/**
 * Erzeugt das ZIP, das im Chrome Web Store hochgeladen wird.
 *
 *   npm run package   ->  store/schreibwerkstatt-chrome-<version>.zip
 *
 * Bewusst kein `zip`-Aufruf und kein npm-Paket:
 *
 * - Reproduzierbarkeit. Alle Zeitstempel sind auf einen festen Wert gesetzt und
 *   die Einträge sind sortiert. Gleiches `dist/` ergibt Byte für Byte dasselbe
 *   ZIP. Du kannst also jederzeit nachrechnen, was du hochgeladen hast, und die
 *   Prüfsumme mit der des Uploads vergleichen.
 * - Keine Systemabhängigkeit, kein weiteres devDependency.
 *
 * Die CRC-32-Routine steht hier ein zweites Mal (auch `make-icons.mjs` braucht
 * sie). Das ist beabsichtigt: jedes Werkzeug in `tools/` soll für sich allein
 * lauffähig bleiben, ohne interne Hilfsmodule.
 */

import { deflateRawSync } from 'node:zlib';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url)).replace(/\/tools$/, '');
const DIST = join(ROOT, 'dist');
const OUT_DIR = join(ROOT, 'store');

/**
 * Fester Zeitstempel: 1980-01-01 00:00:00, das früheste im ZIP-Format
 * darstellbare Datum. Der Store liest ihn nicht aus.
 */
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

/** Dateien, die im Paket nichts zu suchen haben. */
const FORBIDDEN = [
  /\.map$/, // Sourcemaps — entstehen nur bei `npm run watch`
  /(^|\/)\./, // versteckte Dateien, auch in Unterordnern
  /(^|\/)Thumbs\.db$/,
];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

/** @param {Buffer} buffer */
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Sammelt alle Dateien unter `dir` rekursiv.
 *
 * @param {string} dir
 * @returns {Promise<string[]>} Pfade relativ zu `dir`, mit `/` als Trenner
 */
async function collect(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolute = join(entry.parentPath ?? entry.path, entry.name);
    files.push(relative(dir, absolute).split(sep).join('/'));
  }
  // Sortiert, damit die Reihenfolge im Archiv nicht vom Dateisystem abhängt.
  return files.sort();
}

/**
 * Schreibt ein ZIP im Deflate-Verfahren.
 *
 * @param {Array<{ name: string, data: Buffer }>} entries
 * @returns {Buffer}
 */
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // Signatur
    local.writeUInt16LE(20, 4); // benötigte Version: 2.0
    local.writeUInt16LE(0x0800, 6); // Flag: Name ist UTF-8
    local.writeUInt16LE(8, 8); // Verfahren: Deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // kein Extra-Feld
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // erzeugt von: Unix, Version 3.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // Extra
    central.writeUInt16LE(0, 32); // Kommentar
    central.writeUInt16LE(0, 34); // Datenträger
    central.writeUInt16LE(0, 36); // interne Attribute
    // Externe Attribute: rw-r--r--. Multiplikation statt `<< 16`, weil der
    // Shift-Operator in JS auf 32 Bit mit Vorzeichen rechnet und überlaufen würde.
    central.writeUInt32LE(0o100644 * 0x10000, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // Signatur
  end.writeUInt16LE(0, 4); // dieser Datenträger
  end.writeUInt16LE(0, 6); // Datenträger mit dem Zentralverzeichnis
  end.writeUInt16LE(entries.length, 8); // Einträge auf diesem Datenträger
  end.writeUInt16LE(entries.length, 10); // Einträge insgesamt
  end.writeUInt32LE(centralBuffer.length, 12); // Größe des Zentralverzeichnisses
  end.writeUInt32LE(offset, 16); // Beginn des Zentralverzeichnisses
  end.writeUInt16LE(0, 20); // kein Archivkommentar

  return Buffer.concat([...locals, centralBuffer, end]);
}

/** @param {string} message */
function fail(message) {
  process.stderr.write(`\nFEHLER: ${message}\n\n`);
  process.exit(1);
}

// --- Ablauf -----------------------------------------------------------------

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));

try {
  await stat(DIST);
} catch {
  fail('dist/ fehlt. Erst `npm run build` ausführen.');
}

const names = await collect(DIST);

if (!names.includes('manifest.json')) {
  fail('dist/manifest.json fehlt — das ZIP muss das Manifest im Wurzelverzeichnis tragen.');
}

for (const name of names) {
  for (const pattern of FORBIDDEN) {
    if (pattern.test(name)) fail(`${name} gehört nicht ins Paket. Nach \`npm run build\` neu packen (nicht \`npm run watch\`: das erzeugt Sourcemaps).`);
  }
}

const manifest = JSON.parse(await readFile(join(DIST, 'manifest.json'), 'utf8'));

if (manifest.version !== pkg.version) {
  fail(`Version läuft auseinander: manifest ${manifest.version}, package.json ${pkg.version}. \`npm run build\` neu ausführen.`);
}

// Der Store akzeptiert 1–4 durch Punkte getrennte Zahlen von 0 bis 65535,
// ohne führende Nullen.
if (!/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/.test(manifest.version)
  || manifest.version.split('.').some((part) => Number(part) > 65535)) {
  fail(`Version "${manifest.version}" ist für den Store unzulässig (1–4 Zahlen von 0 bis 65535, keine führenden Nullen).`);
}

const entries = await Promise.all(
  names.map(async (name) => ({ name, data: await readFile(join(DIST, name)) })),
);

const zip = makeZip(entries);
const outFile = join(OUT_DIR, `schreibwerkstatt-chrome-${manifest.version}.zip`);
await mkdir(OUT_DIR, { recursive: true });
await writeFile(outFile, zip);

const sha256 = createHash('sha256').update(zip).digest('hex');
const kib = (zip.length / 1024).toFixed(1);

process.stdout.write([
  '',
  `Paket:    ${relative(ROOT, outFile)}`,
  `Version:  ${manifest.version}`,
  `Dateien:  ${entries.length}`,
  `Größe:    ${kib} KiB`,
  `SHA-256:  ${sha256}`,
  '',
  'Hochladen: https://chrome.google.com/webstore/devconsole',
  '',
].join('\n'));
