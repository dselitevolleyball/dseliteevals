// One-off: seed the tournaments table from the live AES Lone Star feed, silently
// (dedupes on source_url so re-running is safe; no alerts). Same query/mapping
// as api/aes-poll. Run: node scripts/aes-seed-once.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const l of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const SOURCE = "AES:LoneStar";

const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const f = `region/regionId eq 4 and endDate ge ${today}T00:00:00Z`;
const u = "https://www.advancedeventsystems.com/api/events?$filter=" + encodeURIComponent(f) + "&$orderby=startDate&$top=1000";
const j = await fetch(u, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36" } }).then(r => r.json());
const rows = (j.value || []).filter(e => e.eventId).map(e => ({
  name: e.name,
  start_date: (e.startDate || "").slice(0, 10) || null,
  end_date: (e.endDate || "").slice(0, 10) || null,
  location: [e.address?.city, e.address?.state?.abbreviation].filter(Boolean).join(", ") || null,
  venue: e.locationName || null,
  status: e.isRegistrationOpen ? "Registration open" : "",
  source: SOURCE, source_url: "https://www.advancedeventsystems.com/" + e.eventId,
  is_qualifier: false, gender: null, cancelled: false, updated_at: new Date().toISOString(),
}));

const { data: existing } = await sb.from("tournaments").select("id, source_url").eq("source", SOURCE);
const known = new Set((existing || []).map(r => r.source_url));
const inserts = rows.filter(r => !known.has(r.source_url));
if (inserts.length) { const { error } = await sb.from("tournaments").insert(inserts); if (error) { console.log("ERR " + error.message); process.exit(1); } }
console.log(`Lone Star events: ${rows.length} total, inserted ${inserts.length} new (skipped ${rows.length - inserts.length} already present).`);
