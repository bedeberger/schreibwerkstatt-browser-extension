/**
 * REST-Client fuer die Schreibwerkstatt-API.
 *
 * Laeuft ausschliesslich im Service Worker. Mit `host_permissions` auf den
 * App-Host ist der Worker CORS-befreit; derselbe Aufruf aus einem
 * Content-Script wuerde scheitern.
 *
 * Alle Abhaengigkeiten sind injizierbar, damit der Client im Test gegen
 * einen Mock-Server laeuft, ohne dass `chrome` existieren muss.
 */

import { ApiError } from '../shared/errors.js';

/** Zeitlimit je Anfrage. Uploads bekommen mehr. */
const DEFAULT_TIMEOUT_MS = 20000;
const UPLOAD_TIMEOUT_MS = 120000;

/**
 * @typedef {object} ClientConfig
 * @property {string} serverUrl Basis ohne abschliessenden Slash
 * @property {string} token Geraete-Token (`swd_…`)
 */

/**
 * @typedef {object} ClientInfo
 * @property {string} platform Wert fuer `X-Client-Platform`
 * @property {string} device Wert fuer `X-Client-Device`
 * @property {string} version Wert fuer `X-Client-Version`
 */

/**
 * @param {object} deps
 * @param {() => Promise<ClientConfig>|ClientConfig} deps.getConfig
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {() => Promise<ClientInfo>|ClientInfo} deps.getClientInfo
 * @param {(error: ApiError) => void} [deps.onAuthError] wird bei 401 gerufen
 * @param {(error: ApiError) => void} [deps.onScopeError] wird bei CAPTURE_SCOPE_REQUIRED gerufen
 */
