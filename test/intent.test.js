/**
 * Erntedaten -> Auftrag, inklusive Haupttext-Extraktion.
 * Popup und Kontextmenue teilen sich diesen Weg; er muss beidseitig stimmen.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractArticleText } from '../src/content/article-text.js';
import { harvestMetadata } from '../src/content/extract-meta.js';
import { LIMITS } from '../src/shared/limits.js';
import { intentFromHarvest, mergeLookup } from '../src/shared/intent.js';
import { loadFixture } from './helpers/dom.js';

const NOW = new Date(2026, 6, 31);

/**
 * Baut das, was `content/harvest.js` im Browser zurueckgibt.
 * @param {Document} doc
 * @param {string} url
 * @param {string} [selection]
 */
function harvestLike(doc, url, selection = '') {
  const meta = harvestMetadata(doc, { url, now: NOW });
  const article = extractArticleText(doc, LIMITS.BODY_MAX);
  const hasSelection = selection.trim().length > 0;
  return {
    meta,
    article,
    selectionText: selection,
    hasSelection,
    suggestedBody: hasSelection ? selection : article.text,
    suggestedKind: hasSelection ? 'quote' : 'link',
    bodyTruncated: hasSelection ? false : article.truncated,
    bodyOriginalLength: hasSelection ? selection.length : article.originalLength,
  };
}

describe('extractArticleText', () => {
  it('holt den Fliesstext eines Artikels', async () => {
    const doc = await loadFixture('blog-og.html', 'https://kestrel.example.net/posts/standing-desk');
    const article = extractArticleText(doc);
    assert.ok(article.text.includes('burst of optimism'));
    assert.ok(article.text.includes('kitchen timer'));
    assert.equal(article.truncated, false);
  });

  it('kommt auch ohne <article> zurecht', async () => {
    const doc = await loadFixture('bare.html', 'https://gemeinde.example.ch/p');
    const article = extractArticleText(doc);
    assert.ok(article.text.includes('Gemeindepräsidenten'));
  });

  it('kuerzt an einer Satzgrenze und meldet das', async () => {
    const doc = await loadFixture('blog-og.html', 'https://kestrel.example.net/posts/standing-desk');
    const article = extractArticleText(doc, 200);
    assert.equal(article.truncated, true);
    assert.ok(article.text.length <= 200);
    assert.ok(/[.!?]$/.test(article.text), `endet nicht an einer Satzgrenze: …${article.text.slice(-40)}`);
    assert.ok(article.originalLength > 200);
  });

  it('laesst das Seiten-DOM unangetastet', async () => {
    const doc = await loadFixture('blog-og.html', 'https://kestrel.example.net/posts/standing-desk');
    const before = doc.body.innerHTML;
    extractArticleText(doc);
    assert.equal(doc.body.innerHTML, before);
  });

  it('fasst eingerueckten Fliesstext zu einem Absatz zusammen', async () => {
    const doc = await loadFixture('indented-prose.html', 'https://example.org/probe');
    const article = extractArticleText(doc);
    // Readability liefert den ganzen Artikel als einen Block ohne \n\n-Trennung;
    // die eigentliche Anforderung: KEIN einzelner Zeilenumbruch im Fliesstext.
    assert.ok(!article.text.includes('\n'), `Soft-Wraps uebrig in:\n${article.text}`);
    // Die HTML-Einrueckungen sind zu Leerzeichen geworden, nicht zu Umbruechen.
    assert.ok(article.text.includes('Block umbrochen werden.'), 'Satzgrenze verloren');
  });
});

