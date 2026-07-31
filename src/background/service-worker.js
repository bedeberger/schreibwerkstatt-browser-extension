/**
 * Service Worker (MV3, ESM).
 *
 * Hier — und nur hier — laufen Netzwerkanfragen. Mit `host_permissions`
 * auf den App-Host ist der Worker CORS-befreit; aus einem Content-Script
 * wuerde derselbe Request scheitern.
 *
 * Der Worker faengt keine Navigation ab, beobachtet keinen Verlauf und
 * wird nie von selbst aktiv. Alles beginnt mit einer Nutzeraktion:
 * Popup, Tastenkuerzel oder Kontextmenue.
 */

import { createApiClient, describeDevice } from './api-client.js';
import { probeCapabilities } from './capabilities.js';
import { runCaptureJob } from './capture-runner.js';
import { createQueue } from './queue.js';
import {
  getCapabilities,
  getConfig,
  getSettings,
  getTokenState,
  loadQueue,
  readState,
  saveBooks,
  saveDetectedCapabilities,
  saveQueue,
  saveSettings,
  setCapabilityMode,
  setTokenState,
  writeState,
} from './state.js';

import {
  BOOKS_TTL_MS,
  CAPABILITY_TTL_MS,
  JOB_STATE,
  STORAGE_KEYS,
  TOKEN_PREFIX,
  TOKEN_STATE,
  canWriteToBook,
  capabilityEnabled,
} from '../shared/config.js';
import { ApiError, describeError } from '../shared/errors.js';
import { t } from '../shared/i18n.js';
import { intentFromHarvest } from '../shared/intent.js';
import { LIMITS } from '../shared/limits.js';
import { MSG } from '../shared/messages.js';
import { normalizeServerUrl, toOriginPattern } from '../shared/url.js';

const QUEUE_ALARM = 'schreibwerkstatt-queue';
const CONTEXT_MENU_QUOTE = 'schreibwerkstatt-capture-quote';
const UNDO_NOTIFICATION_PREFIX = 'undo:';

/** Chrome deckelt Alarme in gepackten Erweiterungen auf 30 s. */
const MIN_ALARM_DELAY_MS = 30 * 1000;

// ---------------------------------------------------------------------------
// Grundbausteine
// ---------------------------------------------------------------------------

const api = createApiClient({
  getConfig,
  getClientInfo: async () => ({
    platform: 'chrome',
    device: describeDevice(navigator),
    version: chrome.runtime.getManifest().version,
  }),
  onAuthError: () => {
    // Nie stillschweigend erneut versuchen: Token markieren, Badge rot.
    void setTokenState(TOKEN_STATE.INVALID).then(refreshBadge);
  },
  onScopeError: () => {
    void setTokenState(TOKEN_STATE.SCOPE_MISSING).then(refreshBadge);
  },
});

const queue = createQueue({
  load: loadQueue,
  save: saveQueue,
  translate: t,
});

/** Verhindert, dass zwei Wecker gleichzeitig dieselbe Queue abarbeiten. */
let processing = false;

/**
 * Anhaenge (Screenshot, PDF) NUR im Arbeitsspeicher.
 *
 * Sie gehoeren bewusst nicht in die persistierte Warteschlange: ein PDF darf
 * 25 MB gross sein, als base64 also rund 33 MB — `chrome.storage.local` fasst
 * aber nur etwa 10 MB. Wuerden wir sie mitschreiben, ginge beim Ueberlauf der
 * gesamte Auftrag verloren, nicht nur der Anhang.
 *
 * Folge: ueberlebt ein Auftrag den Neustart des Workers, wird er ohne Anhang
 * gesendet. Der Verlust wird am Auftrag vermerkt und in den Optionen angezeigt
 * — er passiert nicht stillschweigend.
 *
 * @type {Map<string, Record<string, any>>}
 */
const attachmentCache = new Map();

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

