import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../core/errors.js";
import { tryCommands } from "../try.js";
import { NOW, keeping } from "./playground.js";

const FINGERPRINT = "a".repeat(64);
const MADE = { session: { session_token: "run-1" }, mcp_url: "https://mock.test/try/tok-x/mcp" };

// A fake ctx.api records the request shape it receives and answers as a minted run; the
// fingerprint is injected, the profile's folder is in memory.
const requestOf = async (entry, intent) => {
  let seen;
  const api = async (r) => ((seen = r), MADE);
  await entry.execute(intent, { api, fingerprint: async () => FINGERPRINT, ...keeping().ctx });
  return seen;
};

describe("try run commands", () => {
  it("map each command to its endpoint", async () => {
    expect(await requestOf(tryCommands["try run create"], { mockId: "hubspot" })).toEqual({
      method: "POST",
      path: "/public/try/runs",
      body: { mock_id: "hubspot", fingerprint: FINGERPRINT },
    });
    expect(await requestOf(tryCommands["try run status"], { token: "t1" })).toEqual({ method: "GET", path: "/public/try/runs/t1" });
    expect(await requestOf(tryCommands["try run trace"], { token: "t1" })).toEqual({ method: "GET", path: "/public/try/runs/t1/traces" });
    expect(await requestOf(tryCommands["try run delete"], { token: "t1" })).toEqual({ method: "DELETE", path: "/public/try/runs/t1" });
  });

  // A token from the command line is one path segment; it cannot lead to another route.
  it("keeps a token with a slash in it to one path segment", async () => {
    expect((await requestOf(tryCommands["try run status"], { token: "../../me" })).path).toBe("/public/try/runs/..%2F..%2Fme");
    expect((await requestOf(tryCommands["try run diff"], { token: "a/b", other: "c?d" })).path).toBe("/public/try/runs/a%2Fb/diff/c%3Fd");
  });

  it("has no alias of the pre-release name `session …`", () => {
    expect(Object.keys(tryCommands).filter((name) => name.startsWith("session"))).toEqual([]);
  });

  // The backend lists nothing on the playground; `try list` finds the run here, with the
  // address it was minted on, which only this answer names.
  it("keeps the minted run with its address in the profile's folder", async () => {
    const { ctx, kept } = keeping();
    await tryCommands["try run create"].execute({ mockId: "notion" }, { api: async () => MADE, fingerprint: async () => FINGERPRINT, ...ctx });
    expect(kept()).toEqual([{ kind: "run", token: "run-1", mock: "notion", at: NOW, mcp_url: "https://mock.test/try/tok-x/mcp" }]);
  });

  it("keeps nothing when the playground refuses the run", async () => {
    const { ctx } = keeping();
    const api = async () => {
      throw new ApiError(409, { reason: "address_in_use", reopens_at: null });
    };
    await expect(tryCommands["try run create"].execute({ mockId: "hubspot" }, { api, fingerprint: async () => FINGERPRINT, ...ctx })).rejects.toThrow("HTTP 409");
    expect(ctx.machine.fs.files).toEqual({});
  });

  it("sends no request when the machine id cannot be read", async () => {
    const api = vi.fn();
    const fingerprint = async () => {
      throw new Error("cannot read this machine's id from /etc/machine-id: ENOENT");
    };
    const call = tryCommands["try run create"].execute({ mockId: "hubspot" }, { api, fingerprint });
    await expect(call).rejects.toThrow("cannot read this machine's id");
    expect(api).not.toHaveBeenCalled();
  });

  it("says from when a new run can start when this machine already has one", async () => {
    const api = async () => {
      throw new ApiError(409, { reason: "address_in_use", reopens_at: "2026-09-26T11:58:00Z" });
    };
    const call = tryCommands["try run create"].execute({ mockId: "hubspot" }, { api, fingerprint: async () => FINGERPRINT });
    await expect(call).rejects.toThrow("the next one can start at 2026-09-26T11:58:00Z (address_in_use)");
  });

  it("names a mock that is not free on the playground, and no way in the CLI cannot give", async () => {
    const api = async () => {
      throw new ApiError(403, { reason: "mock_not_free", mock: "stripe" });
    };
    const call = tryCommands["try run create"].execute({ mockId: "stripe" }, { api, fingerprint: async () => FINGERPRINT });
    await expect(call).rejects.toThrow("HTTP 403: stripe is not free on the playground; only a few mocks are, the others need an account (https://mock-d.com) (mock_not_free)");
    await expect(call).rejects.not.toThrow("mockd login");
  });

  it("renders create with a trace link when MOCKD_TRACE_BASE is set, else the trace command", () => {
    const data = { session: { session_token: "tok", mock_id: "hubspot", mock_version: "1", expires_at: null }, mcp_url: "u" };
    const withBase = tryCommands["try run create"].render(data, { MOCKD_TRACE_BASE: "https://mock-d.com/" });
    const without = tryCommands["try run create"].render(data, {});
    expect(withBase).toContain("trace     https://mock-d.com/try?token=tok");
    expect(without).toContain("trace     mockd try run trace tok");
    expect(without).toContain("expires   —");
  });

  it("renders the trace as one line per call, scenario in brackets", () => {
    const render = tryCommands["try run trace"].render;
    expect(render([])).toBe("(no calls yet)");
    expect(render([{ sequence: 1, tool_name: "a", status: "ok", latency_ms: 12.4, scenario: "none" }])).toBe("#1 a  ok  12ms");
    expect(render([{ sequence: 2, tool_name: "b", status: "error", latency_ms: 3, scenario: "rate_limit" }])).toBe("#2 b  error  3ms [rate_limit]");
  });

  it("renders delete as a verdict", () => {
    expect(tryCommands["try run delete"].render({ deleted: true })).toBe("deleted");
    expect(tryCommands["try run delete"].render({ deleted: false })).toContain("not deleted");
  });
});

