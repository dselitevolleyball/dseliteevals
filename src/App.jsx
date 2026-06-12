import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "./supabase";
import Papa from "papaparse";
import { DndContext, useDraggable, useDroppable, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";

const POSITIONS = ["S","OH","MB","RS","L","DS","U"];
const POS_LABELS = {S:"Setter",OH:"Outside Hitter",MB:"Middle Blocker",RS:"Right Side",L:"Libero",DS:"Def Specialist",U:"Utility"};
const SKILLS = ["Serving","Passing","Serve Receive","Attacking","Setting","Blocking","Agility","Communication","Coachability"];
// Skills that contribute to the displayed Total and Average. Blocking is
// tracked (still scoreable, still shown as a column) but intentionally not
// included in stats — it gets evaluated separately by position coaches.
const STATS_SKILLS = SKILLS.filter(s => s !== "Blocking");
// Short labels for the Evaluate-table column headers (full name shown on hover).
// Lets us fit all 9 skill columns on a single screen without horizontal scrolling.
const SKILL_ABBR = {Serving:"SRV",Passing:"PASS","Serve Receive":"S/R",Attacking:"ATK",Setting:"SET",Blocking:"BLK",Agility:"AGI",Communication:"COM",Coachability:"COACH"};
const PROJ_OPTS = ["","1","1/2","2","2/3","3"];
const ROSTER_POS = ["S1","S2","Pin1","Pin2","Pin3","Pin4","M1","M2","M3","L","DS1","DS2","U1","U2"];
const ROSTER_GROUPS = [{label:"Setters",pos:["S1","S2"]},{label:"Pins",pos:["Pin1","Pin2","Pin3","Pin4"]},{label:"Middles",pos:["M1","M2","M3"]},{label:"Libero/DS",pos:["L","DS1","DS2"]},{label:"Utility",pos:["U1","U2"]}];
const DIVS = ["U10","U11","U12","U13","U14","U15","U16","U17"];
const CLINIC_DIVS = ["U13","U14","U15","U16","U17"];
// Specific National Team ID Clinic dates a player attended (multi-select).
// Mirrors the EVAL_DATES pattern — short M/D strings. Edit here when the
// club adds more clinic dates.
const CLINIC_DATES = ["6/2"];
const TM = {U10:["11-1","11-2","11-3"],U11:["11-1","11-2","11-3"],U12:["12-1","12-2","12-3"],U13:["13-1","13-2","13-3","13-4"],U14:["14-1","14-2","14-3","14-4","14-5"],U15:["15-1","15-2","15-3"],U16:["16 Diamond","16-1","16-2"],U17:["17-1"]};
// 2026-27 season club plan: how many teams at each competitive tier per age group.
// Sent to the AI summary so parents see the broader landscape their daughter is
// being evaluated against. Edit here when the plan changes.
const TEAM_PLAN_2026 = {
  U10: { national: 0, regional: 0, rise: 0 },
  U11: { national: 0, regional: 1, rise: 1 },
  U12: { national: 1, regional: 1, rise: 2 },
  U13: { national: 1, regional: 2, rise: 1 },
  U14: { national: 2, regional: 2, rise: 0 },
  U15: { national: 2, regional: 2, rise: 0 },
  U16: { national: 1, regional: 1, rise: 0 },
};
const EVAL_DATES = ["5/13","5/14","5/20","5/21","5/27","5/28","6/3","6/4","6/9","6/10"];
const STATUS_OPTS = ["In Progress","Offered","Accepted","Declined","No Offer"];
const STATUS_COLORS = {"In Progress":"#999999","Offered":"#e91e8c","Accepted":"#22c55e","Declined":"#ef4444","No Offer":"#666666"};
const C = {bg:"#0a0a0a",card:"#141414",border:"#2a2a2a",gold:"#e91e8c",text:"#ffffff",mut:"#999999",acc:"#ff69b4",red:"#ef4444",grn:"#22c55e"};

// ─── Bulk tournament import (USAV format) ───────────────────────────────
// Parses the format used by USAV / TournamentCentral listings:
//   {NAME (one or two lines)}
//   {Three/Two/Four} Day Format Age: {LOW}-{HIGH} {Female|Male|Male / Female}
//   {Month Day, YYYY} - {Month Day, YYYY}
//   {City, ST} - {Venue}
//   {trailing status flags: Watch Now / Book Hotels / Registration X / etc}
// Robust to markdown link syntax (`[label](url)`) since paste from a webpage
// often includes that wrapper.
const TN_MONTH_MAP = { jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12", january:"01",february:"02",march:"03",april:"04",june:"06",july:"07",august:"08",september:"09",october:"10",november:"11",december:"12" };
const TN_FORMAT_RE = /^([A-Za-z]+)\s+Day\s+Format\s+Age:\s*(\d+)\s*-\s*(\d+)\s+(Male\s*\/\s*Female|Female\s*\/\s*Male|Male|Female)\s*$/i;
const TN_DATE_RANGE_RE = /^([A-Za-z]+\s+\d{1,2},\s*\d{4})\s*-\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})$/;
function parseMonthDateString(s) {
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec((s||"").trim());
  if (!m) return null;
  const mo = TN_MONTH_MAP[m[1].toLowerCase()];
  if (!mo) return null;
  return m[3] + "-" + mo + "-" + m[2].padStart(2,"0");
}
function parseUSAVTournaments(text) {
  const cleanLines = (text || "")
    // strip markdown link syntax: [label](url) -> label
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  const out = [];
  let i = 0;
  while (i < cleanLines.length) {
    // Find next format line anchoring a tournament entry.
    let fIdx = -1;
    for (let j = i; j < cleanLines.length; j++) {
      if (TN_FORMAT_RE.test(cleanLines[j])) { fIdx = j; break; }
    }
    if (fIdx === -1) break;
    // Name: lines between i and fIdx (usually one line, occasionally two).
    const rawName = cleanLines.slice(i, fIdx).join(" ").trim();
    const cancelled = /cancelled/i.test(rawName);
    const postponed = /postponed/i.test(rawName);
    const name = rawName.replace(/^CANCELLED\s*-\s*/i, "").replace(/^Postponed\s*-\s*/i, "").replace(/\s*-\s*CANCELLED.*$/i, "").trim() || "Untitled";
    const fm = TN_FORMAT_RE.exec(cleanLines[fIdx]);
    const format = (fm[1] || "Three") + " Day Format";
    const ageLow = parseInt(fm[2]);
    const ageHigh = parseInt(fm[3]);
    const gender = fm[4].replace(/\s+/g, " ").trim();
    // Date range on the next line.
    const dateLine = cleanLines[fIdx + 1] || "";
    const dm = TN_DATE_RANGE_RE.exec(dateLine);
    if (!dm) { i = fIdx + 1; continue; }
    const startDate = parseMonthDateString(dm[1]);
    const endDate = parseMonthDateString(dm[2]);
    if (!startDate || !endDate) { i = fIdx + 1; continue; }
    // Location line: "City, ST - Venue"
    const locLine = cleanLines[fIdx + 2] || "";
    let location = locLine, venue = "";
    const ds = locLine.match(/^(.*?)\s+-\s+(.+)$/);
    if (ds) { location = ds[1].trim(); venue = ds[2].trim(); }
    // Status: any trailing lines until the next format anchor.
    let j = fIdx + 3;
    const statusParts = [];
    while (j < cleanLines.length) {
      if (TN_FORMAT_RE.test(cleanLines[j])) break;
      // If the line after this one is a format line, this is the next
      // tournament's name — stop here.
      if (j + 1 < cleanLines.length && TN_FORMAT_RE.test(cleanLines[j + 1])) break;
      statusParts.push(cleanLines[j]);
      j++;
    }
    const statusText = statusParts.join(" ");
    let status = "";
    const sm = /Registration\s+(Closed|Open|Opens?\s+-\s+[A-Za-z]+\s+\d{1,2},\s*\d{4})/i.exec(statusText);
    if (sm) status = sm[0].trim();
    out.push({
      name, start_date: startDate, end_date: endDate,
      location, venue,
      age_low: ageLow, age_high: ageHigh, gender,
      format, status,
      cancelled: cancelled || postponed,
      source: "USAV",
      divisions: [],
    });
    i = j;
  }
  return out;
}

// ─── Bulk tournament import (JVC format) ────────────────────────────────
// Parses listings from JVC Tournaments (the NIKE / Boston / NERVA family).
// Structure:
//   MONTH YYYY                       <- section header that anchors the year
//
//   *Mon. DD-DD:  Tournament Name  (City, ST[-PENDING NOTE])
//   Girls 10-18s, 17 Open, ...       <- age + division info on next line(s)
//   *Optional commentary starting with *
//
// Names may carry leading and/or trailing asterisks (highlight markers) which
// we strip. Pending venue note becomes the status.
const JVC_MONTH_NUM = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12, january:1, february:2, march:3, april:4, june:6, july:7, august:8, september:9, october:10, november:11, december:12 };
const JVC_HEADER_RE = /^\*{0,4}\s*([A-Z][a-z]{2})\.\s+(\d{1,2})-(\d{1,2}):\s*(.+?)\s*\(([^)]+)\)\s*\*{0,4}\s*$/;
const JVC_MONTH_CTX_RE = /^([A-Z][A-Z]+)\s+(\d{4})\s*$/;
const JVC_DIV_NAMES = ["Open", "USA", "American", "Liberty", "National", "Club", "Patriot", "Freedom", "Premier", "Select"];
function parseJVCTournaments(text) {
  const lines = (text || "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  const out = [];
  let curYear = null;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    // Month section header → set the year context.
    const mc = JVC_MONTH_CTX_RE.exec(ln);
    if (mc) {
      const mn = JVC_MONTH_NUM[mc[1].toLowerCase()];
      if (mn) curYear = parseInt(mc[2]);
      continue;
    }
    // Tournament header
    const dh = JVC_HEADER_RE.exec(ln);
    if (!dh || !curYear) continue;
    const month = JVC_MONTH_NUM[dh[1].toLowerCase()];
    if (!month) continue;
    const startDay = parseInt(dh[2]);
    const endDay = parseInt(dh[3]);
    const name = dh[4].replace(/\*+/g, "").trim();
    const locFull = dh[5].trim();
    const startDate = curYear + "-" + String(month).padStart(2,"0") + "-" + String(startDay).padStart(2,"0");
    const endDate   = curYear + "-" + String(month).padStart(2,"0") + "-" + String(endDay).padStart(2,"0");
    // Location split: "City, ST" or "City, ST-NOTE"
    let location = locFull, pendingNote = "";
    const lm = /^(.+?),\s*([A-Z]{2})(?:\s*-\s*(.+))?$/.exec(locFull);
    if (lm) {
      location = lm[1].trim() + ", " + lm[2];
      if (lm[3]) pendingNote = lm[3].trim();
    }
    // Subsequent description lines (until next header or month ctx).
    const descLines = [];
    let j = i + 1;
    while (j < lines.length) {
      const nl = lines[j];
      if (JVC_HEADER_RE.test(nl)) break;
      if (JVC_MONTH_CTX_RE.test(nl)) break;
      descLines.push(nl);
      j++;
    }
    const descText = descLines.join(" ");
    // Ages: any 8-19 number in the description
    const ages = (descText.match(/\b\d{1,2}\b/g) || []).map(s => parseInt(s)).filter(n => n >= 8 && n <= 19);
    const ageLow  = ages.length ? Math.min(...ages) : null;
    const ageHigh = ages.length ? Math.max(...ages) : null;
    // Gender from Girls/Boys keywords
    const hasFem = /girls/i.test(descText);
    const hasMal = /boys/i.test(descText);
    const gender = hasMal && hasFem ? "Male / Female" : hasMal ? "Male" : "Female";
    // Divisions called out in the description
    const divisions = JVC_DIV_NAMES.filter(d => new RegExp("\\b" + d + "\\b", "i").test(descText));
    // Format words from day count
    const days = endDay - startDay + 1;
    const formatWords = {1:"One",2:"Two",3:"Three",4:"Four",5:"Five",6:"Six",7:"Seven"};
    const format = (formatWords[days] || days) + " Day Format";
    const status = pendingNote && /pending/i.test(pendingNote) ? "Pending Site Confirmation" : "";
    out.push({
      name,
      start_date: startDate,
      end_date: endDate,
      location,
      venue: "",
      age_low: ageLow,
      age_high: ageHigh,
      gender,
      format,
      status,
      cancelled: false,
      source: "JVC",
      divisions,
      notes: descLines.length ? descLines.join("\n") : null,
    });
    i = j - 1; // for-loop will increment to j next iteration
  }
  return out;
}

// ─── Bulk tournament import (SportWrench format) ────────────────────────
// SportWrench list pages render each tournament twice (an "Additional Info"
// block + a "Main Info" block) interspersed with navigation chrome. The
// reliable anchor is a {Name line} followed by a {City, ST Venue} line.
// We walk lines pair-by-pair, find that anchor, then look forward for a
// date line in any of these shapes:
//   "Month D–D, YYYY"           (single-month range)
//   "Month D, YYYY"             (single date)
//   "Month D – Month D, YYYY"   (cross-month range)
// and pull Gender + Sanctioning Body from their keyword-anchored sections.
// Dedup by (name + start_date) collapses the duplicate Additional/Main pair
// into one row.
const SW_LOC_RE = /^[A-Z][^,\n]+,\s*[A-Z]{2}(?:\s+\S|$)/;
const SW_DATE_RES = [
  /^([A-Z][a-z]+)\s+(\d{1,2})\s*[–-]\s*([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})$/,   // cross-month
  /^([A-Z][a-z]+)\s+(\d{1,2})\s*[–-]\s*(\d{1,2}),\s*(\d{4})$/,                    // same-month range
  /^([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})$/,                                       // single day
];
const SW_JUNK = new Set([
  "Schedule/Results", "Buy Tickets", "Register Teams", "Register Here",
  "Favorite", "Location", "Current", "Upcoming", "Past", "All", "Favorites",
  "Detailed View", "Filters", "Support", "Sign In",
  "Main Info", "Additional Info", "Ticket Info", "Event Info", "About Event",
  "Sales Open", "Prices", "Start Date", "Team Registration", "Deadlines",
  "Teams Fee", "Divisions", "Clubs", "Teams", "Genders", "Sanctioning Body",
  "Additional Info", "Main Info", "Not Available",
]);
function parseSportWrenchTournaments(text) {
  const lines = (text || "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  const out = [];
  const seen = new Set();
  let i = 0;
  while (i < lines.length - 1) {
    const line = lines[i];
    const next = lines[i + 1];
    // Skip obvious chrome / search-bar text.
    if (SW_JUNK.has(line) || line === "s" || line.startsWith("Search by")) { i++; continue; }
    // Require the next line to look like "City, ST Venue".
    if (!SW_LOC_RE.test(next)) { i++; continue; }
    const name = line;
    let location = next, venue = "";
    const lm = /^(.+?,\s*[A-Z]{2})\s+(.+)$/.exec(next);
    if (lm) { location = lm[1]; venue = lm[2]; }
    // Find a date line in the next ~40 lines.
    let startDate = null, endDate = null;
    let dateAt = -1;
    for (let j = i + 2; j < Math.min(i + 50, lines.length); j++) {
      const ln = lines[j];
      let m, mo, mo2;
      if ((m = SW_DATE_RES[0].exec(ln))) {
        mo = TN_MONTH_MAP[m[1].toLowerCase()];
        mo2 = TN_MONTH_MAP[m[3].toLowerCase()];
        if (mo && mo2) {
          startDate = m[5] + "-" + mo + "-" + m[2].padStart(2,"0");
          endDate   = m[5] + "-" + mo2 + "-" + m[4].padStart(2,"0");
          dateAt = j;
          break;
        }
      } else if ((m = SW_DATE_RES[1].exec(ln))) {
        mo = TN_MONTH_MAP[m[1].toLowerCase()];
        if (mo) {
          startDate = m[4] + "-" + mo + "-" + m[2].padStart(2,"0");
          endDate   = m[4] + "-" + mo + "-" + m[3].padStart(2,"0");
          dateAt = j;
          break;
        }
      } else if ((m = SW_DATE_RES[2].exec(ln))) {
        mo = TN_MONTH_MAP[m[1].toLowerCase()];
        if (mo) {
          startDate = m[3] + "-" + mo + "-" + m[2].padStart(2,"0");
          endDate   = startDate;
          dateAt = j;
          break;
        }
      }
    }
    if (!startDate) { i++; continue; }
    // Dedup against the previous "Additional Info" / "Main Info" pass for
    // the same tournament.
    const key = (name + "|" + startDate).toLowerCase();
    if (seen.has(key)) { i = dateAt + 1; continue; }
    seen.add(key);
    // End-of-entry boundary: next "Register Teams" line, or next anchor pair.
    let endIdx = dateAt + 1;
    while (endIdx < lines.length) {
      if (lines[endIdx] === "Register Teams") break;
      // Also break if we hit the next entry's anchor pair.
      if (endIdx + 1 < lines.length && !SW_JUNK.has(lines[endIdx]) && SW_LOC_RE.test(lines[endIdx + 1])) break;
      endIdx++;
    }
    const block = lines.slice(i, endIdx);
    const blockText = block.join("\n");
    // Gender (from the "Genders" header followed by Male/Female/Co-ed lines).
    let gender = "Female";
    const gIdx = block.indexOf("Genders");
    if (gIdx >= 0) {
      const tags = [];
      for (let k = gIdx + 1; k < Math.min(gIdx + 5, block.length); k++) {
        if (/^(Male|Female|Co-?ed)$/i.test(block[k])) tags.push(block[k]);
        else break;
      }
      const hasMale = tags.some(t => /^Male$/i.test(t));
      const hasFem  = tags.some(t => /^Female$/i.test(t));
      gender = hasMale && hasFem ? "Male / Female" : hasMale ? "Male" : "Female";
    }
    // Sanctioning body becomes part of the source so we can filter by it
    // (USAV / AAU / JVA / Other).
    let sanction = "";
    const sIdx = block.indexOf("Sanctioning Body");
    if (sIdx >= 0 && sIdx + 1 < block.length) sanction = block[sIdx + 1];
    // Age range: scan for "NN-NN" or "NNU" patterns in 8-19 across the block.
    let ageLow = null, ageHigh = null;
    const ranges = blockText.match(/(\d{1,2})\s*U?\s*[-–]\s*(\d{1,2})\s*U/g) || [];
    for (const r of ranges) {
      const rm = /(\d{1,2})\s*U?\s*[-–]\s*(\d{1,2})/.exec(r);
      if (!rm) continue;
      const lo = parseInt(rm[1]), hi = parseInt(rm[2]);
      if (lo >= 8 && lo <= 19 && hi >= 8 && hi <= 19) {
        if (ageLow == null || lo < ageLow) ageLow = lo;
        if (ageHigh == null || hi > ageHigh) ageHigh = hi;
      }
    }
    const single = blockText.match(/\b(\d{1,2})U\b/g) || [];
    for (const s of single) {
      const n = parseInt(s);
      if (n >= 8 && n <= 19) {
        if (ageLow == null || n < ageLow) ageLow = n;
        if (ageHigh == null || n > ageHigh) ageHigh = n;
      }
    }
    // Day count -> "X Day Format"
    const dStart = new Date(startDate + "T00:00").getTime();
    const dEnd   = new Date(endDate   + "T00:00").getTime();
    const days   = Math.round((dEnd - dStart) / 86400000) + 1;
    const words  = { 1:"One",2:"Two",3:"Three",4:"Four",5:"Five",6:"Six",7:"Seven" };
    const format = days > 7 ? days + " Day Format" : (words[days] || days) + " Day Format";
    out.push({
      name,
      start_date: startDate,
      end_date: endDate,
      location,
      venue,
      age_low: ageLow,
      age_high: ageHigh,
      gender,
      format,
      status: "",
      cancelled: false,
      source: sanction ? "SportWrench:" + sanction : "SportWrench",
      divisions: [],
      notes: null,
    });
    i = endIdx + 1;
  }
  return out;
}

function calcUSAV(dob) {
  if (!dob) return 12;
  const parts = dob.split("-");
  const y = parseInt(parts[0]); const m = parseInt(parts[1]);
  return 2026 - (m >= 7 ? y : y - 1);
}
// Total = sum of stat-skill scores only (Blocking is excluded).
function tot(p) {
  const s = p.scores || {};
  return STATS_SKILLS.reduce((sum, sk) => sum + (s[sk] || 0), 0);
}

// Payload sent to /api/summarize-player. Shared by initial generation and
// the refine flow so both requests describe the player identically.
function buildPlayerPayload(p, players) {
  const div = p.usavDiv || p.usav_div;
  const divPeers = players.filter(o => (o.usavDiv || o.usav_div) === div && tot(o) > 0);
  const playerTotal = tot(p);
  let division_band = null;
  if (playerTotal > 0 && divPeers.length >= 5) {
    const betterCount = divPeers.filter(o => tot(o) > playerTotal).length;
    const rank = betterCount + 1;
    const pct = rank / divPeers.length; // 1/N = best, 1.0 = worst
    if (pct <= 0.10)      division_band = "top10";
    else if (pct <= 0.25) division_band = "top25";
    else if (pct >= 0.90) division_band = "bottom10";
    else if (pct >= 0.75) division_band = "bottom25";
    else                  division_band = "middle";
  }
  return {
    first_name: p.first_name, last_name: p.last_name, age: p.age,
    usav_div: div,
    positions: p.positions, scores: p.scores,
    notes: p.notes, parent_feedback_notes: p.parent_feedback_notes,
    eval_dates: p.eval_dates,
    projected_team: p.projected_team, team_assignment: p.team_assignment,
    status: p.status,
    strength_weakness: p.strength_weakness, goal: p.goal,
    division_band,
    division_total_scored: divPeers.length,
    team_plan: TEAM_PLAN_2026[div] || null,
  };
}
// Average = mean of scored stat-skills (Blocking is excluded). A skill with
// no score is skipped from the denominator so a partially-evaluated player
// still gets a meaningful average.
function avg(p) {
  const s = p.scores || {};
  const vals = STATS_SKILLS.map(sk => s[sk]).filter(v => v && v > 0);
  if (!vals.length) return "—";
  return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
}
// A player counts as a returning DS Elite athlete if her Prev Season Team field
// names DSE / DS Elite. Coaches can correct false positives/negatives by editing
// the "Prev Season Team" value in the profile modal.
function isReturningDSE(p) {
  const t = (p.current_team || "").toUpperCase();
  return t.includes("DSE") || t.includes("DS ELITE");
}
// Highlights players added to the DB in the last 3 days — surfaces fresh CSV uploads.
const NEW_PLAYER_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
function isNewPlayer(p) {
  if (!p.created_at) return false;
  const t = new Date(p.created_at).getTime();
  return Number.isFinite(t) && (Date.now() - t) < NEW_PLAYER_WINDOW_MS;
}

const inpStyle = {background:"#1a1a1a",border:"1px solid "+C.border,borderRadius:6,color:C.text,fontFamily:"inherit",outline:"none"};

function Tag({c,children}) { return <span style={{display:"inline-block",padding:"2px 7px",borderRadius:10,fontSize:10,fontWeight:600,background:c+"22",color:c}}>{children}</span>; }

// DnD wrappers — module-level so they aren't recreated on every App render (which would wipe input state).
// PointerSensor distance + TouchSensor delay let taps still register as clicks (open profile, focus rank input).
function DraggablePlayer({ player, children, style }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: "player-" + player.id });
  return <div ref={setNodeRef} {...listeners} {...attributes}
    style={{ ...(style||{}), opacity: isDragging ? 0.3 : 1, touchAction: "manipulation" }}>{children}</div>;
}
function DropZone({ id, children, style }) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return <div ref={setNodeRef}
    style={{ ...style, outline: isOver ? "2px solid " + C.gold : "2px solid transparent", outlineOffset: -2, transition: "outline-color 0.1s" }}>{children}</div>;
}
// Debounced text input/textarea. Holds keystrokes locally and only fires
// onCommit once the user has paused typing for `delay` ms (or blurs the
// field, or the component unmounts). Keeps the Supabase players row — and
// the change_log audit trail — from getting one write per character.
function DebouncedField({ value, onCommit, delay = 800, multiline = false, ...rest }) {
  const [local, setLocal]   = useState(value ?? "");
  const localRef            = useRef(local);
  const lastSyncedRef       = useRef(value ?? "");
  const timeoutRef          = useRef(null);
  const onCommitRef         = useRef(onCommit);
  useEffect(() => { localRef.current    = local;    }, [local]);
  useEffect(() => { onCommitRef.current = onCommit; }, [onCommit]);
  // Sync from props when the external value changes and we're NOT mid-edit
  // (no pending timeout). Without the timeout guard, a fast prop refresh
  // would clobber what the user just typed.
  useEffect(() => {
    const v = value ?? "";
    if (v !== lastSyncedRef.current && !timeoutRef.current) {
      setLocal(v);
      lastSyncedRef.current = v;
    }
  }, [value]);
  const flush = () => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    const v = localRef.current;
    if (v !== lastSyncedRef.current) {
      lastSyncedRef.current = v;
      onCommitRef.current(v);
    }
  };
  const handleChange = (e) => {
    const v = e.target.value;
    setLocal(v);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      const cur = localRef.current;
      if (cur !== lastSyncedRef.current) {
        lastSyncedRef.current = cur;
        onCommitRef.current(cur);
      }
    }, delay);
  };
  // Flush on unmount so closing a modal mid-edit still persists.
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const Tag = multiline ? "textarea" : "input";
  return <Tag {...rest} value={local} onChange={handleChange} onBlur={flush} />;
}

function RankInput({ value, max, onCommit }) {
  const [v, setV] = useState(value == null ? "" : String(value));
  useEffect(() => { setV(value == null ? "" : String(value)); }, [value]);
  const commit = () => {
    const n = parseInt(v);
    if (!isNaN(n) && n >= 1 && n !== value) onCommit(n);
    else setV(value == null ? "" : String(value));
  };
  return <input type="number" inputMode="numeric" min={1} max={max} value={v}
    onChange={e => setV(e.target.value)}
    onBlur={commit}
    onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
    onPointerDown={e => e.stopPropagation()}
    onClick={e => e.stopPropagation()}
    title="Rank within position (1 = top). Persists across team assignment changes."
    style={{ ...inpStyle, width: 40, fontSize: 11, padding: "3px 4px", textAlign: "center", fontWeight: 700, color: C.gold }} />;
}

