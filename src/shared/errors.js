/**
 * Fehlercode -> Text und Verhalten.
 *
 * Zwei Regeln aus der Spezifikation:
 *  - Der `error_code` wird IMMER mit angezeigt, damit Support moeglich ist.
 *  - Auth-Fehler werden nie stillschweigend wiederholt.
 *
 * Dieses Modul kennt `chrome.i18n` nicht; es liefert nur Schluessel.
 * Das Uebersetzen macht der Aufrufer (siehe `shared/i18n.js`).
 */

/** Fehler mit strukturierter Server-Antwort. */
export class ApiError extends Error {
  /**
   * @param {object} init
   * @param {number} [init.status]
   * @param {string} [init.code]
   * @param {Record<string, any>} [init.params]
   * @param {string} [init.message]
   * @param {boolean} [init.networkError]
   * @param {unknown} [init.cause]
   */
  constructor({ status = 0, code = '', params = {}, message = '', networkError = false, cause } = {}) {
    super(message || code || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.params = params;
    this.networkError = networkError;
    if (cause !== undefined) this.cause = cause;
  }

  toJSON() {
    return {
      name: this.name,
      status: this.status,
      code: this.code,
      params: this.params,
      networkError: this.networkError,
      message: this.message,
    };
  }
}

/** Vom Server dokumentierte bzw. erwartete Codes -> i18n-Schluessel. */
export const ERROR_MESSAGE_KEYS = Object.freeze({
  NOT_LOGGED_IN: 'err_not_logged_in',
  CAPTURE_SCOPE_REQUIRED: 'err_capture_scope_required',
  SOURCE_IDENTITY_REQ: 'err_source_identity_req',
  CITEKEY_TAKEN: 'err_citekey_taken',
  BOOK_NOT_FOUND: 'err_book_not_found',
  BOOK_ACCESS_DENIED: 'err_book_access_denied',
  FORBIDDEN: 'err_forbidden',
  VALIDATION_FAILED: 'err_validation_failed',
  PAYLOAD_TOO_LARGE: 'err_payload_too_large',
  UNSUPPORTED_MEDIA_TYPE: 'err_unsupported_media_type',
  RATE_LIMITED: 'err_rate_limited',
  NOT_FOUND: 'err_not_found',
  SERVER_ERROR: 'err_server_error',
});

/** Fallback nach HTTP-Status, wenn der Server keinen Code mitschickt. */
const STATUS_MESSAGE_KEYS = Object.freeze({
  400: 'err_status_400',
  401: 'err_not_logged_in',
  403: 'err_status_403',
  404: 'err_status_404',
  405: 'err_status_404',
  408: 'err_status_timeout',
  409: 'err_status_409',
  413: 'err_payload_too_large',
  415: 'err_unsupported_media_type',
  429: 'err_rate_limited',
  500: 'err_server_error',
  502: 'err_server_error',
  503: 'err_server_error',
  504: 'err_status_timeout',
});

/** Codes, bei denen ein Wiederholen sinnlos ist (Nutzer muss handeln). */
const TERMINAL_CODES = new Set([
  'NOT_LOGGED_IN',
  'CAPTURE_SCOPE_REQUIRED',
  'SOURCE_IDENTITY_REQ',
  'BOOK_NOT_FOUND',
  'BOOK_ACCESS_DENIED',
  'FORBIDDEN',
  'VALIDATION_FAILED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
]);

/** HTTP-Status, die ein Wiederholen rechtfertigen. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 507, 522, 524]);

/**
 * @param {{status?: number, code?: string}} error
 * @returns {string} i18n-Schluessel
 */
export function messageKeyForError(error = {}) {
  const code = typeof error.code === 'string' ? error.code.toUpperCase() : '';
  if (code && ERROR_MESSAGE_KEYS[code]) return ERROR_MESSAGE_KEYS[code];
  if (error.networkError) return 'err_network';
  const status = Number(error.status) || 0;
  if (STATUS_MESSAGE_KEYS[status]) return STATUS_MESSAGE_KEYS[status];
  if (status >= 500) return 'err_server_error';
  if (status >= 400) return 'err_status_400';
  return 'err_unknown';
}

/**
 * Darf dieser Fehler in der Queue wiederholt werden?
 * @param {{status?: number, code?: string, networkError?: boolean}} error
 * @returns {boolean}
 */
export function isRetryable(error = {}) {
  if (error.networkError) return true;
  const code = typeof error.code === 'string' ? error.code.toUpperCase() : '';
  if (code && TERMINAL_CODES.has(code)) return false;
  // CITEKEY_TAKEN wird im Ablauf selbst behandelt (ohne citekey erneut senden),
  // darf also nicht als generischer Retry durchrutschen.
  if (code === 'CITEKEY_TAKEN') return false;
  const status = Number(error.status) || 0;
  if (status === 0) return true; // kein HTTP zustande gekommen
  if (RETRYABLE_STATUS.has(status)) return true;
  return status >= 500;
}

/**
 * Ist das ein Authentifizierungsproblem? Dann Token als ungueltig markieren,
 * Badge rot, Options-Seite verlinken.
 * @param {{status?: number, code?: string}} error
 */
export function isAuthError(error = {}) {
  const code = typeof error.code === 'string' ? error.code.toUpperCase() : '';
  if (code === 'NOT_LOGGED_IN') return true;
  return Number(error.status) === 401;
}

/**
 * Fehlt dem Token die Erfassungs-Berechtigung?
 * @param {{status?: number, code?: string}} error
 */
export function isScopeError(error = {}) {
  const code = typeof error.code === 'string' ? error.code.toUpperCase() : '';
  return code === 'CAPTURE_SCOPE_REQUIRED';
}

/**
 * Baut den anzeigbaren Text. Der Code steht immer dabei.
 *
 * @param {{status?: number, code?: string, params?: Record<string, any>, message?: string, networkError?: boolean}} error
 * @param {(key: string, substitutions?: string[]) => string} translate
 * @returns {{ code: string, key: string, text: string, retryable: boolean, auth: boolean, scope: boolean }}
 */
export function describeError(error = {}, translate = (key) => key) {
  const key = messageKeyForError(error);
  const params = error.params && typeof error.params === 'object' ? error.params : {};
  const substitutions = Object.values(params).map((v) => String(v));
  let text = translate(key, substitutions) || key;

  const badge =
    (typeof error.code === 'string' && error.code) ||
    (error.networkError ? 'NETWORK' : '') ||
    (error.status ? `HTTP_${error.status}` : 'UNKNOWN');

  if (badge) text = `${text} (${badge})`;

  return {
    code: badge,
    key,
    text,
    retryable: isRetryable(error),
    auth: isAuthError(error),
    scope: isScopeError(error),
  };
}
