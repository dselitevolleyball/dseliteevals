// HQ -> Payments (DS Elite): collect money from families through Stripe
// (Drew, Oct 29 2026: "a payment system through Stripe that I can use for
// things like the NCAA tickets"). A request is one thing families pay for;
// each family gets a private link (/pay?t=) to Stripe Checkout, and the list
// shows who has paid. Cash / Venmo / check can be recorded by hand; card
// payments refund through Stripe. The server side is api/pay.js.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";

const T = { bg: "#0a0a0a", card: "#141414", card2: "#1b1b1b", line: "#2a2a2a", pink: "#e91e8c", hot: "#ff69b4", text: "#fff", mut: "#999", ok: "#22c55e", bad: "#ff8a7a", warn: "#f59e0b" };
const api = async (action, body = {}) => {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch("/api/pay", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (session?.access_token || "") }, body: JSON.stringify({ action, ...body }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || r.statusText);
  return d;
};
const usd = (c) => "$" + (Number(c || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: Number(c || 0) % 100 ? 2 : 0, maximumFractionDigits: 2 });
const when = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
const STATUS = { unpaid: [T.warn, "Unpaid"], pending: [T.hot, "Clearing"], paid: [T.ok, "Paid"], refunded: [T.mut, "Refunded"], canceled: [T.mut, "Canceled"] };

