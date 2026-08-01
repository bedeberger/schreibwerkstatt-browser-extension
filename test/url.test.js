import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  fileNameFromUrl,
  hostLabel,
  isHttpUrl,
  isLocalHost,
  normalizeServerUrl,
  normalizeUrl,
  resolveUrl,
  sameOrigin,
  sameResource,
  sameServerResource,
  serverNormalizeUrl,
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

/**
 * Diese Faelle sind gegen `lib/url-normalize.js` im Mutterprojekt gepruefte
 * Erwartungen. Sie sind der Grund, warum es zwei Normalisierer gibt: was hier
 * steht, weicht bewusst von `normalizeUrl` ab.
 */
describe('serverNormalizeUrl — Nachbau der Serverregeln', () => {
  it('wirft das Fragment immer weg, auch #!-Routen', () => {
    assert.equal(serverNormalizeUrl('https://example.org/a#kapitel'), 'https://example.org/a');
    assert.equal(serverNormalizeUrl('https://example.org/a#!/route'), 'https://example.org/a');
    // Der lokale Normalisierer behaelt #! — genau deshalb zwei Funktionen.
    assert.equal(normalizeUrl('https://example.org/a#!/route'), 'https://example.org/a#!/route');
  });

  it('entfernt www. und vereinheitlicht auf https', () => {
    assert.equal(serverNormalizeUrl('http://www.example.org/a'), 'https://example.org/a');
    assert.equal(normalizeUrl('http://www.example.org/a'), 'http://www.example.org/a');
  });

  it('entfernt den Standardport des urspruenglichen Schemas', () => {
    assert.equal(serverNormalizeUrl('http://example.org:80/a'), 'https://example.org/a');
    assert.equal(serverNormalizeUrl('https://example.org:443/a'), 'https://example.org/a');
    assert.equal(serverNormalizeUrl('https://example.org:8443/a'), 'https://example.org:8443/a');
  });

  it('entfernt Tracking-Parameter, laesst ref stehen', () => {
    assert.equal(
      serverNormalizeUrl('https://example.org/a?utm_source=x&ref=newsletter&mc_cid=7'),
      'https://example.org/a?ref=newsletter',
    );
  });

  it('sortiert die Query und entfernt ein leeres ?', () => {
    assert.equal(serverNormalizeUrl('https://example.org/a?b=2&a=1'), 'https://example.org/a?a=1&b=2');
    assert.equal(serverNormalizeUrl('https://example.org/a?utm_source=x'), 'https://example.org/a');
  });

  it('entfernt den Trailing-Slash, behaelt aber den Root-Slash', () => {
    assert.equal(serverNormalizeUrl('https://example.org/a/b/'), 'https://example.org/a/b');
    assert.equal(serverNormalizeUrl('https://example.org/a/?q=1'), 'https://example.org/a?q=1');
    assert.equal(serverNormalizeUrl('https://example.org/'), 'https://example.org/');
  });

  it('lehnt ab, was keine http(s)-URL ist', () => {
    assert.equal(serverNormalizeUrl('chrome://extensions'), null);
    assert.equal(serverNormalizeUrl('kaputt'), null);
    assert.equal(serverNormalizeUrl(''), null);
    assert.equal(serverNormalizeUrl(null), null);
  });

  it('haelt die Faelle zusammen, die der Server zusammenhaelt', () => {
    assert.equal(
      sameServerResource('http://www.example.org/a/b/?utm_source=n#x', 'https://example.org/a/b'),
      true,
    );
    // sameResource sieht hier vier verschiedene Seiten — deshalb darf die
    // Dublettenpruefung nicht damit arbeiten.
    assert.equal(sameResource('http://www.example.org/a/b/', 'https://example.org/a/b'), false);
    assert.equal(sameServerResource('https://example.org/a', 'https://example.org/b'), false);
    assert.equal(sameServerResource('kaputt', 'kaputt'), false);
  });
});

describe('fileNameFromUrl', () => {
  it('nimmt den letzten Pfadteil', () => {
    assert.equal(fileNameFromUrl('https://example.org/docs/bericht.pdf'), 'bericht.pdf');
  });

  it('laesst Query und Fragment weg', () => {
    assert.equal(fileNameFromUrl('https://example.org/a/bericht.pdf?v=2#seite3'), 'bericht.pdf');
  });

  it('loest Prozentkodierung auf', () => {
    assert.equal(fileNameFromUrl('https://example.org/Jahres%20bericht.pdf'), 'Jahres bericht.pdf');
  });

  it('haengt .pdf an, wenn der Pfad keine Endung traegt', () => {
    assert.equal(fileNameFromUrl('https://example.org/artikel/12345'), '12345.pdf');
  });

  it('faellt auf einen Namen zurueck, statt nichts zu schicken', () => {
    assert.equal(fileNameFromUrl('https://example.org/'), 'dokument.pdf');
    assert.equal(fileNameFromUrl('https://example.org'), 'dokument.pdf');
    assert.equal(fileNameFromUrl('kaputt'), 'dokument.pdf');
    assert.equal(fileNameFromUrl(null), 'dokument.pdf');
  });

  it('vertraegt kaputte Prozentkodierung', () => {
    // `decodeURIComponent` wuerde hier werfen — der Name ist Beigabe, kein
    // Grund, den Upload scheitern zu lassen.
    assert.equal(fileNameFromUrl('https://example.org/a/%E0%A4%A.pdf'), '%E0%A4%A.pdf');
  });
});
