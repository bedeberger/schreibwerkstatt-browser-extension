# Privacy Policy — Schreibwerkstatt – Capture (Chrome extension)

**Last updated:** 31 July 2026
**Controller:** David Berger, bede.berger@gmail.com

> English version of [privacy-policy.de.md](privacy-policy.de.md). Publishing one
> of the two is enough for the Chrome Web Store; publishing both is better,
> since the extension ships both locales. Der Text ist vollständig; nichts mehr
> einzutragen.

---

## In short

This extension sends data only to the server you enter in its own settings. Its
developer collects, receives, stores and processes no data about you whatsoever.
There is no backing service and no other address anything is sent to.

## 1. Who processes what

The extension is a companion to a **self-hosted** writing app called
Schreibwerkstatt. You run that server, or have access to it; you enter its
address in the extension's settings.

That makes for two separate roles:

- **The extension** transmits data from your browser to that one server. It
  relays nothing, mirrors nothing and phones nothing home.
- **The server you entered** processes the data that arrives there. What it does
  with it and how long it keeps it is governed by that installation's
  configuration and privacy policy — not by this one.

The maintainer of this extension has **no access** to anything you capture.

## 2. What the extension transmits

Only what belongs to a single capture that you triggered:

| Data | When |
|---|---|
| Title, body text or selected quote of the open page | every capture |
| The page URL (with known tracking parameters stripped) and the access date | every capture |
| Bibliographic metadata present on the page: authors, journal, publisher, year, DOI, ISBN | every capture, where present |
| Your own input: tags, note, citation key, book selection | every capture |
| Screenshot of the visible tab area | only if you tick the box |
| The page's PDF | only if you tick the box and the page declares a `citation_pdf_url` on the same host |
| Your device token in the `Authorization` header | every request — it authenticates you to your own server |
| `X-Client-Platform` (`chrome`), `X-Client-Device` (browser name, version, operating system, e.g. `Google Chrome 131 / Linux`), `X-Client-Version` (platform and extension version, e.g. `chrome/1.1.1`) | every request, so your server can tell where an entry came from |

**Recipients:** the host you entered, and nobody else. No other endpoint exists.

## 3. What the extension never touches

- **No browsing history.** There is no `history` and no `tabs` permission. The
  extension never learns which pages you visit. Only the single page you
  explicitly capture is transmitted.
- **No automatic capture.** The service worker only wakes on your action, or to
  retry an item you created yourself.
- **No access to pages where you do nothing.** There is no persistently
  registered content script. The harvesting script is injected through the
  `activeTab` permission at the moment you click, and is gone on the next
  navigation.
- **No cookies, form fields or `localStorage`** of the visited page. The
  harvesting script reads `<meta>` elements, JSON-LD, the page text and the
  current text selection. It makes no network requests of its own.
- **No tracking, analytics, telemetry or crash reporting.**
- **No third-party code, CDN or external fonts.** No code is loaded remotely;
  the extension's Content Security Policy permits `'self'` as the only script
  source.
- **No advertising, and no sale or sharing of data.** To nobody, for no purpose.

## 4. DOI and ISBN lookup

When you ask the extension for canonical metadata, the request goes to **your**
server (`GET /sources/lookup`), which queries Crossref or OpenLibrary
server-side. Your browser never talks to those services directly; they do not
see your IP address.

## 5. What is stored locally

In `chrome.storage.local` on your device:

- the server address and your device token
- the book list loaded from the server
- your settings (default book, undo window length, notifications on or off)
- the queue of captures not yet sent

Deliberately **not** in `chrome.storage.sync`: the token should not travel to
other machines through your Google account. Chrome offers extensions no keychain,
so the token is stored unencrypted — as is every other extension secret in
Chrome. It is only ever sent in the `Authorization` header to the host you
entered, and is never logged.

Attachments (screenshot, PDF) that you explicitly choose to send are kept in the
extension's IndexedDB on your device — only until their entry has been sent or
you discard it. They are deleted afterwards. This exists solely so that an
attachment survives a retry after a connection failure.

## 6. Permissions and why they are needed

| Permission | Purpose |
|---|---|
| `storage` | keep address, token, book list, settings and queue locally |
| `activeTab` | read the page you are capturing — only at the moment of your action |
| `scripting` | inject the harvesting script at that moment |
| `contextMenus` | offer "Capture as quote" on selected text |
| `notifications` | show the confirmation with its undo button; can be switched off |
| `alarms` | wake the service worker for a due retry; generates no network traffic |
| Host permission | exactly one origin: that of your Schreibwerkstatt installation. The manifest contains no `<all_urls>`; the extension asks for that single origin during setup, and Chrome shows you the dialog. |

## 7. Deletion

- **Local data:** uninstall the extension. Chrome erases
  `chrome.storage.local` and the extension's IndexedDB entirely, token, book
  list, queue and stored attachments included.
  Individual values can also be reset on the options page.
- **Entries already sent:** manage those in your Schreibwerkstatt web app. The
  extension cannot delete them; the app's API has no endpoint for it.

## 8. Children

The extension is not directed at children and collects no age information.

## 9. Legal basis and your rights (GDPR)

Because this extension transmits no personal data to its developer, there is no
processing on their side that rights of access, erasure or objection could apply
to. For the data on **your** Schreibwerkstatt server, that server's operator —
usually you — is the controller.

Transmission to your server happens on your explicit action: it begins with your
click and not before.

## 10. Changes

Material changes appear here with a new date. Any change that widens the scope of
transmitted data goes through Chrome Web Store review together with a new version
of the extension.

## 11. Contact

`bede.berger@gmail.com`
