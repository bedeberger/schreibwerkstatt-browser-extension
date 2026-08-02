/**
 * chrome.i18n-Bruecke fuer die UI und den Service Worker.
 *
 * `shared/i18n.js` enthaelt die rene Logik (testbar, ohne chrome). Hier wird
 * die chrome-Variante der Uebersetzer-Funktion `t` sowie gebundene Fassungen
 * von `applyI18n` und `formatRelativeTime` bereitgestellt, damit Aufrufer
 * ohne Parameterwechsel so weiterarbeiten koennen wie bisher.
 */

import { applyI18n as applyI18nBase, formatRelativeTime as formatRelativeTimeBase } from '../shared/i18n.js';

/**
 * Uebersetzt einen Schluessel via `chrome.i18n.getMessage`.
 * Fehlt die Uebersetzung, faellt die Funktion auf den Schluessel zurueck
 * und signalisiert so der `applyI18n`-Logik, den Wert nicht zu setzen.
 *
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
 * Ersetzt alle `data-i18n`-Marker unterhalb von `root` mit der chrome-Bruecke.
 * @param {ParentNode} [root]
 */
export function applyI18n(root = document) {
  return applyI18nBase(root, t);
}

/**
 * Relativer Zeitpunkt, gebunden an die chrome-Sprache.
 *
 * @param {number} timestamp
 * @param {number} [now]
 */
export function formatRelativeTime(timestamp, now) {
  return formatRelativeTimeBase(timestamp, now, t);
}