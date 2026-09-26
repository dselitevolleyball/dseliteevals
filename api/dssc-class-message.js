// A coach messages ONE class — the families signed up for a single session of
// a DSSC clinic or pod — with optional pictures/video from that class.
//
// POST { clinic_id, session_id, body, media_ids?: [id] }
//   Authorization: Bearer <Supabase session token>
//
// Who may send: an owner/director, an admin coach, or a coach who is on that
// session's staff. Recipients are the class roster (dssc_pod_roster rows for
// the session plus the program-wide rows with session_id NULL), deduped.
//
//   Email  → Resend, DSSC-branded, media inline / linked.
//   Text   → Twilio, ONLY to parents with sms_consent, and ONLY once a DSSC
//            sending number exists (DSSC_TWILIO_FROM_NUMBER). Until then texts
//            are counted as skipped and the response says why — the DS Elite
//            10DLC campaign is registered for DS Elite, not the club.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY (or lowercase),
//      DSE_FROM_EMAIL, DSSC_FROM_EMAIL (opt, "Dripping Springs Sports Club <…>"),
//      DSSC_REPLY_TO (opt), TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
//      DSSC_TWILIO_FROM_NUMBER (opt — texting is off until this is set).

import { createClient } from "@supabase/supabase-js";
import { appOrigin } from "../shared/app-origin.js";
import { sendOneSms, twilioReady } from "./_lib/sms.js";

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
  if (!clinicId || !sessionId) return res.status(400).json({ error: "clinic_id and session_id are required" });
  if (!text && !mediaIds.length) return res.status(400).json({ error: "Write a message or pick something to send." });

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

  // ── Who gets it ───────────────────────────────────────────────────────────
  const { data: roster, error: rErr } = await sb.from("dssc_pod_roster").select("*").eq("clinic_id", clinicId);
  if (rErr) return res.status(500).json({ error: rErr.message });
  const classRoster = (roster || []).filter(r => !r.session_id || String(r.session_id) === sessionId);
  const emails = new Map(), phones = new Map();
  let noConsent = 0;
  for (const r of classRoster) {
    const e = nrm(r.parent_email);
    if (e && EMAIL_RE.test(e) && !emails.has(e)) emails.set(e, r);
    const p = normalizePhone(r.parent_phone);
    if (p && /^\+\d{8,15}$/.test(p) && !phones.has(p)) { if (r.sms_consent) phones.set(p, r); else noConsent++; }
  }
  if (!emails.size && !phones.size) return res.status(400).json({ error: "Nobody on this class has an email or a texting number yet." });

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
  let textsSent = 0, textsSkipped = noConsent; const textErrors = []; let textNote = null;
  if (phones.size) {
    if (twilioReady("dssc")) {
      // Pictures ride along as MMS (Twilio caps each at 5MB); video goes as a link.
      const mms = media.filter(m => m.kind === "image" && (!m.bytes || m.bytes <= 5 * 1024 * 1024)).map(m => m.url);
      const links = media.filter(m => !mms.includes(m.url)).map(m => m.url);
      const smsBody = [text, ...links].filter(Boolean).join("\n") + "\n— Coach " + senderName + ", DSSC";
      for (const [to, r] of phones.entries()) {
        try {
          await sendOneSms(sb, { to, brand: "dssc", name: r.parent_name || null, kind: "parent", dssc_program: clinic.name, dssc_player: r.player_name || null }, smsBody, { sent_by_label: senderName, media_urls: mms });
          textsSent++;
        } catch (e) { textErrors.push(to + ": " + e.message); }
      }
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
