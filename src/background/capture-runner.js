/**
 * Fuehrt einen Erfassungsauftrag aus.
 *
 * Zwei Wege:
 *   A) `POST /capture` — ein transaktionaler, idempotenter Request.
 *   B) Fallback — `POST /research`, `POST /sources`, `POST /sources/:id/link`
 *      und die Anhaenge, jeweils einzeln.
 *
 * Der Fortschritt wird in `job.progress` festgehalten. Ein Wiederholungs-
 * versuch setzt dort fort, wo er abgebrochen ist; ein bereits angelegtes
 * Recherche-Item wird nie ein zweites Mal erzeugt.
 */

import { ApiError } from '../shared/errors.js';
import { validateResearchPayload, validateSourcePayload } from '../shared/limits.js';

/**
 * @typedef {object} RunContext
 * @property {ReturnType<import('./api-client.js').createApiClient>} api
 * @property {{capture: boolean, byUrl: boolean}} capabilities
 * @property {(event: string, detail?: Record<string, any>) => void} [log]
 * @property {(name: 'capture'|'byUrl') => void} [onCapabilityMissing]
 */

const wantsResearch = (mode) => mode === 'research' || mode === 'both';
const wantsSource = (mode) => mode === 'source' || mode === 'both';

const hasText = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * Wirft einen Fehler, der wie ein Server-400 aussieht, damit die Queue ihn
 * als endgueltig behandelt und die UI ihn wie jeden anderen Fehler anzeigt.
 *
 * @param {import('../shared/limits.js').ValidationProblem[]} problems
 */
function throwValidation(problems) {
  const first = problems[0];
  throw new ApiError({
    status: 400,
    code: 'CLIENT_VALIDATION_FAILED',
    params: { field: first.field, rule: first.key, ...(first.params || {}) },
    message: `${first.field}: ${first.key}`,
  });
}

/**
 * @param {import('../shared/config.js').CaptureJob} job
 * @param {RunContext} ctx
 * @returns {Promise<import('../shared/config.js').CaptureProgress>}
 */
export async function runCaptureJob(job, ctx) {
  const { intent, progress } = job;
  const { api, capabilities, log = () => {} } = ctx;

  const untouched = !progress.researchItemId && !progress.sourceId;

  if (capabilities.capture && untouched) {
    const done = await tryUnifiedCapture(job, ctx);
    if (done) return progress;
  }

  // -------------------------------------------------------------- Recherche
  if (wantsResearch(intent.mode) && !progress.researchItemId) {
    const payload = buildResearchPayload(intent);
    const problems = validateResearchPayload(payload);
    if (problems.length) throwValidation(problems);

    const item = await api.createResearchItem(payload);
    progress.researchItemId = item && (item.id ?? item.research_item?.id) ? (item.id ?? item.research_item.id) : null;
    progress.via = progress.via || 'split';
    log('research-created', { id: progress.researchItemId });
  }

  // ----------------------------------------------------------------- Quelle
  if (wantsSource(intent.mode) && !progress.sourceId) {
    await createOrReuseSource(job, ctx);
  }

  // Verknuepfung nachziehen (eigener Request laut Vertrag).
  if (
    wantsSource(intent.mode) &&
    progress.sourceId &&
    intent.bookId &&
    !progress.linkedBookIds.includes(intent.bookId)
  ) {
    await api.linkSource(progress.sourceId, intent.bookId);
    progress.linkedBookIds.push(intent.bookId);
    log('source-linked', { id: progress.sourceId, bookId: intent.bookId });
  }

  // --------------------------------------------------------------- Anhaenge
  await uploadAttachments(job, ctx);

  return progress;
}

/**
 * @param {import('../shared/config.js').CaptureJob} job
 * @param {RunContext} ctx
 * @returns {Promise<boolean>} true, wenn der Ein-Request-Pfad genuegt hat
 */
async function tryUnifiedCapture(job, ctx) {
  const { intent, progress } = job;
  const { api, log = () => {}, onCapabilityMissing } = ctx;

  const payload = {
    book_id: intent.bookId,
    mode: intent.mode,
    url: intent.normalizedUrl || intent.url,
    title: intent.title,
    authors: intent.source.authors,
    container_title: intent.source.container_title,
    year: intent.source.year || null,
    doi: intent.source.doi || '',
    accessed_at: intent.source.accessed_at,
    kind: intent.kind,
    body: intent.body,
    tags: intent.tags,
  };

  try {
    const result = await api.capture(payload);
    progress.via = 'capture';
    if (result && result.research_item) progress.researchItemId = result.research_item.id ?? null;
    if (result && result.source) {
      progress.sourceId = result.source.id ?? null;
      if (intent.bookId && !progress.linkedBookIds.includes(intent.bookId)) {
        progress.linkedBookIds.push(intent.bookId);
      }
    }
    log('capture-unified', { created: result && result.created });
    await uploadAttachments(job, ctx);
    return true;
  } catch (error) {
    const err = /** @type {any} */ (error);
    const routeMissing = (err.status === 404 || err.status === 405) && err.jsonBody !== true;
    if (routeMissing) {
      log('capture-endpoint-missing');
      if (onCapabilityMissing) onCapabilityMissing('capture');
      return false; // auf den Vier-Request-Pfad zurueckfallen
    }
    throw error;
  }
}

/**
 * @param {import('../shared/config.js').CaptureIntent} intent
 * @returns {Record<string, any>}
 */
