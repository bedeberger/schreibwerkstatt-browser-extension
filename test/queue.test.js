import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createQueue } from '../src/background/queue.js';
import { MAX_ATTEMPTS, exhausted, nextDelay } from '../src/shared/backoff.js';
import { ApiError } from '../src/shared/errors.js';
import { JOB_STATE } from '../src/shared/config.js';

describe('backoff', () => {
  it('waechst exponentiell und deckelt', () => {
    const delays = [1, 2, 3, 4, 5, 6, 7, 20].map((n) => nextDelay(n, 0));
    assert.deepEqual(delays.slice(0, 6), [15_000, 60_000, 300_000, 1_800_000, 7_200_000, 21_600_000]);
    // Ab dem siebten Versuch bleibt es bei sechs Stunden.
    assert.equal(delays[6], 21_600_000);
    assert.equal(delays[7], 21_600_000);
  });

  it('streut nur nach oben', () => {
    const value = nextDelay(1, 0.2, () => 1);
    assert.equal(value, 18_000);
    assert.equal(nextDelay(1, 0.2, () => 0), 15_000);
  });

  it('erschoepft nach MAX_ATTEMPTS', () => {
    assert.equal(exhausted(MAX_ATTEMPTS - 1), false);
    assert.equal(exhausted(MAX_ATTEMPTS), true);
  });
});

/** Speicher-Attrappe mit steuerbarer Uhr. */
function makeQueue(startTime = 1_000_000) {
  let jobs = [];
  let now = startTime;
  const queue = createQueue({
    load: async () => JSON.parse(JSON.stringify(jobs)),
    save: async (next) => {
      jobs = JSON.parse(JSON.stringify(next));
    },
    now: () => now,
    random: () => 0,
  });
  return {
    queue,
    advance: (ms) => {
      now += ms;
    },
    at: () => now,
    raw: () => jobs,
  };
}

const intent = (title = 'Titel') => ({
  mode: 'research',
  bookId: 1,
  bookName: 'Buch',
  url: 'https://example.org/a',
  normalizedUrl: 'https://example.org/a',
  kind: 'quote',
  title,
  body: 'Wortlaut',
  tags: [],
  urls: [],
  source: {},
  attachments: {},
});

