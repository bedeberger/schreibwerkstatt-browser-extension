/**
 * Nagelt die Berechtigungen im Manifest fest.
 *
 * Berechtigungen sind der teuerste Teil einer Store-Einreichung: jede
 * Erweiterung geht durch eine erneute Pruefung, und eine *neue* Berechtigung
 * deaktiviert die Erweiterung bei allen Nutzern, bis sie zustimmen. Was hier
 * steht, ist im Store-Eintrag einzeln begruendet
 * (store/listing-de.md → „Begruendung je Berechtigung"). Wer eine Zeile
 * aendert, muss die Begruendung mitaendern — dieser Test erzwingt, dass es
 * auffaellt.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { isLocalHost, toOriginPattern } from '../src/shared/url.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, ''), 'src');
const manifest = JSON.parse(await readFile(join(SRC, 'manifest.json'), 'utf8'));

describe('manifest — Berechtigungen', () => {
  it('fuehrt genau die begruendeten API-Berechtigungen', () => {
    assert.deepEqual(manifest.permissions, [
      'storage',
      'contextMenus',
      'activeTab',
      'scripting',
      'notifications',
      'alarms',
    ]);
  });

  it('fordert keine Host-Berechtigung vorab an', () => {
    assert.equal(manifest.host_permissions, undefined);
  });

  it('erlaubt http nur lokal', () => {
    const optional = manifest.optional_host_permissions;
    assert.ok(Array.isArray(optional));
    assert.ok(!optional.includes('http://*/*'), 'http://*/* waere unverschluesselt und weltweit');
    assert.ok(!optional.includes('<all_urls>'));
    for (const pattern of optional.filter((p) => p.startsWith('http://'))) {
      assert.ok(
        isLocalHost(pattern.replace('/*', '')),
        `${pattern} ist keine lokale Adresse`,
      );
    }
  });

  it('deckt jede Adresse ab, die die Options-Seite durchlaesst', () => {
    // Was `isLocalHost` als http durchgehen laesst, muss ein Muster im Manifest
    // treffen — sonst scheitert `chrome.permissions.request()` erst zur Laufzeit.
    const optional = manifest.optional_host_permissions;
    const covered = (url) => {
      const pattern = toOriginPattern(url);
      assert.ok(pattern, `${url} ergibt kein Muster`);
      const host = new URL(pattern.replace('/*', '')).hostname;
      return optional.some((entry) => {
        if (!entry.startsWith('http://')) return false;
        const declared = entry.slice('http://'.length, -'/*'.length);
        return declared.startsWith('*.') ? host.endsWith(declared.slice(1)) : declared === host;
      });
    };
    for (const url of ['http://localhost:3000', 'http://127.0.0.1:8080', 'http://werkstatt.localhost']) {
      assert.ok(isLocalHost(url) && covered(url), `${url} waere nicht anforderbar`);
    }
  });

  it('haelt am weiten https-Muster fest', () => {
    // Selbst gehostet heisst: die Adresse steht erst zur Laufzeit fest, und
    // Manifest V3 kennt keinen Weg, ein solches Origin nachzudeklarieren.
    assert.ok(manifest.optional_host_permissions.includes('https://*/*'));
  });
});
