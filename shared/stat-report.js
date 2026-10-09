// Performance testing report — the email Coach Brandon sends a family after
// testing (Drew, Oct 9 2026). One builder for the app's live preview and the
// server's send (api/stat-report.js), so what Brandon sees is what goes out.
//
//   metricRows(player, tests)  -> [{ key, label, baseline, baselineFrom, latest, latestFrom, change, better }]
//   buildReport({ player, tests, settings, draft, parentFirst }) -> { subject, html, text }
//
// Baseline = the first result on file (tryouts, else the first test); latest =
// the most recent test. "Better" respects direction (10-yard: lower is better).

export const METRICS = [
  // key, label, unit, higherIsBetter, tryout column
  ["stand_reach", "Standing reach", "in", true, "stand_reach"],
  ["approach_touch", "Approach touch", "in", true, "approach_touch"],
  ["standing_touch", "Standing jump touch", "in", true, "jump_touch"],
  ["vertical", "Approach vertical", "in", true, null],
  ["broad_jump", "Broad jump", "in", true, null],
  ["dash_10y", "10-yard sprint", "sec", false, "sprint_10y"],
];

export const DEFAULT_SETTINGS = {
  subject: "{player_first}'s performance testing results",
  intro: "I'm Coach Brandon, and I run performance training at Dripping Springs Sports Club. I tested {player_first} with her {team} teammates, and I wanted to share where she is right now and where she's already improved.",
  pitch: "If {player_first} wants to keep building on this, we've just launched Reach Performance memberships at DSSC: ongoing speed, strength and jump training built for volleyball players, with regular re-testing so you can watch the numbers move. I'd love to work with her. Reply to this email with any questions, or tap below to learn more.",
  pitch_button: "Learn about Reach memberships",
  pitch_link: "",
  signoff: "Coach Brandon\nPerformance Coach, Reach at DSSC",
  // The metrics section — all editable in the template.
  numbers_heading: "{player_first}'s numbers",
  col_test: "Test", col_baseline: "Baseline", col_now: "Now", col_change: "Change",
  show_gains: true,
  gains_text: "Where {player_first} got better:",
  worked_heading: "What we worked on",
  pitch_heading: "Reach Performance",
  default_metrics: [],          // empty = every metric on file
};

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtDate = (iso) => { try { return new Date(String(iso).slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); } catch { return String(iso || ""); } };
const ftIn = (n) => { const r = Math.round(n * 2) / 2; const f = Math.floor(r / 12), i = r - f * 12; return f ? `${f}' ${i % 1 ? i.toFixed(1) : i}"` : `${i}"`; };
export const fmtMetric = (key, v) => {
  if (v == null) return "—";
  const unit = METRICS.find(m => m[0] === key)?.[2];
  if (unit === "sec") return v.toFixed(2) + "s";
  if (key === "vertical" || key === "broad_jump") return (Math.round(v * 2) / 2) + '"';
  return ftIn(v);
};
const fmtChange = (key, d) => {
  const unit = METRICS.find(m => m[0] === key)?.[2];
  const s = d > 0 ? "+" : d < 0 ? "−" : "±";
  return unit === "sec" ? s + Math.abs(d).toFixed(2) + "s" : s + (Math.round(Math.abs(d) * 2) / 2) + '"';
};

export function metricRows(player, tests = []) {
  const sr = num(player?.stand_reach), ap = num(player?.approach_touch);
  const tryout = { from: "Tryouts", stand_reach: sr, approach_touch: ap, standing_touch: num(player?.jump_touch), vertical: sr != null && ap != null ? ap - sr : null, broad_jump: null, dash_10y: num(player?.sprint_10y) };
  const sorted = [...tests].sort((a, b) => String(a.test_date).localeCompare(String(b.test_date)));
  let reach = sr;
  const rows = sorted.map(t => {
    const r = { from: fmtDate(t.test_date) };
    for (const [k] of METRICS) r[k] = num(t[k]);
    if (r.stand_reach != null) reach = r.stand_reach;
    if (r.vertical == null && r.approach_touch != null && reach != null) r.vertical = r.approach_touch - reach;
    return r;
  });
  const all = [tryout, ...rows];
  return METRICS.map(([key, label, , up]) => {
    const has = all.filter(x => x[key] != null);
    if (!has.length) return null;
    const a = has[0], b = has.length > 1 ? has[has.length - 1] : null;
    const change = b ? b[key] - a[key] : null;
    return { key, label, baseline: a[key], baselineFrom: a.from, latest: b ? b[key] : null, latestFrom: b ? b.from : null,
      // A real change, not noise: a quarter inch, or two hundredths of a second.
      // Standing reach is growth, not training, so it is never called "better".
      change, better: (() => { if (change == null || key === "stand_reach") return null; const min = METRICS.find(m => m[0] === key)[2] === "sec" ? 0.02 : 0.25; if (Math.abs(change) < min) return null; return up ? change > 0 : change < 0; })() };
  }).filter(Boolean);
}

const fill = (t, v) => String(t || "").replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m));

