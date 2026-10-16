---
name: mockd
description: Use the Mockd command line (`mockd`) to look up what Mockd is and how it works, to try its playground without an account, and, once the user has signed in with read access, to read what an agent run did. Use when asked about Mockd, to mock a SaaS tool for an agent, or to inspect the calls and changes of a run.
---

# Mockd from the command line

Mockd is a control layer between an agent and its SaaS tools (HubSpot, Notion, …). The agent
talks MCP to one stable address; behind it Mockd serves a **mock** of the tool and records every
connection as a **run**: the calls, and what they changed in the mock data. The `mockd` CLI is a
thin, `--json`-first wrapper over the Mockd API.

Not installed yet: `curl -fsSL https://mock-d.com/install | sh` (Windows:
`irm https://mock-d.com/install.ps1 | iex`) puts one file, `mockd`, on the PATH; no Node needed.

Read `mockd commands --json` for the full table. Every command prints a stable JSON shape with
`--json`; exit codes: `0` ok, `1` runtime error (the API's own message on stderr), `2` usage
error (with the usage text). Nothing asks a question, and secrets never travel as arguments.
`mockd` without arguments prints the usage (exit 2), so call a command.

## Product knowledge: `mockd guide`

For what Mockd is, what it can do and how to do something with it, do not rely on this file:

```bash
mockd guide                # the topics: slug, title, summary
mockd guide <topic>        # one topic in full (markdown); `cli` tells what works with and without sign-in
mockd guide <topic> --json # {"slug", "title", "summary", "markdown"}
```

The guide is read live from the Mockd backend, so it is current. When the backend cannot be
reached the command fails (exit 1) with that reason; it has no copy of the text. Do not make up
an answer then: say that the guide could not be read.

## Part A: without an account

```bash
mockd catalog list                                    # the mocks you can try
mockd try agent create hubspot --rule "crm.deals.search:1=rate_limit" --json
mockd try agent show <token>                          # the address, its failure picture, its current run
mockd try run trace <run>                             # the calls of a run, in order
mockd try run changes <run>                           # added / changed / removed records
mockd try run diff <a> <b>                            # two runs side by side
mockd try list --json                                 # what this machine minted, each read fresh
```

`try agent create` mints a stable address on a catalog mock (an MCP endpoint, 24 h, no login);
the failure picture is preset on the address before the run, because an agent run takes seconds:
`--scenario` (`none`, `rate_limit`, `timeout`, `empty`, `latency`, `ok`, `error`), `--latency ms`,
and `--rule tool[:occurrence]=scenario[:latency_ms]`, repeatable. `try agent scenario <token> …`
changes it, `try agent close <token>` ends the run and shuts the address. `try run create` starts
a run without an address.

The tokens are kept in the CLI's folder (`try.json`), since the playground lists nothing. One run
per machine and mock: minting sends a hash of this machine's id, and while that run goes or for
24 h after it the next mint fails with `address_in_use` and the moment it opens again. Without a
readable machine id (a container without `/etc/machine-id`) minting fails and sends nothing; the
host's id mounted read-only is the way. Only a few mocks are free there; the others fail with
`mock_not_free`: they need an account.

## Part B: read access to the user's runs

```bash
mockd login            # prints a code and a link on stderr, waits until the user confirms
mockd whoami
mockd runs list [--project id] [--live]    # lab by default, --live for operation
mockd runs show <token>
mockd runs trace <token>                   # the calls, in order
mockd runs changes <token>                 # added / changed / removed records
mockd runs diff <a> <b>                    # two lab runs side by side
mockd logout                               # ends the access on the server and here
```

`mockd login` gives this machine a **read access**, nothing more: it can read runs, and the
backend refuses everything else (403). Show the code and the link to the user and let them
confirm in the browser (exit 1 when they decline or the code expires); never confirm it yourself.
Anything that changes something is the user's to do in the web app: hand them the link instead of
looking for another way.

`MOCKD_CLIENT_ID` + `MOCKD_CLIENT_SECRET` in the environment beat what `login` stored (scripts,
containers). `mockd` talks to `https://api.mock-d.com`; `MOCKD_API_URL` (or `--api`) names another
backend, and plain `http://` is refused except to `localhost`. `MOCKD_PROFILE=<name>` is a second
setup apart from the real one (its own access and folder `mockd-<name>`); `mockd whoami` names it.

## Conventions when acting on request

- Prefer `--json` and read ids from the answers; never guess ids.
- A run's token comes from `runs list` (signed in) or from `try agent show` / `try list`
  (playground); take it from there.
- `create` commands mint a new thing each time; list first (`try list`).
- Show the user what you found: the calls of a run, the records it changed. Do not store secrets
  in files an agent controls.
- When a command fails, say what the message says. A 403 is a boundary, not a bug to work around.
