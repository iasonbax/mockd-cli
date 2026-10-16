// Reading a file of the CLI's own through the injected `fs`: absent is a state, not an error.

const isMissing = (e) => e?.code === "ENOENT";

// The text of the file, or null when there is none yet.
export async function readText(fs, file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch (e) {
    if (isMissing(e)) return null;
    throw e;
  }
}
