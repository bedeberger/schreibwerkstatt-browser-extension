# Testanleitung für die Prüfung

Der Text im Kasten geht in das Feld **„Testanleitung"** im Developer-Dashboard.

Warum das der wichtigste Text der ganzen Einreichung ist: die Erweiterung ist
ohne Server und Token **funktionslos**. Ein Prüfer, der das Popup öffnet und nur
„Nicht verbunden" sieht, hat keinen Grund anzunehmen, dass die Erweiterung
überhaupt etwas tut — und „funktioniert nicht wie beschrieben" ist ein
Ablehnungsgrund.

Drei Wege, in dieser Rangfolge:

| | Weg | Urteil |
|---|---|---|
| **A** | [Referenz-Server für die Prüfdauer](#variante-a--referenz-server-empfehlung) | ✅ **Empfehlung** |
| **B** | [Token auf der Produktion](#variante-b--produktions-token-nicht-empfohlen) | ⚠️ nur im Notfall |
| **C** | [Gar kein Server](#variante-c--ohne-server) | ❌ letzter Ausweg |

---

## Variante A — Referenz-Server (Empfehlung)

Der Vertrag, gegen den `test/integration.test.js` prüft, ist vollständig
implementiert und liegt schon im Repo. `tools/review-server.mjs` bietet ihn
öffentlich an, mit Beispieldaten statt echter:

```bash
REVIEW_TOKEN=swd_pruefung_$(openssl rand -hex 12) PORT=8787 npm run review-server
```

Der Server hält seinen Zustand nur im Arbeitsspeicher, schreibt nichts auf Platte
und greift auf nichts Echtes zu. Nach der Prüfung Prozess beenden — fertig.
Nichts wegzuräumen, kein Token zu widerrufen.

Er protokolliert jede Anfrage. Daran siehst du nebenbei, ob der Prüfer die
Erweiterung wirklich ausprobiert hat.

**Zwei Voraussetzungen:**

1. **HTTPS.** Die Options-Seite warnt bei einer nicht-lokalen `http`-Adresse, und
   eine Warnung im Einrichtungsdialog ist das Letzte, was ein Prüfer sehen soll.
   Also hinter deinen bestehenden Reverse-Proxy mit Zertifikat, z. B. als
   `https://cws-review.<deine-domain>` oder als Unterpfad — die Erweiterung kann
   beides. Du betreibst die Schreibwerkstatt schon selbst, die Infrastruktur ist
   also da; es ist ein Server-Block, kein neues Hosting.
2. **Erreichbar bleiben, bis die Prüfung durch ist.** Das können Wochen sein.
   Lauf ihn unter systemd oder in einem Container, nicht in einem Terminal, das
   irgendwann zugeht.

Was der Prüfer zu sehen bekommt: drei Bücher — *Nordlicht* (owner), *Mitschrift*
(editor) und *Fremdes Buch* (viewer, liefert absichtlich `BOOK_ACCESS_DENIED`,
damit auch die Fehlerbehandlung sichtbar wird). Erfassen, Zitate, DOI-Lookup,
Anhänge und Warteschlange funktionieren vollständig.

### Text für das Formular

```
Schreibwerkstatt is a self-hosted writing app; this extension is its browser
companion and has no bundled backend. It cannot be exercised without a server,
so I have deployed a reference implementation of that server's REST API for the
duration of this review. It serves sample data — it is not a production system
and contains no real user content. Its source is in the repository at
tools/review-server.mjs and test/helpers/mock-server.js, so you can verify that
the extension speaks exactly the documented contract.

SETUP (about one minute)

1. Right-click the extension icon and choose "Options" (the options page also
   opens from the gear icon in the popup).
2. Server address:  <REVIEW-SERVER-URL EINTRAGEN, z. B. https://cws-review.example.org>
   Device token:    <REVIEW_TOKEN EINTRAGEN, beginnt mit swd_>
3. Click "Save".
4. Click "Grant access to this host". Chrome will ask for the host permission
   for this single origin. This is expected and required — see the host
   permission justification. The manifest deliberately contains no <all_urls>;
   the address of a self-hosted app differs per user and cannot be declared in
   the manifest, so it is requested at runtime for exactly one origin.
5. Click "Test connection". Three sample books load.
6. Pick "Nordlicht" as the default book.

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
   Capture into the book "Fremdes Buch". The server refuses it (the account has
   viewer access only) and the extension reports precisely why, naming the
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

---

## Variante B — Produktions-Token (nicht empfohlen)

Nur, wenn A aus irgendeinem Grund nicht geht. Was du dabei in Kauf nimmst:

- **`GET /content/books` gibt alles heraus.** Nicht nur die Titel aller deiner
  Buchprojekte, sondern auch die `owner_email` der jeweiligen Eigentümer. Bei
  gemeinsam bearbeiteten Büchern gibst du damit **E-Mail-Adressen anderer Leute**
  an einen Google-Prüfer weiter, die dir dafür keine Erlaubnis gegeben haben.
  Das ist der Grund, aus dem diese Variante nicht die erste ist.
- **Die Testeinträge bleiben.** Der API-Vertrag kennt kein
  `DELETE /research/:id`; du räumst sie in der Web-App von Hand weg.
- **Das Token muss danach widerrufen werden**, und es muss die ganze Prüfung
  über gültig bleiben — das können Wochen sein.

Wenn es dabei bleiben soll, dann wenigstens so:

1. Ein **eigenes Buch** anlegen, z. B. „Chrome Web Store — Prüfung", und es in
   der Anleitung ausdrücklich als Ziel nennen.
2. Ein **frisches Gerätetoken** nur für die Prüfung erzeugen, nicht dein eigenes
   benutzen.
3. Nach der Freigabe: Token widerrufen, Testeinträge löschen.

Den Formulartext aus Variante A übernehmen, aber den ersten Absatz ersetzen:

```
Schreibwerkstatt is a self-hosted writing app; this extension is its browser
companion and has no bundled backend. It cannot be exercised without a server,
so please use the instance and token below. Please capture into the book
"Chrome Web Store — Prüfung", which exists for this review.
```

Und in Schritt 6 „Nordlicht" durch „Chrome Web Store — Prüfung" ersetzen sowie
Abschnitt C streichen — den Fehlerpfad kannst du auf der Produktion nicht
vorführen.

---

## Variante C — ohne Server

Dem Prüfer fehlt dann jede Möglichkeit, die Erweiterung zu bedienen. Das erhöht
das Ablehnungsrisiko deutlich. Nicht hoffnungslos, wenn du es offen sagst und den
Rest so nachvollziehbar wie möglich machst — aber nimm das nur, wenn A und B
beide ausfallen.

```
This extension is a companion to a self-hosted web app ("Schreibwerkstatt")
that the user installs on their own server. It has no bundled backend and no
default server address, and it therefore cannot be exercised end to end
without such an installation. I am unfortunately not able to provide a public
test instance. Everything that can be verified without one is listed below.

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

If it would help the review, I can stand up a reference implementation of the
server API on request — please just ask.

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

## Vor dem Absenden ersetzen

Repository-URL und Kontaktadresse sind eingesetzt. Bei Variante A bleiben zwei
Werte:

- `<REVIEW-SERVER-URL EINTRAGEN, z. B. https://cws-review.example.org>`
- `<REVIEW_TOKEN EINTRAGEN, beginnt mit swd_>` — dasselbe, das der Server beim
  Start ausgibt

Und daran denken: Adresse und Token müssen die ganze Prüfung über funktionieren.
Die kann Wochen dauern; fällt der Server mittendrin aus, sieht der Prüfer eine
Erweiterung, die sich nicht verbinden kann.
