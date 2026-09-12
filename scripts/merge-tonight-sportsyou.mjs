// One SportsYou post per team tonight, instead of two.
//
// Two things are queued for the same families: tonight's orientation reminder
// (15s and 16 Diamond) and the Reach Performance block that starts tomorrow
// (eight teams). Three teams — 15 Diamond, 15 Ruby, 16 Diamond — are in both,
// and two posts landing at once is how the second one goes unread.
//
// So the queue is rebuilt as one row per team:
//   in both      → orientation, then the Reach section under it
//   orientation  → unchanged
//   Reach only   → unchanged
//
// The orientation wording is taken from the rows already queued rather than
// rewritten, so what goes out is what was approved.
//
// The Friday 18 and Friday 25 reminders are set to "held" — Drew wants them
// nearer their nights, and the bookmarklet drains everything pending. Held
// rows are one status flip away from going out.
//
// DRY RUN BY DEFAULT.
//
// Usage:
//   node scripts/merge-tonight-sportsyou.mjs
//   node scripts/merge-tonight-sportsyou.mjs --apply
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BLOCK = "fall1";
const TONIGHT = "%September 12%";
const HOLD_LIKE = ["%September 18%", "%September 25%"];
const REACH_SUBJECT_PART = "Reach Performance";

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const apply = process.argv.includes("--apply");
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: queued } = await sb.from("sportsyou_outbox").select("*").eq("status", "pending");
const orientation = (queued || []).filter(r => /September 12/.test(r.subject));
const reach = (queued || []).filter(r => r.subject.includes(REACH_SUBJECT_PART));
const toHold = (queued || []).filter(r => /September 18|September 25/.test(r.subject));
if (!orientation.length && !reach.length) { console.error("Nothing pending to merge."); process.exit(1); }

const byTeam = new Map();
for (const r of orientation) byTeam.set(r.team_name, { team: r.team_name, orientation: r, reach: null });
for (const r of reach) {
  if (!byTeam.has(r.team_name)) byTeam.set(r.team_name, { team: r.team_name, orientation: null, reach: r });
  else byTeam.get(r.team_name).reach = r;
}

// The Reach half of a combined post: the same facts as the standalone one,
// shortened, because it is riding under a full orientation notice.
const reachTail = (msg) => {
  // Keep everything from the schedule sentence on; drop the standalone opener,
  // which duplicates a heading we are about to write.
  const i = msg.indexOf("Speed and agility training");
  return i >= 0 ? msg.slice(i).trim() : msg.trim();
};

const rows = [];
for (const { team, orientation: o, reach: r } of [...byTeam.values()].sort((a, b) => a.team.localeCompare(b.team))) {
  if (o && r) {
    rows.push({
      team_name: team,
      subject: "Tonight's orientation — and speed & agility starts tomorrow",
      message: o.message.trim()
        + "\n\n———\n\nONE MORE THING — SPEED & AGILITY STARTS TOMORROW\n\n"
        + reachTail(r.message),
      replaces: [o.id, r.id],
    });
  } else if (o) {
    rows.push({ team_name: team, subject: o.subject, message: o.message, replaces: [o.id] });
  } else {
    rows.push({ team_name: team, subject: r.subject, message: r.message, replaces: [r.id] });
  }
}

const combined = rows.filter(r => r.replaces.length === 2);
console.log(`${rows.length} posts after merging — ${combined.length} combined (${combined.map(r => r.team_name).join(", ")})`);
console.log(`holding ${toHold.length}: ${[...new Set(toHold.map(r => r.subject))].join(" / ")}\n`);
const sample = combined[0] || rows[0];
console.log("─".repeat(70) + "\n" + sample.team_name + " · " + sample.subject + "\n" + "─".repeat(70));
console.log(sample.message + "\n");

if (!apply) { console.log("DRY RUN — queue unchanged. Re-run with --apply."); process.exit(0); }

const now = new Date().toISOString();
// Held first: if anything below fails, the queue still doesn't contain posts
// Drew asked to keep back.
if (toHold.length) {
  const { error } = await sb.from("sportsyou_outbox")
    .update({ status: "held", sy_response: "Held on Drew's instruction — re-queue nearer the night by setting status back to pending." })
    .in("id", toHold.map(r => r.id));
  if (error) { console.error("Hold failed: " + error.message); process.exit(1); }
}
// Insert the merged rows, then retire the originals — in that order, so a
// failure leaves the old rows intact rather than losing the message entirely.
const { error: insErr } = await sb.from("sportsyou_outbox").insert(rows.map(r => ({
  team_name: r.team_name, subject: r.subject, message: r.message,
  status: "pending", queued_by: "Drew Rose", queued_at: now,
})));
if (insErr) { console.error("Insert failed: " + insErr.message); process.exit(1); }
const replaced = rows.flatMap(r => r.replaces);
const { error: supErr } = await sb.from("sportsyou_outbox")
  .update({ status: "superseded", sy_response: "Replaced by the merged post queued " + now })
  .in("id", replaced);
if (supErr) { console.error("Supersede failed — DUPLICATES ARE NOW QUEUED, fix before posting: " + supErr.message); process.exit(1); }

const { data: left } = await sb.from("sportsyou_outbox").select("team_name, subject").eq("status", "pending").order("team_name");
console.log(`\nQueue is now ${left.length} posts:`);
left.forEach(r => console.log("   " + r.team_name.padEnd(13) + r.subject));
