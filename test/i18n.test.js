/**
 * Vollstaendigkeit der Sprachdateien.
 *
 * Die Spezifikation verlangt: keine hartcodierten Strings in JS/HTML.
 * Dieser Test haelt die Gegenprobe — jeder verwendete Schluessel muss in
 * `de` UND `en` existieren, und beide Dateien muessen deckungsgleich sein.
 */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { ERROR_MESSAGE_KEYS, messageKeyForError } from '../src/shared/errors.js';
import { CAPTURE_MODES, CSL_TYPES, RESEARCH_KINDS } from '../src/shared/limits.js';
import { JOB_STATE } from '../src/shared/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

/** @param {string} dir @returns {Promise<string[]>} */
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return Promise.resolve([full]);
    }),
  );
  return files.flat();
}

const de = JSON.parse(await readFile(join(SRC, '_locales/de/messages.json'), 'utf8'));
const en = JSON.parse(await readFile(join(SRC, '_locales/en/messages.json'), 'utf8'));
const manifest = await readFile(join(SRC, 'manifest.json'), 'utf8');
const files = await walk(SRC);

/**
 * Sammelt alle Schluessel, die im Quelltext statisch benutzt werden.
 * @returns {Promise<Map<string, string>>} Schluessel -> Fundort
 */
