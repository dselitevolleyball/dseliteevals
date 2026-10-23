// Performance testing report — the email Coach Brandon sends a family after
// testing (Drew, Oct 9 2026). One builder for the app's live preview and the
// server's send (api/stat-report.js), so what Brandon sees is what goes out.
//
//   metricRows(player, tests)  -> [{ key, label, baseline, baselineFrom, baselineDate, baselineRow,
//                                    latest, latestFrom, latestDate, latestRow, change, better }]
//   buildReport({ player, tests, settings, draft, parentFirst, teammates, omit }) -> { subject, html, text, rows, picked }
//   statResultRows(player, tests) -> every result on file, oldest first (the baseline, then each test)
//   statFlags(player, tests, { peers }) -> likely data-entry errors, staff only (see the block above it)
//   statPeerStats(players, testsByPlayer) / allStatFlags(...) / flaggedReportKeys(...) -> HQ helpers
//   setCustomMetrics(stat_metrics rows) -> tests added in HQ join METRICS everywhere
//   parseMetric(key, typed) -> the number to store (8'4" -> 100), null blank, NaN unreadable
//
import { REACH_COPY, REACH_YOUTH_COPY, reachPlanFor, isYouthTeam } from "./reach-plan.js";

// Baseline = the first result on file (tryouts, else the first test); latest =
// the most recent test. "Better" respects direction (10-yard: lower is better).
// Every number and change shows two decimals (Drew, Oct 12 2026: "make sure the
// change is two decimal points like 3.14"), and the baseline is labelled with
// the day it was measured, players.stat_baseline_date, not "Tryouts" ("include
// the date of the baseline instead of tryouts"); "Tryouts" only when unknown.
// Pure and browser-safe: no imports, no I/O.

export const METRICS = [
  // key, label, unit, higherIsBetter, tryout column
  ["stand_reach", "Standing reach", "in", true, "stand_reach"],
  ["approach_touch", "Approach touch", "in", true, "approach_touch"],
  ["standing_touch", "Standing jump touch", "in", true, "jump_touch"],
  ["vertical", "Approach vertical", "in", true, null],
  ["broad_jump", "Broad jump", "in", true, null],
  ["dash_10y", "10-yard sprint", "sec", false, "sprint_10y"],
  // Top sprint speed on a radar/laser (Drew, Oct 23 2026: "add miles per hour
  // as a trackable measurement to all of my DS Elite athletes going forward").
  ["sprint_mph", "Sprint speed", "mph", true, "sprint_mph"],
];
export const BUILT_IN_METRICS = METRICS.map(m => m[0]);

// Tests the staff add in HQ (Reach -> Tests; stat_metrics rows: key, label,
// unit, higher_better, active) join METRICS in place, so every screen, email,
// chart and board that walks METRICS shows them. Their numbers live in the test
// row's `extra` ({ key: number }). Call it again whenever the list may have
// changed; it replaces the custom part and leaves the built-ins alone.
export function setCustomMetrics(defs) {
  for (let i = METRICS.length - 1; i >= 0; i--) if (!BUILT_IN_METRICS.includes(METRICS[i][0])) METRICS.splice(i, 1);
  const seen = new Set(BUILT_IN_METRICS);
  for (const d of [...(defs || [])].filter(d => d && d.active !== false && /^[a-z][a-z0-9_]{1,40}$/.test(d.key || "")).sort((a, b) => (a.sort ?? 100) - (b.sort ?? 100) || String(a.label).localeCompare(String(b.label)))) {
    if (seen.has(d.key)) continue;
    seen.add(d.key);
    METRICS.push([d.key, String(d.label || d.key), String(d.unit || "").trim(), d.higher_better !== false, null]);
  }
  return METRICS;
}

