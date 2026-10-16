# AGENT.md — Arbeitsregeln für dieses Repo

> Gilt für Menschen **und** Coding-Agenten (Claude Code, Cursor, Codex …).

## Regel Nr. 1 — nie direkt auf `main` oder `dev`

**Kein Commit, kein Push, kein Merge direkt auf `main` oder `dev`.** Beide Branches sind durch
Rulesets geschützt: Änderungen kommen nur per Pull Request, ohne Force-Push und ohne Löschen.
`dev` ist der Integrations-Branch, `main` der Release-Zyklus (siehe „Release“).

## Ablauf

```bash
gh issue develop <nr> --base dev --name feat/kurzer-name --checkout   # feat/ | fix/ | chore/ | docs/
# … arbeiten, committen, pushen …
gh pr create --base dev --draft          # sofort, als Draft: kein CI-Lauf, solange gearbeitet wird
# … am Ende lokal grün machen: npm run lint && npm test …
gh pr ready                              # fertig: der eine CI-Lauf → Review → Merge durch einen Maintainer
```

1. **Issue zuerst.** Im Repo anlegen oder ein bestehendes nehmen; es ist die Doku des Vorhabens.
2. **Verknüpfter Branch von `dev`** (`gh issue develop … --base dev`), nie `git checkout -b`: nur so
   hängen Issue, Branch und PR zusammen.
3. **Lokal prüfen, dann pushen:** `npm run lint && npm test`. Was in CI läuft, läuft vorher lokal.
4. **Commit:** Englisch, Conventional Commits (`feat(runs): …`), der Body erklärt das *Warum*,
   `Closes #<nr>` für das Issue.
5. **PR als Draft gegen `dev`**, gleich nach dem ersten Push. Erst wenn die Arbeit fertig und lokal
   grün ist: `gh pr ready`. Das startet den einen CI-Lauf; danach nur pushen, wenn er rot war.
6. **Merge:** Feature-PRs per Squash, Release-PRs per Merge-Commit. Gemergt wird durch einen
   Maintainer. Branches werden nach dem Merge nicht gelöscht.

### Pull Requests

- **Titel** nach Conventional Commits; **erste Zeile** `Closes #<nr>`.
- **Fünf Abschnitte** in dieser Reihenfolge (`.github/pull_request_template.md` füllt sie vor):
  `## Abstract` · `## Architektonische Implikationen` · `## Angepasste Funktionalitäten` ·
  `## Tests` · `## Erklärungen`. Höchstens 150 Wörter; Details stehen in Commits, Specs und Code.
- **Sprache:** PR-Text auf Deutsch, Commit-Messages und Code-Kommentare auf Englisch. Beiträge von
  außen dürfen den PR-Text englisch schreiben.

## Release

Ein Release ist ein eigener PR **`dev → main`** (Merge-Commit); er wird erst geöffnet, wenn
released wird. Der Push auf `main` startet `release.yml`: Es baut die Dateien für alle fünf Systeme
(`scripts/build-binaries.sh`), startet die des Runners, legt `SHA256SUMS` an und das Release
`v<Version aus package.json>` **in diesem Repo** — mit dem `GITHUB_TOKEN` des Laufs, ohne weiteres
Secret. `https://mock-d.com/install` lädt von dort.

- **Nur der Release-Commit ändert die Version** (`package.json`, `package-lock.json`), nicht jeder
  Merge auf `dev`. Ein Release, das es schon gibt, lässt den Lauf rot enden.
- Ein PR gegen `main`, der nicht von `dev` kommt, lässt den Job `check` scheitern („Releases kommen
  nur als PR dev → main“).

## Versionierung — Pride Versioning

`MAJOR.MINOR.PATCH` bleibt die Form, die Bedeutung ist eine andere als bei SemVer:

| Stelle | Name | Wann hochzählen |
|---|---|---|
| MAJOR | **Proud version** | Wenn wir auf das Release stolz sind. Etwas, worüber man reden will. |
| MINOR | **Default version** | Normale, ordentliche Releases. Der Normalfall. |
| PATCH | **Shame version** | Wenn wir etwas reparieren, das zu peinlich ist, um es zu benennen. |

Die Stufe entscheidet ein Mensch, nicht die Größe des Diffs. Die Zahl ist öffentlich, die
Begründung bleibt intern; Release-Notes beschreiben, was drin ist. Im Zweifel MINOR.

**Achtung vor dem ersten `npm publish`:** npm liest `^` und `~` als Kompatibilitätsaussage. Ein
stolzes MAJOR ohne Breaking Change schneidet jeden Consumer mit `^1.x` vom Update ab, und
Dependabot/Renovate melden es als Major-Upgrade. Solange `@mock-d/cli` nicht veröffentlicht ist, ist
das theoretisch; vor dem ersten Publish gehört die Frage entschieden.

## Architektur — wie wir Code schreiben

