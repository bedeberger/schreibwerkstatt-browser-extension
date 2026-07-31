import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ApiError,
  describeError,
  isAuthError,
  isRetryable,
  isScopeError,
  messageKeyForError,
} from '../src/shared/errors.js';

/** Uebersetzer-Attrappe: gibt den Schluessel mit eingesetzten Platzhaltern zurueck. */
const fakeTranslate = (key, subs = []) =>
  subs.length ? `${key}[${subs.join('|')}]` : `text:${key}`;

describe('messageKeyForError', () => {
  it('bildet dokumentierte Codes ab', () => {
    assert.equal(messageKeyForError({ status: 401, code: 'NOT_LOGGED_IN' }), 'err_not_logged_in');
    assert.equal(
      messageKeyForError({ status: 403, code: 'CAPTURE_SCOPE_REQUIRED' }),
      'err_capture_scope_required',
    );
    assert.equal(messageKeyForError({ status: 400, code: 'SOURCE_IDENTITY_REQ' }), 'err_source_identity_req');
    assert.equal(messageKeyForError({ status: 409, code: 'CITEKEY_TAKEN' }), 'err_citekey_taken');
  });

  it('ist unempfindlich gegen Kleinschreibung', () => {
    assert.equal(messageKeyForError({ code: 'not_logged_in' }), 'err_not_logged_in');
  });

  it('faellt auf den HTTP-Status zurueck', () => {
    assert.equal(messageKeyForError({ status: 404 }), 'err_status_404');
    assert.equal(messageKeyForError({ status: 500 }), 'err_server_error');
    assert.equal(messageKeyForError({ status: 418 }), 'err_status_400');
    assert.equal(messageKeyForError({ status: 599 }), 'err_server_error');
  });

  it('erkennt Netzfehler', () => {
    assert.equal(messageKeyForError({ networkError: true, status: 0 }), 'err_network');
  });

  it('kennt einen letzten Ausweg', () => {
    assert.equal(messageKeyForError({}), 'err_unknown');
  });

  it('ein unbekannter Code faellt auf den Status zurueck, verschwindet aber nicht', () => {
    assert.equal(messageKeyForError({ status: 400, code: 'WAS_AUCH_IMMER' }), 'err_status_400');
  });
});

describe('isRetryable', () => {
  it('Netzfehler und Zeitueberschreitungen: ja', () => {
    assert.equal(isRetryable({ networkError: true }), true);
    assert.equal(isRetryable({ status: 408 }), true);
    assert.equal(isRetryable({ status: 429 }), true);
    assert.equal(isRetryable({ status: 503 }), true);
  });

  it('Auth- und Berechtigungsfehler: nein — nie stillschweigend wiederholen', () => {
    assert.equal(isRetryable({ status: 401, code: 'NOT_LOGGED_IN' }), false);
    assert.equal(isRetryable({ status: 403, code: 'CAPTURE_SCOPE_REQUIRED' }), false);
  });

  it('fachliche Ablehnungen: nein', () => {
    assert.equal(isRetryable({ status: 400, code: 'SOURCE_IDENTITY_REQ' }), false);
    assert.equal(isRetryable({ status: 413, code: 'PAYLOAD_TOO_LARGE' }), false);
    assert.equal(isRetryable({ status: 400, code: 'VALIDATION_FAILED' }), false);
  });

  it('CITEKEY_TAKEN wird im Ablauf behandelt, nicht per Retry', () => {
    assert.equal(isRetryable({ status: 409, code: 'CITEKEY_TAKEN' }), false);
  });

  it('ohne HTTP-Antwort: ja', () => {
    assert.equal(isRetryable({ status: 0 }), true);
  });
});

describe('isAuthError / isScopeError', () => {
  it('erkennt 401 und NOT_LOGGED_IN', () => {
    assert.equal(isAuthError({ status: 401 }), true);
    assert.equal(isAuthError({ code: 'NOT_LOGGED_IN' }), true);
    assert.equal(isAuthError({ status: 403 }), false);
  });

  it('erkennt den fehlenden Erfassungs-Scope', () => {
    assert.equal(isScopeError({ code: 'CAPTURE_SCOPE_REQUIRED' }), true);
    assert.equal(isScopeError({ status: 403 }), false);
  });
});

describe('describeError', () => {
  it('haengt IMMER den Fehlercode an — dafuer ist er da', () => {
    const result = describeError({ status: 403, code: 'CAPTURE_SCOPE_REQUIRED' }, fakeTranslate);
    assert.equal(result.code, 'CAPTURE_SCOPE_REQUIRED');
    assert.ok(result.text.endsWith('(CAPTURE_SCOPE_REQUIRED)'));
    assert.equal(result.scope, true);
    assert.equal(result.retryable, false);
  });

  it('reicht Server-Parameter als Platzhalter durch', () => {
    const result = describeError(
      { status: 400, code: 'VALIDATION_FAILED', params: { field: 'title', max: 300 } },
      fakeTranslate,
    );
    assert.equal(result.text, 'err_validation_failed[title|300] (VALIDATION_FAILED)');
  });

  it('markiert Netzfehler als NETWORK', () => {
    const result = describeError({ networkError: true, status: 0 }, fakeTranslate);
    assert.equal(result.code, 'NETWORK');
    assert.equal(result.retryable, true);
  });

  it('ohne Code steht der HTTP-Status im Text', () => {
    const result = describeError({ status: 502 }, fakeTranslate);
    assert.equal(result.code, 'HTTP_502');
    assert.ok(result.text.endsWith('(HTTP_502)'));
  });

  it('kommt ohne Uebersetzer aus', () => {
    const result = describeError({ status: 404 });
    assert.equal(result.text, 'err_status_404 (HTTP_404)');
  });
});

describe('ApiError', () => {
  it('laesst sich fuer die Warteschlange serialisieren', () => {
    const error = new ApiError({ status: 409, code: 'CITEKEY_TAKEN', params: { citekey: 'muster2019' } });
    const json = JSON.parse(JSON.stringify(error));
    assert.equal(json.status, 409);
    assert.equal(json.code, 'CITEKEY_TAKEN');
    assert.deepEqual(json.params, { citekey: 'muster2019' });
  });

  it('ist ein echter Error', () => {
    const error = new ApiError({ code: 'X' });
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'ApiError');
  });
});