// A typed number -> what's stored: inches take 100, 100.5, 8'4, 8' 4", 8-4,
// 8ft 4in; everything else a plain number. null = blank, NaN = unreadable.
export function parseMetric(key, raw) {
  const s = String(raw ?? "").trim().replace(/,/g, ".");
  if (!s) return null;
  if (unitOf(key) === "in") {
    const m = /^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(\d+(?:\.\d+)?)?\s*(?:"|in|inches)?$/i.exec(s) || /^(\d)\s*[-\s]\s*(\d+(?:\.\d+)?)\s*(?:"|in)?$/.exec(s);
    if (m) return +m[1] * 12 + (m[2] ? +m[2] : 0);
  }
  const n = parseFloat(s.replace(/[^\d.\-]/g, ""));
  return /^-?\d*\.?\d+\s*[a-z"'/]*$/i.test(s) && Number.isFinite(n) ? n : NaN;
}

export const DEFAULT_SETTINGS = {
  subject: "{player_first}'s performance testing results",
  // Drew, Oct 12 2026: open with the past 5 weeks of working with her team.
  intro: "I'm Coach Brandon, and I run performance training at Dripping Springs Sports Club. Over the past 5 weeks I've been working personally with {team}, and with {player_first} whenever she was able to make it, and it's been great working with her! I wanted to share where she is right now and where she's already improved.",
  // The Reach pitch (Drew, 12 Oct 2026): 2x a week, start now through
  // Thanksgiving, the slot that fits her team's practice nights ({reach_plan},
  // from shared/reach-plan.js), individual plans, both memberships, and the
  // photos of Coach Brandon with athletes he has trained.
  pitch_heading: REACH_COPY.pitch_heading,
  pitch: REACH_COPY.pitch,
  pitch_button: REACH_COPY.pitch_button,
  pitch_link: "",
  signup_note: REACH_COPY.signup_note,
  memberships: REACH_COPY.memberships,
  fine_print: REACH_COPY.fine_print,
  photos: REACH_COPY.photos,
  photos_caption: REACH_COPY.photos_caption,
  // 11s and 12s get this instead of the pitch + memberships, with the PDF attached.
  youth_pitch_heading: REACH_YOUTH_COPY.youth_pitch_heading,
  youth_pitch: REACH_YOUTH_COPY.youth_pitch,
  take_heading: "My take on {player_first}",
  signoff: "Coach Brandon\nPerformance Coach, Reach at DSSC",
  // The metrics section — all editable in the template.
  numbers_heading: "{player_first}'s numbers",
  col_test: "Test", col_baseline: "Baseline", col_now: "Now", col_change: "Change",
  show_gains: true,
  gains_text: "Where {player_first} got better:",
  worked_heading: "What we worked on",
  default_metrics: [],          // empty = every metric on file
  // Charts (drawn with table cells so they show in every email app).
  team_metrics: ["vertical", "broad_jump", "dash_10y"],   // compared against the team (and its average)
  show_team: true,
  team_heading: "Where {player_first} stands on {team}",
  team_note: "Each grey bar is a teammate, best at the top. Names stay private.",
};

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtDate = (iso) => { try { return new Date(String(iso).slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); } catch { return String(iso || ""); } };
const unitOf = (key) => METRICS.find(m => m[0] === key)?.[2];
// { label, unit, up } for a test, built-in or added in HQ (null when unknown).
export const metricInfo = (key) => { const m = METRICS.find(x => x[0] === key); return m ? { label: m[1], unit: m[2], up: m[3] } : null; };
// The smallest change that counts as real, not measuring noise.
export const gainMin = (key) => { const u = unitOf(key); return u === "sec" ? 0.02 : u === "in" ? 0.25 : u === "mph" ? 0.2 : 0.01; };
// The suffix a number and a change carry: 1.85s, 21.70", 17.20 mph, 225 lb.
const suffix = (key) => { const u = unitOf(key); return u === "sec" ? "s" : u === "in" ? '"' : u ? " " + u : ""; };
// Whole hundredths, half away from zero. The nudge stops float drift
// (1.865 * 100 = 186.4999…) from rounding a typed 1.865 down to 1.86.
const hund = (n) => Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-6);
const d2 = (n) => (hund(n) / 100).toFixed(2);
// Feet and inches with the inch remainder to two decimals, ".00" dropped:
// 8' 8.72", 8' 6.50", 8' 6" (Drew, Oct 12 2026 — two decimals so baseline
// minus now visibly equals the change; it used to round to the half inch).
const ftIn = (n) => { const h = hund(n), f = Math.floor(h / 1200), i = h - f * 1200; const s = i % 100 ? (i / 100).toFixed(2) : String(i / 100); return f ? `${f}' ${s}"` : `${s}"`; };
export const fmtMetric = (key, v) => {
  if (v == null || !Number.isFinite(+v)) return "—";
  const u = unitOf(key);
  if (u === "in") return key === "vertical" || key === "broad_jump" || !BUILT_IN_METRICS.includes(key) ? d2(+v) + '"' : ftIn(+v);   // 21.70", 8' 4"
  // A test added in HQ in its own unit drops the ".00" (225 lb, 12 reps).
  return (BUILT_IN_METRICS.includes(key) || u === "sec" ? d2(+v) : String(hund(+v) / 100)) + suffix(key);   // 1.85s, 17.20 mph
};
// Every change shows exactly two decimals: +3.14", −0.12s, and ±0.00 when it
// rounds to nothing (Drew, Oct 12 2026: "two decimal points like 3.14").
export const fmtChange = (key, d) => {
  if (d == null || !Number.isFinite(+d)) return "";
  const h = hund(+d);
  return (h > 0 ? "+" : h < 0 ? "−" : "±") + (Math.abs(h) / 100).toFixed(2) + suffix(key);
};

// What the baseline is labelled with: the day it was measured ("Jun 26"),
// players.stat_baseline_date (migrations/20261012_stat_baseline_date.sql, Drew
// Oct 12 2026: "include the date of the baseline instead of tryouts"), else the
// old word "Tryouts" for a player whose date isn't known.
export const baselineLabel = (player) => /^\d{4}-\d{2}-\d{2}/.test(String(player?.stat_baseline_date || "")) ? fmtDate(player.stat_baseline_date) : "Tryouts";

// Every result on file, oldest first: the baseline (the tryout columns on
// players) then each player_stat_tests row. One walk shared by the email
// table, the series/team charts and the red flags, so they never disagree.
//   { row: "tryout" | "test:<id>", from: "Jun 26", date, tryout, <metric keys>,
//     reach (hers or the latest earlier one; tests often leave it blank),
//     reachOwn, reachRow, vertEntered (the stored vertical, tests only), standJump }
// vertical = approach touch − reach whenever both are on file, else the stored
// number (a row with no touch or no reach). Nobody types a vertical (the
// sheet's box is "Vertical (auto)"), and 39 of the 48 Oct 11 verticals were
// saved with toFixed(1): the email showed Denver Dolch's 104.72 − 83 as a
// padded 21.70" and +3.54" for a real +3.56", while /stats showed 21.72"
// (Oct 12 2026, Drew: "two decimal points like 3.14"). Worked out here, the
// email, HQ, the player card and the sheet agree to the hundredth. vertEntered
// keeps the stored number so vMismatch still catches a hand-typed or stale one
// (> 1" off; that rounding is ≤ 0.05"). standJump = standing touch − reach
// (not a report metric; the flags use it).
export function statResultRows(player, tests = []) {
  const sr = num(player?.stand_reach), ap = num(player?.approach_touch);
  const base = /^\d{4}-\d{2}-\d{2}/.test(String(player?.stat_baseline_date || "")) ? String(player.stat_baseline_date).slice(0, 10) : null;
  const rows = [{ row: "tryout", from: baselineLabel(player), date: base, tryout: true,
    ...Object.fromEntries(METRICS.map(([k, , , , col]) => [k, col ? num(player?.[col]) : null])), vertical: sr != null && ap != null ? ap - sr : null,
    reach: sr, reachOwn: sr != null, reachRow: sr != null ? "tryout" : null, vertEntered: null }];
  let reach = sr, reachRow = rows[0].reachRow;
  const sorted = [...(tests || [])].sort((a, b) => String(a.test_date).localeCompare(String(b.test_date)) || (Number(a.id) || 0) - (Number(b.id) || 0));
  sorted.forEach((t, i) => {
    const r = { row: "test:" + (t.id ?? i), from: fmtDate(t.test_date), date: String(t.test_date || "").slice(0, 10) || null, tryout: false };
    for (const [k] of METRICS) r[k] = num(t[k] ?? t.extra?.[k]);   // a test added in HQ lives in extra
    if (r.stand_reach != null) { reach = r.stand_reach; reachRow = r.row; }
    Object.assign(r, { reach, reachOwn: r.stand_reach != null, reachRow, vertEntered: r.vertical });
    if (r.approach_touch != null && reach != null) r.vertical = r.approach_touch - reach;
    rows.push(r);
  });
  for (const r of rows) r.standJump = r.standing_touch != null && r.reach != null ? r.standing_touch - r.reach : null;
  return rows;
}

