---
description: Arbeitsstand committen, Version setzen, testen, packen, Tag und GitHub-Release mit ZIP-Anhang
argument-hint: "[patch|minor|major|x.y.z] [--draft] [--dry-run]"
allowed-tools: Bash(git *), Bash(gh *), Bash(npm *), Bash(node *), Bash(sha256sum *), Read, Write, Edit
---

# Release

Erzeugt aus dem aktuellen Stand ein GitHub-Release: getestet, gepackt,
committet, gepusht, getaggt, mit dem Store-ZIP als Anhang. **Der Upload in den
Chrome Web Store gehört nicht dazu** — der bleibt Handarbeit, siehe
[store/PUBLISHING.md](../../store/PUBLISHING.md), Abschnitt „Aktualisieren".

„Aus dem aktuellen Stand" heißt wörtlich: der Arbeitsstand wird nicht
vorausgesetzt, sondern mitgenommen. Was im Arbeitsverzeichnis liegt, ist nach
`/release` committet und auf `origin/main` — ohne Rückfrage. Der Befehl hat
damit Wirkung nach außen, sobald er startet; `--dry-run` ist der einzige
folgenlose Weg.

Argumente: `$ARGUMENTS`

- `patch` · `minor` · `major` · `x.y.z` — Version vorher erhöhen. Ohne Angabe
  wird die Version aus `package.json` genommen, wie sie ist.
- `--draft` — Release als Entwurf anlegen (Tag wird trotzdem gepusht).
- `--dry-run` — alles prüfen, testen, packen und die Notizen zeigen, aber weder
  committen noch pushen noch ein Release anlegen. **Der einzige Weg, den Ablauf
  ohne Nebenwirkung zu sehen.**

## Regeln für diesen Ablauf

- **Der Arbeitsstand wird immer mitgenommen.** Ein nicht leeres
  `git status` ist kein Abbruchgrund, sondern der Normalfall: alles, was im
  Arbeitsverzeichnis liegt — geändert *und* nicht getrackt —, wird committet und
  gepusht (Schritt 7). Kein `git stash`, kein Teil-Commit, kein Zurücklassen.
- **Ohne Rückfrage.** Commit, Push und Release laufen durch, sobald die
  Prüfungen grün sind; die Zusammenfassung aus Schritt 6 wird gezeigt, nicht
  abgefragt. Wer vorher schauen will, nimmt `--dry-run`.
- **Kein Schritt wird stillschweigend übersprungen.** Scheitert eine Prüfung,
  brich ab und sag, was fehlt — kein `--force`, kein `push -f`.
- **Ein bestehender Tag wird nie überschrieben.** Gleiche Version zweimal ⇒
  Abbruch mit Hinweis auf ein Bump-Argument.
- Wird nach einem Versions-Bump abgebrochen, den Bump zurücknehmen
  (`git checkout -- package.json package-lock.json`), damit kein halber Stand
  liegen bleibt.
- **Das Repository ist öffentlich — und das überlebt „alles committen".** In
  Tag, Notizen und Commit-Text keine Token, keine echten Hostnamen, keine
  lokalen Pfade; Beispieladressen immer `schreibwerkstatt.example.com`. Weil
  `git add -A` nicht nach Herkunft fragt, gilt dasselbe für den Inhalt des
  Commits: die Sichtprüfung in Schritt 1 ist die einzige verbliebene Bremse und
  darf abbrechen.

## 1. Vorprüfungen

Alles in einem Rutsch, dann auswerten:

```bash
node -v                                        # ≥ 20
git rev-parse --abbrev-ref HEAD                # erwartet: main
git status --porcelain --untracked-files=all   # darf voll sein — kommt mit
git fetch --tags --quiet origin
git rev-list --left-right --count @{u}...HEAD  # erwartet: 0 <n>  (kein Rückstand)
gh auth status
```

Abbruchgründe: nicht auf `main` (nachfragen, ob bewusst), Rückstand gegenüber
`origin/main` (erst `git pull --ff-only`), `gh` nicht angemeldet
(`gh auth login`). **Ein voller Arbeitsstand ist keiner** — der wird in
Schritt 7 committet.

