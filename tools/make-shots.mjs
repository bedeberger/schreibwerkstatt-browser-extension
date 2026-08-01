/**
 * Nimmt die Store-Screenshots (1280x800) mit der echten Oberflaeche auf.
 *
 *   SHOTS_TOKEN=swd_… npm run shots
 *
 * Erzeugt in store/assets/:
 *   shot-1-popup.png     Popup ueber einem Artikel, Felder gefuellt
 *   shot-2-options.png   Options-Seite: Adresse, Token, Verbindung, Standardbuch
 *   shot-3-queue.png     Warteschlange und Faehigkeiten
 *
 * Was das Werkzeug NICHT kann und was deshalb Handarbeit bleibt:
 *   - das Kontextmenue „Als Zitat erfassen" (vom Betriebssystem gezeichnet)
 *   - die Benachrichtigung mit dem Rueckgaengig-Knopf (ebenfalls OS-Ebene)
 * Beide lassen sich mit keinem Fernsteuerungsprotokoll aufnehmen; siehe die
 * Anleitung am Ende der Ausgabe.
 *
 * Ehrlichkeitsvorbehalt, damit niemand darueber stolpert: fuer den Lauf wird
 * `dist/` in ein Wegwerf-Verzeichnis kopiert und im Manifest das Server-Origin
 * unter `host_permissions` eingetragen. Grund ist allein, dass
 * `chrome.permissions.request()` eine echte Mausgeste braucht, die sich nicht
 * fernsteuern laesst. Sonst laeuft dieselbe, unveraenderte Erweiterung: alle
 * Daten in den Bildern kommen aus dem echten Server und dem echten Code.
 *
 * Braucht Node >= 22 (globales `WebSocket`) und ein installiertes Chrome.
 */

import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';

import { findChrome, baseArgs, exists, headlessScreenshot, pngSize, sleep } from './lib/chrome.mjs';
import { Cdp, browserWebSocketUrl } from './lib/cdp.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url)).replace(/\/tools$/, '');
const DIST = join(ROOT, 'dist');
const OUT_DIR = join(ROOT, 'store', 'assets');

const WIDTH = 1280;
const HEIGHT = 800;
const PORT = Number(process.env.SHOTS_PORT || 9333);

const SERVER = (process.env.SHOTS_SERVER || 'https://demo.schreibwerkstatt.app').replace(/\/+$/, '');
const TOKEN = process.env.SHOTS_TOKEN || '';
const LANG = process.env.SHOTS_LANG === 'en' ? 'en' : 'de';
const THEME = process.env.SHOTS_THEME === 'dark' ? 'dark' : 'light';
/*
 * Voreingestellt ein arXiv-Abstract: Es traegt `citation_*`-Metadaten, also
 * Titel, Autor:innen, Jahr und DOI aus erster Hand — genau der Fall, fuer den
 * die Erweiterung gebaut ist, und im Bild sieht man die Herkunftszeile dazu.
 * Wikipedia taugt schlechter: dort steht im JSON-LD `headline` die
 * Wikidata-Kurzbeschreibung, und im Titelfeld landet dann „reference to a
 * source" statt „Citation".
 */
const ARTICLE = process.env.SHOTS_ARTICLE || 'https://arxiv.org/abs/1706.03762';

const SUFFIX = LANG === 'en' ? '-en' : '';

function fail(message) {
  process.stderr.write(`\nFEHLER: ${message}\n\n`);
  process.exit(1);
}

if (!TOKEN) {
  fail([
    'Kein Token. Die Erweiterung zeigt ohne Server und Token nichts,',
    'was einen Screenshot wert waere.',
    '',
    '  SHOTS_TOKEN=swd_… npm run shots',
    '',
    'Die Werte der Demo-Instanz stehen in store/test-instructions.md.',
  ].join('\n'));
}
if (!(await exists(join(DIST, 'manifest.json')))) fail('dist/ fehlt — erst `npm run build`.');

const chrome = await findChrome().catch((error) => fail(error.message));

// ------------------------------------------------------------- Vorbereitung

const work = await mkdtemp(join(tmpdir(), 'swk-shots-'));
const extensionDir = join(work, 'extension');
const profileDir = join(work, 'profile');
await cp(DIST, extensionDir, { recursive: true });
await mkdir(OUT_DIR, { recursive: true });

