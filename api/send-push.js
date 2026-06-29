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
    targets = targets.filter(s => s.is_admin || (Array.isArray(s.teams) && s.teams.includes(audience.team)));
  } else if (audience.type === "email") {
    const e = String(audience.email || "").toLowerCase();
    targets = targets.filter(s => (s.email || "").toLowerCase() === e);
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

  return res.status(200).json({ ok: true, sent, removed: stale.length });
}
