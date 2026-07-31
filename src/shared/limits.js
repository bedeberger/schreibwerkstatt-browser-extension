/**
 * Serverseitige Grenzwerte, clientseitig gespiegelt.
 * Wir pruefen vorher, damit der Nutzer eine klare Meldung bekommt
 * statt eines nackten 400 nach dem Absenden.
 */

export const LIMITS = Object.freeze({
  TITLE_MAX: 300,
  BODY_MAX: 20000,
  IMAGE_MAX_BYTES: 12 * 1024 * 1024,
  DOC_MAX_BYTES: 25 * 1024 * 1024,
});

/** @type {readonly string[]} */
export const RESEARCH_KINDS = Object.freeze(['note', 'link', 'quote', 'fact']);

/** @type {readonly string[]} */
export const CSL_TYPES = Object.freeze([
  'book',
  'chapter',
  'article',
  'website',
  'thesis',
  'report',
  'legal',
  'interview',
  'film',
  'dataset',
  'other',
]);

/** @type {readonly string[]} */
export const CAPTURE_MODES = Object.freeze(['research', 'source', 'both']);

/**
 * @typedef {{ field: string, key: string, params?: Record<string, string|number> }} ValidationProblem
 */

const hasText = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * Prueft eine `POST /research`-Payload gegen die dokumentierten Grenzen.
 * @param {Record<string, any>} payload
 * @returns {ValidationProblem[]}
 */
export function validateResearchPayload(payload = {}) {
  /** @type {ValidationProblem[]} */
  const problems = [];

  if (payload.book_id === undefined || payload.book_id === null || payload.book_id === '') {
    problems.push({ field: 'book_id', key: 'validation_book_required' });
  }

  if (payload.kind !== undefined && !RESEARCH_KINDS.includes(payload.kind)) {
    problems.push({ field: 'kind', key: 'validation_kind_invalid' });
  }

  const title = typeof payload.title === 'string' ? payload.title : '';
  if (title.length > LIMITS.TITLE_MAX) {
    problems.push({
      field: 'title',
      key: 'validation_title_too_long',
      params: { max: LIMITS.TITLE_MAX, actual: title.length },
    });
  }

  const body = typeof payload.body === 'string' ? payload.body : '';
  if (body.length > LIMITS.BODY_MAX) {
    problems.push({
      field: 'body',
      key: 'validation_body_too_long',
      params: { max: LIMITS.BODY_MAX, actual: body.length },
    });
  }

  // "mindestens eines von title/body/url muss gesetzt sein"
  const anyUrl =
    hasText(payload.source) ||
    (Array.isArray(payload.urls) && payload.urls.some((u) => hasText(u && u.url)));
  if (!hasText(title) && !hasText(body) && !anyUrl) {
    problems.push({ field: 'title', key: 'validation_research_empty' });
  }

  return problems;
}

/**
 * Prueft eine `POST /sources`-Payload.
 * @param {Record<string, any>} payload
 * @returns {ValidationProblem[]}
 */
export function validateSourcePayload(payload = {}) {
  /** @type {ValidationProblem[]} */
  const problems = [];

  if (!payload.csl_type || !CSL_TYPES.includes(payload.csl_type)) {
    problems.push({ field: 'csl_type', key: 'validation_csl_type_invalid' });
  }

  const people = [
    ...(Array.isArray(payload.authors) ? payload.authors : []),
    ...(Array.isArray(payload.editors) ? payload.editors : []),
  ];
  const anyPerson = people.some(
    (p) => p && (hasText(p.family) || hasText(p.given) || hasText(p.literal)),
  );

  // Spiegelt SOURCE_IDENTITY_REQ: mindestens Titel ODER eine Person.
  if (!hasText(payload.title) && !anyPerson) {
    problems.push({ field: 'title', key: 'validation_source_identity' });
  }

  if (hasText(payload.url) && !/^https?:\/\//i.test(payload.url.trim())) {
    problems.push({ field: 'url', key: 'validation_url_scheme' });
  }

  if (hasText(payload.title) && payload.title.length > LIMITS.TITLE_MAX) {
    problems.push({
      field: 'title',
      key: 'validation_title_too_long',
      params: { max: LIMITS.TITLE_MAX, actual: payload.title.length },
    });
  }

  if (payload.year !== undefined && payload.year !== null && payload.year !== '') {
    const year = Number(payload.year);
    if (!Number.isInteger(year) || year < 1 || year > 2999) {
      problems.push({ field: 'year', key: 'validation_year_invalid' });
    }
  }

  return problems;
}

/**
 * @param {number} bytes
 * @param {'image'|'doc'} kind
 * @returns {ValidationProblem|null}
 */
export function validateBinarySize(bytes, kind) {
  const max = kind === 'image' ? LIMITS.IMAGE_MAX_BYTES : LIMITS.DOC_MAX_BYTES;
  if (bytes > max) {
    return {
      field: kind,
      key: kind === 'image' ? 'validation_image_too_large' : 'validation_doc_too_large',
      params: { max: Math.round(max / (1024 * 1024)), actual: (bytes / (1024 * 1024)).toFixed(1) },
    };
  }
  return null;
}
