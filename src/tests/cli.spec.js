import { describe, expect, it, vi } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { UsageError, VERSION, resolve, run } from "../cli.js";

const mkRes = (obj, status = 200) => ({
  ok: status < 400,
  status,
  statusText: "",
  text: async () => JSON.stringify(obj),
});

const silent = { out: () => {}, err: () => {} };

// A file system in memory: the machine id the playground reads, and everything the CLI keeps.
const memfs = (files = {}) => ({
  files,
  readFile: async (p) => {
    if (!(p in files)) throw Object.assign(new Error(`ENOENT: no such file, open '${p}'`), { code: "ENOENT" });
    return files[p];
  },
  writeFile: async (p, t) => {
    files[p] = t;
  },
  stat: async (p) => {
    if (!(p in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return { mode: 0o600 };
  },
  chmod: async () => {},
  mkdir: async () => {},
  rename: async (from, to) => {
    files[to] = files[from];
    delete files[from];
  },
  unlink: async (p) => {
    if (!(p in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    delete files[p];
  },
});

// A Linux machine with a readable machine id and no commands: minting on the playground reads
// the id from here, never from the machine the tests run on.
const MACHINE_ID = "0123456789abcdef0123456789abcdef";
const linux = (files = {}) => ({
  platform: "linux",
  arch: "x64",
  home: "/home/me",
  user: () => "ada",
  fs: memfs({ "/etc/machine-id": `${MACHINE_ID}\n`, ...files }),
  run: async () => {
    throw new Error("no command may run here");
  },
});

describe("resolve", () => {
  it("names the command and defaults mock_id to hubspot on create", () => {
    expect(resolve(["try", "run", "create"], {})).toMatchObject({ name: "try run create", mockId: "hubspot" });
  });

  it("takes an explicit mock id", () => {
    expect(resolve(["try", "run", "create", "stripe"], {}).mockId).toBe("stripe");
  });

  it("requires a token for status/trace/delete and names the command in the complaint", () => {
    for (const sub of ["status", "trace", "delete"])
      expect(() => resolve(["try", "run", sub], {})).toThrow(`try run ${sub} needs a <token>`);
  });

  it("api precedence: flag > env > default", () => {
    expect(resolve(["catalog", "list", "--api", "http://flag"], {}).api).toBe("http://flag");
    expect(resolve(["catalog", "list"], { MOCKD_API_URL: "http://env" }).api).toBe("http://env");
    expect(resolve(["catalog", "list"], {}).api).toBe("https://api.mock-d.com");
  });

  it("rejects unknown flags", () => {
    expect(() => resolve(["catalog", "list", "--bogus"], {})).toThrow(UsageError);
  });

  // The typed-in client access is gone: the only way to a read access is the browser.
  it("knows no --client-id, no --secret-stdin and no --browser", () => {
    for (const flag of ["--client-id", "--secret-stdin", "--browser"]) {
      expect(() => resolve(["login", flag, "x"], {}), flag).toThrow(UsageError);
    }
  });

  it("knows no command that writes, connects a client or runs a background service", () => {
    for (const argv of [["connect"], ["watch"], ["setup"], ["status"], ["logs"], ["service"], ["agents", "list"], ["servers", "list"], ["projects", "list"], ["goals", "list"], ["variants", "list"], ["jobs", "list"], ["changes", "list"], ["runs", "judge", "t", "met"], ["session", "create"]]) {
      expect(() => resolve(argv, {}), argv.join(" ")).toThrow("Unknown command");
    }
  });

  // A failure picture belongs on the ADDRESS, before the run (`try agent create --scenario`). A
  // run command that silently dropped `--scenario` would be half-work, so it is a usage error.
  it("refuses the scenario flags on a run command", () => {
    expect(() => resolve(["try", "run", "create", "--scenario", "rate_limit"], {})).toThrow(
      "--scenario is not an option of try run create"
    );
    expect(() => resolve(["catalog", "list", "--rule", "a=timeout"], {})).toThrow(UsageError);
  });

  it("collects repeated --rule flags for the agent commands", () => {
    const intent = resolve(["try", "agent", "create", "--rule", "a=timeout", "--rule", "b:2=empty"], {});
    expect(intent.preset.rules).toEqual([
      { tool: "a", scenario: "timeout" },
      { tool: "b", occurrence: 2, scenario: "empty" },
    ]);
  });

  it("refuses a flag of another command by name", () => {
    expect(() => resolve(["runs", "list", "--scenario", "none"], {})).toThrow("--scenario is not an option of runs list");
    expect(resolve(["runs", "list", "--live", "--project", "5"], {})).toMatchObject({ live: true, project: "5" });
  });
});

describe("run", () => {
  // An installed file has no backend on localhost; a local one is named explicitly.
  it("talks to https://api.mock-d.com unless MOCKD_API_URL or --api names another backend", async () => {
    const fetch = vi.fn(async () => mkRes([]));
    expect(await run(["catalog", "list"], { fetch, env: {}, ...silent })).toBe(0);
    expect(await run(["catalog", "list"], { fetch, env: { MOCKD_API_URL: "http://localhost:8000" }, ...silent })).toBe(0);
    expect(fetch.mock.calls.map(([url]) => new URL(url).origin)).toEqual(["https://api.mock-d.com", "http://localhost:8000"]);
  });

  it("prints the version of the package on --version and -v, exit 0, without a request", async () => {
    const out = [];
    const fetch = vi.fn();
    const deps = { fetch, env: {}, out: (s) => out.push(s), err: () => {} };
    expect(await run(["--version"], deps)).toBe(0);
    expect(await run(["-v"], deps)).toBe(0);
    expect(out).toEqual([pkg.version, pkg.version]);
    expect(VERSION).toBe(pkg.version);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows the usage without a command, exit 2, and on --help, exit 0, without a request", async () => {
    const out = [];
    const fetch = vi.fn();
    const deps = { fetch, env: {}, out: (s) => out.push(s), err: () => {} };
    expect(await run([], deps)).toBe(2);
    expect(await run(["--help"], deps)).toBe(0);
    expect(await run(["-h"], deps)).toBe(0);
    expect(out).toHaveLength(3);
    expect(out.every((text) => text.includes("mockd login"))).toBe(true);
    expect(out[0]).toContain("mockd guide [topic]");
    expect(out[0]).toContain("mockd try run create [mock_id]");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("creates a playground run with a single call and returns 0", async () => {
    const urls = [];
    const fetch = vi.fn(async (url) => {
      urls.push(url);
      return mkRes({ session: { session_token: "tok_1" }, mcp_url: "u" });
    });
    const code = await run(["try", "run", "create", "--json"], { fetch, env: {}, ...linux(), ...silent });
    expect(code).toBe(0);
    expect(urls).toEqual(["https://api.mock-d.com/public/try/runs"]);
  });

  it("sends the same machine fingerprint on every mint, as 64 lowercase hex characters", async () => {
    const bodies = [];
    const fetch = vi.fn(async (url, init) => {
      bodies.push(JSON.parse(init.body));
      return url.endsWith("/agents")
        ? mkRes({ connector: { connector_token: "tok-a", mock_id: "hubspot" }, mcp_url: "u" })
        : mkRes({ session: { session_token: "tok_1" }, mcp_url: "u" });
    });
    const world = linux();
    expect(await run(["try", "run", "create", "--json"], { fetch, env: {}, ...world, ...silent })).toBe(0);
    expect(await run(["try", "agent", "create", "stripe", "--json"], { fetch, env: {}, ...world, ...silent })).toBe(0);
    expect(bodies[0]).toEqual({ mock_id: "hubspot", fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(bodies[1]).toEqual({ mock_id: "stripe", fingerprint: bodies[0].fingerprint });
    expect(JSON.stringify(bodies)).not.toContain(MACHINE_ID);
  });

  it("fails with exit 1 and no request when the machine id cannot be read", async () => {
    const err = [];
    const fetch = vi.fn();
    const world = { ...linux(), fs: memfs() };
    expect(await run(["try", "agent", "create"], { fetch, env: {}, ...world, out: () => {}, err: (s) => err.push(s) })).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(err.join()).toContain("cannot read this machine's id from /etc/machine-id: ENOENT");
  });

  it("shows a refusal of the playground as its sentence, exit 1", async () => {
    const err = [];
    const fetch = vi.fn(async () =>
      mkRes({ detail: { reason: "address_in_use", reopens_at: "2026-09-26T11:58:00Z", detail: "A run from this browser is already in progress." } }, 409)
    );
    expect(await run(["try", "run", "create"], { fetch, env: {}, ...linux(), out: () => {}, err: (s) => err.push(s) })).toBe(1);
    expect(err).toEqual([
      "HTTP 409: this machine already had a playground run on hubspot; the next one can start at 2026-09-26T11:58:00Z (address_in_use)",
    ]);
  });

  it("shows a structured detail it does not know as JSON", async () => {
    const err = [];
    const fetch = vi.fn(async () => mkRes({ detail: { reason: "something_new" } }, 409));
    const code = await run(["try", "run", "status", "t1"], { fetch, env: {}, out: () => {}, err: (s) => err.push(s) });
    expect(code).toBe(1);
    expect(err).toEqual(['HTTP 409: {"reason":"something_new"}']);
  });

  it("mints an address and presets its failure picture in two calls", async () => {
    const calls = [];
    const fetch = vi.fn(async (url, init) => {
      calls.push([url, init.method, init.body && JSON.parse(init.body)]);
      return calls.length === 1
        ? mkRes({ connector: { connector_token: "tok-a", mock_id: "hubspot" }, mcp_url: "u" })
        : mkRes({ connector_token: "tok-a", mock_id: "hubspot", default_scenario: "none" });
    });
    const out = [];
    const code = await run(["try", "agent", "create", "--rule", "a:1=timeout:10", "--json"], {
      fetch, env: {}, ...linux(), out: (s) => out.push(s), err: () => {},
    });
    expect(code).toBe(0);
    expect(calls).toEqual([
      ["https://api.mock-d.com/public/try/agents", "POST", { mock_id: "hubspot", fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) }],
      ["https://api.mock-d.com/public/try/agents/tok-a/scenario", "POST", { scenario: "none", rules: [{ tool: "a", occurrence: 1, scenario: "timeout", latency_ms: 10 }] }],
    ]);
    expect(JSON.parse(out[0]).connector.default_scenario).toBe("none");
  });

  // What a command minted stands in `try list`, read fresh.
  it("lists what try agent create minted on this machine, read fresh", async () => {
    const world = linux();
    const connector = { connector_token: "tok-a", mock_id: "stripe", closed: false, current_session_token: null, default_scenario: null };
    const fetch = vi.fn(async (url, init) =>
      init.method === "POST" ? mkRes({ connector, mcp_url: "u" }) : mkRes({ connector, mcp_url: "u", config_snippet: {} })
    );
    expect(await run(["try", "agent", "create", "stripe", "--json"], { fetch, env: {}, ...world, ...silent })).toBe(0);
    expect(JSON.parse(world.fs.files["/home/me/.config/mockd/try.json"])).toEqual([{ kind: "address", token: "tok-a", mock: "stripe", at: expect.any(String) }]);
    const out = [];
    expect(await run(["try", "list"], { fetch, env: {}, ...world, out: (s) => out.push(s), err: () => {} })).toBe(0);
    expect(out).toEqual(["address  stripe       tok-a  open · run — · scenario —"]);
    expect(fetch.mock.calls.at(-1)[0]).toBe("https://api.mock-d.com/public/try/agents/tok-a");
  });

  it("prints --json output unchanged and human output through the renderer", async () => {
    const out = [];
    const fetch = vi.fn(async () => mkRes({ session_token: "t1", mock_id: "hubspot", is_live: true, active_scenario: "none" }));
    await run(["try", "run", "status", "t1", "--json"], { fetch, env: {}, out: (s) => out.push(s), err: () => {} });
    await run(["try", "run", "status", "t1"], { fetch, env: {}, out: (s) => out.push(s), err: () => {} });
    expect(JSON.parse(out[0]).session_token).toBe("t1");
    expect(out[1]).toBe("t1 · hubspot · live · scenario=none");
  });

  it("lists the commands as data, from the package and without a request", async () => {
    const out = [];
    const fetch = vi.fn();
    const code = await run(["commands", "--json"], { fetch, env: {}, out: (s) => out.push(s), err: () => {} });
    const names = JSON.parse(out[0]).map((c) => c.name);
    expect(code).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(names).toContain("try run create");
    expect(names).toContain("guide");
    expect(names).toContain("runs list");
  });

  it("returns 1 on HTTP error, surfacing detail", async () => {
    const err = [];
    const fetch = vi.fn(async () => mkRes({ detail: "Session not found" }, 404));
    const code = await run(["try", "run", "status", "x"], { fetch, env: {}, out: () => {}, err: (s) => err.push(s) });
    expect(code).toBe(1);
    expect(err.join()).toContain("404");
    expect(err.join()).toContain("Session not found");
  });

  it("returns 2 on usage error (unknown command), without calling the api", async () => {
    const fetch = vi.fn();
    const code = await run(["bogus"], { fetch, env: {}, ...silent });
    expect(code).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a plain-http API on another machine for the sign-in before any request, exit 2", async () => {
    const fetch = vi.fn();
    const err = [];
    const deps = { fetch, env: {}, ...linux(), out: () => {}, err: (s) => err.push(s) };
    expect(await run(["login", "--api", "http://api.example.com"], deps)).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
    expect(err.join()).toContain("refusing to move the client secret over http://api.example.com; use https://");
  });
});

describe("guide end to end", () => {
  const topics = { topics: [{ slug: "cli", title: "The command line", summary: "Install it." }] };

  it("reads the topics and a topic live from the backend, with no bearer and no store", async () => {
    const fetch = vi.fn(async (url) =>
      mkRes(new URL(url).pathname === "/public/guide" ? topics : { slug: "cli", title: "The command line", summary: "Install it.", markdown: "# CLI\n" })
    );
    const out = [];
    const world = { ...linux(), fs: { ...memfs(), stat: async () => Promise.reject(new Error("store must not be touched")) } };
    const env = { MOCKD_CLIENT_ID: "mk_env", MOCKD_CLIENT_SECRET: "s" };
    const deps = { fetch, env, ...world, out: (s) => out.push(s), err: () => {} };
    expect(await run(["guide"], deps)).toBe(0);
    expect(await run(["guide", "cli"], deps)).toBe(0);
    expect(await run(["guide", "cli", "--json"], deps)).toBe(0);
    expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(["/public/guide", "/public/guide/cli", "/public/guide/cli"]);
    expect(fetch.mock.calls.every(([, init]) => init.headers === undefined)).toBe(true);
    expect(out[0]).toContain("cli  The command line — Install it.");
    expect(out[1]).toBe("# CLI");
    expect(JSON.parse(out[2])).toMatchObject({ slug: "cli", markdown: "# CLI\n" });
  });

  // No built-in text: a backend that cannot be reached ends the command with that reason.
  it("ends with exit 1 and the reason when the backend cannot be reached, and prints no text", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:8000") });
    });
    const out = [];
    const err = [];
    const code = await run(["guide"], { fetch, env: { MOCKD_API_URL: "http://localhost:8000" }, ...linux(), out: (s) => out.push(s), err: (s) => err.push(s) });
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err).toEqual(["cannot reach http://localhost:8000: connect ECONNREFUSED 127.0.0.1:8000"]);
  });

  it("ends with exit 1 and the backend's sentence for a topic it does not have", async () => {
    const fetch = vi.fn(async () => mkRes({ detail: "Topic not found" }, 404));
    const err = [];
    const code = await run(["guide", "nope"], { fetch, env: {}, ...linux(), out: () => {}, err: (s) => err.push(s) });
    expect(code).toBe(1);
    expect(err).toEqual(["HTTP 404: Topic not found"]);
  });
});

describe("the read access end to end", () => {
  const PATH = "/home/me/.config/mockd/credentials.json";
  const person = { user_id: "7", name: "Ada", email: "ada@example.test", provider: "client", tenant: { name: "Analytical" } };
  const code = { device_code: "dev-1", user_code: "BCDF-GHJK", verification_url: "https://app.example/confirm?code=BCDF-GHJK", interval: 3, expires_in: 600 };

  it("whoami without a credential is a usage error that names the way in, without a request", async () => {
    const err = [];
    const fetch = vi.fn();
    expect(await run(["whoami"], { fetch, env: {}, ...linux(), out: () => {}, err: (s) => err.push(s) })).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
    expect(err.join()).toContain("mockd login");
  });

  it("whoami with the environment credential sends the bearer to /me", async () => {
    const fetch = vi.fn(async () => mkRes(person));
    const env = { MOCKD_CLIENT_ID: "mk_env", MOCKD_CLIENT_SECRET: "s" };
    expect(await run(["whoami", "--json"], { fetch, env, ...linux(), ...silent })).toBe(0);
    expect(fetch.mock.calls[0][0]).toBe("https://api.mock-d.com/me");
    expect(fetch.mock.calls[0][1].headers).toEqual({ authorization: "Bearer mk_env.s" });
  });

  it("login asks the reader's door, opens the browser, waits, stores the access owner-only, then whoami and logout use it", async () => {
    const tokens = [mkRes({ status: "pending" }, 202), mkRes({ status: "approved", client_id: "mk_new", secret: "fresh" })];
    const fetch = vi.fn(async (url, init) => {
      const path = new URL(url).pathname;
      if (path === "/public/reader/login") return mkRes(code, 201);
      if (path === "/public/reader/login/token") return tokens.shift();
      if (init.method === "DELETE") return { ok: true, status: 204, statusText: "", text: async () => "" };
      return mkRes(person);
    });
    const world = linux();
    // Linux names the machine by its pretty host name (platform/machine-name.js).
    const commands = [];
    const run_ = async (command, args) => {
      commands.push([command, ...args]);
      return { code: 0, stdout: command === "hostnamectl" ? "Adas Werkbank\n" : "", stderr: "" };
    };
    const out = [];
    const err = [];
    const deps = { fetch, env: { MOCKD_API_URL: "https://api.test" }, ...world, run: run_, hostname: "werkbank", sleep: async () => {}, out: (s) => out.push(s), err: (s) => err.push(s) };

    expect(await run(["login"], deps)).toBe(0);
    expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(["/public/reader/login", "/public/reader/login/token", "/public/reader/login/token", "/me"]);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ machine: "Adas Werkbank", os: "linux", os_user: "ada" });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ device_code: "dev-1" });
    expect(fetch.mock.calls.slice(0, 3).every(([, init]) => init.headers.authorization === undefined)).toBe(true);
    expect(fetch.mock.calls[3][1].headers).toEqual({ authorization: "Bearer mk_new.fresh" });
    expect(commands).toEqual([["hostnamectl", "--pretty"], ["xdg-open", code.verification_url]]);
    expect(JSON.parse(world.fs.files[PATH])).toEqual({ client_id: "mk_new", secret: "fresh" });
    expect(err[0]).toBe(`Confirm the code BCDF-GHJK in the browser: ${code.verification_url}`);
    expect(out).toEqual(["logged in as Ada <ada@example.test> with read access · client mk_new · stored in file"]);

    expect(await run(["whoami"], deps)).toBe(0);
    expect(fetch.mock.calls.at(-1)[1].headers).toEqual({ authorization: "Bearer mk_new.fresh" });

    expect(await run(["logout"], deps)).toBe(0);
    const [url, init] = fetch.mock.calls.at(-1);
    expect([init.method, new URL(url).pathname, init.headers.authorization]).toEqual(["DELETE", "/me/reader", "Bearer mk_new.fresh"]);
    expect(world.fs.files[PATH]).toBeUndefined();
    expect(out.at(-1)).toBe("logged out (file); the access on the server is removed too");
  });

  it("login with a declined code fails with exit 1 and stores nothing", async () => {
    const fetch = vi.fn(async (url) =>
      new URL(url).pathname === "/public/reader/login" ? mkRes(code, 201) : mkRes({ detail: "abgelehnt" }, 403)
    );
    const world = linux();
    const err = [];
    const deps = { fetch, env: { MOCKD_API_URL: "https://api.test" }, ...world, run: async () => ({ code: 0, stdout: "Werkbank", stderr: "" }), sleep: async () => {}, out: () => {}, err: (s) => err.push(s) };
    expect(await run(["login"], deps)).toBe(1);
    expect(err.at(-1)).toBe("the sign-in was declined in the browser");
    expect(world.fs.files[PATH]).toBeUndefined();
  });

  it("logout says a server that failed, exit 1, with the access gone here all the same", async () => {
    const world = linux({ [PATH]: JSON.stringify({ client_id: "mk_cli", secret: "s" }) });
    const fetch = vi.fn(async () => mkRes({ detail: "kaputt" }, 500));
    const err = [];
    expect(await run(["logout"], { fetch, env: {}, ...world, out: () => {}, err: (s) => err.push(s) })).toBe(1);
    expect(err).toEqual(["logged out here (file), but the access on the server stays: HTTP 500: kaputt. The person who owns the account can remove it in the web app"]);
    expect(world.fs.files[PATH]).toBeUndefined();
  });

  it("logout with nothing stored asks nobody", async () => {
    const fetch = vi.fn();
    const out = [];
    expect(await run(["logout"], { fetch, env: {}, ...linux(), out: (s) => out.push(s), err: () => {} })).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(out).toEqual(["nothing stored"]);
  });

  it("a playground command never opens the store", async () => {
    const world = linux();
    world.fs.stat = async () => {
      throw new Error("store must not be touched");
    };
    const fetch = vi.fn(async () => mkRes([]));
    expect(await run(["catalog", "list"], { fetch, env: {}, ...world, ...silent })).toBe(0);
  });

  it("runs list carries the bearer to /labs/runs, and --live to /live/runs", async () => {
    const fetch = vi.fn(async () => mkRes([]));
    const env = { MOCKD_CLIENT_ID: "mk_env", MOCKD_CLIENT_SECRET: "s" };
    expect(await run(["runs", "list"], { fetch, env, ...linux(), ...silent })).toBe(0);
    expect(await run(["runs", "list", "--live", "--project", "5"], { fetch, env, ...linux(), ...silent })).toBe(0);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["https://api.mock-d.com/labs/runs", "https://api.mock-d.com/live/runs?project=5"]);
    expect(fetch.mock.calls.every(([, init]) => init.headers.authorization === "Bearer mk_env.s")).toBe(true);
  });
});

