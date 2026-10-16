import { describe, expect, it } from "vitest";
import { ApiError } from "../../core/errors.js";
import { account } from "../account.js";

const me = { user_id: "7", name: "Ada", email: "ada@example.test", provider: "client", tenant: { name: "Analytical" } };

const CODE = {
  device_code: "dev-1",
  user_code: "BCDF-GHJK",
  verification_url: "https://app.example/confirm?code=BCDF-GHJK",
  interval: 3,
  expires_in: 600,
};

// A world for the three commands: the sign-in routes answer from a script (after the code),
// `/me` and the sign-out go through `apiWith` and record the bearer they carry.
function world({ answer = me, stored = null, tokens = [] } = {}) {
  const state = { stored, bearers: [], notes: [], opened: [] };
  const script = [CODE, ...tokens];
  const ctx = {
    apiWith: (bearer) => async (r) => {
      state.bearers.push([bearer, r]);
      if (answer instanceof Error) throw answer;
      return answer;
    },
    secureApi: () => async () => {
      const next = script.length > 1 ? script.shift() : script[0];
      if (next instanceof Error) throw next;
      return next;
    },
    store: {
      kind: "file",
      read: async () => state.stored,
      write: async (t) => (state.stored = t),
      remove: async () => {
        const had = state.stored !== null;
        state.stored = null;
        return had;
      },
    },
    machine: { name: async () => "mac-1", platform: "linux", user: () => "ada", sleep: async () => {} },
    browser: { open: async (url) => void state.opened.push(url) },
    note: (line) => state.notes.push(line),
  };
  return { ctx, state };
}

const APPROVED = { status: "approved", client_id: "mk_new", secret: "fresh" };

describe("login", () => {
  it("takes no flag and no argument: the browser is the only way in", () => {
    expect(account.login.args).toBeUndefined();
    expect(account.login.flags).toBeUndefined();
    expect(account.login.auth).toBeUndefined();
  });

  it("puts the code and the link on stderr, stores the access on approval and names who it is", async () => {
    const { ctx, state } = world({ tokens: [{ status: "pending" }, APPROVED] });
    const data = await account.login.execute({}, ctx);
    expect(state.notes).toEqual([
      `Confirm the code BCDF-GHJK in the browser: ${CODE.verification_url}`,
      "Waiting for the confirmation (Ctrl-C stops) …",
    ]);
    expect(state.opened).toEqual([CODE.verification_url]);
    expect(JSON.parse(state.stored)).toEqual({ client_id: "mk_new", secret: "fresh" });
    expect(state.bearers).toEqual([["Bearer mk_new.fresh", { method: "GET", path: "/me" }]]);
    expect(data).toMatchObject({ client_id: "mk_new", stored_in: "file", email: "ada@example.test" });
    expect(account.login.render(data)).toBe(
      "logged in as Ada <ada@example.test> with read access · client mk_new · stored in file"
    );
  });

  it("says a declined sign-in and an expired code, and stores nothing", async () => {
    const declined = world({ tokens: [new ApiError(403, "abgelehnt")] });
    await expect(account.login.execute({}, declined.ctx)).rejects.toThrow("the sign-in was declined in the browser");
    expect(declined.state.stored).toBeNull();

    const expired = world({ tokens: [new ApiError(404, "abgelaufen")] });
    await expect(account.login.execute({}, expired.ctx)).rejects.toThrow(
      "the code expired before it was confirmed; run `mockd login` again"
    );
    expect(expired.state.stored).toBeNull();
  });

  it("names a browser that did not open and keeps waiting", async () => {
    const { ctx, state } = world({ tokens: [APPROVED] });
    ctx.browser.open = async () => {
      throw new Error("xdg-open failed (3): no browser");
    };
    await account.login.execute({}, ctx);
    expect(state.notes).toContain("could not open the browser (xdg-open failed (3): no browser); open the link yourself");
    expect(JSON.parse(state.stored).client_id).toBe("mk_new");
  });

  it("keeps the access when the name lookup fails after the approval: the browser hands it out once", async () => {
    const { ctx, state } = world({ answer: new ApiError(503, "wartet"), tokens: [APPROVED] });
    await expect(account.login.execute({}, ctx)).rejects.toThrow("HTTP 503: wartet");
    expect(JSON.parse(state.stored).client_id).toBe("mk_new");
  });
});

describe("whoami", () => {
  it("needs the credential, asks /me and renders who it is", async () => {
    expect(account.whoami.auth).toBe(true);
    let seen;
    await account.whoami.execute({}, { api: async (r) => (seen = r, me) });
    expect(seen).toEqual({ method: "GET", path: "/me" });
    expect(account.whoami.render(me)).toBe("Ada <ada@example.test> · via client · tenant Analytical");
  });

  it("names the profile when one is set", async () => {
    const data = await account.whoami.execute({}, { api: async () => me, profile: "dev" });
    expect(data.profile).toBe("dev");
    expect(account.whoami.render(data)).toBe("Ada <ada@example.test> · via client · tenant Analytical · profile dev");
  });
});

describe("logout", () => {
  const STORED = JSON.stringify({ client_id: "mk_cli", secret: "s" });

  it("ends the access on the server with the stored access, then removes it here", async () => {
    const { ctx, state } = world({ stored: STORED, answer: null });
    const done = { removed: true, stored_in: "file", server: "removed" };
    expect(await account.logout.execute({}, ctx)).toEqual(done);
    expect(state.bearers).toEqual([["Bearer mk_cli.s", { method: "DELETE", path: "/me/reader" }]]);
    expect(state.stored).toBeNull();
    expect(account.logout.render(done)).toBe("logged out (file); the access on the server is removed too");
  });

  it("asks nobody when nothing is stored", async () => {
    const { ctx, state } = world({ stored: null });
    const data = await account.logout.execute({}, ctx);
    expect(data).toEqual({ removed: false, stored_in: "file", server: null });
    expect(state.bearers).toEqual([]);
    expect(account.logout.render(data)).toBe("nothing stored");
  });

  it("takes a 401 for an access the server removed already", async () => {
    const { ctx } = world({ stored: STORED, answer: new ApiError(401, "Client access invalid") });
    const data = await account.logout.execute({}, ctx);
    expect(data).toMatchObject({ removed: true, server: "unknown" });
    expect(account.logout.render(data)).toBe("logged out (file); the server knew this access no more");
  });

  it("takes a 403 for an access that is no read access", async () => {
    const { ctx } = world({ stored: STORED, answer: new ApiError(403, "Only the read access itself") });
    const data = await account.logout.execute({}, ctx);
    expect(account.logout.render(data)).toBe("logged out (file); the stored access was no read access, the server had none to remove");
  });

  it("fails when the server does, after removing the access here, and says where the access stays", async () => {
    const { ctx, state } = world({ stored: STORED, answer: new ApiError(503, "wartet") });
    await expect(account.logout.execute({}, ctx)).rejects.toThrow(
      "logged out here (file), but the access on the server stays: HTTP 503: wartet. " +
        "The person who owns the account can remove it in the web app"
    );
    expect(state.stored).toBeNull();
  });
});
