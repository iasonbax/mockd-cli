import { describe, expect, it } from "vitest";

import { runProcess, withDefaults } from "../deps.js";

// Real child processes, node itself, so the spec runs on every system the CLI builds on.
const node = (script, options) => runProcess(process.execPath, ["-e", script], options);

describe("runProcess", () => {
  it("hands the input over stdin and answers with the exit code and the output", async () => {
    const r = await node("process.stdin.pipe(process.stdout); process.stderr.write('note')", { input: "the text" });
    expect(r).toEqual({ code: 0, stdout: "the text", stderr: "note" });
  });

  it("answers with the exit code of a child that fails", async () => {
    const r = await node("process.stderr.write('no'); process.exit(3)");
    expect(r).toEqual({ code: 3, stdout: "", stderr: "no" });
  });

  // A tool that ends without reading its input breaks the pipe; its exit code is the answer.
  it("does not fail on a child that never reads its input", async () => {
    const r = await node("process.exit(0)", { input: "x".repeat(1_000_000) });
    expect(r.code).toBe(0);
  });

  it("fails with the system's error when the command is not there", async () => {
    await expect(runProcess("mockd-no-such-command", [])).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("withDefaults", () => {
  it("takes what it is given and wires the real world for the rest", () => {
    const given = { fetch: () => {}, env: { A: "1" }, platform: "linux", arch: "x64", home: "/h", hostname: "box", user: () => "ada", sleep: () => {}, now: () => "T" };
    expect(withDefaults(given)).toMatchObject({ fetchImpl: given.fetch, env: given.env, platform: "linux", home: "/h", hostname: "box" });
    const real = withDefaults({});
    expect(real.fetchImpl).toBe(globalThis.fetch);
    expect(real.platform).toBe(process.platform);
    expect(typeof real.run).toBe("function");
    expect(real.now()).toMatch(/^\d{4}-\d\d-\d\dT/);
  });
});
