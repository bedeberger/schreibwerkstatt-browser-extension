/**
 * Zugriff auf `chrome.storage.local`.
 *
 * Bewusst `local` und nicht `sync`: das Geraete-Token ist ein Geheimnis
 * und soll nicht ueber das Google-Konto auf fremde Rechner wandern.
 */

import {
  CAPABILITY_MODE,
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  TOKEN_STATE,
  withDefaults,
} from '../shared/config.js';
import { normalizeServerUrl } from '../shared/url.js';

/**
 * @returns {Promise<ReturnType<typeof withDefaults>>}
 */
export async function readState() {
  const stored = await chrome.storage.local.get(null);
  return withDefaults(stored);
}

/**
 * @param {Record<string, any>} patch
 */
export async function writeState(patch) {
  await chrome.storage.local.set(patch);
}

/**
 * Zugangsdaten fuer den API-Client.
 * @returns {Promise<{serverUrl: string, token: string}>}
 */
export async function getConfig() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.SERVER_URL, STORAGE_KEYS.TOKEN]);
  return {
    serverUrl: normalizeServerUrl(stored[STORAGE_KEYS.SERVER_URL]) || '',
    token: stored[STORAGE_KEYS.TOKEN] || '',
  };
}

/**
 * @returns {Promise<typeof DEFAULT_SETTINGS>}
 */
export async function getSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEYS.SETTINGS] || {}) };
}

/**
 * @param {Partial<typeof DEFAULT_SETTINGS>} patch
 */
export async function saveSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await writeState({ [STORAGE_KEYS.SETTINGS]: next });
  return next;
}

/**
 * @returns {Promise<import('../shared/config.js').CaptureJob[]>}
 */
export async function loadQueue() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.QUEUE);
  const value = stored[STORAGE_KEYS.QUEUE];
  return Array.isArray(value) ? value : [];
}

/**
 * @param {import('../shared/config.js').CaptureJob[]} jobs
 */
export async function saveQueue(jobs) {
  await chrome.storage.local.set({ [STORAGE_KEYS.QUEUE]: jobs });
}

/**
 * @param {import('../shared/config.js').TokenState} state
 */
export async function setTokenState(state) {
  await writeState({ [STORAGE_KEYS.TOKEN_STATE]: state });
}

/**
 * @returns {Promise<import('../shared/config.js').TokenState>}
 */
export async function getTokenState() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.TOKEN_STATE);
  return stored[STORAGE_KEYS.TOKEN_STATE] || TOKEN_STATE.UNKNOWN;
}

/**
 * @returns {Promise<{capture: {mode: string, detected: boolean|null}, byUrl: {mode: string, detected: boolean|null}, probedAt: number}>}
 */
export async function getCapabilities() {
  const state = await readState();
  return state[STORAGE_KEYS.CAPABILITIES];
}

/**
 * @param {{capture?: boolean|null, byUrl?: boolean|null}} detected
 */
export async function saveDetectedCapabilities(detected) {
  const current = await getCapabilities();
  const next = {
    ...current,
    capture: { ...current.capture, detected: pick(detected.capture, current.capture.detected) },
    byUrl: { ...current.byUrl, detected: pick(detected.byUrl, current.byUrl.detected) },
    probedAt: Date.now(),
  };
  await writeState({ [STORAGE_KEYS.CAPABILITIES]: next });
  return next;
}

/**
 * `null` aus der Probe heisst „keine Aussage" — dann bleibt der alte Befund.
 * @param {boolean|null|undefined} fresh
 * @param {boolean|null} previous
 */
function pick(fresh, previous) {
  return fresh === null || fresh === undefined ? previous : fresh;
}

/**
 * @param {'capture'|'byUrl'} name
 * @param {'auto'|'on'|'off'} mode
 */
export async function setCapabilityMode(name, mode) {
  const current = await getCapabilities();
  if (!Object.values(CAPABILITY_MODE).includes(mode)) return current;
  const next = { ...current, [name]: { ...current[name], mode } };
  await writeState({ [STORAGE_KEYS.CAPABILITIES]: next });
  return next;
}

/**
 * @param {Array<Record<string, any>>} books
 */
export async function saveBooks(books) {
  await writeState({
    [STORAGE_KEYS.BOOKS]: books,
    [STORAGE_KEYS.BOOKS_FETCHED_AT]: Date.now(),
  });
}
