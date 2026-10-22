// Marketing → Settings → Best times. When families actually sign up (Playbook
// purchases, shared/marketing-timing.js) as a day × hour picture, and the
// schedule that follows from it: which days the rhythm's posts and stories go
// out, at what time, the email days and the text time. "Apply" saves it and
// moves this week's and next weeks' drafts to the new times (their days stay;
// drag them on the Calendar if you want). "Keep optimizing" lets the cron redo
// it every Sunday morning as new Playbook exports come in.

import { useState, useEffect, useMemo } from "react";
import { supabase } from "../supabase";
import { DS, Btn, fetchAll } from "./DsscHub.jsx";
import { mktApi, Panel, H, Msg, dayOf, timeOf } from "./DsscMarketingKit.jsx";
import { DAY_KEYS } from "../../shared/marketing-plan.js";
import { registrationHeatmap, recommendCadence, bestTimeFor, fmtHour } from "../../shared/marketing-timing.js";

const DLABEL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 16 }, (_, i) => i + 7);   // 7 am – 10 pm

export default function MarketingTiming({ cadence, narrow, onApplied }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [line, setLine] = useState("");
  useEffect(() => {
    fetchAll(() => supabase.from("dssc_purchases").select("id, invoice, program, category, amount_cents, purchased_at"))
      .then(setRows).catch(e => { setErr(/dssc_purchases|schema cache|does not exist/i.test(e.message || "") ? "Import a Playbook registrations export (with prices) in People first." : e.message); setRows([]); });
  }, []);
  const heat = useMemo(() => rows ? registrationHeatmap(rows) : null, [rows]);
  const rec = useMemo(() => heat ? recommendCadence(heat, cadence) : null, [heat, cadence]);
  const m = heat ? (line && heat.lines[line] ? heat.lines[line].m : heat.overall) : null;
  const max = m ? Math.max(1, ...m.flatMap(r => r.slice(7, 23))) : 1;
  const lineTabs = heat ? Object.entries(heat.lines).filter(([k, v]) => v.total >= 20 && k !== "rentals").sort((a, b) => b[1].total - a[1].total) : [];

  const apply = async () => {
    if (!rec?.ok) return;
    setBusy(true); setMsg(null);
    try {
      const next = { ...rec.cadence, social: { ...rec.cadence.social, auto_times: cadence?.social?.auto_times } };
      await mktApi("settings_save", { patch: { cadence: next } });
      // Upcoming drafts take the new time for their day.
      const { data } = await supabase.from("mkt_items").select("id, channel, line, scheduled_at").eq("status", "draft").gte("scheduled_at", new Date().toISOString());
      let moved = 0;
      for (const it of data || []) {
        const day = dayOf(it.scheduled_at); if (!day) continue;
        const key = DAY_KEYS[(new Date(day + "T12:00:00").getDay() + 6) % 7];
        const t = bestTimeFor(heat, it.line, key, it.channel);
        if (t && t !== timeOf(it.scheduled_at)) { await mktApi("update", { id: it.id, patch: { scheduled_at: new Date(`${day}T${t}:00`).toISOString() } }); moved++; }
      }
      setMsg({ ok: `Applied. New weeks are drafted on this schedule${moved ? `, and ${moved} upcoming draft${moved === 1 ? "" : "s"} moved to the better time` : ""}.` });
      onApplied?.(next);
    } catch (e) { setMsg({ err: e.message }); }
    setBusy(false);
  };
  const toggleAuto = async (on) => {
    const next = { ...cadence, social: { ...cadence.social, auto_times: on } };
    try { await mktApi("settings_save", { patch: { cadence: next } }); onApplied?.(next); setMsg({ ok: on ? "The machine will re-check the best times every Sunday morning." : "Automatic re-checking is off." }); }
    catch (e) { setMsg({ err: e.message }); }
  };

  return (
    <Panel style={{ marginBottom: 14 }}>
      <H>Best times — from Playbook registrations</H>
      {rows == null ? <div style={{ color: DS.mut, fontSize: 13 }}>Reading sign-ups…</div>
        : err ? <div style={{ color: DS.orange, fontSize: 13 }}>{err}</div>
        : !rec?.ok ? <div style={{ color: DS.mut, fontSize: 13 }}>{rec?.reason}</div>
        : <>
          <div style={{ fontSize: 13, color: DS.mut, lineHeight: 1.5 }}>{rec.summary} Posts are timed to land about an hour before each sport's busiest sign-up window that day; emails the morning of the biggest days.</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0 6px" }}>
            <button onClick={() => setLine("")} style={tab(!line)}>All programs</button>
            {lineTabs.map(([k, v]) => <button key={k} onClick={() => setLine(k)} style={tab(line === k)}>{k.replace(/_/g, " ")} <span style={{ opacity: 0.7, fontWeight: 600 }}>{v.total}</span></button>)}
          </div>
          {/* Day × hour: darker = more sign-ups */}
          <div style={{ overflowX: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: `40px repeat(${HOURS.length}, minmax(${narrow ? 18 : 26}px, 1fr))`, gap: 2, minWidth: narrow ? 340 : 0 }}>
              <span />
              {HOURS.map(h => <span key={h} style={{ fontSize: 9, color: DS.dim, textAlign: "center" }}>{h % 3 === 0 ? fmtHour(h).replace(" ", "") : ""}</span>)}
              {DLABEL.map((d, di) => [
                <span key={d} style={{ fontSize: 11, color: DS.mut, fontWeight: 700 }}>{d}</span>,
                ...HOURS.map(h => { const v = m[di][h]; return <span key={d + h} title={`${d} ${fmtHour(h)}: ${v} sign-up${v === 1 ? "" : "s"}`} style={{ height: 18, borderRadius: 3, background: v ? `rgba(178,208,73,${0.12 + 0.88 * v / max})` : DS.panel2 }} />; }),
              ])}
            </div>
          </div>
          <div style={{ fontWeight: 800, fontSize: 13, marginTop: 12 }}>{rec.changes.length ? "Recommended changes" : "Your schedule already matches the data."}</div>
          {rec.changes.map((c, i) => <div key={i} style={{ fontSize: 13, color: DS.mut, padding: "3px 0" }}>• {c}</div>)}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
            {rec.changes.length > 0 && <Btn kind="primary" disabled={busy} onClick={apply} style={narrow ? { minHeight: 44 } : {}}>{busy ? "Applying…" : "Apply these times"}</Btn>}
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={!!cadence?.social?.auto_times} onChange={e => toggleAuto(e.target.checked)} style={{ width: 18, height: 18, accentColor: DS.lime }} />
              Keep optimizing every week as new Playbook data comes in
            </label>
          </div>
          <Msg msg={msg} style={{ marginTop: 8 }} />
        </>}
    </Panel>
  );
}
const tab = (on) => ({ fontFamily: DS.font, fontSize: 12, fontWeight: 800, padding: "4px 10px", borderRadius: 999, cursor: "pointer", border: "1px solid " + (on ? DS.lime : DS.lineStrong), background: on ? DS.lime : "transparent", color: on ? DS.bg : DS.text, textTransform: "capitalize" });
