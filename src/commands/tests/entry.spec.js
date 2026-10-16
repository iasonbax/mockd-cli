import { describe, expect, it } from "vitest";

import { query, viaApi, withProfile } from "../entry.js";

describe("viaApi", () => {
  it("turns a request shape into an execute that asks the context's api", async () => {
    const seen = [];
    const execute = viaApi((intent) => ({ method: "GET", path: `/x/${intent.id}` }));
    await execute({ id: "7" }, { api: async (r) => (seen.push(r), null) });
    expect(seen).toEqual([{ method: "GET", path: "/x/7" }]);
  });
});

describe("query", () => {
  it("is a query string of the values that were given, and nothing when none was", () => {
    expect(query({ project: "5", live: undefined, other: null })).toBe("?project=5");
    expect(query({ a: "1", b: "x y" })).toBe("?a=1&b=x+y");
    expect(query({})).toBe("");
    expect(query({ project: undefined })).toBe("");
  });
});

describe("withProfile", () => {
  it("names the profile in an answer, and leaves it as it was without one", () => {
    expect(withProfile({ a: 1 }, "dev")).toEqual({ a: 1, profile: "dev" });
    expect(withProfile({ a: 1 }, null)).toEqual({ a: 1 });
  });
});
