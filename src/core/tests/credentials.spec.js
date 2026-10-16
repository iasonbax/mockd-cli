import { describe, expect, it } from "vitest";
import {
  bearerOf,
  fromEnv,
  parseCredential,
  requireCredential,
  resolveCredential,
  serializeCredential,
  validateCredential,
} from "../credentials.js";
import { UsageError } from "../errors.js";

const cred = { clientId: "mk_abc", secret: "s3cret" };

describe("credential", () => {
  it("serializes and parses the same thing", () => {
    expect(parseCredential(serializeCredential(cred))).toEqual(cred);
    expect(parseCredential(null)).toBeNull();
    expect(parseCredential("")).toBeNull();
  });

  it("refuses a stored text that is not a credential", () => {
    expect(() => parseCredential('{"client_id": 1}')).toThrow(UsageError);
  });

  it("becomes one bearer", () => {
    expect(bearerOf(cred)).toBe("Bearer mk_abc.s3cret");
  });

  it("validates the client id prefix and a non-empty secret", () => {
    expect(validateCredential(cred)).toEqual(cred);
    expect(() => validateCredential({ clientId: "abc", secret: "x" })).toThrow('starts with "mk_"');
    expect(() => validateCredential({ clientId: "mk_a", secret: "" })).toThrow("secret is empty");
  });
});

describe("fromEnv / resolveCredential", () => {
  it("reads both variables, none, and complains about one alone", () => {
    expect(fromEnv({ MOCKD_CLIENT_ID: "mk_abc", MOCKD_CLIENT_SECRET: "s3cret" })).toEqual(cred);
    expect(fromEnv({})).toBeNull();
    expect(() => fromEnv({ MOCKD_CLIENT_ID: "mk_abc" })).toThrow("both");
    expect(() => fromEnv({ MOCKD_CLIENT_SECRET: "x" })).toThrow("both");
  });

  it("prefers the environment over the store and never opens the store then", async () => {
    let opened = false;
    const store = { read: async () => ((opened = true), serializeCredential({ clientId: "mk_store", secret: "y" })) };
    expect(await resolveCredential({ env: { MOCKD_CLIENT_ID: "mk_abc", MOCKD_CLIENT_SECRET: "s3cret" }, store })).toEqual(cred);
    expect(opened).toBe(false);
    expect(await resolveCredential({ env: {}, store })).toEqual({ clientId: "mk_store", secret: "y" });
  });

  it("is null when neither the environment nor the store has one", async () => {
    expect(await resolveCredential({ env: {}, store: { read: async () => null } })).toBeNull();
  });

  it("refuses one variable alone instead of reading the store", async () => {
    const read = async () => {
      throw new Error("the store must not be read");
    };
    await expect(resolveCredential({ env: { MOCKD_CLIENT_ID: "mk_abc" }, store: { read } })).rejects.toThrow("both");
  });
});

describe("requireCredential", () => {
  it("passes a credential through and names both ways in without one", () => {
    expect(requireCredential(cred)).toBe(cred);
    expect(() => requireCredential(null)).toThrow(UsageError);
    expect(() => requireCredential(null)).toThrow("mockd login");
    expect(() => requireCredential(null)).toThrow("MOCKD_CLIENT_ID");
  });
});
