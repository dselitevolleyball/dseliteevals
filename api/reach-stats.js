// POST /api/reach-stats — Reach Performance stats in HQ (Drew, Oct 23 2026:
// "a system on the DSSC HQ that allows Coach Brandon Butler to add new
// players to the Reach Performance stats and add their stats on certain
// dates"). Coach Brandon and the directors; everything lands on the public
// board (api/leaderboard.js → www.drippingsportsclub.com/reach).
//
//   Authorization: Bearer <Supabase session token> (DSSC_DIRECTORS - Brandon
//   is on it - or an approved admin; api/_lib/site-inbox.js verifyDirector)
//   { action: "load" }                        -> { athletes, players, tests: { reach, dse }, metrics, custom, today }
//   { action: "athlete_save", athlete, force? } -> { athlete } | 409 { match } (same name already on file)
//   { action: "results_save", date, rows: [{ kind: "reach"|"dse", id, values: { key: typed }, notes? }] }
//                                             -> { saved, cleared, flags: [{ kind, id, name, level, reason }] }
//        a key sent blank clears that number for the day; a key left out keeps it
//   { action: "result_delete", kind, id }     -> {}
//   { action: "metric_save", metric }         -> { metric }   a test added in HQ (stat_metrics)
//
// Two kinds of athlete: Reach athletes (reach_athletes / reach_athlete_tests,
// for anyone who isn't a DS Elite player) and DS Elite players, whose results
// go to player_stat_tests like the team testing links (api/stats-form.js), so
// the player card, the family reports and the club stats board see them too.
// Numbers: shared/stat-report.js parseMetric (8'4" → 100), vertical = approach
// touch − the latest standing reach, flags from the shared statFlags.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";
import { readBody } from "./_lib/site-forms.js";
import { verifyDirector, isEmailish, nrm } from "./_lib/site-inbox.js";
import { loadCustomMetrics } from "./_lib/stat-metrics.js";
import { isReachStaff } from "../shared/campaign-audience.js";
import { METRICS, BUILT_IN_METRICS, parseMetric, statFlags } from "../shared/stat-report.js";

const TERMINAL = new Set(["declined", "opted_out", "not_invited"]);
const PLAYER_COLS = "id, first_name, last_name, gender, dob, usav_div, season, team_assignment, offer_status, stand_reach, approach_touch, jump_touch, sprint_10y, sprint_mph, stat_baseline_date";
const COLUMNS = ["stand_reach", "approach_touch", "standing_touch", "vertical", "broad_jump", "dash_10y", "sprint_mph"];
const UNITS = ["in", "sec", "mph", "lb", "reps", "%", ""];
const fail = (status, error, extra) => Object.assign(new Error(error), { status, extra });
const centralToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const str = (v, n = 200) => String(v ?? "").trim().slice(0, n);
const nameKey = (f, l) => `${str(f).toLowerCase()}|${str(l).toLowerCase()}`;

async function allRows(build, page = 1000) {
  const out = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await build().range(from, from + page - 1);
    if (error) throw fail(500, error.message);
    out.push(...(data || []));
    if (!data || data.length < page) return out;
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "POST only" }); }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const who = await verifyReach(sb, req);
  if (who.error) return res.status(who.status).json({ error: who.status === 403 ? "Reach stats are for Coach Brandon and the directors" : who.error });
  try {
    return res.status(200).json({ ok: true, ...(await runReach(sb, who, readBody(req))) });
  } catch (e) {
    if (!e.status) console.error("reach-stats", e);
    return res.status(e.status || 500).json({ error: e.message || String(e), ...(e.extra || {}) });
  }
}

// Directors, plus approved Reach staff (sports or staff_view includes "reach"),
// the same people who get Reach Texts.
async function verifyReach(sb, req) {
  const who = await verifyDirector(sb, req);
  if (who.status !== 403) return who;
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  const { data: { user } = {} } = await sb.auth.getUser(bearer).catch(() => ({ data: {} }));
  const me = nrm(user?.email);
  const { data: c } = me ? await sb.from("coaches").select("display_name, is_approved, sports, staff_view").ilike("email", me).maybeSingle() : { data: null };
  return c?.is_approved && isReachStaff(c) ? { me, name: c.display_name || me, row: c } : who;
}

