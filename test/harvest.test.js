/**
 * Metadaten-Ernte gegen gespeicherte HTML-Fixtures.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { guessCslType, harvestMetadata } from '../src/content/extract-meta.js';
import { loadFixture } from './helpers/dom.js';

const FIXED_NOW = new Date(2026, 6, 31); // 2026-07-31, lokale Zeit

describe('Ernte: Wissenschaftsverlag mit citation_*', () => {
  const url = 'https://press.example.org/articles/jfs-2019-0417?utm_campaign=toc';
  /** @type {any} */
  let meta;

  it('liest die Fixture', async () => {
    const doc = await loadFixture('publisher-citation.html', url);
    meta = harvestMetadata(doc, { url, now: FIXED_NOW });
  });

  it('bevorzugt citation_title vor og:title und DC.title', () => {
    assert.equal(meta.title, 'Sediment transport under partial ice cover');
    assert.equal(meta.provenance.title, 'citation');
  });

  it('nimmt alle citation_author und zerlegt sie', () => {
    assert.deepEqual(meta.authors, [
      { family: 'Halvorsen', given: 'Ingrid M.' },
      { family: 'Okonkwo', given: 'Chidi' },
      { family: 'van der Meer', given: 'Jan' },
    ]);
    assert.equal(meta.provenance.authors, 'citation');
  });

  it('nimmt das Journal als container_title', () => {
    assert.equal(meta.containerTitle, 'Journal of Fluvial Studies');
    assert.equal(meta.publisher, 'Northfield Academic Press');
  });

  it('zieht Datum und Jahr aus citation_publication_date, nicht aus article:published_time', () => {
    assert.equal(meta.publishedDate, '2019-04-17');
    assert.equal(meta.year, 2019);
  });

  it('findet das DOI', () => {
    assert.equal(meta.doi, '10.1234/jfs.2019.0417');
  });

  it('loest citation_pdf_url absolut auf und erkennt gleiche Herkunft', () => {
    assert.equal(meta.pdfUrl, 'https://press.example.org/articles/jfs-2019-0417/pdf');
    assert.equal(meta.pdfSameOrigin, true);
  });

  it('raet den CSL-Typ article', () => {
    assert.equal(meta.cslType, 'article');
  });

  it('normalisiert die URL auf die kanonische Fassung ohne Tracking', () => {
    assert.equal(meta.normalizedUrl, 'https://press.example.org/articles/jfs-2019-0417');
  });

  it('setzt accessed_at auf heute', () => {
    assert.equal(meta.accessedAt, '2026-07-31');
  });
});

describe('Ernte: Nachrichtenseite mit JSON-LD', () => {
  const url = 'https://abendpost.example.ch/stadt/seeufer-entscheid-verschoben';
  /** @type {any} */
  let meta;

  it('liest die Fixture', async () => {
    const doc = await loadFixture('news-jsonld.html', url);
    meta = harvestMetadata(doc, { url, now: FIXED_NOW });
  });

  it('nimmt headline aus dem NewsArticle-Knoten, nicht og:title', () => {
    assert.equal(meta.title, 'Stadtrat verschiebt Entscheid über Seeufer');
    assert.equal(meta.provenance.title, 'jsonld');
  });

  it('findet den Artikel-Knoten auch im @graph neben einer Organization', () => {
    assert.deepEqual(meta.authors, [
      { family: 'Stauffer', given: 'Miriam' },
      { family: 'Dubois', given: 'Léon' },
    ]);
  });

  it('erkennt den Verlag als Koerperschaft statt ihn zu zerlegen', () => {
    assert.equal(meta.publisher, 'Abendpost Verlag AG');
  });

  it('nimmt datePublished, nicht dateModified', () => {
    assert.equal(meta.publishedDate, '2024-06-11');
    assert.equal(meta.year, 2024);
  });

  it('faellt fuer den Website-Namen auf og:site_name zurueck', () => {
    assert.equal(meta.siteName, 'Abendpost');
  });

  it('bleibt beim CSL-Typ website', () => {
    assert.equal(meta.cslType, 'website');
    assert.equal(meta.containerTitle, 'Abendpost');
  });
});

