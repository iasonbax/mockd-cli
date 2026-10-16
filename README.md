# mockd

The command line of Mockd, made for coding agents and the people who run them.

Mockd is a control layer between an agent and its SaaS tools: the agent talks MCP to one stable
address, behind it Mockd serves a mock of the tool, and every connection is recorded as a
**run**. `mockd` does two things with that:

- **Without an account** it tells you about the product, live from the backend (`mockd guide`),
  and lets you try the playground: a mock address you can point an agent at for 24 hours.
- **With a read-only sign-in** your agent can read your runs: which calls were made, what they
  changed in the mock data, how two runs differ. **Nothing can be changed with it.**

## Install

macOS and Linux:

```sh
curl -fsSL https://mock-d.com/install | sh
```

Windows (PowerShell):

```powershell
irm https://mock-d.com/install.ps1 | iex
```

This puts one file, `mockd`, on your PATH. It needs no Node.

From the source, with Node 22 or newer (no build step, no runtime dependencies):

```sh
git clone https://github.com/iasonbax/mockd-cli.git
cd mockd-cli
node bin/mockd.js --help
```

## Part A: without an account

```sh
mockd guide                  # the topics of the guide
mockd guide cli              # one topic in full: install, what works with and without sign-in
mockd commands --json        # every command with its usage line, as data
mockd catalog list           # the mocks you can try
mockd try agent create hubspot --rule "crm.deals.search:1=rate_limit" --json
```

| Command | What it does |
|---|---|
| `mockd guide [topic]` | Product knowledge and how-tos, read **live from the backend**. Without a topic: the list of topics. There is no built-in text: when the backend cannot be reached, the command fails with that reason (exit 1). |
| `mockd commands` | Every command with its usage line. |
| `mockd catalog list` | The catalog mocks with their tool counts. |
| `mockd try run create\|status\|trace\|delete\|changes\|diff` | A playground run on a catalog mock, 24 hours, no account. |
| `mockd try agent create\|show\|scenario\|close` | A stable playground address (an MCP endpoint) with an optional failure picture: `--scenario`, `--latency`, `--rule tool[:n]=scenario[:ms]`. |
| `mockd try list` | What this machine minted on the playground, each read fresh. |

The playground allows one run per machine and mock: minting sends a hash of the machine's id,
and while a run goes, or for 24 hours after it, the next one is refused with the moment it can
start. Only a few mocks are free there.

## Part B: read access to your runs

```sh
mockd login                  # prints a code and a link; you confirm it in the browser
mockd whoami                 # who the stored access belongs to
mockd runs list              # your runs, newest first (--live for operation, --project <id>)
mockd runs show <token>      # one run
mockd runs trace <token>     # its tool calls, in order
mockd runs changes <token>   # what it added, changed and removed in the mock data
mockd runs diff <a> <b>      # two lab runs, call by call
mockd logout                 # ends the access on the server and removes it here
```

`mockd login` opens the browser, shows the code and the link on stderr, and waits until you
confirm. Your agent should hand you both and let you confirm; it cannot do it for you. The access
is stored in the macOS Keychain, with Windows DPAPI, or in a file only you can read.

**Signed in, mockd can only read.** The access it gets is a read access: the backend answers
every other request with 403, and the CLI sends nothing but reads with it (the one exception is
`logout`, which ends the access itself; a test holds the whole command table to this). A script or
a container can name an access in `MOCKD_CLIENT_ID` and `MOCKD_CLIENT_SECRET` instead.

## For agents

```sh
mockd guide --json                      # {"topics": [{"slug", "title", "summary"}]}
mockd guide cli --json                  # {"slug", "title", "summary", "markdown"}
mockd runs list --json
mockd try agent create hubspot --json   # {"connector": {…}, "mcp_url": "…"}
```

- Every command prints a stable JSON shape with `--json`.
- Exit codes: `0` ok, `1` runtime error (the API's own message on stderr), `2` usage error
  (with the usage text).
- Nothing asks a question, and secrets never travel as arguments.
- `skills/mockd/SKILL.md` is a skill for coding agents: copy the `mockd` folder into the skills
  directory of your agent. For the product itself it points to `mockd guide`.

## Environment

| Variable | Meaning |
|---|---|
| `MOCKD_API_URL` | The backend (default `https://api.mock-d.com`); `--api` does the same per call. A local backend is `http://localhost:8000`; plain `http://` is refused except to `localhost`. |
| `MOCKD_CLIENT_ID`, `MOCKD_CLIENT_SECRET` | A client access for scripts and containers; beats what `mockd login` stored. Set both or neither. |
| `MOCKD_TRACE_BASE` | A website address; `try run create` then prints a link to the trace. |
| `MOCKD_PROFILE` | A setup apart from the real one (for tests against a local backend): its own folder and keychain item, `mockd-<profile>`. |

Files live in `~/.config/mockd` (`%APPDATA%\mockd` on Windows): `try.json` holds the playground
tokens this machine minted, and on Linux `credentials.json` holds the access (mode 600).

## Development

```sh
npm ci
npm run lint     # ESLint with the clean-code limits: complexity, parameters, depth, file length
npm test         # Vitest; every spec lies in a tests/ folder next to the module it tests
```

The standalone files are built with [Bun](https://bun.sh): `scripts/build-binaries.sh linux-x64`
writes `dist/mockd-linux-x64`, and `scripts/smoke-binary.sh dist/mockd-linux-x64` starts it the way
a user's machine does. A merge to `main` publishes all five files and `SHA256SUMS` as a release.

How the code is cut, and how changes get in, is written down in [AGENT.md](AGENT.md) and
[CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Carl Iason Baxmann
