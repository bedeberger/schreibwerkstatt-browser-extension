/**
 * Gemeinsamer Unterbau der Bildwerkzeuge: Chrome finden und starten.
 *
 * Benutzt von `make-promo.mjs` (Werbekacheln) und `make-shots.mjs`
 * (Store-Screenshots). Enthaelt nichts, was ins Paket geht.
 */

import { execFile, spawn } from 'node:child_process';
import { access, rm, stat } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Kandidaten in der Reihenfolge, in der wir sie ausprobieren. macOS liegt
 * vorn, weil dort nichts davon im PATH steht — der haeufigste Grund, warum
 * `npm run promo` frueher mit „Kein Chrome gefunden" abbrach, obwohl Chrome
 * installiert war.
 */
export const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

/**
 * @returns {Promise<string>} Pfad zu einer lauffaehigen Chrome-Binaerdatei
 * @throws wenn keiner der Kandidaten startet
 */
export async function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await run(candidate, ['--version']);
      return candidate;
    } catch {
      // weiter
    }
  }
  const hint = [
    '',
    'FEHLER: Kein Chrome gefunden.',
    '',
    'Gerendert wird mit dem installierten Chrome. Setze CHROME_PATH, falls',
    'die Binaerdatei woanders liegt:',
    '',
    '  CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run promo',
    '',
  ].join('\n');
  throw new Error(hint);
}

/** Argumente, die jeder unserer Chrome-Starts braucht. */
export function baseArgs(profileDir) {
  return [
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--force-device-scale-factor=1',
    '--hide-scrollbars',
  ];
}

/**
 * Ein Screenshot im Headless-Modus.
 *
 * Warum nicht einfach `execFile` und auf das Ende warten: auf macOS schreibt
 * Chrome die Datei und beendet sich danach mitunter nicht mehr — das Werkzeug
 * haengt dann ewig, obwohl das Bild laengst fertig ist. Also auf die Datei
 * warten und den Prozess danach selbst beenden.
 *
 * @param {object} options
 * @param {string} options.chrome Pfad zur Binaerdatei
 * @param {string} options.url zu rendernde Adresse (`file://…` ist erlaubt)
 * @param {string} options.out Zieldatei (PNG)
 * @param {number} options.width
 * @param {number} options.height
 * @param {string} options.profileDir Wegwerf-Profil
 * @param {number} [options.timeoutMs] Abbruch, wenn nichts entsteht
 */
export async function headlessScreenshot({ chrome, url, out, width, height, profileDir, timeoutMs = 60_000 }) {
  await rm(out, { force: true });

  const child = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    ...baseArgs(profileDir),
    `--window-size=${width},${height}`,
    `--screenshot=${out}`,
    url,
  ], { stdio: 'ignore' });

  let exited = false;
  const done = new Promise((resolve) => child.once('exit', () => { exited = true; resolve(); }));

  const deadline = Date.now() + timeoutMs;
  let size = -1;
  for (;;) {
    if (Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error(`Chrome hat ${out} nicht innerhalb von ${timeoutMs / 1000}s geschrieben.`);
    }
    await sleep(150);
    const current = await fileSize(out);
    // Zweimal dieselbe Groesse: fertig geschrieben, nicht mitten im Schreiben.
    if (current > 0 && current === size) break;
    size = current;
    if (exited && current <= 0) throw new Error(`Chrome endete ohne ${out} zu schreiben.`);
  }

  // Auf das Ende warten, bevor der Aufrufer das Profil wegräumt — sonst
  // schreibt der sterbende Chrome noch in ein Verzeichnis, das gerade gelöscht
  // wird, und `rm` scheitert mit ENOTEMPTY.
  if (!exited) {
    child.kill('SIGTERM');
    const hardKill = setTimeout(() => child.kill('SIGKILL'), 5_000);
    await done;
    clearTimeout(hardKill);
  }
}

export async function fileSize(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return -1;
  }
}

export async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Masse aus dem PNG-IHDR-Chunk. Chrome liefert bei falschem Skalierungsfaktor
 * stillschweigend die doppelte Kantenlaenge, und der Store weist das ohne
 * brauchbare Meldung ab.
 *
 * @param {Buffer} png
 */
export function pngSize(png) {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
