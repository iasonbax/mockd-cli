import { posix, win32 } from "node:path";

import { PRODUCT } from "../core/product.js";
import { named } from "./profile.js";

// The ONLY module that knows the operating system. Everything else asks here.

// Where the CLI keeps its files: the platform's convention for per-user configuration. macOS
// keeps the secret in the keychain, not here. A profile (platform/profile.js) has a folder of
// its own next to it: `mockd-dev`. The path is joined the way the given system writes it, so
// the answer does not depend on the system the code happens to run on.
export function configDir({ platform, env, home, profile }) {
  const folder = named(PRODUCT, profile);
  if (platform === "win32") return win32.join(env.APPDATA ?? win32.join(home, "AppData", "Roaming"), folder);
  return posix.join(env.XDG_CONFIG_HOME ?? posix.join(home, ".config"), folder);
}

// Which credential store the platform gets: one per system, no falling back to another.
export function storeKind(platform) {
  if (platform === "darwin") return "keychain";
  if (platform === "win32") return "dpapi";
  return "file";
}
