// Exit codes are part of a CLI's contract: 0 success, 1 runtime error (e.g. HTTP), 2 usage
// error (with the usage text). Everything that ends a run goes through these two classes.
export const EXIT = { OK: 0, RUNTIME: 1, USAGE: 2 };

export class UsageError extends Error {}

// A structured `detail` (`{reason, …}`) is shown as JSON, never as "[object Object]"; a command
// that knows the reason passes its own sentence as `said` and keeps status and detail as data.
export const shown = (detail) => (typeof detail === "string" ? detail : JSON.stringify(detail));

export class ApiError extends Error {
  constructor(status, detail, said = shown(detail)) {
    super(`HTTP ${status}: ${said}`);
    this.status = status;
    this.detail = detail;
  }
}