async function refreshBadge() {
  const [tokenState, counts] = await Promise.all([getTokenState(), queue.counts()]);

  if (tokenState === TOKEN_STATE.INVALID || tokenState === TOKEN_STATE.SCOPE_MISSING) {
    await setBadge('!', '#c0392b', t('badge_token_problem'));
    return;
  }

  if (counts.failed > 0) {
    await setBadge(String(counts.total), '#c0392b', t('badge_failed', [String(counts.failed)]));
    return;
  }

  if (counts.total > 0) {
    await setBadge(String(counts.total), '#2f6f4f', t('badge_pending', [String(counts.total)]));
    return;
  }

  await setBadge('', '#2f6f4f', t('ext_name'));
}

/**
 * @param {string} text
 * @param {string} color
 * @param {string} title
 */
async function setBadge(text, color, title) {
  try {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setTitle({ title });
  } catch {
    // Beim Herunterfahren des Workers kann das fehlschlagen — unkritisch.
  }
}

// ---------------------------------------------------------------------------
// Faehigkeiten
// ---------------------------------------------------------------------------

/**
 * Aufgeloeste Faehigkeiten. Wenn der Auto-Modus noch keinen Befund hat oder
 * der Befund abgelaufen ist, wird einmal geprobt — nur im Rahmen einer vom
 * Nutzer ausgeloesten Aktion.
 *
 * @param {boolean} [allowProbe]
 * @returns {Promise<{capture: boolean, byUrl: boolean}>}
 */
async function resolveCapabilities(allowProbe = true) {
  let capabilities = await getCapabilities();

  const needsProbe =
    (capabilities.capture.mode === 'auto' && capabilities.capture.detected === null) ||
    (capabilities.byUrl.mode === 'auto' && capabilities.byUrl.detected === null) ||
    Date.now() - (capabilities.probedAt || 0) > CAPABILITY_TTL_MS;

  if (allowProbe && needsProbe) {
    const config = await getConfig();
    const tokenState = await getTokenState();
    if (config.serverUrl && config.token && tokenState !== TOKEN_STATE.INVALID) {
      try {
        const detected = await probeCapabilities(api);
        capabilities = await saveDetectedCapabilities(detected);
      } catch {
        // Probe ist Kuer. Fehlschlag heisst: Fallback-Pfad benutzen.
      }
    }
  }

  return {
    capture: capabilityEnabled(capabilities.capture),
    byUrl: capabilityEnabled(capabilities.byUrl),
  };
}

/** @param {'capture'|'byUrl'} name */
function markCapabilityMissing(name) {
  void getCapabilities().then((capabilities) =>
    saveDetectedCapabilities({
      capture: name === 'capture' ? false : capabilities.capture.detected,
      byUrl: name === 'byUrl' ? false : capabilities.byUrl.detected,
    }),
  );
}

// ---------------------------------------------------------------------------
// Seitenzugriff (nur im Moment der Nutzeraktion)
// ---------------------------------------------------------------------------

/**
 * @returns {Promise<chrome.tabs.Tab|null>}
 */
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

/**
 * Injiziert das Ernte-Script und ruft es auf.
 *
 * Zwei Aufrufe, damit der Rueckgabewert zuverlaessig ankommt: der erste
 * laedt das Buendel, der zweite ruft die registrierte Funktion.
 *
 * @param {number} tabId
 * @param {{includeArticleText?: boolean}} [options]
 */
async function harvestTab(tabId, options = {}) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/harvest.js'],
  });

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    args: [{ includeArticleText: options.includeArticleText !== false }],
    func: (opts) => {
      const bridge = /** @type {any} */ (globalThis).__schreibwerkstatt;
      return bridge ? bridge.harvest(opts) : null;
    },
  });

  const result = results && results[0] ? results[0].result : null;
  if (!result) {
    throw new ApiError({ code: 'HARVEST_FAILED', status: 0, message: 'content script returned nothing' });
  }
  return result;
}

