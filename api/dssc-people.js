// DSSC coaches & staff who aren't on the DS Elite coach roster (Drew, 13 Oct
// 2026): basketball coaches, interns, DSSC administrators. Minimal info -
// name, email, phone, role, sport. Adding someone also lets them create a
// login (pre-approved, DSSC-only) at www.drippingsportsclub.com/hq.
//
// POST { action: "list" }
// POST { action: "save", person: { id?, email, first_name, last_name, phone, role, sports[], notes } }
// POST { action: "deactivate", id }  /  { action: "reactivate", id }
// POST { action: "invite", id }       email (and text, if there's a phone) the /hq link
// Authorization: Bearer <Supabase session token> of a DSSC admin.

import { createClient } from "@supabase/supabase-js";
import { sendOneSms, normalizePhone, twilioReady } from "./_lib/sms.js";

export const DSSC_APP_URL = "https://www.drippingsportsclub.com/hq";
const OWNER_EMAILS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];
const DIRECTOR_EMAILS = ["hunterhaleysc10@gmail.com", "hunter@drippingsportsclub.com"];
const ROLES = ["admin", "coach", "staff"];
const SPORTS = ["volleyball", "basketball"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const nrm = (v) => String(v || "").trim().toLowerCase();

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DSE_FROM_EMAIL, DSSC_FROM_EMAIL } = process.env;
  const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.resend_api_key;
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const { data: { user } = {} } = bearer ? await sb.auth.getUser(bearer).catch(() => ({ data: {} })) : { data: {} };
  const me = nrm(user?.email);
  if (!me) return res.status(401).json({ error: "Sign in first" });
  const { data: meRow } = await sb.from("coaches").select("display_name, is_admin, is_approved, dssc_role").ilike("email", me).maybeSingle();
  const ok = OWNER_EMAILS.includes(me) || DIRECTOR_EMAILS.includes(me) || !!(meRow?.is_approved && (meRow.is_admin || meRow.dssc_role === "admin"));
  if (!ok) return res.status(403).json({ error: "DSSC administrators only" });
  const myName = meRow?.display_name || me;

  let body = req.body; try { body = typeof body === "string" ? JSON.parse(body) : (body || {}); } catch { return res.status(400).json({ error: "Invalid JSON" }); }

  if (body.action === "list") {
    const [{ data: people }, { data: logins }, { data: roster }] = await Promise.all([
      sb.from("dssc_people").select("*").order("active", { ascending: false }).order("first_name"),
      sb.from("coaches").select("email, is_approved, dssc_role, last_seen_at"),
      sb.from("coach_roster").select("email"),
    ]);
    const byEmail = new Map((logins || []).map(l => [nrm(l.email), l]));
    const dse = new Set((roster || []).map(r => nrm(r.email)).filter(Boolean));
    return res.status(200).json({ people: (people || []).map(p => ({ ...p, login: byEmail.get(nrm(p.email)) || null, ds_elite: dse.has(nrm(p.email)) })) });
  }

  if (body.action === "save") {
    const p = body.person || {};
    const email = nrm(p.email), first = String(p.first_name || "").trim();
    if (!first) return res.status(400).json({ error: "First name is required." });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "A valid email is required - it's their login." });
    const role = ROLES.includes(p.role) ? p.role : "coach";
    const sports = (Array.isArray(p.sports) ? p.sports : []).filter(s => SPORTS.includes(s));
    if (role === "coach" && !sports.length) return res.status(400).json({ error: "Pick the sport they coach." });
    const phone = p.phone ? normalizePhone(p.phone) : null;
    const row = { email, first_name: first, last_name: String(p.last_name || "").trim() || null, phone, role, sports, notes: String(p.notes || "").trim() || null, updated_at: new Date().toISOString() };
    const q = p.id ? sb.from("dssc_people").update(row).eq("id", p.id).select().single() : sb.from("dssc_people").upsert({ ...row, created_by: myName, active: true }, { onConflict: "email" }).select().single();
    const { data: saved, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    await grantAccess(sb, saved, myName);
    return res.status(200).json({ ok: true, person: saved });
  }

  if (body.action === "deactivate" || body.action === "reactivate") {
    const on = body.action === "reactivate";
    const { data: p, error } = await sb.from("dssc_people").update({ active: on, updated_at: new Date().toISOString() }).eq("id", body.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    if (on) await grantAccess(sb, p, myName);
    else {
      // A DSSC-only login is switched off; a DS Elite coach just loses the DSSC role.
      const { data: login } = await sb.from("coaches").select("id, dssc_only").ilike("email", p.email).maybeSingle();
      if (login) await sb.from("coaches").update(login.dssc_only ? { is_approved: false, dssc_role: null } : { dssc_role: null }).eq("id", login.id);
      await sb.from("allowed_signup_emails").delete().ilike("email", p.email).eq("dssc_only", true);
    }
    return res.status(200).json({ ok: true, person: p });
  }

  if (body.action === "invite") {
    const { data: p } = await sb.from("dssc_people").select("*").eq("id", body.id).maybeSingle();
    if (!p) return res.status(404).json({ error: "Not found" });
    const { data: login } = await sb.from("coaches").select("id").ilike("email", p.email).maybeSingle();
    const what = p.role === "staff" ? "clock in and out" : p.role === "admin" ? "see who's coaching, assign coaches and fix clock-ins" : "see your classes and players, clock in, message families and write recaps";
    const step = login ? `Sign in with ${p.email}.` : `Tap "Sign up" and create a password using ${p.email} - you're already approved.`;
    const sent = { email: false, text: false };
    if (RESEND_API_KEY && (DSSC_FROM_EMAIL || DSE_FROM_EMAIL)) {
      const from = DSSC_FROM_EMAIL || ("Dripping Springs Sports Club <" + ((DSE_FROM_EMAIL || "").match(/<([^>]+)>/)?.[1] || DSE_FROM_EMAIL) + ">");
      const html = `<div style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;max-width:560px;color:#191919">
        <div style="background:#104946;padding:18px 22px;border-radius:12px 12px 0 0"><img src="${DSSC_APP_URL}/dssc/logo-horizontal-white.png" alt="Dripping Springs Sports Club" style="height:32px;display:block" /></div>
        <div style="border:1px solid #d3e0de;border-top:0;border-radius:0 0 12px 12px;padding:20px 22px;font-size:15px;line-height:1.55">
          <p>Hi ${p.first_name},</p>
          <p>You're set up in DSSC HQ, the club's app where you ${what}.</p>
          <p><a href="${DSSC_APP_URL}" style="display:inline-block;padding:11px 18px;border-radius:8px;background:#B2D049;color:#104946;font-weight:800;text-decoration:none">Open DSSC HQ</a></p>
          <p>${step} On your phone, use "Add to Home Screen" so it opens like an app.</p>
          <p style="color:#667;font-size:13px">Questions? Reply to this email.<br>- Dripping Springs Sports Club</p></div></div>`;
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [p.email], reply_to: "drew@drippingsportsclub.com", subject: "You're set up in DSSC HQ", html }) }).catch(() => null);
      sent.email = !!(r && r.ok);
    }
    if (p.phone && twilioReady("dssc")) {
      try { await sendOneSms(sb, { to: p.phone, brand: "dssc", name: `${p.first_name} ${p.last_name || ""}`.trim(), kind: "staff" }, `Hi {first}, you're set up in DSSC HQ, the club's app. ${step}\n${DSSC_APP_URL}`, { sent_by_label: "DSSC HQ invite" }); sent.text = true; } catch { /* email still went */ }
    }
    await sb.from("dssc_people").update({ invited_at: new Date().toISOString() }).eq("id", p.id);
    return res.status(200).json({ ok: sent.email || sent.text, sent });
  }

  return res.status(400).json({ error: "Unknown action" });
}

// Let them in: pre-approved allowlist entry for a first login, and the role on
// an existing login. Someone on the DS Elite roster keeps DS Elite access.
async function grantAccess(sb, p, by) {
  const { data: onRoster } = await sb.from("coach_roster").select("id").ilike("email", p.email).limit(1);
  const dsscOnly = !(onRoster && onRoster.length);
  const display = `${p.first_name} ${p.last_name || ""}`.trim();
  await sb.from("allowed_signup_emails").upsert({ email: p.email, added_by_name: by, note: `DSSC ${p.role}${p.sports?.length ? " (" + p.sports.join(", ") + ")" : ""}`, pre_approved: true, display_name: display, dssc_role: p.role, dssc_only: dsscOnly, sports: p.sports || [] }, { onConflict: "email" });
  const { data: login } = await sb.from("coaches").select("id").ilike("email", p.email).maybeSingle();
  if (login) await sb.from("coaches").update({ dssc_role: p.role, sports: p.sports || [], is_approved: true, ...(dsscOnly ? { dssc_only: true } : {}) }).eq("id", login.id);
}
