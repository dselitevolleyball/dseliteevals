// Send coaches the clock-in & time-off walkthrough (public/coach-guide.html,
// served at /coach-guide) by text and app notification.
//
//   node scripts/send-coach-guide.mjs --test      # Drew only
//   node scripts/send-coach-guide.mjs --dry       # who would get it
//   node scripts/send-coach-guide.mjs --send      # every coach
//   add --wait to keep retrying until the deploy is live
//
// Env: SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
const APP = "https://dseliteevals.vercel.app";
const GUIDE = APP + "/coach-guide";
const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const args = process.argv.slice(2);
const qs = new URLSearchParams();
if (args.includes("--test")) qs.set("test", "1");
if (args.includes("--dry")) qs.set("dry", "1");
if (!qs.has("test") && !qs.has("dry") && !args.includes("--send")) { console.error("Say --test, --dry or --send."); process.exit(1); }

const message = {
  label: "clock-in guide",
  url: GUIDE,
  sms: `Hi {first} — a 2-minute walkthrough on clocking in and requesting time off: how you get paid on time, and how we get your team covered when you can't make it. Please give it a look before Sunday: ${GUIDE} — Drew`,
  push_title: "How clocking in & time off work",
  push_body: "2-minute walkthrough: how you get paid on time and how we cover your team. Tap to read.",
};

const tries = args.includes("--wait") ? 30 : 1;
for (let i = 1; i <= tries; i++) {
  const r = await fetch(APP + "/api/coach-broadcast?" + qs, { method: "POST", headers: { Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY, "Content-Type": "application/json" }, body: JSON.stringify(message) });
  if (r.status === 404 || r.status === 401) { console.log(`attempt ${i}: ${r.status} (deploy not live yet)`); await new Promise(res => setTimeout(res, 10000)); continue; }
  console.log(JSON.stringify(await r.json().catch(() => ({})), null, 1));
  process.exit(r.ok ? 0 : 2);
}
console.log("gave up waiting"); process.exit(3);
