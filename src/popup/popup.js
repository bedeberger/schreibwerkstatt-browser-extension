/**
 * Popup: vorausgefuelltes Formular fuer die Erfassung.
 *
 * Das Popup ruft selbst nichts im Netz auf. Es erntet ueber den Service
 * Worker (der injiziert das Content-Script) und schickt den fertigen
 * Auftrag ebenfalls an den Worker.
 */

import { canWriteToBook, TOKEN_STATE } from '../shared/config.js';
import { applyI18n, t } from '../shared/i18n.js';
import { intentFromHarvest, mergeLookup } from '../shared/intent.js';
import { CSL_TYPES, LIMITS, validateResearchPayload, validateSourcePayload } from '../shared/limits.js';
import { MSG, send } from '../shared/messages.js';
import { formatPeople, parsePeople } from '../shared/people.js';
import { hostLabel, normalizeUrl } from '../shared/url.js';

const el = (id) => /** @type {any} */ (document.getElementById(id));

const ui = {
  loading: el('loading'),
  setupNeeded: el('setup-needed'),
  tokenProblem: el('token-problem'),
  tokenProblemText: el('token-problem-text'),
  form: el('capture-form'),
  queueChip: el('queue-chip'),

  book: el('book'),
  bookHint: el('book-hint'),
  kind: el('kind'),
  tags: el('tags'),
  title: el('title'),
  titleCounter: el('title-counter'),
  body: el('body'),
  bodyCounter: el('body-counter'),
  truncationHint: el('truncation-hint'),
  verbatimHint: el('verbatim-hint'),
  duplicateNotice: el('duplicate-notice'),
  provenanceNotice: el('provenance-notice'),

  sourceFields: el('source-fields'),
  cslType: el('csl-type'),
  year: el('year'),
  authors: el('authors'),
  authorsParsed: el('authors-parsed'),
  containerTitle: el('container-title'),
  publisher: el('publisher'),
  place: el('place'),
  doi: el('doi'),
  isbn: el('isbn'),
  lookup: el('lookup'),
  lookupStatus: el('lookup-status'),
  sourceUrl: el('source-url'),
  accessedAt: el('accessed-at'),
  citekey: el('citekey'),
  note: el('note'),

  attachScreenshot: el('attach-screenshot'),
  attachPdfRow: el('attach-pdf-row'),
  attachPdf: el('attach-pdf'),
  pdfHint: el('pdf-hint'),

  formError: el('form-error'),
  formSuccess: el('form-success'),
  submit: el('submit'),
  cancel: el('cancel'),
};

/** @type {{state: any, harvested: any, tab: any, intent: any}} */
const context = { state: null, harvested: null, tab: null, intent: null };

// ---------------------------------------------------------------------------
// Aufbau
// ---------------------------------------------------------------------------

async function init() {
  applyI18n();
  fillCslTypes();
  wireEvents();

  try {
    context.state = await send(MSG.GET_STATE);
  } catch (error) {
    showFatal(error);
    return;
  }

  updateQueueChip(context.state.counts);

  if (!context.state.serverUrl || !context.state.hasToken) {
    ui.loading.hidden = true;
    ui.setupNeeded.hidden = false;
    return;
  }

  if (context.state.tokenState === TOKEN_STATE.INVALID) {
    showTokenProblem(`${t('err_not_logged_in')} (NOT_LOGGED_IN)`);
  } else if (context.state.tokenState === TOKEN_STATE.SCOPE_MISSING) {
    showTokenProblem(`${t('err_capture_scope_required')} (CAPTURE_SCOPE_REQUIRED)`);
  }

  fillBooks(context.state.books, context.state.defaultBookId);

  try {
    const result = await send(MSG.HARVEST_ACTIVE_TAB, {
      includeArticleText: context.state.settings.harvestArticleText,
    });
    context.harvested = result.harvested;
    context.tab = result.tab;
  } catch (error) {
    // Auf chrome://-Seiten und im Web Store ist keine Injektion moeglich.
    ui.loading.hidden = true;
    ui.form.hidden = false;
    showError(error);
    return;
  }

  prefill();
  ui.loading.hidden = true;
  ui.form.hidden = false;

  void checkDuplicate();
}

