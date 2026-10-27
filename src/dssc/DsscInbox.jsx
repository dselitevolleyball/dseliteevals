// Dripping Springs Sports Club — the shared Inbox (Drew, 20 Oct 2026: "an
// inbox on the back end that all the directors have access to and can respond
// to emails in a timely manner").
//
// Every question a family sends the club, in one place, for every director:
// the website's forms (court rentals, parties, Reach, camps, leagues, contact)
// and mail to info@drippingsportsclub.com (read by api/site-inbox-poll.js).
// A thread shows who has it and where it stands; a director answers from here
// (api/site-inbox-reply.js sends as the club, Reply-To info@) so the reply —
// and the family's answer to it — stay on the thread for everyone to see.
//
// Reads and the status / assignee / note writes go straight to Supabase with
// the director's own session (RLS: is_dssc_director()); replies go through
// the API, which sends the email and stores it.

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "../supabase";
import { DS, nrm, Btn, Tag, inputStyle, Grow, Field } from "./DsscHub.jsx";
import { DSSC_DIRECTORS, directorByEmail, directorName, canonicalDirectorEmail, initialsOf, kindLabel, SPORT_LABELS, inquirySport, DSSC_INBOX_ADDRESS } from "../../shared/dssc-directors.js";

const SPAM_RED = "#ef5350";
const STATUS = { new: ["New", DS.lime], open: ["Open", "#7FD1C3"], waiting: ["Waiting on family", DS.orange], done: ["Done", DS.dim], spam: ["Spam", SPAM_RED] };
const STATUS_KEYS = ["new", "open", "waiting", "done", "spam"];
// Spam stays out of every view but its own (Drew, Oct 27 2026).
const FILTERS = [["new", "New"], ["mine", "Mine"], ["waiting", "Waiting"], ["done", "Done"], ["all", "All"], ["spam", "Spam"]];
const SPORTS = [["volleyball", "Volleyball"], ["basketball", "Basketball"], ["reach", "Reach"], ["frontdesk", "Front desk"]];
const SPORT_COLOR = { volleyball: DS.lime, basketball: DS.orange, reach: "#7FD1C3" };
const DETAIL_LABELS = { date: "Date", time: "Time", group: "Group", sport: "Sport", age: "Age", duration: "Duration", building: "Building", players: "Players", player: "Player", level: "Level", subject: "Subject", program: "Program", budget: "Budget", notes: "Notes" };
const NARROW = 760;

const ago = (iso) => {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 7 * 86400) return Math.floor(s / 86400) + "d ago";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const fmtWhen = (iso) => iso ? new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const fmtPhone = (p) => { const s = String(p || "").replace(/\D/g, ""); if (s.length === 11 && s.startsWith("1")) return `(${s.slice(1, 4)}) ${s.slice(4, 7)}-${s.slice(7)}`; if (s.length === 10) return `(${s.slice(0, 3)}) ${s.slice(3, 6)}-${s.slice(6)}`; return p || ""; };
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "";
// The reply without the quoted history under it ("On ... wrote:").
const stripQuoted = (text) => { const t = String(text || "").replace(/\r\n?/g, "\n"); const m = /\n\s*(On [^\n]{0,200}wrote:\s*\n|-{3,}\s*Original Message\s*-{3,}|From:\s[^\n]+\n(Sent|Date):\s|_{10,}\n|>\s)/.exec(t); return (m ? t.slice(0, m.index) : t).trim(); };
const detailRows = (d) => Object.entries(d && typeof d === "object" ? d : {}).filter(([, v]) => v != null && String(v).trim() !== "" && typeof v !== "object").map(([k, v]) => [DETAIL_LABELS[k] || k[0].toUpperCase() + k.slice(1).replace(/_/g, " "), String(v)]);
const previewOf = (r) => { const m = stripQuoted(r.message).replace(/\s+/g, " ").trim(); return m || detailRows(r.details).map(([k, v]) => `${k}: ${v}`).join(" · ") || r.email; };

