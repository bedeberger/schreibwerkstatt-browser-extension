/**
 * Integrationstest: API-Client, Faehigkeits-Erkennung, Erfassungsablauf
 * und Warteschlange gegen einen Mock-Server, der den Vertrag nachbaut.
 *
 * Es wird kein echter Server gebraucht — der Mock laeuft auf 127.0.0.1.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createApiClient, describeDevice } from '../src/background/api-client.js';
import { probeCapabilities } from '../src/background/capabilities.js';
import { runCaptureJob, toBase64, toBinary } from '../src/background/capture-runner.js';
import { createQueue } from '../src/background/queue.js';
import { startMockServer } from './helpers/mock-server.js';
import { JOB_STATE } from '../src/shared/config.js';

const CLIENT_INFO = { platform: 'chrome', device: 'Chrome 131 / Linux', version: '0.1.0' };

/**
 * @param {{url: string}} server
 * @param {object} [overrides]
 */
function makeClient(server, overrides = {}) {
  const events = { auth: 0, scope: 0 };
  const api = createApiClient({
    getConfig: () => ({ serverUrl: server.url, token: 'swd_gueltig', ...overrides }),
    getClientInfo: () => CLIENT_INFO,
    onAuthError: () => {
      events.auth += 1;
    },
    onScopeError: () => {
      events.scope += 1;
    },
  });
  return { api, events };
}

function makeJob(intent, id = 'job_1') {
  return {
    id,
    createdAt: 0,
    attempts: 0,
    runAfter: 0,
    state: JOB_STATE.PENDING,
    lastError: null,
    intent,
    progress: {
      researchItemId: null,
      sourceId: null,
      linkedBookIds: [],
      imageUploaded: false,
      pdfUploaded: false,
      via: null,
    },
  };
}

const baseIntent = (overrides = {}) => ({
  mode: 'research',
  bookId: 1,
  bookName: 'Nordlicht',
  url: 'https://press.example.org/articles/jfs-2019-0417',
  normalizedUrl: 'https://press.example.org/articles/jfs-2019-0417',
  kind: 'quote',
  title: 'Sediment transport under partial ice cover',
  body: 'Transport rates diverged sharply from open-water predictions.',
  tags: ['eis', 'fluss'],
  urls: [{ url: 'https://press.example.org/articles/jfs-2019-0417/pdf', label: 'PDF' }],
  source: {
    csl_type: 'article',
    title: 'Sediment transport under partial ice cover',
    authors: [{ family: 'Halvorsen', given: 'Ingrid M.' }],
    editors: [],
    container_title: 'Journal of Fluvial Studies',
    publisher: 'Northfield Academic Press',
    place: '',
    year: 2019,
    url: 'https://press.example.org/articles/jfs-2019-0417',
    doi: '10.1234/jfs.2019.0417',
    isbn: '',
    accessed_at: '2026-07-31',
    note: '',
  },
  attachments: {},
  ...overrides,
});

// ---------------------------------------------------------------------------