function fillCslTypes() {
  for (const type of CSL_TYPES) {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = t(`csl_${type}`);
    ui.cslType.append(option);
  }
}

/**
 * @param {Array<Record<string, any>>} books
 * @param {number|string|null} defaultBookId
 */
function fillBooks(books, defaultBookId) {
  ui.book.replaceChildren();

  if (!books.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = t('popup_no_books');
    ui.book.append(option);
    return;
  }

  let hasViewerOnly = false;
  for (const book of books) {
    const option = document.createElement('option');
    option.value = String(book.id);
    const writable = canWriteToBook(book);
    if (!writable) hasViewerOnly = true;
    // Bücher mit `viewer` ausgrauen, nicht verstecken.
    option.disabled = !writable;
    option.textContent = writable ? book.name : `${book.name} — ${t('role_viewer')}`;
    ui.book.append(option);
  }

  ui.bookHint.hidden = !hasViewerOnly;

  const preferred = books.find((book) => String(book.id) === String(defaultBookId) && canWriteToBook(book));
  const firstWritable = books.find(canWriteToBook);
  const chosen = preferred || firstWritable;
  if (chosen) ui.book.value = String(chosen.id);
}

function prefill() {
  const settings = context.state.settings;
  const bookId = ui.book.value || null;
  const book = (context.state.books || []).find((entry) => String(entry.id) === String(bookId));

  const intent = intentFromHarvest(context.harvested, {
    mode: settings.defaultMode,
    defaultKind: settings.defaultKind,
    bookId,
    bookName: book ? book.name : '',
  });
  context.intent = intent;

  for (const radio of document.querySelectorAll('input[name="mode"]')) {
    /** @type {HTMLInputElement} */ (radio).checked = radio.value === intent.mode;
  }

  ui.kind.value = intent.kind;
  ui.title.value = intent.title;
  ui.body.value = intent.body;
  ui.tags.value = '';

  ui.cslType.value = intent.source.csl_type;
  ui.year.value = intent.source.year ? String(intent.source.year) : '';
  ui.authors.value = formatPeople(intent.source.authors);
  ui.containerTitle.value = intent.source.container_title;
  ui.publisher.value = intent.source.publisher;
  ui.place.value = intent.source.place;
  ui.doi.value = intent.source.doi;
  ui.isbn.value = intent.source.isbn;
  ui.sourceUrl.value = intent.source.url;
  ui.accessedAt.value = intent.source.accessed_at;
  ui.citekey.value = '';
  ui.note.value = '';

  const harvested = context.harvested;

  // Sichtbarer Hinweis, wenn der Fliesstext gekuerzt wurde.
  if (harvested.bodyTruncated) {
    ui.truncationHint.textContent = t('popup_truncated_hint', [
      String(LIMITS.BODY_MAX),
      String(harvested.bodyOriginalLength),
    ]);
    ui.truncationHint.hidden = false;
  }

  ui.verbatimHint.hidden = !harvested.hasSelection;

  // PDF nur anbieten, wenn es same-origin liegt — sonst fehlt die Berechtigung.
  if (harvested.meta.pdfUrl) {
    ui.attachPdfRow.hidden = false;
    if (!harvested.meta.pdfSameOrigin) {
      ui.attachPdf.disabled = true;
      ui.pdfHint.textContent = t('popup_pdf_cross_origin', [hostLabel(harvested.meta.pdfUrl)]);
      ui.pdfHint.hidden = false;
    }
  }

  // DOI/ISBN vorhanden -> kanonische Angaben anbieten (und empfehlen).
  if (intent.source.doi || intent.source.isbn) {
    ui.lookup.hidden = false;
    if (intent.source.doi) {
      ui.lookupStatus.textContent = t('popup_lookup_recommended');
      ui.lookupStatus.hidden = false;
    }
  }

  showProvenance(harvested.meta.provenance, harvested.meta.bylineHint);
  updateCounters();
  updateAuthorsPreview();
  updateModeVisibility();
}

