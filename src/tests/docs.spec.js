import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { COMMANDS, match } from "../commands/index.js";

// The docs an agent copies from must name commands that exist, and the README must name all of
// them. A command that is renamed or removed without the docs turns this spec red.

const DOCS = { "README.md": readFileSync("README.md", "utf8"), "skills/mockd/SKILL.md": readFileSync("skills/mockd/SKILL.md", "utf8") };

/** The code of a markdown text: the lines of fenced blocks and every inline `span`. */
function code(markdown) {
  let fenced = false;
  return markdown.split("\n").flatMap((line) => {
    if (line.startsWith("```")) {
      fenced = !fenced;
      return [];
    }
    return fenced ? [line] : [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  });
}

/** Every `mockd <words>` in the code of a doc, as the words that follow (up to a flag, a placeholder, a pipe). */
function invocations(markdown) {
  return code(markdown).flatMap((snippet) =>
    [...snippet.matchAll(/(?<![\w./-])mockd\s+((?:[a-z][a-z-]*\s*)+)/g)].map((m) => m[1].trim().split(/\s+/))
  );
}

describe.each(Object.entries(DOCS))("%s", (_name, text) => {
  it("names only commands that exist", () => {
    const unknown = invocations(text).flatMap((words) => {
      try {
        match(words);
        return [];
      } catch {
        return [`mockd ${words.join(" ")}`];
      }
    });
    expect(unknown).toEqual([]);
  });

  it("names no command that writes, connects a client or runs a background service", () => {
    expect(text).not.toMatch(/mockd (connect|watch|setup|status|logs|service|agents|servers|projects|goals|variants|jobs|changes) /);
    expect(text).not.toMatch(/runs judge|--client-id|--secret-stdin|login --browser/);
  });
});

describe("README.md", () => {
  // `mockd try run create|status|…` names the family once and the commands as alternatives.
  const covers = (name) => {
    const words = name.split(" ");
    const prefix = words.slice(0, -1).join(" ");
    return DOCS["README.md"].split("\n").some((line) => {
      if (line.includes(`mockd ${name}`)) return true;
      const head = prefix ? line.indexOf(`mockd ${prefix} `) : -1;
      return head >= 0 && new RegExp(`\\b${words.at(-1)}\\b`).test(line.slice(head));
    });
  };

  it("names every command of the table", () => {
    expect(Object.keys(COMMANDS).filter((name) => !covers(name))).toEqual([]);
  });

  it("says that a signed-in access only reads", () => {
    expect(DOCS["README.md"]).toMatch(/can only read/i);
  });
});
