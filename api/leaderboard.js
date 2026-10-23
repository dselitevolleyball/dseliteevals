// Vercel serverless function: the testing leaderboard TV's data (Drew, Oct 14
// 2026 - "a display that will highlight the top 20 athletes for each of the
// measurements ... first name and last name initial only").
//
//   GET /api/leaderboard            the public board (www.drippingsportsclub.com/reach)
//   GET /api/leaderboard?k=<key>    a specific board (stat_boards.key)
//   -> { title, subtitle, settings, metrics, athletes, recent, asOf }
// No key reads the board marked public; with none public it's a 403, so
// `update stat_boards set public = false` takes the page down without a deploy.
//
// Privacy: an athlete is "Quinn R." plus team and age group - never a full
// last name, a player id, a birthday or a contact. Ids are a hash scoped to
// the board's key, stable between polls so the TV can tell what's new.
// Only the club's athletes appear: on a team with a live offer, or tested by
// Reach (a player_stat_tests row) - plus Reach athletes who aren't DS Elite
// players (reach_athletes, added by Coach Brandon in HQ, Oct 23 2026), shown
// the same way under the team "Reach" unless he unticks "show on the public board".
//
// Numbers come from shared/stat-report.js, the same walk as Brandon's reports:
// vertical = approach touch - standing reach, baseline = tryout numbers, then
// each retest. A result HQ red-flags as a likely typo (and nobody accepted) is
// left off the board, so a slipped decimal never tops it on the TV.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { statResultRows, statFlags, statPeerStats, reviewFlags } from "../shared/stat-report.js";
import { loadCustomMetrics } from "./_lib/stat-metrics.js";

export const BOARD_METRICS = [
  { key: "vertical", label: "Vertical", unit: "in", up: true, about: "Approach vertical: approach touch minus standing reach" },
  { key: "approach_touch", label: "Approach Jump", unit: "in", up: true, about: "Highest touch off a full approach" },
  { key: "standing_touch", label: "Standing Jump", unit: "in", up: true, about: "Highest touch off a standing jump" },
  { key: "broad_jump", label: "Broad Jump", unit: "in", up: true, about: "Standing broad jump distance" },
  { key: "dash_10y", label: "10-Yard Dash", unit: "sec", up: false, about: "Fastest 10-yard sprint - lower is better" },
  { key: "sprint_mph", label: "Sprint Speed", unit: "mph", up: true, about: "Top sprint speed in miles per hour" },
];
// The board's tests: the built-ins, then those added in HQ marked "on the board".
export const boardMetrics = (custom = []) => [...BOARD_METRICS,
  ...custom.filter(m => m.active !== false && m.on_board !== false).map(m => ({ key: m.key, label: m.label, unit: m.unit || "", up: m.higher_better !== false, about: m.label }))];
const DEFAULTS = { title: "Reach Performance Leaderboard", subtitle: "Performance testing · Top 20 in every test", slide_seconds: 14, idle_seconds: 75, poll_seconds: 15 };
const TERMINAL = new Set(["declined", "opted_out", "not_invited"]);
const r2 = (n) => Math.round(n * 100) / 100;

// U11..U15 each, U16+ pooled (only a handful of 16-18s test).
const ageGroup = (p) => {
  const m = /^U(\d+)$/i.exec(String(p.usav_div || "").trim());
  let a = m ? +m[1] : null;
  if (a == null && /^\d{4}-\d{2}-\d{2}/.test(String(p.dob || ""))) {
    // USAV: age on July 1 of the season's start year, +1.
    const d = new Date(p.dob + "T12:00:00Z"), now = new Date(), y = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
    a = y - d.getUTCFullYear() - (d.getUTCMonth() >= 6 ? 1 : 0) + 1;
  }
  if (a == null || a < 8) return null;
  return a >= 16 ? "U16+" : "U" + a;
};
const displayName = (p) => {
  // "(Kensleigh) O'ren" = the legal name in brackets, then the one she goes by.
  const raw = String(p.first_name || "").trim();
  const first = (raw.replace(/\([^)]*\)/g, " ").trim() || raw.replace(/[()]/g, "")).replace(/\s+/g, " ").trim();
  const init = (String(p.last_name || "").trim().match(/[A-Za-z]/) || [""])[0].toUpperCase();
  return first ? first + (init ? " " + init + "." : "") : "";
};