export function metricRows(player, tests = []) {
  const all = statResultRows(player, tests);
  return METRICS.map(([key, label, unit, up]) => {
    const has = all.filter(x => x[key] != null);
    if (!has.length) return null;
    const a = has[0], b = has.length > 1 ? has[has.length - 1] : null;
    // The change is taken between the two numbers as shown (to the hundredth),
    // so "baseline − now" on the page always equals the change printed beside it.
    const change = b ? (hund(b[key]) - hund(a[key])) / 100 : null;
    return { key, label, baseline: a[key], baselineFrom: a.from, baselineDate: a.date, baselineRow: a.row,
      latest: b ? b[key] : null, latestFrom: b ? b.from : null, latestDate: b ? b.date : null, latestRow: b ? b.row : null,
      // A real change, not noise: a quarter inch, or two hundredths of a second.
      // Standing reach is growth, not training, so it is never called "better".
      change, better: (() => { if (change == null || key === "stand_reach") return null; const min = unit === "sec" ? 0.02 : unit === "in" ? 0.25 : unit === "mph" ? 0.2 : 0; if (Math.abs(change) < min || change === 0) return null; return up ? change > 0 : change < 0; })() };
  }).filter(Boolean);
}

const fill = (t, v) => String(t || "").replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m));

// Every result on file for one metric, in order: [{ from, value, date, row }].
// The baseline's `from` is its measuring date ("Jun 26"), else "Tryouts".
export function metricSeries(player, tests, key) {
  return statResultRows(player, tests).filter(r => r[key] != null).map(r => ({ from: r.from, value: r[key], date: r.date, row: r.row }));
}

// Team comparison (only the metrics in S.team_metrics — vertical and 10-yard
// sprint by default). A ranked bar chart, best at the top: every teammate is an
// unnamed grey bar, hers is pink and named, and the team average is its own
// dark bar at the place it falls. Needs 3+ players with a result.
// drop = buildReport's omit: a metric held back from the table leaves the chart too.
const teamMetricsOf = (S, drop) => (Array.isArray(S.team_metrics) && S.team_metrics.length ? S.team_metrics : ["vertical", "broad_jump", "dash_10y"]).filter(k => METRICS.some(m => m[0] === k) && !(drop && drop.has(k)));
// A teammate whose latest number is red-flagged as a likely typo is left out
// (Oct 12 2026: Genevieve Guerrero's 30.65" vertical, reach probably 72.5 for
// 82.5, was printing as "team best" in every 16 Diamond family's email).
export function teamStanding(player, tests, teammates, key) {
  const up = METRICS.find(m => m[0] === key)[3];
  const latestOf = (p, t, mate) => {
    const s = metricSeries(p, t, key); if (!s.length) return null;
    const last = s[s.length - 1];
    if (mate && statFlags(p, t).some(f => f.level === "red" && f.row === last.row && (f.key === key || f.related.includes(key)))) return null;
    return last.value;
  };
  const mine = latestOf(player, tests);
  const others = (teammates || []).filter(x => x.player.id !== player.id).map(x => latestOf(x.player, x.tests, true)).filter(v => v != null);
  if (mine == null || others.length < 2) return null;
  const all = [...others.map(v => ({ v, me: false })), { v: mine, me: true }].sort((a, b) => up ? b.v - a.v : a.v - b.v);
  const rank = all.findIndex(x => x.me) + 1;
  const avg = all.reduce((s, x) => s + x.v, 0) / all.length;
  return { all, rank, n: all.length, best: all[0].v, avg, mine, up };
}
function teamHtml(player, tests, teammates, S, vars, drop) {
  const blocks = teamMetricsOf(S, drop).map(key => {
    const t = teamStanding(player, tests, teammates, key);
    if (!t) return "";
    const label = METRICS.find(m => m[0] === key)[1];
    const rows = [...t.all.map(x => ({ ...x, avg: false })), { v: t.avg, me: false, avg: true }]
      .sort((a, b) => (t.up ? b.v - a.v : a.v - b.v) || (a.avg ? -1 : 1));
    const vals = rows.map(x => x.v), lo = Math.min(...vals), hi = Math.max(...vals);
    // Bars run from 60% (worst) to 100% (best) so the gaps read clearly.
    const width = (v) => Math.round(60 + ((t.up ? v - lo : hi - v) / Math.max(hi - lo, 0.001)) * 40);
    const bar = (x) => {
      const color = x.me ? "#e91e8c" : x.avg ? "#3f3f46" : "#d4d4d8";
      const name = x.me ? vars.player_first : x.avg ? "Team average" : "";
      return `<tr><td style="padding:2px 8px 2px 0;font-size:12px;white-space:nowrap;width:96px;font-weight:${x.me || x.avg ? 700 : 400};color:${x.me ? "#e91e8c" : "#3f3f46"}">${esc(name)}</td>`
        + `<td style="padding:2px 0"><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%"><tr><td style="width:${width(x.v)}%;background:${color};height:${x.me || x.avg ? 16 : 10}px;border-radius:3px"></td><td></td></tr></table></td>`
        + `<td style="padding:2px 0 2px 8px;font-size:12px;white-space:nowrap;width:56px;text-align:right;font-weight:${x.me || x.avg ? 700 : 400};color:${x.me || x.avg ? "#1a1a1a" : "#a1a1aa"}">${esc(fmtMetric(key, x.v))}</td></tr>`;
    };
    const vsAvg = t.mine - t.avg, ahead = t.up ? vsAvg > 0 : vsAvg < 0;
    return `<div style="margin:0 0 18px"><div style="font-size:14px;font-weight:700">${esc(label)}${t.up ? "" : ' <span style="font-weight:400;color:#888">(lower is faster)</span>'}</div>`
      + `<div style="font-size:12px;color:#666;margin:2px 0 6px">${esc(vars.player_first)} is #${t.rank} of ${t.n} · ${esc(fmtMetric(key, Math.abs(vsAvg)).replace(/^-/, ""))} ${ahead ? "better than" : "behind"} the team average · Team best ${esc(fmtMetric(key, t.best))}</div>`
      + `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">${rows.map(bar).join("")}</table></div>`;
  }).filter(Boolean);
  return blocks.length ? `<p style="margin:22px 0 4px;font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#c2186f">${esc(fill(S.team_heading, vars))}</p>`
    + `<p style="margin:0 0 10px;font-size:12px;color:#888">${esc(fill(S.team_note, vars))}</p>` + blocks.join("") : "";
}

