// The shape every command shares:
//   usage     the line shown in `--help` and `mockd commands`
//   describe  one sentence for the same two places
//   auth      the command reads an account and needs the stored (or the environment's) access
//   flags     the non-global flags this command reads; any other given flag is a usage error
//   args      (positionals, values) -> command-specific intent fields; throws UsageError
//   execute   (intent, ctx) -> data; ctx is the world cli.js builds (api, store, env, …)
//   render    (data, env) -> human text (`--json` prints `data` unchanged)

// Most commands are one request against the API; this turns a request shape into `execute`.
export const viaApi = (request) => (intent, ctx) => ctx.api(request(intent));

// Under a profile (platform/profile.js) an answer names it; without one it stays as it was.
export const withProfile = (data, profile) => (profile ? { ...data, profile } : data);

// `?a=1&b=2` from the values that were given; nothing when none was.
export function query(params) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) q.set(key, value);
  }
  const text = q.toString();
  return text ? `?${text}` : "";
}
