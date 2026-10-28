// DSSC → Reach Texts. Coach Brandon (Reach staff) texts Reach families from
// the club number: everyone who has ever signed up for Reach, everyone since a
// date, or one Reach program - see exactly who, leave anyone out, write one
// message (personalised with the parent's and athlete's names), test it on his
// own phone, send. Replies from Reach families show up under Conversations,
// where he can answer one family at a time.
//
// Sends go through the campaign engine (api/sms-campaigns.js) as a campaign
// with scope "reach"; shared/campaign-audience.js forces that scope to Reach
// sign-ups only, and the server lets Reach staff send nothing else. Opted-out
// numbers and do-not-text families are always left out.

import { useState, useEffect, useMemo } from "react";
import { supabase } from "../supabase";
import { DS, Btn, Tag, inputStyle } from "./DsscHub.jsx";
import { reachFilters, loadAudienceData, buildPeople, resolveAudience, renderBody, isGsm, segmentsOf } from "../../shared/campaign-audience.js";

const fmtPhone = (p) => { const s = String(p || "").replace(/\D/g, "").slice(-10); return s.length === 10 ? `(${s.slice(0, 3)}) ${s.slice(3, 6)}-${s.slice(6)}` : p || ""; };
const fmtWhen = (iso) => iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const localISO = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return localISO(d); };
const last10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);
const chip = (on) => ({ padding: "7px 12px", borderRadius: 999, border: "1px solid " + (on ? DS.lime : DS.line), background: on ? "rgba(178,208,73,0.18)" : "transparent", color: on ? DS.lime : DS.text, fontSize: 13, fontWeight: on ? 800 : 600, cursor: "pointer", fontFamily: DS.font });
const panel = { background: DS.panel, border: "1px solid " + DS.line, borderRadius: 14, padding: 14, marginBottom: 12 };
const title = { fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: DS.lime, marginBottom: 8 };
const MERGE = [["{parent_first}", "Parent's first name"], ["{players}", "Athlete names"], ["{program}", "Their Reach program"]];
const WHEN = [["", "Everyone, ever"], ["90", "Last 3 months"], ["30", "Last 30 days"], ["date", "Since a date…"]];

