import { describe, expect, it, vi } from "vitest";

import { machineNameSource, readMachineName } from "../machine-name.js";

// A process table that answers the given commands and records every call; anything else the
// module reached for would show up as a failure here.
function processes(answers) {
  const calls = [];
  const run = vi.fn(async (command, args) => {
    calls.push([command, ...args]);
    const answer = answers[command];
    if (answer instanceof Error) throw answer;
    if (!answer) throw new Error(`no ${command} here`);
    return answer;
  });
  return { run, calls };
}

const printed = (stdout) => ({ code: 0, stdout, stderr: "" });
const failed = (code, stderr) => ({ code, stdout: "", stderr });
const enoent = (command) => Object.assign(new Error(`spawn ${command} ENOENT`), { code: "ENOENT" });

describe("readMachineName on macOS", () => {
  it("is the computer name of the settings, not the host name", async () => {
    const { run, calls } = processes({ scutil: printed("MacBook Pro von Ada\n") });
    const name = await readMachineName({ platform: "darwin", env: {}, run, hostname: "MacBook-Pro-von-Ada.local" });
    expect(name).toBe("MacBook Pro von Ada");
    expect(calls).toEqual([["scutil", "--get", "ComputerName"]]);
  });

  it("fails with the cause when no computer name is set, and takes no host name instead", async () => {
    const { run } = processes({ scutil: failed(1, "ComputerName: not set\n") });
    const reading = readMachineName({ platform: "darwin", env: {}, run, hostname: "mac.local" });
    await expect(reading).rejects.toThrow(
      "cannot read this machine's name from scutil --get ComputerName: scutil exited with 1: ComputerName: not set. " +
        "mockd names the machine as the system shows it and sends no other name. Name it in System Settings › General › About"
    );
  });
});

describe("readMachineName on Windows", () => {
  it("is COMPUTERNAME, and runs nothing", async () => {
    const { run } = processes({});
    expect(await readMachineName({ platform: "win32", env: { COMPUTERNAME: "DESKTOP-7Q2K" }, run, hostname: "x" })).toBe("DESKTOP-7Q2K");
    expect(run).not.toHaveBeenCalled();
  });

  it("fails when COMPUTERNAME is not set or empty", async () => {
    const { run } = processes({});
    await expect(readMachineName({ platform: "win32", env: {}, run, hostname: "desktop" })).rejects.toThrow(
      "cannot read this machine's name from COMPUTERNAME: it is not set"
    );
    await expect(readMachineName({ platform: "win32", env: { COMPUTERNAME: " " }, run, hostname: "desktop" })).rejects.toThrow(
      "cannot read this machine's name from COMPUTERNAME: it is empty"
    );
  });
});

describe("readMachineName on Linux", () => {
  it("is the pretty host name when one is set", async () => {
    const { run, calls } = processes({ hostnamectl: printed("Adas Werkbank\n") });
    expect(await readMachineName({ platform: "linux", env: {}, run, hostname: "werkbank" })).toBe("Adas Werkbank");
    expect(calls).toEqual([["hostnamectl", "--pretty"]]);
  });

  it("is the host name when the system has no pretty name set, as machine-info(5) says", async () => {
    const { run } = processes({ hostnamectl: printed("\n") });
    expect(await readMachineName({ platform: "linux", env: {}, run, hostname: "werkbank" })).toBe("werkbank");
  });

  it("fails when hostnamectl fails or is missing, and takes no host name instead", async () => {
    const noSystemd = processes({ hostnamectl: failed(1, "System has not been booted with systemd as init system (PID 1). Can't operate.") });
    await expect(readMachineName({ platform: "linux", env: {}, run: noSystemd.run, hostname: "box" })).rejects.toThrow(
      "cannot read this machine's name from hostnamectl --pretty: hostnamectl exited with 1: System has not been booted"
    );
    const missing = processes({ hostnamectl: enoent("hostnamectl") });
    await expect(readMachineName({ platform: "linux", env: {}, run: missing.run, hostname: "box" })).rejects.toThrow(
      "from hostnamectl --pretty: spawn hostnamectl ENOENT. mockd names the machine as the system shows it"
    );
  });

  it("fails on an empty host name as well", async () => {
    const { run } = processes({ hostnamectl: printed("") });
    await expect(readMachineName({ platform: "linux", env: {}, run, hostname: "  " })).rejects.toThrow(
      "cannot read this machine's name from hostnamectl --pretty: it is empty"
    );
  });
});

describe("machineNameSource", () => {
  it("names one source per system; the others read like Linux", () => {
    expect(["darwin", "win32", "linux", "freebsd"].map((p) => machineNameSource(p).name)).toEqual([
      "scutil --get ComputerName",
      "COMPUTERNAME",
      "hostnamectl --pretty",
      "hostnamectl --pretty",
    ]);
  });
});