Dafür kommt die Prüfung hinzu, die der Wegfall der leeren Arbeitskopie nötig
macht: **was genau geht mit?** Jede Datei benennen, nicht nur zählen:

```bash
git status --porcelain --untracked-files=all
git diff HEAD --stat        # getrackt: staged und unstaged zusammen
```

`git diff` zeigt nicht getrackte Dateien **nicht** — die tauchen nur in
`git status` als `??` auf. Deren Inhalt also einzeln mit `Read` ansehen; es sind
in der Regel wenige, und genau sie sind die ungeprüften.

Abbrechen — und zwar hier, vor dem Versions-Bump —, wenn darunter etwas ist, das
nicht in ein öffentliches Repository gehört: Token oder `swd_…`-Werte außerhalb
der Test-Attrappen, echte Hostnamen oder IP-Adressen, lokale absolute Pfade,
`.env`-Reste, Logs, Datenbanken, Test-Ausgaben, Screenshots oder Fixtures mit
personenbezogenen Daten (die Liste im [CLAUDE.md](../../CLAUDE.md), Abschnitt
*Öffentliches Repository*). Im Zweifel abbrechen und fragen, nicht committen:
Ein Push ins öffentliche Repository ist nicht zurücknehmbar, auch nicht durch
einen Folge-Commit.

Nicht abbrechen dagegen bei Dateien, die schlicht noch nicht getrackt sind und
dazugehören — die sind der Grund für diesen Ablauf. Genau so eine Datei ist
sonst lokal grün und im frischen Klon kaputt, siehe
[.github/workflows/ci.yml](../../.github/workflows/ci.yml).

## 2. Version festlegen

Bei Bump-Argument:

```bash
npm version <patch|minor|major|x.y.z> --no-git-tag-version
```

`package.json` ist die einzige Versionsquelle; `build.mjs` schreibt sie ins
Manifest, `tools/package.mjs` prüft, dass beide übereinstimmen und die Nummer
store-tauglich ist (1–4 Zahlen von 0 bis 65535, keine führenden Nullen).

Dann prüfen, dass der Tag noch frei ist — lokal **und** auf `origin`:

```bash
node -p "require('./package.json').version"
git tag -l "v<version>"
git ls-remote --tags origin "refs/tags/v<version>"
```

Beides muss leer sein.

## 3. Tests

```bash
npm test
```

224 Tests, kein Netz nötig. Ein einziger Fehlschlag beendet den Release —
Ausgabe zeigen, nichts umdeuten.

## 4. Paket bauen

```bash
npm run package
```

Baut `dist/` neu und schreibt `store/schreibwerkstatt-chrome-<version>.zip`.
Version, Dateizahl, Größe und **SHA-256** aus der Ausgabe übernehmen — die
gehören in die Release-Notizen. Das Archiv ist reproduzierbar, gleiches `dist/`
ergibt byteweise dasselbe ZIP.

**Zwischen hier und Schritt 7 wird keine Datei mehr angefasst.** Früher garantierte
die leere Arbeitskopie, dass das ZIP dem getaggten Commit entspricht; jetzt
garantiert das nur noch die Reihenfolge. Jede Änderung dazwischen — auch eine
„kleine Korrektur" — macht das Release-ZIP zu einem anderen Stand als den Tag.
Wer nach dem Packen noch etwas ändern muss, bricht ab und startet `/release` neu.

`dist/` bleibt danach im Arbeitsverzeichnis liegen und ist genau der Stand, der
im ZIP steckt. Für die eigene Nutzung also **kein Entpacken nötig**: in
`chrome://extensions` reicht der Reload-Pfeil an einer bereits entpackt
geladenen Erweiterung, sonst einmal „Entpackte Erweiterung laden" auf `dist/`.
Das gilt auch bei `--dry-run` — gebaut wird trotzdem.

## 5. Notizen schreiben

Commits seit dem letzten Tag sammeln (beim ersten Release: alle):

```bash
git describe --tags --abbrev=0 2>/dev/null
git log --pretty=format:'%s' <letzter-tag>..HEAD    # bzw. git log --pretty=format:'%s'
```