export function buildResearchPayload(intent) {
  /** @type {Array<{url: string, label: string}>} */
  const urls = [];
  const seen = new Set();
  for (const entry of intent.urls || []) {
    if (!entry || !hasText(entry.url)) continue;
    const key = entry.url.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push({ url: key, label: (entry.label || '').slice(0, 300) });
  }

  return {
    book_id: intent.bookId,
    kind: intent.kind,
    title: intent.title,
    body: intent.body,
    // Laut Absprache: `source` traegt die Herkunfts-URL als String.
    source: intent.normalizedUrl || intent.url || '',
    urls,
    tags: Array.isArray(intent.tags) ? intent.tags : [],
  };
}

/**
 * @param {import('../shared/config.js').CaptureIntent} intent
 * @returns {Record<string, any>}
 */
export function buildSourcePayload(intent) {
  const draft = intent.source || {};
  /** @type {Record<string, any>} */
  const payload = {
    csl_type: draft.csl_type || 'website',
    title: draft.title || '',
    authors: Array.isArray(draft.authors) ? draft.authors : [],
    editors: Array.isArray(draft.editors) ? draft.editors : [],
    container_title: draft.container_title || '',
    publisher: draft.publisher || '',
    place: draft.place || '',
    year: draft.year || null,
    url: draft.url || intent.normalizedUrl || intent.url || '',
    doi: draft.doi || '',
    isbn: draft.isbn || '',
    accessed_at: draft.accessed_at || '',
    note: draft.note || '',
  };
  if (hasText(draft.citekey)) payload.citekey = draft.citekey.trim();
  return payload;
}

/**
 * Legt die Quelle an — oder verwendet eine schon vorhandene wieder.
 *
 * @param {import('../shared/config.js').CaptureJob} job
 * @param {RunContext} ctx
 */
async function createOrReuseSource(job, ctx) {
  const { intent, progress } = job;
  const { api, capabilities, log = () => {}, onCapabilityMissing } = ctx;

  // Doppelte Quelle vermeiden, wenn der Server es hergibt.
  if (capabilities.byUrl && (intent.normalizedUrl || intent.url)) {
    try {
      const found = await api.findSourceByUrl(intent.normalizedUrl || intent.url, intent.bookId);
      if (found && found.source && found.source.id) {
        progress.sourceId = found.source.id;
        progress.via = progress.via || 'split';
        if (found.linked_to_book && intent.bookId && !progress.linkedBookIds.includes(intent.bookId)) {
          progress.linkedBookIds.push(intent.bookId);
        }
        log('source-reused', { id: progress.sourceId });
        return;
      }
    } catch (error) {
      const err = /** @type {any} */ (error);
      const routeMissing = (err.status === 404 || err.status === 405) && err.jsonBody !== true;
      if (routeMissing && onCapabilityMissing) onCapabilityMissing('byUrl');
      // 404 heisst hier schlicht: noch nicht in der Bibliothek. Weitermachen.
      if (err.status !== 404 && err.status !== 405) throw error;
    }
  }

  const payload = buildSourcePayload(intent);
  const problems = validateSourcePayload(payload);
  if (problems.length) throwValidation(problems);

  let source;
  try {
    source = await api.createSource(payload);
  } catch (error) {
    const err = /** @type {any} */ (error);
    if (err.code === 'CITEKEY_TAKEN' && payload.citekey) {
      // Vertragsgemaess: ohne citekey erneut senden, Server vergibt einen.
      log('citekey-taken-retry', { citekey: payload.citekey });
      const { citekey, ...withoutCitekey } = payload;
      source = await api.createSource(withoutCitekey);
    } else {
      throw error;
    }
  }

  progress.sourceId = source && source.id !== undefined ? source.id : null;
  progress.via = progress.via || 'split';
  log('source-created', { id: progress.sourceId });
}

/**
 * Screenshot und PDF nachreichen. Fehler hier sind nicht kritisch genug,
 * um den ganzen Auftrag zu wiederholen — der Haupteintrag steht bereits.
 *
 * @param {import('../shared/config.js').CaptureJob} job
 * @param {RunContext} ctx
 */
async function uploadAttachments(job, ctx) {
  const { intent, progress } = job;
  const { api, log = () => {} } = ctx;
  const attachments = intent.attachments || {};

  if (attachments.screenshot && progress.researchItemId && !progress.imageUploaded) {
    const { bytes, contentType } = attachments.screenshot;
    await api.uploadResearchImage(progress.researchItemId, toBinary(bytes), contentType || 'image/jpeg');
    progress.imageUploaded = true;
    log('image-uploaded', { id: progress.researchItemId });
  }

  if (attachments.pdf && !progress.pdfUploaded) {
    const data = toBinary(attachments.pdf.bytes);
    if (progress.sourceId) {
      await api.uploadSourcePdf(progress.sourceId, data);
      progress.pdfUploaded = true;
      log('pdf-uploaded', { sourceId: progress.sourceId });
    } else if (progress.researchItemId) {
      await api.uploadResearchDoc(progress.researchItemId, data);
      progress.pdfUploaded = true;
      log('doc-uploaded', { researchItemId: progress.researchItemId });
    }
  }
}

/**
 * Anhaenge liegen in der Queue als base64 (JSON-faehig). Fuer den Versand
 * werden sie wieder zu Bytes.
 *
 * @param {string|Uint8Array|ArrayBuffer} value
 * @returns {Uint8Array|ArrayBuffer}
 */
export function toBinary(value) {
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return value;
  if (typeof value !== 'string') throw new TypeError('attachment must be base64 or binary');
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {string} base64
 */
export function toBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, /** @type {any} */ (bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}
