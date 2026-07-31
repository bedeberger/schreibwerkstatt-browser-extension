/**
 * Options-Seite: Verbindung einrichten, Standardbuch waehlen,
 * Verhalten einstellen, Warteschlange einsehen.
 *
 * Die Host-Berechtigung wird hier angefragt — ausdruecklich einzeln fuer
 * den eingetragenen Host, nie fuer alle Seiten.
 */

import { CAPABILITY_MODE, TOKEN_PREFIX, TOKEN_STATE, canWriteToBook } from '../shared/config.js';
import { applyI18n, formatRelativeTime, t } from '../shared/i18n.js';
import { MSG, send } from '../shared/messages.js';
import { isLocalHost, normalizeServerUrl, toOriginPattern } from '../shared/url.js';

const el = (id) => /** @type {any} */ (document.getElementById(id));

const ui = {
  serverUrl: el('server-url'),
  serverUrlHint: el('server-url-hint'),
  token: el('token'),
  toggleToken: el('toggle-token'),
  tokenFormatHint: el('token-format-hint'),
  saveConnection: el('save-connection'),
  grantPermission: el('grant-permission'),
  testConnection: el('test-connection'),
  permissionState: el('permission-state'),
  connectionResult: el('connection-result'),

  defaultBook: el('default-book'),
  booksMeta: el('books-meta'),
  refreshBooks: el('refresh-books'),
  booklist: el('booklist'),

  defaultMode: el('default-mode'),
  defaultKind: el('default-kind'),
  undoDelay: el('undo-delay'),
  harvestArticleText: el('harvest-article-text'),
  notifications: el('notifications'),
  duplicateCheck: el('duplicate-check'),
  saveSettings: el('save-settings'),
  settingsSaved: el('settings-saved'),

  capCaptureDetected: el('cap-capture-detected'),
  capCaptureMode: el('cap-capture-mode'),
  capByUrlDetected: el('cap-byurl-detected'),
  capByUrlMode: el('cap-byurl-mode'),
  capProbedAt: el('cap-probed-at'),

  flushQueue: el('flush-queue'),
  queue: el('queue'),
  queueEmpty: el('queue-empty'),

  versionLine: el('version-line'),
};

/** @type {any} */
let state = null;

// ---------------------------------------------------------------------------

async function init() {
  applyI18n();
  wireEvents();
  await reload();
}

async function reload() {
  state = await send(MSG.GET_STATE);

  ui.serverUrl.value = state.serverUrl || '';
  ui.token.value = state.hasToken ? '••••••••••••••••' : '';
  ui.token.dataset.untouched = state.hasToken ? 'true' : '';

  ui.defaultMode.value = state.settings.defaultMode;
  ui.defaultKind.value = state.settings.defaultKind;
  ui.undoDelay.value = String(Math.round(state.settings.undoDelayMs / 1000));
  ui.harvestArticleText.checked = !!state.settings.harvestArticleText;
  ui.notifications.checked = !!state.settings.notifications;
  ui.duplicateCheck.checked = !!state.settings.duplicateCheck;

  ui.capCaptureMode.value = state.capabilities.capture.mode;
  ui.capByUrlMode.value = state.capabilities.byUrl.mode;

  ui.versionLine.textContent = t('options_version', [state.version]);

  renderTokenState();
  renderBooks();
  renderCapabilities();
  renderQueue();
  await renderPermissionState();
}

function wireEvents() {
  ui.serverUrl.addEventListener('input', () => {
    const normalized = normalizeServerUrl(ui.serverUrl.value);
    if (!ui.serverUrl.value.trim()) {
      ui.serverUrlHint.textContent = '';
      return;
    }
    if (!normalized) {
      ui.serverUrlHint.textContent = t('options_server_url_invalid');
      return;
    }
    // http nur fuer lokale Entwicklung durchgehen lassen.
    if (normalized.startsWith('http://') && !isLocalHost(normalized)) {
      ui.serverUrlHint.textContent = t('options_server_url_insecure');
      return;
    }
    ui.serverUrlHint.textContent = t('options_server_url_normalized', [normalized]);
  });

  ui.token.addEventListener('input', () => {
    ui.token.dataset.untouched = '';
    const value = ui.token.value.trim();
    ui.tokenFormatHint.hidden = !value || value.startsWith(TOKEN_PREFIX);
  });

  ui.toggleToken.addEventListener('click', () => {
    const shown = ui.token.type === 'text';
    ui.token.type = shown ? 'password' : 'text';
    ui.toggleToken.textContent = shown ? t('options_show_token') : t('options_hide_token');
  });

  ui.saveConnection.addEventListener('click', () => void saveConnection());
  ui.grantPermission.addEventListener('click', () => void requestPermission());
  ui.testConnection.addEventListener('click', () => void testConnection());

  ui.refreshBooks.addEventListener('click', () => void refreshBooks());
  ui.defaultBook.addEventListener('change', () => void setDefaultBook());

  ui.saveSettings.addEventListener('click', () => void saveSettings());

  ui.capCaptureMode.addEventListener('change', () =>
    void setCapabilityMode('capture', ui.capCaptureMode.value),
  );
  ui.capByUrlMode.addEventListener('change', () => void setCapabilityMode('byUrl', ui.capByUrlMode.value));

  ui.flushQueue.addEventListener('click', () => void flushQueue());
}

