/**
 * `verdictFromError` — nicht mehr ueber ein `__testing`-Gimmick erreichbar,
 * sondern als oeffentliche Funktion. So laesst sich jedes Urteil isoliert
 * pruefen, ohne den API-Client zu bemuehen.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { verdictFromError } from '../src/background/capabilities.js';

describe('verdictFromError', () => {
  it('404/405 OHNE error_code heisst „Route fehlt"', () => {
    assert.equal(verdictFromError({ status: 404, jsonBody: false }), false);
    assert.equal(verdictFromError({ status: 405 }), false);
    assert.equal(verdictFromError({ status: 501, jsonBody: false }), false);
  });

  it('404/405 MIT error_code heisst „Route da"', () => {
    // Ein fachliches 404 mit error_code belegt, dass die Route existiert.
    assert.equal(verdictFromError({ status: 404, jsonBody: true, code: 'NOT_FOUND' }), true);
    assert.equal(verdictFromError({ status: 405, jsonBody: true, code: 'X' }), true);
  });

  it('400/422 MIT error_code — Route ist da', () => {
    assert.equal(verdictFromError({ status: 400, jsonBody: true, code: 'BOOKID_REQ' }), true);
    assert.equal(verdictFromError({ status: 422, jsonBody: true, code: 'X' }), true);
  });

  it('400 OHNE error_code ist trotzdem „Route da"', () => {
    // Der Body-Parser antwortet 400 + HTML; hier kein verdict — aber 400 bedeutet
    // zumindest, dass etwas die Anfrage inhaltlich geprueft hat.
    assert.equal(verdictFromError({ status: 400, jsonBody: false }), true);
  });

  it('Auth, Berechtigung und Drosselung sagen nichts ueber die Route', () => {
    for (const status of [401, 403, 429]) {
      assert.equal(verdictFromError({ status, jsonBody: true, code: 'X' }), null);
    }
  });

  it('Netzfehler sind keine Aussage ueber die Route', () => {
    assert.equal(verdictFromError({ networkError: true, status: 0 }), null);
  });

  it('5xx (ausser 501) ist keine Aussage ueber die Route', () => {
    assert.equal(verdictFromError({ status: 500, jsonBody: true, code: 'X' }), null);
    assert.equal(verdictFromError({ status: 503 }), null);
  });

  it('kein Fehlerobjekt ist keine Aussage', () => {
    assert.equal(verdictFromError(null), null);
    assert.equal(verdictFromError(undefined), null);
  });
});