/**
 * Zeigt, woher die wichtigsten Felder stammen — geerntet ist nicht belegt.
 * @param {Record<string, string>} provenance
 * @param {string} [bylineHint]
 */
function showProvenance(provenance, bylineHint) {
  const layers = new Set(Object.values(provenance || {}));
  /** @type {string[]} */
  const parts = [];

  if (layers.has('citation')) parts.push(t('provenance_citation'));
  else if (layers.has('jsonld')) parts.push(t('provenance_jsonld'));
  else if (layers.has('dublincore')) parts.push(t('provenance_dublincore'));
  else if (layers.has('opengraph')) parts.push(t('provenance_opengraph'));
  else parts.push(t('provenance_fallback'));

  if (bylineHint) parts.push(t('provenance_byline_hint', [bylineHint]));

  ui.provenanceNotice.textContent = parts.join(' · ');
  ui.provenanceNotice.hidden = false;
}

// ---------------------------------------------------------------------------
// Ereignisse
// ---------------------------------------------------------------------------

function wireEvents() {
  ui.title.addEventListener('input', updateCounters);
  ui.body.addEventListener('input', updateCounters);
  ui.authors.addEventListener('input', updateAuthorsPreview);
  ui.book.addEventListener('change', () => void checkDuplicate());

  for (const radio of document.querySelectorAll('input[name="mode"]')) {
    radio.addEventListener('change', () => {
      updateModeVisibility();
      void checkDuplicate();
    });
  }

  ui.lookup.addEventListener('click', () => void runLookup());
  ui.form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit();
  });
  ui.cancel.addEventListener('click', () => window.close());

  for (const id of ['open-options', 'goto-options', 'goto-options-2']) {
    const node = document.getElementById(id);
    if (node) node.addEventListener('click', () => chrome.runtime.openOptionsPage());
  }
}

function updateModeVisibility() {
  const mode = currentMode();
  el('research-fields').hidden = mode === 'source';
  // Bei „Quelle" und „Beides" sind die bibliografischen Angaben das Wichtige,
  // also aufgeklappt. Bei reiner Recherche bleiben sie eingeklappt erreichbar.
  if (mode !== 'research') ui.sourceFields.open = true;
}

function currentMode() {
  const checked = /** @type {HTMLInputElement|null} */ (document.querySelector('input[name="mode"]:checked'));
  return checked ? checked.value : 'research';
}

function updateCounters() {
  setCounter(ui.titleCounter, ui.title.value.length, LIMITS.TITLE_MAX);
  setCounter(ui.bodyCounter, ui.body.value.length, LIMITS.BODY_MAX);
}

/**
 * @param {HTMLElement} node
 * @param {number} value
 * @param {number} max
 */
function setCounter(node, value, max) {
  node.textContent = `${value} / ${max}`;
  node.classList.toggle('counter--over', value > max);
}

function updateAuthorsPreview() {
  const people = parsePeople(ui.authors.value);
  if (!people.length) {
    ui.authorsParsed.textContent = '';
    return;
  }
  const rendered = people
    .map((person) =>
      person.literal
        ? t('popup_author_literal', [person.literal])
        : `${person.family}, ${person.given}`,
    )
    .join(' · ');
  ui.authorsParsed.textContent = rendered;
}

// ---------------------------------------------------------------------------
// Dubletten und Lookup
// ---------------------------------------------------------------------------

