// Dripping Springs Sports Club — People (the CRM).
//
// Every family the club has ever dealt with, with their players and what they
// took part in — from Upper Hand (the old sales platform), Playbook (the
// current one) and the DS Elite roster. The point is the filter bar: "girls
// aged 10–13 who've done a volleyball program, who we can text" — then one
// button hands that list to DSSC Texts, parents tied to their kids.
//
// Filters run on players (age, gender, what they did), results are shown as
// families (the parent is who gets the text), so a family appears once with
// the players that matched.

import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../supabase";
import { DS, nrm, Btn, Card, Label, Tag, inputStyle, Field } from "./DsscHub.jsx";
import Papa from "papaparse";

const today = new Date();
const ageOf = (dob) => { if (!dob) return null; const d = new Date(dob + "T12:00:00"); let a = today.getFullYear() - d.getFullYear(); if (today < new Date(today.getFullYear(), d.getMonth(), d.getDate())) a--; return a; };
const fmtPhone = (p) => { const s = String(p || "").replace(/\D/g, ""); if (s.length === 11 && s.startsWith("1")) return `(${s.slice(1, 4)}) ${s.slice(4, 7)}-${s.slice(7)}`; if (s.length === 10) return `(${s.slice(0, 3)}) ${s.slice(3, 6)}-${s.slice(6)}`; return p || ""; };
const money = (c) => "$" + (Math.round((c || 0) / 100)).toLocaleString();
const fmtD = (iso) => iso ? new Date(iso + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" }) : "";
const CATS = [["", "any program"], ["volleyball", "volleyball"], ["basketball", "basketball"], ["reach", "Reach / performance"], ["facility", "rentals / open gym"], ["none", "never participated"]];
const last10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);