// omit = metric keys to leave out whatever the draft/template picks: the
// red-flagged numbers HQ holds back until someone fixes or ticks them
// (flaggedReportKeys). Flag text itself never goes in the email.
// practice: practice_assignments rows, for the Reach slot that fits her team's
// nights. origin: absolute base for the photos (email apps need full URLs).
export function buildReport({ player, tests, settings, draft, parentFirst, teammates, omit, practice, origin = "https://dseliteevals.vercel.app" }) {
  const S = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const team = String(player?.team_assignment || "").replace(/ 1$/, "");
  const plan = reachPlanFor(player?.team_assignment || "", practice || []);
  const vars = { player_first: String(player?.first_name || "").trim(), team: team || "DS Elite", parent_first: parentFirst || "", reach_plan: team ? plan.text.split(player.team_assignment).join(team) : plan.text };   // "11 Rise 1" reads as "11 Rise"
  const all = metricRows(player, tests);
  // One metric list for every player (Drew, Oct 12 2026: "the metrics in her
  // report need to be team wide"): the template's default_metrics. A draft's
  // metrics column now only carries flag ticks ("ok:<key>:<print>").
  const want = Array.isArray(S.default_metrics) && S.default_metrics.length ? S.default_metrics : null;
  const drop = new Set(Array.isArray(omit) ? omit : []);
  const picked = (want ? all.filter(r => want.includes(r.key)) : all).filter(r => !drop.has(r.key));
  const gains = picked.filter(r => r.better === true);
  const subject = fill(S.subject, vars);
  const greet = parentFirst ? `Hi ${parentFirst},` : "Hi,";
  const para = (t) => fill(t, vars).split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  // 11s and 12s: evaluation + director's discretion, no sign-up buttons, the
  // Intro S&C PDF attached (shared/reach-plan.js REACH_YOUTH_COPY).
  const youth = isYouthTeam(player?.team_assignment);
  const base = String(origin).replace(/\/$/, "");
  const pdf = youth ? { ...REACH_YOUTH_COPY.youth_pdf, url: base + REACH_YOUTH_COPY.youth_pdf.path } : null;
  const pitchHeading = youth ? S.youth_pitch_heading : S.pitch_heading;
  const intro = para(S.intro), pitch = para(youth ? S.youth_pitch : S.pitch);
  const worked = String(draft?.worked_on || "").trim(), note = String(draft?.note || "").trim();
  // Claude's "Coach's take" (api/stat-report-ai.js), as written or as a coach edited it.
  const take = String(draft?.ai_take || "").trim();
  const members = !youth && Array.isArray(S.memberships) ? S.memberships.filter(m => m && m.link) : [];
  const pitchLink = youth ? "" : S.pitch_link;
  const photos = (Array.isArray(S.photos) ? S.photos : []).filter(Boolean).map(p => /^https?:/.test(p) ? p : base + p);
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
    + (take ? H(fill(S.take_heading, vars)) + `<p style="margin:0 0 14px;padding:2px 0 2px 12px;border-left:3px solid #e91e8c">${esc(take).replace(/\n/g, "<br>")}</p>` : "")
    + (picked.length ? H(fill(S.numbers_heading, vars)) + table : "")
    + (gainLine ? `<p style="margin:0 0 14px;padding:10px 12px;background:#ecfdf3;border-radius:8px;color:#14532d;font-weight:600">${esc(gainLine)}</p>` : "")
    + (S.show_team !== false ? teamHtml(player, tests, teammates, S, vars, drop) : "")
    + (worked ? H(fill(S.worked_heading, vars)) + P(worked) : "")
    + (note ? P(note) : "")
    + (pitch.length ? H(fill(pitchHeading, vars)) + pitch.map(P).join("") : "")
    + (pdf ? `<p style="margin:0 0 18px"><a href="${esc(pdf.url)}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">${esc(pdf.label)}</a><br><span style="font-size:12px;color:#666">Also attached to this email.</span></p>` : "")
    // Coach Brandon with athletes he has trained — two photos side by side
    // (a table, so they sit together in every email app), one caption.
    + (photos.length ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:6px 0 6px"><tr>${photos.map(u => `<td style="width:${Math.floor(100 / photos.length)}%;padding:0 4px;vertical-align:top"><img src="${esc(u)}" alt="Coach Brandon with athletes he has trained" width="290" style="width:100%;max-width:290px;height:auto;border-radius:8px;display:block"></td>`).join("")}</tr></table>`
        + (S.photos_caption ? `<p style="margin:0 0 16px;font-size:12px;color:#666">${esc(fill(S.photos_caption, vars))}</p>` : "") : "")
    // The memberships, Elite (the 2x-a-week plan) first.
    + (members.length
      ? (S.signup_note ? P(fill(S.signup_note, vars)) : "")
        + members.map(m => `<div style="border:1px solid ${m.recommended ? "#e91e8c" : "#e5e5e5"};border-radius:10px;padding:12px 14px;margin:0 0 10px">`
          + `<div style="font-weight:700;font-size:15px">${esc(m.name)} · ${esc(m.price)}${m.recommended ? ` <span style="font-size:11px;font-weight:700;color:#e91e8c;text-transform:uppercase;letter-spacing:.05em">· recommended</span>` : ""}</div>`
          + `<div style="font-size:13px;color:#555;margin:2px 0 10px">${esc(m.detail)}</div>`
          + `<a href="${esc(m.link)}" style="display:inline-block;background:${m.recommended ? "#e91e8c" : "#1a1a1a"};color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Sign ${esc(vars.player_first)} up for ${esc(m.name)}</a></div>`).join("")
        + (S.fine_print ? `<p style="margin:4px 0 14px;font-size:12px;color:#666">${esc(fill(S.fine_print, vars))}</p>` : "")
      : (pitchLink ? `<p style="margin:6px 0 18px"><a href="${esc(pitchLink)}" style="display:inline-block;background:#e91e8c;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700">${esc(fill(S.pitch_button, vars) || "Learn more")}</a></p>` : ""))
    + `<p style="margin:18px 0 0">${esc(fill(S.signoff, vars)).replace(/\n/g, "<br>")}</p></div>`;

  // ── Text ──
  const tline = (r) => `  ${r.label}: ${fmtMetric(r.key, r.baseline)} (${r.baselineFrom})` + (r.latest != null ? ` -> ${fmtMetric(r.key, r.latest)} (${r.latestFrom})${r.change != null ? "  " + fmtChange(r.key, r.change) + (r.better ? " better" : "") : ""}` : "");
  const text = [greet, ...intro,
    take ? fill(S.take_heading, vars).toUpperCase() + "\n" + take : "",
    picked.length ? fill(S.numbers_heading, vars).toUpperCase() + "\n" + picked.map(tline).join("\n") : "",
    gainLine,
    S.show_team !== false ? teamMetricsOf(S, drop).map(key => { const t = teamStanding(player, tests, teammates, key); const lab = METRICS.find(m => m[0] === key)[1]; return t ? `  ${lab}: #${t.rank} of ${t.n} on the team (team average ${fmtMetric(key, t.avg)}, team best ${fmtMetric(key, t.best)})` : ""; }).filter(Boolean).join("\n") : "",
    worked ? fill(S.worked_heading, vars).toUpperCase() + "\n" + worked : "", note,
    pitch.length ? fill(pitchHeading, vars).toUpperCase() + "\n" + pitch.join("\n\n") + (!members.length && pitchLink ? "\n" + pitchLink : "") + (pdf ? "\n\n" + pdf.label + ": " + pdf.url : "") : "",
    photos.length && S.photos_caption ? fill(S.photos_caption, vars) : "",
    members.length ? [S.signup_note ? fill(S.signup_note, vars) : "", ...members.map(m => `${m.name} (${m.price}): ${m.detail}\n${m.link}`), S.fine_print ? fill(S.fine_print, vars) : ""].filter(Boolean).join("\n\n") : "",
    fill(S.signoff, vars)].filter(Boolean).join("\n\n");
  // attachments: Resend's shape ({ filename, path: a public URL }).
  return { subject, html, text, rows: all, picked, youth, attachments: pdf ? [{ filename: pdf.filename, path: pdf.url }] : [] };
}

