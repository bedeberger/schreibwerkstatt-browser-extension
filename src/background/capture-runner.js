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

import { ApiError, isRouteMissing } from '../shared/errors.js';
import {
  LIMITS,
  clampCapturePayload,
  clampResearchPayload,
  clampSourcePayload,
  jsonByteLength,
  validateBinarySize,
  validateResearchPayload,
  validateSourcePayload,
} from '../shared/limits.js';
import { serverNormalizeUrl } from '../shared/url.js';

/**
 * @typedef {object} RunContext
 * @property {ReturnType<typeof import('./api-client.js').createApiClient>} api
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

  if (capabilities.capture && untouched && unifiedCaptureFits(intent)) {
    const done = await tryUnifiedCapture(job, ctx);
    if (done) return progress;
  }

  // -------------------------------------------------------------- Recherche
  if (wantsResearch(intent.mode) && !progress.researchItemId) {
    const { payload } = buildResearchPayload(intent);
    const problems = validateResearchPayload(payload, { verbatimBody: isVerbatim(intent) });
    if (problems.length) throwValidation(problems);

    const item = await api.createResearchItem(payload);
    progress.researchItemId = item && (item.id ?? item.research_item?.id) ? (item.id ?? item.research_item.id) : null;
    progress.researchCreated = true;
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
    progress.sourceLinked = true;
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

  const { payload } = buildCapturePayload(intent);

  // Dieselben Pruefungen wie auf dem Fallback-Pfad. Ohne sie waere der
  // Ein-Request-Pfad die Luecke, durch die ein zu langes Zitat ungeprueft
  // hinausgeht — der Server kuerzt es dann still, und die Erweiterung quittiert
  // einen Wortlaut, den so niemand gespeichert hat.
  const problems = [
    ...(wantsResearch(intent.mode)
      ? validateResearchPayload(payload, { verbatimBody: isVerbatim(intent) })
      : []),
    ...(wantsSource(intent.mode) ? validateSourcePayload(payload) : []),
  ];
  if (problems.length) throwValidation(problems);

  // Der JSON-Koerper laeuft in den Body-Parser, nicht in die Route: 256 kB
  // ueberschritten heisst `413` OHNE `error_code`, als HTML-Seite. Vorher
  // pruefen, damit die Meldung den Grund nennt.
  const bytes = jsonByteLength(payload);
  if (bytes > LIMITS.CAPTURE_JSON_MAX_BYTES) {
    throw new ApiError({
      status: 413,
      code: 'CLIENT_PAYLOAD_TOO_LARGE',
      params: { max: LIMITS.CAPTURE_JSON_MAX_BYTES, actual: bytes },
      message: `capture payload ${bytes} bytes`,
    });
  }

  try {
    const result = (await api.capture(payload)) || {};
    progress.via = 'capture';

    // Der Vertrag antwortet mit drei Flags — `research_created`,
    // `source_created`, `source_linked`. Sie sind die einzige Grundlage fuer
    // „war schon drin"; ein `created` gibt es nicht.
    if (result.research_item) {
      progress.researchItemId = result.research_item.id ?? null;
      progress.researchCreated = result.research_created !== false;
    }
    if (result.source) {
      progress.sourceId = result.source.id ?? null;
      progress.sourceCreated = result.source_created !== false;
      // `source_linked` heisst „DIESER Aufruf hat verknuepft" — `false` also
      // „hing schon am Buch", nicht „haengt nicht dran". Der Aufruf ist
      // transaktional; in beiden Faellen ist die Quelle danach am Buch, deshalb
      // wird `linkedBookIds` unabhaengig vom Flag gesetzt und der eigene
      // `/link`-Request entfaellt.
      progress.sourceLinked = result.source_linked !== false;
      if (intent.bookId && !progress.linkedBookIds.includes(intent.bookId)) {
        progress.linkedBookIds.push(intent.bookId);
      }
    }

    log('capture-unified', {
      researchCreated: progress.researchCreated,
      sourceCreated: progress.sourceCreated,
      sourceLinked: progress.sourceLinked,
    });
    await uploadAttachments(job, ctx);
    return true;
  } catch (error) {
    const err = /** @type {any} */ (error);
    if (isRouteMissing(err)) {
      log('capture-endpoint-missing');
      if (onCapabilityMissing) onCapabilityMissing('capture');
      return false; // auf den Vier-Request-Pfad zurueckfallen
    }
    throw error;
  }
}

/**
 * Bibliografische Felder, die `POST /sources` und `POST /capture` gemeinsam
 * erwarten — ohne `title` und `url`, weil die beiden Endpunkte sie aus
 * unterschiedlichen Quellen ziehen, und ohne `citekey`, das nur `/sources`
 * annimmt (siehe `unifiedCaptureFits`).
 *
 * @param {Record<string, any>} draft
 */