describe('Ernte: Blog nur mit OpenGraph', () => {
  const url = 'https://kestrel.example.net/posts/standing-desk';
  /** @type {any} */
  let meta;

  it('liest die Fixture', async () => {
    const doc = await loadFixture('blog-og.html', url);
    meta = harvestMetadata(doc, { url, now: FIXED_NOW });
  });

  it('nimmt og:title', () => {
    assert.equal(meta.title, 'Why I stopped using a standing desk');
    assert.equal(meta.provenance.title, 'opengraph');
  });

  it('zerlegt article:author', () => {
    assert.deepEqual(meta.authors, [{ family: 'Raghunathan', given: 'Priya' }]);
  });

  it('nimmt article:published_time', () => {
    assert.equal(meta.publishedDate, '2023-11-02');
    assert.equal(meta.year, 2023);
  });

  it('putzt die Tracking-Parameter aus der og:url', () => {
    assert.equal(meta.canonicalUrl, 'https://kestrel.example.net/posts/standing-desk?utm_source=rss');
    assert.equal(meta.normalizedUrl, 'https://kestrel.example.net/posts/standing-desk');
  });

  it('findet kein DOI und keine ISBN', () => {
    assert.equal(meta.doi, '');
    assert.equal(meta.isbn, '');
  });
});

describe('Ernte: nackte Seite ohne Metadaten', () => {
  const url = 'https://gemeinde-fallstadt.example.ch/protokolle/2024-05-03.html';
  /** @type {any} */
  let meta;

  it('liest die Fixture', async () => {
    const doc = await loadFixture('bare.html', url);
    meta = harvestMetadata(doc, { url, now: FIXED_NOW });
  });

  it('faellt auf document.title zurueck', () => {
    assert.equal(meta.title, 'Protokoll der Gemeindeversammlung vom 3. Mai');
    assert.equal(meta.provenance.title, 'fallback');
  });

  it('findet keine Personen statt welche zu erfinden', () => {
    assert.deepEqual(meta.authors, []);
  });

  it('nimmt den Hostnamen als Website-Namen', () => {
    assert.equal(meta.siteName, 'gemeinde-fallstadt.example.ch');
  });

  it('laesst das Jahr leer, statt eine Zahl aus dem Text zu raten', () => {
    assert.equal(meta.publishedDate, '');
    assert.equal(meta.year, null);
  });

  it('bleibt bei website', () => {
    assert.equal(meta.cslType, 'website');
  });
});

describe('Ernte: Dublin Core', () => {
  const url = 'https://repo.example.edu/eintrag/88421';
  /** @type {any} */
  let meta;

  it('liest die Fixture', async () => {
    const doc = await loadFixture('dublincore.html', url);
    meta = harvestMetadata(doc, { url, now: FIXED_NOW });
  });

  it('nimmt DC.title, weil weder citation_* noch JSON-LD da sind', () => {
    assert.equal(meta.title, 'Zur Rezeption der Lex Salica im Frühmittelalter');
    assert.equal(meta.provenance.title, 'dublincore');
  });

  it('zerlegt mehrere DC.creator, auch mit Sonderzeichen', () => {
    assert.deepEqual(meta.authors, [
      { family: 'Brenner', given: 'Anne-Sophie' },
      { family: 'Ó Súilleabháin', given: 'Cormac' },
    ]);
  });

  it('nimmt DCTERMS.issued', () => {
    assert.equal(meta.publishedDate, '2011-09-30');
    assert.equal(meta.year, 2011);
  });

  it('zieht die ISBN aus DC.identifier und schaltet auf book um', () => {
    assert.equal(meta.isbn, '9783161484100');
    assert.equal(meta.cslType, 'book');
  });
});

describe('DOI aus dem Fliesstext', () => {
  it('greift nur, wenn keine Meta-Angabe existiert', async () => {
    const url = 'https://example.org/paper';
    const doc = await loadFixture('bare.html', url);
    doc.body.insertAdjacentHTML(
      'beforeend',
      '<p>Zitieren als doi:10.5555/abc-123.4 (Stand Mai).</p>',
    );
    const meta = harvestMetadata(doc, { url, now: FIXED_NOW });
    assert.equal(meta.doi, '10.5555/abc-123.4');
    assert.equal(meta.provenance.doi, 'fallback');
    // Mit DOI, aber ohne ISBN: Zeitschriftenartikel.
    assert.equal(meta.cslType, 'article');
  });
});

describe('guessCslType', () => {
  it('ISBN schlaegt DOI', () => {
    assert.equal(guessCslType({ isbn: '9783161484100', doi: '10.1/x' }), 'book');
  });

  it('JSON-LD-Typ schlaegt alles', () => {
    assert.equal(guessCslType({ isbn: '9783161484100', jsonLdTypes: ['thesis'] }), 'thesis');
    assert.equal(guessCslType({ jsonLdTypes: ['ScholarlyArticle'.toLowerCase()] }), 'article');
  });

  it('ohne Anhaltspunkt: website', () => {
    assert.equal(guessCslType({}), 'website');
  });
});
