// DSSC People -> Birthdays: the party invite 75 days before a kid's birthday
// (turning 3-13, $50 off a party, the open party times around it) and the
// birthday wishes on the day ($35 off anything). Each one is switched on here,
// with a preview to yourself first; then the next 30 days and what went out.
// api/dssc-birthdays.js and api/_lib/dssc-birthdays.js do the work.
import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { DS, Btn, Card, Label, Tag, inputStyle } from "./DsscHub.jsx";

const api = async (action, body = {}) => {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch("/api/dssc-birthdays", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (session?.access_token || "") }, body: JSON.stringify({ action, ...body }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || r.statusText);
  return d;
};
const fmtD = (iso, o = { weekday: "short", month: "short", day: "numeric" }) => iso ? new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString(undefined, o) : "";
const KIND = { party: ["🎉", "Party invite", "#E86FA6"], birthday: ["🎂", "Birthday", DS.lime] };
const STATUS = { sent: [DS.lime, "Sent"], sending: ["#7FD1C3", "Sending"], failed: [DS.orange, "Failed - retries"], skipped: [DS.mut, "Skipped"] };
const num = { ...inputStyle, width: 70, padding: "6px 8px" };
const code = { ...inputStyle, width: 120, padding: "6px 8px", textTransform: "uppercase", fontWeight: 800 };
const chip = (on) => ({ fontFamily: DS.font, fontSize: 12.5, fontWeight: 800, padding: "5px 11px", borderRadius: 999, cursor: "pointer", border: "1px solid " + (on ? DS.lime : DS.lineStrong), background: on ? DS.lime : "transparent", color: on ? DS.bg : DS.text });

