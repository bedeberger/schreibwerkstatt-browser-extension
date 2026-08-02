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

import { ApiError, isScopeError } from '../shared/errors.js';
import { clampAttachmentName, clampResearchLimit } from '../shared/limits.js';

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
 * @property {string} version NACKTE Erweiterungsversion (`1.1.1`). Das
 *   Plattform-Praefix setzt `clientVersion()` — siehe dort, warum es keine
 *   Kosmetik ist.
 */

/**
 * Wert fuer `X-Client-Version`: `<plattform>/<version>`, z. B. `chrome/1.1.1`.
 *
 * Der Server erkennt die Plattform eines Geraete-Tokens ausschliesslich an
 * diesem Praefix (`_devicesIsChrome` prueft `/chrome/i` auf `client_version`
 * bzw. `platform`). `device_tokens.platform` ist bei Tokens der Erweiterung
 * NULL — die Mint-Oberflaeche schickt keine Plattform, und `X-Client-Platform`
 * wird nicht persistiert. Eine nackte Version wie `1.1.1` landet deshalb im
 * Versionsstrang der macOS-App und erzeugt dort ein falsches „veraltet".
 *
 * Deshalb steht der Zusammenbau hier und nicht beim Aufrufer: wer
 * `getClientInfo` implementiert, kann das Praefix nicht vergessen.
 *
 * @param {string} platform
 * @param {string} version
 */
export function clientVersion(platform, version) {
  return `${platform}/${version}`;
}

