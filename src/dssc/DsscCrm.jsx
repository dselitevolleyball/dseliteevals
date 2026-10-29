// Dripping Springs Sports Club — People (the CRM).
//
// Every family the club has ever dealt with: their players, what they did and
// bought (Upper Hand, Playbook, DS Elite), every form and email they sent us,
// and how they answer texts and emails. Four tabs:
//
//   Pulse      the club at a glance - stages, products, reach - and revenue
//              ideas: ready-made campaigns with their audience and a rough $ (DsscCrmPulse.jsx)
//   People     the list. One-tap smart groups (New, Cooling, VIP, Open gym
//              members, Privates, Birthdays soon, Answers texts…) on top of the
//              player filters (age, DS Elite, position, program, dates). Text
//              them, start a campaign for them, tag them, export them.
//   Segments   saved audiences for emails, texts and campaigns (DsscCrmSegments.jsx)
//   Campaigns  audience + offer + AI-written steps -> the Marketing calendar,
//              then who booked and what they spent (DsscCrmCampaigns.jsx)
//
// Each family's profile (stage, tier, products, reach) comes from
// shared/crm-profile.js via shared/crm-segments.js buildFamilies(), so this
// screen, segments, campaigns and Marketing's senders count the same people.
// Filters run on players (age, gender, what they did); results are families.

import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../supabase";
import { DS, nrm, Btn, Card, Label, Tag, inputStyle, Field } from "./DsscHub.jsx";
import Papa from "papaparse";
import DsscCrmSegments from "./DsscCrmSegments.jsx";
import DsscCrmPulse from "./DsscCrmPulse.jsx";
import DsscCrmCampaigns from "./DsscCrmCampaigns.jsx";
import { loadSegmentData, buildFamilies, familyMatches, describeSegment, EMPTY_SEGMENT } from "../../shared/crm-segments.js";
import { stageMeta, PRODUCTS, hasProduct } from "../../shared/crm-profile.js";
import { revenueIdeas, nextBestFor } from "../../shared/crm-ideas.js";

const today = new Date();
const todayYmd = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const ageOf = (dob) => { if (!dob) return null; const d = new Date(dob + "T12:00:00"); let a = today.getFullYear() - d.getFullYear(); if (today < new Date(today.getFullYear(), d.getMonth(), d.getDate())) a--; return a; };
const fmtPhone = (p) => { const s = String(p || "").replace(/\D/g, ""); if (s.length === 11 && s.startsWith("1")) return `(${s.slice(1, 4)}) ${s.slice(4, 7)}-${s.slice(7)}`; if (s.length === 10) return `(${s.slice(0, 3)}) ${s.slice(3, 6)}-${s.slice(6)}`; return p || ""; };
const money = (c) => "$" + (Math.round((c || 0) / 100)).toLocaleString();
const fmtD = (iso) => iso ? new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" }) : "";
const CATS = [["", "any program"], ["volleyball", "volleyball"], ["basketball", "basketball"], ["reach", "Reach / performance"], ["facility", "rentals / open gym"], ["none", "never participated"]];
const last10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);
const POS_GROUPS = [["Setter", /set/i], ["Hitter", /pin|hit|outside|right|opp|oh|rs/i], ["Middle", /mid|mb/i], ["Libero/DS", /lib|ds|def/i]];
const posGroup = (v) => { const g = POS_GROUPS.find(([, re]) => re.test(String(v || ""))); return g ? g[0] : (v ? "Other" : null); };
const teamAge = (t) => { const m = /^(\d{1,2})\b/.exec(t || ""); return m ? +m[1] : null; };
const nameOf = (c) => ((c.first_name || "") + " " + (c.last_name || "")).trim() || c.email || fmtPhone(c.phone) || "Family #" + c.id;
// The club's own exports (api/dssc-crm-import.js recognises these); anything else with an email column is a mailing list.
const KNOWN_EXPORT = (cols) => (cols.includes("student_pk") && cols.includes("guardian_email")) || (cols.includes("registration_pk") && cols.includes("source_pk")) || (cols.includes("invoice_number") && cols.includes("registration_base_price")) || (cols.includes("phone_number") && cols.includes("added_date")) || (cols.includes("gender") && cols.includes("date_of_birth") && cols.includes("phone")) || (cols.includes("Order Number") && cols.includes("Buyer")) || cols.some(c => /event|attend|product|item|program|class/i.test(c));

// One-tap groups: a name and a test on a family's profile.
export const SMART_GROUPS = [
  ["all", "Everyone", () => true],
  ["new", "New", p => p.stage === "new"],
  ["active", "Active", p => p.stage === "active"],
  ["cooling", "Cooling", p => p.stage === "cooling"],
  ["lapsed", "Lapsed", p => ["lapsed", "lost"].includes(p.stage)],
  ["prospect", "Prospects", p => p.stage === "prospect"],
  ["vip", "VIP", p => p.tier === "vip"],
  ["open_gym", "Open gym members", p => hasProduct(p, "open_gym_active")],
  ["privates", "Privates", p => hasProduct(p, "privates")],
  ["reach_member", "Reach", p => hasProduct(p, "reach")],
  ["rentals", "Renters", p => hasProduct(p, "rentals")],
  ["parties", "Parties", p => hasProduct(p, "parties")],
  ["bday", "Birthday in 30 days", p => p.birthdays.some(b => b.days <= 30)],
  ["replies", "Answers texts", p => p.text.replies > 0],
  ["reached", "Wrote to us", p => p.reached.count > 0],
];

