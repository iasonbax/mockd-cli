import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { runProcess } from "../deps.js";

// The entry point itself, as a real child process: node runs bin/mockd.js the way an install
// from the source does, so the file is proven to load `src/` and to end with the right code.
const BIN = fileURLToPath(new URL("../../bin/mockd.js", import.meta.url));
const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

const mockd = (...args) => runProcess(process.execPath, [BIN, ...args]);

describe("bin/mockd.js", () => {
  it("prints the version and ends with 0", async () => {
    expect(await mockd("--version")).toEqual({ code: 0, stdout: `${version}\n`, stderr: "" });
  });

  it("shows the usage and ends with 2 when nothing is asked", async () => {
    const r = await mockd();
    expect(r.code).toBe(2);
    expect(r.stdout).toContain("mockd guide [topic]");
    expect(r.stderr).toBe("");
  });

  it("lists the commands as data without reaching for the network", async () => {
    const r = await mockd("commands", "--json");
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).map((c) => c.name)).toContain("runs list");
  });

  it("names an unknown command on stderr, with the usage, and ends with 2", async () => {
    const r = await mockd("bogus");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Unknown command: bogus");
    expect(r.stdout).toBe("");
  });

  it("ends with 1 and the reason when the backend cannot be reached", async () => {
    // Port 9 (discard) on the own machine: nothing listens, the connection is refused at once.
    const r = await mockd("guide", "--api", "http://127.0.0.1:9");
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("cannot reach http://127.0.0.1:9");
  });
});
