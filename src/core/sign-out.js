import { bearerOf, parseCredential } from "./credentials.js";
import { ApiError } from "./errors.js";

// Signing out: the read access on the server first (`DELETE /me/reader`, the one thing a read
// access may write: its own end), while there is still an access to ask with, then the access
// in this machine's store. Only the stored access is signed out; one from the environment is
// not mockd's to remove.
//
// The access leaves this machine in every case: signing out must not depend on the network.
// What the server did is part of the answer, and a failure there is `error`, for the caller to
// say: the access then stays on the server, where the person who owns the account can remove it.

export const READER_PATH = "/me/reader";

// 204 removed it. Two answers leave nothing there to remove: 401, the server knows the access
// no more (removed there already), and 403, the access is no read access, so the route is not
// its own (a client access typed into the environment, say). Anything else is a failure with
// its reason.
const NOTHING_THERE = { 401: "unknown", 403: "none" };

async function removeOnServer(api) {
  try {
    await api({ method: "DELETE", path: READER_PATH });
    return { server: "removed", error: null };
  } catch (e) {
    const state = e instanceof ApiError ? NOTHING_THERE[e.status] : undefined;
    return state ? { server: state, error: null } : { server: "failed", error: e.message };
  }
}

// The stored access, or why it cannot be used to ask the server.
function readable(text) {
  try {
    return { credential: parseCredential(text), error: null };
  } catch (e) {
    return { credential: null, error: `the stored access is unreadable (${e.message}), so the server was not asked` };
  }
}

/**
 * `{ removed, server, error }`: removed says whether an access was stored; server is "removed",
 * "unknown" (the server knew it no more), "none" (it was no read access), "failed" (see error)
 * or null when nothing was stored.
 */
export async function signOut({ store, apiWith }) {
  const text = await store.read();
  if (!text) return { removed: false, server: null, error: null };
  const { credential, error } = readable(text);
  const outcome = credential ? await removeOnServer(apiWith(bearerOf(credential))) : { server: "failed", error };
  await store.remove();
  return { removed: true, ...outcome };
}