export default function DsscCrmBirthdays() {
  const [st, setSt] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [show, setShow] = useState("all");
  const load = () => api("state").then(d => { setSt(d); setForm(d.settings); setErr(""); }).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);
  const run = (k, fn) => async () => { setBusy(k); setMsg(""); setErr(""); try { await fn(); } catch (e) { setErr(e.message); } setBusy(""); };
  const save = (patch) => run("save", async () => { const d = await api("save", { settings: { ...form, ...patch } }); setForm(d.settings); await load(); setMsg("✓ Saved"); })();
  const dueNow = (kind) => (st?.upcoming || []).filter(r => r.kind === kind && r.on <= st.today && !r.sent).length;
  const toggle = (kind) => {
    const key = kind === "party" ? "party_on" : "birthday_on";
    if (!form[key]) {
      const n = dueNow(kind);
      const what = kind === "party" ? `party invites (${n} are due now, including kids whose invite day was in the last two weeks)` : `birthday emails (${n} today)`;
      if (!window.confirm(`Turn on ${kind === "party" ? "party invites" : "birthday emails"}? The next run (9am or 3pm Central) sends ${what}. Did you check the preview?`)) return;
    }
    save({ [key]: !form[key] });
  };
  const preview = (kind) => run("p" + kind, async () => { const d = await api("preview", { kind }); setMsg(`✓ Preview sent to ${d.preview.to}: "${d.preview.subject}" (built for ${d.preview.for}, as it would go on ${fmtD(d.preview.sends_on)}).`); })();

  if (err && !st) return <Card><span style={{ color: DS.orange }}>{err}</span></Card>;
  if (!st || !form) return <Card><span style={{ color: DS.mut }}>Loading birthdays…</span></Card>;
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const rows = st.upcoming.filter(r => show === "all" || r.kind === show);
  const byDay = rows.reduce((m, r) => { (m[r.on] ||= []).push(r); return m; }, {});

  const box = (kind, on, title, sub, fields) => (
    <div style={{ background: DS.panel, border: "1px solid " + (on ? KIND[kind][2] : DS.line), borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div style={{ fontSize: 28 }}>{KIND[kind][0]}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 900, fontSize: 17 }}>{title}</div>
          <div style={{ fontSize: 12.5, color: DS.mut, marginTop: 2 }}>{sub}</div>
        </div>
        <button onClick={() => toggle(kind)} disabled={!!busy} style={{ ...chip(on), padding: "7px 14px" }}>{on ? "On" : "Off"}</button>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>{fields}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Btn small onClick={() => preview(kind)} disabled={!!busy}>{busy === "p" + kind ? "Sending…" : "✉ Send me a preview"}</Btn>
        <Btn small kind="primary" onClick={() => save({})} disabled={!!busy}>{busy === "save" ? "Saving…" : "Save"}</Btn>
      </div>
    </div>
  );
  const field = (label, el) => <label style={{ display: "inline-flex", gap: 6, alignItems: "center", color: DS.mut }}>{label}{el}</label>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(340px, 100%), 1fr))", gap: 12 }}>
        {box("party", form.party_on, "Party invite", `${form.party_days} days before the birthday, kids turning ${form.party_min_age}-${form.party_max_age}: $${form.party_off} off a party, the open party times the weekends around it (live from Playbook), party photos. Families with a party already booked around the birthday are skipped.`, <>
          {field("Days before", <input type="number" value={form.party_days} onChange={set("party_days")} style={num} />)}
          {field("Ages", <><input type="number" value={form.party_min_age} onChange={set("party_min_age")} style={num} />to<input type="number" value={form.party_max_age} onChange={set("party_max_age")} style={num} /></>)}
          {field("$ off", <input type="number" value={form.party_off} onChange={set("party_off")} style={num} />)}
          {field("Code", <input value={form.party_code} onChange={set("party_code")} style={code} />)}
          {field("Book within (days, 0 = no date)", <input type="number" value={form.party_book_days} onChange={set("party_book_days")} style={num} />)}
        </>)}
        {box("birthday", form.birthday_on, "Happy birthday", `On the birthday, kids turning up to ${form.birthday_max_age}: happy birthday from DSSC and $${form.birthday_off} off anything. Twins get one email.`, <>
          {field("Up to age", <input type="number" value={form.birthday_max_age} onChange={set("birthday_max_age")} style={num} />)}
          {field("$ off", <input type="number" value={form.birthday_off} onChange={set("birthday_off")} style={num} />)}
          {field("Code", <input value={form.birthday_code} onChange={set("birthday_code")} style={code} />)}
          {field("Good for (days, 0 = no expiry)", <input type="number" value={form.birthday_valid_days} onChange={set("birthday_valid_days")} style={num} />)}
        </>)}
      </div>
      {(msg || err) && <div style={{ fontSize: 13, color: err ? DS.orange : DS.lime }}>{err || msg}</div>}
      <div style={{ fontSize: 12, color: DS.mut }}>Emails go at 9am and 3pm Central to the parent's email, never to anyone unsubscribed or bounced, and never twice for the same birthday. The codes must exist in Playbook ({form.party_code}, {form.birthday_code}). {st.kidsWithBirthday.toLocaleString()} kids in People have a birthday on file.</div>

      <Card>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <Label>Next 30 days</Label>
          <div style={{ flex: 1 }} />
          {[["all", "All"], ["party", "🎉 Party invites"], ["birthday", "🎂 Birthdays"]].map(([k, l]) => <button key={k} onClick={() => setShow(k)} style={chip(show === k)}>{l} {k === "all" ? st.upcoming.length : st.upcoming.filter(r => r.kind === k).length}</button>)}
        </div>
        {!rows.length && <div style={{ fontSize: 13, color: DS.mut }}>Nothing in the next 30 days.</div>}
        {Object.entries(byDay).map(([day, list]) => (
          <div key={day} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: DS.lime, margin: "6px 0 4px" }}>{day === st.today ? "Today" : fmtD(day, { weekday: "long", month: "short", day: "numeric" })}</div>
            {list.map(r => { const [ic, lab, col] = KIND[r.kind]; const on = r.kind === "party" ? form.party_on : form.birthday_on; const s = r.sent ? STATUS[r.sent.status] : null; return (
              <div key={r.kind + r.pid} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", borderBottom: "1px solid " + DS.line, fontSize: 13, flexWrap: "wrap" }}>
                <span title={lab}>{ic}</span>
                <b style={{ minWidth: 140 }}>{r.first} {r.last}</b>
                <span style={{ color: DS.mut, flex: 1, minWidth: 180 }}>turns {r.turns} on {fmtD(r.birthday)} · {r.family}</span>
                {s ? <Tag color={s[0]}>{s[1]}{r.sent.reason ? ": " + r.sent.reason : ""}</Tag> : <Tag color={on ? col : DS.dim}>{on ? (r.on <= st.today ? "Goes next run" : "Scheduled") : "Off"}</Tag>}
                {!r.sent && <button onClick={run("s" + r.kind + r.pid, async () => { await api("skip", { pid: r.pid, kind: r.kind, birthday: r.birthday }); await load(); })} disabled={!!busy} title="Never send this one" style={{ ...chip(false), padding: "2px 9px", fontSize: 11 }}>Skip</button>}
                {r.sent?.status === "skipped" && /^skipped by/.test(r.sent.reason || "") && <button onClick={run("u" + r.kind + r.pid, async () => { await api("unskip", { pid: r.pid, kind: r.kind, birthday: r.birthday }); await load(); })} disabled={!!busy} style={{ ...chip(false), padding: "2px 9px", fontSize: 11 }}>Undo</button>}
              </div>); })}
          </div>))}
      </Card>

      <Card>
        <Label>Sent lately</Label>
        {!st.recent.length && <div style={{ fontSize: 13, color: DS.mut }}>Nothing yet - turn an email on above.</div>}
        {st.recent.map(r => { const [ic] = KIND[r.kind]; const s = STATUS[r.status] || [DS.mut, r.status]; return (
          <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", borderBottom: "1px solid " + DS.line, fontSize: 13, flexWrap: "wrap" }}>
            <span style={{ color: DS.mut, minWidth: 64 }}>{fmtD(r.sent_at || r.created_at, { month: "short", day: "numeric" })}</span>
            <span>{ic}</span><b style={{ minWidth: 140 }}>{r.first} {r.last}</b>
            <span style={{ color: DS.mut, flex: 1, minWidth: 160 }}>turns {r.turns} on {fmtD(r.birthday)} · {r.email}</span>
            <Tag color={s[0]}>{s[1]}{r.reason ? ": " + r.reason : ""}</Tag>
          </div>); })}
      </Card>
    </div>
  );
}
