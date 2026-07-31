# Testanleitung für die Prüfung

Der Text im Kasten geht in das Feld **„Testanleitung"** im Developer-Dashboard.

Warum das der wichtigste Text der ganzen Einreichung ist: die Erweiterung ist
ohne Server und Token **funktionslos**. Ein Prüfer, der das Popup öffnet und nur
„Nicht verbunden" sieht, hat keinen Grund anzunehmen, dass die Erweiterung
überhaupt etwas tut — und „funktioniert nicht wie beschrieben" ist ein
Ablehnungsgrund.

---

## Werte für die Einreichung

**Hier eintragen, was die Demo-Instanz seedet.** Alles weiter unten verweist auf
diese Tabelle, damit die Werte nur an einer Stelle stehen.

| | Wert |
|---|---|
| Adresse | `<DEMO-URL>` — z. B. `https://demo.schreibwerkstatt.example.org` |
| Gerätetoken | `<DEMO-TOKEN>` — beginnt mit `swd_`, braucht die Erfassungs-Berechtigung |
| Zielbuch | `<DEMO-BUCH>` — der Name, wie er im Popup in der Auswahl steht |

> Das Feld „Testanleitung" ist ein Prüf-Feld: es erscheint **nicht** im
> öffentlichen Store-Eintrag, nur die Prüfung sieht es. Das Token wird damit
> nicht der Allgemeinheit bekannt — es sollte aber trotzdem eines sein, das du
> ohne Bauchschmerzen widerrufen kannst.

---

## Was die Demo-Instanz mitbringen sollte

Damit die Prüfung glatt läuft und nichts durchsickert:

- **Mindestens ein Buch mit `owner`- oder `editor`-Rolle**, in das der Prüfer
  erfassen kann. Sonst kommt er über den Verbindungstest nicht hinaus.
- **Ein Buch mit `viewer`-Rolle**, z. B. „Fremdes Buch". Nice to have: damit
  lässt sich der Fehlerpfad `BOOK_ACCESS_DENIED` vorführen, und dass die
  Erweiterung Fehler sauber benennt statt stillschweigend zu scheitern, ist ein
  gutes Argument. Wenn du es seedest, Abschnitt C im Formulartext drinlassen,
  sonst streichen.
- **Keine echten E-Mail-Adressen im Seed.** `GET /content/books` gibt zu jedem
  Buch die `owner_email` heraus, und der Prüfer sieht die Antwort. Nimm
  `example.org`-Adressen — nicht deine, und erst recht nicht die von
  Mitarbeitenden.
- **Ein Token, das nicht abläuft** oder das mindestens mehrere Wochen gültig
  bleibt. Die Prüfung kann Wochen dauern; läuft das Token mitten darin aus, sieht
  der Prüfer eine Erweiterung, die sich nicht verbinden kann.
- **Regelmäßiges Zurücksetzen der Demo-Daten**, z. B. per Cron nächtlich. Der
  Prüfer legt Einträge an, der API-Vertrag kennt kein `DELETE /research/:id`, und
  bei einer Nachbesserung oder einem späteren Update kommt die nächste Runde.
  Eine Instanz, die sich selbst aufräumt, bleibt über Monate vorzeigbar.
- **HTTPS.** Die Options-Seite warnt bei einer nicht-lokalen `http`-Adresse, und
  eine Warnung im Einrichtungsdialog ist das Letzte, was ein Prüfer sehen soll.

