/**
 * Nachrichtentypen zwischen Popup/Options und Service Worker.
 * Als Konstanten, damit ein Tippfehler beim Bauen auffaellt und nicht
 * erst als stumm verschluckte Nachricht zur Laufzeit.
 */

export const MSG = Object.freeze({
  /** Aktuellen Zustand fuer die UI holen (Server, Token, Buecher, Queue). */
  GET_STATE: 'get-state',
  /** Metadaten des aktiven Tabs ernten. */
  HARVEST_ACTIVE_TAB: 'harvest-active-tab',
  /** Buecherliste vom Server neu laden. */
  REFRESH_BOOKS: 'refresh-books',
  /** Verbindungstest inkl. Faehigkeits-Probe. */
  TEST_CONNECTION: 'test-connection',
  /** Erfassung ausloesen. */
  SUBMIT_CAPTURE: 'submit-capture',
  /** Dubletten-Pruefung fuer eine URL. */
  CHECK_DUPLICATE: 'check-duplicate',
  /** DOI/ISBN beim Server nachschlagen. */
  LOOKUP_METADATA: 'lookup-metadata',
  /** Sichtbaren Bereich des Tabs aufnehmen. */
  CAPTURE_SCREENSHOT: 'capture-screenshot',
  /** Warteschlange sofort abarbeiten. */
  FLUSH_QUEUE: 'flush-queue',
  /** Einzelnen Auftrag verwerfen (nur auf ausdrueckliche Nutzeraktion). */
  DISCARD_JOB: 'discard-job',
  /** Auftrag im Undo-Fenster zurueckziehen. */
  UNDO_JOB: 'undo-job',
  /** Einzelnen Auftrag jetzt erneut versuchen. */
  RETRY_JOB: 'retry-job',
  /** Faehigkeits-Schalter setzen. */
  SET_CAPABILITY_MODE: 'set-capability-mode',
  /** Zugangsdaten speichern. */
  SAVE_CREDENTIALS: 'save-credentials',
  /** Einstellungen speichern. */
  SAVE_SETTINGS: 'save-settings',
  /** Standardbuch setzen. */
  SET_DEFAULT_BOOK: 'set-default-book',
  /** Der Worker meldet der offenen UI eine Aenderung. */
  STATE_CHANGED: 'state-changed',
});

/**
 * Kleiner Wrapper um `chrome.runtime.sendMessage`, der Fehler des Workers
 * als abgelehnte Promise weiterreicht statt sie zu verschlucken.
 *
 * @param {string} type
 * @param {Record<string, any>} [payload]
 * @returns {Promise<any>}
 */
export async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (response && response.ok === false) {
    const error = new Error(response.error?.message || 'request failed');
    Object.assign(error, response.error || {});
    throw error;
  }
  return response ? response.data : undefined;
}