// Four replies a director can drop in and edit. {first} = the parent's first
// name, {player} = the player if the form named one. The API signs the email
// (name · Dripping Springs Sports Club · info@), so these end before the name.
const CANNED = [
  { key: "vb", label: "Volleyball — first session", body: `Hi {first},

Thanks for reaching out to Dripping Springs Sports Club — we'd love to get {player} on the court.

The best first step is to come to a session: our volleyball clinics and skill pods are small groups by age and level, so the coach can see where they are and point you to the right fit. The current schedule and sign-up are at drippingsportsclub.com.

If you tell me their age and how long they've played, I'll suggest the session to start with.

See you in the gym,` },
  { key: "bb", label: "Basketball — first session", body: `Hi {first},

Thanks for reaching out to Dripping Springs Sports Club — great to hear {player} wants to play basketball.

The easiest way to start is a session: our basketball clinics and skill pods are small groups by age and level, so the coaches can see where they are and get them in the right group. The schedule and sign-up are at drippingsportsclub.com.

Tell me their age and how much they've played and I'll point you to the right session.

See you in the gym,` },
  { key: "rental", label: "Rental / party — quote questions", body: `Hi {first},

Thanks for asking about court space at Dripping Springs Sports Club. To put a quote together I need a few things:

- The date(s) and start/end time you have in mind
- Roughly how many people, and their ages
- What you'll use it for (practice, games, a party, an event)
- Half court or full court, and any equipment you'd like set up

As soon as I have those I'll confirm availability and send the price.

Thanks,` },
  { key: "thanks", label: "Thanks — we're on it", body: `Hi {first},

Thanks for getting in touch with Dripping Springs Sports Club. I've got your message and I'm looking into it — I'll be back to you shortly with an answer.

Thanks,` },
];
const fill = (tpl, inq) => tpl.replace(/\{first\}/g, firstName(inq?.name) || "there").replace(/\{player\}/g, inq?.player_name || inq?.details?.player || "your player");

const chipStyle = (on, color = DS.lime) => ({ fontFamily: DS.font, fontSize: 12, fontWeight: 700, padding: "5px 11px", borderRadius: 999, cursor: "pointer", border: "1px solid " + (on ? color : DS.line), background: on ? (color === DS.lime ? DS.limeSoft : color + "22") : "transparent", color: on ? color : DS.mut, whiteSpace: "nowrap" });
const selectStyle = { ...inputStyle, width: "auto", padding: "6px 28px 6px 10px", fontSize: 13, fontWeight: 700, cursor: "pointer" };

