/**
 * Bruecke zu `chrome.i18n` plus ein kleiner DOM-Lokalisierer.
 *
 * In HTML werden Strings nie hartcodiert, sondern deklariert:
 *   <span data-i18n="popup_title"></span>
 *   <input data-i18n-attr="placeholder:popup_tags_placeholder">
 */

/**
 * @param {string} key
 * @param {string[]} [substitutions]
 * @returns {string}
 */
export function t(key, substitutions) {
  if (typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getMessage === 'function') {
    const value = chrome.i18n.getMessage(key, substitutions);
    if (value) return value;
  }
  return key;
}

/**
 * Uebersetzer in der Signatur, die `describeError` erwartet.
 * @type {(key: string, substitutions?: string[]) => string}
 */
export const translate = (key, substitutions) => t(key, substitutions);

/**
 * Ersetzt alle `data-i18n`-Marker unterhalb von `root`.
 * @param {ParentNode} [root]
 */
export function applyI18n(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    const key = node.getAttribute('data-i18n');
    if (!key) continue;
    const value = t(key);
    if (value && value !== key) node.textContent = value;
  }

  for (const node of root.querySelectorAll('[data-i18n-attr]')) {
    const spec = node.getAttribute('data-i18n-attr');
    if (!spec) continue;
    for (const pair of spec.split(',')) {
      const [attr, key] = pair.split(':').map((part) => part.trim());
      if (!attr || !key) continue;
      const value = t(key);
      if (value && value !== key) node.setAttribute(attr, value);
    }
  }

  if (root === document) {
    const title = document.querySelector('title[data-i18n]');
    if (title) document.title = title.textContent || document.title;
    const lang = t('lang_code');
    if (lang && lang !== 'lang_code') document.documentElement.lang = lang;
  }
}

/**
 * Formatiert eine Zahl in der UI-Sprache.
 * @param {number} value
 */
export function formatNumber(value) {
  try {
    return new Intl.NumberFormat(t('lang_code') === 'de' ? 'de-DE' : 'en-GB').format(value);
  } catch {
    return String(value);
  }
}

/**
 * Relativer Zeitpunkt ("vor 3 Minuten") ohne externe Bibliothek.
 * @param {number} timestamp
 * @param {number} [now]
 */
export function formatRelativeTime(timestamp, now = Date.now()) {
  if (!timestamp) return '';
  const locale = t('lang_code') === 'de' ? 'de-DE' : 'en-GB';
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
