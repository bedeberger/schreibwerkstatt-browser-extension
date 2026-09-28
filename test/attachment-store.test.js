/**
 * `createAttachmentStore` und `createIdbBackend` — Anhaenge ausserhalb der
 * Warteschlange.
 *
 * Der eigentliche Punkt ist der Worker-Neustart: ein Anhang muss ihn
 * ueberstehen, sonst geht er ab der zweiten Wiederholung verloren. Den
 * Neustart bildet hier eine zweite Ablage ueber derselben Datenbank nach.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { IDBFactory } from 'fake-indexeddb';

import { createAttachmentStore } from '../src/background/attachment-store.js';
import { createIdbBackend } from '../src/background/idb.js';

const PDF = { pdf: { bytes: 'JVBERi0=', name: 'studie.pdf' } };

describe('createIdbBackend', () => {
  /** @type {ReturnType<typeof createIdbBackend>} */
  let backend;
  beforeEach(() => {
    backend = createIdbBackend({ indexedDB: new IDBFactory() });
  });

  it('put/get/delete/keys', async () => {
    assert.equal(await backend.get('job_a'), undefined);
    await backend.put('job_a', PDF);
    await backend.put('job_b', {});
    assert.deepEqual(await backend.get('job_a'), PDF);
    assert.deepEqual((await backend.keys()).sort(), ['job_a', 'job_b']);
    await backend.delete('job_a');
    assert.equal(await backend.get('job_a'), undefined);
    assert.deepEqual(await backend.keys(), ['job_b']);
  });

  it('haelt Binaerdaten unveraendert', async () => {
    const bytes = new Uint8Array([0, 1, 254, 255]);
    await backend.put('job_bin', { pdf: { bytes } });
    const stored = await backend.get('job_bin');
    assert.deepEqual([...stored.pdf.bytes], [0, 1, 254, 255]);
  });
});

describe('createAttachmentStore', () => {
  it('ohne Backend: reiner Arbeitsspeicher, set meldet „nicht persistent"', async () => {
    const store = createAttachmentStore();
    assert.equal(await store.set('job_a', PDF), false);
    assert.deepEqual(await store.get('job_a'), PDF);
    await store.delete('job_a');
    assert.equal(await store.get('job_a'), undefined);
    assert.equal(await store.prune(async () => []), 0);
  });

  it('uebersteht einen Worker-Neustart', async () => {
    const factory = new IDBFactory();
    const before = createAttachmentStore({ backend: createIdbBackend({ indexedDB: factory }) });
    assert.equal(await before.set('job_a', PDF), true);

    const after = createAttachmentStore({ backend: createIdbBackend({ indexedDB: factory }) });
    assert.deepEqual(await after.get('job_a'), PDF);
  });

  it('delete entfernt auch die persistente Kopie', async () => {
    const factory = new IDBFactory();
    const before = createAttachmentStore({ backend: createIdbBackend({ indexedDB: factory }) });
    await before.set('job_a', PDF);
    await before.delete('job_a');

    const after = createAttachmentStore({ backend: createIdbBackend({ indexedDB: factory }) });
    assert.equal(await after.get('job_a'), undefined);
  });

  it('ein scheiterndes Backend faellt auf den Arbeitsspeicher zurueck, statt zu werfen', async () => {
    const broken = {
      get: async () => {
        throw new Error('QuotaExceededError');
      },
      put: async () => {
        throw new Error('QuotaExceededError');
      },
      delete: async () => {
        throw new Error('gesperrt');
      },
      keys: async () => {
        throw new Error('gesperrt');
      },
    };
    const store = createAttachmentStore({ backend: broken });
    assert.equal(await store.set('job_a', PDF), false);
    assert.deepEqual(await store.get('job_a'), PDF);
    await store.delete('job_a');
    assert.equal(await store.get('job_a'), undefined);
    assert.equal(await store.prune(async () => []), 0);
  });

  it('prune entfernt nur Anhaenge ohne Auftrag', async () => {
    const backend = createIdbBackend({ indexedDB: new IDBFactory() });
    const store = createAttachmentStore({ backend });
    await store.set('job_lebt', PDF);
    await store.set('job_weg', PDF);

    assert.equal(await store.prune(async () => ['job_lebt']), 1);
    assert.deepEqual(await backend.keys(), ['job_lebt']);
    assert.equal(await store.get('job_weg'), undefined);
  });

  it('prune liest die Auftraege erst nach den Schluesseln — kein Wettrennen beim Kaltstart', async () => {
    const backend = createIdbBackend({ indexedDB: new IDBFactory() });
    const store = createAttachmentStore({ backend });
    /** @type {string[]} */
    const queue = [];

    // Ein Auftrag, der den Worker weckt, landet zuerst in der Warteschlange,
    // dann sein Anhang — beides, bevor `prune` die Auftraege liest.
    queue.push('job_neu');
    await store.set('job_neu', PDF);

    assert.equal(await store.prune(async () => queue), 0);
    assert.deepEqual(await store.get('job_neu'), PDF);
  });

  it('prune ohne gespeicherte Anhaenge liest die Warteschlange gar nicht erst', async () => {
    const store = createAttachmentStore({ backend: createIdbBackend({ indexedDB: new IDBFactory() }) });
    let asked = false;
    await store.prune(async () => {
      asked = true;
      return [];
    });
    assert.equal(asked, false);
  });
});
