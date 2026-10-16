import { UsageError } from "../core/errors.js";
import { query, viaApi } from "./entry.js";
import { renderChanges, renderDiff, renderTrace, when } from "./render.js";

// The account's runs, read only, in two areas: `/labs` (the lab) and `/live` (operation
// against the originals). `--live` switches the area; the shapes are the same, so the
// renderers are the playground's. Every route here is a GET: a read access can do no more, and
// src/tests/readonly.spec.js holds the whole command table to it.

const area = (i) => (i.live ? "/live" : "/labs");

const runPath = (i) => `${area(i)}/runs/${encodeURIComponent(i.token)}`;

const needsToken = ([token], values) => {
  if (!token) throw new UsageError("needs a <token>");
  return { token, live: Boolean(values.live) };
};

// The verdict is the one human input on a run: met · missed · unclear, or nothing yet. It
// shows in the list as it shows on the run, so an unjudged run stands out.
const line = (r) =>
  `${r.session_token}  ${r.is_live ? "live" : "done"}  ${when(r.created_at)}  ` +
  `agent=${r.agent ?? "—"}  project=${r.project_id ?? "—"}  variant=${r.variant_id ?? "—"}  ` +
  `verdict=${r.goal_met ?? "—"}`;

export const renderRuns = (d) => (d.length ? d.map(line).join("\n") : "(no runs)");

export function renderRun(r) {
  const latency = r.scenario_latency_ms != null ? ` (latency ${r.scenario_latency_ms}ms)` : "";
  return [
    `run       ${r.session_token}`,
    `state     ${r.is_live ? "live" : "done"}`,
    `agent     ${r.agent ?? "—"}`,
    `project   ${r.project_id ?? "—"}`,
    `variant   ${r.variant_id ?? "—"}`,
    `verdict   ${r.goal_met ?? "—"}`,
    `servers   ${r.servers_used?.length ? r.servers_used.join(", ") : "—"}`,
    `scenario  ${r.active_scenario ?? "none"}${latency}`,
    `created   ${when(r.created_at)}`,
  ].join("\n");
}

const list = {
  usage: "mockd runs list [--project id] [--live]",
  describe: "My runs, newest first: the lab by default, --live for operation.",
  auth: true,
  flags: ["project", "live"],
  args: (_positionals, values) => ({ project: values.project, live: Boolean(values.live) }),
  execute: viaApi((i) => ({ method: "GET", path: `${area(i)}/runs${query({ project: i.project })}` })),
  render: renderRuns,
};

const show = {
  usage: "mockd runs show <token> [--live]",
  describe: "One run: agent, project, variant, servers, failure picture.",
  auth: true,
  flags: ["live"],
  args: needsToken,
  execute: viaApi((i) => ({ method: "GET", path: runPath(i) })),
  render: renderRun,
};

const trace = {
  usage: "mockd runs trace <token> [--live]",
  describe: "The tool calls of a run, in order.",
  auth: true,
  flags: ["live"],
  args: needsToken,
  execute: viaApi((i) => ({ method: "GET", path: `${runPath(i)}/traces` })),
  render: renderTrace,
};

const changes = {
  usage: "mockd runs changes <token> [--live]",
  describe: "What the run changed in the mock data: added, removed and changed records.",
  auth: true,
  flags: ["live"],
  args: needsToken,
  execute: viaApi((i) => ({ method: "GET", path: `${runPath(i)}/changes` })),
  render: renderChanges,
};

const diff = {
  usage: "mockd runs diff <token> <other>",
  describe: "Two lab runs side by side, call by call (same servers and seed make them comparable).",
  auth: true,
  args: ([token, other]) => {
    if (!token || !other) throw new UsageError("needs a <token> and an <other> run token");
    return { token, other };
  },
  execute: viaApi((i) => ({ method: "GET", path: `/labs/runs/${encodeURIComponent(i.token)}/diff/${encodeURIComponent(i.other)}` })),
  render: renderDiff,
};

export const runs = {
  "runs list": list,
  "runs show": show,
  "runs trace": trace,
  "runs changes": changes,
  "runs diff": diff,
};
