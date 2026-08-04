/**
 * Holt einmalig das Refresh-Token fuer die Chrome-Web-Store-API.
 *
 *   npm run store:auth
 *
 * Startet einen Server auf `localhost`, oeffnet den Zustimmungsbildschirm,
 * faengt den Autorisierungs-Code auf und schreibt das Refresh-Token in
 * `~/.config/schreibwerkstatt-cws.json` (Rechte 600, nie ins Repository).
 *
 * Der Loopback-Weg ist noetig, weil der frueher ueebliche
 * `urn:ietf:wg:oauth:2.0:oob`-Fluss („Code abschreiben") von Google
 * abgeschaltet ist. Fuer einen OAuth-Client des Typs „Desktop-App" ist jeder
 * `http://localhost`-Port ohne Voranmeldung zugelassen — die Portnummer muss
 * also nirgends eingetragen werden.
 *
 * Ein einziges Mal noetig. Danach lebt das Token, **solange der
 * Zustimmungsbildschirm auf „In Produktion" steht**; im Status „Testing"
 * verfaellt es nach sieben Tagen und dieser Befehl ist wieder faellig.
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertOutsideRepo, authUrl, exchangeCode, missingFields, readConfig, updateConfig,
} from './lib/cws.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.CWS_AUTH_PORT || 8976);

/** @param {string} message */
function fail(message) {
  process.stderr.write(`\nFEHLER: ${message}\n\n`);
  process.exit(1);
}

/** @param {string} line */
function say(line) {
  process.stdout.write(`${line}\n`);
}

/**
 * Oeffnet die Adresse im Standardbrowser. Scheitert das, bleibt die Adresse
 * auf der Konsole stehen — der Ablauf haengt nicht daran.
 *
 * @param {string} url
 */
function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(command, args, { stdio: 'ignore', detached: true }).unref();
  } catch { /* dann von Hand */ }
}

/**
 * Wartet auf die Weiterleitung des Zustimmungsbildschirms.
 *
 * @param {string} redirectUri
 * @returns {Promise<string>} der Autorisierungs-Code
 */
function waitForCode(redirectUri) {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url, redirectUri);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(code
        ? 'Angemeldet. Fenster kann geschlossen werden.\n'
        : `Abgebrochen: ${error ?? 'kein Code in der Weiterleitung'}\n`);

      server.close();
      if (code) resolvePromise(code);
      else rejectPromise(new Error(error ?? 'Weiterleitung ohne Code.'));
    });

    server.on('error', rejectPromise);
    // Nur auf der Loopback-Adresse lauschen: der Code ist ein Geheimnis auf Zeit.
    server.listen(PORT, '127.0.0.1');
  });
}

// --- Ablauf -----------------------------------------------------------------

const config = await readConfig();

const inRepo = assertOutsideRepo(config.file, ROOT);
if (inRepo) fail(inRepo);

const missing = missingFields(config, { refreshToken: false });
if (missing.length) {
  fail([
    `In ${config.file} fehlt:`,
    ...missing.map((field) => `  - ${field}`),
    '',
    'Die Werte stammen aus der Google Cloud Console (OAuth-Client vom Typ',
    '„Desktop-App") und dem Developer Dashboard (Item-ID). Aufbau der Datei:',
    '',
    '  { "item_id": "…", "client_id": "…", "client_secret": "…" }',
  ].join('\n'));
}

if (config.refreshToken) {
  say('Hinweis: es liegt schon ein Refresh-Token. Es wird jetzt ersetzt.\n');
}

const redirectUri = `http://localhost:${PORT}`;
const url = authUrl({ clientId: config.clientId, redirectUri });

say('Zustimmungsbildschirm wird geoeffnet. Falls nichts passiert, diese Adresse');
say('von Hand aufrufen:\n');
say(`  ${url}\n`);
say('Der Warnhinweis „Google hat diese App nicht verifiziert" ist erwartbar —');
say('es ist deine eigene App. Ueber „Erweitert" fortfahren.\n');

openBrowser(url);

let code;
try {
  code = await waitForCode(redirectUri);
} catch (error) {
  fail(error.code === 'EADDRINUSE'
    ? `Port ${PORT} ist belegt. Mit CWS_AUTH_PORT einen anderen waehlen.`
    : error.message);
}

let tokens;
try {
  tokens = await exchangeCode({
    code,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri,
  });
} catch (error) {
  fail(error.message);
}

if (!tokens.refresh_token) {
  fail([
    'Google hat kein Refresh-Token geschickt, nur ein Access-Token.',
    'Das passiert, wenn die Zustimmung schon erteilt war; `prompt=consent` sollte',
    'das verhindern. Zugriff unter https://myaccount.google.com/permissions',
    'entziehen und den Befehl wiederholen.',
  ].join('\n'));
}

await updateConfig(config.file, { refresh_token: tokens.refresh_token });

say('');
say(`Refresh-Token in ${config.file} gespeichert (Rechte 600).`);
say('');
say('Naechster Schritt: `npm run store:publish -- --dry-run` prueft die');
say('Verbindung, ohne etwas zu senden.');
say('');
say('Wichtig, damit das Token nicht in sieben Tagen verfaellt: der');
say('OAuth-Zustimmungsbildschirm muss in der Cloud Console auf');
say('„In Produktion" stehen, nicht auf „Testing".');
say('');
