// READ-ONLY schedule reader. SELECT queries only — never writes, updates, or
// deletes. Pulls the practice grid + coach roster so we can compute efficient,
// gap-free coach moves. Honors the project rule: no writes against prod.
//
// Setup (one time): create a gitignored .env next to package.json with:
//   SUPABASE_URL=https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=eyJ...           # service role; bypasses RLS for read
//
// Run:  node scripts/read-schedule.mjs [phase]   # phase defaults to "season"

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// ── tiny .env parser (avoids a dotenv dependency) ──────────────────────────
function loadEnv() {
  let raw = "";
  try { raw = readFileSync(new URL("../.env", import.meta.url), "utf8"); }
  catch { console.error("Missing .env file next to package.json."); process.exit(1); }
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv();
const URL_ = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env"); process.exit(1); }

const phase = process.argv[2] || "season";
const sb = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu"];
const dayIdx = (d) => DAYS.indexOf(d);
const slotRange = (label) => {
  const m = /^(\d+)-(\d+)pm$/.exec(label || "");
  if (!m) return null;
  const to24 = (h) => (h === 12 ? 12 : h + 12);
  return [to24(+m[1]), to24(+m[2])];
};
const fmtHr = (h) => (h === 12 ? "12pm" : h > 12 ? (h - 12) + "pm" : h + "am");

const { data: teams, error: tErr } = await sb
  .from("practice_teams")
  .select("team_name, age_div, level, head_coach, assistant_coach, practices_per_week, locked");
if (tErr) { console.error("practice_teams read failed:", tErr.message); process.exit(1); }

const { data: assigns, error: aErr } = await sb
  .from("practice_assignments")
  .select("team_name, day, slot, phase");
if (aErr) { console.error("practice_assignments read failed:", aErr.message); process.exit(1); }

const seasonAssigns = assigns.filter((a) => (a.phase || "fall1") === phase);
const teamByName = new Map(teams.map((t) => [t.team_name, t]));

// ── 1. Per-team grid ───────────────────────────────────────────────────────
console.log(`\n=== ${phase.toUpperCase()} — schedule by team ===`);
const byTeam = new Map();
for (const a of seasonAssigns) {
  if (!byTeam.has(a.team_name)) byTeam.set(a.team_name, []);
  byTeam.get(a.team_name).push(a);
}
for (const t of [...teams].sort((a, b) => a.team_name.localeCompare(b.team_name))) {
  const list = (byTeam.get(t.team_name) || [])
    .sort((a, b) => dayIdx(a.day) - dayIdx(b.day) || (slotRange(a.slot)?.[0] ?? 0) - (slotRange(b.slot)?.[0] ?? 0))
    .map((a) => `${a.day} ${a.slot}`)
    .join(", ");
  console.log(
    `${t.team_name.padEnd(13)} ${("[" + (t.age_div || "?") + "]").padEnd(7)} ` +
    `H:${(t.head_coach || "—").padEnd(20)} A:${(t.assistant_coach || "—").padEnd(20)} ` +
    `${list || "(none)"}`
  );
}

// ── 2. Per-coach schedule + efficiency flags ────────────────────────────────
console.log(`\n=== ${phase.toUpperCase()} — schedule by coach (gaps / splits) ===`);
const coachSessions = new Map();
for (const a of seasonAssigns) {
  const t = teamByName.get(a.team_name);
  if (!t) continue;
  for (const c of [t.head_coach, t.assistant_coach]) {
    if (!c) continue;
    if (!coachSessions.has(c)) coachSessions.set(c, []);
    coachSessions.get(c).push(a);
  }
}
for (const coach of [...coachSessions.keys()].sort()) {
  const sessions = coachSessions.get(coach);
  const teamsSet = new Set(sessions.map((s) => s.team_name));
  const flags = [];
  // same-day gaps (merge consecutive cells first)
  for (const day of DAYS) {
    const items = sessions.filter((s) => s.day === day).map((s) => slotRange(s.slot)).filter(Boolean).sort((a, b) => a[0] - b[0]);
    if (items.length < 2) continue;
    const merged = [];
    for (const it of items) {
      const last = merged[merged.length - 1];
      if (last && it[0] <= last[1]) last[1] = Math.max(last[1], it[1]);
      else merged.push([...it]);
    }
    for (let i = 1; i < merged.length; i++)
      flags.push(`GAP ${day} idle ${fmtHr(merged[i - 1][1])}-${fmtHr(merged[i][0])}`);
  }
  // weekday split
  const wd = sessions.filter((s) => ["Mon", "Tue", "Wed", "Thu"].includes(s.day));
  const wdDays = new Set(wd.map((s) => s.day));
  if (teamsSet.size >= 2 && wd.length <= 2 && wdDays.size >= 2) flags.push(`SPLIT weekdays ${[...wdDays].join("+")}`);

  const sched = sessions
    .sort((a, b) => dayIdx(a.day) - dayIdx(b.day) || (slotRange(a.slot)?.[0] ?? 0) - (slotRange(b.slot)?.[0] ?? 0))
    .map((s) => `${s.day} ${s.slot} (${s.team_name})`)
    .join(", ");
  const tag = teamsSet.size >= 2 ? `[${teamsSet.size} teams]` : "[1 team]";
  console.log(`${coach.padEnd(22)} ${tag.padEnd(10)} ${sched}`);
  if (flags.length) console.log(`${" ".repeat(22)} >>> ${flags.join(" | ")}`);
}
console.log("");
