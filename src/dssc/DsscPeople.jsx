// DSSC Coaches & Staff (Drew, 13 Oct 2026) - add basketball coaches, interns
// and DSSC administrators with just the basics. Adding someone lets them make
// a login at www.drippingsportsclub.com/hq (pre-approved, DSSC-only); "Invite"
// emails/texts them the link. Server side: api/dssc-people.js.

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabase";
import { DS, Btn, Card, Label, Tag, inputStyle } from "./DsscHub.jsx";

const ROLE_LABEL = { admin: "Administrator", coach: "Coach", staff: "Staff / intern" };
const ROLE_HELP = {
  admin: "Sees who's coaching, assigns coaches, fixes clock-ins, approves hours.",
  coach: "Their classes and players, clock in, message families, recaps.",
  staff: "Clock in / clock out with what they worked on.",
};
const blank = { email: "", first_name: "", last_name: "", phone: "", role: "coach", sports: ["basketball"], notes: "" };

async function call(body) {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch("/api/dssc-people", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (session?.access_token || "") }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
  return d;
}

export default function DsscPeople() {
  const [people, setPeople] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const [filter, setFilter] = useState("bb");
  const load = useCallback(async () => { try { const d = await call({ action: "list" }); setPeople(d.people || []); } catch (e) { setMsg({ err: e.message }); } }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy("save"); setMsg(null);
    try { await call({ action: "save", person: form }); setMsg({ ok: `${form.first_name} saved - they can now sign up at drippingsportsclub.com/hq with ${form.email}.` }); setForm(null); await load(); }
    catch (e) { setMsg({ err: e.message }); }
    setBusy("");
  };
  const act = async (p, action, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(action + p.id); setMsg(null);
    try {
      const d = await call({ action, id: p.id });
      if (action === "invite") setMsg({ ok: `Invite sent to ${p.first_name}${d.sent ? ` (${[d.sent.email && "email", d.sent.text && "text"].filter(Boolean).join(" + ") || "nothing went - check the email"})` : ""}.` });
      await load();
    } catch (e) { setMsg({ err: e.message }); }
    setBusy("");
  };
  const toggleSport = (s) => setForm(f => ({ ...f, sports: f.sports.includes(s) ? f.sports.filter(x => x !== s) : [...f.sports, s] }));
  // "Basketball coaches" is the list basketball classes are staffed from - nobody else can be put on one.
  const shown = (people || []).filter(p => filter === "all" ? p.active : filter === "inactive" ? !p.active : filter === "bb" ? p.active && p.role === "coach" && (p.sports || []).includes("basketball") : p.active && p.role === filter);

  return (
    <div style={{ margin: "-14px -18px", padding: "16px 16px 48px", background: DS.bg, minHeight: "calc(100vh - 56px)", fontFamily: DS.font, color: DS.text }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
          <div style={{ fontSize: 24, fontWeight: 800 }}>Coaches & staff</div>
          <div style={{ flex: 1 }} />
          {!form && <Btn kind="primary" onClick={() => setForm({ ...blank })}>+ Add a person</Btn>}
        </div>
        <div style={{ fontSize: 13, color: DS.mut, marginBottom: 14 }}>Basketball coaches, interns and DSSC administrators who aren't part of DS Elite. Basketball classes can only be staffed from the basketball coaches here, and a basketball-only coach is never offered for volleyball. DS Elite's volleyball coaches are already set up and don't need adding.</div>

        {form && (
          <Card accent={DS.lime}>
            <Label>{form.id ? "Edit " + form.first_name : "Add a person"}</Label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
              <input value={form.first_name} onChange={e => setForm({ ...form, first_name: e.target.value })} placeholder="First name *" style={inputStyle} />
              <input value={form.last_name || ""} onChange={e => setForm({ ...form, last_name: e.target.value })} placeholder="Last name" style={inputStyle} />
              <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="Email * (their login)" type="email" style={inputStyle} disabled={!!form.id} />
              <input value={form.phone || ""} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Cell (for reminder texts)" type="tel" style={inputStyle} />
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "12px 0 4px" }}>
              {["coach", "staff", "admin"].map(r => (
                <button key={r} onClick={() => setForm({ ...form, role: r })} style={{ fontFamily: DS.font, fontSize: 13, fontWeight: 700, padding: "7px 13px", borderRadius: 999, cursor: "pointer", border: "1px solid " + (form.role === r ? DS.lime : DS.line), background: form.role === r ? DS.limeSoft : "transparent", color: form.role === r ? DS.lime : DS.mut }}>{ROLE_LABEL[r]}</button>
              ))}
            </div>
            <div style={{ fontSize: 12, color: DS.mut, marginBottom: 10 }}>{ROLE_HELP[form.role]}</div>
            {form.role !== "staff" && (
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: DS.mut }}>{form.role === "admin" ? "Oversees:" : "Coaches:"}</span>
                {["basketball", "volleyball"].map(s => (
                  <label key={s} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, cursor: "pointer" }}><input type="checkbox" checked={form.sports.includes(s)} onChange={() => toggleSport(s)} /> {s[0].toUpperCase() + s.slice(1)}</label>
                ))}
              </div>
            )}
            <input value={form.notes || ""} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Notes (optional)" style={{ ...inputStyle, marginBottom: 10 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <Btn kind="primary" disabled={busy === "save"} onClick={save}>{busy === "save" ? "Saving…" : "Save"}</Btn>
              <Btn kind="quiet" onClick={() => setForm(null)}>Cancel</Btn>
            </div>
          </Card>
        )}
        {msg?.ok && <div style={{ color: DS.lime, fontWeight: 700, fontSize: 13, margin: "0 0 12px" }}>{msg.ok}</div>}
        {msg?.err && <div style={{ color: DS.orange, fontWeight: 700, fontSize: 13, margin: "0 0 12px" }}>{msg.err}</div>}

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {[["all", "Everyone"], ["bb", "🏀 Basketball coaches"], ["coach", "All coaches"], ["staff", "Staff"], ["admin", "Administrators"], ["inactive", "Inactive"]].map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} style={{ fontFamily: DS.font, fontSize: 12, fontWeight: 700, padding: "5px 11px", borderRadius: 999, cursor: "pointer", border: "1px solid " + (filter === k ? DS.lime : DS.line), background: "transparent", color: filter === k ? DS.lime : DS.mut }}>{l}</button>
          ))}
        </div>
        {people == null ? <div style={{ color: DS.mut }}>Loading…</div> : !shown.length ? <Card><div style={{ color: DS.mut, fontSize: 13 }}>Nobody here yet.</div></Card> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {shown.map(p => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 14px", borderRadius: 12, background: DS.panel, border: "1px solid " + DS.line, opacity: p.active ? 1 : 0.6 }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 15, fontWeight: 800 }}>{p.first_name} {p.last_name || ""}</div>
                  <div style={{ fontSize: 12, color: DS.mut, marginTop: 2 }}>{p.email}{p.phone ? " · " + p.phone : ""}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                    <Tag color={p.role === "admin" ? DS.orange : DS.lime}>{ROLE_LABEL[p.role] || p.role}</Tag>
                    {(p.sports || []).map(s => <Tag key={s} color={DS.mut}>{s}</Tag>)}
                    {p.ds_elite && <Tag color={DS.mut}>also DS Elite</Tag>}
                    {p.login ? <Tag color={DS.lime}>Has a login{p.login.last_seen_at ? " · seen " + new Date(p.login.last_seen_at).toLocaleDateString() : ""}</Tag> : <Tag color={DS.dim}>{p.invited_at ? "Invited " + new Date(p.invited_at).toLocaleDateString() : "No login yet"}</Tag>}
                  </div>
                </div>
                {p.active && <Btn small onClick={() => act(p, "invite", `Email${p.phone ? " and text" : ""} ${p.first_name} the DSSC HQ link?`)} disabled={busy === "invite" + p.id}>{busy === "invite" + p.id ? "…" : p.invited_at ? "Re-invite" : "Invite"}</Btn>}
                {p.active && <Btn small kind="quiet" onClick={() => setForm({ ...blank, ...p, sports: p.sports || [] })}>Edit</Btn>}
                {p.active ? <Btn small kind="quiet" style={{ color: DS.orange }} onClick={() => act(p, "deactivate", `Deactivate ${p.first_name}? ${p.ds_elite ? "They keep DS Elite access." : "Their DSSC login stops working."}`)}>Deactivate</Btn>
                  : <Btn small kind="quiet" onClick={() => act(p, "reactivate")}>Reactivate</Btn>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
