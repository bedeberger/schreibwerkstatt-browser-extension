/**
 * Reine i18n-Logik ohne chrome-Abhaengigkeit — direkt testbar.
 *
 * `t` ist hier die Identitaet (gibt den Schluessel zurueck). Die chrome-Bruecke
 * in `src/ui/chrome-i18n.js` liefert die uebersetzte Fassung und bindet
 * `applyI18n`/`formatRelativeTime` an sich.
 */

/**
 * Identitaet — in Tests kann hier jede beliebige Uebersetzer-Attrappe
 * übergeben werden.
 * @param {string} key
 * @param {string[]} [_substitutions]
 * @returns {string}
 */
export function t(key, _substitutions) {
  return key;
}

/**
 * Ersetzt alle `data-i18n`-Marker unterhalb von `root` mit Hilfe des
 * uebergebenen Uebersetzers.
 *
 * @param {ParentNode} [root]
 * @param {(key: string, substitutions?: string[]) => string} [translate]
 */
export function applyI18n(root = document, translate = t) {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    const key = node.getAttribute('data-i18n');
    if (!key) continue;
    const value = translate(key);
    if (value && value !== key) node.textContent = value;
  }

  for (const node of root.querySelectorAll('[data-i18n-attr]')) {
    const spec = node.getAttribute('data-i18n-attr');
    if (!spec) continue;
    for (const pair of spec.split(',')) {
      const [attr, key] = pair.split(':').map((part) => part.trim());
      if (!attr || !key) continue;
      const value = translate(key);
      if (value && value !== key) node.setAttribute(attr, value);
    }
  }

  // Titel- und lang-Ersetzung sind nur sinnvoll, wenn `root` actually das
  // Dokument ist. In Tests (JSDOM) existiert der globale `document` nicht;
  // der Aufrufer uebergibt das JSDOM-Dokument, nicht das globale.
  if (typeof document !== 'undefined' && root === document) {
    const title = document.querySelector('title[data-i18n]');
    if (title) document.title = title.textContent || document.title;
    const lang = translate('lang_code');
    if (lang && lang !== 'lang_code') document.documentElement.lang = lang;
  }
}

/**
 * Relativer Zeitpunkt ("vor 3 Minuten") ohne externe Bibliothek.
 *
 * @param {number} timestamp
 * @param {number} [now]
 * @param {(key: string, substitutions?: string[]) => string} [translate]
 */
export function formatRelativeTime(timestamp, now = Date.now(), translate = t) {
  if (!timestamp) return '';
  const locale = translate('lang_code') === 'de' ? 'de-DE' : 'en-GB';
  const deltaSeconds = Math.round((timestamp - now) / 1000);
  const units = /** @type {const} */ ([
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
  ]);
  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    for (const [unit, seconds] of units) {
      if (Math.abs(deltaSeconds) >= seconds || unit === 'second') {
        return rtf.format(Math.round(deltaSeconds / seconds), unit);
      }
    }
  } catch {
    /* Intl fehlt — dann eben absolut. */
  }
  return new Date(timestamp).toLocaleString(locale);
}