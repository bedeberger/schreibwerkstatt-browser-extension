/**
 * `createAttachmentStore` — In-Memory-Ablage fuer Anhaenge.
 *
 * Kleines Modul; es tested vor allem, dass die Methoden vorhanden sind und
 * sich wie eine dichte Map verhalten (kein Chrome-Bezug, keine Persistence).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createAttachmentStore } from '../src/background/attachment-store.js';

describe('createAttachmentStore', () => {
  it('set/get/delete roundtrip', () => {
    const store = createAttachmentStore();
    assert.equal(store.has('job_a'), false);
    store.set('job_a', { pdf: { bytes: 'AAA' } });
    assert.equal(store.has('job_a'), true);
    assert.deepEqual(store.get('job_a'), { pdf: { bytes: 'AAA' } });
    store.delete('job_a');
    assert.equal(store.has('job_a'), false);
    assert.equal(store.get('job_a'), undefined);
  });

  it('size spiegelt die Anzahl Jobs mit Anhang', () => {
    const store = createAttachmentStore();
    assert.equal(store.size, 0);
    store.set('job_a', {});
    store.set('job_b', {});
    assert.equal(store.size, 2);
    store.delete('job_a');
    assert.equal(store.size, 1);
  });

  it('delete auf einen nicht existenten jobId ist still ok', () => {
    const store = createAttachmentStore();
    assert.equal(store.delete('gibt-es-nicht'), false);
    assert.equal(store.size, 0);
  });
});