// Every row, not just Supabase's first 1,000 per request.
async function allRows(build, page = 1000) {
  const out = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await build().range(from, from + page - 1);
    if (error) return { data: null, error };
    out.push(...(data || []));
    if (!data || data.length < page) return { data: out, error: null };
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const asked = String((req.query && req.query.k) || new URL(req.url, "https://x").searchParams.get("k") || "").trim();
  if (asked && !/^[a-z0-9]{16,64}$/i.test(asked)) return res.status(403).json({ error: "This display link isn't valid." });

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const known = String((req.query && req.query.v) || new URL(req.url, "https://x").searchParams.get("v") || "");
  const { status, body } = await boardData(sb, { asked, known });
  return res.status(status).json(body);
}

// The board for a key (or the public one) -> { status, body }; known = the
// version the TV already has (?v=), answered with { same: true } when unchanged.
export async function boardData(sb, { asked = "", known = "" } = {}) {
  const { data: board } = asked
    ? await sb.from("stat_boards").select("key, settings").eq("key", asked).maybeSingle()
    : await sb.from("stat_boards").select("key, settings").eq("public", true).order("created_at").limit(1).maybeSingle();
  if (!board) return { status: 403, body: { error: asked ? "This display link isn't valid any more." : "The leaderboard is switched off right now." } };
  const key = board.key;   // ids are hashed with it, so they match however the board is opened

  const custom = await loadCustomMetrics(sb);
  const METRICS_ON = boardMetrics(custom);
  const cols = "id, first_name, last_name, gender, dob, usav_div, team_assignment, offer_status, stand_reach, approach_touch, jump_touch, sprint_10y, sprint_mph, stat_baseline_date";
  const [pRes, tRes, fRes, raRes, rtRes] = await Promise.all([
    sb.from("players").select(cols).or("stand_reach.not.is.null,approach_touch.not.is.null,jump_touch.not.is.null,sprint_10y.not.is.null,sprint_mph.not.is.null"),
    allRows(() => sb.from("player_stat_tests").select("*").order("test_date").order("id")),
    sb.from("stat_flag_reviews").select("player_id, flag_id, decision"),
    sb.from("reach_athletes").select("id, first_name, last_name, gender, dob, team, public, active").eq("active", true).eq("public", true),
    allRows(() => sb.from("reach_athlete_tests").select("*").order("test_date").order("id")),
  ]);
  if (pRes.error || tRes.error) return { status: 500, body: { error: (pRes.error || tRes.error).message } };
  const tests = tRes.data || [], reviews = fRes.data || [];
  const testsBy = new Map();
  for (const t of tests) { if (!testsBy.has(t.player_id)) testsBy.set(t.player_id, []); testsBy.get(t.player_id).push(t); }
  // Tested by Reach but no tryout numbers: still on the board.
  const have = new Set((pRes.data || []).map(p => p.id));
  const extraIds = [...testsBy.keys()].filter(id => !have.has(id));
  const extra = extraIds.length ? ((await sb.from("players").select(cols).in("id", extraIds)).data || []) : [];
  const players = [...(pRes.data || []), ...extra];
  const peers = statPeerStats(players, testsBy);
  // Reach athletes ride along as players with an "r" id (their own table, so a
  // DS Elite id can never collide); no usav_div, so no age-group peer flags.
  // A missing table (migration not run) just leaves them off.
  for (const a of (raRes && !raRes.error ? raRes.data : null) || []) {
    const mine = ((rtRes && !rtRes.error ? rtRes.data : null) || []).filter(t => t.athlete_id === a.id);
    if (!mine.length) continue;
    const id = "r" + a.id;
    testsBy.set(id, mine.map(t => ({ ...t, player_id: id })));
    players.push({ id, reach: true, first_name: a.first_name, last_name: a.last_name, gender: a.gender === "F" ? "female" : a.gender === "M" ? "male" : null, dob: a.dob, usav_div: null, team_assignment: null, offer_status: null });
  }

  const idOf = (pid) => crypto.createHash("sha256").update(key + ":" + pid).digest("hex").slice(0, 10);
  const athletes = [], recent = [];
  const since = Date.now() - 24 * 3600e3;
  for (const p of players) {
    const mine = testsBy.get(p.id) || [];
    const inClub = (p.team_assignment && !TERMINAL.has(String(p.offer_status || ""))) || mine.length > 0 || p.reach;
    const name = displayName(p);
    if (!inClub || !name) continue;
    const rows = statResultRows(p, mine);
    // Red flags nobody accepted keep that number (and what rides on it) off.
    const red = reviewFlags(statFlags(p, mine, { peers }), reviews, p.id).live.filter(f => f.level === "red");
    const bad = new Set();
    for (const f of red) for (const k of [f.key, ...(f.related || [])]) bad.add(f.row + "|" + k);
    for (const r of rows) if (r.reachRow && r.reachRow !== r.row && bad.has(r.reachRow + "|stand_reach")) bad.add(r.row + "|vertical");
    const m = {};
    for (const { key: k, up } of METRICS_ON) {
      const hist = rows.filter(r => r[k] != null && Number.isFinite(r[k]) && !bad.has(r.row + "|" + k)).map(r => ({ d: r.date, v: r2(r[k]), row: r.row }));
      if (!hist.length) continue;
      const best = hist.reduce((a, b) => (up ? b.v > a.v : b.v < a.v) ? b : a);
      const base = hist[0], last = hist[hist.length - 1];
      m[k] = { best: best.v, bestDate: best.d, base: base.v, baseDate: base.d, last: last.v, lastDate: last.d,
        gain: hist.length > 1 ? r2(up ? last.v - base.v : base.v - last.v) : null,
        hist: hist.map(h => [h.d, h.v]) };
    }
    if (!Object.keys(m).length) continue;
    const id = idOf(p.id);
    // Every DS Elite team is a girls' team, so a blank gender on a team reads
    // as a girl (14 of them in Oct 2026); a boy is only ever marked "male".
    const g = String(p.gender || "").toLowerCase();
    const gender = g.startsWith("f") ? "F" : g.startsWith("m") ? "M" : p.team_assignment ? "F" : null;
    athletes.push({ id, n: name, t: p.reach ? "Reach" : String(p.team_assignment || "").replace(/ 1$/, "") || null, g: gender, ag: ageGroup(p), m });
    // Results saved in the last day, for the TV's live ticker.
    for (const t of mine) {
      const at = Date.parse(t.updated_at || t.created_at || "");
      if (!(at > since)) continue;
      const vals = {};
      for (const { key: k } of METRICS_ON) { const h = (m[k]?.hist || []).find(([d]) => d === String(t.test_date).slice(0, 10)); if (h) vals[k] = h[1]; }
      if (Object.keys(vals).length) recent.push({ id, at: new Date(at).toISOString(), date: String(t.test_date).slice(0, 10), vals });
    }
  }
  recent.sort((a, b) => b.at.localeCompare(a.at));
  const settings = { ...DEFAULTS, ...(board.settings || {}) };
  // The TV polls every few seconds; when nothing changed it gets two lines,
  // not the whole board again (?v= is the version it already has).
  const body = { title: settings.title, subtitle: settings.subtitle, settings, metrics: METRICS_ON, athletes, recent: recent.slice(0, 80),
    custom: custom.map(m => ({ key: m.key, label: m.label, unit: m.unit, higher_better: m.higher_better, active: m.active, sort: m.sort })) };
  const v = crypto.createHash("md5").update(JSON.stringify(body)).digest("hex").slice(0, 12);
  const asOf = new Date().toISOString();
  if (known === v) return { status: 200, body: { ok: true, same: true, v, asOf } };
  return { status: 200, body: { ok: true, v, asOf, ...body } };
}
