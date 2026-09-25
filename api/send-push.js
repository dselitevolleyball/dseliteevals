// Vercel serverless function: send a Web Push notification to subscribed
// devices, picking recipients by audience.
//
// Env vars (Vercel -> Project Settings -> Environment Variables):
//   VAPID_PUBLIC_KEY          - required. From `web-push generate-vapid-keys`.
//   VAPID_PRIVATE_KEY         - required. Keep secret.
//   VAPID_SUBJECT             - optional. mailto:you@domain (default below).
//   SUPABASE_URL              - required. Your project URL.
//   SUPABASE_SERVICE_ROLE_KEY - required. Service role key (server-only) to
//                               read all push_subscriptions past RLS.
//
// Request body: { title, body, url?, audience }
//   audience = { type: "all" }
//            | { type: "team", team: "14 Diamond" }
//            | { type: "admins" }
//            | { type: "email", email: "coach@x.com" }
// Response: { ok, sent, removed }

import webpush from "web-push";
import { appOrigin } from "../shared/app-origin.js";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const PUB  = process.env.VAPID_PUBLIC_KEY;
  const PRIV = process.env.VAPID_PRIVATE_KEY;
  const SUBJ = process.env.VAPID_SUBJECT || "mailto:drew@dselitevolleyball.com";
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!PUB || !PRIV) return res.status(500).json({ error: "VAPID keys are not set." });
  if (!SUPA_URL || !SUPA_KEY) return res.status(500).json({ error: "Supabase service role is not set." });

  webpush.setVapidDetails(SUBJ, PUB, PRIV);
  const supabase = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: "Invalid JSON body" }); }

  const title = (body && body.title ? String(body.title) : "DS Elite").slice(0, 120);
  const text  = (body && body.body ? String(body.body) : "").slice(0, 300);
  const url   = (body && body.url ? String(body.url) : "/");
  const audience = (body && body.audience) || { type: "all" };

  const { data: subs, error } = await supabase.from("push_subscriptions").select("*");
  if (error) return res.status(500).json({ error: error.message });

  let targets = subs || [];
  if (audience.type === "admins") {
    targets = targets.filter(s => s.is_admin);
  } else if (audience.type === "team") {
    // Admins normally also receive team pushes (to see all activity); pass
    // excludeAdmins:true to target only that team's coaches (e.g. reminders).
    const adminsToo = !audience.excludeAdmins;
    targets = targets.filter(s => (adminsToo && s.is_admin) || (Array.isArray(s.teams) && s.teams.includes(audience.team)));
  } else if (audience.type === "email") {
    const e = String(audience.email || "").toLowerCase();
    targets = targets.filter(s => (s.email || "").toLowerCase() === e);
  } else if (audience.type === "emails") {
    const set = new Set((audience.emails || []).map(e => String(e || "").toLowerCase()));
    targets = targets.filter(s => set.has((s.email || "").toLowerCase()));
  } // "all" → everyone

  const payload = JSON.stringify({ title, body: text, url });
  let sent = 0;
  const stale = [];
  await Promise.all(targets.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      sent++;
    } catch (e) {
      // 404/410 = subscription expired/unsubscribed; clean it up.
      if (e && (e.statusCode === 404 || e.statusCode === 410)) stale.push(s.endpoint);
    }
  }));
  if (stale.length) await supabase.from("push_subscriptions").delete().in("endpoint", stale);

  // A notification and an email are the same message on two channels — Drew's
  // rule. Mirroring here rather than at 26 call sites means a new feature gets
  // both for free and cannot drift back apart.
  //
  // Callers that already send their own email pass skipEmail. As a second
  // guard, we check email_log for the same subject in the last two minutes, so
  // a caller that forgets the flag still doesn't double-mail anyone.
  let mailed = 0;
  if (!body?.skipEmail) {
    try {
      // The email side used to go only to coaches with a push subscription —
      // so a coach who never tapped "Enable notifications" got neither the
      // push NOR the email, and four coaches went a season hearing nothing.
      // Resolve the audience from the team rows and the coach roster too, so
      // the email reaches everyone the message is for, phone set up or not.
      const rosterEmails = await audienceEmails(supabase, audience);
      const emails = [...new Set([...targets.map(s => s.email), ...rosterEmails]
        .map(e => String(e || "").trim().toLowerCase()).filter(Boolean))];
      if (emails.length) {
        // Match on the BODY, not the subject. Callers decorate subjects
        // ("… — DS Elite HQ") while the text stays identical, so a subject
        // match missed a real duplicate: a coach with a stale bundle sent a
        // push without skipEmail, we mirrored it, and 22 people got Kristen's
        // registration note twice. The body is what actually repeats.
        const probe = String(text || "").replace(/\s+/g, " ").trim().slice(0, 120);
        const { data: recent } = await supabase.from("email_log")
          .select("id, body")
          .gte("created_at", new Date(Date.now() - 300000).toISOString()).limit(30);
        const dup = probe.length > 20 && (recent || []).some(r =>
          String(r.body || "").replace(/\s+/g, " ").trim().slice(0, 120) === probe);
        if (!dup) {
          const origin = appOrigin(req);
          const r = await fetch(origin + "/api/send-email", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              subject: title,
              body: text + "\n\n" + origin + (url.startsWith("/") ? url : "/" + url),
              recipients: emails,
              sentBy: body?.sentBy || null, source: "notification",
            }),
          });
          if (r.ok) mailed = emails.length;
        }
      }
    } catch (e) { console.error("push→email mirror failed (push already sent):", e?.message); }
  }

  return res.status(200).json({ ok: true, sent, removed: stale.length, mailed });
}

// Who a push audience means in people, independent of push subscriptions.
// Team coaches come from practice_teams (head / assistant / third) resolved
// to an address through the coach roster and the accounts table, matching
// the app's own rule (full name, or first + last initial). Admins are the
// accounts flagged is_admin. Any failure here returns [] so the push path is
// never blocked by the email one.
async function audienceEmails(supabase, audience) {
  try {
    const type = audience?.type || "all";
    if (type === "email") return [audience.email];
    if (type === "emails") return audience.emails || [];
    if (type === "admins") {
      const { data } = await supabase.from("coaches").select("email").eq("is_admin", true).eq("is_approved", true);
      return (data || []).map(c => c.email);
    }
    const [{ data: teams }, { data: roster }, { data: accounts }] = await Promise.all([
      supabase.from("practice_teams").select("team_name, head_coach, assistant_coach, third_coach"),
      supabase.from("coach_roster").select("first_name, last_name, email"),
      supabase.from("coaches").select("display_name, email, is_admin").eq("is_approved", true),
    ]);
    const norm = s => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
    const byName = new Map();
    const put = (n, e) => { const k = norm(n); if (k && e && !byName.has(k)) byName.set(k, e); };
    for (const r of roster || []) {
      const f = norm(r.first_name), l = norm(r.last_name);
      put(f + " " + l, r.email);
      if (l) put(f + " " + l[0] + ".", r.email);
    }
    for (const a of accounts || []) put(a.display_name, a.email);
    const rows = (teams || []).filter(t => type === "all" || t.team_name === audience.team);
    const out = [];
    for (const t of rows) for (const n of [t.head_coach, t.assistant_coach, t.third_coach]) {
      const e = byName.get(norm(n));
      if (e) out.push(e);
    }
    if (type === "team" && !audience.excludeAdmins) (accounts || []).filter(a => a.is_admin).forEach(a => out.push(a.email));
    return out;
  } catch (e) {
    console.error("audienceEmails failed (push already sent):", e?.message);
    return [];
  }
}
