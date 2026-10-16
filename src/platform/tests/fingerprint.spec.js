import { describe, expect, it, vi } from "vitest";
import { machineFingerprint, machineIdSource, readMachineId } from "../fingerprint.js";

const ID = "0123456789abcdef0123456789abcdef";
const HEX64 = /^[0-9a-f]{64}$/;

// Injected readers: a file system with just the given files, a process table with just the
// given commands. Anything else the module reached for would show up as a failure here.
const filesOf = (files) =>
  vi.fn(async (p) => {
    if (!(p in files)) throw Object.assign(new Error(`ENOENT: no such file, open '${p}'`), { code: "ENOENT" });
    return files[p];
  });
const noRun = vi.fn(async () => {
  throw new Error("no command may run here");
});
const answers = (result) => vi.fn(async () => result);

const linux = (files) => ({ platform: "linux", arch: "x64", readFile: filesOf(files), run: noRun });

describe("machineFingerprint", () => {
  it("is 64 lowercase hex characters and the same on every call", async () => {
    const world = linux({ "/etc/machine-id": `${ID}\n` });
    const first = await machineFingerprint(world);
    expect(first).toMatch(HEX64);
    expect(await machineFingerprint(world)).toBe(first);
  });

  // A golden value: a changed label or trait order would silently hand every machine a new
  // fingerprint, so the form is pinned here.
  it("keeps its form: label, platform, arch and machine id under SHA-256", async () => {
    expect(await machineFingerprint(linux({ "/etc/machine-id": `${ID}\n` }))).toBe(
      "4524e9c174a4f182ab12176d11d18f9be49165ff84dd4e5da187169da5e740b4"
    );
  });

  it("differs with the machine id, the platform and the architecture", async () => {
    const base = await machineFingerprint(linux({ "/etc/machine-id": ID }));
    const otherId = await machineFingerprint(linux({ "/etc/machine-id": "f".repeat(32) }));
    const otherArch = await machineFingerprint({ ...linux({ "/etc/machine-id": ID }), arch: "arm64" });
    const otherPlatform = await machineFingerprint({ ...linux({ "/etc/machine-id": ID }), platform: "freebsd" });
    expect(new Set([base, otherId, otherArch, otherPlatform]).size).toBe(4);
  });

  it("is not the plain hash of the machine id, which other programs could compute too", async () => {
    const { createHash } = await import("node:crypto");
    const plain = createHash("sha256").update(ID).digest("hex");
    expect(await machineFingerprint(linux({ "/etc/machine-id": ID }))).not.toBe(plain);
  });
});

describe("readMachineId", () => {
  it("reads /etc/machine-id on Linux and runs nothing", async () => {
    const world = linux({ "/etc/machine-id": `${ID}\n` });
    expect(await readMachineId(world)).toBe(ID);
    expect(world.readFile).toHaveBeenCalledWith("/etc/machine-id");
    expect(noRun).not.toHaveBeenCalled();
  });

  it("reads IOPlatformUUID through ioreg on macOS", async () => {
    const run = answers({
      code: 0,
      stdout: `+-o Mac  <class IOPlatformExpertDevice>\n    {\n      "IOPlatformSerialNumber" = "X"\n      "IOPlatformUUID" = "0D9D1A2B-3C4D-5E6F-7081-3A1B7A6FB010"\n    }\n`,
      stderr: "",
    });
    const readFile = filesOf({});
    expect(await readMachineId({ platform: "darwin", readFile, run })).toBe("0D9D1A2B-3C4D-5E6F-7081-3A1B7A6FB010");
    expect(run).toHaveBeenCalledWith("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("reads MachineGuid from the 64-bit registry view on Windows", async () => {
    const run = answers({
      code: 0,
      stdout: "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    8f3c2a1e-0b4d-4e6f-9a7b-1c2d3e4f5a6b\r\n\r\n",
      stderr: "",
    });
    expect(await readMachineId({ platform: "win32", readFile: filesOf({}), run })).toBe("8f3c2a1e-0b4d-4e6f-9a7b-1c2d3e4f5a6b");
    expect(run).toHaveBeenCalledWith("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid", "/reg:64"]);
  });

  it("names one source per system", () => {
    expect(machineIdSource("darwin").name).toBe("IOPlatformUUID (ioreg)");
    expect(machineIdSource("win32").name).toBe("MachineGuid (registry)");
    expect(machineIdSource("linux").name).toBe("/etc/machine-id");
  });
});

// No random stand-in: an unreadable id is an error that names the source and the cause.
describe("an unreadable machine id", () => {
  it("fails with the source and the cause when the file is missing", async () => {
    const call = readMachineId(linux({}));
    await expect(call).rejects.toThrow("cannot read this machine's id from /etc/machine-id: ENOENT");
    await expect(call).rejects.toThrow("mockd sends no random stand-in");
  });

  // Regression: a container image without /etc/machine-id (Alpine never ships one) failed with
  // the cause alone and left the caller no way forward.
  it("names the way that remains in a container without a machine id", async () => {
    const call = readMachineId(linux({}));
    await expect(call).rejects.toThrow("mount the host's: -v /etc/machine-id:/etc/machine-id:ro");
  });

  it("offers no mount where the id is no file", async () => {
    const run = answers({ code: 1, stdout: "", stderr: "denied" });
    const error = await readMachineId({ platform: "win32", run }).catch((e) => e);
    expect(error.message).toBe(
      "cannot read this machine's id from MachineGuid (registry): reg exited with 1: denied. " +
        "The playground allows one run per machine and mockd sends no random stand-in."
    );
    expect(error.message).not.toContain("/etc/machine-id");
  });

  // The CLI cannot mint an address of an account, so no message may point to one.
  it("points to no account as a way around the machine id", async () => {
    const error = await readMachineId(linux({})).catch((e) => e);
    expect(error.message).not.toMatch(/account|login/i);
  });

  it("fails when the file is empty", async () => {
    await expect(readMachineId(linux({ "/etc/machine-id": "\n" }))).rejects.toThrow("/etc/machine-id: it is empty");
  });

  it("fails when ioreg exits with an error", async () => {
    const run = answers({ code: 1, stdout: "", stderr: "ioreg: no such class\n" });
    await expect(readMachineId({ platform: "darwin", run })).rejects.toThrow(
      "IOPlatformUUID (ioreg): ioreg exited with 1: ioreg: no such class"
    );
  });

  it("fails when the output carries no id", async () => {
    const run = answers({ code: 0, stdout: "nothing here", stderr: "" });
    await expect(readMachineId({ platform: "win32", run })).rejects.toThrow("MachineGuid (registry): reg printed no machine id");
  });

  it("fails when the command cannot start at all", async () => {
    const run = vi.fn(async () => {
      throw new Error("spawn ioreg ENOENT");
    });
    await expect(machineFingerprint({ platform: "darwin", arch: "arm64", run })).rejects.toThrow("spawn ioreg ENOENT");
  });
});