describe('intentFromHarvest', () => {
  it('fuellt aus einer Verlagsseite einen vollstaendigen Quellen-Entwurf', async () => {
    const url = 'https://press.example.org/articles/jfs-2019-0417';
    const doc = await loadFixture('publisher-citation.html', url);
    const intent = intentFromHarvest(harvestLike(doc, url), {
      mode: 'both',
      bookId: 7,
      bookName: 'Nordlicht',
    });

    assert.equal(intent.mode, 'both');
    assert.equal(intent.bookId, 7);
    assert.equal(intent.title, 'Sediment transport under partial ice cover');
    assert.equal(intent.source.csl_type, 'article');
    assert.equal(intent.source.container_title, 'Journal of Fluvial Studies');
    assert.equal(intent.source.year, 2019);
    assert.equal(intent.source.doi, '10.1234/jfs.2019.0417');
    assert.equal(intent.source.accessed_at, '2026-07-31');
    assert.equal(intent.source.url, 'https://press.example.org/articles/jfs-2019-0417');
    // Das PDF wandert als Zusatzlink mit.
    assert.ok(intent.urls.some((entry) => entry.label === 'PDF'));
  });

  it('ohne Markierung ist die Art `link` bzw. die Voreinstellung', async () => {
    const url = 'https://kestrel.example.net/posts/standing-desk';
    const doc = await loadFixture('blog-og.html', url);

    assert.equal(intentFromHarvest(harvestLike(doc, url), {}).kind, 'link');
    assert.equal(intentFromHarvest(harvestLike(doc, url), { defaultKind: 'note' }).kind, 'note');
  });

  it('eine Markierung hat Vorrang und bleibt WORTWOERTLICH', async () => {
    const url = 'https://kestrel.example.net/posts/standing-desk';
    const doc = await loadFixture('blog-og.html', url);
    // Absichtlich mit Rand-Weissraum, weichen Anfuehrungszeichen und Umbruch.
    const selection = '  „Standing badly is not obviously better\n   than sitting badly.“  ';

    const intent = intentFromHarvest(harvestLike(doc, url, selection), {});

    assert.equal(intent.kind, 'quote');
    assert.equal(intent.body, selection, 'kein Trim, keine Normalisierung im Zitat');
  });

  it('kuerzt den geernteten Fliesstext, nicht aber ein Zitat', async () => {
    const url = 'https://example.org/x';
    const doc = await loadFixture('bare.html', url);

    const long = 'Satz eins. '.repeat(4000); // > 20000 Zeichen
    const harvested = harvestLike(doc, url, long);
    const quoteIntent = intentFromHarvest(harvested, {});
    // Ein zu langes Zitat wird nicht heimlich beschnitten — die Pruefung
    // im Popup lehnt es sichtbar ab.
    assert.equal(quoteIntent.body.length, long.length);

    const pageIntent = intentFromHarvest({ ...harvested, hasSelection: false, selectionText: '' }, {});
    assert.ok(pageIntent.body.length <= LIMITS.BODY_MAX);
  });

  it('nimmt die kanonische URL als normalisierte Fassung', async () => {
    const url = 'https://kestrel.example.net/posts/standing-desk?utm_source=rss';
    const doc = await loadFixture('blog-og.html', url);
    const intent = intentFromHarvest(harvestLike(doc, url), {});
    assert.equal(intent.normalizedUrl, 'https://kestrel.example.net/posts/standing-desk');
    assert.equal(intent.url, url);
  });

  it('faellt bei unbekanntem Modus auf `research` zurueck', async () => {
    const doc = await loadFixture('bare.html', 'https://example.org/x');
    const intent = intentFromHarvest(harvestLike(doc, 'https://example.org/x'), { mode: 'quatsch' });
    assert.equal(intent.mode, 'research');
  });
});

describe('mergeLookup', () => {
  const draft = {
    csl_type: 'website',
    title: 'Geraten: Sediment transport | JFS',
    authors: [{ family: 'Halvorsen', given: 'I.' }],
    editors: [],
    container_title: 'press.example.org',
    publisher: '',
    place: '',
    year: null,
    url: 'https://press.example.org/a',
    doi: '10.1234/jfs.2019.0417',
    isbn: '',
    accessed_at: '2026-07-31',
    note: '',
  };

  it('kanonische Angaben schlagen geerntete', () => {
    const { draft: merged, changed } = mergeLookup(draft, {
      source: {
        csl_type: 'article',
        title: 'Sediment transport under partial ice cover',
        authors: [
          { family: 'Halvorsen', given: 'Ingrid M.' },
          { family: 'Okonkwo', given: 'Chidi' },
        ],
        container_title: 'Journal of Fluvial Studies',
        publisher: 'Northfield Academic Press',
        year: 2019,
      },
    });

    assert.equal(merged.csl_type, 'article');
    assert.equal(merged.title, 'Sediment transport under partial ice cover');
    assert.equal(merged.authors.length, 2);
    assert.equal(merged.year, 2019);
    assert.ok(changed.includes('title'));
    assert.ok(changed.includes('authors'));
  });

  it('leere Lookup-Felder ueberschreiben nichts', () => {
    const { draft: merged, changed } = mergeLookup(draft, {
      source: { title: '', authors: [], publisher: null, year: undefined },
    });
    assert.equal(merged.title, draft.title);
    assert.deepEqual(merged.authors, draft.authors);
    assert.deepEqual(changed, []);
  });

  it('akzeptiert die Antwort auch ohne `source`-Huelle', () => {
    const { draft: merged } = mergeLookup(draft, { publisher: 'Northfield Academic Press' });
    assert.equal(merged.publisher, 'Northfield Academic Press');
  });

  it('vertraegt Unsinn', () => {
    assert.deepEqual(mergeLookup(draft, null).changed, []);
    assert.deepEqual(mergeLookup(draft, 'nope').changed, []);
  });
});
