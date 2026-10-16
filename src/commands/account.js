import { bearerOf } from "../core/credentials.js";
import { signInInBrowser } from "../core/device-login.js";
import { signOut } from "../core/sign-out.js";
import { withProfile } from "./entry.js";

// The read access: `login` gets it through the browser, `whoami` names who it belongs to,
// `logout` ends it. With it a machine can read runs, and the backend allows nothing else.

const me = (ctx, cred) => ctx.apiWith(bearerOf(cred))({ method: "GET", path: "/me" });

function person(d) {
  return `${d.name ?? "—"} <${d.email ?? "—"}>`;
}

// The code and the link go to stderr as they come; stdout keeps the answer, so `--json` stays
// parseable while the command waits. The browser hands the access out once, so it is stored
// on approval, before `/me` names who it is.
async function inBrowser(ctx) {
  const outcome = await signInInBrowser(ctx, {
    onCode: (code) => {
      ctx.note(`Confirm the code ${code.user_code} in the browser: ${code.verification_url}`);
      ctx.note("Waiting for the confirmation (Ctrl-C stops) …");
    },
    onBrowserError: (e) => ctx.note(`could not open the browser (${e.message}); open the link yourself`),
  });
  if (outcome.status === "denied") throw new Error("the sign-in was declined in the browser");
  if (outcome.status === "expired") throw new Error("the code expired before it was confirmed; run `mockd login` again");
  return outcome.credential;
}

const login = {
  usage: "mockd login",
  describe: "Give this machine read access: confirm a code in the browser. Runs can be read with it, nothing changed.",
  execute: async (_i, ctx) => {
    const cred = await inBrowser(ctx);
    return { ...(await me(ctx, cred)), client_id: cred.clientId, stored_in: ctx.store.kind };
  },
  render: (d) => `logged in as ${person(d)} with read access · client ${d.client_id} · stored in ${d.stored_in}`,
};

const whoami = {
  usage: "mockd whoami",
  describe: "Who the stored access identifies (and the profile, when one is set).",
  auth: true,
  execute: async (_i, ctx) => withProfile(await ctx.api({ method: "GET", path: "/me" }), ctx.profile),
  render: (d) =>
    [`${person(d)} · via ${d.provider ?? "—"} · tenant ${d.tenant?.name ?? "—"}`, d.profile && `profile ${d.profile}`]
      .filter(Boolean)
      .join(" · "),
};

// `logout` ends the access on the server (`DELETE /me/reader`) with the stored access, then
// removes it here (core/sign-out.js). A server that failed is exit 1, said after the access
// left this machine anyway.
const SERVER = {
  removed: "the access on the server is removed too",
  unknown: "the server knew this access no more",
  none: "the stored access was no read access, the server had none to remove",
};

const logout = {
  usage: "mockd logout",
  describe: "End this machine's read access: on the server and the stored copy here.",
  execute: async (_i, ctx) => {
    const o = await signOut(ctx);
    if (o.error) {
      const here = o.removed ? `logged out here (${ctx.store.kind})` : "nothing stored";
      throw new Error(`${here}, but the access on the server stays: ${o.error}. The person who owns the account can remove it in the web app`);
    }
    return { removed: o.removed, stored_in: ctx.store.kind, server: o.server };
  },
  render: (d) => (d.removed ? `logged out (${d.stored_in}); ${SERVER[d.server]}` : "nothing stored"),
};

export const account = { login, whoami, logout };
