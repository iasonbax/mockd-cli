# Contributing

Thanks for looking at mockd. Changes are welcome; this is how they get in.

## Who can change what

Nobody but the maintainer has write access to this repository. `dev` and `main` accept changes
only through pull requests: no direct pushes, no force-pushes, no deletions. A change from outside
comes as a pull request from a **fork**; a maintainer reviews it and merges it.

## How to contribute

1. **Open an issue first** for anything bigger than a typo, so the idea can be discussed before
   you spend time on it.
2. **Fork** the repository and create a branch from `dev`.
3. Make the change. Every feature gets a test and every bug fix a regression test; specs live in a
   `tests/` folder next to the module they test (`src/core/tests/api.spec.js` next to
   `src/core/api.js`).
4. Make it green locally. You need Node 22 or newer:

   ```sh
   npm ci
   npm run lint
   npm test
   ```

5. **Open a pull request against `dev`** (not `main`: `main` only takes releases, as a pull request
   from `dev`). Fill in the sections of the template; English is fine.
6. Workflows from forks run only after a maintainer approves them. If CI is red after that, push a fix
   to the same branch.

## Style

- Code comments and commit messages are in English; commits follow
  [Conventional Commits](https://www.conventionalcommits.org/) (`feat(runs): …`, `fix: …`), and the
  body says *why*.
- The CLI has no runtime dependencies on purpose; please do not add one.
- Keep the limits ESLint enforces (complexity, parameters, nesting, file length). There is no list of
  exceptions.
- No secrets, tokens or links to private systems in code, tests or text.

## Security

Please do not report vulnerabilities in an issue. See [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