// ── Red flags: numbers that look like data-entry errors (staff only) ─────────
// Drew, Oct 12 2026: "red-flag potential issues with players' metrics — things
// that seem too high or too low — potentially a data entry issue." Calibrated
// on all 200 tryout baselines + the 56 Oct 11 retests, and on the 187 typos
// staff fixed by hand at tryouts (change_log): the rules would have caught
// every one of those. The morning of Oct 12 they flagged 9 red + 6 amber on 11
// players; 7 red + 7 amber on 11 after Drew raised Denver Dolch's June touches
// at 11:08 CT (counts move as staff fix numbers — allStatFlags is live). The
// aim is typos, not unusual athletes — Hazel Colletti's 97" reach is
// consistent with her touches and never flags.
//   statFlags(player, tests, { peers }) ->
//     [{ key, from, date, row, value, level: "red"|"amber", reason, rule, related, prevRow?, z? }]
// key = the metric cell that gets the badge; related = the other report
// metrics whose number or change rides on the same suspect value (Everly
// Shumway's 40 cm-short June touches make a fake 6.16" vertical, and would
// make a fake ~+16" gain at her retest), so "off by default" covers key +
// related (flaggedReportKeys). `from` carries the baseline date like the
// email does. Never put `reason` in a family email.
export const STAT_FLAG_RULES = {
  // A. Unit slips + physical limits for girls 9–18 (red). Wide on purpose: the
  // real data spans reach 67–97, touches 79.5–116.5, broad jump 48–86 and
  // 10-yard 1.69–2.91. The unit bands are cut at the typos staff actually made
  // (10-yard 1770/245, cm 213–238 in an inches box, 8875/825/1052, reach 7).
  range: { stand_reach: [58, 104], approach_touch: [70, 125], standing_touch: [68, 122], broad_jump: [30, 110], dash_10y: [1.45, 3.5],
    // Sprint top speed: youth athletes run about 10–20 mph, elite adults ~23.
    // 28+ is km/h typed in the mph box (17 mph = 27.4 km/h).
    sprint_mph: [6, 26] },
  // B. The same row against itself. Clean results: approach vertical 10.53–26.10
  // across 238 values (30" is national-team), standing jump from 9.94, approach
  // minus standing touch −0.79 to +6.70 (a 1 cm tie is common).
  vertical: [9, 30],
  standJump: [7, 27],
  bonus: { redLo: -4, amberLo: -1.5, amberHi: 7, redHi: 9 },
  vMismatch: 1,       // an entered vertical vs approach touch − reach
  stAboveAp: 2,       // standing touch over her best approach with approach blank (12 Ruby, Oct 11)
  // C. Change vs her previous result. Over 95–108 days the real spread was
  // reach 0 to +2.5, vertical ±4.4, 10-yard −0.25 to +0.14s: amber sits just
  // outside that, red at about twice. Gains ("Up"; for the 10-yard, faster)
  // widen by max(1, months/4) so a Feb retest isn't over-flagged; drops
  // ("Down"; 10-yard slower) don't. Reach growth is [base, per month] —
  // peak height velocity ~0.45"/mo plus 1–2" of measuring noise.
  change: {
    stand_reach: { amberDown: 1, redDown: 2.5, amberUp: [1, 0.6], redUp: [2, 1] },
    vertical: { amberDown: 5, redDown: 8, amberUp: 5, redUp: 8 },
    standJump: { amberDown: 5, redDown: 8, amberUp: 5, redUp: 8 },
    broad_jump: { amberDown: 8, redDown: 14, amberUp: 10, redUp: 16 },
    dash_10y: { amberDown: 0.25, redDown: 0.4, amberUp: 0.3, redUp: 0.5 },
    sprint_mph: { amberDown: 2, redDown: 3.5, amberUp: 2.5, redUp: 4 },
  },
  // D. Unusual for her age group (amber only): robust z = (v − median) /
  // max(1.4826 × MAD, floor), flagged at |z| ≥ 4 in a pool of 15+. z ≥ 3 would
  // also catch real athletes (Brittan Bradford 2.18s, Ellie Wong 21.1", Kate
  // Stroop 48"). Small pools (most broad jumps today) wait for more tests.
  peer: { z: 4, minN: 15, floor: { vertical: 1.5, standJump: 1.5, dash_10y: 0.06, broad_jump: 3, stand_reach: 1.5, approach_touch: 2, standing_touch: 2, sprint_mph: 0.6 } },
  // The U14 jump station typed every touch 40 cm short from 17:24 to 17:48 on
  // Jun 26; Drew fixed the rest at 17:56 but missed three. He raised Denver
  // Dolch's by 10" on Oct 12 (15.75" would match her Oct 11 retest); Everly
  // Shumway and Lucy Brewer remain. A low touch this would mend gets a hint.
  short40cm: 15.75,
};
const FLAG_LABEL = Object.fromEntries(METRICS.map(m => [m[0], m[1]]));
const typed = (v) => String(+(+v).toFixed(2));   // a slipped number as typed: 1770, 9222.05
const signed = (d) => { const h = hund(d); return (h > 0 ? "+" : h < 0 ? "−" : "±") + (Math.abs(h) / 100).toFixed(2); };
// Peer group from usav_div: U9–U15 each, U16–U18 pooled (only 10 players
// tested); anything else (a stray "U47") gets no peer check.
export const statAgeGroup = (div) => { const m = /^U(\d+)$/i.exec(String(div || "").trim()); if (!m) return null; const a = +m[1]; return a < 9 || a > 18 ? null : a >= 16 ? "U16+" : "U" + a; };
// testsByPlayer may be a Map (StatReports' testsBy), a { [player_id]: [] }
// object, or a flat array of player_stat_tests rows.
const testsLookup = (x) => {
  if (x instanceof Map) return (id) => x.get(id) || [];
  if (Array.isArray(x)) { const m = new Map(); for (const t of x) { if (!m.has(t.player_id)) m.set(t.player_id, []); m.get(t.player_id).push(t); } return (id) => m.get(id) || []; }
  return (id) => (x && x[id]) || [];
};
const PEER_KEYS = ["vertical", "standJump", "dash_10y", "sprint_mph", "broad_jump", "stand_reach", "approach_touch", "standing_touch"];
const unitMark = (m) => m === "dash_10y" ? "s" : m === "sprint_mph" ? " mph" : '"';

