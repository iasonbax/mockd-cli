// `mockd commands`: the command table as data. An agent reads what the CLI can do instead
// of guessing (`--json`); the same source renders the usage text, so the two never drift.
export const listed = (commands) =>
  Object.entries(commands).map(([name, e]) => ({ name, usage: e.usage, describe: e.describe }));

export const meta = {
  commands: {
    usage: "mockd commands",
    describe: "List every command with its usage line (--json for the table as data).",
    execute: (_intent, ctx) => listed(ctx.commands),
    render: (data) => data.map((c) => `${c.usage.padEnd(34)} ${c.describe}`).join("\n"),
  },
};
