/**
 * Metadaten-Ernte („graben").
 *
 * Reine Funktion ueber einem `Document` — kein `window`, kein `chrome`,
 * damit sie in Node gegen HTML-Fixtures getestet werden kann.
 *
 * Prioritaetsreihenfolge (hoechste zuerst):
 *   1. Highwire / `citation_*`
 *   2. JSON-LD (schema.org Article & Verwandte)
 *   3. Dublin Core
 *   4. OpenGraph / `article:*`
 *   5. Fallback: <title>, rel=canonical, erstes <h1>
 *
 * Jedes Feld merkt sich in `provenance`, aus welcher Schicht es stammt.
 * Das Popup zeigt das an, damit sichtbar ist, was belegt und was geraten ist.
 */

import { parsePeople } from '../shared/people.js';
import {
  clampLine,
  collapseWhitespace,
  extractDoi,
  extractIsbn,
  isoDate,
  normalizeDate,
  yearFromDate,
} from '../shared/text.js';
import { normalizeUrl, resolveUrl } from '../shared/url.js';

/** Reihenfolge der Schichten; frueher = staerker. */
export const LAYERS = Object.freeze(['citation', 'jsonld', 'dublincore', 'opengraph', 'fallback']);

const ARTICLE_TYPES = new Set([
  'article',
  'newsarticle',
  'scholarlyarticle',
  'blogposting',
  'techarticle',
  'report',
  'reportagenewsarticle',
  'liveblogposting',
  'medicalscholarlyarticle',
  'socialmediaposting',
]);

const OTHER_CREATIVE_TYPES = new Set(['book', 'chapter', 'thesis', 'dataset', 'movie', 'webpage']);

/**
 * Baut einen Index ueber alle <meta>-Elemente.
 * Schluessel sind kleingeschrieben; `name`, `property` und `itemprop`
 * landen im selben Topf, weil Seiten das munter mischen.
 *
 * @param {Document} doc
 * @returns {Map<string, string[]>}
 */
function indexMetaTags(doc) {
  /** @type {Map<string, string[]>} */
  const index = new Map();
  const add = (key, value) => {
    if (!key || !value) return;
    const normalizedKey = key.trim().toLowerCase();
    const normalizedValue = String(value).trim();
    if (!normalizedKey || !normalizedValue) return;
    const bucket = index.get(normalizedKey);
    if (bucket) bucket.push(normalizedValue);
    else index.set(normalizedKey, [normalizedValue]);
  };

  for (const meta of doc.querySelectorAll('meta')) {
    const content = meta.getAttribute('content');
    if (!content) continue;
    add(meta.getAttribute('name'), content);
    add(meta.getAttribute('property'), content);
    add(meta.getAttribute('itemprop'), content);
  }
  return index;
}

/**
 * @param {Map<string, string[]>} index
 * @param {string[]} keys
 * @returns {string|null} erster Treffer
 */
function first(index, keys) {
  for (const key of keys) {
    const values = index.get(key.toLowerCase());
    if (values && values.length && values[0]) return values[0];
  }
  return null;
}

/**
 * @param {Map<string, string[]>} index
 * @param {string[]} keys
 * @returns {string[]} alle Treffer aller Schluessel
 */
function all(index, keys) {
  /** @type {string[]} */
  const out = [];
  for (const key of keys) {
    const values = index.get(key.toLowerCase());
    if (values) out.push(...values);
  }
  return out;
}

/**
 * Sammelt alle JSON-LD-Knoten, inklusive `@graph` und verschachtelter Arrays.
 * @param {Document} doc
 * @returns {Record<string, any>[]}
 */
export function collectJsonLdNodes(doc) {
  /** @type {Record<string, any>[]} */
  const nodes = [];

  /** @param {any} value */
  const walk = (value, depth = 0) => {
    if (!value || depth > 6) return;
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;
    nodes.push(value);
    if (value['@graph']) walk(value['@graph'], depth + 1);
    // Verschachtelte Werke ("mainEntity", "itemListElement") mitnehmen.
    for (const key of ['mainEntity', 'mainEntityOfPage', 'itemListElement', 'hasPart']) {
      if (value[key] && typeof value[key] === 'object') walk(value[key], depth + 1);
    }
  };

  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    const raw = script.textContent;
    if (!raw || !raw.trim()) continue;
    try {
      walk(JSON.parse(raw));
    } catch {
      // Kaputtes JSON-LD ist haeufig. Kein Grund, die Ernte abzubrechen.
    }
  }
  return nodes;
}

