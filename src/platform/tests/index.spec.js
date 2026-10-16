import { describe, expect, it } from "vitest";
import { PRODUCT } from "../../core/product.js";
import { configDir, storeKind } from "../index.js";

describe("configDir", () => {
  it("follows XDG on Linux and macOS, APPDATA on Windows, whatever system runs the code", () => {
    expect(configDir({ platform: "linux", env: {}, home: "/home/me" })).toBe("/home/me/.config/mockd");
    expect(configDir({ platform: "linux", env: { XDG_CONFIG_HOME: "/xdg" }, home: "/home/me" })).toBe("/xdg/mockd");
    expect(configDir({ platform: "darwin", env: {}, home: "/Users/me" })).toBe("/Users/me/.config/mockd");
    expect(configDir({ platform: "win32", env: { APPDATA: "C:\\Users\\me\\AppData\\Roaming" }, home: "C:\\Users\\me" })).toBe(
      "C:\\Users\\me\\AppData\\Roaming\\mockd"
    );
    expect(configDir({ platform: "win32", env: {}, home: "C:\\Users\\me" })).toBe("C:\\Users\\me\\AppData\\Roaming\\mockd");
  });

  // The product's name is one constant (core/product.js); the folder is derived from it.
  it("derives the folder from the product's name", () => {
    expect(configDir({ platform: "linux", env: {}, home: "/home/me" })).toBe(`/home/me/.config/${PRODUCT}`);
  });
});

describe("configDir with a profile", () => {
  it("is a folder of its own next to the real one, on every system", () => {
    const profile = "dev";
    expect(configDir({ platform: "linux", env: {}, home: "/home/me", profile })).toBe("/home/me/.config/mockd-dev");
    expect(configDir({ platform: "linux", env: { XDG_CONFIG_HOME: "/xdg" }, home: "/home/me", profile })).toBe("/xdg/mockd-dev");
    expect(configDir({ platform: "darwin", env: {}, home: "/Users/me", profile })).toBe("/Users/me/.config/mockd-dev");
    expect(configDir({ platform: "win32", env: { APPDATA: "C:\\Users\\me\\AppData\\Roaming" }, home: "C:\\Users\\me", profile })).toBe(
      "C:\\Users\\me\\AppData\\Roaming\\mockd-dev"
    );
    expect(configDir({ platform: "linux", env: {}, home: "/home/me", profile: null })).toBe("/home/me/.config/mockd");
  });
});

describe("storeKind", () => {
  it("is keychain on macOS, dpapi on Windows, file elsewhere", () => {
    expect(storeKind("darwin")).toBe("keychain");
    expect(storeKind("win32")).toBe("dpapi");
    expect(storeKind("linux")).toBe("file");
    expect(storeKind("freebsd")).toBe("file");
  });
});
