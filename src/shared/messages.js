/**
 * Nachrichtentypen zwischen Popup/Options und Service Worker.
 * Als Konstanten, damit ein Tippfehler beim Bauen auffaellt und nicht
 * erst als stumm verschluckte Nachricht zur Laufzeit.
 *
 * Reine Daten — kein `chrome`-Bezug. Der Versand (`send`) liegt in
 * `src/ui/messaging.js`, weil er `chrome.runtime.sendMessage` braucht.
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
});