async function collectUsedKeys() {
  /** @type {Map<string, string>} */
  const used = new Map();
  const note = (key, where) => {
    if (key && !used.has(key)) used.set(key, where);
  };

  for (const file of files) {
    const ext = extname(file);
    if (ext !== '.js' && ext !== '.html') continue;
    const source = await readFile(file, 'utf8');
    const where = file.slice(SRC.length + 1);

    // t('key') / t("key")
    for (const match of source.matchAll(/\bt\(\s*(['"])([A-Za-z0-9_@]+)\1/g)) note(match[2], where);
    // data-i18n="key"
    for (const match of source.matchAll(/data-i18n="([A-Za-z0-9_@]+)"/g)) note(match[1], where);
    // data-i18n-attr="attr:key,attr:key"
    for (const match of source.matchAll(/data-i18n-attr="([^"]+)"/g)) {
      for (const pair of match[1].split(',')) {
        const key = pair.split(':')[1];
        if (key) note(key.trim(), where);
      }
    }
    // Validierungsschluessel aus limits.js: key: 'validation_…'
    for (const match of source.matchAll(/\bkey:\s*'(validation_[A-Za-z0-9_]+)'/g)) note(match[1], where);
    // Schluessel, die erst zur Laufzeit an t() gehen (z. B. per Ternaer
    // gewaehlt oder als `key`-Feld weitergereicht, siehe `shared/outcome.js`).
    // Die Praefixe sind eindeutige Nachrichten-Namensraeume.
    if (ext === '.js') {
      for (const match of source.matchAll(
        /(['"])((?:notice|notify|popup|options|badge|provenance|queue_state)_[A-Za-z0-9_]+)\1/g,
      )) {
        note(match[2], where);
      }
    }
  }

  // __MSG_key__ im Manifest
  for (const match of manifest.matchAll(/__MSG_([A-Za-z0-9_@]+)__/g)) note(match[1], 'manifest.json');

  return used;
}

const usedKeys = await collectUsedKeys();

describe('Sprachdateien', () => {
  it('de und en haben denselben Schluesselsatz', () => {
    const deKeys = new Set(Object.keys(de));
    const enKeys = new Set(Object.keys(en));
    const missingInEn = [...deKeys].filter((key) => !enKeys.has(key));
    const missingInDe = [...enKeys].filter((key) => !deKeys.has(key));
    assert.deepEqual(missingInEn, [], 'fehlt in en');
    assert.deepEqual(missingInDe, [], 'fehlt in de');
  });

  it('jede Nachricht hat einen nicht leeren Text', () => {
    for (const [locale, messages] of [
      ['de', de],
      ['en', en],
    ]) {
      for (const [key, value] of Object.entries(messages)) {
        assert.ok(value && typeof value.message === 'string', `${locale}/${key}: kein message-Feld`);
        assert.ok(value.message.trim().length > 0, `${locale}/${key}: leer`);
      }
    }
  });

  it('Platzhalter stimmen zwischen de und en ueberein', () => {
    for (const key of Object.keys(de)) {
      const dePlaceholders = [...de[key].message.matchAll(/\$(\d)/g)].map((m) => m[1]).sort();
      const enPlaceholders = [...en[key].message.matchAll(/\$(\d)/g)].map((m) => m[1]).sort();
      assert.deepEqual(enPlaceholders, dePlaceholders, `Platzhalter weichen ab bei ${key}`);
    }
  });

  it('Schluessel folgen der von chrome.i18n erlaubten Form', () => {
    for (const key of Object.keys(de)) {
      assert.match(key, /^[A-Za-z0-9_@]+$/, `unzulaessiger Schluessel: ${key}`);
    }
  });
});

describe('Verwendete Schluessel sind uebersetzt', () => {
  it('jeder statisch verwendete Schluessel existiert', () => {
    const missing = [...usedKeys.entries()]
      .filter(([key]) => !(key in de))
      .map(([key, where]) => `${key} (${where})`);
    assert.deepEqual(missing, []);
  });

  it('die dynamisch zusammengesetzten Familien sind vollstaendig', () => {
    /** @type {string[]} */
    const expected = [
      ...CSL_TYPES.map((type) => `csl_${type}`),
      ...RESEARCH_KINDS.map((kind) => `kind_${kind}`),
      ...CAPTURE_MODES.map((mode) => `mode_${mode}`),
      ...['owner', 'editor', 'viewer'].map((role) => `role_${role}`),
      ...Object.values(JOB_STATE).map((jobState) => `queue_state_${jobState}`),
      'lang_code',
    ];
    const missing = expected.filter((key) => !(key in de));
    assert.deepEqual(missing, []);
  });

  it('jeder Fehlerschluessel, den messageKeyForError liefern kann, existiert', () => {
    /** @type {Set<string>} */
    const produced = new Set(Object.values(ERROR_MESSAGE_KEYS));
    produced.add(messageKeyForError({ networkError: true }));
    produced.add(messageKeyForError({}));
    for (const status of [400, 401, 403, 404, 405, 408, 409, 413, 415, 418, 429, 500, 502, 503, 504, 599]) {
      produced.add(messageKeyForError({ status }));
    }
    const missing = [...produced].filter((key) => !(key in de));
    assert.deepEqual(missing, []);
  });
});

describe('Keine hartcodierten Strings dort, wo Uebersetzungen hingehoeren', () => {
  it('kein __MSG_-Verweis im Manifest ohne Entsprechung', () => {
    for (const match of manifest.matchAll(/__MSG_([A-Za-z0-9_@]+)__/g)) {
      assert.ok(match[1] in de, `manifest verweist auf ${match[1]}`);
      assert.ok(match[1] in en, `manifest verweist auf ${match[1]}`);
    }
  });

  it('keine ungenutzten Nachrichten', () => {
    const dynamicPrefixes = ['csl_', 'kind_', 'mode_', 'role_', 'queue_state_', 'err_', 'validation_'];
    const unused = Object.keys(de).filter(
      (key) =>
        !usedKeys.has(key) &&
        key !== 'lang_code' &&
        !dynamicPrefixes.some((prefix) => key.startsWith(prefix)),
    );
    assert.deepEqual(unused, []);
  });

  it('kein Inline-style-Attribut im HTML', async () => {
    for (const file of files.filter((name) => name.endsWith('.html'))) {
      const source = await readFile(file, 'utf8');
      assert.equal(
        /\sstyle="/.test(source),
        false,
        `${file.slice(SRC.length + 1)} enthaelt ein style-Attribut`,
      );
    }
  });

  it('kein .style.-Zugriff im UI-Code', async () => {
    for (const file of files.filter((name) => /(popup|options)\.js$/.test(name))) {
      const source = await readFile(file, 'utf8');
      assert.equal(
        /\.style\.[a-zA-Z]/.test(source),
        false,
        `${file.slice(SRC.length + 1)} setzt Inline-Styles`,
      );
    }
  });

  it('keine externen Ressourcen im HTML', async () => {
    for (const file of files.filter((name) => name.endsWith('.html'))) {
      const source = await readFile(file, 'utf8');
      assert.equal(/(src|href)="https?:\/\//.test(source), false, `${file} laedt von aussen`);
    }
  });
});
