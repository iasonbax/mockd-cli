import { beforeAll, describe, expect, it } from "vitest";
import { run } from "../cli.js";
import { COMMANDS } from "../commands/index.js";

// The access `mockd login` stores can read and nothing else, and the backend enforces it. This
// spec holds the CLI to the same rule from its side: over the WHOLE command table, with a
// faked fetch, every request that carries an authorization header is a GET. The one exception
// is `logout`, which ends the access itself with `DELETE /me/reader`. A command that writes
// with the bearer, or reaches a route a read access may not use, turns this spec red; a new
// command without a call below does too, so none can slip past it.

// One or more calls per command, each reaching the network where the command does.
const CALLS = {
  guide: [["guide"], ["guide", "cli"]],
  commands: [["commands"]],
  "catalog list": [["catalog", "list"]],
  "try run create": [["try", "run", "create"]],
  "try run status": [["try", "run", "status", "t1"]],
  "try run trace": [["try", "run", "trace", "t1"]],
  "try run delete": [["try", "run", "delete", "t1"]],
  "try run changes": [["try", "run", "changes", "t1"]],
  "try run diff": [["try", "run", "diff", "t1", "t2"]],
  "try agent create": [["try", "agent", "create"], ["try", "agent", "create", "--rule", "a=timeout"]],
  "try agent show": [["try", "agent", "show", "a1"]],
  "try agent scenario": [["try", "agent", "scenario", "a1", "rate_limit"]],
  "try agent close": [["try", "agent", "close", "a1"]],
  "try list": [["try", "list"]],
  login: [["login"]],
  whoami: [["whoami"]],
  logout: [["logout"]],
  "runs list": [["runs", "list"], ["runs", "list", "--live", "--project", "5"]],
  "runs show": [["runs", "show", "t1"], ["runs", "show", "t1", "--live"]],
  "runs trace": [["runs", "trace", "t1"], ["runs", "trace", "t1", "--live"]],
  "runs changes": [["runs", "changes", "t1"], ["runs", "changes", "t1", "--live"]],
  "runs diff": [["runs", "diff", "t1", "t2"]],
};

// The routes the backend lets a read access use: the account, the runs of the lab and of
// operation, and the end of the access itself. Everything else is a 403 there.
const READER_ROUTES = [
  ["GET", /^\/me$/],
  ["GET", /^\/(labs|live)\/runs$/],
  ["GET", /^\/(labs|live)\/runs\/[^/]+$/],
  ["GET", /^\/(labs|live)\/runs\/[^/]+\/(traces|changes)$/],
  ["GET", /^\/labs\/runs\/[^/]+\/diff\/[^/]+$/],
  ["DELETE", /^\/me\/reader$/],
];

const OPEN_DOORS = /^\/(public|catalog)\//;

const CODE = { device_code: "dev-1", user_code: "BCDF-GHJK", verification_url: "https://app.example/confirm?code=BCDF-GHJK", interval: 3, expires_in: 600 };

// What the faked backend answers: [method + path, status, body]; the first match wins.
const ANSWERS = [
  [/^POST \/public\/reader\/login$/, 201, CODE],
  [/^POST \/public\/reader\/login\/token$/, 200, { status: "approved", client_id: "mk_new", secret: "fresh" }],
  [/^DELETE \/me\/reader$/, 204, null],
  [/^GET \/public\/guide$/, 200, { topics: [{ slug: "cli", title: "The CLI", summary: "Install it." }] }],
  [/^GET \/public\/guide\/[^/]+$/, 200, { slug: "cli", title: "The CLI", summary: "Install it.", markdown: "# The CLI\n" }],
  [/^POST \/public\/try\/runs$/, 200, { session: { session_token: "r1" }, mcp_url: "u" }],
  [/^POST \/public\/try\/agents$/, 200, { connector: { connector_token: "a1", mock_id: "hubspot" }, mcp_url: "u" }],
  [/./, 200, {}],
];

const answerTo = (method, path) => {
  const [, status, body] = ANSWERS.find(([pattern]) => pattern.test(`${method} ${path}`));
  return { ok: status < 400, status, statusText: "", text: async () => (body === null ? "" : JSON.stringify(body)) };
};