export async function runReach(sb, { me, name }, b) {
  const custom = await loadCustomMetrics(sb);
  switch (b.action) {
    case "load": {
      const [athletes, rtests, players, dtests] = await Promise.all([
        allRows(() => sb.from("reach_athletes").select("*").order("last_name").order("first_name")),
        allRows(() => sb.from("reach_athlete_tests").select("*").order("test_date").order("id")),
        allRows(() => sb.from("players").select(PLAYER_COLS).order("last_name")),
        allRows(() => sb.from("player_stat_tests").select("*").order("test_date").order("id")),
      ]);
      // DS Elite: this season's rostered players, and anyone Reach has tested.
      const tested = new Set(dtests.map(t => t.player_id));
      const club = players.filter(p => ((p.season || "2026-27") === "2026-27" && p.team_assignment && !TERMINAL.has(String(p.offer_status || ""))) || tested.has(p.id));
      return { athletes, players: club, tests: { reach: rtests, dse: dtests.filter(t => club.some(p => p.id === t.player_id)) },
        metrics: METRICS.map(([key, label, unit, up]) => ({ key, label, unit, up, built_in: BUILT_IN_METRICS.includes(key) })), custom, today: centralToday() };
    }

    case "athlete_save": {
      const a = b.athlete && typeof b.athlete === "object" ? b.athlete : {};
      const row = {
        first_name: str(a.first_name, 60), last_name: str(a.last_name, 60),
        gender: ["F", "M"].includes(a.gender) ? a.gender : null,
        dob: /^\d{4}-\d{2}-\d{2}$/.test(a.dob || "") ? a.dob : null,
        grad_year: Number.isInteger(+a.grad_year) && +a.grad_year >= 2000 && +a.grad_year <= 2045 ? +a.grad_year : null,
        sport: str(a.sport, 60) || null, team: str(a.team, 80) || null,
        parent_name: str(a.parent_name, 80) || null, parent_email: isEmailish(a.parent_email) ? nrm(a.parent_email) : null, parent_phone: str(a.parent_phone, 30) || null,
        notes: str(a.notes, 1000) || null, public: a.public !== false, active: a.active !== false, updated_at: new Date().toISOString(),
      };
      if (!row.first_name) throw fail(400, "Add the athlete's first name");
      if (!a.id && !b.force) {
        // Already on file? A DS Elite player is tested on her DS Elite record
        // (so her family reports and player card see it); a Reach athlete once.
        const k = nameKey(row.first_name, row.last_name);
        const [{ data: ps }, { data: ras }] = await Promise.all([
          sb.from("players").select("id, first_name, last_name, team_assignment, season").ilike("first_name", row.first_name).limit(20),
          sb.from("reach_athletes").select("id, first_name, last_name").ilike("first_name", row.first_name).limit(20),
        ]);
        const p = (ps || []).find(x => nameKey(x.first_name, x.last_name) === k);
        if (p) throw fail(409, `${row.first_name} ${row.last_name} is a DS Elite player${p.team_assignment ? ` (${p.team_assignment})` : ""} - enter her results under DS Elite so her player card and reports see them.`, { match: { kind: "dse", id: p.id } });
        const r = (ras || []).find(x => nameKey(x.first_name, x.last_name) === k);
        if (r) throw fail(409, `${row.first_name} ${row.last_name} is already a Reach athlete.`, { match: { kind: "reach", id: r.id } });
      }
      const q = a.id ? sb.from("reach_athletes").update(row).eq("id", Number(a.id)) : sb.from("reach_athletes").insert({ ...row, created_by: me });
      const { data, error } = await q.select("*").single();
      if (error) throw fail(500, error.message);
      return { athlete: data };
    }

    case "results_save": {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") ? b.date : centralToday();
      if (date > centralToday()) throw fail(400, "That date hasn't happened yet");
      const keys = METRICS.map(m => m[0]).filter(k => k !== "vertical");   // vertical is worked out
      const rows = Array.isArray(b.rows) ? b.rows.slice(0, 200) : [];
      const want = { reach: [...new Set(rows.filter(r => r.kind === "reach").map(r => Number(r.id)))], dse: [...new Set(rows.filter(r => r.kind === "dse").map(r => Number(r.id)))] };
      const [ra, rt, pl, pt] = await Promise.all([
        want.reach.length ? sb.from("reach_athletes").select("*").in("id", want.reach) : { data: [] },
        want.reach.length ? sb.from("reach_athlete_tests").select("*").in("athlete_id", want.reach).order("test_date") : { data: [] },
        want.dse.length ? sb.from("players").select(PLAYER_COLS).in("id", want.dse) : { data: [] },
        want.dse.length ? sb.from("player_stat_tests").select("*").in("player_id", want.dse).order("test_date") : { data: [] },
      ]);
      const bad = [], saved = [], cleared = [], flags = [];
      for (const r of rows) {
        const reach = r.kind === "reach";
        const who = reach ? (ra.data || []).find(x => x.id === Number(r.id)) : (pl.data || []).find(x => x.id === Number(r.id));
        if (!who) continue;
        const hist = ((reach ? rt.data : pt.data) || []).filter(t => (reach ? t.athlete_id : t.player_id) === who.id);
        const old = hist.find(t => String(t.test_date).slice(0, 10) === date) || null;
        const vals = r.values && typeof r.values === "object" ? r.values : {};
        const out = {}, extra = { ...(old?.extra || {}) };
        let unreadable = false;
        for (const k of keys) {
          if (!(k in vals)) { if (old) { if (COLUMNS.includes(k)) out[k] = old[k] ?? null; } continue; }
          const v = parseMetric(k, vals[k]);
          if (Number.isNaN(v)) { unreadable = true; continue; }
          const n = v == null ? null : +v.toFixed(2);
          if (COLUMNS.includes(k)) out[k] = n; else if (n == null) delete extra[k]; else extra[k] = n;
        }
        if (unreadable) { bad.push({ kind: r.kind, id: who.id }); continue; }
        // Stand & reach rarely changes: the latest one on or before this day
        // (a DS Elite player's tryout number counts) sets the vertical.
        const earlier = hist.filter(t => String(t.test_date).slice(0, 10) < date && t.stand_reach != null);
        const reachNow = out.stand_reach ?? (earlier.length ? +earlier[earlier.length - 1].stand_reach : (!reach && who.stand_reach != null ? +who.stand_reach : null));
        out.vertical = out.approach_touch != null && reachNow != null ? +(out.approach_touch - reachNow).toFixed(2) : null;
        const notes = "notes" in r ? (str(r.notes, 300) || null) : (old?.notes ?? null);
        const empty = COLUMNS.every(k => out[k] == null) && !Object.keys(extra).length && !notes;
        const tbl = reach ? "reach_athlete_tests" : "player_stat_tests";
        if (empty) {
          if (old) { const { error } = await sb.from(tbl).delete().eq("id", old.id); if (error) throw fail(500, error.message); cleared.push({ kind: r.kind, id: who.id }); }
          continue;
        }
        const rec = { ...out, extra, notes, test_date: date, recorded_by: name || me, source: "hq", updated_at: new Date().toISOString(),
          ...(reach ? { athlete_id: who.id } : { player_id: who.id, team_name: who.team_assignment || null }) };
        const { data: up, error } = await sb.from(tbl).upsert(rec, { onConflict: reach ? "athlete_id,test_date" : "player_id,test_date" }).select("*").single();
        if (error) throw fail(500, error.message);
        saved.push({ kind: r.kind, id: who.id, test: up });
        // Numbers that look like typos on the day just saved (staff only).
        const after = [...hist.filter(t => t.id !== up.id), up];
        const asPlayer = reach ? { ...who, usav_div: null, stand_reach: null, approach_touch: null, jump_touch: null, sprint_10y: null, sprint_mph: null } : who;
        for (const f of statFlags(asPlayer, after)) if (f.row === "test:" + up.id || f.prevRow === "test:" + up.id)
          flags.push({ kind: r.kind, id: who.id, name: `${who.first_name} ${who.last_name || ""}`.trim(), level: f.level, reason: f.reason });
      }
      if (bad.length) throw fail(400, "Some numbers couldn't be read - check the highlighted rows.", { bad, saved: saved.length });
      return { date, saved: saved.length, cleared: cleared.length, tests: saved.map(s => ({ kind: s.kind, test: s.test })), flags };
    }

    case "result_delete": {
      const tbl = b.kind === "reach" ? "reach_athlete_tests" : b.kind === "dse" ? "player_stat_tests" : null;
      if (!tbl || !Number(b.id)) throw fail(400, "Which result?");
      const { error } = await sb.from(tbl).delete().eq("id", Number(b.id));
      if (error) throw fail(500, error.message);
      return {};
    }

    case "metric_save": {
      const m = b.metric && typeof b.metric === "object" ? b.metric : {};
      const label = str(m.label, 40);
      if (!label) throw fail(400, "Name the test");
      let key = str(m.key, 41);
      if (!key) {
        key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 36);
        if (!/^[a-z]/.test(key)) key = "t_" + key;
        if (key.length < 2) key = "test";
        let n = 2, base = key;
        while (BUILT_IN_METRICS.includes(key) || custom.some(c => c.key === key)) key = `${base}_${n++}`;
      } else if (BUILT_IN_METRICS.includes(key)) throw fail(400, "That's a built-in test");
      if (!/^[a-z][a-z0-9_]{1,40}$/.test(key)) throw fail(400, "Bad test key");
      const unit = UNITS.includes(m.unit) ? m.unit : str(m.unit, 10).toLowerCase().replace(/[^a-z%/]/g, "");
      const row = { key, label, unit, higher_better: m.higher_better !== false, on_board: m.on_board !== false, active: m.active !== false,
        sort: Number.isFinite(+m.sort) ? Math.round(+m.sort) : 100, ...(custom.some(c => c.key === key) ? {} : { created_by: me }) };
      const { data, error } = await sb.from("stat_metrics").upsert(row, { onConflict: "key" }).select("*").single();
      if (error) throw fail(500, error.message);
      return { metric: data };
    }

    default:
      throw fail(400, `Unknown action "${b.action || ""}"`);
  }
}
