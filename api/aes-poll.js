// Vercel Cron: poll the public AES (Advanced Event Systems) OData API for
// upcoming Lone Star region (regionId=4) volleyball events, mirror them into
// aes_events, and alert Drew the moment a brand-new event is posted. AES is
// public + server-fetchable (this is the same feed VolleyballHub uses), so this
// is fully hands-off — no browser, no credentials.
//
// First run seeds the current backlog silently (marks everything notified) so
// we only ping on events that appear AFTER that.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; also ?token=.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
//      VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (opt), APP_URL (opt),
//      RESEND_API_KEY (or resend_api_key), DSE_FROM_EMAIL,
//      AES_ALERT_EMAILS (opt comma list — default drew@dselitevolleyball.com),
//      AES_REGION_ID (opt — default 4 = Lone Star).

import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const ALERT_DEFAULT = ["drew@dselitevolleyball.com"];
const fmtD = (iso) => { try { return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }); } catch { return (iso || "").slice(0, 10); } };

async function fetchLoneStar(regionId, today) {
  const filter = `region/regionId eq ${regionId} and endDate ge ${today}T00:00:00Z`;
  const url = "https://www.advancedeventsystems.com/api/events?$filter=" + encodeURIComponent(filter) + "&$orderby=startDate&$top=1000";
  const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA } });
  if (!r.ok) throw new Error("AES fetch " + r.status);
  const j = await r.json();
  return Array.isArray(j) ? j : (j.value || []);
}

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, APP_URL, DSE_FROM_EMAIL, AES_ALERT_EMAILS, AES_REGION_ID } = process.env;
  const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.resend_api_key;

  const urlToken = (() => { try { return new URL(req.url, "https://x").searchParams.get("token") || ""; } catch { return ""; } })();
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!CRON_SECRET || (bearer !== CRON_SECRET && urlToken !== CRON_SECRET)) return res.status(403).json({ error: "Forbidden" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const regionId = Number(AES_REGION_ID) || 4;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

  let events;
  try { events = await fetchLoneStar(regionId, today); } catch (e) { return res.status(502).json({ error: String(e.message || e) }); }

  const rows = events.map((e) => ({
    event_id: e.eventId,
    name: e.name,
    start_date: (e.startDate || "").slice(0, 10) || null,
    end_date: (e.endDate || "").slice(0, 10) || null,
    city: e.address?.city || null,
    state: e.address?.state?.abbreviation || null,
    region_id: e.region?.regionId ?? regionId,
    region_name: e.region?.name || null,
    reg_open: !!e.isRegistrationOpen,
    is_past: !!e.isPastEvent,
    url: "https://www.advancedeventsystems.com/" + e.eventId,
    raw: { affiliation: e.affiliation?.description, eventType: e.eventType?.description, locationName: e.locationName, regEnd: e.registrationPeriod?.endDate },
    updated_at: new Date().toISOString(),
  })).filter((r) => r.event_id);

  // Who's new vs known (preserve notified/first_seen on existing by omitting them from the upsert).
  const { data: existing, count } = await supabase.from("aes_events").select("event_id", { count: "exact" });
  const knownIds = new Set((existing || []).map((r) => r.event_id));
  const firstRun = (count || 0) === 0;
  const newRows = rows.filter((r) => !knownIds.has(r.event_id));

  if (rows.length) {
    const { error } = await supabase.from("aes_events").upsert(rows, { onConflict: "event_id" });
    if (error) return res.status(500).json({ error: "upsert: " + error.message });
  }

  // Alert on brand-new events (not on the first seeding run).
  const alertRows = firstRun ? [] : newRows.slice().sort((a, b) => (a.start_date || "").localeCompare(b.start_date || ""));
  const url = (APP_URL || ("https://" + (req.headers["x-forwarded-host"] || req.headers.host || "dseliteevals.vercel.app"))) + "/?view=aesevents";
  const alertEmails = (AES_ALERT_EMAILS ? AES_ALERT_EMAILS.split(",") : ALERT_DEFAULT).map((s) => s.trim().toLowerCase()).filter(Boolean);

  let pushed = 0;
  if (alertRows.length) {
    if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
      webpush.setVapidDetails(VAPID_SUBJECT || "mailto:drew@dselitevolleyball.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
      const { data: subs } = await supabase.from("push_subscriptions").select("endpoint, p256dh, auth, email");
      const mine = (subs || []).filter((s) => alertEmails.includes((s.email || "").toLowerCase()));
      const head = alertRows[0];
      const payload = JSON.stringify({
        title: alertRows.length === 1 ? "New Lone Star event posted" : alertRows.length + " new Lone Star events posted",
        body: alertRows.length === 1 ? `${head.name} — ${fmtD(head.start_date)}${head.city ? " · " + head.city : ""}` : `${head.name} + ${alertRows.length - 1} more. Tap to view.`,
        url,
      });
      await Promise.all(mine.map((s) => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload).catch(() => {})));
      pushed = mine.length;
    }
    if (RESEND_API_KEY && DSE_FROM_EMAIL) {
      const li = alertRows.map((r) => `<li><a href="${r.url}">${r.name}</a> — ${fmtD(r.start_date)}${r.city ? " · " + r.city + (r.state ? ", " + r.state : "") : ""}${r.reg_open ? " · <b>registration open</b>" : ""}</li>`).join("");
      const text = alertRows.map((r) => `• ${r.name} — ${fmtD(r.start_date)}${r.city ? " · " + r.city : ""}  ${r.url}`).join("\n");
      await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: DSE_FROM_EMAIL, to: alertEmails, subject: `New Lone Star volleyball event${alertRows.length === 1 ? "" : "s"} posted — ${alertRows.length}`, html: `<div style="font-family:sans-serif;font-size:14px"><p><b>${alertRows.length}</b> new Lone Star region event${alertRows.length === 1 ? "" : "s"} just posted on AES:</p><ul>${li}</ul><p><a href="${url}">See all upcoming Lone Star events →</a></p></div>`, text }),
      }).catch(() => {});
    }
  }

  // Mark every new row processed so we only alert once (first run marks the backlog).
  if (newRows.length) {
    await supabase.from("aes_events").update({ notified: true }).in("event_id", newRows.map((r) => r.event_id));
  }

  return res.status(200).json({ ok: true, fetched: rows.length, firstRun, newEvents: newRows.length, alerted: alertRows.length, pushed });
}
