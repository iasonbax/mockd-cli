import { describe, expect, it } from "vitest";
import { ApiError, UsageError } from "../../core/errors.js";
import { guide } from "../guide.js";

const entry = guide.guide;

const TOPICS = {
  topics: [
    { slug: "cli", title: "The command line", summary: "Install it, what works without and with sign-in." },
    { slug: "product", title: "The product", summary: "" },
  ],
};
const TOPIC = { slug: "cli", title: "The command line", summary: "Install it.", markdown: "# The command line\n\nInstall it.\n" };

// A ctx whose api records the request and answers `answer` (an Error is thrown).
function ctxOf(answer) {
  const seen = [];
  const api = async (r) => {
    seen.push(r);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { ctx: { api }, seen };
}

const run = (argv, answer) => {
  const { ctx, seen } = ctxOf(answer);
  return entry.execute(entry.args(argv, {}), ctx).then((data) => ({ data, seen }));
};

describe("guide", () => {
  it("is open: it needs no sign-in and no flag", () => {
    expect(entry.auth).toBeUndefined();
    expect(entry.flags).toBeUndefined();
  });

  it("lists the topics from the backend", async () => {
    const { data, seen } = await run([], TOPICS);
    expect(seen).toEqual([{ method: "GET", path: "/public/guide" }]);
    expect(data).toBe(TOPICS);
  });

  it("reads one topic from the backend", async () => {
    const { data, seen } = await run(["cli"], TOPIC);
    expect(seen).toEqual([{ method: "GET", path: "/public/guide/cli" }]);
    expect(data).toBe(TOPIC);
  });

  it("keeps a topic with a slash in it to one path segment", async () => {
    const { seen } = await run(["../me"], TOPIC);
    expect(seen[0].path).toBe("/public/guide/..%2Fme");
  });

  it("takes at most one topic", () => {
    expect(() => entry.args(["cli", "runs"], {})).toThrow(UsageError);
    expect(() => entry.args(["cli", "runs"], {})).toThrow("takes at most one topic");
  });

  it("renders the topics as a list with the way to read one, and a topic as its markdown", () => {
    expect(entry.render(TOPICS).split("\n")).toEqual([
      "cli      The command line — Install it, what works without and with sign-in.",
      "product  The product",
      "",
      "Read one with: mockd guide <topic>",
    ]);
    expect(entry.render(TOPIC)).toBe("# The command line\n\nInstall it.");
    expect(entry.render({ topics: [] })).toBe("(the guide has no topics)");
  });

  // There is no built-in text: what the backend answers with is all there is.
  it("passes the backend's refusal on, and has no copy of the text to show instead", async () => {
    await expect(run(["nope"], new ApiError(404, "Thema nicht gefunden"))).rejects.toThrow("HTTP 404: Thema nicht gefunden");
    await expect(run([], new Error("cannot reach https://api.mock-d.com: ENOTFOUND"))).rejects.toThrow("cannot reach");
  });

  it("refuses an answer that is not the contract's shape", async () => {
    await expect(run([], { topics: "none" })).rejects.toThrow("unexpected answer from GET /public/guide");
    await expect(run([], { topics: [{ slug: "cli" }] })).rejects.toThrow("no list of topics");
    await expect(run([], null)).rejects.toThrow("unexpected answer from GET /public/guide");
    await expect(run(["cli"], { slug: "cli", title: "T" })).rejects.toThrow("unexpected answer from GET /public/guide/cli");
  });
});
