import { UsageError } from "../core/errors.js";

// A profile keeps a second setup apart from the real one on the same machine: a test against
// a local backend (MOCKD_PROFILE=dev) must neither sign the real access out nor read the real
// playground list. Everything the CLI owns on the machine carries the profile's name: its
// folder and its keychain item. Without MOCKD_PROFILE every name is the one it always was.

const NAME = /^[a-z0-9-]{1,20}$/;

// The profile in force, or null. cli.js reads it once from the injected environment and hands
// it on; a value that is no name is a usage error, never "no profile": an empty or mistyped
// profile must not land in the real setup.
export function profileOf(env) {
  const name = env.MOCKD_PROFILE;
  if (name === undefined) return null;
  if (!NAME.test(name)) {
    throw new UsageError(`MOCKD_PROFILE "${name}" is no profile name: 1 to 20 characters of a-z, 0-9 and -`);
  }
  return name;
}

// The name of something the CLI owns, in the profile's copy: `mockd` → `mockd-dev`. Without a
// profile, the name as it is.
export const named = (base, profile) => (profile ? `${base}-${profile}` : base);
