// Dripping Springs Sports Club — Texts.
//
// The club's own texting, on the club's own number (brand 'dssc'), separate
// from DS Elite's. Hunter texts a family about their player's pod, sends the
// class a photo, or blasts everyone signed up for a program, an age group, a
// category, or the whole system — each recipient gets their own one-to-one
// thread and replies come back here, filed under the program.
//
// Who can be reached: families on class rosters (dssc_pod_roster) with a
// phone — from the /dssc-texts opt-in form, or a DS Elite family we already
// know by email — plus the DSSC coach pool. Texts default to opted-in numbers
// only; the sender can include the rest on purpose, same as DS Elite.

import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../supabase";
import { DS, nrm, fmtDay, Btn, Card, Label, Tag, inputStyle } from "./DsscHub.jsx";
import { localDateISO } from "../../shared/dssc-clinics.js";

const last10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);
const e164 = (s) => { const d = String(s || "").replace(/\D/g, ""); if (d.length === 10) return "+1" + d; if (d.length === 11 && d.startsWith("1")) return "+" + d; return d.length > 10 ? "+" + d : ""; };
const fmtPhone = (p) => { const s = String(p || "").replace(/\D/g, ""); if (s.length === 11 && s.startsWith("1")) return `(${s.slice(1, 4)}) ${s.slice(4, 7)}-${s.slice(7)}`; if (s.length === 10) return `(${s.slice(0, 3)}) ${s.slice(3, 6)}-${s.slice(6)}`; return p || ""; };
const fmtWhen = (iso) => { if (!iso) return ""; const d = new Date(iso); return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); };
const segments = (s) => Math.max(1, Math.ceil((s || "").length / (/[^\u0000-\u007f]/.test(s || "") ? 70 : 160)));
const catOf = (c) => /pod/i.test(c?.category || "") || /pod/i.test(c?.name || "") ? "Pods" : /camp/i.test(c?.category || "") || /camp/i.test(c?.name || "") ? "Camps" : /adult/i.test(c?.category || "") ? "Adult" : "Clinics";