describe("try run changes / diff", () => {
  it("map to their endpoints", async () => {
    expect(await requestOf(tryCommands["try run changes"], { token: "t1" })).toEqual({ method: "GET", path: "/public/try/runs/t1/changes" });
    expect(await requestOf(tryCommands["try run diff"], { token: "t1", other: "t2" })).toEqual({ method: "GET", path: "/public/try/runs/t1/diff/t2" });
  });

  it("diff needs both tokens", () => {
    expect(() => tryCommands["try run diff"].args(["t1"], {})).toThrow("needs a <token> and an <other>");
  });

  it("renders changes as a summary plus one line per record", () => {
    const render = tryCommands["try run changes"].render;
    expect(render({ added: 0, changed: 0, removed: 0, materialized: false, records: [], truncated: false })).toBe("0 added · 0 changed · 0 removed (no calls yet)");
    const text = render({
      added: 1, changed: 1, removed: 0, materialized: true, truncated: true,
      records: [
        { op: "added", collection: "deals", id: "d-1", fields: [] },
        { op: "changed", collection: "contacts", id: "c-7", fields: ["email", "phone"] },
      ],
    });
    expect(text.split("\n")).toEqual([
      "1 added · 1 changed · 0 removed",
      "added    deals d-1",
      "changed  contacts c-7  [email, phone]",
      "…",
    ]);
  });

  it("renders a diff step by step with a mark per op", () => {
    const render = tryCommands["try run diff"].render;
    expect(render({ comparable: false, a_token: "a", b_token: "b", steps: [] })).toBe("not comparable: a vs b");
    expect(render({ comparable: true, steps: [] })).toBe("(no steps)");
    const text = render({
      comparable: true,
      steps: [
        { op: "equal", a: { tool_name: "search" }, b: { tool_name: "search" } },
        { op: "changed", a: { tool_name: "update", status: "ok" }, b: { tool_name: "update", status: "error" } },
        { op: "added", b: { tool_name: "notes" } },
        { op: "removed", a: { tool_name: "tickets" } },
      ],
    });
    expect(text.split("\n")).toEqual(["= search", "~ update  ok → error", "+ notes", "- tickets"]);
  });
});
