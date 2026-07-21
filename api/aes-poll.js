// Vercel Cron: poll the public AES (Advanced Event Systems) OData API for
// upcoming Lone Star region (regionId=4) volleyball events, mirror them into the
// tournaments table (source "AES:LoneStar") so they show in the Tournaments
// Listings alongside National Qualifiers, and alert Drew the moment a brand-new
// event is posted. AES is public + server-fetchable (same feed VolleyballHub
// uses), so this is fully hands-off — no browser, no credentials.
//
// Dedupe is by source_url (= advancedeventsystems.com/{eventId}). We only ever
// touch our own AES:LoneStar rows — manual/imported tournaments are untouched.
// First run seeds the current backlog silently (alerts only on later additions).
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
const SOURCE = "AES:LoneStar";
const fmtD = (iso) => { try { return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }); } catch { return (iso || "").slice(0, 10); } };
const aesUrl = (id) => "https://www.advancedeventsystems.com/" + id;

async function fetchLoneStar(regionId, today) {
  const filter = `region/regionId eq ${regionId} and endDate ge ${today}T00:00:00Z`;
  const url = "https://www.advancedeventsystems.com/api/events?$filter=" + encodeURIComponent(filter) + "&$orderby=startDate&$top=1000";
  const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA } });
  if (!r.ok) throw new Error("AES fetch " + r.status);
  const j = await r.json();
  return Array.isArray(j) ? j : (j.value || []);
}

// AES event → tournaments row.
function toRow(e) {
  const loc = [e.address?.city, e.address?.state?.abbreviation].filter(Boolean).join(", ") || null;
  return {
    name: e.name,
    start_date: (e.startDate || "").slice(0, 10) || null,
    end_date: (e.endDate || "").slice(0, 10) || null,
    location: loc,
    venue: e.locationName || null,
    status: e.isRegistrationOpen ? "Registration open" : "",
    source: SOURCE,
    source_url: aesUrl(e.eventId),
    is_qualifier: false,
    gender: null,
    cancelled: false,
    updated_at: new Date().toISOString(),
  };
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
  const rows = events.filter((e) => e.eventId).map(toRow);

  // Existing AES:LoneStar tournaments, keyed by source_url → id.
  const { data: existing } = await supabase.from("tournaments").select("id, source_url").eq("source", SOURCE);
  const idByUrl = new Map((existing || []).map((r) => [r.source_url, r.id]));
  const firstRun = idByUrl.size === 0;

  const updates = rows.filter((r) => idByUrl.has(r.source_url)).map((r) => ({ id: idByUrl.get(r.source_url), ...r }));
  const inserts = rows.filter((r) => !idByUrl.has(r.source_url));

  if (updates.length) { const { error } = await supabase.from("tournaments").upsert(updates, { onConflict: "id" }); if (error) return res.status(500).json({ error: "update: " + error.message }); }
  if (inserts.length) { const { error } = await supabase.from("tournaments").insert(inserts); if (error) return res.status(500).json({ error: "insert: " + error.message }); }

  // Alert on brand-new events (never on the first seeding run).
  const alertRows = firstRun ? [] : inserts.slice().sort((a, b) => (a.start_date || "").localeCompare(b.start_date || ""));
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
        title: alertRows.length === 1 ? "New Lone Star event posted" : alertRows.length + " new Lone Star events posted",
        body: alertRows.length === 1 ? `${head.name} — ${fmtD(head.start_date)}${head.location ? " · " + head.location : ""}` : `${head.name} + ${alertRows.length - 1} more. Tap to view.`,
        url,
      });
      await Promise.all(mine.map((s) => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload).catch(() => {})));
      pushed = mine.length;
    }
    if (RESEND_API_KEY && DSE_FROM_EMAIL) {
      const li = alertRows.map((r) => `<li><a href="${r.source_url}">${r.name}</a> — ${fmtD(r.start_date)}${r.location ? " · " + r.location : ""}${r.status ? " · <b>" + r.status.toLowerCase() + "</b>" : ""}</li>`).join("");
      const text = alertRows.map((r) => `• ${r.name} — ${fmtD(r.start_date)}${r.location ? " · " + r.location : ""}  ${r.source_url}`).join("\n");
      await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: DSE_FROM_EMAIL, to: alertEmails, subject: `New Lone Star volleyball event${alertRows.length === 1 ? "" : "s"} posted — ${alertRows.length}`, html: `<div style="font-family:sans-serif;font-size:14px"><p><b>${alertRows.length}</b> new Lone Star region event${alertRows.length === 1 ? "" : "s"} just posted on AES:</p><ul>${li}</ul><p><a href="${url}">Open the Tournaments listings →</a></p></div>`, text }),
      }).catch(() => {});
    }
  }

  return res.status(200).json({ ok: true, fetched: rows.length, firstRun, inserted: inserts.length, updated: updates.length, alerted: alertRows.length, pushed });
}
