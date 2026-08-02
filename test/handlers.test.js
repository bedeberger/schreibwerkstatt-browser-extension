/**
 * Handler-Dispatch — Test, dass `lookupHandler` alle bekannten Typen kennt
 * und bei unbekannten mit `UNKNOWN_MESSAGE` abweist, ohne das `ctx` zu
 * beruehren.
 *
 * Die Handler selbst sind asynchrone Uebergange ueber Chrome-Helfer; hier
 * wird nur der Routing-Kern geprueft. Verhaltenspruefungen mit Mock-Server
 * laufen in `integration.test.js`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createHandlers, lookupHandler } from '../src/background/handlers.js';
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