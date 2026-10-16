import { UsageError } from "./errors.js";

// The client access: a public client id plus a secret, sent as one bearer. `mockd login` stores
// one; a script or a container names one in the environment.

export const CLIENT_ID_PREFIX = "mk_";

export function bearerOf({ clientId, secret }) {
  return `Bearer ${clientId}.${secret}`;
}

export function serializeCredential(cred) {
  return JSON.stringify({ client_id: cred.clientId, secret: cred.secret });
}

export function parseCredential(text) {
  if (!text) return null;
  const data = JSON.parse(text);
  if (typeof data.client_id !== "string" || typeof data.secret !== "string") {
    throw new UsageError("stored credential is unreadable; run `mockd logout` and `mockd login`");
  }
  return { clientId: data.client_id, secret: data.secret };
}

export function validateCredential({ clientId, secret }) {
  if (!clientId?.startsWith(CLIENT_ID_PREFIX)) {
    throw new UsageError(`a client id starts with "${CLIENT_ID_PREFIX}", got "${clientId ?? ""}"`);
  }
  if (!secret) throw new UsageError("the secret is empty");
  return { clientId, secret };
}

// Environment first (CI, containers), then the platform's store. A fixed order, not a
// fallback: one variable alone is a mistake, not "use the store instead".
export function fromEnv(env) {
  const clientId = env.MOCKD_CLIENT_ID;
  const secret = env.MOCKD_CLIENT_SECRET;
  if (!clientId && !secret) return null;
  if (!clientId || !secret) {
    throw new UsageError("set both MOCKD_CLIENT_ID and MOCKD_CLIENT_SECRET, or neither");
  }
  return validateCredential({ clientId, secret });
}

// The access in force. The store is not opened when the environment has one.
export async function resolveCredential({ env, store }) {
  return fromEnv(env) ?? parseCredential(await store.read());
}

// The commands that read an account need one; the message names both ways to get it.
export function requireCredential(cred) {
  if (!cred) throw new UsageError("not logged in; run `mockd login` or set MOCKD_CLIENT_ID and MOCKD_CLIENT_SECRET");
  return cred;
}
