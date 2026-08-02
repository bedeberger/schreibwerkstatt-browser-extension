/**
 * Tests fuer `createStore` — die Factory hinter `state.js`.
 *
 * Ueber eine In-Memory-Storage-Attrappe laeuft das Modul ohne chrome-Umgebung.
 * Damit ist `state.js` diret testbar, analog zu `createQueue` und
 * `createApiClient`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createStore } from '../src/background/state.js';
import { DEFAULT_CAPABILITIES, DEFAULT_SETTINGS, STORAGE_KEYS, TOKEN_STATE } from '../src/shared/config.js';

/** Minimaler chrome.storage.local-Nachbau mit(assert.ok) */
function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    async get(keys) {
      if (keys === null || keys === undefined) return { ...data };
      const out = {};
      const arr = Array.isArray(keys) ? keys : [keys];
      for (const k of arr) if (k in data) out[k] = data[k];
      return out;
    },
    async set(patch) {
      Object.assign(data, patch);
    },
    _dump: data,
  };
}

describe('createStore', () => {
  it('readState liefert Defaults, wenn storage leer ist', async () => {
    const storage = memoryStorage();
    const store = createStore({ storage });
    const state = await store.readState();
    assert.equal(state[STORAGE_KEYS.SERVER_URL], '');
    assert.equal(state[STORAGE_KEYS.TOKEN_STATE], TOKEN_STATE.UNKNOWN);
    assert.deepEqual(state[STORAGE_KEYS.CAPABILITIES].capture, DEFAULT_CAPABILITIES.capture);
    assert.deepEqual(state[STORAGE_KEYS.SETTINGS], DEFAULT_SETTINGS);
  });

  it('getConfig normalisiert die Server-URL und liefert den Token', async () => {
    const storage = memoryStorage({
      [STORAGE_KEYS.SERVER_URL]: 'https://app.schreibwerkstatt.example.com/',
      [STORAGE_KEYS.TOKEN]: 'swd_abc',
    });
    const store = createStore({ storage });
    const config = await store.getConfig();
    assert.equal(config.serverUrl, 'https://app.schreibwerkstatt.example.com');
    assert.equal(config.token, 'swd_abc');
  });

  it('getSettings mischt Defaults mit gespeicherten Werten', async () => {
    const storage = memoryStorage({
      [STORAGE_KEYS.SETTINGS]: { undoDelayMs: 3000, notifications: false },
    });
    const store = createStore({ storage });
    const settings = await store.getSettings();
    assert.equal(settings.undoDelayMs, 3000);
    assert.equal(settings.notifications, false);
    assert.equal(settings.defaultMode, DEFAULT_SETTINGS.defaultMode, 'unberuehrter Default bleibt');
  });

  it('saveSettings schreibt patchweise', async () => {
    const storage = memoryStorage();
    const store = createStore({ storage });
    await store.saveSettings({ defaultMode: 'source' });
    assert.equal(storage._dump[STORAGE_KEYS.SETTINGS].defaultMode, 'source');
    assert.equal(storage._dump[STORAGE_KEYS.SETTINGS].undoDelayMs, DEFAULT_SETTINGS.undoDelayMs);
  });

  it('queue: loadQueue liefert [] bei ungueltigem Wert; saveQueue kehrt zurueck', async () => {
    const storage = memoryStorage({ [STORAGE_KEYS.QUEUE]: 'kein array' });
    const store = createStore({ storage });
    assert.deepEqual(await store.loadQueue(), []);
    await store.saveQueue([{ id: 'job_a' }]);
    assert.deepEqual(await store.loadQueue(), [{ id: 'job_a' }]);
  });

  it('setTokenState/getTokenState roundtrip', async () => {
    const storage = memoryStorage();
    const store = createStore({ storage });
    assert.equal(await store.getTokenState(), TOKEN_STATE.UNKNOWN);
    await store.setTokenState(TOKEN_STATE.INVALID);
    assert.equal(await store.getTokenState(), TOKEN_STATE.INVALID);
  });

  it('getCapabilities liefert die Defaults', async () => {
    const storage = memoryStorage();
    const store = createStore({ storage });
    const caps = await store.getCapabilities();
    assert.deepEqual(caps, DEFAULT_CAPABILITIES);
  });

  it('saveDetectedCapabilities: null bedeutet „keine Aussage" — Wert bleibt', async () => {
    const storage = memoryStorage();
    const store = createStore({ storage });
    await store.saveDetectedCapabilities({ capture: true });
    await store.saveDetectedCapabilities({ capture: null, byUrl: true });
    const caps = await store.getCapabilities();
    assert.equal(caps.capture.detected, true, 'null aendert nichts');
    assert.equal(caps.byUrl.detected, true);
  });

  it('resetDetectedCapabilities setzt zurueck statt „null zu respektieren"', async () => {
    const storage = memoryStorage();
    const store = createStore({ storage });
    await store.saveDetectedCapabilities({ capture: true, byUrl: true, researchList: true });
    await store.resetDetectedCapabilities();
    const caps = await store.getCapabilities();
    assert.equal(caps.capture.detected, null);
    assert.equal(caps.byUrl.detected, null);
    assert.equal(caps.researchList.detected, null);
    assert.equal(caps.researchList.scopeMissing, false);
    assert.equal(caps.probedAt, 0, 'ProbedAt wird null, nicht ueberall');
  });

  it('setCapabilityMode: falscher Modus wird abgewiesen, sonst Patch', async () => {
    const storage = memoryStorage();
    const store = createStore({ storage });
    const unchanged = await store.setCapabilityMode('capture', 'unsinn');
    assert.equal(unchanged.capture.mode, DEFAULT_CAPABILITIES.capture.mode);
    const changed = await store.setCapabilityMode('capture', 'on');
    assert.equal(changed.capture.mode, 'on');
  });

  it('saveBooks setzt Buecher und Zeitstempel', async () => {
    const storage = memoryStorage();
    const store = createStore({ storage });
    await store.saveBooks([{ id: 1, name: 'A' }]);
    const state = await store.readState();
    assert.deepEqual(state[STORAGE_KEYS.BOOKS], [{ id: 1, name: 'A' }]);
    assert.ok(state[STORAGE_KEYS.BOOKS_FETCHED_AT] > 0);
  });
});