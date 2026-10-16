import { describe, expect, it } from "vitest";
import { ApiError, UsageError } from "../../core/errors.js";
import { renderAgent, tryAgent } from "../try-agent.js";
import { NOW, TRY_JSON, keeping } from "./playground.js";

const FINGERPRINT = "b".repeat(64);
const fingerprint = async () => FINGERPRINT;

// A fake ctx.api that records every request and answers from a queue.
const apiOf = (answers) => {
  const seen = [];
  const api = async (r) => {
    seen.push(r);
    return answers.shift();
  };
  return { api, seen };
};

const made = { connector: { connector_token: "tok-a", mock_id: "hubspot" }, mcp_url: "u" };

describe("try agent create", () => {
  it("mints the address with one request when no failure picture is given", async () => {
    const { api, seen } = apiOf([made]);
    const intent = tryAgent["try agent create"].args([], {});
    const data = await tryAgent["try agent create"].execute(intent, { api, fingerprint, ...keeping().ctx });
    expect(seen).toEqual([
      { method: "POST", path: "/public/try/agents", body: { mock_id: "hubspot", fingerprint: FINGERPRINT } },
    ]);
    expect(data).toBe(made);
  });

  // The backend lists nothing on the playground; `try list` finds the address here.
  it("keeps the minted address in the profile's folder", async () => {
    const { api } = apiOf([made]);
    const { ctx, kept } = keeping();
    await tryAgent["try agent create"].execute(tryAgent["try agent create"].args([], {}), { api, fingerprint, ...ctx });
    expect(kept()).toEqual([{ kind: "address", token: "tok-a", mock: "hubspot", at: NOW }]);
  });

  it("keeps the address also when its failure picture is refused", async () => {
    const answers = [made];
    const api = async (r) => {
      if (r.path.endsWith("/scenario")) throw new ApiError(422, "latency_ms too large");
      return answers.shift();
    };
    const { ctx, kept } = keeping();
    const intent = tryAgent["try agent create"].args([], { scenario: "latency", latency: "5" });
    await expect(tryAgent["try agent create"].execute(intent, { api, fingerprint, ...ctx })).rejects.toThrow("HTTP 422");
    expect(kept().map((e) => e.token)).toEqual(["tok-a"]);
  });

  it("names the minted token when it cannot keep it", async () => {
    const { api } = apiOf([made]);
    const { ctx } = keeping();
    ctx.machine.fs.rename = async () => {
      throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    };
    const intent = tryAgent["try agent create"].args([], {});
    await expect(tryAgent["try agent create"].execute(intent, { api, fingerprint, ...ctx })).rejects.toThrow(
      `minted address tok-a, but could not keep it in ${TRY_JSON}: EACCES: permission denied`
    );
  });

  it("presets the failure picture on the freshly minted address, scenario defaulting to none", async () => {
    const updated = { ...made.connector, default_scenario_rules: [{ tool: "a", scenario: "timeout" }] };
    const { api, seen } = apiOf([made, updated]);
    const intent = tryAgent["try agent create"].args(["stripe"], { rule: ["a=timeout"] });
    const data = await tryAgent["try agent create"].execute(intent, { api, fingerprint, ...keeping().ctx });
    expect(seen[0].body).toEqual({ mock_id: "stripe", fingerprint: FINGERPRINT });
    expect(seen[1]).toEqual({
      method: "POST",
      path: "/public/try/agents/tok-a/scenario",
      body: { scenario: "none", rules: [{ tool: "a", scenario: "timeout" }] },
    });
    expect(data).toEqual({ ...made, connector: updated });
  });

  it("says that this machine's run still goes and mints nothing further", async () => {
    const seen = [];
    const api = async (r) => {
      seen.push(r);
      throw new ApiError(409, { reason: "address_in_use", reopens_at: null });
    };
    const intent = tryAgent["try agent create"].args([], { scenario: "timeout" });
    await expect(tryAgent["try agent create"].execute(intent, { api, fingerprint })).rejects.toThrow(
      "HTTP 409: this machine already has a playground run on hubspot that is still going; the next one can start 24 hours after it ends (address_in_use)"
    );
    expect(seen).toHaveLength(1);
  });

  it("names a mock that is not free on the playground", async () => {
    const api = async () => {
      throw new ApiError(403, { reason: "mock_not_free", mock: "stripe" });
    };
    const intent = tryAgent["try agent create"].args(["stripe"], {});
    await expect(tryAgent["try agent create"].execute(intent, { api, fingerprint })).rejects.toThrow(
      "HTTP 403: stripe is not free on the playground; only a few mocks are, the others need an account (https://mock-d.com) (mock_not_free)"
    );
  });

  it("declares the scenario flags", () => {
    expect(tryAgent["try agent create"].flags).toEqual(["scenario", "latency", "rule", "clear-rules"]);
  });
});