// ------------------------------------------------------------------ Verbindung

async function saveConnection() {
  hideNotice(ui.connectionResult);

  const serverUrl = normalizeServerUrl(ui.serverUrl.value);
  if (!serverUrl) {
    showNotice(ui.connectionResult, t('options_server_url_invalid'), 'error');
    return;
  }

  // Unveraendertes Maskenfeld bedeutet: Token bleibt, wie es ist.
  const token = ui.token.dataset.untouched === 'true' ? '' : ui.token.value.trim();

  try {
    const result = await send(MSG.SAVE_CREDENTIALS, { serverUrl, token });
    ui.serverUrl.value = result.serverUrl;
    showNotice(ui.connectionResult, t('options_saved'), 'success');
    await reload();
  } catch (error) {
    showNotice(ui.connectionResult, errorText(error), 'error');
  }
}

async function requestPermission() {
  const pattern = toOriginPattern(ui.serverUrl.value);
  if (!pattern) {
    showNotice(ui.connectionResult, t('options_server_url_invalid'), 'error');
    return;
  }
  try {
    // Muss aus einer Nutzergeste kommen — daher direkt im Klick-Handler.
    const granted = await chrome.permissions.request({ origins: [pattern] });
    if (!granted) {
      showNotice(ui.connectionResult, t('options_permission_denied'), 'error');
    }
    await renderPermissionState();
  } catch (error) {
    showNotice(ui.connectionResult, errorText(error), 'error');
  }
}

async function renderPermissionState() {
  const pattern = toOriginPattern(ui.serverUrl.value || state?.serverUrl);
  if (!pattern) {
    ui.permissionState.hidden = true;
    ui.grantPermission.disabled = true;
    return;
  }
  ui.grantPermission.disabled = false;
  const granted = await chrome.permissions.contains({ origins: [pattern] });
  ui.permissionState.textContent = granted
    ? t('options_permission_granted', [pattern])
    : t('options_permission_missing', [pattern]);
  ui.permissionState.classList.toggle('notice--warn', !granted);
  ui.permissionState.classList.toggle('notice--muted', granted);
  ui.permissionState.hidden = false;
  ui.grantPermission.hidden = granted;
}

async function testConnection() {
  ui.testConnection.disabled = true;
  showNotice(ui.connectionResult, t('options_testing'), 'muted');
  try {
    const result = await send(MSG.TEST_CONNECTION);
    showNotice(
      ui.connectionResult,
      t('options_test_ok', [String(result.books.length)]),
      'success',
    );
    await reload();
  } catch (error) {
    showNotice(ui.connectionResult, errorText(error), 'error');
    await reload();
  } finally {
    ui.testConnection.disabled = false;
  }
}

function renderTokenState() {
  if (state.tokenState === TOKEN_STATE.INVALID) {
    showNotice(ui.connectionResult, t('err_not_logged_in') + ' (NOT_LOGGED_IN)', 'error');
  } else if (state.tokenState === TOKEN_STATE.SCOPE_MISSING) {
    showNotice(ui.connectionResult, t('err_capture_scope_required') + ' (CAPTURE_SCOPE_REQUIRED)', 'error');
  }
}

// ---------------------------------------------------------------------- Bücher

function renderBooks() {
  ui.defaultBook.replaceChildren();
  ui.booklist.replaceChildren();

  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = t('options_no_default_book');
  ui.defaultBook.append(empty);

  for (const book of state.books || []) {
    const writable = canWriteToBook(book);

    const option = document.createElement('option');
    option.value = String(book.id);
    option.disabled = !writable;
    option.textContent = writable ? book.name : `${book.name} — ${t('role_viewer')}`;
    ui.defaultBook.append(option);

    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = book.name;
    const meta = document.createElement('span');
    meta.textContent = [t(`role_${book.role}`) || book.role, book.buchtyp, book.owner_email]
      .filter(Boolean)
      .join(' · ');
    item.append(name, meta);
    ui.booklist.append(item);
  }

  if (state.defaultBookId !== null && state.defaultBookId !== undefined) {
    ui.defaultBook.value = String(state.defaultBookId);
  }

  ui.booksMeta.textContent = state.booksFetchedAt
    ? t('options_books_fetched', [formatRelativeTime(state.booksFetchedAt)])
    : t('options_books_never');
}

async function refreshBooks() {
  ui.refreshBooks.disabled = true;
  try {
    await send(MSG.REFRESH_BOOKS);
    await reload();
  } catch (error) {
    showNotice(ui.connectionResult, errorText(error), 'error');
  } finally {
    ui.refreshBooks.disabled = false;
  }
}

async function setDefaultBook() {
  const value = ui.defaultBook.value;
  await send(MSG.SET_DEFAULT_BOOK, { bookId: value ? Number(value) : null });
  flash(ui.settingsSaved);
}

// -------------------------------------------------------------------- Verhalten