/**
 * Holt ein PDF im Seitenkontext.
 *
 * Der Worker selbst darf fremde Hosts nicht anfragen (keine Host-Permission
 * ausser dem App-Host). Im Seitenkontext ist ein Same-Origin-Abruf dagegen
 * erlaubt — deshalb bieten wir „PDF mitschicken" nur bei gleicher Herkunft an.
 *
 * @param {number} tabId
 * @param {string} pdfUrl
 * @returns {Promise<{base64?: string, size?: number, error?: string}>}
 */
async function fetchPdfInPage(tabId, pdfUrl) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    args: [pdfUrl, LIMITS.DOC_MAX_BYTES],
    func: async (url, maxBytes) => {
      try {
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) return { error: `HTTP_${response.status}` };
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > maxBytes) return { error: 'TOO_LARGE', size: buffer.byteLength };
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
        }
        return { base64: btoa(binary), size: buffer.byteLength };
      } catch (error) {
        return { error: 'FETCH_FAILED' };
      }
    },
  });

  return (results && results[0] && results[0].result) || { error: 'FETCH_FAILED' };
}

/**
 * @param {number} windowId
 * @returns {Promise<{base64: string, contentType: string, size: number}>}
 */
async function captureScreenshot(windowId) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 80 });
  const comma = dataUrl.indexOf(',');
  const base64 = dataUrl.slice(comma + 1);
  const size = Math.floor((base64.length * 3) / 4);
  if (size > LIMITS.IMAGE_MAX_BYTES) {
    throw new ApiError({ status: 400, code: 'CLIENT_IMAGE_TOO_LARGE', params: { size } });
  }
  return { base64, contentType: 'image/jpeg', size };
}

// ---------------------------------------------------------------------------
// Buecher
// ---------------------------------------------------------------------------

/**
 * @param {boolean} [force]
 * @returns {Promise<Array<Record<string, any>>>}
 */
async function fetchBooks(force = false) {
  const state = await readState();
  const age = Date.now() - (state[STORAGE_KEYS.BOOKS_FETCHED_AT] || 0);
  if (!force && state[STORAGE_KEYS.BOOKS].length && age < BOOKS_TTL_MS) {
    return state[STORAGE_KEYS.BOOKS];
  }

  const books = await api.getBooks();
  await saveBooks(books);
  await setTokenState(TOKEN_STATE.VALID);
  await refreshBadge();

  // Ein Standardbuch, das es nicht mehr gibt oder in dem wir nur lesen
  // duerfen, wird zurueckgesetzt statt beim Senden zu scheitern.
  const current = state[STORAGE_KEYS.DEFAULT_BOOK_ID];
  if (current !== null && current !== undefined) {
    const book = books.find((entry) => String(entry.id) === String(current));
    if (!book || !canWriteToBook(book)) {
      await writeState({ [STORAGE_KEYS.DEFAULT_BOOK_ID]: null });
    }
  }

  return books;
}

// ---------------------------------------------------------------------------
// Warteschlange abarbeiten
// ---------------------------------------------------------------------------

async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    const jobs = await queue.due();
    // Nur proben, wenn ohnehin gesendet wird. Ein Wecker, der nichts
    // vorfindet, loest keinen einzigen Netzwerkaufruf aus.
    const capabilities = await resolveCapabilities(jobs.length > 0);

    for (const job of jobs) {
      // Ein Auftrag im Undo-Fenster wird beim Faelligwerden regulaer gesendet.
      await queue.update(job.id, { state: JOB_STATE.RUNNING });
      restoreAttachments(job);
      try {
        await runCaptureJob(job, {
          api,
          capabilities,
          onCapabilityMissing: markCapabilityMissing,
        });
        await queue.complete(job.id);
        attachmentCache.delete(job.id);
        await notifySuccess(job);
      } catch (error) {
        job.intent.attachments = {};
        const { willRetry } = await queue.fail(job.id, error, job.progress);
        if (!willRetry) {
          attachmentCache.delete(job.id);
          await notifyFailure(job, error);
        }
      }
    }
  } finally {
    processing = false;
    await scheduleNextWake();
    await refreshBadge();
  }
}

