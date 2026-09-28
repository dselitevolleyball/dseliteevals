// Run the Saturday weekly-schedule notice from here, through the deployed
// endpoint, with the service-role key as the operator credential.
//
//   node scripts/weekly-schedule-run.mjs --dry                 # what everyone would get
//   node scripts/weekly-schedule-run.mjs --test                # Drew's own week, to Drew only
//   node scripts/weekly-schedule-run.mjs --send                # everyone, text + push
//   node scripts/weekly-schedule-run.mjs --dry --week 2026-10-04
//   node scripts/weekly-schedule-run.mjs --wait --dry          # keep trying until the deploy answers
//
// Env: SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
const APP = "https://dseliteevals.vercel.app";
const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const qs = new URLSearchParams();
if (args.includes("--dry")) qs.set("dry", "1");
if (args.includes("--test")) qs.set("test", "1");
if (val("week")) qs.set("week", val("week"));
if (val("channels")) qs.set("channels", val("channels"));
if (!qs.has("dry") && !qs.has("test") && !args.includes("--send")) { console.error("Say --dry, --test or --send."); process.exit(1); }
const tries = args.includes("--wait") ? 30 : 1;
for (let i = 1; i <= tries; i++) {
  const r = await fetch(APP + "/api/weekly-schedule?" + qs, { method: "POST", headers: { Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY } });
  const o = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403 || r.status === 404) { console.log(`attempt ${i}: ${r.status} (deploy not live yet)`); await new Promise(res => setTimeout(res, 10000)); continue; }
  if (o.dry) { console.log(`week ${o.week.start} → ${o.week.end} · ${o.count} coaches\n`); for (const c of o.coaches) console.log("=== " + c.name + " (" + c.work + " shifts, " + c.out + " covered, " + c.hours + "h)\n" + c.sms + "\n"); }
  else console.log(JSON.stringify(o, null, 1));
  process.exit(r.ok ? 0 : 2);
}
console.log("gave up waiting"); process.exit(3);
