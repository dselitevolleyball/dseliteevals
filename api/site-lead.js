// POST /api/site-lead — "Get club news by email" sign-up on dselitevolleyball.com.
//
// Saves the address in site_leads (HQ → Website → Email list) and sends a short welcome email from
// DS Elite with an unsubscribe link (/api/site-unsubscribe?t=<unsub_token>). Signing up twice is fine:
// the second time just updates the optional fields (and re-subscribes someone who had left).
//
//   body  { email, first_name?, player_age?, interest?: 'tryouts'|'training'|'general', page?, us?, r?, company? }
//   200   { ok: true, message }
//
// Same test header, honeypot and throttle as /api/site-contact (see _lib/site-forms.js).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, DSE_FROM_EMAIL.

import { cors, readBody, str, isEmail, clientIp, testMode, badTestToken, throttled, serviceClient, esc } from "./_lib/site-forms.js";

const SITE = "https://www.dselitevolleyball.com";
const APP = "https://dseliteevals.vercel.app";
const INTERESTS = new Set(["tryouts", "training", "general"]);
const THANKS = "You're on the list! Check your inbox for a welcome email.";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") { res.setHeader("Allow", "POST, OPTIONS"); return res.status(405).json({ ok: false, error: "Use POST." }); }

  const mode = testMode(req);
  if (mode === "invalid") return badTestToken(res);
  const test = mode === "valid";
  const b = readBody(req);
  if (str(b.company, 200)) return res.status(200).json({ ok: true, message: THANKS });
  if (throttled((test ? "lead-test:" : "lead:") + clientIp(req), { max: test ? 20 : 6 })) return res.status(429).json({ ok: false, error: "That's a lot of sign-ups from one connection. Please try again in a few minutes." });

  const email = str(b.email, 200).toLowerCase();
  if (!isEmail(email)) return res.status(400).json({ ok: false, field: "email", error: "Please enter a valid email address." });
  const first = str(b.first_name, 60) || null;
  const interest = INTERESTS.has(b.interest) ? b.interest : "general";
  const row = { email, first_name: first, player_age: str(b.player_age, 40) || null, interest, source_path: str(b.page, 200) || null,
    utm_source: str(b.us, 80) || null, ref_host: str(b.r, 120) || null, is_test: test };

  const sb = serviceClient();
  if (!sb) return res.status(500).json({ ok: false, error: "Sign-up isn't available right now. Please try again later." });
  const { data: old } = await sb.from("site_leads").select("id, unsub_token, welcomed_at, unsubscribed_at").eq("email", email).maybeSingle();
  let lead;
  if (old) {
    const patch = Object.fromEntries(Object.entries(row).filter(([k, v]) => v != null && !["email", "source_path", "utm_source", "ref_host", "is_test"].includes(k)));
    const { data, error } = await sb.from("site_leads").update({ ...patch, unsubscribed_at: null }).eq("id", old.id).select("*").single();
    if (error) return res.status(500).json({ ok: false, error: "Something went wrong. Please try again." });
    lead = data;
  } else {
    const { data, error } = await sb.from("site_leads").insert(row).select("*").single();
    if (error) { console.error("site-lead insert", error.message); return res.status(500).json({ ok: false, error: "Something went wrong. Please try again." }); }
    lead = data;
  }
  if (test || lead.welcomed_at) return res.status(200).json({ ok: true, message: THANKS, ...(test ? { test: true } : {}) });

  try {
    const key = process.env.RESEND_API_KEY || process.env.resend_api_key, from = process.env.DSE_FROM_EMAIL;
    if (!key || !from) throw new Error("email not configured");
    const unsub = `${APP}/api/site-unsubscribe?t=${lead.unsub_token}`;
    const hi = first ? `Hi ${esc(first)},` : "Hi there,";
    const link = (href, label) => `<a href="${href}" style="color:#d12c74;font-weight:700">${label}</a>`;
    const html = `<div style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a;max-width:560px">
<p>${hi}</p>
<p>Thanks for your interest in DS Elite Volleyball! You're on our list, so you'll hear from us first when tryout dates are set and when we have club news worth sharing. We won't flood your inbox.</p>
<p>While you're here:</p>
<ul style="padding-left:20px">
<li>${link(SITE + "/tryouts", "Tryouts & pricing")}: how teams form and what a season costs</li>
<li>${link(SITE + "/training", "Training & facilities")}: clinics, PODs, and camps you can join any time of year</li>
<li>${link(SITE + "/about", "Who we are")}: our story and how we coach</li>
</ul>
<p>Questions? Just reply to this email.</p>
<p>Drew Rose<br>Founder &amp; Club Director, DS Elite Volleyball</p>
<p style="color:#888;font-size:12px;margin-top:24px">You signed up at dselitevolleyball.com. ${link(unsub, "Unsubscribe")} any time.</p></div>`;
    const text = `${first ? `Hi ${first},` : "Hi there,"}\n\nThanks for your interest in DS Elite Volleyball! You're on our list, so you'll hear from us first when tryout dates are set and when we have club news worth sharing.\n\nTryouts & pricing: ${SITE}/tryouts\nTraining & facilities: ${SITE}/training\nWho we are: ${SITE}/about\n\nQuestions? Just reply to this email.\n\nDrew Rose\nFounder & Club Director, DS Elite Volleyball\n\nUnsubscribe: ${unsub}`;
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email], reply_to: "drew@dselitevolleyball.com", subject: "Welcome to DS Elite Volleyball", html, text,
        headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }) });
    if (!r.ok) throw new Error("Resend " + r.status);
    await sb.from("site_leads").update({ welcomed_at: new Date().toISOString() }).eq("id", lead.id);
  } catch (e) { console.error("site-lead welcome", e.message); }
  return res.status(200).json({ ok: true, message: THANKS });
}
