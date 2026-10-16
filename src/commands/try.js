import { UsageError } from "../core/errors.js";
import { viaApi } from "./entry.js";
import { renderChanges, renderDiff, renderTrace } from "./render.js";
import { keep } from "./try-memory.js";
import { explained } from "./try-refusals.js";

// The playground: anonymous runs on a catalog mock, 24 h, no account. What the website's try
// page does, from the command line. Minting sends this machine's fingerprint
// (`platform/fingerprint.js`): one run per machine and mock, then a 24-hour lock. What is
// minted is kept in the profile's folder (try-memory.js), where `try list` finds it.

const needsToken = ([token]) => {
  if (!token) throw new UsageError("needs a <token>");
  return { token };
};

const runPath = (token) => `/public/try/runs/${encodeURIComponent(token)}`;

function renderCreate(data, env) {
  const s = data.session;
  const traceBase = env.MOCKD_TRACE_BASE;
  const trace = traceBase
    ? `${traceBase.replace(/\/$/, "")}/try?token=${s.session_token}`
    : `mockd try run trace ${s.session_token}`;
  return [
    `session   ${s.session_token}`,
    `mock      ${s.mock_id} @ ${s.mock_version}`,
    `mcp_url   ${data.mcp_url}`,
    `expires   ${s.expires_at ?? "—"}`,
    `trace     ${trace}`,
  ].join("\n");
}

const create = {
  usage: "mockd try run create [mock_id]",
  describe: "Start a playground run on a catalog mock (default: hubspot).",
  args: ([mockId]) => ({ mockId: mockId ?? "hubspot" }),
  execute: explained(async (i, ctx) => {
    const made = await ctx.api({
      method: "POST",
      path: "/public/try/runs",
      body: { mock_id: i.mockId, fingerprint: await ctx.fingerprint() },
    });
    await keep(ctx, { kind: "run", token: made.session.session_token, mock: i.mockId, mcp_url: made.mcp_url });
    return made;
  }),
  render: renderCreate,
};

const status = {
  usage: "mockd try run status <token>",
  describe: "Show whether a playground run is live and which scenario it carries.",
  args: needsToken,
  execute: viaApi((i) => ({ method: "GET", path: runPath(i.token) })),
  // `scenario=` stays in the display: a run CAN carry a fault preset (inherited from the
  // address or a replay fork); only setting it is not this command's job.
  render: (d) =>
    `${d.session_token} · ${d.mock_id} · ${d.is_live ? "live" : "done"} · scenario=${d.active_scenario}`,
};

const trace = {
  usage: "mockd try run trace <token>",
  describe: "List the tool calls of a playground run.",
  args: needsToken,
  execute: viaApi((i) => ({ method: "GET", path: `${runPath(i.token)}/traces` })),
  render: renderTrace,
};

const remove = {
  usage: "mockd try run delete <token>",
  describe: "Delete an empty, unclaimed playground run.",
  args: needsToken,
  execute: viaApi((i) => ({ method: "DELETE", path: runPath(i.token) })),
  render: (d) => (d.deleted ? "deleted" : "not deleted (session has calls or is claimed)"),
};

const changes = {
  usage: "mockd try run changes <token>",
  describe: "What the run changed in the mock data: added, removed and changed records.",
  args: needsToken,
  execute: viaApi((i) => ({ method: "GET", path: `${runPath(i.token)}/changes` })),
  render: renderChanges,
};

const diff = {
  usage: "mockd try run diff <token> <other>",
  describe: "Two runs side by side, call by call (same mock and seed make them comparable).",
  args: ([token, other]) => {
    if (!token || !other) throw new UsageError("needs a <token> and an <other> run token");
    return { token, other };
  },
  execute: viaApi((i) => ({ method: "GET", path: `${runPath(i.token)}/diff/${encodeURIComponent(i.other)}` })),
  render: renderDiff,
};

export const tryCommands = {
  "try run create": create,
  "try run status": status,
  "try run trace": trace,
  "try run delete": remove,
  "try run changes": changes,
  "try run diff": diff,
};
