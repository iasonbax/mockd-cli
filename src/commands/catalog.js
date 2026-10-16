import { viaApi } from "./entry.js";

export const catalog = {
  "catalog list": {
    usage: "mockd catalog list",
    describe: "List the catalog mocks with their tool counts.",
    execute: viaApi(() => ({ method: "GET", path: "/catalog/mocks" })),
    render: (data) =>
      data.map((m) => `${m.id.padEnd(12)} ${m.title}  (${m.tools.length} tools)`).join("\n"),
  },
};