describe('Warteschlange', () => {
  it('nimmt einen Auftrag auf und meldet ihn als faellig', async () => {
    const { queue } = makeQueue();
    const job = await queue.add(intent());
    assert.equal(job.state, JOB_STATE.PENDING);
    const due = await queue.due();
    assert.equal(due.length, 1);
    assert.equal(due[0].id, job.id);
  });

  it('haelt einen Auftrag im Undo-Fenster zurueck', async () => {
    const { queue, advance } = makeQueue();
    await queue.add(intent(), { holdMs: 6000 });

    assert.deepEqual(await queue.due(), []);
    assert.equal((await queue.counts()).held, 1);

    advance(6000);
    assert.equal((await queue.due()).length, 1);
  });

  it('undo zieht zurueck, solange das Fenster offen ist', async () => {
    const { queue } = makeQueue();
    const job = await queue.add(intent(), { holdMs: 6000 });

    assert.equal(await queue.undo(job.id), true);
    assert.equal((await queue.list()).length, 0);
  });

  it('undo greift nicht mehr, sobald der Auftrag unterwegs ist', async () => {
    const { queue } = makeQueue();
    // Ohne Haltezeit ist der Auftrag sofort `pending`, nicht `held`.
    const job = await queue.add(intent(), { holdMs: 0 });

    assert.equal(await queue.undo(job.id), false);
    assert.equal((await queue.list()).length, 1);
  });

  it('undo auf einen unbekannten Auftrag ist harmlos', async () => {
    const { queue } = makeQueue();
    assert.equal(await queue.undo('gibt-es-nicht'), false);
  });

  it('plant nach einem wiederholbaren Fehler den naechsten Versuch', async () => {
    const { queue, at } = makeQueue();
    const job = await queue.add(intent());

    const result = await queue.fail(job.id, new ApiError({ status: 503 }));
    assert.equal(result.willRetry, true);
    assert.equal(result.job.state, JOB_STATE.PENDING);
    assert.equal(result.job.attempts, 1);
    assert.equal(result.job.runAfter, at() + 15_000);
    assert.ok(result.job.lastError.text.includes('HTTP_503'));

    assert.deepEqual(await queue.due(), []);
  });

  it('gibt bei einem endgueltigen Fehler auf, behaelt den Auftrag aber', async () => {
    const { queue } = makeQueue();
    const job = await queue.add(intent());

    const result = await queue.fail(job.id, new ApiError({ status: 401, code: 'NOT_LOGGED_IN' }));
    assert.equal(result.willRetry, false);
    assert.equal(result.job.state, JOB_STATE.FAILED);

    // Nicht stillschweigend verworfen — er steht weiter in der Liste.
    assert.equal((await queue.list()).length, 1);
    assert.equal((await queue.counts()).failed, 1);
    assert.deepEqual(await queue.due(), []);
  });

  it('gibt nach MAX_ATTEMPTS auf', async () => {
    const { queue, advance } = makeQueue();
    const job = await queue.add(intent());

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await queue.fail(job.id, new ApiError({ status: 0, networkError: true }));
      advance(24 * 60 * 60 * 1000);
    }

    const [stored] = await queue.list();
    assert.equal(stored.attempts, MAX_ATTEMPTS);
    assert.equal(stored.state, JOB_STATE.FAILED);
  });

  it('bewahrt den Teilfortschritt ueber Fehlschlaege hinweg', async () => {
    const { queue } = makeQueue();
    const job = await queue.add(intent());

    await queue.fail(job.id, new ApiError({ status: 500 }), {
      researchItemId: 4711,
      linkedBookIds: [],
    });

    const [stored] = await queue.list();
    // Ein Retry darf das Recherche-Item nicht ein zweites Mal anlegen.
    assert.equal(stored.progress.researchItemId, 4711);
  });

  it('retryNow setzt den Zaehler zurueck', async () => {
    const { queue, at } = makeQueue();
    const job = await queue.add(intent());
    await queue.fail(job.id, new ApiError({ status: 401, code: 'NOT_LOGGED_IN' }));

    const revived = await queue.retryNow(job.id);
    assert.equal(revived.state, JOB_STATE.PENDING);
    assert.equal(revived.attempts, 0);
    assert.equal(revived.runAfter, at());
    assert.equal((await queue.due()).length, 1);
  });

  it('complete entfernt, discard ebenfalls — aber nur auf Zuruf', async () => {
    const { queue } = makeQueue();
    const a = await queue.add(intent('A'));
    const b = await queue.add(intent('B'));

    await queue.complete(a.id);
    assert.equal((await queue.list()).length, 1);
    await queue.discard(b.id);
    assert.equal((await queue.list()).length, 0);
  });

  it('nextWakeAt nennt den fruehesten faelligen Zeitpunkt', async () => {
    const { queue, at } = makeQueue();
    await queue.add(intent('spaet'), { holdMs: 10_000 });
    await queue.add(intent('frueh'), { holdMs: 2_000 });

    assert.equal(await queue.nextWakeAt(), at() + 2_000);
  });

  it('nextWakeAt ignoriert endgueltig gescheiterte Auftraege', async () => {
    const { queue } = makeQueue();
    const job = await queue.add(intent());
    await queue.fail(job.id, new ApiError({ status: 403, code: 'CAPTURE_SCOPE_REQUIRED' }));
    assert.equal(await queue.nextWakeAt(), null);
  });

  it('serialisiert gleichzeitige Schreibvorgaenge', async () => {
    const { queue } = makeQueue();
    await Promise.all(Array.from({ length: 20 }, (_, i) => queue.add(intent(`T${i}`))));
    assert.equal((await queue.list()).length, 20);
  });
});