const manifest = JSON.parse(await readFile(join(extensionDir, 'manifest.json'), 'utf8'));
// Server-Origin: weil `chrome.permissions.request()` eine Mausgeste braucht.
// Artikel-Origin: weil `activeTab` nur ein echter Klick auf das Symbol erteilt
// und die Ernte sonst mit UNKNOWN abbricht. Beides betrifft nur, woher die
// Berechtigung kommt — nicht, was die Erweiterung tut.
manifest.host_permissions = [`${new URL(SERVER).origin}/*`, `${new URL(ARTICLE).origin}/*`];
await writeFile(join(extensionDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

process.stdout.write(`Chrome:  ${chrome}\nServer:  ${SERVER}\nArtikel: ${ARTICLE}\nSprache: ${LANG}\n\n`);

// `--load-extension` gibt es seit Chrome 137 nicht mehr; entpackt laden geht
// nur noch ueber das CDP-Kommando `Extensions.loadUnpacked`, und das wiederum
// nur mit `--enable-unsafe-extension-debugging`.
const browser = spawn(chrome, [
  ...baseArgs(profileDir),
  `--remote-debugging-port=${PORT}`,
  '--enable-unsafe-extension-debugging',
  `--window-size=${WIDTH},${HEIGHT}`,
  '--window-position=0,0',
  `--lang=${LANG === 'en' ? 'en-US' : 'de-DE'}`,
  '--disable-popup-blocking',
  // macOS zieht die Oberflaechensprache aus den Systemeinstellungen und
  // ignoriert `--lang`; nur ueber die Cocoa-Argumente laesst sie sich fuer
  // diesen einen Prozess umbiegen.
  ...(process.platform === 'darwin'
    ? ['-AppleLanguages', LANG === 'en' ? '(en-US)' : '(de-DE)']
    : []),
  'about:blank',
], { stdio: 'ignore' });

let cdp;
try {
  cdp = await new Cdp(await browserWebSocketUrl(`http://127.0.0.1:${PORT}`)).connect();
  await run(cdp);
} finally {
  cdp?.close();
  browser.kill('SIGTERM');
  await sleep(500);
  browser.kill('SIGKILL');
  await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

// ------------------------------------------------------------------- Ablauf

async function run(cdp) {
  await cdp.send('Target.setDiscoverTargets', { discover: true });

  // 1. Erweiterung entpackt laden. Die Antwort nennt die Extension-ID; sie
  //    haengt am Pfad und ist deshalb pro Lauf eine andere.
  const { id: extensionId } = await cdp.send('Extensions.loadUnpacked', { path: extensionDir });
  process.stdout.write(`Erweiterung: ${extensionId}\n`);
  await sleep(1500);

  // 2. Einrichtung genau wie ein Mensch: Adresse und Token in die Maske,
  //    speichern, Verbindung testen, Buecher laden. Kein Umweg am Code vorbei
  //    — was auf dem Bild steht, ist damit auch wirklich passiert.
  const options = await openPage(cdp, `chrome-extension://${extensionId}/options/options.html`);
  await fill(cdp, options.session, '#server-url', SERVER);
  await fill(cdp, options.session, '#token', TOKEN);
  await click(cdp, options.session, '#save-connection');
  await sleep(1500);
  await click(cdp, options.session, '#test-connection');
  await sleep(2500);
  await click(cdp, options.session, '#refresh-books');
  await sleep(2500);

  // Erstes beschreibbares Buch als Standard waehlen — dieselbe Auswahl, die
  // ein Mensch trifft; die Seite speichert sie im `change`-Handler selbst.
  const bookName = await evaluate(cdp, options.session, `
    (() => {
      const select = document.querySelector('#default-book');
      const option = [...(select?.options ?? [])].find((o) => o.value && !o.disabled);
      if (!option) return '';
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return option.textContent.trim();
    })()
  `);
  if (!bookName) {
    const notice = await evaluate(cdp, options.session,
      'document.querySelector("#connection-result")?.textContent?.trim() || "(keine Meldung)"');
    fail(`Kein beschreibbares Buch geladen. Die Options-Seite sagt: ${notice}`);
  }
  await sleep(800);
  process.stdout.write(`Buch:    ${bookName}\n\n`);

  await shoot(cdp, options.session, join(OUT_DIR, `shot-2-options${SUFFIX}.png`));

  // 4. Faehigkeiten, Warteschlange und „Was verlaesst den Browser" sitzen
  //    weiter unten auf derselben Seite — ans Ende scrollen, dann steht der
  //    Seitenfuss buendig am unteren Bildrand.
  await evaluate(cdp, options.session, 'window.scrollTo(0, document.body.scrollHeight); 1');
  await sleep(400);
  await shoot(cdp, options.session, join(OUT_DIR, `shot-3-queue${SUFFIX}.png`));

  // 5. Popup und Artikel. Reihenfolge ist hier alles: der Service Worker
  //    ermittelt den zu erfassenden Tab mit `currentWindow`, und das ist aus
  //    seiner Sicht das zuletzt fokussierte Fenster. Also erst das Popup-
  //    Fenster, dann den Artikel in einem eigenen Fenster — der zieht den Fokus
  //    zu sich, und danach wird das Popup neu aufgebaut.
  const windowsBefore = await evaluate(cdp, options.session,
    'chrome.windows.getAll().then((ws) => ws.map((w) => w.id))', false);
  const article = await openPage(cdp, ARTICLE, { activate: true, newWindow: true });
  await sleep(2000);
  const page = await capture(cdp, article.session);

  // Welches Fenster der Artikel ist, muss feststehen: das Popup gehoert genau
  // dorthin, sonst erfasst die Erweiterung die Options-Seite im Nachbarfenster.
  const articleWindowId = await evaluate(cdp, options.session, `
    chrome.windows.getAll().then((ws) =>
      ws.map((w) => w.id).find((id) => !${JSON.stringify(windowsBefore)}.includes(id)) ?? null)
  `, false);

  // `chrome.action.openPopup()` verlangt ein im Betriebssystem fokussiertes
  // Fenster. Genau diesen Chrome nach vorn holen — ueber die Prozessnummer,
  // damit ein zweiter, privater Chrome des Nutzers unberuehrt bleibt.
  await focusApp(browser.pid);
  await sleep(800);

  const popup = (await openActionPopup(cdp, options.session, extensionId, articleWindowId))
    || (await openPopupWindow(cdp, extensionId, articleWindowId));
  if (!popup) {
    process.stdout.write(
      '\nHinweis: Das Popup liess sich nicht öffnen. Motiv 1 bleibt Handarbeit.\n',
    );
    return;
  }
  await sleep(2500);
  if (process.env.SHOTS_DEBUG) {
    const state = await evaluate(cdp, popup.session, `
      chrome.windows.getLastFocused({ populate: true }).then((w) => JSON.stringify({
        panels: [...document.querySelectorAll('section, .panel')]
          .filter((n) => getComputedStyle(n).display !== 'none')
          .map((n) => n.id || n.className),
        title: document.querySelector('#title')?.value ?? null,
        body: (document.querySelector('#body')?.value ?? '').slice(0, 40),
        provenance: document.querySelector('#provenance-notice')?.textContent?.trim().slice(0, 60),
        lastFocused: { type: w.type, active: w.tabs?.find((t) => t.active)?.url?.slice(0, 60) },
      }))
    `, false).catch((error) => `(${error.message})`);
    const harvest = await evaluate(cdp, popup.session, `
      chrome.runtime.sendMessage({ type: 'harvest-active-tab', payload: { includeArticleText: true } })
        .then((r) => JSON.stringify(r).slice(0, 400), (e) => 'ERR ' + e.message)
    `, false).catch((error) => `(${error.message})`);
    process.stdout.write(`DEBUG Harvest: ${harvest}\n`);
    process.stdout.write(`DEBUG Popup: ${state}\n`);
  }
  const popupShot = await capture(cdp, popup.session);
  await composite(page, popupShot, join(OUT_DIR, `shot-1-popup${SUFFIX}.png`));
}

// ------------------------------------------------------------------ Bausteine

async function evaluate(cdp, session, expression, userGesture = true) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture,
  }, session);
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result?.value;
}