describe('API-Client', () => {
  /** @type {any} */
  let server;

  before(async () => {
    server = await startMockServer();
  });
  after(async () => server.close());

  it('schickt die vereinbarten Kopfzeilen mit', async () => {
    const { api } = makeClient(server);
    await api.getBooks();
    const call = server.calls('GET /content/books').at(-1);
    assert.equal(call.headers.authorization, 'Bearer swd_gueltig');
    assert.equal(call.headers['x-client-platform'], 'chrome');
    assert.equal(call.headers['x-client-device'], 'Chrome 131 / Linux');
    assert.equal(call.headers['x-client-version'], '0.1.0');
  });

  it('liefert die Buecher inklusive Rollen', async () => {
    const { api } = makeClient(server);
    const books = await api.getBooks();
    assert.equal(books.length, 3);
    assert.deepEqual(
      books.map((b) => b.role),
      ['owner', 'editor', 'viewer'],
    );
  });

  it('meldet 401 NOT_LOGGED_IN und ruft onAuthError — ohne Retry', async () => {
    const { api, events } = makeClient(server, { token: 'swd_falsch' });
    await assert.rejects(
      () => api.getBooks(),
      (error) => {
        assert.equal(error.status, 401);
        assert.equal(error.code, 'NOT_LOGGED_IN');
        return true;
      },
    );
    assert.equal(events.auth, 1);
  });

  it('meldet 403 CAPTURE_SCOPE_REQUIRED und ruft onScopeError', async () => {
    const scoped = await startMockServer({ tokenHasCaptureScope: false });
    try {
      const { api, events } = makeClient(scoped);
      await assert.rejects(
        () => api.createResearchItem({ book_id: 1, title: 'x' }),
        (error) => {
          assert.equal(error.status, 403);
          assert.equal(error.code, 'CAPTURE_SCOPE_REQUIRED');
          return true;
        },
      );
      assert.equal(events.scope, 1);
    } finally {
      await scoped.close();
    }
  });

  it('verweigert Anfragen ohne Server oder Token, bevor es ins Netz geht', async () => {
    const noServer = createApiClient({
      getConfig: () => ({ serverUrl: '', token: 'swd_x' }),
      getClientInfo: () => CLIENT_INFO,
    });
    await assert.rejects(() => noServer.getBooks(), { code: 'NO_SERVER_CONFIGURED' });

    const noToken = createApiClient({
      getConfig: () => ({ serverUrl: server.url, token: '' }),
      getClientInfo: () => CLIENT_INFO,
    });
    await assert.rejects(() => noToken.getBooks(), { code: 'NO_TOKEN_CONFIGURED' });
  });

  it('meldet einen Netzfehler als solchen', async () => {
    const dead = createApiClient({
      getConfig: () => ({ serverUrl: 'http://127.0.0.1:1', token: 'swd_x' }),
      getClientInfo: () => CLIENT_INFO,
    });
    await assert.rejects(
      () => dead.getBooks(),
      (error) => {
        assert.equal(error.networkError, true);
        assert.equal(error.status, 0);
        return true;
      },
    );
  });

  it('schlaegt DOIs nach', async () => {
    const { api } = makeClient(server);
    const result = await api.lookup({ doi: '10.1234/jfs.2019.0417' });
    assert.equal(result.source.container_title, 'Journal of Fluvial Studies');
    assert.equal(server.calls('GET /sources/lookup').at(-1).query.doi, '10.1234/jfs.2019.0417');
  });
});

// ---------------------------------------------------------------------------

describe('Faehigkeits-Erkennung', () => {
  it('erkennt einen Server ohne die neuen Endpunkte', async () => {
    const server = await startMockServer({ hasCapture: false, hasByUrl: false });
    try {
      const { api } = makeClient(server);
      assert.deepEqual(await probeCapabilities(api), { capture: false, byUrl: false });
    } finally {
      await server.close();
    }
  });

  it('erkennt einen Server mit den neuen Endpunkten', async () => {
    const server = await startMockServer({ hasCapture: true, hasByUrl: true });
    try {
      const { api } = makeClient(server);
      // /capture antwortet auf den leeren Probe-Body mit 400 + error_code,
      // /sources/by-url mit 404 + error_code — beides heisst „Route ist da".
      assert.deepEqual(await probeCapabilities(api), { capture: true, byUrl: true });
    } finally {
      await server.close();
    }
  });

  it('legt beim Proben nichts an', async () => {
    const server = await startMockServer({ hasCapture: true, hasByUrl: true });
    try {
      const { api } = makeClient(server);
      await probeCapabilities(api);
      assert.equal(server.state.researchItems.size, 0);
      assert.equal(server.state.sources.size, 0);
    } finally {
      await server.close();
    }
  });

  it('sagt bei einem Auth-Problem „unbekannt" statt „nicht vorhanden"', async () => {
    const server = await startMockServer({ hasCapture: true, hasByUrl: true });
    try {
      const { api } = makeClient(server, { token: 'swd_falsch' });
      assert.deepEqual(await probeCapabilities(api), { capture: null, byUrl: null });
    } finally {
      await server.close();
    }
  });
});

// ---------------------------------------------------------------------------

