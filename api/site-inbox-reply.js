// POST /api/site-inbox-reply — a director answers a family from the shared
// inbox (HQ -> DSSC -> Inbox), or leaves an internal note on the thread.
//
//   Authorization: Bearer <Supabase session token> of a DSSC director
//   { inquiry_id, body, status? }   email the family; stores an 'out' message,
//                                   status -> 'waiting' (or the one passed),
//                                   assigns the thread to the sender if nobody has it
//   { inquiry_id, note, status? }   store a 'note' row, no email
//   200 { ok: true, message, status }
//
// The reply goes out from the director who wrote it ("Jonathan DelaRosa
// <jonathan@drippingsportsclub.com>"), with Reply-To that director and
// info@drippingsportsclub.com (DSSC_INBOX_ADDRESS) and a blind copy to the
// director. The family's answer reaches the director's mailbox and the one
// api/site-inbox-poll.js reads, so it lands on this same thread. A director
// without an @drippingsportsclub.com address, or DSSC_INBOX_REPLY_AS=club,
// sends as the club (DSSC_FROM_EMAIL). A DS Elite website thread
// (site = 'dselite') is answered from the DS Elite address.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, DSSC_FROM_EMAIL
//      (fallback DSE_FROM_EMAIL), DSSC_INBOX_ADDRESS (optional), DSE_REPLY_TO (optional).

