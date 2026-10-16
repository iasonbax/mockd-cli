// Renderers the playground and the account's runs share: a trace, the dataset changes, a diff.
// Both sides answer with the same shapes (`TraceEvent`, `DatasetChanges`, the diff), so one
// renderer each: a second copy would drift with the first change.

// An API timestamp in a table: seconds are enough, milliseconds and the T are noise.
export const when = (iso) => (iso ? iso.replace("T", " ").slice(0, 19) : "—");

export function renderTrace(data) {
  if (!data.length) return "(no calls yet)";
  return data
    .map(
      (t) =>
        `#${t.sequence} ${t.tool_name}  ${t.status}  ${Math.round(t.latency_ms)}ms` +
        (t.scenario !== "none" ? ` [${t.scenario}]` : "")
    )
    .join("\n");
}

export function renderChanges(d) {
  const head =
    `${d.added} added · ${d.changed} changed · ${d.removed} removed` +
    (d.materialized ? "" : " (no calls yet)");
  const lines = d.records.map(
    (r) =>
      `${r.op.padEnd(8)} ${r.collection} ${r.id ?? ""}` +
      (r.fields.length ? `  [${r.fields.join(", ")}]` : "")
  );
  if (d.truncated) lines.push("…");
  return [head, ...lines].join("\n");
}

const MARK = { equal: "=", changed: "~", added: "+", removed: "-" };

export function renderDiff(d) {
  if (!d.comparable) return `not comparable: ${d.a_token} vs ${d.b_token}`;
  if (!d.steps.length) return "(no steps)";
  return d.steps
    .map((s) => {
      const tool = (s.a ?? s.b)?.tool_name ?? "?";
      const change = s.op === "changed" ? `  ${s.a?.status} → ${s.b?.status}` : "";
      return `${MARK[s.op]} ${tool}${change}`;
    })
    .join("\n");
}
