// 💡 Feedback (Drew, Oct 28 2026): on every HQ screen, for everyone signed
// in. An idea, an improvement or a bug - with which screen it came from and an
// optional picture - goes to the Product board's Inbox, where Drew approves or
// declines it (the sender gets an email either way). "My requests" shows where
// each of theirs is. Server: api/product.js (request, mine).

import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import { viewLabel } from "./Nav.jsx";
import { STATUS_LABEL } from "../shared/product.js";
import { HQ_DSSC } from "./hq-base.js";

// Each business's own colors: DS Elite black + pink, DSSC evergreen + lime
// (the DSSC side of HQ and drippingsportsclub.com/hq).
const THEMES = {
  dse: { card: "#141414", field: "#0a0a0a", border: "#2a2a2a", gold: "#e91e8c", soft: "rgba(233,30,140,0.14)", onAccent: "#000", fab: "rgba(20,20,20,0.94)", text: "#fff", mut: "#999999", grn: "#22c55e", red: "#ef4444" },
  dssc: { card: "#0C3A37", field: "#082C2A", border: "#1F5A55", gold: "#B2D049", soft: "rgba(178,208,73,0.16)", onAccent: "#082C2A", fab: "rgba(12,58,55,0.96)", text: "#fff", mut: "#A9C7C3", grn: "#B2D049", red: "#FF7A59" },
};
const KINDS = [["feature", "💡 New idea", "What should HQ do that it doesn't?"], ["improvement", "✨ Make it better", "What's clunky or could be easier?"], ["bug", "🐞 Something's broken", "What happened, and what did you expect?"]];
const STATUS_TEXT = { inbox: "Waiting for Drew", backlog: "Approved", planned: "Planned", building: "Being built", review: "Almost ready", shipped: "Live ✓", declined: "Not now", canceled: "Canceled" };
const AREA = (view, app) => /marketing/.test(view) ? "Marketing" : /time|hours|pay|claims|expenses/.test(view) ? "Time cards & pay" : /message|texts|inbox|email/.test(view) ? "Texts & email" : app === "dssc" ? "DSSC HQ" : "DS Elite HQ";

async function api(action, payload = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch("/api/product", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (session?.access_token || "") }, body: JSON.stringify({ action, ...payload }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
  return d;
}

// A picture shrunk to 1600px and re-encoded as JPEG (drops EXIF, keeps it small).
function shrink(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that picture")); };
    img.src = url;
  });
}