`npm run lint` prüft die Grenzen, CI bricht bei Verstoß ab. Alle Regeln sind `error`, nie `warn`.

- **Reines ESM, kein Build-Schritt, keine Laufzeit-Abhängigkeiten.** `bin/mockd.js` lädt `src/`
  direkt: `parseArgs` aus `node:util`, `fetch` global. Eine neue Dependency ist eine Installation,
  die der Nutzer bezahlt; erst ergänzen, wenn die Standardbibliothek es nicht kann. Das Binary
  bündelt Bun (`scripts/build-binaries.sh`); `bin/mockd.js` importiert nichts aus `node_modules`.
- **S — eine Verantwortung je Einheit.** `src/cli.js` parst und verteilt; `src/commands/` kennt je
  Familie nur ihre Routen und ihre Ausgabe (`args` → `execute` → `render`); `src/core/api.js` ist die
  einzige Stelle, die HTTP spricht; `src/platform/` die einzige, die das Betriebssystem kennt;
  `src/deps.js` die einzige, die echte I/O verdrahtet.
- **O — offen für Erweiterung.** Ein neuer Befehl ist ein Eintrag in seiner Familie, eine neue
  Familie eine Datei plus eine Zeile in `commands/index.js`; `cli.js` bekommt keine Verzweigung.
- **D — Dependency Injection.** Nichts holt sich seine Abhängigkeiten selbst: `run(argv, deps)` nimmt
  `fetch`, `env`, `fs`, `run`, `out`, `err`. So fahren die Specs die ganze Befehlskette ohne Netz.
- **Reine Stufen:** Argumente prüfen (`args`), Anfrage stellen (`execute`), Text bauen (`render`).
  Keine Stufe tut die Arbeit der anderen.
- **Keine Fallbacks.** Kein zweiter Weg, wenn der erste fehlschlägt, kein stilles Ausweichen auf einen
  Default. Fehler fangen, mit Kontext weitergeben (Exit 1). `mockd guide` hat deshalb keinen
  eingebauten Text: ohne Backend endet der Befehl mit dem Grund.
- **Mit Anmeldung nur lesen.** Jede Anfrage mit `authorization`-Header ist ein `GET`; einzige
  Ausnahme ist `DELETE /me/reader` beim Abmelden. `src/tests/readonly.spec.js` prüft das über die
  ganze Befehlstabelle; ein neuer Befehl braucht dort einen Aufruf.
- **Der Produktname steht an einer Stelle:** `src/core/product.js` (Ordner und Schlüsselbund-Eintrag
  leiten sich davon ab).
- **Lint-Grenzen:** `complexity ≤ 10`, `max-params ≤ 5`, `max-depth ≤ 4`, `max-lines ≤ 300`,
  `eqeqeq`, `no-param-reassign`. Es gibt keine Ausnahmeliste: Eine Datei, die eine Grenze reißt,
  wird geteilt.

## Tests

**Jedes Feature bekommt Tests, jeder Bugfix einen Regressionstest.** Ohne Test gilt eine
Funktionalität als unfertig.

- **Vitest**, `<modul>.spec.js`, ein Testfall pro Verhalten; der Name sagt, was gelten soll.
- **Ablage:** ein `tests/`-Ordner im Feature-Ordner neben dem getesteten Modul
  (`src/core/tests/api.spec.js` neben `src/core/api.js`). `src/tests/structure.spec.js` schlägt
  fehl, sobald eine Spec woanders liegt; das vitest-`include` bleibt breit, damit eine falsch
  abgelegte Spec benannt statt still übersprungen wird.
- **Exit-Codes sind Teil des Vertrags** und werden mitgetestet: `0` Erfolg, `1` Laufzeitfehler,
  `2` Aufruffehler (mit Usage-Ausgabe).
- Die Specs fahren die Befehle gegen ein gefälschtes `fetch`; gegen ein echtes Backend laufen sie nicht.

## Öffentlich

Dieses Repo ist **öffentlich** (MIT). Deshalb gilt:

- **Keine Verweise auf private Repos, Issues oder interne Systeme** — nicht in Code, Kommentaren,
  Tests, Doku oder Commit-Messages. Kommentare müssen für sich stehen.
- **Keine internen Hosts.** Erlaubt sind `https://api.mock-d.com`, `https://mock-d.com` und
  `localhost`.
- **Keine Geheimnisse:** keine Tokens, Schlüssel, Zugangsdaten oder echten Kennungen, auch nicht
  in Tests und Beispielen (dort stehen erkennbar erfundene Werte).
- `src/tests/public.spec.js` prüft einen Teil davon bei jedem Testlauf; es ersetzt nicht das Hinsehen.
- `skills/mockd/SKILL.md` und `README.md` ziehen mit, wenn sich ein Befehl ändert;
  `src/tests/docs.spec.js` fängt Befehle ab, die es nicht gibt.
