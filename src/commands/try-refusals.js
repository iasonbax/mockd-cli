import { ApiError } from "../core/errors.js";

// The playground's refusals in words a person or an agent can act on. The reason is the
// contract; the API's own sentence is written for the website's try page, so the CLI speaks
// from the reason, keeps the moment and names the reason at the end for scripts.

const mockOf = (intent) => intent.mockId ?? "the mock of this address";

// A run that ends does not free its address or its machine: both stay locked for 24 hours
// after the end, however the run ended. While the run still goes there is no moment yet, so
// the sentence names the span; every moment comes from `reopens_at`.
const AFTER_THE_END = "24 hours after it ends";

const SENTENCES = {
  // `reopens_at` is null while that other run is still going, else the end of its lock.
  address_in_use: (d, i) =>
    d.reopens_at
      ? `this machine already had a playground run on ${mockOf(i)}; the next one can start at ${d.reopens_at}`
      : `this machine already has a playground run on ${mockOf(i)} that is still going; the next one can start ${AFTER_THE_END}`,
  address_closed: (d) => `this address is closed; its next run can start at ${d.reopens_at}`,
  mock_not_free: (d, i) =>
    `${mockOf(i)} is not free on the playground; only a few mocks are, the others need an account (https://mock-d.com)`,
};

// The refusal as a sentence, or null when the error is not one the playground names.
export function refusalOf(error, intent) {
  if (!(error instanceof ApiError)) return null;
  const reason = error.detail?.reason;
  const sentence = Object.hasOwn(SENTENCES, reason) ? SENTENCES[reason] : null;
  if (!sentence) return null;
  return new ApiError(error.status, error.detail, `${sentence(error.detail, intent)} (${reason})`);
}

// Wraps a playground command's `execute`: a known refusal leaves as its sentence (still an
// ApiError, exit 1), everything else unchanged.
export const explained = (execute) => async (intent, ctx) => {
  try {
    return await execute(intent, ctx);
  } catch (e) {
    throw refusalOf(e, intent) ?? e;
  }
};