/**
 * Haengt die im Speicher gehaltenen Anhaenge wieder an den Auftrag.
 * Fehlen sie (Worker-Neustart), wird der Verlust am Auftrag vermerkt.
 *
 * @param {import('../shared/config.js').CaptureJob} job
 */
function restoreAttachments(job) {
  const cached = attachmentCache.get(job.id);
  job.intent.attachments = cached || {};

  const declared = job.intent.attachmentsDeclared || {};
  const stillOutstanding =
    (declared.screenshot && !job.progress.imageUploaded) || (declared.pdf && !job.progress.pdfUploaded);
  if (!cached && stillOutstanding) {
    job.progress.attachmentsLost = true;
  }
}

async function scheduleNextWake() {
  const at = await queue.nextWakeAt();
  if (at === null) {
    await chrome.alarms.clear(QUEUE_ALARM);
    return;
  }
  const delay = Math.max(at - Date.now(), 0);
  // Kurze Wartezeiten (Undo-Fenster) faengt ein Timer ab; der Alarm ist nur
  // das Netz darunter, falls der Worker vorher eingeschlaefert wird.
  if (delay < MIN_ALARM_DELAY_MS) {
    setTimeout(() => {
      void processQueue();
    }, delay + 50);
  }
  await chrome.alarms.create(QUEUE_ALARM, { when: Date.now() + Math.max(delay, MIN_ALARM_DELAY_MS) });
}

// ---------------------------------------------------------------------------
// Benachrichtigungen
// ---------------------------------------------------------------------------

/**
 * @param {string} id
 * @param {chrome.notifications.NotificationOptions} options
 */
async function notify(id, options) {
  const settings = await getSettings();
  if (!settings.notifications) return;
  if (!chrome.notifications) return;
  try {
    await chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      silent: true,
      ...options,
    });
  } catch {
    // Benachrichtigungen sind Komfort, kein Vertrag.
  }
}

/**
 * @param {import('../shared/config.js').CaptureJob} job
 * @param {number} delayMs
 */
async function showUndoNotification(job, delayMs) {
  const seconds = Math.round(delayMs / 1000);
  await notify(`${UNDO_NOTIFICATION_PREFIX}${job.id}`, {
    title: t('notify_quote_captured_title'),
    message: t('notify_quote_captured_message', [
      job.intent.bookName || String(job.intent.bookId ?? ''),
      String(seconds),
    ]),
    contextMessage: (job.intent.body || '').slice(0, 120),
    buttons: [{ title: t('notify_undo_button') }],
    requireInteraction: false,
  });
}

/** @param {import('../shared/config.js').CaptureJob} job */
async function notifySuccess(job) {
  const key =
    job.intent.mode === 'source'
      ? 'notify_saved_source'
      : job.intent.mode === 'both'
        ? 'notify_saved_both'
        : 'notify_saved_research';
  await notify(`done:${job.id}`, {
    title: t('notify_saved_title'),
    message: t(key, [job.intent.bookName || '']),
    contextMessage: job.intent.title.slice(0, 120),
  });
}

/**
 * @param {import('../shared/config.js').CaptureJob} job
 * @param {any} error
 */
async function notifyFailure(job, error) {
  const described = describeError(error, t);
  await notify(`fail:${job.id}`, {
    title: t('notify_failed_title'),
    message: described.text,
    contextMessage: job.intent.title.slice(0, 120),
  });
}

// ---------------------------------------------------------------------------
// Kontextmenue: Zitat erfassen
// ---------------------------------------------------------------------------