**Der `git log` allein reicht hier nicht mehr.** Seit der Arbeitsstand
mitgenommen wird (Schritt 7), steckt ein Teil der Version in einem Commit, der
noch nicht existiert und deshalb in keiner Log-Zeile steht. Also beide Quellen
lesen: den Log **und** den Diff des Arbeitsstands aus Schritt 1
(`git diff` plus die neuen Dateien). Was dort inhaltlich passiert, gehört in die
Notizen, nicht bloß in die Commit-Nachricht.

Daraus deutsche Notizen bauen — nach Thema gruppiert, nicht der rohe
`git log`. Reine Aufräum-Commits weglassen, Verhaltensänderungen und neue
Berechtigungen dagegen immer nennen. Aufbau:

```markdown
<ein Satz, worum es in dieser Version geht>

### Geändert
- …

### Behoben
- …

### Paket
- `schreibwerkstatt-chrome-<version>.zip` — <n> Dateien, <größe> KiB
- SHA-256: `<hash>`

Installation ohne Store: ZIP entpacken, in `chrome://extensions` den
Entwicklermodus einschalten und „Entpackte Erweiterung laden" auf den
entpackten Ordner zeigen lassen.
```

Datei in den Scratchpad schreiben (nicht ins Repository) und für
`gh release create --notes-file` verwenden.

Ändern sich Berechtigungen, Datenübertragung oder der API-Vertrag, in den
Notizen darauf hinweisen und daran erinnern, dass `store/listing-{de,en}.md`
und die Datenschutzerklärung im selben Zug nachzuziehen sind.

## 6. Zusammenfassung

Zeigen, **nicht fragen**: Version, ob gebumpt, Testergebnis, ZIP-Name mit
SHA-256, Zieltag, `--draft` ja/nein, die Liste der Dateien, die mit in den
Commit gehen, und die fertigen Notizen. Danach ohne Rückfrage weiter zu
Schritt 7.

Bei `--dry-run` hier enden — mit dem Hinweis, dass ZIP und Notizen erzeugt
wurden, aber weder Commit noch Tag noch Release existieren und der
Arbeitsstand unverändert liegt.

## 7. Veröffentlichen

In dieser Reihenfolge:

```bash
# Alles mitnehmen: geänderte und neue Dateien. Nach Schritt 1 ist geprüft,
# was hier drinsteckt.
git add -A
git status --short          # letzter Blick auf den Index

git commit -m "$(cat <<'EOF'
Version <version>

<ein bis drei Zeilen, was in dieser Version steckt — dieselbe Substanz wie
die Notizen aus Schritt 5, nicht „alles committen">

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"

git tag -a "v<version>" -m "Version <version>"
git push origin main --follow-tags

gh release create "v<version>" \
  "store/schreibwerkstatt-chrome-<version>.zip" \
  --title "v<version>" \
  --notes-file "<scratchpad>/release-notes-<version>.md"
  # bei --draft zusätzlich: --draft
```

Zwei Sonderfälle:

- **Nichts zu committen** — Arbeitsstand war leer und es wurde nicht gebumpt.
  Dann bricht `git commit` mit „nothing to commit" ab; das ist in Ordnung. Den
  Commit überspringen und `HEAD` so taggen, wie er ist. Nicht mit
  `--allow-empty` einen Leer-Commit erzeugen.
- **`gh release create` scheitert, während Commit, Tag und Push durch sind** —
  das sagen und den Befehl zum Nachholen ausgeben. Weder Tag löschen noch den
  Push zurückdrehen.

## 8. Abschluss

Melden: Release-URL, Tag, SHA-256 des ZIP und **welche Dateien der Commit
mitgenommen hat** (die Liste aus Schritt 7, nicht bloß „alles"). Dazu, dass
`dist/` auf diesem Stand gebaut ist und in `chrome://extensions` nur noch neu
geladen werden muss. Danach der Hinweis, was noch offen ist:

- Store-Upload von Hand: Developer Dashboard → **Paket** → **Neues Paket
  hochladen**, Ablauf und Fallstricke in
  [store/PUBLISHING.md](../../store/PUBLISHING.md).
- Solange eine Store-Prüfung läuft, nicht erneut einreichen.
- SHA-256 notieren, damit später belegbar ist, welcher Stand hochgegangen ist.
