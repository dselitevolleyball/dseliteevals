// One-click SportWrench → tournaments sync. Called by a bookmarklet the admin
// runs FROM events.sportwrench.com: it fetches /api/esw/events (same-origin, so
// it passes Cloudflare), filters to National Qualifiers + Texas events, and
// POSTs { secret, events } here. We upsert into the tournaments table (source
// "SportWrench:Sync") and alert Drew on brand-new events. SportWrench is behind
// Cloudflare so a server cron can't do this — hence the browser bookmarklet.
//
// Auth: body.secret | ?token= | Bearer  ==  DSSC_SYNC_SECRET (or CRON_SECRET).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DSSC_SYNC_SECRET (or CRON_SECRET),
//      VAPID_* (opt), RESEND_API_KEY/resend_api_key + DSE_FROM_EMAIL (opt),
//      AES_ALERT_EMAILS (opt — reused; default drew@dselitevolleyball.com).

import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { syncSportWrench } from "./_lib/sportwrench-sync.js";

const ALERT_DEFAULT = ["drew@dselitevolleyball.com"];
const fmtD = (iso) => { try { return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }); } catch { return (iso || "").slice(0, 10); } };

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
};
async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let raw = ""; await new Promise((r) => { req.on("data", (c) => (raw += c)); req.on("end", r); req.on("error", r); });
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DSSC_SYNC_SECRET, CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, APP_URL, DSE_FROM_EMAIL, AES_ALERT_EMAILS } = process.env;
  const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.resend_api_key;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const secretExpected = DSSC_SYNC_SECRET || CRON_SECRET;
  if (!secretExpected) return res.status(500).json({ error: "DSSC_SYNC_SECRET not set" });

  const body = await readBody(req);
  const url0 = (() => { try { return new URL(req.url, "https://x"); } catch { return null; } })();
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const provided = body.secret || url0?.searchParams.get("token") || bearer || "";
  if (provided !== secretExpected) return res.status(403).json({ error: "Forbidden" });

  const events = Array.isArray(body.events) ? body.events : null;
  if (!events) return res.status(400).json({ error: "Body must include an `events` array from SportWrench" });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  let result;
  try { result = await syncSportWrench(supabase, events); } catch (e) { return res.status(500).json({ error: String(e.message || e).slice(0, 300) }); }

  // Alert on brand-new events (never on the first seeding run).
  const alertRows = result.firstRun ? [] : result.newRows.slice().sort((a, b) => (a.start_date || "").localeCompare(b.start_date || ""));
  const url = (APP_URL || ("https://" + (req.headers["x-forwarded-host"] || req.headers.host || "dseliteevals.vercel.app"))) + "/?view=tournaments";
  const alertEmails = (AES_ALERT_EMAILS ? AES_ALERT_EMAILS.split(",") : ALERT_DEFAULT).map((s) => s.trim().toLowerCase()).filter(Boolean);
  let pushed = 0;
  if (alertRows.length) {
    if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
      webpush.setVapidDetails(VAPID_SUBJECT || "mailto:drew@dselitevolleyball.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
      const { data: subs } = await supabase.from("push_subscriptions").select("endpoint, p256dh, auth, email");
      const mine = (subs || []).filter((s) => alertEmails.includes((s.email || "").toLowerCase()));
      const head = alertRows[0];
      const payload = JSON.stringify({
        title: alertRows.length === 1 ? "New SportWrench event" : alertRows.length + " new SportWrench events",
        body: alertRows.length === 1 ? `${head.name} — ${fmtD(head.start_date)}${head.location ? " · " + head.location : ""}` : `${head.name} + ${alertRows.length - 1} more. Tap to view.`,
        url,
      });
      await Promise.all(mine.map((s) => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload).catch(() => {})));
      pushed = mine.length;
    }
    if (RESEND_API_KEY && DSE_FROM_EMAIL) {
      const li = alertRows.map((r) => `<li><a href="${r.source_url}">${r.name}</a> — ${fmtD(r.start_date)}${r.location ? " · " + r.location : ""}${r.is_qualifier ? " · <b>National Qualifier</b>" : ""}</li>`).join("");
      const text = alertRows.map((r) => `• ${r.name} — ${fmtD(r.start_date)}${r.location ? " · " + r.location : ""}  ${r.source_url}`).join("\n");
      await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: DSE_FROM_EMAIL, to: alertEmails, subject: `New SportWrench event${alertRows.length === 1 ? "" : "s"} — ${alertRows.length}`, html: `<div style="font-family:sans-serif;font-size:14px"><p><b>${alertRows.length}</b> new SportWrench event${alertRows.length === 1 ? "" : "s"} (qualifiers / Texas):</p><ul>${li}</ul><p><a href="${url}">Open the Tournaments listings →</a></p></div>`, text }),
      }).catch(() => {});
    }
  }

  return res.status(200).json({ ok: true, ...result, alerted: alertRows.length, pushed, newRows: undefined });
}
