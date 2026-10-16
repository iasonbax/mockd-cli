import { posix, win32 } from "node:path";

import { named } from "../platform/profile.js";
import { UsageError } from "./errors.js";
import { PRODUCT } from "./product.js";

// Where the credential rests, one store per platform (see platform/storeKind): the macOS
// keychain, Windows DPAPI, a 0600 file elsewhere. Every store speaks the same three verbs on a
// text (`read()` -> text | null, `write(text)`, `remove()` -> boolean) and never sees what
// the text means; `location` names the place for a person (the keychain item, the file). A
// secret never travels as a process argument (that is the process list and the shell
// history); it goes over stdin. A profile (platform/profile.js) has an access of its own: the
// keychain item `<product>-client-access-dev`, the files under its own folder.

const SERVICE = `${PRODUCT}-client-access`;
const ACCOUNT = PRODUCT;
const NOT_FOUND = 44; // `security`: "The specified item could not be found in the keychain."

const failed = (what, r) => new Error(`${what} failed (${r.code}): ${r.stderr.trim()}`);

export function keychainStore(run, profile) {
  const service = named(SERVICE, profile);
  const security = (command) => run("security", ["-i"], { input: `${command}\n` });
  return {
    kind: "keychain",
    location: service,
    async read() {
      const r = await security(`find-generic-password -a ${ACCOUNT} -s ${service} -w`);
      if (r.code === NOT_FOUND) return null;
      if (r.code !== 0) throw failed("keychain read", r);
      return r.stdout.trim() || null;
    },
    async write(text) {
      const r = await security(
        `add-generic-password -a ${ACCOUNT} -s ${service} -U -w ${JSON.stringify(text)}`
      );
      if (r.code !== 0) throw failed("keychain write", r);
    },
    async remove() {
      const r = await security(`delete-generic-password -a ${ACCOUNT} -s ${service}`);
      if (r.code === NOT_FOUND) return false;
      if (r.code !== 0) throw failed("keychain delete", r);
      return true;
    },
  };
}

const PROTECT =
  "Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd(); " +
  "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect(" +
  "[Text.Encoding]::UTF8.GetBytes($s),$null,'CurrentUser'))";
const UNPROTECT =
  "Add-Type -AssemblyName System.Security; $b=[Console]::In.ReadToEnd().Trim(); " +
  "[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect(" +
  "[Convert]::FromBase64String($b),$null,'CurrentUser'))";

const isMissing = (e) => e?.code === "ENOENT";

async function unlinkIfThere(fs, file) {
  try {
    await fs.unlink(file);
    return true;
  } catch (e) {
    if (isMissing(e)) return false;
    throw e;
  }
}

export function dpapiStore(run, fs, dir) {
  const file = win32.join(dir, "credentials.dpapi");
  const powershell = (script, input) =>
    run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { input });
  return {
    kind: "dpapi",
    location: file,
    async read() {
      let blob;
      try {
        blob = await fs.readFile(file, "utf8");
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
      const r = await powershell(UNPROTECT, blob);
      if (r.code !== 0) throw failed("DPAPI read", r);
      return r.stdout.trim() || null;
    },
    async write(text) {
      const r = await powershell(PROTECT, text);
      if (r.code !== 0) throw failed("DPAPI write", r);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file, r.stdout.trim(), "utf8");
    },
    remove: () => unlinkIfThere(fs, file),
  };
}

const OWNER_ONLY = 0o600;
const OTHERS = 0o077;

export function fileStore(fs, dir) {
  const file = posix.join(dir, "credentials.json");
  return {
    kind: "file",
    location: file,
    async read() {
      let stat;
      try {
        stat = await fs.stat(file);
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
      // Like ssh with a readable key: a file others can read is refused, not used.
      if (stat.mode & OTHERS) {
        const mode = (stat.mode & 0o777).toString(8);
        throw new UsageError(`${file} is readable by others (mode ${mode}); run chmod 600 on it`);
      }
      return (await fs.readFile(file, "utf8")) || null;
    },
    async write(text) {
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      await fs.writeFile(file, text, { encoding: "utf8", mode: OWNER_ONLY });
      await fs.chmod(file, OWNER_ONLY);
    },
    remove: () => unlinkIfThere(fs, file),
  };
}

export function storeFor(kind, { run, fs, dir, profile }) {
  if (kind === "keychain") return keychainStore(run, profile);
  if (kind === "dpapi") return dpapiStore(run, fs, dir);
  return fileStore(fs, dir);
}
