// Shared plumbing for the DSSC shared inbox (api/site-inbox.js intake,
// api/site-inbox-reply.js, api/site-inbox-poll.js): who the directors are,
// who gets told, sending through Resend, and the notification email a
// director receives with a link straight to the thread in HQ.
//
// Env: RESEND_API_KEY, DSSC_FROM_EMAIL (fallback DSE_FROM_EMAIL),
//      DSSC_INBOX_ADDRESS (default info@drippingsportsclub.com),
//      DSSC_INBOX_ROUTES (optional JSON: sport/kind -> comma list of emails).

import { randomBytes, timingSafeEqual } from "node:crypto";
import { esc } from "./site-forms.js";
import { resendKeyFor } from "./resend-key.js";
import {
  DSSC_DIRECTORS, DSSC_INBOX_ADDRESS, directorByEmail, directorEmails, isDirectorEmail, directorName, canonicalDirectorEmail,
  KIND_LABELS, KINDS, kindLabel, SPORT_LABELS, normSport, inquirySport, routeInquiry, inboxThreadUrl,
} from "../../shared/dssc-directors.js";

export { DSSC_DIRECTORS, DSSC_INBOX_ADDRESS, directorByEmail, directorEmails, isDirectorEmail, directorName, canonicalDirectorEmail, KIND_LABELS, KINDS, kindLabel, SPORT_LABELS, normSport, inquirySport, routeInquiry, inboxThreadUrl, esc };

export const nrm = (v) => String(v || "").trim().toLowerCase();
export const isEmailish = (s) => /^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i.test(String(s || ""));
export const STATUSES = ["new", "open", "waiting", "done"];

// Constant-time token compare (pattern: api/expense-inbox.js).
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a || "")), bb = Buffer.from(String(b || ""));
  if (!ba.length || ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export const addrOf = (from) => { const m = String(from || "").match(/<([^>]+)>/); return nrm(m ? m[1] : from); };
export const resendKey = () => process.env.RESEND_API_KEY || process.env.resend_api_key || "";
export const inboxAddress = () => nrm(process.env.DSSC_INBOX_ADDRESS) || DSSC_INBOX_ADDRESS;
// Mail goes out as the club. Without DSSC_FROM_EMAIL it borrows the DS Elite
// sending address (verified in Resend) under the club's name.
export function dsscFrom() {
  const own = String(process.env.DSSC_FROM_EMAIL || "").trim();
  if (own) return own;
  const dse = addrOf(process.env.DSE_FROM_EMAIL);
  return dse ? `Dripping Springs Sports Club <${dse}>` : "";
}
export function envRoutes() {
  try { const j = JSON.parse(process.env.DSSC_INBOX_ROUTES || "null"); return j && typeof j === "object" && !Array.isArray(j) ? j : null; }
  catch { return null; }
}
export const routeFor = (inq) => routeInquiry({ kind: inq?.kind, sport: inq?.sport }, envRoutes());

// Addresses that are "us": mail from these is never a family writing in.
export function isOurAddress(email) {
  const e = nrm(email);
  if (!e) return true;
  if (isDirectorEmail(e) || e === inboxAddress() || e === addrOf(dsscFrom()) || e === addrOf(process.env.DSE_FROM_EMAIL)) return true;
  return /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce[s]?|notifications?)@/i.test(e) || /@(resend\.(com|dev)|bounces\.|amazonses\.com)$/i.test(e);
}

// Our own Message-ID on mail we send, so a family's reply carries it back in
// In-Reply-To / References and the poller can land it on the right thread.
export function newMessageId() {
  const domain = (addrOf(dsscFrom()).split("@")[1] || "drippingsportsclub.com").replace(/[^a-z0-9.-]/gi, "");
  return `<dssc-inbox-${Date.now().toString(36)}-${randomBytes(6).toString("hex")}@${domain}>`;
}

