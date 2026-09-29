/**
 * Seitenrezept: MediaWiki (Wikipedia und jedes andere Wiki auf derselben Software).
 *
 * Reine Funktion ueber einem `Document` — kein `window`, kein `chrome`.
 *
 * Warum ein eigenes Rezept: die allgemeinen Schichten liefern bei Wikipedia
 * plausibel aussehenden Unsinn.
 *   - JSON-LD `headline` ist die Wikidata-Kurzbeschreibung
 *     („theoretischer Physiker (1879–1955); …"), nicht der Titel.
 *   - JSON-LD `datePublished` ist die Anlage des Artikels (2002), nicht der
 *     zitierte Stand. Zitiert wird eine Version, also deren Datum.
 *   - JSON-LD `author` ist die Koerperschaft „Autoren der Wikimedia-Projekte";
 *     Zitierstile setzen bei Wikipedia keinen Autor.
 *   - `og:title` und `<title>` tragen den Site-Namen („… – Wikipedia").
 *
 * Die Seitenstruktur ist dagegen verlaesslich: `h1#firstHeading` ist der
 * angezeigte Titel (samt DISPLAYTITLE, etwa kursive Werktitel), `#t-permalink`
 * zeigt auf die gerade gelesene Version, `#footer-info-lastmod` nennt ihren Stand.
 */

import { clampLine, collapseWhitespace, normalizeDate } from '../shared/text.js';
import { resolveUrl } from '../shared/url.js';
import { splitTitleAffix } from './title-affix.js';

/**
 * @typedef {object} MediaWikiMeta
 * @property {string} title angezeigter Seitentitel
 * @property {string} siteName Name des Wikis, aus `<title>` abgeleitet
 * @property {string} date Stand der Version, ISO-Datum oder nur Jahr; leer, wenn unbekannt
 * @property {string} description Kurzbeschreibung (bei Wikipedia aus Wikidata)
 * @property {string} permalink Adresse genau dieser Version (`oldid=`)
 * @property {boolean} wikipedia liegt die Seite auf einer Wikipedia?
 */

/**
 * @param {Document} doc
 * @returns {boolean}
 */
export function isMediaWiki(doc) {
  const generator = doc.querySelector('meta[name="generator" i]');
  const content = generator ? generator.getAttribute('content') || '' : '';
  return /^mediawiki\b/i.test(content.trim()) && !!doc.getElementById('firstHeading');
}

/**
 * @param {Document} doc
 * @param {Record<string, any>} article gewaehlter JSON-LD-Knoten (oder `{}`)
 * @param {string} baseUrl
 * @returns {MediaWikiMeta|null} `null`, wenn die Seite kein MediaWiki ist
 */
export function harvestMediaWiki(doc, article, baseUrl) {
  if (!isMediaWiki(doc)) return null;

  const heading = doc.getElementById('firstHeading');
  const title = clampLine(collapseWhitespace(heading ? heading.textContent || '' : '')) ||
    clampLine(typeof article.name === 'string' ? article.name : '');

  const documentTitle = collapseWhitespace(doc.title || '');
  const affix = splitTitleAffix(documentTitle, { heading: title });
  const siteName = clampLine(affix ? affix.site : '');

  const lastmod = doc.getElementById('footer-info-lastmod');
  const date =
    normalizeDate(typeof article.dateModified === 'string' ? article.dateModified : '') ||
    normalizeDate(lastmod ? lastmod.textContent || '' : '') ||
    '';

  // Nur bei Wikipedia ist `headline` verlaesslich die Kurzbeschreibung.
  const wikipedia = isWikipediaHost(baseUrl);
  const description =
    wikipedia && typeof article.headline === 'string' && article.headline !== article.name
      ? collapseWhitespace(article.headline)
      : '';

  // Gegen die kanonische Adresse aufloesen: auf der Mobilansicht zeigte der
  // relative Link sonst auf `de.m.wikipedia.org`.
  const canonicalLink = doc.querySelector('link[rel~="canonical" i]');
  const base =
    resolveUrl(canonicalLink && canonicalLink.getAttribute('href'), baseUrl) ||
    resolveUrl(typeof article.url === 'string' ? article.url : null, baseUrl) ||
    baseUrl;
  const permalinkAnchor = doc.querySelector('#t-permalink a[href]');
  const permalink = resolveUrl(permalinkAnchor && permalinkAnchor.getAttribute('href'), base) || '';

  return { title, siteName, date, description, permalink, wikipedia };
}

/**
 * @param {string} url
 * @returns {boolean}
 */
function isWikipediaHost(url) {
  try {
    return /(^|\.)wikipedia\.org$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}
