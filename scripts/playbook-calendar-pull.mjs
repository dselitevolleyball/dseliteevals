// Run the hourly Playbook calendar pull from here — same fetcher, same merge —
// to catch a class up right now or to check what the cron would do.
//
//   node scripts/playbook-calendar-pull.mjs            # dry: what Playbook has
//   node scripts/playbook-calendar-pull.mjs --sync     # write it to dssc_clinics
//   node scripts/playbook-calendar-pull.mjs --days 60
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { syncClinics, parsePlaybookEvents } from "../api/_lib/dssc-clinics-sync.js";
import { fetchPlaybookEvents, centralToday, addDays } from "../api/_lib/playbook-calendar.js";

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const doSync = args.includes("--sync");
const days = Number(val("days")) || 120;

const start = centralToday(), end = addDays(start, days);
console.log(`pulling ${start} → ${end} …`);
const t0 = Date.now();
const events = await fetchPlaybookEvents(start, end);
const progs = Object.values(parsePlaybookEvents(events));
console.log(`${events.length} events in ${Math.round((Date.now() - t0) / 1000)}s · ${progs.length} volleyball programs`);
for (const p of progs) console.log(`  ${p.name.padEnd(40)} ${String(p.sessions.length).padStart(3)} sessions  ${p.sessions[0]?.date} .. ${p.sessions[p.sessions.length - 1]?.date}`);
if (!doSync) { console.log("\nDRY RUN — --sync to write."); process.exit(0); }

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const out = await syncClinics(sb, events, { syncedBy: "playbook pull (script)", window: { min: start, max: addDays(end, -1) } });
console.log(JSON.stringify(out, null, 1));