// Median + MAD of every result on file (baselines and all tests) per age group
// and metric. Build once for the whole club and pass it to statFlags as peers.
export function statPeerStats(players, testsByPlayer) {
  const testsOf = testsLookup(testsByPlayer), pools = {};
  for (const p of players || []) {
    const g = statAgeGroup(p?.usav_div); if (!g) continue;
    for (const r of statResultRows(p, testsOf(p.id))) for (const k of PEER_KEYS) if (r[k] != null) { pools[g] = pools[g] || {}; (pools[g][k] = pools[g][k] || []).push(r[k]); }
  }
  const med = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const out = {};
  for (const [g, ks] of Object.entries(pools)) for (const [k, a] of Object.entries(ks)) { const m = med(a); out[g] = out[g] || {}; out[g][k] = { median: m, mad: med(a.map(x => Math.abs(x - m))), n: a.length }; }
  return out;
}

export function statFlags(player, tests, { peers } = {}) {
  const R = STAT_FLAG_RULES, rows = statResultRows(player, tests), out = [];
  const add = (r, key, level, rule, reason, extra) => out.push({ key, from: r.from, date: r.date, row: r.row, value: r[key], level, reason, rule, related: [], ...(extra || {}) });
  const SIZE = ["stand_reach", "approach_touch", "standing_touch"];
  const rangeRed = (row, keys) => out.some(f => f.row === row && f.rule === "range" && keys.includes(f.key));
  const short = R.short40cm;
  for (const r of rows) {
    // A. Unit slips first (they explain the number), then the physical range.
    for (const [k, [lo, hi]] of Object.entries(R.range)) {
      const v = r[k]; if (v == null) continue;
      const L = FLAG_LABEL[k]; let why = null;
      if (k === "sprint_mph") {
        if (v >= 100) why = `${L} ${typed(v)} mph: looks like it was typed without the decimal point (${d2(v / (v >= 1000 ? 100 : 10))} mph?)`;
        else if (v > hi && v < 45) why = `${L} ${d2(v)} mph is faster than any youth athlete runs. Typed in km/h? (${d2(v / 1.609)} mph)`;
        else if (v >= 45) why = `${L} ${d2(v)} mph can't be right; likely a typo`;
        else if (v < lo) why = `${L} ${d2(v)} mph is slower than a jog; likely a typo`;
      } else if (k === "dash_10y") {
        if (v >= 100) why = `${L} ${typed(v)}s: looks like it was typed without the decimal point (${d2(v / (v >= 1000 ? 1000 : 100))}s?)`;
        else if (v >= 10) why = `${L} ${typed(v)}s: looks like a typo (${d2(v / 10)}s?)`;
        else if (v < lo) why = `${L} ${d2(v)}s is faster than any youth player runs; likely a typo`;
        else if (v > hi) why = `${L} ${d2(v)}s is far too slow for 10 yards; likely a typo`;
      } else {
        if (v >= 600) why = `${L} ${typed(v)}": missing decimal point? (${d2(v / (v >= 6000 ? 100 : 10))}"?)`;
        else if (v >= 150 && v < 330) why = `${L} ${typed(v)}": looks like centimeters (${d2(v / 2.54)}")`;
        else if (v < 12) why = `${L} ${typed(v)}": looks like feet (${typed(v)} ft = ${d2(v * 12)}"). Enter inches`;
        else if (v < 40 && (k === "approach_touch" || k === "standing_touch")) why = `${L} ${typed(v)}": looks like a jump height, not a touch height`;
        else if (v < lo || v > hi) why = `${L} ${d2(v)}" is too ${v < lo ? "low" : "high"} to be right; likely a typo`;
      }
      if (why) add(r, k, "red", "range", why, { related: k === "approach_touch" || k === "stand_reach" ? ["vertical"] : [] });
    }
    // B. Relationships on a junk number are noise, so a row with a bad
    // reach/touch skips them; so does a reach carried from a row where it's bad.
    if (rangeRed(r.row, SIZE)) continue;
    const reach = r.reachRow && r.reachRow !== r.row && rangeRed(r.reachRow, ["stand_reach"]) ? null : r.reach;
    const ap = r.approach_touch, st = r.standing_touch;
    if (ap != null && reach != null) {
      const v = ap - reach, [lo, hi] = R.vertical;
      const why = `(touch ${d2(ap)}" − reach ${d2(reach)}")`;
      if (v <= 0) add(r, "approach_touch", "red", "ap<=reach", `Approach touch ${d2(ap)}" is not above her standing reach ${d2(reach)}"; likely a typo`, { related: ["stand_reach", "vertical"] });
      else if (v < lo) add(r, "vertical", "red", "vertLow", `Approach vertical only ${d2(v)}" ${why}; one of those is likely a typo${v + short >= lo && v + short <= hi ? " (touch about 40 cm short?)" : ""}`, { value: v, related: ["approach_touch", "stand_reach"] });
      else if (v > hi) add(r, "vertical", "red", "vertHigh", `Approach vertical ${d2(v)}" ${why} is beyond elite level; check the reach and touch`, { value: v, related: ["approach_touch", "stand_reach"] });
    }
    if (st != null && reach != null) {
      const v = st - reach, [lo, hi] = R.standJump;
      if (v <= 0) add(r, "standing_touch", "red", "st<=reach", `Standing jump touch ${d2(st)}" is not above her standing reach ${d2(reach)}"; likely a typo`, { related: ["stand_reach"] });
      else if (v < lo) add(r, "standing_touch", "red", "sjLow", `Standing jump only ${d2(v)}" above her reach (touch ${d2(st)}", reach ${d2(reach)}"); likely a typo${v + short >= lo && v + short <= hi ? " (touch about 40 cm short?)" : ""}`, { related: ["stand_reach"] });
      else if (v > hi) add(r, "standing_touch", "red", "sjHigh", `Standing jump ${d2(v)}" above her reach (touch ${d2(st)}", reach ${d2(reach)}") is beyond elite level; likely a typo`, { related: ["stand_reach"] });
    }
    if (ap != null && st != null) {
      const d = ap - st, B = R.bonus;
      if (d < B.redLo) add(r, "approach_touch", "red", "bonusNeg", `Approach touch ${d2(ap)}" is ${d2(-d)}" below her standing jump touch ${d2(st)}". Boxes swapped, or a typo?`, { related: ["standing_touch", "vertical"] });
      else if (d < B.amberLo) add(r, "approach_touch", "amber", "bonusNeg", `Approach touch ${d2(ap)}" is ${d2(-d)}" below her standing jump touch ${d2(st)}". Boxes swapped?`, { related: ["standing_touch", "vertical"] });
      else if (d > B.redHi) add(r, "standing_touch", "red", "bonusPos", `Standing jump touch ${d2(st)}" is ${d2(d)}" below her approach touch ${d2(ap)}". Players are usually within 0–5"; likely a typo`, { related: ["approach_touch"] });
      else if (d > B.amberHi) add(r, "standing_touch", "amber", "bonusPos", `Standing jump touch ${d2(st)}" is ${d2(d)}" below her approach touch ${d2(ap)}"; an unusually big gap`, { related: ["approach_touch"] });
    }
    if (r.vertEntered != null && ap != null && reach != null && Math.abs(r.vertEntered - (ap - reach)) > R.vMismatch)
      add(r, "vertical", "red", "vMismatch", `Vertical ${d2(r.vertEntered)}" doesn't match approach touch − reach (${d2(ap - reach)}")`, { value: r.vertEntered, related: ["approach_touch", "stand_reach"] });
    if (!r.tryout && st != null && ap == null) {
      const bestAp = Math.max(...rows.filter(x => x !== r && x.approach_touch != null).map(x => x.approach_touch));
      if (Number.isFinite(bestAp) && st > bestAp + R.stAboveAp)
        add(r, "standing_touch", "amber", "stAboveAp", `Standing jump touch ${d2(st)}" is above her best approach touch (${d2(bestAp)}") and approach is blank. Typed in the wrong box?`);
    }
  }

  // C. Change vs her previous result for that metric (each consecutive pair,
  // not only vs the baseline); the flag sits on the later result. Raw touches
  // aren't checked: touch change = reach change + jump change, both covered,
  // and checking both would double-flag one typo. Skipped when either end
  // already has a red flag that explains it.
  const CHANGE = [["stand_reach", "stand_reach", ["stand_reach"], ["vertical"]], ["vertical", "vertical", ["vertical", "approach_touch", "stand_reach"], ["approach_touch"]],
    ["standJump", "standing_touch", ["standing_touch", "stand_reach"], []], ["broad_jump", "broad_jump", ["broad_jump"], []], ["dash_10y", "dash_10y", ["dash_10y"], []], ["sprint_mph", "sprint_mph", ["sprint_mph"], []]];
  for (const [m, key, deps, related] of CHANGE) {
    const c = R.change[m], u = unitMark(m);
    let prev = null;
    for (const r of rows) {
      const v = r[m]; if (v == null) continue;   // stand_reach is only her own, never a carried one
      if (prev) {
        const known = !!(prev.r.date && r.date);
        const months = known ? Math.max(0.5, (Date.parse(r.date) - Date.parse(prev.r.date)) / 864e5 / 30.44) : 4;
        const sc = Math.max(1, months / 4), d = v - prev.v, gain = m === "dash_10y" ? -d : d;
        const lim = (x) => Array.isArray(x) ? x[0] + x[1] * months : x * sc;
        const level = gain > lim(c.redUp) ? "red" : gain > lim(c.amberUp) ? "amber" : -gain > c.redDown ? "red" : -gain > c.amberDown ? "amber" : null;
        const explained = out.some(f => f.level === "red" && (f.row === r.row || f.row === prev.r.row) && (deps.includes(f.key) || f.related.includes(key)));
        if (level && !explained) {
          const lab = m === "standJump" ? "Standing jump (touch − reach)" : FLAG_LABEL[m];
          add(r, key, level, "change:" + m, `${lab} ${signed(d)}${u} since ${prev.r.from} (${d2(prev.v)}${u} → ${d2(v)}${u})${known ? ` in ${months.toFixed(1)} months` : ""}, more than real change explains; one of the two is likely a typo`, { prevRow: prev.r.row, related });
        }
      }
      prev = { r, v };
    }
  }

  // D. Unusual for her age group (amber). Body size (reach, touches) only on
  // rows where B can't cross-check it — no reach + touch pair — so tall
  // athletes never flag; Lucy Brewer's lone short touches do.
  const g = statAgeGroup(player?.usav_div), P = peers && g ? peers[g] : null;
  if (P) for (const r of rows) {
    const ks = ["vertical", "standJump", "dash_10y", "sprint_mph", "broad_jump"];
    if (!(r.reach != null && (r.approach_touch != null || r.standing_touch != null))) ks.push(...SIZE);
    for (const m of ks) {
      const v = r[m], s = P[m]; if (v == null || !s || s.n < R.peer.minN) continue;
      const sd = Math.max(1.4826 * s.mad, R.peer.floor[m]), z = (v - s.median) / sd;
      const key = m === "standJump" ? "standing_touch" : m, u = unitMark(m);
      if (Math.abs(z) < R.peer.z || out.some(f => f.row === r.row && f.key === key && f.level === "red")) continue;
      const what = m === "standJump" ? `Standing jump (touch − reach) ${d2(v)}"` : `${FLAG_LABEL[m]} ${d2(v)}${u}`;
      const dir = m === "dash_10y" ? (z > 0 ? "slower than" : "faster than") : z > 0 ? "above" : "below";
      const mend = z < 0 && m !== "dash_10y" && m !== "sprint_mph" && m !== "broad_jump" && m !== "stand_reach" && Math.abs((v + short - s.median) / sd) < R.peer.z;
      add(r, key, "amber", "peer:" + m, `${what} is far ${dir} other ${g} players (typical ${d2(s.median)}${u}). Double-check it${mend ? " (about 40 cm short?)" : ""}`, { z: Math.round(z * 10) / 10 });
    }
  }

  // Red first, then oldest result first.
  const at = new Map(rows.map((r, i) => [r.row, i]));
  return out.map((f, i) => [f, i]).sort(([a, i], [b, j]) => (a.level === b.level ? 0 : a.level === "red" ? -1 : 1) || at.get(a.row) - at.get(b.row) || i - j).map(([f]) => f);
}