export function StageChip({ stage }) { const [k, l, , color] = stageMeta(stage); return <span title={stageMeta(k)[2]} style={{ display: "inline-block", fontSize: 10.5, fontWeight: 800, padding: "2px 7px", borderRadius: 999, border: "1px solid " + color, color, whiteSpace: "nowrap" }}>{l}</span>; }
export function ProductBadges({ p, max = 4 }) {
  const list = [];
  for (const pr of PRODUCTS) { const e = p.products[pr.key]; if (!e) continue; list.push(<span key={pr.key} title={pr.label + (pr.membership ? (e.active ? " · active" : " · lapsed") : "") + (e.coaches?.length ? " · " + e.coaches.join(", ") : "") + (e.last ? " · last " + fmtD(e.last) : "")} style={{ fontSize: 11, padding: "1px 6px", borderRadius: 6, background: pr.membership && !e.active ? "transparent" : "rgba(178,208,73,0.14)", border: "1px solid " + (pr.membership && !e.active ? DS.line : "transparent"), color: pr.membership && !e.active ? DS.mut : DS.text, whiteSpace: "nowrap" }}>{pr.icon} {pr.label}</span>); }
  if (p.dse) list.push(<span key="dse" style={{ fontSize: 11, padding: "1px 6px", borderRadius: 6, background: "rgba(255,115,0,0.14)", whiteSpace: "nowrap" }}>DS Elite</span>);
  return <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>{list.slice(0, max)}{list.length > max ? <span style={{ fontSize: 11, color: DS.mut }}>+{list.length - max}</span> : null}</span>;
}
// ✉ and 💬 with their state, as two small dots of color.
export function ReachIcons({ p }) {
  const e = p.email.state, t = p.text.state;
  const ec = e === "ok" ? (p.email.opens ? DS.lime : DS.text) : DS.dim, tc = t === "ok" ? (p.text.replies ? DS.lime : DS.text) : t === "opted_out" ? DS.orange : DS.dim;
  return <span style={{ display: "inline-flex", gap: 8, fontSize: 12, whiteSpace: "nowrap" }}>
    <span title={e === "ok" ? `Email ok${p.email.opens ? ` · opened ${p.email.opens}×` : ""}` : e === "none" ? "No email" : `Email ${e}`} style={{ color: ec }}>✉{e === "ok" && p.email.opens ? <sup>{p.email.opens}</sup> : e !== "ok" ? "̸" : ""}</span>
    <span title={t === "ok" ? `Can text · ${p.text.sent} sent · ${p.text.replies} replies${p.text.lastReply ? " · last reply " + fmtD(p.text.lastReply) : ""}` : t === "opted_out" ? "Opted out of texts" : "No phone"} style={{ color: tc }}>💬{t === "ok" && p.text.replies ? <sup>{p.text.replies}</sup> : t !== "ok" ? "̸" : ""}</span>
  </span>;
}

