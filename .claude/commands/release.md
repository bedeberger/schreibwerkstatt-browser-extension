---
description: Version setzen, testen, packen, Tag und GitHub-Release mit ZIP-Anhang
argument-hint: "[patch|minor|major|x.y.z] [--draft] [--dry-run]"
allowed-tools: Bash(git *), Bash(gh *), Bash(npm *), Bash(node *), Bash(sha256sum *), Read, Write, Edit
---

# Release

Erzeugt aus dem aktuellen Stand ein GitHub-Release: getestet, gepackt, getaggt,
mit dem Store-ZIP als Anhang. **Der Upload in den Chrome Web Store gehört nicht
dazu** — der bleibt Handarbeit, siehe [store/PUBLISHING.md](../../store/PUBLISHING.md),
Abschnitt „Aktualisieren".

Argumente: `$ARGUMENTS`

- `patch` · `minor` · `major` · `x.y.z` — Version vorher erhöhen. Ohne Angabe
  wird die Version aus `package.json` genommen, wie sie ist.
- `--draft` — Release als Entwurf anlegen (Tag wird trotzdem gepusht).
- `--dry-run` — alles prüfen, testen, packen und die Notizen zeigen, aber weder
  committen noch pushen noch ein Release anlegen.

## Regeln für diesen Ablauf

- **Kein Schritt wird stillschweigend übersprungen.** Scheitert eine Prüfung,
  brich ab und sag, was fehlt — nichts eigenmächtig reparieren (keine Commits
  fremder Änderungen, kein `git stash`, kein `--force`, kein `push -f`).
- **Ein bestehender Tag wird nie überschrieben.** Gleiche Version zweimal ⇒
  Abbruch mit Hinweis auf ein Bump-Argument.
- **Bestätigung einholen**, bevor gepusht oder ein Release angelegt wird. Push
  und Release sind nach außen sichtbar.
- Wird nach einem Versions-Bump abgebrochen, den Bump zurücknehmen
  (`git checkout -- package.json package-lock.json`), damit kein halber Stand
  liegen bleibt.
- Das Repository ist öffentlich: in Tag, Notizen und Commit-Text keine Token,
  keine echten Hostnamen, keine lokalen Pfade. Beispieladressen immer
  `schreibwerkstatt.example.com`.

## 1. Vorprüfungen

Alles in einem Rutsch, dann auswerten:

```bash
node -v                                        # ≥ 20
git rev-parse --abbrev-ref HEAD                # erwartet: main
git status --porcelain                         # muss leer sein
git fetch --tags --quiet origin
git rev-list --left-right --count @{u}...HEAD  # erwartet: 0 <n>  (kein Rückstand)
gh auth status
```

Abbruchgründe: nicht auf `main` (nachfragen, ob bewusst), unversionierte oder
nicht committete Änderungen, Rückstand gegenüber `origin/main` (erst `git pull
--ff-only`), `gh` nicht angemeldet (`gh auth login`).

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

## 5. Notizen schreiben

Commits seit dem letzten Tag sammeln (beim ersten Release: alle):

```bash
git describe --tags --abbrev=0 2>/dev/null
git log --pretty=format:'%s' <letzter-tag>..HEAD    # bzw. git log --pretty=format:'%s'
```

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

## 6. Bestätigung

Zusammenfassung zeigen: Version, ob gebumpt, Testergebnis, ZIP-Name mit
SHA-256, Zieltag, `--draft` ja/nein, und die fertigen Notizen. Dann fragen, ob
gepusht und veröffentlicht werden soll.

Bei `--dry-run` hier enden — mit dem Hinweis, dass ZIP und Notizen erzeugt
wurden, aber weder Tag noch Release existieren.

## 7. Veröffentlichen

Nur nach Bestätigung, in dieser Reihenfolge:

```bash
# nur wenn in Schritt 2 gebumpt wurde
git commit -am "$(cat <<'EOF'
Version <version>

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

Scheitert `gh release create`, während Tag und Push durch sind: das sagen und
den Befehl zum Nachholen ausgeben — nicht den Tag löschen.

## 8. Abschluss

Melden: Release-URL, Tag, SHA-256 des ZIP. Danach der Hinweis, was noch offen
ist:

- Store-Upload von Hand: Developer Dashboard → **Paket** → **Neues Paket
  hochladen**, Ablauf und Fallstricke in
  [store/PUBLISHING.md](../../store/PUBLISHING.md).
- Solange eine Store-Prüfung läuft, nicht erneut einreichen.
- SHA-256 notieren, damit später belegbar ist, welcher Stand hochgegangen ist.