/**
 * Holt den Chrome dieses Laufs in den Vordergrund (nur macOS). Kein Fehler,
 * wenn es nicht klappt — dann greift der Rueckfallweg mit dem Popup-Fenster.
 *
 * @param {number} pid
 */
async function focusApp(pid) {
  if (process.platform !== 'darwin' || !pid) return;
  await new Promise((resolve) => {
    execFile('osascript', [
      '-e',
      `tell application "System Events" to set frontmost of (first application process whose unix id is ${pid}) to true`,
    ], () => resolve());
  });
}

/** Wartet, bis ein Element da ist — Seiten bauen sich asynchron auf. */
async function waitFor(cdp, session, selector, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const there = await evaluate(cdp, session, `!!document.querySelector(${JSON.stringify(selector)})`, false)
      .catch(() => false);
    if (there) return;
    if (Date.now() > deadline) {
      const where = await evaluate(cdp, session, 'location.href + " / " + document.readyState', false)
        .catch((error) => `unbekannt (${error.message})`);
      throw new Error(`Kein Element ${selector} nach ${timeoutMs / 1000}s — Seite: ${where}`);
    }
    await sleep(200);
  }
}

async function fill(cdp, session, selector, value) {
  await waitFor(cdp, session, selector);
  const found = await evaluate(cdp, session, `
    (() => { const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true; })()
  `);
  if (!found) throw new Error(`Kein Element ${selector}`);
}