function sourceFields(draft) {
  return {
    authors: Array.isArray(draft.authors) ? draft.authors : [],
    editors: Array.isArray(draft.editors) ? draft.editors : [],
    container_title: draft.container_title || '',
    publisher: draft.publisher || '',
    place: draft.place || '',
    year: draft.year || null,
    doi: draft.doi || '',
    isbn: draft.isbn || '',
    csl_type: draft.csl_type || 'website',
    accessed_at: draft.accessed_at || '',
    note: draft.note || '',
  };
}

/**
 * Baut den Koerper fuer `POST /capture` — VOLLSTAENDIG.
 *
 * Er trug lange nur die Haelfte der Felder: ohne `csl_type` setzt der Server
 * `website`, und `editors`, `publisher`, `place`, `isbn` und `note` fielen
 * ersatzlos weg. Ein Buch mit ISBN verlor auf dem besseren Weg also Angaben,
 * die der Fallback-Pfad vollstaendig uebertrug.
 *
 * `source` traegt wie in `POST /research` die Herkunfts-URL als String;
 * `url` ist die Adresse, aus der der Server die Quelle bildet.
 *
 * Die bibliografischen Felder stammen aus `sourceFields` — derselbe Ort, an
 * dem auch `buildSourcePayload` sie zieht. So kann der bessere Weg nicht das
 * schlechtere Ergebnis liefern.
 *
 * @param {import('../shared/config.js').CaptureIntent} intent
 * @returns {{ payload: Record<string, any>, truncations: import('../shared/limits.js').Truncation[] }}
 */
export function buildCapturePayload(intent) {
  /** @type {Partial<import('../shared/config.js').SourceDraft>} */
  const draft = intent.source || {};
  const url = intent.normalizedUrl || intent.url || '';

  const payload = {
    book_id: intent.bookId,
    mode: intent.mode,
    url: draft.url || url,
    title: intent.title,
    body: intent.body,
    kind: intent.kind,
    tags: Array.isArray(intent.tags) ? intent.tags : [],
    source: url,
    ...sourceFields(draft),
  };

  return clampCapturePayload(payload, { verbatimBody: isVerbatim(intent) });
}

/**
 * Traegt dieser Auftrag einen wortwoertlichen Fund?
 *
 * Dann darf `body` nicht gekuerzt werden — im Grenzfall wird der Auftrag
 * sichtbar abgelehnt. Siehe CLAUDE.md, „Wortlauttreue".
 *
 * @param {import('../shared/config.js').CaptureIntent} intent
 */
function isVerbatim(intent) {
  return intent.kind === 'quote';
}

/**
 * Kann dieser Auftrag ueberhaupt ueber `POST /capture` gehen?
 *
 * `/capture` kennt kein `citekey`, und zwar mit Absicht: der Zitierschluessel
 * ist Sache der Autorin oder des Autors, `409 CITEKEY_TAKEN` deckt dort nur
 * den Wettlauf zweier gleichzeitiger Anfragen ab (geklaert am 2026-08-02).
 * Wer einen vergeben hat, nimmt deshalb dauerhaft den Fallback-Pfad — dort
 * nimmt `POST /sources` ihn an. Ihn auf dem Ein-Request-Pfad einfach
 * mitzuschicken waere ein erfundenes Feld; ihn wegzulassen waere stiller
 * Datenverlust.
 *
 * @param {import('../shared/config.js').CaptureIntent} intent
 */
export function unifiedCaptureFits(intent) {
  return !hasText(intent.source && intent.source.citekey);
}

/**
 * @param {import('../shared/config.js').CaptureIntent} intent
 * @returns {{ payload: Record<string, any>, truncations: import('../shared/limits.js').Truncation[] }}
 */
export function buildResearchPayload(intent) {
  /** @type {Array<{url: string, label: string}>} */
  const urls = [];
  const seen = new Set();
  for (const entry of intent.urls || []) {
    if (!entry || !hasText(entry.url)) continue;
    const value = entry.url.trim();
    // Verglichen wird nach SERVER-Regeln, gesendet wird der Wortlaut. Zwei
    // Adressen, die der Server verschmilzt, duerfen hier nicht als zwei
    // Verweise landen. Was er nicht parsen kann, bleibt mit sich selbst
    // verglichen — lieber ein Verweis zu viel als einer verschluckt.
    const key = serverNormalizeUrl(value) || value;
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push({ url: value, label: entry.label || '' });
  }

  return clampResearchPayload(
    {
      book_id: intent.bookId,
      kind: intent.kind,
      title: intent.title,
      body: intent.body,
      // Laut Absprache: `source` traegt die Herkunfts-URL als String.
      source: intent.normalizedUrl || intent.url || '',
      urls,
      tags: Array.isArray(intent.tags) ? intent.tags : [],
    },
    { verbatimBody: isVerbatim(intent) },
  );
}

/**
 * @param {import('../shared/config.js').CaptureIntent} intent
 * @returns {{ payload: Record<string, any>, truncations: import('../shared/limits.js').Truncation[] }}
 */