import { createClient } from "@supabase/supabase-js";
import { longStr, str, esc } from "./_lib/site-forms.js";
import { verifyDirector, sendResend, dsscFrom, addrOf, inboxAddress, newMessageId, threadSubject, canonicalDirectorEmail, STATUSES, isEmailish, nrm } from "./_lib/site-inbox.js";
import { directorByEmail } from "../shared/dssc-directors.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "POST only" }); }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const who = await verifyDirector(sb, req);
  if (who.error) return res.status(who.status).json({ error: who.error });
  const { me, name } = who;

  let body = req.body; try { body = typeof body === "string" ? JSON.parse(body) : (body || {}); } catch { return res.status(400).json({ error: "Invalid JSON" }); }
  const inquiryId = Number(body.inquiry_id);
  if (!Number.isInteger(inquiryId) || inquiryId <= 0) return res.status(400).json({ error: "inquiry_id is required" });
  const status = STATUSES.includes(body.status) ? body.status : null;

  const { data: inq, error: qErr } = await sb.from("site_inquiries").select("*").eq("id", inquiryId).maybeSingle();
  if (qErr) return res.status(500).json({ error: qErr.message });
  if (!inq) return res.status(404).json({ error: "That thread no longer exists" });

  // ── An internal note: stored, never emailed ───────────────────────────────
  if (typeof body.note === "string") {
    const note = longStr(body.note, 5000);
    if (!note) return res.status(400).json({ error: "Write the note first" });
    const { data: row, error } = await sb.from("site_inbox_messages").insert({ inquiry_id: inq.id, direction: "note", from_name: name, from_email: me, body_text: note, sent_by: me }).select("*").single();
    if (error) return res.status(500).json({ error: error.message });
    const patch = { last_message_at: new Date().toISOString() };
    if (status) patch.status = status;
    await sb.from("site_inquiries").update(patch).eq("id", inq.id);
    return res.status(200).json({ ok: true, message: row, status: status || inq.status });
  }

  // ── A reply to the family ─────────────────────────────────────────────────
  const text = longStr(body.body, 10000);
  if (text.length < 2) return res.status(400).json({ error: "Write the reply first" });
  if (!isEmailish(inq.email)) return res.status(400).json({ error: "This thread has no email address to reply to" });

  const { data: msgs } = await sb.from("site_inbox_messages").select("id, direction, subject, message_id, references_ids, created_at").eq("inquiry_id", inq.id).order("created_at", { ascending: true });
  const inbound = (msgs || []).filter(m => m.direction === "in");
  const firstIn = inbound[0] || null;
  const lastWithId = [...inbound].reverse().find(m => m.message_id && /^<.+@.+>$/.test(m.message_id)) || null;
  const subject = ("Re: " + threadSubject(inq, firstIn)).slice(0, 180);

  const dse = inq.site === "dselite";
  // A DSSC reply goes out from the director who wrote it (Drew, Oct 26 2026:
  // "when Jonathan responds in the HQ inbox it comes from his email"), on the
  // club's verified domain. The family's answer goes to that director and to
  // info@, so it still lands on this thread, and the director gets a copy in
  // their own mailbox. A director without an @drippingsportsclub.com address,
  // or DSSC_INBOX_REPLY_AS=club, sends as the club as before.
  const dir = !dse && process.env.DSSC_INBOX_REPLY_AS !== "club" ? directorByEmail(me) : null;
  const own = dir && /@drippingsportsclub\.com$/i.test(dir.email) ? dir.email : null;
  const from = dse ? (String(process.env.DSE_FROM_EMAIL || "").trim() || dsscFrom()) : own ? `${dir.name} <${own}>` : dsscFrom();
  const replyTo = dse ? (nrm(process.env.DSE_REPLY_TO) || addrOf(process.env.DSE_FROM_EMAIL) || inboxAddress()) : own ? [own, inboxAddress()] : inboxAddress();
  const shownAddr = own || (Array.isArray(replyTo) ? replyTo[0] : replyTo);
  const signature = `${name}\n${dse ? "DS Elite Volleyball" : "Dripping Springs Sports Club"}\n${shownAddr}`;
  const fullText = `${text}\n\n${signature}`;
  const html = `<div style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#191919;max-width:640px">${text.split(/\n{2,}/).map(p => `<p style="margin:0 0 12px;white-space:pre-wrap">${esc(p)}</p>`).join("")}<p style="margin:18px 0 0;color:#333">${esc(name)}<br><span style="color:#667">${esc(dse ? "DS Elite Volleyball" : "Dripping Springs Sports Club")} · <a href="mailto:${esc(shownAddr)}" style="color:#0F8B76">${esc(shownAddr)}</a></span></p></div>`;

  // Threading: our own Message-ID (so the family's answer finds this thread)
  // and, when they emailed us first, a reference to their message so their
  // mail app shows one conversation.
  const messageId = newMessageId();
  const headers = { "Message-ID": messageId };
  const refs = lastWithId ? [...new Set([...(lastWithId.references_ids || []), lastWithId.message_id])].slice(-10) : [];
  if (lastWithId) { headers["In-Reply-To"] = lastWithId.message_id; headers.References = refs.join(" "); }

  const sent = await sendResend({ from, to: [inq.email], bcc: own && own !== nrm(inq.email) ? [own] : [], reply_to: replyTo, subject, html, text: fullText, headers });
  if (!sent.ok) return res.status(502).json({ error: "The email didn't send: " + (sent.error || "unknown error") });

  const { data: row, error: mErr } = await sb.from("site_inbox_messages").insert({
    inquiry_id: inq.id, direction: "out", from_name: name, from_email: addrOf(from), to_email: inq.email, subject,
    body_text: fullText, body_html: html, message_id: messageId, in_reply_to: lastWithId?.message_id || null, references_ids: refs.length ? refs : null,
    provider_id: sent.id || null, sent_by: me,
  }).select("*").single();
  if (mErr) console.error("site-inbox-reply store", inq.id, mErr.message);

  const now = new Date().toISOString();
  const patch = { status: status || "waiting", last_message_at: now };
  if (!inq.assigned_to) { patch.assigned_to = canonicalDirectorEmail(me); patch.assigned_at = now; }
  if (patch.status === "done") { patch.handled = true; patch.handled_at = now; patch.handled_by = str(name, 120); }
  const { error: uErr } = await sb.from("site_inquiries").update(patch).eq("id", inq.id);
  if (uErr) console.error("site-inbox-reply update", inq.id, uErr.message);

  return res.status(200).json({ ok: true, message: row || null, provider_id: sent.id || null, status: patch.status, assigned_to: patch.assigned_to || inq.assigned_to });
}
