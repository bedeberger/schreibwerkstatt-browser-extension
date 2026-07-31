/**
 * Mock-Server, der den dokumentierten API-Vertrag nachbaut.
 *
 * Kein echter Server, keine Netzabhaengigkeit — nur `node:http` auf
 * einem freien Port. Fehlerantworten haben die vertragsgemaesse Form
 * `{ error_code, params? }`; eine unbekannte Route antwortet mit HTML,
 * genau wie Express es tut. Daran haengt die Faehigkeits-Erkennung.
 */

import { createServer } from 'node:http';

/**
 * @typedef {object} MockOptions
 * @property {boolean} [hasCapture] `POST /capture` ausgerollt?
 * @property {boolean} [hasByUrl] `GET /sources/by-url` ausgerollt?
 * @property {string} [token] gueltiges Token
 * @property {boolean} [tokenHasCaptureScope]
 * @property {Set<string>} [takenCitekeys]
 */

/**
 * @param {MockOptions} [options]
 */
export async function startMockServer(options = {}) {
  const config = {
    hasCapture: false,
    hasByUrl: false,
    token: 'swd_gueltig',
    tokenHasCaptureScope: true,
    takenCitekeys: new Set(['muster2019']),
    ...options,
  };

  /** Alles, was der Server gesehen hat — die Tests pruefen daran den Ablauf. */
  const log = [];
  const state = {
    researchItems: new Map(),
    sources: new Map(),
    links: new Map(), // sourceId -> Set(bookId)
    sourcesByUrl: new Map(), // normalisierte URL -> sourceId
    attachments: [],
    nextId: 1,
    /** Anzahl der Ausfaelle, die der Server noch simuliert. */
    failuresLeft: 0,
    failureStatus: 503,
  };

  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      try {
        handle(req, res, body);
      } catch (error) {
        send(res, 500, { error_code: 'SERVER_ERROR', params: { message: String(error) } });
      }
    });
  });

  /**
   * @param {import('node:http').ServerResponse} res
   * @param {number} status
   * @param {any} payload
   */
  function send(res, status, payload) {
    const text = JSON.stringify(payload);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(text);
  }

  /**
   * Unbekannte Route: HTML, kein JSON. Das ist das Unterscheidungsmerkmal,
   * an dem die Erweiterung „Endpunkt fehlt" erkennt.
   */
  function sendNotARoute(res) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!DOCTYPE html>\n<html><head><title>Error</title></head><body><pre>Cannot POST /capture</pre></body></html>\n');
  }

  function handle(req, res, rawBody) {
    const url = new URL(req.url, 'http://localhost');
    const route = `${req.method} ${url.pathname}`;

    log.push({
      route,
      query: Object.fromEntries(url.searchParams),
      headers: req.headers,
      body: parseJson(rawBody, req.headers['content-type']),
      rawLength: rawBody.length,
    });

    // ---------------------------------------------------------- Kopfzeilen
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) {
      return send(res, 401, { error_code: 'NOT_LOGGED_IN' });
    }
    if (auth.slice(7) !== config.token) {
      return send(res, 401, { error_code: 'NOT_LOGGED_IN' });
    }
    if (!config.tokenHasCaptureScope && req.method !== 'GET') {
      return send(res, 403, { error_code: 'CAPTURE_SCOPE_REQUIRED' });
    }

    // Simulierte Ausfaelle, damit die Retry-Logik pruefbar ist.
    if (state.failuresLeft > 0 && req.method !== 'GET') {
      state.failuresLeft -= 1;
      return send(res, state.failureStatus, { error_code: 'SERVER_ERROR' });
    }

    // ------------------------------------------------------------- Routen
    if (route === 'GET /content/books') {
      return send(res, 200, [
        { id: 1, name: 'Nordlicht', role: 'owner', owner_email: 'ich@example.org', buchtyp: 'roman' },
        { id: 2, name: 'Mitschrift', role: 'editor', owner_email: 'wir@example.org', buchtyp: 'sachbuch' },
        { id: 3, name: 'Fremdes Buch', role: 'viewer', owner_email: 'du@example.org', buchtyp: 'roman' },
      ]);
    }

    if (route === 'POST /research') {
      const payload = parseJson(rawBody, req.headers['content-type']) || {};
      if (!payload.book_id) return send(res, 400, { error_code: 'VALIDATION_FAILED', params: { field: 'book_id' } });
      if (payload.book_id === 3) return send(res, 403, { error_code: 'BOOK_ACCESS_DENIED' });
      if ((payload.title || '').length > 300) {
        return send(res, 400, { error_code: 'VALIDATION_FAILED', params: { field: 'title' } });
      }
      if ((payload.body || '').length > 20000) {
        return send(res, 400, { error_code: 'VALIDATION_FAILED', params: { field: 'body' } });
      }
      if (!payload.title && !payload.body && !payload.source) {
        return send(res, 400, { error_code: 'VALIDATION_FAILED', params: { field: 'title' } });
      }
      const id = state.nextId++;
      state.researchItems.set(id, payload);
      return send(res, 201, { id, ...payload });
    }

    let match = url.pathname.match(/^\/research\/(\d+)\/(image|doc)$/);
    if (match && req.method === 'POST') {
      const id = Number(match[1]);
      if (!state.researchItems.has(id)) return send(res, 404, { error_code: 'NOT_FOUND' });
      const max = match[2] === 'image' ? 12 * 1024 * 1024 : 25 * 1024 * 1024;
      if (rawBody.length > max) return send(res, 413, { error_code: 'PAYLOAD_TOO_LARGE' });
      state.attachments.push({ kind: match[2], id, bytes: rawBody.length, contentType: req.headers['content-type'] });
      return send(res, 201, { ok: true });
    }

    if (route === 'POST /sources') {
      const payload = parseJson(rawBody, req.headers['content-type']) || {};
      const anyPerson = [...(payload.authors || []), ...(payload.editors || [])].some(
        (p) => p && (p.family || p.given || p.literal),
      );
      if (!payload.title && !anyPerson) return send(res, 400, { error_code: 'SOURCE_IDENTITY_REQ' });
      if (payload.url && !/^https?:\/\//.test(payload.url)) {
        return send(res, 400, { error_code: 'VALIDATION_FAILED', params: { field: 'url' } });
      }
      if (payload.citekey && config.takenCitekeys.has(payload.citekey)) {
        return send(res, 409, { error_code: 'CITEKEY_TAKEN', params: { citekey: payload.citekey } });
      }
      const id = state.nextId++;
      const citekey = payload.citekey || `auto${id}`;
      config.takenCitekeys.add(citekey);
      state.sources.set(id, { ...payload, citekey });
      state.links.set(id, new Set(payload.book_id ? [payload.book_id] : []));
      if (payload.url) state.sourcesByUrl.set(payload.url, id);
      return send(res, 201, { id, ...payload, citekey });
    }

    match = url.pathname.match(/^\/sources\/(\d+)\/link$/);
    if (match && req.method === 'POST') {
      const id = Number(match[1]);
      if (!state.sources.has(id)) return send(res, 404, { error_code: 'NOT_FOUND' });
      const payload = parseJson(rawBody, req.headers['content-type']) || {};
      if (!payload.book_id) return send(res, 400, { error_code: 'VALIDATION_FAILED', params: { field: 'book_id' } });
      state.links.get(id).add(payload.book_id);
      return send(res, 200, { ok: true });
    }

    match = url.pathname.match(/^\/sources\/(\d+)\/pdf$/);
    if (match && req.method === 'POST') {
      const id = Number(match[1]);
      if (!state.sources.has(id)) return send(res, 404, { error_code: 'NOT_FOUND' });
      if (rawBody.length > 25 * 1024 * 1024) return send(res, 413, { error_code: 'PAYLOAD_TOO_LARGE' });
      if (req.headers['content-type'] !== 'application/pdf') {
        return send(res, 415, { error_code: 'UNSUPPORTED_MEDIA_TYPE' });
      }
      state.attachments.push({ kind: 'pdf', id, bytes: rawBody.length });
      return send(res, 201, { ok: true });
    }

    if (route === 'GET /sources/lookup') {
      const doi = url.searchParams.get('doi');
      const isbn = url.searchParams.get('isbn');
      if (!doi && !isbn) return send(res, 400, { error_code: 'VALIDATION_FAILED', params: { field: 'doi' } });
      if (doi === '10.0000/unbekannt') return send(res, 404, { error_code: 'NOT_FOUND' });
      return send(res, 200, {
        source: {
          csl_type: 'article',
          title: 'Sediment transport under partial ice cover',
          authors: [
            { family: 'Halvorsen', given: 'Ingrid M.' },
            { family: 'Okonkwo', given: 'Chidi' },
            { family: 'van der Meer', given: 'Jan' },
          ],
          container_title: 'Journal of Fluvial Studies',
          publisher: 'Northfield Academic Press',
          year: 2019,
          doi: doi || '',
          isbn: isbn || '',
        },
      });
    }

    if (route === 'GET /sources/by-url') {
      if (!config.hasByUrl) return sendNotARoute(res);
      const wanted = url.searchParams.get('url') || '';
      const bookId = url.searchParams.get('book_id');
      const id = state.sourcesByUrl.get(wanted);
      if (!id) return send(res, 404, { error_code: 'SOURCE_NOT_FOUND' });
      return send(res, 200, {
        source: { id, ...state.sources.get(id) },
        linked_to_book: bookId ? state.links.get(id).has(Number(bookId)) : false,
      });
    }

    if (route === 'POST /capture') {
      if (!config.hasCapture) return sendNotARoute(res);
      const payload = parseJson(rawBody, req.headers['content-type']) || {};
      if (!payload.book_id || !payload.mode || !payload.url) {
        return send(res, 400, { error_code: 'VALIDATION_FAILED', params: { field: 'book_id' } });
      }

      // Idempotent ueber die normalisierte URL.
      const existingSourceId = state.sourcesByUrl.get(payload.url);
      if (existingSourceId) {
        return send(res, 200, {
          created: false,
          source: { id: existingSourceId, ...state.sources.get(existingSourceId) },
        });
      }

      /** @type {any} */
      const result = { created: true };
      if (payload.mode === 'research' || payload.mode === 'both') {
        const id = state.nextId++;
        state.researchItems.set(id, payload);
        result.research_item = { id };
      }
      if (payload.mode === 'source' || payload.mode === 'both') {
        const id = state.nextId++;
        state.sources.set(id, payload);
        state.links.set(id, new Set([payload.book_id]));
        state.sourcesByUrl.set(payload.url, id);
        result.source = { id };
      }
      return send(res, 201, result);
    }

    return sendNotARoute(res);
  }

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = /** @type {any} */ (server.address());

  return {
    url: `http://127.0.0.1:${port}`,
    config,
    state,
    log,
    /** @param {string} route */
    calls: (route) => log.filter((entry) => entry.route === route),
    routes: () => log.map((entry) => entry.route),
    /**
     * Laesst die naechsten n schreibenden Anfragen scheitern.
     * @param {number} count
     * @param {number} [status]
     */
    failNext(count, status = 503) {
      state.failuresLeft = count;
      state.failureStatus = status;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function parseJson(buffer, contentType) {
  if (!buffer || !buffer.length) return null;
  if (contentType && !contentType.includes('json')) return null;
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    return null;
  }
}
