import { ApiError, UsageError } from "./errors.js";

// What an installed mockd talks to: a file downloaded from mock-d.com has no backend on
// localhost. A local one is named explicitly, `MOCKD_API_URL=http://localhost:8000` or
// `--api http://localhost:8000`.
export const DEFAULT_API = "https://api.mock-d.com";

// A request that has not been answered after this long is a backend that cannot be reached, as
// far as a person or an agent waiting for the command is concerned.
export const REQUEST_TIMEOUT_MS = 30_000;

// The guide, the playground and the catalog are open doors; the access goes to every other path.
const OPEN = ["/public/", "/catalog/"];
const needsAuth = (path) => !OPEN.some((prefix) => path.startsWith(prefix));

const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// A secret over plain http is a leak, not a request, except on the own machine. It goes out
// as the bearer, or comes back in an answer (`secure`: the sign-in in the browser).
function checkedBase(base, secret) {
  const root = base.replace(/\/$/, "");
  if (!/^https?:\/\//.test(root)) {
    throw new UsageError(`the API address must start with https:// (or http:// for a local backend), got "${base}"`);
  }
  if (secret && root.startsWith("http://") && !LOCAL.test(root)) {
    throw new UsageError(`refusing to move the client secret over ${root}; use https://`);
  }
  return root;
}

// The body's type and the bearer are this module's, and no request overrides them.
function headersFor(body, bearer, path) {
  const headers = {};
  if (body) headers["content-type"] = "application/json";
  if (bearer && needsAuth(path)) headers.authorization = bearer;
  return Object.keys(headers).length ? headers : undefined;
}

// The API's own error text (`detail`) is surfaced unchanged: it is written for the caller,
// agent or human. An error's body is JSON for the API's own answers, anything for a proxy's page.
function failure(res, text) {
  let detail = text || res.statusText;
  try {
    detail = JSON.parse(text)?.detail ?? text;
  } catch {
    // Not JSON: the text is the detail.
  }
  return new ApiError(res.status, detail);
}

// The backend did not answer: name it and the reason the system gives, so an agent can tell a
// missing connection from a refusal.
function unreachable(root, error) {
  if (error?.name === "TimeoutError") {
    return new Error(`cannot reach ${root}: no answer within ${REQUEST_TIMEOUT_MS / 1000} seconds`, { cause: error });
  }
  const reason = error?.cause?.message ?? error?.message ?? String(error);
  return new Error(`cannot reach ${root}: ${reason}`, { cause: error });
}

async function exchange(fetchImpl, root, url, init) {
  try {
    const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    return { res, text: await res.text() };
  } catch (e) {
    throw unreachable(root, e);
  }
}

function parsed(text, { method, path }) {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`unexpected answer from ${method} ${path}: not JSON (${e.message})`, { cause: e });
  }
}

/**
 * The adapter to the backend and the only module that speaks HTTP. `fetchImpl` is injected,
 * so the specs drive the whole command chain without a network.
 */
export function makeApi(fetchImpl, base, { bearer, secure = false } = {}) {
  const root = checkedBase(base, Boolean(bearer) || secure);
  return async function request({ method, path, body }) {
    const { res, text } = await exchange(fetchImpl, root, root + path, {
      method,
      headers: headersFor(body, bearer, path),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw failure(res, text);
    return text ? parsed(text, { method, path }) : null;
  };
}
