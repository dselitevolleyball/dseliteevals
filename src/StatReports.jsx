// Testing Reports — the performance coach's testing emails to families
// (Oct 2026). Template editor with a live preview (every part of the email,
// including the metrics section, is editable) and a test send to any address;
// then player by player: enter test results, pick which metrics to show
// (baseline, now, change, improvements flagged), add what she worked on and a
// personal note, preview exactly what the family gets, test, send.
// Builder: shared/stat-report.js (same as the server's send in api/stat-report.js).
//
// Red flags (Drew, Oct 12 2026: "red-flag potential issues with players'
// metrics — things that seem too high or too low — potentially a data entry
// issue"): statFlags in the shared builder marks numbers that look like typos
// (centimeters in an inches box, a touch below her reach, a 13" jump in four
// months…). Here they show as the "Check these numbers" panel, badges on the
// player list, outlined cells with the reason in her metric list, and a fix
// box. A flagged metric is left out of her email until someone fixes the number
// or ticks it back in; the send API holds them back too (defence in depth) and
// flag text never reaches a family.

import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "./supabase";
import { buildReport, metricRows, fmtMetric, fmtChange, baselineLabel, statResultRows, allStatFlags, flaggedReportKeys, DEFAULT_SETTINGS, METRICS, SAMPLE_PLAYER, SAMPLE_TESTS, SAMPLE_DRAFT, SAMPLE_TEAM } from "../shared/stat-report.js";
import { StatsLinks } from "./PlayerStats.jsx";

