/**
 * Duenne Promise-Huelle um IndexedDB — ein Objektspeicher, Schluessel frei.
 *
 * IndexedDB statt `chrome.storage.local`, weil Anhaenge dort nicht hineinpassen:
 * `storage.local` fasst ohne `unlimitedStorage` etwa 10 MB, ein PDF darf 25 MB
 * gross sein. IndexedDB teilt sich das Kontingent des Profils und ist im
 * Service Worker verfuegbar.
 *
 * Die Fabrik nimmt die `indexedDB`-Implementierung entgegen, damit Tests sie
 * mit `fake-indexeddb` treiben koennen.
 */

/**
 * @param {IDBRequest} request
 * @returns {Promise<any>}
 */
function settle(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * @param {object} [deps]
 * @param {IDBFactory} [deps.indexedDB]
 * @param {string} [deps.dbName]
 * @param {string} [deps.storeName]
 */
export function createIdbBackend({
  indexedDB = globalThis.indexedDB,
  dbName = 'schreibwerkstatt',
  storeName = 'attachments',
} = {}) {
  /** @type {Promise<IDBDatabase>|null} */
  let opening = null;

  function open() {
    if (!opening) {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName);
        }
      };
      opening = settle(request).catch((error) => {
        // Ein gescheitertes Oeffnen darf den naechsten Versuch nicht blockieren.
        opening = null;
        throw error;
      });
    }
    return opening;
  }

  /**
   * @param {IDBTransactionMode} mode
   * @param {(store: IDBObjectStore) => IDBRequest} action
   */
  async function run(mode, action) {
    const db = await open();
    const tx = db.transaction(storeName, mode);
    const result = settle(action(tx.objectStore(storeName)));
    // Schreiben gilt erst mit dem Abschluss der Transaktion als erledigt —
    // `onsuccess` des Requests allein sagt noch nichts ueber die Platte.
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(undefined);
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
    const [value] = await Promise.all([result, done]);
    return value;
  }

  return {
    /** @param {string} key */
    get: (key) => run('readonly', (store) => store.get(key)),
    /**
     * @param {string} key
     * @param {any} value
     */
    put: async (key, value) => {
      await run('readwrite', (store) => store.put(value, key));
    },
    /** @param {string} key */
    delete: async (key) => {
      await run('readwrite', (store) => store.delete(key));
    },
    /** @returns {Promise<string[]>} */
    keys: async () => /** @type {string[]} */ (await run('readonly', (store) => store.getAllKeys())),
  };
}
