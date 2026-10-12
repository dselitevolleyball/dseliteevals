// POST /api/stat-report-ai — Claude writes the "Coach's take" for testing
// reports (Drew, 12 Oct 2026). Stored on stat_report_drafts.ai_take for the
// Testing Reports screen to show, edit and send; nothing is emailed here.
//
//   { player_id }               write (or rewrite) one player's take
//   { team }                    write takes for every current player on a team
//                               who has testing numbers and no take yet
//   { ..., refresh: true }      also rewrite takes that already exist
//   { ..., force: true }        also rewrite takes a coach has edited
//   { ..., dry: true }          return the facts Claude would get, no Claude call
//
// Auth: owners/admins, the performance coach (REPORT_SENDERS), or the
// service-role key (operator scripts).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.

import { createClient } from "@supabase/supabase-js";
import * as SR from "../shared/stat-report.js";
import { writeCoachTake, positionNames, AI_MODEL } from "./_lib/stat-report-ai.js";
import { REPORT_SENDERS } from "./stat-report.js";

export const config = { maxDuration: 300 };

const OWNER_EMAILS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];
const TERMINAL = ["declined", "not_invited", "opted_out"];
const nrm = (v) => String(v || "").trim().toLowerCase();
const LEVEL = { National: "National team", Regional: "Regional team", Developmental: "Rise (developmental) team" };
const fmtDay = (iso) => { try { return new Date(String(iso).slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); } catch { return null; } };
// Changes to two decimals (Drew, 12 Oct 2026: "like 3.14").
const fmtChange = (d, unit) => (d > 0 ? "+" : d < 0 ? "−" : "±") + Math.abs(d).toFixed(2) + (unit === "sec" ? "s" : '"');

// The facts Claude gets for one player — nothing else.
export function factsFor({ player, tests, teammates, level, draft }) {
  const flagged = new Set(typeof SR.statFlags === "function"
    ? SR.statFlags(player, tests, { peers: teammates }).filter(f => f.level === "red").map(f => f.key) : []);
  const rows = SR.metricRows(player, tests).filter(r => r.key !== "stand_reach" && !flagged.has(r.key));
  const baselineDate = player.stat_baseline_date ? fmtDay(player.stat_baseline_date) : null;
  const results = rows.map(r => {
    const unit = SR.METRICS.find(m => m[0] === r.key)[2];
    const st = SR.teamStanding(player, tests, teammates, r.key);
    return {
      test: r.label + (unit === "sec" ? " (lower is faster)" : ""),
      baseline: SR.fmtMetric(r.key, r.baseline),
      baseline_from: r.baselineFrom === "Tryouts" && baselineDate ? baselineDate : r.baselineFrom,
      now: r.latest != null ? SR.fmtMetric(r.key, r.latest) : null,
      now_from: r.latestFrom || null,
      change: r.change != null ? fmtChange(r.change, unit) : null,
      improved: r.better === true ? true : r.better === false ? false : null,
      team_rank: st ? `#${st.rank} of ${st.n}` : null,
    };
  });
  return {
    player_first: String(player.first_name || "").trim(),
    team: player.team_assignment || null,
    level: LEVEL[level] || null,
    positions: positionNames(player.positions),
    has_retest: results.some(r => r.now != null),
    results,
    worked_on: draft?.worked_on || null,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "POST only" }); }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return res.status(401).json({ error: "Sign in first" });
  if (bearer !== SUPABASE_SERVICE_ROLE_KEY) {
    const { data: { user } = {} } = await sb.auth.getUser(bearer).catch(() => ({ data: {} }));
    const email = nrm(user?.email);
    if (!email) return res.status(401).json({ error: "Sign in first" });
    const { data: me } = await sb.from("coaches").select("is_admin, is_approved").ilike("email", email).maybeSingle();
    if (!(OWNER_EMAILS.includes(email) || REPORT_SENDERS.includes(email) || (me?.is_approved && me?.is_admin))) return res.status(403).json({ error: "Only admins and the performance coach can do this." });
  }

  let b = req.body; try { b = typeof b === "string" ? JSON.parse(b) : (b || {}); } catch { return res.status(400).json({ error: "Invalid JSON" }); }
  const playerId = Number(b.player_id) || null, team = String(b.team || "").trim() || null;
  if (!playerId && !team) return res.status(400).json({ error: "player_id or team required" });
  const refresh = !!b.refresh || !!playerId, force = !!b.force, dry = !!b.dry;

  const COLS = "id, first_name, last_name, team_assignment, offer_status, positions, stand_reach, approach_touch, jump_touch, sprint_10y, stat_baseline_date";
  let roster;
  if (playerId) {
    const { data: p, error } = await sb.from("players").select(COLS).eq("id", playerId).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!p) return res.status(404).json({ error: "Player not found" });
    roster = [p];
  }
  const teamName = team || roster[0].team_assignment;
  const { data: mates } = teamName
    ? await sb.from("players").select(COLS).eq("team_assignment", teamName).eq("season", "2026-27")
    : { data: [] };
  const live = (mates || []).filter(m => !TERMINAL.includes(m.offer_status || ""));
  if (!roster) roster = live;
  const ids = [...new Set([...live, ...roster].map(m => m.id))];
  const [{ data: allTests }, { data: drafts }, { data: pt }] = await Promise.all([
    ids.length ? sb.from("player_stat_tests").select("*").in("player_id", ids) : { data: [] },
    ids.length ? sb.from("stat_report_drafts").select("*").in("player_id", ids) : { data: [] },
    teamName ? sb.from("practice_teams").select("level").eq("team_name", teamName).maybeSingle() : { data: null },
  ]);
  const testsOf = (id) => (allTests || []).filter(t => t.player_id === id);
  const teammates = live.map(m => ({ player: m, tests: testsOf(m.id) }));
  const draftOf = (id) => (drafts || []).find(d => d.player_id === id) || null;

  const jobs = roster.map(p => ({ p, tests: testsOf(p.id), draft: draftOf(p.id) }))
    .filter(j => SR.metricRows(j.p, j.tests).length);
  const skipped = [];
  const todo = jobs.filter(j => {
    if (j.draft?.ai_take_edited && !force) { skipped.push({ player_id: j.p.id, name: j.p.first_name + " " + j.p.last_name, why: "edited by a coach" }); return false; }
    if (j.draft?.ai_take && !refresh) { skipped.push({ player_id: j.p.id, name: j.p.first_name + " " + j.p.last_name, why: "already written" }); return false; }
    return true;
  });

  const out = [];
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const j = todo[i++];
      const facts = factsFor({ player: j.p, tests: j.tests, teammates, level: pt?.level, draft: j.draft });
      if (dry) { out.push({ player_id: j.p.id, name: j.p.first_name + " " + j.p.last_name, facts }); continue; }
      try {
        const r = await writeCoachTake(facts);
        if (r.take) {
          const { error } = await sb.from("stat_report_drafts").upsert(
            { player_id: j.p.id, ai_take: r.take, ai_take_at: new Date().toISOString(), ai_take_model: r.model || AI_MODEL, ai_take_edited: false },
            { onConflict: "player_id" });
          if (error) throw new Error(error.message);
        }
        out.push({ player_id: j.p.id, name: j.p.first_name + " " + j.p.last_name, take: r.take, model: r.model, error: r.error || null });
      } catch (e) {
        out.push({ player_id: j.p.id, name: j.p.first_name + " " + j.p.last_name, take: null, error: String(e.message || e).slice(0, 300) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, todo.length) }, worker));
  return res.status(200).json({ ok: true, team: teamName, written: out.filter(o => o.take).length, results: out, skipped, dry });
}
