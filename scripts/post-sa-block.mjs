// SportsYou: a fall speed & agility block, per team — and what changed.
//
// For each team with S&A in the block, one post: the five Sundays, the order
// of their hour of speed & agility and their hour of practice, and the window
// that makes. Built from sa_sessions and practice_assignments, so the post
// says what the calendar says.
//
// --before <snapshot id> compares against a practice_snapshots restore point
// and says, per team, whether the times are new, changed or the same. Families
// whose Sunday moved need to be told it moved; families whose Sunday didn't
// shouldn't be made to hunt for a change that isn't there.
//
// Queues into sportsyou_outbox — nothing reaches SportsYou until the
// bookmarklet runs. A team that already has this exact post pending is skipped.
//
// DRY RUN BY DEFAULT.
//
// Usage:
//   node scripts/post-sa-block.mjs --block fall2 --before 15
//   node scripts/post-sa-block.mjs --block fall2 --before 15 --queue
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const BLOCK = val("block") || "fall2";
const BEFORE = val("before") ? Number(val("before")) : null;
const doQueue = args.includes("--queue");
const LABEL = { fall1: "Fall 1", fall2: "Fall 2" }[BLOCK] || BLOCK;

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const [{ data: sa }, { data: pa }, { data: snap }] = await Promise.all([
  sb.from("sa_sessions").select("team_name, slot, session_date").eq("block", BLOCK).order("session_date"),
  sb.from("practice_assignments").select("team_name, slot, day, phase").eq("phase", BLOCK).eq("day", "Sun"),
  BEFORE ? sb.from("practice_snapshots").select("id, created_at, assignments, sa_sessions").eq("id", BEFORE).maybeSingle()
         : Promise.resolve({ data: null }),
]);
if (!sa?.length) { console.error("No " + BLOCK + " speed & agility sessions."); process.exit(1); }
if (BEFORE && !snap) { console.error("Snapshot " + BEFORE + " not found."); process.exit(1); }

// Afternoon/evening hours: 12 is noon, everything else pm.
const hr = (n) => (Number(n) === 12 ? 12 : Number(n) + 12);
const parse = (slot) => { const m = /^(\d{1,2})\s*-\s*(\d{1,2})/.exec(String(slot || "")); return m ? { start: hr(m[1]), end: hr(m[2]) } : null; };
const clock = (h) => { const x = h > 12 ? h - 12 : h; return x + (h >= 12 ? "pm" : "am"); };
const span = (a, b) => { const s = clock(a).replace(/[ap]m$/, ""), e = clock(b); return (clock(a).slice(-2) === e.slice(-2) ? s : clock(a)) + "–" + e; };
// "5-6pm" + "6-7pm" → "5–7pm", so a two-hour practice reads as one block.
const merged = (slots) => {
  const r = slots.map(parse).filter(Boolean).sort((x, y) => x.start - y.start);
  const out = [];
  for (const x of r) { const last = out[out.length - 1]; if (last && last.end === x.start) last.end = x.end; else out.push({ ...x }); }
  return out.map(x => span(x.start, x.end));
};

