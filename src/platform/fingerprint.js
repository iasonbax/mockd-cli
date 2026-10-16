import { createHash } from "node:crypto";

// The machine fingerprint the playground asks for when it mints an address or a run. The
// backend turns it, together with the network, into the key that stops a second run from the
// same machine inside the 24-hour lock. So the traits must stay the same from one call to the
// next, and when they cannot be read there is no random stand-in: a fresh value per call would
// be exactly the way around the lock.
//
// The traits: the operating system's machine id (readable without elevated rights), platform
// and architecture. The hostname stays out: macOS changes it with the network, and anyone can
// change it with one command. Nothing is stored. The id leaves the machine only inside the
// hash, under a label of this tool's own, so the value matches no other program's hash of that id.

// The label is a protocol value, not the product's name: renaming the product must not hand
// every machine a new fingerprint, which would reset every lock at once.
const LABEL = "mockd/try/fingerprint/v1";
const MACHINE_ID_FILE = "/etc/machine-id";

// A command that prints the id; its exit code and its output are checked, never guessed.
async function fromCommand(run, [command, args], pattern) {
  const r = await run(command, args);
  if (r.code !== 0) throw new Error(`${command} exited with ${r.code}: ${r.stderr.trim()}`);
  const found = pattern.exec(r.stdout);
  if (!found) throw new Error(`${command} printed no machine id`);
  return found[1];
}

const IOREG = ["ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]];
// `/reg:64`: a 32-bit process would otherwise read the WOW64 view, which has no MachineGuid.
const REG = ["reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid", "/reg:64"]];

// Where the machine id comes from: one source per system, no falling back to another (like
// `storeKind`). A source that fails is an error, not a reason to try the next one.
export function machineIdSource(platform) {
  if (platform === "darwin") {
    return {
      name: "IOPlatformUUID (ioreg)",
      read: ({ run }) => fromCommand(run, IOREG, /"IOPlatformUUID" = "([^"]+)"/),
    };
  }
  if (platform === "win32") {
    return {
      name: "MachineGuid (registry)",
      read: ({ run }) => fromCommand(run, REG, /MachineGuid\s+REG_SZ\s+(\S+)/),
    };
  }
  return {
    name: MACHINE_ID_FILE,
    read: ({ readFile }) => readFile(MACHINE_ID_FILE),
    // Many container images ship none (Alpine never does). The host's own id is the only one
    // that keeps the lock honest; a generated one would be a fresh machine per container.
    hint: "A container without one can mount the host's: -v /etc/machine-id:/etc/machine-id:ro",
  };
}

// The error names the source, the cause and the ways that remain; it never picks one itself.
function unreadable(source, why) {
  const hint = source.hint ? ` ${source.hint}.` : "";
  return new Error(
    `cannot read this machine's id from ${source.name}: ${why}. The playground allows one run ` +
      `per machine and mockd sends no random stand-in.${hint}`
  );
}

// The machine id, trimmed; an empty one is as unreadable as a missing one.
export async function readMachineId({ platform, readFile, run }) {
  const source = machineIdSource(platform);
  let id;
  try {
    id = (await source.read({ readFile, run })).trim();
  } catch (e) {
    throw unreadable(source, e.message);
  }
  if (!id) throw unreadable(source, "it is empty");
  return id;
}

// 64 lowercase hex characters (SHA-256), the form the backend requires.
export async function machineFingerprint({ platform, arch, readFile, run }) {
  const id = await readMachineId({ platform, readFile, run });
  return createHash("sha256").update([LABEL, platform, arch, id].join("\n")).digest("hex");
}
