import { describe, expect, it } from "vitest";
import { browserFor, openCommand } from "../browser.js";

describe("openCommand", () => {
  it("opens a link with the platform's opener", () => {
    expect(openCommand("darwin", "https://x.test/a")).toEqual(["open", ["https://x.test/a"]]);
    expect(openCommand("linux", "https://x.test/a")).toEqual(["xdg-open", ["https://x.test/a"]]);
    expect(openCommand("win32", "https://x.test/a")).toEqual(["cmd", ["/c", "start", "", "https://x.test/a"]]);
  });

  // `start` hands the address to cmd.exe: an `&` would start a second command there.
  it("refuses on Windows a link that cmd.exe would read as a command", () => {
    expect(() => openCommand("win32", "https://x.test/?a=1&calc")).toThrow("cmd.exe would read part of it as a command");
    expect(() => openCommand("win32", "https://x.test/?a=1|calc")).toThrow("refusing to open");
    expect(openCommand("linux", "https://x.test/?a=1&b=2")).toEqual(["xdg-open", ["https://x.test/?a=1&b=2"]]);
  });
});

describe("browserFor", () => {
  const runOf = (code = 0) => {
    const calls = [];
    const run = async (command, args) => (calls.push([command, args]), { code, stdout: "", stderr: "nope" });
    return { run, calls };
  };

  it("runs the opener through the injected run", async () => {
    const { run, calls } = runOf();
    await browserFor({ platform: "darwin", run }).open("https://x.test/a");
    expect(calls).toEqual([["open", ["https://x.test/a"]]]);
  });

  it("fails loudly when the opener fails", async () => {
    const { run } = runOf(1);
    await expect(browserFor({ platform: "linux", run }).open("https://x.test/a")).rejects.toThrow("xdg-open failed (1): nope");
  });
});