export default function DsscInbox({ coach, initialId, onConsumedInitial, onChanged }) {
  const me = nrm(coach?.email);
  const meCanon = canonicalDirectorEmail(me);
  const myName = directorByEmail(me)?.name || coach?.display_name || me;

  const [rows, setRows] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [filter, setFilter] = useState("new");
  const [sport, setSport] = useState("");
  const [q, setQ] = useState("");
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [after, setAfter] = useState("waiting");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const [people, setPeople] = useState(DSSC_DIRECTORS.map(d => ({ email: d.email, name: d.name, role: d.role })));
  const [expanded, setExpanded] = useState(() => new Set());
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < NARROW);
  const [showList, setShowList] = useState(true);
  const fetchedSingles = useRef(new Set());
  const replyRef = useRef(null);

  // ── Data ─────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    const { data, error } = await supabase.from("site_inquiries").select("*").eq("is_test", false).order("last_message_at", { ascending: false }).limit(600);
    if (error) { setMsg({ err: /last_message_at|status/.test(error.message) ? "The inbox tables aren't set up yet — run migrations/20261020_site_inbox.sql." : error.message }); setRows(r => r || []); return; }
    setRows(data || []);
  }, []);
  useEffect(() => { load(); const iv = setInterval(load, 60000); return () => clearInterval(iv); }, [load]);
  useEffect(() => {
    // Who can be assigned: the directors, plus any approved login with dssc_role 'admin'.
    supabase.from("coaches").select("email, display_name").eq("dssc_role", "admin").eq("is_approved", true).then(({ data }) => {
      const by = new Map(DSSC_DIRECTORS.map(d => [d.email, { email: d.email, name: d.name, role: d.role }]));
      for (const c of data || []) { const e = canonicalDirectorEmail(c.email); if (e && !by.has(e)) by.set(e, { email: e, name: c.display_name || e, role: "DSSC admin" }); }
      setPeople([...by.values()]);
    });
  }, []);
  const loadMsgs = useCallback(async (id) => {
    if (!id) { setMsgs([]); return; }
    const { data } = await supabase.from("site_inbox_messages").select("*").eq("inquiry_id", id).order("created_at", { ascending: true });
    setMsgs(data || []);
  }, []);
  useEffect(() => { loadMsgs(openId); setExpanded(new Set()); }, [openId, loadMsgs]);
  // Deep link from a notification email (?view=dsscinbox&inquiry=<id>).
  useEffect(() => {
    if (!initialId || !rows) return;
    setOpenId(Number(initialId)); setFilter("all"); setSport(""); setQ(""); setShowList(false);
    onConsumedInitial?.();
  }, [initialId, rows]); // eslint-disable-line react-hooks/exhaustive-deps
  // An open thread older than the list window is fetched on its own.
  useEffect(() => {
    if (!openId || !rows || rows.some(r => r.id === openId) || fetchedSingles.current.has(openId)) return;
    fetchedSingles.current.add(openId);
    supabase.from("site_inquiries").select("*").eq("id", openId).maybeSingle().then(({ data }) => { if (data) setRows(rs => [data, ...(rs || []).filter(r => r.id !== data.id)]); });
  }, [openId, rows]);
  useEffect(() => { const f = () => setNarrow(window.innerWidth < NARROW); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);

  // ── The list ─────────────────────────────────────────────────────────────
  const isMine = (r) => !!r.assigned_to && canonicalDirectorEmail(r.assigned_to) === meCanon;
  const sportOf = (r) => inquirySport(r) || "frontdesk";
  const list = useMemo(() => {
    const words = nrm(q).split(/\s+/).filter(Boolean);
    return (rows || []).filter(r => {
      if ((filter === "spam") !== (r.status === "spam")) return false;
      if (filter === "new" && r.status !== "new") return false;
      if (filter === "mine" && !(isMine(r) && r.status !== "done")) return false;
      if (filter === "waiting" && r.status !== "waiting") return false;
      if (filter === "done" && r.status !== "done") return false;
      if (sport && sportOf(r) !== sport) return false;
      if (words.length) { const hay = nrm([r.name, r.email, r.phone, r.message, r.kind, r.player_name, r.assigned_to, JSON.stringify(r.details || {})].join(" ")); if (!words.every(w => hay.includes(w))) return false; }
      return true;
    });
  }, [rows, filter, sport, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => ({ new: (rows || []).filter(r => r.status === "new").length, mine: (rows || []).filter(r => isMine(r) && r.status !== "done").length, waiting: (rows || []).filter(r => r.status === "waiting").length, spam: (rows || []).filter(r => r.status === "spam").length }), [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = useMemo(() => (rows || []).find(r => r.id === openId) || null, [rows, openId]);

  // ── Writes ───────────────────────────────────────────────────────────────
  const patchRow = async (id, patch) => {
    setRows(rs => (rs || []).map(r => r.id === id ? { ...r, ...patch } : r));
    const { error } = await supabase.from("site_inquiries").update(patch).eq("id", id);
    if (error) { setMsg({ err: error.message }); load(); } else onChanged?.();
  };
  const setStatus = (r, status) => {
    // Into or out of Spam also blocks or unblocks the sender.
    if (status === "spam" && r.status !== "spam") return markSpam(r);
    if (r.status === "spam" && status !== "spam") return notSpam(r, status);
    return patchRow(r.id, { status, ...(status === "done" ? { handled: true, handled_at: new Date().toISOString(), handled_by: myName } : { handled: false }) });
  };
  // Spam: the thread goes to the Spam filter, and the sender is blocked, so
  // anything new from them is filed straight to Spam with no email to anyone.
  // A director's or the club's own address is never blocked.
  const markSpam = async (r) => {
    const email = nrm(r.email), blockable = email.includes("@") && !directorByEmail(email) && !/@(drippingsportsclub\.com|dselitevolleyball\.com)$/.test(email);
    await patchRow(r.id, { status: "spam", handled: true, handled_at: new Date().toISOString(), handled_by: myName });
    let blocked = false;
    if (blockable) {
      const { error } = await supabase.from("site_inbox_blocked").upsert({ email, inquiry_id: r.id, blocked_by: myName, blocked_at: new Date().toISOString() }, { onConflict: "email" });
      blocked = !error;
      if (error) console.error("block sender", error.message);
    }
    setMsg({ ok: `Marked as spam${blocked ? `. Anything new from ${email} goes straight to Spam` : ""}. "Not spam" undoes it.` });
    if (openId === r.id && filter !== "spam") { setOpenId(null); setShowList(true); }
  };
  const notSpam = async (r, status = "open") => {
    await patchRow(r.id, { status, handled: status === "done" });
    await supabase.from("site_inbox_blocked").delete().eq("email", nrm(r.email));
    setMsg({ ok: `Not spam: back in the inbox as ${STATUS[status]?.[0] || status}, and ${nrm(r.email)} isn't blocked anymore.` });
  };
  const assign = (r, email) => patchRow(r.id, { assigned_to: email || null, assigned_at: email ? new Date().toISOString() : null, ...(email && r.status === "new" ? { status: "open" } : {}) });
  const token = async () => (await supabase.auth.getSession()).data.session?.access_token || "";
  const callApi = async (body) => {
    const r = await fetch("/api/site-inbox-reply", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + await token() }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
    return d;
  };
  const send = async () => {
    if (!open || reply.trim().length < 2 || busy) return;
    setBusy("send"); setMsg(null);
    try {
      await callApi({ inquiry_id: open.id, body: reply.trim(), status: after });
      setReply(""); setMsg({ ok: `Sent to ${open.name || open.email} from ${DSSC_INBOX_ADDRESS}.` });
      await Promise.all([load(), loadMsgs(open.id)]); onChanged?.();
    } catch (e) { setMsg({ err: e.message }); }
    setBusy("");
  };
  const addNote = async () => {
    if (!open || !note.trim() || busy) return;
    setBusy("note"); setMsg(null);
    const { error } = await supabase.from("site_inbox_messages").insert({ inquiry_id: open.id, direction: "note", from_name: myName, from_email: me, body_text: note.trim(), sent_by: me });
    if (error) {
      try { await callApi({ inquiry_id: open.id, note: note.trim() }); }
      catch (e) { setMsg({ err: e.message }); setBusy(""); return; }
    }
    setNote(""); await loadMsgs(open.id); setBusy("");
  };
  const insertCanned = (key) => {
    const c = CANNED.find(x => x.key === key); if (!c || !open) return;
    setReply(fill(c.body, open));
    setAfter(key === "thanks" ? "open" : "waiting");
    setTimeout(() => replyRef.current?.querySelector("textarea")?.focus(), 0);
  };
  const openThread = (id) => { setOpenId(id); setShowList(false); setReply(""); setNote(""); setAfter("waiting"); setMsg(null); };

  // ── Pieces ───────────────────────────────────────────────────────────────
  const Row = (r) => {
    const sp = inquirySport(r), sel = r.id === openId, mine = isMine(r);
    return (
      <button key={r.id} onClick={() => openThread(r.id)} style={{ display: "block", width: "100%", textAlign: "left", background: sel ? "rgba(178,208,73,0.10)" : "transparent", border: "none", borderBottom: "1px solid " + DS.line, borderLeft: "3px solid " + (sel ? DS.lime : "transparent"), padding: "10px 12px 10px 10px", cursor: "pointer", color: DS.text, fontFamily: DS.font }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, flex: "none", background: r.status === "new" ? DS.lime : r.status === "waiting" ? DS.orange : r.status === "spam" ? SPAM_RED : "transparent", border: r.status === "open" ? "1px solid " + DS.mut : "1px solid transparent" }} />
          <b style={{ fontSize: 14, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: r.status === "done" ? 0.6 : 1 }}>{r.name || r.email}</b>
          {r.assigned_to && <span title={"Assigned to " + directorName(r.assigned_to)} style={{ fontSize: 10, fontWeight: 800, width: 22, height: 22, borderRadius: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none", background: mine ? DS.lime : "rgba(255,255,255,0.12)", color: mine ? DS.bg : DS.text }}>{initialsOf(directorName(r.assigned_to))}</span>}
          <span style={{ fontSize: 11, color: DS.dim, flex: "none" }} title={fmtWhen(r.last_message_at || r.created_at)}>{ago(r.last_message_at || r.created_at)}</span>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", margin: "4px 0 0 16px", minWidth: 0 }}>
          <Tag color={sp ? SPORT_COLOR[sp] : DS.mut}>{kindLabel(r.kind)}{sp && r.kind !== "reach" ? " · " + SPORT_LABELS[sp] : ""}</Tag>
          {r.site === "dselite" && <Tag color="#f06bb4">DS Elite</Tag>}
          <span style={{ fontSize: 12, color: DS.mut, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{previewOf(r)}</span>
        </div>
      </button>
    );
  };

  const ListPanel = (
    <div style={{ background: DS.panel, border: "1px solid " + DS.line, borderRadius: 14, overflow: "hidden", position: narrow ? "static" : "sticky", top: 70 }}>
      <div style={{ padding: "10px 10px 8px", borderBottom: "1px solid " + DS.line, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {FILTERS.map(([k, l]) => <button key={k} onClick={() => setFilter(k)} style={chipStyle(filter === k, k === "spam" ? SPAM_RED : DS.lime)}>{l}{counts[k] ? ` · ${counts[k]}` : ""}</button>)}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {SPORTS.map(([k, l]) => <button key={k} onClick={() => setSport(sport === k ? "" : k)} style={chipStyle(sport === k, SPORT_COLOR[k] || DS.mut)}>{l}</button>)}
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, email, message…" style={{ ...inputStyle, padding: "7px 10px", fontSize: 13 }} />
      </div>
      <div style={{ maxHeight: narrow ? "none" : "calc(100vh - 290px)", overflowY: "auto" }}>
        {rows == null ? <div style={{ padding: 14, color: DS.mut, fontSize: 13 }}>Loading…</div>
          : !list.length ? <div style={{ padding: 14, color: DS.mut, fontSize: 13 }}>{rows.length ? (filter === "new" ? "Nothing new — everything has been picked up." : filter === "spam" ? "No spam. Open a thread and press Spam to send it here and block its sender." : "Nothing here.") : "No messages yet. The website's forms and mail to " + DSSC_INBOX_ADDRESS + " will show up here."}</div>
          : list.map(Row)}
      </div>
    </div>
  );

  const ThreadPanel = !open ? (
    <div style={{ background: DS.panel, border: "1px dashed " + DS.lineStrong, borderRadius: 14, padding: 28, color: DS.mut, fontSize: 14, textAlign: "center" }}>
      {counts.new ? `${counts.new} new ${counts.new === 1 ? "message is" : "messages are"} waiting — pick one on the left.` : "Pick a thread to read it and reply."}
    </div>
  ) : (() => {
    const sp = inquirySport(open);
    const [sLabel, sColor] = STATUS[open.status] || STATUS.new;
    const details = detailRows(open.details);
    const shown = msgs.length ? msgs : (open.message ? [{ id: "orig", direction: "in", from_name: open.name, from_email: open.email, body_text: open.message, created_at: open.created_at }] : []);
    const assigneeKnown = !open.assigned_to || people.some(p => p.email === canonicalDirectorEmail(open.assigned_to));
    return (
      <div style={{ background: DS.panel, border: "1px solid " + DS.line, borderRadius: 14, overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid " + DS.line }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {narrow && <Btn small kind="quiet" onClick={() => setShowList(true)}>← Inbox</Btn>}
            <div style={{ fontSize: 18, fontWeight: 800, flex: 1, minWidth: 160 }}>{open.name || open.email}</div>
            <Tag color={sColor} fill={open.status === "new"}>{sLabel}</Tag>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 13, color: DS.mut, marginTop: 6, alignItems: "center" }}>
            <a href={"mailto:" + open.email} style={{ color: DS.lime }}>{open.email}</a>
            {open.phone && <a href={"tel:" + open.phone} style={{ color: DS.mut }}>{fmtPhone(open.phone)}</a>}
            <Tag color={sp ? SPORT_COLOR[sp] : DS.mut}>{kindLabel(open.kind)}{sp && open.kind !== "reach" ? " · " + SPORT_LABELS[sp] : ""}</Tag>
            {open.site === "dselite" && <Tag color="#f06bb4">DS Elite site</Tag>}
            <span title={fmtWhen(open.created_at)}>in {ago(open.created_at)}{open.source_path ? " · " + open.source_path : ""}</span>
          </div>
          {(details.length || open.player_name || open.age_group) ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "6px 14px", marginTop: 10, fontSize: 13 }}>
              {open.player_name && <div><span style={{ color: DS.dim }}>Player </span>{open.player_name}</div>}
              {open.age_group && <div><span style={{ color: DS.dim }}>Age group </span>{open.age_group}</div>}
              {details.map(([k, v]) => <div key={k}><span style={{ color: DS.dim }}>{k} </span>{v}</div>)}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
            <label style={{ fontSize: 12, color: DS.mut }}>Status</label>
            <select value={open.status || "new"} onChange={e => setStatus(open, e.target.value)} style={selectStyle}>
              {STATUS_KEYS.map(k => <option key={k} value={k}>{STATUS[k][0]}</option>)}
            </select>
            <label style={{ fontSize: 12, color: DS.mut, marginLeft: 6 }}>Assigned to</label>
            <select value={open.assigned_to ? canonicalDirectorEmail(open.assigned_to) : ""} onChange={e => assign(open, e.target.value)} style={selectStyle}>
              <option value="">Nobody yet</option>
              {people.map(p => <option key={p.email} value={p.email}>{p.name}{p.email === meCanon ? " (me)" : ""}</option>)}
              {!assigneeKnown && <option value={canonicalDirectorEmail(open.assigned_to)}>{open.assigned_to}</option>}
            </select>
            {!isMine(open) && <Btn small kind="primary" onClick={() => assign(open, meCanon)}>I've got it</Btn>}
            {open.status !== "done" && open.status !== "spam" && <Btn small kind="quiet" onClick={() => setStatus(open, "done")}>Mark done</Btn>}
            {open.status !== "spam"
              ? <Btn small kind="quiet" onClick={() => markSpam(open)} style={{ color: SPAM_RED, borderColor: "rgba(239,83,80,0.4)" }} title="Move to Spam and block this sender: anything new from them goes straight to Spam, with no email to anyone">🚫 Spam</Btn>
              : <Btn small kind="primary" onClick={() => notSpam(open)} title="Back to the inbox as Open, and unblock the sender">Not spam</Btn>}
          </div>
          {open.status === "spam" && <div style={{ marginTop: 10, fontSize: 13, color: SPAM_RED, background: "rgba(239,83,80,0.08)", border: "1px solid rgba(239,83,80,0.3)", borderRadius: 10, padding: "8px 10px" }}>Marked as spam. Anything new from {open.email} is filed here, and nobody is emailed about it.</div>}
          <div style={{ marginTop: 10 }}>
            <Field multiline minRows={1} value={open.note || ""} placeholder="Pinned note for the directors (what's agreed, what's pending)…" onSave={(v) => patchRow(open.id, { note: v || null })} style={{ fontSize: 13, padding: "7px 10px", background: "rgba(255,115,0,0.06)", borderColor: "rgba(255,115,0,0.25)" }} />
          </div>
        </div>

        <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10, maxHeight: narrow ? "none" : "48vh", overflowY: "auto", background: "rgba(0,0,0,0.12)" }}>
          {!shown.length && <div style={{ color: DS.mut, fontSize: 13 }}>No messages on this thread yet.</div>}
          {shown.map(m => {
            const out = m.direction === "out", isNote = m.direction === "note";
            const full = String(m.body_text || "").trim(), short = out || isNote ? full : stripQuoted(full);
            const clipped = short.length < full.length - 20 && !expanded.has(m.id);
            const who = isNote ? "Note · " + (m.from_name || directorName(m.sent_by)) : out ? (m.from_name || directorName(m.sent_by)) + " → " + (m.to_email || open.email) : (m.from_name || m.from_email || open.name);
            return (
              <div key={m.id} style={{ alignSelf: out ? "flex-end" : "stretch", width: isNote ? "100%" : undefined, maxWidth: isNote ? "100%" : "94%", boxSizing: "border-box", background: isNote ? "rgba(255,115,0,0.10)" : out ? "rgba(178,208,73,0.12)" : DS.panel2, border: "1px solid " + (isNote ? "rgba(255,115,0,0.35)" : out ? "rgba(178,208,73,0.35)" : DS.line), borderRadius: 12, padding: "10px 12px" }}>
                <div style={{ fontSize: 11, color: DS.mut, marginBottom: 4, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                  <b style={{ color: isNote ? DS.orange : out ? DS.lime : DS.text }}>{who}</b>
                  {m.subject && !isNote && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }}>· {m.subject}</span>}
                  <span style={{ marginLeft: "auto" }} title={fmtWhen(m.created_at)}>{ago(m.created_at)}</span>
                </div>
                <div style={{ fontSize: 14, whiteSpace: "pre-wrap", lineHeight: 1.5, wordBreak: "break-word" }}>{(clipped ? short : full) || "(no text)"}</div>
                {short.length < full.length - 20 && <button onClick={() => setExpanded(s => { const n = new Set(s); n.has(m.id) ? n.delete(m.id) : n.add(m.id); return n; })} style={{ background: "none", border: "none", color: DS.dim, fontSize: 12, padding: "4px 0 0", cursor: "pointer", fontFamily: DS.font }}>{clipped ? "Show quoted text" : "Hide quoted text"}</button>}
              </div>
            );
          })}
        </div>

        <div style={{ padding: 14, borderTop: "1px solid " + DS.line, display: "flex", flexDirection: "column", gap: 10 }}>
          {msg?.ok && <div style={{ color: DS.lime, fontWeight: 700, fontSize: 13 }}>{msg.ok}</div>}
          {msg?.err && <div style={{ color: DS.orange, fontWeight: 700, fontSize: 13 }}>{msg.err}</div>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: DS.lime }}>Reply to {firstName(open.name) || open.email}</span>
            <span style={{ flex: 1 }} />
            <select value="" onChange={e => insertCanned(e.target.value)} style={selectStyle}>
              <option value="">Insert a canned reply…</option>
              {CANNED.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div ref={replyRef}><Grow value={reply} onChange={e => setReply(e.target.value)} minRows={4} placeholder={`Hi ${firstName(open.name) || "there"},`} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send(); }} /></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Btn kind="primary" disabled={busy === "send" || reply.trim().length < 2} onClick={send}>{busy === "send" ? "Sending…" : "Send reply"}</Btn>
            <label style={{ fontSize: 12, color: DS.mut }}>then mark</label>
            <select value={after} onChange={e => setAfter(e.target.value)} style={selectStyle}>
              <option value="waiting">Waiting on family</option>
              <option value="open">Open (still ours)</option>
              <option value="done">Done</option>
            </select>
            <span style={{ fontSize: 12, color: DS.dim, flex: 1, minWidth: 200 }}>Signed {myName} · {open.site === "dselite" ? "DS Elite Volleyball" : "Dripping Springs Sports Club"} · replies come back to {open.site === "dselite" ? "DS Elite" : DSSC_INBOX_ADDRESS}{!isMine(open) && !open.assigned_to ? " · sending assigns it to you" : ""}</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 4 }}>
            <input value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addNote(); }} placeholder="Internal note — the family never sees this" style={{ ...inputStyle, padding: "8px 10px", fontSize: 13, borderColor: "rgba(255,115,0,0.3)" }} />
            <Btn kind="warn" small disabled={busy === "note" || !note.trim()} onClick={addNote} style={{ padding: "9px 13px" }}>{busy === "note" ? "…" : "Add note"}</Btn>
          </div>
        </div>
      </div>
    );
  })();

  return (
    <div style={{ margin: "-14px -18px", padding: "16px 16px 48px", background: DS.bg, minHeight: "calc(100vh - 56px)", fontFamily: DS.font, color: DS.text }}>
      <div style={{ maxWidth: 1240, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
          <div style={{ fontSize: 24, fontWeight: 800 }}>Inbox</div>
          {counts.new > 0 && <Tag color={DS.lime} fill>{counts.new} new</Tag>}
          <div style={{ flex: 1 }} />
          <Btn small kind="quiet" onClick={() => { load(); if (openId) loadMsgs(openId); }}>Refresh</Btn>
        </div>
        <div style={{ fontSize: 13, color: DS.mut, marginBottom: 14 }}>Everything families send the club — the website's forms and mail to {DSSC_INBOX_ADDRESS} — for all the directors. Reply from here: it goes out as the club and their answer lands back on the same thread, so everyone can see what's been handled.</div>
        {msg?.err && !open && <div style={{ color: DS.orange, fontWeight: 700, fontSize: 13, marginBottom: 10 }}>{msg.err}</div>}
        <div style={narrow ? { display: "block" } : { display: "grid", gridTemplateColumns: "minmax(300px, 400px) minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
          {(!narrow || showList) && ListPanel}
          {(!narrow || !showList) && ThreadPanel}
        </div>
      </div>
    </div>
  );
}
