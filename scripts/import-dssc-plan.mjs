// Drew's 2027 planning workbook → dssc_plan_bookings, for the DSSC Planning
// Calendar (Drew, Oct 12 2026: "a visual representation of my detailed planning
// work book for 2027 … so Hunter can figure out what to plan, how many courts
// are available and what is on all of the courts").
//
//   node scripts/import-dssc-plan.mjs "<Warehouse I, and II.xlsx>" [--write]
//
// Without --write it only prints what it found. With --write it replaces the
// plan's workbook rows (source = 'workbook'); bookings added in the app
// (source = 'app') are kept.
//
// The sheet ("2027 Detailed Yearly Schedule") is a grid: a row of date cells,
// a row of court names under each date (C1..C6, Flex), then half-hour rows from
// 7:00. A session's length is its merged cell when Drew merged it (a merge
// across courts takes all of them), else consecutive rental cells, else the
// program's usual length (the same table as dssc-schedule-planner), cut short
// where the next label on that court starts. The workbook is built on the 2026
// calendar, so dates move forward 52 weeks (weekdays stay put).
import fs from "node:fs";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
const XLSX = createRequire(import.meta.url)("xlsx");

const [file, flag] = process.argv.slice(2);
if (!file) { console.error('usage: node scripts/import-dssc-plan.mjs "<xlsx>" [--write]'); process.exit(1); }
const PLAN = "2027", SHEET = "2027 Detailed Yearly Schedule", SHIFT_DAYS = 364;

const wb = XLSX.readFile(file);
const ws = wb.Sheets[SHEET];
if (!ws) { console.error("No sheet named " + SHEET); process.exit(1); }
const range = XLSX.utils.decode_range(ws["!ref"]);
const cell = (R, C) => { const c = ws[XLSX.utils.encode_cell({ r: R, c: C })]; return c ? c.v : undefined; };
const isSerial = (v) => typeof v === "number" && v > 45000 && v < 48000;
const iso = (serial) => new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const COURT = (s) => { const t = String(s || "").trim().toUpperCase(); return /^C[1-6]$/.test(t) ? t : t === "FLEX" ? "FLEX" : null; };

// Merges: top-left cell → its extent.
const mergeAt = new Map();
for (const m of ws["!merges"] || []) mergeAt.set(m.s.r + ":" + m.s.c, m);
const covered = new Set();
for (const m of ws["!merges"] || []) for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) if (r !== m.s.r || c !== m.s.c) covered.add(r + ":" + c);

// Program lengths in half hours, and which ones are blocks (fill every cell).
const SESSION = { "Basketball Clinic": 2, "Basketball Training": 3, "Basketball Academy": 4, "Basketball Lab": 2, "Basketball Adult Open Run": 4, "Basketball Summer League": 4,
  "Volleyball Clinic": 2, "Volleyball Training": 3, "Volleyball Academy": 4, "Volleyball Camp": 6, "Volleyball Pick Up": 4, "Volleyball Summer League": 4, "Womens Volleyball League": 4,
  "Summer Camp": 6, "Adult Pick Up": 6, "Open Gym": 6, "Home School Physical Education": 3, "Futsal Academy": 2, "Futsal": 2, "POD": 2, "Volleyball Pod": 2, "ACES": 2, "Austin Sports and Social": 6 };
const BLOCK = new Set(["Rental", "Day Rent", "DSEV", "TCG", "Veritas", "Privates", "TWE", "Booked", "HOLIDAY"]);
const ALIAS = { "Volleyball Trianing": "Volleyball Training", "Volleyball Summer Leauge": "Volleyball Summer League", RENTAL: "Rental", "Volleyball Pickup": "Volleyball Pick Up" };
const program = (raw) => {
  const s = String(raw).replace(/\s+/g, " ").trim();
  if (ALIAS[s]) return ALIAS[s];
  if (SESSION[s] || BLOCK.has(s)) return s;
  if (/^POD\b/i.test(s)) return "POD";
  if (/^Austin Sports and Social/i.test(s)) return "Austin Sports and Social";
  if (/^DSEV\b/i.test(s)) return "DSEV";
  if (/^TCG\b/i.test(s)) return "TCG";
  if (/rental/i.test(s)) return "Rental";
  return s;          // anything else keeps its own name
};
// Labels the table doesn't know (DS Storm, Heatwave Academy…) are filled cell by cell
// in the sheet, so they run like rentals: as long as the label repeats.
const isBlock = (p) => BLOCK.has(p) || !SESSION[p];
const defaultSlots = (p) => SESSION[p] || 2;

// ---- headers: a row of date cells with the court names on the row below ----
// A date cell is a date serial, or text like "2/8/2026 - Super Bowl Sunday".
const textDate = (v) => { const m = typeof v === "string" && /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v); return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null; };
const dateCells = (R) => { const out = []; for (let C = 1; C <= range.e.c; C++) { const v = cell(R, C); if (isSerial(v)) out.push({ C, date: iso(v) }); else if (textDate(v)) out.push({ C, date: textDate(v) }); } return out; };
const isHeader = (R) => { if (!dateCells(R).length) return false; for (let C = 1; C <= range.e.c; C++) if (COURT(cell(R + 1, C)) === "C1") return true; return false; };

