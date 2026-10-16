import { ApiError } from "../core/errors.js";
import { when } from "./render.js";
import { tryAgent } from "./try-agent.js";
import { playgroundMemory } from "./try-memory.js";
import { tryCommands } from "./try.js";

// `mockd try list`: what this machine minted on the playground (try-memory.js), newest first,
// each read fresh through the core of `try agent show` or `try run status`. The playground
// deletes what nobody used for 24 hours; what the API no longer knows (404) is gone and leaves
// the file. Every other failure is the list's.

const READS = { address: "try agent show", run: "try run status" };

const ENTRIES = { ...tryAgent, ...tryCommands };

function read(entry, ctx) {
  const command = ENTRIES[READS[entry.kind]];
  return command.execute(command.args([entry.token]), ctx);
}

// An address as `try agent show` answers it, a run as `try run status` does, each with its kind,
// token, mock and when it was minted here; a run with the address it was minted on.
const ITEM = {
  address: (entry, fresh) => ({ kind: "address", token: entry.token, mock: entry.mock, at: entry.at, ...fresh }),
  run: (entry, fresh) => ({ kind: "run", token: entry.token, mock: entry.mock, at: entry.at, mcp_url: entry.mcp_url, run: fresh }),
};

async function freshOf(entry, ctx) {
  try {
    return await read(entry, ctx);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

const LINE = {
  address: (item) => {
    const c = item.connector;
    const state = c.closed ? `closed until ${when(c.reopens_at)}` : "open";
    return `${state} · run ${c.current_session_token ?? "—"} · scenario ${c.default_scenario ?? "—"}`;
  },
  run: (item) => `${item.run.is_live ? "live" : "done"} · expires ${when(item.run.expires_at)}`,
};

function render(items) {
  if (!items.length) return "(nothing minted on the playground here yet: mockd try agent create)";
  return items.map((item) => `${item.kind.padEnd(8)} ${item.mock.padEnd(12)} ${item.token}  ${LINE[item.kind](item)}`).join("\n");
}

export const tryList = {
  "try list": {
    usage: "mockd try list",
    describe: "What this machine minted on the playground, newest first, each read fresh; what is gone drops out.",
    execute: async (_intent, ctx) => {
      const memory = playgroundMemory(ctx.machine.fs, ctx.dir);
      const entries = await memory.read();
      const fresh = await Promise.all(entries.map(async (entry) => ({ entry, fresh: await freshOf(entry, ctx) })));
      const gone = fresh.filter((r) => r.fresh === null).map((r) => r.entry.token);
      if (gone.length) await memory.forget(gone);
      return fresh
        .filter((r) => r.fresh !== null)
        .map((r) => ITEM[r.entry.kind](r.entry, r.fresh))
        .reverse();
    },
    render,
  },
};