const dates = [...new Set(sa.map(s => s.session_date))].sort();
const byMonth = new Map();
for (const d of dates) {
  const dt = new Date(d + "T12:00:00Z");
  const mon = dt.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  if (!byMonth.has(mon)) byMonth.set(mon, []);
  byMonth.get(mon).push(dt.getUTCDate());
}
const join = (xs) => xs.length <= 1 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];
// "October 18 and 25, November 1, 8 and 15" — months separated by a comma so
// the "and" inside each month isn't doubled up.
const datesSentence = [...byMonth.entries()].map(([m, ds]) => m + " " + join(ds.map(String))).join(", ");
const firstDate = new Date(dates[0] + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const lastDate = new Date(dates[dates.length - 1] + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

const beforeSA = (team) => (snap?.sa_sessions || []).find(r => r.block === BLOCK && r.team_name === team)?.slot || null;
const beforePractice = (team) => (snap?.assignments || []).filter(r => r.phase === BLOCK && r.day === "Sun" && r.team_name === team).map(r => r.slot);

const teams = [...new Set(sa.map(s => s.team_name))].sort();
const posts = [];
for (const team of teams) {
  const saSlot = sa.find(s => s.team_name === team).slot;
  const practice = pa.filter(p => p.team_name === team).map(p => p.slot);
  const s = parse(saSlot);
  const p = merged(practice);
  const saFirst = practice.map(parse).filter(Boolean).every(x => x.start >= s.end);
  const allH = [s, ...practice.map(parse).filter(Boolean)];
  const windowText = span(Math.min(...allH.map(x => x.start)), Math.max(...allH.map(x => x.end)));
  const saLine = `  ${span(s.start, s.end)} — speed & agility with Reach Performance`;
  const pLine = `  ${p.join(" and ")} — practice`;

  let status = "same", was = "";
  if (snap) {
    const bSA = beforeSA(team), bP = beforePractice(team);
    const sameP = [...bP].sort().join() === [...practice].sort().join();
    if (!bSA) { status = "new"; was = bP.length ? `practice ${merged(bP).join(" and ")}` : "not on the Sunday schedule"; }
    else if (bSA !== saSlot || !sameP) {
      status = "changed";
      was = `speed & agility ${span(parse(bSA).start, parse(bSA).end)}, practice ${merged(bP).join(" and ")}`;
    }
  }
  // A new team whose two hours also moved must be told the window moved — "one
  // hour becomes S&A" read alone sends 14 Ruby families in at 5pm for a 6pm start.
  const oldWindow = (() => {
    const bp = snap ? beforePractice(team).map(parse).filter(Boolean) : [];
    return bp.length ? span(Math.min(...bp.map(x => x.start)), Math.max(...bp.map(x => x.end))) : null;
  })();
  const changeLine = status === "new"
    ? (oldWindow && oldWindow !== windowText
        ? `This is new for ${team}: it wasn't in a speed & agility block before (it had ${was}). For these five Sundays your two hours become ${windowText} instead of ${oldWindow} — please note the later start.`
        : `This is new for ${team}: it wasn't in a speed & agility block before (it had ${was}), so for these five Sundays one of your two hours becomes speed & agility. Your Sunday is still ${windowText}.`)
    : status === "changed"
    ? `Your times have changed from what was on the schedule before (${was}), so please check the new times above.`
    : `Your times haven't changed.`;

  const message = `${team} families — your Sunday schedule for the ${LABEL} block.

For five Sundays — ${datesSentence} — each Sunday is one hour of speed & agility and one hour of practice:

${saFirst ? saLine + "\n" + pLine : pLine + "\n" + saLine}

That makes your Sunday ${windowText}, starting ${firstDate}.

${changeLine}

${status === "same" ? "These are the times on your team calendar in SportsYou." : "Your team calendar in SportsYou already shows the new times."} The block runs through ${lastDate}.`;

  posts.push({ team_name: team, status, subject: `${LABEL} Sundays: 1 hour speed & agility + 1 hour practice, starts ${new Date(dates[0] + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`, message });
}

console.log(`${posts.length} teams in ${LABEL} (${dates[0]} → ${dates[dates.length - 1]})` + (snap ? `, compared with snapshot #${snap.id} (${snap.created_at.slice(0, 16)})` : ""));
for (const p of posts) console.log(`  ${p.team_name.padEnd(12)} ${p.status}`);
for (const p of posts.filter(x => x.status !== "same").slice(0, 2).concat(posts.filter(x => x.status === "same").slice(0, 1))) {
  console.log("\n" + "─".repeat(70) + "\n" + p.team_name + " · " + p.subject + "\n" + "─".repeat(70) + "\n" + p.message);
}

if (!doQueue) { console.log("\nDRY RUN — nothing queued. Re-run with --queue."); process.exit(0); }
const { data: pending } = await sb.from("sportsyou_outbox").select("team_name, subject").eq("status", "pending");
const dup = new Set((pending || []).map(r => r.team_name + "|" + r.subject));
const rows = posts.filter(p => !dup.has(p.team_name + "|" + p.subject))
  .map(p => ({ team_name: p.team_name, subject: p.subject, message: p.message, status: "pending", queued_by: "Drew Rose", queued_at: new Date().toISOString() }));
if (rows.length) {
  const { error } = await sb.from("sportsyou_outbox").insert(rows);
  if (error) { console.error("Queue failed: " + error.message); process.exit(1); }
}
console.log(`\nQueued ${rows.length}` + (posts.length - rows.length ? `, skipped ${posts.length - rows.length} already pending` : "") + ". Run the SportsYou bookmarklet to post.");
