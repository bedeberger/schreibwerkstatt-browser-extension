/**
 * Erkennung der noch nicht ueberall deployten Endpunkte.
 *
 * `POST /capture`, `GET /sources/by-url` und `GET /research` gibt es nicht auf
 * jedem Server.
 * Unterscheidungsmerkmal: laut Vertrag antwortet die App bei jedem Fehler
 * mit JSON `{ error_code }`. Eine unbekannte Route beantwortet Express
 * dagegen mit einer HTML-Standardseite. Also:
 *
 *   404/405 ohne JSON-Koerper  -> Route fehlt
 *   4xx MIT JSON `error_code`  -> Route existiert, Anfrage war nur ungueltig
 *   401/403/5xx/Netzfehler     -> keine Aussage moeglich (null)
 *
 * Die Probe laeuft nur beim Verbindungstest und hoechstens einmal taeglich
 * im Moment einer vom Nutzer ausgeloesten Erfassung — kein Hintergrundverkehr.
 */

/** Harmlose URL fuer die by-url-Probe. Reserviert nach RFC 2606. */
const PROBE_URL = 'https://example.com/schreibwerkstatt-probe';

/**
 * @param {unknown} error
 * @returns {boolean|null}
 */
function verdictFromError(error) {
  const err = /** @type {any} */ (error);
  if (!err) return null;
  if (err.networkError) return null;

  const status = Number(err.status) || 0;
  const hasJson = err.jsonBody === true && typeof err.code === 'string' && err.code.length > 0;

  // Auth, Berechtigung und Drosselung entscheidet die Middleware VOR dem
  // Routing. Solche Antworten sagen nichts darueber, ob es die Route gibt.
  if (status === 401 || status === 403 || status === 429) return null;

  // Fachlicher Fehler in JSON-Form => die Route ist da.
  if (hasJson && status >= 400 && status < 500) return true;

  if (status === 404 || status === 405 || status === 501) return false;

  // 400 ohne error_code ist untypisch fuer diese App, aber immer noch ein
  // Zeichen, dass etwas die Anfrage inhaltlich geprueft hat.
  if (status === 400 || status === 422) return true;

  return null;
}

/**
 * @param {ReturnType<import('./api-client.js').createApiClient>} api
 * @returns {Promise<boolean|null>}
 */
export async function probeByUrl(api) {
  try {
    await api.findSourceByUrl(PROBE_URL, '');
    return true;
  } catch (error) {
    return verdictFromError(error);
  }
}

/**
 * Probe mit leerem Koerper. Der Endpunkt verlangt `book_id`, `mode` und `url`
 * und muss deshalb mit 400 ablehnen — es entsteht kein Datensatz.
 *
 * @param {ReturnType<import('./api-client.js').createApiClient>} api
 * @returns {Promise<boolean|null>}
 */
export async function probeCapture(api) {
  try {
    await api.capture({});
    // Unerwartet, aber eindeutig: der Endpunkt existiert.
    return true;
  } catch (error) {
    return verdictFromError(error);
  }
}

/**
 * Probe fuer `GET /research` — ohne `book_id`, der Endpunkt muss deshalb mit
 * `400 INVALID_ID` ablehnen. Nichts wird gelesen, nichts geschrieben.
 *
 * Sonderfall gegenueber den anderen Proben: `403 DEVICE_SCOPE_FORBIDDEN` wird
 * hier nicht als „keine Aussage" verworfen, sondern als „Endpunkt da, Scope
 * fehlt" gewertet. Begruendung: das Scope-Gate sitzt vor dem Routing, ein 403
 * beweist also streng genommen nicht, dass es die Route gibt. Der wahrschein-
 * lichere Fall ist aber der neue Server mit einem Token ohne `content:read` —
 * und wenn die Annahme falsch war, faellt das beim ersten echten Aufruf auf:
 * der antwortet mit dem HTML-404 von Express, und der Aufrufer setzt die
 * Faehigkeit auf `false` zurueck. Die Verwechslung kostet einen Request, kein
 * falsches Ergebnis.
 *
 * @param {ReturnType<import('./api-client.js').createApiClient>} api
 * @returns {Promise<{detected: boolean|null, scopeMissing: boolean}>}
 */
export async function probeResearchList(api) {
  try {
    await api.listResearch({});
    // Ohne `book_id` duerfte kein 200 kommen — der Endpunkt ist aber da.
    return { detected: true, scopeMissing: false };
  } catch (error) {
    const err = /** @type {any} */ (error);
    if (err && err.status === 403 && err.code === 'DEVICE_SCOPE_FORBIDDEN') {
      return { detected: true, scopeMissing: true };
    }
    return { detected: verdictFromError(error), scopeMissing: false };
  }
}

/**
 * @param {ReturnType<import('./api-client.js').createApiClient>} api
 * @returns {Promise<{capture: boolean|null, byUrl: boolean|null, researchList: boolean|null, researchScopeMissing: boolean}>}
 */
export async function probeCapabilities(api) {
  const [capture, byUrl, research] = await Promise.all([
    probeCapture(api),
    probeByUrl(api),
    probeResearchList(api),
  ]);
  return {
    capture,
    byUrl,
    researchList: research.detected,
    researchScopeMissing: research.scopeMissing,
  };
}

export const __testing = { verdictFromError, PROBE_URL };