describe("try agent scenario / show / close", () => {
  it("builds the scenario body from the positional and the flags", async () => {
    const entry = tryAgent["try agent scenario"];
    const intent = entry.args(["tok-a", "rate_limit"], { latency: "300", rule: ["a:1=timeout:10"] });
    const { api, seen } = apiOf([{}]);
    await entry.execute(intent, { api });
    expect(seen).toEqual([
      {
        method: "POST",
        path: "/public/try/agents/tok-a/scenario",
        body: { scenario: "rate_limit", latency_ms: 300, rules: [{ tool: "a", occurrence: 1, scenario: "timeout", latency_ms: 10 }] },
      },
    ]);
  });

  // Since an ended run keeps its address locked, a reset would free nothing: there is none.
  it("has no reset command", () => {
    expect(tryAgent["try agent reset"]).toBeUndefined();
  });

  it("requires token and scenario and rejects unknown scenarios", () => {
    const entry = tryAgent["try agent scenario"];
    expect(() => entry.args(["tok-a"], {})).toThrow(UsageError);
    expect(() => entry.args(["tok-a", "bogus"], {})).toThrow(/unknown scenario "bogus"/);
  });

  it.each([
    ["try agent show", { method: "GET", path: "/public/try/agents/tok-a" }],
    ["try agent close", { method: "POST", path: "/public/try/agents/tok-a/close", body: {} }],
  ])("%s hits its endpoint", async (name, request) => {
    const { api, seen } = apiOf([{}]);
    await tryAgent[name].execute(tryAgent[name].args(["tok-a"], {}), { api });
    expect(seen).toEqual([request]);
  });

  it("keeps a token with a slash in it to one path segment", async () => {
    const { api, seen } = apiOf([{}]);
    await tryAgent["try agent show"].execute({ token: "../x" }, { api });
    expect(seen[0].path).toBe("/public/try/agents/..%2Fx");
  });
});

describe("renderAgent", () => {
  it("shows address, run token, failure picture and state", () => {
    const text = renderAgent(
      {
        connector_token: "tok-a",
        mock_id: "hubspot",
        current_session_token: "run-1",
        default_scenario: "rate_limit",
        default_latency_ms: 300,
        default_scenario_rules: [{ tool: "a", occurrence: 1, scenario: "timeout", latency_ms: 10 }],
        closed: false,
      },
      "https://gw/try/tok-a/mcp"
    );
    expect(text.split("\n")).toEqual([
      "agent     tok-a",
      "mock      hubspot",
      "mcp_url   https://gw/try/tok-a/mcp",
      "run       run-1",
      "scenario  rate_limit (latency 300ms)",
      "rules     a:1=timeout:10",
      "state     open",
    ]);
  });

  it("shows dashes for nothing and closed for closed", () => {
    const text = renderAgent({ connector_token: "t", mock_id: "m", closed: true });
    expect(text).toContain("run       —");
    expect(text).toContain("scenario  —");
    expect(text).toContain("rules     —");
    expect(text).toContain("state     closed");
    expect(text).not.toContain("mcp_url");
  });
});
