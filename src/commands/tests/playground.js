import { join } from "node:path";

// The profile's folder a playground command keeps its tokens in (try-memory.js), in memory: a
// context's `machine` and `dir`, and what `try.json` holds now.
export const DIR = "/home/me/.config/mockd";
export const NOW = "2026-09-29T08:00:00.000Z";
export const TRY_JSON = join(DIR, "try.json");

export function keeping(files = {}) {
  const missing = () => Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  const fs = {
    files,
    readFile: async (p) => {
      if (!(p in files)) throw missing();
      return files[p];
    },
    writeFile: async (p, t) => {
      files[p] = t;
    },
    mkdir: async () => {},
    rename: async (from, to) => {
      files[to] = files[from];
      delete files[from];
    },
  };
  return { ctx: { machine: { fs, now: () => NOW }, dir: DIR }, kept: () => JSON.parse(files[TRY_JSON]) };
}