// Every flag across the club for HQ's "Check these numbers" panel: red first,
// then team (no team last), then player. Each flag gains player_id, player, team.
export function allStatFlags(players, testsByPlayer, { peers } = {}) {
  const testsOf = testsLookup(testsByPlayer), P = peers || statPeerStats(players, testsByPlayer), out = [];
  for (const p of players || []) for (const f of statFlags(p, testsOf(p.id), { peers: P }))
    out.push({ ...f, player_id: p.id, player: `${p.first_name || ""} ${p.last_name || ""}`.trim(), team: p.team_assignment || "" });
  const tn = (t) => (t ? parseInt(t) || 99 : 999);
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "red" ? -1 : 1) || tn(a.team) - tn(b.team) || a.team.localeCompare(b.team) || a.player.localeCompare(b.player) || (a.player_id - b.player_id));
}

// Staff review of a flag (Drew, Oct 12 2026: "accept or ignore"), stored in
// stat_flag_reviews. flagId = the metric, the result, the rule and the number,
// so a retyped number is a new flag and shows again.
//   accept: the number is right. It's no longer a flag anywhere (not held,
//           not in the panel, not hidden from Claude).
//   ignore: hidden from the panel and badges, but the number still stays out
//           of her email.
export const flagId = (f) => [f.key, f.row, f.prevRow || "", f.rule, Math.round((+f.value || 0) * 100)].join("|");
export function reviewFlags(flags, reviews, playerId) {
  const dec = new Map((reviews || []).filter(r => playerId == null || r.player_id === playerId).map(r => [r.flag_id, r.decision]));
  const open = [], accepted = [], ignored = [];
  for (const f of flags || []) { const d = dec.get(flagId(f)); (d === "accept" ? accepted : d === "ignore" ? ignored : open).push(f); }
  // live = what still holds a number out of her email
  return { open, accepted, ignored, live: [...open, ...ignored] };
}

