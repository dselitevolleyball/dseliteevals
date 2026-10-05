// DSSC Texts → Campaigns. Build an audience from filters (DS Elite level, team,
// age, position, gender, DSSC programs and dates, current classes; parents,
// players or coaches), see exactly who it reaches, write a personalised
// message, send a test, then send now or schedule it — and see delivery and
// replies per campaign. The audience engine is shared/campaign-audience.js,
// the same code the sending API runs, so the count here is who gets it.

import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../supabase";
import { DS, Btn, Tag, inputStyle } from "./DsscHub.jsx";
import { LEVELS, POSITIONS, CATEGORIES, MERGE_FIELDS, EMPTY_FILTERS, loadAudienceData, buildPeople, resolveAudience, renderBody, isGsm, segmentsOf } from "../../shared/campaign-audience.js";

const fmtPhone = (p) => { const s = String(p || "").replace(/\D/g, "").slice(-10); return s.length === 10 ? `(${s.slice(0, 3)}) ${s.slice(3, 6)}-${s.slice(6)}` : p || ""; };
const fmtWhen = (iso) => iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const localISO = () => { const x = new Date(); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const STATUS_COLOR = { draft: DS.mut, scheduled: "#60a5fa", sending: "#f59e0b", sent: DS.lime, cancelled: DS.mut, failed: DS.orange };
const TARGETS = [["parents", "Parents"], ["players", "Players (own phones)"], ["both", "Parents + players"], ["coaches", "Coaches"]];

const chip = (on) => ({ padding: "4px 10px", borderRadius: 999, border: "1px solid " + (on ? DS.lime : DS.line), background: on ? "rgba(178,208,73,0.18)" : "transparent", color: on ? DS.lime : DS.text, fontSize: 12, fontWeight: on ? 800 : 600, cursor: "pointer", fontFamily: DS.font });
const sectionTitle = { fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: DS.lime, marginBottom: 8 };
const rowLbl = { fontSize: 11, color: DS.mut, width: 92, flexShrink: 0, paddingTop: 5 };

export default function DsscCampaigns({ coach, coachRoster = [] }) {
  const me = coach?.display_name || coach?.email || "";
  const myPhone = useMemo(() => { const r = coachRoster.find(x => String(x.email || "").toLowerCase() === String(coach?.email || "").toLowerCase()); return r?.phone || ""; }, [coachRoster, coach]);
  const [list, setList] = useState([]);
  const [segments, setSegments] = useState([]);
  const [selId, setSelId] = useState(null);
  const [draft, setDraft] = useState(null);       // editable campaign
  const [people, setPeople] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [ready, setReady] = useState({});
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const [search, setSearch] = useState("");
  const [testTo, setTestTo] = useState("");
  const [results, setResults] = useState(null);   // { rows, delivered, replies }
  const fileRef = useRef(null);

  const token = async () => (await supabase.auth.getSession()).data.session?.access_token || "";
  const api = async (payload) => {
    const r = await fetch("/api/sms-campaigns", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + await token() }, body: JSON.stringify(payload) });
    const d = await r.json().catch(() => ({})); if (!r.ok || d.error) throw new Error(d.error || r.statusText); return d;
  };
  const loadList = async () => { const { data } = await supabase.from("sms_campaigns").select("*").order("created_at", { ascending: false }).limit(100); setList(data || []); };
  const loadSegments = async () => { const { data } = await supabase.from("sms_segments").select("*").order("name"); setSegments(data || []); };
  useEffect(() => {
    loadList(); loadSegments();
    (async () => { try { setPeople(buildPeople(await loadAudienceData(supabase), localISO())); } catch (e) { setLoadErr(e.message); } })();
    (async () => { try { const r = await fetch("/api/sms-campaigns?config=1", { headers: { Authorization: "Bearer " + await token() } }); const d = await r.json(); setReady(d.ready || {}); } catch { /* ignore */ } })();
  }, []);
  useEffect(() => { setTestTo(myPhone); }, [myPhone]);

  const sel = list.find(c => c.id === selId) || null;
  const editing = draft && (draft.status === "draft" || draft.status === "scheduled" || !draft.id);
  useEffect(() => { if (sel) { setDraft({ ...sel, filters: { ...EMPTY_FILTERS, ...(sel.filters || {}) } }); setMsg(null); } }, [selId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Results for a sent / sending campaign.
  const loadResults = async (c) => {
    if (!c?.id || c.status === "draft" || c.status === "scheduled") { setResults(null); return; }
    const { data: rows } = await supabase.from("sms_campaign_recipients").select("*").eq("campaign_id", c.id).order("id");
    const ids = (rows || []).map(r => r.message_id).filter(Boolean);
    const st = new Map();
    for (let i = 0; i < ids.length; i += 300) { const { data } = await supabase.from("sms_messages").select("id, status, error_code").in("id", ids.slice(i, i + 300)); (data || []).forEach(m => st.set(m.id, m)); }
    const { data: threads } = await supabase.from("sms_threads").select("phone, last_message_direction, last_message_at").eq("brand", c.brand).in("phone", (rows || []).map(r => r.phone).slice(0, 1000));
    const replied = new Set((threads || []).filter(t => t.last_message_direction === "inbound" && t.last_message_at > (c.started_at || c.created_at)).map(t => t.phone));
    const { data: outs } = await supabase.from("sms_optouts").select("phone, opted_out_at").eq("brand", c.brand).gte("opted_out_at", c.started_at || c.created_at);
    const optedSince = new Set((outs || []).map(o => o.phone));
    setResults({ rows: (rows || []).map(r => ({ ...r, delivery: st.get(r.message_id)?.status || null, code: st.get(r.message_id)?.error_code || null, replied: replied.has(r.phone), optedOut: optedSince.has(r.phone) })) });
  };
  useEffect(() => { loadResults(sel); }, [sel?.id, sel?.status, sel?.sent_count]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (sel?.status !== "sending") return; const t = setInterval(loadList, 5000); return () => clearInterval(t); }, [sel?.status]);

  const set = (p) => setDraft(d => ({ ...d, ...p }));
  const setF = (p) => setDraft(d => ({ ...d, filters: { ...d.filters, ...p } }));
  const toggle = (key, v) => setDraft(d => { const cur = d.filters[key] || []; return { ...d, filters: { ...d.filters, [key]: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v] } }; });

  const audience = useMemo(() => (people && draft) ? resolveAudience(people, draft.filters, draft.brand) : { recipients: [], skipped: [] }, [people, draft?.filters, draft?.brand]); // eslint-disable-line react-hooks/exhaustive-deps
  const teamOptions = useMemo(() => {
    if (!people) return [];
    return [...people.teamInfo.entries()].filter(([, t]) => !t.event && (!draft?.filters.levels?.length || draft.filters.levels.includes(t.level)) && (!draft?.filters.ageGroups?.length || draft.filters.ageGroups.includes(t.ageGroup)))
      .map(([n]) => n).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [people, draft?.filters.levels, draft?.filters.ageGroups]); // eslint-disable-line react-hooks/exhaustive-deps
  const ageOptions = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

  const newCampaign = () => { setSelId(null); setResults(null); setMsg(null); setDraft({ id: null, brand: "dssc", name: "", status: "draft", filters: { ...EMPTY_FILTERS }, body: "", media_urls: [], scheduled_at: null }); };
  const save = async (patch = {}) => {
    const row = { brand: draft.brand, name: draft.name.trim() || "Untitled campaign", filters: draft.filters, body: draft.body, media_urls: draft.media_urls || [], scheduled_at: draft.scheduled_at || null, status: draft.status === "scheduled" ? "scheduled" : "draft", created_by: draft.created_by || me, updated_at: new Date().toISOString(), ...patch };
    const q = draft.id ? supabase.from("sms_campaigns").update(row).eq("id", draft.id).select().single() : supabase.from("sms_campaigns").insert(row).select().single();
    const { data, error } = await q; if (error) { setMsg({ err: error.message }); return null; }
    await loadList(); setSelId(data.id); setDraft({ ...data, filters: { ...EMPTY_FILTERS, ...(data.filters || {}) } }); return data;
  };
  const doTest = async () => {
    setBusy("test"); setMsg(null);
    try { const c = await save(); if (!c) return; const r = await api({ action: "test", id: c.id, to: testTo }); setMsg({ ok: `Test sent to ${fmtPhone(r.to)}${r.sample ? " (personalised as " + r.sample + ")" : ""}.` }); loadList(); }
    catch (e) { setMsg({ err: e.message }); } finally { setBusy(""); }
  };
  const doSend = async () => {
    if (!window.confirm(`Send "${draft.name || "this campaign"}" to ${audience.recipients.length} number${audience.recipients.length === 1 ? "" : "s"} from the ${draft.brand === "dse" ? "DS Elite" : "DSSC club"} number now?`)) return;
    setBusy("send"); setMsg(null);
    try {
      const c = await save({ status: "draft", scheduled_at: null }); if (!c) return;
      let r = await api({ action: "send", id: c.id });
      while (r.status === "sending" && r.pending > 0) { setMsg({ ok: `Sending… ${r.sent + r.failed + r.skipped} of ${r.total}` }); await loadList(); r = await api({ action: "continue", id: c.id }); }
      setMsg({ ok: `Done — ${r.sent} sent${r.failed ? ", " + r.failed + " failed" : ""}${r.skipped ? ", " + r.skipped + " skipped (opted out)" : ""}.` }); await loadList();
    } catch (e) { setMsg({ err: e.message + " — anything already sent won't be sent again; open the campaign and press Continue." }); await loadList(); } finally { setBusy(""); }
  };
  const doSchedule = async () => {
    if (!draft.scheduled_at) { setMsg({ err: "Pick a date and time first." }); return; }
    if (new Date(draft.scheduled_at) < new Date()) { setMsg({ err: "That time has passed." }); return; }
    const c = await save({ status: "scheduled" }); if (c) setMsg({ ok: `Scheduled for ${fmtWhen(c.scheduled_at)} — sends within 10 minutes of that time.` });
  };
  const doContinue = async () => { setBusy("send"); try { let r = await api({ action: "continue", id: sel.id }); while (r.status === "sending" && r.pending > 0) { await loadList(); r = await api({ action: "continue", id: sel.id }); } await loadList(); } catch (e) { setMsg({ err: e.message }); } finally { setBusy(""); } };
  const doCancel = async () => { if (!window.confirm("Stop this campaign? Anyone not texted yet won't be.")) return; await api({ action: "cancel", id: sel.id }); loadList(); };
  const duplicate = () => { const c = draft; setSelId(null); setResults(null); setDraft({ ...c, id: null, status: "draft", name: (c.name || "Campaign") + " (copy)", scheduled_at: null, sent_at: null, started_at: null }); };
  const saveSegment = async () => { const name = window.prompt("Name this audience (e.g. National 14s parents):"); if (!name) return; await supabase.from("sms_segments").insert({ brand: draft.brand, name: name.trim(), filters: { ...draft.filters, exclude: [] }, created_by: me }); loadSegments(); };
  const uploadMedia = async (files) => {
    for (const f of [...(files || [])].filter(x => x.type.startsWith("image/")).slice(0, 3)) {
      const path = `campaign/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${(f.name.split(".").pop() || "jpg").toLowerCase()}`;
      const up = await supabase.storage.from("dssc-media").upload(path, f, { contentType: f.type });
      if (up.error) { window.alert(up.error.message); continue; }
      set({ media_urls: [...(draft.media_urls || []), supabase.storage.from("dssc-media").getPublicUrl(path).data.publicUrl] });
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const f = draft?.filters || EMPTY_FILTERS;
  const sample = audience.recipients[0];
  const preview = draft ? renderBody(draft.body, sample || { first: "Jamie", kind: "parent", players: ["Ava Smith"], team: "14 Ruby", program: "Fall Pods" }) : "";
  const q = search.trim().toLowerCase();
  const shown = audience.recipients.filter(r => !q || [r.name, r.team, r.program, ...(r.players || []), r.to].some(v => String(v || "").toLowerCase().includes(q)));
  const exclude = (to) => setF({ exclude: [...(f.exclude || []), to] });
  const brandReady = ready[draft?.brand] !== false;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 14, minHeight: "calc(100vh - 150px)" }}>
      {/* Campaign list */}
      <div style={{ background: DS.panel, border: "1px solid " + DS.line, borderRadius: 14, overflowY: "auto" }}>
        <div style={{ padding: 10, borderBottom: "1px solid " + DS.line }}><Btn kind="primary" small style={{ width: "100%" }} onClick={newCampaign}>+ New campaign</Btn></div>
        {!list.length && <div style={{ padding: 16, fontSize: 12, color: DS.mut }}>No campaigns yet.</div>}
        {list.map(c => (
          <div key={c.id} onClick={() => setSelId(c.id)} style={{ padding: "9px 12px", borderBottom: "1px solid " + DS.line, cursor: "pointer", background: c.id === selId ? "rgba(178,208,73,0.10)" : "transparent" }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 13, fontWeight: 800, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
              <Tag color={STATUS_COLOR[c.status]}>{c.status}</Tag>
            </div>
            <div style={{ fontSize: 11, color: DS.mut, marginTop: 3 }}>
              {c.brand === "dse" ? "DS Elite #" : "Club #"} · {c.status === "scheduled" ? "sends " + fmtWhen(c.scheduled_at) : c.status === "sent" || c.status === "sending" ? `${c.sent_count}/${c.recipient_count} sent · ${fmtWhen(c.started_at)}` : "edited " + fmtWhen(c.updated_at)}
            </div>
          </div>
        ))}
      </div>

      {/* Editor / results */}
      <div style={{ background: DS.panel, border: "1px solid " + DS.line, borderRadius: 14, padding: 16, overflowY: "auto" }}>
        {!draft && <div style={{ color: DS.mut, fontSize: 13, textAlign: "center", padding: 40 }}>Pick a campaign or start a new one. Build the audience with filters — level, team, age, position, program — see exactly who it reaches, then send or schedule.</div>}
        {loadErr && <div style={{ color: DS.orange, fontSize: 12, marginBottom: 10 }}>Couldn't load people: {loadErr}</div>}
        {draft && (<>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
            <input value={draft.name} disabled={!editing} onChange={e => set({ name: e.target.value })} placeholder="Campaign name (e.g. Spring tryout reminder)" style={{ ...inputStyle, flex: 1, minWidth: 240, fontSize: 16, fontWeight: 800 }} />
            {draft.id && <Tag color={STATUS_COLOR[draft.status]}>{draft.status}</Tag>}
            {draft.id && <Btn small onClick={duplicate}>Duplicate</Btn>}
          </div>

          {/* From */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
            <span style={rowLbl}>Send from</span>
            {[["dssc", "DSSC club number"], ["dse", "DS Elite number"]].map(([k, l]) => <button key={k} disabled={!editing} onClick={() => set({ brand: k })} style={chip(draft.brand === k)}>{l}{ready[k] === false ? " (not set up)" : ""}</button>)}
            <span style={{ fontSize: 11, color: DS.mut, flex: "1 1 260px" }}>DS Elite team news goes from the DS Elite number; club programs from the club number — each is registered with the carriers for its own messages.</span>
          </div>

          {/* Audience */}
          <div style={{ border: "1px solid " + DS.line, borderRadius: 12, padding: 12, marginBottom: 14, opacity: editing ? 1 : 0.7, pointerEvents: editing ? "auto" : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <div style={sectionTitle}>Audience</div><div style={{ flex: 1 }} />
              {segments.length > 0 && <select value="" onChange={e => { const s = segments.find(x => String(x.id) === e.target.value); if (s) setF({ ...EMPTY_FILTERS, ...s.filters }); }} style={{ ...inputStyle, width: "auto", padding: "4px 8px", fontSize: 12 }}><option value="">Load a saved audience…</option>{segments.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
              <Btn small onClick={saveSegment}>Save audience</Btn>
              <Btn small onClick={() => setF({ ...EMPTY_FILTERS, target: f.target })}>Clear filters</Btn>
            </div>
            {[
              ["Text", TARGETS.map(([k, l]) => <button key={k} onClick={() => setF({ target: k })} style={chip(f.target === k)}>{l}</button>)],
              f.target !== "coaches" && ["DS Elite", [["any", "Everyone"], ["members", "DS Elite families"], ["non", "Not DS Elite"]].map(([k, l]) => <button key={k} onClick={() => setF({ dse: k })} style={chip(f.dse === k)}>{l}</button>)],
              ["Level", LEVELS.map(l => <button key={l} onClick={() => toggle("levels", l)} style={chip(f.levels.includes(l))}>{l}</button>)],
              ["Age group", ageOptions.map(a => <button key={a} onClick={() => toggle("ageGroups", a)} style={chip(f.ageGroups.includes(a))}>{a}s</button>)],
              ["Team", teamOptions.map(t => <button key={t} onClick={() => toggle("teams", t)} style={chip(f.teams.includes(t))}>{t}</button>)],
              f.target !== "coaches" && ["Position", POSITIONS.map(([k, l]) => <button key={k} onClick={() => toggle("positions", k)} style={chip(f.positions.includes(k))}>{l}</button>)],
              f.target !== "coaches" && ["Gender", [["", "Any"], ["female", "Girls"], ["male", "Boys"]].map(([k, l]) => <button key={k} onClick={() => setF({ gender: k })} style={chip(f.gender === k)}>{l}</button>)],
              f.target !== "coaches" && ["Exact age", [<input key="a" type="number" min="3" max="99" value={f.minAge} onChange={e => setF({ minAge: e.target.value })} placeholder="from" style={{ ...inputStyle, width: 70, padding: "4px 8px", fontSize: 12 }} />, <span key="b" style={{ color: DS.mut, fontSize: 12 }}>to</span>, <input key="c" type="number" min="3" max="99" value={f.maxAge} onChange={e => setF({ maxAge: e.target.value })} placeholder="to" style={{ ...inputStyle, width: 70, padding: "4px 8px", fontSize: 12 }} />]],
              f.target !== "coaches" && ["DSSC programs", [
                ...CATEGORIES.map(k => <button key={k} onClick={() => toggle("categories", k)} style={chip(f.categories.includes(k))}>{k}</button>),
                <input key="p" value={f.program} onChange={e => setF({ program: e.target.value })} placeholder="program name contains…" style={{ ...inputStyle, width: 190, padding: "4px 8px", fontSize: 12 }} />,
                <span key="s" style={{ color: DS.mut, fontSize: 12 }}>since</span>,
                <input key="d" type="date" value={f.since} onChange={e => setF({ since: e.target.value })} style={{ ...inputStyle, width: 150, padding: "4px 8px", fontSize: 12, colorScheme: "dark" }} />,
                <button key="cur" onClick={() => setF({ current: !f.current })} style={chip(f.current)}>In a current class</button>,
              ]],
            ].filter(Boolean).map(([label, items]) => (
              <div key={label} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
                <span style={rowLbl}>{label}</span>{items}
              </div>
            ))}
            <div style={{ fontSize: 11, color: DS.mut, marginTop: 4 }}>Within a row, any choice matches; across rows, all must match. A family matches when any of its kids does.</div>
          </div>

          {/* Who it reaches */}
          <div style={{ border: "1px solid " + DS.line, borderRadius: 12, padding: 12, marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: DS.lime }}>{people ? audience.recipients.length : "…"}</div>
              <div style={{ fontSize: 12, color: DS.mut }}>numbers{audience.skipped.length ? ` · ${audience.skipped.length} left out (opted out / do not text)` : ""}{(f.exclude || []).length ? ` · ${(f.exclude || []).length} removed by hand` : ""}</div>
              <div style={{ flex: 1 }} />
              {(f.exclude || []).length > 0 && editing && <Btn small onClick={() => setF({ exclude: [] })}>Put removed back</Btn>}
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search who's in…" style={{ ...inputStyle, width: 200, padding: "5px 8px", fontSize: 12 }} />
            </div>
            <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid " + DS.line, borderRadius: 8 }}>
              {shown.slice(0, 300).map(r => (
                <div key={r.to} style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 10px", borderBottom: "1px solid " + DS.line, fontSize: 12 }}>
                  <span style={{ fontWeight: 700, minWidth: 150 }}>{r.name}</span>
                  <span style={{ color: DS.mut, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[r.kind !== "parent" ? r.kind : "", (r.players || []).join(", "), r.team, r.program].filter(Boolean).join(" · ")}</span>
                  <span style={{ color: DS.mut }}>{fmtPhone(r.to)}</span>
                  {editing && <button title="Leave this number out" onClick={() => exclude(r.to)} style={{ background: "none", border: "none", color: DS.mut, cursor: "pointer" }}>✕</button>}
                </div>
              ))}
              {!shown.length && <div style={{ padding: 12, fontSize: 12, color: DS.mut }}>{people ? "No one matches." : "Loading people…"}</div>}
              {shown.length > 300 && <div style={{ padding: 8, fontSize: 11, color: DS.mut }}>…and {shown.length - 300} more — search to find someone.</div>}
            </div>
          </div>

          {/* Message */}
          <div style={{ border: "1px solid " + DS.line, borderRadius: 12, padding: 12, marginBottom: 14 }}>
            <div style={sectionTitle}>Message</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
              {MERGE_FIELDS.map(([tok, label]) => <button key={tok} disabled={!editing} title={label} onClick={() => set({ body: (draft.body || "") + tok })} style={{ ...chip(false), fontSize: 11 }}>{tok}</button>)}
            </div>
            <textarea value={draft.body} disabled={!editing} onChange={e => set({ body: e.target.value })} rows={5} placeholder="Hi {parent_first}! Quick note for {players}…" style={{ ...inputStyle, resize: "vertical" }} />
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
              <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => uploadMedia(e.target.files)} />
              {editing && <Btn small onClick={() => fileRef.current?.click()}>📷 Photo</Btn>}
              {(draft.media_urls || []).map(u => <span key={u} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><img src={u} alt="" style={{ height: 26, borderRadius: 4 }} />{editing && <button onClick={() => set({ media_urls: draft.media_urls.filter(x => x !== u) })} style={{ background: "none", border: "none", color: DS.mut, cursor: "pointer" }}>✕</button>}</span>)}
              <span style={{ fontSize: 11, color: preview.length > 600 || !isGsm(preview) ? DS.orange : DS.mut }}>
                {preview.length} chars · {segmentsOf(preview)} segment{segmentsOf(preview) === 1 ? "" : "s"}{(draft.media_urls || []).length ? " · MMS" : ""}
                {!isGsm(preview) ? " · has emoji/special characters — counts as a much longer text" : ""}{preview.length > 600 ? " · long texts can be blocked by carriers; keep under ~600" : ""}
              </span>
            </div>
            <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: "rgba(178,208,73,0.08)", border: "1px solid " + DS.line }}>
              <div style={{ fontSize: 10, color: DS.mut, marginBottom: 4 }}>PREVIEW{sample ? " — as " + sample.name + " gets it" : ""} · long dashes and curly quotes are sent as plain - and " automatically</div>
              <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{preview || <i style={{ color: DS.mut }}>(empty)</i>}</div>
            </div>
          </div>

          {/* Send */}
          {editing ? (
            <div style={{ border: "1px solid " + DS.line, borderRadius: 12, padding: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <Btn small onClick={() => save()}>Save draft</Btn>
              <span style={{ width: 1, height: 22, background: DS.line }} />
              <input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="Your phone" style={{ ...inputStyle, width: 140, padding: "5px 8px", fontSize: 12 }} />
              <Btn small disabled={!!busy || !draft.body.trim() || !brandReady} onClick={doTest}>{busy === "test" ? "Sending test…" : "Send me a test"}</Btn>
              <span style={{ width: 1, height: 22, background: DS.line }} />
              <input type="datetime-local" value={draft.scheduled_at ? new Date(new Date(draft.scheduled_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""} onChange={e => set({ scheduled_at: e.target.value ? new Date(e.target.value).toISOString() : null })} style={{ ...inputStyle, width: 200, padding: "5px 8px", fontSize: 12, colorScheme: "dark" }} />
              <Btn small disabled={!!busy || !draft.body.trim() || !audience.recipients.length} onClick={doSchedule}>Schedule</Btn>
              {draft.status === "scheduled" && <Btn small onClick={() => save({ status: "draft", scheduled_at: null })}>Unschedule</Btn>}
              <div style={{ flex: 1 }} />
              <Btn kind="primary" disabled={!!busy || !draft.body.trim() || !audience.recipients.length || !brandReady} onClick={doSend}>{busy === "send" ? "Sending…" : `Send now to ${audience.recipients.length}`}</Btn>
              {!brandReady && <div style={{ width: "100%", fontSize: 12, color: DS.orange }}>The {draft.brand === "dse" ? "DS Elite" : "DSSC club"} number isn't set up to send yet.</div>}
              {draft.test_sent_at && <div style={{ width: "100%", fontSize: 11, color: DS.mut }}>Last test sent {fmtWhen(draft.test_sent_at)}.</div>}
            </div>
          ) : sel && (
            <div style={{ border: "1px solid " + DS.line, borderRadius: 12, padding: 12 }}>
              <div style={{ display: "flex", gap: 14, alignItems: "baseline", flexWrap: "wrap", marginBottom: 8 }}>
                <div style={sectionTitle}>Results</div>
                {(() => { const r = results?.rows || []; const n = (fn) => r.filter(fn).length; return <>
                  <span style={{ fontSize: 13 }}><b>{sel.sent_count}</b>/{sel.recipient_count} sent</span>
                  <span style={{ fontSize: 13, color: DS.lime }}><b>{n(x => x.delivery === "delivered")}</b> delivered</span>
                  <span style={{ fontSize: 13, color: DS.orange }}><b>{n(x => x.status === "failed" || x.delivery === "undelivered" || x.delivery === "failed")}</b> failed</span>
                  <span style={{ fontSize: 13 }}><b>{n(x => x.replied)}</b> replied</span>
                  <span style={{ fontSize: 13, color: DS.mut }}>{n(x => x.optedOut)} opted out since · {sel.skipped_count + n(x => x.status === "skipped")} skipped</span>
                </>; })()}
                <div style={{ flex: 1 }} />
                {sel.status === "sending" && <><Btn small disabled={!!busy} onClick={doContinue}>{busy ? "Sending…" : "Continue sending"}</Btn><Btn small onClick={doCancel}>Stop</Btn></>}
                <Btn small onClick={() => { loadList(); loadResults(sel); }}>Refresh</Btn>
              </div>
              {sel.last_error && <div style={{ fontSize: 12, color: DS.orange, marginBottom: 6 }}>{sel.last_error}</div>}
              <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid " + DS.line, borderRadius: 8 }}>
                {(results?.rows || []).map(r => (
                  <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 10px", borderBottom: "1px solid " + DS.line, fontSize: 12 }}>
                    <span style={{ fontWeight: 700, minWidth: 150 }}>{r.name}</span>
                    <span style={{ color: DS.mut, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[(r.players || []).join(", "), r.team_name].filter(Boolean).join(" · ")}</span>
                    <span style={{ color: DS.mut }}>{fmtPhone(r.phone)}</span>
                    <Tag color={r.status === "failed" || r.delivery === "undelivered" || r.delivery === "failed" ? DS.orange : r.delivery === "delivered" ? DS.lime : DS.mut}>{r.status === "sent" ? (r.delivery || "sent") : r.status}</Tag>
                    {r.replied && <Tag color={DS.lime}>replied</Tag>}{r.optedOut && <Tag color={DS.orange}>opted out</Tag>}
                    {(r.error || r.code) && <span title={r.error || "carrier error " + r.code} style={{ color: DS.orange, cursor: "help" }}>ⓘ</span>}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: DS.mut, marginTop: 6 }}>Replies land in the Inbox, one thread per person, filed under this campaign's group.</div>
            </div>
          )}
          {msg && <div style={{ marginTop: 10, fontSize: 13, color: msg.err ? DS.orange : DS.lime, fontWeight: 700 }}>{msg.err || msg.ok}</div>}
        </>)}
      </div>
    </div>
  );
}
