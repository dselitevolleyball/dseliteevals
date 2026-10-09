// Testing Reports — Coach Brandon's performance-testing emails to families
// (Oct 2026). His editable template (introduction + Reach membership pitch),
// then player by player: pick which metrics to show (baseline, now, change,
// improvements flagged), add what she worked on and a personal note, preview
// exactly what the family gets, send a test to himself, then send.
// Builder: shared/stat-report.js (same as the server's send in api/stat-report.js).

import { useState, useEffect, useMemo } from "react";
import { supabase } from "./supabase";
import { buildReport, metricRows, fmtMetric, DEFAULT_SETTINGS } from "../shared/stat-report.js";
import { StatsLinks } from "./PlayerStats.jsx";

const C = { bg: "#0a0a0a", card: "#141414", border: "#2a2a2a", gold: "#e91e8c", text: "#ffffff", mut: "#999999", red: "#ef4444", grn: "#22c55e" };
const inp = { background: "#0f0f0f", border: "1px solid " + C.border, borderRadius: 8, color: C.text, fontFamily: "inherit", fontSize: 13, padding: "8px 10px", width: "100%", boxSizing: "border-box" };
const TERMINAL = ["declined", "not_invited", "opted_out"];
const fmtD = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
const teamSort = (a, b) => (parseInt(a) || 99) - (parseInt(b) || 99) || a.localeCompare(b);

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

  const roster = useMemo(() => players.filter(p => p.team_assignment && (p.season || "2026-27") === "2026-27" && !TERMINAL.includes(p.offer_status || "")), [players]);
  const teams = useMemo(() => [...new Set(roster.map(p => p.team_assignment))].sort(teamSort), [roster]);
  useEffect(() => { if (!team && teams.length) setTeam(teams[0]); }, [teams, team]);
  const testsBy = useMemo(() => { const m = new Map(); for (const t of tests) { if (!m.has(t.player_id)) m.set(t.player_id, []); m.get(t.player_id).push(t); } return m; }, [tests]);
  const lastSend = (id) => sends.find(s => s.player_id === id && !s.test);
  const onTeam = roster.filter(p => p.team_assignment === team).sort((a, b) => a.first_name.localeCompare(b.first_name));
  const player = roster.find(p => p.id === pid) || null;

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
  const send = async (test) => {
    if (!player) return;
    const to = test ? coach?.email : null;
    if (!test && !window.confirm(`Send ${player.first_name}'s testing report to ${parentEmails(player).join(", ")}?`)) return;
    setBusy(test ? "test" : "send"); setMsg(null);
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch("/api/stat-report", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (session?.access_token || "") }, body: JSON.stringify({ player_id: player.id, test_to: to }) });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) { setMsg({ err: j.error || "Send failed" }); return; }
    setMsg({ ok: test ? `Test sent to ${to}.` : `Sent to ${j.to.join(", ")}.` });
    load();
  };
  const parentEmails = (p) => [...new Set([p.parent_email, p.parent_email2, p.parent_email3].map(e => String(e || "").trim().toLowerCase()).filter(e => /@/.test(e)))];

  if (!settings) return <div style={{ padding: 24, color: C.mut }}>Loading…</div>;
  const draft = player ? (drafts.get(player.id) || {}) : {};
  const rows = player ? metricRows(player, testsBy.get(player.id) || []) : [];
  const firsts = player ? [...new Set([player.parent_name, player.parent2_name].map(x => String(x || "").trim().split(/\s+/)[0]).filter(Boolean))] : [];
  const parentFirst = firsts.length <= 1 ? (firsts[0] || "") : firsts.slice(0, -1).join(", ") + " and " + firsts[firsts.length - 1];
  const rep = player ? buildReport({ player, tests: testsBy.get(player.id) || [], settings, draft, parentFirst }) : null;
  const picked = new Set(Array.isArray(draft.metrics) && draft.metrics.length ? draft.metrics : rows.map(r => r.key));
  const toggleMetric = (k) => { const n = new Set(picked); n.has(k) ? n.delete(k) : n.add(k); saveDraft(player.id, { metrics: rows.map(r => r.key).filter(x => n.has(x)) }); };
  const lbl = { fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: C.mut, marginBottom: 4, display: "block" };
  const tested = (p) => (testsBy.get(p.id) || []).length;

  return (
    <div style={{ padding: "16px 16px 40px", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.gold }}>Testing Reports</h2>
          <div style={{ fontSize: 12, color: C.mut }}>Email each family their daughter's testing numbers — baseline, now, and what got better — with your introduction and the Reach membership.</div>
        </div>
        <button onClick={() => setShowTpl(v => !v)} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid " + C.gold, background: showTpl ? C.gold : "transparent", color: showTpl ? "#000" : C.gold, fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>{showTpl ? "Close template" : "✎ Edit email template"}</button>
      </div>

      <StatsLinks session={session} />

      {showTpl && (
        <div style={{ background: C.card, border: "1px solid " + C.gold, borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: C.mut, marginBottom: 10 }}>Used for every report. <b style={{ color: C.text }}>{"{player_first}"}</b> and <b style={{ color: C.text }}>{"{team}"}</b> fill in for each girl. The numbers, "what we worked on" and your personal note are added per player. Saves when you click out of a box.</div>
          {[["subject", "Subject", 1], ["intro", "Your introduction", 4], ["pitch", "Reach membership pitch", 5], ["pitch_button", "Button text", 1], ["pitch_link", "Button link (Reach sign-up page — leave blank to hide the button)", 1], ["signoff", "Sign-off", 3]].map(([k, l, rowsN]) => (
            <label key={k} style={{ display: "block", marginBottom: 10 }}><span style={lbl}>{l}</span>
              {rowsN > 1 ? <textarea defaultValue={settings[k]} rows={rowsN} onBlur={e => e.target.value !== settings[k] && saveSettings({ [k]: e.target.value })} style={{ ...inp, resize: "vertical", lineHeight: 1.5 }} />
                : <input defaultValue={settings[k]} onBlur={e => e.target.value !== settings[k] && saveSettings({ [k]: e.target.value.trim() })} style={inp} />}
            </label>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 300px) 1fr", gap: 14, alignItems: "start" }}>
        <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 10 }}>
          <select value={team} onChange={e => { setTeam(e.target.value); setPid(null); }} style={{ ...inp, marginBottom: 8 }}>{teams.map(t => <option key={t} value={t}>{t}</option>)}</select>
          {onTeam.map(p => { const s = lastSend(p.id), n = tested(p); return (
            <button key={p.id} onClick={() => { setPid(p.id); setMsg(null); }} style={{ display: "flex", width: "100%", textAlign: "left", gap: 8, alignItems: "center", padding: "8px 10px", marginBottom: 4, borderRadius: 8, border: "1px solid " + (pid === p.id ? C.gold : "transparent"), background: pid === p.id ? "rgba(233,30,140,0.12)" : "transparent", color: C.text, cursor: "pointer", fontFamily: "inherit" }}>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{p.first_name} {p.last_name}</span>
              <span style={{ fontSize: 10, color: n ? C.grn : C.mut }}>{n ? n + " test" + (n === 1 ? "" : "s") : "tryout only"}</span>
              {s && <span title={"Sent " + fmtD(s.sent_at)} style={{ fontSize: 10, color: C.gold, fontWeight: 800 }}>✓ {fmtD(s.sent_at)}</span>}
            </button>); })}
          {!onTeam.length && <div style={{ color: C.mut, fontSize: 12, padding: 8 }}>No players on this team.</div>}
        </div>

        <div>
          {!player ? <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 20, color: C.mut, fontSize: 13 }}>Pick a player to build her report.</div> : (<>
            <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 14, marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <b style={{ fontSize: 16 }}>{player.first_name} {player.last_name}</b><span style={{ color: C.mut, fontSize: 12 }}>{player.team_assignment}</span>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: C.mut }}>To: {parentEmails(player).join(", ") || <span style={{ color: C.red }}>no parent email</span>}</span>
              </div>
              <span style={lbl}>Metrics in her report (tap to include / leave out)</span>
              {!rows.length && <div style={{ color: C.mut, fontSize: 13 }}>No testing numbers on file yet — record her test with the team testing link first.</div>}
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
                <button disabled={!!busy || !rows.length} onClick={() => send(true)} style={{ padding: "9px 14px", borderRadius: 8, border: "1px solid " + C.border, background: "transparent", color: C.text, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>{busy === "test" ? "Sending…" : "Send me a test"}</button>
                <button disabled={!!busy || !rows.length || !parentEmails(player).length} onClick={() => send(false)} style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: C.gold, color: "#000", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>{busy === "send" ? "Sending…" : lastSend(player.id) ? "Send again" : "Send to parents"}</button>
                {msg?.ok && <span style={{ color: C.grn, fontSize: 12, fontWeight: 700 }}>{msg.ok}</span>}
                {msg?.err && <span style={{ color: C.red, fontSize: 12, fontWeight: 700 }}>{msg.err}</span>}
                {lastSend(player.id) && <span style={{ color: C.mut, fontSize: 11 }}>Last sent {fmtD(lastSend(player.id).sent_at)} by {lastSend(player.id).sent_by}</span>}
              </div>
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