// The report metrics a flag actually touches: its key + related, when the
// flagged result (or, for a change flag, either end) is the baseline or the
// "now" that metric shows. HQ ticks these off by default; a flag on an
// in-between test doesn't change the email. level: "red" to count only reds.
export function flaggedReportKeys(player, tests, flags, { level } = {}) {
  const shown = new Map(metricRows(player, tests).map(r => [r.key, [r.baselineRow, r.latestRow].filter(Boolean)]));
  const hit = new Set();
  for (const f of flags || []) {
    if (level && f.level !== level) continue;
    for (const k of [f.key, ...(f.related || [])]) { const s = shown.get(k); if (s && (s.includes(f.row) || (f.prevRow && s.includes(f.prevRow)))) hit.add(k); }
  }
  return METRICS.map(m => m[0]).filter(k => hit.has(k));
}

// A made-up player for previewing / test-sending the template before anyone
// real has been retested.
export const SAMPLE_PLAYER = { id: 0, first_name: "Sample", last_name: "Player", team_assignment: "14 Diamond", usav_div: "U14", stand_reach: 90, approach_touch: 112, jump_touch: 101, sprint_10y: 1.95, stat_baseline_date: "2026-06-26" };
export const SAMPLE_TESTS = [{ test_date: new Date().toISOString().slice(0, 10), stand_reach: 90.5, approach_touch: 115, standing_touch: 103, broad_jump: 86, dash_10y: 1.88 }];
export const SAMPLE_DRAFT = { worked_on: "Approach footwork, arm swing timing and first-step quickness off the block.", note: "",
  // Stands in for Claude's Coach's take so the template preview shows where it goes.
  ai_take: "Sample's approach touch is up 3.00\" since June, the second-best jump on 14 Diamond, and that extra height is exactly what lets an outside hitter swing over the block instead of into it. Where an individual Reach plan would help her most is first-step speed: her 10-yard has room to drop, and quicker feet will get her to more balls in transition." };
// Made-up teammates for the sample preview's team chart.
export const SAMPLE_TEAM = [[110, 1.90], [118, 1.85], [108, 2.00], [113, 1.92], [104, 2.05], [115, 1.97], [109, 1.99]]
  .map(([ap, d], i) => ({ player: { id: -1 - i, first_name: "T" + i, stand_reach: 90, approach_touch: ap, sprint_10y: d }, tests: [] }));