async function checkDuplicate() {
  ui.duplicateNotice.hidden = true;
  if (!context.harvested) return;
  if (!context.state.settings.duplicateCheck) return;
  if (currentMode() === 'research') return;

  const url = normalizeUrl(ui.sourceUrl.value || context.harvested.meta.normalizedUrl);
  if (!url) return;

  try {
    const result = await send(MSG.CHECK_DUPLICATE, { url, bookId: ui.book.value || null });
    if (!result.supported || !result.found) return;
    ui.duplicateNotice.textContent = result.linkedToBook
      ? t('popup_duplicate_in_book')
      : t('popup_duplicate_in_library');
    ui.duplicateNotice.hidden = false;
  } catch {
    // Dubletten-Pruefung ist Komfort; ein Fehler blockiert das Erfassen nicht.
  }
}

async function runLookup() {
  ui.lookup.disabled = true;
  ui.lookupStatus.textContent = t('popup_lookup_running');
  ui.lookupStatus.hidden = false;

  try {
    const doi = ui.doi.value.trim();
    const isbn = ui.isbn.value.trim();
    const result = await send(MSG.LOOKUP_METADATA, doi ? { doi } : { isbn });

    const { draft, changed } = mergeLookup(readSourceDraft(), result);
    if (!changed.length) {
      ui.lookupStatus.textContent = t('popup_lookup_nothing_new');
      return;
    }

    ui.cslType.value = draft.csl_type;
    ui.title.value = draft.title || ui.title.value;
    ui.authors.value = formatPeople(draft.authors);
    ui.containerTitle.value = draft.container_title || '';
    ui.publisher.value = draft.publisher || '';
    ui.place.value = draft.place || '';
    ui.year.value = draft.year ? String(draft.year) : '';
    ui.doi.value = draft.doi || '';
    ui.isbn.value = draft.isbn || '';
    updateAuthorsPreview();
    updateCounters();

    ui.lookupStatus.textContent = t('popup_lookup_applied', [String(changed.length)]);
  } catch (error) {
    ui.lookupStatus.textContent = errorText(error);
  } finally {
    ui.lookup.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Absenden
// ---------------------------------------------------------------------------

/** @returns {import('../shared/config.js').SourceDraft} */
function readSourceDraft() {
  return {
    csl_type: ui.cslType.value,
    title: ui.title.value.trim(),
    authors: parsePeople(ui.authors.value),
    editors: [],
    container_title: ui.containerTitle.value.trim(),
    publisher: ui.publisher.value.trim(),
    place: ui.place.value.trim(),
    year: ui.year.value.trim() ? Number(ui.year.value.trim()) : null,
    url: ui.sourceUrl.value.trim(),
    doi: ui.doi.value.trim(),
    isbn: ui.isbn.value.trim(),
    accessed_at: ui.accessedAt.value,
    note: ui.note.value.trim(),
    citekey: ui.citekey.value.trim(),
  };
}

function readIntent() {
  const bookId = ui.book.value ? Number(ui.book.value) : null;
  const book = (context.state.books || []).find((entry) => String(entry.id) === String(bookId));
  const url = context.harvested ? context.harvested.meta.url : context.tab?.url || '';
  const normalized = normalizeUrl(ui.sourceUrl.value) || (context.harvested && context.harvested.meta.normalizedUrl) || url;

  return {
    mode: currentMode(),
    bookId,
    bookName: book ? book.name : '',
    url,
    normalizedUrl: normalized,
    kind: ui.kind.value,
    title: ui.title.value.trim(),
    // Wortlaut so lassen, wie er im Feld steht — kein Trim innerhalb des Zitats.
    body: ui.body.value,
    tags: ui.tags.value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    urls: context.intent ? context.intent.urls : [],
    source: readSourceDraft(),
    attachments: {},
  };
}

async function submit() {
  hideMessages();

  const intent = readIntent();

  if (!intent.bookId) {
    showMessage(ui.formError, t('validation_book_required'));
    return;
  }

  // Clientseitig gegen die Serverlimits pruefen, damit kein 400 zurueckkommt.
  /** @type {import('../shared/limits.js').ValidationProblem[]} */
  const problems = [];
  if (intent.mode !== 'source') {
    problems.push(
      ...validateResearchPayload({
        book_id: intent.bookId,
        kind: intent.kind,
        title: intent.title,
        body: intent.body,
        source: intent.normalizedUrl,
        urls: intent.urls,
      }),
    );
  }
  if (intent.mode !== 'research') {
    problems.push(...validateSourcePayload({ ...intent.source, url: intent.source.url || intent.normalizedUrl }));
  }

  if (problems.length) {
    const first = problems[0];
    showMessage(ui.formError, t(first.key, Object.values(first.params || {}).map(String)));
    return;
  }

  ui.submit.disabled = true;
  ui.submit.textContent = t('popup_sending');

  try {
    /** @type {Record<string, any>} */
    const payload = { intent, tabId: context.tab ? context.tab.id : undefined };

    if (ui.attachScreenshot.checked) {
      payload.screenshot = await send(MSG.CAPTURE_SCREENSHOT);
    }
    if (ui.attachPdf.checked && !ui.attachPdf.disabled) {
      payload.attachPdf = true;
      payload.pdfUrl = context.harvested.meta.pdfUrl;
    }

    const result = await send(MSG.SUBMIT_CAPTURE, payload);

    if (result.queued === false && result.pdfError) {
      showMessage(ui.formError, t('popup_pdf_failed', [result.pdfError]));
      return;
    }

    if (result.done) {
      showMessage(ui.formSuccess, t('popup_saved', [intent.bookName]));
      setTimeout(() => window.close(), 900);
      return;
    }

    // Nicht durchgekommen: liegt in der Warteschlange, geht nichts verloren.
    const job = result.job;
    const reason = job && job.lastError ? job.lastError.text : t('err_unknown');
    showMessage(ui.formError, t('popup_queued', [reason]));
    updateQueueChip(await refreshCounts());
  } catch (error) {
    showError(error);
  } finally {
    ui.submit.disabled = false;
    ui.submit.textContent = t('popup_submit');
  }
}

async function refreshCounts() {
  const state = await send(MSG.GET_STATE);
  context.state = state;
  return state.counts;
}

// ---------------------------------------------------------------------------
// Meldungen
// ---------------------------------------------------------------------------

function hideMessages() {
  ui.formError.hidden = true;
  ui.formSuccess.hidden = true;
}

/**
 * @param {HTMLElement} node
 * @param {string} text
 */
function showMessage(node, text) {
  node.textContent = text;
  node.hidden = false;
}

/** @param {any} error */
function errorText(error) {
  if (error && error.message) return error.message;
  return t('err_unknown');
}

/** @param {any} error */
function showError(error) {
  if (error && error.auth) {
    showTokenProblem(errorText(error));
    return;
  }
  showMessage(ui.formError, errorText(error));
}

/** @param {any} error */
function showFatal(error) {
  ui.loading.hidden = true;
  ui.tokenProblem.hidden = false;
  ui.tokenProblemText.textContent = errorText(error);
}

/**
 * Der Text enthaelt den Fehlercode bereits — `describeError` haengt ihn im
 * Service Worker an, bevor die Meldung hier ankommt.
 *
 * @param {string} text
 */
function showTokenProblem(text) {
  ui.tokenProblem.hidden = false;
  ui.tokenProblemText.textContent = text;
}

/** @param {{total: number, failed: number}} counts */
function updateQueueChip(counts) {
  if (!counts || !counts.total) {
    ui.queueChip.hidden = true;
    return;
  }
  ui.queueChip.textContent = t('popup_queue_chip', [String(counts.total)]);
  ui.queueChip.classList.toggle('chip--warn', counts.failed > 0);
  ui.queueChip.hidden = false;
}

void init();