// A Linux machine in memory: a machine id for the playground, the playground's list with an
// address and a run in it (for `try list`), and an access in the store. `logout` ends only the
// stored access, so the store holds one in both worlds; where the environment names one as
// well, that one wins for every command that reads an account.
function machine() {
  const files = {
    "/etc/machine-id": "0123456789abcdef0123456789abcdef\n",
    "/home/me/.config/mockd/try.json": JSON.stringify([
      { kind: "address", token: "a1", mock: "hubspot", at: "2026-10-01T00:00:00.000Z" },
      { kind: "run", token: "r1", mock: "hubspot", at: "2026-10-01T00:00:00.000Z", mcp_url: "u" },
    ]),
    "/home/me/.config/mockd/credentials.json": JSON.stringify({ client_id: "mk_stored", secret: "from-store" }),
  };
  const missing = () => Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  const fs = {
    files,
    readFile: async (p) => (p in files ? files[p] : Promise.reject(missing())),
    writeFile: async (p, t) => void (files[p] = t),
    stat: async (p) => (p in files ? { mode: 0o600 } : Promise.reject(missing())),
    chmod: async () => {},
    mkdir: async () => {},
    rename: async (from, to) => ((files[to] = files[from]), delete files[from]),
    unlink: async (p) => (p in files ? void delete files[p] : Promise.reject(missing())),
  };
  const commandsRun = async (command) => ({ code: 0, stdout: command === "hostnamectl" ? "Ada's Workbench\n" : "", stderr: "" });
  return { fs, platform: "linux", arch: "x64", home: "/home/me", user: () => "ada", hostname: "box", run: commandsRun, sleep: async () => {} };
}

// Runs every call of the table in a world of its own; the requests come back with the command
// that sent them and whether they carried an authorization header.
async function collect(source) {
  const requests = [];
  const exits = [];
  for (const [name, calls] of Object.entries(CALLS)) {
    for (const argv of calls) {
      const fetch = async (url, init) => {
        const { pathname } = new URL(url);
        requests.push({ command: name, method: init.method, path: pathname, authorization: init.headers?.authorization });
        return answerTo(init.method, pathname);
      };
      const env = source === "env" ? { MOCKD_CLIENT_ID: "mk_env", MOCKD_CLIENT_SECRET: "from-env" } : {};
      const code = await run([...argv, "--json"], { fetch, env, ...machine(), out: () => {}, err: () => {} });
      exits.push([argv.join(" "), code]);
    }
  }
  return { requests, exits };
}

describe("the table of commands", () => {
  it("is exercised in full: a new command needs a call here", () => {
    expect(Object.keys(CALLS).sort()).toEqual(Object.keys(COMMANDS).sort());
  });
});

describe.each(["env", "store"])("with the access from the %s", (source) => {
  let requests;
  let exits;

  beforeAll(async () => {
    ({ requests, exits } = await collect(source));
  });

  it("runs every call to the end", () => {
    expect(exits.filter(([, code]) => code !== 0)).toEqual([]);
  });

  it("makes requests for every command that has a backend to ask", () => {
    const asked = new Set(requests.map((r) => r.command));
    expect([...Object.keys(CALLS)].filter((name) => !asked.has(name))).toEqual(["commands"]);
  });

  it("sends the bearer only with a GET, the one exception being DELETE /me/reader of logout", () => {
    const withBearer = requests.filter((r) => r.authorization);
    expect(withBearer.length).toBeGreaterThan(0);
    const writes = withBearer.filter((r) => r.method !== "GET").map((r) => `${r.command}: ${r.method} ${r.path}`);
    expect(writes).toEqual(["logout: DELETE /me/reader"]);
  });

  it("sends the bearer only to the routes a read access may use", () => {
    const outside = requests
      .filter((r) => r.authorization)
      .filter((r) => !READER_ROUTES.some(([method, route]) => r.method === method && route.test(r.path)))
      .map((r) => `${r.command}: ${r.method} ${r.path}`);
    expect(outside).toEqual([]);
  });

  it("sends no bearer to the guide, the playground, the catalog or the sign-in", () => {
    const open = requests.filter((r) => OPEN_DOORS.test(r.path));
    expect(open.length).toBeGreaterThan(0);
    expect(open.filter((r) => r.authorization).map((r) => `${r.command}: ${r.method} ${r.path}`)).toEqual([]);
  });

  it("asks only routes under /public/, /catalog/ or the reader's own", () => {
    const stray = requests
      .filter((r) => !OPEN_DOORS.test(r.path) && !r.authorization)
      .map((r) => `${r.command}: ${r.method} ${r.path}`);
    expect(stray).toEqual([]);
  });

  it("reads the runs with GET under /labs and /live and nothing else", () => {
    const runs = requests.filter((r) => r.command.startsWith("runs "));
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((r) => r.method === "GET" && /^\/(labs|live)\/runs/.test(r.path))).toBe(true);
  });
});
