import { describe, expect, it } from "vitest";
import { UsageError } from "../errors.js";
import { PRODUCT } from "../product.js";
import { dpapiStore, fileStore, keychainStore, storeFor } from "../stores.js";

// A fake `run` that records every process call and answers from a script.
const runner = (answer) => {
  const calls = [];
  const run = async (cmd, args, opts) => {
    calls.push({ cmd, args, input: opts?.input });
    return typeof answer === "function" ? answer(calls.length) : answer;
  };
  return { run, calls };
};

describe("where a store keeps the access", () => {
  it("names the keychain item and the files, for a person to find them", () => {
    const { run } = runner({ code: 0, stdout: "", stderr: "" });
    expect(keychainStore(run).location).toBe("mockd-client-access");
    expect(dpapiStore(run, {}, "C:\\Users\\me\\AppData\\Roaming\\mockd").location).toBe(
      "C:\\Users\\me\\AppData\\Roaming\\mockd\\credentials.dpapi"
    );
    expect(fileStore({}, "/home/me/.config/mockd").location).toBe("/home/me/.config/mockd/credentials.json");
  });

  // The product's name is one constant (core/product.js); the item is derived from it.
  it("derives the keychain item from the product's name", () => {
    const { run } = runner({ code: 0, stdout: "", stderr: "" });
    expect(keychainStore(run).location).toBe(`${PRODUCT}-client-access`);
  });
});

describe("keychainStore (macOS)", () => {
  it("writes through `security -i` with the secret on stdin, never as an argument", async () => {
    const { run, calls } = runner({ code: 0, stdout: "", stderr: "" });
    await keychainStore(run).write('{"secret":"s3cret"}');
    expect(calls[0].cmd).toBe("security");
    expect(calls[0].args).toEqual(["-i"]);
    expect(calls[0].input).toContain("add-generic-password");
    expect(calls[0].input).toContain("-U -w \"{\\\"secret\\\":\\\"s3cret\\\"}\"");
    expect(JSON.stringify(calls[0].args)).not.toContain("s3cret");
  });

  it("reads the stored text, null when the keychain has none, and surfaces other failures", async () => {
    expect(await keychainStore(runner({ code: 0, stdout: "stored\n", stderr: "" }).run).read()).toBe("stored");
    expect(await keychainStore(runner({ code: 44, stdout: "", stderr: "not found" }).run).read()).toBeNull();
    await expect(keychainStore(runner({ code: 1, stdout: "", stderr: "locked" }).run).read()).rejects.toThrow("keychain read failed (1): locked");
  });

  it("removes: true when something was there, false when not", async () => {
    expect(await keychainStore(runner({ code: 0, stdout: "", stderr: "" }).run).remove()).toBe(true);
    expect(await keychainStore(runner({ code: 44, stdout: "", stderr: "" }).run).remove()).toBe(false);
  });
});

