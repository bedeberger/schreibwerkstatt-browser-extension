/**
 * Erzeugt die Werbegrafiken für den Chrome Web Store.
 *
 *   npm run promo   ->  store/assets/promo-small-440x280.png
 *                       store/assets/promo-marquee-1400x560.png
 *
 * Verlangte Maße (Stand Juli 2026):
 *   - kleine Kachel   440 x 280   PNG oder JPEG   faktisch Pflicht:
 *                                 ohne sie wird das Listing in der Suche
 *                                 schlechter platziert
 *   - Marquee        1400 x 560   optional, nur für redaktionelle Plätze
 *
 * Gerendert wird mit dem installierten Chrome im Headless-Modus. Dasselbe
 * Prinzip wie bei `make-icons.mjs`: das Motiv steht als Quelltext hier und
 * ist nachvollziehbar reproduzierbar, statt als Binärblob im Repo zu liegen.
 * Die Farben sind aus `make-icons.mjs` übernommen.
 *
 * Für die Screenshots (1280x800) taugt das nicht — die müssen die echte
 * Oberfläche zeigen. Siehe store/PUBLISHING.md.
 */

import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

const ROOT = dirname(fileURLToPath(import.meta.url)).replace(/\/tools$/, '');
const OUT_DIR = join(ROOT, 'store', 'assets');
const TMP_DIR = join(OUT_DIR, '.tmp');

const INK = '#22405f';
const PAPER = '#ffffff';
const ACCENT = '#d98324';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
].filter(Boolean);

/**
 * Das Icon-Motiv als SVG, in denselben Proportionen wie in `make-icons.mjs`:
 * abgerundete Kachel, Blatt mit drei Textzeilen, bernsteinfarbene Marke.
 *
 * @param {number} size Kantenlänge in px
 */
function mark(size) {
  const s = (fraction) => (fraction * size).toFixed(2);
  const lines = [
    [0.35, 0.65, 0.3],
    [0.35, 0.65, 0.435],
    [0.35, 0.56, 0.57],
  ];
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="0" y="0" width="${size}" height="${size}" rx="${s(0.18)}" fill="${INK}"/>
    <circle cx="${s(0.735)}" cy="${s(0.755)}" r="${s(0.125)}" fill="${ACCENT}"/>
    <rect x="${s(0.26)}" y="${s(0.18)}" width="${s(0.48)}" height="${s(0.64)}" rx="${s(0.05)}" fill="${PAPER}"/>
    ${lines
      .map(([x0, x1, y0]) =>
        `<rect x="${s(x0)}" y="${s(y0)}" width="${s(x1 - x0)}" height="${s(0.055)}" fill="${INK}"/>`)
      .join('\n    ')}
  </svg>`;
}

/**
 * @param {object} spec
 * @param {number} spec.width
 * @param {number} spec.height
 * @param {number} spec.markSize
 * @param {number} spec.padding
 * @param {string} spec.title
 * @param {string} spec.claim
 * @param {number} spec.titleSize
 * @param {number} spec.claimSize
 */
function page(spec) {
  // Keine Netzwerk-Schriften: Chrome soll offline und deterministisch rendern.
  // Deshalb ausschließlich lokal vorhandene Familien mit generischem Fallback.
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${spec.width}px; height: ${spec.height}px; overflow: hidden; }
  body {
    display: flex; align-items: center; gap: ${spec.padding * 0.8}px;
    padding: ${spec.padding}px;
    /* Vollflächig gefüllt: der Store schneidet die Kachel randlos ein. */
    background: linear-gradient(135deg, #f7f4ee 0%, #ece5d8 100%);
    font-family: "DejaVu Serif", "Liberation Serif", Georgia, serif;
    color: ${INK};
    -webkit-font-smoothing: antialiased;
  }
  .mark { flex: 0 0 auto; filter: drop-shadow(0 ${spec.markSize * 0.03}px ${spec.markSize * 0.08}px rgba(34, 64, 95, 0.28)); }
  .text { min-width: 0; }
  h1 {
    font-size: ${spec.titleSize}px; font-weight: 700; line-height: 1.1;
    letter-spacing: -0.01em;
  }
  .rule { width: ${spec.titleSize * 1.4}px; height: ${Math.max(2, spec.titleSize * 0.07)}px;
    background: ${ACCENT}; margin: ${spec.titleSize * 0.34}px 0; border-radius: 999px; }
  p { font-size: ${spec.claimSize}px; line-height: 1.34; color: #3d5872;
      font-family: "DejaVu Sans", "Liberation Sans", system-ui, sans-serif; }
</style></head><body>
  <div class="mark">${mark(spec.markSize)}</div>
  <div class="text">
    <h1>${spec.title}</h1>
    <div class="rule"></div>
    <p>${spec.claim}</p>
  </div>
</body></html>`;
}

