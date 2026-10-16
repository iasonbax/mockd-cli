import { describe, expect, it, vi } from "vitest";

import { awaitApproval, checkCode, requestCode, signInInBrowser, SLOW_DOWN_SECONDS } from "../device-login.js";
import { ApiError, UsageError } from "../errors.js";

const CODE = {
  device_code: "dev-1",
  user_code: "BCDF-GHJK",
  verification_url: "https://app.example/confirm?code=BCDF-GHJK",
  interval: 3,
  expires_in: 600,
};

const PENDING = { status: "pending" };
const APPROVED = { status: "approved", client_id: "mk_new", secret: "fresh" };

// An API that answers from a script, one entry per request; an ApiError entry is thrown, the
// way `makeApi` throws a 4xx. The last entry repeats.
function scripted(...answers) {
  const calls = [];
  const api = async (request) => {
    calls.push(request);
    const answer = answers.length > 1 ? answers.shift() : answers[0];
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { api, calls };
}

// A sleep that records the pauses and returns at once.
function pauses() {
  const slept = [];
  return { slept, sleep: async (ms) => void slept.push(ms) };
}

describe("requestCode", () => {
  it("asks the reader's door for a code with this machine's name, its system and the user", async () => {
    const { api, calls } = scripted(CODE);
    expect(await requestCode(api, { machine: "mac-1", os: "darwin", user: "ada" })).toEqual(CODE);
    expect(calls).toEqual([
      { method: "POST", path: "/public/reader/login", body: { machine: "mac-1", os: "darwin", os_user: "ada" } },
    ]);
  });

  it("refuses an answer without a usable interval or lifetime instead of polling without pause", async () => {
    const { api } = scripted({ ...CODE, interval: undefined, expires_in: 0 });
    await expect(requestCode(api, { machine: "m", os: "linux", user: "ada" })).rejects.toThrow(
      "unexpected answer from POST /public/reader/login: no valid interval, expires_in"
    );
  });

  // The link is opened on this machine: it has to be a web address, whatever the server says.
  it.each(["file:///etc/passwd", "javascript:alert(1)", "-a Calculator", "", undefined])(
    "refuses %j as the link to open",
    async (verification_url) => {
      const { api } = scripted({ ...CODE, verification_url });
      await expect(requestCode(api, { machine: "m", os: "linux", user: "ada" })).rejects.toThrow("no valid verification_url");
    }
  );

  it("takes http for a local backend", async () => {
    const { api } = scripted({ ...CODE, verification_url: "http://localhost:3000/confirm?code=X" });
    await expect(requestCode(api, { machine: "m", os: "linux", user: "ada" })).resolves.toMatchObject({ user_code: "BCDF-GHJK" });
  });
});

describe("checkCode", () => {
  it("reads 202 pending and 200 approved from the body", async () => {
    expect(await checkCode(scripted(PENDING).api, "dev-1")).toEqual({ status: "pending" });
    expect(await checkCode(scripted(APPROVED).api, "dev-1")).toEqual({
      status: "approved",
      credential: { clientId: "mk_new", secret: "fresh" },
    });
  });

  it("asks the reader's token route with the device code, without any credential", async () => {
    const { api, calls } = scripted(PENDING);
    await checkCode(api, "dev-1");
    expect(calls).toEqual([{ method: "POST", path: "/public/reader/login/token", body: { device_code: "dev-1" } }]);
  });

  it("reads 429 as slow down, 403 as declined, 404 as expired", async () => {
    expect(await checkCode(scripted(new ApiError(429, "zu schnell")).api, "d")).toEqual({ status: "slow_down" });
    expect(await checkCode(scripted(new ApiError(403, "abgelehnt")).api, "d")).toEqual({ status: "denied" });
    expect(await checkCode(scripted(new ApiError(404, "abgelaufen")).api, "d")).toEqual({ status: "expired" });
  });

  it("passes every other failure on as it is", async () => {
    await expect(checkCode(scripted(new ApiError(500, "kaputt")).api, "d")).rejects.toThrow("HTTP 500: kaputt");
    await expect(checkCode(scripted(new Error("cannot reach https://api.test: fetch failed")).api, "d")).rejects.toThrow("cannot reach");
  });

  it("refuses an answer it does not know without echoing it, and a bad pair as a runtime error", async () => {
    const odd = checkCode(scripted({ status: "maybe", secret: "do-not-print" }).api, "d");
    await expect(odd).rejects.toThrow("unexpected answer from POST /public/reader/login/token (status maybe)");
    await expect(checkCode(scripted({ status: "maybe", secret: "do-not-print" }).api, "d")).rejects.not.toThrow("do-not-print");

    const bad = checkCode(scripted({ status: "approved", client_id: "nope", secret: "s" }).api, "d");
    await expect(bad).rejects.toThrow('a client id starts with "mk_"');
    await expect(checkCode(scripted({ status: "approved", client_id: "nope", secret: "s" }).api, "d")).rejects.not.toBeInstanceOf(UsageError);
  });
});

describe("awaitApproval", () => {
  it("asks every interval until the approval: pending, pending, approved", async () => {
    const { api, calls } = scripted(PENDING, PENDING, APPROVED);
    const { slept, sleep } = pauses();
    const outcome = await awaitApproval(api, CODE, { sleep });
    expect(outcome).toEqual({ status: "approved", credential: { clientId: "mk_new", secret: "fresh" } });
    expect(calls).toHaveLength(3);
    expect(slept).toEqual([3000, 3000, 3000]);
  });

  it("slows down by five seconds with every 429", async () => {
    const { api } = scripted(new ApiError(429, "zu schnell"), PENDING, new ApiError(429, "zu schnell"), APPROVED);
    const { slept, sleep } = pauses();
    expect((await awaitApproval(api, CODE, { sleep })).status).toBe("approved");
    expect(SLOW_DOWN_SECONDS).toBe(5);
    expect(slept).toEqual([3000, 8000, 8000, 13000]);
  });

  it("ends with declined on 403 and with expired on 404", async () => {
    const { sleep } = pauses();
    expect(await awaitApproval(scripted(PENDING, new ApiError(403, "nein")).api, CODE, { sleep })).toEqual({ status: "denied" });
    expect(await awaitApproval(scripted(new ApiError(404, "weg")).api, CODE, { sleep })).toEqual({ status: "expired" });
  });

  it("gives up once the code's lifetime is over, even if the server keeps saying pending", async () => {
    const { api, calls } = scripted(PENDING);
    const { sleep } = pauses();
    expect(await awaitApproval(api, { ...CODE, interval: 3, expires_in: 9 }, { sleep })).toEqual({ status: "expired" });
    expect(calls).toHaveLength(3);
  });
});

describe("signInInBrowser", () => {
  // A context as cli.js builds it, reduced to what the sign-in touches.
  function context(...tokenAnswers) {
    const { api, calls } = scripted(CODE, ...tokenAnswers);
    const stored = [];
    const opened = [];
    const ctx = {
      secureApi: () => api,
      machine: { name: async () => "DESKTOP-7Q2K", platform: "win32", user: () => "ada", sleep: async () => {} },
      browser: { open: async (url) => void opened.push(url) },
      store: { write: async (text) => void stored.push(text) },
    };
    return { ctx, calls, stored, opened };
  }

  const quiet = { onCode: () => {}, onBrowserError: () => {} };

  it("shows the code, opens the page, waits, and stores the access on approval", async () => {
    const { ctx, calls, stored, opened } = context(PENDING, APPROVED);
    const shown = [];
    const outcome = await signInInBrowser(ctx, { onCode: (code) => shown.push(code.user_code), onBrowserError: vi.fn() });
    expect(outcome.status).toBe("approved");
    expect(shown).toEqual(["BCDF-GHJK"]);
    expect(opened).toEqual([CODE.verification_url]);
    expect(calls[0].body).toEqual({ machine: "DESKTOP-7Q2K", os: "windows", os_user: "ada" });
    expect(stored.map((t) => JSON.parse(t))).toEqual([{ client_id: "mk_new", secret: "fresh" }]);
  });

  it("stores nothing when the sign-in is declined", async () => {
    const { ctx, stored } = context(new ApiError(403, "nein"));
    expect((await signInInBrowser(ctx, quiet)).status).toBe("denied");
    expect(stored).toEqual([]);
  });

  it("reports a browser that does not open and keeps waiting for the link on screen", async () => {
    const { ctx } = context(PENDING, APPROVED);
    ctx.browser.open = async () => {
      throw new Error("xdg-open failed (3): no browser");
    };
    const onBrowserError = vi.fn();
    expect((await signInInBrowser(ctx, { onCode: () => {}, onBrowserError })).status).toBe("approved");
    expect(onBrowserError).toHaveBeenCalledWith(new Error("xdg-open failed (3): no browser"));
  });

  // The API's `MachineName` takes 80 characters; a longer name is cut, not refused.
  it("sends the machine's name as the system shows it, cut to what the API takes", async () => {
    const { ctx, calls } = context(APPROVED);
    ctx.machine.name = async () => "M".repeat(90);
    await signInInBrowser(ctx, quiet);
    expect(calls[0].body.machine).toBe("M".repeat(80));
  });

  // The user as the API takes it (os_user, 1–64 characters, no control character).
  it("sends the user mockd runs as, without control characters, cut to what the API takes", async () => {
    const { ctx, calls } = context(APPROVED);
    ctx.machine.user = () => ` a\u0007${"d".repeat(70)} `;
    await signInInBrowser(ctx, quiet);
    expect(calls[0].body.os_user).toBe(`a${"d".repeat(63)}`);
  });

  it("asks for no code when the user has no name, or none can be read", async () => {
    for (const user of [() => " \u0000 ", () => { throw new Error("ENOENT: no such user"); }]) {
      const { ctx, calls } = context(APPROVED);
      ctx.machine.user = user;
      await expect(signInInBrowser(ctx, quiet)).rejects.toThrow();
      expect(calls).toEqual([]);
    }
  });

  it("asks for no code when the machine's name cannot be read", async () => {
    const { ctx, calls } = context(APPROVED);
    ctx.machine.name = async () => Promise.reject(new Error("cannot read this machine's name from COMPUTERNAME: it is not set"));
    await expect(signInInBrowser(ctx, quiet)).rejects.toThrow("cannot read this machine's name from COMPUTERNAME");
    expect(calls).toEqual([]);
  });
});
