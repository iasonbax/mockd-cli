// The machine's name as the system shows it to its person: the name the sign-in sends, and the
// one the person recognizes when confirming it. On macOS that is the computer name of the
// settings, not the network name the host name carries ("MacBook-Pro-von-Ada.local"), which
// nobody recognizes there.
//
// One source per system, like the machine id (fingerprint.js): a source that cannot be read is
// an error with its cause, never a name from somewhere else. A stand-in would put a name on the
// confirmation page that the person does not know as this machine's.

// A command that prints the name; its exit code is checked, its output trimmed.
async function printed(run, [command, args]) {
  const r = await run(command, args);
  if (r.code !== 0) throw new Error(`${command} exited with ${r.code}: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

const SCUTIL = ["scutil", ["--get", "ComputerName"]];
const HOSTNAMECTL = ["hostnamectl", ["--pretty"]];

export function machineNameSource(platform) {
  if (platform === "darwin") {
    return {
      name: "scutil --get ComputerName",
      read: ({ run }) => printed(run, SCUTIL),
      hint: "Name it in System Settings › General › About",
    };
  }
  if (platform === "win32") {
    return {
      name: "COMPUTERNAME",
      async read({ env }) {
        if (env.COMPUTERNAME === undefined) throw new Error("it is not set");
        return env.COMPUTERNAME;
      },
    };
  }
  return {
    name: "hostnamectl --pretty",
    // machine-info(5): the pretty host name is optional, and where it is not set the host name
    // is the one to show. That is the system's own rule for an answer, not a second way: a
    // hostnamectl that fails or is missing stays an error.
    async read({ run, hostname }) {
      const pretty = await printed(run, HOSTNAMECTL);
      return pretty === "" ? hostname : pretty;
    },
    hint: "On Linux mockd reads the name systemd keeps; a system without systemd has none to read",
  };
}

function unreadable(source, why) {
  const hint = source.hint ? `. ${source.hint}` : "";
  return new Error(
    `cannot read this machine's name from ${source.name}: ${why}. mockd names the machine as the ` +
      `system shows it and sends no other name${hint}`
  );
}

/**
 * The name, trimmed; an empty one is as unreadable as a missing one. `hostname` is the kernel's
 * host name (what `hostname` prints), which only Linux takes, when no pretty name is set.
 */
export async function readMachineName({ platform, env, run, hostname }) {
  const source = machineNameSource(platform);
  let name;
  try {
    name = (await source.read({ env, run, hostname: hostname ?? "" })).trim();
  } catch (e) {
    throw unreadable(source, e.message);
  }
  if (!name) throw unreadable(source, "it is empty");
  return name;
}
