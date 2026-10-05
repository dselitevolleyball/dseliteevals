// Europe trip interest meeting RSVPs (Sun Oct 11, 3:30pm, Warehouse + Zoom).
// Families answer from their /meet?t= link (api/global-meeting.js) into
// global_meeting_rsvps. Shows who's coming in person / on Zoom / can't, how
// many people, their questions, and who was invited but hasn't answered.
// Invited = the 14/15 National families except those who said No to the trip.

import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import { GC_TEAMS } from "../shared/global-challenge.js";

const C = { bg: "#0a0a0a", card: "#141414", border: "#2a2a2a", gold: "#e91e8c", text: "#ffffff", mut: "#999999", grn: "#22c55e", amber: "#f59e0b", red: "#ef4444", teal: "#2dd4bf" };
const LABEL = { in_person: "In person", zoom: "Zoom", cant: "Can't make it" };
const COLOR = { in_person: C.grn, zoom: "#60a5fa", cant: C.mut };

export default function EuropeRsvps({ players = [], gcAnswers = [] }) {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(true);
  const load = async () => { const { data } = await supabase.from("global_meeting_rsvps").select("*").order("updated_at", { ascending: false }); setRows(data || []); };
  useEffect(() => { load(); }, []);
  if (!rows) return null;

  const byId = new Map(players.map(p => [p.id, p]));
  const saidNo = new Set(gcAnswers.filter(a => a.interest === "no").map(a => a.player_id));
  const interest = new Map(gcAnswers.map(a => [a.player_id, a.interest]));
  const invited = players.filter(p => GC_TEAMS.includes(p.team_assignment) && !/declin|releas|withdr/i.test(p.offer_status || "") && !saidNo.has(p.id));
  const answered = rows.map(r => ({ r, p: byId.get(r.player_id) })).filter(x => x.p);
  const answeredIds = new Set(answered.map(x => x.p.id));
  const waiting = invited.filter(p => !answeredIds.has(p.id)).sort((a, b) => a.team_assignment.localeCompare(b.team_assignment) || a.first_name.localeCompare(b.first_name));
  const of = (k) => answered.filter(x => x.r.response === k);
  const people = (k) => of(k).reduce((n, x) => n + (x.r.attendees || 1), 0);
  const csv = () => {
    const q = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const lines = [["Player", "Team", "RSVP", "How many", "Name", "Questions", "Trip interest", "Answered"].map(q).join(",")];
    for (const { r, p } of answered) lines.push([p.first_name + " " + p.last_name, p.team_assignment, LABEL[r.response], r.attendees ?? "", r.responder, r.note, interest.get(p.id) || "no answer", (r.updated_at || "").slice(0, 16).replace("T", " ")].map(q).join(","));
    for (const p of waiting) lines.push([p.first_name + " " + p.last_name, p.team_assignment, "No reply", "", "", "", interest.get(p.id) || "no answer", ""].map(q).join(","));
    const el = document.createElement("a"); el.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })); el.download = "europe-meeting-rsvps.csv"; el.click();
  };
  const chip = (label, n, sub, color) => (
    <div style={{ background: C.bg, border: "1px solid " + C.border, borderRadius: 10, padding: "8px 12px", minWidth: 110 }}>
      <div style={{ fontSize: 20, fontWeight: 900, color }}>{n}</div>
      <div style={{ fontSize: 11, color: C.mut }}>{label}{sub ? " · " + sub : ""}</div>
    </div>
  );

  return (
    <div style={{ background: C.card, border: "1px solid " + C.teal, borderRadius: 12, marginTop: 18, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 16 }}>📅</span>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>Europe meeting RSVPs</div>
          <div style={{ fontSize: 11, color: C.mut }}>Sun Oct 11, 3:30pm · DSSC Warehouse + Zoom · {answered.length} of {invited.length} invited families answered</div>
        </div>
        <button onClick={load} style={btn}>Refresh</button>
        <button onClick={csv} style={btn}>CSV</button>
        <button onClick={() => setOpen(o => !o)} style={btn}>{open ? "Hide" : "Show"}</button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        {chip("In person", of("in_person").length, people("in_person") + " people", C.grn)}
        {chip("Zoom", of("zoom").length, people("zoom") + " people", "#60a5fa")}
        {chip("Can't make it", of("cant").length, "", C.mut)}
        {chip("No reply yet", waiting.length, "", C.amber)}
      </div>
      {open && (
        <div style={{ marginTop: 10 }}>
          {["in_person", "zoom", "cant"].map(k => of(k).length > 0 && (
            <div key={k} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: COLOR[k], textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>{LABEL[k]}</div>
              {of(k).map(({ r, p }) => (
                <div key={p.id} style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", fontSize: 13, padding: "4px 0", borderTop: "1px solid " + C.border }}>
                  <b style={{ minWidth: 150 }}>{p.first_name} {p.last_name}</b>
                  <span style={{ color: C.mut, fontSize: 12 }}>{p.team_assignment}{r.attendees && k !== "cant" ? " · " + r.attendees + " coming" : ""}{r.responder ? " · " + r.responder : ""}</span>
                  {r.note && <div style={{ width: "100%", fontSize: 12, color: C.text, paddingLeft: 4 }}>“{r.note}”</div>}
                </div>
              ))}
            </div>
          ))}
          {waiting.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: C.amber, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>No reply yet</div>
              <div style={{ fontSize: 12, color: C.mut, lineHeight: 1.7 }}>
                {waiting.map((p, i) => <span key={p.id}>{i ? " · " : ""}{p.first_name} {p.last_name} <span style={{ fontSize: 11 }}>({p.team_assignment}{interest.get(p.id) ? ", " + interest.get(p.id) : ", no form"})</span></span>)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
const btn = { padding: "4px 10px", borderRadius: 6, border: "1px solid " + C.border, background: "transparent", color: C.mut, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