const C = { bg: "#0a0a0a", card: "#141414", border: "#2a2a2a", gold: "#e91e8c", text: "#ffffff", mut: "#999999", red: "#ef4444", grn: "#22c55e", amb: "#f59e0b" };
const inp = { background: "#0f0f0f", border: "1px solid " + C.border, borderRadius: 8, color: C.text, fontFamily: "inherit", fontSize: 13, padding: "8px 10px", width: "100%", boxSizing: "border-box" };
const lbl = { fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: C.mut, marginBottom: 4, display: "block" };
const TERMINAL = ["declined", "not_invited", "opted_out"];
const OWNER_EMAILS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];
const fmtD = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
const teamSort = (a, b) => (parseInt(a) || 99) - (parseInt(b) || 99) || a.localeCompare(b);
const btn = (primary) => ({ padding: "9px 14px", borderRadius: 8, border: primary ? "none" : "1px solid " + C.border, background: primary ? C.gold : "transparent", color: primary ? "#000" : C.text, fontWeight: primary ? 800 : 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" });
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
// "9'4", "9 4", "112" -> inches; plain decimals for seconds.
const parseIn = (v) => { const s = String(v || "").trim(); if (!s) return null; const m = /^(\d+)\s*['’ ]\s*(\d+(?:\.\d+)?)?\s*"?$/.exec(s); if (m && /['’ ]/.test(s)) return +m[1] * 12 + (m[2] ? +m[2] : 0); const n = parseFloat(s); return Number.isFinite(n) ? n : null; };
const LABEL = Object.fromEntries(METRICS.map(m => [m[0], m[1]]));
// A flagged number as staff check it: raw inches / seconds to the hundredth,
// the same unit the flag reasons quote (90.16", 2.91s). Rounded by the shared
// builder (fmtMetric's vertical / 10-yard branches are plain hundredths), so a
// computed 15.42499… reads 15.43" here, in its reason and in the email alike —
// Math.round gave 15.42" (Oct 12 2026; same helper as the player card's fk).
const fv = (k, v) => fmtMetric(k === "dash_10y" ? k : "vertical", v);
const flagC = (x) => (Array.isArray(x) ? x.some(f => f.level === "red") : x === "red") ? C.red : C.amb;
const hasTryout = (p) => [p?.stand_reach, p?.approach_touch, p?.jump_touch, p?.sprint_10y].some(v => v != null && v !== "") || !!p?.stat_baseline_date;
// Ticking a flagged metric back in is saved in the draft's metrics array
// (stat_report_drafts.metrics is TEXT[]) as "ok:<key>:<fingerprint of the
// flags behind it>". It covers exactly those numbers: fix one, or a new test
// raises a new flag, and the fingerprint no longer matches, so the metric is
// held back again. buildReport only matches real metric keys, so the token
// never reaches the email. api/stat-report.js re-checks the saved token
// against its own fresh flags with a copy of these two lines (keep them the
// same; a mismatch only holds the metric back, it never lets one through).
const flagPrint = (flags, k) => {
  const s = flags.filter(f => f.key === k || (f.related || []).includes(k)).map(f => `${f.row}/${f.rule}/${Math.round((+f.value || 0) * 100)}`).sort().join(",");
  let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};
const ackOf = (flags, k) => `ok:${k}:${flagPrint(flags, k)}`;
// The fix box: which boxes a result has, and where tryout numbers live on players.
const FIX_KEYS = ["stand_reach", "approach_touch", "standing_touch", "broad_jump", "dash_10y"];
const TRYOUT_COL = { stand_reach: "stand_reach", approach_touch: "approach_touch", standing_touch: "jump_touch", dash_10y: "sprint_10y" };

export default function StatReports({ coach, players = [], session }) {
  const [settings, setSettings] = useState(null);
  const [tests, setTests] = useState([]);
  const [drafts, setDrafts] = useState(new Map());
  const [sends, setSends] = useState([]);
  const [team, setTeam] = useState("");
  const [pid, setPid] = useState(null);
  const [showTpl, setShowTpl] = useState(false);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [testTo, setTestTo] = useState(coach?.email || "");
  const [tplPreview, setTplPreview] = useState("sample");
  const [entry, setEntry] = useState(null);
  // Player rows changed here (baseline date, a fixed tryout number) show at
  // once; App's realtime feed brings the same values back in `players`.
  const [patch, setPatch] = useState(new Map());
  const [showFlags, setShowFlags] = useState(true);
  const [fix, setFix] = useState(null);   // { row, from, vals } — the flagged result being corrected
  const panelRef = useRef(null);
  const me = coach?.display_name || coach?.email || null;
  // Baseline dates and tryout numbers live on players: admins only (Brandon
  // fixes his own test results; tryout numbers belong to the evaluators).
  const isAdmin = !!coach?.is_admin || OWNER_EMAILS.includes(String(coach?.email || "").trim().toLowerCase());

  const load = async () => {
    const [s, t, d, x] = await Promise.all([
      supabase.from("stat_report_settings").select("data").eq("id", "main").maybeSingle(),
      supabase.from("player_stat_tests").select("*").order("test_date"),
      supabase.from("stat_report_drafts").select("*"),
      supabase.from("stat_report_sends").select("player_id, sent_at, test, recipients, sent_by").order("sent_at", { ascending: false }),
    ]);
    setSettings({ ...DEFAULT_SETTINGS, ...(s.data?.data || {}) });
    setTests(t.data || []); setDrafts(new Map((d.data || []).map(r => [r.player_id, r]))); setSends(x.data || []);
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { if (!testTo && coach?.email) setTestTo(coach.email); }, [coach?.email]);

  const allPlayers = useMemo(() => patch.size ? players.map(p => patch.has(p.id) ? { ...p, ...patch.get(p.id) } : p) : players, [players, patch]);
  const roster = useMemo(() => allPlayers.filter(p => p.team_assignment && (p.season || "2026-27") === "2026-27" && !TERMINAL.includes(p.offer_status || "")), [allPlayers]);
  const teams = useMemo(() => [...new Set(roster.map(p => p.team_assignment))].sort(teamSort), [roster]);
  useEffect(() => { if (!team && teams.length) setTeam(teams[0]); }, [teams, team]);
  const testsBy = useMemo(() => { const m = new Map(); for (const t of tests) { if (!m.has(t.player_id)) m.set(t.player_id, []); m.get(t.player_id).push(t); } return m; }, [tests]);
  // Flags over every 2026-27 player, teamless ones too: the "unusual for her
  // age group" check pools the whole club (same pool as api/stat-report.js),
  // and a typo on a girl who isn't on a team is still a typo.
  const flagsAll = useMemo(() => allStatFlags(allPlayers.filter(p => (p.season || "2026-27") === "2026-27"), testsBy), [allPlayers, testsBy]);
  const flagsBy = useMemo(() => { const m = new Map(); for (const f of flagsAll) { if (!m.has(f.player_id)) m.set(f.player_id, []); m.get(f.player_id).push(f); } return m; }, [flagsAll]);
  const rosterIds = useMemo(() => new Set(roster.map(p => p.id)), [roster]);
  const lastSend = (id) => sends.find(s => s.player_id === id && !s.test);
  const onTeam = roster.filter(p => p.team_assignment === team).sort((a, b) => a.first_name.localeCompare(b.first_name));
  const player = roster.find(p => p.id === pid) || null;
  const parentEmails = (p) => [...new Set([p.parent_email, p.parent_email2, p.parent_email3].map(e => String(e || "").trim().toLowerCase()).filter(e => /@/.test(e)))];
  const parentFirstOf = (p) => { const f = [...new Set([p.parent_name, p.parent2_name].map(x => String(x || "").trim().split(/\s+/)[0]).filter(Boolean))]; return f.length <= 1 ? (f[0] || "") : f.slice(0, -1).join(", ") + " and " + f[f.length - 1]; };
  // What a player's flags do to her email: held = the report metrics a flag
  // touches (flaggedReportKeys), acked = the held ones someone ticked back in
  // for these exact flags, omit = held − acked (what buildReport leaves out),
  // cut = the omitted ones her email would otherwise show (her ticks, else the
  // template's defaults, else every metric — the pick buildReport makes). Only
  // cut is news to staff: with the template on approach touch + vertical, all 11
  // flagged players on Oct 12 were told "Left out: Standing jump touch" about a
  // metric that was never going in (Kate Lockett, Katerina Gorelik…). omit still
  // goes to buildReport and the server, so a held metric can't sneak in later.
  // The sample player is made up and never held.
  const holdOf = (p) => {
    if (!p?.id) return { flags: [], held: [], acked: [], omit: [], cut: [] };
    const flags = flagsBy.get(p.id) || [], mine = testsBy.get(p.id) || [];
    const held = flags.length ? flaggedReportKeys(p, mine, flags) : [];
    const saved = drafts.get(p.id)?.metrics || [];
    const acked = held.filter(k => saved.includes(ackOf(flags, k)));
    const omit = held.filter(k => !acked.includes(k));
    const sk = saved.filter(k => LABEL[k]), dm = Array.isArray(settings?.default_metrics) && settings.default_metrics.length ? settings.default_metrics : null;
    const pick = sk.length ? sk : dm || metricRows(p, mine).map(r => r.key);
    return { flags, held, acked, omit, cut: omit.filter(k => pick.includes(k)) };
  };
  // Sent with every send so the server holds back the same metrics even if its
  // own flag check came out differently (api/stat-report.js).
  const flagBody = (h) => ({ flagged: h.held, include_flagged: h.acked });
  const labels = (ks) => ks.map(k => LABEL[k] || k).join(", ");

  const saveSettings = async (patch) => {
    const next = { ...settings, ...patch }; setSettings(next);
    const { error } = await supabase.from("stat_report_settings").upsert({ id: "main", data: next, updated_by: me, updated_at: new Date().toISOString() });
    if (error) setMsg({ err: error.message });
  };
  const saveDraft = async (id, patch) => {
    const cur = drafts.get(id) || { player_id: id };
    const next = { ...cur, ...patch, player_id: id, updated_by: me, updated_at: new Date().toISOString() };
    setDrafts(m => new Map(m).set(id, next));
    const { error } = await supabase.from("stat_report_drafts").upsert(next);
    if (error) setMsg({ err: error.message });
  };
  const patchPlayer = (id, upd) => setPatch(m => new Map(m).set(id, { ...(m.get(id) || {}), ...upd }));
  // players.stat_baseline_date: the day her tryout numbers were measured,
  // shown in her email instead of "Tryouts" (migrations/20261012_stat_baseline_date.sql).
  const saveBaseline = async (v) => {
    if (!player || (v && !/^\d{4}-\d{2}-\d{2}$/.test(v))) return;
    const val = v || null;
    patchPlayer(player.id, { stat_baseline_date: val });
    const { error } = await supabase.from("players").update({ stat_baseline_date: val }).eq("id", player.id);
    setMsg(error ? { err: error.message } : { ok: `${player.first_name}'s baseline is now ${val ? baselineLabel({ stat_baseline_date: val }) : "“Tryouts” (no date)"}.` });
  };
  const post = async (body) => {
    const { data: { session: s } } = await supabase.auth.getSession();
    const r = await fetch("/api/stat-report", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (s?.access_token || "") }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Send failed");
    return j;
  };
  const heldNote = (j) => j?.held?.length ? ` Left out as flagged: ${labels(j.held)}.` : "";
  const sendTest = async (p) => {
    const to = testTo.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { setMsg({ err: "Type the email address the test should go to." }); return; }
    setBusy("test"); setMsg(null);
    try { const j = await post(p ? { player_id: p.id, test_to: to, ...flagBody(holdOf(p)) } : { sample: true, test_to: to }); setMsg({ ok: `Test sent to ${to}.` + heldNote(j) }); load(); }
    catch (e) { setMsg({ err: e.message }); }
    setBusy(null);
  };
  const sendReal = async () => {
    if (!player) return;
    const h = holdOf(player);
    const extra = (h.cut.length ? `\n\nLeft out (flagged as a possible typo): ${labels(h.cut)}.` : "") + (h.acked.length ? `\n\nIncludes flagged numbers you ticked: ${labels(h.acked)}.` : "");
    if (!window.confirm(`Send ${player.first_name}'s testing report to ${parentEmails(player).join(", ")}?${extra}`)) return;
    setBusy("send"); setMsg(null);
    try { const j = await post({ player_id: player.id, ...flagBody(h) }); setMsg({ ok: `Sent to ${j.to.join(", ")}.` + heldNote(j) }); load(); }
    catch (e) { setMsg({ err: e.message }); }
    setBusy(null);
  };
  const saveEntry = async () => {
    const e = entry;
    const row = { player_id: player.id, team_name: player.team_assignment, test_date: e.date, recorded_by: me, source: "app",
      stand_reach: parseIn(e.stand_reach), approach_touch: parseIn(e.approach_touch), standing_touch: parseIn(e.standing_touch), broad_jump: parseIn(e.broad_jump), dash_10y: e.dash_10y ? parseFloat(e.dash_10y) : null, notes: e.notes || null };
    if (!["stand_reach", "approach_touch", "standing_touch", "broad_jump", "dash_10y"].some(k => row[k] != null)) { setMsg({ err: "Enter at least one result." }); return; }
    const reach = row.stand_reach ?? metricRows(player, testsBy.get(player.id) || []).find(r => r.key === "stand_reach")?.latest ?? (player.stand_reach != null ? +player.stand_reach : null);
    // Stored to the hundredth like api/stats-form.js (Oct 12 2026).
    if (row.approach_touch != null && reach != null) row.vertical = +(row.approach_touch - reach).toFixed(2);
    setBusy("entry");
    const { error } = await supabase.from("player_stat_tests").insert(row);
    setBusy(null);
    if (error) { setMsg({ err: error.message }); return; }
    setEntry(null); setMsg({ ok: "Test results saved." }); load();
  };
  // Correct a flagged result in place: the tryout numbers on players (admins),
  // or one player_stat_tests row. Vertical is redone from approach − reach the
  // way api/stats-form.js stores it (to the hundredth since Oct 12 2026: a
  // toFixed(1) here turned Denver Dolch's 104.72 − 83 back into 21.7" on every
  // save), including later tests that borrowed this reach because they had
  // none of their own.
  const startFix = (row) => {
    const mine = testsBy.get(player.id) || [];
    const r = statResultRows(player, mine).find(x => x.row === row); if (!r) return;
    const src = row === "tryout" ? { stand_reach: player.stand_reach, approach_touch: player.approach_touch, standing_touch: player.jump_touch, dash_10y: player.sprint_10y } : mine.find(t => "test:" + t.id === row) || {};
    setFix({ row, from: r.from, vals: Object.fromEntries(FIX_KEYS.map(k => [k, num(src[k]) == null ? "" : String(num(src[k]))])) });
  };
  const saveFix = async () => {
    const p = player, mine = testsBy.get(p.id) || [], row = fix.row, tryout = row === "tryout";
    const v = {};
    for (const k of FIX_KEYS) {
      if (tryout && k === "broad_jump") continue;
      const s = String(fix.vals[k] ?? "").trim();
      const n = s === "" ? null : k === "dash_10y" ? parseFloat(s) : parseIn(s);
      if (s !== "" && !Number.isFinite(n)) { setMsg({ err: `Couldn't read ${LABEL[k]} "${s}".` }); return; }
      v[k] = n;
    }
    const t0 = tryout ? null : mine.find(t => "test:" + t.id === row);
    if (!tryout && !t0) return;
    const p2 = tryout ? { ...p, stand_reach: v.stand_reach, approach_touch: v.approach_touch, jump_touch: v.standing_touch, sprint_10y: v.dash_10y } : p;
    const tests2 = tryout ? mine : mine.map(t => t === t0 ? { ...t, ...v, vertical: null } : t);
    const before = new Map(statResultRows(p, mine).map(r => [r.row, r]));
    const now = new Date().toISOString(), testUpd = [];
    for (const r of statResultRows(p2, tests2)) {
      const t = r.tryout ? null : mine.find(x => "test:" + x.id === r.row); if (!t) continue;
      if (r.row === row) { testUpd.push([t.id, { ...v, vertical: v.approach_touch != null && r.reach != null ? +(v.approach_touch - r.reach).toFixed(2) : null, updated_at: now }]); continue; }
      const b = before.get(r.row), ap = num(t.approach_touch), vt = num(t.vertical);
      if (num(t.stand_reach) != null || ap == null || vt == null || !b || b.reach === r.reach) continue;
      if (b.reach != null && Math.abs(vt - (ap - b.reach)) > 0.11) continue;   // typed by hand, not worked out: leave it
      testUpd.push([t.id, { vertical: r.reach != null ? +(ap - r.reach).toFixed(2) : null, updated_at: now }]);
    }
    setBusy("fix");
    let error = null;
    if (tryout) {
      const upd = {}; for (const [k, col] of Object.entries(TRYOUT_COL)) if (num(p[col]) !== v[k]) upd[col] = v[k];
      if (Object.keys(upd).length) { ({ error } = await supabase.from("players").update(upd).eq("id", p.id)); if (!error) patchPlayer(p.id, upd); }
    }
    for (const [id, u] of error ? [] : testUpd) { ({ error } = await supabase.from("player_stat_tests").update(u).eq("id", id)); if (error) break; }
    setBusy(null);
    if (error) { setMsg({ err: error.message }); return; }
    const redone = testUpd.length - (tryout ? 0 : 1);
    setFix(null); setMsg({ ok: `${p.first_name}'s ${fix.from} numbers saved.` + (redone > 0 ? ` Vertical redone on ${redone} later test${redone === 1 ? "" : "s"} that used that reach.` : "") }); load();
  };
  const pickPlayer = (id) => { setPid(id); setMsg(null); setEntry(null); setFix(null); };
  const openFlag = (f) => {
    const p = roster.find(x => x.id === f.player_id); if (!p) return;
    setShowTpl(false); setTeam(p.team_assignment); pickPlayer(p.id);
    setTimeout(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  if (!settings) return <div style={{ padding: 24, color: C.mut }}>Loading…</div>;

  // Template preview: the sample player, or any real player.
  const tplPlayer = tplPreview === "sample" ? SAMPLE_PLAYER : roster.find(p => String(p.id) === tplPreview) || SAMPLE_PLAYER;
  const tplHold = holdOf(tplPlayer);
  const matesOf = (p) => roster.filter(x => x.team_assignment === p.team_assignment).map(x => ({ player: x, tests: testsBy.get(x.id) || [] }));
  const tplRep = buildReport({ player: tplPlayer, tests: tplPlayer.id ? (testsBy.get(tplPlayer.id) || []) : SAMPLE_TESTS, settings, draft: tplPlayer.id ? (drafts.get(tplPlayer.id) || {}) : SAMPLE_DRAFT, parentFirst: tplPlayer.id ? parentFirstOf(tplPlayer) : "Jordan", teammates: tplPlayer.id ? matesOf(tplPlayer) : SAMPLE_TEAM, omit: tplHold.omit });

  const draft = player ? (drafts.get(player.id) || {}) : {};
  const rows = player ? metricRows(player, testsBy.get(player.id) || []) : [];
  const hold = holdOf(player);
  const rep = player ? buildReport({ player, tests: testsBy.get(player.id) || [], settings, draft, parentFirst: parentFirstOf(player), teammates: matesOf(player), omit: hold.omit }) : null;
  const defaults = Array.isArray(settings.default_metrics) && settings.default_metrics.length ? settings.default_metrics : null;
  const savedKeys = (Array.isArray(draft.metrics) ? draft.metrics : []).filter(k => LABEL[k]);
  // base = what she'd get with no flags; a held metric stays in base (so it
  // comes back by itself once the number is fixed) but is shown unticked.
  const base = new Set(savedKeys.length ? savedKeys : (defaults || rows.map(r => r.key)));
  const picked = new Set([...base].filter(k => !hold.omit.includes(k)));
  const toggleMetric = (k) => {
    const want = new Set(base), ok = new Set(hold.acked);
    if (picked.has(k)) { want.delete(k); ok.delete(k); }
    else { want.add(k); if (hold.held.includes(k)) ok.add(k); }   // ticking a flagged one = "include anyway"
    saveDraft(player.id, { metrics: [...rows.map(r => r.key).filter(x => want.has(x)), ...[...ok].map(x => ackOf(hold.flags, x))] });
  };
  const tested = (p) => (testsBy.get(p.id) || []).length;
  const redN = flagsAll.filter(f => f.level === "red").length, amberN = flagsAll.length - redN;
  const out = (fl) => fl.length ? { outline: "2px solid " + flagC(fl), outlineOffset: 2, borderRadius: 4 } : {};
  const T = (k, label, rowsN = 1, hint) => (
    <label key={k} style={{ display: "block", marginBottom: 10 }}><span style={lbl}>{label}</span>
      {rowsN > 1 ? <textarea key={k + String(settings[k]).length} defaultValue={settings[k]} rows={rowsN} onBlur={e => e.target.value !== settings[k] && saveSettings({ [k]: e.target.value })} style={{ ...inp, resize: "vertical", lineHeight: 1.5 }} />
        : <input defaultValue={settings[k]} onBlur={e => e.target.value !== settings[k] && saveSettings({ [k]: e.target.value.trim() })} style={inp} />}
      {hint && <span style={{ fontSize: 11, color: C.mut }}>{hint}</span>}
    </label>
  );
  const Section = ({ title, children }) => <div style={{ border: "1px solid " + C.border, borderRadius: 10, padding: 12, marginBottom: 12 }}><div style={{ fontSize: 12, fontWeight: 800, color: C.gold, marginBottom: 8 }}>{title}</div>{children}</div>;
  const TestBox = ({ p }) => (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="Send a test to (any email)" style={{ ...inp, width: 240 }} />
      <button disabled={!!busy} onClick={() => sendTest(p)} style={btn(false)}>{busy === "test" ? "Sending…" : "Send test"}</button>
    </div>
  );
  const HeldNote = ({ h }) => (<>
    {h.cut.length > 0 && <div style={{ fontSize: 11, color: flagC(h.flags), marginBottom: 6 }}>⚑ Left out because a number looks wrong: <b>{labels(h.cut)}</b>. Fix it or tick it back in. Flag notes never go in the email.</div>}
    {h.acked.length > 0 && <div style={{ fontSize: 11, color: C.amb, marginBottom: 6 }}>⚑ Includes flagged numbers someone ticked back in: <b>{labels(h.acked)}</b>.</div>}
  </>);

  return (
    <div style={{ padding: "16px 16px 40px", maxWidth: 1240, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.gold }}>Testing Reports</h2>
          <div style={{ fontSize: 12, color: C.mut }}>Email each family their daughter's testing numbers — baseline, now, and what got better — with your introduction and the Reach membership.</div>
        </div>
        <button onClick={() => setShowTpl(v => !v)} style={{ ...btn(false), border: "1px solid " + C.gold, background: showTpl ? C.gold : "transparent", color: showTpl ? "#000" : C.gold, fontWeight: 800 }}>{showTpl ? "Close template" : "✎ Edit email template"}</button>
      </div>
      {msg?.ok && <div style={{ color: C.grn, fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{msg.ok}</div>}
      {msg?.err && <div style={{ color: C.red, fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{msg.err}</div>}

      {showTpl && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 1fr) minmax(320px, 1fr)", gap: 14, marginBottom: 14 }}>
          <div style={{ background: C.card, border: "1px solid " + C.gold, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 12, color: C.mut, marginBottom: 10 }}>Used for every report. <b style={{ color: C.text }}>{"{player_first}"}</b> and <b style={{ color: C.text }}>{"{team}"}</b> fill in per girl. Changes save when you click out of a box; the preview updates.</div>
            <Section title="Opening">{T("subject", "Subject")}{T("intro", "Your introduction", 4)}</Section>
            <Section title="Metrics section">
              {T("numbers_heading", "Heading above the numbers")}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>{[["col_test", "Column 1"], ["col_baseline", "Baseline column"], ["col_now", "Now column"], ["col_change", "Change column"]].map(([k, l]) => T(k, l))}</div>
              <span style={lbl}>Metrics included by default (each player can still change hers)</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                {METRICS.map(([k, l]) => { const on = !defaults || defaults.includes(k); return (
                  <button key={k} onClick={() => { const cur = new Set(defaults || METRICS.map(m => m[0])); cur.has(k) ? cur.delete(k) : cur.add(k); const arr = METRICS.map(m => m[0]).filter(x => cur.has(x)); saveSettings({ default_metrics: arr.length === METRICS.length ? [] : arr }); }}
                    style={{ fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", border: "1px solid " + (on ? C.gold : C.border), background: on ? "rgba(233,30,140,0.15)" : "transparent", color: on ? C.gold : C.mut }}>{l}</button>); })}
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={settings.show_gains !== false} onChange={e => saveSettings({ show_gains: e.target.checked })} style={{ accentColor: C.gold, width: 16, height: 16 }} /> Show the "got better" summary line
              </label>
              {T("gains_text", "Summary line starts with", 1, "Followed automatically by each improved metric and how much.")}
              {T("worked_heading", "Heading for \"what she worked on\"")}
            </Section>
            <Section title="Team comparison chart">
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 6, cursor: "pointer" }}><input type="checkbox" checked={settings.show_team !== false} onChange={e => saveSettings({ show_team: e.target.checked })} style={{ accentColor: C.gold, width: 16, height: 16 }} /> Show where she ranks against her team and the team average (teammates unnamed; needs 3+ players with results)</label>
              <span style={lbl}>Metrics compared against the team</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                {METRICS.filter(m => m[0] !== "stand_reach").map(([k, l]) => { const cur = Array.isArray(settings.team_metrics) && settings.team_metrics.length ? settings.team_metrics : ["vertical", "broad_jump", "dash_10y"]; const on = cur.includes(k); return (
                  <button key={k} onClick={() => { const n = new Set(cur); n.has(k) ? n.delete(k) : n.add(k); if (!n.size) return; saveSettings({ team_metrics: METRICS.map(m => m[0]).filter(x => n.has(x)) }); }}
                    style={{ fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", border: "1px solid " + (on ? C.gold : C.border), background: on ? "rgba(233,30,140,0.15)" : "transparent", color: on ? C.gold : C.mut }}>{l}</button>); })}
              </div>
              {T("team_heading", "Heading")}{T("team_note", "Note under the heading")}
            </Section>
            <Section title="Reach membership pitch">{T("pitch_heading", "Heading")}{T("pitch", "Pitch", 5)}{T("pitch_button", "Button text")}{T("pitch_link", "Button link (leave blank to hide the button)")}</Section>
            <Section title="Sign-off">{T("signoff", "Sign-off", 3)}</Section>
          </div>
          <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 14, alignSelf: "start", position: "sticky", top: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
              <span style={{ ...lbl, marginBottom: 0 }}>Preview with</span>
              <select value={tplPreview} onChange={e => setTplPreview(e.target.value)} style={{ ...inp, width: "auto" }}>
                <option value="sample">Sample player (made-up numbers)</option>
                {roster.filter(p => tested(p) || p.approach_touch != null || p.stand_reach != null).sort((a, b) => tested(b) - tested(a) || a.first_name.localeCompare(b.first_name)).map(p => <option key={p.id} value={String(p.id)}>{p.first_name} {p.last_name} · {p.team_assignment}{tested(p) ? " · retested" : ""}{flagsBy.has(p.id) ? " · ⚑" : ""}</option>)}
              </select>
            </div>
            <TestBox p={tplPlayer.id ? tplPlayer : null} />
            <div style={{ fontSize: 12, color: C.mut, margin: "10px 0 6px" }}>Subject: <b style={{ color: C.text }}>{tplRep.subject}</b></div>
            <HeldNote h={tplHold} />
            <div style={{ background: "#fff", borderRadius: 8, padding: "18px 20px", maxHeight: "70vh", overflow: "auto" }} dangerouslySetInnerHTML={{ __html: tplRep.html }} />
          </div>
        </div>
      )}

      {!showTpl && <StatsLinks session={session} />}

      {!showTpl && flagsAll.length > 0 && (
        <div style={{ background: C.card, border: "1px solid " + (redN ? C.red : C.amb), borderRadius: 12, padding: 12, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: redN ? C.red : C.amb }}>⚑ Check these numbers</span>
            <span style={{ fontSize: 11, color: C.mut }}>{redN} likely typo{redN === 1 ? "" : "s"} · {amberN} to double-check · {new Set(flagsAll.map(f => f.player_id)).size} players</span>
            <div style={{ flex: 1 }} />
            <button onClick={() => setShowFlags(v => !v)} style={{ ...btn(false), padding: "4px 10px", fontSize: 12 }}>{showFlags ? "Hide" : "Show"}</button>
          </div>
          {showFlags && (<>
            <div style={{ fontSize: 11, color: C.mut, margin: "4px 0 8px" }}>Numbers that look like data-entry slips: centimeters in an inches box, a missing decimal point, a touch below her reach, a jump that changed more than training explains. Red = likely wrong, amber = double-check. Staff only; a flagged number stays out of the family email until it's fixed or ticked back in. Tap one to open her report.</div>
            <div style={{ maxHeight: 340, overflowY: "auto" }}>
              {flagsAll.map((f, i) => { const can = rosterIds.has(f.player_id); return (
                <div key={i} onClick={can ? () => openFlag(f) : undefined} title={can ? "Open her report" : "Not on a 2026-27 team, so no report. Fix the number on her player card."}
                  style={{ display: "grid", gridTemplateColumns: "16px minmax(0, 1fr)", gap: 6, padding: "6px 8px", borderRadius: 8, cursor: can ? "pointer" : "default", background: pid === f.player_id ? "rgba(233,30,140,0.10)" : "transparent", borderTop: i ? "1px solid " + C.border : "none" }}>
                  <span style={{ color: flagC(f.level), fontSize: 12, lineHeight: "20px" }}>⚑</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline", fontSize: 13 }}>
                      <b style={{ color: can ? C.text : C.mut }}>{f.player}</b>
                      <span style={{ fontSize: 11, color: C.mut }}>{f.team || "no team"}</span>
                      <span style={{ fontSize: 12 }}>{LABEL[f.key]} <b style={{ color: flagC(f.level) }}>{fv(f.key, f.value)}</b></span>
                      <span style={{ fontSize: 11, color: C.mut }}>{f.from}</span>
                    </div>
                    <div style={{ fontSize: 11, color: C.mut, lineHeight: 1.4 }}>{f.reason}</div>
                  </div>
                </div>); })}
            </div>
          </>)}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 300px) 1fr", gap: 14, alignItems: "start" }}>
        <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 10 }}>
          <select value={team} onChange={e => { setTeam(e.target.value); pickPlayer(null); }} style={{ ...inp, marginBottom: 8 }}>{teams.map(t => { const n = roster.filter(p => p.team_assignment === t && flagsBy.has(p.id)).length; return <option key={t} value={t}>{t}{n ? `  ·  ⚑ ${n}` : ""}</option>; })}</select>
          {onTeam.map(p => { const s = lastSend(p.id), n = tested(p), fl = flagsBy.get(p.id) || []; return (
            <button key={p.id} onClick={() => pickPlayer(p.id)} style={{ display: "flex", width: "100%", textAlign: "left", gap: 8, alignItems: "center", padding: "8px 10px", marginBottom: 4, borderRadius: 8, border: "1px solid " + (pid === p.id ? C.gold : "transparent"), background: pid === p.id ? "rgba(233,30,140,0.12)" : "transparent", color: C.text, cursor: "pointer", fontFamily: "inherit" }}>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{p.first_name} {p.last_name}</span>
              {fl.length > 0 && <span title={fl.map(f => `${LABEL[f.key]} (${f.from}): ${f.reason}`).join("\n")} style={{ fontSize: 10, fontWeight: 800, color: flagC(fl), border: "1px solid " + flagC(fl), borderRadius: 999, padding: "0 6px", lineHeight: "16px" }}>⚑ {fl.length}</span>}
              <span style={{ fontSize: 10, color: n ? C.grn : C.mut }}>{n ? n + " test" + (n === 1 ? "" : "s") : "tryout only"}</span>
              {s && <span title={"Sent " + fmtD(s.sent_at)} style={{ fontSize: 10, color: C.gold, fontWeight: 800 }}>✓ {fmtD(s.sent_at)}</span>}
            </button>); })}
          {!onTeam.length && <div style={{ color: C.mut, fontSize: 12, padding: 8 }}>No players on this team.</div>}
        </div>

        <div ref={panelRef} style={{ scrollMarginTop: 12 }}>
          {!player ? <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 20, color: C.mut, fontSize: 13 }}>Pick a player to enter her results and build her report.</div> : (<>
            <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 14, marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <b style={{ fontSize: 16 }}>{player.first_name} {player.last_name}</b><span style={{ color: C.mut, fontSize: 12 }}>{player.team_assignment}</span>
                {hasTryout(player) && (isAdmin
                  ? <label title="The day her tryout numbers were measured. Her email shows this date instead of “Tryouts”." style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.mut }}>Baseline measured
                      <input type="date" value={player.stat_baseline_date ? String(player.stat_baseline_date).slice(0, 10) : ""} onChange={e => saveBaseline(e.target.value)} style={{ ...inp, width: 140, padding: "3px 6px", fontSize: 12, colorScheme: "dark" }} /></label>
                  : <span style={{ fontSize: 11, color: C.mut }}>Baseline {baselineLabel(player)}</span>)}
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: C.mut }}>To: {parentEmails(player).join(", ") || <span style={{ color: C.red }}>no parent email</span>}</span>
              </div>

              {!entry ? <button onClick={() => setEntry({ date: new Date().toISOString().slice(0, 10) })} style={{ ...btn(false), marginBottom: 10 }}>＋ Add test results</button> : (
                <div style={{ border: "1px solid " + C.gold, borderRadius: 10, padding: 10, marginBottom: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
                    <label><span style={lbl}>Test date</span><input type="date" value={entry.date} onChange={e => setEntry({ ...entry, date: e.target.value })} style={inp} /></label>
                    {[["stand_reach", "Standing reach", "7'6 or 90"], ["approach_touch", "Approach touch", "9'7 or 115"], ["standing_touch", "Standing jump touch", "8'5"], ["broad_jump", "Broad jump (in)", "86"], ["dash_10y", "10-yard (sec)", "1.88"]].map(([k, l, ph]) => (
                      <label key={k}><span style={lbl}>{l}</span><input value={entry[k] || ""} placeholder={ph} onChange={e => setEntry({ ...entry, [k]: e.target.value })} style={inp} /></label>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: C.mut, margin: "6px 0" }}>Heights as feet'inches (9'7) or total inches (115). Vertical is worked out from approach touch minus standing reach.</div>
                  <div style={{ display: "flex", gap: 8 }}><button disabled={busy === "entry"} onClick={saveEntry} style={btn(true)}>{busy === "entry" ? "Saving…" : "Save results"}</button><button onClick={() => setEntry(null)} style={btn(false)}>Cancel</button></div>
                </div>
              )}

              {hold.flags.length > 0 && (() => {
                const red = hold.flags.some(f => f.level === "red"), n = hold.flags.length;
                // Results worth a fix box: the flagged one, the earlier end of a
                // change flag, and the result a borrowed reach came from (Annie
                // Ruffin's Oct 11 test has no reach, so a bad tryout reach shows up
                // on that test's jump numbers). Oldest first.
                const res = statResultRows(player, testsBy.get(player.id) || []), at = new Map(res.map(r => [r.row, r]));
                const usesReach = (f) => f.key === "stand_reach" || (f.related || []).includes("stand_reach");
                const flagRows = [...new Set(hold.flags.flatMap(f => [f.row, f.prevRow, usesReach(f) ? at.get(f.row)?.reachRow : null]).filter(r => r && at.has(r)))].sort((a, b) => res.indexOf(at.get(a)) - res.indexOf(at.get(b)));
                return (
                  <div style={{ border: "1px solid " + flagC(hold.flags), background: red ? "rgba(239,68,68,0.08)" : "rgba(245,158,11,0.08)", borderRadius: 10, padding: 10, marginBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: flagC(hold.flags) }}>⚑ {n} number{n === 1 ? (red ? " looks" : " looks a bit") : (red ? "s look" : "s look a bit")} {red ? "wrong" : "off"}{hold.cut.length ? ` — fix ${n === 1 ? "it" : "them"} first or tick to include.` : "."}</div>
                    <div style={{ fontSize: 12, color: C.mut, margin: "2px 0 6px" }}>
                      {hold.cut.length > 0 && <>Left out of her email for now: <b style={{ color: C.text }}>{labels(hold.cut)}</b>. </>}
                      {hold.acked.length > 0 && <>Included anyway (ticked): <b style={{ color: C.amb }}>{labels(hold.acked)}</b>. </>}
                      {!hold.held.length ? "None of them are a number her email shows (it uses her first and latest results), so nothing is held back."
                        : !hold.cut.length && !hold.acked.length ? `${labels(hold.held)} ${hold.held.length === 1 ? "isn't" : "aren't"} picked for her email, so nothing is held back.` : ""}
                    </div>
                    {hold.flags.map((f, i) => (
                      <div key={i} style={{ display: "flex", gap: 6, fontSize: 12, lineHeight: 1.45, marginBottom: 2 }}>
                        <span style={{ color: flagC(f.level) }}>⚑</span><span><b>{f.from} · {LABEL[f.key]} {fv(f.key, f.value)}:</b> {f.reason}</span>
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
                      {flagRows.map(row => { const fr = at.get(row).from; return row !== "tryout" || isAdmin
                        ? <button key={row} onClick={() => startFix(row)} style={{ ...btn(false), padding: "5px 10px", fontSize: 12, borderColor: fix?.row === row ? C.gold : C.border }}>✎ Fix the {fr}{row === "tryout" ? " tryout" : ""} numbers</button>
                        : <span key={row} style={{ fontSize: 11, color: C.mut }}>Her {fr} tryout numbers are fixed by an admin on her player card.</span>; })}
                    </div>
                    {fix && flagRows.includes(fix.row) && (
                      <div style={{ border: "1px solid " + C.gold, borderRadius: 10, padding: 10, marginTop: 8, background: C.card }}>
                        <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Fix her {fix.from} {fix.row === "tryout" ? "tryout " : "test "}numbers</div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
                          {FIX_KEYS.filter(k => !(fix.row === "tryout" && k === "broad_jump")).map(k => (
                            <label key={k}><span style={lbl}>{LABEL[k]}{k === "dash_10y" ? " (sec)" : " (in)"}</span><input value={fix.vals[k]} onChange={e => setFix({ ...fix, vals: { ...fix.vals, [k]: e.target.value } })} style={inp} /></label>
                          ))}
                        </div>
                        <div style={{ fontSize: 11, color: C.mut, margin: "6px 0" }}>Inches (or feet'inches, 9'4). Vertical is worked out again from approach touch − reach. {fix.row === "tryout" ? "Saves over her tryout numbers (the same boxes as her player card)." : "Saves over this test."}</div>
                        <div style={{ display: "flex", gap: 8 }}><button disabled={busy === "fix"} onClick={saveFix} style={btn(true)}>{busy === "fix" ? "Saving…" : "Save"}</button><button onClick={() => setFix(null)} style={btn(false)}>Cancel</button></div>
                      </div>
                    )}
                  </div>
                );
              })()}

              <span style={lbl}>Metrics in her report (tap to include / leave out)</span>
              {!rows.length && <div style={{ color: C.mut, fontSize: 13 }}>No testing numbers on file yet — add her results above.</div>}
              {rows.map(r => {
                const on = picked.has(r.key), held = hold.held.includes(r.key), dim = on ? 1 : 0.45;
                const shown = [r.baselineRow, r.latestRow].filter(Boolean);
                const own = hold.flags.filter(f => f.key === r.key && (shown.includes(f.row) || (f.prevRow && shown.includes(f.prevRow))));
                const baseF = own.filter(f => !f.prevRow && f.row === r.baselineRow), nowF = own.filter(f => !f.prevRow && f.row === r.latestRow), chgF = own.filter(f => f.prevRow);
                const ride = held && !own.length ? hold.flags.filter(f => (f.related || []).includes(r.key) && (shown.includes(f.row) || (f.prevRow && shown.includes(f.prevRow)))) : [];
                return (
                  <div key={r.key} onClick={() => toggleMetric(r.key)} style={{ display: "grid", gridTemplateColumns: "24px 1.4fr 1fr 1fr 0.8fr", gap: 8, alignItems: "center", padding: "7px 8px", borderRadius: 8, marginBottom: 3, cursor: "pointer", background: on ? (r.better ? "rgba(34,197,94,0.10)" : "#0f0f0f") : "transparent", fontSize: 13, border: held ? "1px dashed " + flagC(own.length ? own : ride) : "1px solid transparent" }}>
                    <span style={{ width: 18, height: 18, borderRadius: 5, border: "2px solid " + (on ? C.gold : held ? flagC(own.length ? own : ride) : C.border), background: on ? C.gold : "transparent", color: on ? "#000" : flagC(own.length ? own : ride), fontSize: 11, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>{on ? "✓" : held ? "⚑" : ""}</span>
                    <span style={{ fontWeight: 700, opacity: dim }}>{r.label}</span>
                    <span style={{ opacity: dim, justifySelf: "start", padding: "0 3px", ...out(baseF) }} title={baseF.map(f => f.reason).join("\n")}><span style={{ color: C.mut, fontSize: 10 }}>Base </span>{fmtMetric(r.key, r.baseline)} <span style={{ color: C.mut, fontSize: 10 }}>{r.baselineFrom}</span></span>
                    <span style={{ opacity: dim, justifySelf: "start", padding: "0 3px", ...out(nowF) }} title={nowF.map(f => f.reason).join("\n")}>{r.latest != null ? <><span style={{ color: C.mut, fontSize: 10 }}>Now </span>{fmtMetric(r.key, r.latest)} <span style={{ color: C.mut, fontSize: 10 }}>{r.latestFrom}</span></> : <span style={{ color: C.mut }}>not retested</span>}</span>
                    <span style={{ fontWeight: 800, color: r.better ? C.grn : C.mut, opacity: dim, justifySelf: "start", padding: "0 3px", ...out(chgF) }} title={chgF.map(f => f.reason).join("\n")}>{r.change == null ? "" : fmtChange(r.key, r.change) + (r.better ? " ▲" : "")}</span>
                    {(own.length > 0 || ride.length > 0) && (
                      <div style={{ gridColumn: "2 / -1", fontSize: 11, lineHeight: 1.4 }}>
                        {own.map((f, i) => <div key={i} style={{ color: flagC(f.level) }}>⚑ {f.from}: {f.reason}</div>)}
                        {ride.length > 0 && <div style={{ color: flagC(ride) }}>⚑ Rides on the flagged {[...new Set(ride.map(f => `${LABEL[f.key]} (${f.from})`))].join(", ")}.</div>}
                        <div style={{ color: C.mut }}>{on ? "Included anyway — tap to leave it out." : base.has(r.key) ? "Left out of her email — tap to include anyway." : "Not picked for her email — tapping adds this flagged number to it."}</div>
                      </div>
                    )}
                  </div>); })}
              <label style={{ display: "block", marginTop: 12 }}><span style={lbl}>What she worked on</span>
                <textarea key={"w" + player.id} defaultValue={draft.worked_on || ""} rows={3} placeholder="e.g. Approach footwork, arm swing timing and first-step quickness." onBlur={e => e.target.value !== (draft.worked_on || "") && saveDraft(player.id, { worked_on: e.target.value })} style={{ ...inp, resize: "vertical" }} />
              </label>
              <label style={{ display: "block", marginTop: 10 }}><span style={lbl}>Personal note (optional)</span>
                <textarea key={"n" + player.id} defaultValue={draft.note || ""} rows={2} placeholder="Anything just for this family." onBlur={e => e.target.value !== (draft.note || "") && saveDraft(player.id, { note: e.target.value })} style={{ ...inp, resize: "vertical" }} />
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
                <TestBox p={player} />
                <div style={{ flex: 1 }} />
                <button disabled={!!busy || !rep?.picked.length || !parentEmails(player).length} onClick={sendReal} style={btn(true)}>{busy === "send" ? "Sending…" : lastSend(player.id) ? "Send again to parents" : "Send to parents"}</button>
              </div>
              {rows.length > 0 && rep && !rep.picked.length && <div style={{ color: C.amb, fontSize: 11, marginTop: 6 }}>Nothing to send yet: {hold.cut.length ? "every number picked for her email is flagged. Fix it, or tick it back in, above." : `none of the metrics picked for her email (${labels([...base])}) have a number for her yet. Tick one above.`}</div>}
              {lastSend(player.id) && <div style={{ color: C.mut, fontSize: 11, marginTop: 6 }}>Last sent {fmtD(lastSend(player.id).sent_at)} by {lastSend(player.id).sent_by}</div>}
            </div>
            {rep && (
              <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 14 }}>
                <span style={lbl}>Preview — exactly what the family gets</span>
                <div style={{ fontSize: 12, color: C.mut, marginBottom: 6 }}>Subject: <b style={{ color: C.text }}>{rep.subject}</b></div>
                <HeldNote h={hold} />
                <div style={{ background: "#fff", borderRadius: 8, padding: "18px 20px" }} dangerouslySetInnerHTML={{ __html: rep.html }} />
              </div>
            )}
          </>)}
        </div>
      </div>
    </div>
  );
}
