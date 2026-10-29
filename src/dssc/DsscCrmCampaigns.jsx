// DSSC People -> Campaigns. Audience + goal + offer -> Claude writes the steps
// -> they go on the Marketing calendar as drafts to approve -> results (who
// booked within 45 days, and what they spent). api/crm-campaigns.js and
// api/_lib/crm-campaigns.js do the work; audience counts here come from the
// same engine (shared/crm-segments.js), so they match what's sent.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { DS, Btn, Card, Label, Tag, inputStyle } from "./DsscHub.jsx";
import { EMPTY_SEGMENT, resolveSegment, resolveSegmentPhones, describeSegment } from "../../shared/crm-segments.js";
import { GOALS, OFFER_KINDS, offerText } from "../../shared/crm-ideas.js";
import { LINES, lineUrl } from "../../shared/marketing-plan.js";
import { SMART_SEGMENTS } from "./DsscCrmSegments.jsx";

const api = async (action, body = {}) => {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch("/api/crm-campaigns", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (session?.access_token || "") }, body: JSON.stringify({ action, ...body }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || r.statusText);
  return d;
};
const ymd = (d) => d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const addDays = (s, n) => new Date(Date.parse(s + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const fmtD = (iso) => iso ? new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
const money = (c) => "$" + Math.round((c || 0) / 100).toLocaleString();
const CADENCE = [["one", "1 email"], ["two", "Email, then a text to those who haven't booked (day 3)"], ["three", "Email · text day 3 · last-call email day 7"], ["text", "1 text"]];
const STATUS = { draft: [DS.mut, "Draft"], scheduled: ["#7FD1C3", "On the calendar"], live: [DS.lime, "Live"], done: [DS.lime, "Done"], cancelled: [DS.dim, "Cancelled"] };
const sel = { ...inputStyle, width: "auto", padding: "6px 9px", fontSize: 13 };
const chip = (on, color = DS.lime) => ({ fontFamily: DS.font, fontSize: 12.5, fontWeight: 800, padding: "5px 11px", borderRadius: 999, cursor: "pointer", border: "1px solid " + (on ? color : DS.lineStrong), background: on ? color : "transparent", color: on ? DS.bg : DS.text });

const blank = () => ({ id: null, name: "", goal: "winback", segment: { ...EMPTY_SEGMENT }, label: "", offer: { kind: "percent", value: 50, applies_to: "your next class", code: "", expires: addDays(ymd(new Date()), 21), url: "", line: "" }, channels: ["email", "text"], cadence: "two", starts_on: addDays(ymd(new Date()), 1), notes: "", steps: [] });
const fromPrefill = (p) => {
  const b = blank();
  if (p?.idea) { const i = p.idea; Object.assign(b, { goal: i.goal, segment: p.segment || i.segment, label: p.label ? `${i.title} · ${p.label}` : i.title, offer: { ...b.offer, ...i.offer, line: "" }, channels: i.channels, cadence: i.channels.length > 1 ? "two" : i.channels[0] === "text" ? "text" : "one", name: i.title, idea_key: i.key }); }
  else if (p?.segment) Object.assign(b, { segment: p.segment, label: p.label || describeSegment(p.segment) });
  return b;
};

export default function DsscCrmCampaigns({ index, ideas, prefill, onPeople, onOpenMarketing }) {
  const [list, setList] = useState(null);
  const [err, setErr] = useState("");
  const [c, setC] = useState(null);          // the campaign being built
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(null);    // results shown for this id
  const [results, setResults] = useState({});
  const load = () => api("list").then(d => setList(d.campaigns)).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => { if (prefill) { setC(fromPrefill(prefill)); setMsg(""); } }, [prefill?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const aud = useMemo(() => {
    if (!index || !c) return null;
    const e = resolveSegment(index, c.segment), t = resolveSegmentPhones(index, c.segment);
    return { families: e.matched, emailable: e.recipients.length, textable: t.recipients.length };
  }, [index, c?.segment]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (label, fn) => { setBusy(label); setErr(""); try { await fn(); } catch (e) { setErr(e.message); } setBusy(""); };
  const set = (patch) => setC(x => ({ ...x, ...patch }));
  const setOffer = (patch) => setC(x => ({ ...x, offer: { ...x.offer, ...patch } }));
  const setStep = (i, patch) => setC(x => ({ ...x, steps: x.steps.map((s, k) => k === i ? { ...s, ...patch } : s) }));
  const payload = () => ({ id: c.id || undefined, name: c.name || c.label || "Campaign", goal: c.goal, segment: c.segment, offer: c.offer, channels: c.channels, steps: c.steps, starts_on: c.starts_on, notes: c.notes, idea_key: c.idea_key || null });
  const write = () => run("write", async () => {
    const d = await api("draft", { campaign: { ...payload(), cadence: c.cadence, audience_notes: c.label } });
    set({ steps: d.steps, name: c.name || d.name });
    setMsg(d.error ? `Claude couldn't write it (${d.error}) - here's plain template copy to edit.` : "");
  });
  const save = (andSchedule) => run(andSchedule ? "schedule" : "save", async () => {
    const d = await api("save", { campaign: payload() });
    let camp = d.campaign;
    if (andSchedule) camp = (await api("schedule", { id: camp.id, starts_on: c.starts_on })).campaign;
    set({ id: camp.id });
    await load();
    if (andSchedule) { setC(null); setMsg(`✓ "${camp.name}" is on the Marketing calendar as ${camp.item_ids.length} draft${camp.item_ids.length === 1 ? "" : "s"}, starting ${fmtD(camp.starts_on)}. Approve them in Marketing.${camp.offer?.code ? ` Create code ${camp.offer.code} in Playbook before the first one goes out.` : ""}`); }
  });
  const showResults = (camp) => { if (open === camp.id) { setOpen(null); return; } setOpen(camp.id); if (!results[camp.id]) api("results", { id: camp.id }).then(d => setResults(r => ({ ...r, [camp.id]: d.results }))).catch(e => setResults(r => ({ ...r, [camp.id]: { error: e.message } }))); };
  const edit = (camp) => setC({ ...blank(), ...camp, label: camp.audience_label || describeSegment(camp.segment), cadence: camp.steps?.length >= 3 ? "three" : camp.steps?.length === 2 ? "two" : camp.steps?.[0]?.channel === "text" ? "text" : "one" });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 14 }}>
      {err && <Card accent={DS.orange}><span style={{ color: DS.orange }}>{err}</span></Card>}
      {msg && !c && <Card accent={DS.lime}><span style={{ color: DS.lime, fontWeight: 700 }}>{msg}</span> {onOpenMarketing && <Btn small kind="link" onClick={onOpenMarketing}>Open Marketing →</Btn>}</Card>}
      {!c && <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Btn kind="primary" onClick={() => { setC(blank()); setMsg(""); }}>+ New campaign</Btn>
        <span style={{ fontSize: 12, color: DS.mut }}>or start from an idea:</span>
        {ideas.slice(0, 5).map(i => <button key={i.key} onClick={() => setC(fromPrefill({ idea: i }))} style={chip(false)}>{i.emoji} {i.title}</button>)}
      </div>}

      {c && <Card accent={DS.lime}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <input value={c.name} onChange={e => set({ name: e.target.value })} placeholder="Campaign name" style={{ ...inputStyle, fontSize: 18, fontWeight: 900, flex: 1 }} />
          <Btn small onClick={() => setC(null)}>Close</Btn>
        </div>

        <Label>1 · Who</Label>
        <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <span style={{ fontSize: 26, fontWeight: 900, color: DS.lime }}>{aud ? aud.families.toLocaleString() : "…"}</span>
          <span style={{ fontSize: 13 }}>families · {aud?.emailable.toLocaleString() ?? "…"} by email · {aud?.textable.toLocaleString() ?? "…"} by text</span>
          <Btn small kind="link" onClick={() => onPeople(c.segment, c.label || describeSegment(c.segment))}>see them</Btn>
        </div>
        <div style={{ fontSize: 13, color: DS.mut, margin: "2px 0 8px" }}>{c.label || describeSegment(c.segment)}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: DS.mut, alignSelf: "center" }}>Change to:</span>
          {SMART_SEGMENTS.map(([k, l, s]) => <button key={k} onClick={() => set({ segment: { ...EMPTY_SEGMENT, ...s }, label: l })} style={chip(false, "#7FD1C3")}>{l}</button>)}
          {ideas.slice(0, 8).map(i => <button key={i.key} onClick={() => set({ segment: i.segment, label: i.title })} style={chip(false, "#7FD1C3")}>{i.emoji} {i.title}</button>)}
        </div>

        <Label>2 · Goal and offer</Label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>{GOALS.map(([k, l]) => <button key={k} onClick={() => set({ goal: k })} style={chip(c.goal === k)}>{l}</button>)}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={c.offer.kind} onChange={e => setOffer({ kind: e.target.value })} style={sel}>{OFFER_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          {["percent", "dollars"].includes(c.offer.kind) && <input type="number" min="0" value={c.offer.value ?? ""} onChange={e => setOffer({ value: e.target.value })} style={{ ...sel, width: 80 }} placeholder={c.offer.kind === "percent" ? "%" : "$"} />}
          {c.offer.kind === "custom" ? <input value={c.offer.text || ""} onChange={e => setOffer({ text: e.target.value })} placeholder='e.g. "book 4 privates, get the 4th half price"' style={{ ...sel, width: 320 }} />
            : c.offer.kind !== "none" && <input value={c.offer.applies_to || ""} onChange={e => setOffer({ applies_to: e.target.value })} placeholder="on what (e.g. your next class)" style={{ ...sel, width: 220 }} />}
          {c.offer.kind !== "none" && <input value={c.offer.code || ""} onChange={e => setOffer({ code: e.target.value.toUpperCase().replace(/\s+/g, "") })} placeholder="CODE" style={{ ...sel, width: 130 }} />}
          {c.offer.kind !== "none" && <><span style={{ fontSize: 12, color: DS.mut }}>until</span><input type="date" value={c.offer.expires || ""} onChange={e => setOffer({ expires: e.target.value })} style={{ ...sel, colorScheme: "dark" }} /></>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
          <span style={{ fontSize: 12, color: DS.mut }}>Button links to</span>
          <select value={c.offer.line || ""} onChange={e => setOffer({ line: e.target.value })} style={sel}><option value="">best guess</option>{LINES.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}</select>
          <input value={c.offer.url || ""} onChange={e => setOffer({ url: e.target.value })} placeholder={"or a specific link (" + lineUrl(c.offer.line || "club").replace(/^https?:\/\//, "") + ")"} style={{ ...sel, width: 300 }} />
        </div>
        <div style={{ fontSize: 13, color: DS.lime, fontWeight: 700, marginTop: 6 }}>{offerText(c.offer) ? "Offer: " + offerText(c.offer) : "No offer - an invitation"}{c.offer.code && <span style={{ color: DS.orange, fontWeight: 600 }}> · create code {c.offer.code} in Playbook</span>}</div>

        <Label>3 · How and when</Label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={c.cadence} onChange={e => set({ cadence: e.target.value, channels: e.target.value === "one" ? ["email"] : e.target.value === "text" ? ["text"] : ["email", "text"] })} style={sel}>{CADENCE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <span style={{ fontSize: 12, color: DS.mut }}>starting</span><input type="date" value={c.starts_on} min={ymd(new Date())} onChange={e => set({ starts_on: e.target.value })} style={{ ...sel, colorScheme: "dark" }} />
        </div>
        <textarea value={c.notes} onChange={e => set({ notes: e.target.value })} rows={2} placeholder="Anything for the writer (optional): e.g. mention the new Warehouse II courts, keep it short, it's for Thanksgiving week…" style={{ ...inputStyle, width: "100%", marginTop: 8, fontSize: 13 }} />
        <div style={{ marginTop: 8 }}><Btn kind="primary" onClick={write} disabled={!!busy || !aud?.families || !!c.sent_item_ids?.length} title={c.sent_item_ids?.length ? "A step has gone out - edit the rest below" : ""}>{busy === "write" ? "Writing…" : c.steps.length ? "✨ Write it again" : "✨ Write it"}</Btn>{!aud?.families && <span style={{ fontSize: 12, color: DS.orange, marginLeft: 8 }}>Nobody's in this audience.</span>}</div>
        {msg && c && <div style={{ fontSize: 13, color: DS.orange, marginTop: 6 }}>{msg}</div>}

        {c.steps.length > 0 && <>
          <Label>4 · The steps (edit anything)</Label>
          <div style={{ display: "grid", gap: 10 }}>
            {c.steps.map((s, i) => { const sent = (c.sent_item_ids || []).includes(s.item_id); return (
              <div key={i} style={{ background: DS.panel2, border: "1px solid " + DS.line, borderRadius: 12, padding: 12, opacity: sent ? 0.6 : 1 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: DS.lime, marginBottom: 6 }}>{fmtD(addDays(c.starts_on, s.day))} · {s.channel === "email" ? "✉ Email" : "💬 Text"} · {s.who === "everyone" ? "everyone" : "only those who haven't booked yet"}{sent && <span style={{ color: DS.mut }}> · already sent</span>}</div>
                <fieldset disabled={sent} style={{ border: "none", margin: 0, padding: 0, minWidth: 0 }}>
                {s.channel === "email" ? <div style={{ display: "grid", gap: 6 }}>
                  <input value={s.subject} onChange={e => setStep(i, { subject: e.target.value })} placeholder="Subject" style={{ ...inputStyle, fontWeight: 700 }} />
                  <input value={s.preheader} onChange={e => setStep(i, { preheader: e.target.value })} placeholder="Preview line" style={{ ...inputStyle, fontSize: 13 }} />
                  <div style={{ display: "flex", gap: 6 }}><input value={s.headline} onChange={e => setStep(i, { headline: e.target.value })} placeholder="Headline (big type)" style={{ ...inputStyle, flex: 1 }} /><input value={s.tag} onChange={e => setStep(i, { tag: e.target.value })} placeholder="Tag" style={{ ...inputStyle, width: 130 }} /></div>
                  <textarea value={s.body} onChange={e => setStep(i, { body: e.target.value })} rows={5} style={{ ...inputStyle, lineHeight: 1.45 }} />
                  <input value={s.cta_text} onChange={e => setStep(i, { cta_text: e.target.value })} placeholder="Button" style={{ ...inputStyle, width: 220 }} />
                </div> : <div>
                  <textarea value={s.sms} onChange={e => setStep(i, { sms: e.target.value })} rows={3} style={{ ...inputStyle, width: "100%", lineHeight: 1.45 }} />
                  <div style={{ fontSize: 11.5, color: s.sms.length > 230 ? DS.orange : DS.mut }}>{s.sms.length}/230 · the link and "Reply STOP to opt out." are added · {"{parent_first}"} and {"{player_first}"} become names</div>
                </div>}
                </fieldset>
              </div>); })}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
            <Btn kind="primary" onClick={() => save(true)} disabled={!!busy}>{busy === "schedule" ? "Adding…" : c.id && ["scheduled", "live"].includes(c.status) ? "Update the calendar" : "📅 Put it on the Marketing calendar"}</Btn>
            <Btn onClick={() => save(false)} disabled={!!busy}>{busy === "save" ? "Saving…" : "Save draft"}</Btn>
            <span style={{ fontSize: 12, color: DS.mut }}>Each step becomes a draft in Marketing; nothing goes out until it's approved there.</span>
          </div>
        </>}
      </Card>}

      <div>
        <div style={{ fontSize: 15, fontWeight: 900, margin: "4px 0 8px" }}>Campaigns</div>
        {!list ? <Card><span style={{ color: DS.mut }}>Loading…</span></Card> : !list.length ? <Card><span style={{ color: DS.mut }}>None yet. Start from a revenue idea on Pulse, or build one above.</span></Card> : (
          <div style={{ display: "grid", gap: 8 }}>
            {list.map(camp => { const [col, lab] = STATUS[camp.status] || [DS.mut, camp.status]; const r = results[camp.id]; return (
              <div key={camp.id} style={{ background: DS.panel, border: "1px solid " + DS.line, borderRadius: 12, padding: 12 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <b style={{ fontSize: 15 }}>{camp.name}</b><Tag color={col}>{lab}</Tag>
                  <span style={{ fontSize: 12, color: DS.mut }}>{camp.audience_count != null ? `${camp.audience_count.toLocaleString()} families · ` : ""}{offerText(camp.offer || {}) || "no offer"}{camp.starts_on ? ` · from ${fmtD(camp.starts_on)}` : ""}</span>
                  <div style={{ flex: 1 }} />
                  {camp.status !== "draft" && <Btn small onClick={() => showResults(camp)}>{open === camp.id ? "Hide results" : "Results"}</Btn>}
                  {["draft", "scheduled", "live"].includes(camp.status) && <Btn small onClick={() => edit(camp)}>Edit</Btn>}
                  {["scheduled", "live"].includes(camp.status) && <Btn small onClick={() => window.confirm("Take this campaign's unsent steps off the calendar?") && run("c", async () => { await api("cancel", { id: camp.id }); await load(); })}>Cancel</Btn>}
                  {camp.status === "draft" && <Btn small onClick={() => window.confirm("Delete this draft?") && run("d", async () => { await api("delete", { id: camp.id }); await load(); })}>Delete</Btn>}
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6, fontSize: 12, color: DS.mut }}>
                  {(camp.steps || []).map((s, i) => <span key={i}>{s.channel === "email" ? "✉" : "💬"} {fmtD(s.at || (camp.starts_on && addDays(camp.starts_on, s.day)))}{s.who === "not_booked" ? " (not booked yet)" : ""}</span>)}
                </div>
                {open === camp.id && <div style={{ marginTop: 10, borderTop: "1px solid " + DS.line, paddingTop: 10 }}>
                  {!r ? <span style={{ fontSize: 13, color: DS.mut }}>Counting…</span> : r.error ? <span style={{ fontSize: 13, color: DS.orange }}>{r.error}</span> : <>
                    <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                      {[["Sent", r.steps.reduce((a, s) => a + (s.sent || 0), 0).toLocaleString()], ["Text replies", r.replies], ["Booked", `${r.booked} of ${r.audience}`], ["Revenue", money(r.revenue)]].map(([l, v]) => <div key={l}><div style={{ fontSize: 20, fontWeight: 900, color: l === "Revenue" ? DS.lime : DS.text }}>{v}</div><div style={{ fontSize: 11, color: DS.mut }}>{l}</div></div>)}
                    </div>
                    <div style={{ fontSize: 12, color: DS.mut, margin: "6px 0" }}>Booked = a purchase or sign-up by a family in the audience between {fmtD(r.window?.from)} and {fmtD(r.window?.to)}. Steps: {r.steps.map(s => `${s.channel === "sms" ? "text" : "email"} ${s.status}${s.error ? " (" + s.error + ")" : ""}`).join(" · ") || "none"}</div>
                    {r.families.map(x => <div key={x.id} style={{ fontSize: 13, display: "flex", gap: 8 }}><span style={{ minWidth: 160 }}>{x.name}</span><span style={{ color: DS.mut, flex: 1 }}>{x.what.join(", ")}</span><span>{x.cents ? money(x.cents) : ""}</span></div>)}
                  </>}
                </div>}
              </div>); })}
          </div>
        )}
      </div>
    </div>
  );
}