async function installContextMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: CONTEXT_MENU_QUOTE,
    title: t('context_menu_capture_quote'),
    contexts: ['selection'],
  });
}

/**
 * Zitat direkt erfassen — ohne Popup, mit Undo-Fenster.
 * @param {chrome.tabs.Tab|undefined} tab
 * @param {string} [fallbackSelection] `info.selectionText`, nur als Notnagel
 */
async function captureQuoteFromTab(tab, fallbackSelection = '') {
  if (!tab || tab.id === undefined) return;

  const state = await readState();
  const settings = state[STORAGE_KEYS.SETTINGS];
  const bookId = state[STORAGE_KEYS.DEFAULT_BOOK_ID];

  if (!state[STORAGE_KEYS.SERVER_URL] || !state[STORAGE_KEYS.TOKEN]) {
    await notify('setup', {
      title: t('notify_setup_needed_title'),
      message: t('notify_setup_needed_message'),
    });
    await chrome.runtime.openOptionsPage();
    return;
  }

  if (bookId === null || bookId === undefined) {
    await notify('nobook', {
      title: t('notify_no_book_title'),
      message: t('notify_no_book_message'),
    });
    await chrome.runtime.openOptionsPage();
    return;
  }

  let harvested;
  try {
    // Kein Fliesstext noetig — das Zitat ist die Markierung.
    harvested = await harvestTab(tab.id, { includeArticleText: false });
  } catch (error) {
    // Auf Seiten, die keine Injektion erlauben (chrome://, Web Store),
    // bleibt nur der von Chrome gelieferte, gekuerzte Text.
    harvested = null;
  }

  const selection = (harvested && harvested.selectionText) || fallbackSelection || '';
  if (!selection.trim()) {
    await notify('noselection', {
      title: t('notify_no_selection_title'),
      message: t('notify_no_selection_message'),
    });
    return;
  }

  if (selection.length > LIMITS.BODY_MAX) {
    await notify('toolong', {
      title: t('notify_quote_too_long_title'),
      message: t('notify_quote_too_long_message', [String(LIMITS.BODY_MAX), String(selection.length)]),
    });
    return;
  }

  const book = (state[STORAGE_KEYS.BOOKS] || []).find((entry) => String(entry.id) === String(bookId));

  const intent = intentFromHarvest(harvested || { meta: { url: tab.url || '' }, hasSelection: true, selectionText: selection }, {
    mode: 'research',
    bookId,
    bookName: book ? book.name : '',
  });
  // Der Wortlaut bleibt exakt, auch wenn die Ernte scheiterte.
  intent.body = selection;
  intent.kind = 'quote';
  if (!intent.title) intent.title = (tab.title || '').slice(0, LIMITS.TITLE_MAX);

  // Ohne Hinweise gibt es keinen Rueckgaengig-Knopf — dann waere das
  // Warten nur eine Verzoegerung ohne Gegenwert.
  const holdMs = settings.notifications ? settings.undoDelayMs : 0;

  const job = await queue.add(intent, { holdMs });
  if (holdMs > 0) await showUndoNotification(job, holdMs);
  await refreshBadge();
  await scheduleNextWake();
  if (holdMs === 0) await processQueue();
}

// ---------------------------------------------------------------------------
// Nachrichten aus Popup und Options-Seite
// ---------------------------------------------------------------------------

/**
 * @param {any} message
 * @param {chrome.runtime.MessageSender} sender
 */
