/**
 * Build: `npm run build` erzeugt ein `dist/`, das sich in Chrome unter
 * „Entpackte Erweiterung laden" direkt oeffnen laesst.
 *
 * esbuild wird nur gebraucht, weil Readability gebuendelt werden muss.
 * Es wird nichts minifiziert und nichts nachgeladen — der ausgelieferte
 * Code bleibt lesbar, was die Web-Store-Pruefung erleichtert.
 */

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');

const watch = process.argv.includes('--watch');

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));

/** Statische Dateien, die unveraendert nach dist wandern. */
const COPIES = [
  ['_locales', '_locales'],
  ['icons', 'icons'],
  ['shared/ui.css', 'shared/ui.css'],
  ['popup/popup.html', 'popup/popup.html'],
  ['popup/popup.css', 'popup/popup.css'],
  ['options/options.html', 'options/options.html'],
  ['options/options.css', 'options/options.css'],
];

/**
 * Lizenzhinweis fuer das Content-Bundle.
 *
 * Mozillas Readability traegt einen Apache-2.0-Kopf ohne `@license`-Marker;
 * esbuild wirft solche Kommentare weg. Apache-2.0 §4 verlangt aber, dass der
 * Hinweis erhalten bleibt — also setzen wir ihn selbst davor. Die vollstaendige
 * Lizenz landet zusaetzlich als Datei in `dist/`.
 */
const READABILITY_BANNER = `/*! @license
 * Enthaelt Mozilla Readability — Copyright (c) 2010 Arc90 Inc.
 * Lizenziert unter der Apache License, Version 2.0.
 * Volltext: siehe THIRD_PARTY_LICENSES.txt in diesem Verzeichnis
 * bzw. http://www.apache.org/licenses/LICENSE-2.0
 */`;

const BUNDLES = [
  // Service Worker: ESM, weil das Manifest `"type": "module"` deklariert.
  { in: 'background/service-worker.js', out: 'background/service-worker.js', format: 'esm' },
  // Popup und Options laufen als <script type="module">.
  { in: 'popup/popup.js', out: 'popup/popup.js', format: 'esm' },
  { in: 'options/options.js', out: 'options/options.js', format: 'esm' },
  // Content-Script: wird per `executeScript({files})` als klassisches
  // Script injiziert, also IIFE.
  { in: 'content/harvest.js', out: 'content/harvest.js', format: 'iife', banner: READABILITY_BANNER },
];

async function copyStatic() {
  for (const [from, to] of COPIES) {
    const target = join(DIST, to);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(SRC, from), target, { recursive: true });
  }
}

async function writeManifest() {
  const manifest = JSON.parse(await readFile(join(SRC, 'manifest.json'), 'utf8'));
  // Eine Versionsquelle: package.json.
  manifest.version = pkg.version;
  await writeFile(join(DIST, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

/** @returns {import('esbuild').BuildOptions} */
function optionsFor(bundle) {
  return {
    entryPoints: [join(SRC, bundle.in)],
    outfile: join(DIST, bundle.out),
    bundle: true,
    format: bundle.format,
    target: ['chrome116'],
    platform: 'browser',
    charset: 'utf8',
    legalComments: 'inline',
    logLevel: 'info',
    // Nicht minifizieren: der Store prueft lesbaren Code lieber.
    minify: false,
    sourcemap: watch ? 'inline' : false,
    ...(bundle.banner ? { banner: { js: bundle.banner } } : {}),
  };
}

/** Legt die vollstaendigen Lizenztexte des mitgelieferten Drittcodes ab. */
async function writeThirdPartyLicenses() {
  const readability = await readFile(
    join(ROOT, 'node_modules', '@mozilla', 'readability', 'LICENSE.md'),
    'utf8',
  );
  const text = [
    'Drittcode, der in dieser Erweiterung mitgeliefert wird',
    '='.repeat(54),
    '',
    '@mozilla/readability — Apache License, Version 2.0',
    'https://github.com/mozilla/readability',
    '-'.repeat(54),
    '',
    readability.trim(),
    '',
    'Der Volltext der Apache License 2.0 steht unter',
    'http://www.apache.org/licenses/LICENSE-2.0',
    '',
    'Der uebrige Code dieser Erweiterung steht unter der MIT-Lizenz.',
    '',
  ].join('\n');
  await writeFile(join(DIST, 'THIRD_PARTY_LICENSES.txt'), text, 'utf8');
}

async function buildOnce() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  await Promise.all(BUNDLES.map((bundle) => esbuild.build(optionsFor(bundle))));
  await copyStatic();
  await writeManifest();
  await writeThirdPartyLicenses();
  process.stdout.write(`\ndist/ ist bereit (Version ${pkg.version}).\n`);
}

async function buildWatch() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  await copyStatic();
  await writeManifest();
  await writeThirdPartyLicenses();
  const contexts = await Promise.all(BUNDLES.map((bundle) => esbuild.context(optionsFor(bundle))));
  await Promise.all(contexts.map((context) => context.watch()));
  process.stdout.write('\nBeobachte Aenderungen. Statische Dateien werden nur beim Start kopiert.\n');
}

if (watch) await buildWatch();
else await buildOnce();
