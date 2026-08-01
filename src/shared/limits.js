/**
 * Serverseitige Grenzwerte, clientseitig gespiegelt.
 *
 * Zwei verschiedene Sorten Grenze, und die Unterscheidung ist der ganze Punkt:
 *
 *  - **Textfelder kuerzt der Server still.** Er lehnt nicht ab, er schneidet ab
 *    und antwortet 2xx. Wer das nicht spiegelt, zeigt eine Quittung ueber einen
 *    Text, der so nie gespeichert wurde. Deshalb kuerzen wir VORHER und sagen es
 *    — siehe `clampResearchPayload` / `clampSourcePayload`.
 *  - **Uploads und der JSON-Koerper laufen in den Body-Parser.** Der antwortet
 *    mit Express' Default: `413` **ohne** `error_code`, als HTML. Deshalb pruefen
 *    wir die Groesse vor dem Request — `validateBinarySize`, `jsonByteLength`.
 *
 * Eine Ausnahme von „kuerzen statt ablehnen" ist Absicht und steht in CLAUDE.md:
 * der Wortlaut eines markierten Zitats wird nie beschnitten, sondern im
 * Grenzfall sichtbar abgelehnt.
 */

export const LIMITS = Object.freeze({
  TITLE_MAX: 300,
  BODY_MAX: 20000,
  /** `source` in `POST /research` — Freitext, traegt bei uns die Herkunfts-URL. */
  SOURCE_MAX: 1000,
  TAG_MAX: 60,
  TAGS_MAX: 20,
  URL_MAX: 2000,
  URLS_MAX: 20,
  URL_LABEL_MAX: 300,
  /** Dateiname im `?name=` der Anhang-Endpunkte. */
  DOC_NAME_MAX: 200,
  IMAGE_MAX_BYTES: 12 * 1024 * 1024,
  DOC_MAX_BYTES: 25 * 1024 * 1024,
  /**
   * JSON-Koerper von `POST /capture`. Darueber greift der Body-Parser, nicht
   * die Route: 413 ohne `error_code`.
   */
  CAPTURE_JSON_MAX_BYTES: 256 * 1024,
  /**
   * Aus einem PDF gespeicherter Text. Der Server meldet die Kuerzung selbst
   * mit `doc_truncated: true` — wir muessen sie nur weitergeben.
   */
  DOC_TEXT_MAX: 200000,
});

/**
 * Grenzen des Lesepfads `GET /research`.
 *
 * `FTS_PREFILTER_CAP` ist der wichtigste Wert und der einzige, den der Client
 * nicht durchsetzen, sondern nur BERICHTEN kann: eine Query `q` laeuft
 * serverseitig durch einen FTS5-Vorfilter, der nach 500 Treffern abschneidet —
 * und zwar BEVOR `kind`, `tag`, `sort` und `limit` greifen. In einem grossen
 * Buch ist „nichts gefunden" nach einer breiten Query deshalb keine Aussage
 * ueber den Bestand, sondern nur ueber die ersten 500 Zeilen. Wer das Ergebnis
 * anzeigt, muss es als unvollstaendig kennzeichnen.
 */
export const RESEARCH_LIST = Object.freeze({
  LIMIT_DEFAULT: 50,
  LIMIT_MAX: 200,
  FTS_PREFILTER_CAP: 500,
  SNIPPET_MAX: 200,
});

/**
 * `kind`-Werte, die der Lesepfad kennt. Absichtlich laenger als
 * `RESEARCH_KINDS`: schreiben kann die Erweiterung nur vier Arten, lesen
 * bekommt sie auch `image` und `document` zurueck.
 *
 * @type {readonly string[]}
 */
export const RESEARCH_LIST_KINDS = Object.freeze(['note', 'link', 'quote', 'fact', 'image', 'document']);

/** @type {readonly string[]} */
export const RESEARCH_LIST_SORTS = Object.freeze(['updated', 'created', 'title', 'kind']);

/** @type {readonly string[]} */
export const RESEARCH_KINDS = Object.freeze(['note', 'link', 'quote', 'fact']);

/**
 * Bringt `limit` in den vom Server akzeptierten Bereich.
 * Der Server faellt bei 0, negativ oder Text stillschweigend auf seinen
 * Default zurueck; wir schicken dann lieber gar nichts mit, damit im Log
 * steht, was wirklich gemeint war.
 *
 * @param {unknown} value
 * @returns {number|null} null = Parameter weglassen
 */
export function clampResearchLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const whole = Math.trunc(number);
  if (whole < 1) return null;
  return Math.min(whole, RESEARCH_LIST.LIMIT_MAX);
}

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

