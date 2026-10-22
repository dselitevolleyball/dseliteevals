// DSSC People → Email segments. Build "who gets this email" from everything
// People knows — what a family's kids did and when, ages and grades, DS Elite,
// spend, lapsed families, old mailing lists, tags, town — see the count live,
// save it, and pick it as the audience of any marketing email (Marketing →
// an email → To, or Settings → weekly email). Same engine as the sender
// (shared/crm-segments.js), so the count here is who gets it.

import { useState, useEffect, useMemo } from "react";
import { supabase } from "../supabase";
import { DS, Btn, Card, Label, Tag, inputStyle } from "./DsscHub.jsx";
import { EMPTY_SEGMENT, SEGMENT_CATEGORIES, GRADES, loadSegmentData, buildFamilies, resolveSegment, describeSegment } from "../../shared/crm-segments.js";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const chip = (on, color = DS.lime) => ({ fontFamily: DS.font, fontSize: 13, fontWeight: 800, padding: "5px 11px", borderRadius: 999, cursor: "pointer", border: "1px solid " + (on ? color : DS.lineStrong), background: on ? color : "transparent", color: on ? DS.bg : DS.text });
const lbl = { fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: DS.mut, margin: "12px 0 6px" };
const sel = { ...inputStyle, width: "auto", padding: "6px 9px", fontSize: 13 };
const csvEsc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

