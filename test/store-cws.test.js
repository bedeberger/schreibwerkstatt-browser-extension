/**
 * Nagelt die Entscheidungen der Store-Werkzeuge fest — die Teile, die ohne Netz
 * pruefbar sind.
 *
 * Der Rest von `tools/store-publish.mjs` ist HTTP gegen Google und gehoert
 * nicht in `npm test`. Wichtig ist hier zweierlei: dass die Zugangsdaten nie
 * im oeffentlichen Repository landen koennen, und dass ein unbekannter
 * Statuscode sich selbst nennt statt zu verschwinden — dieselbe Regel wie bei
 * `err_unmapped_code` im Client.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  DRAFT_STATES,
  PUBLISH_STATES,
  UPLOAD_STATES,
  assertOutsideRepo,
  authUrl,
  configPath,
  describeStatus,
  missingFields,
  readConfig,
  stillProcessing,
  updateConfig,
} from '../tools/lib/cws.mjs';

describe('configPath', () => {
  it('nimmt CWS_CONFIG, wenn gesetzt', () => {
    assert.equal(configPath({ CWS_CONFIG: '/somewhere/cws.json' }), '/somewhere/cws.json');
  });

  it('folgt XDG_CONFIG_HOME', () => {
    assert.equal(
      configPath({ XDG_CONFIG_HOME: '/xdg' }),
      '/xdg/schreibwerkstatt-cws.json',
    );
  });

  it('ignoriert ein relatives XDG_CONFIG_HOME', () => {
    // Sonst haenge der Pfad der Zugangsdaten am Arbeitsverzeichnis.
    assert.ok(configPath({ XDG_CONFIG_HOME: 'relativ' }).endsWith('/.config/schreibwerkstatt-cws.json'));
  });
});

describe('assertOutsideRepo', () => {
  it('laesst einen Pfad ausserhalb durch', () => {
    assert.equal(assertOutsideRepo('/home/x/.config/schreibwerkstatt-cws.json', '/repo'), null);
  });

  it('meldet einen Pfad im Repository', () => {
    const message = assertOutsideRepo('/repo/store/cws.json', '/repo');
    assert.match(message, /oeffentlich/);
    assert.match(message, /store\/cws\.json/);
  });

  it('meldet auch die Wurzel selbst', () => {
    assert.ok(assertOutsideRepo('/repo/cws.json', '/repo'));
  });

  it('faellt nicht auf einen Nachbarordner mit gleichem Anfang herein', () => {
    assert.equal(assertOutsideRepo('/repo-privat/cws.json', '/repo'), null);
  });
});

describe('missingFields', () => {
  const full = {
    itemId: 'i', clientId: 'c', clientSecret: 's', refreshToken: 'r',
  };

  it('ist leer, wenn alles da ist', () => {
    assert.deepEqual(missingFields(full), []);
  });

  it('zaehlt alle Luecken auf, nicht nur die erste', () => {
    assert.equal(missingFields({}).length, 4);
  });

  it('laesst das Refresh-Token auf Wunsch aus — vor `store:auth` gibt es keines', () => {
    assert.deepEqual(missingFields({ ...full, refreshToken: undefined }, { refreshToken: false }), []);
  });
});

describe('authUrl', () => {
  const url = new URL(authUrl({ clientId: 'abc.apps.googleusercontent.com', redirectUri: 'http://localhost:8976' }));

  it('fragt ein Refresh-Token an', () => {
    // Ohne access_type=offline kommt keines, ohne prompt=consent nur beim
    // allerersten Mal. Beide sind noetig.
    assert.equal(url.searchParams.get('access_type'), 'offline');
    assert.equal(url.searchParams.get('prompt'), 'consent');
  });

  it('verlangt genau den Store-Scope', () => {
    assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/chromewebstore');
  });

  it('schickt den Code an die Loopback-Adresse zurueck', () => {
    assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:8976');
    assert.equal(url.searchParams.get('response_type'), 'code');
  });
});

describe('describeStatus', () => {
  it('uebersetzt bekannte Codes', () => {
    assert.deepEqual(describeStatus(['OK'], PUBLISH_STATES), ['OK — Eingereicht.']);
  });

  it('laesst einen unbekannten Code sich selbst nennen', () => {
    const [line] = describeStatus(['WAS_AUCH_IMMER'], PUBLISH_STATES);
    assert.match(line, /^WAS_AUCH_IMMER — unbekannter Code/);
  });

  it('vertraegt eine fehlende Liste', () => {
    assert.deepEqual(describeStatus(undefined, PUBLISH_STATES), []);
  });

  it('kennt die laufende Pruefung — der Fall, der nicht wiederholt werden darf', () => {
    assert.match(PUBLISH_STATES.ITEM_PENDING_REVIEW, /nicht erneut einreichen/);
  });
});

describe('NOT_FOUND heisst zweierlei', () => {
  /**
   * Am 2026-08-04 am echten Store gemessen: `GET items/:id?projection=DRAFT`
   * antwortete `uploadState: NOT_FOUND` **zusammen mit** `crxVersion: 1.0.0`.
   * Das Item war also da — „kein Upload in Arbeit" ist der Ruhezustand.
   * Derselbe Wert in der Upload-Antwort heisst dagegen „Item unbekannt".
   */
  it('meldet im Upload eine unbekannte Item-ID', () => {
    assert.match(UPLOAD_STATES.NOT_FOUND, /Item-ID unbekannt/);
  });

  it('ist in der Abfrage der Normalzustand', () => {
    assert.match(DRAFT_STATES.NOT_FOUND, /Normalzustand/);
    assert.doesNotMatch(DRAFT_STATES.NOT_FOUND, /unbekannt/);
  });

  it('haelt nur IN_PROGRESS die Warteschleife am Laufen', () => {
    // Der Fehler, der hier lauerte: NOT_FOUND als Fehlschlag zu lesen und einen
    // geglueckten Upload abzubrechen.
    assert.equal(stillProcessing('IN_PROGRESS'), true);
    for (const state of ['SUCCESS', 'NOT_FOUND', 'FAILURE', undefined]) {
      assert.equal(stillProcessing(state), false, `${state} darf nicht warten`);
    }
  });
});

