// POST /api/site-optin — the website's /text-updates form (DS Elite text opt-in).
//
// This is the consent the DS Elite 10DLC campaign (approved 2026-09-25) points
// at: a parent gives their name and mobile and ticks the consent box, and the
// opt-in is recorded in sms_consents for the DS Elite brand ('dse', the brand
// the Texts screen and api/send-sms.js use). It NEVER sends a text.
//
//   body  { first_name, last_name, phone, email?, player_name?, consent: true, consent_text, company? }
//   200   { ok: true, message }          (the same answer for everyone — see below)
//   400   { ok: false, error, field }
//
// One answer for every valid sign-up: the response never says whether the
// number is new, already on the list or blocked (an earlier STOP), so the form
// can't be used to probe who is in the club's database. Someone who once replied
// STOP stays in sms_optouts (only their own START reply lifts a carrier block);
// the new consent is still recorded, with a note saying so.
//
// A number already on the list keeps its ORIGINAL name, source and consented_at
// — the first opt-in is the evidence — and a dated line is appended to its notes.
// The consent wording the form sent is compared with the v2026-09-23 sentence
// (whitespace and dashes ignored); a different wording is still accepted but the
// notes say 'consent_text_mismatch' so it can be looked at.
//
// Testing: the header x-site-test: <secret> (see testMode() in _lib/site-forms.js)
// validates the whole request and answers { ok: true, test: true } WITHOUT writing
// anything. A wrong token is a 403.
// company is a honeypot: people never see it, bots fill it in — they get the
// normal 200 and nothing is saved.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { cors, readBody, str, longStr, isEmail, truthy, usPhone, clientIp, testMode, badTestToken, throttled, serviceClient } from "./_lib/site-forms.js";

const BRAND = "dse";
const SOURCE = "website /text-updates";
const CONSENT_VERSION = "v2026-09-23";
// The checkbox sentence of v2026-09-23 (the website sends it with a leading "Yes, ").
const CONSENT_TEXT = "I agree to receive recurring text messages from DS Elite Volleyball Club at the number provided — including tryout and practice reminders, schedule and tournament updates, coach assignments, weather cancellations, and club announcements. Message frequency varies (about 2–8 messages per month). Message and data rates may apply. Reply STOP to unsubscribe or HELP for help. Consent is not a condition of registration. We do not sell or share your mobile information with third parties or affiliates for marketing purposes.";
const SUCCESS = "You're signed up for DS Elite text updates. Reply STOP to any message to opt out, HELP for help.";

// Whitespace, every kind of dash/hyphen, curly quotes and a leading "Yes," don't count as different wording.
const wording = (s) => String(s ?? "")
  .replace(/[‐-―−]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/\s+/g, " ").trim().replace(/^yes[,.]?\s+/i, "");
const WORDING_OK = wording(CONSENT_TEXT);

// Keep the first opt-in's evidence and the latest lines when a number has signed up many times.
const capNotes = (s) => (s.length <= 8000 ? s : s.slice(0, 3000) + "\n…\n" + s.slice(-4900));

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") { res.setHeader("Allow", "POST, OPTIONS"); return res.status(405).json({ ok: false, error: "Use POST." }); }

  const mode = testMode(req);
  if (mode === "invalid") return badTestToken(res);
  const test = mode === "valid";
  const b = readBody(req);
  if (str(b.company, 200)) return res.status(200).json({ ok: true, message: SUCCESS });
  const ip = clientIp(req);
  if (throttled((test ? "optin-test:" : "optin:") + ip, { max: test ? 20 : 8 })) return res.status(429).json({ ok: false, error: "That's a lot of sign-ups from one connection. Please wait a few minutes and try again." });

  const first = str(b.first_name, 60), last = str(b.last_name, 60);
  const phone = usPhone(b.phone);
  const email = str(b.email, 200).toLowerCase();
  const player = str(b.player_name, 200);
  const consentText = longStr(b.consent_text, 2000);
  const bad = (field, error) => res.status(400).json({ ok: false, field, error });
  if (!first) return bad("first_name", "Please enter your first name.");
  if (!last) return bad("last_name", "Please enter your last name.");
  if (!phone) return bad("phone", "Please enter a 10-digit US mobile number.");
  if (email && !isEmail(email)) return bad("email", "That email address doesn't look right.");
  if (!truthy(b.consent)) return bad("consent", "Please check the box to agree to receive text messages.");
  if (!consentText) return bad("consent_text", "The consent wording is missing. Please reload the page and try again.");
  if (test) return res.status(200).json({ ok: true, test: true });   // validated; nothing is written

  const sb = serviceClient();
  if (!sb) return res.status(500).json({ ok: false, error: "Sign-ups aren't available right now. Please try again later." });
  try {
    const [{ data: prev, error: e1 }, { data: out, error: e2 }] = await Promise.all([
      sb.from("sms_consents").select("notes").eq("phone", phone).eq("brand", BRAND).maybeSingle(),
      sb.from("sms_optouts").select("phone").eq("phone", phone).eq("brand", BRAND).maybeSingle(),
    ]);
    if (e1 || e2) throw new Error((e1 || e2).message);
    const now = new Date().toISOString();
    const mismatch = wording(consentText) !== WORDING_OK;
    const parts = [
      `${now.slice(0, 10)} website opt-in${prev ? " again" : ""}`, ip ? "ip " + ip : null, "consent " + CONSENT_VERSION,
      mismatch ? "consent_text_mismatch" : null,
      email ? "email " + email : null, out ? "had replied STOP (still opted out until START)" : null,
    ];
    if (prev) {
      // Already on the list: the original name / source / consented_at stay; only the notes grow.
      parts.push(`submitted as "${first} ${last}"`, player ? `player "${player}"` : null);
      if (mismatch) parts.push(`text: "${consentText.slice(0, 600)}"`);
      const note = parts.filter(Boolean).join(" · ");
      const { error } = await sb.from("sms_consents").update({ notes: capNotes(prev.notes ? prev.notes + "\n" + note : note) }).eq("phone", phone).eq("brand", BRAND);
      if (error) throw new Error(error.message);
    } else {
      parts.push(`text: "${consentText.slice(0, 1200)}"`);
      const row = { phone, brand: BRAND, name: `${first} ${last}`, source: SOURCE, consented_at: now, notes: parts.filter(Boolean).join(" · ").slice(0, 8000) };
      if (player) row.player_name = player;
      // ignoreDuplicates: two sign-ups racing for a new number can't overwrite each other.
      const { error } = await sb.from("sms_consents").upsert(row, { onConflict: "phone,brand", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }
    return res.status(200).json({ ok: true, message: SUCCESS });
  } catch (e) {
    console.error("site-optin", e);
    return res.status(500).json({ ok: false, error: "Something went wrong saving that. Please try again in a minute." });
  }
}