async function handleMessage(message, sender) {
  switch (message.type) {
    case MSG.GET_STATE: {
      const state = await readState();
      const counts = await queue.counts();
      return {
        serverUrl: state[STORAGE_KEYS.SERVER_URL],
        hasToken: !!state[STORAGE_KEYS.TOKEN],
        tokenState: state[STORAGE_KEYS.TOKEN_STATE],
        defaultBookId: state[STORAGE_KEYS.DEFAULT_BOOK_ID],
        books: state[STORAGE_KEYS.BOOKS],
        booksFetchedAt: state[STORAGE_KEYS.BOOKS_FETCHED_AT],
        capabilities: state[STORAGE_KEYS.CAPABILITIES],
        settings: state[STORAGE_KEYS.SETTINGS],
        queue: state[STORAGE_KEYS.QUEUE],
        counts,
        version: chrome.runtime.getManifest().version,
      };
    }

    case MSG.HARVEST_ACTIVE_TAB: {
      const tab = await activeTab();
      if (!tab || tab.id === undefined) throw new ApiError({ code: 'NO_ACTIVE_TAB' });
      const settings = await getSettings();
      const harvested = await harvestTab(tab.id, {
        includeArticleText: message.includeArticleText ?? settings.harvestArticleText,
      });
      return { harvested, tab: { id: tab.id, url: tab.url, title: tab.title, windowId: tab.windowId } };
    }

    case MSG.REFRESH_BOOKS:
      return { books: await fetchBooks(true) };

    case MSG.TEST_CONNECTION: {
      const books = await fetchBooks(true);
      const detected = await probeCapabilities(api);
      const capabilities = await saveDetectedCapabilities(detected);
      return { books, capabilities, tokenState: await getTokenState() };
    }

    case MSG.CHECK_DUPLICATE: {
      const capabilities = await resolveCapabilities(true);
      if (!capabilities.byUrl) return { supported: false };
      try {
        const found = await api.findSourceByUrl(message.url, message.bookId ?? '');
        return { supported: true, found: true, source: found.source, linkedToBook: !!found.linked_to_book };
      } catch (error) {
        const err = /** @type {any} */ (error);
        if (err.status === 404) return { supported: true, found: false };
        throw error;
      }
    }

    case MSG.LOOKUP_METADATA:
      return api.lookup({ doi: message.doi, isbn: message.isbn });

    case MSG.CAPTURE_SCREENSHOT: {
      const tab = await activeTab();
      if (!tab || tab.windowId === undefined) throw new ApiError({ code: 'NO_ACTIVE_TAB' });
      return captureScreenshot(tab.windowId);
    }

    case MSG.SUBMIT_CAPTURE: {
      /** @type {import('../shared/config.js').CaptureIntent} */
      const intent = message.intent;

      /** @type {Record<string, any>} */
      const attachments = {};

      // PDF erst jetzt holen — im Seitenkontext, solange der Tab noch da ist.
      if (message.attachPdf && message.pdfUrl && message.tabId !== undefined) {
        const result = await fetchPdfInPage(message.tabId, message.pdfUrl);
        if (result.base64) {
          attachments.pdf = { bytes: result.base64, size: result.size };
        } else {
          return { queued: false, pdfError: result.error || 'FETCH_FAILED' };
        }
      }

      if (message.screenshot && message.screenshot.base64) {
        attachments.screenshot = {
          bytes: message.screenshot.base64,
          contentType: message.screenshot.contentType,
        };
      }

      // Die Nutzdaten bleiben im Speicher, nur die Absicht wird persistiert.
      intent.attachments = {};
      intent.attachmentsDeclared = {
        screenshot: !!attachments.screenshot,
        pdf: !!attachments.pdf,
      };

      const job = await queue.add(intent, { holdMs: 0 });
      if (attachments.screenshot || attachments.pdf) attachmentCache.set(job.id, attachments);
      await refreshBadge();
      // Sofort versuchen; bei Erfolg ist der Auftrag beim Antworten schon weg.
      await processQueue();
      const remaining = await queue.list();
      const stillThere = remaining.find((entry) => entry.id === job.id);
      return {
        queued: true,
        jobId: job.id,
        done: !stillThere,
        job: stillThere || null,
      };
    }

    case MSG.FLUSH_QUEUE:
      await processQueue();
      return { counts: await queue.counts() };

    case MSG.RETRY_JOB:
      await queue.retryNow(message.jobId);
      await processQueue();
      return { counts: await queue.counts() };

    case MSG.UNDO_JOB: {
      const undone = await queue.undo(message.jobId);
      if (undone) attachmentCache.delete(message.jobId);
      await refreshBadge();
      return { undone };
    }

    case MSG.DISCARD_JOB:
      await queue.discard(message.jobId);
      attachmentCache.delete(message.jobId);
      await refreshBadge();
      return { counts: await queue.counts() };

    case MSG.SET_CAPABILITY_MODE:
      return { capabilities: await setCapabilityMode(message.name, message.mode) };

    case MSG.SAVE_CREDENTIALS: {
      const serverUrl = normalizeServerUrl(message.serverUrl);
      if (!serverUrl) throw new ApiError({ code: 'INVALID_SERVER_URL', status: 400 });

      const token = String(message.token || '').trim();
      await writeState({
        [STORAGE_KEYS.SERVER_URL]: serverUrl,
        ...(token ? { [STORAGE_KEYS.TOKEN]: token } : {}),
        [STORAGE_KEYS.TOKEN_STATE]: TOKEN_STATE.UNKNOWN,
        // Ein Serverwechsel macht Buecher und Faehigkeits-Befunde ungueltig.
        [STORAGE_KEYS.BOOKS]: [],
        [STORAGE_KEYS.BOOKS_FETCHED_AT]: 0,
      });
      await saveDetectedCapabilities({ capture: null, byUrl: null });
      await refreshBadge();
      return { serverUrl, originPattern: toOriginPattern(serverUrl), tokenLooksValid: token.startsWith(TOKEN_PREFIX) };
    }

    case MSG.SAVE_SETTINGS:
      return { settings: await saveSettings(message.settings || {}) };

    case MSG.SET_DEFAULT_BOOK:
      await writeState({ [STORAGE_KEYS.DEFAULT_BOOK_ID]: message.bookId ?? null });
      return { defaultBookId: message.bookId ?? null };

    default:
      throw new ApiError({ code: 'UNKNOWN_MESSAGE', message: String(message.type) });
  }
}

