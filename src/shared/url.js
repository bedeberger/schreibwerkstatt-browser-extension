/**
 * URL-Normalisierung.
 *
 * Es gibt hier zwei Normalisierer, und die Trennung ist der Punkt:
 *
 *  - `normalizeUrl` ist die Form, die wir SENDEN. Sie legt fest, unter welcher
 *    Adresse ein Fundstueck in der Bibliothek landet, und ist deshalb bewusst
 *    konservativ: entfernt wird nur, was nachweislich Tracking ist. Alles
 *    andere bleibt stehen, weil es die Ressource identifizieren koennte
 *    (`?id=42`, `?page=3`, `?v=…`).
 *  - `serverNormalizeUrl` ist der Nachbau von `lib/url-normalize.js` und
 *    beantwortet die andere Frage: „sieht der SERVER hier dieselbe Seite?"
 *
 * **Jeder Vergleich zweier Adressen gehoert zum zweiten**, auch der rein
 * lokale. Vergleicht der Client mit seinen eigenen, strengeren Regeln, haelt
 * er `http://www.x.de/a/` und `https://x.de/a` auseinander — der Server nicht,
 * und heraus kommt eine Dublette, die es serverseitig gar nicht geben kann.
 */

/** Exakte Parameternamen, die entfernt werden. */
const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'msclkid',
  'yclid',
  'twclid',
  'igshid',
  'igsh',
  'mc_cid',
  'mc_eid',
  'ref_src',
  'ref_url',
  's_cid',
  'vero_id',
  'vero_conv',
  'wickedid',
  'oly_anon_id',
  'oly_enc_id',
  'spm',
  'scm',
  '__s',
  '_openstat',
  'trk',
  'trkCampaign',
  'sc_channel',
  'sc_campaign',
  'cmpid',
  'ncid',
  'at_medium',
  'at_campaign',
]);

/** Praefixe, die entfernt werden (utm_source, pk_kwd, …). */
const TRACKING_PREFIXES = ['utm_', 'pk_', 'mtm_', 'piwik_', 'matomo_', 'hsa_', '_hs', 'ga_'];

/** Standardports, die aus der Autoritaet fliegen. */
const DEFAULT_PORTS = { 'http:': '80', 'https:': '443' };

function isTrackingParam(name) {
  const lower = name.toLowerCase();
  if (TRACKING_PARAMS.has(name) || TRACKING_PARAMS.has(lower)) return true;
  return TRACKING_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * @param {unknown} raw
 * @returns {URL|null}
 */
function parse(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

/**
 * @param {unknown} raw
 * @returns {boolean} true, wenn es eine absolute http(s)-URL ist.
 */
export function isHttpUrl(raw) {
  const url = parse(raw);
  return !!url && (url.protocol === 'http:' || url.protocol === 'https:');
}

/**
 * Normalisiert eine Seiten-URL.
 *
 * - Schema und Host klein
 * - Standardport weg
 * - Tracking-Parameter weg, restliche Parameter alphabetisch sortiert
 * - leerer Query/Fragment weg; `#!`-Routen bleiben erhalten
 * - Trailing Slash nur bei leerem Pfad entfernt (`/a/` != `/a`, das
 *   entscheidet der Server, aber `https://x.de/` == `https://x.de`)
 *
 * @param {unknown} raw
 * @returns {string|null} normalisierte URL oder null, wenn unbrauchbar
 */
export function normalizeUrl(raw) {
  const url = parse(raw);
  if (!url) return null;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  // Punycode-Hosts vereinheitlichen; URL macht das bereits, IDN bleibt IDN.
  if (url.port && DEFAULT_PORTS[url.protocol] === url.port) url.port = '';

  // Query saeubern und sortieren.
  const params = [...url.searchParams.entries()].filter(([name]) => !isTrackingParam(name));
  params.sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1));
  url.search = '';
  for (const [name, value] of params) url.searchParams.append(name, value);
  if (![...url.searchParams].length) url.search = '';

  // Fragment: nur `#!`-Routen ueberleben, sie adressieren echte Inhalte.
  if (url.hash && !url.hash.startsWith('#!')) url.hash = '';

  // Auth-Angaben gehoeren nie in eine gespeicherte Quelle.
  url.username = '';
  url.password = '';

  let out = url.toString();
  if (url.pathname === '/' && !url.search && !url.hash) out = out.replace(/\/$/, '');
  return out;
}