const raw = [];   // { date, court, slot, label, R, C }
const colsOf = [];
for (let R = range.s.r; R <= range.e.r; R++) {
  if (!isHeader(R)) continue;
  const heads = dateCells(R);
  const cols = [];
  let date = null, lastHeadC = -1;
  for (let C = 1; C <= range.e.c; C++) {
    const court = COURT(cell(R + 1, C)); if (!court) continue;
    if (court === "C1") { const h = heads.filter(x => x.C <= C && x.C > lastHeadC).pop(); if (h) { date = h.date; lastHeadC = h.C; } else if (date) date = addDays(date, 1); else continue; }
    if (date) cols.push({ C, court, date });
  }
  colsOf.push({ R, cols });
  for (let RR = R + 2; RR <= range.e.r; RR++) {
    if (isHeader(RR)) break;
    const t = cell(RR, 0); if (typeof t !== "number" || t >= 1) continue;
    const slot = Math.round(t * 48);
    for (const c of cols) {
      if (covered.has(RR + ":" + c.C)) continue;
      const v = cell(RR, c.C); if (v === undefined || v === "" || isSerial(v)) continue;
      if (/^\d+(\.\d+)?$/.test(String(v).trim())) continue;
      raw.push({ date: c.date, court: c.court, slot, label: String(v).replace(/\s+/g, " ").trim(), R: RR, C: c.C, cols });
    }
  }
}

// ---- cells → bookings ----
const slotRows = (R0) => { // row index → slot for the rows under a header block
  const m = new Map(); for (let RR = R0; RR <= range.e.r && RR < R0 + 40; RR++) { const t = cell(RR, 0); if (typeof t === "number" && t < 1) m.set(RR, Math.round(t * 48)); } return m; };
const taken = new Set(); // date|court|slot
const key = (d, c, s) => d + "|" + c + "|" + s;
const occupied = new Set(raw.map(x => key(x.date, x.court, x.slot)));
const bookings = [];
const stats = { merged: 0, block: 0, session: 0, overlap: 0, outside: 0 };
for (const x of raw.sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot)) {
  if (taken.has(key(x.date, x.court, x.slot))) { stats.overlap++; continue; }
  const p = program(x.label);
  let slots, courts = [x.court];
  const m = mergeAt.get(x.R + ":" + x.C);
  if (m && (m.e.r > m.s.r || m.e.c > m.s.c)) {
    const rows = slotRows(x.R);
    const endSlot = rows.get(m.e.r); slots = endSlot != null ? endSlot - x.slot + 1 : m.e.r - m.s.r + 1;
    courts = x.cols.filter(c => c.date === x.date && c.C >= m.s.c && c.C <= m.e.c).map(c => c.court);
    if (!courts.length) courts = [x.court];
    stats.merged++;
  } else if (isBlock(p)) {
    slots = 1; while (raw.find(y => y.date === x.date && y.court === x.court && y.slot === x.slot + slots && program(y.label) === p) && !taken.has(key(x.date, x.court, x.slot + slots))) { taken.add(key(x.date, x.court, x.slot + slots)); slots++; }
    stats.block++;
  } else {
    slots = defaultSlots(p);
    for (let i = 1; i < slots; i++) if (occupied.has(key(x.date, x.court, x.slot + i))) { slots = i; break; }
    stats.session++;
  }
  slots = Math.max(1, Math.min(slots, 44 - x.slot));      // never past 10pm
  for (const c of courts) for (let i = 0; i < slots; i++) taken.add(key(x.date, c, x.slot + i));
  const date = addDays(x.date, SHIFT_DAYS);
  if (!date.startsWith(PLAN)) { stats.outside++; continue; }
  // One row per court so the calendar can draw and count each court.
  for (const c of courts) bookings.push({ plan: PLAN, date, court: c, start_slot: x.slot, slots, program: p, label: x.label === p ? null : x.label, source: "workbook" });
}

const byProg = {}; for (const b of bookings) byProg[b.program] = (byProg[b.program] || 0) + b.slots / 2;
const courtsSeen = {}; for (const b of bookings) courtsSeen[b.court] = (courtsSeen[b.court] || 0) + 1;
const dates = bookings.map(b => b.date).sort();
console.log(`${raw.length} labelled cells → ${bookings.length} court-bookings ${dates[0]} … ${dates[dates.length - 1]}`, stats);
console.log("courts:", courtsSeen);
console.log("court-hours by program:"); for (const [k, v] of Object.entries(byProg).sort((a, b) => b[1] - a[1])) console.log("  ", String(v).padStart(7), k);

if (process.env.SHOW) { const hh = (s) => Math.floor(s / 2) + ":" + (s % 2 ? "30" : "00"); for (const d of process.env.SHOW.split(",")) { console.log("--", d); for (const b of bookings.filter(b => b.date === d).sort((a, b) => a.court.localeCompare(b.court) || a.start_slot - b.start_slot)) console.log("  ", b.court, hh(b.start_slot) + "-" + hh(b.start_slot + b.slots), b.program, b.label || ""); } }
if (flag === "--write") {
  for (const l of fs.readFileSync(".env", "utf8").split(/\r?\n/)) { const m = /^([A-Z_]+)=(.*)$/.exec(l); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
  const sb = createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { error: de } = await sb.from("dssc_plan_bookings").delete().eq("plan", PLAN).eq("source", "workbook");
  if (de) throw de;
  for (let i = 0; i < bookings.length; i += 500) { const { error } = await sb.from("dssc_plan_bookings").insert(bookings.slice(i, i + 500)); if (error) throw error; }
  console.log("wrote", bookings.length, "rows to dssc_plan_bookings (plan " + PLAN + ")");
}