export function buildReport({ player, tests, settings, draft, parentFirst }) {
  const S = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const team = String(player?.team_assignment || "").replace(/ 1$/, "");
  const vars = { player_first: String(player?.first_name || "").trim(), team: team || "DS Elite", parent_first: parentFirst || "" };
  const all = metricRows(player, tests);
  const want = Array.isArray(draft?.metrics) && draft.metrics.length ? draft.metrics : (Array.isArray(S.default_metrics) && S.default_metrics.length ? S.default_metrics : null);
  const picked = want ? all.filter(r => want.includes(r.key)) : all;
  const gains = picked.filter(r => r.better === true);
  const subject = fill(S.subject, vars);
  const greet = parentFirst ? `Hi ${parentFirst},` : "Hi,";
  const para = (t) => fill(t, vars).split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const intro = para(S.intro), pitch = para(S.pitch);
  const worked = String(draft?.worked_on || "").trim(), note = String(draft?.note || "").trim();
  const anyLatest = picked.some(r => r.latest != null);

  // ── HTML ──
  const P = (t) => `<p style="margin:0 0 14px">${esc(t).replace(/\n/g, "<br>")}</p>`;
  const row = (r) => {
    const tint = r.better === true ? "background:#ecfdf3" : "";
    return `<tr style="${tint}"><td style="padding:9px 10px;border-top:1px solid #eee;font-weight:600">${esc(r.label)}</td>`
      + `<td style="padding:9px 10px;border-top:1px solid #eee;text-align:right;white-space:nowrap">${esc(fmtMetric(r.key, r.baseline))}<div style="font-size:11px;color:#888">${esc(r.baselineFrom)}</div></td>`
      + (anyLatest ? `<td style="padding:9px 10px;border-top:1px solid #eee;text-align:right;white-space:nowrap;font-weight:700">${r.latest == null ? "—" : esc(fmtMetric(r.key, r.latest))}${r.latestFrom ? `<div style="font-size:11px;color:#888;font-weight:400">${esc(r.latestFrom)}</div>` : ""}</td>`
        + `<td style="padding:9px 10px;border-top:1px solid #eee;text-align:right;white-space:nowrap;font-weight:700;color:${r.better === true ? "#15803d" : "#666"}">${r.change == null ? "" : esc(fmtChange(r.key, r.change)) + (r.better === true ? " ▲" : "")}</td>` : "")
      + `</tr>`;
  };
  const table = picked.length
    ? `<table style="border-collapse:collapse;width:100%;font-size:14px;margin:4px 0 16px"><thead><tr style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#888">`
      + `<th style="text-align:left;padding:6px 10px">${esc(S.col_test)}</th><th style="text-align:right;padding:6px 10px">${esc(S.col_baseline)}</th>${anyLatest ? `<th style="text-align:right;padding:6px 10px">${esc(S.col_now)}</th><th style="text-align:right;padding:6px 10px">${esc(S.col_change)}</th>` : ""}</tr></thead><tbody>`
      + picked.map(row).join("") + `</tbody></table>`
    : "";
  const gainLine = S.show_gains !== false && gains.length ? `${fill(S.gains_text, vars)} ${gains.map(g => `${g.label} (${fmtChange(g.key, g.change)})`).join(", ")}.` : "";
  const H = (t) => `<p style="margin:22px 0 8px;font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#c2186f">${esc(t)}</p>`;
  const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:620px">'
    + P(greet) + intro.map(P).join("")
    + (picked.length ? H(fill(S.numbers_heading, vars)) + table : "")
    + (gainLine ? `<p style="margin:0 0 14px;padding:10px 12px;background:#ecfdf3;border-radius:8px;color:#14532d;font-weight:600">${esc(gainLine)}</p>` : "")
    + (worked ? H(fill(S.worked_heading, vars)) + P(worked) : "")
    + (note ? P(note) : "")
    + (pitch.length ? H(fill(S.pitch_heading, vars)) + pitch.map(P).join("") : "")
    + (S.pitch_link ? `<p style="margin:6px 0 18px"><a href="${esc(S.pitch_link)}" style="display:inline-block;background:#e91e8c;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700">${esc(fill(S.pitch_button, vars) || "Learn more")}</a></p>` : "")
    + `<p style="margin:18px 0 0">${esc(fill(S.signoff, vars)).replace(/\n/g, "<br>")}</p></div>`;

  // ── Text ──
  const tline = (r) => `  ${r.label}: ${fmtMetric(r.key, r.baseline)} (${r.baselineFrom})` + (r.latest != null ? ` -> ${fmtMetric(r.key, r.latest)} (${r.latestFrom})${r.change != null ? "  " + fmtChange(r.key, r.change) + (r.better ? " better" : "") : ""}` : "");
  const text = [greet, ...intro,
    picked.length ? fill(S.numbers_heading, vars).toUpperCase() + "\n" + picked.map(tline).join("\n") : "",
    gainLine, worked ? fill(S.worked_heading, vars).toUpperCase() + "\n" + worked : "", note,
    pitch.length ? fill(S.pitch_heading, vars).toUpperCase() + "\n" + pitch.join("\n\n") + (S.pitch_link ? "\n" + S.pitch_link : "") : "",
    fill(S.signoff, vars)].filter(Boolean).join("\n\n");
  return { subject, html, text, rows: all, picked };
}

// A made-up player for previewing / test-sending the template before anyone
// real has been retested.
export const SAMPLE_PLAYER = { id: 0, first_name: "Sample", last_name: "Player", team_assignment: "14 Diamond", stand_reach: 90, approach_touch: 112, jump_touch: 101, sprint_10y: 1.95 };
export const SAMPLE_TESTS = [{ test_date: new Date().toISOString().slice(0, 10), stand_reach: 90.5, approach_touch: 115, standing_touch: 103, broad_jump: 86, dash_10y: 1.88 }];
export const SAMPLE_DRAFT = { worked_on: "Approach footwork, arm swing timing and first-step quickness off the block.", note: "" };