const TILES = [
  {
    file: 'promo-small-440x280.png',
    width: 440,
    height: 280,
    html: page({
      width: 440,
      height: 280,
      markSize: 104,
      padding: 30,
      titleSize: 34,
      claimSize: 15,
      title: 'Schreib&shy;werkstatt',
      claim: 'Webseiten als Recherche-Fundstück oder zitierfähige Quelle erfassen — in deine eigene Instanz.',
    }),
  },
  {
    file: 'promo-marquee-1400x560.png',
    width: 1400,
    height: 560,
    html: page({
      width: 1400,
      height: 560,
      markSize: 280,
      padding: 90,
      titleSize: 78,
      claimSize: 34,
      title: 'Schreibwerkstatt',
      claim: 'Titel, Autor:innen, DOI, Volltext und Zitate mit einem Klick erfassen.<br>Nur an deinen eigenen Server — kein Analytics, kein Tracking.',
    }),
  },
];

/** @returns {Promise<string>} Pfad zu einer lauffähigen Chrome-Binärdatei */
async function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await run(candidate, ['--version']);
      return candidate;
    } catch {
      // weiter
    }
  }
  process.stderr.write([
    '',
    'FEHLER: Kein Chrome gefunden.',
    '',
    'Die Kacheln werden mit dem installierten Chrome im Headless-Modus',
    'gerendert. Setze CHROME_PATH, falls die Binärdatei anders heißt:',
    '',
    '  CHROME_PATH=/pfad/zu/chrome npm run promo',
    '',
    'Alternativ die HTML-Dateien unter store/assets/.tmp/ selbst im Browser',
    'öffnen und bei genau der angegebenen Fenstergröße abfotografieren.',
    '',
  ].join('\n'));
  process.exit(1);
}

const chrome = await findChrome();

await rm(TMP_DIR, { recursive: true, force: true });
await mkdir(TMP_DIR, { recursive: true });

for (const tile of TILES) {
  const htmlFile = join(TMP_DIR, `${tile.file}.html`);
  const outFile = join(OUT_DIR, tile.file);
  await writeFile(htmlFile, tile.html, 'utf8');

  await run(chrome, [
    '--headless',
    '--disable-gpu',
    // Kein Netz: die Kacheln dürfen nichts nachladen.
    '--disable-extensions',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${tile.width},${tile.height}`,
    `--screenshot=${outFile}`,
    `--user-data-dir=${join(TMP_DIR, 'profile')}`,
    `file://${htmlFile}`,
  ]);

  // Maße aus dem PNG-IHDR-Chunk nachprüfen: Chrome liefert bei falschem
  // Skalierungsfaktor sonst stillschweigend die doppelte Kantenlänge, und der
  // Store weist das ohne brauchbare Meldung ab.
  const png = await readFile(outFile);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== tile.width || height !== tile.height) {
    process.stderr.write(`\nFEHLER: ${tile.file} ist ${width}x${height}, erwartet ${tile.width}x${tile.height}.\n\n`);
    process.exit(1);
  }

  process.stdout.write(`${relative(ROOT, outFile)}  ${width}x${height}  ${(png.length / 1024).toFixed(1)} KiB\n`);
}

await rm(TMP_DIR, { recursive: true, force: true });

process.stdout.write('\nDie Screenshots (1280x800) fehlen noch — siehe store/PUBLISHING.md.\n');