describe('readConfig und updateConfig', () => {
  it('liest die Datei und laesst die Umgebung gewinnen', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cws-test-'));
    const file = join(dir, 'cws.json');
    await updateConfig(file, { item_id: 'aus-datei', client_id: 'c', client_secret: 's' });

    const plain = await readConfig({ env: {}, file });
    assert.equal(plain.itemId, 'aus-datei');
    assert.equal(plain.fileExists, true);

    const overridden = await readConfig({ env: { CWS_ITEM_ID: 'aus-umgebung' }, file });
    assert.equal(overridden.itemId, 'aus-umgebung');
    assert.equal(overridden.clientId, 'c');
  });

  it('ergaenzt Felder, ohne die vorhandenen zu verlieren', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cws-test-'));
    const file = join(dir, 'cws.json');
    await updateConfig(file, { item_id: 'i', client_secret: 's' });
    await updateConfig(file, { refresh_token: 'r' });

    const config = await readConfig({ env: {}, file });
    assert.equal(config.itemId, 'i');
    assert.equal(config.clientSecret, 's');
    assert.equal(config.refreshToken, 'r');
  });

  it('schreibt die Datei mit Rechten 600', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cws-test-'));
    const file = join(dir, 'cws.json');
    await updateConfig(file, { refresh_token: 'geheim' });
    // Ein zweites Mal, weil `mode` bei writeFile nur beim Anlegen greift: eine
    // schon vorhandene, weltlesbare Datei muss trotzdem eng werden.
    await updateConfig(file, { refresh_token: 'geheim' });

    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.match(await readFile(file, 'utf8'), /geheim/);
  });

  it('meldet eine fehlende Datei als fehlend, statt zu werfen', async () => {
    const config = await readConfig({ env: {}, file: join(tmpdir(), 'gibt-es-nicht', 'cws.json') });
    assert.equal(config.fileExists, false);
    assert.equal(config.refreshToken, undefined);
  });
});
