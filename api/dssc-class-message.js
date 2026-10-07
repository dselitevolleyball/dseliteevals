// A coach messages ONE class — the families signed up for a single session of
// a DSSC clinic or pod — with optional pictures/video from that class.
//
// POST { clinic_id, session_id, body, media_ids?: [id], channels?: ["email","sms"] }
// POST { clinic_id, session_id, action: "draft", feedback?, previous? }
//   → { draft } — Claude writes the parent note from the class's practice plan
//   (and rewrites `previous` per the coach's `feedback`). Nothing is sent.
//   channels defaults to both; "email" only or "sms" only when the coach picks.
//   Authorization: Bearer <Supabase session token>
//
// Who may send: an owner/director, an admin coach, or a coach who is on that
// session's staff. Recipients are the class roster (dssc_pod_roster rows for
// the session plus the program-wide rows with session_id NULL), deduped.
//
//   Email  → Resend, DSSC-branded, media inline / linked.
//   Text   → Twilio, to every family's parent phone except recorded opt-outs
//            (sms_optouts brand dssc — STOP replies, bounces, "do not text").
//            Every family registered with the club agreed to texts (Drew,
//            26 and 30 Sep 2026), so there is no opt-in gate. Needs the club's
//            own sending number (DSSC_TWILIO_FROM_NUMBER): the DS Elite 10DLC
//            campaign is registered for DS Elite, not the club, and must not
//            carry club messages. Until it's set, texts are skipped and the
//            response says why.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY (or lowercase),
//      DSE_FROM_EMAIL, DSSC_FROM_EMAIL (opt, "Dripping Springs Sports Club <…>"),
//      DSSC_REPLY_TO (opt), TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
//      DSSC_TWILIO_FROM_NUMBER (opt — texting is off until this is set).

import { createClient } from "@supabase/supabase-js";
import { appOrigin } from "../shared/app-origin.js";
import { sendOneSms, twilioReady } from "./_lib/sms.js";
import Anthropic from "@anthropic-ai/sdk";

const DRAFT_SYSTEM = `You write the short "note to parents" a Dripping Springs Sports Club (DSSC) volleyball coach sends the families of one class (a clinic or pod session) about today's practice. Parents are not coaches: turn the coach's practice plan into plain language about what their daughter will work on and why it helps her.

Rules:
- 60-140 words. Warm, upbeat, specific. Sounds like a real coach, not marketing.
- Lead with the theme of the session in one sentence, then 2-4 concrete things the players will do or learn, in everyday words (explain or skip jargon like "seam", "pin", "cover", "OH/RS/MB").
- No minute-by-minute schedule, no drill names in quotes, no coaching cues verbatim, no internal coaching notes (things the coach should "watch" or "call") - those are for the coach.
- If the plan has a game or competition, you may mention it as something fun.
- Only use what is in the plan and class details. Never invent times, locations, things to bring, or results.
- Plain text only: no markdown, no bullets, no emoji, no subject line, no greeting name, no sign-off name. It goes out by email and text exactly as written, so keep it to one or two short paragraphs.
- When given a previous draft and the coach's feedback, rewrite the draft to follow the feedback exactly and keep everything else that worked.`;

