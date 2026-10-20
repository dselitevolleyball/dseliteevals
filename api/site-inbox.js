// POST /api/site-inbox — drippingsportsclub.com's forms land here (Drew, 20 Oct
// 2026: "a shared inbox all the directors have access to").
//
// Server to server: the website's own API posts each form (court rental,
// birthday party, Reach, contact, camp, league, open gym, membership...) with
// the shared secret in `x-site-token`. The thread is saved (site_inquiries +
// the first site_inbox_messages row), the directors who own that kind of
// request are emailed (Reply-To = the family, with a link to the thread in
// HQ), and the site is told { ok: true, id, emailed } — when emailed is true
// the site sends nothing of its own.
//
//   headers  x-site-token: <DSSC_SITE_TOKEN>
//   body     { site: 'dssc', kind, name, email, phone?, message?,
//              details?: { date, time, group, sport, age, duration, building, ... },
//              page?, ip?, company? (honeypot) }
//   200      { ok: true, id, emailed }
//   400      { ok: false, error, field }      401 bad token      500 not configured
//
// Routing (shared/dssc-directors.js, override with env DSSC_INBOX_ROUTES):
//   volleyball -> Hunter · basketball -> Adrian + Jonathan · Reach -> Brandon
//   rentals, parties, leagues, open gym, membership, plain contact -> Jonathan
//   Drew is CC'd on everything.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DSSC_SITE_TOKEN, RESEND_API_KEY,
//      DSSC_FROM_EMAIL (fallback DSE_FROM_EMAIL), DSSC_INBOX_ROUTES (optional).

import { cors, readBody, str, longStr, isEmail, usPhone, clientIp, serviceClient } from "./_lib/site-forms.js";
import { safeEqual, KINDS, kindLabel, inquirySport, inboxAddress, notifyDirectors, detailRows } from "./_lib/site-inbox.js";

const DETAIL_KEYS = ["date", "time", "group", "sport", "age", "duration", "building", "players", "player", "level", "program", "subject", "budget", "notes"];
const THANKS = "Thanks — we got your message and will get back to you soon.";

export default async function handler(req, res) {
  cors(res);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Site-Token");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") { res.setHeader("Allow", "POST, OPTIONS"); return res.status(405).json({ ok: false, error: "Use POST." }); }

  const SECRET = String(process.env.DSSC_SITE_TOKEN || "").trim();
  if (!SECRET) return res.status(500).json({ ok: false, error: "DSSC_SITE_TOKEN is not configured on HQ." });
  const token = String(req.headers["x-site-token"] || "").trim();
  if (!safeEqual(token, SECRET)) return res.status(401).json({ ok: false, error: "Bad site token." });

  const b = readBody(req);
  // Honeypot: the site tells the bot "thanks" and we tell the site we have it.
  if (str(b.company, 200)) return res.status(200).json({ ok: true, id: null, emailed: true, message: THANKS });

  const name = str(b.name, 120), email = str(b.email, 200).toLowerCase();
  const phoneRaw = str(b.phone, 40), phone = phoneRaw ? usPhone(phoneRaw) : null;
  const kindRaw = str(b.kind, 30).toLowerCase().replace(/[^a-z]/g, "");
  const kind = KINDS.includes(kindRaw) ? kindRaw : (kindRaw ? "other" : "contact");
  const message = longStr(b.message, 5000);
  const rawDetails = b.details && typeof b.details === "object" && !Array.isArray(b.details) ? b.details : {};
  const details = {};
  for (const k of Object.keys(rawDetails)) {
    const key = str(k, 40).toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (!key || !(DETAIL_KEYS.includes(key) || Object.keys(details).length < 20)) continue;
    const v = rawDetails[k];
    if (v == null || typeof v === "object") continue;
    const s = str(v, 300);
    if (s) details[key] = s;
  }
  if (!details.sport && str(b.sport, 40)) details.sport = str(b.sport, 40);
  const sport = inquirySport({ kind, sport: details.sport });
  const page = str(b.page, 300) || null;
  const ip = str(b.ip, 60) || clientIp(req);

  const bad = (field, error) => res.status(400).json({ ok: false, field, error });
  if (!name) return bad("name", "Please enter your name.");
  if (!isEmail(email)) return bad("email", "Please enter an email address we can reply to.");
  if (phoneRaw && !phone) return bad("phone", "That phone number doesn't look right — use a 10-digit US number, or leave it blank.");
  if (!message && !Object.keys(details).length) return bad("message", "Please write a short message.");

  const sb = serviceClient();
  if (!sb) return res.status(500).json({ ok: false, error: "HQ is not configured (Supabase)." });

  const subject = `${kindLabel(kind)}${sport && sport !== "reach" ? " · " + sport[0].toUpperCase() + sport.slice(1) : ""} — ${name}`;
  // What the first message says when the form had no free-text box.
  const bodyText = message || detailRows(details).map(([k, v]) => `${k}: ${v}`).join("\n");
  let inq;
  try {
    const { data, error } = await sb.from("site_inquiries").insert({
      site: "dssc", kind, topic: kind, sport, details, source_path: page,
      name, email, phone, message, ip, is_test: false, status: "new", last_message_at: new Date().toISOString(),
    }).select("*").single();
    if (error) throw new Error(error.message);
    inq = data;
    const { error: mErr } = await sb.from("site_inbox_messages").insert({
      inquiry_id: inq.id, direction: "in", from_name: name, from_email: email, to_email: inboxAddress(), subject, body_text: bodyText,
    });
    if (mErr) console.error("site-inbox message insert", inq.id, mErr.message);
  } catch (e) {
    console.error("site-inbox insert", e);
    return res.status(500).json({ ok: false, error: "HQ couldn't save that message." });
  }

  // Saved either way; a failed email only means the directors see it in HQ
  // (and the site, told emailed:false, sends its own).
  let emailed = false;
  try {
    emailed = await notifyDirectors(inq, { body_text: bodyText }, { reason: "new" });
    if (emailed) await sb.from("site_inquiries").update({ emailed_at: new Date().toISOString() }).eq("id", inq.id);
  } catch (e) {
    console.error("site-inbox email", inq.id, e.message);
  }
  return res.status(200).json({ ok: true, id: inq.id, emailed, message: THANKS });
}