/**
 * @param {Record<string, any>} node
 * @returns {string[]} @type als Liste kleingeschriebener Strings
 */
function typesOf(node) {
  const raw = node['@type'] ?? node.type;
  if (!raw) return [];
  return (Array.isArray(raw) ? raw : [raw])
    .filter((t) => typeof t === 'string')
    .map((t) => t.replace(/^https?:\/\/schema\.org\//i, '').toLowerCase());
}

/**
 * Waehlt den JSON-LD-Knoten, der die Seite selbst beschreibt.
 * @param {Record<string, any>[]} nodes
 * @returns {Record<string, any>|null}
 */
export function pickJsonLdArticle(nodes) {
  let fallbackNode = null;
  for (const node of nodes) {
    const types = typesOf(node);
    if (types.some((type) => ARTICLE_TYPES.has(type))) return node;
    if (!fallbackNode && types.some((type) => OTHER_CREATIVE_TYPES.has(type))) fallbackNode = node;
  }
  return fallbackNode;
}

/**
 * Zieht einen Namen aus schema.org-Werten, die String, Objekt oder Array sein duerfen.
 * @param {any} value
 * @returns {string}
 */
function schemaName(value) {
  if (!value) return '';
  if (typeof value === 'string') return collapseWhitespace(value);
  if (Array.isArray(value)) return schemaName(value[0]);
  if (typeof value === 'object') return collapseWhitespace(value.name || value['@id'] || '');
  return '';
}

/**
 * Kandidatensammlung mit Herkunft.
 */
class Field {
  constructor() {
    /** @type {Map<string, any>} */
    this.byLayer = new Map();
  }

  /**
   * @param {string} layer
   * @param {any} value
   */
  set(layer, value) {
    if (value === null || value === undefined || value === '' ) return;
    if (Array.isArray(value) && value.length === 0) return;
    if (!this.byLayer.has(layer)) this.byLayer.set(layer, value);
  }

  /**
   * @returns {{value: any, layer: string}|null}
   */
  resolve() {
    for (const layer of LAYERS) {
      if (this.byLayer.has(layer)) return { value: this.byLayer.get(layer), layer };
    }
    return null;
  }
}

/**
 * @typedef {object} HarvestedMeta
 * @property {string} url
 * @property {string} normalizedUrl
 * @property {string} canonicalUrl
 * @property {string} title
 * @property {string} siteName
 * @property {string} containerTitle
 * @property {string} publisher
 * @property {string} place
 * @property {Array<{family?: string, given?: string, literal?: string}>} authors
 * @property {Array<{family?: string, given?: string, literal?: string}>} editors
 * @property {string} publishedDate
 * @property {number|null} year
 * @property {string} doi
 * @property {string} isbn
 * @property {string} pdfUrl
 * @property {boolean} pdfSameOrigin
 * @property {string} lang
 * @property {string} accessedAt
 * @property {string} cslType
 * @property {string} description
 * @property {Record<string, string>} provenance
 */

/**
 * @param {Document} doc
 * @param {object} [options]
 * @param {string} [options.url] Adresse der Seite (Vorrang vor `doc.baseURI`)
 * @param {Date} [options.now] fuer deterministische Tests
 * @returns {HarvestedMeta}
 */
export function harvestMetadata(doc, options = {}) {
  const baseUrl =
    options.url ||
    (doc.defaultView && doc.defaultView.location && doc.defaultView.location.href) ||
    doc.baseURI ||
    '';

  const index = indexMetaTags(doc);
  const jsonLdNodes = collectJsonLdNodes(doc);
  const article = pickJsonLdArticle(jsonLdNodes) || {};

  const fields = {
    title: new Field(),
    authors: new Field(),
    editors: new Field(),
    containerTitle: new Field(),
    publisher: new Field(),
    place: new Field(),
    date: new Field(),
    doi: new Field(),
    isbn: new Field(),
    pdfUrl: new Field(),
    siteName: new Field(),
    description: new Field(),
    canonicalUrl: new Field(),
    lang: new Field(),
  };

  // ---------------------------------------------------------------- 1. Highwire
  fields.title.set('citation', clampLine(first(index, ['citation_title'])));
  fields.authors.set('citation', parsePeople(all(index, ['citation_author', 'citation_authors'])));
  fields.editors.set('citation', parsePeople(all(index, ['citation_editor'])));
  fields.containerTitle.set(
    'citation',
    clampLine(
      first(index, [
        'citation_journal_title',
        'citation_conference_title',
        'citation_book_title',
        'citation_inbook_title',
      ]),
    ),
  );
  fields.publisher.set('citation', clampLine(first(index, ['citation_publisher', 'citation_dissertation_institution'])));
  fields.date.set(
    'citation',
    normalizeDate(
      first(index, ['citation_publication_date', 'citation_date', 'citation_online_date', 'citation_year']),
    ),
  );
  fields.doi.set('citation', extractDoi(first(index, ['citation_doi']) || ''));
  fields.isbn.set('citation', extractIsbn(first(index, ['citation_isbn']) || ''));
  fields.pdfUrl.set('citation', resolveUrl(first(index, ['citation_pdf_url', 'citation_fulltext_html_url']), baseUrl));

  // ---------------------------------------------------------------- 2. JSON-LD
  fields.title.set('jsonld', clampLine(article.headline || article.name || ''));
  fields.authors.set('jsonld', parsePeople(article.author ?? article.creator ?? null));
  fields.editors.set('jsonld', parsePeople(article.editor ?? null));
  fields.date.set('jsonld', normalizeDate(article.datePublished || article.dateCreated || article.dateModified || ''));
  fields.publisher.set('jsonld', clampLine(schemaName(article.publisher)));
  fields.containerTitle.set('jsonld', clampLine(schemaName(article.isPartOf) || schemaName(article.publication)));
  fields.description.set('jsonld', collapseWhitespace(article.description || ''));
  fields.isbn.set('jsonld', extractIsbn(String(article.isbn || '')));
  fields.doi.set(
    'jsonld',
    extractDoi(String(article.doi || article.identifier?.value || article.identifier || '')),
  );
  fields.canonicalUrl.set('jsonld', resolveUrl(typeof article.url === 'string' ? article.url : null, baseUrl));
  fields.lang.set('jsonld', typeof article.inLanguage === 'string' ? article.inLanguage : schemaName(article.inLanguage));

  // ------------------------------------------------------------- 3. Dublin Core
  fields.title.set('dublincore', clampLine(first(index, ['dc.title', 'dcterms.title'])));
  fields.authors.set(
    'dublincore',
    parsePeople(all(index, ['dc.creator', 'dcterms.creator', 'dc.contributor.author'])),
  );
  fields.date.set('dublincore', normalizeDate(first(index, ['dc.date', 'dcterms.date', 'dcterms.issued', 'dc.date.issued'])));
  fields.publisher.set('dublincore', clampLine(first(index, ['dc.publisher', 'dcterms.publisher'])));
  fields.containerTitle.set('dublincore', clampLine(first(index, ['dc.source', 'dcterms.ispartof'])));
  fields.description.set('dublincore', collapseWhitespace(first(index, ['dc.description', 'dcterms.abstract']) || ''));
  fields.lang.set('dublincore', first(index, ['dc.language', 'dcterms.language']));
  fields.isbn.set('dublincore', extractIsbn(first(index, ['dc.identifier', 'dcterms.identifier']) || ''));
  fields.doi.set('dublincore', extractDoi(first(index, ['dc.identifier', 'dcterms.identifier']) || ''));

  // -------------------------------------------------------------- 4. OpenGraph
  fields.title.set('opengraph', clampLine(first(index, ['og:title', 'twitter:title'])));
  fields.siteName.set('opengraph', clampLine(first(index, ['og:site_name', 'application-name'])));
  fields.date.set(
    'opengraph',
    normalizeDate(first(index, ['article:published_time', 'article:modified_time', 'og:updated_time', 'date'])),
  );
  fields.authors.set('opengraph', parsePeople(all(index, ['article:author', 'author', 'twitter:creator'])));
  fields.description.set('opengraph', collapseWhitespace(first(index, ['og:description', 'description']) || ''));
  fields.canonicalUrl.set('opengraph', resolveUrl(first(index, ['og:url']), baseUrl));

  // ---------------------------------------------------------------- 5. Fallback
  const canonicalLink = doc.querySelector('link[rel~="canonical" i]');
  fields.canonicalUrl.set('fallback', resolveUrl(canonicalLink && canonicalLink.getAttribute('href'), baseUrl));

  const h1 = doc.querySelector('h1');
  const documentTitle = clampLine(doc.title || '');
  fields.title.set('fallback', documentTitle || clampLine(h1 ? h1.textContent : ''));

  const alternatePdf = doc.querySelector('link[rel~="alternate" i][type="application/pdf"]');
  fields.pdfUrl.set('fallback', resolveUrl(alternatePdf && alternatePdf.getAttribute('href'), baseUrl));

  const htmlLang = doc.documentElement && doc.documentElement.getAttribute('lang');
  fields.lang.set('fallback', htmlLang || '');

  let host = '';
  try {
    host = baseUrl ? new URL(baseUrl).hostname.replace(/^www\./i, '') : '';
  } catch {
    host = '';
  }
  fields.siteName.set('fallback', host);

  // ------------------------------------------------------- DOI aus dem Fliesstext
  // Ausdruecklich gewuenscht: wenn keine Meta-Angabe existiert, im Text suchen.
  if (!fields.doi.resolve()) {
    const textDoi = extractDoi(doc.body ? doc.body.textContent || '' : '');
    if (textDoi) fields.doi.set('fallback', textDoi);
  }
  if (!fields.isbn.resolve()) {
    const textIsbn = extractIsbn(doc.body ? doc.body.textContent || '' : '');
    if (textIsbn) fields.isbn.set('fallback', textIsbn);
  }

  // ------------------------------------------------------------------- Aufloesen
  /** @type {Record<string, string>} */
  const provenance = {};
  /**
   * @template T
   * @param {keyof typeof fields} name
   * @param {T} fallbackValue
   * @returns {T}
   */
  const take = (name, fallbackValue) => {
    const resolved = fields[name].resolve();
    if (!resolved) return fallbackValue;
    provenance[name] = resolved.layer;
    return resolved.value;
  };

  const title = take('title', '');
  const authors = take('authors', []);
  const editors = take('editors', []);
  const containerTitle = take('containerTitle', '');
  const siteName = take('siteName', host);
  const publisher = take('publisher', '');
  const publishedDate = take('date', '');
  const doi = take('doi', '');
  const isbn = take('isbn', '');
  const pdfUrl = take('pdfUrl', '');
  const description = take('description', '');
  const lang = take('lang', '');
  const canonicalUrl = take('canonicalUrl', '');

  const effectiveUrl = canonicalUrl || baseUrl;
  const cslType = guessCslType({ doi, isbn, containerTitle, jsonLdTypes: typesOf(article) });

  let pdfSameOrigin = false;
  if (pdfUrl) {
    try {
      pdfSameOrigin = new URL(pdfUrl).origin === new URL(baseUrl).origin;
    } catch {
      pdfSameOrigin = false;
    }
  }

  return {
    url: baseUrl,
    normalizedUrl: normalizeUrl(effectiveUrl) || normalizeUrl(baseUrl) || baseUrl,
    canonicalUrl,
    title,
    siteName,
    // Bei Zeitschriften ist der Container das Journal, bei Webseiten die Site.
    containerTitle: containerTitle || (cslType === 'website' ? siteName : ''),
    publisher,
    place: '',
    authors,
    editors,
    publishedDate,
    year: yearFromDate(publishedDate),
    doi,
    isbn,
    pdfUrl,
    pdfSameOrigin,
    lang: (lang || '').slice(0, 16),
    accessedAt: isoDate(options.now || new Date()),
    cslType,
    description,
    provenance,
  };
}

/**
 * Ratet den CSL-Typ. Bewusst grob — der Nutzer korrigiert im Popup.
 *
 * @param {{doi?: string, isbn?: string, containerTitle?: string, jsonLdTypes?: string[]}} input
 * @returns {string}
 */
export function guessCslType({ doi = '', isbn = '', containerTitle = '', jsonLdTypes = [] } = {}) {
  const types = new Set(jsonLdTypes.map((t) => String(t).toLowerCase()));

  if (types.has('book')) return 'book';
  if (types.has('chapter')) return 'chapter';
  if (types.has('thesis')) return 'thesis';
  if (types.has('dataset')) return 'dataset';
  if (types.has('movie') || types.has('videoobject')) return 'film';
  if (types.has('report')) return 'report';
  if (types.has('scholarlyarticle') || types.has('medicalscholarlyarticle')) return 'article';

  if (isbn) return 'book';
  if (doi || containerTitle) return 'article';
  return 'website';
}
