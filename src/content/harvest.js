/**
 * Content-Script-Einstiegspunkt.
 *
 * Wird per `chrome.scripting.executeScript` auf ausdrueckliche Nutzeraktion
 * injiziert (activeTab) — es liegt kein dauerhaftes Script auf allen Seiten.
 * Das Script fuehrt selbst KEINE Netzwerkanfragen aus; es reicht nur Daten
 * an den Service Worker zurueck.
 *
 * Es registriert eine Funktion unter `globalThis.__schreibwerkstatt`.
 * Der Worker ruft sie in einem zweiten `executeScript`-Aufruf auf, damit
 * der Rueckgabewert zuverlaessig ankommt.
 */

import { extractArticleText } from './article-text.js';
import { harvestMetadata } from './extract-meta.js';
import { LIMITS } from '../shared/limits.js';

/**
 * Liest die aktuelle Textmarkierung WORTWOERTLICH.
 *
 * Absichtlich nicht `info.selectionText` aus dem Kontextmenue: Chrome
 * kuerzt das und normalisiert Weissraum. Ein Zitat muss aber exakt so
 * ankommen, wie es auf der Seite steht.
 *
 * @returns {string}
 */
function readSelection() {
  try {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return '';
    return selection.toString();
  } catch {
    return '';
  }
}

/**
 * @param {object} [options]
 * @param {boolean} [options.includeArticleText]
 * @returns {object}
 */
function harvest(options = {}) {
  const includeArticleText = options.includeArticleText !== false;
  const selectionText = readSelection();

  const meta = harvestMetadata(document, { url: location.href });

  const article = includeArticleText
    ? extractArticleText(document, LIMITS.BODY_MAX)
    : { text: '', truncated: false, originalLength: 0, byline: '', excerpt: '', siteName: '', readerable: false };

  // Readability kennt manchmal eine Autorenzeile, die keine Meta-Angabe hat.
  if (!meta.authors.length && article.byline) {
    meta.bylineHint = article.byline;
  }
  if (!meta.siteName && article.siteName) {
    meta.siteName = article.siteName;
  }

  // Eine Markierung hat Vorrang: sie wird zum Zitat, unveraendert.
  const hasSelection = selectionText.trim().length > 0;

  return {
    meta,
    article,
    selectionText,
    hasSelection,
    /** Vorschlag fuer `body`; das Popup darf ihn ueberschreiben. */
    suggestedBody: hasSelection ? selectionText : article.text,
    suggestedKind: hasSelection ? 'quote' : 'link',
    bodyTruncated: hasSelection ? false : article.truncated,
    bodyOriginalLength: hasSelection ? selectionText.length : article.originalLength,
  };
}

const api = { harvest, readSelection, version: 1 };

// Mehrfache Injektion ist unschaedlich: die letzte Registrierung gewinnt.
Object.defineProperty(globalThis, '__schreibwerkstatt', {
  value: api,
  writable: true,
  configurable: true,
});

export default api;