export function buildSourcePayload(intent) {
  /** @type {Partial<import('../shared/config.js').SourceDraft>} */
  const draft = intent.source || {};
  const fallbackUrl = intent.normalizedUrl || intent.url || '';
  /** @type {Record<string, any>} */
  const payload = {
    title: draft.title || '',
    url: draft.url || fallbackUrl,
    ...sourceFields(draft),
  };
  if (hasText(draft.citekey)) payload.citekey = draft.citekey.trim();
  return clampSourcePayload(payload);
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
        // Wiederverwendet, nicht angelegt — genau das soll der Nutzer erfahren.
        progress.sourceCreated = false;
        progress.via = progress.via || 'split';
        if (found.linked_to_book && intent.bookId && !progress.linkedBookIds.includes(intent.bookId)) {
          progress.linkedBookIds.push(intent.bookId);
          progress.sourceLinked = true;
        }
        log('source-reused', { id: progress.sourceId });
        return;
      }
    } catch (error) {
      const err = /** @type {any} */ (error);
      if (isRouteMissing(err) && onCapabilityMissing) onCapabilityMissing('byUrl');
      // 404 heisst hier schlicht: noch nicht in der Bibliothek. Weitermachen.
      if (err.status !== 404 && err.status !== 405) throw error;
    }
  }

  const { payload } = buildSourcePayload(intent);
  const problems = validateSourcePayload(payload);
  if (problems.length) throwValidation(problems);

  let source;
  try {
    source = await api.createSource(payload);
  } catch (error) {
    const err = /** @type {any} */ (error);
    if (err.code === 'CITEKEY_TAKEN' && payload.citekey) {
      // Vertragsgemaess: ohne citekey erneut senden, Server vergibt einen.
      //
      // Den Schluessel hat der Nutzer selbst eingetippt — dass er nicht
      // uebernommen wurde, gehoert an den Auftrag und von dort in die
      // Quittung. Ohne diesen Vermerk meldet die Erweiterung „gespeichert"
      // ueber eine Quelle, die unter einem anderen Schluessel liegt als dem
      // gewaehlten. Genau dieser stille Verlust ist auch die Begruendung
      // dafuer, dass ein Auftrag mit `citekey` ueberhaupt diesen Weg nimmt
      // (siehe `unifiedCaptureFits`) — dann darf er hier nicht doch passieren.
      log('citekey-taken-retry', { citekey: payload.citekey });
      progress.citekeyDropped = payload.citekey;
      const { citekey, ...withoutCitekey } = payload;
      source = await api.createSource(withoutCitekey);
    } else {
      throw error;
    }
  }

  progress.sourceId = source && source.id !== undefined ? source.id : null;
  progress.sourceCreated = true;
  progress.via = progress.via || 'split';
  log('source-created', { id: progress.sourceId });
}

/**
 * Screenshot und PDF nachreichen.
 *
 * Die Groesse wird VOR dem Request geprueft. Nicht aus Hoeflichkeit: Body-Parser
 * und Route haben dieselbe Schwelle, der Parser kommt zuerst, und was er
 * zurueckgibt, ist ein `413` ohne `error_code` als HTML-Seite. Ohne die Pruefung
 * hier bekaeme der Nutzer „Der Server hat die Uebertragung abgebrochen" statt
 * „das PDF ist zu gross".
 *
 * Beide Endpunkte heissen `doc` — auch der der Quelle. `/sources/:id/pdf` gibt
 * es nicht.
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
    const data = toBinary(bytes);
    throwIfTooLarge(byteLength(data), 'image');
    await api.uploadResearchImage(progress.researchItemId, data, contentType || 'image/jpeg');
    progress.imageUploaded = true;
    log('image-uploaded', { id: progress.researchItemId });
  }

  if (attachments.pdf && !progress.pdfUploaded) {
    const data = toBinary(attachments.pdf.bytes);
    throwIfTooLarge(byteLength(data), 'doc');
    const name = attachments.pdf.name || '';
    if (progress.sourceId) {
      await api.uploadSourceDoc(progress.sourceId, data, name);
      progress.pdfUploaded = true;
      log('source-doc-uploaded', { sourceId: progress.sourceId });
    } else if (progress.researchItemId) {
      await api.uploadResearchDoc(progress.researchItemId, data, name);
      progress.pdfUploaded = true;
      log('research-doc-uploaded', { researchItemId: progress.researchItemId });
    }
  }
}

/**
 * @param {Uint8Array|ArrayBuffer} data
 * @returns {number}
 */
function byteLength(data) {
  return data.byteLength;
}

/**
 * @param {number} bytes
 * @param {'image'|'doc'} kind
 */
function throwIfTooLarge(bytes, kind) {
  const problem = validateBinarySize(bytes, kind);
  if (!problem) return;
  throw new ApiError({
    status: 413,
    code: kind === 'image' ? 'CLIENT_IMAGE_TOO_LARGE' : 'CLIENT_DOC_TOO_LARGE',
    params: problem.params,
    message: `${kind} ${bytes} bytes`,
  });
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
