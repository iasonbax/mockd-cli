#!/usr/bin/env node
import { run } from "../src/cli.js";

// The process ends only after its output has left it: a pipe that is read slowly would lose
// the tail of a long answer, a guide topic say, to an early exit.
const drained = (stream) => new Promise((resolve) => stream.write("", resolve));

async function main() {
  let code = 1;
  try {
    code = await run(process.argv.slice(2));
  } catch (e) {
    process.stderr.write((e?.stack ?? String(e)) + "\n");
  }
  await Promise.all([drained(process.stdout), drained(process.stderr)]);
  process.exit(code);
}

main();