const OWNER_EMAILS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];
const DIRECTOR_EMAILS = ["hunterhaleysc10@gmail.com", "hunter@drippingsportsclub.com"];
const RESEND_SINGLE = "https://api.resend.com/emails";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const nrm = (v) => String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
const normalizePhone = (raw) => {
  const d = String(raw || "").replace(/[^\d+]/g, "");
  if (!d) return "";
  if (d.startsWith("+")) return d;
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  return "+" + d;
};
const fmtDate = (iso) => iso ? new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Chicago" }) : "";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", ["POST"]); return res.status(405).json({ error: "POST only" }); }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DSE_FROM_EMAIL, DSSC_FROM_EMAIL, DSSC_REPLY_TO } = process.env;
  const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.resend_api_key;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });

  let body = req.body;
  try { body = typeof body === "string" ? JSON.parse(body) : (body || {}); } catch { return res.status(400).json({ error: "Invalid JSON" }); }
  const clinicId = Number(body.clinic_id), sessionId = String(body.session_id || "").trim();
  const text = String(body.body || "").trim();
  const mediaIds = (Array.isArray(body.media_ids) ? body.media_ids : []).map(Number).filter(Boolean);
  const want = new Set((Array.isArray(body.channels) && body.channels.length ? body.channels : ["email", "sms"]).map(String));
  const drafting = body.action === "draft";
  if (!drafting && want.has("sms") && !want.has("email") && !twilioReady("dssc")) {
    return res.status(400).json({ error: "Texting for the club isn't live yet — it's waiting on the club's own texting number. Send by email for now." });
  }
  if (!clinicId || !sessionId) return res.status(400).json({ error: "clinic_id and session_id are required" });
  if (!drafting && !text && !mediaIds.length) return res.status(400).json({ error: "Write a message or pick something to send." });

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // ── Who is sending ────────────────────────────────────────────────────────
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return res.status(401).json({ error: "Sign in first" });
  const { data: { user } = {} } = await sb.auth.getUser(bearer).catch(() => ({ data: {} }));
  const email = nrm(user?.email);
  if (!email) return res.status(401).json({ error: "Sign in first" });
  const [{ data: me }, { data: rosterRow }] = await Promise.all([
    sb.from("coaches").select("display_name, is_admin, is_approved").ilike("email", email).maybeSingle(),
    sb.from("coach_roster").select("first_name, last_name, email").ilike("email", email).maybeSingle(),
  ]);
  const myNames = new Set([nrm(me?.display_name), nrm(((rosterRow?.first_name || "") + " " + (rosterRow?.last_name || "")).trim())].filter(Boolean));
  const senderName = me?.display_name || ((rosterRow?.first_name || "") + " " + (rosterRow?.last_name || "")).trim() || email;

  const { data: clinic, error: cErr } = await sb.from("dssc_clinics").select("id, name, sessions, location").eq("id", clinicId).maybeSingle();
  if (cErr || !clinic) return res.status(404).json({ error: "Clinic not found" });
  const session = (Array.isArray(clinic.sessions) ? clinic.sessions : []).find(s => String(s.id) === sessionId);
  if (!session) return res.status(404).json({ error: "That class isn't on this clinic any more" });
  const staffNames = [session.coach_name, ...((Array.isArray(session.staff) ? session.staff : []).filter(x => x.status !== "declined").map(x => x.name))].map(nrm).filter(Boolean);
  const privileged = OWNER_EMAILS.includes(email) || DIRECTOR_EMAILS.includes(email) || !!(me?.is_approved && me?.is_admin);
  const onStaff = !!(me?.is_approved) && staffNames.some(n => myNames.has(n));
  if (!privileged && !onStaff) return res.status(403).json({ error: "Only the coaches on this class (or a director) can message it." });

  // ── Draft the parent note from the plan (nothing is sent) ─────────────────
  if (drafting) {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "Claude isn't configured (ANTHROPIC_API_KEY)." });
    const blocks = (Array.isArray(session.blocks) ? session.blocks : []).filter(b => String(b?.name || "").trim() || String(b?.desc || "").trim());
    if (!blocks.length) return res.status(400).json({ error: "This class has no practice plan yet - add the plan first." });
    const NL = String.fromCharCode(10);
    const planText = blocks.map(b => "## " + (b.name || "Block") + (Number(b.minutes) ? " (" + Number(b.minutes) + " min)" : "") + (b.desc ? NL + String(b.desc).slice(0, 2500) : "")).join(NL + NL).slice(0, 16000);
    const facts = ["Program: " + (clinic.name || "DSSC class"), session.date ? "Date: " + fmtDate(session.date) : "", (session.start_time || session.end_time) ? "Time: " + [session.start_time, session.end_time].filter(Boolean).join(" - ") : "", clinic.location ? "Location: " + clinic.location : ""].filter(Boolean).join(NL);
    const previous = String(body.previous || "").trim().slice(0, 4000), feedback = String(body.feedback || "").trim().slice(0, 2000);
    let prompt = facts + NL + NL + "Practice plan:" + NL + planText;
    if (previous && feedback) prompt += NL + NL + "Previous draft:" + NL + previous + NL + NL + "Coach's feedback on that draft:" + NL + feedback + NL + NL + "Rewrite the note following the feedback.";
    else prompt += NL + NL + "Write the note to parents.";
    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const resp = await client.messages.create({ model: "claude-sonnet-5-5", max_tokens: 1200, system: DRAFT_SYSTEM, messages: [{ role: "user", content: prompt }] });
      const draft = (resp.content || []).filter(p => p.type === "text").map(p => p.text).join("").trim();
      if (!draft) return res.status(502).json({ error: "Claude returned an empty draft - try again." });
      return res.status(200).json({ draft });
    } catch (e) {
      console.error("parent note draft failed:", e);
      return res.status(502).json({ error: "Couldn't draft the note: " + (e?.message || e) });
    }
  }

  // ── Who gets it ───────────────────────────────────────────────────────────
  const { data: roster, error: rErr } = await sb.from("dssc_pod_roster").select("*").eq("clinic_id", clinicId);
  if (rErr) return res.status(500).json({ error: rErr.message });
  const classRoster = (roster || []).filter(r => !r.session_id || String(r.session_id) === sessionId);
  const emails = new Map(), phones = new Map();
  // Everyone in the club's system agreed to texts at registration; only a
  // recorded opt-out (STOP reply, 21610 bounce, or "do not text") holds one back.
  const { data: outs } = await sb.from("sms_optouts").select("phone").eq("brand", "dssc");
  const optedOut = new Set((outs || []).map(o => o.phone));
  let noConsent = 0;
  for (const r of classRoster) {
    const e = nrm(r.parent_email);
    if (want.has("email") && e && EMAIL_RE.test(e) && !emails.has(e)) emails.set(e, r);
    const p = normalizePhone(r.parent_phone);
    if (want.has("sms") && p && /^\+\d{8,15}$/.test(p) && !phones.has(p)) { if (!optedOut.has(p)) phones.set(p, r); else noConsent++; }
  }
  if (!emails.size && !phones.size) return res.status(400).json({ error: want.has("email") && want.has("sms") ? "Nobody on this class has an email or a texting number yet." : want.has("sms") ? "Nobody on this class has a texting number on file." : "Nobody on this class has an email on file." });

  // ── Media ─────────────────────────────────────────────────────────────────
  let media = [];
  if (mediaIds.length) {
    const { data } = await sb.from("dssc_class_media").select("*").in("id", mediaIds).eq("clinic_id", clinicId);
    media = (data || []).map(m => ({ ...m, url: sb.storage.from("dssc-media").getPublicUrl(m.storage_path).data.publicUrl }));
  }

  const origin = appOrigin(req);
  const when = fmtDate(session.date) + (session.start_time ? " · " + session.start_time : "");
  const subject = `${clinic.name} — ${fmtDate(session.date)}`;
  const replyTo = DSSC_REPLY_TO || (rosterRow?.email || email);

  // ── Email ─────────────────────────────────────────────────────────────────
  let emailsSent = 0; const emailErrors = [];
  if (emails.size) {
    if (!RESEND_API_KEY || !(DSSC_FROM_EMAIL || DSE_FROM_EMAIL)) return res.status(500).json({ error: "Email isn't configured on the server." });
    // The club doesn't have its own verified sending domain in Resend yet, so
    // mail goes out from the DS Elite address under the club's name.
    const from = DSSC_FROM_EMAIL || ("Dripping Springs Sports Club <" + (DSE_FROM_EMAIL.match(/<([^>]+)>/)?.[1] || DSE_FROM_EMAIL) + ">");
    const imgs = media.filter(m => m.kind === "image");
    const vids = media.filter(m => m.kind !== "image");
    const html = `<div style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#191919">
  <div style="background:#104946;padding:18px 22px;border-radius:12px 12px 0 0"><img src="${origin}/dssc/logo-horizontal-white.png" alt="Dripping Springs Sports Club" style="height:34px;display:block" /></div>
  <div style="border:1px solid #d3e0de;border-top:0;border-radius:0 0 12px 12px;padding:20px 22px">
    <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#0F8B76">${esc(clinic.name)}</p>
    <p style="margin:0 0 14px;font-size:13px;color:#555">${esc(when)}${clinic.location ? " · " + esc(clinic.location) : ""}</p>
    ${text ? `<div style="font-size:15px;line-height:1.55;white-space:pre-wrap">${esc(text)}</div>` : ""}
    ${imgs.length ? `<div style="margin-top:16px">${imgs.map(m => `<a href="${m.url}"><img src="${m.url}" alt="${esc(m.caption || "")}" style="max-width:100%;border-radius:10px;display:block;margin:0 0 10px" /></a>${m.caption ? `<p style="margin:-4px 0 12px;font-size:12px;color:#777">${esc(m.caption)}</p>` : ""}`).join("")}</div>` : ""}
    ${vids.length ? `<div style="margin-top:12px">${vids.map(m => `<p style="margin:0 0 8px"><a href="${m.url}" style="display:inline-block;padding:9px 14px;border-radius:8px;background:#B2D049;color:#104946;font-weight:700;text-decoration:none">▶ Watch video${m.caption ? " — " + esc(m.caption) : ""}</a></p>`).join("")}</div>` : ""}
    <p style="margin:22px 0 0;font-size:12px;color:#888">From Coach ${esc(senderName)} · Dripping Springs Sports Club</p>
  </div>
</div>`;
    const plain = [text, ...media.map(m => (m.caption ? m.caption + ": " : "") + m.url)].filter(Boolean).join("\n\n") + "\n\n— Coach " + senderName + ", Dripping Springs Sports Club";
    const list = [...emails.keys()];
    const LANES = 5; let cursor = 0;
    const worker = async () => {
      while (cursor < list.length) {
        const to = list[cursor++];
        try {
          const r = await fetch(RESEND_SINGLE, { method: "POST", headers: { Authorization: "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({ from, to: [to], reply_to: replyTo, subject, html, text: plain }) });
          if (r.ok) emailsSent++; else emailErrors.push(to + ": " + (await r.text()).slice(0, 120));
        } catch (e) { emailErrors.push(to + ": " + e.message); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(LANES, list.length) }, worker));
  }

  // ── Text ──────────────────────────────────────────────────────────────────
  let textsSent = 0, textsSkipped = noConsent; const textErrors = []; let textNote = noConsent ? noConsent + " opted out" : null;
  if (phones.size) {
    if (twilioReady("dssc")) {
      // Pictures ride along as MMS (Twilio caps each at 5MB); video goes as a link.
      const mms = media.filter(m => m.kind === "image" && (!m.bytes || m.bytes <= 5 * 1024 * 1024)).map(m => m.url);
      const links = media.filter(m => !mms.includes(m.url)).map(m => m.url);
      const smsBody = [text, ...links].filter(Boolean).join("\n") + "\n— Coach " + senderName + ", DSSC";
      // The class is remembered as a group in DSSC Texts: one broadcast row,
      // named for the program and the day, that every family's text points
      // at — so the group can be opened, its replies seen together, and
      // texted again from there.
      const shortDay = session.date ? new Date(session.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Chicago" }) : "";
      const { data: bc } = await sb.from("sms_broadcasts").insert({
        brand: "dssc", body: smsBody, recipient_count: phones.size, sent_by_label: senderName, media_urls: mms.length ? mms : null,
        audience: { type: "class", clinic_id: clinicId, session_id: sessionId, program: clinic.name, date: session.date || null, label: clinic.name + (shortDay ? " · " + shortDay : ""), from: "coach hub" },
      }).select("id").single();
      const broadcastId = bc?.id || null;
      for (const [to, r] of phones.entries()) {
        try {
          await sendOneSms(sb, { to, brand: "dssc", name: r.parent_name || null, kind: "parent", dssc_program: clinic.name, dssc_player: r.player_name || null }, smsBody, { broadcast_id: broadcastId, sent_by_label: senderName, media_urls: mms });
          textsSent++;
        } catch (e) { textErrors.push(to + ": " + e.message); }
      }
      if (broadcastId) await sb.from("sms_broadcasts").update({ sent_count: textsSent, failed_count: textErrors.length }).eq("id", broadcastId);
    } else {
      textsSkipped += phones.size;
      textNote = "Texting for the club isn't live yet (waiting on the DSSC texting number/approval) — those families got the email only.";
    }
  }

  const note = [textNote, emailErrors.length ? emailErrors.length + " email(s) failed" : null, textErrors.length ? textErrors.length + " text(s) failed" : null].filter(Boolean).join(" · ") || null;
  const { data: logRow } = await sb.from("dssc_class_messages").insert({ clinic_id: clinicId, session_id: sessionId, body: text, media_ids: mediaIds, sent_by: senderName,
    emails_sent: emailsSent, texts_sent: textsSent, texts_skipped: textsSkipped, note }).select().single();
  if (mediaIds.length && (emailsSent || textsSent)) await sb.from("dssc_class_media").update({ sent_at: new Date().toISOString() }).in("id", mediaIds);

  return res.status(200).json({ ok: emailsSent + textsSent > 0, emails_sent: emailsSent, texts_sent: textsSent, texts_skipped: textsSkipped,
    families: classRoster.length, note, errors: [...emailErrors, ...textErrors].slice(0, 5), message: logRow || null });
}