/**
 * Ein Feld, das beim Senden gekuerzt wird. `actual` ist die Laenge (bzw. die
 * Anzahl) VOR dem Kuerzen — nur damit laesst sich dem Nutzer sagen, wie viel
 * verloren geht.
 *
 * @typedef {{ field: string, max: number, actual: number }} Truncation
 */

const hasText = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * Kuerzt genau so, wie der Server es tut: hart auf `max` Zeichen, ohne
 * Ruecksicht auf Wortgrenzen. Absichtlich nicht `truncateAtSentence` — wir
 * wollen dasselbe Ergebnis wie die Gegenstelle, nicht ein schoeneres.
 *
 * @param {unknown} value
 * @param {number} max
 * @returns {string}
 */
function cut(value, max) {
  const text = typeof value === 'string' ? value : '';
  return text.length > max ? text.slice(0, max) : text;
}

/**
 * Kuerzt eine `POST /research`-Payload auf die serverseitigen Grenzen.
 *
 * Rueckgabe ist eine Kopie; die uebergebene Payload bleibt unberuehrt, damit
 * das Popup dieselbe Funktion nur zum VORHERSAGEN benutzen kann.
 *
 * @param {Record<string, any>} payload
 * @param {object} [options]
 * @param {boolean} [options.verbatimBody] Wortlaut nicht antasten (Zitat).
 *   Dann bleibt `body` stehen und `validateResearchPayload` lehnt ab.
 * @returns {{ payload: Record<string, any>, truncations: Truncation[] }}
 */
export function clampResearchPayload(payload = {}, { verbatimBody = false } = {}) {
  const next = { ...payload };
  /** @type {Truncation[]} */
  const truncations = [];

  /** @param {string} field @param {number} max */
  const clampField = (field, max) => {
    const value = next[field];
    if (typeof value !== 'string' || value.length <= max) return;
    truncations.push({ field, max, actual: value.length });
    next[field] = cut(value, max);
  };

  clampField('title', LIMITS.TITLE_MAX);
  if (!verbatimBody) clampField('body', LIMITS.BODY_MAX);
  clampField('source', LIMITS.SOURCE_MAX);

  if (Array.isArray(next.tags)) {
    const tags = next.tags.filter((tag) => typeof tag === 'string');
    if (tags.length > LIMITS.TAGS_MAX) {
      truncations.push({ field: 'tags', max: LIMITS.TAGS_MAX, actual: tags.length });
    }
    const kept = tags.slice(0, LIMITS.TAGS_MAX);
    if (kept.some((tag) => tag.length > LIMITS.TAG_MAX)) {
      truncations.push({
        field: 'tags',
        max: LIMITS.TAG_MAX,
        actual: Math.max(...kept.map((tag) => tag.length)),
      });
    }
    next.tags = kept.map((tag) => cut(tag, LIMITS.TAG_MAX));
  }

  if (Array.isArray(next.urls)) {
    const urls = next.urls.filter((entry) => entry && typeof entry.url === 'string');
    if (urls.length > LIMITS.URLS_MAX) {
      truncations.push({ field: 'urls', max: LIMITS.URLS_MAX, actual: urls.length });
    }
    const kept = urls.slice(0, LIMITS.URLS_MAX);
    if (kept.some((entry) => entry.url.length > LIMITS.URL_MAX)) {
      truncations.push({
        field: 'urls',
        max: LIMITS.URL_MAX,
        actual: Math.max(...kept.map((entry) => entry.url.length)),
      });
    }
    next.urls = kept.map((entry) => ({
      url: cut(entry.url, LIMITS.URL_MAX),
      label: cut(entry.label || '', LIMITS.URL_LABEL_MAX),
    }));
  }

  return { payload: next, truncations };
}

/**
 * Kuerzt eine `POST /sources`-Payload. Nur `title` und `url` haben eine
 * dokumentierte Grenze — `container_title`, `publisher`, `place` und `note`
 * bekommen ausdruecklich KEINE erfundene.
 *
 * @param {Record<string, any>} payload
 * @returns {{ payload: Record<string, any>, truncations: Truncation[] }}
 */
export function clampSourcePayload(payload = {}) {
  const next = { ...payload };
  /** @type {Truncation[]} */
  const truncations = [];

  for (const [field, max] of [
    ['title', LIMITS.TITLE_MAX],
    ['url', LIMITS.URL_MAX],
  ]) {
    const value = next[field];
    if (typeof value !== 'string' || value.length <= Number(max)) continue;
    truncations.push({ field: String(field), max: Number(max), actual: value.length });
    next[field] = cut(value, Number(max));
  }

  return { payload: next, truncations };
}

