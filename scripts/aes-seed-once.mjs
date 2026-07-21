// One-off: seed aes_events from the live AES Lone Star feed, silently (marks
// everything notified so the cron only alerts on events added AFTER this).
// Same query the cron uses. Run: node scripts/aes-seed-once.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const l of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const f = `region/regionId eq 4 and endDate ge ${today}T00:00:00Z`;
const u = "https://www.advancedeventsystems.com/api/events?$filter=" + encodeURIComponent(f) + "&$orderby=startDate&$top=1000";
const j = await fetch(u, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36" } }).then(r => r.json());
const rows = (j.value || []).filter(e => e.eventId).map(e => ({
  event_id: e.eventId, name: e.name, start_date: (e.startDate || "").slice(0, 10) || null, end_date: (e.endDate || "").slice(0, 10) || null,
  city: e.address?.city || null, state: e.address?.state?.abbreviation || null, region_id: e.region?.regionId ?? 4, region_name: e.region?.name || null,
  reg_open: !!e.isRegistrationOpen, is_past: !!e.isPastEvent, url: "https://www.advancedeventsystems.com/" + e.eventId,
  raw: { eventType: e.eventType?.description, locationName: e.locationName }, notified: true, updated_at: new Date().toISOString(),
}));
const { error } = await sb.from("aes_events").upsert(rows, { onConflict: "event_id" });
console.log(error ? ("ERR " + error.message) : ("seeded " + rows.length + " Lone Star events (silent)"));
