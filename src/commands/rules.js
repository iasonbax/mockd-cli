import { UsageError } from "../core/errors.js";

// The failure pictures the backend knows (`ScenarioType`), in its own words.
export const SCENARIOS = ["none", "rate_limit", "timeout", "empty", "latency", "ok", "error"];

export function integer(value, what, min) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new UsageError(`${what} must be an integer ≥ ${min}, got "${value}"`);
  return n;
}

function scenarioNamed(value, what) {
  if (!SCENARIOS.includes(value)) {
    throw new UsageError(`${what}: unknown scenario "${value}" (one of ${SCENARIOS.join(", ")})`);
  }
  return value;
}

// `tool[:occurrence]=scenario[:latency_ms]`, a FailureRule on one line. Examples:
//   crm.deals.search:1=timeout:3000   the FIRST call of that tool times out after 3 s
//   clickup_create_task=rate_limit    every call of that tool gets a 429
export function parseRule(spec) {
  const what = `rule "${spec}"`;
  const parts = spec.split("=");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new UsageError(`${what} must look like tool[:n]=scenario[:latency_ms]`);
  }
  const [tool, occurrence] = parts[0].split(":");
  const [scenario, latency] = parts[1].split(":");
  if (!tool) throw new UsageError(`${what} names no tool`);
  const rule = { tool, scenario: scenarioNamed(scenario, what) };
  if (occurrence !== undefined) rule.occurrence = integer(occurrence, `${what}: occurrence`, 1);
  if (latency !== undefined) rule.latency_ms = integer(latency, `${what}: latency_ms`, 0);
  return rule;
}

export const parseRules = (specs) => specs.map(parseRule);

export function formatRule(r) {
  const n = r.occurrence != null ? `:${r.occurrence}` : "";
  const ms = r.latency_ms != null ? `:${r.latency_ms}` : "";
  return `${r.tool}${n}=${r.scenario}${ms}`;
}

// The flags `--scenario`, `--latency`, `--rule …`, `--clear-rules` as the body of
// `POST …/scenario`. Empty when none was given. `rules` stays three-valued like the API:
// absent keeps the address's rules, `[]` (--clear-rules) deletes them, a list replaces them.
export function scenarioBody(values) {
  const body = {};
  if (values.scenario !== undefined) body.scenario = scenarioNamed(values.scenario, "--scenario");
  if (values.latency !== undefined) body.latency_ms = integer(values.latency, "--latency", 0);
  if (values.rule?.length) body.rules = parseRules(values.rule);
  if (values["clear-rules"]) body.rules = [];
  return body;
}

export const SCENARIO_FLAGS = ["scenario", "latency", "rule", "clear-rules"];
