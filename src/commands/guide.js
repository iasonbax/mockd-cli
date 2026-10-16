import { UsageError } from "../core/errors.js";

// `mockd guide [topic]`: what the product is and how to use it, read live from the backend
// (`GET /public/guide` for the topics, `GET /public/guide/{slug}` for one). The text is not in
// this package: it is current without a new install, and a backend that cannot be reached ends
// the command with that reason. There is no built-in copy to fall back on. No sign-in needed.

const LIST_PATH = "/public/guide";

const isText = (v) => typeof v === "string" && v !== "";

// An answer that is not the contract's shape is an error, not a half-printed guide.
function checkedTopics(data) {
  const topics = data?.topics;
  const fits = (t) => isText(t?.slug) && isText(t?.title) && typeof t?.summary === "string";
  if (!Array.isArray(topics) || !topics.every(fits)) {
    throw new Error(`unexpected answer from GET ${LIST_PATH}: no list of topics (slug, title, summary)`);
  }
  return data;
}

function checkedTopic(data, path) {
  if (!isText(data?.slug) || !isText(data?.title) || typeof data?.markdown !== "string") {
    throw new Error(`unexpected answer from GET ${path}: no slug, title and markdown`);
  }
  return data;
}

function renderTopics({ topics }) {
  if (!topics.length) return "(the guide has no topics)";
  const width = Math.max(...topics.map((t) => t.slug.length));
  const lines = topics.map((t) => `${t.slug.padEnd(width)}  ${t.title}${t.summary ? ` — ${t.summary}` : ""}`);
  return [...lines, "", "Read one with: mockd guide <topic>"].join("\n");
}

export const guide = {
  guide: {
    usage: "mockd guide [topic]",
    describe: "Product knowledge and how-tos, read live from the backend: the topics, or one topic in full.",
    args: (positionals) => {
      if (positionals.length > 1) throw new UsageError("takes at most one topic");
      return { topic: positionals[0] };
    },
    execute: async ({ topic }, ctx) => {
      if (topic === undefined) return checkedTopics(await ctx.api({ method: "GET", path: LIST_PATH }));
      const path = `${LIST_PATH}/${encodeURIComponent(topic)}`;
      return checkedTopic(await ctx.api({ method: "GET", path }), path);
    },
    render: (data) => (Array.isArray(data.topics) ? renderTopics(data) : data.markdown.trimEnd()),
  },
};