export default function DsscCrmSegments({ coach }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [segs, setSegs] = useState([]);
  const [cur, setCur] = useState({ id: null, name: "", filters: { ...EMPTY_SEGMENT } });
  const [saving, setSaving] = useState(false);

  const loadSegs = async () => { const { data: s, error } = await supabase.from("dssc_segments").select("*").order("name"); if (error) setErr(/dssc_segments|schema cache|does not exist/i.test(error.message) ? "Run migrations/20261025_dssc_crm_spend_segments.sql to turn on segments." : error.message); else setSegs(s || []); };
  useEffect(() => { loadSegmentData(supabase).then(setData).catch(e => setErr(/dssc_purchases|mkt_unsubscribes|schema cache|does not exist|lists|email_status/i.test(e.message) ? "Run migrations/20261025_dssc_crm_spend_segments.sql to turn on segments." : e.message)); loadSegs(); }, []);

  const index = useMemo(() => data ? buildFamilies(data, today()) : null, [data]);
  const f = cur.filters;
  const res = useMemo(() => index ? resolveSegment(index, f) : null, [index, f]);
  const lists = useMemo(() => [...new Set((data?.contacts || []).flatMap(c => c.lists || []))].sort(), [data]);
  const tags = useMemo(() => [...new Set((data?.contacts || []).flatMap(c => c.tags || []))].sort(), [data]);
  const cities = useMemo(() => [...new Set((data?.contacts || []).map(c => c.city).filter(Boolean))].sort(), [data]);
  const countOf = (s) => index ? resolveSegment(index, s.filters || {}).recipients.length : null;

  const set = (k, v) => setCur(c => ({ ...c, filters: { ...c.filters, [k]: v } }));
  const tog = (k, v) => { const a = f[k] || []; set(k, a.includes(v) ? a.filter(x => x !== v) : [...a, v]); };
  const pick = (s) => setCur({ id: s.id, name: s.name, filters: { ...EMPTY_SEGMENT, ...(s.filters || {}) } });

  const save = async (asNew) => {
    const name = asNew || !cur.id ? window.prompt("Name this segment", cur.name || describeSegment(f).slice(0, 60)) : cur.name;
    if (!name?.trim()) return;
    setSaving(true);
    const row = { name: name.trim(), filters: f, last_count: res?.recipients.length ?? null };
    const q = cur.id && !asNew ? supabase.from("dssc_segments").update(row).eq("id", cur.id).select().single() : supabase.from("dssc_segments").insert({ ...row, created_by: coach?.email || null }).select().single();
    const { data: s, error } = await q;
    setSaving(false);
    if (error) return setErr(error.message);
    setCur({ id: s.id, name: s.name, filters: f }); loadSegs();
  };
  const del = async (s) => { if (!window.confirm(`Delete "${s.name}"? Emails that use it will need a new audience.`)) return; await supabase.from("dssc_segments").delete().eq("id", s.id); if (cur.id === s.id) setCur({ id: null, name: "", filters: { ...EMPTY_SEGMENT } }); loadSegs(); };
  const exportCsv = () => {
    const lines = [["Email", "First name", "Last name", "Kids", "Program", "New to email"].join(",")];
    for (const r of res.recipients) lines.push([r.email, csvEsc(r.first_name), csvEsc(r.last_name), csvEsc(r.kids.join("; ")), csvEsc(r.program), r.cold ? "yes" : ""].join(","));
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })); a.download = (cur.name || "dssc-segment").replace(/[^\w-]+/g, "-") + ".csv"; a.click(); URL.revokeObjectURL(a.href);
  };

  if (err) return <Card accent={DS.orange}><span style={{ color: DS.orange }}>{err}</span></Card>;
  if (!data) return <Card><span style={{ color: DS.mut }}>Loading families, sign-ups and spend…</span></Card>;
  const cold = res.recipients.filter(r => r.cold).length;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 14 }}>
      {/* Saved */}
      <Card>
        <Label>Saved segments</Label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button onClick={() => setCur({ id: null, name: "", filters: { ...EMPTY_SEGMENT } })} style={chip(!cur.id, DS.mut)}>+ New</button>
          {segs.map(s => <span key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><button onClick={() => pick(s)} style={chip(cur.id === s.id)} title={describeSegment(s.filters)}>{s.name} <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.8 }}>{countOf(s)?.toLocaleString()}</span></button><button onClick={() => del(s)} title="Delete" style={{ background: "none", border: "none", color: DS.dim, cursor: "pointer", fontSize: 12 }}>✕</button></span>)}
          {!segs.length && <span style={{ fontSize: 12, color: DS.mut, alignSelf: "center" }}>None yet. Build one below and save it; it shows up as an audience in Marketing.</span>}
        </div>
      </Card>

      {/* Builder */}
      <Card accent={DS.lime}>
        <Label>{cur.id ? `Editing "${cur.name}"` : "New segment"}</Label>
        <div style={lbl}>Took part in (any of)</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {SEGMENT_CATEGORIES.map(([k, l]) => <button key={k} onClick={() => tog("categories", k)} style={chip((f.categories || []).includes(k))}>{l}</button>)}
          <input value={f.program} onChange={e => set("program", e.target.value)} placeholder="program name contains…" style={{ ...sel, width: 200 }} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
          <span style={{ fontSize: 12, color: DS.mut }}>between</span><input type="date" value={f.since} onChange={e => set("since", e.target.value)} style={sel} />
          <span style={{ fontSize: 12, color: DS.mut }}>and</span><input type="date" value={f.until} onChange={e => set("until", e.target.value)} style={sel} />
          <span style={{ fontSize: 12, color: DS.mut, marginLeft: 8 }}>but nothing since</span><input type="date" value={f.lapsedSince} onChange={e => set("lapsedSince", e.target.value)} style={sel} title="Lapsed families: some activity, none on or after this date" />
        </div>

        <div style={lbl}>A kid in the family</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={f.gender} onChange={e => set("gender", e.target.value)} style={sel}><option value="">any gender</option><option value="female">girl</option><option value="male">boy</option></select>
          <span style={{ fontSize: 12, color: DS.mut }}>age</span>
          <input type="number" min="3" max="18" value={f.minAge} onChange={e => set("minAge", e.target.value)} placeholder="from" style={{ ...sel, width: 70 }} />
          <input type="number" min="3" max="18" value={f.maxAge} onChange={e => set("maxAge", e.target.value)} placeholder="to" style={{ ...sel, width: 70 }} />
          <select value={f.dse} onChange={e => set("dse", e.target.value)} style={sel}><option value="any">DS Elite or not</option><option value="members">on a DS Elite team</option><option value="non">not on DS Elite</option></select>
          {["national", "regional", "rise"].map(l => <button key={l} onClick={() => tog("levels", l)} style={chip((f.levels || []).includes(l), DS.orange)}>{l[0].toUpperCase() + l.slice(1)}</button>)}
        </div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
          <span style={{ fontSize: 12, color: DS.mut, marginRight: 4 }}>grade</span>
          {GRADES.map(([g, l]) => <button key={g} onClick={() => tog("grades", g)} style={{ ...chip((f.grades || []).includes(g), "#7FD1C3"), padding: "4px 9px" }}>{l}</button>)}
        </div>

        <div style={lbl}>Spend &amp; history</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: DS.mut }}>spent $</span>
          <input type="number" min="0" value={f.spendMin} onChange={e => set("spendMin", e.target.value)} placeholder="at least" style={{ ...sel, width: 90 }} />
          <span style={{ fontSize: 12, color: DS.mut }}>to $</span>
          <input type="number" min="0" value={f.spendMax} onChange={e => set("spendMax", e.target.value)} placeholder="at most" style={{ ...sel, width: 90 }} />
          <select value={f.spendWindow} onChange={e => set("spendWindow", e.target.value)} style={sel}><option value="all">ever</option><option value="12m">in the last 12 months</option><option value="ytd">this year</option></select>
          <select value={f.customers} onChange={e => set("customers", e.target.value)} style={sel}><option value="any">customers and prospects</option><option value="customers">customers only</option><option value="prospects">never bought (lists / website)</option></select>
          <select value={f.engaged} onChange={e => set("engaged", e.target.value)} style={sel}><option value="any">any email engagement</option><option value="opened90">opened in the last 90 days</option><option value="never_opened">emailed but never opened</option></select>
        </div>

        {(lists.length > 0 || tags.length > 0) && <div style={lbl}>Lists &amp; tags</div>}
        {lists.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}><span style={{ fontSize: 12, color: DS.mut }}>on list</span>{lists.map(l => <button key={l} onClick={() => tog("lists", l)} style={chip((f.lists || []).includes(l), "#7FD1C3")}>{l}</button>)}</div>}
        {tags.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}><span style={{ fontSize: 12, color: DS.mut }}>tagged</span>{tags.map(t => <button key={t} onClick={() => tog("tags", t)} style={chip((f.tags || []).includes(t))}>{t}</button>)}<span style={{ fontSize: 12, color: DS.mut, marginLeft: 8 }}>not tagged</span>{tags.map(t => <button key={"x" + t} onClick={() => tog("excludeTags", t)} style={chip((f.excludeTags || []).includes(t), DS.orange)}>{t}</button>)}</div>}

        <div style={lbl}>Where</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value="" onChange={e => e.target.value && tog("cities", e.target.value)} style={sel}><option value="">+ town</option>{cities.filter(c => !(f.cities || []).includes(c)).map(c => <option key={c}>{c}</option>)}</select>
          {(f.cities || []).map(c => <button key={c} onClick={() => tog("cities", c)} style={chip(true)}>{c} ✕</button>)}
          <input value={(f.zips || []).join(", ")} onChange={e => set("zips", e.target.value.split(/[\s,]+/).filter(Boolean))} placeholder="zip codes, comma separated" style={{ ...sel, width: 220 }} />
        </div>
      </Card>

      {/* Result */}
      <Card>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 28, fontWeight: 900, color: DS.lime }}>{res.recipients.length.toLocaleString()}</span>
          <span style={{ fontSize: 14, fontWeight: 700 }}>will get the email</span>
          <span style={{ fontSize: 12, color: DS.mut }}>{res.matched.toLocaleString()} families match{res.suppressed.unsubscribed ? ` · ${res.suppressed.unsubscribed} unsubscribed` : ""}{res.suppressed.bounced ? ` · ${res.suppressed.bounced} bounced / complained` : ""}{res.suppressed.no_email ? ` · ${res.suppressed.no_email} no email` : ""}{cold ? ` · ${cold} new to our email (old lists)` : ""}</span>
          <div style={{ flex: 1 }} />
          <Btn small onClick={exportCsv} disabled={!res.recipients.length}>⬇ CSV</Btn>
          {cur.id && <Btn small onClick={() => save(true)} disabled={saving}>Save as new</Btn>}
          <Btn small kind="primary" onClick={() => save(false)} disabled={saving}>{saving ? "Saving…" : cur.id ? "Save changes" : "Save segment"}</Btn>
        </div>
        <div style={{ fontSize: 13, color: DS.mut, marginTop: 4 }}>{describeSegment(f)}</div>
        {cold > 500 && <div style={{ fontSize: 12, color: DS.orange, marginTop: 6 }}>{cold.toLocaleString()} of these have never had an email from us. Warm them up gradually: in Marketing, set "new addresses per send" to about 500, then 1,000, then 2,000.</div>}
        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
            <thead><tr>{["Email", "Name", "Kids", "Latest match"].map(h => <th key={h} style={{ textAlign: "left", padding: "6px 8px", fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: DS.mut, borderBottom: "1px solid " + DS.line }}>{h}</th>)}</tr></thead>
            <tbody>{res.recipients.slice(0, 60).map(r => <tr key={r.email}><td style={{ padding: "5px 8px", fontSize: 12, borderBottom: "1px solid " + DS.line }}>{r.email}{r.cold && <> <Tag color={DS.orange}>new</Tag></>}</td><td style={{ padding: "5px 8px", fontSize: 12, borderBottom: "1px solid " + DS.line }}>{(r.first_name + " " + r.last_name).trim()}</td><td style={{ padding: "5px 8px", fontSize: 12, borderBottom: "1px solid " + DS.line, color: DS.mut }}>{r.kids.join(", ")}</td><td style={{ padding: "5px 8px", fontSize: 12, borderBottom: "1px solid " + DS.line, color: DS.mut }}>{r.program}</td></tr>)}</tbody>
          </table>
          {res.recipients.length > 60 && <div style={{ fontSize: 12, color: DS.mut, padding: "6px 8px" }}>Showing 60 of {res.recipients.length.toLocaleString()} — the CSV has everyone.</div>}
        </div>
      </Card>
    </div>
  );
}
