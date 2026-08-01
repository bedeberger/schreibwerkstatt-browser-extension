import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  hostLabel,
  isHttpUrl,
  isLocalHost,
  normalizeServerUrl,
  normalizeUrl,
  resolveUrl,
  sameOrigin,
  sameResource,
  toOriginPattern,
} from '../src/shared/url.js';

describe('normalizeUrl', () => {
  it('macht Schema und Host klein', () => {
    assert.equal(normalizeUrl('HTTPS://Example.ORG/Pfad'), 'https://example.org/Pfad');
  });

  it('laesst den Pfad in Ruhe — Gross-/Kleinschreibung ist dort bedeutsam', () => {
    assert.equal(normalizeUrl('https://example.org/A/b'), 'https://example.org/A/b');
  });

  it('entfernt Standardports', () => {
    assert.equal(normalizeUrl('https://example.org:443/x'), 'https://example.org/x');
    assert.equal(normalizeUrl('http://example.org:80/x'), 'http://example.org/x');
  });

  it('behaelt abweichende Ports', () => {
    assert.equal(normalizeUrl('https://example.org:8443/x'), 'https://example.org:8443/x');
  });

  it('entfernt Tracking-Parameter', () => {
    assert.equal(
      normalizeUrl('https://example.org/a?utm_source=rss&utm_medium=x&id=7&fbclid=abc'),
      'https://example.org/a?id=7',
    );
  });

  it('behaelt inhaltstragende Parameter und sortiert sie', () => {
    assert.equal(normalizeUrl('https://example.org/a?z=1&a=2'), 'https://example.org/a?a=2&z=1');
  });

  it('entfernt einen leer gewordenen Query-String ganz', () => {
    assert.equal(normalizeUrl('https://example.org/a?utm_source=x'), 'https://example.org/a');
  });

  it('wirft das Fragment weg, ausser bei #!-Routen', () => {
    assert.equal(normalizeUrl('https://example.org/a#abschnitt-3'), 'https://example.org/a');
    assert.equal(normalizeUrl('https://example.org/a#!/detail/7'), 'https://example.org/a#!/detail/7');
  });

  it('entfernt den Slash nur beim leeren Pfad', () => {
    assert.equal(normalizeUrl('https://example.org/'), 'https://example.org');
    assert.equal(normalizeUrl('https://example.org/a/'), 'https://example.org/a/');
  });

  it('entfernt Zugangsdaten aus der URL', () => {
    assert.equal(normalizeUrl('https://nutzer:geheim@example.org/a'), 'https://example.org/a');
  });

  it('weist alles zurueck, was nicht http(s) ist', () => {
    assert.equal(normalizeUrl('ftp://example.org/a'), null);
    assert.equal(normalizeUrl('javascript:alert(1)'), null);
    assert.equal(normalizeUrl('chrome://extensions'), null);
    assert.equal(normalizeUrl('file:///etc/hosts'), null);
    assert.equal(normalizeUrl('kein-url'), null);
    assert.equal(normalizeUrl(''), null);
    assert.equal(normalizeUrl(null), null);
  });
});

describe('sameResource', () => {
  it('erkennt dieselbe Seite trotz Tracking und Fragment', () => {
    assert.equal(
      sameResource('https://example.org/a?utm_source=x#top', 'https://EXAMPLE.org/a'),
      true,
    );
  });

  it('unterscheidet verschiedene Seiten', () => {
    assert.equal(sameResource('https://example.org/a', 'https://example.org/b'), false);
  });

  it('unbrauchbare Eingaben sind nie gleich', () => {
    assert.equal(sameResource('nichts', 'nichts'), false);
  });
});

describe('normalizeServerUrl', () => {
  it('ergaenzt https, wenn kein Schema angegeben ist', () => {
    assert.equal(normalizeServerUrl('schreibwerkstatt.example.com'), 'https://schreibwerkstatt.example.com');
  });

  it('entfernt abschliessende Slashes', () => {
    assert.equal(normalizeServerUrl('https://example.com///'), 'https://example.com');
  });

  it('behaelt einen Unterpfad (Reverse-Proxy)', () => {
    assert.equal(normalizeServerUrl('https://example.com/werkstatt/'), 'https://example.com/werkstatt');
  });

  it('wirft Query und Fragment weg', () => {
    assert.equal(normalizeServerUrl('https://example.com/x?a=1#y'), 'https://example.com/x');
  });

  it('erlaubt http fuer lokale Entwicklung', () => {
    assert.equal(normalizeServerUrl('http://localhost:3000'), 'http://localhost:3000');
  });

  it('weist Unsinn zurueck', () => {
    assert.equal(normalizeServerUrl(''), null);
    assert.equal(normalizeServerUrl('   '), null);
    assert.equal(normalizeServerUrl('ftp://example.com'), null);
  });
});

describe('toOriginPattern', () => {
  it('baut ein Muster fuer genau ein Origin', () => {
    assert.equal(toOriginPattern('https://example.com/werkstatt'), 'https://example.com/*');
    assert.equal(toOriginPattern('http://localhost:3000'), 'http://localhost:3000/*');
  });

  it('liefert null bei ungueltiger Eingabe', () => {
    assert.equal(toOriginPattern('nope://x'), null);
  });
});

describe('Kleinkram', () => {
  it('isHttpUrl', () => {
    assert.equal(isHttpUrl('https://example.org'), true);
    assert.equal(isHttpUrl('chrome://x'), false);
  });

  it('isLocalHost', () => {
    assert.equal(isLocalHost('http://localhost:3000'), true);
    assert.equal(isLocalHost('http://127.0.0.1'), true);
    assert.equal(isLocalHost('http://werkstatt.localhost'), true);
    assert.equal(isLocalHost('https://example.org'), false);
    // Kein Match-Muster im Manifest kann ein IPv6-Literal abdecken; was sich
    // nicht anfordern laesst, gilt hier auch nicht als lokal.
    assert.equal(isLocalHost('http://[::1]:3000'), false);
  });

  it('hostLabel entfernt www.', () => {
    assert.equal(hostLabel('https://www.example.org/a'), 'example.org');
    assert.equal(hostLabel('kaputt'), '');
  });

  it('resolveUrl loest relativ auf', () => {
    assert.equal(resolveUrl('/pdf/1', 'https://example.org/a/b'), 'https://example.org/pdf/1');
    assert.equal(resolveUrl('javascript:void(0)', 'https://example.org/'), null);
    assert.equal(resolveUrl('', 'https://example.org/'), null);
  });

  it('sameOrigin', () => {
    assert.equal(sameOrigin('https://a.org/1', 'https://a.org/2'), true);
    assert.equal(sameOrigin('https://a.org/1', 'https://b.org/1'), false);
    assert.equal(sameOrigin('https://a.org/1', 'http://a.org/1'), false);
  });
});
