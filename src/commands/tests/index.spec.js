import { describe, expect, it } from "vitest";
import { UsageError } from "../../core/errors.js";
import { COMMANDS, match, usageText } from "../index.js";
import { listed } from "../meta.js";

describe("command table", () => {
  it("matches the longest name first and hands back the rest", () => {
    const table = { try: {}, "try run": {}, "try run create": {} };
    expect(match(["try", "run", "create", "x"], table)).toEqual(["try run create", ["x"]]);
    expect(match(["try", "run"], table)).toEqual(["try run", []]);
    expect(match(["try", "zzz"], table)).toEqual(["try", ["zzz"]]);
  });

  it("rejects unknown and missing commands as usage errors", () => {
    expect(() => match(["bogus"], COMMANDS)).toThrow(UsageError);
    expect(() => match([], COMMANDS)).toThrow("Unknown command: (none)");
  });

  it("lists every command in the usage text and in `commands`", () => {
    const text = usageText();
    for (const c of listed(COMMANDS)) expect(text).toContain(c.usage);
    expect(listed(COMMANDS)).toHaveLength(Object.keys(COMMANDS).length);
  });

  it("holds exactly the commands of part A and part B, and none that writes", () => {
    expect(Object.keys(COMMANDS)).toEqual([
      "guide",
      "commands",
      "catalog list",
      "try run create",
      "try run status",
      "try run trace",
      "try run delete",
      "try run changes",
      "try run diff",
      "try agent create",
      "try agent show",
      "try agent scenario",
      "try agent close",
      "try list",
      "login",
      "whoami",
      "logout",
      "runs list",
      "runs show",
      "runs trace",
      "runs changes",
      "runs diff",
    ]);
  });

  it("separates the families in the usage text with a blank line", () => {
    const lines = usageText().split("\n");
    const at = lines.findIndex((l) => l.startsWith("  mockd runs list"));
    expect(lines[at - 1]).toBe("");
    expect(lines[at + 1]).toMatch(/^ {2}mockd runs show/);
  });

  it("marks exactly whoami and the runs as needing the credential", () => {
    const families = new Set(
      Object.entries(COMMANDS)
        .filter(([, e]) => e.auth)
        .map(([name]) => name.split(" ")[0])
    );
    expect([...families].sort()).toEqual(["runs", "whoami"]);
  });

  it("gives every command the shared shape", () => {
    for (const [name, e] of Object.entries(COMMANDS)) {
      expect(typeof e.usage, name).toBe("string");
      expect(typeof e.describe, name).toBe("string");
      expect(typeof e.execute, name).toBe("function");
      expect(typeof e.render, name).toBe("function");
    }
  });
});