export default function DsscTexts({ coach, clinics = [], players = [], coachRoster = [], dsscAvail = [], isDirector, initial, onConsumedInitial }) {
  const today = localDateISO();
  const me = coach?.display_name || coach?.email || "";
  const [threads, setThreads] = useState([]);
  const [selId, setSelId] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [roster, setRoster] = useState([]);
  const [consents, setConsents] = useState([]);
  const [composer, setComposer] = useState(null);   // { scope, clinicId, sessionId, category, age, who, includeUnconsented, body, media:[], result }
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [folded, setFolded] = useState(() => new Set());
  const [health, setHealth] = useState(null);
  const [consentPaste, setConsentPaste] = useState("");
  const fileRef = useRef(null);

  const loadThreads = async () => { const { data } = await supabase.from("sms_threads").select("*").eq("brand", "dssc").order("last_message_at", { ascending: false, nullsFirst: false }); setThreads(data || []); };
  const loadMsgs = async (id) => { if (!id) { setMsgs([]); return; } const { data } = await supabase.from("sms_messages").select("*").eq("thread_id", id).order("id"); setMsgs(data || []); };
  const loadRoster = async () => { const { data } = await supabase.from("dssc_pod_roster").select("*"); setRoster(data || []); };
  const loadConsents = async () => { const { data } = await supabase.from("sms_consents").select("*").eq("brand", "dssc"); setConsents(data || []); };
  useEffect(() => { loadThreads(); loadRoster(); loadConsents(); fetch("/api/send-sms", { method: "OPTIONS" }).catch(() => {}); }, []);
  useEffect(() => { loadMsgs(selId); }, [selId]);
  useEffect(() => {
    const ch = supabase.channel("dssc-sms").on("postgres_changes", { event: "*", schema: "public", table: "sms_messages" }, () => { loadThreads(); if (selId) loadMsgs(selId); }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [selId]);
  useEffect(() => {
    if (!initial) return;
    setSelId(null);
    setComposer({ scope: initial.sessionId ? "class" : "program", clinicId: initial.clinicId || "", sessionId: initial.sessionId || "", category: "", age: "", who: "families", includeUnconsented: false, body: "", media: [], result: null });
    onConsumedInitial && onConsumedInitial();
  }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Who could be texted ─────────────────────────────────────────────────
  const consented = useMemo(() => new Set(consents.map(c => last10(c.phone))), [consents]);
  // A DS Elite family on a DSSC roster: reuse the phone we already have by email.
  const dsePhoneByEmail = useMemo(() => { const m = new Map(); for (const p of players) for (const e of [p.parent_email, p.parent_email2, p.parent_email3]) { const k = nrm(e); if (k && !m.has(k) && p.parent_phone) m.set(k, { phone: p.parent_phone, name: p.parent_name }); } return m; }, [players]);
  const clinicById = useMemo(() => new Map(clinics.map(c => [c.id, c])), [clinics]);
  const upcomingClinics = useMemo(() => clinics.filter(c => (c.sessions || []).some(s => s.date >= today)).sort((a, b) => a.name.localeCompare(b.name)), [clinics, today]);
  const ages = useMemo(() => [...new Set(clinics.map(c => c.age_group).filter(Boolean))].sort(), [clinics]);

  const buildAudience = (c) => {
    const out = [], skipped = [];
    const push = (phone, name, extra) => {
      const to = e164(phone);
      if (!to) { if (name) skipped.push({ name, reason: "no phone" }); return; }
      if (out.some(x => x.to === to)) return;
      out.push({ to, name, consent: consented.has(last10(to)) || !!extra.rosterConsent, ...extra });
    };
    if (c.scope === "coaches") {
      const pool = new Set(dsscAvail.filter(a => a.available).map(a => nrm(a.coach_name)));
      for (const r of coachRoster) { const full = ((r.first_name || "") + " " + (r.last_name || "")).trim(); if (full && pool.has(nrm(full))) push(r.phone, full, { kind: "coach" }); }
      return { ready: out, held: [], skipped };
    }
    let rows = roster;
    if (c.scope === "program" || c.scope === "class") rows = rows.filter(r => String(r.clinic_id) === String(c.clinicId) && (c.scope === "program" || !r.session_id || String(r.session_id) === String(c.sessionId)));
    if (c.scope === "category") rows = rows.filter(r => catOf(clinicById.get(r.clinic_id)) === c.category);
    if (c.scope === "age") rows = rows.filter(r => clinicById.get(r.clinic_id)?.age_group === c.age);
    if (c.scope !== "class") rows = rows.filter(r => { const cl = clinicById.get(r.clinic_id); return cl && (cl.sessions || []).some(s => s.date >= today); });   // current programs only
    for (const r of rows) {
      const cl = clinicById.get(r.clinic_id);
      const fallback = !r.parent_phone && r.parent_email ? dsePhoneByEmail.get(nrm(r.parent_email)) : null;
      push(r.parent_phone || fallback?.phone, r.parent_name || fallback?.name || (r.player_name + "'s parent"), { kind: "parent", dssc_program: cl?.name || null, dssc_player: r.player_name, rosterConsent: !!r.sms_consent, via: fallback ? "DS Elite roster" : null });
    }
    const gated = !c.includeUnconsented;
    return { ready: out.filter(x => !gated || x.consent), held: gated ? out.filter(x => !x.consent) : [], skipped };
  };

  const send = async (payload) => {
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch("/api/send-sms", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (session?.access_token || "") }, body: JSON.stringify({ brand: "dssc", sent_by_coach_id: coach?.id || null, sent_by_label: me, ...payload }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) return { error: d.error || r.statusText };
    return d;
  };
  const uploadMedia = async (files) => {
    const list = [...(files || [])].filter(f => f.type.startsWith("image/")).slice(0, 5);
    for (const f of list) {
      const path = `broadcast/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${(f.name.split(".").pop() || "jpg").toLowerCase()}`;
      const up = await supabase.storage.from("dssc-media").upload(path, f, { contentType: f.type });
      if (up.error) { window.alert(f.name + ": " + up.error.message); continue; }
      const url = supabase.storage.from("dssc-media").getPublicUrl(path).data.publicUrl;
      setComposer(c => c ? { ...c, media: [...c.media, { url, name: f.name }] } : c);
    }
    if (fileRef.current) fileRef.current.value = "";
  };
  const addConsents = async () => {
    const rows = [];
    for (const l of consentPaste.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
      const m = /(\+?1?[\s(.-]*\d{3}[\s).-]*\d{3}[\s.-]*\d{4})/.exec(l); if (!m) continue;
      const phone = e164(m[1]); if (!phone) continue;
      rows.push({ phone, brand: "dssc", name: l.replace(m[1], "").replace(/^[\s,;:|-]+|[\s,;:|-]+$/g, "").trim() || null, source: "pasted", added_by: me });
    }
    if (!rows.length) { window.alert("No phone numbers found — one per line, name after the number."); return; }
    const { error } = await supabase.from("sms_consents").upsert(rows, { onConflict: "phone,brand" });
    if (error) { window.alert(error.message); return; }
    setConsentPaste(""); loadConsents();
  };

  // ── Inbox grouping ──────────────────────────────────────────────────────
  const groupOf = (t) => t.contact_kind === "coach" ? "Coaches" : (t.dssc_program || "Other");
  const labelOf = (t) => (t.contact_name || fmtPhone(t.phone)) + (t.dssc_player ? " · " + t.dssc_player.split(" ")[0] : "");
  const sections = useMemo(() => { const m = new Map(); for (const t of threads) { const g = groupOf(t); if (!m.has(g)) m.set(g, []); m.get(g).push(t); } return [...m.entries()].sort((a, b) => (a[0] === "Other") - (b[0] === "Other") || a[0].localeCompare(b[0])); }, [threads]);
  const selected = threads.find(t => t.id === selId) || null;
  const totalUnread = threads.reduce((n, t) => n + (t.unread_count || 0), 0);
  const markRead = async (id) => { await supabase.from("sms_threads").update({ unread_count: 0 }).eq("id", id); loadThreads(); };

  const openComposer = (scope) => { setSelId(null); setComposer({ scope, clinicId: upcomingClinics[0]?.id || "", sessionId: "", category: "Pods", age: ages[0] || "", who: "families", includeUnconsented: false, body: "", media: [], result: null }); };
  const shell = (inner) => (
    <div style={{ margin: "-14px -18px", padding: "16px 16px 30px", background: DS.bg, minHeight: "calc(100vh - 56px)", fontFamily: DS.font, color: DS.text }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <img src="/dssc/logo-horizontal-white.png" alt="Dripping Springs Sports Club" style={{ height: 30 }} />
          <Tag color={DS.lime}>Texts</Tag>
          <span style={{ fontSize: 12, color: DS.mut }}>{threads.length} conversation{threads.length === 1 ? "" : "s"}{totalUnread ? ` · ${totalUnread} unread` : ""} · {consents.length} opt-in{consents.length === 1 ? "" : "s"}</span>
          <div style={{ flex: 1 }} />
          <Btn small kind="primary" onClick={() => openComposer("program")}>+ Text a program</Btn>
          <Btn small onClick={() => openComposer("class")}>+ Text a class</Btn>
          <Btn small onClick={() => openComposer("everyone")}>+ Everyone</Btn>
          <Btn small onClick={() => openComposer("category")}>+ By category</Btn>
          <Btn small onClick={() => openComposer("age")}>+ By age</Btn>
          <Btn small onClick={() => openComposer("coaches")}>+ Coaches</Btn>
        </div>
        {inner}
      </div>
    </div>
  );

  return shell(
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 14, height: "calc(100vh - 150px)" }}>
      {/* Inbox */}
      <div style={{ background: DS.panel, border: "1px solid " + DS.line, borderRadius: 14, overflowY: "auto" }}>
        {!threads.length && <div style={{ padding: 20, fontSize: 12, color: DS.mut, textAlign: "center" }}>No conversations yet. Text a program or a class to start one per family.</div>}
        {sections.map(([g, list]) => {
          const unread = list.reduce((n, t) => n + (t.unread_count || 0), 0), isF = folded.has(g);
          return (
            <div key={g}>
              <div onClick={() => setFolded(f => { const n = new Set(f); n.has(g) ? n.delete(g) : n.add(g); return n; })} style={{ padding: "7px 12px", borderBottom: "1px solid " + DS.line, background: "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", position: "sticky", top: 0 }}>
                <span style={{ fontSize: 10, color: DS.mut }}>{isF ? "›" : "⌄"}</span><span style={{ fontSize: 12, fontWeight: 800, color: unread ? DS.lime : DS.text }}>{g}</span><span style={{ fontSize: 10, color: DS.mut }}>{list.length}</span><div style={{ flex: 1 }} />{unread > 0 && <Tag color={DS.lime} fill>{unread} new</Tag>}
              </div>
              {!isF && list.map(t => (
                <div key={t.id} onClick={() => { setComposer(null); setSelId(t.id); if (t.unread_count) markRead(t.id); }} style={{ padding: "8px 12px 8px 22px", borderBottom: "1px solid " + DS.line, cursor: "pointer", background: t.id === selId ? DS.limeSoft : t.unread_count ? "rgba(178,208,73,0.06)" : "transparent" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}><span style={{ fontSize: 13, fontWeight: 700, color: t.unread_count ? DS.lime : DS.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{labelOf(t)}</span><span style={{ fontSize: 10, color: DS.mut, whiteSpace: "nowrap" }}>{fmtWhen(t.last_message_at)}</span></div>
                  <div style={{ fontSize: 11, color: DS.mut, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.last_message_direction === "outbound" && <span style={{ color: DS.lime }}>→ </span>}{t.last_message_preview || <i>(no messages yet)</i>}</div>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Right pane */}
      <div style={{ background: DS.panel, border: "1px solid " + DS.line, borderRadius: 14, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {composer && (() => {
          const c = composer, set = (p) => setComposer(x => ({ ...x, ...p }));
          const aud = buildAudience(c);
          const cl = clinicById.get(Number(c.clinicId));
          const sessions = (cl?.sessions || []).filter(s => s.date >= today).sort((a, b) => a.date.localeCompare(b.date));
          const label = c.scope === "everyone" ? "everyone in current programs" : c.scope === "program" ? (cl?.name || "a program") : c.scope === "class" ? `${cl?.name || "a class"} · ${sessions.find(s => String(s.id) === String(c.sessionId)) ? fmtDay(sessions.find(s => String(s.id) === String(c.sessionId)).date, today) : "pick a class"}` : c.scope === "category" ? c.category : c.scope === "age" ? c.age : "DSSC coaches";
          const canSend = (c.body.trim() || c.media.length) && aud.ready.length > 0 && !sending && !c.result;
          const go = async () => {
            if (!canSend) return;
            if (!window.confirm(`Send to ${aud.ready.length} number${aud.ready.length === 1 ? "" : "s"} (${label})? Each person gets their own one-to-one text from the club number.`)) return;
            setSending(true);
            const r = await send({ recipients: aud.ready.map(x => ({ to: x.to, name: x.name, kind: x.kind, dssc_program: x.dssc_program || null, dssc_player: x.dssc_player || null })), body: c.body.trim(), media_urls: c.media.map(m => m.url), audience: { type: c.scope, clinic_id: c.clinicId || null, session_id: c.sessionId || null, category: c.category || null, age: c.age || null, include_unconsented: !!c.includeUnconsented, label } });
            setSending(false); set({ result: r }); loadThreads();
          };
          return (<>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid " + DS.line, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 15, fontWeight: 800 }}>Text {label}</div><div style={{ flex: 1 }} /><Btn small onClick={() => setComposer(null)}>Close</Btn>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <select value={c.scope} onChange={e => set({ scope: e.target.value, result: null })} style={{ ...inputStyle, width: "auto", padding: "6px 9px", fontSize: 13 }}>
                  {[["program", "A program"], ["class", "One class"], ["everyone", "Everyone (current programs)"], ["category", "By category"], ["age", "By age group"], ["coaches", "DSSC coaches"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                {(c.scope === "program" || c.scope === "class") && <select value={c.clinicId} onChange={e => set({ clinicId: e.target.value, sessionId: "", result: null })} style={{ ...inputStyle, width: "auto", padding: "6px 9px", fontSize: 13, maxWidth: 320 }}>{upcomingClinics.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
                {c.scope === "class" && <select value={c.sessionId} onChange={e => set({ sessionId: e.target.value, result: null })} style={{ ...inputStyle, width: "auto", padding: "6px 9px", fontSize: 13 }}><option value="">— pick the class —</option>{sessions.map(s => <option key={s.id} value={s.id}>{fmtDay(s.date, today)} {s.start_time || ""}</option>)}</select>}
                {c.scope === "category" && <select value={c.category} onChange={e => set({ category: e.target.value, result: null })} style={{ ...inputStyle, width: "auto", padding: "6px 9px", fontSize: 13 }}>{["Pods", "Clinics", "Camps", "Adult"].map(k => <option key={k}>{k}</option>)}</select>}
                {c.scope === "age" && <select value={c.age} onChange={e => set({ age: e.target.value, result: null })} style={{ ...inputStyle, width: "auto", padding: "6px 9px", fontSize: 13 }}>{ages.map(k => <option key={k}>{k}</option>)}</select>}
                <span style={{ fontSize: 12, color: DS.mut }}><b style={{ color: DS.lime }}>{aud.ready.length}</b> will get it{aud.held.length > 0 && <> · <b style={{ color: DS.orange }}>{aud.held.length}</b> held (no opt-in)</>}{aud.skipped.length > 0 && <> · {aud.skipped.length} no phone</>}</span>
              </div>
              {c.scope !== "coaches" && (
                <div style={{ fontSize: 12, color: DS.mut, lineHeight: 1.5, background: DS.panel2, border: "1px solid " + DS.line, borderRadius: 10, padding: "8px 10px" }}>
                  Goes to numbers with a recorded opt-in — the <b style={{ color: DS.text }}>/dssc-texts</b> form, or a DS Elite family whose number we already have. {aud.held.length > 0 && <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, cursor: "pointer", color: DS.orange, fontWeight: 700 }}><input type="checkbox" checked={!!c.includeUnconsented} onChange={e => set({ includeUnconsented: e.target.checked, result: null })} /> Include the {aud.held.length} without a recorded opt-in</label>}
                </div>
              )}
              <textarea value={c.body} onChange={e => set({ body: e.target.value })} rows={5} placeholder={"Type the message everyone in " + label + " should get… (it comes from the club number; replies land here)"} style={{ ...inputStyle, resize: "vertical" }} />
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => uploadMedia(e.target.files)} />
                <Btn small onClick={() => fileRef.current?.click()}>📷 Attach photo</Btn>
                {c.media.map(m => <span key={m.url} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "3px 8px", borderRadius: 8, border: "1px solid " + DS.line }}><img src={m.url} alt="" style={{ height: 22, borderRadius: 4 }} />{m.name}<button onClick={() => set({ media: c.media.filter(x => x.url !== m.url) })} style={{ background: "none", border: "none", color: DS.mut, cursor: "pointer" }}>✕</button></span>)}
                <span style={{ fontSize: 11, color: DS.mut }}>{c.body.length} chars · {segments(c.body)} segment{segments(c.body) === 1 ? "" : "s"}{c.media.length ? " · MMS" : ""}</span>
                <div style={{ flex: 1 }} />
                <Btn kind="primary" disabled={!canSend} onClick={go}>{sending ? "Sending…" : `Send to ${aud.ready.length}`}</Btn>
              </div>
              {c.result && <div style={{ border: "1px solid " + (c.result.error || c.result.failed?.length ? DS.orange : DS.lime), borderRadius: 10, padding: "10px 12px", fontSize: 13 }}>{c.result.error ? <span style={{ color: DS.orange, fontWeight: 700 }}>{c.result.error}</span> : <><b style={{ color: DS.lime }}>Sent to {c.result.sent}</b>{c.result.failed?.length > 0 && <div style={{ color: DS.orange, marginTop: 4 }}>{c.result.failed.length} failed: {c.result.failed.map(f => (f.name || f.to) + " (" + f.error + ")").join("; ")}</div>}<div style={{ color: DS.mut, marginTop: 4 }}>Replies show up on the left, one thread per family.</div></>}</div>}
              <details><summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Recipients ({aud.ready.length}){aud.held.length ? ` · held (${aud.held.length})` : ""}{aud.skipped.length ? ` · no phone (${aud.skipped.length})` : ""}</summary>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 6, fontSize: 12 }}>
                  {aud.ready.map(x => <div key={x.to} style={{ display: "flex", gap: 8 }}><span style={{ minWidth: 180 }}>{x.name}</span><span style={{ color: DS.mut }}>{fmtPhone(x.to)}</span>{x.dssc_player && <span style={{ color: DS.mut }}>{x.dssc_player}</span>}{x.via && <Tag color={DS.mut}>{x.via}</Tag>}</div>)}
                  {aud.held.map(x => <div key={x.to} style={{ display: "flex", gap: 8, opacity: .7 }}><span style={{ minWidth: 180 }}>{x.name}</span><span style={{ color: DS.mut }}>{fmtPhone(x.to)}</span><Tag color={DS.orange}>no opt-in</Tag></div>)}
                  {aud.skipped.map((x, i) => <div key={i} style={{ display: "flex", gap: 8, opacity: .6 }}><span style={{ minWidth: 180 }}>{x.name}</span><Tag color={DS.mut}>{x.reason}</Tag></div>)}
                </div>
              </details>
              <details><summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Record opt-ins ({consents.length} on file)</summary>
                <div style={{ fontSize: 12, color: DS.mut, margin: "6px 0" }}>Families opt in at <b style={{ color: DS.text }}>dseliteevals.vercel.app/dssc-texts</b>. Got them another way (a paper form, a text reply)? Paste numbers here, one per line, name after the number.</div>
                <textarea value={consentPaste} onChange={e => setConsentPaste(e.target.value)} rows={3} placeholder={"512-555-0100 Jamie Smith"} style={{ ...inputStyle, resize: "vertical" }} />
                <div style={{ marginTop: 6 }}><Btn small disabled={!consentPaste.trim()} onClick={addConsents}>Add opt-ins</Btn></div>
              </details>
            </div>
          </>);
        })()}
        {!composer && !selected && <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: DS.mut, fontSize: 13, padding: 20, textAlign: "center" }}>Pick a conversation, or start a text with the buttons above.</div>}
        {!composer && selected && (<>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid " + DS.line }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><div style={{ fontSize: 15, fontWeight: 800 }}>{selected.contact_name || fmtPhone(selected.phone)}</div>{selected.dssc_player && <Tag color={DS.lime}>{selected.dssc_player}</Tag>}{selected.dssc_program && <Tag color={DS.mut}>{selected.dssc_program}</Tag>}{selected.contact_kind === "coach" && <Tag color={DS.mut}>coach</Tag>}</div>
            <div style={{ fontSize: 12, color: DS.mut, marginTop: 2 }}>{fmtPhone(selected.phone)}</div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            {msgs.map(m => { const out = m.direction === "outbound"; return (
              <div key={m.id} style={{ display: "flex", justifyContent: out ? "flex-end" : "flex-start" }}>
                <div style={{ maxWidth: "75%", padding: "8px 12px", borderRadius: 14, background: out ? DS.limeSoft : "rgba(255,255,255,0.06)", border: "1px solid " + (out ? DS.lime : DS.line), fontSize: 13, lineHeight: 1.4 }}>
                  {(m.media_urls || []).map(u => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" style={{ maxWidth: 220, borderRadius: 8, display: "block", marginBottom: 6 }} /></a>)}
                  <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.body}</div>
                  <div style={{ fontSize: 10, color: DS.mut, marginTop: 4, textAlign: out ? "right" : "left" }}>{fmtWhen(m.sent_at || m.created_at)}{out && m.status && <span style={{ marginLeft: 6, fontWeight: 700, color: m.status === "delivered" ? DS.lime : m.status === "failed" ? DS.orange : DS.mut }}>· {m.status}</span>}{out && m.sent_by_label && <span style={{ marginLeft: 6 }}>· {m.sent_by_label}</span>}{out && m.broadcast_id && <span style={{ marginLeft: 6 }}>· 📣 group</span>}</div>
                </div>
              </div>); })}
            {!msgs.length && <div style={{ textAlign: "center", color: DS.mut, fontSize: 12, padding: 20 }}>No messages yet.</div>}
          </div>
          <div style={{ borderTop: "1px solid " + DS.line, padding: "10px 14px", display: "flex", gap: 8, alignItems: "flex-end" }}>
            <textarea value={reply} onChange={e => setReply(e.target.value)} rows={2} placeholder="Type a reply…" onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); } }} style={{ ...inputStyle, flex: 1, resize: "vertical", minHeight: 40, maxHeight: 140 }} />
            <Btn kind="primary" disabled={sending || !reply.trim()} onClick={async () => { setSending(true); const r = await send({ to: selected.phone, body: reply.trim(), contact_name: selected.contact_name, dssc_program: selected.dssc_program, dssc_player: selected.dssc_player, contact_kind: selected.contact_kind }); setSending(false); if (r.error) window.alert(r.error); else { setReply(""); loadMsgs(selected.id); loadThreads(); } }}>{sending ? "…" : "Send"}</Btn>
          </div>
        </>)}
      </div>
    </div>
  );
}