/**
 * Kuerzt eine `POST /capture`-Payload. Sie traegt Recherche- und Quellenfelder
 * in einem Koerper, also gelten beide Regelwerke — `title` steht in beiden und
 * hat dieselbe Grenze.
 *
 * @param {Record<string, any>} payload
 * @param {object} [options]
 * @param {boolean} [options.verbatimBody]
 * @returns {{ payload: Record<string, any>, truncations: Truncation[] }}
 */
export function clampCapturePayload(payload = {}, { verbatimBody = false } = {}) {
  const research = clampResearchPayload(payload, { verbatimBody });
  const source = clampSourcePayload(research.payload);
  const seen = new Set(research.truncations.map((entry) => `${entry.field}:${entry.max}`));
  return {
    payload: source.payload,
    truncations: [
      ...research.truncations,
      ...source.truncations.filter((entry) => !seen.has(`${entry.field}:${entry.max}`)),
    ],
  };
}

/**
 * Kuerzt den Dateinamen eines Anhangs auf die Laenge, die der Server behaelt.
 * @param {unknown} value
 * @returns {string}
 */
export function clampAttachmentName(value) {
  return cut(typeof value === 'string' ? value.trim() : '', LIMITS.DOC_NAME_MAX);
}

/**
 * Groesse eines JSON-Koerpers in Bytes — der Body-Parser zaehlt Bytes, nicht
 * Zeichen, und Umlaute wiegen zwei.
 *
 * @param {any} payload
 * @returns {number}
 */
export function jsonByteLength(payload) {
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

/**
 * Prueft eine `POST /research`-Payload gegen die dokumentierten Grenzen.
 *
 * Was der Server still kuerzt, wird hier NICHT beanstandet — dafuer ist
 * `clampResearchPayload` da. Beanstandet wird nur, was der Server wirklich
 * ablehnt (`EMPTY`, `BOOKID_REQ`, `INVALID_VALUE`), und der Wortlaut eines
 * Zitats, den wir nicht heimlich beschneiden wollen.
 *
 * @param {Record<string, any>} payload
 * @param {object} [options]
 * @param {boolean} [options.verbatimBody] Zitat: zu lang heisst ablehnen
 * @returns {ValidationProblem[]}
 */
export function validateResearchPayload(payload = {}, { verbatimBody = false } = {}) {
  /** @type {ValidationProblem[]} */
  const problems = [];

  if (payload.book_id === undefined || payload.book_id === null || payload.book_id === '') {
    problems.push({ field: 'book_id', key: 'validation_book_required' });
  }

  if (payload.kind !== undefined && !RESEARCH_KINDS.includes(payload.kind)) {
    problems.push({ field: 'kind', key: 'validation_kind_invalid' });
  }

  const title = typeof payload.title === 'string' ? payload.title : '';
  const body = typeof payload.body === 'string' ? payload.body : '';

  // Wortlauttreue: ein markiertes Zitat wird sichtbar abgelehnt, nicht gekuerzt.
  if (verbatimBody && body.length > LIMITS.BODY_MAX) {
    problems.push({
      field: 'body',
      key: 'validation_body_too_long',
      params: { max: LIMITS.BODY_MAX, actual: body.length },
    });
  }

  // Spiegelt EMPTY: mindestens eines von title/body/url muss gesetzt sein.
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

  // Spiegelt INVALID_URL: der Server verlangt eine normalisierbare http(s)-URL.
  if (hasText(payload.url) && !/^https?:\/\//i.test(payload.url.trim())) {
    problems.push({ field: 'url', key: 'validation_url_scheme' });
  }

  // Ein zu langer Titel wird gekuerzt, nicht abgelehnt — `clampSourcePayload`.

  if (payload.year !== undefined && payload.year !== null && payload.year !== '') {
    const year = Number(payload.year);
    if (!Number.isInteger(year) || year < 1 || year > 2999) {
      problems.push({ field: 'year', key: 'validation_year_invalid' });
    }
  }

  return problems;
}

/**
 * Groessenpruefung VOR dem Upload.
 *
 * Sie ist nicht Komfort, sondern der einzige Weg zu einer brauchbaren Meldung:
 * Body-Parser und Route haben dieselbe Schwelle (25 MB), und der Parser kommt
 * zuerst. Wer auf `DOC_TOO_LARGE` wartet, wartet vergeblich — was zurueckkommt,
 * ist ein `413` ohne `error_code` als HTML-Seite.
 *
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
