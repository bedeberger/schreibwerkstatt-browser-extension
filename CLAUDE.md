# schreibwerkstatt-browser-extension

Chrome-Erweiterung (Manifest V3), die Webseiten als **Recherche-Fundstück** oder
**zitierfähige Quelle** in eine selbst gehostete Schreibwerkstatt-Instanz schickt.
Vanilla JS als ESM, esbuild als Bündler, `node:test` für Tests. Funktionsumfang,
Berechtigungen und Datenschutz: [README.md](README.md) — diese Datei enthält nur
die Arbeitsregeln.

```bash
npm install
npm run build     # dist/ erzeugen (unmittelbar in chrome://extensions ladbar)
npm run watch     # dist/ beobachten
npm test          # alle Tests, kein Netz und kein Server nötig
npm run icons     # Symbole neu erzeugen
npm run clean     # dist/ löschen
```

Node ≥ 20. `npm test` muss vor jedem Commit grün sein.

Ein versionierter Stand entsteht mit dem Befehl `/release`
([.claude/commands/release.md](.claude/commands/release.md)): Vorprüfungen, Test,
`npm run package`, Tag, GitHub-Release mit dem ZIP als Anhang. Der Upload in den
Chrome Web Store bleibt Handarbeit — [store/PUBLISHING.md](store/PUBLISHING.md).

---

## Verhältnis zum Mutterprojekt

Die Server-App **schreibwerkstatt** ist das Mutterprojekt und wird in einem eigenen
Repository entwickelt: <https://github.com/bedeberger/schreibwerkstatt> (lokal
üblicherweise als Geschwisterordner `../schreibwerkstatt` ausgecheckt).

Dieses Repository enthält **ausschließlich den Client**. Der API-Vertrag ist dort
die Single Source of Truth, nicht hier:

| Was | Wo im Mutterprojekt |
|---|---|
| Vertrag der Erweiterung, Begründungen, Idempotenz-Regeln | [`docs/clients.md`](https://github.com/bedeberger/schreibwerkstatt/blob/main/docs/clients.md) → Abschnitt *„Dritter Client: Browser-Erweiterung"* |
| `POST /capture` (transaktionaler Ein-Request-Pfad) | `routes/capture.js` |
| `POST /research`, `POST /research/:id/{image,doc}` | `routes/research.js` |
| `POST /sources`, `GET /sources/{lookup,by-url}`, `POST /sources/:id/{link,pdf,doc}` | `routes/sources.js` |
| Geräte-Token `swd_…` und die durchgesetzte Scope-Allowlist | `lib/device-scopes.js`, `lib/device-auth.js` |
| Token ausstellen (`POST /me/device-tokens`, `kind: 'capture'`) | `routes/usersettings.js` |
| URL-Normalisierung serverseitig (Dublettenvergleich) | `lib/url-normalize.js` |

Die Erweiterung darf nur Pfade ansprechen, die in der `capture:write`-Allowlist
stehen; alles andere antwortet `403 DEVICE_SCOPE_FORBIDDEN`. Kein `DELETE`, kein
`/me/*`, kein `/jobs/*`, kein Zugriff auf den Manuskripttext. Die clientseitig
verwendeten Endpunkte stehen gesammelt in
[src/background/api-client.js](src/background/api-client.js).

---

## Harte Regel: API-Änderungen nur als Prompt für das Mutterprojekt

**In diesem Repository wird nie eine Serveränderung implementiert, angenommen oder
vorausgesetzt.** Auch nicht „nur schnell das Feld mitschicken" — die App weist
unbekannte Felder und Pfade ab, und ein hier erfundener Vertrag driftet
unbemerkt.

Sobald eine Aufgabe eine Änderung am Server verlangt — neuer Endpunkt, neues Feld
in Request oder Response, geänderter `error_code`, geändertes Limit, neuer Scope,
andere Idempotenz-Regel, ein Serverfehler, der nicht clientseitig gehört —, gilt:

1. **Anhalten** vor dem Client-Code, der davon abhängt.
2. Die Serveränderung als **fertigen Prompt** ausgeben, den der Nutzer in eine
   Claude-Code-Sitzung im Mutterprojekt einsetzen kann (Vorlage unten). Nicht als
   Prosa-Vorschlag, nicht als Patch, nicht als Issue-Text — als Prompt.
3. Erst danach die Client-Seite bauen, und zwar so, dass sie **gegen den heutigen
   Server weiterläuft**: hinter Fähigkeits-Erkennung
   ([src/background/capabilities.js](src/background/capabilities.js)) mit
   dokumentiertem Fallback, oder als klar gemeldete Ablehnung. Nie ein Pfad, der
   ohne die noch nicht deployte Änderung stillschweigend scheitert.

Zum Prompt gehört immer die Pflege von `docs/clients.md` im Mutterprojekt mit —
ein Vertrag ohne Doku ist der nächste Drift.

Umgekehrt gilt dasselbe passiv: fällt beim Arbeiten auf, dass Server und
Erweiterung auseinanderlaufen (Limit, Fehlercode, Feldname), ist das ein Befund
plus Prompt — nicht ein Workaround, der die Abweichung hier verewigt.

### Vorlage

````markdown
```
Kontext: Die Browser-Erweiterung `schreibwerkstatt-browser-extension` braucht eine
Serveränderung. Sie authentisiert per Geräte-Token mit `kind: 'capture'`
(`capture:write`-Scope, Allowlist in lib/device-scopes.js) und ist in
docs/clients.md unter „Dritter Client: Browser-Erweiterung" dokumentiert.

Anlass: <was die Erweiterung tun soll und warum es heute nicht geht>

Gewünschte Änderung:
- Endpunkt/Route: <Methode + Pfad, betroffene Datei in routes/>
- Request: <Felder, Typen, Pflicht/optional>
- Response: <Felder>
- Fehlerfälle: <error_code + HTTP-Status je Fall>
- Scope: <steht der Pfad schon in der capture-Allowlist? sonst dort ergänzen>
- Limits/Validierung: <Grenzen, damit der Client sie spiegeln kann>
- Idempotenz: <Verhalten bei Wiederholung desselben Requests>

Bitte zusätzlich:
- docs/clients.md im Abschnitt zur Browser-Erweiterung nachziehen
- Tests für die neuen Pfade inkl. Fehlerfälle
- am Ende den fertigen Vertrag in der Form zurückgeben, die ich in die
  Erweiterung übernehmen kann (Pfad, Body, Response, error_codes)
```
````

Der Client-Teil im Anschluss gehört in
[src/background/api-client.js](src/background/api-client.js) (Requests),
[src/background/capture-runner.js](src/background/capture-runner.js) (Ablauf),
[src/shared/limits.js](src/shared/limits.js) (gespiegelte Grenzen) und
[src/shared/errors.js](src/shared/errors.js) (Fehlercode → Text), mit einem Test in
[test/integration.test.js](test/integration.test.js) gegen den Mock-Server
[test/helpers/mock-server.js](test/helpers/mock-server.js), der den Vertrag nachbaut.

---

## Client-Konventionen

- **Trennlinie:** alles unter [src/shared/](src/shared/) und
  [src/content/extract-meta.js](src/content/extract-meta.js) ist frei von
  `chrome`-APIs und deshalb direkt testbar.
  [src/background/service-worker.js](src/background/service-worker.js) ist die
  einzige Datei, die Chrome-Ereignisse verdrahtet.
- **Alle Netzwerkanfragen laufen im Service Worker.** Nur er ist durch die
  Host-Berechtigung von CORS befreit; derselbe Request aus einem Content-Script
  scheitert.
- **Keine feste Server-Adresse, keine externe Ressource.** Keine Schrift, kein
  CDN, kein Analytics, kein Crash-Reporting. Beispieladressen in Code, Tests und
  Sprachdateien immer `schreibwerkstatt.example.com`.
- **Kein stilles Verwerfen.** Gescheiterte Aufträge bleiben in der Warteschlange,
  bis der Nutzer sie verwirft; jede Fehlermeldung nennt den `error_code`.
- **i18n:** keine hartcodierten Strings, keine Inline-Styles, beide
  `_locales/{de,en}/messages.json` deckungsgleich —
  [test/i18n.test.js](test/i18n.test.js) erzwingt das.
- **Wortlauttreue:** ein markiertes Zitat wird nie beschnitten oder normalisiert,
  sondern im Grenzfall sichtbar abgelehnt.
- Getroffene Annahmen zum Vertrag stehen im README unter *Getroffene Annahmen* und
  sind je mit einem Test festgenagelt; ändert der Server sie, gilt die Prompt-Regel.

---

## Öffentliches Repository

Dieses Repository ist öffentlich. Entsprechend gehört nichts davon hinein:

- Geräte-Token, Zugangsdaten, `.env`-Dateien (in Tests nur Attrappen wie
  `swd_gueltig`)
- echte Hostnamen, IP-Adressen oder Instanzpfade des Nutzers
- lokale absolute Pfade (`/home/…`) in Code, Doku oder Kommentaren
- Logs, Datenbanken, `dist/`-Artefakte, Test-Ausgaben
- Test-Fixtures oder Screenshots mit personenbezogenen Daten — die HTML-Fixtures
  unter [test/fixtures/](test/fixtures/) sind bewusst erfunden