// ---------------------------------------------------------------------------
// Ereignisse
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    await installContextMenus();
    await refreshBadge();
    await scheduleNextWake();
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    await installContextMenus();
    await refreshBadge();
    await processQueue();
  })();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_QUOTE) return;
  void captureQuoteFromTab(tab, info.selectionText || '');
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'capture-quote') void captureQuoteFromTab(tab);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === QUEUE_ALARM) void processQueue();
});

if (chrome.notifications) {
  chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
    if (!notificationId.startsWith(UNDO_NOTIFICATION_PREFIX) || buttonIndex !== 0) return;
    void (async () => {
      const jobId = notificationId.slice(UNDO_NOTIFICATION_PREFIX.length);
      const undone = await queue.undo(jobId);
      if (undone) attachmentCache.delete(jobId);
      await chrome.notifications.clear(notificationId);
      await refreshBadge();
      await notify(`undone:${jobId}`, {
        title: undone ? t('notify_undone_title') : t('notify_undo_too_late_title'),
        message: undone ? t('notify_undone_message') : t('notify_undo_too_late_message'),
      });
    })();
  });

  chrome.notifications.onClicked.addListener((notificationId) => {
    void chrome.notifications.clear(notificationId);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => {
      const described = describeError(error, t);
      sendResponse({
        ok: false,
        error: {
          code: described.code,
          message: described.text,
          status: /** @type {any} */ (error)?.status ?? 0,
          key: described.key,
          auth: described.auth,
          scope: described.scope,
        },
      });
    });
  return true; // asynchrone Antwort
});

// Beim Kaltstart des Workers den Zustand wiederherstellen.
void (async () => {
  await refreshBadge();
  await scheduleNextWake();
})();
