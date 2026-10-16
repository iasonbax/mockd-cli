# AGENT.md — Working rules for this repository

> These rules apply to people **and** coding agents (Claude Code, Cursor, Codex, and others).
> Maintainers work as described here. External contributors follow [CONTRIBUTING.md](CONTRIBUTING.md),
> which describes the same flow from a fork.

## Rule 1 — never commit directly to `main` or `dev`

**No commit, push or merge goes directly to `main` or `dev`.** Both branches are protected by
rulesets: changes arrive only through pull requests, with no force-pushes and no deletions.
`dev` is the integration branch; `main` carries the release cycle (see "Release").

## Workflow

```bash
gh issue develop <number> --base dev --name feat/short-name --checkout   # feat/ | fix/ | chore/ | docs/
# ... work, commit, push ...
gh pr create --base dev --draft          # right away, as a draft: no CI run while work is in progress
# ... when done, make it green locally: npm run lint && npm test ...
gh pr ready                              # done: the single CI run, then review and merge by a maintainer
```

1. **Issue first.** Open one in this repository or use an existing one; it documents the intent of
   the change.
2. **Linked branch from `dev`** (`gh issue develop ... --base dev`), never a plain
   `git checkout -b`: only then are issue, branch and pull request connected.
3. **Verify locally, then push:** `npm run lint && npm test`. Whatever runs in CI runs locally first.
4. **Commit:** English, Conventional Commits (`feat(runs): ...`). The body explains the *why*, and
   `Closes #<number>` references the issue.
5. **Open the pull request as a draft against `dev`**, right after the first push. Mark it ready
   (`gh pr ready`) only when the work is finished and green locally. That starts the single CI run;
   push again only if it failed.
6. **Merge:** feature pull requests are squash-merged, release pull requests use a merge commit.
   A maintainer performs the merge. Branches are not deleted after merging.

### Pull requests

- **Title** follows Conventional Commits; the **first line** of the description is
  `Closes #<number>`.
- **Five sections**, in this order (`.github/pull_request_template.md` pre-fills them):
  `## Summary` · `## Architecture` · `## Behavior` · `## Testing` · `## Notes`.
  At most 150 words; details belong in commits, specs and code.
- **Language:** English for pull request text, commit messages and code comments.

## Release

A release is a pull request of its own, **`dev` → `main`**, merged with a merge commit. It is
opened only when a release is due. The push to `main` starts `release.yml`: it builds the files for
all five platforms (`scripts/build-binaries.sh`), starts the one for the runner, writes
`SHA256SUMS` and creates the release `v<version from package.json>` **in this repository**, using
the run's own `GITHUB_TOKEN` and no further secret. `https://mock-d.com/install` downloads from
there.

- **Only the release commit changes the version** (`package.json`, `package-lock.json`), not every
  merge to `dev`. If the release already exists, the run ends red.
- A pull request against `main` that does not come from `dev` of this repository fails the `check`
  job ("Releases only come as a pull request from dev to main").

## Versioning — Pride Versioning

The form stays `MAJOR.MINOR.PATCH`; the meaning differs from SemVer:

| Position | Name | When to increment |
|---|---|---|
| MAJOR | **Proud version** | When we are proud of the release. Something worth talking about. |
| MINOR | **Default version** | Normal, solid releases. The usual case. |
| PATCH | **Shame version** | When we fix something too embarrassing to name. |

A person decides the level, not the size of the diff. The number is public, the reasoning stays
internal; release notes describe what is in the release. When in doubt, MINOR.

**Before the first `npm publish`:** npm reads `^` and `~` as a statement about compatibility. A proud
MAJOR without a breaking change cuts every consumer on `^1.x` off from the update, and
Dependabot/Renovate report it as a major upgrade. As long as `@mock-d/cli` is unpublished this is
theoretical; the question has to be settled before the first publish.

## Architecture — how we write code

`npm run lint` enforces the limits, and CI fails on a violation. Every rule is an `error`, never a
`warn`.

- **Plain ESM, no build step, no runtime dependencies.** `bin/mockd.js` loads `src/` directly:
  `parseArgs` from `node:util`, global `fetch`. A new dependency is an installation the user pays
  for; add one only when the standard library cannot do the job. The standalone binary bundles Bun
  (`scripts/build-binaries.sh`); `bin/mockd.js` imports nothing from `node_modules`.
- **S — one responsibility per unit.** `src/cli.js` parses and dispatches; `src/commands/` knows,
  per family, only its routes and its output (`args` → `execute` → `render`); `src/core/api.js` is
  the only place that speaks HTTP; `src/platform/` is the only place that knows the operating
  system; `src/deps.js` is the only place that wires real I/O.
- **O — open for extension.** A new command is an entry in its family; a new family is one file plus
  one line in `commands/index.js`. `cli.js` gets no new branch.
- **D — dependency injection.** Nothing fetches its own dependencies: `run(argv, deps)` receives
  `fetch`, `env`, `fs`, `run`, `out` and `err`. This lets the specs drive the whole command chain
  without a network.
- **Pure stages:** validate arguments (`args`), make the request (`execute`), build the text
  (`render`). No stage does another stage's work.
- **No fallbacks.** No second path when the first fails, and no silent fallback to a default. Catch
  errors and pass them on with context (exit 1). That is why `mockd guide` has no built-in text:
  without a backend the command ends with the reason.
- **Read-only when signed in.** Every request carrying an `authorization` header is a `GET`; the only
  exception is `DELETE /me/reader` on sign-out. `src/tests/readonly.spec.js` checks this across the
  whole command table; a new command needs a call there.
- **The product name lives in one place:** `src/core/product.js` (the folder and the keychain entry
  derive from it).
- **Lint limits:** `complexity ≤ 10`, `max-params ≤ 5`, `max-depth ≤ 4`, `max-lines ≤ 300`,
  `eqeqeq`, `no-param-reassign`. There is no exception list: a file that breaks a limit is split.

## Tests

**Every feature gets tests and every bug fix a regression test.** Functionality without a test is
considered unfinished.

- **Vitest**, `<module>.spec.js`, one test case per behavior; the name states what should hold.
- **Placement:** a `tests/` folder in the feature folder, next to the module under test
  (`src/core/tests/api.spec.js` next to `src/core/api.js`). `src/tests/structure.spec.js` fails as
  soon as a spec lives elsewhere; the vitest `include` stays broad so that a misplaced spec is
  reported instead of silently skipped.
- **Exit codes are part of the contract** and are tested: `0` success, `1` runtime error, `2` usage
  error (with usage output).
- The specs run the commands against a fake `fetch`; they do not run against a real backend.

## Public repository

This repository is **public** (MIT). Therefore:

- **No references to private repositories, issues or internal systems** — not in code, comments,
  tests, documentation or commit messages. Comments must stand on their own.
- **No internal hosts.** Allowed are `https://api.mock-d.com`, `https://mock-d.com` and
  `localhost`.
- **No secrets:** no tokens, keys, credentials or real identifiers, not even in tests and examples
  (those use recognizably made-up values).
- `src/tests/public.spec.js` checks part of this on every test run; it does not replace a careful
  look.
- Everything in the repository is written in English: documentation, pull request text, commit
  messages, code comments and user-facing messages.
- `skills/mockd/SKILL.md` and `README.md` change together with a command;
  `src/tests/docs.spec.js` catches commands that do not exist.
