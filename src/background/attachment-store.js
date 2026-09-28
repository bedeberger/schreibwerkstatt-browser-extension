/**
 * Ablage fuer Anhaenge (Screenshot, PDF), solange ihr Auftrag in der
 * Warteschlange steht.
 *
 * Sie gehoeren bewusst NICHT in die Warteschlange selbst: ein PDF darf 25 MB
 * gross sein, als base64 also rund 33 MB — `chrome.storage.local` fasst aber
 * nur etwa 10 MB. Wuerden wir sie mitschreiben, ginge beim Ueberlauf der
 * gesamte Auftrag verloren, nicht nur der Anhang.
 *
 * Zwei Stufen: der Arbeitsspeicher fuer den ersten Versuch, darunter ein
 * persistentes Backend (IndexedDB, siehe `idb.js`). Ohne die zweite Stufe waere
 * der Anhang ab der zweiten Wiederholung praktisch immer weg — Chrome beendet
 * einen untaetigen Service Worker nach etwa 30 s, der Backoff wartet ab dem
 * zweiten Versuch eine Minute und laenger.
 *
 * Scheitert das Backend (Kontingent, gesperrter Speicher), bleibt es beim
 * Arbeitsspeicher. Geht der Anhang dann mit dem Worker verloren, vermerkt der
 * Service Worker das am Auftrag — nie stillschweigend.
 *
 * Ueber die Factory injizierbar, damit Tests das Modul ohne Chrome treiben.
 */

/**
 * @typedef {object} AttachmentBackend
 * @property {(key: string) => Promise<any>} get
 * @property {(key: string, value: any) => Promise<void>} put
 * @property {(key: string) => Promise<void>} delete
 * @property {() => Promise<string[]>} keys
 */

/**
 * @param {object} [deps]
 * @param {AttachmentBackend|null} [deps.backend] ohne: nur Arbeitsspeicher
 */
export function createAttachmentStore({ backend = null } = {}) {
  /** @type {Map<string, Record<string, any>>} */
  const memory = new Map();

  return {
    /**
     * @param {string} jobId
     * @returns {Promise<Record<string, any>|undefined>}
     */
    async get(jobId) {
      const cached = memory.get(jobId);
      if (cached || !backend) return cached;
      try {
        const stored = await backend.get(jobId);
        if (stored) memory.set(jobId, stored);
        return stored || undefined;
      } catch {
        return undefined;
      }
    },

    /**
     * @param {string} jobId
     * @param {Record<string, any>} attachments
     * @returns {Promise<boolean>} ob der Anhang einen Worker-Neustart uebersteht
     */
    async set(jobId, attachments) {
      memory.set(jobId, attachments);
      if (!backend) return false;
      try {
        await backend.put(jobId, attachments);
        return true;
      } catch {
        return false;
      }
    },

    /** @param {string} jobId */
    async delete(jobId) {
      memory.delete(jobId);
      if (!backend) return;
      try {
        await backend.delete(jobId);
      } catch {
        // Ein Rest wird beim naechsten `prune` eingesammelt.
      }
    },

    /**
     * Raeumt Anhaenge ab, deren Auftrag es nicht mehr gibt — etwa wenn der
     * Worker zwischen Abschluss und Loeschen beendet wurde.
     *
     * Die lebenden Auftraege werden erst NACH den gespeicherten Schluesseln
     * gelesen. Ein Auftrag wird vor seinem Anhang in die Warteschlange
     * geschrieben; jeder Schluessel, den wir sehen, hat seinen Auftrag also
     * spaetestens dann schon. Andersherum koennte ein Aufraeumen beim
     * Kaltstart den Anhang eines Auftrags loeschen, der den Worker gerade
     * erst geweckt hat.
     *
     * @param {() => Promise<Iterable<string>>} liveJobIds
     * @returns {Promise<number>} Anzahl entfernter Eintraege
     */
    async prune(liveJobIds) {
      if (!backend) return 0;
      let removed = 0;
      try {
        const keys = await backend.keys();
        if (!keys.length) return 0;
        const live = new Set(await liveJobIds());
        for (const key of keys) {
          if (live.has(key)) continue;
          memory.delete(key);
          await backend.delete(key);
          removed += 1;
        }
      } catch {
        // Aufraeumen ist Kuer; der naechste Kaltstart versucht es erneut.
      }
      return removed;
    },
  };
}
