/**
 * Autorenzeile und Datum aus dem Markup der Seite.
 *
 * Reine Funktion ueber einem `Document` — kein `window`, kein `chrome`.
 *
 * Viele Blogs nennen die Autorin nirgends in den Metadaten, nur im Kopf des
 * Beitrags: WordPress ohne SEO-Plugin, HubSpot-Themes, selbstgebaute Seiten.
 * Das ist die schwaechste Quelle ueberhaupt und gilt deshalb nur als
 * Fallback-Schicht; jede Meta-Angabe schlaegt sie.
 *
 * Gelesen wird nur, was eindeutig markiert ist — Klassennamen und
 * Attribute, die WordPress-Core, verbreitete Themes, HubSpot-Themes und
 * Microformats/Microdata verwenden. Kommentare, Karten verwandter Beitraege,
 * Seitenleisten und Fusszeilen sind ausgenommen: dort stehen fremde Namen.
 */

/**
 * Selektoren in absteigender Verlaesslichkeit. Der erste, der etwas findet,
 * gewinnt; alle seine Treffer zaehlen (mehrere Autor:innen).
 */
const AUTHOR_SELECTORS = Object.freeze([
  // WordPress-Blockthemes (Core-Block „Post Author Name")
  '.wp-block-post-author-name',
  // Microdata / Microformats
  '[itemprop="author"] [itemprop="name"]',
  '.h-entry .p-author',
  '.author.vcard .fn',
  '.author.vcard a',
  // Klassische WordPress-Themes
  '.byline .author a',
  '.byline .author',
  '.entry-author-name',
  '.entry-author',
  // HubSpot-Standardthemes
  '.blog-post__author-name',
  '.hs-author-name',
  // Allgemein, zuletzt: eine Klasse, die auf „author-name" / „author__name"
  // endet (HubSpot-Themes wie „blog-hero-1__author-name"); siehe AUTHOR_NAME_CLASS
  '[class*="author"]',
  // CSS-Module (hbr.org): „…__byline" enthaelt „…__author" je Person
  '[class*="byline"] [class*="author"]',
  'a[rel~="author"]',
]);

/**
 * Fuer den allgemeinen Selektor: die Klasse muss auf den Namen ENDEN.
 * „np-intro-author-name-dates" enthaelt Name und Datum — kein Treffer.
 */
const AUTHOR_NAME_CLASS = /(^|[_-])author(?:-|__)name$/i;

/** Fuer den Byline-Selektor: Klassen muessen auf „byline" bzw. „author" ENDEN. */
const BYLINE_CLASS = /(^|[_-])byline$/i;
const AUTHOR_CLASS = /(^|[_-])author$/i;

/**
 * @param {Element} element
 * @param {RegExp} pattern
 */
const hasClass = (element, pattern) => [...element.classList].some((token) => pattern.test(token));

/**
 * Filter fuer die allgemeinen Selektoren, die per Teilstring waehlen:
 * erst die Endung der Klasse macht den Treffer eindeutig.
 *
 * @param {string} selector
 * @param {Element} element
 */
function matchesStrictly(selector, element) {
  if (selector === '[class*="author"]') return hasClass(element, AUTHOR_NAME_CLASS);
  if (selector === '[class*="byline"] [class*="author"]') {
    if (!hasClass(element, AUTHOR_CLASS)) return false;
    for (let node = element.parentElement; node; node = node.parentElement) {
      if (hasClass(node, BYLINE_CLASS)) return true;
    }
    return false;
  }
  return true;
}

/** Zeitangaben, die den Beitrag selbst datieren (nicht Kommentare, nicht „geaendert“). */
const TIME_SELECTORS = Object.freeze([
  'time.entry-date[datetime]',
  'time.published[datetime]',
  'time.dt-published[datetime]',
  '.wp-block-post-date time[datetime]',
  '[itemprop="datePublished"][datetime]',
  'article time[datetime]',
]);

/** Bereiche, in denen Namen und Daten anderer Beitraege oder Personen stehen. */
const FOREIGN = /(^|[\s_-])(comments?|related|card|teaser|sidebar|widget|recommend)/i;

/** „von", „by", „Written by:", „Autorin:" — vor dem Namen, nicht Teil davon. */
const BYLINE_PREFIX = /^(?:(?:written|posted|published)\s+by|by|von|text|autor(?:in)?|author)\s*:?\s+/i;

/** Laenger ist keine Autorenzeile mehr, sondern ein Kasten mit Biografie. */
const MAX_BYLINE = 120;

/**
 * @param {Element} element
 * @returns {boolean} liegt das Element in einem fremden Bereich?
 */
function inForeignArea(element) {
  for (let node = element; node && node.tagName && node.tagName !== 'BODY'; node = node.parentElement) {
    const tag = node.tagName;
    if (tag === 'ASIDE' || tag === 'FOOTER' || tag === 'NAV') return true;
    const cls = typeof node.className === 'string' ? node.className : '';
    if ((cls && FOREIGN.test(cls)) || (node.id && FOREIGN.test(node.id))) return true;
  }
  return false;
}

/**
 * @param {string} value
 * @returns {string}
 */
function cleanByline(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(BYLINE_PREFIX, '')
    .trim();
}

/**
 * Namen aus der Autorenzeile, roh — die Zerlegung macht `parsePeople`.
 *
 * @param {Document} doc
 * @returns {string[]}
 */
export function harvestBylineNames(doc) {
  for (const selector of AUTHOR_SELECTORS) {
    /** @type {string[]} */
    const names = [];
    for (const element of doc.querySelectorAll(selector)) {
      if (!matchesStrictly(selector, element)) continue;
      if (inForeignArea(element)) continue;
      const name = cleanByline(element.textContent || '');
      if (!name || name.length > MAX_BYLINE || /^https?:\/\//i.test(name)) continue;
      // Ziffern stehen in Daten und Zaehlern, nicht in Namen.
      if (/\d/.test(name)) continue;
      if (!names.includes(name)) names.push(name);
    }
    if (names.length) return names;
  }
  return [];
}

/**
 * Erstes maschinenlesbares Veroeffentlichungsdatum im Beitrag.
 *
 * @param {Document} doc
 * @returns {string} Inhalt von `datetime`, sonst leer
 */
export function harvestBylineDate(doc) {
  for (const selector of TIME_SELECTORS) {
    for (const element of doc.querySelectorAll(selector)) {
      if (inForeignArea(element)) continue;
      const value = element.getAttribute('datetime') || '';
      if (value.trim()) return value.trim();
    }
  }
  return '';
}
