// One-off: seed/refresh DSSC clinics from a Playbook getEvents() JSON dump.
// Uses the SAME merge logic as the live bookmarklet endpoint, so running this
// is equivalent to a bookmarklet sync — safe to re-run (idempotent merge).
//
//   node scripts/dssc-sync-from-json.mjs <events.json>
//
// <events.json> is the raw array from window.fullCalendar.getEvents(), each
// item { title, start|startStr, end|endStr, ext|extendedProps:{...} }.
// Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from a gitignored .env.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { syncClinics } from "../api/_lib/dssc-clinics-sync.js";

function loadEnv() {
  let raw = "";
  try { raw = readFileSync(new URL("../.env", import.meta.url), "utf8"); }
  catch { console.error("Missing .env next to package.json."); process.exit(1); }
  const env = {};
  for (const line of raw.split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
  return env;
}

const file = process.argv[2];
if (!file) { console.error("Usage: node scripts/dssc-sync-from-json.mjs <events.json>"); process.exit(1); }
const env = loadEnv();
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env"); process.exit(1); }

const events = JSON.parse(readFileSync(file, "utf8"));
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const summary = await syncClinics(supabase, Array.isArray(events) ? events : events.events, { syncedBy: "local-seed" });
console.log(JSON.stringify(summary, null, 2));