export function createApiClient({ getConfig, fetchImpl, getClientInfo, onAuthError, onScopeError }) {
  const doFetch = fetchImpl || globalThis.fetch.bind(globalThis);

  /**
   * @param {string} path
   * @param {object} [options]
   * @param {string} [options.method]
   * @param {any} [options.json] JSON-Body
   * @param {BodyInit} [options.body] Rohbody
   * @param {string} [options.contentType] noetig bei Rohbody
   * @param {Record<string, any>} [options.query]
   * @param {number} [options.timeoutMs]
   * @returns {Promise<any>}
   */
  async function request(path, options = {}) {
    const config = await getConfig();
    const info = await getClientInfo();

    if (!config || !config.serverUrl) {
      throw new ApiError({ code: 'NO_SERVER_CONFIGURED', message: 'server url missing' });
    }
    if (!config.token) {
      throw new ApiError({ code: 'NO_TOKEN_CONFIGURED', message: 'device token missing' });
    }

    const url = new URL(`${config.serverUrl}${path.startsWith('/') ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(options.query || {})) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }

    /** @type {Record<string, string>} */
    const headers = {
      Authorization: `Bearer ${config.token}`,
      'X-Client-Platform': info.platform,
      'X-Client-Device': info.device,
      'X-Client-Version': info.version,
      Accept: 'application/json',
    };

    /** @type {BodyInit|undefined} */
    let body;
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    } else if (options.body !== undefined) {
      if (options.contentType) headers['Content-Type'] = options.contentType;
      body = options.body;
    }

    const timeoutMs = options.timeoutMs || (options.body !== undefined ? UPLOAD_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await doFetch(url.toString(), {
        method: options.method || (body !== undefined ? 'POST' : 'GET'),
        headers,
        body,
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'follow',
      });
    } catch (cause) {
      clearTimeout(timer);
      const aborted = cause && /** @type {any} */ (cause).name === 'AbortError';
      throw new ApiError({
        status: 0,
        code: aborted ? 'TIMEOUT' : '',
        networkError: true,
        message: aborted ? `timeout after ${timeoutMs} ms` : String(/** @type {any} */ (cause)?.message || cause),
        cause,
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text().catch(() => '');
    /** @type {any} */
    let parsed = null;
    let jsonBody = false;
    if (text) {
      try {
        parsed = JSON.parse(text);
        jsonBody = true;
      } catch {
        jsonBody = false;
      }
    }

    if (!response.ok) {
      const error = new ApiError({
        status: response.status,
        code: (jsonBody && parsed && typeof parsed.error_code === 'string' ? parsed.error_code : '') || '',
        params: (jsonBody && parsed && parsed.params) || {},
        message: text.slice(0, 500) || `HTTP ${response.status}`,
      });
      // Fuer die Faehigkeits-Erkennung: ein Express-404 fuer eine unbekannte
      // Route ist HTML, ein fachliches 404 ist JSON mit `error_code`.
      error.jsonBody = jsonBody;
      error.bodyText = text.slice(0, 500);

      if (error.status === 401 && onAuthError) onAuthError(error);
      if (error.code === 'CAPTURE_SCOPE_REQUIRED' && onScopeError) onScopeError(error);

      throw error;
    }

    return jsonBody ? parsed : text;
  }

  return {
    request,

    /** @returns {Promise<Array<Record<string, any>>>} */
    async getBooks() {
      const data = await request('/content/books');
      return Array.isArray(data) ? data : [];
    },

    /**
     * @param {Record<string, any>} payload
     * @returns {Promise<Record<string, any>>}
     */
    createResearchItem(payload) {
      return request('/research', { method: 'POST', json: payload });
    },

    /**
     * @param {number|string} id
     * @param {Blob|ArrayBuffer|Uint8Array} data
     * @param {string} contentType z. B. "image/jpeg"
     */
    uploadResearchImage(id, data, contentType) {
      return request(`/research/${encodeURIComponent(String(id))}/image`, {
        method: 'POST',
        body: /** @type {any} */ (data),
        contentType,
      });
    },

    /**
     * @param {number|string} id
     * @param {Blob|ArrayBuffer|Uint8Array} data
     */
    uploadResearchDoc(id, data) {
      return request(`/research/${encodeURIComponent(String(id))}/doc`, {
        method: 'POST',
        body: /** @type {any} */ (data),
        contentType: 'application/pdf',
      });
    },

    /**
     * @param {Record<string, any>} payload
     * @returns {Promise<Record<string, any>>}
     */
    createSource(payload) {
      return request('/sources', { method: 'POST', json: payload });
    },

    /**
     * @param {number|string} id
     * @param {number|string} bookId
     */
    linkSource(id, bookId) {
      return request(`/sources/${encodeURIComponent(String(id))}/link`, {
        method: 'POST',
        json: { book_id: bookId },
      });
    },

    /**
     * @param {number|string} id
     * @param {Blob|ArrayBuffer|Uint8Array} data
     */
    uploadSourcePdf(id, data) {
      return request(`/sources/${encodeURIComponent(String(id))}/pdf`, {
        method: 'POST',
        body: /** @type {any} */ (data),
        contentType: 'application/pdf',
      });
    },

    /**
     * Kanonische Metadaten aus Crossref/OpenLibrary.
     * @param {{doi?: string, isbn?: string}} query
     */
    lookup(query) {
      return request('/sources/lookup', { query });
    },

    /**
     * Noch nicht ueberall deployed — Aufrufer prueft die Faehigkeit vorher.
     * @param {string} url
     * @param {number|string|null} [bookId]
     * @returns {Promise<{source: Record<string, any>, linked_to_book: boolean}>}
     */
    findSourceByUrl(url, bookId) {
      return request('/sources/by-url', { query: { url, book_id: bookId ?? '' } });
    },

    /**
     * Noch nicht ueberall deployed — transaktional und idempotent.
     * @param {Record<string, any>} payload
     * @returns {Promise<{created: boolean, research_item?: Record<string, any>, source?: Record<string, any>}>}
     */
    capture(payload) {
      return request('/capture', { method: 'POST', json: payload });
    },
  };
}

/**
 * Baut den Wert fuer `X-Client-Device` aus `navigator.userAgentData`,
 * mit Rueckfall auf den klassischen User-Agent.
 *
 * @param {Navigator|WorkerNavigator} [nav]
 * @returns {string} z. B. "Chrome 131 / Linux"
 */
export function describeDevice(nav = globalThis.navigator) {
  if (!nav) return 'unknown';

  const uaData = /** @type {any} */ (nav).userAgentData;
  if (uaData) {
    const brands = Array.isArray(uaData.brands) ? uaData.brands : [];
    // "Not A(Brand" ist ein absichtlicher Stoerwert und wird aussortiert.
    const brand =
      brands.find((b) => /chrome/i.test(b.brand) && !/not.*brand/i.test(b.brand)) ||
      brands.find((b) => !/not.*brand/i.test(b.brand));
    const name = brand ? `${brand.brand} ${brand.version}` : 'Chromium';
    const platform = uaData.platform || 'unknown';
    return `${name} / ${platform}`.slice(0, 120);
  }

  const ua = nav.userAgent || '';
  const browser = ua.match(/(Chrome|Chromium|Edg|Firefox)\/(\d+)/);
  const platform = ua.match(/\(([^)]+)\)/);
  const name = browser ? `${browser[1]} ${browser[2]}` : 'unknown';
  const os = platform ? platform[1].split(';')[0].trim() : 'unknown';
  return `${name} / ${os}`.slice(0, 120);
}
