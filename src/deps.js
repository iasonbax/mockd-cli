import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";

// A child process with text on stdin, resolved with its exit code and output. Secrets go this
// way, never as an argument, which the process list and the shell history would show. A child
// that ends without reading its input breaks the pipe (EPIPE); its exit code and output say
// what happened then, so that alone is not an error of this call.
export function runProcess(command, args, { input = "" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.stdin.on("error", (e) => e.code !== "EPIPE" && reject(e));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

// The network and the terminal: where requests go out and where answers are written.
function wire(deps) {
  return {
    fetchImpl: deps.fetch ?? globalThis.fetch,
    env: deps.env ?? process.env,
    out: deps.out ?? ((s) => process.stdout.write(s + "\n")),
    err: deps.err ?? ((s) => process.stderr.write(s + "\n")),
  };
}

// The machine side: where files, processes, the platform and the user come from. The kernel's
// host name names the machine only on Linux, where no pretty name is set
// (platform/machine-name.js); the user is read when asked, since the system has no answer for
// every user.
function machine(deps) {
  return {
    platform: deps.platform ?? process.platform,
    arch: deps.arch ?? process.arch,
    home: deps.home ?? homedir(),
    hostname: deps.hostname ?? hostname(),
    user: deps.user ?? (() => userInfo().username),
    fs: deps.fs ?? fs,
    run: deps.run ?? runProcess,
  };
}

// Time: the pause between two looks at the sign-in, and the moment a token was minted.
function clock(deps) {
  return {
    sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    now: deps.now ?? (() => new Date().toISOString()),
  };
}

// Everything `run` takes from the outside, wired in ONE place: the binary passes the real
// world, the specs pass fakes and drive the whole chain offline. Nothing else in `src/`
// reaches for `fetch`, `process.env`, the file system or stdout on its own.
export function withDefaults(deps) {
  return { ...wire(deps), ...machine(deps), ...clock(deps) };
}