export default function Payments({ narrow }) {
  const [stripe, setStripe] = useState(null);
  const [reqs, setReqs] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);
  const loadStatus = () => api("status").then(d => setStripe(d.stripe)).catch(e => setErr(e.message));
  const loadReqs = () => api("requests").then(d => setReqs(d.requests)).catch(e => setErr(e.message));
  useEffect(() => { loadStatus(); loadReqs(); }, []);
  return (
    <div style={{ margin: "-14px -18px", padding: "16px 16px 40px", background: T.bg, minHeight: "calc(100vh - 56px)", color: T.text }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ fontSize: 22, fontWeight: 900 }}>💳 Payments</div>
          <span style={{ fontSize: 12, color: T.mut }}>Families pay by card, Apple Pay or Google Pay through Stripe · DS Elite covers the fees</span>
          <div style={{ flex: 1 }} />
          {stripe && (stripe.connected && stripe.ok ? <Pill c={T.ok}>● Stripe: {stripe.account}{stripe.livemode ? "" : " (test mode)"}</Pill> : <Pill c={T.warn}>⚠ {stripe.connected ? stripe.problem || "Stripe needs attention" : "Stripe not connected"}</Pill>)}
        </div>
        {err && <div style={{ color: T.bad, fontSize: 13, marginBottom: 10 }}>{err}</div>}
        {stripe && (!stripe.connected || !stripe.ok) && <Connect onDone={() => { loadStatus(); }} stripe={stripe} />}
        {openId ? <Request id={openId} narrow={narrow} onBack={() => { setOpenId(null); loadReqs(); }} stripeOk={!!stripe?.ok} /> : (
          <>
            <div style={{ display: "flex", gap: 8, margin: "4px 0 12px" }}>
              <Btn primary onClick={() => setCreating(c => !c)}>{creating ? "Close" : "+ New payment request"}</Btn>
            </div>
            {creating && <Create onMade={(id) => { setCreating(false); loadReqs(); setOpenId(id); }} />}
            {!reqs ? <Muted>Loading…</Muted> : !reqs.length ? <Box><Muted>No payment requests yet. Start one with "+ New payment request" - for the NCAA tickets, tick "Start from the NCAA form" and every family who said yes is added with the number they asked for.</Muted></Box> : (
              <div style={{ display: "grid", gap: 10 }}>
                {reqs.map(r => <button key={r.id} onClick={() => setOpenId(r.id)} style={{ textAlign: "left", background: T.card, border: "1px solid " + T.line, borderRadius: 12, padding: 14, color: T.text, cursor: "pointer", fontFamily: "inherit" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <b style={{ fontSize: 16 }}>{r.title}</b><span style={{ color: T.mut, fontSize: 13 }}>{usd(r.unit_amount_cents)} / {r.unit_label}</span>
                    {r.status === "closed" && <Pill c={T.mut}>Closed</Pill>}
                    <div style={{ flex: 1 }} />
                    <span style={{ fontSize: 14 }}><b style={{ color: T.ok }}>{usd(r.totals.collected_cents)}</b> collected · {r.totals.paid + r.totals.pending} of {r.totals.families} families paid</span>
                  </div>
                  <Bar a={r.totals.paid + r.totals.pending} b={r.totals.families} />
                </button>)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Connect({ onDone, stripe }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  return (
    <Box style={{ marginBottom: 14, borderColor: T.warn }}>
      <b>Connect DS Elite's Stripe account</b>
      <ol style={{ fontSize: 13, color: T.mut, margin: "8px 0", paddingLeft: 18, lineHeight: 1.6 }}>
        <li>Sign in at <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noreferrer" style={{ color: T.hot }}>dashboard.stripe.com/apikeys</a> as DS Elite Volleyball, LLC (Live mode).</li>
        <li>Under <b>Secret key</b>, click <b>Reveal live key</b> and copy it (it starts with <code>sk_live_</code>).</li>
        <li>Paste it here and press Connect. HQ checks it with Stripe, sets up the payment notifications, and keeps the key on the server - it's never shown again.</li>
      </ol>
      {stripe?.problem && stripe.connected && <div style={{ color: T.warn, fontSize: 13, marginBottom: 6 }}>{stripe.problem}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder="sk_live_…" autoComplete="off" style={{ ...input, flex: 1, minWidth: 220 }} />
        <Btn primary disabled={busy || !key.trim()} onClick={async () => { setBusy(true); setMsg(""); try { const d = await api("connect", { key: key.trim() }); setKey(""); setMsg(`Connected to ${d.stripe.account}${d.stripe.livemode ? "" : " (test mode)"}`); onDone(); } catch (e) { setMsg(e.message); } setBusy(false); }}>{busy ? "Checking…" : "Connect"}</Btn>
      </div>
      {msg && <div style={{ fontSize: 13, marginTop: 6, color: /^Connected/.test(msg) ? T.ok : T.bad }}>{msg}</div>}
    </Box>
  );
}

function Create({ onMade }) {
  const [f, setF] = useState({ title: "", unit_amount: "", unit_label: "ticket", description: "", due_date: "", allow_qty_change: true, ncaa: false });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const ncaa = () => setF({ ...f, ncaa: !f.ncaa, ...(!f.ncaa ? { title: f.title || "NCAA Championship tickets", unit_amount: f.unit_amount || "52", unit_label: "ticket", description: f.description || "The DS Elite group at the NCAA women's volleyball championship match at the Alamodome in San Antonio, Sunday, December 20 at 2:30pm. Seats in the 300 level." } : {}) });
  return (
    <Box style={{ marginBottom: 14 }}>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, marginBottom: 10 }}><input type="checkbox" checked={f.ncaa} onChange={ncaa} />Start from the NCAA form (adds every family who said yes, with the number of tickets they asked for)</label>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <Field label="What is it?"><input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="NCAA Championship tickets" style={input} /></Field>
        <Field label="Price each ($)"><input value={f.unit_amount} onChange={e => setF({ ...f, unit_amount: e.target.value })} inputMode="decimal" placeholder="52" style={input} /></Field>
        <Field label="Unit"><input value={f.unit_label} onChange={e => setF({ ...f, unit_label: e.target.value })} placeholder="ticket" style={input} /></Field>
        <Field label="Pay by (optional)"><input type="date" value={f.due_date} onChange={e => setF({ ...f, due_date: e.target.value })} style={{ ...input, colorScheme: "dark" }} /></Field>
      </div>
      <Field label="Description families see (optional)"><textarea value={f.description} onChange={e => setF({ ...f, description: e.target.value })} rows={2} style={{ ...input, width: "100%" }} /></Field>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: T.mut, marginTop: 6 }}><input type="checkbox" checked={f.allow_qty_change} onChange={e => setF({ ...f, allow_qty_change: e.target.checked })} />Families can change the number before paying</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
        <Btn primary disabled={busy || !f.title.trim() || !f.unit_amount} onClick={async () => { setBusy(true); setMsg(""); try { const d = await api("create", { ...f, source: f.ncaa ? "ncaa" : null }); onMade(d.request.id); } catch (e) { setMsg(e.message); } setBusy(false); }}>{busy ? "Creating…" : "Create"}</Btn>
        {msg && <span style={{ color: T.bad, fontSize: 13 }}>{msg}</span>}
      </div>
    </Box>
  );
}

function Request({ id, onBack, narrow, stripeOk }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [send, setSend] = useState(null);   // { remind, preview, text }
  const load = () => api("request", { id }).then(setD).catch(e => setMsg({ err: e.message }));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (key, fn, ok) => { setBusy(key); setMsg(null); try { const r = await fn(); if (ok) setMsg({ ok: typeof ok === "function" ? ok(r) : ok }); await load(); return r; } catch (e) { setMsg({ err: e.message }); } finally { setBusy(""); } };
  const items = useMemo(() => (d?.items || []).filter(i => (filter === "all" ? i.status !== "canceled" : i.status === filter) && (!q || i.family_label.toLowerCase().includes(q.toLowerCase()))), [d, q, filter]);
  if (!d) return <Muted>{msg?.err || "Loading…"}</Muted>;
  const r = d.request, t = r.totals;
  const unsent = d.items.filter(i => i.status === "unpaid" && !i.sent_at).length, unpaid = d.items.filter(i => i.status === "unpaid").length;
  const openSend = async (remind) => { setMsg(null); try { const p = await api("preview", { id }); setSend({ remind, preview: p, text: false }); } catch (e) { setMsg({ err: e.message }); } };
  return (
    <div>
      <button onClick={onBack} style={{ ...link, marginBottom: 8 }}>← All payment requests</button>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <div style={{ fontSize: 20, fontWeight: 900 }}>{r.title}</div>
        <span style={{ color: T.mut }}>{usd(r.unit_amount_cents)} / {r.unit_label}{r.due_date ? ` · pay by ${new Date(r.due_date + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}</span>
        {r.status === "closed" && <Pill c={T.mut}>Closed</Pill>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr 1fr" : "repeat(4, 1fr)", gap: 8, margin: "12px 0" }}>
        <Stat label="Collected" value={usd(t.collected_cents)} color={T.ok} />
        <Stat label={`Paid families`} value={`${t.paid + t.pending} / ${t.families}`} />
        <Stat label={`${r.unit_label}s paid`} value={t.qty_paid} />
        <Stat label="Still owed" value={usd(t.qty_open * r.unit_amount_cents)} color={t.qty_open ? T.warn : T.mut} />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <Btn primary disabled={!!busy || !unsent || !stripeOk || r.status !== "open"} onClick={() => openSend(false)} title={!stripeOk ? "Connect Stripe first" : ""}>Send links to {unsent} famil{unsent === 1 ? "y" : "ies"}</Btn>
        <Btn disabled={!!busy || !unpaid || !stripeOk || r.status !== "open"} onClick={() => openSend(true)}>Remind {unpaid} unpaid</Btn>
        {r.source === "ncaa" && <Btn disabled={!!busy} onClick={() => run("imp", () => api("import_ncaa", { id }), (x) => x.added ? `Added ${x.added} new famil${x.added === 1 ? "y" : "ies"} from the NCAA form` : "Everyone who said yes is already on the list")}>Add new NCAA "yes" families</Btn>}
        <AddFamily id={id} onAdded={load} />
        <Btn disabled={!!busy} onClick={() => run("st", () => api("update", { id, status: r.status === "open" ? "closed" : "open" }), r.status === "open" ? "Closed - links now say payments are closed" : "Reopened")}>{r.status === "open" ? "Close" : "Reopen"}</Btn>
      </div>
      {send && <SendPanel id={id} send={send} setSend={setSend} onSent={(x) => { setSend(null); setMsg({ ok: `Sent to ${x.families} famil${x.families === 1 ? "y" : "ies"} (${x.emailed} emails${x.texted ? `, ${x.texted} texts` : ""})${x.failed.length ? ` · ${x.failed.length} problem${x.failed.length === 1 ? "" : "s"}: ${x.failed.slice(0, 3).map(f => `${f.family} (${f.error})`).join("; ")}` : ""}` }); load(); }} />}
      <Words r={r} onSaved={load} />
      {msg && <div style={{ fontSize: 13, margin: "8px 0", color: msg.err ? T.bad : T.ok }}>{msg.err || msg.ok}</div>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: "12px 0 8px" }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search families…" style={{ ...input, width: narrow ? "100%" : 220 }} />
        {["all", "unpaid", "paid", "pending", "refunded", "canceled"].map(k => <button key={k} onClick={() => setFilter(k)} style={chip(filter === k)}>{k === "all" ? "All" : STATUS[k][1]}</button>)}
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {items.map(i => <Row key={i.id + i.updated_at} i={i} r={r} busy={busy} run={run} />)}
        {!items.length && <Muted>No families here.</Muted>}
      </div>
    </div>
  );
}

function SendPanel({ id, send, setSend, onSent }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const p = send.preview;
  return (
    <Box style={{ margin: "8px 0", borderColor: T.pink }}>
      <b>{send.remind ? "Remind every unpaid family" : "Send the payment links"}</b> <span style={{ color: T.mut, fontSize: 13 }}>· here's what {p.family} would get</span>
      <div style={{ fontSize: 12, color: T.mut, marginTop: 8 }}>Email to {p.emails.join(", ") || "(no email on file)"}</div>
      <div style={{ background: T.card2, borderRadius: 8, padding: 10, fontSize: 13, whiteSpace: "pre-wrap", marginTop: 4 }}><b>{send.remind ? "Reminder: " : ""}{p.subject}</b>{"\n\n"}{p.body}</div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginTop: 8 }}><input type="checkbox" checked={send.text} onChange={e => setSend({ ...send, text: e.target.checked })} />Also text the parents</label>
      {send.text && <div style={{ background: T.card2, borderRadius: 8, padding: 10, fontSize: 13, whiteSpace: "pre-wrap", marginTop: 4 }}>{send.remind ? "Reminder: " : ""}{p.sms.replace("{first}", (p.family.split(/[\s&(]/)[0] || "there"))}</div>}
      {err && <div style={{ color: T.bad, fontSize: 13, marginTop: 6 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <Btn primary disabled={busy} onClick={async () => { setBusy(true); setErr(""); try { onSent(await api("send", { id, remind: send.remind, email: true, text: send.text })); } catch (e) { setErr(e.message); } setBusy(false); }}>{busy ? "Sending… (about a second a family)" : send.remind ? "Send the reminders" : "Send the links"}</Btn>
        <Btn disabled={busy} onClick={() => setSend(null)}>Cancel</Btn>
      </div>
    </Box>
  );
}

function Words({ r, onSaved }) {
  const d = r.defaults || {};
  const [f, setF] = useState({ email_subject: r.email_subject || d.email_subject || "", email_body: r.email_body || d.email_body || "", sms_body: r.sms_body || d.sms_body || "" });
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState("");
  return (
    <details style={{ margin: "6px 0" }}>
      <summary style={{ cursor: "pointer", fontSize: 13, color: T.mut }}>Edit the email and text</summary>
      <div style={{ fontSize: 12, color: T.mut, margin: "6px 0" }}>Fill-ins: {"{greeting} {qty} {price} {total} {link} {due_by} {title}"} · texts also {"{first}"}</div>
      <input value={f.email_subject} onChange={e => setF({ ...f, email_subject: e.target.value })} style={{ ...input, width: "100%" }} />
      <textarea value={f.email_body} onChange={e => setF({ ...f, email_body: e.target.value })} rows={12} style={{ ...input, width: "100%", marginTop: 6 }} />
      <textarea value={f.sms_body} onChange={e => setF({ ...f, sms_body: e.target.value })} rows={3} style={{ ...input, width: "100%", marginTop: 6 }} />
      <Btn small disabled={busy} onClick={async () => { setBusy(true); try { await api("update", { id: r.id, ...f }); setOk("Saved"); onSaved(); } catch (e) { setOk(e.message); } setBusy(false); }}>{busy ? "Saving…" : "Save"}</Btn> <span style={{ fontSize: 12, color: T.mut }}>{ok}</span>
    </details>
  );
}

function Row({ i, r, busy, run }) {
  const [qty, setQty] = useState(i.qty);
  const [method, setMethod] = useState("");
  const [st, label] = STATUS[i.status] || [T.mut, i.status];
  const copy = () => { try { navigator.clipboard.writeText(i.link); } catch { /* ignore */ } };
  const k = (s) => s + i.id;
  return (
    <div style={{ background: T.card, border: "1px solid " + T.line, borderRadius: 10, padding: "10px 12px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", opacity: i.status === "canceled" ? 0.55 : 1 }}>
      <div style={{ flex: "1 1 240px", minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>{i.family_label}</div>
        <div style={{ fontSize: 12, color: T.mut }}>{i.sent_at ? `sent ${when(i.sent_at)}` : "not sent"}{i.reminded_at ? ` · reminded ${when(i.reminded_at)}` : ""}{i.opened_at ? ` · opened ${when(i.opened_at)}` : ""}{i.note ? ` · ${i.note}` : ""}</div>
      </div>
      {i.status === "unpaid"
        ? <span style={{ display: "inline-flex", gap: 4, alignItems: "center", fontSize: 13 }}><input type="number" min={1} max={99} value={qty} onChange={e => setQty(e.target.value)} style={{ ...input, width: 58, padding: "4px 6px" }} />× {usd(r.unit_amount_cents)}{Number(qty) !== i.qty && <Btn small disabled={!!busy} onClick={() => run(k("q"), () => api("item_update", { item_id: i.id, qty: Number(qty) }))}>Save</Btn>}</span>
        : <span style={{ fontSize: 13 }}>{i.paid_qty || i.qty} {r.unit_label}{(i.paid_qty || i.qty) === 1 ? "" : "s"}</span>}
      <b style={{ width: 80, textAlign: "right" }}>{usd(i.paid_cents ?? i.qty * r.unit_amount_cents)}</b>
      <Pill c={st}>{label}{i.method && i.status === "paid" ? ` · ${i.method}` : ""}</Pill>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {i.status === "unpaid" && <Btn small onClick={copy}>Copy link</Btn>}
        {i.status === "unpaid" && <select value={method} disabled={!!busy} onChange={e => { const m = e.target.value; setMethod(""); if (m) run(k("p"), () => api("mark_paid", { item_id: i.id, method: m, qty: Number(qty) || i.qty }), `Recorded ${i.family_label} as paid (${m})`); }} style={{ ...input, padding: "4px 6px", width: "auto", fontSize: 12 }}>
          <option value="">Paid another way…</option>{["cash", "venmo", "zelle", "check", "other"].map(m => <option key={m} value={m}>{m[0].toUpperCase() + m.slice(1)}</option>)}
        </select>}
        {i.status === "paid" && i.stripe_payment_intent && <Btn small disabled={!!busy} onClick={() => { if (window.confirm(`Refund ${usd((i.paid_cents || 0) - (i.refunded_cents || 0))} to ${i.family_label}'s card?`)) run(k("r"), () => api("refund", { item_id: i.id }), "Refunded - Stripe emails them a receipt"); }}>Refund</Btn>}
        {i.status === "paid" && !i.stripe_payment_intent && <Btn small disabled={!!busy} onClick={() => run(k("u"), () => api("mark_unpaid", { item_id: i.id }))}>Undo</Btn>}
        {i.status === "unpaid" && <Btn small disabled={!!busy} onClick={() => run(k("c"), () => api("cancel", { item_id: i.id }))}>Remove</Btn>}
        {i.status === "canceled" && <Btn small disabled={!!busy} onClick={() => run(k("c"), () => api("restore", { item_id: i.id }))}>Bring back</Btn>}
      </div>
    </div>
  );
}

function AddFamily({ id, onAdded }) {
  const [open, setOpen] = useState(false);
  const [players, setPlayers] = useState(null);
  const [q, setQ] = useState("");
  const [qty, setQty] = useState(1);
  const [err, setErr] = useState("");
  useEffect(() => { if (open && !players) api("players").then(d => setPlayers(d.players)).catch(e => setErr(e.message)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const hits = (players || []).filter(p => q.length > 1 && (p.name + " " + p.team).toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  if (!open) return <Btn onClick={() => setOpen(true)}>+ Add a family</Btn>;
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", position: "relative" }}>
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Player's name…" style={{ ...input, width: 200 }} />
      <input type="number" min={1} value={qty} onChange={e => setQty(e.target.value)} style={{ ...input, width: 60 }} title="How many" />
      <Btn small onClick={() => setOpen(false)}>Done</Btn>
      {err && <span style={{ color: T.bad, fontSize: 12 }}>{err}</span>}
      {hits.length > 0 && <div style={{ position: "absolute", top: 40, left: 0, zIndex: 5, background: T.card2, border: "1px solid " + T.line, borderRadius: 8, minWidth: 260 }}>
        {hits.map(p => <button key={p.id} onClick={async () => { setErr(""); try { await api("add_family", { id, player_id: p.id, qty: Number(qty) || 1 }); setQ(""); onAdded(); } catch (e) { setErr(e.message); } }} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", background: "none", border: "none", color: T.text, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>{p.name} <span style={{ color: T.mut }}>· {p.team}</span></button>)}
      </div>}
    </div>
  );
}

const input = { background: T.card2, border: "1px solid " + T.line, borderRadius: 8, color: T.text, fontFamily: "inherit", fontSize: 14, padding: "8px 10px", boxSizing: "border-box", outline: "none" };
const link = { background: "none", border: "none", color: T.mut, cursor: "pointer", fontFamily: "inherit", fontSize: 13, padding: 0 };
const chip = (on) => ({ padding: "5px 11px", borderRadius: 999, border: "1px solid " + (on ? T.pink : T.line), background: on ? T.pink : "transparent", color: on ? "#fff" : T.text, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 700 });
function Pill({ c, children }) { return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, border: "1px solid " + c, color: c, fontSize: 11, fontWeight: 800, whiteSpace: "nowrap" }}>{children}</span>; }
function Box({ children, style }) { return <div style={{ background: T.card, border: "1px solid " + T.line, borderRadius: 12, padding: 14, ...style }}>{children}</div>; }
function Muted({ children }) { return <div style={{ color: T.mut, fontSize: 13 }}>{children}</div>; }
function Field({ label, children }) { return <label style={{ display: "grid", gap: 4, fontSize: 12, color: T.mut, marginTop: 6 }}>{label}{children}</label>; }
function Stat({ label, value, color }) { return <div style={{ background: T.card, border: "1px solid " + T.line, borderRadius: 10, padding: "10px 12px" }}><div style={{ fontSize: 11, color: T.mut, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>{label}</div><div style={{ fontSize: 22, fontWeight: 900, color: color || T.text }}>{value}</div></div>; }
function Bar({ a, b }) { return <div style={{ height: 6, background: T.line, borderRadius: 6, marginTop: 8, overflow: "hidden" }}><div style={{ width: (b ? Math.round(100 * a / b) : 0) + "%", height: "100%", background: T.ok }} /></div>; }
function Btn({ primary, small, children, ...rest }) {
  return <button {...rest} style={{ padding: small ? "5px 10px" : "8px 14px", borderRadius: 8, border: "1px solid " + (primary ? T.pink : T.line), background: primary ? T.pink : "transparent", color: "#fff", fontWeight: 700, fontSize: small ? 12 : 13, cursor: rest.disabled ? "default" : "pointer", opacity: rest.disabled ? 0.5 : 1, fontFamily: "inherit" }}>{children}</button>;
}
