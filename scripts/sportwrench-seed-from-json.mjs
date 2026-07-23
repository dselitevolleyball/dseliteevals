// One-off: seed tournaments from a SportWrench events JSON dump (extracted from
// a browser on events.sportwrench.com, since Cloudflare blocks server fetch).
// Same merge logic as the live bookmarklet endpoint — safe to re-run.
//   node scripts/sportwrench-seed-from-json.mjs <events.json>
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { syncSportWrench } from "../api/_lib/sportwrench-sync.js";

const env = {};
for (const l of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const file = process.argv[2];
if (!file) { console.error("Usage: node scripts/sportwrench-seed-from-json.mjs <events.json>"); process.exit(1); }
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const events = JSON.parse(readFileSync(file, "utf8"));
const r = await syncSportWrench(sb, Array.isArray(events) ? events : events.events);
console.log(JSON.stringify(r, null, 2));
