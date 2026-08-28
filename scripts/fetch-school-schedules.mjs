// Fetch the schedule links families sent, so a link becomes dates.
//
// Most of these are public and machine-readable once you ask properly:
//   Google Sheet → /export?format=csv    (rows become tab-separated lines)
//   Google Doc   → /export?format=txt
//   a school site → HTML, stripped to text
//   a PDF        → not read here. Every PDF we were sent is a duplicate of a
//                  schedule we already have as text, so a PDF parser would be a
//                  dependency earning nothing. Those are reported, not fetched.
//
// What comes back is stored in school_schedule_sources and parsed by the same
// code that reads what families paste. The family's own answer is never
// overwritten: theirs is theirs, and a re-fetch has to be repeatable.
//
// Usage:
//   node scripts/fetch-school-schedules.mjs           # fetch + report, no write
//   node scripts/fetch-school-schedules.mjs --write   # store what it found
//   node scripts/fetch-school-schedules.mjs --url X --school "Name"   # one extra link
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { parseSchedule, schoolKey } from "../shared/school-schedule.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

function loadEnv() {
  let raw = "";
  try { raw = readFileSync(new URL("../.env", import.meta.url), "utf8"); }
  catch { console.error("Missing .env next to package.json."); process.exit(1); }
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

// Google's share URLs don't serve the content; their export endpoints do.
export function fetchableUrl(url) {
  const sheet = /docs\.google\.com\/spreadsheets\/(?:u\/\d+\/)?d\/([\w-]+)/.exec(url);
  if (sheet) {
    const gid = /[?#&]gid=(\d+)/.exec(url);
    return { kind: "sheet", url: `https://docs.google.com/spreadsheets/d/${sheet[1]}/export?format=csv${gid ? "&gid=" + gid[1] : ""}` };
  }
  const doc = /docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([\w-]+)/.exec(url);
  if (doc) return { kind: "doc", url: `https://docs.google.com/document/d/${doc[1]}/export?format=txt` };
  if (/\.pdf(\?|$)/i.test(url)) return { kind: "pdf", url };
  return { kind: "html", url };
}

// A CSV row is a schedule row; tabs are what the parser already understands.
function csvToLines(csv) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (quoted) {
      if (c === '"' && csv[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  row.push(cell); rows.push(row);
  return rows
    // A cell holding its own line breaks ("BYE WEEK\n(Team Pictures…)") would
    // otherwise split one game across two rows.
    .map(r => r.map(c => c.replace(/\s*\n\s*/g, " ").trim()).join("\t").replace(/\t+$/, ""))
    .filter(l => l.replace(/\t/g, "").trim());
}

// A Google Doc table exports one CELL per line, each prefixed with a tab —
// date, day, opponent, site, time, time, date, day, … — so the date and the
// opponent it belongs to end up on different lines and nothing lines up. Walk
// the cells and start a new row at every date.
function docTableToLines(text) {
  const cells = text.split(/\r?\n/)
    .filter(l => l.startsWith("\t"))
    .map(l => l.slice(1).trim())
    .filter(Boolean);
  if (cells.length < 6) return null;
  const isDate = (c) => /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(c);
  const isWeekday = (c) => /^(mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)[a-z]*\.?$/i.test(c);
  const rows = [];
  let cur = null;
  for (const c of cells) {
    if (isDate(c)) { if (cur) rows.push(cur); cur = [c]; continue; }
    if (!cur) continue;            // header cells before the first date
    if (cur.length === 1 && isWeekday(c)) continue;  // the "Day" column
    cur.push(c);
  }
  if (cur) rows.push(cur);
  return rows.length ? rows.map(r => r.join("\t")).join("\n") : null;
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(tr|div|p|li|h[1-6]|table)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

const args = process.argv.slice(2);
const write = args.includes("--write");
const arg = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };

const env = loadEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Every distinct link a family sent, tied to the school they said it was for.
const { data: reports } = await supabase.from("school_team_reports").select("id,school,team_level,schedule");
const targets = new Map();
const addTarget = (school, url) => {
  const clean = String(url || "").replace(/[)\].,'"]+$/, "").trim();
  if (!/^https?:\/\//i.test(clean) || !school) return;
  if (!targets.has(clean)) targets.set(clean, { school, url: clean });
};
for (const r of reports || []) {
  const school = String(r.school || "").trim();
  for (const u of String(r.schedule || "").match(/https?:\/\/\S+/g) || []) addTarget(school, u);
}
if (arg("url")) addTarget(arg("school") || "", arg("url"));

console.log(`${targets.size} links to try\n`);

const results = [];
for (const t of targets.values()) {
  const { kind, url: fetchUrl } = fetchableUrl(t.url);
  if (kind === "pdf") {
    results.push({ ...t, kind, fetchUrl, status: "pdf", games: 0, text: null, http: null,
      note: "PDF — not read here" });
    console.log(`PDF   ${t.school} — skipped (${t.url.slice(0, 60)}…)`);
    continue;
  }
  let http = null, text = null, status = "empty", note = null;
  try {
    const res = await fetch(fetchUrl, { headers: { "User-Agent": UA, Accept: "*/*" }, redirect: "follow" });
    http = res.status;
    const body = await res.text();
    if (!res.ok) { status = "error"; note = "HTTP " + res.status; }
    else if (kind === "sheet") text = csvToLines(body).join("\n");
    else if (kind === "doc") {
      const clean = body.replace(/\r/g, "");
      text = docTableToLines(clean) || clean;
    }
    else text = htmlToText(body);
  } catch (e) {
    status = "error"; note = String(e?.message || e).slice(0, 120);
  }

  let games = [];
  if (text) {
    games = parseSchedule(text, { level: null }).games.filter(g => g.is_game);
    // A date scraped off a web page with no opponent attached is as likely to be
    // a copyright line as a fixture. Sheets and docs are tables we asked for by
    // name and get the benefit of the doubt; scraped HTML has to name an
    // opponent to count.
    if (kind === "html") games = games.filter(g => g.opponent);
    // A school calendar grid is mostly numbered squares. On a page we fetched
    // ourselves, a row with neither an opponent nor a time is a square, not a
    // fixture — unlike a family typing a bare list of dates, which is an answer.
    games = games.filter(g => g.opponent || (g.times || []).length);
    status = games.length ? "ok" : "no-dates";
  }
  results.push({ ...t, kind, fetchUrl, http, text, status, games: games.length, note });
  console.log(`${status.padEnd(9)} ${String(games.length).padStart(3)} games  ${t.school.padEnd(32)} ${kind}`);
  if (games.length) {
    games.slice(0, 3).forEach(g => console.log(`              ${g.game_date}  ${(g.opponent || "?").slice(0, 40)}  ${(g.times || []).join("/")}`));
    if (games.length > 3) console.log(`              … ${games.length - 3} more`);
  }
}

const ok = results.filter(r => r.status === "ok");
console.log(`\n${ok.length} of ${results.length} links produced dates` +
  ` — ${[...new Set(ok.map(r => r.school))].length} schools`);
const stuck = results.filter(r => r.status !== "ok");
if (stuck.length) {
  console.log("\nStill need a human:");
  stuck.forEach(r => console.log(`   ${r.status.padEnd(9)} ${r.school.padEnd(32)} ${r.note || ""}`));
}

if (!write) { console.log("\nDRY RUN — nothing stored. Re-run with --write."); process.exit(0); }

for (const r of results) {
  const { error } = await supabase.from("school_schedule_sources").upsert({
    school_key: schoolKey(r.school), school_name: r.school,
    url: r.url, fetch_url: r.fetchUrl, kind: r.kind,
    status: r.status, http_status: r.http,
    text: r.text ? r.text.slice(0, 100000) : null,
    games_found: r.games, note: r.note, fetched_at: new Date().toISOString(),
  }, { onConflict: "url" });
  if (error) console.error("store failed for " + r.url + ": " + error.message);
}
console.log(`\nStored ${results.length} sources. Now run: node scripts/parse-school-schedules.mjs --write`);
