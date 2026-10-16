import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Enforces the placement rule from AGENT.md: without this test it stays a request. vitest looks
// for specs under src/ only and widely (`src/**/*.spec.js`), so a spec in the wrong place is
// named here instead of being skipped quietly.

const SKIP = new Set(["node_modules", ".git", "dist", ".claude"]);

/** Every spec file below `dir`, as a path relative to it. */
function specFiles(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return SKIP.has(entry.name) ? [] : specFiles(join(dir, entry.name), rel);
    return /\.(spec|test)\.[cm]?[jt]s$/.test(entry.name) ? [rel] : [];
  });
}

describe("test structure", () => {
  const specs = specFiles(".");

  it("has specs to look at", () => {
    expect(specs.length).toBeGreaterThan(10);
  });

  it("puts every spec directly into a tests/ folder", () => {
    const misplaced = specs.filter((f) => f.split("/").at(-2) !== "tests");
    expect(misplaced).toEqual([]);
  });

  it("keeps every spec under src/, where vitest looks for it", () => {
    expect(specs.filter((f) => !f.startsWith("src/"))).toEqual([]);
  });

  it("names every spec <module>.spec.js", () => {
    expect(specs.filter((f) => !/\.spec\.js$/.test(f))).toEqual([]);
  });
});