Wenn die Demo-Instanz erst später steht: [Variante B](#variante-b--referenz-server-aus-diesem-repo)
überbrückt das ohne Mutterprojekt.

---

## Variante A — Demo-Instanz (Empfehlung)

Der Prüfer bedient die echte Anwendung. Kein Vorbehalt im Text nötig, kein Bezug
auf Testdoubles — das ist der glatteste Weg durch die Prüfung.

Vor dem Einreichen die drei Platzhalter aus
[der Tabelle oben](#werte-für-die-einreichung) einsetzen und die Einrichtung
**einmal selbst wie ein Prüfer durchklicken**, in einem frischen Chrome-Profil
ohne deine bestehende Konfiguration.

```
Schreibwerkstatt is a self-hosted writing app; this extension is its browser
companion and has no bundled backend. It cannot be exercised without a server,
so I have set up a demo instance for this review. It holds sample data only —
no real user content.

SETUP (about one minute)

1. Right-click the extension icon and choose "Options" (the options page also
   opens from the gear icon in the popup).
2. Server address:  <DEMO-URL>
   Device token:    <DEMO-TOKEN>
3. Click "Save".
4. Click "Grant access to this host". Chrome will ask for the host permission
   for this single origin. This is expected and required — see the host
   permission justification. The manifest deliberately contains no <all_urls>;
   the address of a self-hosted app differs per user and cannot be declared in
   the manifest, so it is requested at runtime for exactly one origin.
5. Click "Test connection". The demo instance's books load.
6. Pick "<DEMO-BUCH>" as the default book.

WHAT TO TEST

A) Capture a page
   Open any article, e.g. https://en.wikipedia.org/wiki/Citation
   Click the extension icon (or press Alt+Shift+S). The form is pre-filled from
   the page's own metadata — title, authors, journal, year, DOI, URL, access
   date, body text — and shows where each field came from. Press "Send".

B) Capture a quote
   Select a sentence on that page, right-click, choose "Capture as quote"
   (or press Alt+Shift+Q). A notification appears with an Undo button. If you
   press Undo within 6 seconds, no server record is created at all; the request
   is only sent after the undo window closes.

C) Error handling
   Capture into the book "Fremdes Buch". The account has viewer access only, so
   the server refuses it and the extension reports precisely why, naming the
   error code, instead of failing silently.

D) Offline queue (optional)
   Change the server address to an unreachable host and capture a page. The item
   goes into a retry queue with exponential backoff and is shown on the toolbar
   badge. Nothing is ever dropped silently.

NOTES FOR REVIEW

- No remote code. Nothing is loaded or executed from a remote source; the
  Content Security Policy in the manifest allows 'self' only. The code in the
  package is neither minified nor obfuscated.
- Network traffic goes exclusively to the host entered in step 2. There is no
  default server, no analytics, no telemetry and no third-party endpoint.
  Apart from relative API paths, the package contains no hardcoded address.
- There is no persistent content script. The harvesting script is injected via
  activeTab at the moment of a user action only.
- Source code: https://github.com/bedeberger/schreibwerkstatt-browser-extension

Contact for questions during review: bede.berger@gmail.com
```

> Kein `viewer`-Buch geseedet? Dann Abschnitt C streichen. Etwas anzukündigen,
> was der Prüfer nicht vorfindet, ist schlimmer als es weglassen.

---

## Variante B — Referenz-Server aus diesem Repo

Falls die Demo-Instanz noch nicht steht oder ausfällt. Braucht das Mutterprojekt
nicht:

```bash
REVIEW_TOKEN=swd_pruefung_$(openssl rand -hex 12) PORT=8787 npm run review-server
```

[../tools/review-server.mjs](../tools/review-server.mjs) bietet denselben
API-Vertrag an, gegen den `test/integration.test.js` prüft — Zustand nur im
Arbeitsspeicher, kein Plattenzugriff, kein Bezug zu echten Daten. Er liefert
*Nordlicht* (owner), *Mitschrift* (editor) und *Fremdes Buch* (viewer, gibt
absichtlich `BOOK_ACCESS_DENIED`), protokolliert jede Anfrage und ist nach
Strg+C restlos weg. Braucht ebenfalls HTTPS über deinen Reverse-Proxy.

Formulartext aus Variante A übernehmen, aber den ersten Absatz ersetzen — hier
ist der Vorbehalt Pflicht, weil es *nicht* die echte Anwendung ist:

```
Schreibwerkstatt is a self-hosted writing app; this extension is its browser
companion and has no bundled backend. It cannot be exercised without a server,
so I have deployed a reference implementation of that server's REST API for the
duration of this review. It serves sample data — it is not a production system
and contains no real user content. Its source is in the repository at
tools/review-server.mjs and test/helpers/mock-server.js, so you can verify that
the extension speaks exactly the documented contract.
```

In Schritt 6 „Nordlicht" als Zielbuch nennen.

---

## Variante C — Produktions-Token

**Nicht nehmen.** Steht hier nur, damit die Begründung dokumentiert ist:

- `GET /content/books` gibt die Titel **aller** deiner Buchprojekte heraus und
  dazu die `owner_email` der Eigentümer. Bei gemeinsam bearbeiteten Büchern
  gehen damit E-Mail-Adressen anderer Leute an einen Google-Prüfer, die dir das
  nicht erlaubt haben.
- Der API-Vertrag kennt kein `DELETE /research/:id`. Die Testeinträge des
  Prüfers räumst du in der Web-App von Hand weg.
- Der Fehlerpfad aus Abschnitt C lässt sich nicht vorführen, ohne dir selbst ein
  Buch zu entziehen.

Variante A und B leisten dasselbe ohne all das.

---

## Variante D — ohne Server

Letzter Ausweg. Dem Prüfer fehlt jede Möglichkeit, die Erweiterung zu bedienen;
das Ablehnungsrisiko steigt deutlich. Nicht hoffnungslos, wenn du es offen sagst
und den Rest so nachvollziehbar wie möglich machst.

```
This extension is a companion to a self-hosted web app ("Schreibwerkstatt")
that the user installs on their own server. It has no bundled backend and no
default server address, and it therefore cannot be exercised end to end
without such an installation. I am unfortunately not able to provide a public
test instance at the moment. Everything that can be verified without one is
listed below.

WHAT CAN BE VERIFIED WITHOUT A SERVER

1. Right-click the extension icon, choose "Options". The options page explains
   the setup and validates the address and token format.
2. Enter any https URL, e.g. https://example.org, and any token starting with
   "swd_", then click "Save".
3. Click "Grant access to this host". Chrome asks for the host permission for
   that single origin. This demonstrates the whole point of the broad optional
   host pattern in the manifest: exactly one user-supplied origin is requested
   at runtime. The manifest contains no <all_urls> and no static
   host_permissions.
4. Click "Test connection". The error handling is visible: the extension
   reports precisely why the host did not answer as expected, rather than
   failing silently.
5. Open any article and click the extension icon (or press Alt+Shift+S). The
   capture form fills itself from the page's metadata — title, authors,
   journal, year, DOI, URL, access date, body text — and shows the provenance
   of each field. This is the entire harvesting path and it needs no server.
6. Select text, right-click, choose "Capture as quote". The notification with
   its Undo button appears. Sending fails against a non-existent host, and the
   item is placed in the visible retry queue instead of being dropped.

If it would help the review, I can stand up a demo instance of the server on
request — please just ask.

NOTES FOR REVIEW

- No remote code. Nothing is loaded or executed from a remote source; the
  Content Security Policy in the manifest allows 'self' only. The code in the
  package is neither minified nor obfuscated, so the network layer can be read
  directly: see background/api-client.js.
- Every request URL is built from the address the user entered. Apart from
  relative API paths, the package contains no hardcoded address. This is
  verifiable by grepping the package for "http".
- There is no persistent content script. The harvesting script is injected via
  activeTab at the moment of a user action only.
- Source code: https://github.com/bedeberger/schreibwerkstatt-browser-extension

I am glad to answer any question that would help the review.
Contact: bede.berger@gmail.com
```

---

## Vor dem Absenden

- [ ] `<DEMO-URL>`, `<DEMO-TOKEN>` und `<DEMO-BUCH>` in
      [der Tabelle oben](#werte-für-die-einreichung) und im Formulartext ersetzt
- [ ] Demo-Instanz über **HTTPS** erreichbar, Zertifikat gültig
- [ ] Seed enthält keine echten E-Mail-Adressen
- [ ] Token hat die Erfassungs-Berechtigung und läuft nicht in den nächsten
      Wochen ab
- [ ] Abschnitt C passt zum Seed — `viewer`-Buch vorhanden oder Abschnitt raus
- [ ] Einrichtung in einem **frischen Chrome-Profil** einmal selbst
      durchgeklickt, so wie der Prüfer sie vorfindet