describe('Erfassung: Fallback-Pfad (ohne /capture)', () => {
  /** @type {any} */
  let server;
  const caps = { capture: false, byUrl: false };

  before(async () => {
    server = await startMockServer({ hasCapture: false, hasByUrl: false });
  });
  after(async () => server.close());

  it('mode=research schickt genau einen POST /research mit der URL in `source`', async () => {
    const { api } = makeClient(server);
    const job = makeJob(baseIntent({ mode: 'research' }));
    await runCaptureJob(job, { api, capabilities: caps });

    const call = server.calls('POST /research').at(-1);
    assert.equal(call.body.book_id, 1);
    assert.equal(call.body.kind, 'quote');
    assert.equal(call.body.source, 'https://press.example.org/articles/jfs-2019-0417');
    assert.deepEqual(call.body.tags, ['eis', 'fluss']);
    assert.deepEqual(call.body.urls, [
      { url: 'https://press.example.org/articles/jfs-2019-0417/pdf', label: 'PDF' },
    ]);
    assert.ok(job.progress.researchItemId);
    assert.equal(job.progress.sourceId, null);
    assert.equal(job.progress.via, 'split');
  });

  it('mode=source geht den Zwei-Request-Pfad: POST /sources, dann /link', async () => {
    const { api } = makeClient(server);
    const job = makeJob(baseIntent({ mode: 'source' }), 'job_source');
    await runCaptureJob(job, { api, capabilities: caps });

    const create = server.calls('POST /sources').at(-1);
    assert.equal(create.body.csl_type, 'article');
    assert.equal(create.body.doi, '10.1234/jfs.2019.0417');
    // book_id gehoert laut Vertrag in den eigenen /link-Request.
    assert.equal(create.body.book_id, undefined);

    const link = server.calls(`POST /sources/${job.progress.sourceId}/link`).at(-1);
    assert.equal(link.body.book_id, 1);
    assert.deepEqual(job.progress.linkedBookIds, [1]);
  });

  it('mode=both legt beides an', async () => {
    const { api } = makeClient(server);
    const before = server.calls('POST /research').length;
    const job = makeJob(baseIntent({ mode: 'both' }), 'job_both');
    await runCaptureJob(job, { api, capabilities: caps });

    assert.equal(server.calls('POST /research').length, before + 1);
    assert.ok(job.progress.researchItemId);
    assert.ok(job.progress.sourceId);
  });

  it('bei CITEKEY_TAKEN wird ohne citekey erneut gesendet', async () => {
    const { api } = makeClient(server);
    const intent = baseIntent({ mode: 'source' });
    intent.source = { ...intent.source, citekey: 'muster2019', url: 'https://example.org/anders' };
    const job = makeJob(intent, 'job_citekey');

    const before = server.calls('POST /sources').length;
    await runCaptureJob(job, { api, capabilities: caps });
    const calls = server.calls('POST /sources').slice(before);

    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.citekey, 'muster2019');
    assert.equal('citekey' in calls[1].body, false);
    assert.ok(job.progress.sourceId);
  });

  it('lehnt eine Quelle ohne Titel und ohne Person clientseitig ab', async () => {
    const { api } = makeClient(server);
    const intent = baseIntent({ mode: 'source' });
    intent.source = { ...intent.source, title: '', authors: [], editors: [] };
    const job = makeJob(intent, 'job_leer');

    const before = server.calls('POST /sources').length;
    await assert.rejects(
      () => runCaptureJob(job, { api, capabilities: caps }),
      (error) => {
        assert.equal(error.code, 'CLIENT_VALIDATION_FAILED');
        assert.equal(error.status, 400);
        assert.equal(error.params.rule, 'validation_source_identity');
        return true;
      },
    );
    // Nicht gesendet — der 400 wird gar nicht erst provoziert.
    assert.equal(server.calls('POST /sources').length, before);
  });

  it('lehnt ein zu langes Zitat clientseitig ab', async () => {
    const { api } = makeClient(server);
    const job = makeJob(baseIntent({ mode: 'research', body: 'x'.repeat(20001) }), 'job_lang');

    const before = server.calls('POST /research').length;
    await assert.rejects(() => runCaptureJob(job, { api, capabilities: caps }), {
      code: 'CLIENT_VALIDATION_FAILED',
    });
    assert.equal(server.calls('POST /research').length, before);
  });

  it('reicht BOOK_ACCESS_DENIED unveraendert durch', async () => {
    const { api } = makeClient(server);
    const job = makeJob(baseIntent({ mode: 'research', bookId: 3 }), 'job_viewer');
    await assert.rejects(() => runCaptureJob(job, { api, capabilities: caps }), {
      code: 'BOOK_ACCESS_DENIED',
      status: 403,
    });
  });

  it('haengt Screenshot und PDF an', async () => {
    const { api } = makeClient(server);
    const intent = baseIntent({ mode: 'both' });
    intent.source = { ...intent.source, url: 'https://example.org/mit-anhang' };
    intent.attachments = {
      screenshot: { bytes: toBase64(new Uint8Array([1, 2, 3, 4])), contentType: 'image/jpeg' },
      pdf: { bytes: toBase64(new Uint8Array(new Array(64).fill(7))) },
    };
    const job = makeJob(intent, 'job_anhang');
    await runCaptureJob(job, { api, capabilities: caps });

    const image = server.state.attachments.find((a) => a.kind === 'image');
    assert.equal(image.bytes, 4);
    assert.equal(image.contentType, 'image/jpeg');

    // Bei vorhandener Quelle geht das PDF an /sources/:id/pdf.
    const pdf = server.state.attachments.find((a) => a.kind === 'pdf');
    assert.equal(pdf.bytes, 64);
    assert.equal(pdf.id, job.progress.sourceId);
    assert.equal(job.progress.imageUploaded, true);
    assert.equal(job.progress.pdfUploaded, true);
  });
});

