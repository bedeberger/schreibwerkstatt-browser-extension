import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LIMITS,
  validateBinarySize,
  validateResearchPayload,
  validateSourcePayload,
} from '../src/shared/limits.js';

const keys = (problems) => problems.map((problem) => problem.key);

describe('validateResearchPayload', () => {
  it('nimmt eine gueltige Payload an', () => {
    assert.deepEqual(
      validateResearchPayload({ book_id: 1, kind: 'quote', title: 'Titel', body: 'Text' }),
      [],
    );
  });

  it('verlangt ein Buch', () => {
    assert.ok(keys(validateResearchPayload({ title: 'x' })).includes('validation_book_required'));
  });

  it('verlangt Titel, Text ODER eine URL', () => {
    assert.ok(
      keys(validateResearchPayload({ book_id: 1, title: '', body: '' })).includes(
        'validation_research_empty',
      ),
    );
    // Eine URL allein genuegt.
    assert.deepEqual(
      keys(validateResearchPayload({ book_id: 1, source: 'https://example.org' })),
      [],
    );
    assert.deepEqual(
      keys(validateResearchPayload({ book_id: 1, urls: [{ url: 'https://example.org' }] })),
      [],
    );
  });

  it('prueft die Titellaenge gegen 300', () => {
    const problems = validateResearchPayload({ book_id: 1, title: 'x'.repeat(301) });
    assert.deepEqual(keys(problems), ['validation_title_too_long']);
    assert.deepEqual(problems[0].params, { max: 300, actual: 301 });
  });

  it('prueft die Textlaenge gegen 20000', () => {
    const problems = validateResearchPayload({ book_id: 1, body: 'x'.repeat(LIMITS.BODY_MAX + 1) });
    assert.deepEqual(keys(problems), ['validation_body_too_long']);
  });

  it('prueft die Art', () => {
    assert.ok(
      keys(validateResearchPayload({ book_id: 1, kind: 'zettel', title: 'x' })).includes(
        'validation_kind_invalid',
      ),
    );
  });
});

describe('validateSourcePayload', () => {
  const base = { csl_type: 'website', title: 'Titel' };

  it('nimmt eine gueltige Payload an', () => {
    assert.deepEqual(validateSourcePayload(base), []);
  });

  it('spiegelt SOURCE_IDENTITY_REQ: Titel ODER Person', () => {
    assert.ok(
      keys(validateSourcePayload({ csl_type: 'website' })).includes('validation_source_identity'),
    );
    // Eine Person allein genuegt.
    assert.deepEqual(
      validateSourcePayload({ csl_type: 'website', authors: [{ family: 'Muster', given: 'Max' }] }),
      [],
    );
    // Auch ein literal zaehlt als Person.
    assert.deepEqual(
      validateSourcePayload({ csl_type: 'website', editors: [{ literal: 'Abendpost AG' }] }),
      [],
    );
    // Leere Personenobjekte zaehlen nicht.
    assert.ok(
      keys(validateSourcePayload({ csl_type: 'website', authors: [{ family: '', given: '' }] })).includes(
        'validation_source_identity',
      ),
    );
  });

  it('prueft den CSL-Typ', () => {
    assert.ok(
      keys(validateSourcePayload({ ...base, csl_type: 'blogpost' })).includes(
        'validation_csl_type_invalid',
      ),
    );
  });

  it('verlangt http(s) fuer die URL', () => {
    assert.ok(
      keys(validateSourcePayload({ ...base, url: 'ftp://example.org' })).includes('validation_url_scheme'),
    );
    assert.deepEqual(validateSourcePayload({ ...base, url: 'https://example.org' }), []);
  });

  it('prueft das Jahr', () => {
    assert.ok(keys(validateSourcePayload({ ...base, year: 'neulich' })).includes('validation_year_invalid'));
    assert.deepEqual(validateSourcePayload({ ...base, year: 2019 }), []);
    assert.deepEqual(validateSourcePayload({ ...base, year: null }), []);
    assert.deepEqual(validateSourcePayload({ ...base, year: '' }), []);
  });
});

describe('validateBinarySize', () => {
  it('laesst zu, was hineinpasst', () => {
    assert.equal(validateBinarySize(1024, 'image'), null);
    assert.equal(validateBinarySize(LIMITS.DOC_MAX_BYTES, 'doc'), null);
  });

  it('lehnt zu grosse Bilder ab (12 MB)', () => {
    const problem = validateBinarySize(LIMITS.IMAGE_MAX_BYTES + 1, 'image');
    assert.equal(problem.key, 'validation_image_too_large');
    assert.equal(problem.params.max, 12);
  });

  it('lehnt zu grosse PDFs ab (25 MB)', () => {
    const problem = validateBinarySize(LIMITS.DOC_MAX_BYTES + 1, 'doc');
    assert.equal(problem.key, 'validation_doc_too_large');
    assert.equal(problem.params.max, 25);
  });
});