export default function DsscCrm({ coach, onText, isDirector, onOpenView }) {
  const [data, setData] = useState(null);
  const [view, setView] = useState("pulse");
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const blankF = { q: "", ages: new Set(), levels: new Set(), pos: new Set(), gender: "", cat: "", program: "", since: "", notSince: "", source: "", city: "", phone: false, optout: false, tag: "", list: "" };
  const [f, setF] = useState(blankF);
  const [group, setGroup] = useState("all");
  const [seg, setSeg] = useState(null);           // a segment applied from Pulse / Segments: { label, filters }
  const [openId, setOpenId] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [imp, setImp] = useState(null);
  const [campaignDraft, setCampaignDraft] = useState(null);   // prefill for the Campaigns wizard
  const fileRef = useRef(null);

  const loadAll = async () => {
    setLoading(true); setLoadErr("");
    try { setData(await loadSegmentData(supabase)); } catch (e) { setLoadErr(e.message); }
    setLoading(false);
  };
  useEffect(() => { loadAll(); }, []);

  const contacts = data?.contacts || [], parts = data?.participants || [], partic = data?.participation || [], orders = data?.orders || [], buys = data?.purchases || [];
  const index = useMemo(() => data ? buildFamilies(data, todayYmd()) : null, [data]);
  const ideas = useMemo(() => index ? revenueIdeas(index) : [], [index]);
  const prof = (id) => index?.fams.get(id)?.profile;

  // ── Indexes ──────────────────────────────────────────────────────────────
  const optedOut = useMemo(() => new Set((data?.optouts || []).map(x => last10(x.phone))), [data]);
  const partsByC = useMemo(() => { const m = new Map(); for (const p of parts) { if (!m.has(p.contact_id)) m.set(p.contact_id, []); m.get(p.contact_id).push(p); } return m; }, [parts]);
  const particByP = useMemo(() => { const m = new Map(); for (const x of partic) { const k = x.participant_id || ("c" + x.contact_id); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; }, [partic]);
  const particByC = useMemo(() => { const m = new Map(); for (const x of partic) { if (!m.has(x.contact_id)) m.set(x.contact_id, []); m.get(x.contact_id).push(x); } return m; }, [partic]);
  const lists = useMemo(() => [...new Set(contacts.flatMap(c => c.lists || []))].sort(), [contacts]);
  const tags = useMemo(() => [...new Set(contacts.flatMap(c => c.tags || []))].sort(), [contacts]);
  const cities = useMemo(() => [...new Set(contacts.map(c => c.city).filter(Boolean))].sort(), [contacts]);
  const lvlTag = (p) => p.dse_level ? <Tag color={p.dse_level === "national" ? DS.lime : p.dse_level === "rise" ? DS.orange : DS.mut}>{p.dse_team || p.dse_level}</Tag> : null;

  // ── The filter ───────────────────────────────────────────────────────────
  const groupTest = (SMART_GROUPS.find(g => g[0] === group) || SMART_GROUPS[0])[2];
  const results = useMemo(() => {
    if (!index) return [];
    const q = nrm(f.q);
    const out = [];
    for (const c of contacts) {
      const fam = index.fams.get(c.id), p = fam?.profile;
      if (!p || !groupTest(p)) continue;
      if (seg && !familyMatches(fam, seg.filters, { today: index.today })) continue;
      if (f.source && !(c.sources || []).includes(f.source)) continue;
      if (f.city && nrm(c.city) !== nrm(f.city)) continue;
      if (f.phone && !c.phone) continue;
      if (f.optout && !(c.do_not_text || (c.phone && optedOut.has(last10(c.phone))))) continue;
      if (f.tag && !(c.tags || []).includes(f.tag)) continue;
      if (f.list && !(c.lists || []).includes(f.list)) continue;
      const kids = partsByC.get(c.id) || [];
      const matchP = (pl) => {
        // An age chip matches on real age, or on the DS Elite team age ("12 Diamond" = 12s).
        const age = ageOf(pl.dob), ta = teamAge(pl.dse_team);
        if (f.ages.size && !(f.ages.has(age) || f.ages.has(ta))) return false;
        if (f.gender && pl.gender !== f.gender) return false;
        if (f.pos.size && !(f.pos.has(posGroup(pl.position)) || f.pos.has(posGroup(pl.position2)))) return false;
        if (f.levels.size && !(f.levels.has(pl.dse_level || "none"))) return false;
        const hist = [...(particByP.get(pl.id) || []), ...(pl.is_contact ? (particByP.get("c" + c.id) || []) : [])];
        if (f.cat === "none") { if (hist.length) return false; }
        else if (f.cat && !hist.some(h => h.category === f.cat)) return false;
        if (f.program && !hist.some(h => nrm(h.program).includes(nrm(f.program)))) return false;
        if (f.since && !hist.some(h => h.event_date && h.event_date >= f.since)) return false;
        if (f.notSince && hist.some(h => h.event_date && h.event_date >= f.notSince)) return false;
        return true;
      };
      const anyPlayerFilter = f.ages.size || f.gender || f.cat || f.program || f.since || f.notSince || f.pos.size || f.levels.size;
      let matched = anyPlayerFilter ? kids.filter(matchP) : kids;
      if (anyPlayerFilter && !matched.length && !kids.length && !f.ages.size && !f.gender && !f.pos.size && !f.levels.size) { const hist = particByC.get(c.id) || []; if ((f.cat === "none" ? !hist.length : (!f.cat || hist.some(h => h.category === f.cat))) && (!f.program || hist.some(h => nrm(h.program).includes(nrm(f.program))))) matched = []; else continue; }
      else if (anyPlayerFilter && !matched.length) continue;
      if (q) { const hay = [c.first_name, c.last_name, c.email, c.phone, c.city, ...(c.tags || []), ...(c.interests || []), ...kids.map(pl => pl.first_name + " " + pl.last_name), ...(particByC.get(c.id) || []).map(h => h.program)].map(nrm).join(" "); if (!q.split(/\s+/).every(w => hay.includes(w))) continue; }
      out.push({ c, matched, kids, p });
    }
    // Only booked ahead = just signed up, so they sit with today's activity rather than above it.
    const seen = (p) => p.lastPast || (p.next ? index.today : "");
    return out.sort((a, b) => seen(b.p).localeCompare(seen(a.p)) || (a.c.last_name || "").localeCompare(b.c.last_name || ""));
  }, [contacts, index, partsByC, particByP, particByC, f, optedOut, group, seg]); // eslint-disable-line react-hooks/exhaustive-deps

  const groupCounts = useMemo(() => { const m = new Map(); if (!index) return m; for (const [k, , t] of SMART_GROUPS) m.set(k, [...index.fams.values()].filter(x => t(x.profile)).length); return m; }, [index]);
  const textable = results.filter(r => r.p.text.state === "ok");
  const chosenAll = picked.size ? results.filter(r => picked.has(r.c.id)) : results;
  const chosen = picked.size ? textable.filter(r => picked.has(r.c.id)) : textable;
  const toTexts = () => onText(chosen.map(r => ({ to: r.c.phone, name: nameOf(r.c), kind: "parent", players: (r.matched.length ? r.matched : r.kids).filter(p => !p.is_contact).map(p => p.first_name + " " + p.last_name), programs: [...new Set((particByC.get(r.c.id) || []).map(h => h.program))].slice(0, 3), contact_id: r.c.id })));
  const startCampaign = (prefill) => { setCampaignDraft({ ...prefill, key: Date.now() }); setView("campaigns"); };
  const campaignForList = () => startCampaign({ segment: { ...EMPTY_SEGMENT, ids: chosenAll.map(r => r.c.id) }, label: `${chosenAll.length} families from People${seg ? " (" + seg.label + ")" : ""}` });
  const exportCsv = () => {
    const lines = [["Parent", "Email", "Phone", "Stage", "Tier", "Can text", "Text replies", "Email", "City", "Players", "DS Elite", "Has", "Programs", "Last activity", "Spend", "Purchases (12 mo)", "Tags", "Asked about"].join(",")];
    const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    for (const r of results) lines.push([esc(nameOf(r.c)), r.c.email || "", r.c.phone || "", r.p.stage, r.p.tier || "", r.p.text.state === "ok" ? "yes" : r.p.text.state, r.p.text.replies, r.p.email.state, esc(r.c.city), esc((r.matched.length ? r.matched : r.kids).map(p => p.first_name + " " + p.last_name + (ageOf(p.dob) != null ? " (" + ageOf(p.dob) + ")" : "") + (p.position ? " " + p.position : "")).join("; ")), esc((r.matched.length ? r.matched : r.kids).filter(p => p.dse_team).map(p => p.first_name + ": " + p.dse_team + " · " + p.dse_level).join("; ")), esc(Object.keys(r.p.products).join("; ")), esc([...new Set((particByC.get(r.c.id) || []).map(h => h.program))].join("; ")), r.p.last || "", Math.round((r.p.spend.all || 0) / 100), r.p.buys12, esc((r.c.tags || []).join("; ")), esc((r.c.interests || []).join("; "))].join(","));
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })); a.download = "dssc-people.csv"; a.click(); URL.revokeObjectURL(a.href);
  };
  const tagAll = async () => {
    const t = window.prompt(`Tag ${chosenAll.length} famil${chosenAll.length === 1 ? "y" : "ies"} with:`, "");
    if (!t?.trim()) return;
    for (const r of chosenAll) if (!(r.c.tags || []).includes(t.trim())) await supabase.from("dssc_contacts").update({ tags: [...(r.c.tags || []), t.trim()] }).eq("id", r.c.id);
    loadAll();
  };
  const saveContact = async (id, patch) => { setData(d => ({ ...d, contacts: d.contacts.map(c => c.id === id ? { ...c, ...patch } : c) })); await supabase.from("dssc_contacts").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id); };

  // ── Imports (Playbook participants / Upper Hand / rosters / mailing lists) ──
  const upload = async (files) => {
    const list = [...(files || [])]; if (!list.length) return;
    setImp({ loading: true });
    try {
      const parsed = [];
      for (const file of list) {
        const text = await file.text(); const rows = Papa.parse(text, { header: true, skipEmptyLines: true }).data;
        const cols = Object.keys(rows[0] || {});
        let listName;
        if (!KNOWN_EXPORT(cols) && cols.some(c => /e-?mail/i.test(c))) {
          listName = window.prompt(`"${file.name}" looks like a mailing list (${rows.length.toLocaleString()} rows). Which list is it? Everyone on it gets this list name in People.`, file.name.replace(/\.csv$/i, "").replace(/[_-]+/g, " ").replace(/\s*\d{4}[\s_-]\d{2}[\s_-]\d{2}.*$/, "").trim());
          if (listName == null) continue;
        }
        parsed.push({ name: file.name, rows, list: listName || undefined, text: !listName && text.length < 300_000 ? text : undefined });
      }
      if (!parsed.length) { setImp(null); return; }
      // Big files go up in parts (Vercel takes ~4 MB a request). A Playbook spend export is cut between invoices.
      const chunks = [];
      for (const p of parsed) {
        if (p.rows.length <= 2500) { chunks.push(p); continue; }
        let cur = [], key = null;
        for (const r of p.rows) { const k = r.invoice_number || null; if (cur.length >= 2500 && (!k || k !== key)) { chunks.push({ ...p, rows: cur, text: undefined }); cur = []; } cur.push(r); key = k; }
        if (cur.length) chunks.push({ ...p, rows: cur, text: undefined });
      }
      const { data: { session } } = await supabase.auth.getSession();
      const summaries = [];
      for (let i = 0; i < chunks.length; i++) {
        if (chunks.length > 1) setImp({ loading: true, step: `${i + 1} of ${chunks.length}` });
        const r = await fetch("/api/dssc-crm-import", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (session?.access_token || "") }, body: JSON.stringify({ files: [chunks[i]] }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((summaries.length ? summaries.join(" · ") + " · then " : "") + (d.error || ("HTTP " + r.status)));
        summaries.push(d.summary);
      }
      setImp({ ok: true, summary: summaries.join(" · ") }); loadAll();
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
  const toggle = (k, v) => { setF(x => { const n = new Set(x[k]); n.has(v) ? n.delete(v) : n.add(v); return { ...x, [k]: n }; }); setPicked(new Set()); };
  const counts = useMemo(() => {
    const ages = new Map(), levels = new Map(), pos = new Map();
    for (const p of parts) {
      const a = ageOf(p.dob), ta = teamAge(p.dse_team);
      for (const v of new Set([a, ta].filter(x => x != null))) ages.set(v, (ages.get(v) || 0) + 1);
      levels.set(p.dse_level || "none", (levels.get(p.dse_level || "none") || 0) + 1);
      for (const v of new Set([posGroup(p.position), posGroup(p.position2)].filter(Boolean))) pos.set(v, (pos.get(v) || 0) + 1);
    }
    return { ages, levels, pos };
  }, [parts]);
  const chipRow = (label, items, key) => (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: DS.mut, minWidth: 64 }}>{label}</span>
      {items.map(([v, l, n]) => { const on = f[key].has(v); return (
        <button key={String(v)} onClick={() => toggle(key, v)} style={{ fontFamily: DS.font, fontSize: 13, fontWeight: 800, padding: "5px 11px", borderRadius: 999, cursor: "pointer", border: "1px solid " + (on ? DS.lime : DS.lineStrong), background: on ? DS.lime : "transparent", color: on ? DS.bg : DS.text, opacity: n ? 1 : 0.45 }}>
          {l}{n ? <span style={{ fontSize: 10, fontWeight: 600, marginLeft: 5, color: on ? DS.bg : DS.mut }}>{n}</span> : null}
        </button>); })}
      {f[key].size > 0 && <button onClick={() => set(key, new Set())} style={{ background: "none", border: "none", color: DS.mut, fontSize: 11, cursor: "pointer", fontFamily: DS.font }}>clear</button>}
    </div>
  );
  const sel = { ...inputStyle, width: "auto", padding: "6px 9px", fontSize: 13 };
  const tab = (k, l) => <button key={k} onClick={() => setView(k)} style={{ fontFamily: DS.font, fontSize: 13, fontWeight: 800, padding: "6px 14px", borderRadius: 999, cursor: "pointer", border: "1px solid " + (view === k ? DS.lime : DS.lineStrong), background: view === k ? DS.lime : "transparent", color: view === k ? DS.bg : DS.text }}>{l}</button>;
  const showPeople = (segment, label) => { setSeg(segment ? { filters: segment, label: label || describeSegment(segment) } : null); setGroup("all"); setF(blankF); setPicked(new Set()); setView("people"); };

  return (
    <div style={{ margin: "-14px -18px", padding: "16px 16px 48px", background: DS.bg, minHeight: "calc(100vh - 56px)", fontFamily: DS.font, color: DS.text }}>
      <div style={{ maxWidth: 1240, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <img src={import.meta.env.BASE_URL + "dssc/logo-horizontal-white.png"} alt="Dripping Springs Sports Club" style={{ height: 30 }} />
          <Tag color={DS.lime}>People</Tag>
          {tab("pulse", "Pulse")}{tab("people", "People")}{tab("segments", "Segments")}{tab("campaigns", "Campaigns")}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: DS.mut }}>{contacts.length.toLocaleString()} families · {parts.length.toLocaleString()} players</span>
          <input ref={fileRef} type="file" accept=".csv" multiple style={{ display: "none" }} onChange={e => upload(e.target.files)} />
          <Btn small onClick={() => fileRef.current?.click()} disabled={!!imp?.loading} title="Playbook participants · Playbook registrations report with prices (spend) · Upper Hand contacts / orders / per-event lists · old mailing lists (any CSV with an email column)">{imp?.loading ? (imp.step ? `Importing ${imp.step}…` : "Importing…") : "⬆ Import CSV"}</Btn>
          <Btn small onClick={syncRosters} disabled={!!imp?.loading} title="Pull the current Playbook class rosters and the DS Elite roster in as participation">↻ Sync rosters</Btn>
        </div>
        {imp && !imp.loading && <div style={{ background: DS.panel, border: "1px solid " + (imp.error ? DS.orange : DS.lime), borderRadius: 12, padding: "10px 14px", marginBottom: 12, fontSize: 13 }}>{imp.error ? <span style={{ color: DS.orange }}>{imp.error}</span> : <span style={{ color: DS.lime, fontWeight: 700 }}>✓ {imp.summary || JSON.stringify(imp)}</span>}<button onClick={() => setImp(null)} style={{ float: "right", background: "none", border: "none", color: DS.mut, cursor: "pointer" }}>✕</button></div>}
        {loadErr && <Card accent={DS.orange}><span style={{ color: DS.orange }}>Couldn't load People: {loadErr}</span></Card>}

        {view === "pulse" && <DsscCrmPulse index={index} ideas={ideas} loading={loading} onPeople={showPeople} onCampaign={startCampaign} onOpen={setOpenId} />}
        {view === "segments" && <DsscCrmSegments coach={coach} data={data} index={index} onCampaign={startCampaign} onPeople={showPeople} />}
        {view === "campaigns" && <DsscCrmCampaigns index={index} ideas={ideas} prefill={campaignDraft} onPeople={showPeople} onOpenMarketing={() => onOpenView?.("dsscmarketing")} />}

        {view === "people" && <>
        {/* Smart groups */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {SMART_GROUPS.map(([k, l]) => { const on = group === k, n = groupCounts.get(k) || 0; return <button key={k} onClick={() => { setGroup(k); setPicked(new Set()); }} style={{ fontFamily: DS.font, fontSize: 12.5, fontWeight: 800, padding: "5px 11px", borderRadius: 999, cursor: "pointer", border: "1px solid " + (on ? DS.lime : DS.lineStrong), background: on ? DS.lime : "transparent", color: on ? DS.bg : DS.text, opacity: n || k === "all" ? 1 : 0.4 }}>{l}<span style={{ fontSize: 10, fontWeight: 600, marginLeft: 5, color: on ? DS.bg : DS.mut }}>{n.toLocaleString()}</span></button>; })}
        </div>
        {seg && <div style={{ display: "flex", gap: 8, alignItems: "center", background: "rgba(178,208,73,0.08)", border: "1px solid " + DS.lime, borderRadius: 10, padding: "7px 12px", marginBottom: 10, fontSize: 13 }}><span style={{ color: DS.lime, fontWeight: 800 }}>Showing:</span><span style={{ flex: 1 }}>{seg.label}</span><Btn small kind="link" onClick={() => setSeg(null)}>✕ clear</Btn></div>}
        {/* Filters */}
        <Card accent={DS.lime}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input value={f.q} onChange={e => set("q", e.target.value)} placeholder="Search a parent, player, email, program…" style={{ ...inputStyle, width: 280, padding: "7px 10px", fontSize: 13 }} />
            <select value={f.gender} onChange={e => set("gender", e.target.value)} style={sel}><option value="">any gender</option><option value="female">girls</option><option value="male">boys</option></select>
            <select value={f.cat} onChange={e => set("cat", e.target.value)} style={sel}>{CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <input value={f.program} onChange={e => set("program", e.target.value)} placeholder="program contains…" style={{ ...sel, width: 170 }} />
          </div>
          {chipRow("Age", [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map(a => [a, String(a), counts.ages.get(a) || 0]), "ages")}
          {chipRow("DS Elite", [["national", "National", counts.levels.get("national") || 0], ["regional", "Regional", counts.levels.get("regional") || 0], ["rise", "Rise", counts.levels.get("rise") || 0], ["none", "Not on a team", counts.levels.get("none") || 0]], "levels")}
          {chipRow("Position", ["Setter", "Hitter", "Middle", "Libero/DS", "Other"].map(p => [p, p, counts.pos.get(p) || 0]), "pos")}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            <span style={{ fontSize: 12, color: DS.mut }}>Participated since</span><input type="date" value={f.since} onChange={e => set("since", e.target.value)} style={sel} />
            <span style={{ fontSize: 12, color: DS.mut }}>but not since</span><input type="date" value={f.notSince} onChange={e => set("notSince", e.target.value)} style={sel} title="Lapsed: nothing on or after this date" />
            <select value={f.source} onChange={e => set("source", e.target.value)} style={sel}><option value="">any source</option><option value="playbook">Playbook</option><option value="upperhand">Upper Hand</option><option value="dse">DS Elite</option><option value="inquiry">website form / email</option><option value="texts-form">texts opt-in</option><option value="website">newsletter</option><option value="list">mailing list</option></select>
            <select value={f.city} onChange={e => set("city", e.target.value)} style={sel}><option value="">any city</option>{cities.map(c => <option key={c}>{c}</option>)}</select>
            {tags.length > 0 && <select value={f.tag} onChange={e => set("tag", e.target.value)} style={sel}><option value="">any tag</option>{tags.map(t => <option key={t}>{t}</option>)}</select>}
            {lists.length > 0 && <select value={f.list} onChange={e => set("list", e.target.value)} style={sel}><option value="">any mailing list</option>{lists.map(t => <option key={t}>{t}</option>)}</select>}
            <label style={{ fontSize: 12, display: "flex", gap: 5, alignItems: "center" }}><input type="checkbox" checked={f.phone} onChange={e => set("phone", e.target.checked)} /> has phone</label>
            <label style={{ fontSize: 12, display: "flex", gap: 5, alignItems: "center" }}><input type="checkbox" checked={f.optout} onChange={e => set("optout", e.target.checked)} /> opted out only</label>
            <Btn kind="link" small onClick={() => { setF(blankF); setPicked(new Set()); setGroup("all"); setSeg(null); }}>clear all</Btn>
          </div>
        </Card>

        {/* Results header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 800 }}>{loading ? "Loading…" : `${results.length.toLocaleString()} famil${results.length === 1 ? "y" : "ies"}`}</span>
          <span style={{ fontSize: 12, color: DS.mut }}>{textable.length} can be texted{picked.size ? ` · ${picked.size} selected` : ""} · {money(results.reduce((s, r) => s + (r.p.spend["12m"] || 0), 0))} spent in 12 months</span>
          <div style={{ flex: 1 }} />
          <Btn small onClick={exportCsv} disabled={!results.length}>⬇ CSV</Btn>
          <Btn small onClick={tagAll} disabled={!chosenAll.length}>🏷 Tag {chosenAll.length}</Btn>
          <Btn small onClick={campaignForList} disabled={!chosenAll.length || chosenAll.length > 3000}>📣 Campaign for {chosenAll.length}</Btn>
          <Btn small kind="primary" onClick={toTexts} disabled={!chosen.length}>💬 Text {chosen.length}</Btn>
        </div>

        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
              <thead><tr>{["", "Family", "Stage", "Players", "Has", "Reach", "Last", "Spend"].map((h, i) => <th key={i} style={{ textAlign: i === 7 ? "right" : "left", padding: "8px 10px", fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: DS.mut, borderBottom: "1px solid " + DS.line, whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
              <tbody>
                {results.slice(0, 400).map(({ c, matched, kids, p }) => {
                  const show = matched.length ? matched : kids;
                  const td = { padding: "6px 10px", borderBottom: "1px solid " + DS.line, verticalAlign: "top" };
                  return (
                    <tr key={c.id} onClick={() => setOpenId(c.id)} style={{ cursor: "pointer", background: picked.has(c.id) ? DS.limeSoft : "transparent" }}>
                      <td style={td} onClick={e => e.stopPropagation()}><input type="checkbox" checked={picked.has(c.id)} onChange={() => setPicked(s => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })} /></td>
                      <td style={{ ...td, fontSize: 13 }}>
                        <div style={{ fontWeight: 700 }}>{nameOf(c)}{p.tier === "vip" && <span title="VIP: top 10% by spend" style={{ marginLeft: 6, color: "#F2C230" }}>★</span>}</div>
                        <div style={{ fontSize: 11, color: DS.mut, display: "flex", gap: 6, flexWrap: "wrap" }}>{c.phone && <span>{fmtPhone(c.phone)}</span>}{c.email && <span>{c.email}</span>}{c.city && <span>{c.city}</span>}{(c.tags || []).map(t => <Tag key={t} color={DS.mut}>{t}</Tag>)}</div>
                      </td>
                      <td style={td}><StageChip stage={p.stage} /></td>
                      <td style={{ ...td, fontSize: 12 }}>{show.filter(x => !x.is_contact).slice(0, 3).map(x => <div key={x.id} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>{x.first_name} {x.last_name}{ageOf(x.dob) != null && <span style={{ color: DS.mut }}>· {ageOf(x.dob)}{x.gender === "female" ? " F" : x.gender === "male" ? " M" : ""}</span>}{lvlTag(x)}</div>)}{show.filter(x => !x.is_contact).length > 3 && <div style={{ color: DS.mut }}>+{show.filter(x => !x.is_contact).length - 3} more</div>}</td>
                      <td style={{ ...td, maxWidth: 260 }}><ProductBadges p={p} max={3} /></td>
                      <td style={td}><ReachIcons p={p} /></td>
                      <td style={{ ...td, fontSize: 12, whiteSpace: "nowrap" }}>{fmtD(p.lastPast)}{p.next && <div style={{ fontSize: 10.5, color: DS.lime }}>next {fmtD(p.next)}</div>}</td>
                      <td style={{ ...td, fontSize: 12, textAlign: "right", whiteSpace: "nowrap" }}>{p.spend.all ? money(p.spend.all) : ""}{p.buys12 > 1 && <div style={{ fontSize: 10.5, color: DS.mut }}>{p.buys12}× this year</div>}</td>
                    </tr>
                  );
                })}
                {!loading && !results.length && <tr><td colSpan={8} style={{ padding: 20, textAlign: "center", color: DS.mut, fontSize: 13 }}>Nobody matches those filters.</td></tr>}
              </tbody>
            </table>
          </div>
          {results.length > 400 && <div style={{ padding: "8px 12px", fontSize: 12, color: DS.mut }}>Showing 400 of {results.length.toLocaleString()} — narrow it down, or export the CSV / start a campaign for all of them.</div>}
        </Card>
        </>}

        {openId && index?.fams.get(openId) && <Profile fam={index.fams.get(openId)} data={data} ideas={ideas} index={index} optedOut={optedOut} onClose={() => setOpenId(null)} onText={onText} onSave={saveContact} onCampaign={(prefill) => { setOpenId(null); startCampaign(prefill); }} />}
      </div>
    </div>
  );
}

// ── one family ───────────────────────────────────────────────────────────────
function Profile({ fam, data, ideas, index, onClose, onText, onSave, onCampaign }) {
  const c = fam.c, p = fam.profile;
  const kids = (data.participants || []).filter(x => x.contact_id === c.id);
  const kidName = (pid) => kids.find(k => k.id === pid)?.first_name;
  const best = useMemo(() => nextBestFor(fam, ideas, index), [fam, ideas, index]);
  // Everything that happened, newest first: sign-ups, purchases, orders, forms/emails/opt-ins.
  const timeline = useMemo(() => {
    const t = [];
    for (const x of (data.participation || []).filter(x => x.contact_id === c.id)) t.push({ at: x.event_date, icon: "🏐", text: x.program + (kidName(x.participant_id) ? " · " + kidName(x.participant_id) : ""), tag: x.category });
    for (const b of (data.purchases || []).filter(x => x.contact_id === c.id)) t.push({ at: (b.purchased_at || "").slice(0, 10), icon: "💳", text: (b.program || "Purchase") + (kidName(b.participant_id) ? " · " + kidName(b.participant_id) : ""), amount: b.amount_cents });
    for (const o of (data.orders || []).filter(x => x.contact_id === c.id)) if (o.total_cents) t.push({ at: (o.ordered_at || "").slice(0, 10), icon: "🧾", text: "Upper Hand order", amount: o.total_cents });
    for (const x of (data.touches || []).filter(x => x.contact_id === c.id)) t.push({ at: (x.at || "").slice(0, 10), icon: x.kind === "email" ? "📧" : x.kind === "text_optin" ? "💬" : x.kind === "newsletter" ? "📰" : "📝", text: x.detail || x.kind, tag: x.kind === "form" ? "form" : x.kind });
    if (p.text.lastReply) t.push({ at: p.text.lastReply.slice(0, 10), icon: "💬", text: `Latest text reply (${p.text.replies} in all)` });
    // Upcoming bookings first (dimmed), then the history, newest first.
    const now = todayYmd();
    return t.filter(x => x.at).map(x => ({ ...x, future: x.at > now })).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 80);
  }, [c.id, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const card = { background: DS.panel, border: "1px solid " + DS.line, borderRadius: 12, padding: 12, marginBottom: 10 };
  const stat = (v, l) => <div style={{ flex: 1, minWidth: 90 }}><div style={{ fontSize: 18, fontWeight: 900 }}>{v}</div><div style={{ fontSize: 11, color: DS.mut }}>{l}</div></div>;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 50, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "min(600px, 100vw)", background: DS.bg, borderLeft: "1px solid " + DS.line, height: "100%", overflowY: "auto", padding: 18, fontFamily: DS.font, boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <div style={{ fontSize: 22, fontWeight: 900, flex: 1 }}>{nameOf(c)}{p.tier === "vip" && <span style={{ color: "#F2C230" }}> ★</span>}</div>
          <Btn small onClick={onClose}>✕</Btn>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <StageChip stage={p.stage} />{p.tier && <Tag color={DS.mut}>{p.tier === "vip" ? "VIP" : p.tier} spender</Tag>}
          <span style={{ fontSize: 12, color: DS.mut }}>{[c.email, c.phone && fmtPhone(c.phone), c.city, (c.sources || []).join(", ")].filter(Boolean).join(" · ")}</span>
        </div>
        <div style={{ ...card, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {stat(money(p.spend.all), "lifetime")}{stat(money(p.spend["12m"]), "last 12 months")}{stat(p.buys12 || 0, p.every ? `purchases a year · every ~${p.every}d` : "purchases a year")}{stat(p.lastPast ? fmtD(p.lastPast) : "—", p.next ? `last seen · next booked ${fmtD(p.next)}` : p.lastPast ? `last seen · ${p.since}d ago` : "never")}
        </div>
        {best && <div style={{ ...card, borderColor: DS.lime }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: DS.lime, marginBottom: 4 }}>Next best offer</div>
          <div style={{ fontWeight: 800 }}>{best.emoji} {best.title}</div>
          <div style={{ fontSize: 13, color: DS.mut, margin: "2px 0 8px" }}>{best.offer_text}</div>
          <div style={{ display: "flex", gap: 8 }}><Btn small kind="primary" onClick={() => onCampaign({ idea: best, segment: { ...EMPTY_SEGMENT, ids: [c.id] }, label: nameOf(c) })}>Send this to {c.first_name || "them"}</Btn><Btn small onClick={() => onCampaign({ idea: best })}>Run it for all {best.families}</Btn></div>
        </div>}
        <div style={card}>
          <Label>How to reach them</Label>
          <div style={{ fontSize: 13, display: "grid", gap: 4 }}>
            <div>✉ {p.email.state === "ok" ? <>Email ok{p.email.opens ? ` · opened ${p.email.opens} marketing email${p.email.opens === 1 ? "" : "s"}` : p.email.lastEmailed ? " · hasn't opened yet" : ""}{p.email.lastOpen ? ` · last open ${fmtD(p.email.lastOpen)}` : ""}</> : p.email.state === "none" ? <span style={{ color: DS.mut }}>No email on file</span> : <span style={{ color: DS.orange }}>Email {p.email.state} - never emailed</span>}</div>
            <div>💬 {p.text.state === "ok" ? <>Can text{p.text.sent ? ` · ${p.text.sent} club texts · ${p.text.replies ? `${p.text.replies} repl${p.text.replies === 1 ? "y" : "ies"}, last ${fmtD(p.text.lastReply)}` : "never replied"}` : " · never texted"}</> : p.text.state === "opted_out" ? <span style={{ color: DS.orange }}>Opted out of club texts</span> : <span style={{ color: DS.mut }}>No phone</span>}</div>
            {p.reached.count > 0 && <div>📝 Wrote to us {p.reached.count}× · last {fmtD(p.reached.last)}{p.reached.interests.length ? ` · asked about ${p.reached.interests.join(", ")}` : ""}</div>}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>{p.text.state === "ok" && <Btn small kind="primary" onClick={() => onText([{ to: c.phone, name: nameOf(c), kind: "parent", players: kids.filter(k => !k.is_contact).map(k => k.first_name + " " + k.last_name), programs: [], contact_id: c.id }])}>💬 Text</Btn>}{c.email && <Btn small onClick={() => { window.location.href = "mailto:" + c.email; }}>✉ Email</Btn>}</div>
        </div>
        {(Object.keys(p.products).length > 0 || p.dse) && <div style={card}>
          <Label>Has</Label>
          <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
            {PRODUCTS.filter(pr => p.products[pr.key]).map(pr => { const e = p.products[pr.key]; return <div key={pr.key}>{pr.icon} <b>{pr.label}</b>{pr.membership ? <span style={{ color: e.active ? DS.lime : DS.orange }}> · {e.active ? "active" : "lapsed"}</span> : null} <span style={{ color: DS.mut }}>· {e.count}× · last {fmtD(e.last)}{e.coaches?.length ? " · with " + e.coaches.join(", ") : ""}</span></div>; })}
            {p.dse && <div>🟧 <b>DS Elite</b> <span style={{ color: DS.mut }}>· {kids.filter(k => k.dse_team).map(k => k.first_name + ": " + k.dse_team).join(", ")}</span></div>}
          </div>
        </div>}
        <div style={card}>
          <Label>Players</Label>
          {kids.length ? kids.map(k => <div key={k.id} style={{ fontSize: 14, padding: "3px 0" }}><b>{k.first_name} {k.last_name}</b>{k.is_contact && <span style={{ color: DS.mut }}> (self)</span>}{ageOf(k.dob) != null && <span style={{ color: DS.mut }}> · {ageOf(k.dob)} · born {fmtD(k.dob)}</span>}{k.gender && <span style={{ color: DS.mut }}> · {k.gender}</span>}{k.position && <span style={{ color: DS.mut }}> · {k.position}{k.position2 ? "/" + k.position2 : ""}</span>}{k.dse_level ? <Tag color={DS.mut}>{k.dse_team || k.dse_level}</Tag> : null}{p.birthdays.find(b => b.name === k.first_name && b.days <= 45) && <span style={{ color: "#E86FA6", fontSize: 12 }}> · 🎂 in {p.birthdays.find(b => b.name === k.first_name).days}d</span>}</div>) : <div style={{ fontSize: 13, color: DS.mut }}>No players on file.</div>}
        </div>
        <div style={card}>
          <Label>Timeline</Label>
          {timeline.length ? timeline.map((x, i) => <div key={i} style={{ fontSize: 13, padding: "3px 0", display: "flex", gap: 8, opacity: x.future ? 0.6 : 1 }} title={x.future ? "Booked, coming up" : ""}><span style={{ color: DS.mut, minWidth: 74 }}>{fmtD(x.at)}</span><span>{x.icon}</span><span style={{ flex: 1 }}>{x.text}</span>{x.amount ? <span>{money(x.amount)}</span> : x.tag ? <Tag color={DS.mut}>{x.tag}</Tag> : null}</div>) : <div style={{ fontSize: 13, color: DS.mut }}>Nothing recorded yet.</div>}
        </div>
        <div style={card}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div><Label>Mobile</Label><Field value={c.phone || ""} onSave={v => onSave(c.id, { phone: v.replace(/\D/g, "").length >= 10 ? "+1" + v.replace(/\D/g, "").slice(-10) : null })} placeholder="(512) 555-0100" /></div>
            <div><Label>Tags</Label><Field value={(c.tags || []).join(", ")} onSave={v => onSave(c.id, { tags: v.split(",").map(s => s.trim()).filter(Boolean) })} placeholder="e.g. hot lead, camp 2025" /></div>
          </div>
          <label style={{ fontSize: 12, color: DS.orange, display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}><input type="checkbox" checked={!!c.do_not_text} onChange={e => onSave(c.id, { do_not_text: e.target.checked })} /> do not text</label>
          <div style={{ marginTop: 8 }}><Label>Notes</Label><Field value={c.notes || ""} onSave={v => onSave(c.id, { notes: v })} multiline minRows={2} placeholder="Anything worth remembering about this family…" /></div>
        </div>
      </div>
    </div>
  );
}
