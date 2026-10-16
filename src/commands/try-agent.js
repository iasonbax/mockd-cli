import { UsageError } from "../core/errors.js";
import { viaApi } from "./entry.js";
import { SCENARIO_FLAGS, SCENARIOS, formatRule, scenarioBody } from "./rules.js";
import { keep } from "./try-memory.js";
import { explained } from "./try-refusals.js";

// A playground address: the stable MCP endpoint an agent enters once. It has one run at a time:
// a reconnect takes that run over, and the next run starts with the first call 24 hours after it
// ended. The failure picture (scenario + rules) is preset on the ADDRESS, before the run: an
// agent run takes seconds, nobody clicks at the right moment.

const needsToken = ([token]) => {
  if (!token) throw new UsageError("needs a <token>");
  return { token };
};

const base = (token) => `/public/try/agents/${encodeURIComponent(token)}`;

export function renderAgent(c, mcpUrl) {
  const latency = c.default_latency_ms != null ? ` (latency ${c.default_latency_ms}ms)` : "";
  const scenario = c.default_scenario ? `${c.default_scenario}${latency}` : "—";
  const rules = c.default_scenario_rules?.length
    ? c.default_scenario_rules.map(formatRule).join(", ")
    : "—";
  return [
    `agent     ${c.connector_token}`,
    `mock      ${c.mock_id}`,
    mcpUrl ? `mcp_url   ${mcpUrl}` : null,
    `run       ${c.current_session_token ?? "—"}`,
    `scenario  ${scenario}`,
    `rules     ${rules}`,
    `state     ${c.closed ? "closed" : "open"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const create = {
  usage: "mockd try agent create [mock_id] [--scenario s] [--latency ms] [--rule spec…]",
  describe: "Mint a playground address (stable MCP endpoint), optionally with a failure picture.",
  flags: SCENARIO_FLAGS,
  args: ([mockId], values) => ({ mockId: mockId ?? "hubspot", preset: scenarioBody(values) }),
  // Two requests when a failure picture comes along: the address first, then its preset. The
  // backend wants a scenario on that route; rules without one are granular rules on `none`.
  // The address carries this machine's fingerprint: one run per machine and mock at a time.
  // It is kept (try-memory.js) before the preset, so a preset that fails leaves it findable.
  execute: explained(async (i, ctx) => {
    const made = await ctx.api({
      method: "POST",
      path: "/public/try/agents",
      body: { mock_id: i.mockId, fingerprint: await ctx.fingerprint() },
    });
    await keep(ctx, { kind: "address", token: made.connector.connector_token, mock: i.mockId });
    if (!Object.keys(i.preset).length) return made;
    const body = { scenario: "none", ...i.preset };
    const path = `${base(made.connector.connector_token)}/scenario`;
    const connector = await ctx.api({ method: "POST", path, body });
    return { ...made, connector };
  }),
  render: (d) => renderAgent(d.connector, d.mcp_url),
};

const show = {
  usage: "mockd try agent show <token>",
  describe: "The address, its failure picture and the token of its current run.",
  args: needsToken,
  execute: viaApi((i) => ({ method: "GET", path: base(i.token) })),
  render: (d) => renderAgent(d.connector, d.mcp_url),
};

const scenario = {
  usage: "mockd try agent scenario <token> <scenario> [--latency ms] [--rule spec…] [--clear-rules]",
  describe: "Preset the failure picture for every following run; `none` takes it back.",
  flags: SCENARIO_FLAGS,
  args: ([token, name], values) => {
    if (!token || !name) throw new UsageError("needs a <token> and a <scenario>");
    if (!SCENARIOS.includes(name)) {
      throw new UsageError(`unknown scenario "${name}" (one of ${SCENARIOS.join(", ")})`);
    }
    return { token, body: { ...scenarioBody(values), scenario: name } };
  },
  execute: explained(viaApi((i) => ({ method: "POST", path: `${base(i.token)}/scenario`, body: i.body }))),
  render: (d) => renderAgent(d),
};

const close = {
  usage: "mockd try agent close <token>",
  describe: "Finish the run and shut the address: the next call gets an error, not a silent run.",
  args: needsToken,
  execute: viaApi((i) => ({ method: "POST", path: `${base(i.token)}/close`, body: {} })),
  render: (d) => renderAgent(d),
};

export const tryAgent = {
  "try agent create": create,
  "try agent show": show,
  "try agent scenario": scenario,
  "try agent close": close,
};