async function click(cdp, session, selector) {
  await waitFor(cdp, session, selector);
  const found = await evaluate(cdp, session, `
    (() => { const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false; el.click(); return true; })()
  `);
  if (!found) throw new Error(`Kein Element ${selector}`);
}

/** Neuer Tab, angehaengt, mit gesetzten Bildschirmmassen. */
async function openPage(cdp, url, { activate = false, newWindow = false } = {}) {
  // Masse kommen ueber setDeviceMetricsOverride, nicht ueber die Fenstergroesse:
  // `Target.createTarget` nimmt width/height nur fuer neue Fenster an.
  const { targetId } = await cdp.send('Target.createTarget', newWindow
    ? { url, newWindow: true, width: WIDTH, height: HEIGHT }
    : { url });
  const session = await cdp.attach(targetId);
  await cdp.send('Page.enable', {}, session);
  await cdp.send('Runtime.enable', {}, session);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false,
  }, session);
  await setTheme(cdp, session);
  if (activate) await cdp.send('Target.activateTarget', { targetId });
  await waitForLoad(cdp, session);
  return { targetId, session };
}

/**
 * Erzwingt das Farbschema. Ohne das folgt Chrome der Systemeinstellung, und
 * dann haengt es vom Rechner ab, ob die Bilder hell oder dunkel werden — die
 * Kacheln aus `make-promo.mjs` sind hell, also hier per Voreinstellung auch.
 */
async function setTheme(cdp, session) {
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: THEME }],
  }, session).catch(() => {});
}

async function waitForLoad(cdp, session, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await evaluate(cdp, session, 'document.readyState', false).catch(() => null);
    if (state === 'complete') return;
    if (Date.now() > deadline) return;
    await sleep(200);
  }
}

/** @returns {Promise<Buffer>} PNG */
async function capture(cdp, session) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session);
  return Buffer.from(data, 'base64');
}

async function shoot(cdp, session, out) {
  const png = await capture(cdp, session);
  await writeFile(out, png);
  report(out, png);
}

/**
 * Oeffnet das echte Aktions-Popup. `chrome.action.openPopup()` gibt es seit
 * Chrome 127; scheitert es (aeltere Version, keine Geste), liefern wir null
 * statt ein falsches Bild zu bauen.
 */
async function openActionPopup(cdp, session, extensionId, windowId) {
  if (windowId == null) return null;
  try {
    // Ohne fokussiertes Fenster antwortet Chrome mit „Could not find an active
    // browser window" — also erst holen, dann oeffnen. Und zwar genau das
    // Fenster mit dem Artikel: das Popup erfasst dessen aktiven Tab.
    await evaluate(cdp, session, `
      (async () => {
        await chrome.windows.update(${windowId}, { focused: true });
        await chrome.action.openPopup({ windowId: ${windowId} });
        return 'ok';
      })()
    `);
  } catch (error) {
    process.stdout.write(`chrome.action.openPopup: ${error.message}\n`);
    return null;
  }
  const target = await cdp.findTarget(
    (t) => t.url.startsWith(`chrome-extension://${extensionId}/popup/`),
    8000,
  );
  if (!target) return null;
  const popupSession = await cdp.attach(target.targetId);
  await cdp.send('Page.enable', {}, popupSession);
  await cdp.send('Runtime.enable', {}, popupSession);
  await setTheme(cdp, popupSession);
  await waitForLoad(cdp, popupSession);
  return { targetId: target.targetId, session: popupSession };
}

/**
 * Rueckfallweg, wenn Chrome das Aktions-Popup nicht oeffnen will — auf macOS
 * verlangt es ein im Betriebssystem fokussiertes Fenster, und das laesst sich
 * aus einem Skript nicht erzwingen, ohne dem Nutzer den Fokus zu klauen.
 *
 * Dieselbe Seite in einem eigenen Fenster liefert dasselbe Bild: der Service
 * Worker ermittelt den zu erfassenden Tab mit `currentWindow: true`, und das
 * ist aus seiner Sicht weiterhin das zuletzt fokussierte normale Fenster — also
 * der Artikel.
 */
