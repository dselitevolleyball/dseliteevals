// Ask the coaches about private lessons at DSSC — by text, app push and
// email — each with her own /privates link for the month ahead.
//
// Who gets asked: every coach on the roster with a privates link, except
// those who last answered "not right now". A coach who has never answered
// gets the first-time ask; one who said yes gets the "has anything changed?"
// ask with her link pre-filled from last month.
//
// Runs on the 25th (Vercel cron) for the following month, and from the
// Privates screen by hand. ?test=1 sends the whole set — text, push, email —
// to Drew only, worded exactly as a coach would get it, so it can be read on
// a phone before anyone else sees it.
//
// Auth: Vercel Cron `Authorization: Bearer <CRON_SECRET>` (or ?token=), or a
// signed-in owner / admin coach (their Supabase access token as the bearer).
// Query: ?test=1   Drew only.   ?month=YYYY-MM   override the month.
//        ?dry=1    list who would be asked, send nothing.

import { createClient } from "@supabase/supabase-js";
import { appOrigin } from "../shared/app-origin.js";
import { sendOneSms, normalizePhone, twilioReady } from "./_lib/sms.js";
import { askMonth } from "./privates-form.js";

const OWNERS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];

// The three messages a coach gets, in one place so a preview shows exactly
// what the send will say. kind: "first" (never answered) | "update" (said yes).
export function askWording({ first, kind, link, label }) {
  if (kind === "update") return {
    sms: `Hi ${first} — DSSC privates for ${label}: has your availability changed? Tap to update the days & hours you can work (30 sec): ${link} — Drew`,
    push: { title: "DSSC privates — " + label, body: "Has your availability changed? Tap to update your days and hours." },
    subject: `DSSC privates — your ${label} availability`,
    email: `Hi ${first},\n\nQuick one for ${label}: has anything changed in when you can run privates at DSSC? Your page is pre-filled with last month — tap what's different and save:\n\n${link}\n\nIf nothing's changed, just open it and hit Save so we know it's current.\n\nThanks,\nDrew`,
  };
  return {
    sms: `Hi ${first} — we're about to launch a new private-lessons system at DSSC and we'd love our coaches running them. Interested? Tap to say yes/no, pick the ages & skills you want to coach, and the days & hours you can work in ${label} (2 min): ${link} — Drew`,
    push: { title: "Privates at DSSC — are you in?", body: "New private-lessons system launching. Tap to say yes and pick your ages, skills, days and hours for " + label + "." },
    subject: `Privates at DSSC — are you in for ${label}?`,
    email: `Hi ${first},\n\nWe're about to launch a new private-lessons system at DSSC: families book lessons on our courts through Playbook, and our own coaches run them. We'd love to have you in the lineup.\n\nThis takes two minutes: say whether you're in, pick the age groups and skills you want to coach, then tap the days and hours you can work in ${label}. We build the Playbook schedule from exactly what you pick.\n\n${link}\n\nIf you're in, we'll check back once a month for the month ahead. If not, just say so and we won't keep asking.\n\nThanks,\nDrew`,
  };
}
const DREW = { name: "Drew Rose", email: "drew@dselitevolleyball.com", phone: "+15122029099" };
const isPlaceholder = (nm) => /assistant coach|head coach|tbd|coach needed|floater/i.test(nm || "");
const monthLabel = (m) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }); };

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const url = (() => { try { return new URL(req.url, "https://x"); } catch { return null; } })();
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // Cron, or a signed-in admin.
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  let who = "cron";
  // The service-role key also opens this door, so an operator script can run
  // a send from a machine that holds the same secret the server does.
  const cronOk = (CRON_SECRET && (bearer === CRON_SECRET || (url?.searchParams.get("token") || "") === CRON_SECRET))
    || (bearer && bearer === SUPABASE_SERVICE_ROLE_KEY);
  if (bearer && bearer === SUPABASE_SERVICE_ROLE_KEY) who = "operator";
  if (!cronOk) {
    if (!bearer) return res.status(401).json({ error: "Not signed in" });
    const { data: { user } = {} } = await sb.auth.getUser(bearer).catch(() => ({ data: {} }));
    const email = (user?.email || "").trim().toLowerCase();
    if (!email) return res.status(401).json({ error: "Not signed in" });
    let ok = OWNERS.includes(email);
    if (!ok) { const { data: c } = await sb.from("coaches").select("is_admin, is_approved").ilike("email", email).maybeSingle(); ok = !!(c && c.is_approved && c.is_admin); }
    if (!ok) return res.status(403).json({ error: "Admins only" });
    who = email;
  }

  const test = url?.searchParams.get("test") === "1";
  const dry = url?.searchParams.get("dry") === "1";
  // ?channels=sms,push — which of the three to use; all three by default.
  const want = new Set(String(url?.searchParams.get("channels") || "sms,push,email").split(",").map(x => x.trim()).filter(Boolean));
  const month = /^\d{4}-\d{2}$/.test(url?.searchParams.get("month") || "") ? url.searchParams.get("month") : askMonth();
  const origin = appOrigin(req);
  const label = monthLabel(month);

  const [{ data: roster }, { data: answers }, { data: asks }] = await Promise.all([
    sb.from("coach_roster").select("id, first_name, last_name, email, phone, privates_token").not("privates_token", "is", null),
    sb.from("coach_privates").select("coach_id, month, interested, submitted_at").order("submitted_at", { ascending: false }),
    sb.from("coach_privates_asks").select("coach_id, month, is_test").eq("month", month).eq("is_test", false),
  ]);
  const latest = new Map();   // coach_id → most recent answer (any month)
  for (const a of answers || []) if (!latest.has(a.coach_id)) latest.set(a.coach_id, a);
  const answeredThisMonth = new Set((answers || []).filter(a => a.month === month && a.interested != null).map(a => a.coach_id));
  const askedThisMonth = new Set((asks || []).map(a => a.coach_id));

  const coaches = (roster || []).map(c => ({ ...c, name: `${c.first_name || ""} ${c.last_name || ""}`.trim() }))
    .filter(c => c.name && !isPlaceholder(c.name))
    .filter(c => latest.get(c.id)?.interested !== false)           // said no → leave alone
    .filter(c => !answeredThisMonth.has(c.id))                      // already told us for this month
    .filter(c => test || !askedThisMonth.has(c.id))                 // the cron never asks twice
    .map(c => ({ ...c, kind: latest.get(c.id)?.interested === true ? "update" : "first" }));

  const link = (c) => `${origin}/privates?t=${c.privates_token}&m=${month}`;
  const wording = (c) => askWording({ first: (c.first_name || c.name).trim(), kind: c.kind, link: link(c), label });

  if (dry) return res.status(200).json({ ok: true, dry: true, month, count: coaches.length, coaches: coaches.map(c => ({ name: c.name, kind: c.kind, phone: !!c.phone, email: !!c.email })) });

  // In test mode every message goes to Drew, worded for the first coach on
  // the list (or for Drew's own roster row if he has one).
  const sample = test ? (coaches.find(c => OWNERS.includes(String(c.email || "").toLowerCase())) || coaches[0]) : null;
  if (test && !sample) return res.status(200).json({ ok: true, month, sent: 0, note: "nobody to ask this month" });
  const targets = test ? [{ ...sample, name: DREW.name, email: DREW.email, phone: DREW.phone, first_name: sample.first_name }] : coaches;

  const results = [];
  for (const c of targets) {
    const w = wording(c);
    const channels = [];
    const phone = normalizePhone(c.phone);
    let smsError = null;
    if (want.has("sms") && phone && /^\+\d{10,15}$/.test(phone) && twilioReady()) {
      try { await sendOneSms(sb, { to: phone, name: c.name, kind: "coach" }, w.sms, { sent_by_label: "DSSC privates ask" }); channels.push("sms"); }
      catch (e) { smsError = e.message; }
    }
    const email = String(c.email || "").trim().toLowerCase();
    if (email && want.has("push")) {
      try {
        const r = await fetch(origin + "/api/send-push", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skipEmail: true, title: w.push.title, body: w.push.body, url: link(c), audience: { type: "email", email } }) });
        const o = await r.json().catch(() => ({}));
        if (o.sent > 0) channels.push("push");
      } catch { /* push is best-effort */ }
    }
    if (email && want.has("email")) {
      try {
        const r = await fetch(origin + "/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skipPush: true, subject: (test ? "[TEST — as " + sample.name + " would see it] " : "") + w.subject, body: w.email, recipients: [email], sentBy: "Drew Rose", sentByEmail: DREW.email, source: "privates-ask" + (test ? " (test)" : "") }) });
        const o = await r.json().catch(() => ({}));
        if (r.ok && !o.error) channels.push("email");
      } catch { /* logged below as no email channel */ }
    }
    await sb.from("coach_privates_asks").insert({ coach_id: c.id, month, channels, is_test: test, sent_by: who });
    results.push({ name: c.name, kind: c.kind, channels, ...(smsError ? { sms_error: smsError } : {}) });
  }
  return res.status(200).json({ ok: true, month, test, sent: results.filter(r => r.channels?.length).length, results });
}