/**
 * @param {object} deps
 * @param {() => Promise<ClientConfig>|ClientConfig} deps.getConfig
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {() => Promise<ClientInfo>|ClientInfo} deps.getClientInfo
 * @param {(error: ApiError) => void} [deps.onAuthError] wird bei 401 gerufen
 * @param {(error: ApiError) => void} [deps.onScopeError] wird bei
 *   `403 DEVICE_SCOPE_FORBIDDEN` gerufen
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
   * @param {boolean} [options.notifyScopeError] `false` haelt `onScopeError`
   *   zurueck. Noetig fuer Pfade, die einen ANDEREN Scope brauchen als das
   *   Erfassen: dass `content:read` fehlt, heisst nicht, dass das Token zum
   *   Schreiben untauglich ist — der globale Token-Zustand darf davon nicht
   *   auf „Scope fehlt" springen.
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
      'X-Client-Version': clientVersion(info.platform, info.version),
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

    // NIE `response.json()`: zwei echte Fehlerantworten sind HTML, nicht JSON.
    // Der Server hat keinen globalen Express-Fehler-Handler, also antwortet der
    // Body-Parser mit Express' Default — `413` bei zu grossem Koerper, `400` bei
    // kaputtem JSON, beides als HTML-Seite ohne `error_code`. Ein Parserfehler
    // hier wuerde den Auftrag aus einem Grund scheitern lassen, der nichts mit
    // dem Auftrag zu tun hat.
    const text = await response.text().catch(() => '');
    /** @type {any} */
    let parsed = null;
    let jsonBody = false;
    if (text) {
      try {
        parsed = JSON.parse(text);
        // `null`, `12` und `"text"` sind gueltiges JSON, aber keine Antwort im
        // Sinne des Vertrags — sonst wuerde `parsed.error_code` unten werfen.
        jsonBody = parsed !== null && typeof parsed === 'object';
      } catch {
        jsonBody = false;
      }
    }

    if (!response.ok) {
      // Der Server benennt die Zusatzangaben je nach Route `params` oder
      // `detail` (so bei `INSUFFICIENT_ROLE`: `{ actual, required }`).
      // Beides landet hier im selben Feld, `params` gewinnt bei Namensgleichheit.
      const detail = jsonBody && parsed.detail && typeof parsed.detail === 'object' ? parsed.detail : null;
      const error = new ApiError({
        status: response.status,
        code: (jsonBody && typeof parsed.error_code === 'string' ? parsed.error_code : '') || '',
        params: { ...(detail || {}), ...((jsonBody && parsed.params) || {}) },
        // Ohne `error_code` traegt der Koerper HTML. Der gehoert nicht in eine
        // Meldung — `describeError` waehlt dann ueber den HTTP-Status.
        message: (jsonBody ? text.slice(0, 500) : '') || `HTTP ${response.status}`,
      });
      // Fuer die Faehigkeits-Erkennung: ein Express-404 fuer eine unbekannte
      // Route ist HTML, ein fachliches 404 ist JSON mit `error_code`.
      error.jsonBody = jsonBody;
      error.bodyText = text.slice(0, 500);
      // Welcher Scope fehlt, sagt der Fehlercode nicht — der Pfad schon.
      error.path = url.pathname;

      if (error.status === 401 && onAuthError) onAuthError(error);
      if (options.notifyScopeError !== false && isScopeError(error) && onScopeError) {
        onScopeError(error);
      }

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
     * Recherche-Eintraege eines Buchs lesen.
     *
     * Reiner Lesepfad, ohne Nebenwirkung. Braucht `content:read` — bereits
     * ausgestellte `capture`-Token tragen den Scope; ein Server, der ihn nicht
     * sieht, antwortet `403 DEVICE_SCOPE_FORBIDDEN`. Das ist ein Befund ueber
     * das Token, keine Stoerung, und markiert deshalb NICHT den globalen
     * Token-Zustand (`notifyScopeError: false`).
     *
     * `limit` geht nie ueber 200 hinaus; der Server wuerde mehr ohnehin
     * kappen, aber dann wuesste der Aufrufer nicht, wonach er gefragt hat.
     * Zu `q` gehoert der 500er-Vorfilter — siehe `RESEARCH_LIST` in
     * `shared/limits.js`.
     *
     * @param {object} params
     * @param {number|string} params.bookId PFLICHT
     * @param {string} [params.q] FTS5-Syntax
     * @param {string} [params.kind]
     * @param {string} [params.tag]
     * @param {string} [params.linked] "<kind>:<id>"
     * @param {string} [params.sort]
     * @param {boolean} [params.archived] auch archivierte mitliefern
     * @param {number} [params.limit]
     * @returns {Promise<Array<Record<string, any>>>}
     */
    async listResearch(params = /** @type {any} */ ({})) {
      const limit = clampResearchLimit(params.limit);
      const data = await request('/research', {
        notifyScopeError: false,
        query: {
          book_id: params.bookId,
          q: params.q,
          kind: params.kind,
          tag: params.tag,
          linked: params.linked,
          sort: params.sort,
          archived: params.archived ? '1' : undefined,
          limit: limit === null ? undefined : limit,
        },
      });
      return Array.isArray(data) ? data : [];
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
     * PDF an ein Fundstueck. Rohe Bytes, `Content-Type: application/pdf`,
     * Dateiname als `?name=` (serverseitig auf 200 Zeichen gekuerzt).
     *
     * @param {number|string} id
     * @param {Blob|ArrayBuffer|Uint8Array} data
     * @param {string} [name] Dateiname; leer laesst den Parameter weg
     */
    uploadResearchDoc(id, data, name) {
      return request(`/research/${encodeURIComponent(String(id))}/doc`, {
        method: 'POST',
        body: /** @type {any} */ (data),
        contentType: 'application/pdf',
        query: { name: clampAttachmentName(name) },
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
     * PDF an eine Quelle.
     *
     * Der Endpunkt heisst `doc`, nicht `pdf` — `routes/sources-doc.js`, unter
     * `/sources` gemountet. `POST /sources/:id/pdf` gibt es nicht und hat es
     * nie gegeben; der Name stand nur in der Scope-Allowlist des Servers, und
     * die ist eine Rechte-Liste, keine Routenliste. Ein Aufruf von `/pdf` lief
     * ins Express-404 und sah aus wie ein kaputter Server.
     *
     * Nur der Besitzer der Quelle darf das (`NOT_SOURCE_OWNER`), unabhaengig
     * vom Buchrecht.
     *
     * @param {number|string} id
     * @param {Blob|ArrayBuffer|Uint8Array} data
     * @param {string} [name] Dateiname fuer `?name=`
     */
    uploadSourceDoc(id, data, name) {
      return request(`/sources/${encodeURIComponent(String(id))}/doc`, {
        method: 'POST',
        body: /** @type {any} */ (data),
        contentType: 'application/pdf',
        query: { name: clampAttachmentName(name) },
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
     *
     * Die Antwort sagt mit drei Flags, was wirklich passiert ist. Es gibt kein
     * `created`; wer darauf schaut, sieht immer `undefined` und weiss danach
     * nichts. Die Idempotenz ist absichtlich zweigeteilt: eine **Quelle**
     * existiert pro Dokument nur einmal (bekannte URL wird wiederverwendet und
     * nur verlinkt), ein **Fundstueck** beliebig oft — dedupliziert wird nur ein
     * wortgleicher Fund (kind + Titel + Text + URL) aus einem 10-Minuten-Fenster,
     * also der Doppelklick.
     *
     * @param {Record<string, any>} payload
     * @returns {Promise<{
     *   research_item?: Record<string, any>,
     *   research_created?: boolean,
     *   source?: Record<string, any>,
     *   source_created?: boolean,
     *   source_linked?: boolean,
     * }>}
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
