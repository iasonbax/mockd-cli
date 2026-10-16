import { describe, expect, it } from "vitest";

import { ApiError } from "../errors.js";
import { READER_PATH, signOut } from "../sign-out.js";

const STORED = JSON.stringify({ client_id: "mk_cli", secret: "s3" });

// A store holding `text` and an API that answers the one route with `answer`; both record.
function world(text, answer = null) {
  const state = { text, removed: 0, calls: [] };
  const store = {
    read: async () => state.text,
    remove: async () => {
      state.removed += 1;
      state.text = null;
      return true;
    },
  };
  const apiWith = (bearer) => async (request) => {
    state.calls.push([bearer, request.method, request.path]);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { state, ctx: { store, apiWith } };
}

describe("signOut", () => {
  it("ends the read access on the server with the stored access, then removes it here", async () => {
    const { state, ctx } = world(STORED);
    expect(await signOut(ctx)).toEqual({ removed: true, server: "removed", error: null });
    expect(READER_PATH).toBe("/me/reader");
    expect(state.calls).toEqual([["Bearer mk_cli.s3", "DELETE", "/me/reader"]]);
    expect(state.removed).toBe(1);
  });

  it("asks nobody when nothing is stored", async () => {
    const { state, ctx } = world(null);
    expect(await signOut(ctx)).toEqual({ removed: false, server: null, error: null });
    expect(state.calls).toEqual([]);
    expect(state.removed).toBe(0);
  });

  it("counts a 401 as an access the server knows no more, and removes it here", async () => {
    const { state, ctx } = world(STORED, new ApiError(401, "Client access invalid"));
    expect(await signOut(ctx)).toEqual({ removed: true, server: "unknown", error: null });
    expect(state.removed).toBe(1);
  });

  it("counts a 403 as an access that is no read access: nothing to remove there", async () => {
    const { state, ctx } = world(STORED, new ApiError(403, "Only the read access itself"));
    expect(await signOut(ctx)).toEqual({ removed: true, server: "none", error: null });
    expect(state.removed).toBe(1);
  });

  it("removes the access here also when the server fails, and says why it stays there", async () => {
    const { state, ctx } = world(STORED, new ApiError(500, "kaputt"));
    expect(await signOut(ctx)).toEqual({ removed: true, server: "failed", error: "HTTP 500: kaputt" });
    expect(state.removed).toBe(1);

    const offline = world(STORED, new Error("cannot reach https://api.mock-d.com: getaddrinfo ENOTFOUND api.mock-d.com"));
    expect(await signOut(offline.ctx)).toMatchObject({
      removed: true,
      server: "failed",
      error: "cannot reach https://api.mock-d.com: getaddrinfo ENOTFOUND api.mock-d.com",
    });
  });

  it("removes an unreadable access without asking the server, and says so", async () => {
    const { state, ctx } = world('{"client_id": 7}');
    const result = await signOut(ctx);
    expect(result).toMatchObject({ removed: true, server: "failed" });
    expect(result.error).toMatch(/^the stored access is unreadable \(stored credential is unreadable.*\), so the server was not asked$/);
    expect(state.calls).toEqual([]);
    expect(state.removed).toBe(1);
  });
});
