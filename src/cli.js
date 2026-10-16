import { parseArgs } from "node:util";

import pkg from "../package.json" with { type: "json" };
import { COMMANDS, match, usageText } from "./commands/index.js";
import { DEFAULT_API, makeApi } from "./core/api.js";
import { bearerOf, requireCredential, resolveCredential } from "./core/credentials.js";
import { EXIT, UsageError } from "./core/errors.js";
import { storeFor } from "./core/stores.js";
import { withDefaults } from "./deps.js";
import { browserFor } from "./platform/browser.js";
import { machineFingerprint } from "./platform/fingerprint.js";
import { configDir, storeKind } from "./platform/index.js";
import { readMachineName } from "./platform/machine-name.js";
import { profileOf } from "./platform/profile.js";

// The version the package carries. An import, not a read at runtime: the standalone binary
// has no package.json next to it, the bundler writes the value in.
export const VERSION = pkg.version;

function parseArgv(argv) {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: "boolean", default: false },
        api: { type: "string" },
        // Every flag is declared once here and claimed per command (`flags`); a flag a
        // command does not claim is a usage error.
        scenario: { type: "string" },
        latency: { type: "string" },
        rule: { type: "string", multiple: true },
        "clear-rules": { type: "boolean", default: false },
        project: { type: "string" },
        live: { type: "boolean", default: false },
      },
    });
  } catch (e) {
    throw new UsageError(e.message);
  }
}

const GLOBAL_FLAGS = new Set(["json", "api"]);

// Answered before any command, like --help: the version this build carries.
const VERSION_FLAGS = ["--version", "-v"];

const given = (value) =>
  value !== undefined && value !== false && !(Array.isArray(value) && value.length === 0);

// A flag a command does not declare is a usage error, not silence: `try run create
// --scenario x` must not mint a run and drop the failure picture on the floor.
function rejectStrayFlags(entry, name, values) {
  const allowed = new Set(entry.flags ?? []);
  for (const [flag, value] of Object.entries(values)) {
    if (GLOBAL_FLAGS.has(flag) || allowed.has(flag) || !given(value)) continue;
    throw new UsageError(`--${flag} is not an option of ${name}`);
  }
}

// The intent's own keys; a command's `args` must not answer with them, or `--json` and the
// dispatch would read the command's data as their own. A programming error, not a usage one.
const RESERVED = ["name", "json", "api", "profile"];

// The command-specific fields, with the command name in front of an argument complaint so
// "needs a <token>" says which command asked.
function fields(entry, name, rest, values) {
  rejectStrayFlags(entry, name, values);
  if (!entry.args) return {};
  let own;
  try {
    own = entry.args(rest, values);
  } catch (e) {
    if (e instanceof UsageError) throw new UsageError(`${name} ${e.message}`);
    throw e;
  }
  const clash = RESERVED.find((key) => key in own);
  if (clash) throw new Error(`${name}: the intent field "${clash}" is reserved`);
  return own;
}

// What a command may touch: the API (with the access where the command needs one), the
// credential store of this platform, the browser for `login`. Read lazily: a playground
// command never opens the keychain, and only minting on the playground reads the machine id.
// The intent's profile (platform/profile.js) picks the folder and the store here and travels
// on as `profile`.
async function contextFor(entry, intent, world) {
  const { fetchImpl, env, platform, arch, home, fs, run } = world;
  const { profile } = intent;
  const dir = configDir({ platform, env, home, profile });
  const store = storeFor(storeKind(platform), { run, fs, dir, profile });
  const apiWith = (bearer) => makeApi(fetchImpl, intent.api, { bearer });
  const cred = entry.auth ? requireCredential(await resolveCredential({ env, store })) : null;
  return {
    api: apiWith(cred ? bearerOf(cred) : undefined),
    apiWith,
    // An answer that carries a secret (the sign-in in the browser) follows the bearer's https
    // rule; built on use, so a playground command against a plain http:// never meets it.
    secureApi: () => makeApi(fetchImpl, intent.api, { secure: true }),
    store,
    env,
    commands: COMMANDS,
    dir,
    profile,
    browser: browserFor({ platform, run }),
    fingerprint: () => machineFingerprint({ platform, arch, readFile: (p) => fs.readFile(p, "utf8"), run }),
    machine: {
      platform,
      fs,
      now: world.now,
      sleep: world.sleep,
      user: world.user,
      // The name the system shows, read when asked: only the sign-in needs it.
      name: () => readMachineName({ platform, env, run, hostname: world.hostname }),
    },
    note: world.err,
  };
}

// Which backend: the flag, then the environment, then the default.
const apiOf = (flag, env) => flag ?? env.MOCKD_API_URL ?? DEFAULT_API;

// Pure: argv -> validated intent. Reads env only for the API default and the profile, once
// here for every command (injected for tests).
export function resolve(argv, env = process.env) {
  const { values, positionals } = parseArgv(argv);
  const [name, rest] = match(positionals);
  return {
    name,
    json: values.json,
    api: apiOf(values.api, env),
    profile: profileOf(env),
    ...fields(COMMANDS[name], name, rest, values),
  };
}

const HELP = ["--help", "-h"];

// Without a command, and on --help, the usage: exit 2 when nothing was asked, 0 when help was.
function withoutCommand(argv, world) {
  world.out(usageText());
  return argv.length === 0 ? EXIT.USAGE : EXIT.OK;
}

export async function run(argv, deps = {}) {
  const world = withDefaults(deps);
  const { env, out, err } = world;

  if (VERSION_FLAGS.includes(argv[0])) {
    out(VERSION);
    return EXIT.OK;
  }

  try {
    if (argv.length === 0 || HELP.includes(argv[0])) return withoutCommand(argv, world);
    const intent = resolve(argv, env);
    const entry = COMMANDS[intent.name];
    const data = await entry.execute(intent, await contextFor(entry, intent, world));
    out(intent.json ? JSON.stringify(data, null, 2) : entry.render(data, env));
    return EXIT.OK;
  } catch (e) {
    // A wrong call gets the usage and exit 2; everything else is a runtime error, exit 1.
    if (e instanceof UsageError) {
      err(e.message + "\n\n" + usageText());
      return EXIT.USAGE;
    }
    err(e.message);
    return EXIT.RUNTIME;
  }
}

export { UsageError } from "./core/errors.js";
