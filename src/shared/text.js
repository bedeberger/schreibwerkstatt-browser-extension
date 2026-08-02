/**
 * Textwerkzeuge: kuerzen, Jahreszahlen und DOIs ziehen, Datum formatieren.
 * Alles rein und ohne DOM, damit es sich ohne Browser testen laesst.
 */

import { LIMITS } from './limits.js';

/**
 * Vereinheitlicht Weissraum. Nur fuer Metadaten-Felder benutzen —
 * NIE fuer den Wortlaut eines Zitats.
 * @param {unknown} value
 * @returns {string}
 */
export function collapseWhitespace(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Normalisiert Absatzstruktur von extrahiertem Fliesstext.
 *
 * Regel: eine Absatzgrenze ist **zwei** aufeinanderfolgende Zeilenumbrueche.
 * Ein einzelner Umbruch ist ein Soft-Wrap (vom Browser-Umbuch, von `<br>`
 * oder von eingeruecktem HTML-Quelltext) und wird zu einem Leerzeichen.
 * beliebig viele Umbrueche werden zu hoechstens einer Leerzeile.
 *
 * NIE fuer den Wortlaut eines Zitats benutzen — siehe `readSelection`.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function tidyParagraphs(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((para) => para.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

/** Satzende, gefolgt von Weissraum oder Zeilenende. */
const SENTENCE_END = /[.!?…]["'»«”’)\]]?(?=\s|$)/g;

/**
 * Untergrenzen, damit das Kuerzen nicht zu viel wegwirft.
 * Eine Satzgrenze ist die deutlich bessere Trennstelle, deshalb darf sie
 * weiter vorn liegen als eine blosse Wortgrenze.
 */
const SENTENCE_FLOOR = 0.3;
const WORD_FLOOR = 0.5;

/**
 * Kuerzt Text auf `max` Zeichen und bricht dabei moeglichst an einer
 * Satzgrenze ab. Wenn im hinteren Teil keine Satzgrenze liegt, wird an
 * einer Wortgrenze getrennt; erst zuletzt hart.
 *
 * @param {unknown} value
 * @param {number} [max]
 * @returns {{text: string, truncated: boolean, originalLength: number}}
 */
export function truncateAtSentence(value, max = LIMITS.BODY_MAX) {
  const text = typeof value === 'string' ? value : '';
  const originalLength = text.length;

  if (max <= 0) return { text: '', truncated: originalLength > 0, originalLength };
  if (originalLength <= max) return { text, truncated: false, originalLength };

  const window = text.slice(0, max);

  // Letzte Satzgrenze im erlaubten Fenster suchen.
  let cut = -1;
  SENTENCE_END.lastIndex = 0;
  let match;
  while ((match = SENTENCE_END.exec(window)) !== null) {
    cut = match.index + match[0].length;
  }

  if (cut >= Math.floor(max * SENTENCE_FLOOR)) {
    return { text: window.slice(0, cut).trimEnd(), truncated: true, originalLength };
  }

  const lastSpace = window.lastIndexOf(' ');
  if (lastSpace >= Math.floor(max * WORD_FLOOR)) {
    return { text: window.slice(0, lastSpace).trimEnd(), truncated: true, originalLength };
  }

  return { text: window.trimEnd(), truncated: true, originalLength };
}

/**
 * Kuerzt eine einzeilige Angabe hart (Titel duerfen 300 Zeichen haben).
 * @param {unknown} value
 * @param {number} [max]
 */
export function clampLine(value, max = LIMITS.TITLE_MAX) {
  const text = collapseWhitespace(value);
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd();
}

/**
 * DOI aus beliebigem Text ziehen.
 * Praefix (`doi:`, `https://doi.org/`) wird entfernt, Satzzeichen am Ende
 * abgeschnitten — die gehoeren fast nie zum DOI.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function extractDoi(value) {
  if (typeof value !== 'string' || !value) return null;
  const match = value.match(/\b10\.\d{4,9}\/[^\s"'<>]+/);
  if (!match) return null;
  let doi = match[0];
  // Haeufige Anhaengsel aus HTML/Prosa entfernen.
  doi = doi.replace(/[.,;:]+$/, '');
  while (/[)\]}>]$/.test(doi)) {
    const open = doi.slice(-1) === ')' ? '(' : doi.slice(-1) === ']' ? '[' : doi.slice(-1) === '}' ? '{' : '<';
    const close = doi.slice(-1);
    const opens = (doi.match(new RegExp(`\\${open}`, 'g')) || []).length;
    const closes = (doi.match(new RegExp(`\\${close}`, 'g')) || []).length;
    if (closes > opens) doi = doi.slice(0, -1).replace(/[.,;:]+$/, '');
    else break;
  }
  return doi || null;
}

/**
 * ISBN aus Text ziehen und normalisieren (ohne Bindestriche).
 * @param {unknown} value
 * @returns {string|null}
 */
export function extractIsbn(value) {
  if (typeof value !== 'string' || !value) return null;
  const match = value.match(/\b(?:ISBN(?:-1[03])?:?\s*)?((?:97[89][-\s]?)?(?:\d[-\s]?){9}[\dXx])\b/);
  if (!match) return null;
  const digits = match[1].replace(/[-\s]/g, '').toUpperCase();
  if (digits.length !== 10 && digits.length !== 13) return null;
  return digits;
}

/**
 * Vierstellige Jahreszahl aus einem Datum oder Datumsfragment.
 * Akzeptiert "2019", "2019-04-01", "01.04.2019", "April 2019", ISO-Zeitstempel.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
export function yearFromDate(value) {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value >= 1000 && value <= 2999 ? value : null;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;

  // Kein `\b` am Ende: bei "2024-06-11T05:30:00" folgt ein Wortzeichen.
  const iso = text.match(/\b((?:1[0-9]|2[0-9])\d{2})-\d{2}(?:-\d{2})?(?!\d)/);
  if (iso) return Number(iso[1]);

  const matches = text.match(/\b(1[0-9]{3}|2[0-9]{3})\b/g);
  if (!matches || !matches.length) return null;

  // Bei mehreren Kandidaten die erste plausible nehmen.
  const year = Number(matches[0]);
  return year >= 1000 && year <= 2999 ? year : null;
}

/**
 * Datum als `YYYY-MM-DD` in lokaler Zeit (nicht UTC — `accessed_at` ist
 * ein Kalendertag aus Nutzersicht, kein Zeitpunkt).
 *
 * @param {Date} [date]
 * @returns {string}
 */
export function isoDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Normalisiert ein gefundenes Publikationsdatum auf `YYYY-MM-DD`,
 * wenn Tag und Monat bekannt sind, sonst auf `YYYY`.
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeDate(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;

  // Kein `\b` am Ende: ISO-Zeitstempel haengen ein "T…" an den Tag an.
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})(?!\d)/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const german = text.match(/\b(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\b/);
  if (german) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${german[3]}-${pad(german[2])}-${pad(german[1])}`;
  }

  const slashed = text.match(/\b(\d{4})\/(\d{1,2})\/(\d{1,2})\b/);
  if (slashed) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${slashed[1]}-${pad(slashed[2])}-${pad(slashed[3])}`;
  }

  const year = yearFromDate(text);
  return year ? String(year) : null;
}

/**
 * Byte-Groesse menschenlesbar.
 * @param {number} bytes
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '–';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
