// The "Travel to book" email body, grouped by EVENT (Drew, Oct 9 2026: "segment
// them by event instead of person"). One section per tournament in date order —
// when, where, flights or not — with every coach who still needs travel there,
// her team, and a warning if she's also due somewhere else that weekend.
// Used by api/travel-gap-alert.js (daily cron) and scripts/coach-travel-gaps.mjs.
//
// gaps: [{ coach, team, t: { id, name, start_date, end_date, location }, far, clash? }]

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const day = (iso) => {
  try { return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }); }
  catch { return iso; }
};
export const tripSpan = (a, b) => {
  if (!b || b === a) return day(a);
  const A = day(a), B = day(b), sameMonth = String(a).slice(0, 7) === String(b).slice(0, 7);
  return A + "–" + (sameMonth ? B.replace(/^\w+, \w+ /, "") : B.replace(/^\w+, /, ""));
};

export function groupByEvent(gaps) {
  const by = new Map();
  for (const g of gaps) {
    const k = g.t.id;
    if (!by.has(k)) by.set(k, { t: g.t, far: !!g.far, rows: [] });
    by.get(k).rows.push(g);
  }
  return [...by.values()]
    .map(e => ({ ...e, rows: e.rows.sort((a, b) => String(a.team).localeCompare(String(b.team)) || String(a.coach).localeCompare(String(b.coach))) }))
    .sort((a, b) => String(a.t.start_date).localeCompare(String(b.t.start_date)) || String(a.t.name).localeCompare(String(b.t.name)));
}

export function travelSections(gaps) {
  const events = groupByEvent(gaps);
  const html = events.map(e => {
    const n = e.rows.length;
    return `<div style="margin:22px 0 0;border:1px solid #eee;border-radius:10px;overflow:hidden">`
      + `<div style="background:#faf5f8;padding:10px 12px">`
      + `<div style="font-weight:700;font-size:15px">${esc(String(e.t.name).trim())}</div>`
      + `<div style="font-size:13px;color:#555">${esc(tripSpan(e.t.start_date, e.t.end_date))} · ${esc(e.t.location || "")}`
      + `${e.far ? ' · <b style="color:#b62d2d">flights</b>' : ""} · ${n} coach${n === 1 ? "" : "es"} to book</div></div>`
      + `<table style="border-collapse:collapse;width:100%;font-size:14px"><tbody>`
      + e.rows.map(g => `<tr><td style="padding:7px 12px;border-top:1px solid #eee;font-weight:600">${esc(g.coach)}</td>`
        + `<td style="padding:7px 12px;border-top:1px solid #eee;white-space:nowrap;color:#555">${esc(g.team)}`
        + `${g.clash ? `<div style="color:#9a6510;font-size:12.5px;margin-top:2px;white-space:normal">also due at ${esc(g.clash)} that weekend — confirm which before booking</div>` : ""}</td></tr>`).join("")
      + `</tbody></table></div>`;
  }).join("");
  const text = events.map(e =>
    `${String(e.t.name).trim()} — ${tripSpan(e.t.start_date, e.t.end_date)}, ${e.t.location || ""}${e.far ? " (FLIGHTS)" : ""}\n`
    + e.rows.map(g => `  ${g.coach} (${g.team})${g.clash ? ` - also due at ${g.clash}, confirm which` : ""}`).join("\n")
  ).join("\n\n");
  return { html, text, events: events.length };
}
