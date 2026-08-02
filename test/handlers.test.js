/**
 * Handler-Dispatch — Test, dass `lookupHandler` alle bekannten Typen kennt
 * und bei unbekannten mit `UNKNOWN_MESSAGE` abweist, ohne das `ctx` zu
 * beruehren.
 *
 * Die Handler selbst sind asynchrone Uebergange ueber Chrome-Helfer; hier
 * wird nur der Routing-Kern geprueft. Verhaltenspruefungen mit Mock-Server
 * laufen in `integration.test.js`. Ausnahme ist `SAVE_CREDENTIALS`: der
 * Handler braucht kein Netz, und was er beim Serverwechsel wegwirft, ist zu
 * leicht wieder zu verlieren.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createHandlers, lookupHandler } from '../src/background/handlers.js';
import { createStore } from '../src/background/state.js';
import { STORAGE_KEYS } from '../src/shared/config.js';
import { MSG } from '../src/shared/messages.js';

/**
 * Minimaler `ctx`, der fuer keinen Handler ausgefuehrt wird — die Tests
 * rufen die Handler nicht auf, nur den Dispatcher.
 */
const noop = async () => undefined;
const noopMap = { get: () => undefined, delete: () => undefined, set: () => undefined };
const ctx = {
  api: {},
  queue: {},
  store: {},
  refreshBadge: noop,
  processQueue: noop,
  scheduleNextWake: noop,
  resolveCapabilities: noop,
  markCapabilityMissing: () => undefined,
  checkSourceDuplicate: noop,
  checkResearchDuplicate: noop,
  fetchBooks: noop,
  probeCapabilities: noop,
  harvestTab: noop,
  captureScreenshot: noop,
  fetchPdfInPage: noop,
  activeTab: noop,
  notify: noop,
  attachmentCache: noopMap,
  lastOutcome: noopMap,
  showUndoNotification: noop,
  extensionVersion: () => '0.0.0-test',
};

describe('handler dispatch', () => {
  const handlers = createHandlers(ctx);

  it('kennt jeden dokumentierten Nachrichtentyp — sonst wuerde der Client stillschweigend scheitern', () => {
    const known = Object.values(MSG);
    const missing = known.filter((type) => typeof handlers[type] !== 'function');
    assert.deepEqual(missing, [], `handler fehlt fuer: ${missing.join(', ')}`);
  });

  it('kennt keinen Typ, der nicht in MSG steht', () => {
    const mapped = Object.keys(handlers);
    const extra = mapped.filter((type) => !Object.values(MSG).includes(type));
    assert.deepEqual(extra, [], `handler ohne MSG-Konstante: ${extra.join(', ')}`);
  });

  it('lookupHandler wirft UNKNOWN_MESSAGE bei unbekanntem Typ — mit dem Typ im Text', () => {
    assert.throws(() => lookupHandler(handlers, 'gibt-es-nicht'), (error) => {
      assert.equal(error.code, 'UNKNOWN_MESSAGE');
      assert.equal(error.message, 'gibt-es-nicht');
      return true;
    });
  });

  it('lookupHandler liefert fuer bekannte Typen die Funktion', () => {
    assert.equal(typeof lookupHandler(handlers, MSG.GET_STATE), 'function');
    assert.equal(typeof lookupHandler(handlers, MSG.SUBMIT_CAPTURE), 'function');
  });
});

/** Minimaler chrome.storage.local-Nachbau, wie in `state.test.js`. */
function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    async get(keys) {
      if (keys === null || keys === undefined) return { ...data };
      const out = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) if (key in data) out[key] = data[key];
      return out;
    },
    async set(patch) {
      Object.assign(data, patch);
    },
  };
}

describe('SAVE_CREDENTIALS', () => {
  /**
   * Ein Serverwechsel macht die Faehigkeits-Befunde wertlos, und
   * `saveDetectedCapabilities({ capture: null, … })` wuerde sie NICHT
   * loeschen: `pick()` liest `null` als „keine Aussage" und behaelt den alten
   * Wert. Ohne diesen Test faellt ein Rueckfall darauf nicht auf — der neue
   * Server erbte dann bis zum Ablauf der 24-h-TTL die Befunde des alten.
   */
  it('wirft die Befunde des vorigen Servers weg, behaelt aber die Vorgabe', async () => {
    const storage = memoryStorage();
    const store = createStore({ storage });
    await store.setCapabilityMode('capture', 'off');
    await store.saveDetectedCapabilities({ capture: true, byUrl: true, researchList: true });
    await store.saveBooks([{ id: 1, name: 'Nordlicht' }]);

    const handlers = createHandlers({ ...ctx, store });
    const result = await handlers[MSG.SAVE_CREDENTIALS]({
      serverUrl: 'https://neu.schreibwerkstatt.example.com/',
      token: 'swd_neu',
    });

    assert.equal(result.serverUrl, 'https://neu.schreibwerkstatt.example.com');
    assert.equal(result.tokenLooksValid, true);

    const caps = await store.getCapabilities();
    assert.equal(caps.capture.detected, null);
    assert.equal(caps.byUrl.detected, null);
    assert.equal(caps.researchList.detected, null);
    assert.equal(caps.probedAt, 0);
    // Die Vorgabe aus den Optionen ist keine Aussage ueber den alten Server.
    assert.equal(caps.capture.mode, 'off');

    const state = await store.readState();
    assert.deepEqual(state[STORAGE_KEYS.BOOKS], []);
    assert.equal(state[STORAGE_KEYS.BOOKS_FETCHED_AT], 0);
  });
});