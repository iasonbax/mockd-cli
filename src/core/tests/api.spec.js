import { describe, expect, it, vi } from "vitest";
import { REQUEST_TIMEOUT_MS, makeApi } from "../api.js";
import { ApiError, UsageError } from "../errors.js";

const mkRes = (text, status = 200) => ({ ok: status < 400, status, statusText: "", text: async () => text });

describe("makeApi", () => {
  it("joins base and path, trimming a trailing slash, and sends JSON bodies", async () => {
    const fetch = vi.fn(async () => mkRes('{"ok":true}'));
    const api = makeApi(fetch, "http://api.test/");
    await api({ method: "POST", path: "/x", body: { a: 1 } });
    expect(fetch).toHaveBeenCalledWith("http://api.test/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"a":1}',
      signal: expect.any(AbortSignal),
    });
  });

  it("sends no body and no content-type on GET", async () => {
    const fetch = vi.fn(async () => mkRes("[]"));
    await makeApi(fetch, "http://api.test")({ method: "GET", path: "/x" });
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: "GET", headers: undefined, body: undefined });
  });

  it("returns null for an empty body", async () => {
    const fetch = vi.fn(async () => mkRes("", 204));
    expect(await makeApi(fetch, "http://api.test")({ method: "DELETE", path: "/x" })).toBeNull();
  });

  it("refuses an address that is no web address, before any request", () => {
    expect(() => makeApi(vi.fn(), "localhost:8000")).toThrow(UsageError);
    expect(() => makeApi(vi.fn(), "localhost:8000")).toThrow('must start with https://');
  });
});

describe("makeApi and the answers that are errors", () => {
  it("throws ApiError with status and the API's detail", async () => {
    const fetch = vi.fn(async () => mkRes('{"detail":"nicht gefunden"}', 404));
    const call = makeApi(fetch, "http://api.test")({ method: "GET", path: "/x" });
    await expect(call).rejects.toBeInstanceOf(ApiError);
    await expect(call).rejects.toMatchObject({ status: 404, detail: "nicht gefunden", message: "HTTP 404: nicht gefunden" });
  });

  it("keeps a structured detail as data and shows it as JSON, not as [object Object]", async () => {
    const fetch = vi.fn(async () => mkRes('{"detail":{"reason":"run_active"}}', 409));
    const call = makeApi(fetch, "http://api.test")({ method: "POST", path: "/x", body: {} });
    await expect(call).rejects.toMatchObject({
      status: 409,
      detail: { reason: "run_active" },
      message: 'HTTP 409: {"reason":"run_active"}',
    });
  });

  it("throws ApiError with the text when an error's body is no JSON, a proxy's page", async () => {
    const fetch = vi.fn(async () => mkRes("<html>Bad Gateway</html>", 502));
    const call = makeApi(fetch, "http://api.test")({ method: "GET", path: "/x" });
    await expect(call).rejects.toBeInstanceOf(ApiError);
    await expect(call).rejects.toMatchObject({ status: 502, detail: "<html>Bad Gateway</html>" });
  });

  it("names a successful answer that is no JSON instead of failing inside the parser", async () => {
    const fetch = vi.fn(async () => mkRes("<html>captive portal</html>"));
    const call = makeApi(fetch, "http://api.test")({ method: "GET", path: "/public/guide" });
    await expect(call).rejects.toThrow("unexpected answer from GET /public/guide: not JSON");
  });
});

// A backend that cannot be reached is its own error, with the address and the reason: an
// agent must be able to tell a missing connection from a refusal.
describe("makeApi and a backend that cannot be reached", () => {
  it("names the backend and the system's reason", async () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND api.mock-d.com"), { code: "ENOTFOUND" });
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed", { cause });
    });
    const call = makeApi(fetch, "https://api.mock-d.com/")({ method: "GET", path: "/public/guide" });
    await expect(call).rejects.toThrow("cannot reach https://api.mock-d.com: getaddrinfo ENOTFOUND api.mock-d.com");
    await expect(call).rejects.not.toBeInstanceOf(ApiError);
  });

  it("names a fetch that failed without a reason", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(makeApi(fetch, "http://localhost:8000")({ method: "GET", path: "/x" })).rejects.toThrow(
      "cannot reach http://localhost:8000: fetch failed"
    );
  });

  it("gives every request a time limit and names it when it is hit", async () => {
    expect(REQUEST_TIMEOUT_MS).toBe(30_000);
    const fetch = vi.fn(async () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    });
    await expect(makeApi(fetch, "https://api.test")({ method: "GET", path: "/x" })).rejects.toThrow(
      "cannot reach https://api.test: no answer within 30 seconds"
    );
  });

  it("names a body that breaks off while it is read", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "",
      text: async () => {
        throw new TypeError("terminated");
      },
    }));
    await expect(makeApi(fetch, "https://api.test")({ method: "GET", path: "/x" })).rejects.toThrow(
      "cannot reach https://api.test: terminated"
    );
  });
});

describe("makeApi with a bearer", () => {
  it("sends the bearer to account paths and not to the guide, the playground or the catalog", async () => {
    const fetch = vi.fn(async () => mkRes("{}"));
    const api = makeApi(fetch, "https://api.test", { bearer: "Bearer mk_a.b" });
    await api({ method: "GET", path: "/me" });
    await api({ method: "GET", path: "/public/guide" });
    await api({ method: "GET", path: "/public/try/runs/x" });
    await api({ method: "GET", path: "/catalog/mocks" });
    expect(fetch.mock.calls[0][1].headers).toEqual({ authorization: "Bearer mk_a.b" });
    expect(fetch.mock.calls[1][1].headers).toBeUndefined();
    expect(fetch.mock.calls[2][1].headers).toBeUndefined();
    expect(fetch.mock.calls[3][1].headers).toBeUndefined();
  });

  it("refuses to send the secret over plain http, except to the own machine", () => {
    expect(() => makeApi(vi.fn(), "http://api.example.com", { bearer: "Bearer x" })).toThrow(UsageError);
    expect(() => makeApi(vi.fn(), "http://localhost:8000", { bearer: "Bearer x" })).not.toThrow();
    expect(() => makeApi(vi.fn(), "http://127.0.0.1:8000/", { bearer: "Bearer x" })).not.toThrow();
    expect(() => makeApi(vi.fn(), "http://api.example.com")).not.toThrow();
  });

  it("holds an answer that carries a secret to the same rule: `secure` without a bearer", () => {
    expect(() => makeApi(vi.fn(), "http://api.example.com", { secure: true })).toThrow(
      "refusing to move the client secret over http://api.example.com; use https://"
    );
    expect(() => makeApi(vi.fn(), "http://localhost:8000", { secure: true })).not.toThrow();
    expect(() => makeApi(vi.fn(), "https://api.example.com", { secure: true })).not.toThrow();
  });

  it("sends no bearer when it is only `secure`", async () => {
    const fetch = vi.fn(async () => mkRes("{}"));
    await makeApi(fetch, "https://api.test", { secure: true })({ method: "POST", path: "/public/reader/login", body: {} });
    expect(fetch.mock.calls[0][1].headers).toEqual({ "content-type": "application/json" });
  });
});
