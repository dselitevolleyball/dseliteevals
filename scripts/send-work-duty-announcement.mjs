// Oct 9 2026: picture text to every team coach announcing Work Duty.
//   node scripts/send-work-duty-announcement.mjs            # dry run
//   node scripts/send-work-duty-announcement.mjs --send

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { isEventTeam } from "../shared/event-teams.js";

const APP = "https://dseliteevals.vercel.app";
const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const IMAGE = env.SUPABASE_URL + "/storage/v1/object/public/email-images/announcements/work-duty-2026-10-09.png";
const TEXT = "Hi {first}, new in DS Elite HQ: Work Duty. When your team works a match at a tournament, open Players > Work Duty and your next work assignment is already dealt: score book + VolleyStation, libero tracker, and each set's line judges and flipper. Untick anyone who isn't at the tournament and her jobs get re-dealt. Tap Done and the next one pops up. It keeps every girl even on every job all season. " + APP + "/?view=workduty - Drew";

const [{ data: pt }, { data: cr }, { data: outs }] = await Promise.all([
  sb.from("practice_teams").select("team_name, head_coach, assistant_coach, third_coach, practices_per_week"),
  sb.from("coach_roster").select("first_name, last_name, phone"),
  sb.from("sms_optouts").select("phone"),
]);
const nm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
const last10 = (p) => String(p || "").replace(/\D/g, "").slice(-10);
const out = new Set((outs || []).map(o => last10(o.phone)));
const names = [...new Set(pt.filter(t => !isEventTeam(t)).flatMap(t => [t.head_coach, t.assistant_coach, t.third_coach]).filter(Boolean))];
const seen = new Set(), jobs = [];
for (const n of names) {
  const r = cr.find(x => nm(x.first_name + x.last_name) === nm(n));
  const d = last10(r?.phone); if (d.length !== 10 || seen.has(d) || out.has(d)) continue;
  seen.add(d); jobs.push({ to: "+1" + d, name: (r.first_name + " " + r.last_name).trim() });
}
console.log(jobs.length + " coaches: " + jobs.map(j => j.name).join(", "));
if (!process.argv.includes("--send")) { console.log("DRY RUN"); process.exit(0); }
let ok = 0; const failed = [];
for (const j of jobs) {
  const r = await fetch(APP + "/api/send-sms", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY },
    body: JSON.stringify({ to: j.to, body: TEXT, media_urls: [IMAGE], contact_name: j.name, contact_kind: "coach", sent_by_label: "Drew Rose" }) });
  const o = await r.json().catch(() => ({}));
  if (r.ok && !o.error) ok++; else failed.push(j.name + ": " + (o.error || r.status));
}
console.log(`Sent ${ok} of ${jobs.length}` + (failed.length ? "\nFailed: " + failed.join("; ") : ""));