export default function App() {
  // ─── Auth state ─────────────────────────────────────────────────────
  // We use Supabase Auth (email + password). Each coach has their own login.
  // `session` is the raw Supabase session; `coach` is the matching row in
  // public.coaches (display_name, is_admin, is_approved). The app is gated
  // until `coach.is_approved` is true — the FIRST signup is auto-approved as
  // admin by the handle_new_user trigger, every other signup waits.
  const [authChecking, setAuthChecking] = useState(true);
  const [session, setSession]           = useState(null);
  const [coach, setCoach]               = useState(null);
  // Login/signup form state (only used pre-auth):
  const [loginMode, setLoginMode]               = useState("login"); // "login" | "signup"
  const [loginEmail, setLoginEmail]             = useState("");
  const [loginPassword, setLoginPassword]       = useState("");
  const [loginDisplayName, setLoginDisplayName] = useState("");
  const [loginBusy, setLoginBusy]               = useState(false);
  const [loginError, setLoginError]             = useState("");
  const [loginInfo, setLoginInfo]               = useState("");
  // Set when supabase-js fires a PASSWORD_RECOVERY event (user clicked the
  // reset link in their email). Gates a "Set new password" screen ahead of
  // every other auth gate so it always wins.
  const [recoveryMode, setRecoveryMode]         = useState(false);
  const [newPassword, setNewPassword]           = useState("");
  const [newPasswordBusy, setNewPasswordBusy]   = useState(false);
  const [newPasswordError, setNewPasswordError] = useState("");
  // Activity tab state (audit log):
  const [activityLog, setActivityLog]         = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityActor, setActivityActor]     = useState("");
  const [activityAction, setActivityAction]   = useState("");
  // Coaches admin tab state:
  const [coachesList, setCoachesList]         = useState([]);
  const [coachesLoading, setCoachesLoading]   = useState(false);
  // Signup email allowlist (admin section of the Coaches tab):
  const [allowedEmails, setAllowedEmails]       = useState([]);
  const [allowedLoading, setAllowedLoading]     = useState(false);
  const [bulkAllowedInput, setBulkAllowedInput] = useState("");
  // Tournament planning tab state:
  const [tournaments, setTournaments]                       = useState([]);
  const [tournamentAssignments, setTournamentAssignments]   = useState([]);
  const [tournamentsLoading, setTournamentsLoading]         = useState(false);
  const [teamsList, setTeamsList]                           = useState([]);
  const [blackoutDates, setBlackoutDates]                   = useState([]);
  const [tnFilters, setTnFilters]                           = useState({ search: "", ageFor: "", qualifierOnly: false, dateFrom: "", dateTo: "", hideClosed: false, hideCancelled: true, startsOn: [], state: "", numDays: "", divisions: [] });
  const [tnView, setTnView]                                 = useState("list"); // "list" | "calendar"
  const [tnSelectedTeams, setTnSelectedTeams]               = useState(new Set()); // empty = all shown
  const [tnCalFrom, setTnCalFrom]                           = useState("2026-08-01");
  const [tnCalTo, setTnCalTo]                               = useState("2027-06-30");
  // Month being shown in the Month View calendar; YYYY-MM-01 string.
  // Default to today's month so it lands on something relevant on open.
  const [tnMonthCursor, setTnMonthCursor]                   = useState(() => {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-01";
  });
  const [addingTournament, setAddingTournament]             = useState(false);
  const [editingTournament, setEditingTournament]           = useState(null);
  const [newTournament, setNewTournament]                   = useState({ name: "", start_date: "", end_date: "", location: "", venue: "", age_low: "", age_high: "", gender: "Female", is_qualifier: false, source: "manual", status: "", notes: "", divisions: [] });
  const [bulkImportOpen, setBulkImportOpen]                 = useState(false);
  const [bulkImportText, setBulkImportText]                 = useState("");
  const [bulkImportSource, setBulkImportSource]             = useState("USAV");
  const [bulkImporting, setBulkImporting]                   = useState(false);

  // Bootstrap auth on mount; subscribe to changes so the UI re-renders on
  // login/logout/token-refresh.
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      setSession(session);
      setAuthChecking(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      // Fired when the user clicks the password-reset link in their email.
      // Flag it so the "Set new password" gate renders ahead of the main app.
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
      setSession(s);
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  // Whenever the session changes, look up (or refetch) the coach profile row.
  // Also stamp last_seen_at — useful in the Coaches admin screen.
  useEffect(() => {
    if (!session) { setCoach(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("coaches").select("*").eq("id", session.user.id).maybeSingle();
      if (cancelled) return;
      setCoach(data || null);
      if (data) {
        supabase.from("coaches").update({ last_seen_at: new Date().toISOString() }).eq("id", session.user.id);
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

  const isApproved = !!coach?.is_approved;
  const isAdmin    = !!coach?.is_admin;

  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("dashboard");
  // Selected age-group tabs. Multi-select: clicking a tab toggles membership.
  // Always at least one division is selected. Drives Evaluate filter, Teams sections, and Rankings.
  const [selectedDivs, setSelectedDivs] = useState(["U14"]);
  // Three independent highlight toggles for the Teams + Tracker views.
  // Off by default; coaches can flip any combination to spotlight that
  // bucket.
  //   - showTryoutOnly  : cyan ring around players on the tryout roster
  //                       only (tryout_registered=true, eval_registered=false)
  //   - showEvalOnly    : amber ring around players on the eval roster
  //                       only and NOT supplemental (eval_registered=true,
  //                       tryout_registered=false, supplemental!=1)
  //   - showEvalAsTryout: pink ring around supplemental players
  //                       (supplemental=1) — they're using their eval as
  //                       the tryout because they can't attend.
  const [showTryoutOnly, setShowTryoutOnly] = useState(false);
  const [showEvalOnly, setShowEvalOnly] = useState(false);
  const [showEvalAsTryout, setShowEvalAsTryout] = useState(false);
  // Three actionable buckets. eval_registered (the eval CSV roster) is
  // the source of truth for "did/will be evaluated" — coaches manage
  // this via the eval CSV upload + the toggle on the player card.
  //   pink   — supplemental (eval-as-tryout, locked in)
  //   cyan   — signed up for tryout, NOT on eval roster (needs evaluating)
  //   amber  — on eval roster, NOT signed up for tryout (needs to register)
  const playerHighlight = (p) => {
    if (!p) return null;
    if (p.supplemental === 1 && showEvalAsTryout) {
      return { color: C.acc, bg: "rgba(233,30,140,0.12)", label: "EVAL→TRYOUT" };
    }
    if (p.tryout_registered && !p.eval_registered && showTryoutOnly) {
      return { color: "#06b6d4", bg: "rgba(6,182,212,0.14)", label: "NEEDS EVAL" };
    }
    if (p.eval_registered && !p.tryout_registered && p.supplemental !== 1 && showEvalOnly) {
      return { color: "#f59e0b", bg: "rgba(245,158,11,0.14)", label: "NEEDS TRYOUT" };
    }
    return null;
  };
  const [search, setSearch] = useState("");
  const [filterPos, setFilterPos] = useState("");
  const [filterProj, setFilterProj] = useState("");
  const [filterEval, setFilterEval] = useState("all");
  const [filterDate, setFilterDate] = useState("");
  const [filterClinic, setFilterClinic] = useState("all");
  const [filterClinicDate, setFilterClinicDate] = useState(""); // "" = any; "6/2" = only players who attended that clinic date
  // "Registered since" date filter (YYYY-MM-DD) — drives the email-the-new-batch workflow.
  const [regSince, setRegSince] = useState("");
  const [copiedEmails, setCopiedEmails] = useState(false);
  const [sortBy, setSortBy] = useState("name");
  // Rankings view column sort: key matches a column id in renderRankings' COLS table.
  const [rankSort, setRankSort] = useState({ key: "total", dir: "desc" });
  // Rankings view date filter — independent from the Evaluate-tab date filter so
  // switching views doesn't carry the selection over.
  const [rankDate, setRankDate] = useState("");
  const [profileId, setProfileId] = useState(null);
  // AI parent-summary state for the profile modal. Reset whenever the profile changes.
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState("");
  const [aiError, setAiError] = useState("");
  const [aiCopied, setAiCopied] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiSavedAt, setAiSavedAt] = useState(null);
  // When the profile changes, hydrate the AI summary state from the player row
  // so a previously-generated summary shows up again instead of disappearing.
  useEffect(() => {
    setAiBusy(false); setAiError(""); setAiCopied(false); setAiInstruction("");
    const player = players.find(x => x.id === profileId);
    setAiResult(player?.parent_summary || "");
    setAiSavedAt(player?.parent_summary_updated_at || null);
    // Intentionally only re-run when the open profile changes — we don't want
    // a background players reload to wipe an in-progress edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [addingPlayer, setAddingPlayer] = useState(false);
  const [newPlayer, setNewPlayer] = useState({ first_name:"", last_name:"", dob:"", age:"", usav_div:"", positions:[], parent_name:"", parent_email:"", parent_phone:"" });
  const [addMsg, setAddMsg] = useState("");
  // DnD sensors at App level (hook order must be stable across renders, can't live in renderTeams).
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 200, tolerance: 5 } }),
  );
  // Manual position rankings, scoped by division+position. Synced across all coaches via Supabase.
  // Shape: { [division]: { [position]: [playerId, ...] } }
  // Semantics: the list is the ordered ranking of ALL players in (division, position),
  // regardless of team assignment. Persists across team changes.
  const [unassignedRanks, setUnassignedRanks] = useState({});

  const loadRankings = useCallback(async () => {
    const { data, error } = await supabase.from("unassigned_rankings").select("*");
    if (error) { console.error("Load rankings error:", error); return; }
    const ranks = {};
    (data || []).forEach(r => {
      if (!ranks[r.division]) ranks[r.division] = {};
      ranks[r.division][r.position] = r.player_ids || [];
    });
    setUnassignedRanks(ranks);
  }, []);

  // Persist a ranking change. Pass playerIds=null to reset (delete the row).
  const persistRanking = useCallback(async (division, position, playerIds) => {
    // Optimistic local update
    setUnassignedRanks(prev => {
      const next = { ...prev, [division]: { ...(prev[division] || {}) } };
      if (playerIds === null) delete next[division][position];
      else next[division][position] = playerIds;
      return next;
    });
    if (playerIds === null) {
      const { error } = await supabase.from("unassigned_rankings").delete().match({ division, position });
      if (error) console.error("Reset ranking error:", error);
    } else {
      const { error } = await supabase.from("unassigned_rankings").upsert(
        { division, position, player_ids: playerIds, updated_at: new Date().toISOString() },
        { onConflict: "division,position" }
      );
      if (error) console.error("Save ranking error:", error);
    }
  }, []);

  // Load all players from Supabase
  const loadPlayers = useCallback(async () => {
    const { data, error } = await supabase.from("players").select("*").order("last_name");
    if (error) { console.error(error); return; }
    setPlayers(data.map(p => ({
      ...p,
      scores: p.scores || {},
      positions: p.positions || [],
      eval_dates: p.eval_dates || [],
      usavDiv: p.usav_div || "U" + calcUSAV(p.dob),
    })));
    setLoading(false);
  }, []);

  useEffect(() => { if (isApproved) { loadPlayers(); loadRankings(); } }, [isApproved, loadPlayers, loadRankings]);

  // Coaches list loader (used by the admin Coaches tab). Lives up here, NOT
  // next to renderCoaches, so the hook call order stays stable across the
  // auth-gate early returns below.
  const loadCoaches = useCallback(async () => {
    setCoachesLoading(true);
    const { data, error } = await supabase.from("coaches").select("*").order("created_at", { ascending: true });
    if (error) console.error("Load coaches error:", error);
    setCoachesList(data || []);
    setCoachesLoading(false);
  }, []);
  // Load coaches as soon as we're approved (not only when the Coaches tab
  // is opened) so the admin "N coaches awaiting approval" banner has data
  // on every page.
  useEffect(() => { if (isApproved) loadCoaches(); }, [isApproved, loadCoaches]);

  // Allowed-signup-emails loader (lives next to loadCoaches so the Coaches
  // tab can render both lists in one fetch round).
  const loadAllowedEmails = useCallback(async () => {
    setAllowedLoading(true);
    const { data, error } = await supabase.from("allowed_signup_emails").select("*").order("added_at", { ascending: false });
    if (error) console.error("Load allowed emails error:", error);
    setAllowedEmails(data || []);
    setAllowedLoading(false);
  }, []);
  useEffect(() => { if (isApproved && view === "coaches") loadAllowedEmails(); }, [isApproved, view, loadAllowedEmails]);

  // Activity feed loader (used by the Activity tab). Same hook-order rule.
  const loadActivity = useCallback(async () => {
    setActivityLoading(true);
    let q = supabase.from("change_log").select("*").order("created_at", { ascending: false }).limit(300);
    if (activityActor)  q = q.eq("actor_id", activityActor);
    if (activityAction) q = q.eq("action", activityAction);
    const { data, error } = await q;
    if (error) console.error("Load activity error:", error);
    setActivityLog(data || []);
    setActivityLoading(false);
  }, [activityActor, activityAction]);
  useEffect(() => { if (isApproved && view === "activity") loadActivity(); }, [isApproved, view, loadActivity]);

  // ─── Realtime sync ──────────────────────────────────────────────────
  // Subscribe to Postgres change events on the tables the eval site cares
  // about so each coach's screen updates without manual refresh. Players are
  // patched in-place (the hot path); coaches and rankings just refetch on
  // any change since their payloads are small. RLS still applies — coaches
  // only receive events for rows they're allowed to read.
  useEffect(() => {
    if (!isApproved) return;
    const playerChannel = supabase
      .channel("realtime-players")
      .on("postgres_changes", { event: "*", schema: "public", table: "players" }, (payload) => {
        if (payload.eventType === "INSERT") {
          setPlayers(prev => {
            if (prev.some(p => p.id === payload.new.id)) return prev;
            const next = [...prev, payload.new];
            next.sort((a, b) => (a.last_name || "").localeCompare(b.last_name || ""));
            return next;
          });
        } else if (payload.eventType === "UPDATE") {
          setPlayers(prev => prev.map(p => p.id === payload.new.id ? { ...p, ...payload.new } : p));
        } else if (payload.eventType === "DELETE") {
          setPlayers(prev => prev.filter(p => p.id !== payload.old.id));
        }
      })
      .subscribe();
    const coachChannel = supabase
      .channel("realtime-coaches")
      .on("postgres_changes", { event: "*", schema: "public", table: "coaches" }, () => { loadCoaches(); })
      .subscribe();
    const rankingsChannel = supabase
      .channel("realtime-rankings")
      .on("postgres_changes", { event: "*", schema: "public", table: "unassigned_rankings" }, () => { loadRankings(); })
      .subscribe();
    return () => {
      supabase.removeChannel(playerChannel);
      supabase.removeChannel(coachChannel);
      supabase.removeChannel(rankingsChannel);
    };
  }, [isApproved, loadCoaches, loadRankings]);

  // Activity feed live updates — only subscribe while that tab is open, since
  // change_log INSERTs fire on every player write and the feed is otherwise
  // cheap to refetch.
  useEffect(() => {
    if (!isApproved || view !== "activity") return;
    const channel = supabase
      .channel("realtime-change_log")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "change_log" }, (payload) => {
        setActivityLog(prev => {
          if (prev.some(e => e.id === payload.new.id)) return prev;
          return [payload.new, ...prev].slice(0, 300);
        });
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [isApproved, view]);

  // ─── Tournament planning data loaders ───────────────────────────────
  // teams + blackouts are small and used cross-app (conflict counts, badges)
  // so we load them eagerly. Tournaments + assignments are heavier and only
  // fetched when the Tournaments tab is opened.
  const loadTeamsList = useCallback(async () => {
    const { data, error } = await supabase.from("teams").select("*").order("sort_order");
    if (error) console.error("Load teams error:", error);
    setTeamsList(data || []);
  }, []);
  const loadBlackouts = useCallback(async () => {
    const { data, error } = await supabase.from("blackout_dates").select("*").order("date_start");
    if (error) console.error("Load blackouts error:", error);
    setBlackoutDates(data || []);
  }, []);
  useEffect(() => { if (isApproved) { loadTeamsList(); loadBlackouts(); } }, [isApproved, loadTeamsList, loadBlackouts]);

  const loadTournaments = useCallback(async () => {
    setTournamentsLoading(true);
    const [tRes, aRes] = await Promise.all([
      supabase.from("tournaments").select("*").order("start_date"),
      supabase.from("tournament_assignments").select("*"),
    ]);
    if (tRes.error) console.error("Load tournaments error:", tRes.error);
    if (aRes.error) console.error("Load tournament assignments error:", aRes.error);
    setTournaments(tRes.data || []);
    setTournamentAssignments(aRes.data || []);
    setTournamentsLoading(false);
  }, []);
  useEffect(() => { if (isApproved && view === "tournaments") loadTournaments(); }, [isApproved, view, loadTournaments]);

  // Realtime sync for tournament planning (separate channel — only when on
  // that tab so we don't burn a websocket connection elsewhere).
  useEffect(() => {
    if (!isApproved || view !== "tournaments") return;
    const ch = supabase
      .channel("realtime-tournaments")
      .on("postgres_changes", { event: "*", schema: "public", table: "tournaments" }, () => loadTournaments())
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_assignments" }, () => loadTournaments())
      .on("postgres_changes", { event: "*", schema: "public", table: "teams" }, () => loadTeamsList())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [isApproved, view, loadTournaments, loadTeamsList]);

  // Coach conflicts memo — must live ABOVE the auth gates so React sees the
  // same hook call order on every render path (pre-auth and post-auth alike).
  const tournamentConflicts = useMemo(() => {
    const tById = new Map(tournaments.map(t => [t.id, t]));
    const teamById = new Map(teamsList.map(t => [t.id, t]));
    const coachToItems = new Map();
    for (const a of tournamentAssignments) {
      const tn = tById.get(a.tournament_id);
      const tm = teamById.get(a.team_id);
      if (!tn || !tm) continue;
      const coaches = [tm.head_coach, tm.assistant_coach].filter(Boolean);
      for (const coach of coaches) {
        if (!coachToItems.has(coach)) coachToItems.set(coach, []);
        coachToItems.get(coach).push({ tournament: tn, team_id: a.team_id });
      }
    }
    const conflicts = [];
    for (const [coach, items] of coachToItems) {
      const sorted = [...items].sort((a, b) => a.tournament.start_date.localeCompare(b.tournament.start_date));
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const a = sorted[i].tournament, b = sorted[j].tournament;
          if (a.id === b.id) continue;
          if (a.start_date <= b.end_date && b.start_date <= a.end_date) {
            conflicts.push({
              coach,
              a: { tournament: a, team_id: sorted[i].team_id },
              b: { tournament: b, team_id: sorted[j].team_id },
            });
          }
        }
      }
    }
    return conflicts;
  }, [tournaments, tournamentAssignments, teamsList]);

  // Distinct US states (from "City, ST" format) for the location filter
  // dropdown. Also above the auth gates to keep hook order stable.
  const stateOptions = useMemo(() => {
    const set = new Set();
    for (const t of tournaments) {
      const m = (t.location || "").match(/,\s*([A-Z]{2})\s*$/);
      if (m) set.add(m[1]);
    }
    return [...set].sort();
  }, [tournaments]);

  // Bulk-import preview: parse the paste live and split into "new" vs
  // "already in the DB" by (name|start_date). Also above the gates.
  const bulkImportPreview = useMemo(() => {
    if (!bulkImportText.trim()) return { parsed: [], newOnes: [], dupes: [] };
    let parsed = [];
    if (bulkImportSource === "USAV")              parsed = parseUSAVTournaments(bulkImportText);
    else if (bulkImportSource === "JVC")          parsed = parseJVCTournaments(bulkImportText);
    else if (bulkImportSource === "SportWrench")  parsed = parseSportWrenchTournaments(bulkImportText);
    const existing = new Set(tournaments.map(t => (t.name + "|" + t.start_date).toLowerCase()));
    const newOnes = [], dupes = [];
    for (const p of parsed) {
      const k = (p.name + "|" + p.start_date).toLowerCase();
      if (existing.has(k)) dupes.push(p); else newOnes.push(p);
    }
    return { parsed, newOnes, dupes };
  }, [bulkImportText, bulkImportSource, tournaments]);

  // Save a single player field update to Supabase
  const upd = useCallback(async (id, updates) => {
    // Optimistic update
    setPlayers(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
    setSaving(true);
    const dbUpdates = {};
    for (const [k, v] of Object.entries(updates)) {
      if (k === "usavDiv") continue;
      dbUpdates[k] = v;
    }
    const { error } = await supabase.from("players").update(dbUpdates).eq("id", id);
    if (error) console.error("Save error:", error);
    setSaving(false);
  }, []);

  // CSV Upload handler.
  //
  // Two formats supported:
  //   (1) The original "intake" CSV with strengths/goals/ideal coach prompts.
  //   (2) The Upper Hand tryout export ("Event Title: DS Elite Tryout - 15s"
  //       in row 2) that carries player email/phone, address, dominant hand,
  //       school team, primary/secondary positions, etc.
  //
  // Matching: lowercase + trim + collapse whitespace + strip punctuation,
  //           then Levenshtein-fuzzy on (firstName, lastName) — last name
  //           must be within 1 edit, first name within 2. Catches typos
  //           and trailing-space inconsistencies but not unrelated names.
  //
  // Merge policy for matched players:
  //   - Empty existing field → fill from CSV.
  //   - "Comment" / intake fields (other_sports, school_team, dominant_hand,
  //     reg_position, etc.) that exist on both sides → leave existing value;
  //     CSV value is appended into the Coach Notes as a timestamped line so
  //     no data is lost.
  //   - positions[] is union'd (CSV adds; never removes).
  //   - usav_div is filled only if missing.
  //   - Coach notes and scores are never overwritten.
  const handleCSVUpload = useCallback(async (file) => {
    setUploading(true); setUploadMsg("Parsing CSV...");

    // Cheap Levenshtein — bounded by max len for these short strings.
    const lev = (a, b) => {
      a = a||""; b = b||"";
      if (a === b) return 0;
      if (!a.length) return b.length;
      if (!b.length) return a.length;
      const prev = new Array(b.length+1);
      for (let j=0;j<=b.length;j++) prev[j]=j;
      for (let i=1;i<=a.length;i++) {
        let cur = [i];
        for (let j=1;j<=b.length;j++) {
          const cost = a[i-1]===b[j-1] ? 0 : 1;
          cur.push(Math.min(prev[j]+1, cur[j-1]+1, prev[j-1]+cost));
        }
        for (let j=0;j<=b.length;j++) prev[j]=cur[j];
      }
      return prev[b.length];
    };
    const norm = s => (s||"").toLowerCase().replace(/[^a-z0-9 ]/g,"").replace(/\s+/g," ").trim();

    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: async (results) => {
        const rows = results.data;

        // Find the header row (starts with "First Name") within the first
        // ~12 rows — Upper Hand prepends 5 metadata rows, intake CSVs are tighter.
        let headerIdx = -1;
        for (let i = 0; i < Math.min(rows.length, 12); i++) {
          if (rows[i][0] === "First Name") { headerIdx = i; break; }
        }
        if (headerIdx === -1) { setUploadMsg("Could not find header row. Make sure CSV has 'First Name' column."); setUploading(false); return; }
        const headers = rows[headerIdx];

        // Hunt for a division across the metadata rows + headers.
        // Upper Hand format: "Event Title,DS Elite Tryout - 15s" → U15.
        let parsedDiv = "";
        let parsedRegGroup = "";
        const meta = rows.slice(0, headerIdx).map(r => r.join(" ")).join(" ").toLowerCase();
        // Same metadata buffer also tells us whether this is a TRYOUT
        // signup roster (vs an evaluation roster). When true, every row
        // imported from this file gets tryout_registered=true so the
        // Teams/Tracker views can highlight who hasn't signed up.
        //
        // IMPORTANT: only inspect the Event Title cell — NOT the URL row.
        // Upper Hand auto-generates URL slugs from older event names, so
        // an eval-event URL can still contain "tryout" and would otherwise
        // flag every eval-CSV import as tryout. The Event Title is the
        // human-edited field that tracks the current event purpose.
        const eventTitle = (rows[1] && rows[1][1] != null) ? String(rows[1][1]).toLowerCase() : "";
        // IMPORTANT — eval check runs FIRST. Upper Hand titles like
        // "DS Elite Pre-Tryout Evaluations - U11 and U12" contain BOTH
        // "tryout" and "evaluations". When both match, the file is an
        // eval roster (who's coming to the eval session), not a tryout
        // roster. So eval wins.
        const isEvalCsv = /\beval(?:uations?)?\b/.test(eventTitle);
        const isTryoutCsv = !isEvalCsv && /\btryouts?\b/.test(eventTitle);
        const ageMatch = meta.match(/\b(\d{2})s?\b/);
        if (ageMatch) {
          const n = parseInt(ageMatch[1]);
          if (n>=10 && n<=18) parsedDiv = "U" + n;
        }
        // Also catch explicit "u15" patterns and reg_group buckets.
        if (!parsedDiv) {
          const m = meta.match(/u(\d{2})/);
          if (m) parsedDiv = "U" + m[1];
        }
        if (parsedDiv === "U11" || parsedDiv === "U12") parsedRegGroup = "U11/U12";
        else if (parsedDiv === "U13" || parsedDiv === "U14") parsedRegGroup = "U13/U14";
        else if (parsedDiv === "U15" || parsedDiv === "U16") parsedRegGroup = "U15/U16";
        else if (parsedDiv === "U17" || parsedDiv === "U18") parsedRegGroup = "U17/U18";

        const parsedRows = [];

        for (let i = headerIdx + 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row[0] || !row[0].trim()) continue;

          const get = (partial) => {
            const idx = headers.findIndex(h => h && h.toLowerCase().includes(partial));
            return idx >= 0 ? (row[idx] || "").trim() : "";
          };

          const fn = get("first name");
          const ln = get("last name");
          if (!fn && !ln) continue;
          const dob = get("dob");
          const usavFromDob = dob ? "U" + calcUSAV(dob) : "";

          // Primary + Secondary position columns from Upper Hand. Map free-text
          // entries to our internal position codes when we recognize them, and
          // also stash the raw response into reg_position for the card.
          const posMap = {"setter":"S","pin":"OH","middle":"MB","ds":"DS","libero":"DS","opposite":"OPP"};
          const primaryRaw = get("primary position");
          const secondaryRaw = get("secondary position");
          const csvPositions = [];
          [primaryRaw, secondaryRaw].forEach(raw => {
            const k = (raw||"").toLowerCase().trim();
            if (k && posMap[k] && !csvPositions.includes(posMap[k])) csvPositions.push(posMap[k]);
          });

          // Intake-style fields — only present in the older registration CSV.
          const minLevel = get("minimum level");
          const cleanMin = ["no","n/a","na",""].includes(minLevel.toLowerCase()) ? "" : minLevel;
          const leaving = get("leaving another");
          const cleanLeaving = ["n/a","na","not leaving",""].includes(leaving.toLowerCase()) ? "" : leaving;
          const supp = get("supplemental").toLowerCase() === "yes" ? 1 : 0;

          // "Other sports" prompt is phrased a few ways across exports.
          const otherSports = get("other sports") || get("any other sport");

          parsedRows.push({
            first_name: fn,
            last_name: ln,
            age: get("age"),
            dob: dob,
            gender: get("gender"),
            reg_group: parsedRegGroup,
            usav_div: parsedDiv || usavFromDob,
            // Upper Hand registration fields
            player_email: get("email"),
            player_phone: get("phone").replace(/^\s*managed.*$/i,"").split(",")[0] || "",
            parent_name: get("managed by"),
            parent_email: get("mgr email"),
            parent_phone: get("mgr phone"),
            address_line1: get("street address line 1") || get("address line 1") || get("address"),
            address_line2: get("street address line 2") || get("address line 2"),
            city: get("city"),
            state: get("state"),
            zip: get("zip"),
            other_sports: otherSports,
            dominant_hand: get("dominant hand"),
            school_team: get("school and school team") || get("school team"),
            current_team: get("club and team were you on") || get("club and team you were on") || get("what club") || "",
            positions: csvPositions,
            primary_position: primaryRaw,
            secondary_position: secondaryRaw,
            reg_position: get("how long have you been playing") || (primaryRaw && secondaryRaw ? primaryRaw + "/" + secondaryRaw : primaryRaw || secondaryRaw || ""),
            // Old intake fields — preserved when present
            min_level: cleanMin,
            strength_weakness: get("biggest strength"),
            goal: get("volleyball goals"),
            starter_pref: get("starter on a lower"),
            ideal_coach: get("ideal coach"),
            leaving_reason: cleanLeaving,
            supplemental: supp,
            // Tryout signup flag — only set true when the CSV is a tryout file.
            // Evaluation CSVs leave it undefined (importer will skip the field).
            tryout_registered: isTryoutCsv ? true : undefined,
            // Mirror flag for the eval roster. Set true on eval CSVs;
            // undefined skips the field on tryout/unknown CSVs.
            eval_registered: isEvalCsv ? true : undefined,
          });
        }

        if (parsedRows.length === 0) {
          setUploadMsg("No players found in CSV."); setUploading(false); return;
        }

        // Build a fuzzy lookup. Existing players keyed by normalized last name
        // for fast bucketing, then we compare first names within the bucket.
        const buckets = new Map();
        for (const p of players) {
          const ln = norm(p.last_name);
          if (!buckets.has(ln)) buckets.set(ln, []);
          buckets.get(ln).push(p);
        }
        const findMatch = (fn, ln) => {
          const nfn = norm(fn), nln = norm(ln);
          if (!nln) return null;
          // exact last-name bucket first
          let candidates = buckets.get(nln) || [];
          // also try near-miss last names (Levenshtein ≤ 1)
          if (candidates.length === 0) {
            for (const [k, arr] of buckets) {
              if (lev(k, nln) <= 1) candidates = candidates.concat(arr);
            }
          }
          for (const c of candidates) {
            const cfn = norm(c.first_name);
            if (lev(cfn, nfn) <= 2) return c;
          }
          return null;
        };

        // Fields that are safe to "fill blanks" without prompting.
        const FILL_FIELDS = [
          "dob","age","gender","player_email","player_phone","parent_name",
          "parent_email","parent_phone","address_line1","address_line2","city",
          "state","zip","other_sports","dominant_hand","school_team",
          "primary_position","secondary_position",
          "current_team","reg_position","usav_div","reg_group",
          "min_level","strength_weakness","goal","starter_pref","ideal_coach","leaving_reason",
        ];
        // Fields where, if both sides have a value AND they differ, we append
        // the new value to coach notes (so nothing is silently lost).
        const COMMENT_FIELDS = [
          ["other_sports","Other sports"],
          ["dominant_hand","Dominant hand"],
          ["school_team","School team"],
          ["current_team","Previous club/team"],
          ["reg_position","Position info"],
        ];

        const toInsert = [];
        const toUpdate = []; // [{id, patch}]
        const seenInCsv = new Set();
        for (const np of parsedRows) {
          // De-dup within the CSV itself
          const selfKey = norm(np.first_name) + "|" + norm(np.last_name);
          if (seenInCsv.has(selfKey)) continue;
          seenInCsv.add(selfKey);

          const existing = findMatch(np.first_name, np.last_name);
          if (!existing) {
            // Brand-new player. Strip empty strings so we don't clobber column defaults.
            const insert = {};
            for (const k of Object.keys(np)) {
              const v = np[k];
              if (v === "" || v == null) continue;
              insert[k] = v;
            }
            insert.first_name = np.first_name;
            insert.last_name = np.last_name;
            toInsert.push(insert);
            continue;
          }

          // Build a patch. Only fill empties; for comment fields where both
          // sides differ, queue a note-append.
          const patch = {};
          const noteAppendLines = [];
          for (const k of FILL_FIELDS) {
            const cur = existing[k];
            const nxt = np[k];
            if (nxt && (cur == null || String(cur).trim() === "")) {
              patch[k] = nxt;
            } else if (nxt && cur && String(cur).trim() !== String(nxt).trim()) {
              const cf = COMMENT_FIELDS.find(c => c[0] === k);
              if (cf) noteAppendLines.push("• " + cf[1] + ": " + nxt);
            }
          }
          // Positions: union (never removes)
          const curPos = existing.positions || [];
          const addPos = (np.positions || []).filter(p => !curPos.includes(p));
          if (addPos.length) patch.positions = [...curPos, ...addPos];
          // supplemental: don't clobber an existing 1 with a 0
          if (np.supplemental === 1 && existing.supplemental !== 1) patch.supplemental = 1;
          // tryout_registered: only flip false→true. Tryout CSVs always promote.
          if (np.tryout_registered === true && !existing.tryout_registered) patch.tryout_registered = true;
          // eval_registered: same pattern — eval CSVs promote, never demote.
          if (np.eval_registered === true && !existing.eval_registered) patch.eval_registered = true;

          if (noteAppendLines.length) {
            const stamp = new Date().toISOString().slice(0,10);
            const block = "\n\n[" + stamp + " CSV import — new values on file]\n" + noteAppendLines.join("\n");
            patch.notes = (existing.notes || "") + block;
          }

          if (Object.keys(patch).length > 0) toUpdate.push({ id: existing.id, patch });
        }

        const detected = isTryoutCsv ? "TRYOUT roster (will flag tryout_registered=true)"
                       : isEvalCsv  ? "EVAL roster (will flag eval_registered=true)"
                       : "Generic CSV (no registration flag will be set)";
        const summary = "Found " + parsedRows.length + " row" + (parsedRows.length===1?"":"s") + " in CSV."
          + "\n• " + toInsert.length + " new player" + (toInsert.length===1?"":"s") + " to create"
          + "\n• " + toUpdate.length + " existing player" + (toUpdate.length===1?"":"s") + " to update (fill blanks + log conflicts to notes)"
          + "\n• " + (parsedRows.length - toInsert.length - toUpdate.length) + " already fully matched — no change"
          + (parsedDiv ? "\n\nDivision parsed from event title: " + parsedDiv : "")
          + "\nDetected as: " + detected
          + "\n\nProceed?";
        if (!window.confirm(summary)) {
          setUploadMsg("Import cancelled."); setUploading(false); return;
        }

        setUploadMsg("Importing...");
        // Inserts in one batch
        if (toInsert.length) {
          const { error } = await supabase.from("players").insert(toInsert);
          if (error) { setUploadMsg("Insert error: " + error.message); setUploading(false); return; }
        }
        // Updates one-by-one (Supabase doesn't support multi-row UPDATE with different patches in one call)
        let updErrors = 0;
        for (const u of toUpdate) {
          const { error } = await supabase.from("players").update(u.patch).eq("id", u.id);
          if (error) updErrors++;
        }
        const msg = "Created " + toInsert.length + " · Updated " + (toUpdate.length - updErrors)
          + (updErrors ? " · " + updErrors + " update error" + (updErrors===1?"":"s") : "")
          + ". Reloading...";
        setUploadMsg(msg);
        await loadPlayers();
        setUploading(false);
      },
      error: (err) => { setUploadMsg("Parse error: " + err.message); setUploading(false); }
    });
  }, [loadPlayers, players]);

  // Opens the Add Player modal, pre-filling division to the first selected age tab.
  const openAddPlayer = useCallback(() => {
    setNewPlayer({ first_name:"", last_name:"", dob:"", age:"", usav_div: selectedDivs[0] || "U14", positions:[], parent_name:"", parent_email:"", parent_phone:"" });
    setAddMsg("");
    setAddingPlayer(true);
  }, [selectedDivs]);

  // Manual one-off player add. Dedup-warns on first+last name match (case-insensitive, trimmed)
  // — same key we'll use later when merging tryout-registration CSV rows into existing players.
  const handleAddPlayer = useCallback(async () => {
    const fn = (newPlayer.first_name||"").trim();
    const ln = (newPlayer.last_name||"").trim();
    if (!fn || !ln) { setAddMsg("First and last name are required."); return; }
    const dup = players.find(p =>
      (p.first_name||"").toLowerCase().trim() === fn.toLowerCase() &&
      (p.last_name ||"").toLowerCase().trim() === ln.toLowerCase()
    );
    if (dup) {
      const where = dup.usavDiv || dup.usav_div || "unknown division";
      if (!window.confirm("A player named " + fn + " " + ln + " already exists (" + where + "). Add another row anyway?")) return;
    }
    setAddMsg("Saving...");
    const usav = newPlayer.usav_div || "U" + calcUSAV(newPlayer.dob);
    const insert = {
      first_name: fn,
      last_name: ln,
      dob: newPlayer.dob || null,
      age: newPlayer.age || "",
      usav_div: usav,
      positions: newPlayer.positions || [],
      parent_name: newPlayer.parent_name || "",
      parent_email: newPlayer.parent_email || "",
      parent_phone: newPlayer.parent_phone || "",
    };
    const { error } = await supabase.from("players").insert(insert);
    if (error) { setAddMsg("Error: " + error.message); return; }
    await loadPlayers();
    setAddingPlayer(false);
    setNewPlayer({ first_name:"", last_name:"", dob:"", age:"", usav_div:"", positions:[], parent_name:"", parent_email:"", parent_phone:"" });
    setAddMsg("");
  }, [newPlayer, players, loadPlayers]);

  // Export to CSV
  const exportCSV = useCallback(() => {
    const headers = ["Name","Age","DOB","USAV Div","Reg Group","Positions","Projected","Team","Roster Pos","Current Team","Eval Complete",...SKILLS,"Total","Avg","Notes"];
    const csvRows = [headers.join(",")];
    players.forEach(p => {
      const row = [
        '"' + p.first_name + " " + p.last_name + '"',
        p.age, p.dob, p.usavDiv, p.reg_group,
        '"' + (p.positions||[]).join("/") + '"',
        p.projected_team, p.team_assignment, p.roster_pos, '"' + (p.current_team||"") + '"',
        p.eval_complete ? "Yes" : "No",
        ...SKILLS.map(s => (p.scores||{})[s] || ""),
        tot(p) || "", avg(p),
        '"' + (p.notes||"").replace(/"/g, '""') + '"'
      ];
      csvRows.push(row.join(","));
    });
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "dselite-evals-export.csv"; a.click();
    URL.revokeObjectURL(url);
  }, [players]);

  // Players across all currently-selected age groups (drives Evaluate filter + Rankings combined view).
  const divP = useMemo(() => {
    const divSet = new Set(selectedDivs);
    return players.filter(p => divSet.has(p.usavDiv || p.usav_div));
  }, [players, selectedDivs]);

  const filtered = useMemo(() => {
    let l = [...divP];
    if (search) {
      const s = search.toLowerCase();
      l = l.filter(p => (
        (p.first_name + " " + p.last_name).toLowerCase().includes(s) ||
        (p.tryout_number || "").toString().toLowerCase().includes(s)
      ));
    }
    if (filterPos) l = l.filter(p => (p.positions||[]).includes(filterPos));
    if (filterProj) l = l.filter(p => p.projected_team === filterProj);
    if (filterDate) l = l.filter(p => (p.eval_dates||[]).includes(filterDate));
    if (filterEval === "done") l = l.filter(p => p.eval_complete);
    if (filterEval === "pending") l = l.filter(p => !p.eval_complete);
    if (filterClinic === "invited") l = l.filter(p => p.id_clinic_invited);
    else if (filterClinic === "attended") l = l.filter(p => p.id_clinic_attended);
    else if (filterClinic === "invited_no_show") l = l.filter(p => p.id_clinic_invited && !p.id_clinic_attended);
    if (filterClinicDate) l = l.filter(p => (p.clinic_dates||[]).includes(filterClinicDate));
    if (regSince) l = l.filter(p => p.created_at && p.created_at >= regSince);
    if (sortBy === "name") l.sort((a,b) => (a.last_name||"").localeCompare(b.last_name||""));
    else if (sortBy === "score") l.sort((a,b) => tot(b) - tot(a));
    else if (sortBy === "age") l.sort((a,b) => parseInt(b.age||0) - parseInt(a.age||0));
    else if (sortBy === "proj") { const o = {"1":0,"1/2":1,"2":2,"2/3":3,"3":4,"":5}; l.sort((a,b) => (o[a.projected_team]||5) - (o[b.projected_team]||5)); }
    // Pinny sort — numeric pinnies ascending, blanks/non-numeric last so the
    // assigned numbers cluster at the top of the list.
    else if (sortBy === "pinny") l.sort((a,b) => {
      const na = parseInt(a.tryout_number); const nb = parseInt(b.tryout_number);
      const va = isNaN(na) ? Number.POSITIVE_INFINITY : na;
      const vb = isNaN(nb) ? Number.POSITIVE_INFINITY : nb;
      return va - vb;
    });
    return l;
  }, [divP, search, filterPos, filterProj, filterEval, filterDate, filterClinic, filterClinicDate, regSince, sortBy]);

  // ─── AUTH GATES ──────────────────────────────────────────────────────
  // 1. While bootstrapping the session, render a quiet loading screen so we
  //    don't flash the login form for users who already have a session.
  if (authChecking) {
    return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:C.bg,color:C.mut}}>Checking session…</div>;
  }

  // 2. Password-recovery gate. Fires when the user clicked the reset link in
  //    their email and supabase-js exchanged the token for a recovery session.
  //    Comes BEFORE the no-session gate because by this point they technically
  //    do have a session — but it's only good for setting a new password.
  if (recoveryMode) {
    const submitNewPassword = async (e) => {
      if (e && e.preventDefault) e.preventDefault();
      if (!newPassword || newPassword.length < 6) { setNewPasswordError("Pick a password at least 6 characters long."); return; }
      setNewPasswordBusy(true); setNewPasswordError("");
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      setNewPasswordBusy(false);
      if (error) { setNewPasswordError(error.message || "Couldn't update password."); return; }
      // Clear the flag and the field; the recovery session is now upgraded to
      // a normal session, so the main app gates will let them through.
      setRecoveryMode(false);
      setNewPassword("");
    };
    return (
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:C.bg,padding:16}}>
        <form onSubmit={submitNewPassword} style={{background:C.card,padding:32,borderRadius:16,border:"1px solid "+C.border,maxWidth:400,width:"100%"}}>
          <div style={{textAlign:"center",marginBottom:18}}>
            <div style={{fontSize:24,fontWeight:800,color:C.gold,marginBottom:4}}>◆ Set a new password</div>
            <div style={{fontSize:12,color:C.mut}}>You followed a password-reset link. Choose a new password and you'll be signed in.</div>
          </div>
          <label style={{display:"block",marginBottom:14}}>
            <span style={{fontSize:11,fontWeight:700,color:C.mut,textTransform:"uppercase"}}>New Password</span>
            <input type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} autoComplete="new-password" minLength={6} autoFocus
              style={{...inpStyle,width:"100%",padding:"10px 14px",fontSize:14,marginTop:3}} />
          </label>
          {newPasswordError && <div style={{fontSize:12,color:C.red,marginBottom:10,whiteSpace:"pre-wrap"}}>{newPasswordError}</div>}
          <button type="submit" disabled={newPasswordBusy}
            style={{width:"100%",padding:"12px",borderRadius:8,border:"none",background:newPasswordBusy?C.border:C.gold,color:newPasswordBusy?C.mut:"#000",fontFamily:"inherit",fontSize:14,fontWeight:700,cursor:newPasswordBusy?"default":"pointer"}}>
            {newPasswordBusy ? "Saving…" : "Save & Sign In"}
          </button>
          <button type="button" onClick={async ()=>{ await supabase.auth.signOut(); setRecoveryMode(false); setNewPassword(""); }}
            style={{width:"100%",marginTop:10,padding:"8px",borderRadius:8,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer"}}>
            Cancel
          </button>
        </form>
      </div>
    );
  }

  // 3. No session -> login / signup form.
  if (!session) {
    const submitAuth = async (e) => {
      if (e && e.preventDefault) e.preventDefault();
      const email    = loginEmail.trim();
      const password = loginPassword;
      if (!email || !password) { setLoginError("Email and password are required."); return; }
      setLoginBusy(true); setLoginError(""); setLoginInfo("");
      // Flip the form into Sign In mode with a friendly banner. Called both
      // by the pre-check (clean path) and by the catch block when Supabase
      // rejects a duplicate signup with "already registered" or a rate-limit
      // error.
      const redirectToSignIn = (reason) => {
        setLoginMode("login");
        setLoginPassword("");
        setLoginError("");
        setLoginInfo(reason || "Looks like you already have an account. Sign in with your existing password below.");
      };
      // Match the family of Supabase Auth errors that mean "this email is
      // already in use" so we can recover instead of just showing the raw
      // message ("Email rate limit exceeded", "User already registered", etc.)
      const looksLikeDuplicateSignup = (msg) => {
        const m = (msg || "").toLowerCase();
        return m.includes("already registered")
            || m.includes("already exists")
            || m.includes("user already")
            || m.includes("rate limit")
            || m.includes("over_email_send_rate_limit");
      };
      try {
        if (loginMode === "signup") {
          // Anyone can sign up; the trigger auto-approves allowlisted emails
          // and parks the rest on "Awaiting Approval" until the admin acts.
          // (We used to hard-block non-allowlisted emails here; we removed
          // that so unknown coaches can request access.)
          //
          // Pre-check whether this email already has an account. If yes,
          // flip to Sign In mode instead of letting Supabase return a
          // confusing rate-limit error on the second attempt.
          const { data: alreadyRegistered, error: regErr } = await supabase.rpc("is_email_registered", { check_email: email });
          if (regErr) {
            console.warn("is_email_registered RPC failed:", regErr);
          } else if (alreadyRegistered === true) {
            redirectToSignIn();
            return;
          }
          // 3. Actually create the account.
          const { data, error } = await supabase.auth.signUp({
            email, password,
            options: { data: { display_name: loginDisplayName.trim() || email.split("@")[0] } },
          });
          if (error) {
            if (looksLikeDuplicateSignup(error.message)) { redirectToSignIn(); return; }
            throw error;
          }
          if (!data.session) {
            setLoginInfo("Account created. Check your email for a confirmation link, then sign in.");
            setLoginMode("login");
          }
        } else {
          const { error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) throw error;
        }
      } catch (err) {
        // Catch-all: if even a sign-in error looks like the duplicate-signup
        // family (rare, but possible if the user toggled tabs), redirect.
        if (loginMode === "signup" && looksLikeDuplicateSignup(err.message)) {
          redirectToSignIn();
        } else {
          setLoginError(err.message || "Authentication failed");
        }
      } finally {
        setLoginBusy(false);
      }
    };
    return (
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:C.bg,padding:16}}>
        <form onSubmit={submitAuth} style={{background:C.card,padding:32,borderRadius:16,border:"1px solid "+C.border,maxWidth:400,width:"100%"}}>
          <div style={{textAlign:"center",marginBottom:20}}>
            <div style={{fontSize:28,fontWeight:800,color:C.gold,marginBottom:4}}>◆ DS ELITE</div>
            <div style={{fontSize:13,color:C.mut}}>Tryout Evaluations 2026-27</div>
          </div>
          <div style={{display:"flex",gap:4,marginBottom:18,background:C.bg,borderRadius:8,padding:3}}>
            {["login","signup"].map(m => (
              <button key={m} type="button" onClick={()=>{setLoginMode(m);setLoginError("");setLoginInfo("");}}
                style={{flex:1,padding:"8px 0",borderRadius:6,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,background:loginMode===m?C.gold:"transparent",color:loginMode===m?"#000":C.mut}}>
                {m === "login" ? "Sign In" : "Sign Up"}
              </button>
            ))}
          </div>
          {loginMode === "signup" && (
            <label style={{display:"block",marginBottom:10}}>
              <span style={{fontSize:11,fontWeight:700,color:C.mut,textTransform:"uppercase"}}>Display Name</span>
              <input type="text" value={loginDisplayName} onChange={e=>setLoginDisplayName(e.target.value)} placeholder="e.g. Sarah Smith" autoComplete="name"
                style={{...inpStyle,width:"100%",padding:"10px 14px",fontSize:14,marginTop:3}} />
            </label>
          )}
          <label style={{display:"block",marginBottom:10}}>
            <span style={{fontSize:11,fontWeight:700,color:C.mut,textTransform:"uppercase"}}>Email</span>
            <input type="email" value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} autoComplete="email" autoFocus
              style={{...inpStyle,width:"100%",padding:"10px 14px",fontSize:14,marginTop:3}} />
          </label>
          <label style={{display:"block",marginBottom:14}}>
            <span style={{fontSize:11,fontWeight:700,color:C.mut,textTransform:"uppercase"}}>Password</span>
            <input type="password" value={loginPassword} onChange={e=>setLoginPassword(e.target.value)} autoComplete={loginMode==="signup"?"new-password":"current-password"} minLength={6}
              style={{...inpStyle,width:"100%",padding:"10px 14px",fontSize:14,marginTop:3}} />
          </label>
          {loginError && <div style={{fontSize:12,color:C.red,marginBottom:10,whiteSpace:"pre-wrap"}}>{loginError}</div>}
          {loginInfo  && <div style={{fontSize:12,color:C.grn,marginBottom:10,whiteSpace:"pre-wrap"}}>{loginInfo}</div>}
          <button type="submit" disabled={loginBusy}
            style={{width:"100%",padding:"12px",borderRadius:8,border:"none",background:loginBusy?C.border:C.gold,color:loginBusy?C.mut:"#000",fontFamily:"inherit",fontSize:14,fontWeight:700,cursor:loginBusy?"default":"pointer"}}>
            {loginBusy ? "Please wait…" : (loginMode==="signup" ? "Create Account" : "Sign In")}
          </button>
          {loginMode === "login" && (
            <div style={{textAlign:"center",marginTop:12}}>
              <button type="button"
                onClick={async () => {
                  const email = loginEmail.trim();
                  if (!email) { setLoginError("Enter your email above first, then click Forgot password."); return; }
                  setLoginBusy(true); setLoginError(""); setLoginInfo("");
                  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
                  setLoginBusy(false);
                  if (error) { setLoginError(error.message || "Couldn't send reset email."); return; }
                  setLoginInfo("If an account exists for " + email + ", a password-reset link is on its way. Check your inbox (and spam folder).");
                }}
                style={{background:"none",border:"none",color:C.mut,fontFamily:"inherit",fontSize:11,cursor:"pointer",textDecoration:"underline"}}>
                Forgot password?
              </button>
            </div>
          )}
          {loginMode === "signup" && (
            <div style={{fontSize:10,color:C.mut,marginTop:12,textAlign:"center",lineHeight:1.5}}>
              Pre-approved coaches will be signed in immediately. Anyone else will be parked on an "Awaiting Approval" screen until the admin lets them in.
            </div>
          )}
        </form>
      </div>
    );
  }

  // 4. Session exists but the coach row hasn't loaded yet — brief loading.
  if (!coach) {
    return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:C.bg,color:C.mut}}>Loading profile…</div>;
  }

  // 5. Logged in but not yet approved by an admin.
  if (!coach.is_approved) {
    return (
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:C.bg,padding:16}}>
        <div style={{background:C.card,padding:32,borderRadius:16,border:"1px solid "+C.border,maxWidth:420,textAlign:"center"}}>
          <div style={{fontSize:24,fontWeight:800,color:C.gold,marginBottom:6}}>◆ Awaiting Approval</div>
          <div style={{fontSize:13,color:C.text,marginBottom:6}}>Hi {coach.display_name || coach.email}.</div>
          <div style={{fontSize:13,color:C.mut,marginBottom:20,lineHeight:1.6}}>
            Your account has been created but an admin needs to approve it before you can access the eval data.
            Ping the Director of Volleyball — they can approve you from the <b>Coaches</b> tab.
          </div>
          <button onClick={async ()=>{ await supabase.auth.signOut(); }}
            style={{padding:"10px 20px",borderRadius:8,border:"1px solid "+C.border,background:"transparent",color:C.mut,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700}}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (loading) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:C.bg,color:C.text}}>Loading DS Elite...</div>;

  const divsWithPlayers = DIVS.filter(d => players.some(p => (p.usavDiv||p.usav_div) === d));

  function ScoreB({player, skill}) {
    const cur = (player.scores && player.scores[skill]) || 0;
    return <div style={{display:"flex",gap:1}}>{[1,2,3,4,5].map(v => {
      const active = cur === v;
      return <button key={v} style={{width:22,height:22,borderRadius:4,padding:0,border:active?"2px solid "+C.gold:"1px solid "+C.border,cursor:"pointer",fontFamily:"inherit",fontSize:10,fontWeight:700,
        background:active?(v>=4?"rgba(34,197,94,0.2)":v>=3?"rgba(233,30,140,0.2)":"rgba(239,68,68,0.15)"):"transparent",
        color:active?(v>=4?C.grn:v>=3?C.gold:C.red):C.mut}} onClick={() => upd(player.id, {scores:{...player.scores,[skill]:cur===v?0:v}})}>{v}</button>;
    })}</div>;
  }

  function PosChips({player}) {
    return <div style={{display:"flex",gap:2,flexWrap:"wrap"}}>{POSITIONS.map(pos => {
      const active = (player.positions||[]).includes(pos);
      return <button key={pos} title={POS_LABELS[pos]} style={{padding:"2px 5px",borderRadius:4,fontSize:9,fontWeight:700,cursor:"pointer",
        border:active?"1.5px solid "+C.gold:"1px solid "+C.border,background:active?"rgba(233,30,140,0.15)":"transparent",color:active?C.gold:C.mut}}
        onClick={() => { const next = active ? (player.positions||[]).filter(p=>p!==pos) : [...(player.positions||[]),pos]; upd(player.id, {positions:next}); }}>{pos}</button>;
    })}</div>;
  }

  // ─── DASHBOARD ───
  function renderDashboard() {
    const evald = players.filter(p => p.eval_complete).length;
    const assigned = players.filter(p => p.team_assignment).length;
    // Group players by the date portion of created_at — surfaces when each
    // CSV/manual batch was added. Limit to last 21 days so this stays useful.
    const cutoffMs = Date.now() - 21 * 24 * 60 * 60 * 1000;
    const byUploadDate = {};
    players.forEach(p => {
      if (!p.created_at) return;
      const t = new Date(p.created_at).getTime();
      if (!Number.isFinite(t) || t < cutoffMs) return;
      const key = new Date(p.created_at).toISOString().slice(0, 10); // YYYY-MM-DD
      if (!byUploadDate[key]) byUploadDate[key] = [];
      byUploadDate[key].push(p);
    });
    const uploadDays = Object.keys(byUploadDate).sort().reverse();
    return (
      <div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:12,marginBottom:18}}>
          {[["Total Athletes",players.length,C.gold],["Evaluated",evald,C.grn],["Assigned",assigned,C.acc],["Offered",players.filter(p=>p.status==="Offered").length,"#e91e8c"],["Accepted",players.filter(p=>p.status==="Accepted").length,"#22c55e"]].map(([l,v,c]) =>
            <div key={l} style={{background:C.card,borderRadius:12,padding:"16px 18px",border:"1px solid "+C.border}}>
              <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut,marginBottom:5}}>{l}</div>
              <div style={{fontSize:30,fontWeight:800,color:c}}>{v}</div>
            </div>
          )}
        </div>
        {/* Upload Section */}
        <div style={{background:C.card,borderRadius:12,padding:"18px 20px",border:"1px solid "+C.border,marginBottom:18}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:C.gold,marginBottom:4}}>Upload Registration Spreadsheet</div>
              <div style={{fontSize:12,color:C.mut,maxWidth:520,lineHeight:1.4}}>
                Drop any CSV with a <b>First Name / Last Name</b> column — Upper Hand exports, intake forms, anything.
                Re-upload as often as you like; existing players are matched by name (fuzzy, handles typos) and only blank fields get filled in. Conflicting comments get appended to Coach Notes so nothing is lost.
              </div>
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
              <button onClick={openAddPlayer} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+C.gold,background:"transparent",color:C.gold,fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                + Add Player
              </button>
              <label style={{padding:"8px 16px",borderRadius:8,background:C.gold,color:"#000",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                {uploading ? "Uploading..." : "Upload CSV"}
                <input type="file" accept=".csv" style={{display:"none"}} onChange={e => { if (e.target.files[0]) handleCSVUpload(e.target.files[0]); }} disabled={uploading} />
              </label>
              <button onClick={exportCSV} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+C.gold,background:"transparent",color:C.gold,fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                Export CSV
              </button>
            </div>
          </div>
          {uploadMsg && <div style={{marginTop:8,fontSize:12,color:uploadMsg.includes("Error")? C.red : C.grn}}>{uploadMsg}</div>}
        </div>
        {/* Recent Registrations — grouped by created_at date, last 21 days */}
        {uploadDays.length > 0 && (
          <div style={{background:C.card,borderRadius:12,padding:"18px 20px",border:"1px solid "+C.border,marginBottom:18}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:10,flexWrap:"wrap",gap:8}}>
              <div>
                <div style={{fontSize:14,fontWeight:700,color:C.gold}}>Recent Registrations</div>
                <div style={{fontSize:12,color:C.mut}}>Players added in the last 21 days, grouped by upload date.</div>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {uploadDays.map(day => {
                const group = byUploadDate[day];
                const emails = [...new Set(group.map(p => (p.parent_email||"").trim()).filter(Boolean))];
                const pretty = new Date(day + "T00:00:00").toLocaleDateString(undefined, {weekday:"short", month:"short", day:"numeric"});
                return (
                  <div key={day} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:"8px 12px",background:C.bg,borderRadius:8,border:"1px solid "+C.border,flexWrap:"wrap"}}>
                    <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                      <span style={{fontSize:13,fontWeight:700,color:C.gold,minWidth:120}}>{pretty}</span>
                      <Tag c={C.acc}>{group.length} player{group.length===1?"":"s"}</Tag>
                      <span style={{fontSize:11,color:C.mut}}>{emails.length} parent email{emails.length===1?"":"s"}</span>
                    </div>
                    <div style={{display:"flex",gap:6,alignItems:"center"}}>
                      <button onClick={() => { setRegSince(day); setView("evaluate"); }}
                        title="Filter the Evaluate view to players registered on or after this date"
                        style={{padding:"6px 10px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.text,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                        View
                      </button>
                      <button onClick={() => {
                        if (!emails.length) { window.alert("No parent emails found for this date."); return; }
                        navigator.clipboard.writeText(emails.join(", ")).then(()=>{ setCopiedEmails(true); setTimeout(()=>setCopiedEmails(false), 2000); });
                      }} disabled={!emails.length}
                        style={{padding:"6px 10px",borderRadius:6,border:"1px solid "+(emails.length?C.gold:C.border),background:"transparent",color:emails.length?C.gold:C.mut,fontSize:11,fontWeight:700,cursor:emails.length?"pointer":"default",fontFamily:"inherit"}}>
                        Copy emails
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {copiedEmails && <div style={{marginTop:8,fontSize:11,color:C.grn}}>Copied to clipboard.</div>}
          </div>
        )}
        {/* Age Group Cards */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12}}>
          {divsWithPlayers.map(d => {
            const g = players.filter(p => (p.usavDiv||p.usav_div) === d);
            const ev = g.filter(p => p.eval_complete).length;
            const pct = g.length ? Math.round(ev/g.length*100) : 0;
            return <div key={d} style={{background:C.card,borderRadius:12,padding:"16px 18px",border:"1px solid "+C.border,cursor:"pointer"}} onClick={() => {setSelectedDivs([d]);setView("evaluate");}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <span style={{fontSize:18,fontWeight:800,color:C.gold}}>{d}</span>
                <Tag c={C.gold}>{g.length}</Tag>
              </div>
              <div style={{background:C.bg,borderRadius:5,height:7,marginBottom:7,overflow:"hidden"}}>
                <div style={{height:"100%",width:pct+"%",background:"linear-gradient(90deg,"+C.gold+","+C.acc+")",borderRadius:5}} />
              </div>
              <div style={{fontSize:11,color:C.mut}}>{pct}% evaluated</div>
            </div>;
          })}
        </div>
      </div>
    );
  }

  // ─── EVALUATE TABLE ───
  function renderEval() {
    const tdS = {padding:"5px 4px",fontSize:12,borderBottom:"1px solid "+C.border,verticalAlign:"middle"};
    return (
      <div>
        <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
          <input style={{...inpStyle,padding:"7px 12px",fontSize:13,width:180}} placeholder="Search name or pinny #" value={search} onChange={e=>setSearch(e.target.value)} />
          <select style={{...inpStyle,padding:"7px 10px",fontSize:12}} value={filterPos} onChange={e=>setFilterPos(e.target.value)}>
            <option value="">All Pos</option>{POSITIONS.map(p=><option key={p} value={p}>{p}</option>)}
          </select>
          <select style={{...inpStyle,padding:"7px 10px",fontSize:12}} value={filterProj} onChange={e=>setFilterProj(e.target.value)}>
            <option value="">All Proj</option>{PROJ_OPTS.filter(Boolean).map(o=><option key={o} value={o}>Team {o}</option>)}
          </select>
          <select style={{...inpStyle,padding:"7px 10px",fontSize:12,color:filterDate?C.gold:C.text}} value={filterDate} onChange={e=>setFilterDate(e.target.value)} title="Show only players attending this eval date">
            <option value="">All Dates</option>{EVAL_DATES.map(d=><option key={d} value={d}>{d}</option>)}
          </select>
          <select style={{...inpStyle,padding:"7px 10px",fontSize:12}} value={sortBy} onChange={e=>setSortBy(e.target.value)}>
            <option value="name">Name</option><option value="pinny">Pinny #</option><option value="score">Score</option><option value="proj">Projected</option>
          </select>
          {selectedDivs.some(d => CLINIC_DIVS.includes(d)) && (
            <select style={{...inpStyle,padding:"7px 10px",fontSize:12,color:filterClinic!=="all"?C.gold:C.text}} value={filterClinic} onChange={e=>setFilterClinic(e.target.value)} title="National Team ID Clinic filter">
              <option value="all">All Clinic</option>
              <option value="invited">Invited</option>
              <option value="attended">Attended</option>
              <option value="invited_no_show">Invited, no-show</option>
            </select>
          )}
          {selectedDivs.some(d => CLINIC_DIVS.includes(d)) && (
            <select style={{...inpStyle,padding:"7px 10px",fontSize:12,color:filterClinicDate?C.gold:C.text}} value={filterClinicDate} onChange={e=>setFilterClinicDate(e.target.value)} title="Show only players who attended a specific clinic date">
              <option value="">Any clinic date</option>
              {CLINIC_DATES.map(d => <option key={d} value={d}>Attended {d}</option>)}
            </select>
          )}
          <span style={{fontSize:11,color:C.mut,marginLeft:8}}>Registered since:</span>
          <input type="date" style={{...inpStyle,padding:"6px 10px",fontSize:12,color:regSince?C.gold:C.text,colorScheme:"dark"}} value={regSince} onChange={e=>setRegSince(e.target.value)} title="Show only players whose created_at is on or after this date" />
          {regSince && <button onClick={()=>setRegSince("")} title="Clear date filter" style={{padding:"6px 8px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>×</button>}
          <button onClick={() => {
            const emails = filtered.map(p => (p.parent_email||"").trim()).filter(Boolean);
            const uniq = [...new Set(emails)];
            if (!uniq.length) { window.alert("No parent emails found for the current filter."); return; }
            navigator.clipboard.writeText(uniq.join(", ")).then(()=>{ setCopiedEmails(true); setTimeout(()=>setCopiedEmails(false), 2000); });
          }} title="Copy parent emails of currently visible players to clipboard, comma-separated" style={{padding:"6px 10px",borderRadius:6,border:"1px solid "+C.gold,background:"transparent",color:C.gold,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
            {copiedEmails ? "Copied ✓" : "Copy emails"}
          </button>
          <span style={{fontSize:11,color:C.mut,marginLeft:"auto"}}>{saving?"Saving...":filtered.length+" players"}</span>
        </div>
        <div style={{background:C.card,borderRadius:12,border:"1px solid "+C.border,overflow:"hidden"}}>
          <div style={{overflow:"auto",maxHeight:"calc(100vh - 200px)"}}>
            <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0}}>
              <thead><tr>
                {[
                  {label:"Pinny",full:"Pinny / tryout number",sortKey:"pinny"},
                  {label:"Player",sortKey:"name"},{label:"Pos"},{label:"Proj",sortKey:"proj"},
                  ...SKILLS.map(s => ({label: SKILL_ABBR[s] || s, full: s})),
                  {label:"Tot",sortKey:"score"},{label:"Avg"},{label:"Team"},{label:"Notes"},
                  {label:"✓",full:"Evaluation complete"}
                ].map((h,i) => {
                  const isActive = h.sortKey && sortBy === h.sortKey;
                  // Show a faded ↕ on every sortable header so it's clear they're
                  // clickable, and a gold ▼ on the currently active one.
                  const arrow = h.sortKey ? (isActive
                    ? <span style={{color:C.gold,marginLeft:3}}>▼</span>
                    : <span style={{color:C.border,marginLeft:3,opacity:0.6}}>↕</span>) : null;
                  return <th key={i}
                    onClick={()=>{ if (h.sortKey) setSortBy(h.sortKey); }}
                    title={h.sortKey ? "Sort by "+(h.full||h.label) : (h.full||"")}
                    style={{padding:"6px 4px",textAlign:"left",fontSize:9,fontWeight:700,textTransform:"uppercase",color:isActive?C.gold:C.mut,borderBottom:"1px solid "+C.border,background:C.card,position:"sticky",top:0,zIndex:2,whiteSpace:"nowrap",boxShadow:"0 1px 0 "+C.border,cursor:h.sortKey?"pointer":"default",userSelect:"none"}}>
                    {h.label}{arrow}
                  </th>;
                })}
              </tr></thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id}>
                    <td style={tdS}><DebouncedField style={{...inpStyle,width:44,padding:"4px",textAlign:"center",fontSize:12,fontWeight:700,color:p.tryout_number?C.gold:C.text}} value={p.tryout_number||""} placeholder="—" onCommit={v=>upd(p.id,{tryout_number:v})} /></td>
                    <td style={tdS}>
                      <div style={{cursor:"pointer"}} onClick={()=>setProfileId(p.id)}>
                        <div style={{display:"flex",alignItems:"center",gap:5}}>
                          {isReturningDSE(p) && <span title="DS Elite returning athlete" style={{color:C.gold,fontSize:14,fontWeight:800,lineHeight:1}}>◆</span>}
                          <span style={{fontWeight:700,fontSize:12,color:C.gold}}>{p.first_name} {p.last_name}</span>
                        </div>
                        <div style={{fontSize:10,color:C.mut}}>Age {p.age} • {p.usavDiv||p.usav_div}</div>
                        {isNewPlayer(p) && <Tag c={C.grn}>NEW</Tag>}
                        {p.min_level && <Tag c={C.gold}>Min: {p.min_level}</Tag>}
                        {p.supplemental===1 && <Tag c={C.acc}>SUPP</Tag>}
                        {p.status && p.status !== "In Progress" && <Tag c={STATUS_COLORS[p.status]}>{p.status}</Tag>}
                        {p.id_clinic_invited && <Tag c={C.gold}>INV</Tag>}
                        {p.id_clinic_attended && <Tag c={C.grn}>ATT</Tag>}
                      </div>
                    </td>
                    <td style={tdS}><PosChips player={p} /></td>
                    <td style={tdS}><select style={{...inpStyle,width:40,fontSize:10,padding:"3px 1px"}} value={p.projected_team||""} onChange={e=>upd(p.id,{projected_team:e.target.value})}>{PROJ_OPTS.map(o=><option key={o} value={o}>{o||"—"}</option>)}</select></td>
                    {SKILLS.map(sk=><td key={sk} style={tdS}><ScoreB player={p} skill={sk} /></td>)}
                    <td style={tdS}><span style={{fontWeight:800,fontSize:14,color:tot(p)?C.gold:C.mut}}>{tot(p)||"—"}</span></td>
                    <td style={tdS}><span style={{fontWeight:600,fontSize:12}}>{avg(p)}</span></td>
                    <td style={tdS}>
                      <select style={{...inpStyle,fontSize:10,padding:"3px",width:74}} value={p.team_assignment||""} onChange={e=>upd(p.id,{team_assignment:e.target.value,roster_pos:""})}>
                        <option value="">{"—"}</option>{(TM[p.usavDiv||p.usav_div]||[]).map(t=><option key={t} value={t}>{t}</option>)}
                      </select>
                      {p.team_assignment && <select style={{...inpStyle,fontSize:9,padding:"2px",width:54,marginTop:2,display:"block"}} value={p.roster_pos||""} onChange={e=>upd(p.id,{roster_pos:e.target.value})}>
                        <option value="">Roster</option>
                        {ROSTER_POS.map(rp => { const taken = players.some(o=>o.id!==p.id&&o.team_assignment===p.team_assignment&&o.roster_pos===rp); return <option key={rp} value={rp} disabled={taken}>{rp}{taken?" ✓":""}</option>; })}
                      </select>}
                    </td>
                    <td style={tdS}><DebouncedField style={{...inpStyle,width:90,fontSize:11,padding:"4px 6px"}} placeholder="Notes..." value={p.notes||""} onCommit={v=>upd(p.id,{notes:v})} /></td>
                    <td style={tdS}><input type="checkbox" checked={!!p.eval_complete} onChange={e=>upd(p.id,{eval_complete:e.target.checked})} style={{width:16,height:16,cursor:"pointer",accentColor:C.gold}} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!filtered.length && <div style={{textAlign:"center",padding:28,color:C.mut}}>No players match</div>}
        </div>
      </div>
    );
  }

  // ─── TEAMS ───
  // Each selected age group renders as its own section with its own DndContext, so drags are
  // scoped per-division. Team names can repeat across divisions; per-context droppable IDs
  // keep that unambiguous.
  // Per-player onboarding grid for accepted athletes. Coaches use this once
  // teams are formed to chase down sign-ups before the season starts.
  function renderTracker() {
    if (!selectedDivs.length) return <div style={{padding:20,color:C.mut,fontSize:12}}>Pick a division above to see its tracker.</div>;
    const COLS = [
      ["sportsengine_registered","SportsEngine"],
      ["sportsyou_registered","SportsYou"],
      ["lonestar_member","Lone Star"],
      ["jersey_tryout_complete","Jersey Tryout"],
    ];
    const accepted = players.filter(p => selectedDivs.includes(p.usavDiv || p.usav_div) && p.offer_status === "accepted");
    return (
      <>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:8,flexWrap:"wrap"}}>
          <div style={{fontSize:11,color:C.mut,fontStyle:"italic",flex:1,minWidth:240}}>
            Accepted players for the selected division(s). Click a cell to toggle. Same four flags are editable on the player card.
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            <label title="Signed up for tryout but NOT on the eval roster — they still need evaluating" style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",borderRadius:8,background:showTryoutOnly?"rgba(6,182,212,0.14)":"transparent",border:"1px solid "+(showTryoutOnly?"#06b6d4":C.border),cursor:"pointer",fontSize:11,fontWeight:700,color:showTryoutOnly?"#06b6d4":C.mut,userSelect:"none",whiteSpace:"nowrap"}}>
              <input type="checkbox" checked={showTryoutOnly} onChange={e=>setShowTryoutOnly(e.target.checked)} style={{accentColor:"#06b6d4",cursor:"pointer"}} />
              Tryout — not yet evaluated
            </label>
            <label title="On the eval roster but NOT signed up for tryout — chase them to register" style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",borderRadius:8,background:showEvalOnly?"rgba(245,158,11,0.14)":"transparent",border:"1px solid "+(showEvalOnly?"#f59e0b":C.border),cursor:"pointer",fontSize:11,fontWeight:700,color:showEvalOnly?"#f59e0b":C.mut,userSelect:"none",whiteSpace:"nowrap"}}>
              <input type="checkbox" checked={showEvalOnly} onChange={e=>setShowEvalOnly(e.target.checked)} style={{accentColor:"#f59e0b",cursor:"pointer"}} />
              Eval — not signed up for tryout
            </label>
            <label title="Signed up for eval and indicated they can't attend tryout (using eval as tryout)" style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",borderRadius:8,background:showEvalAsTryout?"rgba(233,30,140,0.10)":"transparent",border:"1px solid "+(showEvalAsTryout?C.acc:C.border),cursor:"pointer",fontSize:11,fontWeight:700,color:showEvalAsTryout?C.acc:C.mut,userSelect:"none",whiteSpace:"nowrap"}}>
              <input type="checkbox" checked={showEvalAsTryout} onChange={e=>setShowEvalAsTryout(e.target.checked)} style={{accentColor:C.acc,cursor:"pointer"}} />
              Using eval as tryout
            </label>
          </div>
        </div>
        {selectedDivs.map(div => {
          const teams = TM[div] || [];
          const divAccepted = accepted.filter(p => (p.usavDiv || p.usav_div) === div);
          if (divAccepted.length === 0) {
            return (
              <div key={div} style={{marginBottom:18,padding:14,background:C.card,borderRadius:10,border:"1px solid "+C.border}}>
                <div style={{fontSize:13,fontWeight:800,color:C.gold,marginBottom:4}}>{div}</div>
                <div style={{fontSize:11,color:C.mut}}>No accepted players yet in {div}.</div>
              </div>
            );
          }
          // Group accepted players by team_assignment, with anything missing
          // a team assignment shown last under "(no team yet)".
          const groups = [];
          for (const t of teams) {
            const tp = divAccepted.filter(p => p.team_assignment === t);
            if (tp.length) groups.push([t, tp]);
          }
          const noTeam = divAccepted.filter(p => !p.team_assignment || !teams.includes(p.team_assignment));
          if (noTeam.length) groups.push(["(no team yet)", noTeam]);
          return (
            <div key={div} style={{marginBottom:24}}>
              {selectedDivs.length > 1 && <h2 style={{margin:"0 0 10px 0",fontSize:15,fontWeight:800,color:C.gold,textTransform:"uppercase",letterSpacing:1,borderBottom:"1px solid "+C.border,paddingBottom:6}}>{div}</h2>}
              {groups.map(([team, roster]) => {
                const totals = COLS.map(([k]) => roster.filter(p => p[k]).length);
                return (
                  <div key={team} style={{marginBottom:16,background:C.card,borderRadius:12,border:"1px solid "+C.border,overflow:"hidden"}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",background:C.bg,borderBottom:"1px solid "+C.border,flexWrap:"wrap",gap:8}}>
                      <div style={{fontSize:13,fontWeight:800,color:C.gold}}>{team} <span style={{color:C.mut,fontWeight:600,fontSize:11,marginLeft:6}}>· {roster.length} accepted</span></div>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                        {COLS.map(([k,label],i) => (
                          <span key={k} style={{fontSize:10,fontWeight:700,padding:"3px 8px",borderRadius:8,background:totals[i]===roster.length?"rgba(34,197,94,0.18)":"rgba(255,255,255,0.04)",color:totals[i]===roster.length?C.grn:C.mut,border:"1px solid "+C.border}}>
                            {label}: {totals[i]}/{roster.length}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div style={{overflowX:"auto"}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                        <thead>
                          <tr style={{background:C.bg}}>
                            <th style={{textAlign:"left",padding:"8px 12px",fontSize:10,fontWeight:700,color:C.mut,letterSpacing:0.5,borderBottom:"1px solid "+C.border}}>PLAYER</th>
                            <th style={{textAlign:"left",padding:"8px 8px",fontSize:10,fontWeight:700,color:C.mut,letterSpacing:0.5,borderBottom:"1px solid "+C.border}}>POS</th>
                            {COLS.map(([k,label]) => (
                              <th key={k} style={{textAlign:"center",padding:"8px 8px",fontSize:10,fontWeight:700,color:C.mut,letterSpacing:0.5,borderBottom:"1px solid "+C.border}}>{label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {roster
                            .slice()
                            .sort((a,b) => (a.last_name||"").localeCompare(b.last_name||""))
                            .map(p => {
                              // Supplemental players are using the evaluation
                              // *as* their tryout — color the row so the staff
                              // can see at a glance who that is.
                              const hi = playerHighlight(p);
                              return (
                              <tr key={p.id} style={{borderBottom:"1px solid "+C.border,background:hi?hi.bg:"transparent"}}>
                                <td style={{padding:"8px 12px"}}>
                                  <span onClick={()=>setProfileId(p.id)} style={{cursor:"pointer",fontWeight:700,color:hi?hi.color:C.text}}>
                                    {p.first_name} {p.last_name}
                                  </span>
                                  {hi && <span title={hi.label} style={{fontSize:9,fontWeight:800,color:hi.color,marginLeft:6,padding:"2px 6px",borderRadius:6,border:"1px solid "+hi.color,letterSpacing:0.5}}>{hi.label}</span>}
                                  {p.roster_pos && <span style={{fontSize:10,color:C.mut,marginLeft:6}}>#{p.roster_pos}</span>}
                                </td>
                                <td style={{padding:"8px 8px",color:C.mut,fontSize:11}}>{(p.positions||[]).join("/") || "—"}</td>
                                {COLS.map(([k]) => {
                                  const on = !!p[k];
                                  return (
                                    <td key={k} style={{padding:"6px 8px",textAlign:"center"}}>
                                      <span onClick={()=>upd(p.id,{[k]:!on})}
                                        title={on?"Click to mark not done":"Click to mark done"}
                                        style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:32,height:24,borderRadius:6,cursor:"pointer",fontSize:14,fontWeight:800,border:"1px solid "+(on?C.grn:C.border),background:on?"rgba(34,197,94,0.18)":"transparent",color:on?C.grn:C.mut,userSelect:"none"}}>
                                        {on?"✓":""}
                                      </span>
                                    </td>
                                  );
                                })}
                              </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </>
    );
  }

  function renderTeams() {
    if (!selectedDivs.length) return null;
    return (
      <>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:8,flexWrap:"wrap"}}>
          <div style={{fontSize:11,color:C.mut,fontStyle:"italic",flex:1,minWidth:240}}>
            Drag a player onto a team card to assign (clears their roster slot). Drag onto Unassigned, Declined, or Not Invited to change status.
            Click the "+ offer" chip on a team player to cycle ★ locked (signed + deposit) → offer → ✓ accepted → waiting (for tryouts) → ✗ declined → none.
            Type a rank number to reorder within a position — rank persists across team changes.
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            <label title="Signed up for tryout but NOT on the eval roster — they still need evaluating" style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",borderRadius:8,background:showTryoutOnly?"rgba(6,182,212,0.14)":"transparent",border:"1px solid "+(showTryoutOnly?"#06b6d4":C.border),cursor:"pointer",fontSize:11,fontWeight:700,color:showTryoutOnly?"#06b6d4":C.mut,userSelect:"none",whiteSpace:"nowrap"}}>
              <input type="checkbox" checked={showTryoutOnly} onChange={e=>setShowTryoutOnly(e.target.checked)} style={{accentColor:"#06b6d4",cursor:"pointer"}} />
              Tryout — not yet evaluated
            </label>
            <label title="On the eval roster but NOT signed up for tryout — chase them to register" style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",borderRadius:8,background:showEvalOnly?"rgba(245,158,11,0.14)":"transparent",border:"1px solid "+(showEvalOnly?"#f59e0b":C.border),cursor:"pointer",fontSize:11,fontWeight:700,color:showEvalOnly?"#f59e0b":C.mut,userSelect:"none",whiteSpace:"nowrap"}}>
              <input type="checkbox" checked={showEvalOnly} onChange={e=>setShowEvalOnly(e.target.checked)} style={{accentColor:"#f59e0b",cursor:"pointer"}} />
              Eval — not signed up for tryout
            </label>
            <label title="Signed up for eval and indicated they can't attend tryout (using eval as tryout)" style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",borderRadius:8,background:showEvalAsTryout?"rgba(233,30,140,0.10)":"transparent",border:"1px solid "+(showEvalAsTryout?C.acc:C.border),cursor:"pointer",fontSize:11,fontWeight:700,color:showEvalAsTryout?C.acc:C.mut,userSelect:"none",whiteSpace:"nowrap"}}>
              <input type="checkbox" checked={showEvalAsTryout} onChange={e=>setShowEvalAsTryout(e.target.checked)} style={{accentColor:C.acc,cursor:"pointer"}} />
              Using eval as tryout
            </label>
          </div>
        </div>
        {selectedDivs.map(div => (
          <div key={div} style={{marginBottom:24}}>
            {selectedDivs.length > 1 && <h2 style={{margin:"0 0 10px 0",fontSize:15,fontWeight:800,color:C.gold,textTransform:"uppercase",letterSpacing:1,borderBottom:"1px solid "+C.border,paddingBottom:6}}>{div} — {players.filter(p=>(p.usavDiv||p.usav_div)===div).length} players</h2>}
            {renderTeamsSection(div)}
          </div>
        ))}
      </>
    );
  }

  function renderTeamsSection(div) {
    const teams = TM[div] || [];
    const divPlayers = players.filter(p => (p.usavDiv || p.usav_div) === div);
    const divRanks = unassignedRanks[div] || {};

    // Full ordered list of player IDs at (div, pos), assigned OR unassigned.
    // Stored manual order first, then any remaining players appended by total score desc.
    const fullPosOrder = (pos) => {
      const allInPos = divPlayers.filter(p => pos === "" ? (p.positions||[]).length === 0 : (p.positions||[]).includes(pos)).map(p => p.id);
      const inSet = new Set(allInPos);
      const stored = (divRanks[pos] || []).filter(id => inSet.has(id));
      const storedSet = new Set(stored);
      const unranked = allInPos.filter(id => !storedSet.has(id))
        .map(id => divPlayers.find(p => p.id === id))
        .sort((a,b) => tot(b) - tot(a))
        .map(p => p.id);
      return [...stored, ...unranked];
    };
    const posRankOf = (playerId, pos) => {
      const order = fullPosOrder(pos);
      const i = order.indexOf(playerId);
      return i >= 0 ? i + 1 : null;
    };
    const setPosRank = (playerId, pos, newRank) => {
      const order = fullPosOrder(pos).filter(id => id !== playerId);
      const clamped = Math.max(1, Math.min(newRank, order.length + 1));
      order.splice(clamped - 1, 0, playerId);
      persistRanking(div, pos, order);
    };
    const resetPos = (pos) => persistRanking(div, pos, null);

    const handleDragEnd = (event) => {
      const { active, over } = event;
      if (!over) return;
      const playerId = parseInt(String(active.id).replace("player-", ""));
      const overId = String(over.id);
      const player = players.find(p => p.id === playerId);
      if (!player) return;
      const now = new Date().toISOString();
      // Terminal-status buckets — clear team assignment and stamp the status.
      if (overId === "bucket-declined") {
        if (player.offer_status === "declined" && !player.team_assignment) return;
        upd(playerId, { team_assignment: "", roster_pos: "", offer_status: "declined", offer_decision_at: now });
        return;
      }
      if (overId === "bucket-not_invited") {
        if (player.offer_status === "not_invited" && !player.team_assignment) return;
        upd(playerId, { team_assignment: "", roster_pos: "", offer_status: "not_invited", offer_made_at: null, offer_decision_at: null });
        return;
      }
      // Team drops (including unassigned via team-""). If the player was declined
      // or not-invited, reset that status — they're back in the offer pipeline.
      if (overId.startsWith("team-")) {
        const newTeam = overId.replace("team-", "");
        const currentTeam = player.team_assignment || "";
        const isTerminal = player.offer_status === "declined" || player.offer_status === "not_invited";
        if (currentTeam === newTeam && !isTerminal) return;
        const updates = { team_assignment: newTeam, roster_pos: "" };
        if (isTerminal) {
          updates.offer_status = "";
          updates.offer_made_at = null;
          updates.offer_decision_at = null;
        }
        upd(playerId, updates);
      }
    };

    // Small pinny-number chip next to a player's name — same source as the
    // Evaluate table's Pinny column (players.tryout_number). Hidden if blank.
    const pinnyChip = (player) => {
      const v = (player.tryout_number || "").trim();
      if (!v) return null;
      return <span title="Pinny #" style={{fontSize:9,fontWeight:800,padding:"1px 6px",borderRadius:8,background:"rgba(255,255,255,0.08)",color:C.text,whiteSpace:"nowrap"}}>#{v}</span>;
    };

    // Click-to-cycle offer-status chip on team-card player rows:
    //   none → "locked" → "made" → "accepted" → "waiting" → "declined" → none.
    //   "locked" comes first so a coach processing a signed agreement + paid
    //   deposit only needs ONE click. The intermediate states (made, accepted,
    //   waiting for tryouts, declined) are reachable by clicking again.
    //   Cycling INTO declined clears team_assignment + roster_pos so the
    //   player moves off the team card automatically — matches the
    //   drag-to-Declined-bucket behaviour. not_invited is still bucket-only.
    const cycleOffer = (player) => {
      const cur = player.offer_status || "";
      const now = new Date().toISOString();
      const updates = {};
      if (cur === "" || cur === "not_invited") {
        updates.offer_status = "locked"; updates.offer_decision_at = now;
      } else if (cur === "locked") {
        updates.offer_status = "made"; updates.offer_made_at = now; updates.offer_decision_at = null;
      } else if (cur === "made") {
        updates.offer_status = "accepted"; updates.offer_decision_at = now;
      } else if (cur === "accepted") {
        // Waiting on tryouts — keep timestamps as-is; this is a pre-decision
        // hold state. No team-assignment side-effects.
        updates.offer_status = "waiting";
      } else if (cur === "waiting") {
        // Family declined. Intentionally NOT clearing team_assignment /
        // roster_pos here — coaches asked the chip to mark status only and
        // leave the player on the card so they can keep iterating (e.g.
        // cycle back through if the family changes their mind). Drag to
        // the Declined Offer bucket is still the way to move them off.
        updates.offer_status = "declined";
        updates.offer_decision_at = now;
      } else {
        // From declined (or anything unknown) back to no-status.
        updates.offer_status = "";
        updates.offer_made_at = null;
        updates.offer_decision_at = null;
      }
      upd(player.id, updates);
    };
    const offerChip = (player) => {
      const s = player.offer_status || "";
      let label, bg, fg, border = "none";
      // Five distinct colors — purple (locked), amber (made), green
      // (accepted), cyan (waiting), red (declined) — chosen to be readable
      // against the dark card background and not collide with any of the
      // other chips already in use (pos rank, pinny, etc.).
      if (s === "locked")        { label = "★ LOCKED";   bg = "rgba(168,85,247,0.25)";  fg = "#a855f7"; }
      else if (s === "made")     { label = "OFFER";      bg = "rgba(245,158,11,0.22)";  fg = "#f59e0b"; }
      else if (s === "accepted") { label = "✓ ACCEPTED"; bg = "rgba(34,197,94,0.22)";   fg = C.grn; }
      else if (s === "waiting")  { label = "WAITING";    bg = "rgba(6,182,212,0.22)";   fg = "#06b6d4"; }
      else if (s === "declined") { label = "✗ DECLINED"; bg = "rgba(239,68,68,0.22)";   fg = C.red; }
      else                       { label = "+ offer";    bg = "transparent";            fg = C.mut; border = "1px dashed "+C.border; }
      return <span title="Click to cycle: none → ★ locked → offer → ✓ accepted → waiting (tryouts) → ✗ declined → none"
        onClick={(e) => { e.stopPropagation(); cycleOffer(player); }}
        style={{fontSize:9,fontWeight:800,padding:"1px 6px",borderRadius:8,background:bg,color:fg,whiteSpace:"nowrap",cursor:"pointer",border,userSelect:"none"}}>{label}</span>;
    };

    // Compact rank chips next to a player's name on team cards (one per position).
    const posRankTags = (player) => (player.positions || []).map(pos => {
      const r = posRankOf(player.id, pos);
      if (r == null) return null;
      return <span key={pos} title={POS_LABELS[pos]+" rank"}
        style={{fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:8,background:"rgba(233,30,140,0.18)",color:C.gold,whiteSpace:"nowrap"}}>{pos}#{r}</span>;
    });

    return (
      <DndContext sensors={dndSensors} onDragEnd={handleDragEnd}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))",gap:14}}>
          {teams.map(team => {
            const tp = divPlayers.filter(p => p.team_assignment === team);
            const rosterMap = {}; tp.forEach(p => { if (p.roster_pos) rosterMap[p.roster_pos] = p; });
            const unslotted = tp.filter(p => !p.roster_pos);
            const offerPending  = tp.filter(p => p.offer_status === "made").length;
            const offerAccepted = tp.filter(p => p.offer_status === "accepted").length;
            const offerLocked   = tp.filter(p => p.offer_status === "locked").length;
            const offerWaiting  = tp.filter(p => p.offer_status === "waiting").length;
            return (
              <DropZone key={team} id={"team-"+team}
                style={{background:C.card,borderRadius:12,padding:"16px 18px",border:"1px solid "+C.border}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,gap:6,flexWrap:"wrap"}}>
                  <h3 style={{margin:0,fontSize:17,fontWeight:800,color:C.gold}}>{team}</h3>
                  <div style={{display:"flex",gap:4,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>
                    <Tag c={C.acc}>{tp.length} players</Tag>
                    {offerLocked   > 0 && <Tag c="#a855f7">{offerLocked} locked</Tag>}
                    {offerAccepted > 0 && <Tag c={C.grn}>{offerAccepted} accepted</Tag>}
                    {offerPending  > 0 && <Tag c="#f59e0b">{offerPending} pending</Tag>}
                    {offerWaiting  > 0 && <Tag c="#06b6d4">{offerWaiting} waiting</Tag>}
                  </div>
                </div>
                {ROSTER_GROUPS.map(grp => (
                  <div key={grp.label} style={{marginBottom:10}}>
                    <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut,marginBottom:4}}>{grp.label}</div>
                    {grp.pos.map(rp => {
                      const player = rosterMap[rp];
                      const hi = playerHighlight(player);
                      const rowBg = hi ? hi.bg : C.bg;
                      const rowBorder = player ? (hi ? "1px solid "+hi.color : "1px solid "+C.border) : "1px dashed "+C.border;
                      const labelColor = player ? (hi ? hi.color : C.gold) : C.mut;
                      const nameColor = hi ? hi.color : C.text;
                      const inner = (
                        <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 8px",marginBottom:2,background:rowBg,borderRadius:6,border:rowBorder}}>
                          <span style={{fontSize:11,fontWeight:700,color:labelColor,minWidth:36}}>{rp}</span>
                          {player ? (<>
                            <span style={{display:"flex",alignItems:"center",gap:4,fontSize:12,fontWeight:600,flex:1,cursor:"pointer",color:nameColor}} onClick={()=>setProfileId(player.id)}>
                              {isReturningDSE(player) && <span title="DS Elite returning athlete" style={{color:C.gold,fontSize:14,fontWeight:800,lineHeight:1}}>◆</span>}
                              {player.first_name} {player.last_name}
                              {hi && <span title={hi.label} style={{fontSize:8,fontWeight:800,color:hi.color,padding:"1px 5px",borderRadius:5,border:"1px solid "+hi.color,letterSpacing:0.5,marginLeft:2}}>{hi.label}</span>}
                            </span>
                            <div style={{display:"flex",gap:3,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>{offerChip(player)}{pinnyChip(player)}{posRankTags(player)}</div>
                            <span style={{fontWeight:800,fontSize:13,color:C.gold,minWidth:22,textAlign:"right"}}>{tot(player)||"—"}</span>
                          </>) : <span style={{fontSize:11,color:C.mut,fontStyle:"italic",flex:1}}>open</span>}
                        </div>
                      );
                      return <div key={rp}>{player ? <DraggablePlayer player={player}>{inner}</DraggablePlayer> : inner}</div>;
                    })}
                  </div>
                ))}
                {unslotted.length>0 && <div style={{marginTop:6}}>
                  <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.acc,marginBottom:4}}>No Roster Position</div>
                  {unslotted.map(p => {
                    const hi = playerHighlight(p);
                    const rowBg = hi ? hi.bg : C.bg;
                    const rowBorder = "1px solid " + (hi ? hi.color : "rgba(233,30,140,0.3)");
                    const nameColor = hi ? hi.color : C.text;
                    return (
                    <DraggablePlayer key={p.id} player={p}>
                      <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 8px",marginBottom:2,background:rowBg,borderRadius:6,border:rowBorder}}>
                        <span style={{display:"flex",alignItems:"center",gap:4,fontSize:12,fontWeight:600,flex:1,cursor:"pointer",color:nameColor}} onClick={()=>setProfileId(p.id)}>
                          {isReturningDSE(p) && <span title="DS Elite returning athlete" style={{color:C.gold,fontSize:14,fontWeight:800,lineHeight:1}}>◆</span>}
                          {p.first_name} {p.last_name}
                          {hi && <span title={hi.label} style={{fontSize:8,fontWeight:800,color:hi.color,padding:"1px 5px",borderRadius:5,border:"1px solid "+hi.color,letterSpacing:0.5,marginLeft:2}}>{hi.label}</span>}
                        </span>
                        <div style={{display:"flex",gap:3,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>{offerChip(p)}{pinnyChip(p)}{posRankTags(p)}</div>
                        <span style={{fontWeight:800,fontSize:13,color:C.gold,minWidth:22,textAlign:"right"}}>{tot(p)||"—"}</span>
                      </div>
                    </DraggablePlayer>
                    );
                  })}
                </div>}
                {tp.length === 0 && <div style={{textAlign:"center",padding:10,color:C.mut,fontSize:11,fontStyle:"italic"}}>Drop players here to add to {team}</div>}
              </DropZone>
            );
          })}
          {/* Unassigned drop zone with position-grouped lists and global rank inputs.
              Declined / not-invited players have their own buckets below, so we
              exclude them here to keep this column focused on players still in play. */}
          {(() => {
            const unassigned = divPlayers.filter(p => !p.team_assignment && p.offer_status !== "declined" && p.offer_status !== "not_invited");
            const groups = {}; POSITIONS.forEach(pos => { groups[pos] = []; }); groups[""] = [];
            unassigned.forEach(p => {
              const ps = p.positions || [];
              if (ps.length === 0) groups[""].push(p);
              else ps.forEach(pos => { if (groups[pos]) groups[pos].push(p); });
            });
            return (
              <DropZone id="team-" style={{background:C.card,borderRadius:12,padding:"16px 18px",border:"1px solid rgba(239,68,68,0.3)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <h3 style={{margin:0,fontSize:17,fontWeight:800,color:C.red}}>Unassigned</h3>
                  <Tag c={C.red}>{unassigned.length}</Tag>
                </div>
                <div style={{fontSize:10,color:C.mut,marginBottom:8,fontStyle:"italic"}}>Numbers are rank within position across the whole division. Drop a player here to remove from team.</div>
                <div style={{display:"flex",flexDirection:"column",gap:10,maxHeight:640,overflowY:"auto"}}>
                  {[...POSITIONS, ""].map(pos => {
                    const list = groups[pos];
                    if (list.length === 0) return null;
                    const ordered = [...list].sort((a,b) => {
                      const ra = posRankOf(a.id, pos), rb = posRankOf(b.id, pos);
                      return (ra == null ? 1e9 : ra) - (rb == null ? 1e9 : rb);
                    });
                    const totalInPos = divPlayers.filter(p => pos === "" ? (p.positions||[]).length === 0 : (p.positions||[]).includes(pos)).length;
                    const isCustom = !!(divRanks[pos] && divRanks[pos].length);
                    const label = pos === "" ? "Unspecified" : POS_LABELS[pos] + " (" + pos + ")";
                    return (
                      <div key={pos||"none"}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4,paddingBottom:3,borderBottom:"1px solid "+C.border}}>
                          <span style={{fontSize:11,fontWeight:700,textTransform:"uppercase",color:C.acc}}>{label} • {list.length} unassigned / {totalInPos} total</span>
                          {isCustom && <button onClick={()=>resetPos(pos)} style={{background:"none",border:"none",color:C.mut,fontSize:9,cursor:"pointer",textDecoration:"underline",fontFamily:"inherit"}}>reset to score order</button>}
                        </div>
                        {ordered.map(p => {
                          const rank = posRankOf(p.id, pos);
                          const hi = playerHighlight(p);
                          const rowBg = hi ? hi.bg : C.bg;
                          const rowBorder = hi ? "1px solid "+hi.color : "1px solid transparent";
                          const nameColor = hi ? hi.color : C.text;
                          return (
                            <DraggablePlayer key={p.id} player={p}>
                              <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 6px",background:rowBg,borderRadius:5,fontSize:11,marginBottom:2,border:rowBorder}}>
                                {pos !== ""
                                  ? <RankInput value={rank} max={totalInPos} onCommit={(n)=>setPosRank(p.id, pos, n)} />
                                  : <span style={{minWidth:40}} />}
                                <span style={{display:"flex",alignItems:"center",gap:4,flex:1,fontWeight:600,cursor:"pointer",color:nameColor}} onClick={()=>setProfileId(p.id)}>
                                  {isReturningDSE(p) && <span title="DS Elite returning athlete" style={{color:C.gold,fontSize:14,fontWeight:800,lineHeight:1}}>◆</span>}
                                  {p.first_name} {p.last_name}
                                  {hi && <span title={hi.label} style={{fontSize:8,fontWeight:800,color:hi.color,padding:"1px 5px",borderRadius:5,border:"1px solid "+hi.color,letterSpacing:0.5,marginLeft:2}}>{hi.label}</span>}
                                </span>
                                {pinnyChip(p)}
                                {p.projected_team && <Tag c={C.gold}>{p.projected_team}</Tag>}
                                <span title="Total points" style={{fontWeight:700,color:C.gold,minWidth:22,textAlign:"right"}}>{tot(p)||"—"}</span>
                                <span title="Average score" style={{fontWeight:600,color:C.mut,minWidth:26,textAlign:"right",fontSize:10}}>{avg(p)}</span>
                              </div>
                            </DraggablePlayer>
                          );
                        })}
                      </div>
                    );
                  })}
                  {unassigned.length === 0 && <div style={{textAlign:"center",padding:14,color:C.mut,fontSize:11}}>No unassigned players</div>}
                </div>
              </DropZone>
            );
          })()}
          {/* Declined Offer bucket — players whose families said no. */}
          {(() => {
            const declined = divPlayers.filter(p => p.offer_status === "declined");
            return (
              <DropZone id="bucket-declined" style={{background:C.card,borderRadius:12,padding:"16px 18px",border:"1px solid rgba(245,158,11,0.45)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <h3 style={{margin:0,fontSize:17,fontWeight:800,color:"#f59e0b"}}>Declined Offer</h3>
                  <Tag c="#f59e0b">{declined.length}</Tag>
                </div>
                <div style={{fontSize:10,color:C.mut,marginBottom:8,fontStyle:"italic"}}>Drop a player here when the family has declined. Drag back to a team or Unassigned to reconsider.</div>
                <div style={{display:"flex",flexDirection:"column",gap:3,maxHeight:640,overflowY:"auto"}}>
                  {declined.map(p => (
                    <DraggablePlayer key={p.id} player={p}>
                      <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 8px",background:C.bg,borderRadius:5,fontSize:11}}>
                        <span style={{display:"flex",alignItems:"center",gap:4,flex:1,fontWeight:600,cursor:"pointer"}} onClick={()=>setProfileId(p.id)}>
                          {isReturningDSE(p) && <span title="DS Elite returning athlete" style={{color:C.gold,fontSize:14,fontWeight:800,lineHeight:1}}>◆</span>}
                          {p.first_name} {p.last_name}
                        </span>
                        {offerChip(p)}
                        {pinnyChip(p)}
                        {(p.positions||[]).map(pos => <span key={pos} style={{fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:8,background:"rgba(34,197,94,0.18)",color:C.grn}}>{pos}</span>)}
                        {p.offer_decision_at && <span title="When declined" style={{fontSize:9,color:C.mut,whiteSpace:"nowrap"}}>{new Date(p.offer_decision_at).toLocaleDateString()}</span>}
                      </div>
                    </DraggablePlayer>
                  ))}
                  {declined.length === 0 && <div style={{textAlign:"center",padding:14,color:C.mut,fontSize:11}}>No declined offers</div>}
                </div>
              </DropZone>
            );
          })()}
          {/* Not Invited bucket — players the staff explicitly excluded from offers. */}
          {(() => {
            const notInvited = divPlayers.filter(p => p.offer_status === "not_invited");
            return (
              <DropZone id="bucket-not_invited" style={{background:C.card,borderRadius:12,padding:"16px 18px",border:"1px dashed "+C.border}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <h3 style={{margin:0,fontSize:17,fontWeight:800,color:C.mut}}>Not Invited</h3>
                  <Tag c={C.mut}>{notInvited.length}</Tag>
                </div>
                <div style={{fontSize:10,color:C.mut,marginBottom:8,fontStyle:"italic"}}>Drop players here who aren't being offered a spot. Drag back to a team or Unassigned to reconsider.</div>
                <div style={{display:"flex",flexDirection:"column",gap:3,maxHeight:640,overflowY:"auto"}}>
                  {notInvited.map(p => (
                    <DraggablePlayer key={p.id} player={p}>
                      <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 8px",background:C.bg,borderRadius:5,fontSize:11,opacity:0.85}}>
                        <span style={{display:"flex",alignItems:"center",gap:4,flex:1,fontWeight:600,cursor:"pointer"}} onClick={()=>setProfileId(p.id)}>
                          {isReturningDSE(p) && <span title="DS Elite returning athlete" style={{color:C.gold,fontSize:14,fontWeight:800,lineHeight:1}}>◆</span>}
                          {p.first_name} {p.last_name}
                        </span>
                        {pinnyChip(p)}
                        {(p.positions||[]).map(pos => <span key={pos} style={{fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:8,background:"rgba(34,197,94,0.18)",color:C.grn}}>{pos}</span>)}
                      </div>
                    </DraggablePlayer>
                  ))}
                  {notInvited.length === 0 && <div style={{textAlign:"center",padding:14,color:C.mut,fontSize:11}}>No players marked not invited</div>}
                </div>
              </DropZone>
            );
          })()}
        </div>
      </DndContext>
    );
  }

  // ─── RANKINGS ───
  function renderRankings() {
    const tdS = {padding:"7px 7px",fontSize:12,borderBottom:"1px solid "+C.border,verticalAlign:"middle"};
    const PROJ_ORDER = {"1":0,"1/2":1,"2":2,"2/3":3,"3":4,"":5};
    // Column definitions for the Rankings table. `get` extracts the sort value;
    // `defDir` is the direction used when first clicking that column (numeric -> desc, text -> asc).
    const COLS = [
      { key:"rank",   label:"Rank",   sortable:false },
      { key:"player", label:"Player", sortable:true,  defDir:"asc",  get:p=>((p.last_name||"")+" "+(p.first_name||"")).toLowerCase() },
      // Pinny # (stored as players.tryout_number). Numeric pinnies sort numerically;
      // blanks sort to the bottom either direction.
      { key:"pinny",  label:"Pinny",  sortable:true,  defDir:"asc",  get:p=>{ const n=parseInt(p.tryout_number); return isNaN(n)?Number.POSITIVE_INFINITY:n; } },
      { key:"age",    label:"Age",    sortable:true,  defDir:"desc", get:p=>parseInt(p.age)||0 },
      { key:"pos",    label:"Pos",    sortable:true,  defDir:"asc",  get:p=>(p.positions||[]).join(",") },
      { key:"proj",   label:"Proj",   sortable:true,  defDir:"asc",  get:p=>PROJ_ORDER[p.projected_team]??5 },
      ...SKILLS.map(sk => ({ key:"sk_"+sk, label:sk, sortable:true, defDir:"desc", get:p=>(p.scores||{})[sk]||0 })),
      { key:"total",  label:"Total",  sortable:true,  defDir:"desc", get:p=>tot(p) },
      { key:"avg",    label:"Avg",    sortable:true,  defDir:"desc", get:p=>parseFloat(avg(p))||0 },
      { key:"team",   label:"Team",   sortable:true,  defDir:"asc",  get:p=>p.team_assignment||"" },
    ];
    const activeCol = COLS.find(c => c.key === rankSort.key) || COLS.find(c => c.key === "total");
    const dirMul = rankSort.dir === "asc" ? 1 : -1;
    const cmpName = (a,b) => {
      const an = ((a.last_name||"")+(a.first_name||"")).toLowerCase();
      const bn = ((b.last_name||"")+(b.first_name||"")).toLowerCase();
      return an < bn ? -1 : an > bn ? 1 : 0;
    };
    const ranked = [...divP]
      .filter(p => tot(p) > 0)
      .filter(p => !rankDate || (p.eval_dates||[]).includes(rankDate))
      .sort((a,b) => {
        const av = activeCol.get(a), bv = activeCol.get(b);
        if (av < bv) return -1 * dirMul;
        if (av > bv) return  1 * dirMul;
        return cmpName(a,b);
      });
    const shown = filterPos ? ranked.filter(p=>(p.positions||[]).includes(filterPos)) : ranked;
    const onSort = (col) => {
      if (!col.sortable) return;
      setRankSort(prev => prev.key === col.key
        ? { key: col.key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key: col.key, dir: col.defDir });
    };
    return (
      <div>
        <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center",flexWrap:"wrap"}}>
          <span style={{fontSize:12,color:C.mut,fontWeight:600}}>Position:</span>
          <select style={{...inpStyle,padding:"7px 10px",fontSize:12,color:filterPos?C.gold:C.text}} value={filterPos} onChange={e=>setFilterPos(e.target.value)} title="Filter the ranking to a single position">
            <option value="">All positions</option>{POSITIONS.map(p=><option key={p} value={p}>{p} - {POS_LABELS[p]}</option>)}
          </select>
          <span style={{fontSize:12,color:C.mut,fontWeight:600,marginLeft:6}}>Eval date:</span>
          <select style={{...inpStyle,padding:"7px 10px",fontSize:12,color:rankDate?C.gold:C.text}} value={rankDate} onChange={e=>setRankDate(e.target.value)} title="Limit rankings to players evaluated on this date">
            <option value="">All Dates</option>{EVAL_DATES.map(d=><option key={d} value={d}>{d}</option>)}
          </select>
          <span style={{fontSize:11,color:C.mut,marginLeft:"auto"}}>{shown.length} ranked</span>
        </div>
        <div style={{background:C.card,borderRadius:12,border:"1px solid "+C.border,overflow:"hidden"}}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0}}>
              <thead><tr>{COLS.map(c => {
                const isActive = c.key === rankSort.key;
                const arrow = isActive ? (rankSort.dir === "asc" ? " ▲" : " ▼") : "";
                return <th key={c.key} onClick={()=>onSort(c)}
                  style={{padding:"8px 7px",textAlign:"left",fontSize:9,fontWeight:700,textTransform:"uppercase",color:isActive?C.gold:C.mut,borderBottom:"1px solid "+C.border,background:C.card,position:"sticky",top:0,whiteSpace:"nowrap",cursor:c.sortable?"pointer":"default",userSelect:"none"}}
                  title={c.sortable?"Click to sort":""}>{c.label}{arrow}</th>;
              })}</tr></thead>
              <tbody>{shown.map((p,i) => (
                <tr key={p.id}>
                  <td style={tdS}><span style={{fontWeight:800,fontSize:15,color:i<3?C.gold:C.mut}}>#{i+1}</span></td>
                  <td style={tdS}><span style={{display:"inline-flex",alignItems:"center",gap:5,fontWeight:700,fontSize:12,color:C.gold,cursor:"pointer"}} onClick={()=>setProfileId(p.id)}>{isReturningDSE(p) && <span title="DS Elite returning athlete" style={{color:C.gold,fontSize:14,fontWeight:800,lineHeight:1}}>◆</span>}{p.first_name} {p.last_name}</span></td>
                  <td style={tdS}><span style={{fontWeight:700,color:p.tryout_number?C.gold:C.mut}}>{p.tryout_number ? "#"+p.tryout_number : "—"}</span></td>
                  <td style={tdS}>{p.age}</td>
                  <td style={tdS}><div style={{display:"flex",gap:2,flexWrap:"wrap"}}>{(p.positions||[]).map(pos=><Tag key={pos} c={C.grn}>{pos}</Tag>)}</div></td>
                  <td style={tdS}>{p.projected_team && <Tag c={C.gold}>{p.projected_team}</Tag>}</td>
                  {SKILLS.map(sk=><td key={sk} style={tdS}><span style={{fontWeight:600,color:(p.scores||{})[sk]>=4?C.grn:(p.scores||{})[sk]>=3?C.gold:(p.scores||{})[sk]?C.red:C.mut}}>{(p.scores||{})[sk]||"—"}</span></td>)}
                  <td style={tdS}><span style={{fontWeight:800,fontSize:15,color:C.gold}}>{tot(p)}</span></td>
                  <td style={tdS}><span style={{fontWeight:600}}>{avg(p)}</span></td>
                  <td style={tdS}><Tag c={p.team_assignment?C.grn:C.mut}>{p.team_assignment||"—"}</Tag></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {!shown.length && <div style={{textAlign:"center",padding:28,color:C.mut}}>No scored players{filterPos?" at "+filterPos:""}</div>}
        </div>
      </div>
    );
  }

  // ─── PROFILE MODAL ───
  function renderProfile() {
    const p = players.find(x => x.id === profileId);
    if (!p) return null;
    const lbl = {fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut,marginBottom:4,display:"block"};
    const editInp = {...inpStyle,width:"100%",padding:"8px 10px",fontSize:13};
    const totalScore = tot(p);
    const scoredCount = Object.values(p.scores||{}).filter(v=>v>0).length;
    return (
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:1000,display:"flex",justifyContent:"center",padding:"30px 16px",overflowY:"auto"}} onClick={()=>setProfileId(null)}>
        <div style={{background:C.card,borderRadius:16,border:"1px solid "+C.border,maxWidth:700,width:"100%",maxHeight:"90vh",overflowY:"auto",padding:24}} onClick={e=>e.stopPropagation()}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}>
            <div>
              <h2 style={{margin:0,fontSize:22,fontWeight:800,color:C.gold,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                {isReturningDSE(p) && <span title="DS Elite returning athlete" style={{color:C.gold,fontSize:14,fontWeight:800,lineHeight:1}}>◆</span>}
                {p.first_name} {p.last_name}
              </h2>
              <div style={{display:"flex",gap:5,marginTop:6,flexWrap:"wrap"}}>
                <Tag c={C.gold}>USAV: {p.usavDiv||p.usav_div}</Tag><Tag c={C.acc}>Reg: {p.reg_group}</Tag><Tag c={C.mut}>Age {p.age}</Tag>
                {(p.positions||[]).map(pos=><Tag key={pos} c={C.grn}>{pos}</Tag>)}
                {p.supplemental===1 && <Tag c={C.acc}>SUPPLEMENTAL</Tag>}
              </div>
            </div>
            <button style={{background:"none",border:"none",color:C.mut,fontSize:24,cursor:"pointer"}} onClick={()=>setProfileId(null)}>✕</button>
          </div>
          {/* Score Summary */}
          <div style={{background:totalScore>0?"linear-gradient(135deg,rgba(233,30,140,0.15),rgba(34,197,94,0.1))":C.bg,borderRadius:12,padding:"14px 18px",marginBottom:16,border:"1px solid "+(totalScore>0?C.gold:C.border)}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div><div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut}} title="Sum of stat-skill scores (Blocking excluded)">Total</div><div style={{fontSize:36,fontWeight:800,color:totalScore>0?C.gold:C.mut}}>{totalScore||0}<span style={{fontSize:16,fontWeight:400,color:C.mut}}>/40</span></div></div>
              <div style={{textAlign:"center"}}><div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut}}>Avg</div><div style={{fontSize:28,fontWeight:800,color:totalScore>0?C.grn:C.mut}}>{avg(p)}</div></div>
              <div style={{textAlign:"right"}}><div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut}}>Scored</div><div style={{fontSize:28,fontWeight:800,color:scoredCount===9?C.grn:C.gold}}>{scoredCount}<span style={{fontSize:16,fontWeight:400,color:C.mut}}>/9</span></div></div>
            </div>
          </div>
          {/* Scores */}
          <div style={{marginBottom:14}}>
            <span style={lbl}>Evaluation Scores (tap 1-5)</span>
            <div style={{background:C.bg,borderRadius:10,padding:14}}>
              {SKILLS.map(sk => {
                const cur = (p.scores&&p.scores[sk])||0;
                return <div key={sk} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid "+C.border}}>
                  <span style={{fontSize:13,fontWeight:600,minWidth:120}}>{sk}</span>
                  <div style={{display:"flex",gap:4}}>{[1,2,3,4,5].map(v => {
                    const active=cur===v;
                    return <button key={v} style={{width:36,height:34,borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:14,fontWeight:700,border:active?"2px solid "+C.gold:"1px solid "+C.border,
                      background:active?(v>=4?"rgba(34,197,94,0.2)":v>=3?"rgba(233,30,140,0.2)":"rgba(239,68,68,0.15)"):"transparent",
                      color:active?(v>=4?C.grn:v>=3?C.gold:C.red):C.mut}} onClick={()=>{
                        const ns={...(p.scores||{})}; ns[sk]=cur===v?0:v;
                        // (Score entry NO LONGER auto-flips eval_registered —
                        // tryout warm-ups are scored too, so scoring isn't a
                        // reliable signal of eval-roster membership. Use the
                        // profile-card toggle or upload an eval CSV instead.)
                        upd(p.id, {scores:ns});
                      }}>{v}</button>;
                  })}</div>
                </div>;
              })}
            </div>
          </div>
          {/* Positions */}
          <div style={{marginBottom:14}}>
            <span style={lbl}>Positions</span>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{POSITIONS.map(pos => {
              const active = (p.positions||[]).includes(pos);
              return <button key={pos} style={{padding:"8px 16px",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer",border:active?"2px solid "+C.gold:"1px solid "+C.border,background:active?"rgba(233,30,140,0.15)":"transparent",color:active?C.gold:C.mut}}
                onClick={()=>{const next=active?(p.positions||[]).filter(x=>x!==pos):[...(p.positions||[]),pos]; upd(p.id,{positions:next});}}>{pos} - {POS_LABELS[pos]}</button>;
            })}</div>
          </div>
          {/* Division/Team/Roster/Prev/Status */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:12,marginBottom:14}}>
            <div><span style={lbl}>Pinny #</span><DebouncedField style={editInp} placeholder="e.g. 12" value={p.tryout_number||""} onCommit={v=>upd(p.id,{tryout_number:v})} /></div>
            <div>
              <span style={lbl}>USAV Div</span>
              <select style={editInp} value={p.usavDiv||p.usav_div||""}
                onChange={e=>{
                  const v = e.target.value;
                  if (v !== (p.usavDiv||p.usav_div) && (p.team_assignment || p.roster_pos)) {
                    if (!window.confirm("Change division to "+v+"? This will clear her team assignment and roster position.")) return;
                  }
                  upd(p.id, { usav_div: v, usavDiv: v, team_assignment: "", roster_pos: "" });
                }}>
                {DIVS.map(d=><option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div><span style={lbl}>Projected</span><select style={editInp} value={p.projected_team||""} onChange={e=>upd(p.id,{projected_team:e.target.value})}>{PROJ_OPTS.map(o=><option key={o} value={o}>{o||"--"}</option>)}</select></div>
            <div><span style={lbl}>Team</span><select style={editInp} value={p.team_assignment||""} onChange={e=>upd(p.id,{team_assignment:e.target.value,roster_pos:""})}><option value="">--</option>{(TM[p.usavDiv||p.usav_div]||[]).map(t=><option key={t} value={t}>{t}</option>)}</select></div>
            <div><span style={lbl}>Roster Pos</span><select style={editInp} value={p.roster_pos||""} onChange={e=>upd(p.id,{roster_pos:e.target.value})}><option value="">--</option>{ROSTER_POS.map(rp=>{const taken=players.some(o=>o.id!==p.id&&o.team_assignment===p.team_assignment&&o.roster_pos===rp);return <option key={rp} value={rp} disabled={taken}>{rp}{taken?" (taken)":""}</option>;})}</select></div>
            <div><span style={lbl}>Status</span><select style={{...editInp,color:STATUS_COLORS[p.status||"In Progress"]}} value={p.status||"In Progress"} onChange={e=>upd(p.id,{status:e.target.value})}>{STATUS_OPTS.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
            <div><span style={lbl}>Prev Season Team</span><DebouncedField style={editInp} placeholder="e.g. DSE 13 Diamond" value={p.current_team||""} onCommit={v=>upd(p.id,{current_team:v})} /></div>
          </div>
          {/* Notes */}
          <div style={{marginBottom:14}}><span style={lbl}>Coach Notes</span><DebouncedField multiline style={{...editInp,minHeight:70,resize:"vertical"}} placeholder="Notes..." value={p.notes||""} onCommit={v=>upd(p.id,{notes:v})} /></div>
          <div style={{marginBottom:14}}><span style={lbl}>Parent Feedback Session Notes</span><DebouncedField multiline style={{...editInp,minHeight:70,resize:"vertical"}} placeholder="Notes from the parent feedback conversation..." value={p.parent_feedback_notes||""} onCommit={v=>upd(p.id,{parent_feedback_notes:v})} /></div>
          {/* Eval Dates */}
          <div style={{marginBottom:14}}>
            <span style={lbl}>Eval Sessions</span>
            <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{EVAL_DATES.map(d => {
              const active = (p.eval_dates||[]).includes(d);
              return <button key={d} style={{padding:"6px 12px",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer",border:active?"2px solid "+C.gold:"1px solid "+C.border,background:active?"rgba(233,30,140,0.2)":"transparent",color:active?C.gold:C.mut}}
                onClick={()=>{
                  const next=active?(p.eval_dates||[]).filter(x=>x!==d):[...(p.eval_dates||[]),d];
                  // (No auto-flag of eval_registered here either — see the
                  // scores onClick above for the same reasoning.)
                  upd(p.id, {eval_dates:next});
                }}>{d}</button>;
            })}</div>
          </div>
          {/* National Team ID Clinic (U13–U17 only) */}
          {CLINIC_DIVS.includes(p.usavDiv || p.usav_div) && (
            <div style={{marginBottom:14}}>
              <span style={lbl}>National Team ID Clinic</span>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <button onClick={()=>upd(p.id,{id_clinic_invited:!p.id_clinic_invited})}
                  style={{padding:"8px 16px",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",border:p.id_clinic_invited?"2px solid "+C.gold:"1px solid "+C.border,background:p.id_clinic_invited?"rgba(233,30,140,0.15)":"transparent",color:p.id_clinic_invited?C.gold:C.mut}}>
                  {p.id_clinic_invited ? "✓ Invited" : "Mark Invited"}
                </button>
                <button onClick={()=>upd(p.id,{id_clinic_attended:!p.id_clinic_attended})}
                  style={{padding:"8px 16px",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",border:p.id_clinic_attended?"2px solid "+C.grn:"1px solid "+C.border,background:p.id_clinic_attended?"rgba(34,197,94,0.15)":"transparent",color:p.id_clinic_attended?C.grn:C.mut}}>
                  {p.id_clinic_attended ? "✓ Attended" : "Mark Attended"}
                </button>
              </div>
              {/* Date-specific clinic attendance — the Evaluate tab has a
                  matching filter so coaches can pull up "who came to 6/2"
                  in one click. */}
              <div style={{marginTop:8,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                <span style={{fontSize:10,fontWeight:700,color:C.mut,textTransform:"uppercase",letterSpacing:0.5,marginRight:4}}>Date attended:</span>
                {CLINIC_DATES.map(d => {
                  const active = (p.clinic_dates||[]).includes(d);
                  return <button key={d}
                    onClick={()=>{ const next = active ? (p.clinic_dates||[]).filter(x=>x!==d) : [...(p.clinic_dates||[]),d]; upd(p.id,{clinic_dates:next}); }}
                    style={{padding:"6px 12px",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",border:active?"2px solid "+C.gold:"1px solid "+C.border,background:active?"rgba(233,30,140,0.2)":"transparent",color:active?C.gold:C.mut}}>
                    {d}
                  </button>;
                })}
              </div>
            </div>
          )}
          {/* Registration Info */}
          <div style={{background:C.bg,borderRadius:10,padding:14}}>
            <div style={{fontSize:11,fontWeight:700,color:C.gold,marginBottom:10}}>REGISTRATION INFO & INTAKE</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:10}}>
              <div><span style={lbl}>Parent Name</span><DebouncedField style={editInp} placeholder="Parent name" value={p.parent_name||""} onCommit={v=>upd(p.id,{parent_name:v})} /></div>
              <div><span style={lbl}>Parent Email</span><DebouncedField type="email" style={editInp} placeholder="email@example.com" value={p.parent_email||""} onCommit={v=>upd(p.id,{parent_email:v})} /></div>
              <div><span style={lbl}>Parent Phone</span><DebouncedField style={editInp} placeholder="555-555-5555" value={p.parent_phone||""} onCommit={v=>upd(p.id,{parent_phone:v})} /></div>
              <div><span style={lbl}>Player Email</span><DebouncedField type="email" style={editInp} placeholder="player@example.com" value={p.player_email||""} onCommit={v=>upd(p.id,{player_email:v})} /></div>
              <div><span style={lbl}>Player Phone</span><DebouncedField style={editInp} placeholder="555-555-5555" value={p.player_phone||""} onCommit={v=>upd(p.id,{player_phone:v})} /></div>
              <div><span style={lbl}>DOB</span><DebouncedField type="date" style={editInp} value={p.dob||""} onCommit={v=>upd(p.id,{dob:v})} /></div>
            </div>
            {/* Address + intake answers from the Upper Hand tryout export. */}
            <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr",gap:10,marginBottom:10}}>
              <div><span style={lbl}>Address</span><DebouncedField style={editInp} placeholder="123 Main St" value={p.address_line1||""} onCommit={v=>upd(p.id,{address_line1:v})} /></div>
              <div><span style={lbl}>City</span><DebouncedField style={editInp} placeholder="City" value={p.city||""} onCommit={v=>upd(p.id,{city:v})} /></div>
              <div><span style={lbl}>State</span><DebouncedField style={editInp} placeholder="TX" value={p.state||""} onCommit={v=>upd(p.id,{state:v})} /></div>
              <div><span style={lbl}>Zip</span><DebouncedField style={editInp} placeholder="78620" value={p.zip||""} onCommit={v=>upd(p.id,{zip:v})} /></div>
            </div>
            {/* Tryout Intake answers — full question phrasing so the card
                reads the same as the Upper Hand registration form. All
                editable inline; CSV imports merge into these. */}
            <div style={{borderTop:"1px solid "+C.border,paddingTop:10,marginBottom:10}}>
              <div style={{fontSize:10,fontWeight:700,color:C.gold,letterSpacing:0.5,marginBottom:8}}>TRYOUT INTAKE</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                <div>
                  <span style={lbl}>Primary Position</span>
                  <DebouncedField style={editInp} placeholder="e.g. Setter" value={p.primary_position||""} onCommit={v=>upd(p.id,{primary_position:v})} />
                </div>
                <div>
                  <span style={lbl}>Secondary Position</span>
                  <DebouncedField style={editInp} placeholder="e.g. Pin" value={p.secondary_position||""} onCommit={v=>upd(p.id,{secondary_position:v})} />
                </div>
              </div>
              <div style={{marginBottom:10}}>
                <span style={lbl}>What club and team were you on for the 2025–2026 season?</span>
                <DebouncedField style={editInp} placeholder="e.g. DS Elite 14 Diamond" value={p.current_team||""} onCommit={v=>upd(p.id,{current_team:v})} />
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                <div>
                  <span style={lbl}>What is your dominant hand?</span>
                  <select style={editInp} value={p.dominant_hand||""} onChange={e=>upd(p.id,{dominant_hand:e.target.value})}>
                    <option value="">--</option>
                    <option value="Right">Right</option>
                    <option value="Left">Left</option>
                    <option value="Ambidextrous">Ambidextrous</option>
                  </select>
                </div>
                <div>
                  <span style={lbl}>What School and School Team were you on for the 2025 season?</span>
                  <DebouncedField style={editInp} placeholder="e.g. Dripping Springs MS, B team" value={p.school_team||""} onCommit={v=>upd(p.id,{school_team:v})} />
                </div>
              </div>
              <div style={{marginBottom:4}}>
                <span style={lbl}>Do you play any other sports? Which, and what season?</span>
                <DebouncedField multiline style={{...editInp,minHeight:42,resize:"vertical"}} placeholder="e.g. Soccer (fall), Track (spring)" value={p.other_sports||""} onCommit={v=>upd(p.id,{other_sports:v})} />
              </div>
            </div>
            {[["Position / Experience",p.reg_position],["Strengths / Improvement",p.strength_weakness],["Ideal Coach",p.ideal_coach],["Goals",p.goal],["Starter Preference",p.starter_pref]].map(([label,val])=>
              val && val!=="na" && <div key={label} style={{marginBottom:10,borderTop:"1px solid "+C.border,paddingTop:8}}><span style={lbl}>{label}</span><div style={{fontSize:13,lineHeight:1.5}}>{val}</div></div>
            )}
            {p.leaving_reason && <div style={{marginBottom:10,borderTop:"1px solid "+C.border,paddingTop:8}}><span style={lbl}>Why leaving previous club?</span><div style={{fontSize:13,lineHeight:1.5}}>{p.leaving_reason}</div></div>}
            {p.min_level && <div><span style={lbl}>Min Level</span><div style={{fontSize:13}}>{p.min_level}</div></div>}
          </div>
          {/* Tryout Toggle */}
          <div style={{display:"flex",alignItems:"center",gap:10,marginTop:16,padding:"12px 16px",background:p.supplemental===1?"rgba(233,30,140,0.1)":C.bg,borderRadius:10,border:"1px solid "+(p.supplemental===1?C.acc:C.border),cursor:"pointer"}} onClick={()=>upd(p.id,{supplemental:p.supplemental===1?0:1})}>
            <input type="checkbox" checked={p.supplemental===1} readOnly style={{width:20,height:20,accentColor:"#ff69b4",cursor:"pointer"}} />
            <span style={{fontSize:14,fontWeight:700,color:p.supplemental===1?C.acc:C.mut}}>{p.supplemental===1?"Using Evaluation as Tryout ✓":"Mark as Using Evaluation for Tryout"}</span>
          </div>
          {/* Feedback Session Complete */}
          <div style={{display:"flex",alignItems:"center",gap:10,marginTop:8,padding:"12px 16px",background:p.feedback_session_complete?"rgba(34,197,94,0.1)":C.bg,borderRadius:10,border:"1px solid "+(p.feedback_session_complete?C.grn:C.border),cursor:"pointer"}} onClick={()=>upd(p.id,{feedback_session_complete:!p.feedback_session_complete})}>
            <input type="checkbox" checked={!!p.feedback_session_complete} readOnly style={{width:20,height:20,accentColor:C.gold,cursor:"pointer"}} />
            <span style={{fontSize:14,fontWeight:700,color:p.feedback_session_complete?C.grn:C.mut}}>{p.feedback_session_complete?"Feedback Session Completed ✓":"Mark Feedback Session Completed"}</span>
          </div>
          {/* Registration flags — flipped automatically when the matching
              CSV (eval / tryout) imports this player, editable here for
              manual cases. Two independent flags because a player can
              register for one, both, or neither. */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:8}}>
            <div onClick={()=>upd(p.id,{eval_registered:!p.eval_registered})}
              style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",background:p.eval_registered?"rgba(6,182,212,0.10)":C.bg,borderRadius:10,border:"1px solid "+(p.eval_registered?"#06b6d4":C.border),cursor:"pointer"}}>
              <input type="checkbox" checked={!!p.eval_registered} readOnly style={{width:18,height:18,accentColor:"#06b6d4",cursor:"pointer"}} />
              <span style={{fontSize:13,fontWeight:700,color:p.eval_registered?"#06b6d4":C.mut}}>{p.eval_registered?"Signed up for evaluation ✓":"Not on eval roster"}</span>
            </div>
            <div onClick={()=>upd(p.id,{tryout_registered:!p.tryout_registered})}
              style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",background:p.tryout_registered?"rgba(34,197,94,0.1)":C.bg,borderRadius:10,border:"1px solid "+(p.tryout_registered?C.grn:C.border),cursor:"pointer"}}>
              <input type="checkbox" checked={!!p.tryout_registered} readOnly style={{width:18,height:18,accentColor:C.grn,cursor:"pointer"}} />
              <span style={{fontSize:13,fontWeight:700,color:p.tryout_registered?C.grn:C.mut}}>{p.tryout_registered?"Signed up for tryout ✓":"Not on tryout roster"}</span>
            </div>
          </div>
          {/* Team Onboarding Tracker — same four flags shown on the Tracker tab.
              Visible here so a coach can flip them straight from the profile too. */}
          <div style={{marginTop:14,padding:"12px 14px",background:C.bg,borderRadius:10,border:"1px solid "+C.border}}>
            <div style={{fontSize:11,fontWeight:700,color:C.gold,marginBottom:8,letterSpacing:0.5}}>TEAM ONBOARDING</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:8}}>
              {[
                ["sportsengine_registered","SportsEngine Registration"],
                ["sportsyou_registered","SportsYou Registration"],
                ["lonestar_member","Lone Star Membership"],
                ["jersey_tryout_complete","Jersey Tryout Complete"],
              ].map(([key,label]) => {
                const on = !!p[key];
                return (
                  <div key={key} onClick={()=>upd(p.id,{[key]:!on})}
                    style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",background:on?"rgba(34,197,94,0.1)":"transparent",borderRadius:8,border:"1px solid "+(on?C.grn:C.border),cursor:"pointer"}}>
                    <input type="checkbox" checked={on} readOnly style={{width:16,height:16,accentColor:C.gold,cursor:"pointer"}} />
                    <span style={{fontSize:12,fontWeight:700,color:on?C.grn:C.mut}}>{label}{on?" ✓":""}</span>
                  </div>
                );
              })}
            </div>
          </div>
          {/* Mark Complete */}
          <div style={{display:"flex",alignItems:"center",gap:10,marginTop:8,padding:"12px 16px",background:p.eval_complete?"rgba(34,197,94,0.1)":C.bg,borderRadius:10,border:"1px solid "+(p.eval_complete?C.grn:C.border),cursor:"pointer"}} onClick={()=>upd(p.id,{eval_complete:!p.eval_complete})}>
            <input type="checkbox" checked={!!p.eval_complete} readOnly style={{width:20,height:20,accentColor:C.gold,cursor:"pointer"}} />
            <span style={{fontSize:14,fontWeight:700,color:p.eval_complete?C.grn:C.mut}}>{p.eval_complete?"Evaluation Complete ✓":"Mark Evaluation Complete"}</span>
          </div>
          {/* AI parent-facing summary. Calls /api/summarize-player which proxies Anthropic. */}
          <div style={{marginTop:16,padding:"14px 16px",background:C.bg,borderRadius:10,border:"1px solid "+C.border}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
              <div>
                <div style={{fontSize:12,fontWeight:700,color:C.gold,letterSpacing:0.5}}>AI PARENT SUMMARY</div>
                <div style={{fontSize:11,color:C.mut,marginTop:2}}>Generates a warm, parent-facing recap you can paste into an email or use as call talking points.</div>
                {aiSavedAt && aiResult && (
                  <div style={{fontSize:10,color:C.mut,marginTop:4,fontStyle:"italic"}}>
                    Saved · last generated {new Date(aiSavedAt).toLocaleString()}
                  </div>
                )}
              </div>
              <button
                disabled={aiBusy}
                onClick={async () => {
                  setAiBusy(true); setAiError(""); setAiResult(""); setAiCopied(false); setAiInstruction("");
                  try {
                    const res = await fetch("/api/summarize-player", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ player: buildPlayerPayload(p, players) }),
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(data.error || ("Request failed (" + res.status + ")"));
                    const summary = data.summary || "";
                    setAiResult(summary);
                    // Persist so the summary survives closing the profile / refresh.
                    if (summary) {
                      const now = new Date().toISOString();
                      setAiSavedAt(now);
                      upd(p.id, { parent_summary: summary, parent_summary_updated_at: now });
                    }
                  } catch (e) {
                    setAiError(e.message || "Generation failed");
                  } finally {
                    setAiBusy(false);
                  }
                }}
                style={{padding:"8px 14px",borderRadius:8,border:"none",background:aiBusy?C.border:C.gold,color:aiBusy?C.mut:"#000",fontFamily:"inherit",fontSize:12,fontWeight:700,cursor:aiBusy?"default":"pointer"}}>
                {aiBusy ? "Writing..." : (aiResult ? "Regenerate" : "Generate Summary")}
              </button>
            </div>
            {aiError && <div style={{marginTop:10,fontSize:12,color:C.red,whiteSpace:"pre-wrap"}}>{aiError}</div>}
            {aiResult && (
              <div style={{marginTop:12}}>
                <div style={{background:"#0a0a0a",border:"1px solid "+C.border,borderRadius:8,padding:"12px 14px",fontSize:13,lineHeight:1.55,whiteSpace:"pre-wrap",color:C.text}}>{aiResult}</div>
                <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:8}}>
                  <button onClick={() => {
                      if (!window.confirm("Clear the saved parent summary for this player?")) return;
                      setAiResult(""); setAiSavedAt(null); setAiInstruction(""); setAiError("");
                      upd(p.id, { parent_summary: "", parent_summary_updated_at: null });
                    }}
                    style={{padding:"6px 12px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                    Clear saved
                  </button>
                  <button onClick={() => { navigator.clipboard.writeText(aiResult).then(()=>{ setAiCopied(true); setTimeout(()=>setAiCopied(false), 2000); }); }}
                    style={{padding:"6px 12px",borderRadius:6,border:"1px solid "+C.gold,background:"transparent",color:C.gold,fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                    {aiCopied ? "Copied ✓" : "Copy to clipboard"}
                  </button>
                </div>
                {/* Refine: lets the coach iterate on the generated summary with a follow-up
                    instruction. Sends previous_summary + instruction to /api/summarize-player. */}
                <div style={{marginTop:14,paddingTop:12,borderTop:"1px dashed "+C.border}}>
                  <div style={{fontSize:11,fontWeight:700,color:C.mut,letterSpacing:0.5,marginBottom:6}}>REFINE THIS SUMMARY</div>
                  <textarea
                    value={aiInstruction}
                    onChange={e=>setAiInstruction(e.target.value)}
                    placeholder='e.g. "Make it shorter", "Mention her serving more", "Warmer tone, less formal"'
                    disabled={aiBusy}
                    style={{...editInp,minHeight:54,resize:"vertical",fontSize:12}} />
                  <div style={{display:"flex",justifyContent:"flex-end",marginTop:8}}>
                    <button
                      disabled={aiBusy || !aiInstruction.trim()}
                      onClick={async () => {
                        const instruction = aiInstruction.trim();
                        if (!instruction || !aiResult) return;
                        const previous = aiResult;
                        setAiBusy(true); setAiError(""); setAiCopied(false);
                        try {
                          const res = await fetch("/api/summarize-player", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              player: buildPlayerPayload(p, players),
                              previous_summary: previous,
                              instruction,
                            }),
                          });
                          const data = await res.json().catch(() => ({}));
                          if (!res.ok) throw new Error(data.error || ("Request failed (" + res.status + ")"));
                          const summary = data.summary || "";
                          setAiResult(summary);
                          setAiInstruction("");
                          if (summary) {
                            const now = new Date().toISOString();
                            setAiSavedAt(now);
                            upd(p.id, { parent_summary: summary, parent_summary_updated_at: now });
                          }
                        } catch (e) {
                          setAiError(e.message || "Refinement failed");
                        } finally {
                          setAiBusy(false);
                        }
                      }}
                      style={{padding:"8px 14px",borderRadius:8,border:"none",background:(aiBusy||!aiInstruction.trim())?C.border:C.gold,color:(aiBusy||!aiInstruction.trim())?C.mut:"#000",fontFamily:"inherit",fontSize:12,fontWeight:700,cursor:(aiBusy||!aiInstruction.trim())?"default":"pointer"}}>
                      {aiBusy ? "Refining..." : "Refine Summary"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          {/* Danger zone — delete player. Two-step confirmation guards against mis-clicks. */}
          <div style={{marginTop:24,paddingTop:16,borderTop:"1px solid "+C.border}}>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.red,marginBottom:8,letterSpacing:0.5}}>Danger Zone</div>
            <button
              onClick={async () => {
                const name = (p.first_name || "") + " " + (p.last_name || "");
                if (!window.confirm("Delete " + name.trim() + " permanently? This cannot be undone.")) return;
                if (!window.confirm("Are you sure? All scores, notes, and team assignments for " + name.trim() + " will be lost.")) return;
                const { error } = await supabase.from("players").delete().eq("id", p.id);
                if (error) { window.alert("Delete failed: " + error.message); return; }
                setProfileId(null);
                await loadPlayers();
              }}
              style={{padding:"10px 16px",borderRadius:8,border:"1px solid "+C.red,background:"transparent",color:C.red,fontFamily:"inherit",fontSize:13,fontWeight:700,cursor:"pointer"}}>
              Delete Player
            </button>
            <div style={{fontSize:11,color:C.mut,marginTop:6}}>Removes this player and all their evaluation data from the database. You'll be asked to confirm twice.</div>
          </div>
        </div>
      </div>
    );
  }

  // ─── COACHES (USER MANAGEMENT) ────────────────────────────────────────
  // Admin-only. Lists every signed-up coach with controls to approve, mark
  // admin, edit display name, and remove. The first signup is auto-approved
  // as admin; all subsequent coaches land here awaiting approval.
  //
  // loadCoaches / loadActivity hooks live at the top of the component (above
  // the auth gates) so the hook-call order is stable across renders. The
  // render and mutation helpers stay here next to their renderXxx fn.

  // Bulk-add: accepts a textarea full of emails separated by any combination
  // of whitespace, commas, semicolons. Lowercases, dedupes, skips invalid.
  const addAllowedEmails = async (raw) => {
    const parts = (raw || "")
      .split(/[\s,;]+/)
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
      .filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
    if (!parts.length) { window.alert("No valid email addresses found in that input."); return; }
    const unique = [...new Set(parts)];
    const rows = unique.map(email => ({
      email,
      added_by: coach.id,
      added_by_name: coach.display_name || coach.email,
      note: null,
    }));
    const { error } = await supabase.from("allowed_signup_emails").upsert(rows, { onConflict: "email" });
    if (error) { window.alert("Add failed: " + error.message); return; }
    setBulkAllowedInput("");
    loadAllowedEmails();
  };
  const removeAllowedEmail = async (email) => {
    if (!window.confirm("Remove " + email + " from the signup allowlist?")) return;
    const { error } = await supabase.from("allowed_signup_emails").delete().eq("email", email);
    if (error) { window.alert("Remove failed: " + error.message); return; }
    loadAllowedEmails();
  };

  const updateCoach = async (id, patch) => {
    // Optimistic local update
    setCoachesList(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
    const { error } = await supabase.from("coaches").update(patch).eq("id", id);
    if (error) { window.alert("Update failed: " + error.message); loadCoaches(); }
    if (id === coach.id) {
      setCoach(prev => prev ? { ...prev, ...patch } : prev);
    }
  };
  const removeCoach = async (target) => {
    if (target.id === coach.id) { window.alert("You can't remove your own account from here. Use Sign Out instead."); return; }
    if (!window.confirm("Remove "+(target.display_name||target.email)+" from the coaches list? Their login still exists in Supabase Auth until you delete it there, but they will no longer be able to access the app.")) return;
    const { error } = await supabase.from("coaches").delete().eq("id", target.id);
    if (error) { window.alert("Remove failed: " + error.message); return; }
    loadCoaches();
  };

  function renderCoaches() {
    if (!isAdmin) {
      return <div style={{padding:24,color:C.mut,textAlign:"center"}}>Coach management is admin-only.</div>;
    }
    const th = {padding:"8px 10px",textAlign:"left",fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut,borderBottom:"1px solid "+C.border,background:C.card,whiteSpace:"nowrap"};
    const td = {padding:"8px 10px",fontSize:12,borderBottom:"1px solid "+C.border,verticalAlign:"middle"};
    const pending = coachesList.filter(c => !c.is_approved);
    return (
      <div>
        {/* Signup allowlist — only emails in this list are permitted to create
            an account. Enforced both server-side (handle_new_user trigger) and
            client-side (is_signup_allowed RPC before the signUp call). */}
        <div style={{background:C.card,borderRadius:12,border:"1px solid "+C.border,padding:"16px 18px",marginBottom:18}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,flexWrap:"wrap",gap:8}}>
            <div>
              <h3 style={{margin:0,fontSize:14,fontWeight:800,color:C.gold,letterSpacing:0.5}}>ALLOWED SIGNUP EMAILS</h3>
              <div style={{fontSize:11,color:C.mut,marginTop:2}}>Coaches with emails on this list are auto-approved on signup (no waiting). Anyone else can still sign up but lands on the "Awaiting Approval" screen until you approve them below. {allowedEmails.length} on the list.</div>
            </div>
            <button onClick={loadAllowedEmails} disabled={allowedLoading}
              style={{padding:"4px 10px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
              {allowedLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
          <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap",alignItems:"flex-start"}}>
            <textarea value={bulkAllowedInput} onChange={e=>setBulkAllowedInput(e.target.value)}
              placeholder="Paste one or more emails — separated by commas, spaces, or new lines"
              rows={2}
              style={{...inpStyle,flex:"1 1 320px",minHeight:54,padding:"8px 10px",fontSize:12,fontFamily:"inherit",resize:"vertical"}} />
            <button onClick={()=>addAllowedEmails(bulkAllowedInput)} disabled={!bulkAllowedInput.trim()}
              style={{padding:"10px 16px",borderRadius:8,border:"none",background:bulkAllowedInput.trim()?C.gold:C.border,color:bulkAllowedInput.trim()?"#000":C.mut,fontFamily:"inherit",fontSize:12,fontWeight:700,cursor:bulkAllowedInput.trim()?"pointer":"default",alignSelf:"stretch"}}>
              Add
            </button>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,maxHeight:200,overflowY:"auto"}}>
            {allowedEmails.map(row => {
              const hasAccount = coachesList.some(c => (c.email||"").toLowerCase() === row.email.toLowerCase());
              return (
                <span key={row.email}
                  title={(row.added_by_name ? "Added by "+row.added_by_name+" · " : "") + (row.added_at ? new Date(row.added_at).toLocaleDateString() : "") + (hasAccount ? " · signed up" : "")}
                  style={{display:"inline-flex",alignItems:"center",gap:6,padding:"4px 6px 4px 10px",borderRadius:20,background:C.bg,border:"1px solid "+(hasAccount?C.grn:C.border),fontSize:11,color:hasAccount?C.grn:C.text}}>
                  {row.email}
                  <button onClick={()=>removeAllowedEmail(row.email)} title="Remove from allowlist"
                    style={{width:18,height:18,borderRadius:9,border:"none",background:"transparent",color:C.mut,cursor:"pointer",fontFamily:"inherit",fontSize:13,lineHeight:1,padding:0}}>×</button>
                </span>
              );
            })}
            {!allowedEmails.length && <div style={{fontSize:11,color:C.mut,fontStyle:"italic",padding:"8px 0"}}>{allowedLoading ? "Loading…" : "No emails on the allowlist yet."}</div>}
          </div>
          <div style={{fontSize:10,color:C.mut,marginTop:8,lineHeight:1.5}}>
            Green chips have already signed up and appear in the Coaches list below. Removing an email here does not delete an existing account — use the Coaches list for that.
          </div>
        </div>

        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8}}>
          <div>
            <h2 style={{margin:0,fontSize:18,fontWeight:800,color:C.gold}}>Coaches</h2>
            <div style={{fontSize:11,color:C.mut,marginTop:2}}>{coachesList.length} total · {pending.length} awaiting approval</div>
          </div>
          <button onClick={loadCoaches} disabled={coachesLoading}
            style={{padding:"6px 12px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
            {coachesLoading ? "Loading…" : "Refresh"}
          </button>
        </div>
        {pending.length > 0 && (
          <div style={{background:"rgba(245,158,11,0.08)",border:"1px solid rgba(245,158,11,0.35)",borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:12,color:"#f59e0b"}}>
            {pending.length} coach{pending.length===1?" is":"es are"} waiting to be approved.
          </div>
        )}
        <div style={{background:C.card,borderRadius:12,border:"1px solid "+C.border,overflow:"hidden"}}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0}}>
              <thead><tr>
                <th style={th}>Display Name</th>
                <th style={th}>Email</th>
                <th style={th}>Approved</th>
                <th style={th}>Admin</th>
                <th style={th}>Last seen</th>
                <th style={th}>Joined</th>
                <th style={th}></th>
              </tr></thead>
              <tbody>
                {coachesList.map(c => {
                  const isSelf = c.id === coach.id;
                  return (
                    <tr key={c.id} style={{background: c.is_approved ? "transparent" : "rgba(245,158,11,0.05)"}}>
                      <td style={td}>
                        <DebouncedField style={{...inpStyle,padding:"5px 8px",fontSize:12,width:"100%",minWidth:120}}
                          value={c.display_name||""}
                          onCommit={v => updateCoach(c.id, { display_name: v })}
                          placeholder="(no name)" />
                      </td>
                      <td style={{...td,color:C.mut}}>{c.email}{isSelf && <span style={{color:C.gold,marginLeft:6,fontSize:10}}>(you)</span>}</td>
                      <td style={td}>
                        <label style={{display:"inline-flex",alignItems:"center",gap:6,cursor:isSelf?"default":"pointer"}}>
                          <input type="checkbox" checked={!!c.is_approved} disabled={isSelf}
                            onChange={e => updateCoach(c.id, { is_approved: e.target.checked })}
                            style={{width:16,height:16,accentColor:C.grn,cursor:isSelf?"default":"pointer"}} />
                          <span style={{fontSize:11,color:c.is_approved?C.grn:C.mut,fontWeight:600}}>{c.is_approved?"Yes":"No"}</span>
                        </label>
                      </td>
                      <td style={td}>
                        <label style={{display:"inline-flex",alignItems:"center",gap:6,cursor:isSelf?"default":"pointer"}}>
                          <input type="checkbox" checked={!!c.is_admin} disabled={isSelf}
                            onChange={e => updateCoach(c.id, { is_admin: e.target.checked })}
                            style={{width:16,height:16,accentColor:C.gold,cursor:isSelf?"default":"pointer"}} />
                          <span style={{fontSize:11,color:c.is_admin?C.gold:C.mut,fontWeight:600}}>{c.is_admin?"Yes":"No"}</span>
                        </label>
                      </td>
                      <td style={{...td,color:C.mut,whiteSpace:"nowrap"}}>{c.last_seen_at ? new Date(c.last_seen_at).toLocaleString() : "—"}</td>
                      <td style={{...td,color:C.mut,whiteSpace:"nowrap"}}>{new Date(c.created_at).toLocaleDateString()}</td>
                      <td style={td}>
                        {!isSelf && (
                          <button onClick={()=>removeCoach(c)}
                            style={{padding:"4px 10px",borderRadius:6,border:"1px solid "+C.red,background:"transparent",color:C.red,fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!coachesList.length && <div style={{padding:24,textAlign:"center",color:C.mut,fontSize:12}}>{coachesLoading ? "Loading…" : "No coaches yet."}</div>}
          </div>
        </div>
        <div style={{fontSize:11,color:C.mut,marginTop:10,lineHeight:1.6}}>
          Coaches sign up at the login screen and appear here awaiting your approval.
          Display names show up in the Activity log so coaches see who made each change.
          You can't toggle your own admin / approved flags (use the Supabase Dashboard if you ever need to).
        </div>
      </div>
    );
  }

  // ─── ACTIVITY (AUDIT LOG) ─────────────────────────────────────────────
  // Global feed of every change to a player row, attributed to the coach who
  // made it. Populated server-side by the players_audit trigger.
  // (loadActivity useCallback + useEffect live at the top of the component,
  // above the auth gates, to keep React's hook-call order stable.)

  function renderActivity() {
    // Distinct actors / actions for the filter dropdowns. We compute from the
    // currently-loaded log so a freshly-loaded feed has the right options.
    const distinctActors = Array.from(new Map(
      activityLog.filter(e => e.actor_id).map(e => [e.actor_id, e.actor_name || e.actor_email || "Unknown"])
    ).entries()); // [[id, name], ...]

    const formatChange = (entry) => {
      // For updates: "5 fields changed: scores, notes, …"
      // For insert/delete: name from the row snapshot.
      if (entry.action === "update") {
        const fields = entry.field_changes ? Object.keys(entry.field_changes) : [];
        if (!fields.length) return "(no visible changes)";
        return fields.length === 1 ? "Changed " + fields[0] : fields.length + " fields: " + fields.slice(0,5).join(", ") + (fields.length>5?", …":"");
      }
      const row = entry.field_changes || {};
      const name = ((row.first_name||"") + " " + (row.last_name||"")).trim();
      if (entry.action === "insert") return "Added " + (name || "player #"+(entry.player_id||"?"));
      if (entry.action === "delete") return "Deleted " + (name || "player #"+(entry.player_id||"?"));
      return entry.action;
    };
    const playerName = (entry) => {
      // Try to find current player; fall back to snapshot fields for deletes.
      const p = entry.player_id ? players.find(x => x.id === entry.player_id) : null;
      if (p) return p.first_name + " " + p.last_name;
      const row = entry.field_changes || {};
      const snap = ((row.first_name||"") + " " + (row.last_name||"")).trim();
      return snap || (entry.player_id ? "Player #"+entry.player_id : "—");
    };

    // Collapse the raw entries into "sessions" — consecutive changes by the
    // same coach to the same player whose gap is <= 10 minutes get rolled
    // into one row so the feed stays scannable when a coach is rapid-firing
    // score taps. Walk ascending so groups extend forward in time, then
    // reverse for display (newest session first).
    const GAP_MS = 10 * 60 * 1000;
    const ascending = [...activityLog].reverse();
    const groups = [];
    for (const e of ascending) {
      const last = groups[groups.length - 1];
      const within = last
        && last.player_id === e.player_id
        && last.actor_id  === e.actor_id
        && (new Date(e.created_at) - new Date(last.lastTime)) <= GAP_MS;
      if (within) {
        last.entries.push(e);
        last.lastTime = e.created_at;
      } else {
        groups.push({
          player_id: e.player_id,
          actor_id: e.actor_id,
          actor_name: e.actor_name,
          actor_email: e.actor_email,
          firstTime: e.created_at,
          lastTime: e.created_at,
          entries: [e],
        });
      }
    }
    groups.reverse();

    // Summary of a group: action breakdown + union of fields touched.
    const summarizeGroup = (g) => {
      const actions = {};
      const fields = new Set();
      for (const e of g.entries) {
        actions[e.action] = (actions[e.action] || 0) + 1;
        if (e.action === "update" && e.field_changes) {
          Object.keys(e.field_changes).forEach(f => fields.add(f));
        }
      }
      const total = g.entries.length;
      const dominant = Object.entries(actions).sort((a,b) => b[1]-a[1])[0][0];
      const fieldList = [...fields];
      let text;
      if (total === 1) {
        text = formatChange(g.entries[0]);
      } else if (Object.keys(actions).length === 1 && dominant === "update") {
        text = total + " edits · " + (fieldList.length
          ? fieldList.slice(0,6).join(", ") + (fieldList.length > 6 ? ", …" : "")
          : "no visible field changes");
      } else if (Object.keys(actions).length === 1) {
        text = total + " " + dominant + (total > 1 ? "s" : "");
      } else {
        const parts = Object.entries(actions).map(([a,n]) => n + " " + a + (n>1 ? "s" : ""));
        text = parts.join(" + ") + (fieldList.length
          ? " · " + fieldList.slice(0,4).join(", ") + (fieldList.length > 4 ? ", …" : "")
          : "");
      }
      return { text, total, dominant };
    };

    const td = {padding:"7px 10px",fontSize:12,borderBottom:"1px solid "+C.border,verticalAlign:"top"};
    const th = {padding:"8px 10px",textAlign:"left",fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut,borderBottom:"1px solid "+C.border,background:C.card,whiteSpace:"nowrap"};
    return (
      <div>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap"}}>
          <h2 style={{margin:0,fontSize:18,fontWeight:800,color:C.gold}}>Activity</h2>
          <span style={{fontSize:11,color:C.mut}}>{groups.length} session{groups.length===1?"":"s"} · {activityLog.length} change{activityLog.length===1?"":"s"} (grouped per player, ≤10 min gap)</span>
          <div style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
            <select value={activityActor} onChange={e=>setActivityActor(e.target.value)}
              style={{...inpStyle,padding:"6px 10px",fontSize:12}}>
              <option value="">All coaches</option>
              {distinctActors.map(([id,name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <select value={activityAction} onChange={e=>setActivityAction(e.target.value)}
              style={{...inpStyle,padding:"6px 10px",fontSize:12}}>
              <option value="">All actions</option>
              <option value="update">Updates</option>
              <option value="insert">Adds</option>
              <option value="delete">Deletes</option>
            </select>
            <button onClick={loadActivity} disabled={activityLoading}
              style={{padding:"6px 12px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
              {activityLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>
        <div style={{background:C.card,borderRadius:12,border:"1px solid "+C.border,overflow:"hidden"}}>
          <div style={{overflowX:"auto",maxHeight:"calc(100vh - 220px)"}}>
            <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0}}>
              <thead><tr>
                <th style={th}>When</th>
                <th style={th}>Coach</th>
                <th style={th}>Action</th>
                <th style={th}>Player</th>
                <th style={th}>Change</th>
              </tr></thead>
              <tbody>
                {groups.map(g => {
                  const { text, total, dominant } = summarizeGroup(g);
                  const actionColor = dominant === "insert" ? C.grn : dominant === "delete" ? C.red : C.gold;
                  const sameTime = g.firstTime === g.lastTime;
                  const timeStr = sameTime
                    ? new Date(g.firstTime).toLocaleString()
                    : new Date(g.firstTime).toLocaleString() + " – " + new Date(g.lastTime).toLocaleTimeString();
                  const key = "g-" + g.entries[0].id + "-" + g.entries[g.entries.length-1].id;
                  return (
                    <tr key={key}>
                      <td style={{...td,color:C.mut,whiteSpace:"nowrap"}}>{timeStr}</td>
                      <td style={td}>{g.actor_name || g.actor_email || <span style={{color:C.mut}}>unknown</span>}</td>
                      <td style={td}>
                        <span style={{fontSize:10,fontWeight:800,padding:"2px 7px",borderRadius:8,background:actionColor+"22",color:actionColor,textTransform:"uppercase",whiteSpace:"nowrap"}}>
                          {total === 1 ? dominant : (total + "× " + dominant)}
                        </span>
                      </td>
                      <td style={td}>
                        {g.player_id
                          ? <span style={{color:C.gold,cursor:"pointer",fontWeight:600}} onClick={()=>{const p = players.find(x=>x.id===g.player_id); if (p) setProfileId(p.id);}}>{playerName(g.entries[0])}</span>
                          : <span style={{color:C.mut}}>{playerName(g.entries[0])}</span>}
                      </td>
                      <td style={td}>
                        <div style={{color:C.text}}>{text}</div>
                        {total > 1 ? (
                          <details style={{marginTop:4}}>
                            <summary style={{fontSize:10,color:C.mut,cursor:"pointer"}}>Show {total} individual changes</summary>
                            <div style={{marginTop:6,paddingLeft:10,borderLeft:"2px solid "+C.border}}>
                              {g.entries.slice().reverse().map(e => {
                                const ec = e.action === "insert" ? C.grn : e.action === "delete" ? C.red : C.gold;
                                return (
                                  <div key={e.id} style={{marginBottom:8,fontSize:11}}>
                                    <span style={{color:C.mut}}>{new Date(e.created_at).toLocaleTimeString()} · </span>
                                    <span style={{fontWeight:700,color:ec,textTransform:"uppercase",fontSize:10}}>{e.action}</span>
                                    <span style={{color:C.text}}> · {formatChange(e)}</span>
                                    {e.action === "update" && e.field_changes && (
                                      <details style={{marginTop:2,paddingLeft:14}}>
                                        <summary style={{fontSize:10,color:C.mut,cursor:"pointer"}}>diff</summary>
                                        <pre style={{margin:"4px 0 0 0",padding:8,background:C.bg,border:"1px solid "+C.border,borderRadius:6,fontSize:10,color:C.text,overflow:"auto",maxHeight:200,whiteSpace:"pre-wrap"}}>{JSON.stringify(e.field_changes, null, 2)}</pre>
                                      </details>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </details>
                        ) : (g.entries[0].action === "update" && g.entries[0].field_changes && (
                          <details style={{marginTop:4}}>
                            <summary style={{fontSize:10,color:C.mut,cursor:"pointer"}}>Show diff</summary>
                            <pre style={{margin:"4px 0 0 0",padding:8,background:C.bg,border:"1px solid "+C.border,borderRadius:6,fontSize:10,color:C.text,overflow:"auto",maxHeight:200,whiteSpace:"pre-wrap"}}>{JSON.stringify(g.entries[0].field_changes, null, 2)}</pre>
                          </details>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!groups.length && <div style={{padding:24,textAlign:"center",color:C.mut,fontSize:12}}>{activityLoading ? "Loading…" : "No activity yet."}</div>}
          </div>
        </div>
      </div>
    );
  }

  // Tournament-related constants used by the cards, filters, and forms.
  const TN_DIVISIONS = ["Open", "USA", "American", "Liberty", "National", "Elite", "Patriot", "Freedom", "Premier", "Select", "Club"];
  const TN_DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const tnDaysBetween = (start, end) => {
    const a = new Date(start + "T00:00").getTime();
    const b = new Date(end + "T00:00").getTime();
    return Math.round((b - a) / (24*60*60*1000)) + 1;
  };
  const tnStartDow = (start) => new Date(start + "T00:00").getDay();
  const tnStateOf = (loc) => { const m = (loc || "").match(/,\s*([A-Z]{2})\s*$/); return m ? m[1] : ""; };

  // ─── TOURNAMENT PLANNING ───
  // Per-tournament helpers and the main render fn. Assignments are stored as
  // (tournament_id, team_id, division); we let coaches add/remove assignments
  // inline on each tournament card, and we surface coach conflicts at the top
  // of the page so they can't ship a schedule that double-books a coach.

  // Quick lookup: which blackouts overlap a given date range?
  const blackoutsForRange = (startDate, endDate) =>
    blackoutDates.filter(b => b.date_start <= endDate && b.date_end >= startDate);

  // Assignment mutations.
  const assignTeamToTournament = async (tournamentId, teamId, division) => {
    if (!tournamentId || !teamId) return;
    const { error } = await supabase.from("tournament_assignments").upsert(
      { tournament_id: tournamentId, team_id: teamId, division: division || null },
      { onConflict: "tournament_id,team_id" }
    );
    if (error) { window.alert("Assign failed: " + error.message); return; }
    loadTournaments();
  };
  const removeAssignment = async (assignmentId) => {
    const { error } = await supabase.from("tournament_assignments").delete().eq("id", assignmentId);
    if (error) { window.alert("Remove failed: " + error.message); return; }
    loadTournaments();
  };
  const updateAssignmentDivision = async (assignmentId, division) => {
    const { error } = await supabase.from("tournament_assignments").update({ division: division || null }).eq("id", assignmentId);
    if (error) { window.alert("Update failed: " + error.message); return; }
    loadTournaments();
  };

  const saveTournament = async () => {
    const t = newTournament;
    if (!t.name.trim() || !t.start_date || !t.end_date) { window.alert("Name, start date, and end date are required."); return; }
    const row = {
      name: t.name.trim(),
      start_date: t.start_date,
      end_date: t.end_date,
      location: t.location.trim() || null,
      venue: t.venue.trim() || null,
      age_low: t.age_low ? parseInt(t.age_low) : null,
      age_high: t.age_high ? parseInt(t.age_high) : null,
      gender: t.gender || null,
      is_qualifier: !!t.is_qualifier,
      source: t.source || "manual",
      status: t.status.trim() || null,
      notes: t.notes.trim() || null,
      divisions: Array.isArray(t.divisions) ? t.divisions : [],
      wish_list: Array.isArray(t.wish_list) ? t.wish_list : [],
      format: "Three Day Format",
    };
    let error;
    if (editingTournament) {
      ({ error } = await supabase.from("tournaments").update(row).eq("id", editingTournament.id));
    } else {
      ({ error } = await supabase.from("tournaments").insert(row));
    }
    if (error) { window.alert("Save failed: " + error.message); return; }
    setAddingTournament(false);
    setEditingTournament(null);
    setNewTournament({ name: "", start_date: "", end_date: "", location: "", venue: "", age_low: "", age_high: "", gender: "Female", is_qualifier: false, source: "manual", status: "", notes: "", divisions: [], wish_list: [] });
    loadTournaments();
  };
  const openEditTournament = (tn) => {
    setEditingTournament(tn);
    setNewTournament({
      name: tn.name || "",
      start_date: tn.start_date || "",
      end_date: tn.end_date || "",
      location: tn.location || "",
      venue: tn.venue || "",
      age_low: tn.age_low != null ? String(tn.age_low) : "",
      age_high: tn.age_high != null ? String(tn.age_high) : "",
      gender: tn.gender || "Female",
      is_qualifier: !!tn.is_qualifier,
      source: tn.source || "manual",
      status: tn.status || "",
      notes: tn.notes || "",
      divisions: Array.isArray(tn.divisions) ? [...tn.divisions] : [],
      wish_list: Array.isArray(tn.wish_list) ? [...tn.wish_list] : [],
    });
    setAddingTournament(true);
  };
  const importBulkTournaments = async () => {
    const { newOnes, dupes } = bulkImportPreview;
    if (!newOnes.length) { window.alert("No new tournaments to import (" + dupes.length + " already exist)."); return; }
    setBulkImporting(true);
    const { error } = await supabase.from("tournaments").insert(newOnes);
    setBulkImporting(false);
    if (error) { window.alert("Import failed: " + error.message); return; }
    setBulkImportOpen(false);
    setBulkImportText("");
    loadTournaments();
    window.alert("Imported " + newOnes.length + " new tournament" + (newOnes.length===1?"":"s") + (dupes.length ? " (skipped " + dupes.length + " duplicate" + (dupes.length===1?"":"s") + ")" : "") + ".");
  };
  const toggleTournamentDivision = async (tn, division) => {
    const cur = Array.isArray(tn.divisions) ? tn.divisions : [];
    const next = cur.includes(division) ? cur.filter(d => d !== division) : [...cur, division];
    const { error } = await supabase.from("tournaments").update({ divisions: next }).eq("id", tn.id);
    if (error) { window.alert("Update failed: " + error.message); return; }
    loadTournaments();
  };
  const deleteTournament = async (id, name) => {
    if (!window.confirm("Delete tournament \"" + name + "\"? Any team assignments to it will also be removed.")) return;
    const { error } = await supabase.from("tournaments").delete().eq("id", id);
    if (error) { window.alert("Delete failed: " + error.message); return; }
    loadTournaments();
  };
  const toggleCancelled = async (t) => {
    const { error } = await supabase.from("tournaments").update({ cancelled: !t.cancelled }).eq("id", t.id);
    if (error) { window.alert("Update failed: " + error.message); return; }
    loadTournaments();
  };

  function TournamentCard({ tn }) {
    // Assignments for this tournament with looked-up team.
    const teamById = new Map(teamsList.map(t => [t.id, t]));
    const myAssignments = tournamentAssignments.filter(a => a.tournament_id === tn.id);
    const conflictsHere = tournamentConflicts.filter(c => c.a.tournament.id === tn.id || c.b.tournament.id === tn.id);
    const conflictTeamIds = new Set();
    conflictsHere.forEach(c => { conflictTeamIds.add(c.a.team_id); conflictTeamIds.add(c.b.team_id); });
    const blackouts = blackoutsForRange(tn.start_date, tn.end_date);
    const isCancelled = tn.cancelled;
    const [assignTeam, setAssignTeam] = [null, null]; // placeholder so eslint quiets; we use local state via DOM
    const cardStyle = {
      background: isCancelled ? "rgba(239,68,68,0.05)" : C.card,
      borderRadius: 12,
      border: "1px solid " + (conflictsHere.length ? C.red : isCancelled ? "rgba(239,68,68,0.3)" : C.border),
      padding: "14px 16px",
      marginBottom: 10,
      opacity: isCancelled ? 0.7 : 1,
    };
    const ageLabel = (tn.age_low != null && tn.age_high != null)
      ? (tn.age_low === tn.age_high ? "U" + tn.age_low : "U" + tn.age_low + "–U" + tn.age_high)
      : "—";
    // Eligible teams: those whose division's number falls in [age_low, age_high].
    const ageOf = (div) => parseInt((div || "").replace(/[^0-9]/g, "")) || 0;
    const eligibleTeams = teamsList.filter(t => {
      if (!t.active) return false;
      const a = ageOf(t.division);
      if (tn.age_low != null && a && a < tn.age_low) return false;
      if (tn.age_high != null && a && a > tn.age_high) return false;
      // Already assigned? Hide from the dropdown.
      if (myAssignments.some(asg => asg.team_id === t.id)) return false;
      return true;
    });
    return (
      <div style={cardStyle}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,flexWrap:"wrap"}}>
          <div style={{flex:"1 1 320px",minWidth:0}}>
            <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
              <h3 style={{margin:0,fontSize:15,fontWeight:800,color:isCancelled?C.mut:C.gold,textDecoration:isCancelled?"line-through":"none"}}>{tn.name}</h3>
              {tn.is_qualifier && <Tag c="#a855f7">QUALIFIER</Tag>}
              {conflictsHere.length > 0 && <Tag c={C.red}>{conflictsHere.length} CONFLICT{conflictsHere.length===1?"":"S"}</Tag>}
              {blackouts.length > 0 && <Tag c="#f59e0b">{blackouts.map(b => b.name).join(" / ")}</Tag>}
              {Array.isArray(tn.wish_list) && tn.wish_list.length > 0 && (
                <Tag c="#f59e0b">★ {tn.wish_list.join(" · ")}</Tag>
              )}
            </div>
            <div style={{fontSize:11,color:C.mut,marginTop:3,display:"flex",gap:10,flexWrap:"wrap"}}>
              <span><b style={{color:C.text}}>{new Date(tn.start_date+"T00:00").toLocaleDateString()}</b>{" – "}<b style={{color:C.text}}>{new Date(tn.end_date+"T00:00").toLocaleDateString()}</b></span>
              <span>{ageLabel}{tn.gender ? " · "+tn.gender : ""}</span>
              {tn.location && <span>{tn.location}</span>}
              {tn.status && <span style={{color:tn.status.includes("Open")?C.grn:C.mut}}>{tn.status}</span>}
            </div>
            {tn.venue && <div style={{fontSize:10,color:C.mut,marginTop:2}}>{tn.venue}</div>}
          </div>
          <div style={{display:"flex",gap:5,alignItems:"center"}}>
            <button onClick={()=>openEditTournament(tn)}
              title="Edit tournament"
              style={{padding:"4px 8px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
              Edit
            </button>
            <button onClick={()=>toggleCancelled(tn)}
              title={isCancelled?"Restore":"Mark cancelled"}
              style={{padding:"4px 8px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
              {isCancelled ? "Restore" : "Cancel"}
            </button>
            <button onClick={()=>deleteTournament(tn.id, tn.name)}
              title="Delete tournament"
              style={{padding:"4px 8px",borderRadius:6,border:"1px solid "+C.red,background:"transparent",color:C.red,fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
              Delete
            </button>
          </div>
        </div>

        {/* Divisions chips — click to toggle. Empty = nothing tagged for
            this tournament; the Divisions filter on the list shows only
            tournaments that match the user's selected divisions. */}
        <div style={{marginTop:8,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
          <span style={{fontSize:9,fontWeight:700,color:C.mut,textTransform:"uppercase",letterSpacing:0.5}}>Divisions:</span>
          {TN_DIVISIONS.map(div => {
            const on = (tn.divisions || []).includes(div);
            return (
              <span key={div} onClick={()=>toggleTournamentDivision(tn, div)}
                style={{padding:"2px 8px",borderRadius:10,fontSize:10,fontWeight:700,cursor:"pointer",border:on?"1px solid "+C.gold:"1px dashed "+C.border,background:on?"rgba(233,30,140,0.18)":"transparent",color:on?C.gold:C.mut,userSelect:"none"}}>
                {div}
              </span>
            );
          })}
        </div>

        {/* Assignments */}
        <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid "+C.border}}>
          <div style={{fontSize:10,fontWeight:700,color:C.mut,textTransform:"uppercase",letterSpacing:0.5,marginBottom:6}}>
            Teams going ({myAssignments.length})
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8}}>
            {myAssignments.map(a => {
              const tm = teamById.get(a.team_id);
              const conflict = conflictTeamIds.has(a.team_id);
              const bg = conflict ? "rgba(239,68,68,0.18)" : C.bg;
              const fg = conflict ? C.red : C.text;
              return (
                <span key={a.id}
                  style={{display:"inline-flex",alignItems:"center",gap:4,padding:"4px 8px",borderRadius:8,background:bg,border:"1px solid "+(conflict?C.red:C.border),fontSize:11,color:fg}}>
                  <span style={{fontWeight:700}}>{a.team_id}</span>
                  {tm && tm.level && <span style={{fontSize:9,color:C.mut}}>· {tm.level}</span>}
                  <select value={a.division||""} onChange={e=>updateAssignmentDivision(a.id, e.target.value)}
                    title="Playing division"
                    style={{...inpStyle,fontSize:10,padding:"1px 4px",marginLeft:4}}>
                    <option value="">— div —</option>
                    <option value="Open">Open</option>
                    <option value="USA">USA</option>
                    <option value="American">American</option>
                    <option value="Liberty">Liberty</option>
                    <option value="National">National</option>
                    <option value="Patriot">Patriot</option>
                    <option value="Freedom">Freedom</option>
                  </select>
                  <button onClick={()=>removeAssignment(a.id)} title="Remove"
                    style={{width:16,height:16,borderRadius:8,border:"none",background:"transparent",color:C.mut,cursor:"pointer",fontFamily:"inherit",fontSize:13,lineHeight:1,padding:0}}>×</button>
                </span>
              );
            })}
            {!myAssignments.length && <span style={{fontSize:11,color:C.mut,fontStyle:"italic"}}>No teams assigned.</span>}
          </div>
          {!isCancelled && eligibleTeams.length > 0 && (
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <select id={"assign-team-"+tn.id} defaultValue=""
                style={{...inpStyle,fontSize:11,padding:"5px 8px"}}>
                <option value="">+ Assign team…</option>
                {eligibleTeams.map(t => <option key={t.id} value={t.id}>{t.id}{t.level?" — "+t.level:""}</option>)}
              </select>
              <button onClick={()=>{
                  const sel = document.getElementById("assign-team-"+tn.id);
                  if (!sel || !sel.value) return;
                  const teamId = sel.value;
                  assignTeamToTournament(tn.id, teamId, "");
                  sel.value = "";
                }}
                style={{padding:"5px 12px",borderRadius:6,border:"1px solid "+C.gold,background:"transparent",color:C.gold,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                Add
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderTournaments() {
    // Filtering (used by Listings view; Calendar respects only the team
    // multi-select since "what's the calendar of selected teams" doesn't
    // need the listing filters).
    const filtered = tournaments.filter(t => {
      if (tnFilters.hideCancelled && t.cancelled) return false;
      if (tnFilters.qualifierOnly && !t.is_qualifier) return false;
      if (tnFilters.hideClosed && (t.status||"").toLowerCase().includes("closed")) return false;
      if (tnFilters.search) {
        const s = tnFilters.search.toLowerCase();
        const hay = (t.name + " " + (t.location||"") + " " + (t.venue||"")).toLowerCase();
        if (!hay.includes(s)) return false;
      }
      if (tnFilters.ageFor) {
        const n = parseInt(tnFilters.ageFor);
        if (t.age_low != null && n < t.age_low) return false;
        if (t.age_high != null && n > t.age_high) return false;
      }
      if (tnFilters.dateFrom && t.end_date < tnFilters.dateFrom) return false;
      if (tnFilters.dateTo && t.start_date > tnFilters.dateTo) return false;
      if (tnFilters.startsOn.length > 0 && !tnFilters.startsOn.includes(tnStartDow(t.start_date))) return false;
      if (tnFilters.state && tnStateOf(t.location) !== tnFilters.state) return false;
      if (tnFilters.numDays) {
        const d = tnDaysBetween(t.start_date, t.end_date);
        if (tnFilters.numDays === "4+") { if (d < 4) return false; }
        else if (d !== parseInt(tnFilters.numDays)) return false;
      }
      if (tnFilters.divisions.length > 0) {
        const dvs = t.divisions || [];
        if (!tnFilters.divisions.some(d => dvs.includes(d))) return false;
      }
      return true;
    });
    const hasActiveFilters = tnFilters.search || tnFilters.ageFor || tnFilters.qualifierOnly || tnFilters.hideClosed || tnFilters.dateFrom || tnFilters.dateTo || tnFilters.startsOn.length || tnFilters.state || tnFilters.numDays || tnFilters.divisions.length;
    return (
      <div>
        {/* Header + view dropdown */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,flexWrap:"wrap",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <h2 style={{margin:0,fontSize:18,fontWeight:800,color:C.gold}}>Tournaments</h2>
            <select value={tnView} onChange={e=>setTnView(e.target.value)}
              style={{...inpStyle,padding:"6px 12px",fontSize:12,fontWeight:700,color:C.gold,minWidth:140}}>
              <option value="list">Listings</option>
              <option value="browse">Browse by Weekend</option>
              <option value="month">Month View</option>
              <option value="calendar">Team Calendar</option>
            </select>
            <div style={{fontSize:11,color:C.mut}}>
              {tournaments.length} total · {filtered.length} match filters · {tournamentAssignments.length} assignments · {tournamentConflicts.length} conflict{tournamentConflicts.length===1?"":"s"}
            </div>
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
            <button onClick={()=>setBulkImportOpen(true)}
              title="Paste tournament listings from USAV / TournamentCentral and import them at once"
              style={{padding:"6px 14px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.text,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
              Bulk import
            </button>
            <button onClick={()=>{ setEditingTournament(null); setNewTournament({ name: "", start_date: "", end_date: "", location: "", venue: "", age_low: "", age_high: "", gender: "Female", is_qualifier: false, source: "manual", status: "", notes: "", divisions: [], wish_list: [] }); setAddingTournament(true); }}
              style={{padding:"6px 14px",borderRadius:6,border:"1px solid "+C.gold,background:"transparent",color:C.gold,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
              + Add tournament
            </button>
            <button onClick={loadTournaments} disabled={tournamentsLoading}
              style={{padding:"6px 12px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
              {tournamentsLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>
        {/* Filter row 1 — primary filters */}
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:6,padding:"8px 10px",background:C.card,borderRadius:10,border:"1px solid "+C.border}}>
          <DebouncedField placeholder="Search name / city / venue"
            value={tnFilters.search} onCommit={v=>setTnFilters(prev=>({...prev,search:v}))}
            style={{...inpStyle,padding:"6px 10px",fontSize:12,minWidth:200}} />
          <select value={tnFilters.ageFor} onChange={e=>setTnFilters(prev=>({...prev,ageFor:e.target.value}))}
            title="Show tournaments whose age range includes this age"
            style={{...inpStyle,padding:"6px 10px",fontSize:12,color:tnFilters.ageFor?C.gold:C.text}}>
            <option value="">All ages</option>
            {[10,11,12,13,14,15,16,17,18].map(a => <option key={a} value={a}>U{a}</option>)}
          </select>
          <select value={tnFilters.state} onChange={e=>setTnFilters(prev=>({...prev,state:e.target.value}))}
            title="Filter by US state"
            style={{...inpStyle,padding:"6px 10px",fontSize:12,color:tnFilters.state?C.gold:C.text}}>
            <option value="">All locations</option>
            {stateOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={tnFilters.numDays} onChange={e=>setTnFilters(prev=>({...prev,numDays:e.target.value}))}
            title="Number of days the tournament runs"
            style={{...inpStyle,padding:"6px 10px",fontSize:12,color:tnFilters.numDays?C.gold:C.text}}>
            <option value="">Any length</option>
            <option value="1">1 day</option>
            <option value="2">2 days</option>
            <option value="3">3 days</option>
            <option value="4+">4+ days</option>
          </select>
          <label style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,color:C.mut,cursor:"pointer"}}>
            <input type="checkbox" checked={tnFilters.qualifierOnly} onChange={e=>setTnFilters(prev=>({...prev,qualifierOnly:e.target.checked}))} />
            Qualifiers only
          </label>
          <label style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,color:C.mut,cursor:"pointer"}}>
            <input type="checkbox" checked={tnFilters.hideClosed} onChange={e=>setTnFilters(prev=>({...prev,hideClosed:e.target.checked}))} />
            Hide closed
          </label>
          <label style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,color:C.mut,cursor:"pointer"}}>
            <input type="checkbox" checked={tnFilters.hideCancelled} onChange={e=>setTnFilters(prev=>({...prev,hideCancelled:e.target.checked}))} />
            Hide cancelled
          </label>
          {hasActiveFilters ? (
            <button onClick={()=>setTnFilters({ search:"", ageFor:"", qualifierOnly:false, dateFrom:"", dateTo:"", hideClosed:false, hideCancelled:true, startsOn:[], state:"", numDays:"", divisions:[] })}
              style={{padding:"4px 8px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginLeft:"auto"}}>
              Clear all
            </button>
          ) : null}
        </div>
        {/* Filter row 2 — day-of-week + date range */}
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:6,padding:"6px 10px",background:C.card,borderRadius:10,border:"1px solid "+C.border}}>
          <span style={{fontSize:11,color:C.mut,fontWeight:600}}>Starts on:</span>
          {TN_DOW_NAMES.map((name, idx) => {
            const on = tnFilters.startsOn.includes(idx);
            return (
              <span key={idx} onClick={()=>setTnFilters(prev=>({...prev,startsOn: on ? prev.startsOn.filter(x=>x!==idx) : [...prev.startsOn, idx]}))}
                style={{padding:"3px 9px",borderRadius:10,fontSize:11,fontWeight:700,cursor:"pointer",border:on?"1px solid "+C.gold:"1px solid "+C.border,background:on?"rgba(233,30,140,0.18)":"transparent",color:on?C.gold:C.mut,userSelect:"none"}}>
                {name}
              </span>
            );
          })}
          <span style={{fontSize:11,color:C.mut,marginLeft:8}}>Dates:</span>
          <input type="date" value={tnFilters.dateFrom} onChange={e=>setTnFilters(prev=>({...prev,dateFrom:e.target.value}))}
            style={{...inpStyle,padding:"5px 8px",fontSize:11,colorScheme:"dark",color:tnFilters.dateFrom?C.gold:C.text}} />
          <span style={{fontSize:11,color:C.mut}}>to</span>
          <input type="date" value={tnFilters.dateTo} onChange={e=>setTnFilters(prev=>({...prev,dateTo:e.target.value}))}
            style={{...inpStyle,padding:"5px 8px",fontSize:11,colorScheme:"dark",color:tnFilters.dateTo?C.gold:C.text}} />
        </div>
        {/* Filter row 3 — divisions */}
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:12,padding:"6px 10px",background:C.card,borderRadius:10,border:"1px solid "+C.border}}>
          <span style={{fontSize:11,color:C.mut,fontWeight:600}}>Divisions:</span>
          {TN_DIVISIONS.map(div => {
            const on = tnFilters.divisions.includes(div);
            return (
              <span key={div} onClick={()=>setTnFilters(prev=>({...prev,divisions: on ? prev.divisions.filter(x=>x!==div) : [...prev.divisions, div]}))}
                style={{padding:"3px 9px",borderRadius:10,fontSize:11,fontWeight:700,cursor:"pointer",border:on?"1px solid "+C.gold:"1px solid "+C.border,background:on?"rgba(233,30,140,0.18)":"transparent",color:on?C.gold:C.mut,userSelect:"none"}}>
                {div}
              </span>
            );
          })}
          {tnFilters.divisions.length > 0 && (
            <span style={{fontSize:10,color:C.mut,marginLeft:6,fontStyle:"italic"}}>matches tournaments that include ANY selected division</span>
          )}
        </div>
        {/* Conflict alert */}
        {tournamentConflicts.length > 0 && (
          <details open style={{marginBottom:14,background:"rgba(239,68,68,0.08)",border:"1px solid "+C.red,borderRadius:10,padding:"10px 14px"}}>
            <summary style={{cursor:"pointer",fontSize:12,fontWeight:800,color:C.red}}>
              {tournamentConflicts.length} coach conflict{tournamentConflicts.length===1?"":"s"} detected
            </summary>
            <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:5}}>
              {tournamentConflicts.map((c, i) => (
                <div key={i} style={{fontSize:11,color:C.text,lineHeight:1.5}}>
                  <b style={{color:C.red}}>{c.coach}</b> would be at <b>{c.a.team_id}</b> (<i>{c.a.tournament.name}</i>) AND <b>{c.b.team_id}</b> (<i>{c.b.tournament.name}</i>) on {new Date(c.a.tournament.start_date+"T00:00").toLocaleDateString()}.
                </div>
              ))}
            </div>
          </details>
        )}
        {tnView === "calendar" ? renderTournamentCalendar(filtered)
         : tnView === "browse" ? renderTournamentBrowser(filtered)
         : tnView === "month" ? renderTournamentMonthView(filtered)
         : (<>
        {/* Tournament cards, grouped by month so the wall-of-cards is scannable */}
        {filtered.length === 0 ? (
          <div style={{padding:30,textAlign:"center",color:C.mut,fontSize:12,background:C.card,borderRadius:10,border:"1px solid "+C.border}}>
            {tournamentsLoading ? "Loading tournaments…" : "No tournaments match these filters."}
          </div>
        ) : (
          (() => {
            const groups = {};
            for (const t of filtered) {
              const key = t.start_date.slice(0,7); // YYYY-MM
              if (!groups[key]) groups[key] = [];
              groups[key].push(t);
            }
            const keys = Object.keys(groups).sort();
            return keys.map(k => {
              const monthLabel = new Date(k + "-01T00:00").toLocaleString(undefined, { month: "long", year: "numeric" });
              return (
                <div key={k} style={{marginBottom:18}}>
                  <h3 style={{margin:"0 0 8px 0",fontSize:13,fontWeight:800,color:C.acc,textTransform:"uppercase",letterSpacing:1,borderBottom:"1px solid "+C.border,paddingBottom:5}}>
                    {monthLabel} · {groups[k].length}
                  </h3>
                  {groups[k].map(tn => <TournamentCard key={tn.id} tn={tn} />)}
                </div>
              );
            });
          })()
        )}
        </>)}
      </div>
    );
  }

  // ─── TOURNAMENT CALENDAR VIEW ─────────────────────────────────────────
  // Rows = weekends (Sat) in the chosen date range. Columns = selected teams.
  // Each cell shows the tournament that team is going to that weekend, or
  // empty. Blackout weekends are tinted amber; conflict cells are red.
  function renderTournamentCalendar(filteredTournaments) {
    const activeTeams = teamsList.filter(t => t.active);
    const teamsToShow = activeTeams.filter(t => tnSelectedTeams.size === 0 || tnSelectedTeams.has(t.id));
    // Generate Saturdays between tnCalFrom and tnCalTo
    const weeks = [];
    {
      const start = new Date(tnCalFrom + "T00:00");
      const end = new Date(tnCalTo + "T00:00");
      // advance to first Saturday on or after start
      let d = new Date(start);
      while (d.getDay() !== 6) d.setDate(d.getDate() + 1);
      while (d <= end) {
        const sat = new Date(d);
        const fri = new Date(sat); fri.setDate(fri.getDate() - 1);
        const sun = new Date(sat); sun.setDate(sun.getDate() + 1);
        weeks.push({
          fri: fri.toISOString().slice(0,10),
          sat: sat.toISOString().slice(0,10),
          sun: sun.toISOString().slice(0,10),
        });
        d.setDate(d.getDate() + 7);
      }
    }
    // Index assignments by (team_id, weekend-key). A weekend matches if the
    // tournament's date range overlaps Fri-Sun of that weekend.
    const tnById = new Map(tournaments.map(t => [t.id, t]));
    const cellMap = new Map();
    const cellKey = (teamId, sat) => teamId + ":" + sat;
    for (const a of tournamentAssignments) {
      const tn = tnById.get(a.tournament_id);
      if (!tn) continue;
      for (const wk of weeks) {
        if (tn.start_date <= wk.sun && tn.end_date >= wk.fri) {
          const k = cellKey(a.team_id, wk.sat);
          if (!cellMap.has(k)) cellMap.set(k, []);
          cellMap.get(k).push({ assignment: a, tournament: tn });
          break; // assign to the FIRST overlapping weekend only
        }
      }
    }
    // Conflict lookup: (team_id, weekend) pairs that are in a conflict
    const conflictCells = new Set();
    for (const c of tournamentConflicts) {
      for (const wk of weeks) {
        if (c.a.tournament.start_date <= wk.sun && c.a.tournament.end_date >= wk.fri) conflictCells.add(cellKey(c.a.team_id, wk.sat));
        if (c.b.tournament.start_date <= wk.sun && c.b.tournament.end_date >= wk.fri) conflictCells.add(cellKey(c.b.team_id, wk.sat));
      }
    }
    const blackoutFor = (wk) => blackoutDates.filter(b => b.date_start <= wk.sun && b.date_end >= wk.fri);
    // A weekend counts as a "3-day" weekend if a school-out day lands on the
    // adjacent Friday or Monday — Memorial / Labor / MLK / Presidents Day
    // (Monday holidays), Good Friday (Friday school out), DSISD long breaks,
    // etc. Pulled straight from the blackout_dates table so adding a custom
    // DSISD blackout automatically marks the adjacent weekend.
    const isThreeDayWeekend = (wk) => {
      const monDate = new Date(wk.sun + "T00:00");
      monDate.setDate(monDate.getDate() + 1);
      const monISO = monDate.toISOString().slice(0,10);
      return blackoutDates.some(b =>
        (b.date_start <= wk.fri  && b.date_end >= wk.fri) ||
        (b.date_start <= monISO && b.date_end >= monISO)
      );
    };
    // Tournaments matching the Listings filter that overlap this weekend.
    const tournamentsThisWeekend = (wk) =>
      (filteredTournaments || []).filter(t => t.start_date <= wk.sun && t.end_date >= wk.fri);

    const abbreviate = (name, n = 22) => name.length > n ? name.slice(0, n-1) + "…" : name;
    const fmtMD = (iso) => { const d = new Date(iso + "T00:00"); return (d.getMonth()+1) + "/" + d.getDate(); };

    return (
      <div>
        {/* Team multi-select chips */}
        <div style={{background:C.card,borderRadius:10,border:"1px solid "+C.border,padding:"10px 12px",marginBottom:10}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6,gap:8,flexWrap:"wrap"}}>
            <span style={{fontSize:11,fontWeight:700,color:C.mut,textTransform:"uppercase",letterSpacing:0.5}}>Teams ({tnSelectedTeams.size === 0 ? activeTeams.length : tnSelectedTeams.size} shown) · per-weekend tournament list respects the Listings filter</span>
            <div style={{display:"flex",gap:6}}>
              <button onClick={()=>setTnSelectedTeams(new Set())}
                style={{padding:"3px 8px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                Show all
              </button>
              <button onClick={()=>setTnSelectedTeams(new Set(activeTeams.filter(t => t.level === "National").map(t => t.id)))}
                style={{padding:"3px 8px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                Nationals only
              </button>
              <button onClick={()=>setTnSelectedTeams(new Set(activeTeams.filter(t => t.level === "Regional").map(t => t.id)))}
                style={{padding:"3px 8px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                Regionals only
              </button>
            </div>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
            {activeTeams.map(team => {
              const on = tnSelectedTeams.size === 0 || tnSelectedTeams.has(team.id);
              return (
                <span key={team.id}
                  onClick={()=>setTnSelectedTeams(prev => {
                    // First click into a chip: if "all" is implied, start a new set with everything EXCEPT this one toggled off
                    if (prev.size === 0) {
                      const all = new Set(activeTeams.map(t => t.id));
                      all.delete(team.id);
                      return all;
                    }
                    const next = new Set(prev);
                    if (next.has(team.id)) next.delete(team.id); else next.add(team.id);
                    return next.size === activeTeams.length ? new Set() : next;
                  })}
                  style={{padding:"3px 9px",borderRadius:10,fontSize:11,fontWeight:700,cursor:"pointer",border:on?"1px solid "+C.gold:"1px solid "+C.border,background:on?"rgba(233,30,140,0.18)":"transparent",color:on?C.gold:C.mut,userSelect:"none"}}>
                  {team.id}{team.level ? " · " + team.level.slice(0,3) : ""}
                </span>
              );
            })}
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center",marginTop:10}}>
            <span style={{fontSize:11,color:C.mut,fontWeight:600}}>Season range:</span>
            <input type="date" value={tnCalFrom} onChange={e=>setTnCalFrom(e.target.value)}
              style={{...inpStyle,padding:"5px 8px",fontSize:11,colorScheme:"dark",color:C.gold}} />
            <span style={{fontSize:11,color:C.mut}}>to</span>
            <input type="date" value={tnCalTo} onChange={e=>setTnCalTo(e.target.value)}
              style={{...inpStyle,padding:"5px 8px",fontSize:11,colorScheme:"dark",color:C.gold}} />
          </div>
        </div>
        {/* Calendar grid */}
        <div style={{background:C.card,borderRadius:10,border:"1px solid "+C.border,overflow:"hidden"}}>
          <div style={{overflowX:"auto",maxHeight:"calc(100vh - 280px)"}}>
            <table style={{borderCollapse:"separate",borderSpacing:0,minWidth:"100%",fontSize:11}}>
              <thead>
                <tr>
                  <th style={{padding:"7px 10px",position:"sticky",top:0,left:0,zIndex:3,background:C.card,borderBottom:"1px solid "+C.border,borderRight:"1px solid "+C.border,textAlign:"left",fontSize:10,fontWeight:700,color:C.mut,textTransform:"uppercase",whiteSpace:"nowrap"}}>Weekend</th>
                  {teamsToShow.map(team => (
                    <th key={team.id} style={{padding:"7px 8px",position:"sticky",top:0,zIndex:2,background:C.card,borderBottom:"1px solid "+C.border,fontSize:9,fontWeight:700,color:C.gold,textTransform:"uppercase",whiteSpace:"nowrap",minWidth:90,textAlign:"left"}}>
                      {team.id}
                      <div style={{fontSize:8,fontWeight:600,color:C.mut,textTransform:"none"}}>{team.head_coach || ""}{team.assistant_coach ? "/" + team.assistant_coach : ""}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map(wk => {
                  const bo = blackoutFor(wk);
                  const isLong = isThreeDayWeekend(wk);
                  const tnrsThis = tournamentsThisWeekend(wk);
                  const rowBg = bo.length ? "rgba(245,158,11,0.06)" : isLong ? "rgba(6,182,212,0.05)" : "transparent";
                  return (
                    <tr key={wk.sat} style={{background:rowBg}}>
                      <td style={{padding:"6px 10px",position:"sticky",left:0,zIndex:1,background:bo.length?"rgba(245,158,11,0.10)":isLong?"rgba(6,182,212,0.08)":C.card,borderBottom:"1px solid "+C.border,borderRight:"1px solid "+C.border,whiteSpace:"normal",minWidth:170,maxWidth:230,verticalAlign:"top"}}>
                        <div style={{fontSize:11,fontWeight:700,color:C.text}}>{fmtMD(wk.fri)}–{fmtMD(wk.sun)}</div>
                        {bo.length > 0 && <div style={{fontSize:9,color:"#f59e0b",fontWeight:600}}>{bo.map(b => b.name).join(" / ")}</div>}
                        {isLong && (
                          <span style={{display:"inline-block",marginTop:3,fontSize:8,fontWeight:800,padding:"1px 6px",borderRadius:8,background:"rgba(6,182,212,0.22)",color:"#06b6d4",letterSpacing:0.5}}>3-DAY (DSISD)</span>
                        )}
                        {tnrsThis.length > 0 && (
                          <details style={{marginTop:4}}>
                            <summary style={{fontSize:9,fontWeight:700,color:C.grn,cursor:"pointer",listStyle:"none"}}>
                              {tnrsThis.length} tournament{tnrsThis.length===1?"":"s"} this wknd ▾
                            </summary>
                            <div style={{marginTop:3,paddingLeft:6,borderLeft:"2px solid "+C.border}}>
                              {tnrsThis.map(t => (
                                <div key={t.id} title={t.name + " · " + (t.location||"")}
                                  style={{fontSize:9,color:C.text,lineHeight:1.4,marginBottom:2}}>
                                  {t.is_qualifier && <span style={{color:"#a855f7",fontWeight:700,marginRight:3}}>Q</span>}
                                  {abbreviate(t.name, 34)}
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </td>
                      {teamsToShow.map(team => {
                        const k = cellKey(team.id, wk.sat);
                        const items = cellMap.get(k) || [];
                        const isConflict = conflictCells.has(k);
                        const bg = isConflict ? "rgba(239,68,68,0.18)" : "transparent";
                        return (
                          <td key={team.id} style={{padding:"5px 6px",borderBottom:"1px solid "+C.border,background:bg,verticalAlign:"top",minWidth:90}}>
                            {items.length === 0 ? (
                              <span style={{color:C.mut,fontSize:11}}>—</span>
                            ) : items.map(it => (
                              <div key={it.assignment.id} title={it.tournament.name + (it.assignment.division ? " · " + it.assignment.division : "")}
                                style={{fontSize:10,fontWeight:600,color:isConflict?C.red:C.text,lineHeight:1.3,marginBottom:2}}>
                                {abbreviate(it.tournament.name, 26)}
                                {it.assignment.division && <span style={{color:C.mut,fontSize:9}}> · {it.assignment.division}</span>}
                              </div>
                            ))}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {!weeks.length && (
                  <tr><td colSpan={teamsToShow.length + 1} style={{padding:20,textAlign:"center",color:C.mut}}>No weekends in the selected date range.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // ─── TOURNAMENT MONTH VIEW (Google-Calendar-style grid) ──────────────
  // Traditional 7-column month grid. Each day cell shows the tournaments
  // happening that day (overlap, so multi-day events appear in each day
  // they span) filtered by the Listings filter. Holiday days tint amber,
  // 3-day-weekend Fridays/Mondays tint cyan, today is outlined gold,
  // out-of-month days dimmed. Forward/back arrows step a month at a time.
  function renderTournamentMonthView(filteredTournaments) {
    const cursor = new Date(tnMonthCursor + "T00:00");
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    // Build a 6-row Sunday-anchored grid that fully covers the month
    // (includes leading days from the previous month and trailing days
    // from the next so each row has exactly 7 cells).
    const firstOfMonth = new Date(year, month, 1);
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(gridStart.getDate() - gridStart.getDay()); // back to Sunday
    const days = [];
    {
      let d = new Date(gridStart);
      // 6 rows × 7 cols = 42 cells. Always enough to cover any month.
      for (let i = 0; i < 42; i++) {
        days.push({
          date: new Date(d),
          iso: d.toISOString().slice(0, 10),
          inMonth: d.getMonth() === month,
          dow: d.getDay(),
        });
        d.setDate(d.getDate() + 1);
      }
    }
    const todayISO = new Date().toISOString().slice(0, 10);
    // Index tournaments by day for quick lookup. A tournament covers
    // [start_date, end_date]; an event that spans Fri-Sun shows up in
    // Fri, Sat, and Sun cells.
    const tnByDay = new Map();
    for (const t of (filteredTournaments || [])) {
      const start = new Date(t.start_date + "T00:00");
      const end = new Date(t.end_date + "T00:00");
      let cur = new Date(start);
      while (cur <= end) {
        const iso = cur.toISOString().slice(0, 10);
        if (!tnByDay.has(iso)) tnByDay.set(iso, []);
        tnByDay.get(iso).push(t);
        cur.setDate(cur.getDate() + 1);
      }
    }
    const blackoutForDay = (iso) => blackoutDates.filter(b => b.date_start <= iso && b.date_end >= iso);
    const isLongWeekendDay = (date, iso) => {
      // Mark cyan only on the Fri or Mon of a 3-day weekend (the day that
      // makes it long). Easier visual scan than tinting the whole weekend.
      const dow = date.getDay();
      if (dow !== 1 && dow !== 5) return false; // Mon or Fri only
      // It's a 3-day weekend if a school-out day lands on this day.
      return blackoutDates.some(b => b.date_start <= iso && b.date_end >= iso);
    };
    const shiftMonth = (delta) => {
      const d = new Date(year, month + delta, 1);
      setTnMonthCursor(d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-01");
    };
    const goToday = () => {
      const d = new Date();
      setTnMonthCursor(d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-01");
    };
    const abbreviate = (name, n = 26) => name.length > n ? name.slice(0, n-1) + "…" : name;
    const totalThisMonth = days
      .filter(d => d.inMonth)
      .reduce((sum, d) => sum + (tnByDay.get(d.iso)?.length || 0), 0);

    return (
      <div>
        {/* Month nav + counter */}
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,background:C.card,borderRadius:10,border:"1px solid "+C.border,padding:"8px 12px",flexWrap:"wrap"}}>
          <button onClick={()=>shiftMonth(-1)}
            style={{padding:"6px 14px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.text,fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>‹ Prev</button>
          <h2 style={{margin:0,fontSize:16,fontWeight:800,color:C.gold,minWidth:180,textAlign:"center"}}>{monthLabel}</h2>
          <button onClick={()=>shiftMonth(1)}
            style={{padding:"6px 14px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.text,fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Next ›</button>
          <button onClick={goToday}
            style={{padding:"6px 12px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",marginLeft:6}}>Today</button>
          <span style={{fontSize:11,color:C.mut,marginLeft:"auto"}}>{totalThisMonth} tournament-day{totalThisMonth===1?"":"s"} this month (filtered)</span>
        </div>
        {/* Weekday header */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,minmax(0,1fr))",gap:1,marginBottom:1}}>
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => (
            <div key={d} style={{padding:"6px 8px",fontSize:10,fontWeight:700,color:C.mut,textTransform:"uppercase",letterSpacing:0.5,textAlign:"center",background:C.card,borderRadius:4}}>{d}</div>
          ))}
        </div>
        {/* Day grid */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,minmax(0,1fr))",gap:1,background:C.border,border:"1px solid "+C.border,borderRadius:8,overflow:"hidden"}}>
          {days.map(day => {
            const dayTn = tnByDay.get(day.iso) || [];
            const bo = blackoutForDay(day.iso);
            const isLong = isLongWeekendDay(day.date, day.iso);
            const isToday = day.iso === todayISO;
            const isWknd = day.dow === 0 || day.dow === 6;
            let cellBg = C.card;
            if (!day.inMonth) cellBg = C.bg;
            else if (bo.length) cellBg = "rgba(245,158,11,0.08)";
            else if (isLong) cellBg = "rgba(6,182,212,0.08)";
            else if (isWknd) cellBg = "rgba(255,255,255,0.02)";
            const cellBorder = isToday ? "2px solid "+C.gold : "none";
            return (
              <div key={day.iso} style={{background:cellBg,minHeight:96,padding:4,outline:cellBorder,outlineOffset:-2,position:"relative",overflow:"hidden"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:2}}>
                  <span style={{fontSize:11,fontWeight:isToday?800:700,color:day.inMonth?(isToday?C.gold:C.text):C.mut}}>{day.date.getDate()}</span>
                  {isLong && day.inMonth && <span title="3-day weekend (DSISD)" style={{fontSize:8,fontWeight:800,padding:"0 4px",borderRadius:6,background:"rgba(6,182,212,0.22)",color:"#06b6d4"}}>3D</span>}
                </div>
                {bo.length > 0 && day.inMonth && (
                  <div title={bo.map(b => b.name).join(", ")} style={{fontSize:8,fontWeight:600,color:"#f59e0b",lineHeight:1.2,marginBottom:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{bo.map(b => b.name).join(" / ")}</div>
                )}
                {dayTn.slice(0, 4).map((t, idx) => (
                  <div key={t.id + "-" + idx}
                    onClick={()=>openEditTournament(t)}
                    title={t.name + (t.location ? " · " + t.location : "")}
                    style={{fontSize:9,fontWeight:600,padding:"1px 4px",marginBottom:1,borderRadius:3,cursor:"pointer",background:t.is_qualifier?"rgba(168,85,247,0.18)":"rgba(34,197,94,0.14)",color:t.is_qualifier?"#a855f7":C.grn,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",lineHeight:1.3}}>
                    {abbreviate(t.name)}
                  </div>
                ))}
                {dayTn.length > 4 && (
                  <div style={{fontSize:9,color:C.mut,fontWeight:700,paddingLeft:4}}>+{dayTn.length - 4} more</div>
                )}
              </div>
            );
          })}
        </div>
        {/* Legend */}
        <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:10,fontSize:10,color:C.mut}}>
          <span><span style={{display:"inline-block",width:10,height:10,background:"rgba(168,85,247,0.5)",borderRadius:2,marginRight:4,verticalAlign:"middle"}} />Qualifier</span>
          <span><span style={{display:"inline-block",width:10,height:10,background:"rgba(34,197,94,0.5)",borderRadius:2,marginRight:4,verticalAlign:"middle"}} />Other</span>
          <span><span style={{display:"inline-block",width:10,height:10,background:"rgba(245,158,11,0.4)",borderRadius:2,marginRight:4,verticalAlign:"middle"}} />Holiday / break</span>
          <span><span style={{display:"inline-block",width:10,height:10,background:"rgba(6,182,212,0.4)",borderRadius:2,marginRight:4,verticalAlign:"middle"}} />3-day weekend (DSISD)</span>
          <span style={{marginLeft:"auto",fontStyle:"italic"}}>Click any tournament to edit · Listings filter narrows what shows here</span>
        </div>
      </div>
    );
  }

  // ─── TOURNAMENT BROWSER (research mode) ──────────────────────────────
  // Per-weekend digest of every tournament matching the Listings filter.
  // No team columns — this view is for shopping the calendar, not tracking
  // assignments. Each weekend is a small card with the date, any blackout
  // labels, a 3-day-weekend badge if school is out adjacent, and a stack
  // of tournaments showing the key research-mode fields (location, age
  // range, gender, divisions, qualifier flag). Click any tournament name
  // to open the edit modal.
  function renderTournamentBrowser(filteredTournaments) {
    // Generate Saturdays between tnCalFrom and tnCalTo (same logic as the
    // team calendar — duplicated here to keep this fn self-contained).
    const weeks = [];
    {
      const start = new Date(tnCalFrom + "T00:00");
      const end = new Date(tnCalTo + "T00:00");
      let d = new Date(start);
      while (d.getDay() !== 6) d.setDate(d.getDate() + 1);
      while (d <= end) {
        const sat = new Date(d);
        const fri = new Date(sat); fri.setDate(fri.getDate() - 1);
        const sun = new Date(sat); sun.setDate(sun.getDate() + 1);
        weeks.push({
          fri: fri.toISOString().slice(0,10),
          sat: sat.toISOString().slice(0,10),
          sun: sun.toISOString().slice(0,10),
        });
        d.setDate(d.getDate() + 7);
      }
    }
    const blackoutFor = (wk) => blackoutDates.filter(b => b.date_start <= wk.sun && b.date_end >= wk.fri);
    const isThreeDayWeekend = (wk) => {
      const monDate = new Date(wk.sun + "T00:00");
      monDate.setDate(monDate.getDate() + 1);
      const monISO = monDate.toISOString().slice(0,10);
      return blackoutDates.some(b =>
        (b.date_start <= wk.fri  && b.date_end >= wk.fri) ||
        (b.date_start <= monISO && b.date_end >= monISO)
      );
    };
    const fmtMD = (iso) => { const d = new Date(iso + "T00:00"); return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); };
    const ageLabel = (t) => {
      if (t.age_low == null && t.age_high == null) return "";
      if (t.age_low === t.age_high) return "U" + t.age_low;
      return "U" + t.age_low + "–U" + t.age_high;
    };

    // Pair each weekend with its matching tournaments. Keep only weekends
    // that actually have something — empty weekends crowd the view in
    // research mode. (Holiday-only weekends still surface via the team
    // calendar.)
    const weekendData = weeks.map(wk => ({
      wk,
      bo: blackoutFor(wk),
      isLong: isThreeDayWeekend(wk),
      tournaments: (filteredTournaments || []).filter(t => t.start_date <= wk.sun && t.end_date >= wk.fri),
    })).filter(w => w.tournaments.length > 0);

    if (!weekendData.length) {
      return (
        <div style={{padding:30,textAlign:"center",color:C.mut,fontSize:12,background:C.card,borderRadius:10,border:"1px solid "+C.border}}>
          No tournaments match the current filter in this date range. Adjust the Listings filters or the date range above.
        </div>
      );
    }

    return (
      <div>
        {/* Date range picker — same widget as the team calendar. Team
            selection is intentionally absent here; this view is tournament
            focused. */}
        <div style={{background:C.card,borderRadius:10,border:"1px solid "+C.border,padding:"10px 12px",marginBottom:10}}>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <span style={{fontSize:11,fontWeight:700,color:C.mut,textTransform:"uppercase",letterSpacing:0.5}}>Research mode — {weekendData.length} weekend{weekendData.length===1?"":"s"} with tournaments matching the Listings filter</span>
            <span style={{fontSize:11,color:C.mut,marginLeft:"auto"}}>Season range:</span>
            <input type="date" value={tnCalFrom} onChange={e=>setTnCalFrom(e.target.value)}
              style={{...inpStyle,padding:"5px 8px",fontSize:11,colorScheme:"dark",color:C.gold}} />
            <span style={{fontSize:11,color:C.mut}}>to</span>
            <input type="date" value={tnCalTo} onChange={e=>setTnCalTo(e.target.value)}
              style={{...inpStyle,padding:"5px 8px",fontSize:11,colorScheme:"dark",color:C.gold}} />
          </div>
        </div>

        {weekendData.map(({ wk, bo, isLong, tournaments: tn }) => {
          const cardBorder = bo.length ? "rgba(245,158,11,0.45)" : isLong ? "rgba(6,182,212,0.45)" : C.border;
          return (
            <div key={wk.sat} style={{background:C.card,borderRadius:10,border:"1px solid "+cardBorder,padding:"10px 14px",marginBottom:10}}>
              <div style={{display:"flex",alignItems:"baseline",gap:8,flexWrap:"wrap",marginBottom:8,paddingBottom:6,borderBottom:"1px solid "+C.border}}>
                <span style={{fontSize:14,fontWeight:800,color:C.gold}}>{fmtMD(wk.fri)} – {fmtMD(wk.sun)}</span>
                {bo.length > 0 && bo.map(b => (
                  <span key={b.id} style={{fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:8,background:"rgba(245,158,11,0.22)",color:"#f59e0b"}}>{b.name}</span>
                ))}
                {isLong && (
                  <span style={{fontSize:10,fontWeight:800,padding:"2px 7px",borderRadius:8,background:"rgba(6,182,212,0.22)",color:"#06b6d4",letterSpacing:0.5}}>3-DAY (DSISD)</span>
                )}
                <span style={{fontSize:11,color:C.mut,marginLeft:"auto"}}>{tn.length} tournament{tn.length===1?"":"s"}</span>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                {tn.map(t => (
                  <div key={t.id}
                    onClick={()=>openEditTournament(t)}
                    title="Click to view / edit"
                    style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",background:C.bg,borderRadius:6,border:"1px solid "+C.border,cursor:"pointer",fontSize:11,flexWrap:"wrap"}}>
                    {t.is_qualifier && <span style={{fontSize:9,fontWeight:800,padding:"1px 6px",borderRadius:8,background:"rgba(168,85,247,0.22)",color:"#a855f7",letterSpacing:0.5,whiteSpace:"nowrap"}}>QUALIFIER</span>}
                    <span style={{fontWeight:700,color:C.text,flex:"1 1 220px",minWidth:0}}>{t.name}</span>
                    {ageLabel(t) && <span style={{fontSize:10,color:C.mut,whiteSpace:"nowrap"}}>{ageLabel(t)}</span>}
                    {t.gender && <span style={{fontSize:10,color:C.mut,whiteSpace:"nowrap"}}>{t.gender}</span>}
                    {t.location && <span style={{fontSize:10,color:C.mut,whiteSpace:"nowrap"}}>{t.location}</span>}
                    {Array.isArray(t.divisions) && t.divisions.length > 0 && (
                      <span style={{display:"inline-flex",gap:3,flexWrap:"wrap"}}>
                        {t.divisions.slice(0,6).map(d => (
                          <span key={d} style={{fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:8,background:"rgba(233,30,140,0.18)",color:C.gold,whiteSpace:"nowrap"}}>{d}</span>
                        ))}
                        {t.divisions.length > 6 && <span style={{fontSize:9,color:C.mut}}>+{t.divisions.length-6}</span>}
                      </span>
                    )}
                    {t.source && <span style={{fontSize:9,color:C.mut,whiteSpace:"nowrap"}}>· {t.source}</span>}
                    {t.status && <span style={{fontSize:9,color:t.status.toLowerCase().includes("open")?C.grn:C.mut,whiteSpace:"nowrap"}}>· {t.status}</span>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Modal: Add OR Edit a tournament. `editingTournament` is set when we
  // opened from a card's Edit button; otherwise we're creating new.
  function renderAddTournament() {
    const lbl = {fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut,marginBottom:4,display:"block"};
    const editInp = {...inpStyle,width:"100%",padding:"8px 10px",fontSize:13};
    const setF = (k, v) => setNewTournament(prev => ({ ...prev, [k]: v }));
    const close = () => { setAddingTournament(false); setEditingTournament(null); };
    const toggleDiv = (d) => setNewTournament(prev => ({
      ...prev,
      divisions: (prev.divisions||[]).includes(d) ? prev.divisions.filter(x=>x!==d) : [...(prev.divisions||[]), d],
    }));
    return (
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:1000,display:"flex",justifyContent:"center",padding:"30px 16px",overflowY:"auto"}} onClick={close}>
        <div style={{background:C.card,borderRadius:16,border:"1px solid "+C.border,maxWidth:640,width:"100%",maxHeight:"90vh",overflowY:"auto",padding:24}} onClick={e=>e.stopPropagation()}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
            <h2 style={{margin:0,fontSize:18,fontWeight:800,color:C.gold}}>{editingTournament ? "Edit Tournament" : "Add Tournament"}</h2>
            <button onClick={close} style={{background:"none",border:"none",color:C.mut,fontSize:22,cursor:"pointer"}}>×</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
            <div style={{gridColumn:"1 / -1"}}><span style={lbl}>Name *</span><input style={editInp} autoFocus value={newTournament.name} onChange={e=>setF("name", e.target.value)} placeholder="e.g. 2027 Lone Star Regional Championship" /></div>
            <div><span style={lbl}>Start Date *</span><input type="date" style={editInp} value={newTournament.start_date} onChange={e=>setF("start_date", e.target.value)} /></div>
            <div><span style={lbl}>End Date *</span><input type="date" style={editInp} value={newTournament.end_date} onChange={e=>setF("end_date", e.target.value)} /></div>
            <div><span style={lbl}>Location (city, state)</span><input style={editInp} value={newTournament.location} onChange={e=>setF("location", e.target.value)} placeholder="e.g. Austin, TX" /></div>
            <div><span style={lbl}>Venue</span><input style={editInp} value={newTournament.venue} onChange={e=>setF("venue", e.target.value)} placeholder="e.g. Austin Convention Center" /></div>
            <div><span style={lbl}>Age Low</span><input type="number" style={editInp} value={newTournament.age_low} onChange={e=>setF("age_low", e.target.value)} placeholder="12" /></div>
            <div><span style={lbl}>Age High</span><input type="number" style={editInp} value={newTournament.age_high} onChange={e=>setF("age_high", e.target.value)} placeholder="18" /></div>
            <div><span style={lbl}>Gender</span>
              <select style={editInp} value={newTournament.gender} onChange={e=>setF("gender", e.target.value)}>
                <option>Female</option><option>Male</option><option>Male / Female</option>
              </select>
            </div>
            <div><span style={lbl}>Source</span>
              <select style={editInp} value={newTournament.source} onChange={e=>setF("source", e.target.value)}>
                <option value="manual">manual</option><option value="USAV">USAV</option><option value="AAU">AAU</option><option value="JVA">JVA</option><option value="Lone Star Region">Lone Star Region</option><option value="other">other</option>
              </select>
            </div>
            <div style={{gridColumn:"1 / -1"}}><span style={lbl}>Status</span><input style={editInp} value={newTournament.status} onChange={e=>setF("status", e.target.value)} placeholder="e.g. Registration Open" /></div>
            <div style={{gridColumn:"1 / -1",display:"flex",alignItems:"center",gap:6}}>
              <input type="checkbox" id="newt-q" checked={newTournament.is_qualifier} onChange={e=>setF("is_qualifier", e.target.checked)} />
              <label htmlFor="newt-q" style={{fontSize:12,color:C.text,cursor:"pointer"}}>Is qualifier</label>
            </div>
            <div style={{gridColumn:"1 / -1"}}>
              <span style={lbl}>Divisions</span>
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                {TN_DIVISIONS.map(d => {
                  const on = (newTournament.divisions||[]).includes(d);
                  return (
                    <span key={d} onClick={()=>toggleDiv(d)}
                      style={{padding:"4px 10px",borderRadius:10,fontSize:11,fontWeight:700,cursor:"pointer",border:on?"1px solid "+C.gold:"1px dashed "+C.border,background:on?"rgba(233,30,140,0.18)":"transparent",color:on?C.gold:C.mut,userSelect:"none"}}>
                      {d}
                    </span>
                  );
                })}
              </div>
            </div>
            <div style={{gridColumn:"1 / -1"}}>
              <span style={lbl}>Wish list (teams that want to go)</span>
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                {teamsList.filter(t => t.active).map(t => {
                  const on = (newTournament.wish_list||[]).includes(t.id);
                  return (
                    <span key={t.id}
                      onClick={()=>setNewTournament(prev => ({
                        ...prev,
                        wish_list: (prev.wish_list||[]).includes(t.id)
                          ? prev.wish_list.filter(x=>x!==t.id)
                          : [...(prev.wish_list||[]), t.id],
                      }))}
                      title={on ? "Remove from "+t.id+" wish list" : "Add to "+t.id+" wish list"}
                      style={{padding:"4px 10px",borderRadius:10,fontSize:11,fontWeight:700,cursor:"pointer",border:on?"1px solid #f59e0b":"1px dashed "+C.border,background:on?"rgba(245,158,11,0.18)":"transparent",color:on?"#f59e0b":C.mut,userSelect:"none"}}>
                      {on ? "★ " : ""}{t.id}
                    </span>
                  );
                })}
                {teamsList.filter(t => t.active).length === 0 && (
                  <span style={{fontSize:11,color:C.mut,fontStyle:"italic"}}>No active teams. Add teams in the Teams tab first.</span>
                )}
              </div>
            </div>
            <div style={{gridColumn:"1 / -1"}}><span style={lbl}>Notes</span><textarea style={{...editInp,minHeight:60,resize:"vertical"}} value={newTournament.notes} onChange={e=>setF("notes", e.target.value)} /></div>
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end",alignItems:"center"}}>
            {editingTournament && (
              <button onClick={()=>{ deleteTournament(editingTournament.id, editingTournament.name); close(); }}
                style={{padding:"10px 14px",borderRadius:8,border:"1px solid "+C.red,background:"transparent",color:C.red,fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit",marginRight:"auto"}}>
                Delete tournament
              </button>
            )}
            <button onClick={close} style={{padding:"10px 18px",borderRadius:8,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
            <button onClick={saveTournament} style={{padding:"10px 18px",borderRadius:8,border:"none",background:C.gold,color:"#000",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>{editingTournament ? "Save changes" : "Save"}</button>
          </div>
        </div>
      </div>
    );
  }

  // ─── BULK IMPORT TOURNAMENTS MODAL ───
  // Paste raw text (USAV / TournamentCentral format), preview what was
  // parsed, dedup against (name + start_date) in the DB, import the new
  // ones. The Source dropdown is there for future formats (AAU, JVA, etc.).
  function renderBulkImport() {
    const lbl = {fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut,marginBottom:4,display:"block"};
    const close = () => { setBulkImportOpen(false); };
    const { parsed, newOnes, dupes } = bulkImportPreview;
    return (
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:1000,display:"flex",justifyContent:"center",padding:"30px 16px",overflowY:"auto"}} onClick={close}>
        <div style={{background:C.card,borderRadius:16,border:"1px solid "+C.border,maxWidth:780,width:"100%",maxHeight:"92vh",overflowY:"auto",padding:24}} onClick={e=>e.stopPropagation()}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
            <div>
              <h2 style={{margin:0,fontSize:18,fontWeight:800,color:C.gold}}>Bulk Import Tournaments</h2>
              <div style={{fontSize:11,color:C.mut,marginTop:3,lineHeight:1.5}}>
                Paste the tournament listings from USAV / TournamentCentral exactly as you see them. The parser pulls out name, dates, location, age range, gender, and status, then imports any that aren't already in the database (matched by name + start date).
              </div>
            </div>
            <button onClick={close} style={{background:"none",border:"none",color:C.mut,fontSize:22,cursor:"pointer"}}>×</button>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8,flexWrap:"wrap"}}>
            <span style={lbl}>Source format:</span>
            <select value={bulkImportSource} onChange={e=>setBulkImportSource(e.target.value)}
              style={{...inpStyle,padding:"5px 10px",fontSize:12}}>
              <option value="USAV">USAV / TournamentCentral</option>
              <option value="JVC">JVC Tournaments (NIKE / Boston / NERVA)</option>
              <option value="SportWrench">SportWrench (AAU / USAV / JVA listings)</option>
            </select>
            <span style={{fontSize:10,color:C.mut,fontStyle:"italic"}}>Send me another source's text if you need a parser for it.</span>
          </div>
          <textarea value={bulkImportText} onChange={e=>setBulkImportText(e.target.value)}
            placeholder={bulkImportSource === "JVC"
              ? "Paste the JVC listing text here. Expected format:\n\nDECEMBER 2026\n\nDec. 12-13:  NIKE Florida Holiday Challenge  (Daytona Beach, FL)\nGirls 10-18s\n\nDec. 12-13:  NIKE Wicked Good Challenge (Providence, RI)\nGirls 12-16s, 17 Club"
              : bulkImportSource === "SportWrench"
              ? "Paste the SportWrench listing text here. Anchor pattern:\n\nTournament Name\nCity, ST Venue Name\n\nLocation\n\nFavorite\n\n[Additional Info or Main Info block]\nMonth D–D, YYYY\n…"
              : "Paste the USAV / TournamentCentral text here. Expected format:\n\n2027 Some Tournament Name\nThree Day Format Age: 12-18 Female\nJan 16, 2027 - Jan 18, 2027\nAustin, TX - Some Venue\nRegistration Open"}
            style={{...inpStyle,width:"100%",minHeight:280,padding:"10px 12px",fontSize:12,fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace",resize:"vertical"}} />
          {/* Live preview */}
          {bulkImportText.trim() ? (
            <div style={{marginTop:12,padding:"10px 12px",background:C.bg,borderRadius:8,border:"1px solid "+C.border}}>
              <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:8}}>
                <span style={{fontSize:12,color:C.text,fontWeight:700}}>
                  Parsed {parsed.length} tournament{parsed.length===1?"":"s"}
                </span>
                {newOnes.length > 0 && <span style={{fontSize:11,color:C.grn,fontWeight:700}}>· {newOnes.length} new</span>}
                {dupes.length > 0 && <span style={{fontSize:11,color:C.mut,fontWeight:700}}>· {dupes.length} already in DB</span>}
                {parsed.length === 0 && <span style={{fontSize:11,color:C.red}}>· couldn't recognize this format</span>}
              </div>
              {parsed.length > 0 && (
                <div style={{maxHeight:240,overflowY:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                    <thead><tr>
                      <th style={{textAlign:"left",padding:"4px 6px",color:C.mut,borderBottom:"1px solid "+C.border,fontSize:10,textTransform:"uppercase"}}>Status</th>
                      <th style={{textAlign:"left",padding:"4px 6px",color:C.mut,borderBottom:"1px solid "+C.border,fontSize:10,textTransform:"uppercase"}}>Dates</th>
                      <th style={{textAlign:"left",padding:"4px 6px",color:C.mut,borderBottom:"1px solid "+C.border,fontSize:10,textTransform:"uppercase"}}>Name</th>
                      <th style={{textAlign:"left",padding:"4px 6px",color:C.mut,borderBottom:"1px solid "+C.border,fontSize:10,textTransform:"uppercase"}}>Ages</th>
                      <th style={{textAlign:"left",padding:"4px 6px",color:C.mut,borderBottom:"1px solid "+C.border,fontSize:10,textTransform:"uppercase"}}>Location</th>
                    </tr></thead>
                    <tbody>
                      {parsed.map((p, i) => {
                        const k = (p.name + "|" + p.start_date).toLowerCase();
                        const isDupe = dupes.some(d => (d.name + "|" + d.start_date).toLowerCase() === k);
                        return (
                          <tr key={i} style={{opacity:isDupe?0.5:1}}>
                            <td style={{padding:"4px 6px",color:isDupe?C.mut:C.grn,fontWeight:700,fontSize:10,whiteSpace:"nowrap"}}>{isDupe ? "DUP" : "NEW"}</td>
                            <td style={{padding:"4px 6px",color:C.mut,whiteSpace:"nowrap"}}>{p.start_date}{p.start_date!==p.end_date?" → "+p.end_date:""}</td>
                            <td style={{padding:"4px 6px",color:C.text,fontWeight:p.cancelled?400:600,textDecoration:p.cancelled?"line-through":"none"}}>{p.name}</td>
                            <td style={{padding:"4px 6px",color:C.mut,whiteSpace:"nowrap"}}>U{p.age_low}–U{p.age_high} {p.gender}</td>
                            <td style={{padding:"4px 6px",color:C.mut}}>{p.location}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div style={{marginTop:10,fontSize:11,color:C.mut,fontStyle:"italic"}}>Paste tournament listings above and the parsed preview will appear here.</div>
          )}
          <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:14}}>
            <button onClick={close}
              style={{padding:"10px 18px",borderRadius:8,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
              Cancel
            </button>
            <button onClick={importBulkTournaments} disabled={!newOnes.length || bulkImporting}
              style={{padding:"10px 18px",borderRadius:8,border:"none",background:(newOnes.length && !bulkImporting)?C.gold:C.border,color:(newOnes.length && !bulkImporting)?"#000":C.mut,fontWeight:700,fontSize:13,cursor:(newOnes.length && !bulkImporting)?"pointer":"default",fontFamily:"inherit"}}>
              {bulkImporting ? "Importing…" : newOnes.length ? "Import " + newOnes.length + " new" : "Nothing to import"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── ADD PLAYER MODAL ───
  function renderAddPlayer() {
    const lbl = {fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut,marginBottom:4,display:"block"};
    const editInp = {...inpStyle,width:"100%",padding:"8px 10px",fontSize:13};
    const setF = (k, v) => setNewPlayer(prev => ({ ...prev, [k]: v }));
    const computedUsav = newPlayer.dob ? "U" + calcUSAV(newPlayer.dob) : "";
    const close = () => { setAddingPlayer(false); setAddMsg(""); };
    return (
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:1000,display:"flex",justifyContent:"center",padding:"30px 16px",overflowY:"auto"}} onClick={close}>
        <div style={{background:C.card,borderRadius:16,border:"1px solid "+C.border,maxWidth:560,width:"100%",maxHeight:"90vh",overflowY:"auto",padding:24}} onClick={e=>e.stopPropagation()}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}>
            <h2 style={{margin:0,fontSize:20,fontWeight:800,color:C.gold}}>+ Add Player</h2>
            <button style={{background:"none",border:"none",color:C.mut,fontSize:24,cursor:"pointer"}} onClick={close}>✕</button>
          </div>
          <div style={{fontSize:12,color:C.mut,marginBottom:14,fontStyle:"italic"}}>
            For one-off entries (walk-ins, late registrations). Players from the registration CSV come in via "Upload CSV".
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
            <div><span style={lbl}>First Name *</span><input autoFocus style={editInp} value={newPlayer.first_name} onChange={e=>setF("first_name", e.target.value)} /></div>
            <div><span style={lbl}>Last Name *</span><input style={editInp} value={newPlayer.last_name} onChange={e=>setF("last_name", e.target.value)} /></div>
            <div><span style={lbl}>Date of Birth</span><input type="date" style={editInp} value={newPlayer.dob} onChange={e=>setF("dob", e.target.value)} /></div>
            <div>
              <span style={lbl}>USAV Division{computedUsav?" (auto: "+computedUsav+")":""}</span>
              <select style={editInp} value={newPlayer.usav_div} onChange={e=>setF("usav_div", e.target.value)}>
                <option value="">{computedUsav || "Select…"}</option>
                {DIVS.map(d=><option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div><span style={lbl}>Age (optional)</span><input style={editInp} value={newPlayer.age} onChange={e=>setF("age", e.target.value)} placeholder="e.g. 13" /></div>
            <div></div>
          </div>
          <div style={{marginBottom:14}}>
            <span style={lbl}>Positions</span>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{POSITIONS.map(pos => {
              const active = (newPlayer.positions||[]).includes(pos);
              return <button key={pos} style={{padding:"6px 12px",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer",border:active?"2px solid "+C.gold:"1px solid "+C.border,background:active?"rgba(233,30,140,0.15)":"transparent",color:active?C.gold:C.mut,fontFamily:"inherit"}}
                onClick={()=>{ const next = active ? newPlayer.positions.filter(x=>x!==pos) : [...(newPlayer.positions||[]),pos]; setF("positions", next); }}>{pos} - {POS_LABELS[pos]}</button>;
            })}</div>
          </div>
          <div style={{borderTop:"1px solid "+C.border,paddingTop:12,marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:C.gold,marginBottom:8}}>PARENT / GUARDIAN (OPTIONAL)</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div style={{gridColumn:"1 / -1"}}><span style={lbl}>Name</span><input style={editInp} value={newPlayer.parent_name} onChange={e=>setF("parent_name", e.target.value)} /></div>
              <div><span style={lbl}>Email</span><input type="email" style={editInp} value={newPlayer.parent_email} onChange={e=>setF("parent_email", e.target.value)} /></div>
              <div><span style={lbl}>Phone</span><input style={editInp} value={newPlayer.parent_phone} onChange={e=>setF("parent_phone", e.target.value)} placeholder="e.g. 512-555-1234" /></div>
            </div>
          </div>
          {addMsg && <div style={{fontSize:12,marginBottom:10,color:addMsg.startsWith("Error")?C.red:addMsg==="Saving..."?C.mut:C.grn}}>{addMsg}</div>}
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <button onClick={close} style={{padding:"10px 18px",borderRadius:8,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
            <button onClick={handleAddPlayer} disabled={addMsg==="Saving..."} style={{padding:"10px 18px",borderRadius:8,border:"none",background:C.gold,color:"#000",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit",opacity:addMsg==="Saving..."?0.5:1}}>Add Player</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{fontFamily:"Outfit,sans-serif",background:C.bg,color:C.text,minHeight:"100vh"}}>
      <header style={{background:"linear-gradient(135deg,#0f0f0f,#1a1a1a)",borderBottom:"1px solid "+C.border,padding:"12px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
        <div style={{fontSize:19,fontWeight:800,color:C.gold,display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:22}}>◆</span> DS ELITE
          <span style={{fontSize:11,fontWeight:400,color:C.mut,marginLeft:6}}>2026-27 Tryouts</span>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <nav style={{display:"flex",gap:3,flexWrap:"wrap"}}>
            {[
              ["dashboard","Dashboard"],
              ["evaluate","Evaluate"],
              ["teams","Teams"],
              ["tracker","Tracker"],
              ["rankings","Rankings"],
              ["tournaments","Tournaments"],
              ["activity","Activity"],
              ...(isAdmin ? [["coaches","Coaches"]] : []),
            ].map(([v,l]) =>
              <button key={v} style={{padding:"6px 14px",borderRadius:8,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600,background:view===v?C.gold:"transparent",color:view===v?"#000":C.mut}} onClick={()=>setView(v)}>{l}</button>
            )}
          </nav>
          <button onClick={openAddPlayer} title="Add a player from any view"
            style={{padding:"6px 12px",borderRadius:8,border:"1px solid "+C.gold,background:"transparent",color:C.gold,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700}}>
            + Add Player
          </button>
          <div style={{display:"flex",alignItems:"center",gap:6,marginLeft:6,paddingLeft:10,borderLeft:"1px solid "+C.border}}>
            <span style={{fontSize:11,color:C.mut}} title={coach.email}>
              {coach.display_name || coach.email}{isAdmin && <span style={{color:C.gold,marginLeft:4,fontSize:9}}>ADMIN</span>}
            </span>
            <button onClick={async ()=>{ await supabase.auth.signOut(); }}
              title="Sign out"
              style={{padding:"4px 10px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,cursor:"pointer",fontFamily:"inherit",fontSize:10,fontWeight:700}}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      {/* Admin notification: a coach has signed up and is waiting for
          approval. Loaded eagerly via the always-on loadCoaches effect so
          this banner shows on every tab, not just the Coaches one. */}
      {isAdmin && (() => {
        const pending = coachesList.filter(c => !c.is_approved);
        if (pending.length === 0 || view === "coaches") return null;
        return (
          <div style={{background:"rgba(245,158,11,0.10)",borderBottom:"1px solid rgba(245,158,11,0.4)",padding:"8px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
            <span style={{fontSize:12,color:"#f59e0b",fontWeight:600}}>
              {pending.length} coach{pending.length === 1 ? " is" : "es are"} waiting for approval{pending.length <= 3 ? ": " + pending.map(c => c.display_name || c.email).join(", ") : ""}.
            </span>
            <button onClick={() => setView("coaches")}
              style={{padding:"5px 12px",borderRadius:6,border:"1px solid #f59e0b",background:"transparent",color:"#f59e0b",fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer"}}>
              Review
            </button>
          </div>
        );
      })()}
      {view !== "dashboard" && view !== "activity" && view !== "coaches" && view !== "tournaments" && (
        <div style={{display:"flex",gap:4,padding:"10px 18px",borderBottom:"1px solid "+C.border,flexWrap:"wrap"}}>
          {divsWithPlayers.map(d => {
            const isSelected = selectedDivs.includes(d);
            const isLast = isSelected && selectedDivs.length === 1;
            return <button key={d}
              title={isLast ? "At least one age group must be selected" : (isSelected ? "Click to remove "+d : "Click to add "+d)}
              style={{padding:"5px 14px",borderRadius:16,border:"1px solid "+(isSelected?C.gold:C.border),background:isSelected?"rgba(233,30,140,0.12)":"transparent",color:isSelected?C.gold:C.mut,cursor:isLast?"default":"pointer",opacity:isLast?0.85:1,fontFamily:"inherit",fontSize:12,fontWeight:600}}
              onClick={()=>{
                setSelectedDivs(prev => {
                  if (prev.includes(d)) {
                    return prev.length > 1 ? prev.filter(x => x !== d) : prev;
                  }
                  return [...prev, d];
                });
              }}>
              {d} ({players.filter(p=>(p.usavDiv||p.usav_div)===d).length})
            </button>;
          })}
        </div>
      )}
      <div style={{padding:"14px 18px",maxWidth:1500,margin:"0 auto"}}>
        {view==="dashboard" && renderDashboard()}
        {view==="evaluate" && renderEval()}
        {view==="teams" && renderTeams()}
        {view==="tracker" && renderTracker()}
        {view==="rankings" && renderRankings()}
        {view==="activity" && renderActivity()}
        {view==="coaches"  && renderCoaches()}
        {view==="tournaments" && renderTournaments()}
      </div>
      {profileId !== null && renderProfile()}
      {addingPlayer && renderAddPlayer()}
      {addingTournament && renderAddTournament()}
      {bulkImportOpen && renderBulkImport()}
    </div>
  );
}
