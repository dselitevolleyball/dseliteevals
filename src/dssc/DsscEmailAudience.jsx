// Who a marketing email goes to — the picker used by Marketing → Settings
// (the weekly email's default) and by each email in Approve. Everyone in
// People, the directors (soft launch), or a saved People segment; plus the
// warm-up cap on "new" addresses (old lists that have never had an email
// from us), so a big cold list goes out a few hundred at a time.

import { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { DS, inputStyle } from "./DsscHub.jsx";
import { describeSegment } from "../../shared/crm-segments.js";

let cache = null;
export function useSegments() {
  const [segs, setSegs] = useState(cache || []);
  useEffect(() => { supabase.from("dssc_segments").select("id, name, filters, last_count").order("name").then(({ data }) => { cache = data || []; setSegs(cache); }); }, []);
  return segs;
}

const chip = (on, color, narrow) => ({ fontFamily: DS.font, fontSize: narrow ? 14 : 13, fontWeight: 800, padding: narrow ? "8px 13px" : "5px 11px", borderRadius: 999, cursor: "pointer", border: "1px solid " + (on ? color : DS.lineStrong), background: on ? color : "transparent", color: on ? DS.bg : DS.text });

export function emailAudienceLabel(a, segs = []) {
  if (!a || typeof a !== "object") return "Everyone in DSSC People";
  const cap = a.cold_cap != null && a.cold_cap !== "" ? ` · at most ${a.cold_cap} new addresses` : "";
  if (a.segment_id) { const s = segs.find(x => x.id === a.segment_id); return (s ? `Segment: ${s.name}` : `Segment #${a.segment_id} (deleted?)`) + cap; }
  if (a.segment) return `Filtered: ${describeSegment(a.segment)}` + cap;
  if (a.source === "directors") return "Directors only (soft launch)";
  if (Array.isArray(a.emails)) return `${a.emails.length} set addresses`;
  return "Everyone in DSSC People" + cap;
}

// value: the audience object; onChange(next); allowDefault: show "Settings default" (per-item use)
export default function EmailAudiencePicker({ value, onChange, narrow, allowDefault = false, disabled = false }) {
  const segs = useSegments();
  const a = value && typeof value === "object" ? value : null;
  const isDefault = allowDefault && !a;
  const capOf = (x) => x?.cold_cap ?? "";
  const keep = (next) => onChange(next && a?.cold_cap != null && a.cold_cap !== "" && next.source !== "directors" ? { ...next, cold_cap: a.cold_cap } : next);
  return (
    <div style={{ opacity: disabled ? 0.6 : 1, pointerEvents: disabled ? "none" : "auto" }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {allowDefault && <button onClick={() => onChange(null)} style={chip(isDefault, DS.mut, narrow)}>Settings default</button>}
        <button onClick={() => keep({ source: "dssc_contacts" })} style={chip(!isDefault && (!a || (a.source === "dssc_contacts" && !a.segment_id && !a.segment)), DS.lime, narrow)}>Everyone in People</button>
        <button onClick={() => onChange({ source: "directors" })} style={chip(a?.source === "directors", DS.orange, narrow)}>Directors only</button>
        {segs.map(s => <button key={s.id} onClick={() => keep({ segment_id: s.id })} title={describeSegment(s.filters)} style={chip(a?.segment_id === s.id, "#7FD1C3", narrow)}>{s.name}{s.last_count != null ? <span style={{ fontSize: 10, fontWeight: 600, marginLeft: 5, opacity: 0.8 }}>{s.last_count.toLocaleString()}</span> : null}</button>)}
      </div>
      {!segs.length && <div style={{ fontSize: 12, color: DS.dim, marginTop: 4 }}>Build segments in People → Email segments (e.g. "volleyball girls 10–13", "lapsed since summer", "spent $500+").</div>}
      {a && a.source !== "directors" && !Array.isArray(a.emails) && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
          <span style={{ fontSize: 12, color: DS.mut }}>New addresses per send (old lists never emailed):</span>
          <input type="number" min="0" step="100" value={capOf(a)} placeholder="no limit" onChange={e => onChange({ ...a, cold_cap: e.target.value === "" ? undefined : Math.max(0, +e.target.value) })} style={{ ...inputStyle, width: 110, padding: "5px 8px", fontSize: narrow ? 16 : 13 }} />
          <span style={{ fontSize: 11, color: DS.dim }}>Warm a cold list up: ~500, then 1,000, then 2,000.</span>
        </div>
      )}
      {a?.segment_id && <div style={{ fontSize: 12, color: DS.dim, marginTop: 4 }}>{describeSegment(segs.find(s => s.id === a.segment_id)?.filters)} — recounted when it sends.</div>}
    </div>
  );
}
