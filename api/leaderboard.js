// Vercel serverless function: the testing leaderboard TV's data (Drew, Oct 14
// 2026 - "a display that will highlight the top 20 athletes for each of the
// measurements ... first name and last name initial only").
//
//   GET /api/leaderboard?k=<stat_boards.key>
//   -> { title, subtitle, settings, metrics, athletes, recent, asOf }
//
// Privacy: an athlete is "Quinn R." plus team and age group - never a full
// last name, a player id, a birthday or a contact. Ids are a hash scoped to
// the board's key, stable between polls so the TV can tell what's new.
// Only the club's athletes appear: on a team with a live offer, or tested by
// Reach (a player_stat_tests row).
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

export const BOARD_METRICS = [
  { key: "vertical", label: "Vertical", up: true, about: "Approach vertical: approach touch minus standing reach" },
  { key: "approach_touch", label: "Approach Jump", up: true, about: "Highest touch off a full approach" },
  { key: "standing_touch", label: "Standing Jump", up: true, about: "Highest touch off a standing jump" },
  { key: "broad_jump", label: "Broad Jump", up: true, about: "Standing broad jump distance" },
  { key: "dash_10y", label: "10-Yard Dash", up: false, about: "Fastest 10-yard sprint - lower is better" },
];
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
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const key = String((req.query && req.query.k) || new URL(req.url, "https://x").searchParams.get("k") || "").trim();
  if (!/^[a-z0-9]{16,64}$/i.test(key)) return res.status(403).json({ error: "This display needs its link (…/board?k=…)." });

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: board } = await sb.from("stat_boards").select("key, settings").eq("key", key).maybeSingle();
  if (!board) return res.status(403).json({ error: "This display link isn't valid any more." });

  const cols = "id, first_name, last_name, gender, dob, usav_div, team_assignment, offer_status, stand_reach, approach_touch, jump_touch, sprint_10y, stat_baseline_date";
  const [pRes, tRes, fRes] = await Promise.all([
    sb.from("players").select(cols).or("stand_reach.not.is.null,approach_touch.not.is.null,jump_touch.not.is.null,sprint_10y.not.is.null"),
    allRows(() => sb.from("player_stat_tests").select("*").order("test_date").order("id")),
    sb.from("stat_flag_reviews").select("player_id, flag_id, decision"),
  ]);
  if (pRes.error || tRes.error) return res.status(500).json({ error: (pRes.error || tRes.error).message });
  const tests = tRes.data || [], reviews = fRes.data || [];
  const testsBy = new Map();
  for (const t of tests) { if (!testsBy.has(t.player_id)) testsBy.set(t.player_id, []); testsBy.get(t.player_id).push(t); }
  // Tested by Reach but no tryout numbers: still on the board.
  const have = new Set((pRes.data || []).map(p => p.id));
  const extraIds = [...testsBy.keys()].filter(id => !have.has(id));
  const extra = extraIds.length ? ((await sb.from("players").select(cols).in("id", extraIds)).data || []) : [];
  const players = [...(pRes.data || []), ...extra];
  const peers = statPeerStats(players, testsBy);

  const idOf = (pid) => crypto.createHash("sha256").update(key + ":" + pid).digest("hex").slice(0, 10);
  const athletes = [], recent = [];
  const since = Date.now() - 24 * 3600e3;
  for (const p of players) {
    const mine = testsBy.get(p.id) || [];
    const inClub = (p.team_assignment && !TERMINAL.has(String(p.offer_status || ""))) || mine.length > 0;
    const name = displayName(p);
    if (!inClub || !name) continue;
    const rows = statResultRows(p, mine);
    // Red flags nobody accepted keep that number (and what rides on it) off.
    const red = reviewFlags(statFlags(p, mine, { peers }), reviews, p.id).live.filter(f => f.level === "red");
    const bad = new Set();
    for (const f of red) for (const k of [f.key, ...(f.related || [])]) bad.add(f.row + "|" + k);
    for (const r of rows) if (r.reachRow && r.reachRow !== r.row && bad.has(r.reachRow + "|stand_reach")) bad.add(r.row + "|vertical");
    const m = {};
    for (const { key: k, up } of BOARD_METRICS) {
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
    athletes.push({ id, n: name, t: String(p.team_assignment || "").replace(/ 1$/, "") || null, g: gender, ag: ageGroup(p), m });
    // Results saved in the last day, for the TV's live ticker.
    for (const t of mine) {
      const at = Date.parse(t.updated_at || t.created_at || "");
      if (!(at > since)) continue;
      const vals = {};
      for (const { key: k } of BOARD_METRICS) { const h = (m[k]?.hist || []).find(([d]) => d === String(t.test_date).slice(0, 10)); if (h) vals[k] = h[1]; }
      if (Object.keys(vals).length) recent.push({ id, at: new Date(at).toISOString(), date: String(t.test_date).slice(0, 10), vals });
    }
  }
  recent.sort((a, b) => b.at.localeCompare(a.at));
  const settings = { ...DEFAULTS, ...(board.settings || {}) };
  // The TV polls every few seconds; when nothing changed it gets two lines,
  // not the whole board again (?v= is the version it already has).
  const body = { title: settings.title, subtitle: settings.subtitle, settings, metrics: BOARD_METRICS, athletes, recent: recent.slice(0, 80) };
  const v = crypto.createHash("md5").update(JSON.stringify(body)).digest("hex").slice(0, 12);
  const asOf = new Date().toISOString();
  const known = String((req.query && req.query.v) || new URL(req.url, "https://x").searchParams.get("v") || "");
  if (known === v) return res.status(200).json({ ok: true, same: true, v, asOf });
  return res.status(200).json({ ok: true, v, asOf, ...body });
}
