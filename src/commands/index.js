import { DEFAULT_API } from "../core/api.js";
import { UsageError } from "../core/errors.js";
import { account } from "./account.js";
import { catalog } from "./catalog.js";
import { guide } from "./guide.js";
import { meta } from "./meta.js";
import { runs } from "./runs.js";
import { tryAgent } from "./try-agent.js";
import { tryList } from "./try-list.js";
import { tryCommands } from "./try.js";

// One table for every family. A new family is one file plus one line here; a new command is
// one entry in its family. Nothing else learns about it. Part A needs no account (guide,
// commands, catalog, try); part B (login, whoami, logout, runs) is the read access.
export const COMMANDS = {
  ...guide,
  ...meta,
  ...catalog,
  ...tryCommands,
  ...tryAgent,
  ...tryList,
  ...account,
  ...runs,
};

const LONGEST_NAME = 3;

// Longest name first, so "try run create" wins over a hypothetical "try". Returns the name and
// the positionals left over for the command's own `args`.
export function match(positionals, commands = COMMANDS) {
  for (let n = Math.min(LONGEST_NAME, positionals.length); n > 0; n -= 1) {
    const name = positionals.slice(0, n).join(" ");
    if (commands[name]) return [name, positionals.slice(n)];
  }
  throw new UsageError(`Unknown command: ${positionals.join(" ") || "(none)"}`);
}

export function usageText(commands = COMMANDS) {
  // One block per family (the word after `mockd`), so the list stays readable; the one-word
  // commands (`login`, `whoami`, `guide`, …) share a block instead of one each.
  const lines = [];
  let family = null;
  for (const e of Object.values(commands)) {
    const words = e.usage.split(" ");
    const head = words.length > 2 && !words[2].startsWith("[") ? words[1] : "";
    if (family !== null && head !== family) lines.push("");
    family = head;
    lines.push(`  ${e.usage}`);
  }
  return [
    "mockd — Mock APIs for agents, from the command line.",
    "People, scripts and agents run the commands below.",
    "",
    "Usage:",
    ...lines,
    "",
    "No account needed: guide, commands, catalog, try. After `mockd login`: whoami, runs (read only).",
    "",
    "Options:",
    "  --json              machine-readable output (stable shape)",
    `  --api <url>         backend base url (default $MOCKD_API_URL or ${DEFAULT_API})`,
    "  --version, -v       print the version",
    "",
    "Env:",
    "  MOCKD_API_URL       backend base url (a local backend: http://localhost:8000)",
    "  MOCKD_CLIENT_ID     client access for scripts and containers (with MOCKD_CLIENT_SECRET);",
    "  MOCKD_CLIENT_SECRET   beats what `mockd login` stored",
    "  MOCKD_TRACE_BASE    website base url; when set, `try run create` prints a link to the trace",
    "  MOCKD_PROFILE       a setup apart from the real one: its own folder and keychain item,",
    "                      mockd-<profile>",
  ].join("\n");
}