// ---------------------------------------------------------------------------
// Serverseitige Normalisierung, hier nachgebaut
// ---------------------------------------------------------------------------

/**
 * Zeichengenauer Nachbau von `lib/url-normalize.js` im Mutterprojekt.
 *
 * Gebraucht wird er ueberall, wo zwei Adressen VERGLICHEN werden, und zwar
 * unabhaengig davon, woher sie kommen:
 *
 *  - Dublettenpruefung gegen `urls[].url` aus `GET /research`
 *    (`shared/duplicates.js`),
 *  - kanonische Adresse gegen Seiten-URL (`shared/intent.js`),
 *  - Dubletten innerhalb von `urls[]` vor dem Senden
 *    (`buildResearchPayload` in `background/capture-runner.js`).
 *
 * Es gibt bewusst kein Gegenstueck auf Basis von `normalizeUrl`: ein solcher
 * Vergleich waere strenger als der Server und wuerde Unterschiede behaupten,
 * die drueben keine sind. Die frueher hier stehende Funktion `sameResource`
 * hat genau das getan und wurde deshalb entfernt.
 *
 * Aenderungen hier gehoeren mit `lib/url-normalize.js` abgeglichen; ein Test
 * in `test/url.test.js` haelt die dokumentierten Faelle fest.
 */

/**
 * Exakt die Liste aus `lib/url-normalize.js`. `ref` steht bewusst NICHT drin —
 * manche Seiten liefern darueber tatsaechlich anderen Inhalt aus.
 */
const SERVER_TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'dclid', 'msclkid', 'yclid', 'twclid', 'igshid',
  'mc_cid', 'mc_eid', 'vero_id', 'vero_conv', '_hsenc', '_hsmi', 'hsctatracking',
  'wt_mc', 'wt_zmc', 'pk_campaign', 'pk_kwd', 'piwik_campaign', 'piwik_kwd',
  'mkt_tok', 's_kwcid', 'ck_subscriber_id', 'oly_anon_id', 'oly_enc_id',
]);

function isServerTrackingParam(name) {
  const lower = String(name).toLowerCase();
  return lower.startsWith('utm_') || SERVER_TRACKING_PARAMS.has(lower);
}

/**
 * Normalisiert wie der Server: Fragment weg, `www.` weg, http -> https,
 * Standardport weg, Tracking-Parameter weg, Query sortiert, Trailing-Slash
 * weg (der Root-Slash bleibt).
 *
 * @param {unknown} raw
 * @returns {string|null} null, wenn es keine brauchbare http(s)-URL ist
 */
