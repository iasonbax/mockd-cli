import { describe, expect, it } from "vitest";

import { ApiError } from "../../core/errors.js";
import { tryList } from "../try-list.js";
import { keep, playgroundMemory } from "../try-memory.js";
import { DIR, NOW, TRY_JSON, keeping } from "./playground.js";

const list = tryList["try list"];

const address = { kind: "address", token: "tok-a", mock: "hubspot", at: "2026-09-29T07:00:00.000Z" };
const run = { kind: "run", token: "run-1", mock: "notion", at: "2026-09-29T07:30:00.000Z", mcp_url: "https://mock.test/try/tok-x/mcp" };
const connector = { connector_token: "tok-a", mock_id: "hubspot", closed: false, current_session_token: "run-9", default_scenario: "rate_limit" };
const session = { session_token: "run-1", mock_id: "notion", is_live: true, expires_at: "2026-09-30T07:30:00Z" };

// The playground's read routes over what `answers` holds; a token it does not hold is gone (404).
function world(entries, answers) {
  const { ctx, kept } = keeping({ [TRY_JSON]: JSON.stringify(entries) });
  const seen = [];
  ctx.api = async (r) => {
    seen.push(r.path);
    if (!(r.path in answers)) throw new ApiError(404, "Adresse nicht gefunden");
    const answer = answers[r.path];
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { ctx, kept, seen };
}

const FRESH = {
  "/public/try/agents/tok-a": { connector, mcp_url: "https://mock.test/try/tok-a/mcp", config_snippet: {} },
  "/public/try/runs/run-1": session,
};

describe("try list", () => {
  it("reads each kept token fresh, the address as try agent show does, the run as try run status does, newest first", async () => {
    const { ctx, seen } = world([address, run], FRESH);
    expect(await list.execute({}, ctx)).toEqual([
      { ...run, run: session },
      { ...address, connector, mcp_url: "https://mock.test/try/tok-a/mcp", config_snippet: {} },
    ]);
    expect(seen.sort()).toEqual(["/public/try/agents/tok-a", "/public/try/runs/run-1"]);
  });

  it("drops what the API no longer knows and forgets it in the file", async () => {
    const { ctx, kept } = world([address, run], { "/public/try/runs/run-1": session });
    expect((await list.execute({}, ctx)).map((item) => item.token)).toEqual(["run-1"]);
    expect(kept()).toEqual([run]);
  });

  it("fails on every other refusal and keeps the file as it was", async () => {
    const { ctx, kept } = world([address, run], { ...FRESH, "/public/try/runs/run-1": new ApiError(503, "kurz weg") });
    await expect(list.execute({}, ctx)).rejects.toThrow("HTTP 503: kurz weg");
    expect(kept()).toEqual([address, run]);
  });

  it("is empty before anything was minted here, and asks nobody", async () => {
    const { ctx } = keeping();
    ctx.api = async () => {
      throw new Error("no request expected");
    };
    expect(await list.execute({}, ctx)).toEqual([]);
    expect(list.render([])).toBe("(nothing minted on the playground here yet: mockd try agent create)");
  });

  it("renders one line per address and run", async () => {
    const { ctx } = world([address, run], FRESH);
    const closed = { ...connector, closed: true, reopens_at: "2026-09-30T07:00:00Z", current_session_token: null, default_scenario: null };
    const items = await list.execute({}, ctx);
    expect(list.render(items).split("\n")).toEqual([
      "run      notion       run-1  live · expires 2026-09-30 07:30:00",
      "address  hubspot      tok-a  open · run run-9 · scenario rate_limit",
    ]);
    expect(list.render([{ ...items[1], connector: closed }])).toBe("address  hubspot      tok-a  closed until 2026-09-30 07:00:00 · run — · scenario —");
  });
});

describe("the playground's file", () => {
  it("keeps an entry with the moment it was minted, after those kept before", async () => {
    const { ctx, kept } = keeping({ [TRY_JSON]: JSON.stringify([address]) });
    await keep(ctx, { kind: "run", token: "run-2", mock: "stripe", mcp_url: "https://mock.test/try/tok-y/mcp" });
    expect(kept()).toEqual([address, { kind: "run", token: "run-2", mock: "stripe", mcp_url: "https://mock.test/try/tok-y/mcp", at: NOW }]);
  });

  it("names a form mockd did not write, with the way out", async () => {
    const { ctx } = keeping({ [TRY_JSON]: JSON.stringify([{ kind: "address", token: "t" }]) });
    await expect(playgroundMemory(ctx.machine.fs, DIR).read()).rejects.toThrow(
      `${TRY_JSON} holds no playground tokens in the form mockd writes; remove it, the playground's addresses and runs start anew`
    );
  });

  it("names a file that is no JSON", async () => {
    const { ctx } = keeping({ [TRY_JSON]: "{" });
    await expect(playgroundMemory(ctx.machine.fs, DIR).read()).rejects.toThrow(`${TRY_JSON} is no JSON`);
  });

  it("writes the file for the user alone, whole, under a name of its own first", async () => {
    const writes = [];
    const { ctx } = keeping();
    const { fs } = ctx.machine;
    const write = fs.writeFile;
    fs.writeFile = async (p, t, options) => (writes.push([p, options]), write(p, t));
    await playgroundMemory(fs, DIR).remember(address);
    expect(writes).toHaveLength(1);
    expect(writes[0][0].startsWith(`${TRY_JSON}.`)).toBe(true);
    expect(writes[0][0]).toMatch(/\.[0-9a-f-]+\.tmp$/);
    expect(writes[0][1]).toEqual({ encoding: "utf8", mode: 0o600 });
    expect(JSON.parse(fs.files[TRY_JSON])).toEqual([address]);
  });
});
