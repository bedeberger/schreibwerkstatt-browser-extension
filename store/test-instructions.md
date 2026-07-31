# Testanleitung für die Prüfung

Der Text unten geht in das Feld **„Testanleitung"** im Developer-Dashboard.

Warum das hier der wichtigste Text der ganzen Einreichung ist: die Erweiterung
ist ohne Server und Token **funktionslos**. Ein Prüfer, der das Popup öffnet und
nur „Nicht verbunden" sieht, hat keinen Grund anzunehmen, dass die Erweiterung
überhaupt etwas tut — und „funktioniert nicht wie beschrieben" ist ein
Ablehnungsgrund. Deshalb muss hier drinstehen, **wie** er es zum Laufen bringt.

---

## Variante A — du kannst eine Instanz bereitstellen (deutlich besser)

Voraussetzung: eine öffentlich erreichbare Schreibwerkstatt-Installation und ein
Gerätetoken mit Erfassungs-Berechtigung, das du für die Dauer der Prüfung
stehenlässt. Am besten eine eigene Demo-Instanz mit Wegwerf-Inhalten, kein
Produktivsystem.

```
This extension is a companion to a self-hosted web app ("Schreibwerkstatt").
It cannot function without a server address and a device token, so please
use the test instance below.

SETUP (about one minute)

1. Right-click the extension icon and choose "Options" (the options page also
   opens from the gear icon in the popup).
2. Server address:  <TEST-INSTANZ-URL EINTRAGEN, z. B. https://demo.example.org>
   Device token:    <TEST-TOKEN EINTRAGEN, beginnt mit swd_>
3. Click "Save".
4. Click "Grant access to this host". Chrome will ask for the host permission
   for this single origin. This is expected and required — see the host
   permission justification. The manifest deliberately contains no <all_urls>;
   the address of a self-hosted app differs per user and cannot be declared in
   the manifest, so it is requested at runtime for exactly one origin.
5. Click "Test connection". The book list loads.
6. Pick a default book.

WHAT TO TEST

A) Capture a page
   Open any article, e.g. https://en.wikipedia.org/wiki/Citation
   Click the extension icon (or press Alt+Shift+S). The form is pre-filled from
   the page's metadata. Press "Send". A confirmation appears.

B) Capture a quote
   Select a sentence on that page, right-click, choose "Capture as quote"
   (or press Alt+Shift+Q). A notification appears with an Undo button. If you
   press Undo within 6 seconds, no server record is created at all; the request
   is only sent after the undo window closes.

C) Offline queue (optional)
   Set the server address to an unreachable host and capture a page. The item
   goes into a retry queue and is shown on the toolbar badge. Nothing is
   dropped silently.

NOTES FOR REVIEW

- No remote code. Nothing is loaded or executed from a remote source; the
  Content Security Policy in the manifest allows 'self' only. The code in the
  package is neither minified nor obfuscated.
- Network traffic goes exclusively to the host entered in step 2. There is no
  default server, no analytics, no telemetry and no third-party endpoint.
  Apart from relative API paths, the package contains no hardcoded address.
- There is no persistent content script. The harvesting script is injected via
  activeTab at the moment of a user action only.
- Source code: <REPOSITORY-URL EINTRAGEN>

Contact for questions during review: <DEINE E-MAIL>
```

---

## Variante B — du kannst keine Instanz bereitstellen

Dann fehlt dem Prüfer die Möglichkeit, die Erweiterung zu bedienen. Das erhöht
das Ablehnungsrisiko merklich, ist aber nicht hoffnungslos, wenn du es offen
sagst und den Rest so nachvollziehbar wie möglich machst.

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
- Source code: <REPOSITORY-URL EINTRAGEN>

I am glad to answer any question that would help the review.
Contact: <DEINE E-MAIL>
```

---

## Vor dem Absenden ersetzen

- `<TEST-INSTANZ-URL EINTRAGEN>`
- `<TEST-TOKEN EINTRAGEN>`
- `<REPOSITORY-URL EINTRAGEN>` — oder die Zeile streichen
- `<DEINE E-MAIL>`

Und daran denken: das Testtoken darf während der Prüfung nicht ablaufen. Läuft es
mitten in der Prüfung aus, sieht der Prüfer eine Erweiterung, die sich nicht
verbinden kann.
