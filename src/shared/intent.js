/**
 * Erntedaten -> Erfassungsauftrag.
 *
 * Wird an zwei Stellen gebraucht: das Popup fuellt damit sein Formular vor,
 * das Kontextmenue erzeugt damit direkt einen Auftrag. Beide muessen zum
 * selben Ergebnis kommen, also liegt die Logik hier und nicht doppelt.
 */

import { CAPTURE_MODES, LIMITS, RESEARCH_KINDS } from './limits.js';
import { clampLine, isoDate, truncateAtSentence } from './text.js';
import { normalizeUrl, sameServerResource } from './url.js';

/**
 * @param {any} harvested Rueckgabe von `content/harvest.js`
 * @param {object} [options]
 * @param {import('./config.js').CaptureIntent['mode']} [options.mode]
 * @param {number|string|null} [options.bookId]
 * @param {string} [options.bookName]
 * @param {string} [options.defaultKind]
 * @param {Date} [options.now]
 * @returns {import('./config.js').CaptureIntent}
 */
export function intentFromHarvest(harvested, options = {}) {
  const meta = (harvested && harvested.meta) || {};
  const hasSelection = !!(harvested && harvested.hasSelection);

  const url = meta.url || '';
  const normalizedUrl = meta.normalizedUrl || normalizeUrl(url) || url;

  const mode = CAPTURE_MODES.includes(options.mode) ? options.mode : 'research';

  // Eine Markierung gewinnt: sie wird zum Zitat und bleibt WORTWOERTLICH.
  const rawBody = hasSelection ? harvested.selectionText : (harvested && harvested.article?.text) || '';
  const kind = hasSelection
    ? 'quote'
    : RESEARCH_KINDS.includes(options.defaultKind)
      ? /** @type {import('./config.js').CaptureIntent['kind']} */ (options.defaultKind)
      : 'link';

  // Nur der geerntete Fliesstext wird gekuerzt; ein Zitat, das laenger als
  // das Limit ist, wird abgelehnt statt heimlich beschnitten.
  const body = hasSelection ? rawBody : truncateAtSentence(rawBody, LIMITS.BODY_MAX).text;

  const title = clampLine(meta.title || '', LIMITS.TITLE_MAX);

  /** @type {Array<{url: string, label: string}>} */
  const urls = [];
  // Nach SERVER-Regeln vergleichen: eine kanonische Adresse, die sich nur in
  // `www.`, Schema oder Trailing-Slash unterscheidet, ist fuer den Server
  // dieselbe Seite. Mit den Client-Regeln haetten wir sie als zweiten
  // `urls[]`-Eintrag angehaengt — eine Dublette, die der Server nie erzeugt.
  if (meta.canonicalUrl && !sameServerResource(meta.canonicalUrl, normalizedUrl)) {
    urls.push({ url: meta.canonicalUrl, label: 'canonical' });
  }
  // Die gelesene Fassung (Wikipedia `oldid=`). Als Quelle zaehlt weiter die
  // kanonische Adresse — sonst waere jede Bearbeitung eine neue Quelle und die
  // Dublettenpruefung liefe ins Leere.
  if (meta.permalink && !sameServerResource(meta.permalink, normalizedUrl)) {
    urls.push({ url: meta.permalink, label: 'permalink' });
  }
  if (meta.pdfUrl) urls.push({ url: meta.pdfUrl, label: 'PDF' });

  return {
    mode,
    bookId: options.bookId ?? null,
    bookName: options.bookName || '',
    url,
    normalizedUrl,
    kind,
    title,
    body,
    tags: [],
    urls,
    source: {
      csl_type: meta.cslType || 'website',
      title,
      authors: Array.isArray(meta.authors) ? meta.authors : [],
      editors: Array.isArray(meta.editors) ? meta.editors : [],
      container_title: meta.containerTitle || meta.siteName || '',
      publisher: meta.publisher || '',
      place: '',
      year: meta.year || null,
      url: normalizedUrl,
      doi: meta.doi || '',
      isbn: meta.isbn || '',
      accessed_at: meta.accessedAt || isoDate(options.now || new Date()),
      note: '',
    },
    attachments: {},
  };
}

/**
 * Uebernimmt einen vom Server gelieferten Metadaten-Entwurf
 * (`GET /sources/lookup`) in einen bestehenden Entwurf.
 *
 * Kanonische Angaben schlagen geerntete — genau dafuer ist der Lookup da.
 * Leere Felder aus dem Lookup ueberschreiben aber nichts.
 *
 * @param {import('./config.js').SourceDraft} draft
 * @param {Record<string, any>} lookup
 * @returns {{draft: import('./config.js').SourceDraft, changed: string[]}}
 */
export function mergeLookup(draft, lookup) {
  if (!lookup || typeof lookup !== 'object') return { draft, changed: [] };
  const source = lookup.source && typeof lookup.source === 'object' ? lookup.source : lookup;

  const next = { ...draft };
  /** @type {string[]} */
  const changed = [];

  /**
   * @param {keyof import('./config.js').SourceDraft} field
   * @param {any} value
   */
  const apply = (field, value) => {
    if (value === null || value === undefined || value === '') return;
    if (Array.isArray(value) && value.length === 0) return;
    if (JSON.stringify(next[field]) === JSON.stringify(value)) return;
    next[field] = value;
    changed.push(field);
  };

  apply('csl_type', source.csl_type);
  apply('title', clampLine(source.title || '', LIMITS.TITLE_MAX));
  apply('authors', Array.isArray(source.authors) ? source.authors : undefined);
  apply('editors', Array.isArray(source.editors) ? source.editors : undefined);
  apply('container_title', source.container_title);
  apply('publisher', source.publisher);
  apply('place', source.place);
  apply('year', source.year);
  apply('doi', source.doi);
  apply('isbn', source.isbn);

  return { draft: next, changed };
}