// One Resend send. Returns { ok, id, status, error }.
export async function sendResend({ from, to, cc, bcc, reply_to, subject, html, text, headers }) {
  const key = resendKeyFor(from);
  if (!key) return { ok: false, error: "RESEND_API_KEY is not set" };
  if (!from) return { ok: false, error: "DSSC_FROM_EMAIL / DSE_FROM_EMAIL is not set" };
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(nrm).filter(isEmailish);
  const toList = list(to);
  if (!toList.length) return { ok: false, error: "no recipient" };
  const payload = { from, to: toList, subject: String(subject || "").slice(0, 200), html, text };
  const ccList = list(cc).filter(e => !toList.includes(e));
  if (ccList.length) payload.cc = ccList;
  const bccList = list(bcc).filter(e => !toList.includes(e) && !ccList.includes(e));
  if (bccList.length) payload.bcc = bccList;
  if (reply_to) payload.reply_to = reply_to;
  if (headers && Object.keys(headers).length) payload.headers = headers;
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: r.status, error: d?.message || d?.error || ("Resend " + r.status) };
    return { ok: true, id: d?.id || null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Who is calling: the Bearer JWT -> Supabase user -> a DSSC director?
// (pattern: api/dssc-people.js). The service-role key also passes, as Drew.
export async function verifyDirector(sb, req) {
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return { error: "Sign in first", status: 401 };
  if (process.env.SUPABASE_SERVICE_ROLE_KEY && safeEqual(bearer, process.env.SUPABASE_SERVICE_ROLE_KEY)) return { me: "drew@drippingsportsclub.com", name: "Drew Rose", row: null };
  const { data: { user } = {} } = await sb.auth.getUser(bearer).catch(() => ({ data: {} }));
  const me = nrm(user?.email);
  if (!me) return { error: "Sign in first", status: 401 };
  const { data: row } = await sb.from("coaches").select("display_name, is_admin, is_approved, dssc_role").ilike("email", me).maybeSingle();
  const ok = isDirectorEmail(me) || !!(row?.is_approved && (row.is_admin || row.dssc_role === "admin"));
  if (!ok) return { error: "The inbox is for the club's directors", status: 403 };
  return { me, name: directorByEmail(me)?.name || row?.display_name || me, row };
}

// The subject a thread is known by: the family's own subject (minus Re:/Fwd:)
// when it started as an email, otherwise what the form was about.
export function threadSubject(inq, firstIn) {
  const raw = String(firstIn?.subject || inq?.details?.subject || "").replace(/^\s*((re|fwd?|aw|wg)\s*:\s*)+/i, "").trim();
  if (raw) return raw.slice(0, 150);
  const sp = inquirySport(inq);
  return [kindLabel(inq?.kind), sp && sp !== "reach" ? SPORT_LABELS[sp] : null].filter(Boolean).join(" · ") + " — Dripping Springs Sports Club";
}

// Strip the quoted history under a reply for previews ("On ... wrote:").
export function stripQuoted(text) {
  const t = String(text || "").replace(/\r\n?/g, "\n");
  const m = /\n\s*(On [^\n]{0,200}wrote:\s*\n|-{3,}\s*Original Message\s*-{3,}|From:\s[^\n]+\n(Sent|Date):\s|_{10,}\n|>\s)/.exec(t);
  return (m ? t.slice(0, m.index) : t).trim();
}
export const preview = (text, n = 160) => String(text || "").replace(/\s+/g, " ").trim().slice(0, n);

const DETAIL_LABELS = { date: "Date", time: "Time", group: "Group size", sport: "Sport", age: "Age", duration: "Duration", building: "Building", players: "Players", player: "Player", level: "Level", subject: "Subject", program: "Program" };
export const detailRows = (details) => Object.entries(details && typeof details === "object" ? details : {})
  .filter(([, v]) => v != null && String(v).trim() !== "" && typeof v !== "object")
  .map(([k, v]) => [DETAIL_LABELS[k] || (k[0].toUpperCase() + k.slice(1).replace(/_/g, " ")), String(v)]);

// The email a director gets: the fields, the message, the thread link.
//   reason  'new'     a form came in / a new email started a thread
//           'reply'   a family wrote back on an existing thread
export function notificationEmail(inq, msg, { reason = "new" } = {}) {
  const sp = inquirySport(inq);
  const label = [kindLabel(inq.kind), sp ? SPORT_LABELS[sp] : null].filter(Boolean).join(" · ");
  const who = inq.name || inq.email;
  const subject = (reason === "reply" ? `${who} replied · ${label}` : `New ${label.toLowerCase()} inquiry — ${who}`).slice(0, 180);
  const rows = [["From", `${inq.name || ""} <${inq.email}>`.trim()], ["Phone", inq.phone || ""], ...detailRows(inq.details), ["Page", inq.source_path || ""], ["Assigned to", inq.assigned_to ? directorName(inq.assigned_to) : ""]].filter(([, v]) => v);
  const body = stripQuoted(msg?.body_text || inq.message || "") || "(no message — see the details above)";
  const link = inboxThreadUrl(inq.id);
  const html = `<div style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#191919;max-width:640px">
<p style="margin:0 0 10px"><b>${esc(reason === "reply" ? `${who} wrote back` : `New ${label.toLowerCase()} inquiry`)}</b> <span style="color:#667">· ${esc(reason === "reply" ? "DSSC inbox" : "drippingsportsclub.com")}</span></p>
<table style="border-collapse:collapse;font-size:14px">${rows.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#666;vertical-align:top">${esc(k)}</td><td style="padding:2px 0">${esc(v)}</td></tr>`).join("")}</table>
<div style="margin:14px 0;padding:12px 14px;background:#f1f5f4;border-radius:8px;white-space:pre-wrap">${esc(body.slice(0, 4000))}</div>
<p style="margin:16px 0"><a href="${link}" style="display:inline-block;background:#B2D049;color:#104946;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:700">Open the thread in HQ →</a></p>
<p style="color:#888;font-size:12px">Reply from HQ so the thread stays together and the other directors can see it was answered. Replying to this email answers ${esc(who)} directly from your own address instead${inboxAddress() ? ` — if you do, CC ${esc(inboxAddress())} so HQ keeps a copy` : ""}.</p></div>`;
  const text = `${reason === "reply" ? `${who} wrote back` : `New ${label.toLowerCase()} inquiry`}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${body.slice(0, 4000)}\n\nOpen the thread in HQ: ${link}\n\nReply from HQ so the thread stays together. Replying to this email answers ${who} directly from your own address instead (CC ${inboxAddress()} so HQ keeps a copy).`;
  return { subject, html, text };
}

// Tell the right directors about a message: the assignee when the thread has
// one, otherwise the routed directors; Drew copied. Returns true when sent.
export async function notifyDirectors(inq, msg, opts = {}) {
  const route = routeFor(inq);
  const assignee = nrm(inq.assigned_to);
  const to = assignee && isEmailish(assignee) ? [assignee] : route.to;
  const cc = route.cc.filter(e => !to.includes(e));
  const { subject, html, text } = notificationEmail(inq, msg, opts);
  const r = await sendResend({ from: dsscFrom(), to, cc, reply_to: isEmailish(inq.email) ? inq.email : undefined, subject, html, text });
  if (!r.ok) console.error("site-inbox notify", inq.id, r.error);
  return r.ok;
}