// ---------------------------------------------------------------------------

describe('Erfassung: /capture-Pfad', () => {
  it('nutzt einen einzigen Request, wenn der Endpunkt da ist', async () => {
    const server = await startMockServer({ hasCapture: true, hasByUrl: true });
    try {
      const { api } = makeClient(server);
      const job = makeJob(baseIntent({ mode: 'both' }));
      await runCaptureJob(job, { api, capabilities: { capture: true, byUrl: true } });

      assert.equal(server.calls('POST /capture').length, 1);
      assert.equal(server.calls('POST /research').length, 0);
      assert.equal(server.calls('POST /sources').length, 0);
      assert.equal(job.progress.via, 'capture');
      assert.ok(job.progress.researchItemId);
      assert.ok(job.progress.sourceId);
      assert.deepEqual(job.progress.linkedBookIds, [1]);
    } finally {
      await server.close();
    }
  });

  it('faellt auf den langen Weg zurueck, wenn der Endpunkt doch fehlt', async () => {
    const server = await startMockServer({ hasCapture: false, hasByUrl: false });
    try {
      const { api } = makeClient(server);
      const missing = [];
      const job = makeJob(baseIntent({ mode: 'both' }));

      // Die Faehigkeit ist faelschlich als vorhanden gemeldet.
      await runCaptureJob(job, {
        api,
        capabilities: { capture: true, byUrl: false },
        onCapabilityMissing: (name) => missing.push(name),
      });

      assert.deepEqual(missing, ['capture']);
      assert.equal(server.calls('POST /research').length, 1);
      assert.equal(server.calls('POST /sources').length, 1);
      assert.ok(job.progress.researchItemId);
      assert.ok(job.progress.sourceId);
    } finally {
      await server.close();
    }
  });
});

// ---------------------------------------------------------------------------

describe('Doppelklick-Schutz ueber /sources/by-url', () => {
  it('verwendet eine vorhandene Quelle wieder, statt sie doppelt anzulegen', async () => {
    const server = await startMockServer({ hasByUrl: true });
    try {
      const { api } = makeClient(server);
      const caps = { capture: false, byUrl: true };

      const first = makeJob(baseIntent({ mode: 'source' }), 'job_a');
      await runCaptureJob(first, { api, capabilities: caps });

      const before = server.calls('POST /sources').length;
      const second = makeJob(baseIntent({ mode: 'source', bookId: 2 }), 'job_b');
      await runCaptureJob(second, { api, capabilities: caps });

      // Keine zweite Quelle, aber eine Verknuepfung zum anderen Buch.
      assert.equal(server.calls('POST /sources').length, before);
      assert.equal(second.progress.sourceId, first.progress.sourceId);
      assert.deepEqual(second.progress.linkedBookIds, [2]);
      assert.deepEqual([...server.state.links.get(first.progress.sourceId)], [1, 2]);
    } finally {
      await server.close();
    }
  });

  it('ein 404 heisst schlicht „noch nicht da"', async () => {
    const server = await startMockServer({ hasByUrl: true });
    try {
      const { api } = makeClient(server);
      const job = makeJob(baseIntent({ mode: 'source' }));
      await runCaptureJob(job, { api, capabilities: { capture: false, byUrl: true } });
      assert.equal(server.calls('POST /sources').length, 1);
      assert.ok(job.progress.sourceId);
    } finally {
      await server.close();
    }
  });
});

