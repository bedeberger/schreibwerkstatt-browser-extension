/**
 * URL-Normalisierung.
 *
 * Zweck: eine stabile, vergleichbare Form derselben Seite, damit
 *  - `GET /sources/by-url` verlaesslich trifft,
 *  - der Doppelklick-Schutz nicht an `?utm_source=` scheitert,
 *  - die Retry-Queue Duplikate erkennt.
 *
 * Bewusst konservativ: wir entfernen nur, was nachweislich Tracking ist.
 * Alles andere bleibt stehen, weil es die Ressource identifizieren koennte
 * (`?id=42`, `?page=3`, `?v=…`).
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

/**
 * Vergleicht zwei URLs nach Normalisierung.
 * @param {unknown} a
 * @param {unknown} b
 */
export function sameResource(a, b) {
  const na = normalizeUrl(a);
  const nb = normalizeUrl(b);
  return !!na && na === nb;
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