export default function FeedbackButton({ view, workspace, narrow, phoneNav }) {
  const C = THEMES[HQ_DSSC || workspace === "dssc" ? "dssc" : "dse"];
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("send");
  const [kind, setKind] = useState("feature");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [shot, setShot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [sent, setSent] = useState(null);
  const [mine, setMine] = useState(null);
  useEffect(() => { if (open && tab === "mine") api("mine").then(d => setMine(d.items)).catch(e => setMsg({ err: e.message })); }, [open, tab]);
  useEffect(() => { if (!open) return; const k = (e) => { if (e.key === "Escape") setOpen(false); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [open]);

  const reset = () => { setTitle(""); setBody(""); setShot(null); setMsg(null); setSent(null); setKind("feature"); };
  const send = async () => {
    if (title.trim().length < 3) { setMsg({ err: "Give it a short title." }); return; }
    setBusy(true); setMsg(null);
    try {
      const d = await api("request", { title, body, kind, area: AREA(view || "", workspace), screenshot: shot, context: { view, view_label: viewLabel(view), app: workspace, url: location.pathname + location.search, ua: navigator.userAgent } });
      setSent(d.key); setTitle(""); setBody(""); setShot(null);
    } catch (e) { setMsg({ err: e.message }); }
    setBusy(false);
  };
  const pick = async (f) => { if (!f) return; try { setShot(await shrink(f)); } catch (e) { setMsg({ err: e.message }); } };
  const k = KINDS.find(x => x[0] === kind);
  const input = { width: "100%", boxSizing: "border-box", background: C.field, border: "1px solid " + C.border, borderRadius: 10, color: C.text, fontFamily: "inherit", fontSize: 15, padding: "10px 12px" };

  return (
    <>
      <button onClick={() => { setOpen(true); setTab("send"); }} title="Send an idea or report a problem with HQ"
        style={{ position: "fixed", right: narrow ? 12 : 18, bottom: phoneNav ? 78 : 18, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minWidth: 52, minHeight: 52, padding: narrow ? "12px 14px" : "12px 20px", borderRadius: 999, border: "1px solid " + C.border, background: C.fab, color: C.text, fontWeight: 800, fontSize: 16, cursor: "pointer", boxShadow: "0 6px 24px rgba(0,0,0,0.45)", fontFamily: "inherit", boxSizing: "border-box" }}>
        <span style={{ fontSize: 22, lineHeight: 1 }}>💡</span>{!narrow && <span>Feedback</span>}
      </button>
      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: narrow ? "flex-end" : "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: narrow ? "100%" : 520, maxHeight: narrow ? "92vh" : "86vh", overflowY: "auto", background: C.card, border: "1px solid " + C.border, borderRadius: narrow ? "16px 16px 0 0" : 16, padding: 18, color: C.text, boxSizing: "border-box", fontFamily: "inherit" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <div><div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, color: C.gold, textTransform: "uppercase" }}>{HQ_DSSC || workspace === "dssc" ? "Dripping Springs Sports Club" : "DS Elite Volleyball"} · HQ</div><b style={{ fontSize: 17 }}>Help make HQ better</b></div>
              <div style={{ flex: 1 }} />
              {[["send", "Send"], ["mine", "My requests"]].map(([t, l]) => <button key={t} onClick={() => { setTab(t); setMsg(null); }} style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid " + (tab === t ? C.gold : C.border), background: "transparent", color: tab === t ? C.gold : C.text, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{l}</button>)}
              <button onClick={() => setOpen(false)} aria-label="Close" style={{ background: "none", border: "none", color: C.mut, fontSize: 20, cursor: "pointer" }}>×</button>
            </div>

            {tab === "send" && (sent ? (
              <div style={{ textAlign: "center", padding: "18px 6px" }}>
                <div style={{ fontSize: 40 }}>🙌</div>
                <div style={{ fontSize: 17, fontWeight: 800, margin: "6px 0" }}>Thanks - got it ({sent})</div>
                <div style={{ color: C.mut, fontSize: 14, lineHeight: 1.5 }}>Drew will look at it. You'll get an email when it's approved, and you can follow it under My requests.</div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14 }}>
                  <button onClick={reset} style={{ padding: "9px 14px", borderRadius: 10, border: "1px solid " + C.border, background: "transparent", color: C.text, fontWeight: 800, cursor: "pointer" }}>Send another</button>
                  <button onClick={() => { reset(); setOpen(false); }} style={{ padding: "9px 14px", borderRadius: 10, border: "none", background: C.gold, color: C.onAccent, fontWeight: 800, cursor: "pointer" }}>Done</button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "1fr 1fr 1fr", gap: 6 }}>
                  {KINDS.map(([v, l]) => <button key={v} onClick={() => setKind(v)} style={{ padding: "10px 8px", borderRadius: 10, border: "1px solid " + (kind === v ? C.gold : C.border), background: kind === v ? C.soft : "transparent", color: C.text, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>{l}</button>)}
                </div>
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder={kind === "bug" ? "What's broken? (one line)" : "Your idea in one line"} maxLength={200} style={{ ...input, marginTop: 12, fontWeight: 700 }} />
                <textarea value={body} onChange={e => setBody(e.target.value)} rows={5} placeholder={k[2] + " The more detail, the better."} style={{ ...input, marginTop: 8, lineHeight: 1.45, resize: "vertical" }} />
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                  <label style={{ fontSize: 13, color: C.mut, cursor: "pointer", border: "1px dashed " + C.border, borderRadius: 10, padding: "8px 12px" }}>
                    📷 {shot ? "Change picture" : "Add a screenshot"}<input type="file" accept="image/*" onChange={e => pick(e.target.files?.[0])} style={{ display: "none" }} />
                  </label>
                  {shot && <><img src={shot} alt="" style={{ height: 44, borderRadius: 6, border: "1px solid " + C.border }} /><button onClick={() => setShot(null)} style={{ background: "none", border: "none", color: C.mut, cursor: "pointer", fontSize: 12 }}>remove</button></>}
                </div>
                <div style={{ fontSize: 12, color: C.mut, marginTop: 10 }}>From: <b style={{ color: C.text }}>{viewLabel(view)}</b> ({workspace === "dssc" ? "DSSC" : "DS Elite"})</div>
                {msg?.err && <div style={{ color: C.red, fontSize: 13, marginTop: 8 }}>{msg.err}</div>}
                <button disabled={busy} onClick={send} style={{ width: "100%", marginTop: 12, padding: 12, borderRadius: 10, border: "none", background: C.gold, color: C.onAccent, fontWeight: 900, fontSize: 15, cursor: "pointer" }}>{busy ? "Sending…" : "Send to Drew"}</button>
              </>
            ))}

            {tab === "mine" && (
              <div>
                {msg?.err && <div style={{ color: C.red, fontSize: 13 }}>{msg.err}</div>}
                {!mine ? <div style={{ color: C.mut }}>Loading…</div> : !mine.length ? <div style={{ color: C.mut, fontSize: 14 }}>You haven't sent anything yet.</div> : mine.map(i => (
                  <div key={i.id} style={{ borderTop: "1px solid " + C.border, padding: "10px 0" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                      <b style={{ flex: 1, fontSize: 14 }}>{i.title}</b>
                      <span style={{ fontSize: 12, fontWeight: 800, color: i.status === "shipped" ? C.grn : i.status === "declined" ? C.mut : C.gold, whiteSpace: "nowrap" }}>{STATUS_TEXT[i.status] || STATUS_LABEL[i.status]}</span>
                    </div>
                    <div style={{ fontSize: 12, color: C.mut }}>HQ-{i.id} · sent {new Date(i.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}{i.decision_note ? ` · "${i.decision_note}"` : ""}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