async function saveSettings() {
  const seconds = Math.min(30, Math.max(0, Number(ui.undoDelay.value) || 0));
  await send(MSG.SAVE_SETTINGS, {
    settings: {
      defaultMode: ui.defaultMode.value,
      defaultKind: ui.defaultKind.value,
      undoDelayMs: seconds * 1000,
      harvestArticleText: ui.harvestArticleText.checked,
      notifications: ui.notifications.checked,
      duplicateCheck: ui.duplicateCheck.checked,
    },
  });
  ui.undoDelay.value = String(seconds);
  flash(ui.settingsSaved);
}

// ---------------------------------------------------------------- Fähigkeiten

function renderCapabilities() {
  ui.capCaptureDetected.textContent = detectedLabel(state.capabilities.capture.detected);
  ui.capByUrlDetected.textContent = detectedLabel(state.capabilities.byUrl.detected);
  ui.capProbedAt.textContent = state.capabilities.probedAt
    ? t('options_cap_probed', [formatRelativeTime(state.capabilities.probedAt)])
    : t('options_cap_never_probed');
}

/** @param {boolean|null} value */
function detectedLabel(value) {
  if (value === true) return t('options_cap_yes');
  if (value === false) return t('options_cap_no');
  return t('options_cap_unknown');
}

/**
 * @param {'capture'|'byUrl'} name
 * @param {string} mode
 */
async function setCapabilityMode(name, mode) {
  if (!Object.values(CAPABILITY_MODE).includes(mode)) return;
  await send(MSG.SET_CAPABILITY_MODE, { name, mode });
  flash(ui.settingsSaved);
}

// ------------------------------------------------------------- Warteschlange

function renderQueue() {
  ui.queue.replaceChildren();
  const jobs = state.queue || [];
  ui.queueEmpty.hidden = jobs.length > 0;

  for (const job of jobs) {
    const item = document.createElement('li');

    const head = document.createElement('div');
    head.className = 'queue__head';

    const title = document.createElement('span');
    title.className = 'queue__title';
    title.textContent = job.intent.title || t('options_queue_untitled');

    const meta = document.createElement('span');
    meta.className = 'queue__meta';
    meta.textContent = [
      t(`mode_${job.intent.mode}`),
      t(`queue_state_${job.state}`),
      job.attempts ? t('options_queue_attempts', [String(job.attempts)]) : '',
      formatRelativeTime(job.createdAt),
    ]
      .filter(Boolean)
      .join(' · ');

    head.append(title, meta);

    const url = document.createElement('div');
    url.className = 'queue__url';
    url.textContent = job.intent.normalizedUrl || job.intent.url || '';

    item.append(head, url);

    if (job.lastError) {
      const error = document.createElement('div');
      error.className = 'queue__error';
      error.textContent = job.lastError.text;
      item.append(error);
    }

    if (job.progress && job.progress.attachmentsLost) {
      const lost = document.createElement('div');
      lost.className = 'queue__error';
      lost.textContent = t('options_queue_attachment_lost');
      item.append(lost);
    }

    const actions = document.createElement('div');
    actions.className = 'queue__actions';

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'button button--ghost';
    retry.textContent = t('options_queue_retry');
    retry.addEventListener('click', () => void retryJob(job.id));

    const discard = document.createElement('button');
    discard.type = 'button';
    discard.className = 'button button--ghost button--danger';
    discard.textContent = t('options_queue_discard');
    discard.addEventListener('click', () => void discardJob(job.id, job.intent.title));

    actions.append(retry, discard);
    item.append(actions);

    ui.queue.append(item);
  }
}

async function flushQueue() {
  ui.flushQueue.disabled = true;
  try {
    await send(MSG.FLUSH_QUEUE);
    await reload();
  } finally {
    ui.flushQueue.disabled = false;
  }
}

/** @param {string} jobId */
async function retryJob(jobId) {
  await send(MSG.RETRY_JOB, { jobId });
  await reload();
}

/**
 * @param {string} jobId
 * @param {string} title
 */
async function discardJob(jobId, title) {
  // Verwerfen ist der einzige Weg, auf dem Daten verloren gehen — also fragen.
  if (!window.confirm(t('options_queue_discard_confirm', [title || '']))) return;
  await send(MSG.DISCARD_JOB, { jobId });
  await reload();
}

// ------------------------------------------------------------------- Helfer

/**
 * @param {HTMLElement} node
 * @param {string} text
 * @param {'error'|'success'|'muted'|'warn'} tone
 */
function showNotice(node, text, tone) {
  node.textContent = text;
  node.classList.remove('notice--error', 'notice--success', 'notice--muted', 'notice--warn');
  node.classList.add(`notice--${tone}`);
  node.hidden = false;
}

/** @param {HTMLElement} node */
function hideNotice(node) {
  node.hidden = true;
}

/** @param {HTMLElement} node */
function flash(node) {
  node.hidden = false;
  setTimeout(() => {
    node.hidden = true;
  }, 1600);
}

/** @param {any} error */
function errorText(error) {
  return (error && error.message) || t('err_unknown');
}

void init();