async function openPopupWindow(cdp, extensionId, articleWindowId) {
  const { targetId } = await cdp.send('Target.createTarget', {
    url: `chrome-extension://${extensionId}/popup/popup.html`,
    newWindow: true,
    width: 460,
    height: 760,
  });
  const session = await cdp.attach(targetId);
  await cdp.send('Page.enable', {}, session);
  await cdp.send('Runtime.enable', {}, session);
  await setTheme(cdp, session);
  await waitForLoad(cdp, session);

  // Fokus zurueck auf das Artikelfenster (das zuletzt geoeffnete der vorher
  // vorhandenen) und das Popup neu aufbauen lassen.
  if (articleWindowId != null) {
    await evaluate(cdp, session,
      `chrome.windows.update(${articleWindowId}, { focused: true }).then(() => 'ok')`, false)
      .catch(() => {});
    await sleep(800);
  }
  await cdp.send('Page.reload', {}, session);
  await waitForLoad(cdp, session);
  await sleep(2500);

  const size = await evaluate(cdp, session, `
    (() => {
      const width = Math.ceil(document.documentElement.getBoundingClientRect().width);
      const height = Math.ceil(document.body.scrollHeight);
      return { width, height };
    })()
  `, false);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: Math.min(size.width || 420, 520),
    height: Math.min(Math.max(size.height || 600, 420), HEIGHT - 60),
    deviceScaleFactor: 1,
    mobile: false,
  }, session);
  await sleep(400);
  return { targetId, session };
}

/**
 * Setzt Seite und Popup zu einem Bild in genau 1280x800 zusammen — so, wie es
 * auf dem Bildschirm aussieht: das Popup rechts oben unter der Symbolleiste.
 * Gerechnet wird im Browser, damit kein Bildwerkzeug installiert sein muss.
 */
async function composite(pageShot, popupShot, out) {
  const popupSize = pngSize(popupShot);
  const html = `<!doctype html><meta charset="utf-8"><style>
    * { margin: 0; padding: 0; }
    html, body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: #fff; }
    .page { position: absolute; inset: 0; width: ${WIDTH}px; height: ${HEIGHT}px; }
    .popup {
      position: absolute; top: 8px; right: 12px;
      width: ${popupSize.width}px; height: ${popupSize.height}px;
      border-radius: 8px;
      box-shadow: 0 12px 34px rgba(15, 30, 45, 0.34), 0 2px 8px rgba(15, 30, 45, 0.2);
    }
  </style>
  <img class="page" src="data:image/png;base64,${pageShot.toString('base64')}">
  <img class="popup" src="data:image/png;base64,${popupShot.toString('base64')}">`;

  const dir = await mkdtemp(join(tmpdir(), 'swk-comp-'));
  const htmlFile = join(dir, 'composite.html');
  await writeFile(htmlFile, html, 'utf8');
  await headlessScreenshot({
    chrome,
    url: `file://${htmlFile}`,
    out,
    width: WIDTH,
    height: HEIGHT,
    profileDir: join(dir, 'profile'),
  });
  report(out, await readFile(out));
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

function report(out, png) {
  const { width, height } = pngSize(png);
  const ok = width === WIDTH && height === HEIGHT;
  process.stdout.write(
    `${relative(ROOT, out)}  ${width}x${height}  ${(png.length / 1024).toFixed(1)} KiB`
    + `${ok ? '' : `  ← FALSCHE MASSE, erwartet ${WIDTH}x${HEIGHT}`}\n`,
  );
}

process.stdout.write([
  '',
  'Von Hand bleiben zwei Motive — beide zeichnet das Betriebssystem, nicht die Seite:',
  '',
  '  Kontextmenü   Text markieren, Rechtsklick, „Als Zitat erfassen" im Menü,',
  '                dann Bildschirmfoto (macOS: Umschalt+Cmd+4, Leertaste für das Fenster).',
  '  Hinweis       Zitat erfassen und die Benachrichtigung mit dem Rückgängig-Knopf',
  '                abfotografieren, solange das Fenster von 6 Sekunden läuft.',
  '',
  'Beide danach auf exakt 1280x800 bringen — Rezept in store/PUBLISHING.md.',
  '',
].join('\n'));
