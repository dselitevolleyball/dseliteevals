// POST /api/site-optin — the website's /text-updates form (DS Elite text opt-in).
//
// This is the consent the DS Elite 10DLC campaign (approved 2026-09-25) points
// at: a parent gives their name and mobile and ticks the consent box, and the
// opt-in is recorded in sms_consents for the DS Elite brand ('dse', the brand
// the Texts screen and api/send-sms.js use). It NEVER sends a text.
//
//   body  { first_name, last_name, phone, email?, player_name?, consent: true, consent_text, company? }
//   200   { ok: true, message, restart_needed? }
//   400   { ok: false, error, field }
//
// company is a honeypot: people never see it, bots fill it in — they get a
// normal-looking 200 and nothing is saved. Someone who once replied STOP stays
// in sms_optouts (only their own START reply lifts a carrier block); the new
// consent is still recorded and the response says to text START.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { cors, readBody, str, longStr, isEmail, truthy, usPhone, clientIp, throttled, serviceClient } from "./_lib/site-forms.js";

const BRAND = "dse";
const SOURCE = "website /text-updates";
const CONSENT_VERSION = "v2026-09-23";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") { res.setHeader("Allow", "POST, OPTIONS"); return res.status(405).json({ ok: false, error: "Use POST." }); }

  const b = readBody(req);
  if (str(b.company, 200)) return res.status(200).json({ ok: true, message: "You're signed up for DS Elite text updates." });
  const ip = clientIp(req);
  if (throttled("optin:" + ip)) return res.status(429).json({ ok: false, error: "That's a lot of sign-ups from one connection. Please wait a few minutes and try again." });

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

  const sb = serviceClient();
  if (!sb) return res.status(500).json({ ok: false, error: "Sign-ups aren't available right now. Please try again later." });
  try {
    const [{ data: prev, error: e1 }, { data: out, error: e2 }] = await Promise.all([
      sb.from("sms_consents").select("notes").eq("phone", phone).eq("brand", BRAND).maybeSingle(),
      sb.from("sms_optouts").select("phone").eq("phone", phone).eq("brand", BRAND).maybeSingle(),
    ]);
    if (e1 || e2) throw new Error((e1 || e2).message);
    const now = new Date().toISOString();
    const note = [
      `${now.slice(0, 10)} website opt-in`, ip ? "ip " + ip : null, "consent " + CONSENT_VERSION,
      email ? "email " + email : null, out ? "had replied STOP (still opted out until START)" : null,
      `text: "${consentText.slice(0, 1200)}"`,
    ].filter(Boolean).join(" · ");
    const row = {
      phone, brand: BRAND, name: `${first} ${last}`, source: SOURCE, consented_at: now,
      notes: (prev && prev.notes ? note + "\n" + prev.notes : note).slice(0, 8000),
    };
    if (player) row.player_name = player;
    const { error } = await sb.from("sms_consents").upsert(row, { onConflict: "phone,brand" });
    if (error) throw new Error(error.message);
    return res.status(200).json(out
      ? { ok: true, restart_needed: true, message: "Thanks — you're signed up. This number replied STOP to us before, so text START to our number to turn DS Elite texts back on." }
      : { ok: true, message: "You're signed up for DS Elite text updates. Reply STOP to any message to opt out, HELP for help." });
  } catch (e) {
    console.error("site-optin", e);
    return res.status(500).json({ ok: false, error: "Something went wrong saving that. Please try again in a minute." });
  }
}