// ---------------------------------------------------------------------------

describe('Warteschlange gegen den Mock-Server', () => {
  it('wiederholt nach 503 und legt dabei nichts doppelt an', async () => {
    const server = await startMockServer();
    try {
      const { api } = makeClient(server);
      let now = 0;
      let jobs = [];
      const queue = createQueue({
        load: async () => JSON.parse(JSON.stringify(jobs)),
        save: async (next) => {
          jobs = JSON.parse(JSON.stringify(next));
        },
        now: () => now,
        random: () => 0,
      });

      const job = await queue.add(baseIntent({ mode: 'both' }));

      // Erster Anlauf: der Server laesst genau die Quellen-Anlage scheitern,
      // nachdem das Recherche-Item schon steht.
      const stored = (await queue.list())[0];
      server.failNext(1, 503);
      // POST /research geht durch? Nein — failNext trifft den ersten Schreibzugriff.
      await assert.rejects(() =>
        runCaptureJob(stored, { api, capabilities: { capture: false, byUrl: false } }),
      );
      const result = await queue.fail(stored.id, { status: 503 }, stored.progress);
      assert.equal(result.willRetry, true);

      // Zweiter Anlauf: geht durch.
      now += 60_000;
      const due = await queue.due();
      assert.equal(due.length, 1);
      await runCaptureJob(due[0], { api, capabilities: { capture: false, byUrl: false } });
      await queue.complete(due[0].id);

      assert.equal((await queue.list()).length, 0);
      assert.equal(server.state.researchItems.size, 1);
      assert.equal(server.state.sources.size, 1);
    } finally {
      await server.close();
    }
  });

  it('ein Retry nach halbem Erfolg legt das Recherche-Item nicht erneut an', async () => {
    const server = await startMockServer();
    try {
      const { api } = makeClient(server);
      const caps = { capture: false, byUrl: false };
      const job = makeJob(baseIntent({ mode: 'both' }), 'job_halb');

      // Erst nur die Recherche-Haelfte laufen lassen …
      const researchOnly = { ...job, intent: { ...job.intent, mode: 'research' } };
      await runCaptureJob(researchOnly, { api, capabilities: caps });
      const researchId = researchOnly.progress.researchItemId;

      // … dann mit demselben Fortschritt als mode=both wiederholen.
      job.progress = researchOnly.progress;
      const before = server.calls('POST /research').length;
      await runCaptureJob(job, { api, capabilities: caps });

      assert.equal(server.calls('POST /research').length, before, 'kein zweites Recherche-Item');
      assert.equal(job.progress.researchItemId, researchId);
      assert.ok(job.progress.sourceId);
    } finally {
      await server.close();
    }
  });
});

// ---------------------------------------------------------------------------

describe('Hilfsfunktionen', () => {
  it('base64 hin und zurueck', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    const roundTrip = toBinary(toBase64(bytes));
    assert.deepEqual([...roundTrip], [...bytes]);
  });

  it('describeDevice liest userAgentData', () => {
    const value = describeDevice({
      userAgentData: {
        brands: [
          { brand: 'Not A(Brand', version: '99' },
          { brand: 'Google Chrome', version: '131' },
        ],
        platform: 'Linux',
      },
    });
    assert.equal(value, 'Google Chrome 131 / Linux');
  });

  it('describeDevice faellt auf den User-Agent zurueck', () => {
    const value = describeDevice({
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    assert.equal(value, 'Chrome 131 / X11');
  });
});
