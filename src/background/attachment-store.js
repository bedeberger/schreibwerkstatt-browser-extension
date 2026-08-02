/**
 * In-Memory-Ablage fuer Anhaenge (Screenshot, PDF) waehrend eine Erfassung
 * laeuft.
 *
 * Sie gehoeren bewusst NICHT in die persistierte Warteschlange: ein PDF darf
 * 25 MB gross sein, als base64 also rund 33 MB — `chrome.storage.local` fasst
 * aber nur etwa 10 MB. Wuerden wir sie mitschreiben, ginge beim Ueberlauf der
 * gesamte Auftrag verloren, nicht nur der Anhang.
 *
 * Folge: ueberlebt ein Auftrag den Neustart des Workers, wird er ohne Anhang
 * gesendet. Der Verlust wird am Auftrag vermerkt und in den Optionen angezeigt
 * — nie stillschweigend.
 *
 * Ueber die Factory injizierbar; die Methoden sind duenn genug, dass Tests
 * das Modul ohne Chrome-Umgebung treiben koennen.
 */

/**
 * @param {object} [deps]
 * @param {() => Map<string, Record<string, any>>} [deps.makeMap]
 */
export function createAttachmentStore({ makeMap = () => new Map() } = {}) {
  /** @type {Map<string, Record<string, any>>} */
  const cache = makeMap();

  return {
    /** @param {string} jobId */
    has: (jobId) => cache.has(jobId),
    /**
     * @param {string} jobId
     * @returns {Record<string, any>|undefined}
     */
    get: (jobId) => cache.get(jobId),
    /**
     * @param {string} jobId
     * @param {Record<string, any>} attachments
     */
    set: (jobId, attachments) => cache.set(jobId, attachments),
    /** @param {string} jobId */
    delete: (jobId) => cache.delete(jobId),
    /** @returns {number} */
    get size() {
      return cache.size;
    },
  };
}