# Im Chrome Web Store veröffentlichen

Alles, was für die Einreichung gebraucht wird, liegt in diesem Ordner. Die Texte
sind zum Kopieren geschrieben, nicht zum Umschreiben.

| Datei | Inhalt |
|---|---|
| [listing-de.md](listing-de.md) | alle Formularfelder des Eintrags, deutsch — Beschreibung, Kategorie, Berechtigungsbegründungen, Datennutzungs-Angaben |
| [listing-en.md](listing-en.md) | dieselben Texte für die zweite Sprache des Eintrags |
| [privacy-policy.de.md](privacy-policy.de.md) · [privacy-policy.en.md](privacy-policy.en.md) | die Datenschutzerklärung, die unter einer öffentlichen URL stehen muss |
| [test-instructions.md](test-instructions.md) | Anleitung für den Prüfer — der wichtigste Text der Einreichung |
| `assets/` | die Werbekacheln, erzeugt mit `npm run promo` |

**Vorher lesen:** [Zwei Dinge, die hier schiefgehen können](#zwei-dinge-die-hier-schiefgehen-können).
Beide betreffen genau diese Erweiterung und nicht Erweiterungen im Allgemeinen.

---

## Inhalt

- [Zwei Dinge, die hier schiefgehen können](#zwei-dinge-die-hier-schiefgehen-können)
- [Brauchst du den Store überhaupt?](#brauchst-du-den-store-überhaupt)
- [1. Entwicklerkonto anlegen](#1-entwicklerkonto-anlegen)
- [2. Paket bauen](#2-paket-bauen)
- [3. Datenschutzerklärung veröffentlichen](#3-datenschutzerklärung-veröffentlichen)
- [4. Sichtbarkeit wählen](#4-sichtbarkeit-wählen)
- [5. Screenshots aufnehmen](#5-screenshots-aufnehmen)
- [6. Einreichen](#6-einreichen)
- [7. Die Prüfung](#7-die-prüfung)
- [8. Aktualisieren](#8-aktualisieren)
- [Checkliste](#checkliste)

---

## Zwei Dinge, die hier schiefgehen können

### Der Prüfer kann die Erweiterung nicht bedienen

Ohne Schreibwerkstatt-Server und Gerätetoken tut die Erweiterung nichts. Wer das
Popup öffnet, sieht „Nicht verbunden" — und eine Erweiterung, die nicht tut, was
ihre Beschreibung ankündigt, wird abgelehnt.

**Das ist das größte Risiko dieser Einreichung, und es ist auflösbar:** stell für
die Dauer der Prüfung eine erreichbare Instanz und ein Token bereit und schreib
beides in die Testanleitung. Am besten eine Demo-Instanz mit Wegwerf-Inhalten,
nicht dein Produktivsystem — der Prüfer wird darin Testeinträge anlegen.

Geht das nicht, nimm Variante B aus [test-instructions.md](test-instructions.md).
Die sagt offen, dass keine Instanz bereitsteht, und listet auf, was sich ohne
Server trotzdem prüfen lässt (die gesamte Erntestrecke funktioniert nämlich
serverlos). Das ist erkennbar schlechter, aber besser als ein leeres Feld.

### Das weite Host-Muster fällt auf

Im Manifest steht:

```json
"optional_host_permissions": ["https://*/*", "http://*/*"]
```

`https://*/*` steht auf der Liste der Muster, die Google ausdrücklich genauer
ansieht — die Prüfung dauert dadurch länger. Dass es hier unter `optional_`
steht und zur Laufzeit nur **ein** Origin angefragt wird, ist der entscheidende
Unterschied, aber niemand sieht ihn, wenn er nicht dasteht. Die
Berechtigungsbegründung in [listing-de.md](listing-de.md#begründung-je-berechtigung)
erklärt es; kopiere sie vollständig, nicht gekürzt.

**Optional, aber es hilft:** `http://*/*` ist im Manifest nur da, damit eine
lokale Entwicklungsinstanz funktioniert. Diesen Teil kannst du auf localhost
verengen:

```diff
   "optional_host_permissions": [
     "https://*/*",
-    "http://*/*"
+    "http://localhost/*",
+    "http://127.0.0.1/*"
   ],
```

Danach lässt sich keine unverschlüsselte Adresse außerhalb von localhost mehr
eintragen — also kein `http://192.168.1.20:3000` und kein `http://dev.intern`.
Ob dir das etwas nimmt, weißt du selbst; sicherheitstechnisch ist es ein Gewinn,
und es entfernt ein Muster aus dem Blickfeld der Prüfung. Wenn du es machst:
`npm test` läuft danach durch, aber prüfe die Warnlogik der Options-Seite
für `http`-Adressen von Hand nach.

> `https://*/*` selbst lässt sich **nicht** verengen. Bei einer selbst
> gehosteten App ist die Adresse pro Nutzer verschieden, und Manifest V3 kennt
> keinen Weg, ein zur Laufzeit bestimmtes Origin anzufordern, das nicht vorab im
> Manifest deklariert ist. Das ist der eigentliche Grund für das weite Muster
> und gehört genau so in die Begründung.

---

## Brauchst du den Store überhaupt?

Für dich allein: nein. `npm run build` und „Entpackte Erweiterung laden" in
`chrome://extensions` funktioniert dauerhaft. Preis dafür: der
Entwicklermodus-Hinweis bei jedem Chrome-Start, und Updates baust und lädst du
selbst.

Der Store bringt drei Dinge:

- automatische Updates
- Installation auf einem anderen Rechner mit einem Klick
- kein Entwicklermodus-Hinweis, keine dauerhaft eingeschaltete Warnung

Wenn du die Erweiterung auf mehr als einem Gerät benutzt, lohnt sich der Weg.
Für ein einziges Gerät ist er Zierde. Die 5 US-Dollar sind einmalig, nicht pro
Erweiterung.

---

## 1. Entwicklerkonto anlegen

1. <https://chrome.google.com/webstore/devconsole> öffnen.
2. Entwicklervertrag und Richtlinien annehmen.
3. **5 US-Dollar** einmalig zahlen. Das gilt für alle künftigen Erweiterungen,
   bis zu 20 veröffentlichte pro Konto.
4. Kontaktadresse eintragen und **bestätigen**. Unbestätigt lässt sich nichts
   veröffentlichen.
5. Bestätigung in zwei Schritten ist für das Konto Pflicht.

**Zwei Dinge, die sich später nicht mehr ändern lassen:**

- **Die E-Mail-Adresse des Kontos.** Willst du sie wechseln, brauchst du ein
  neues Konto und musst die Erweiterungen per Support-Formular übertragen. Die
  Adresse eines gelöschten Kontos ist danach dauerhaft verbrannt und nicht
  wiederverwendbar. Überleg dir also jetzt, ob `david.berger@dotag.ch` die
  richtige ist oder ob eine eigene Adresse fürs Veröffentlichen besser passt.
- **Der Publisher-Name.** Steht unter dem Titel jeder deiner Erweiterungen. Für
  ein Projekt wie dieses ist ein Klarname oder ein Projektname beides
  vertretbar.

---

## 2. Paket bauen

```bash
npm test
npm run package
```

Ergebnis: `store/schreibwerkstatt-chrome-<version>.zip`, dazu Dateizahl, Größe
und SHA-256 auf der Konsole.

Was `npm run package` dabei sicherstellt:

- baut vorher neu, damit nichts Altes mitgeht
- `manifest.json` liegt im Wurzelverzeichnis des Archivs (sonst weist der Store
  es ab)
- Version in Manifest und `package.json` stimmen überein
- die Versionsnummer ist store-tauglich (1–4 Zahlen von 0 bis 65535, keine
  führenden Nullen)
- keine Sourcemaps und keine versteckten Dateien im Paket

Das Archiv ist reproduzierbar: gleiches `dist/` ergibt Byte für Byte dasselbe
ZIP. Notier die SHA-256, dann kannst du später belegen, welcher Stand
hochgegangen ist.

> `npm run watch` erzeugt Inline-Sourcemaps. Vor dem Packen immer einmal
> `npm run build` — `npm run package` macht das von selbst.

Für einen versionierten Stand samt Tag und GitHub-Release gibt es den
Claude-Code-Befehl **`/release`**
([.claude/commands/release.md](../.claude/commands/release.md)): er prüft den
Arbeitsbaum, erhöht auf Wunsch die Version, lässt `npm test` und
`npm run package` laufen, taggt, pusht und hängt das ZIP an ein GitHub-Release.
Den **Store-Upload nimmt er nicht vor** — der bleibt Handarbeit, siehe
[Aktualisieren](#8-aktualisieren). Nötig ist der Befehl nicht; er ersetzt nur
das Von-Hand-Tippen dieser Schritte.

Der Code ist bewusst nicht minifiziert. Minifizieren wäre erlaubt, macht die
Prüfung aber langsamer; Obfuskieren ist verboten. So bleibt es, wie es ist.

---

## 3. Datenschutzerklärung veröffentlichen

Pflichtfeld, weil die Erweiterung Nutzerdaten verarbeitet. Der Text liegt fertig
in [privacy-policy.de.md](privacy-policy.de.md) und
[privacy-policy.en.md](privacy-policy.en.md). Zwei Platzhalter ersetzen —
Verantwortlicher und Kontakt-E-Mail — und dann unter einer **öffentlich
erreichbaren, dauerhaften** URL ablegen.

Möglichkeiten, in absteigender Eignung:

1. **Eine Seite auf deiner Schreibwerkstatt-Domain**, z. B.
   `https://schreibwerkstatt.example.org/extension-privacy`. Am stimmigsten:
   dieselbe Domain, die auch im Eintrag als Server-Beispiel auftaucht.
2. **GitHub Pages oder eine gerenderte Datei im Repository.** Wenn du den Code
   veröffentlichst, ohnehin naheliegend. Eine Markdown-Datei in einem
   öffentlichen Repo genügt; der Store verlangt kein bestimmtes Format.
3. **Ein öffentlicher Gist.** Geht, wirkt aber beiläufig für ein Pflichtdokument.

Nicht geeignet: alles, was einen Login braucht, ablaufen kann oder nur über
einen Kurzlink erreichbar ist. Die Prüfung ruft die URL auf; ist sie nicht
erreichbar, ist das ein Ablehnungsgrund.

> Weg 2 steht offen: das Repository liegt öffentlich unter
> <https://github.com/bedeberger/schreibwerkstatt-browser-extension>. Die
> gerenderte Datei ist damit unter
> `https://github.com/bedeberger/schreibwerkstatt-browser-extension/blob/main/store/privacy-policy.de.md`
> erreichbar — bevor du sie als Datenschutz-URL einträgst, ruf sie einmal in
> einem abgemeldeten Browserfenster auf.

---

## 4. Sichtbarkeit wählen

Alle drei Stufen gehen durch **dieselbe** Prüfung mit denselben
Richtlinienanforderungen — „nicht aufgeführt" ist keine Abkürzung.

| Stufe | Wer kann installieren | Passt hier |
|---|---|---|
| **Öffentlich** | jeder; erscheint in Suche und Kategorien | nur wenn du wirklich Fremde ansprechen willst |
| **Nicht aufgeführt** | jeder, der die URL kennt; nicht auffindbar | ✅ **Empfehlung** |
| **Privat** | nur benannte Test-Konten oder eine Google-Gruppe | wenn außer dir niemand ran soll |

**Empfehlung: nicht aufgeführt.** Die Erweiterung ist ohne eigene
Schreibwerkstatt-Installation nutzlos. Ein öffentlicher Eintrag holt sich
Installationen von Leuten, die keinen Server haben, und die schreiben dann
Ein-Stern-Bewertungen mit „geht nicht" — was sachlich stimmt und dir nichts
bringt. Du bekommst weiterhin automatische Updates und einen Link zum Teilen.

**Privat** ist die engste Stufe. Nachteil: du musst jedes Konto einzeln als
Tester eintragen, und die Erweiterung erscheint nur diesen Konten. Für „nur ich,
auf drei Rechnern" reicht das und ist sauberer als „nicht aufgeführt".

Umstellen kannst du jederzeit — von „privat" oder „nicht aufgeführt" auf
„öffentlich" braucht es allerdings eine erneute Prüfung.

Weitere Felder im Vertriebs-Tab: **kostenlos**, **alle Regionen**.

---

## 5. Screenshots aufnehmen

Mindestens einer ist Pflicht, bis zu fünf gehen. **1280 × 800 Pixel**, PNG oder
JPEG, randlos, keine abgerundeten Ecken, kein Rahmen. Sie sollen die echte
Oberfläche zeigen — dafür gibt es kein Skript, das musst du selbst machen.

Diese fünf Motive, in dieser Reihenfolge:

1. Popup über einem Fachartikel, Felder gefüllt, Herkunftszeile sichtbar
2. Kontextmenü „Als Zitat erfassen" bei markiertem Text
3. Benachrichtigung mit dem Rückgängig-Knopf
4. Options-Seite mit Serveradresse, Token, Verbindungstest, Standardbuch
5. Warteschlange mit einem wartenden und einem gescheiterten Eintrag

Nummer 1 und 4 sind die wichtigsten. Wenn du nur zwei machst, dann die.

### Genau 1280 × 800 treffen

Der zuverlässigste Weg — Chrome mit fester Fenstergröße und eigenem Profil, damit
keine anderen Erweiterungen ins Bild geraten:

```bash
google-chrome \
  --user-data-dir=/tmp/cws-shots \
  --window-size=1280,800 \
  --window-position=0,0 \
  --force-device-scale-factor=1 \
  --load-extension="$PWD/dist" \
  --no-first-run
```

Auf einem HiDPI-Bildschirm ist `--force-device-scale-factor=1` nicht optional:
sonst liefert der Screenshot 2560 × 1600, und der Store lehnt das Bild ohne
brauchbare Meldung ab.

Der Fensterinhalt ist wegen der Titelleiste kleiner als 1280 × 800. Nimm also
den Bildschirm auf und schneide zu, oder — genauer — nimm den Inhaltsbereich mit
DevTools auf: `Strg+Umschalt+P` → *Capture screenshot*. Danach immer die Maße
kontrollieren:

```bash
file screenshot.png    # muss "1280 x 800" zeigen
```

Passt es nicht:

```bash
# hochskalieren/beschneiden auf genau 1280x800, mit Papierfarbe auffüllen
convert screenshot.png -resize 1280x800 -background '#f7f4ee' \
  -gravity center -extent 1280x800 shot-1.png
```

### Für den englischen Eintrag

Dieselbe Zeile, ergänzt um `--lang=en-US`. Die Erweiterung folgt der
Browsersprache, du bekommst also ohne Zusatzaufwand eine englische Oberfläche.

### Beschriftung

Der Store zeigt keine Bildunterschriften. Wenn du erklären willst, was zu sehen
ist, muss es ins Bild — ein Balken oben mit einer kurzen Zeile in
`#22405f` auf `#f7f4ee` passt zu den Kacheln. Optional; unbeschriftete
Screenshots sind zulässig.

### Werbekacheln

```bash
npm run promo
```

Erzeugt `store/assets/promo-small-440x280.png` und
`store/assets/promo-marquee-1400x560.png`, gerendert mit dem installierten
Chrome, und prüft die Maße nach. Die kleine Kachel ist formal optional, aber ohne
sie wird der Eintrag in der Store-Suche schlechter platziert — also hochladen.
Das Motiv steht als Quelltext in [../tools/make-promo.mjs](../tools/make-promo.mjs)
und lässt sich dort ändern.

---

## 6. Einreichen

<https://chrome.google.com/webstore/devconsole> → **Neues Element hinzufügen** →
ZIP hochladen. Danach vier Tabs, in dieser Reihenfolge:

**Store-Eintrag** — Beschreibung, Kategorie, Sprache, Symbol, Screenshots,
Kacheln. Alles aus [listing-de.md](listing-de.md). Danach die Sprache `English`
hinzufügen und [listing-en.md](listing-en.md) einsetzen.

**Datenschutzpraktiken** — einziger Zweck, Begründung für **jede** Berechtigung,
nachgeladener Code (**nein**), Datennutzungs-Angaben, drei Zertifizierungen, URL
der Datenschutzerklärung. Ebenfalls alles in
[listing-de.md](listing-de.md#tab-datenschutzpraktiken). Keine Begründung
auslassen — eine leere Zeile ist ein Ablehnungsgrund.

**Vertrieb** — nicht aufgeführt, kostenlos, alle Regionen.

**Testanleitung** — aus [test-instructions.md](test-instructions.md), Variante A
oder B. Nicht leer lassen.

Dann **Zur Prüfung einreichen**. Zur Wahl steht außerdem, nach der Freigabe
nicht automatisch, sondern von Hand zu veröffentlichen — das Zeitfenster dafür
sind 30 Tage. Bei einer nicht aufgeführten Erweiterung bringt das nichts;
automatisch ist einfacher.

---

## 7. Die Prüfung

Die Bandbreite ist groß und die Angaben widersprechen sich, weil beides stimmt:
eine kleine Erweiterung mit engen Berechtigungen kann in unter einer Stunde
durch sein, die Mehrheit ist innerhalb eines Tages durch, und bei
Einreichungswellen dauert es Wochen. Im Frühjahr 2026 gab es eine solche Welle
mit Wartezeiten von über einem Monat.

Rechne bei dieser Erweiterung mit **mehreren Tagen bis zwei Wochen**: neues
Konto, neue Erweiterung und ein weites Host-Muster sind drei Gründe für einen
genaueren Blick.

**Nicht erneut einreichen, solange die Prüfung läuft.** Das setzt die Uhr auf
null und kann das Konto wegen schneller Wiedereinreichungen markieren. Warte ab.

Was hier für dich spricht: kein `eval`, kein `innerHTML`, keine externe Adresse
im Paket, kein nachgeladener Code, unminifizierter Quelltext, 224 durchlaufende
Tests und ausformulierte Begründungen für jede einzelne Berechtigung.

Bei einer Ablehnung nennt die E-Mail den verletzten Richtlinienabschnitt. Meist
geht es um eine schwache Berechtigungsbegründung oder eine unerreichbare
Datenschutz-URL; beides ist an einem Nachmittag zu beheben. Antworten kannst du
über das Formular im Dashboard.

---

## 8. Aktualisieren

```bash
# Version in package.json erhöhen — sie ist die einzige Quelle,
# build.mjs schreibt sie ins Manifest
npm version patch --no-git-tag-version

npm test
npm run package
```

Dieselben drei Schritte macht `/release` mit `patch`, `minor` oder `major` als
Argument — und legt zusätzlich Tag und GitHub-Release an.

Dann im Dashboard **Paket** → **Neues Paket hochladen** → einreichen.

- Die Version **muss** höher sein als die veröffentlichte. Der Store nimmt
  dieselbe Nummer nicht zweimal.
- Jede Aktualisierung geht erneut durch die Prüfung, meist schneller als die
  erste.
- Kommen **neue Berechtigungen** dazu, deaktiviert Chrome die Erweiterung bei
  allen Nutzern, bis sie zustimmen. Berechtigungen also möglichst nur nach unten
  ändern.
- Änderungen am Eintragstext allein brauchen kein neues Paket, gehen aber
  ebenfalls durch die Prüfung.

Ändert sich der Umfang der übertragenen Daten, gehören Datenschutzerklärung und
Datennutzungs-Angaben im selben Zug angepasst.

---

## Checkliste

Vor dem Einreichen:

- [ ] Entwicklerkonto angelegt, 5 USD bezahlt, E-Mail bestätigt, 2FA aktiv
- [ ] entschieden, welche E-Mail-Adresse das Konto führt (nicht änderbar)
- [ ] Publisher-Name gewählt (nicht änderbar)
- [ ] `npm test` läuft durch
- [ ] `npm run package` erzeugt das ZIP, SHA-256 notiert
- [ ] Datenschutzerklärung: Platzhalter ersetzt, öffentlich erreichbar,
      URL im Browser geprüft
- [ ] Repository-URL in [listing-de.md](listing-de.md) und
      [listing-en.md](listing-en.md) eingesetzt — oder der Absatz gestrichen
- [ ] Testanleitung ausgefüllt, Variante A oder B; Testtoken läuft nicht ab
- [ ] `npm run promo` gelaufen, beide Kacheln vorhanden
- [ ] mindestens ein Screenshot in genau 1280 × 800, mit `file` geprüft
- [ ] Begründung für jede der sechs Berechtigungen **und** für die
      Host-Berechtigung eingesetzt
- [ ] nachgeladener Code: **nein** angegeben
- [ ] Datennutzung: Website-Inhalte und Authentifizierungsdaten angehakt
- [ ] alle drei Zertifizierungen bestätigt
- [ ] Sichtbarkeit auf „nicht aufgeführt" gestellt
- [ ] entschieden, ob `http://*/*` auf localhost verengt wird
      ([Begründung](#das-weite-host-muster-fällt-auf))

---

## Quellen

Stand Juli 2026. Google ändert die Formulare öfter als die Dokumentation.

- [Entwicklerkonto registrieren](https://developer.chrome.com/docs/webstore/register)
- [Veröffentlichen](https://developer.chrome.com/docs/webstore/publish)
- [Prüfprozess](https://developer.chrome.com/docs/webstore/review-process)
- [Grafische Anforderungen](https://developer.chrome.com/docs/webstore/images)
- [Tab „Store-Eintrag"](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)
- [Tab „Datenschutzpraktiken"](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [Tab „Vertrieb"](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)
- [Programmrichtlinien](https://developer.chrome.com/docs/webstore/program-policies)