export function serverNormalizeUrl(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return null;

  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  url.hash = '';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
    url.port = '';
  }
  // Reihenfolge zaehlt: erst den Standardport des ALTEN Schemas entfernen,
  // dann vereinheitlichen — sonst ueberlebt ein `:80` den Wechsel auf https.
  url.protocol = 'https:';

  for (const name of [...url.searchParams.keys()]) {
    if (isServerTrackingParam(name)) url.searchParams.delete(name);
  }
  url.searchParams.sort();

  let out = url.toString();
  out = out.replace(/\?$/, '');
  out = out.replace(/^(https:\/\/[^/]+\/[^?#]*?)\/(?=$|\?)/, '$1');
  return out;
}

/**
 * Bezeichnen zwei URLs nach SERVER-Regeln dasselbe Dokument?
 * @param {unknown} a
 * @param {unknown} b
 */
export function sameServerResource(a, b) {
  const na = serverNormalizeUrl(a);
  const nb = serverNormalizeUrl(b);
  return !!na && !!nb && na === nb;
}

/**
 * Bringt die vom Nutzer eingetippte Server-Adresse in Form.
 * Ein Unterpfad bleibt erhalten (self-hosted hinter Reverse-Proxy),
 * ein abschliessender Slash nicht.
 *
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeServerUrl(raw) {
  if (typeof raw !== 'string') return null;
  let value = raw.trim();
  if (!value) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;

  const url = parse(value);
  if (!url) return null;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;

  url.hostname = url.hostname.toLowerCase();
  url.search = '';
  url.hash = '';
  url.username = '';
  url.password = '';
  if (url.port && DEFAULT_PORTS[url.protocol] === url.port) url.port = '';

  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/**
 * Ist das ein lokaler Host? Nur fuer die gibt die Options-Seite `http:` frei.
 *
 * Die Liste deckt sich absichtlich mit den `http`-Mustern in
 * `manifest.json` → `optional_host_permissions`: was hier durchgeht, muss
 * `chrome.permissions.request()` auch gewaehrt bekommen koennen. Deshalb kein
 * `[::1]` — Chrome-Match-Muster kennen keine IPv6-Literale, ein solches Origin
 * liesse sich gar nicht anfordern.
 *
 * @param {unknown} raw
 */
export function isLocalHost(raw) {
  const url = parse(raw);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');
}

/**
 * Host-Permission-Muster fuer `chrome.permissions.request()`.
 * Bewusst nur dieses eine Origin — nie `<all_urls>`.
 *
 * @param {unknown} raw
 * @returns {string|null} z. B. "https://schreibwerkstatt.example.com/*"
 */
export function toOriginPattern(raw) {
  const normalized = normalizeServerUrl(raw);
  if (!normalized) return null;
  const url = parse(normalized);
  if (!url) return null;
  return `${url.protocol}//${url.host}/*`;
}

/**
 * Kurzer, anzeigbarer Host ohne `www.`.
 * @param {unknown} raw
 * @returns {string}
 */
export function hostLabel(raw) {
  const url = parse(raw);
  if (!url) return '';
  return url.hostname.replace(/^www\./i, '');
}

/**
 * Loest eine moeglicherweise relative URL gegen eine Basis auf.
 * @param {unknown} raw
 * @param {unknown} base
 * @returns {string|null}
 */
export function resolveUrl(raw, base) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim(), typeof base === 'string' ? base : undefined);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Gleiches Origin? Entscheidet, ob ein PDF ueber das Content-Script
 * (activeTab, same-origin) geholt werden darf.
 * @param {unknown} a
 * @param {unknown} b
 */
export function sameOrigin(a, b) {
  const ua = parse(a);
  const ub = parse(b);
  return !!ua && !!ub && ua.origin === ub.origin;
}

/**
 * Dateiname aus einer URL — fuer den `?name=`-Parameter der Anhang-Endpunkte.
 *
 * Query und Fragment fallen weg, Prozentkodierung wird aufgeloest. Liefert eine
 * URL keinen brauchbaren letzten Pfadteil (`/artikel/`, nur Host), kommt der
 * Rueckfall `dokument.pdf` — der Server kuerzt den Namen ohnehin auf 200
 * Zeichen, und die Erweiterung schickt lieber etwas Lesbares als nichts.
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function fileNameFromUrl(raw) {
  const url = parse(raw);
  const last = url ? url.pathname.split('/').filter(Boolean).pop() || '' : '';

  let name = last;
  try {
    name = decodeURIComponent(last);
  } catch {
    // Kaputte Prozentkodierung: den rohen Teil nehmen, nicht scheitern.
  }
  // Ein Dateiname mit Pfadtrennern oder Steuerzeichen hat in einem
  // Query-Parameter nichts zu suchen.
  name = name.replace(/[\\/\u0000-\u001f\u007f]/g, '').trim();

  if (!name) return 'dokument.pdf';
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}