export default function DsscCrm({ coach, onText, isDirector }) {
  const [contacts, setContacts] = useState([]);
  const [parts, setParts] = useState([]);
  const [partic, setPartic] = useState([]);
  const [orders, setOrders] = useState([]);
  const [consents, setConsents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({ q: "", ageMin: "", ageMax: "", gender: "", cat: "", program: "", since: "", notSince: "", source: "", city: "", phone: false, optin: false, tag: "", position: "", level: "" });
  const [openId, setOpenId] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [imp, setImp] = useState(null);
  const fileRef = useRef(null);

  const loadAll = async () => {
    setLoading(true);
    const page = async (table, sel, order) => { const out = []; for (let from = 0; ; from += 1000) { const { data } = await supabase.from(table).select(sel).order(order || "id").range(from, from + 999); out.push(...(data || [])); if (!data || data.length < 1000) break; } return out; };
    const [c, p, pp, o, cs] = await Promise.all([page("dssc_contacts", "*"), page("dssc_participants", "*"), page("dssc_participation", "id, participant_id, contact_id, program, category, event_date, source"), page("dssc_orders", "id, contact_id, total_cents, ordered_at"), supabase.from("sms_consents").select("phone").eq("brand", "dssc").then(r => r.data || [])]);
    setContacts(c); setParts(p); setPartic(pp); setOrders(o); setConsents(cs); setLoading(false);
  };
  useEffect(() => { loadAll(); }, []);

  // ── Indexes ──────────────────────────────────────────────────────────────
  const consented = useMemo(() => new Set(consents.map(x => last10(x.phone))), [consents]);
  const partsByC = useMemo(() => { const m = new Map(); for (const p of parts) { if (!m.has(p.contact_id)) m.set(p.contact_id, []); m.get(p.contact_id).push(p); } return m; }, [parts]);
  const particByP = useMemo(() => { const m = new Map(); for (const x of partic) { const k = x.participant_id || ("c" + x.contact_id); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; }, [partic]);
  const particByC = useMemo(() => { const m = new Map(); for (const x of partic) { if (!m.has(x.contact_id)) m.set(x.contact_id, []); m.get(x.contact_id).push(x); } return m; }, [partic]);
  const spendByC = useMemo(() => { const m = new Map(); for (const o of orders) if (o.contact_id) m.set(o.contact_id, (m.get(o.contact_id) || 0) + (o.total_cents || 0)); return m; }, [orders]);
  const lastByC = useMemo(() => { const m = new Map(); for (const x of partic) if (x.event_date && (!m.has(x.contact_id) || m.get(x.contact_id) < x.event_date)) m.set(x.contact_id, x.event_date); for (const o of orders) { const d = (o.ordered_at || "").slice(0, 10); if (o.contact_id && d && (!m.has(o.contact_id) || m.get(o.contact_id) < d)) m.set(o.contact_id, d); } return m; }, [partic, orders]);
  const tags = useMemo(() => [...new Set(contacts.flatMap(c => c.tags || []))].sort(), [contacts]);
  const cities = useMemo(() => [...new Set(contacts.map(c => c.city).filter(Boolean))].sort(), [contacts]);
  const positions = useMemo(() => [...new Set(parts.flatMap(p => [p.position, p.position2]).filter(Boolean))].sort(), [parts]);
  const lvlTag = (p) => p.dse_level ? <Tag color={p.dse_level === "national" ? DS.lime : p.dse_level === "rise" ? DS.orange : DS.mut}>{p.dse_team || p.dse_level}</Tag> : null;

  // ── The filter ───────────────────────────────────────────────────────────
  const results = useMemo(() => {
    const q = nrm(f.q);
    const out = [];
    for (const c of contacts) {
      if (f.source && !(c.sources || []).includes(f.source)) continue;
      if (f.city && nrm(c.city) !== nrm(f.city)) continue;
      if (f.phone && !c.phone) continue;
      if (f.optin && !(c.phone && consented.has(last10(c.phone)))) continue;
      if (f.tag && !(c.tags || []).includes(f.tag)) continue;
      const kids = partsByC.get(c.id) || [];
      const matchP = (p) => {
        const age = ageOf(p.dob);
        if (f.ageMin !== "" && (age == null || age < +f.ageMin)) return false;
        if (f.ageMax !== "" && (age == null || age > +f.ageMax)) return false;
        if (f.gender && p.gender !== f.gender) return false;
        if (f.position && nrm(p.position) !== nrm(f.position) && nrm(p.position2) !== nrm(f.position)) return false;
        if (f.level === "none" ? p.dse_level : (f.level && p.dse_level !== f.level)) return false;
        const hist = [...(particByP.get(p.id) || []), ...(p.is_contact ? (particByP.get("c" + c.id) || []) : [])];
        if (f.cat === "none") { if (hist.length) return false; }
        else if (f.cat && !hist.some(h => h.category === f.cat)) return false;
        if (f.program && !hist.some(h => nrm(h.program).includes(nrm(f.program)))) return false;
        if (f.since && !hist.some(h => h.event_date && h.event_date >= f.since)) return false;
        if (f.notSince && hist.some(h => h.event_date && h.event_date >= f.notSince)) return false;
        return true;
      };
      const anyPlayerFilter = f.ageMin !== "" || f.ageMax !== "" || f.gender || f.cat || f.program || f.since || f.notSince || f.position || f.level;
      let matched = anyPlayerFilter ? kids.filter(matchP) : kids;
      // A family with no participants on file but with contact-level history still counts for program filters.
      if (anyPlayerFilter && !matched.length && !kids.length && !f.ageMin && !f.ageMax && !f.gender) { const hist = particByC.get(c.id) || []; if ((f.cat === "none" ? !hist.length : (!f.cat || hist.some(h => h.category === f.cat))) && (!f.program || hist.some(h => nrm(h.program).includes(nrm(f.program))))) matched = []; else continue; }
      else if (anyPlayerFilter && !matched.length) continue;
      if (q) { const hay = [c.first_name, c.last_name, c.email, c.phone, c.city, ...(c.tags || []), ...kids.map(p => p.first_name + " " + p.last_name), ...(particByC.get(c.id) || []).map(h => h.program)].map(nrm).join(" "); if (!q.split(/\s+/).every(w => hay.includes(w))) continue; }
      out.push({ c, matched, kids });
    }
    return out.sort((a, b) => (lastByC.get(b.c.id) || "").localeCompare(lastByC.get(a.c.id) || "") || (a.c.last_name || "").localeCompare(b.c.last_name || ""));
  }, [contacts, partsByC, particByP, particByC, f, consented, lastByC]);

  const textable = results.filter(r => r.c.phone && !r.c.do_not_text);
  const chosen = picked.size ? textable.filter(r => picked.has(r.c.id)) : textable;
  const toTexts = () => onText(chosen.map(r => ({ to: r.c.phone, name: ((r.c.first_name || "") + " " + (r.c.last_name || "")).trim() || r.c.email, kind: "parent", consent: consented.has(last10(r.c.phone)), players: (r.matched.length ? r.matched : r.kids).filter(p => !p.is_contact).map(p => p.first_name + " " + p.last_name), programs: [...new Set((particByC.get(r.c.id) || []).map(h => h.program))].slice(0, 3), contact_id: r.c.id })));
  const exportCsv = () => {
    const lines = [["Parent", "Email", "Phone", "Opted in", "City", "Players", "DS Elite", "Programs", "Last activity", "Spend", "Tags"].join(",")];
    const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    for (const r of results) lines.push([esc(((r.c.first_name || "") + " " + (r.c.last_name || "")).trim()), r.c.email, r.c.phone || "", r.c.phone && consented.has(last10(r.c.phone)) ? "yes" : "", esc(r.c.city), esc((r.matched.length ? r.matched : r.kids).map(p => p.first_name + " " + p.last_name + (ageOf(p.dob) != null ? " (" + ageOf(p.dob) + ")" : "") + (p.position ? " " + p.position : "")).join("; ")), esc((r.matched.length ? r.matched : r.kids).filter(p => p.dse_team).map(p => p.first_name + ": " + p.dse_team + " · " + p.dse_level).join("; ")), esc([...new Set((particByC.get(r.c.id) || []).map(h => h.program))].join("; ")), lastByC.get(r.c.id) || "", Math.round((spendByC.get(r.c.id) || 0) / 100), esc((r.c.tags || []).join("; "))].join(","));
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })); a.download = "dssc-people.csv"; a.click(); URL.revokeObjectURL(a.href);
  };
  const tagAll = async () => {
    const t = window.prompt(`Tag ${chosen.length} famil${chosen.length === 1 ? "y" : "ies"} with:`, "");
    if (!t?.trim()) return;
    for (const r of chosen) if (!(r.c.tags || []).includes(t.trim())) await supabase.from("dssc_contacts").update({ tags: [...(r.c.tags || []), t.trim()] }).eq("id", r.c.id);
    loadAll();
  };
  const saveContact = async (id, patch) => { setContacts(cs => cs.map(c => c.id === id ? { ...c, ...patch } : c)); await supabase.from("dssc_contacts").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id); };

  // ── Imports (Playbook participants / Upper Hand / rosters) ───────────────
  const upload = async (files) => {
    const list = [...(files || [])]; if (!list.length) return;
    setImp({ loading: true });
    try {
      const parsed = await Promise.all(list.map(file => new Promise((res, rej) => Papa.parse(file, { header: true, skipEmptyLines: true, complete: r => res({ name: file.name, rows: r.data }), error: rej }))));
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch("/api/dssc-crm-import", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (session?.access_token || "") }, body: JSON.stringify({ files: parsed }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || ("HTTP " + r.status));
      setImp(d); loadAll();
    } catch (e) { setImp({ error: e.message }); }
    if (fileRef.current) fileRef.current.value = "";
  };
  const syncRosters = async () => {
    setImp({ loading: true });
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch("/api/dssc-crm-import", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (session?.access_token || "") }, body: JSON.stringify({ sync: true }) });
    const d = await r.json().catch(() => ({})); setImp(r.ok ? d : { error: d.error || "HTTP " + r.status }); loadAll();
  };

  const set = (k, v) => { setF(x => ({ ...x, [k]: v })); setPicked(new Set()); };
  const sel = { ...inputStyle, width: "auto", padding: "6px 9px", fontSize: 13 };
  const open = openId ? contacts.find(c => c.id === openId) : null;

  return (
    <div style={{ margin: "-14px -18px", padding: "16px 16px 48px", background: DS.bg, minHeight: "calc(100vh - 56px)", fontFamily: DS.font, color: DS.text }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
          <img src="/dssc/logo-horizontal-white.png" alt="Dripping Springs Sports Club" style={{ height: 30 }} />
          <Tag color={DS.lime}>People</Tag>
          <span style={{ fontSize: 12, color: DS.mut }}>{contacts.length.toLocaleString()} families · {parts.length.toLocaleString()} players · {partic.length.toLocaleString()} program records</span>
          <div style={{ flex: 1 }} />
          <input ref={fileRef} type="file" accept=".csv" multiple style={{ display: "none" }} onChange={e => upload(e.target.files)} />
          <Btn small onClick={() => fileRef.current?.click()} disabled={!!imp?.loading}>{imp?.loading ? "Importing…" : "⬆ Import CSV"}</Btn>
          <Btn small onClick={syncRosters} disabled={!!imp?.loading} title="Pull the current Playbook class rosters and the DS Elite roster in as participation">↻ Sync rosters</Btn>
        </div>
        {imp && !imp.loading && <div style={{ ...{ background: DS.panel, border: "1px solid " + (imp.error ? DS.orange : DS.lime), borderRadius: 12, padding: "10px 14px", marginBottom: 12, fontSize: 13 } }}>{imp.error ? <span style={{ color: DS.orange }}>{imp.error}</span> : <span style={{ color: DS.lime, fontWeight: 700 }}>✓ {imp.summary || JSON.stringify(imp)}</span>}<button onClick={() => setImp(null)} style={{ float: "right", background: "none", border: "none", color: DS.mut, cursor: "pointer" }}>✕</button></div>}

        {/* Filters */}
        <Card accent={DS.lime}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input value={f.q} onChange={e => set("q", e.target.value)} placeholder="Search a parent, player, email, program…" style={{ ...inputStyle, width: 280, padding: "7px 10px", fontSize: 13 }} />
            <span style={{ fontSize: 12, color: DS.mut }}>Player age</span>
            <input value={f.ageMin} onChange={e => set("ageMin", e.target.value.replace(/\D/g, ""))} placeholder="from" style={{ ...sel, width: 60 }} />
            <input value={f.ageMax} onChange={e => set("ageMax", e.target.value.replace(/\D/g, ""))} placeholder="to" style={{ ...sel, width: 60 }} />
            <select value={f.gender} onChange={e => set("gender", e.target.value)} style={sel}><option value="">any gender</option><option value="female">girls</option><option value="male">boys</option></select>
            <select value={f.cat} onChange={e => set("cat", e.target.value)} style={sel}>{CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <input value={f.program} onChange={e => set("program", e.target.value)} placeholder="program contains…" style={{ ...sel, width: 170 }} />
            <select value={f.level} onChange={e => set("level", e.target.value)} style={sel} title="DS Elite team level"><option value="">any DS Elite level</option><option value="national">National (Diamond)</option><option value="regional">Regional</option><option value="rise">Rise</option><option value="none">not on a DS Elite team</option></select>
            <select value={f.position} onChange={e => set("position", e.target.value)} style={sel}><option value="">any position</option>{positions.map(p => <option key={p}>{p}</option>)}</select>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            <span style={{ fontSize: 12, color: DS.mut }}>Participated since</span><input type="date" value={f.since} onChange={e => set("since", e.target.value)} style={sel} />
            <span style={{ fontSize: 12, color: DS.mut }}>but not since</span><input type="date" value={f.notSince} onChange={e => set("notSince", e.target.value)} style={sel} title="Lapsed: nothing on or after this date" />
            <select value={f.source} onChange={e => set("source", e.target.value)} style={sel}><option value="">any source</option><option value="playbook">Playbook</option><option value="upperhand">Upper Hand</option><option value="dse">DS Elite</option><option value="form">opt-in form</option></select>
            <select value={f.city} onChange={e => set("city", e.target.value)} style={sel}><option value="">any city</option>{cities.map(c => <option key={c}>{c}</option>)}</select>
            {tags.length > 0 && <select value={f.tag} onChange={e => set("tag", e.target.value)} style={sel}><option value="">any tag</option>{tags.map(t => <option key={t}>{t}</option>)}</select>}
            <label style={{ fontSize: 12, display: "flex", gap: 5, alignItems: "center" }}><input type="checkbox" checked={f.phone} onChange={e => set("phone", e.target.checked)} /> has phone</label>
            <label style={{ fontSize: 12, display: "flex", gap: 5, alignItems: "center" }}><input type="checkbox" checked={f.optin} onChange={e => set("optin", e.target.checked)} /> opted in to texts</label>
            <Btn kind="link" small onClick={() => { setF({ q: "", ageMin: "", ageMax: "", gender: "", cat: "", program: "", since: "", notSince: "", source: "", city: "", phone: false, optin: false, tag: "", position: "", level: "" }); setPicked(new Set()); }}>clear</Btn>
          </div>
        </Card>

        {/* Results header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 800 }}>{loading ? "Loading…" : `${results.length.toLocaleString()} famil${results.length === 1 ? "y" : "ies"}`}</span>
          <span style={{ fontSize: 12, color: DS.mut }}>{textable.length} with a phone{picked.size ? ` · ${picked.size} selected` : ""}</span>
          <div style={{ flex: 1 }} />
          <Btn small onClick={exportCsv} disabled={!results.length}>⬇ CSV</Btn>
          <Btn small onClick={tagAll} disabled={!chosen.length}>🏷 Tag {chosen.length}</Btn>
          <Btn small kind="primary" onClick={toTexts} disabled={!chosen.length}>💬 Text {chosen.length} famil{chosen.length === 1 ? "y" : "ies"}</Btn>
        </div>

        {/* Results */}
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
              <thead><tr>{["", "Family", "Players", "Programs", "Last", "Spend"].map((h, i) => <th key={i} style={{ textAlign: "left", padding: "8px 10px", fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: DS.mut, borderBottom: "1px solid " + DS.line, whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
              <tbody>
                {results.slice(0, 400).map(({ c, matched, kids }) => {
                  const show = matched.length ? matched : kids;
                  const progs = [...new Set((particByC.get(c.id) || []).map(h => h.program))];
                  const optin = c.phone && consented.has(last10(c.phone));
                  return (
                    <tr key={c.id} onClick={() => setOpenId(c.id)} style={{ cursor: "pointer", background: picked.has(c.id) ? DS.limeSoft : "transparent" }}>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid " + DS.line }} onClick={e => e.stopPropagation()}><input type="checkbox" checked={picked.has(c.id)} onChange={() => setPicked(s => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })} /></td>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid " + DS.line, fontSize: 13 }}>
                        <div style={{ fontWeight: 700 }}>{((c.first_name || "") + " " + (c.last_name || "")).trim() || c.email}{c.do_not_text && <Tag color={DS.orange}> do not text</Tag>}</div>
                        <div style={{ fontSize: 11, color: DS.mut, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>{c.phone ? <span>{fmtPhone(c.phone)}{optin ? <span style={{ color: DS.lime }}> ✓</span> : ""}</span> : <span style={{ color: DS.orange }}>no phone</span>}<span>{c.email}</span>{c.city && <span>{c.city}</span>}{(c.tags || []).map(t => <Tag key={t} color={DS.mut}>{t}</Tag>)}</div>
                      </td>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid " + DS.line, fontSize: 12 }}>{show.filter(p => !p.is_contact).map(p => <div key={p.id} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>{p.first_name} {p.last_name}{ageOf(p.dob) != null && <span style={{ color: DS.mut }}>· {ageOf(p.dob)}{p.gender === "female" ? " F" : p.gender === "male" ? " M" : ""}</span>}{p.position && <span style={{ color: DS.mut }}>· {p.position}</span>}{lvlTag(p)}</div>)}{show.some(p => p.is_contact) && <div style={{ color: DS.mut }}>(self)</div>}</td>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid " + DS.line, fontSize: 11, color: DS.mut, maxWidth: 320 }}>{progs.slice(0, 4).join(" · ")}{progs.length > 4 ? ` +${progs.length - 4}` : ""}</td>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid " + DS.line, fontSize: 12, whiteSpace: "nowrap" }}>{fmtD(lastByC.get(c.id))}</td>
                      <td style={{ padding: "6px 10px", borderBottom: "1px solid " + DS.line, fontSize: 12, textAlign: "right", whiteSpace: "nowrap" }}>{spendByC.get(c.id) ? money(spendByC.get(c.id)) : ""}</td>
                    </tr>
                  );
                })}
                {!loading && !results.length && <tr><td colSpan={6} style={{ padding: 20, textAlign: "center", color: DS.mut, fontSize: 13 }}>Nobody matches those filters.</td></tr>}
              </tbody>
            </table>
          </div>
          {results.length > 400 && <div style={{ padding: "8px 12px", fontSize: 12, color: DS.mut }}>Showing 400 of {results.length} — narrow the filters or export the CSV for the full list.</div>}
        </Card>

        {/* Family detail */}
        {open && (() => {
          const kids = partsByC.get(open.id) || [], hist = (particByC.get(open.id) || []).slice().sort((a, b) => (b.event_date || "").localeCompare(a.event_date || ""));
          const os = orders.filter(o => o.contact_id === open.id).sort((a, b) => (b.ordered_at || "").localeCompare(a.ordered_at || ""));
          const optin = open.phone && consented.has(last10(open.phone));
          return (
            <div onClick={() => setOpenId(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 50, display: "flex", justifyContent: "flex-end" }}>
              <div onClick={e => e.stopPropagation()} style={{ width: "min(560px, 100vw)", background: DS.bg, borderLeft: "1px solid " + DS.line, height: "100%", overflowY: "auto", padding: 18, fontFamily: DS.font }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}><div style={{ fontSize: 22, fontWeight: 800, flex: 1 }}>{((open.first_name || "") + " " + (open.last_name || "")).trim() || open.email}</div><Btn small onClick={() => setOpenId(null)}>✕</Btn></div>
                <div style={{ fontSize: 13, color: DS.mut, marginBottom: 10 }}>{open.email} · {(open.sources || []).join(", ")}{open.city ? " · " + open.city : ""}{open.uh_added_at ? " · Upper Hand since " + fmtD(open.uh_added_at) : ""}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                  <div><Label>Mobile</Label><Field value={open.phone || ""} onSave={v => saveContact(open.id, { phone: v.replace(/\D/g, "").length >= 10 ? "+1" + v.replace(/\D/g, "").slice(-10) : null })} placeholder="(512) 555-0100" /><div style={{ fontSize: 11, color: optin ? DS.lime : DS.orange, marginTop: 3 }}>{open.phone ? (optin ? "✓ opted in to club texts" : "no recorded opt-in") : ""}</div></div>
                  <div><Label>Tags</Label><Field value={(open.tags || []).join(", ")} onSave={v => saveContact(open.id, { tags: v.split(",").map(s => s.trim()).filter(Boolean) })} placeholder="e.g. hot lead, camp 2025" /><label style={{ fontSize: 12, color: DS.orange, display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}><input type="checkbox" checked={!!open.do_not_text} onChange={e => saveContact(open.id, { do_not_text: e.target.checked })} /> do not text</label></div>
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>{open.phone && !open.do_not_text && <Btn small kind="primary" onClick={() => onText([{ to: open.phone, name: ((open.first_name || "") + " " + (open.last_name || "")).trim(), kind: "parent", consent: !!optin, players: kids.filter(p => !p.is_contact).map(p => p.first_name + " " + p.last_name), programs: [...new Set(hist.map(h => h.program))].slice(0, 3), contact_id: open.id }])}>💬 Text</Btn>}{spendByC.get(open.id) ? <Tag color={DS.mut}>{money(spendByC.get(open.id))} lifetime</Tag> : null}</div>
                <Card><Label>Players</Label>{kids.length ? kids.map(p => <div key={p.id} style={{ fontSize: 14, padding: "3px 0" }}><b>{p.first_name} {p.last_name}</b>{p.is_contact && <span style={{ color: DS.mut }}> (self)</span>}{ageOf(p.dob) != null && <span style={{ color: DS.mut }}> · {ageOf(p.dob)} · born {fmtD(p.dob)}</span>}{p.gender && <span style={{ color: DS.mut }}> · {p.gender}</span>}{p.position && <span style={{ color: DS.mut }}> · {p.position}{p.position2 ? "/" + p.position2 : ""}</span>}{lvlTag(p)}{p.waiver_signed && <span style={{ color: DS.mut, fontSize: 11 }}> · waiver ✓</span>}</div>) : <div style={{ fontSize: 13, color: DS.mut }}>No players on file.</div>}</Card>
                <Card><Label>Programs & events</Label>{hist.length ? hist.map(h => <div key={h.id} style={{ fontSize: 13, padding: "3px 0", display: "flex", gap: 8 }}><span style={{ color: DS.mut, minWidth: 80 }}>{fmtD(h.event_date) || "—"}</span><span style={{ flex: 1 }}>{h.program}{h.participant_id && kids.find(p => p.id === h.participant_id) ? <span style={{ color: DS.mut }}> · {kids.find(p => p.id === h.participant_id).first_name}</span> : null}</span><Tag color={DS.mut}>{h.category || "?"}</Tag></div>) : <div style={{ fontSize: 13, color: DS.mut }}>Nothing recorded yet.</div>}</Card>
                {os.length > 0 && <Card><Label>Orders (Upper Hand)</Label>{os.slice(0, 15).map(o => <div key={o.id} style={{ fontSize: 13, padding: "2px 0", display: "flex", gap: 8 }}><span style={{ color: DS.mut, minWidth: 80 }}>{fmtD((o.ordered_at || "").slice(0, 10))}</span><span style={{ flex: 1 }} /><span>{money(o.total_cents)}</span></div>)}{os.length > 15 && <div style={{ fontSize: 12, color: DS.mut }}>+{os.length - 15} more</div>}</Card>}
                <Card><Label>Notes</Label><Field value={open.notes || ""} onSave={v => saveContact(open.id, { notes: v })} multiline minRows={2} placeholder="Anything worth remembering about this family…" /></Card>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
