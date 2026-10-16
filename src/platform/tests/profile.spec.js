import { describe, expect, it } from "vitest";
import { UsageError } from "../../core/errors.js";
import { named, profileOf } from "../profile.js";

describe("profileOf", () => {
  it("is null without MOCKD_PROFILE: the real setup", () => {
    expect(profileOf({})).toBeNull();
    expect(profileOf({ MOCKD_API_URL: "http://localhost:8000" })).toBeNull();
  });

  it("takes 1 to 20 characters of a-z, 0-9 and -", () => {
    expect(profileOf({ MOCKD_PROFILE: "dev" })).toBe("dev");
    expect(profileOf({ MOCKD_PROFILE: "a" })).toBe("a");
    expect(profileOf({ MOCKD_PROFILE: "local-2" })).toBe("local-2");
    expect(profileOf({ MOCKD_PROFILE: "x".repeat(20) })).toBe("x".repeat(20));
  });

  // An empty or mistyped profile must not quietly become the real setup.
  it.each(["", "Dev", "de v", "dev_1", "dev.1", "../mockd", "x".repeat(21), "dév"])(
    'refuses "%s" as a usage error that names the rule',
    (name) => {
      expect(() => profileOf({ MOCKD_PROFILE: name })).toThrow(UsageError);
      expect(() => profileOf({ MOCKD_PROFILE: name })).toThrow(
        `MOCKD_PROFILE "${name}" is no profile name: 1 to 20 characters of a-z, 0-9 and -`
      );
    }
  );
});

describe("named", () => {
  it("is the name itself without a profile, the profile's copy with one", () => {
    expect(named("mockd", null)).toBe("mockd");
    expect(named("mockd", undefined)).toBe("mockd");
    expect(named("mockd", "dev")).toBe("mockd-dev");
  });
});
