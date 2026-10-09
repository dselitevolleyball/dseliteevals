// Testing Reports — the performance coach's testing emails to families
// (Oct 2026). Template editor with a live preview (every part of the email,
// including the metrics section, is editable) and a test send to any address;
// then player by player: enter test results, pick which metrics to show
// (baseline, now, change, improvements flagged), add what she worked on and a
// personal note, preview exactly what the family gets, test, send.
// Builder: shared/stat-report.js (same as the server's send in api/stat-report.js).

import { useState, useEffect, useMemo } from "react";
import { supabase } from "./supabase";
import { buildReport, metricRows, fmtMetric, DEFAULT_SETTINGS, METRICS, SAMPLE_PLAYER, SAMPLE_TESTS, SAMPLE_DRAFT, SAMPLE_TEAM } from "../shared/stat-report.js";
import { StatsLinks } from "./PlayerStats.jsx";

const C = { bg: "#0a0a0a", card: "#141414", border: "#2a2a2a", gold: "#e91e8c", text: "#ffffff", mut: "#999999", red: "#ef4444", grn: "#22c55e" };
const inp = { background: "#0f0f0f", border: "1px solid " + C.border, borderRadius: 8, color: C.text, fontFamily: "inherit", fontSize: 13, padding: "8px 10px", width: "100%", boxSizing: "border-box" };
const lbl = { fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: C.mut, marginBottom: 4, display: "block" };
const TERMINAL = ["declined", "not_invited", "opted_out"];
const fmtD = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
const teamSort = (a, b) => (parseInt(a) || 99) - (parseInt(b) || 99) || a.localeCompare(b);
const btn = (primary) => ({ padding: "9px 14px", borderRadius: 8, border: primary ? "none" : "1px solid " + C.border, background: primary ? C.gold : "transparent", color: primary ? "#000" : C.text, fontWeight: primary ? 800 : 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" });
// "9'4", "9 4", "112" -> inches; plain decimals for seconds.
const parseIn = (v) => { const s = String(v || "").trim(); if (!s) return null; const m = /^(\d+)\s*['’ ]\s*(\d+(?:\.\d+)?)?\s*"?$/.exec(s); if (m && /['’ ]/.test(s)) return +m[1] * 12 + (m[2] ? +m[2] : 0); const n = parseFloat(s); return Number.isFinite(n) ? n : null; };

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
  const me = coach?.display_name || coach?.email || null;

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

  const roster = useMemo(() => players.filter(p => p.team_assignment && (p.season || "2026-27") === "2026-27" && !TERMINAL.includes(p.offer_status || "")), [players]);
  const teams = useMemo(() => [...new Set(roster.map(p => p.team_assignment))].sort(teamSort), [roster]);
  useEffect(() => { if (!team && teams.length) setTeam(teams[0]); }, [teams, team]);
  const testsBy = useMemo(() => { const m = new Map(); for (const t of tests) { if (!m.has(t.player_id)) m.set(t.player_id, []); m.get(t.player_id).push(t); } return m; }, [tests]);
  const lastSend = (id) => sends.find(s => s.player_id === id && !s.test);
  const onTeam = roster.filter(p => p.team_assignment === team).sort((a, b) => a.first_name.localeCompare(b.first_name));
  const player = roster.find(p => p.id === pid) || null;
  const parentEmails = (p) => [...new Set([p.parent_email, p.parent_email2, p.parent_email3].map(e => String(e || "").trim().toLowerCase()).filter(e => /@/.test(e)))];
  const parentFirstOf = (p) => { const f = [...new Set([p.parent_name, p.parent2_name].map(x => String(x || "").trim().split(/\s+/)[0]).filter(Boolean))]; return f.length <= 1 ? (f[0] || "") : f.slice(0, -1).join(", ") + " and " + f[f.length - 1]; };

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
  const post = async (body) => {
    const { data: { session: s } } = await supabase.auth.getSession();
    const r = await fetch("/api/stat-report", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (s?.access_token || "") }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Send failed");
    return j;
  };
  const sendTest = async (p) => {
    const to = testTo.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { setMsg({ err: "Type the email address the test should go to." }); return; }
    setBusy("test"); setMsg(null);
    try { await post(p ? { player_id: p.id, test_to: to } : { sample: true, test_to: to }); setMsg({ ok: `Test sent to ${to}.` }); load(); }
    catch (e) { setMsg({ err: e.message }); }
    setBusy(null);
  };
  const sendReal = async () => {
    if (!player || !window.confirm(`Send ${player.first_name}'s testing report to ${parentEmails(player).join(", ")}?`)) return;
    setBusy("send"); setMsg(null);
    try { const j = await post({ player_id: player.id }); setMsg({ ok: `Sent to ${j.to.join(", ")}.` }); load(); }
    catch (e) { setMsg({ err: e.message }); }
    setBusy(null);
  };
  const saveEntry = async () => {
    const e = entry;
    const row = { player_id: player.id, team_name: player.team_assignment, test_date: e.date, recorded_by: me, source: "app",
      stand_reach: parseIn(e.stand_reach), approach_touch: parseIn(e.approach_touch), standing_touch: parseIn(e.standing_touch), broad_jump: parseIn(e.broad_jump), dash_10y: e.dash_10y ? parseFloat(e.dash_10y) : null, notes: e.notes || null };
    if (!["stand_reach", "approach_touch", "standing_touch", "broad_jump", "dash_10y"].some(k => row[k] != null)) { setMsg({ err: "Enter at least one result." }); return; }
    const reach = row.stand_reach ?? metricRows(player, testsBy.get(player.id) || []).find(r => r.key === "stand_reach")?.latest ?? (player.stand_reach != null ? +player.stand_reach : null);
    if (row.approach_touch != null && reach != null) row.vertical = row.approach_touch - reach;
    setBusy("entry");
    const { error } = await supabase.from("player_stat_tests").insert(row);
    setBusy(null);
    if (error) { setMsg({ err: error.message }); return; }
    setEntry(null); setMsg({ ok: "Test results saved." }); load();
  };

  if (!settings) return <div style={{ padding: 24, color: C.mut }}>Loading…</div>;

  // Template preview: the sample player, or any real player.
  const tplPlayer = tplPreview === "sample" ? SAMPLE_PLAYER : roster.find(p => String(p.id) === tplPreview) || SAMPLE_PLAYER;
  const matesOf = (p) => roster.filter(x => x.team_assignment === p.team_assignment).map(x => ({ player: x, tests: testsBy.get(x.id) || [] }));
  const tplRep = buildReport({ player: tplPlayer, tests: tplPlayer.id ? (testsBy.get(tplPlayer.id) || []) : SAMPLE_TESTS, settings, draft: tplPlayer.id ? (drafts.get(tplPlayer.id) || {}) : SAMPLE_DRAFT, parentFirst: tplPlayer.id ? parentFirstOf(tplPlayer) : "Jordan", teammates: tplPlayer.id ? matesOf(tplPlayer) : SAMPLE_TEAM });

  const draft = player ? (drafts.get(player.id) || {}) : {};
  const rows = player ? metricRows(player, testsBy.get(player.id) || []) : [];
  const rep = player ? buildReport({ player, tests: testsBy.get(player.id) || [], settings, draft, parentFirst: parentFirstOf(player), teammates: matesOf(player) }) : null;
  const defaults = Array.isArray(settings.default_metrics) && settings.default_metrics.length ? settings.default_metrics : null;
  const picked = new Set(Array.isArray(draft.metrics) && draft.metrics.length ? draft.metrics : (defaults || rows.map(r => r.key)));
  const toggleMetric = (k) => { const n = new Set(picked); n.has(k) ? n.delete(k) : n.add(k); saveDraft(player.id, { metrics: rows.map(r => r.key).filter(x => n.has(x)) }); };
  const tested = (p) => (testsBy.get(p.id) || []).length;
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
                {roster.filter(p => tested(p) || p.approach_touch != null || p.stand_reach != null).sort((a, b) => tested(b) - tested(a) || a.first_name.localeCompare(b.first_name)).map(p => <option key={p.id} value={String(p.id)}>{p.first_name} {p.last_name} · {p.team_assignment}{tested(p) ? " · retested" : ""}</option>)}
              </select>
            </div>
            <TestBox p={tplPlayer.id ? tplPlayer : null} />
            <div style={{ fontSize: 12, color: C.mut, margin: "10px 0 6px" }}>Subject: <b style={{ color: C.text }}>{tplRep.subject}</b></div>
            <div style={{ background: "#fff", borderRadius: 8, padding: "18px 20px", maxHeight: "70vh", overflow: "auto" }} dangerouslySetInnerHTML={{ __html: tplRep.html }} />
          </div>
        </div>
      )}

      {!showTpl && <StatsLinks session={session} />}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 300px) 1fr", gap: 14, alignItems: "start" }}>
        <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 10 }}>
          <select value={team} onChange={e => { setTeam(e.target.value); setPid(null); setEntry(null); }} style={{ ...inp, marginBottom: 8 }}>{teams.map(t => <option key={t} value={t}>{t}</option>)}</select>
          {onTeam.map(p => { const s = lastSend(p.id), n = tested(p); return (
            <button key={p.id} onClick={() => { setPid(p.id); setMsg(null); setEntry(null); }} style={{ display: "flex", width: "100%", textAlign: "left", gap: 8, alignItems: "center", padding: "8px 10px", marginBottom: 4, borderRadius: 8, border: "1px solid " + (pid === p.id ? C.gold : "transparent"), background: pid === p.id ? "rgba(233,30,140,0.12)" : "transparent", color: C.text, cursor: "pointer", fontFamily: "inherit" }}>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{p.first_name} {p.last_name}</span>
              <span style={{ fontSize: 10, color: n ? C.grn : C.mut }}>{n ? n + " test" + (n === 1 ? "" : "s") : "tryout only"}</span>
              {s && <span title={"Sent " + fmtD(s.sent_at)} style={{ fontSize: 10, color: C.gold, fontWeight: 800 }}>✓ {fmtD(s.sent_at)}</span>}
            </button>); })}
          {!onTeam.length && <div style={{ color: C.mut, fontSize: 12, padding: 8 }}>No players on this team.</div>}
        </div>

        <div>
          {!player ? <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 20, color: C.mut, fontSize: 13 }}>Pick a player to enter her results and build her report.</div> : (<>
            <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 14, marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <b style={{ fontSize: 16 }}>{player.first_name} {player.last_name}</b><span style={{ color: C.mut, fontSize: 12 }}>{player.team_assignment}</span>
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

              <span style={lbl}>Metrics in her report (tap to include / leave out)</span>
              {!rows.length && <div style={{ color: C.mut, fontSize: 13 }}>No testing numbers on file yet — add her results above.</div>}
              {rows.map(r => { const on = picked.has(r.key); return (
                <div key={r.key} onClick={() => toggleMetric(r.key)} style={{ display: "grid", gridTemplateColumns: "24px 1.4fr 1fr 1fr 0.8fr", gap: 8, alignItems: "center", padding: "7px 8px", borderRadius: 8, marginBottom: 3, cursor: "pointer", background: on ? (r.better ? "rgba(34,197,94,0.10)" : "#0f0f0f") : "transparent", opacity: on ? 1 : 0.45, fontSize: 13 }}>
                  <span style={{ width: 18, height: 18, borderRadius: 5, border: "2px solid " + (on ? C.gold : C.border), background: on ? C.gold : "transparent", color: "#000", fontSize: 11, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>{on ? "✓" : ""}</span>
                  <span style={{ fontWeight: 700 }}>{r.label}</span>
                  <span><span style={{ color: C.mut, fontSize: 10 }}>Base </span>{fmtMetric(r.key, r.baseline)} <span style={{ color: C.mut, fontSize: 10 }}>{r.baselineFrom}</span></span>
                  <span>{r.latest != null ? <><span style={{ color: C.mut, fontSize: 10 }}>Now </span>{fmtMetric(r.key, r.latest)} <span style={{ color: C.mut, fontSize: 10 }}>{r.latestFrom}</span></> : <span style={{ color: C.mut }}>not retested</span>}</span>
                  <span style={{ fontWeight: 800, color: r.better ? C.grn : C.mut }}>{r.change == null ? "" : (r.change > 0 ? "+" : "") + (Math.round(r.change * 100) / 100) + (r.better ? " ▲" : "")}</span>
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
                <button disabled={!!busy || !rows.length || !parentEmails(player).length} onClick={sendReal} style={btn(true)}>{busy === "send" ? "Sending…" : lastSend(player.id) ? "Send again to parents" : "Send to parents"}</button>
              </div>
              {lastSend(player.id) && <div style={{ color: C.mut, fontSize: 11, marginTop: 6 }}>Last sent {fmtD(lastSend(player.id).sent_at)} by {lastSend(player.id).sent_by}</div>}
            </div>
            {rep && (
              <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 14 }}>
                <span style={lbl}>Preview — exactly what the family gets</span>
                <div style={{ fontSize: 12, color: C.mut, marginBottom: 6 }}>Subject: <b style={{ color: C.text }}>{rep.subject}</b></div>
                <div style={{ background: "#fff", borderRadius: 8, padding: "18px 20px" }} dangerouslySetInnerHTML={{ __html: rep.html }} />
              </div>
            )}
          </>)}
        </div>
      </div>
    </div>
  );
}
