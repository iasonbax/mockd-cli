import { serializeCredential, validateCredential } from "./credentials.js";
import { ApiError } from "./errors.js";
import { machineField, osField, userField } from "./machine.js";

// Sign-in in the browser, the device-code pattern of RFC 8628: the CLI asks for a code, a
// person confirms it in the web app, the CLI picks up its read access, once. The door is the
// reader's own (`/public/reader/…`): what comes out of it can read runs and nothing else, and
// the backend enforces that, not this client. Both routes are open doors (`/public/`), there is
// no credential yet; the answer carries a secret, so the API comes with the https rule
// (`ctx.secureApi`). Everything here gets its I/O handed in, so the specs drive it offline.

const CODE_PATH = "/public/reader/login";
const TOKEN_PATH = "/public/reader/login/token";

// RFC 8628 §3.5: every "slow down" (here a 429) adds five seconds to the interval.
export const SLOW_DOWN_SECONDS = 5;

// The refusals of the token route come as HTTP errors; pending and approved come as a body.
const REFUSED = { 429: "slow_down", 403: "denied", 404: "expired" };

// The link is opened on this machine, so it must be a web address and nothing else.
function isWebAddress(value) {
  if (typeof value !== "string") return false;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const CODE_FIELDS = {
  device_code: (v) => typeof v === "string" && v !== "",
  user_code: (v) => typeof v === "string" && v !== "",
  verification_url: isWebAddress,
  interval: (v) => Number.isFinite(v) && v > 0,
  expires_in: (v) => Number.isFinite(v) && v > 0,
};

// A code without its interval would poll without pause; an answer that misses a field is an
// error, not a default.
function checkedCode(code) {
  const missing = Object.entries(CODE_FIELDS)
    .filter(([field, ok]) => !ok(code?.[field]))
    .map(([field]) => field);
  if (missing.length) {
    throw new Error(`unexpected answer from POST ${CODE_PATH}: no valid ${missing.join(", ")}`);
  }
  return code;
}

export async function requestCode(api, { machine, os, user }) {
  return checkedCode(await api({ method: "POST", path: CODE_PATH, body: { machine, os, os_user: user } }));
}

// One look at the token route: pending, slow_down, denied, expired, or approved with the
// client access. Anything else is an error; the answer is not echoed, it may hold a secret.
export async function checkCode(api, deviceCode) {
  let answer;
  try {
    answer = await api({ method: "POST", path: TOKEN_PATH, body: { device_code: deviceCode } });
  } catch (e) {
    const status = e instanceof ApiError ? REFUSED[e.status] : undefined;
    if (status) return { status };
    throw e;
  }
  if (answer?.status === "pending") return { status: "pending" };
  if (answer?.status === "approved") return { status: "approved", credential: approved(answer) };
  throw new Error(`unexpected answer from POST ${TOKEN_PATH} (status ${answer?.status})`);
}

// The server's answer, not the user's input: a bad pair is a runtime error, not a usage one.
function approved(answer) {
  try {
    return validateCredential({ clientId: answer.client_id, secret: answer.secret });
  } catch (e) {
    throw new Error(`unexpected answer from POST ${TOKEN_PATH}: ${e.message}`, { cause: e });
  }
}

// Asks every `interval` seconds until the person decided or the code ran out. The code's own
// lifetime bounds the wait, as RFC 8628 asks of a client; the server's 404 usually says it first.
export async function awaitApproval(api, code, { sleep }) {
  let interval = code.interval;
  let waited = 0;
  while (waited < code.expires_in) {
    await sleep(interval * 1000);
    waited += interval;
    const outcome = await checkCode(api, code.device_code);
    if (outcome.status === "slow_down") interval += SLOW_DOWN_SECONDS;
    else if (outcome.status !== "pending") return outcome;
  }
  return { status: "expired" };
}

// The whole way in for `mockd login`: a code, the browser, the wait, and on approval the access
// in this machine's store. The web app names the sign-in after the machine as its system shows
// it (platform/machine-name.js) and the user it was made as; a machine whose name or user
// cannot be read asks for no code.
//   onCode(code)          the code is there: show it and the link
//   onBrowserError(error) the browser did not open; the link on screen is the way then
// The browser is not awaited before the wait: xdg-open may hold until the browser closes.
export async function signInInBrowser(ctx, { onCode, onBrowserError }) {
  const api = ctx.secureApi();
  const machine = machineField(await ctx.machine.name());
  const user = userField(ctx.machine.user());
  const code = await requestCode(api, { machine, os: osField(ctx.machine.platform), user });
  onCode(code);
  ctx.browser.open(code.verification_url).catch(onBrowserError);
  const outcome = await awaitApproval(api, code, { sleep: ctx.machine.sleep });
  if (outcome.status === "approved") await ctx.store.write(serializeCredential(outcome.credential));
  return outcome;
}