const memfs = (files = {}, modes = {}) => ({
  files,
  modes,
  dirs: [],
  async readFile(p) {
    if (!(p in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return files[p];
  },
  async writeFile(p, text, opts) {
    files[p] = text;
    if (opts?.mode) modes[p] = opts.mode;
  },
  async stat(p) {
    if (!(p in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return { mode: modes[p] ?? 0o600 };
  },
  async chmod(p, mode) {
    modes[p] = mode;
  },
  async mkdir(p, opts) {
    this.dirs.push([p, opts]);
  },
  async unlink(p) {
    if (!(p in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    delete files[p];
  },
});

describe("dpapiStore (Windows)", () => {
  it("protects on write and unprotects on read through PowerShell, payload on stdin", async () => {
    const { run, calls } = runner((n) => ({ code: 0, stdout: n === 1 ? "QkxPQg==\n" : "plain\n", stderr: "" }));
    const fs = memfs();
    const dir = "C:\\Users\\me\\AppData\\Roaming\\mockd";
    const store = dpapiStore(run, fs, dir);
    await store.write("plain");
    expect(calls[0].cmd).toBe("powershell");
    expect(calls[0].args.join(" ")).toContain("ProtectedData]::Protect");
    expect(calls[0].input).toBe("plain");
    expect(fs.files[`${dir}\\credentials.dpapi`]).toBe("QkxPQg==");
    expect(await store.read()).toBe("plain");
    expect(calls[1].args.join(" ")).toContain("Unprotect");
    expect(calls[1].input).toBe("QkxPQg==");
  });

  it("reads null without a blob and removes true/false", async () => {
    const store = dpapiStore(runner({ code: 0, stdout: "", stderr: "" }).run, memfs(), "d");
    expect(await store.read()).toBeNull();
    expect(await store.remove()).toBe(false);
  });
});

describe("fileStore (Linux and the rest)", () => {
  const dir = "/home/me/.config/mockd";
  const file = `${dir}/credentials.json`;

  it("writes owner-only into a 0700 directory and reads it back", async () => {
    const fs = memfs();
    const store = fileStore(fs, dir);
    await store.write("text");
    expect(fs.dirs).toEqual([[dir, { recursive: true, mode: 0o700 }]]);
    expect(fs.modes[file]).toBe(0o600);
    expect(await store.read()).toBe("text");
  });

  it("refuses a file others can read instead of using it", async () => {
    const fs = memfs({ [file]: "text" }, { [file]: 0o644 });
    await expect(fileStore(fs, dir).read()).rejects.toThrow(UsageError);
    await expect(fileStore(fs, dir).read()).rejects.toThrow("readable by others (mode 644)");
  });

  it("reads null without a file and removes true/false", async () => {
    const fs = memfs({ [file]: "text" });
    const store = fileStore(fs, dir);
    expect(await store.remove()).toBe(true);
    expect(await store.read()).toBeNull();
    expect(await store.remove()).toBe(false);
  });
});

describe("storeFor", () => {
  it("maps the platform kind to one store, no other", () => {
    const deps = { run: async () => ({ code: 0, stdout: "", stderr: "" }), fs: memfs(), dir: "d" };
    expect(storeFor("keychain", deps).kind).toBe("keychain");
    expect(storeFor("dpapi", deps).kind).toBe("dpapi");
    expect(storeFor("file", deps).kind).toBe("file");
  });
});

describe("a profile's store", () => {
  it("is a keychain item of its own: every `security` call names mockd-client-access-dev", async () => {
    const { run, calls } = runner({ code: 0, stdout: "stored\n", stderr: "" });
    const store = storeFor("keychain", { run, fs: memfs(), dir: "/Users/me/.config/mockd-dev", profile: "dev" });
    expect(store.location).toBe("mockd-client-access-dev");
    await store.write("text");
    await store.read();
    await store.remove();
    expect(calls.map((c) => c.input.trim().split(" ").slice(0, 5).join(" "))).toEqual([
      "add-generic-password -a mockd -s mockd-client-access-dev",
      "find-generic-password -a mockd -s mockd-client-access-dev",
      "delete-generic-password -a mockd -s mockd-client-access-dev",
    ]);
  });

  it("keeps the real item without a profile", () => {
    const run = async () => ({ code: 0, stdout: "", stderr: "" });
    expect(storeFor("keychain", { run, fs: memfs(), dir: "d", profile: null }).location).toBe("mockd-client-access");
  });

  it("keeps the file and the DPAPI blob under the profile's folder, which cli.js hands in", () => {
    const run = async () => ({ code: 0, stdout: "", stderr: "" });
    const file = storeFor("file", { run, fs: memfs(), dir: "/home/me/.config/mockd-dev", profile: "dev" });
    expect(file.location).toBe("/home/me/.config/mockd-dev/credentials.json");
    const dpapi = storeFor("dpapi", { run, fs: memfs(), dir: "C:\\Users\\me\\AppData\\Roaming\\mockd-dev", profile: "dev" });
    expect(dpapi.location).toBe("C:\\Users\\me\\AppData\\Roaming\\mockd-dev\\credentials.dpapi");
  });
});