export default function DsscReachTexts({ coach, coachRoster = [], narrow }) {
  const me = coach?.display_name || coach?.email || "";
  const myPhone = useMemo(() => coachRoster.find(x => String(x.email || "").toLowerCase() === String(coach?.email || "").toLowerCase())?.phone || "", [coachRoster, coach]);
  const [tab, setTab] = useState("new");
  const [people, setPeople] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [when, setWhen] = useState("");
  const [sinceDate, setSinceDate] = useState(daysAgo(180));
  const [program, setProgram] = useState("");
  const [exclude, setExclude] = useState([]);
  const [showList, setShowList] = useState(false);
  const [body, setBody] = useState("Hi {parent_first}! ");
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const [sent, setSent] = useState([]);
  useEffect(() => { setTestTo(myPhone); }, [myPhone]);

  const token = async () => (await supabase.auth.getSession()).data.session?.access_token || "";
  const api = async (url, payload) => {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + await token() }, body: JSON.stringify(payload) });
    const d = await r.json().catch(() => ({})); if (!r.ok || d.error) throw new Error(d.error || r.statusText); return d;
  };
  const loadSent = async () => { const { data } = await supabase.from("sms_campaigns").select("*").eq("filters->>scope", "reach").order("created_at", { ascending: false }).limit(50); setSent(data || []); };
  useEffect(() => {
    loadSent();
    (async () => { try { setPeople(buildPeople(await loadAudienceData(supabase), localISO())); } catch (e) { setLoadErr(e.message); } })();
  }, []);

  const since = when === "date" ? sinceDate : when ? daysAgo(+when) : "";
  const filters = reachFilters({ since, program, exclude });
  const everyone = useMemo(() => people ? resolveAudience(people, reachFilters({ since, program })) : null, [people, since, program]); // eslint-disable-line react-hooks/exhaustive-deps
  const audience = useMemo(() => everyone ? { ...everyone, recipients: everyone.recipients.filter(r => !exclude.includes(last10(r.to))) } : null, [everyone, exclude]);
  // Reach programs anyone has signed up for, most popular first.
  const programs = useMemo(() => {
    if (!people) return [];
    const n = new Map();
    for (const f of people.families.values()) for (const k of f.kids.values()) for (const p of k.programs) if (p.category === "reach") n.set(p.program, (n.get(p.program) || 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  }, [people]);
  const reachPhones = useMemo(() => people ? new Set(resolveAudience(people, reachFilters()).recipients.map(r => last10(r.to))) : null, [people]);

  const sample = audience?.recipients[0];
  const preview = sample ? renderBody(body, sample) : renderBody(body, { first: "Sam", kind: "parent", players: ["Alex"], program: programs[0] || "Elite Athlete Development" });
  const segs = segmentsOf(preview);
  const ready = body.trim().replace(/^hi \{parent_first\}!?$/i, "").trim().length > 0;

  const makeCampaign = async () => {
    const label = program || (when === "" ? "All Reach families" : when === "date" ? `Reach since ${sinceDate}` : `Reach, last ${when} days`);
    const { data, error } = await supabase.from("sms_campaigns").insert({ brand: "dssc", name: "Reach: " + label, filters, body: body.trim(), media_urls: [], status: "draft", created_by: me }).select().single();
    if (error) throw new Error(error.message);
    return data;
  };
  const doTest = async () => {
    setBusy("test"); setMsg(null);
    try { const c = await makeCampaign(); const r = await api("/api/sms-campaigns", { action: "test", id: c.id, to: testTo }); await supabase.from("sms_campaigns").update({ status: "cancelled" }).eq("id", c.id); setMsg({ ok: `Test sent to ${fmtPhone(r.to)}${r.sample ? ` (written as it goes to ${r.sample})` : ""}.` }); }
    catch (e) { setMsg({ err: e.message }); } finally { setBusy(""); }
  };
  const doSend = async () => {
    const n = audience.recipients.length;
    if (!window.confirm(`Text ${n} Reach ${n === 1 ? "family" : "families"} from the club number now?\n\n${preview}`)) return;
    setBusy("send"); setMsg(null);
    try {
      const c = await makeCampaign();
      let r = await api("/api/sms-campaigns", { action: "send", id: c.id });
      while (r.status === "sending" && r.pending > 0) { setMsg({ ok: `Sending… ${r.sent + r.failed + r.skipped} of ${r.total}` }); r = await api("/api/sms-campaigns", { action: "continue", id: c.id }); }
      setMsg({ ok: `Sent to ${r.sent}${r.failed ? `, ${r.failed} didn't go through` : ""}${r.skipped ? `, ${r.skipped} skipped (opted out)` : ""}. Replies show up under Conversations.` });
      setBody("Hi {parent_first}! "); setExclude([]); loadSent();
    } catch (e) { setMsg({ err: e.message + " — anyone already texted won't get it twice; try again to finish." }); loadSent(); } finally { setBusy(""); }
  };

  const tabs = [["new", "New text"], ["convos", "Conversations"], ["sent", "Sent"]];
  return (
    <div style={{ margin: "-14px -18px", padding: "16px 16px 30px", background: DS.bg, minHeight: "calc(100vh - 56px)", fontFamily: DS.font, color: DS.text }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <img src={import.meta.env.BASE_URL + "dssc/logo-horizontal-white.png"} alt="Dripping Springs Sports Club" style={{ height: 28 }} />
          <Tag color={DS.lime}>Reach Texts</Tag>
          <div style={{ display: "flex", border: "1px solid " + DS.line, borderRadius: 999, overflow: "hidden" }}>
            {tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} style={{ padding: "7px 14px", border: "none", cursor: "pointer", fontFamily: DS.font, fontSize: 13, fontWeight: 800, background: tab === k ? DS.lime : "transparent", color: tab === k ? DS.bg : DS.mut }}>{l}</button>)}
          </div>
        </div>
        {loadErr && <div style={{ ...panel, color: DS.orange }}>Couldn't load Reach families: {loadErr}</div>}

        {tab === "new" && <>
          <div style={panel}>
            <div style={title}>Who</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {WHEN.map(([k, l]) => <button key={k} onClick={() => setWhen(k)} style={chip(when === k)}>{l}</button>)}
              {when === "date" && <input type="date" value={sinceDate} onChange={e => setSinceDate(e.target.value)} style={{ ...inputStyle, width: 170, colorScheme: "dark", fontSize: narrow ? 16 : 14 }} />}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              <button onClick={() => setProgram("")} style={chip(!program)}>All Reach programs</button>
              {programs.map(p => <button key={p} onClick={() => setProgram(p === program ? "" : p)} style={chip(program === p)}>{p}</button>)}
            </div>
            <div style={{ marginTop: 10, fontSize: 14 }}>
              {!audience ? <span style={{ color: DS.mut }}>Finding Reach families…</span> : <>
                <b style={{ color: DS.lime, fontSize: 18 }}>{audience.recipients.length}</b> {audience.recipients.length === 1 ? "family" : "families"} will get this
                {exclude.length ? <span style={{ color: DS.mut }}> · {exclude.length} left out</span> : null}
                {audience.skipped.length ? <span style={{ color: DS.mut }}> · {audience.skipped.length} opted out (never texted)</span> : null}
                {" "}<Btn small kind="link" onClick={() => setShowList(s => !s)}>{showList ? "Hide the list" : "See who"}</Btn>
              </>}
            </div>
            {showList && everyone && <div style={{ marginTop: 8, maxHeight: 360, overflowY: "auto", borderTop: "1px solid " + DS.line }}>
              {everyone.recipients.map(r => {
                const k = last10(r.to), out = exclude.includes(k);
                return (
                  <label key={k} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 2px", borderBottom: "1px solid " + DS.line, cursor: "pointer", opacity: out ? 0.5 : 1 }}>
                    <input type="checkbox" checked={!out} onChange={() => setExclude(out ? exclude.filter(x => x !== k) : [...exclude, k])} style={{ width: 18, height: 18, accentColor: DS.lime, flex: "none" }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{r.name}{r.players?.length ? <span style={{ fontWeight: 400, color: DS.mut }}> · {r.players.join(", ")}</span> : null}</div>
                      <div style={{ fontSize: 12, color: DS.mut }}>{fmtPhone(r.to)}{r.program ? ` · ${r.program}` : ""}</div>
                    </div>
                  </label>
                );
              })}
            </div>}
          </div>

          <div style={panel}>
            <div style={title}>Message</div>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={5} placeholder="Hi {parent_first}! …" style={{ ...inputStyle, resize: "vertical", fontSize: narrow ? 16 : 14 }} />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {MERGE.map(([tok, l]) => <button key={tok} onClick={() => setBody(b => b + (b && !/\s$/.test(b) ? " " : "") + tok)} style={{ ...chip(false), fontSize: 12, padding: "4px 10px" }}>+ {l}</button>)}
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: DS.mut }}>How it reads{sample ? ` for ${sample.name}` : ""}:</div>
            <div style={{ marginTop: 4, background: DS.panel2, borderRadius: 12, padding: "10px 12px", fontSize: 14, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{preview || <span style={{ color: DS.dim }}>Your message…</span>}</div>
            <div style={{ fontSize: 11, color: DS.dim, marginTop: 4 }}>{preview.length} characters · {segs} text{segs === 1 ? "" : "s"} each{!isGsm(preview) ? " · has emoji/special characters (shorter limit)" : ""} · families can reply STOP to opt out</div>
          </div>

          <div style={panel}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="Your cell for a test" inputMode="tel" style={{ ...inputStyle, width: 180, fontSize: narrow ? 16 : 14 }} />
              <Btn kind="ghost" disabled={!!busy || !ready || !testTo} onClick={doTest} style={narrow ? { minHeight: 44 } : {}}>{busy === "test" ? "Sending test…" : "Send me a test"}</Btn>
              <div style={{ flex: 1 }} />
              <Btn kind="primary" disabled={!!busy || !ready || !audience?.recipients.length} onClick={doSend} style={narrow ? { minHeight: 44, width: "100%" } : {}}>{busy === "send" ? "Sending…" : `Text ${audience?.recipients.length || 0} ${audience?.recipients.length === 1 ? "family" : "families"}`}</Btn>
            </div>
            {msg && <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: msg.err ? DS.orange : DS.lime }}>{msg.err || msg.ok}</div>}
          </div>
        </>}

        {tab === "convos" && <Conversations reachPhones={reachPhones} me={me} coach={coach} api={api} narrow={narrow} />}

        {tab === "sent" && <div style={panel}>
          <div style={title}>Reach texts sent</div>
          {!sent.length ? <div style={{ color: DS.mut, fontSize: 13 }}>Nothing sent yet.</div> : sent.filter(c => c.status !== "cancelled" || c.recipient_count).map(c => (
            <div key={c.id} style={{ padding: "10px 0", borderTop: "1px solid " + DS.line }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <b style={{ fontSize: 14 }}>{c.name}</b>
                <Tag color={c.status === "sent" ? DS.lime : c.status === "failed" ? DS.orange : DS.mut}>{c.status}</Tag>
                <span style={{ fontSize: 12, color: DS.mut }}>{fmtWhen(c.started_at || c.created_at)}{c.recipient_count ? ` · ${c.recipient_count} families` : ""} · {c.created_by}</span>
              </div>
              <div style={{ fontSize: 13, color: DS.mut, marginTop: 4, whiteSpace: "pre-wrap" }}>{c.body}</div>
              {c.last_error && <div style={{ fontSize: 12, color: DS.orange, marginTop: 2 }}>{c.last_error}</div>}
            </div>
          ))}
        </div>}
      </div>
    </div>
  );
}

// Reach families' conversations with the club number: the newest first, open
// one to read it and answer.
function Conversations({ reachPhones, me, coach, api, narrow }) {
  const [threads, setThreads] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const load = async () => {
    if (!reachPhones) return;
    // The Reach lane of the club's texts (shared/dssc-lanes.js): Reach's own
    // conversations, not what Hunter or Adrian are saying to the same family.
    const { data } = await supabase.from("sms_threads").select("*").eq("brand", "dssc").eq("lane", "reach").order("last_message_at", { ascending: false }).limit(1000);
    setThreads(data || []);
  };
  useEffect(() => { load(); }, [reachPhones]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = threads?.find(t => t.id === openId) || null;
  const loadMsgs = async (id) => { const { data } = await supabase.from("sms_messages").select("*").eq("thread_id", id).order("id"); setMsgs(data || []); };
  useEffect(() => { if (!openId) return; loadMsgs(openId); const t = threads?.find(x => x.id === openId); if (t?.unread_count) supabase.from("sms_threads").update({ unread_count: 0 }).eq("id", openId).then(load); }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    if (!reply.trim()) return;
    setBusy(true); setErr("");
    try { await api("/api/send-sms", { brand: "dssc", lane: "reach", to: open.phone, body: reply.trim(), contact_name: open.contact_name || open.display_name || null, contact_kind: open.contact_kind || "parent", dssc_program: open.dssc_program || "Reach", dssc_player: open.dssc_player || null, sent_by_coach_id: coach?.id || null, sent_by_label: me }); setReply(""); await loadMsgs(open.id); load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  if (!threads) return <div style={panel}><span style={{ color: DS.mut }}>Loading conversations…</span></div>;
  if (open) return (
    <div style={panel}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <Btn small kind="ghost" onClick={() => setOpenId(null)}>← Back</Btn>
        <b>{open.contact_name || open.display_name || fmtPhone(open.phone)}</b>
        <span style={{ fontSize: 12, color: DS.mut }}>{fmtPhone(open.phone)}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: narrow ? "55vh" : 480, overflowY: "auto", padding: "4px 0" }}>
        {msgs.map(m => (
          <div key={m.id} style={{ alignSelf: m.direction === "inbound" ? "flex-start" : "flex-end", maxWidth: "80%", background: m.direction === "inbound" ? DS.panel2 : "rgba(178,208,73,0.18)", border: "1px solid " + (m.direction === "inbound" ? DS.line : DS.lime), borderRadius: 12, padding: "7px 10px" }}>
            <div style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{m.body}</div>
            <div style={{ fontSize: 10, color: DS.dim, marginTop: 2 }}>{fmtWhen(m.sent_at || m.created_at)}{m.direction !== "inbound" && m.sent_by_label ? ` · ${m.sent_by_label}` : ""}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <textarea value={reply} onChange={e => setReply(e.target.value)} rows={2} placeholder="Reply…" style={{ ...inputStyle, flex: 1, resize: "vertical", fontSize: narrow ? 16 : 14 }} />
        <Btn kind="primary" disabled={busy || !reply.trim()} onClick={send} style={{ alignSelf: "flex-end", minHeight: 44 }}>{busy ? "…" : "Send"}</Btn>
      </div>
      {err && <div style={{ fontSize: 12, color: DS.orange, marginTop: 4 }}>{err}</div>}
    </div>
  );
  return (
    <div style={panel}>
      <div style={title}>Conversations with Reach families</div>
      {!threads.length ? <div style={{ color: DS.mut, fontSize: 13 }}>No conversations yet. When a Reach family replies to a text, it shows up here.</div>
        : threads.map(t => (
          <button key={t.id} onClick={() => setOpenId(t.id)} style={{ display: "flex", width: "100%", gap: 10, alignItems: "center", textAlign: "left", padding: "10px 4px", border: "none", borderTop: "1px solid " + DS.line, background: "transparent", color: DS.text, cursor: "pointer", fontFamily: DS.font }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: t.unread_count ? 800 : 600 }}>{t.contact_name || t.display_name || fmtPhone(t.phone)}{t.dssc_player ? <span style={{ fontWeight: 400, color: DS.mut }}> · {t.dssc_player}</span> : null}</div>
              <div style={{ fontSize: 12, color: DS.mut, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.last_message_direction === "inbound" ? "" : "You: "}{t.last_message_preview}</div>
            </div>
            <span style={{ fontSize: 11, color: DS.dim, whiteSpace: "nowrap" }}>{fmtWhen(t.last_message_at)}</span>
            {t.unread_count > 0 && <span style={{ minWidth: 18, height: 18, borderRadius: 9, background: DS.lime, color: DS.bg, fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{t.unread_count}</span>}
          </button>
        ))}
    </div>
  );
}
