/**
 * Site-Namen von Seitentiteln trennen.
 *
 * `<title>` und `og:title` tragen fast immer den Namen der Website mit
 * („Seeufer-Entscheid verschoben – Abendpost", „Home | Kestrel Notes").
 * Als Quellentitel ist das falsch: der Site-Name gehoert in `container_title`.
 *
 * Abgeschnitten wird nur, was sich belegen laesst — der Rest gleicht der
 * Hauptueberschrift der Seite, oder das abgetrennte Stueck gleicht einem
 * bekannten Namen der Website. Ein Gedankenstrich im Titel selbst
 * („Krieg und Frieden – eine Relektuere") bleibt sonst stehen.
 *
 * Der Doppelpunkt ist bewusst kein Trenner: er leitet Untertitel ein.
 */

/** Trenner mit Leerraum auf beiden Seiten. */
const SEPARATOR = /\s+(?:\||–|—|-|·|•|»|::|~)\s+/g;

/** Kuerzere Namen als das gleichen nur exakt, nicht als Anfangsstueck. */
const MIN_PREFIX_MATCH = 4;

/**
 * Vergleichsform: klein, ohne Diakritika, nur Buchstaben und Ziffern.
 * @param {string} value
 */
function fold(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * @param {string} a gefaltet
 * @param {string} b gefaltet
 */
function sameName(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  // „Journal of Fluvial Studies" gegen „Journal of Fluvial Studies Online".
  if (Math.min(a.length, b.length) < MIN_PREFIX_MATCH) return false;
  return a.startsWith(b) || b.startsWith(a);
}

/**
 * Namenskandidaten aus einem Hostnamen: jedes Label ausser TLD und `www`
 * („abendpost.example.ch" -> „abendpost", „example").
 * @param {string} host
 * @returns {string[]}
 */
export function hostNameCandidates(host) {
  const labels = String(host || '')
    .toLowerCase()
    .split('.')
    .filter(Boolean);
  if (labels.length < 2) return [];
  return labels.slice(0, -1).filter((label) => label !== 'www' && label.length >= 3);
}

/**
 * Zerlegt einen Seitentitel in Werk und Site-Namen — oder laesst ihn stehen.
 *
 * @param {string} title
 * @param {object} [hints]
 * @param {string} [hints.heading] Hauptueberschrift der Seite (`<h1>`)
 * @param {string[]} [hints.siteNames] bekannte Namen der Website
 * @param {string[]} [hints.hostNames] Labels des Hostnamens — gleichen nur exakt,
 *   sonst schnitte „repo.example.org" ein „Repositorium" ab
 * @returns {{head: string, site: string}|null} `null`, wenn nichts belegbar abzutrennen ist
 */
export function splitTitleAffix(title, hints = {}) {
  const text = String(title || '').trim();
  if (!text) return null;

  const separators = [...text.matchAll(SEPARATOR)];
  if (!separators.length) return null;

  const heading = fold(hints.heading || '');
  const names = (hints.siteNames || []).map(fold).filter(Boolean);
  const hostNames = (hints.hostNames || []).map(fold).filter(Boolean);
  const isSite = (/** @type {string} */ part) => {
    const folded = fold(part);
    return names.some((name) => sameName(folded, name)) || hostNames.includes(folded);
  };

  // Suffix („Werk | Site") ist die Regel, Praefix („Site | Werk") die Ausnahme.
  const last = separators[separators.length - 1];
  const firstSep = separators[0];
  const candidates = [
    {
      head: text.slice(0, last.index).trim(),
      site: text.slice((last.index ?? 0) + last[0].length).trim(),
    },
    {
      head: text.slice((firstSep.index ?? 0) + firstSep[0].length).trim(),
      site: text.slice(0, firstSep.index).trim(),
    },
  ];

  for (const candidate of candidates) {
    if (!candidate.head || !candidate.site) continue;
    if (heading && fold(candidate.head) === heading) return candidate;
  }
  for (const candidate of candidates) {
    if (!candidate.head || !candidate.site) continue;
    if (isSite(candidate.site)) return candidate;
  }
  return null;
}

/**
 * Wie `splitTitleAffix`, gibt aber nur den bereinigten Titel zurueck.
 *
 * @param {string} title
 * @param {Parameters<typeof splitTitleAffix>[1]} [hints]
 * @returns {string}
 */
export function stripTitleAffix(title, hints = {}) {
  const split = splitTitleAffix(title, hints);
  return split ? split.head : String(title || '').trim();
}
