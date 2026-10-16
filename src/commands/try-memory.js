import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { readText } from "../platform/files.js";

// What this machine minted on the playground. The backend lists nothing there: a token is the
// only way to an address or a run, and whoever loses it loses both. So `try agent create` and
// `try run create` keep what they minted in the profile's folder, `try.json`, and `try list`
// reads it fresh. The website's try page keeps its address per mock in the browser the same
// way; here the command keeps it, for the agent that minted it.
//
//   [{ kind: "address", token, mock, at }, { kind: "run", token, mock, at, mcp_url }, …]
//
// A run keeps its address (`mcp_url`) because only the answer that minted it names one. The
// tokens are the write right on anonymous playground things: the file is the user's alone.

export const TRY_FILE = "try.json";

const KINDS = ["address", "run"];
const isText = (v) => typeof v === "string" && v !== "";
const isEntry = (e) =>
  e !== null &&
  typeof e === "object" &&
  KINDS.includes(e.kind) &&
  [e.token, e.mock, e.at].every(isText) &&
  (e.kind === "run" ? isText(e.mcp_url) : e.mcp_url === undefined);

// The CLI's own file: a form it did not write is an error with the way out, never read around.
function checked(text, file) {
  const broken = (why) => new Error(`${file} ${why}; remove it, the playground's addresses and runs start anew`);
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw broken(`is no JSON (${e.message})`);
  }
  if (!Array.isArray(data) || !data.every(isEntry)) throw broken("holds no playground tokens in the form mockd writes");
  return data;
}

export function playgroundMemory(fs, dir) {
  const file = join(dir, TRY_FILE);
  // Nothing minted yet is [].
  async function read() {
    const text = await readText(fs, file);
    return text === null ? [] : checked(text, file);
  }
  // Written whole under a name of its own and renamed: two commands may read it at the same
  // moment, and neither must meet half a file.
  async function write(entries) {
    await fs.mkdir(dir, { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(entries, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporary, file);
  }
  return {
    file,
    read,
    async remember(entry) {
      await write([...(await read()), entry]);
    },
    // The tokens the API no longer knows: the playground deletes what nobody used for 24 hours.
    async forget(tokens) {
      const gone = new Set(tokens);
      await write((await read()).filter((e) => !gone.has(e.token)));
    },
  };
}

// What was minted but could not be kept is said with its token: the address or the run exists,
// and the answer that named it is the only one there is.
export async function keep(ctx, entry) {
  try {
    await playgroundMemory(ctx.machine.fs, ctx.dir).remember({ ...entry, at: ctx.machine.now() });
  } catch (e) {
    throw new Error(`minted ${entry.kind} ${entry.token}, but could not keep it in ${join(ctx.dir, TRY_FILE)}: ${e.message}`, { cause: e });
  }
}
