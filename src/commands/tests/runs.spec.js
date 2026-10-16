import { describe, expect, it } from "vitest";
import { UsageError } from "../../core/errors.js";
import { renderRun, renderRuns, runs } from "../runs.js";

const call = async (name, positionals, values = {}, answer = []) => {
  const seen = [];
  const entry = runs[name];
  const intent = entry.args ? entry.args(positionals, values) : {};
  await entry.execute(intent, { api: async (r) => (seen.push(r), answer) });
  return seen[0];
};

describe("runs", () => {
  it("every command needs the credential", () => {
    for (const [name, e] of Object.entries(runs)) expect(e.auth, name).toBe(true);
  });

  it("are read only: five commands, every one a GET, and no judge", async () => {
    expect(Object.keys(runs)).toEqual(["runs list", "runs show", "runs trace", "runs changes", "runs diff"]);
    for (const [name, positionals] of [["runs list", []], ["runs show", ["t"]], ["runs trace", ["t"]], ["runs changes", ["t"]], ["runs diff", ["a", "b"]]]) {
      expect((await call(name, positionals)).method, name).toBe("GET");
    }
  });

  it("list asks the lab by default, operation with --live, filtered by project", async () => {
    expect(await call("runs list", [])).toEqual({ method: "GET", path: "/labs/runs" });
    expect(await call("runs list", [], { live: true })).toEqual({ method: "GET", path: "/live/runs" });
    expect(await call("runs list", [], { project: "5" })).toEqual({ method: "GET", path: "/labs/runs?project=5" });
  });

  it.each([
    ["runs show", "/labs/runs/t1"],
    ["runs trace", "/labs/runs/t1/traces"],
    ["runs changes", "/labs/runs/t1/changes"],
  ])("%s follows the area", async (name, path) => {
    expect(await call(name, ["t1"])).toEqual({ method: "GET", path });
    expect(await call(name, ["t1"], { live: true })).toEqual({ method: "GET", path: path.replace("/labs", "/live") });
    expect(() => runs[name].args([], {})).toThrow("needs a <token>");
  });

  // The bearer travels with these requests: a token from the command line is one path segment
  // and cannot lead to another route.
  it("keeps a token with a slash in it to one path segment", async () => {
    expect((await call("runs show", ["../../me/readers"])).path).toBe("/labs/runs/..%2F..%2Fme%2Freaders");
    expect((await call("runs diff", ["a/b", "c/d"])).path).toBe("/labs/runs/a%2Fb/diff/c%2Fd");
  });

  it("diff compares two lab runs and needs both", async () => {
    expect(await call("runs diff", ["a", "b"])).toEqual({ method: "GET", path: "/labs/runs/a/diff/b" });
    expect(() => runs["runs diff"].args(["a"], {})).toThrow(UsageError);
    expect(runs["runs diff"].flags).toBeUndefined();
  });

  it("renders the list and one run", () => {
    const run = {
      session_token: "t1",
      is_live: true,
      created_at: "2026-09-05T12:00:00.123Z",
      agent: "Desktop",
      project_id: "5",
      variant_id: "11",
      servers_used: ["hubspot"],
      active_scenario: "rate_limit",
      scenario_latency_ms: 300,
    };
    expect(renderRuns([run])).toBe(
      "t1  live  2026-09-05 12:00:00  agent=Desktop  project=5  variant=11  verdict=—"
    );
    expect(renderRuns([{ ...run, goal_met: "met" }])).toContain("verdict=met");
    expect(renderRuns([])).toBe("(no runs)");
    expect(renderRun(run).split("\n")).toEqual([
      "run       t1",
      "state     live",
      "agent     Desktop",
      "project   5",
      "variant   11",
      "verdict   —",
      "servers   hubspot",
      "scenario  rate_limit (latency 300ms)",
      "created   2026-09-05 12:00:00",
    ]);
    expect(renderRun({ session_token: "t2", is_live: false })).toContain("scenario  none");
    expect(renderRun({ session_token: "t2", is_live: false, goal_met: "missed" })).toContain("verdict   missed");
  });
});