// MOCKD_PROFILE: everything the CLI owns on the machine in a copy of its own, the real setup
// untouched. Linux keeps the access in a file, so the specs see where it lands.
describe("a profile", () => {
  const REAL = "/home/me/.config/mockd/credentials.json";
  const DEV = "/home/me/.config/mockd-dev/credentials.json";
  const env = { MOCKD_PROFILE: "dev", MOCKD_API_URL: "http://localhost:8000" };
  const person = mkRes({ user_id: "7", name: "Ada", email: "ada@example.test", provider: "client" });
  const stored = (path, id, secret) => ({ [path]: JSON.stringify({ client_id: id, secret }) });

  it("reads and names an access of its own; the real one stays where it was", async () => {
    const world = linux({ ...stored(REAL, "mk_real", "kept"), ...stored(DEV, "mk_dev", "local") });
    const fetch = vi.fn(async () => person);
    const out = [];
    const deps = { fetch, env, ...world, out: (s) => out.push(s), err: () => {} };
    expect(await run(["whoami"], deps)).toBe(0);
    expect(await run(["whoami", "--json"], deps)).toBe(0);
    expect(fetch.mock.calls.map(([url, init]) => [url, init.headers.authorization])).toEqual([
      ["http://localhost:8000/me", "Bearer mk_dev.local"],
      ["http://localhost:8000/me", "Bearer mk_dev.local"],
    ]);
    expect(out[0]).toBe("Ada <ada@example.test> · via client · tenant — · profile dev");
    expect(JSON.parse(out[1])).toMatchObject({ user_id: "7", profile: "dev" });

    const gone = vi.fn(async () => mkRes(null, 204));
    expect(await run(["logout"], { ...deps, fetch: gone })).toBe(0);
    expect(world.fs.files[DEV]).toBeUndefined();
    expect(JSON.parse(world.fs.files[REAL])).toEqual({ client_id: "mk_real", secret: "kept" });
  });

  it("keeps the playground list in the profile's folder", async () => {
    const world = linux();
    const fetch = vi.fn(async () => mkRes({ session: { session_token: "tok_1" }, mcp_url: "u" }));
    expect(await run(["try", "run", "create", "--json"], { fetch, env, ...world, ...silent })).toBe(0);
    expect(Object.keys(world.fs.files).filter((p) => p.endsWith("try.json"))).toEqual(["/home/me/.config/mockd-dev/try.json"]);
  });

  it("keeps the access in a keychain item of its own on macOS", async () => {
    const inputs = [];
    const security = async (_command, _args, { input }) => (inputs.push(input), { code: 44, stdout: "", stderr: "" });
    const deps = { fetch: vi.fn(async () => person), env, fs: memfs(), platform: "darwin", home: "/Users/me", run: security, ...silent };
    expect(await run(["logout"], deps)).toBe(0);
    expect(await run(["whoami"], deps)).toBe(2);
    expect(inputs).toEqual([
      expect.stringMatching(/^find-generic-password -a mockd -s mockd-client-access-dev /),
      expect.stringMatching(/^find-generic-password -a mockd -s mockd-client-access-dev /),
    ]);
  });

  it("refuses a profile that is no name, exit 2 before any request", async () => {
    const fetch = vi.fn();
    const err = [];
    const deps = { fetch, env: { MOCKD_PROFILE: "Dev" }, ...linux(), out: () => {}, err: (s) => err.push(s) };
    expect(await run(["catalog", "list"], deps)).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
    expect(err).toHaveLength(1);
    expect(err.every((e) => e.startsWith('MOCKD_PROFILE "Dev" is no profile name'))).toBe(true);
    expect(await run(["--version"], deps)).toBe(0);
  });
});
