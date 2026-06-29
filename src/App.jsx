import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from "react";
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
// ── Per-team operational checklist (see migrations/20260629_team_operations_checklist) ──
// COACH_TASKS: things each coach does for their team (status + notes + questions).
// OPS_TASKS: things the directors do per team (status set from the All Teams list).
const COACH_TASKS = [
  { key:"welcome_email",    label:"Welcome Email to Players", detail:"Inform them of summer practice times, coaches' backgrounds, that the tournament schedule will be published end of summer, ask for team moms, etc." },
  { key:"diamond_training", label:"Sign Up for Diamond Training Program", detail:"In SportsYou" },
  { key:"coaches_meeting",  label:"Sign Up for Coaches Meeting & Party", detail:"In SportsYou" },
  { key:"background_check",  label:"Complete Background Check" },
  { key:"impact_safesport", label:"Complete Impact & SafeSport Training" },
];
const OPS_TASKS = [
  { key:"team_finalized",       label:"Team Finalized" },
  { key:"sportsyou_setup",      label:"SportsYou Set Up" },
  { key:"practices_scheduled",  label:"Practices Scheduled" },
  { key:"tournaments_scheduled",label:"Tournaments Scheduled" },
  { key:"team_building_event",  label:"Team Building Event Scheduled" },
];
const TASK_NEXT = { not_started:"in_progress", in_progress:"done", done:"not_started" };
const TASK_LABELS = Object.fromEntries([...COACH_TASKS, ...OPS_TASKS].map(i => [i.key, i.label]));
const taskStatusMeta = (st) => ({
  not_started: { label:"Not Started", fg:C.mut,    bg:"transparent",            border:"1px solid "+C.border },
  in_progress: { label:"In Progress", fg:"#f59e0b", bg:"rgba(245,158,11,0.18)", border:"1px solid #f59e0b" },
  done:        { label:"✓ Done",      fg:C.grn,    bg:"rgba(34,197,94,0.22)",   border:"1px solid "+C.grn },
}[st] || { label:"Not Started", fg:C.mut, bg:"transparent", border:"1px solid "+C.border });
const CLINIC_DIVS = ["U13","U14","U15","U16","U17"];
// Specific National Team ID Clinic dates a player attended (multi-select).
// Mirrors the EVAL_DATES pattern — short M/D strings. Edit here when the
// club adds more clinic dates.
const CLINIC_DATES = ["6/2"];
const TM = {U10:[],U11:["11 Diamond","11 Rise 1"],U12:["12 Diamond","12 Ruby","12 Rise 1","12 Rise 2"],U13:["13 Diamond","13 Ruby","13 Sapphire","13 Rise"],U14:["14 Diamond","14 Ruby","14 Sapphire","14 Emerald","14 Topaz"],U15:["15 Diamond","15 Ruby","15 Sapphire","15 Emerald"],U16:["16 Diamond","16 Ruby"],U17:["17 Diamond"]};
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
// Internal identifier for the single shared "guest" login. The shared-device
// user only ever types a password; this email is filled in automatically.
const GUEST_EMAIL = "guest@dselitevolleyball.com";
// Player status — kept in sync with the team-card "+offer" chip (offer_status).
// The first six mirror the chip's cycle; the last two are board placements.
const STATUS_OPTS = ["In Progress","Locked","Offered","Accepted","Waiting","Declined","Open Team","Not Invited"];
const STATUS_COLORS = {"In Progress":"#999999","Locked":"#a855f7","Offered":"#f59e0b","Accepted":"#22c55e","Waiting":"#06b6d4","Declined":"#ef4444","Open Team":"#3b82f6","Not Invited":"#666666","No Offer":"#666666"};
// Map between the offer chip (offer_status) and the Status dropdown (status).
const OFFER_TO_STATUS = { "":"In Progress", locked:"Locked", made:"Offered", accepted:"Accepted", waiting:"Waiting", declined:"Declined", not_invited:"Not Invited" };
const STATUS_TO_OFFER = { "In Progress":"", "Open Team":"", Locked:"locked", Offered:"made", Accepted:"accepted", Waiting:"waiting", Declined:"declined", "Not Invited":"not_invited" };
const C = {bg:"#0a0a0a",card:"#141414",border:"#2a2a2a",gold:"#e91e8c",text:"#ffffff",mut:"#999999",acc:"#ff69b4",red:"#ef4444",grn:"#22c55e"};
// Only these owner emails may open the Coaches management screen. UI-level gate.
const OWNER_EMAILS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];
// Convert a base64url VAPID key to the Uint8Array the Push API expects.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
// Where coach "request a schedule change" emails are sent.
const DIRECTOR_EMAIL = "drew@dselitevolleyball.com";

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
// Vertical jump (inches) = jump touch − standing reach. Null if either is blank.
function vertical(p) {
  const j = parseFloat(p.jump_touch), s = parseFloat(p.stand_reach);
  return (Number.isFinite(j) && Number.isFinite(s)) ? (j - s) : null;
}
// ── Practice schedule display helpers ──
const PRACTICE_PHASES = [
  { id:"summer", label:"Summer" },
  { id:"fall1",  label:"Fall 1" },
  { id:"fall2",  label:"Fall 2" },
  { id:"season", label:"Regular Season" },
];
const PRACTICE_DAY_ORDER = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
// Slots look like "12-1pm", "5-7pm" — all afternoon/evening. Parse to 24h ordinals
// (12=noon, 1pm=13 … 9pm=21) so we can detect + merge adjacent ranges.
function parsePracticeSlot(slot) {
  const m = (slot || "").match(/^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*pm\s*$/i);
  if (!m) return null;
  const to24 = h => (h === 12 ? 12 : h + 12);
  return { start: to24(parseInt(m[1], 10)), end: to24(parseInt(m[2], 10)) };
}
function fmtPracticeRange(start, end) {
  const to12 = h => (h === 12 ? 12 : h - 12);
  return to12(start) + "-" + to12(end) + "pm";
}
// Merge adjacent/overlapping hour slots into single ranges (12-1pm + 1-2pm → 12-2pm).
function mergeAdjacentSlots(slots) {
  const parsed = slots.map(parsePracticeSlot).filter(Boolean).sort((a, b) => a.start - b.start);
  if (!parsed.length) return [...new Set(slots)];
  const out = [];
  let cur = { ...parsed[0] };
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i].start <= cur.end) cur.end = Math.max(cur.end, parsed[i].end);
    else { out.push(cur); cur = { ...parsed[i] }; }
  }
  out.push(cur);
  return out.map(r => fmtPracticeRange(r.start, r.end));
}
// Summarize practice assignments across every phase, merging adjacent slots per
// (phase, team, day). Returns one section per phase that has any practices.
function summarizePractices(assignments) {
  return PRACTICE_PHASES.map(ph => {
    const inPhase = assignments.filter(a => (a.phase || "fall1") === ph.id);
    if (!inPhase.length) return null;
    const groups = {};
    inPhase.forEach(a => {
      const k = (a.team_name || "") + "|" + a.day;
      (groups[k] = groups[k] || { team: a.team_name, day: a.day, slots: [] }).slots.push(a.slot);
    });
    const entries = Object.values(groups)
      .sort((a, b) => (PRACTICE_DAY_ORDER[a.day] ?? 99) - (PRACTICE_DAY_ORDER[b.day] ?? 99) || (a.team || "").localeCompare(b.team || ""))
      .flatMap(g => mergeAdjacentSlots(g.slots).map(slot => ({ team: g.team, day: g.day, slot })));
    return { id: ph.id, label: ph.label, entries };
  }).filter(Boolean);
}
// A player counts as a returning DS Elite athlete if her Prev Season Team field
// names DSE / DS Elite. Coaches can correct false positives/negatives by editing
// the "Prev Season Team" value in the profile modal.
function isReturningDSE(p) {
  const t = (p.current_team || "").toUpperCase();
  return t.includes("DSE") || t.includes("DS ELITE");
}
// Highlights players added to the DB in the last 5 days — surfaces fresh CSV uploads.
const NEW_PLAYER_WINDOW_MS = 5 * 24 * 60 * 60 * 1000;
function isNewPlayer(p) {
  if (!p.created_at) return false;
  const t = new Date(p.created_at).getTime();
  return Number.isFinite(t) && (Date.now() - t) < NEW_PLAYER_WINDOW_MS;
}
// Small green "NEW" badge for players added within the window above. Shown next
// to the player's name everywhere the returning-athlete ◆ marker appears.
function newIcon(p) {
  return isNewPlayer(p)
    ? <span title="New — added in the last 5 days" style={{display:"inline-block",padding:"1px 6px",borderRadius:9,fontSize:9,fontWeight:800,letterSpacing:0.3,background:C.grn+"22",color:C.grn,lineHeight:1.5,verticalAlign:"middle"}}>NEW</span>
    : null;
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
  // Practice schedule tab state
  const [practiceTeams, setPracticeTeams]             = useState([]);
  const [practiceAssignments, setPracticeAssignments] = useState([]);
  const [saSessions, setSaSessions]                   = useState([]);
  const [floatingCoaches, setFloatingCoaches]         = useState([]);
  const [snapshots, setSnapshots]                     = useState([]);
  // Fires the "save a restore point first" nudge at most once per practice session.
  const practiceEditReminded = useRef(false);
  const [saBlock, setSaBlock]                         = useState(
    () => (typeof localStorage !== "undefined" && localStorage.getItem("dse_sa_block")) || "fall_b1"
  );
  useEffect(() => {
    if (typeof localStorage !== "undefined") localStorage.setItem("dse_sa_block", saBlock);
  }, [saBlock]);
  const [practiceCoachFilter, setPracticeCoachFilter] = useState("");
  const [teamCardName, setTeamCardName]               = useState(null); // unified team-detail modal
  const [coachCardName, setCoachCardName]             = useState(null); // unified coach-detail modal
  const [teamDirSearch, setTeamDirSearch]             = useState("");   // All Teams directory search
  // 'season' (regular full-week 2–3×/week practices), 'summer' (Jul–Sep, Sunday
  // preseason), 'fall1' (Sep 13–Oct 11), or 'fall2' (Oct 18–Nov 15). The old
  // 'preseason' name maps to 'summer'; 'season' is kept (it holds the regular
  // schedule and must stay visible).
  const [schedulePhase, setSchedulePhase]             = useState(() => {
    if (typeof localStorage === "undefined") return "season";
    const v = localStorage.getItem("dse_practice_phase");
    if (v === "preseason") return "summer";
    return v || "season";
  });
  useEffect(() => {
    if (typeof localStorage !== "undefined") localStorage.setItem("dse_practice_phase", schedulePhase);
  }, [schedulePhase]);
  const [tryouts, setTryouts]                         = useState([]);
  const [coachRoster, setCoachRoster]                 = useState([]);
  // SMS state
  const [smsThreads, setSmsThreads]                   = useState([]);
  const [smsMessages, setSmsMessages]                 = useState([]);
  const [selectedThreadId, setSelectedThreadId]       = useState(null);
  const [smsCompose, setSmsCompose]                   = useState("");
  const [smsSending, setSmsSending]                   = useState(false);
  // Bulk email (send-only) state
  const [emailGroupScope, setEmailGroupScope]         = useState({});     // { [div]: "all"|"tryout"|"eval"|"none" } — default "all"
  const [emailTeam, setEmailTeam]                     = useState("");    // "" any | "__has" | "__none" | team name
  const [emailStatus, setEmailStatus]                 = useState("");    // "" any | a STATUS_OPTS value
  const [emailSubject, setEmailSubject]               = useState("");
  const [emailBody, setEmailBody]                     = useState("");
  const [emailSending, setEmailSending]               = useState(false);
  const [emailResult, setEmailResult]                 = useState(null);
  const [emailErr, setEmailErr]                       = useState("");
  const [emailShowList, setEmailShowList]             = useState(false);
  const [emailShowMissing, setEmailShowMissing]       = useState(false);
  const [emailShowExcluded, setEmailShowExcluded]     = useState(false);
  const [emailExcluded, setEmailExcluded]             = useState(() => new Set()); // player ids opted out of the current send
  const [emailTemplates, setEmailTemplates]           = useState(() => {
    try { return JSON.parse((typeof localStorage !== "undefined" && localStorage.getItem("dse_email_templates")) || "[]"); }
    catch { return []; }
  });
  const [emailTemplateSel, setEmailTemplateSel]       = useState("");
  const [teamsList, setTeamsList]                           = useState([]);
  const [teamStatus, setTeamStatus]                         = useState({}); // { [team_name]: { status, looking_positions } }
  const [teamTasks, setTeamTasks]                           = useState({}); // { `${team}|${item}`: { status, notes } }
  const [teamQuestions, setTeamQuestions]                   = useState([]); // coach→director questions
  const [qDraft, setQDraft]                                 = useState({}); // { `${team}|${item}`: text } ask-a-question drafts
  const [aDraft, setADraft]                                 = useState({}); // { [questionId]: text } answer drafts
  const [taskMeta, setTaskMeta]                             = useState({}); // { [item_key]: description } admin-editable
  const [updates, setUpdates]                               = useState([]); // club-wide announcements
  const [updateDraft, setUpdateDraft]                       = useState(""); // new-update composer
  const [updateTeamTarget, setUpdateTeamTarget]             = useState(""); // "" = club-wide; else a team name
  const [showChecklistSetup, setShowChecklistSetup]         = useState(false);
  const [practiceApprovals, setPracticeApprovals]           = useState({}); // { [team_name]: { approved, approved_by_name, approved_at } }
  const [schedChangeOpen, setSchedChangeOpen]               = useState({}); // { [team]: bool } request-a-change composer open
  const [schedChangeDraft, setSchedChangeDraft]             = useState({}); // { [team]: text }
  const [schedChangeSending, setSchedChangeSending]         = useState(""); // team currently emailing
  const [notifOpen, setNotifOpen]                           = useState(false); // notification bell dropdown
  const [notifSeenAt, setNotifSeenAt]                       = useState("1970-01-01T00:00:00.000Z"); // last time notifications were viewed
  const [pushState, setPushState]                          = useState("loading"); // unsupported | off | on | denied
  const [blackoutDates, setBlackoutDates]                   = useState([]);
  const [tnFilters, setTnFilters]                           = useState({ search: "", ageFor: "", qualifierOnly: false, dateFrom: "", dateTo: "", hideClosed: false, hideCancelled: true, startsOn: [], state: "", numDays: "", divisions: [], tags: [] });
  const [tnView, setTnView]                                 = useState("list"); // "list" | "calendar"
  const [tnSelectedTeams, setTnSelectedTeams]               = useState(new Set()); // empty = all shown
  const [tnCalFrom, setTnCalFrom]                           = useState("2026-12-01");
  const [tnCalTo, setTnCalTo]                               = useState("2027-06-30");
  // Month being shown in the Month View calendar; YYYY-MM-01 string.
  // Default to today's month so it lands on something relevant on open.
  const [tnMonthCursor, setTnMonthCursor]                   = useState(() => {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-01";
  });
  const [addingTournament, setAddingTournament]             = useState(false);
  const [addingCoach, setAddingCoach]                       = useState(false);
  const [newCoach, setNewCoach]                             = useState({ first_name:"", last_name:"", email:"", phone:"", tshirt_size:"", shoe_size:"", sweatshirt_size:"", notes:"" });
  const [guestPassword, setGuestPassword]                   = useState("");
  const [guestAgeGroups, setGuestAgeGroups]                 = useState([]);
  const [guestBusy, setGuestBusy]                           = useState(false);
  const [guestMsg, setGuestMsg]                             = useState("");
  // Physical-testing height input unit. Values are always STORED in inches;
  // this only controls how the form's height fields are typed/shown.
  const [phUnit, setPhUnit] = useState(() => {
    try { return (typeof localStorage !== "undefined" && localStorage.getItem("dse_ph_unit")) || "in"; } catch { return "in"; }
  });
  useEffect(() => { try { localStorage.setItem("dse_ph_unit", phUnit); } catch {} }, [phUnit]);
  const [editingTournament, setEditingTournament]           = useState(null);
  const [newTournament, setNewTournament]                   = useState({ name: "", start_date: "", end_date: "", location: "", venue: "", age_low: "", age_high: "", gender: "Female", is_qualifier: false, source: "manual", status: "", notes: "", divisions: [], entries: [] });
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
  // Only the owner (Drew) can reach the Coaches screen. Team-list access is a
  // per-coach flag managed there; the owner always has access.
  const isOwner      = OWNER_EMAILS.includes((coach?.email || "").trim().toLowerCase());
  const canViewTeams = isOwner || !!coach?.can_view_teams;
  // Operations are admin-only: the whole "Operations" nav group and the views
  // behind it are hidden and blocked for non-admin coaches. The owner (Drew)
  // always counts here so a bad DB flag can't lock him out.
  const OPS_VIEWS = new Set(["tracker","teamdir","coaches","practice","email","messages","scholarships"]);
  const canOps    = isAdmin || isOwner;
  const opsDenied = <div style={{padding:24,color:C.mut,textAlign:"center"}}>This section is restricted to administrators. Ask the club administrator (Drew) for access.</div>;
  // Scholarship amounts are admin-only. Strip scholarship_amount from change_log
  // entries so non-admins can't see them via the Activity feed or a player's
  // Change History. Returns a cleaned list with now-empty update rows dropped.
  const scrubScholarship = (entries) => {
    if (canOps) return entries;
    return (entries || [])
      .map(e => {
        if (e.action === "update" && e.field_changes && "scholarship_amount" in e.field_changes) {
          const fc = { ...e.field_changes }; delete fc.scholarship_amount;
          return { ...e, field_changes: fc };
        }
        return e;
      })
      .filter(e => !(e.action === "update" && e.field_changes && Object.keys(e.field_changes).length === 0));
  };
  // Age groups this coach may see across Evaluate/Teams/Rankings. Owner sees
  // all; an empty team_divs also means all (default) — a non-empty list restricts.
  const allowedDivs   = isOwner
    ? DIVS
    : ((Array.isArray(coach?.team_divs) && coach.team_divs.length) ? DIVS.filter(d => coach.team_divs.includes(d)) : DIVS);
  const allowedDivSet = new Set(allowedDivs);

  const [players, setPlayers] = useState([]);
  const [favorites, setFavorites] = useState([]); // player_ids the current coach favorited
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("home");
  // Physical Testing tab — dot-plot of a physical metric per player. Age group
  // comes from the global selectedDivs chips; these add team/position filters
  // and pick which metric drives the horizontal axis.
  // Physical Testing is an X/Y scatter: one dot per player at (X metric, Y metric).
  const [ptX, setPtX]       = useState("sprint_10y"); // horizontal axis metric
  const [ptY, setPtY]       = useState("vertical");   // vertical axis metric
  const [ptTeam, setPtTeam] = useState("");           // "" = all teams
  const [ptPos, setPtPos]   = useState("");           // "" = all positions
  // Owner-only "Ask AI" tab — natural-language questions over the player data.
  const [askQ, setAskQ]           = useState("");
  const [askAnswer, setAskAnswer] = useState("");
  const [askBusy, setAskBusy]     = useState(false);
  const [askErr, setAskErr]       = useState("");
  // Tournament-page Q&A — natural-language questions over the schedule.
  const [tnAskQ, setTnAskQ]           = useState("");
  const [tnAskAnswer, setTnAskAnswer] = useState("");
  const [tnAskBusy, setTnAskBusy]     = useState(false);
  const [tnAskErr, setTnAskErr]       = useState("");
  const [tnAskOpen, setTnAskOpen]     = useState(false);
  // Which nav dropdown ("Tryouts" / "Operations") is open, or null. Click-to-toggle.
  const [openMenu, setOpenMenu] = useState(null);
  // Selected age-group tabs. Multi-select: clicking a tab toggles membership.
  // Always at least one division is selected. Drives Evaluate filter, Teams sections, and Rankings.
  const [selectedDivs, setSelectedDivs] = useState(["U14"]);
  // Keep a restricted coach's selected age tabs within their allowed groups, so
  // Evaluate/Teams/Rankings (all driven by selectedDivs) never show other groups.
  useEffect(() => {
    if (isOwner) return;
    setSelectedDivs(prev => {
      const f = prev.filter(d => allowedDivSet.has(d));
      if (f.length === prev.length) return prev;
      return f.length ? f : (allowedDivs[0] ? [allowedDivs[0]] : []);
    });
  }, [coach]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const [filterAttend, setFilterAttend] = useState("all"); // all | attended | not — tryout attendance
  const [copiedEmails, setCopiedEmails] = useState(false);
  const [copiedPhones, setCopiedPhones] = useState(false);
  const [sortBy, setSortBy] = useState("name");
  // Rankings view column sort: key matches a column id in renderRankings' COLS table.
  const [rankSort, setRankSort] = useState({ key: "total", dir: "desc" });
  const [rankAttended, setRankAttended] = useState(false); // Rankings: show only tryout attendees
  // Rankings view date filter — independent from the Evaluate-tab date filter so
  // switching views doesn't carry the selection over.
  const [rankDate, setRankDate] = useState("");
  const [profileId, setProfileId] = useState(null);
  // Per-player change history (loaded on demand from change_log when the
  // "Change History" dropdown on the profile card is opened).
  const [historyOpen, setHistoryOpen]         = useState(false);
  const [historyRows, setHistoryRows]         = useState([]);
  const [historyLoading, setHistoryLoading]   = useState(false);
  const [historyPlayerId, setHistoryPlayerId] = useState(null);
  // Scholarships (admin-only Operations page) — search box for adding offers.
  const [scholarSearch, setScholarSearch] = useState("");
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
  const [newPlayer, setNewPlayer] = useState({ first_name:"", last_name:"", dob:"", age:"", usav_div:"", positions:[], parent_name:"", parent_email:"", parent_email2:"", parent_phone:"" });
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

  // Per-coach favorites. RLS scopes rows to the signed-in coach, so a plain
  // select returns only this coach's shortlist.
  const loadFavorites = useCallback(async () => {
    if (!coach?.id) { setFavorites([]); return; }
    // Filter to THIS coach explicitly — don't rely on RLS alone for isolation.
    const { data, error } = await supabase.from("player_favorites").select("player_id").eq("coach_id", coach.id);
    if (error) { console.error("Load favorites error:", error); return; }
    setFavorites((data || []).map(r => r.player_id));
  }, [coach?.id]);
  useEffect(() => { if (isApproved) loadFavorites(); }, [isApproved, loadFavorites]);
  const toggleFavorite = async (playerId) => {
    if (!coach?.id) return;
    const isFav = favorites.includes(playerId);
    setFavorites(prev => isFav ? prev.filter(id => id !== playerId) : [...prev, playerId]); // optimistic
    const { error } = isFav
      ? await supabase.from("player_favorites").delete().eq("coach_id", coach.id).eq("player_id", playerId)
      : await supabase.from("player_favorites").insert({ coach_id: coach.id, player_id: playerId });
    if (error) { window.alert("Favorite update failed: " + error.message); loadFavorites(); } // resync on error
  };
  // Reusable favorite star — drop next to a player's name anywhere. Stops click
  // and pointer events from bubbling so it won't open a card or start a drag.
  const favStar = (playerId, size = 14) => {
    const on = favorites.includes(playerId);
    return (
      <span onClick={(e) => { e.stopPropagation(); toggleFavorite(playerId); }}
        onPointerDown={(e) => e.stopPropagation()}
        title={on ? "Remove from your favorites" : "Add to your favorites"}
        style={{ cursor: "pointer", fontSize: size, lineHeight: 1, color: on ? C.gold : C.border, userSelect: "none", flexShrink: 0 }}>
        {on ? "★" : "☆"}
      </span>
    );
  };

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
  // Collapse the per-player history whenever the open profile card changes.
  useEffect(() => { setHistoryOpen(false); }, [profileId]);

  // Per-team build status (Teams board). Keyed by team_name. Defined above the
  // realtime effect below because that effect lists it in its dependency array
  // (the deps array is evaluated during render, so the const must exist first).
  const loadTeamStatus = useCallback(async () => {
    const { data, error } = await supabase.from("team_status").select("*");
    if (error) { console.error("Load team_status error:", error); return; }
    const map = {};
    (data || []).forEach(r => { map[r.team_name] = { status: r.status || "in_progress", looking_positions: r.looking_positions || [] }; });
    setTeamStatus(map);
  }, []);
  // Per-team operational checklist (Coach + Ops To-Do) and the coach→director
  // questions. Defined above the realtime effect that lists them in its deps.
  const loadTeamTasks = useCallback(async () => {
    const { data, error } = await supabase.from("team_tasks").select("*");
    if (error) { console.error("Load team_tasks error:", error); return; }
    const map = {};
    (data || []).forEach(r => { map[r.team_name + "|" + r.item_key] = { status: r.status || "not_started", notes: r.notes || "" }; });
    setTeamTasks(map);
  }, []);
  const loadTeamQuestions = useCallback(async () => {
    const { data, error } = await supabase.from("team_questions").select("*").order("created_at", { ascending: false });
    if (error) { console.error("Load team_questions error:", error); return; }
    setTeamQuestions(data || []);
  }, []);
  // Admin-editable item descriptions + club Updates feed.
  const loadTaskMeta = useCallback(async () => {
    const { data, error } = await supabase.from("task_meta").select("*");
    if (error) { console.error("Load task_meta error:", error); return; }
    const map = {};
    (data || []).forEach(r => { map[r.item_key] = r.description || ""; });
    setTaskMeta(map);
  }, []);
  const loadUpdates = useCallback(async () => {
    const { data, error } = await supabase.from("updates").select("*").order("created_at", { ascending: false }).limit(50);
    if (error) { console.error("Load updates error:", error); return; }
    setUpdates(data || []);
  }, []);
  // Per-team practice-schedule approvals.
  const loadPracticeApprovals = useCallback(async () => {
    const { data, error } = await supabase.from("practice_approvals").select("*");
    if (error) { console.error("Load practice_approvals error:", error); return; }
    const map = {};
    (data || []).forEach(r => { map[r.team_name] = { approved: !!r.approved, approved_by_name: r.approved_by_name || "", approved_at: r.approved_at || null }; });
    setPracticeApprovals(map);
  }, []);

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
    const teamStatusChannel = supabase
      .channel("realtime-team_status")
      .on("postgres_changes", { event: "*", schema: "public", table: "team_status" }, () => { loadTeamStatus(); })
      .subscribe();
    const teamTasksChannel = supabase
      .channel("realtime-team_tasks")
      .on("postgres_changes", { event: "*", schema: "public", table: "team_tasks" }, () => { loadTeamTasks(); })
      .subscribe();
    const teamQuestionsChannel = supabase
      .channel("realtime-team_questions")
      .on("postgres_changes", { event: "*", schema: "public", table: "team_questions" }, () => { loadTeamQuestions(); })
      .subscribe();
    const taskMetaChannel = supabase
      .channel("realtime-task_meta")
      .on("postgres_changes", { event: "*", schema: "public", table: "task_meta" }, () => { loadTaskMeta(); })
      .subscribe();
    const updatesChannel = supabase
      .channel("realtime-updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "updates" }, () => { loadUpdates(); })
      .subscribe();
    const practiceApprovalsChannel = supabase
      .channel("realtime-practice_approvals")
      .on("postgres_changes", { event: "*", schema: "public", table: "practice_approvals" }, () => { loadPracticeApprovals(); })
      .subscribe();
    return () => {
      supabase.removeChannel(playerChannel);
      supabase.removeChannel(coachChannel);
      supabase.removeChannel(rankingsChannel);
      supabase.removeChannel(teamStatusChannel);
      supabase.removeChannel(teamTasksChannel);
      supabase.removeChannel(teamQuestionsChannel);
      supabase.removeChannel(taskMetaChannel);
      supabase.removeChannel(updatesChannel);
      supabase.removeChannel(practiceApprovalsChannel);
    };
  }, [isApproved, loadCoaches, loadRankings, loadTeamStatus, loadTeamTasks, loadTeamQuestions, loadTaskMeta, loadUpdates, loadPracticeApprovals]);

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
  useEffect(() => { if (isApproved && (view === "tournaments" || view === "teamdir" || view === "home")) loadTournaments(); }, [isApproved, view, loadTournaments]);

  // Practice tab loader
  const loadPractice = useCallback(async () => {
    const [tRes, aRes, sRes, fRes] = await Promise.all([
      supabase.from("practice_teams").select("*").order("team_name"),
      supabase.from("practice_assignments").select("*"),
      supabase.from("sa_sessions").select("*").order("session_date").order("slot"),
      supabase.from("floating_coaches").select("name"),
    ]);
    if (tRes.error) console.error("Load practice_teams error:", tRes.error);
    if (aRes.error) console.error("Load practice_assignments error:", aRes.error);
    if (sRes.error) console.error("Load sa_sessions error:", sRes.error);
    if (fRes.error) console.error("Load floating_coaches error:", fRes.error);
    setPracticeTeams(tRes.data || []);
    setPracticeAssignments(aRes.data || []);
    setSaSessions(sRes.data || []);
    setFloatingCoaches((fRes.data || []).map(r => r.name));
  }, []);
  const loadSnapshots = useCallback(async () => {
    const { data, error } = await supabase.from("practice_snapshots")
      .select("id, label, created_by, created_at").order("created_at", { ascending: false });
    if (error) { console.error("Load practice_snapshots error:", error); return; }
    setSnapshots(data || []);
  }, []);
  useEffect(() => { if (isApproved && (view === "practice" || view === "teamdir" || view === "home")) loadPractice(); }, [isApproved, view, loadPractice]);
  useEffect(() => { if (isApproved && view === "practice") loadSnapshots(); }, [isApproved, view, loadSnapshots]);
  // Coach/team cards (openable from any view) need practice_teams loaded.
  useEffect(() => { if (isApproved && (coachCardName || teamCardName)) loadPractice(); }, [isApproved, coachCardName, teamCardName, loadPractice]);

  // Tryouts tab loader
  const loadTryouts = useCallback(async () => {
    const { data, error } = await supabase.from("tryouts").select("*").order("start_at");
    if (error) console.error("Load tryouts error:", error);
    setTryouts(data || []);
  }, []);
  useEffect(() => { if (isApproved && view === "tryouts") loadTryouts(); }, [isApproved, view, loadTryouts]);

  useEffect(() => { if (isApproved && (view === "teams" || view === "teamdir" || view === "home" || view === "dashboard")) loadTeamStatus(); }, [isApproved, view, loadTeamStatus]);
  // Operational checklist + questions load on the Home (coaches) and All Teams (admins) views.
  useEffect(() => { if (isApproved && (view === "home" || view === "teamdir")) { loadTeamTasks(); loadTeamQuestions(); } }, [isApproved, view, loadTeamTasks, loadTeamQuestions]);
  // Item descriptions are needed wherever the checklists render; updates show on Home.
  useEffect(() => { if (isApproved && (view === "home" || view === "teamdir")) loadTaskMeta(); }, [isApproved, view, loadTaskMeta]);
  useEffect(() => { if (isApproved && view === "home") loadUpdates(); }, [isApproved, view, loadUpdates]);
  // Notifications need updates + questions loaded on every view (the bell is in the header).
  useEffect(() => { if (isApproved) { loadUpdates(); loadTeamQuestions(); } }, [isApproved, loadUpdates, loadTeamQuestions]);
  useEffect(() => { if (isApproved && (view === "home" || view === "teamdir")) loadPracticeApprovals(); }, [isApproved, view, loadPracticeApprovals]);
  // Optimistically patch local state, then upsert the merged row. `merged` is
  // computed from current state synchronously (NOT inside the setState updater,
  // which React may run later) so the upsert payload is always complete.
  const updateTeamStatus = useCallback(async (team, patch) => {
    const cur = teamStatus[team] || { status: "in_progress", looking_positions: [] };
    const merged = { status: cur.status || "in_progress", looking_positions: cur.looking_positions || [], ...patch };
    setTeamStatus(prev => ({ ...prev, [team]: { ...(prev[team] || { status: "in_progress", looking_positions: [] }), ...patch } }));
    const { error } = await supabase.from("team_status").upsert(
      { team_name: team, status: merged.status, looking_positions: merged.looking_positions, updated_at: new Date().toISOString() },
      { onConflict: "team_name" }
    );
    if (error) console.error("Save team_status error:", error);
  }, [teamStatus]);

  // Checklist item status/notes. merged computed synchronously from state.
  const updateTeamTask = useCallback(async (team, itemKey, patch) => {
    const k = team + "|" + itemKey;
    const cur = teamTasks[k] || { status: "not_started", notes: "" };
    const merged = { status: cur.status || "not_started", notes: cur.notes || "", ...patch };
    setTeamTasks(prev => ({ ...prev, [k]: { ...(prev[k] || { status: "not_started", notes: "" }), ...patch } }));
    const { error } = await supabase.from("team_tasks").upsert(
      { team_name: team, item_key: itemKey, status: merged.status, notes: merged.notes, updated_at: new Date().toISOString() },
      { onConflict: "team_name,item_key" }
    );
    if (error) console.error("Save team_tasks error:", error);
  }, [teamTasks]);
  // A coach posts a question against a checklist item (notifies directors).
  const askTeamQuestion = useCallback(async (team, itemKey, question) => {
    const q = (question || "").trim();
    if (!q) return;
    const { error } = await supabase.from("team_questions").insert({
      team_name: team, item_key: itemKey, question: q,
      asked_by_name: coach?.display_name || coach?.email || "", asked_by_email: coach?.email || "",
    });
    if (error) { window.alert("Post question failed: " + error.message); return; }
    setQDraft(prev => ({ ...prev, [team + "|" + itemKey]: "" }));
    await loadTeamQuestions();
    fetch("/api/send-push", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New coach question", body: (coach?.display_name || coach?.email || "A coach") + " — " + (TASK_LABELS[itemKey] || itemKey) + " (" + team + ")", url: "/", audience: { type: "admins" } }) }).catch(() => {});
  }, [coach, loadTeamQuestions]);
  // A director answers a pending question.
  const answerTeamQuestion = useCallback(async (id, answer) => {
    const a = (answer || "").trim();
    if (!a) return;
    const { error } = await supabase.from("team_questions").update({
      answer: a, answered_by_name: coach?.display_name || coach?.email || "", answered_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) { window.alert("Answer failed: " + error.message); return; }
    setADraft(prev => { const n = { ...prev }; delete n[id]; return n; });
    await loadTeamQuestions();
    const q = teamQuestions.find(x => x.id === id);
    if (q && q.asked_by_email) {
      fetch("/api/send-push", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Your question was answered", body: (TASK_LABELS[q.item_key] || q.item_key) + " (" + q.team_name + ")", url: "/", audience: { type: "email", email: q.asked_by_email } }) }).catch(() => {});
    }
  }, [coach, loadTeamQuestions, teamQuestions]);
  // Admin: save a global description for a checklist item.
  const saveTaskMeta = useCallback(async (itemKey, description) => {
    setTaskMeta(prev => ({ ...prev, [itemKey]: description }));
    const { error } = await supabase.from("task_meta").upsert(
      { item_key: itemKey, description: description || "", updated_at: new Date().toISOString() },
      { onConflict: "item_key" }
    );
    if (error) console.error("Save task_meta error:", error);
  }, []);
  // Admin: post / delete a club-wide update.
  const postUpdate = useCallback(async (body, teamName) => {
    const b = (body || "").trim();
    if (!b) return;
    const { error } = await supabase.from("updates").insert({
      body: b, team_name: (teamName || "").trim() || null, created_by_name: coach?.display_name || coach?.email || "",
    });
    if (error) { window.alert("Post update failed: " + error.message); return; }
    setUpdateDraft("");
    await loadUpdates();
    const tn = (teamName || "").trim();
    fetch("/api/send-push", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: tn ? "DS Elite · " + tn : "DS Elite Update", body: b, url: "/", audience: tn ? { type: "team", team: tn } : { type: "all" } }) }).catch(() => {});
  }, [coach, loadUpdates]);
  const deleteUpdate = useCallback(async (id) => {
    if (!window.confirm("Delete this update?")) return;
    const { error } = await supabase.from("updates").delete().eq("id", id);
    if (error) { window.alert("Delete failed: " + error.message); return; }
    await loadUpdates();
  }, [loadUpdates]);
  // Coach approves (or un-approves) their team's practice schedule.
  const approvePractice = useCallback(async (team, approved) => {
    const now = approved ? new Date().toISOString() : null;
    const name = approved ? (coach?.display_name || coach?.email || "") : "";
    setPracticeApprovals(prev => ({ ...prev, [team]: { approved, approved_by_name: name, approved_at: now } }));
    const { error } = await supabase.from("practice_approvals").upsert(
      { team_name: team, approved, approved_by_name: name || null, approved_at: now, updated_at: new Date().toISOString() },
      { onConflict: "team_name" }
    );
    if (error) console.error("Save practice_approvals error:", error);
  }, [coach]);
  // Director: notify all coaches to approve their practice schedule (posts an update).
  const requestPracticeApproval = useCallback(async () => {
    if (!window.confirm("Notify all coaches to review and approve their practice schedule?")) return;
    await postUpdate("📋 Please review and approve your team's practice schedule on your Home page, and confirm there are no conflicts.", "");
    window.alert("Coaches notified — the request is posted in Updates.");
  }, [postUpdate]);
  // Coach emails the director a potential practice-schedule change request.
  const requestScheduleChange = useCallback(async (team, message) => {
    const msg = (message || "").trim();
    if (!msg) return;
    setSchedChangeSending(team);
    try {
      const who = coach?.display_name || coach?.email || "A coach";
      const subject = "Practice schedule change request — " + team;
      const lines = [
        who + (coach?.email ? " (" + coach.email + ")" : "") + " is requesting a change to the " + team + " practice schedule.",
        "",
        "Requested change:",
        msg,
        "",
        "Note: this may be hard to accommodate — many coaches are on two teams, so a change to one team's schedule can create conflicts with another. Please review before adjusting.",
      ];
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body: lines.join("\n"), recipients: [DIRECTOR_EMAIL], replyTo: coach?.email || "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Send failed");
      setSchedChangeDraft(prev => ({ ...prev, [team]: "" }));
      setSchedChangeOpen(prev => ({ ...prev, [team]: false }));
      window.alert("Your schedule-change request was emailed to the director.");
    } catch (e) {
      window.alert("Could not send request: " + (e.message || "error"));
    } finally {
      setSchedChangeSending("");
    }
  }, [coach]);

  // ── In-app notifications ────────────────────────────────────────────
  // Coach's team names (for filtering team-targeted updates/notifications).
  const myTeamNames = useMemo(() => {
    const norm = s => (s || "").toString().trim().toLowerCase();
    const myRoster = coachRoster.find(r => coach?.email && norm(r.email) === norm(coach.email));
    const cand = new Set();
    if (coach?.display_name) cand.add(norm(coach.display_name));
    if (myRoster) {
      const f = norm(myRoster.first_name), l = norm(myRoster.last_name);
      if (f) { cand.add((f + " " + l).trim()); cand.add(f); if (l) cand.add((f + " " + l[0] + ".").trim()); }
    }
    const isMine = field => !!field && cand.has(norm(field));
    return practiceTeams.filter(t => isMine(t.head_coach) || isMine(t.assistant_coach)).map(t => t.team_name);
  }, [coach, coachRoster, practiceTeams]);

  // Build the per-user notification list from existing data (updates + Q&A).
  const notifications = useMemo(() => {
    const out = [];
    const mine = new Set(myTeamNames);
    const myEmail = (coach?.email || "").toLowerCase();
    updates.forEach(u => {
      if (!(!u.team_name || canOps || mine.has(u.team_name))) return;
      out.push({ id: "u" + u.id, ts: u.created_at, label: "Update", text: (u.team_name ? "[" + u.team_name + "] " : "") + (u.body || ""), view: "home" });
    });
    teamQuestions.forEach(q => {
      if (canOps && !q.answer) {
        out.push({ id: "q" + q.id, ts: q.created_at, label: "Question", text: (q.asked_by_name || "A coach") + " asked about " + (TASK_LABELS[q.item_key] || q.item_key) + " (" + q.team_name + ")", view: "home" });
      }
      if (q.answer && myEmail && (q.asked_by_email || "").toLowerCase() === myEmail) {
        out.push({ id: "qa" + q.id, ts: q.answered_at || q.created_at, label: "Answered", text: "Your question on " + (TASK_LABELS[q.item_key] || q.item_key) + " (" + q.team_name + ") was answered", view: "home" });
      }
    });
    return out.sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
  }, [updates, teamQuestions, myTeamNames, canOps, coach]);

  // Persisted (per device) "last viewed" marker drives the unread badge.
  const notifKey = coach?.id ? "dse_notif_seen_" + coach.id : "dse_notif_seen";
  useEffect(() => {
    try { setNotifSeenAt(localStorage.getItem(notifKey) || "1970-01-01T00:00:00.000Z"); } catch {}
  }, [notifKey]);
  const markNotifsRead = () => {
    const now = new Date().toISOString();
    setNotifSeenAt(now);
    try { localStorage.setItem(notifKey, now); } catch {}
  };
  const unreadCount = notifications.filter(n => (n.ts || "") > notifSeenAt).length;

  // ── Device push (Web Push) ──────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        if (!("serviceWorker" in navigator) || !("PushManager" in window) || !import.meta.env.VITE_VAPID_PUBLIC_KEY) { setPushState("unsupported"); return; }
        if (typeof Notification !== "undefined" && Notification.permission === "denied") { setPushState("denied"); return; }
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setPushState(sub ? "on" : "off");
      } catch { setPushState("off"); }
    })();
  }, [isApproved]);
  const enablePush = useCallback(async () => {
    try {
      const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY;
      if (!VAPID) { window.alert("Push notifications aren't set up yet."); return; }
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) { window.alert("Push isn't supported on this device/browser."); return; }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setPushState(perm === "denied" ? "denied" : "off"); return; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID) });
      const j = sub.toJSON();
      const { error } = await supabase.from("push_subscriptions").upsert({
        endpoint: sub.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth,
        email: coach?.email || "", is_admin: !!canOps, teams: myTeamNames,
      }, { onConflict: "endpoint" });
      if (error) { console.error("save push sub", error); window.alert("Could not save subscription: " + error.message); return; }
      setPushState("on");
    } catch (e) { console.error("enablePush", e); window.alert("Could not enable push: " + (e.message || "error")); }
  }, [coach, canOps, myTeamNames]);
  const disablePush = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); }
      setPushState("off");
    } catch (e) { console.error("disablePush", e); setPushState("off"); }
  }, []);

  // SMS loaders
  const loadSmsThreads = useCallback(async () => {
    const { data, error } = await supabase
      .from("sms_threads")
      .select("*")
      .order("last_message_at", { ascending: false, nullsFirst: false });
    if (error) console.error("Load sms_threads error:", error);
    setSmsThreads(data || []);
  }, []);
  const loadSmsMessages = useCallback(async (threadId) => {
    if (!threadId) { setSmsMessages([]); return; }
    const { data, error } = await supabase
      .from("sms_messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("id", { ascending: true });
    if (error) console.error("Load sms_messages error:", error);
    setSmsMessages(data || []);
  }, []);
  useEffect(() => {
    if (isApproved && (view === "messages" || view === "evaluate")) loadSmsThreads();
  }, [isApproved, view, loadSmsThreads]);
  useEffect(() => { loadSmsMessages(selectedThreadId); }, [selectedThreadId, loadSmsMessages]);
  // Realtime: refresh threads + messages on any sms_messages / sms_threads change.
  useEffect(() => {
    if (!isApproved) return;
    const ch = supabase
      .channel("realtime-sms")
      .on("postgres_changes", { event: "*", schema: "public", table: "sms_messages" }, (payload) => {
        loadSmsThreads();
        const tid = payload.new?.thread_id || payload.old?.thread_id;
        if (selectedThreadId && tid === selectedThreadId) loadSmsMessages(selectedThreadId);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "sms_threads" }, () => loadSmsThreads())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [isApproved, selectedThreadId, loadSmsThreads, loadSmsMessages]);

  // Send an SMS via the Vercel serverless /api/send-sms endpoint.
  const sendSms = useCallback(async ({ to, body, player_id }) => {
    if (!to || !body) return false;
    setSmsSending(true);
    try {
      const res = await fetch("/api/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to, body, player_id: player_id || null,
          sent_by_coach_id: coach?.id || null,
          sent_by_label: coach?.display_name || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        window.alert("Send failed: " + (data.error || res.statusText));
        return false;
      }
      // Switch the inbox over to the affected thread so we can see delivery.
      if (data.thread_id) {
        setSelectedThreadId(data.thread_id);
        await loadSmsThreads();
        await loadSmsMessages(data.thread_id);
      }
      return true;
    } catch (err) {
      window.alert("Send error: " + err.message);
      return false;
    } finally {
      setSmsSending(false);
    }
  }, [coach, loadSmsThreads, loadSmsMessages]);

  const markThreadRead = useCallback(async (threadId) => {
    if (!threadId) return;
    await supabase.from("sms_threads").update({ unread_count: 0 }).eq("id", threadId);
    loadSmsThreads();
  }, [loadSmsThreads]);

  // Total unread for nav badge.
  const totalUnread = useMemo(
    () => smsThreads.reduce((s, t) => s + (t.unread_count || 0), 0),
    [smsThreads]
  );

  // Coach roster loader (admin Coaches tab section).
  const loadCoachRoster = useCallback(async () => {
    const { data, error } = await supabase.from("coach_roster").select("*").order("first_name");
    if (error) console.error("Load coach_roster error:", error);
    setCoachRoster(data || []);
  }, []);
  useEffect(() => {
    // Roster also drives the Tryout coach picker / Text Coaches lookup,
    // so make sure it's loaded whenever either tab opens.
    if (isApproved && (view === "coaches" || view === "tryouts" || view === "home")) loadCoachRoster();
  }, [isApproved, view, loadCoachRoster]);
  // The coach card edits coach_roster, so make sure it's loaded when one opens.
  useEffect(() => { if (isApproved && coachCardName) loadCoachRoster(); }, [isApproved, coachCardName, loadCoachRoster]);

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

  // Team dropdown handler that also moves a player to a terminal status.
  // Special values "__declined" / "__not_invited" mirror the drag-to-bucket
  // behavior (clear team + roster, set offer_status). Picking a real team
  // clears a terminal status so the player is back in play.
  const assignTeamOrStatus = useCallback((p, value) => {
    const now = new Date().toISOString();
    if (value === "__declined") {
      upd(p.id, { team_assignment: "", roster_pos: "", offer_status: "declined", offer_decision_at: now });
    } else if (value === "__not_invited") {
      upd(p.id, { team_assignment: "", roster_pos: "", offer_status: "not_invited", offer_made_at: null, offer_decision_at: null });
    } else {
      const patch = { team_assignment: value, roster_pos: "" };
      if (value && (p.offer_status === "declined" || p.offer_status === "not_invited")) patch.offer_status = "";
      upd(p.id, patch);
    }
  }, [upd]);
  // Current select value for a team dropdown — reflects terminal status.
  const teamSelectValue = (p) =>
    p.offer_status === "declined" ? "__declined"
    : p.offer_status === "not_invited" ? "__not_invited"
    : (p.team_assignment || "");

  // Status dropdown handler. Three of the statuses also move the player on the
  // Teams board: "Open Team" → open/unassigned pool, "Declined" → Declined
  // column, "Not Invited" → Not Invited column. The rest are labels only.
  const setPlayerStatus = useCallback((p, value) => {
    const now = new Date().toISOString();
    const patch = { status: value, offer_status: STATUS_TO_OFFER[value] ?? "" };
    if (value === "Declined") {
      patch.team_assignment = ""; patch.roster_pos = ""; patch.offer_decision_at = now;
    } else if (value === "Not Invited") {
      patch.team_assignment = ""; patch.roster_pos = ""; patch.offer_made_at = null; patch.offer_decision_at = null;
    } else if (value === "Open Team") {
      patch.team_assignment = ""; patch.roster_pos = "";
    } else if (value === "Offered") {
      patch.offer_made_at = now; patch.offer_decision_at = null;
    } else if (value === "Locked" || value === "Accepted") {
      patch.offer_decision_at = now;
    }
    upd(p.id, patch);
  }, [upd]);

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
            parent_email2: get("mgr email 2") || get("mgr email2") || get("second mgr email") || get("mgr 2 email"),
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
          "parent_email","parent_email2","parent_phone","address_line1","address_line2","city",
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
    setNewPlayer({ first_name:"", last_name:"", dob:"", age:"", usav_div: selectedDivs[0] || "U14", positions:[], parent_name:"", parent_email:"", parent_email2:"", parent_phone:"" });
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
      parent_email2: newPlayer.parent_email2 || "",
      parent_phone: newPlayer.parent_phone || "",
    };
    const { error } = await supabase.from("players").insert(insert);
    if (error) { setAddMsg("Error: " + error.message); return; }
    await loadPlayers();
    setAddingPlayer(false);
    setNewPlayer({ first_name:"", last_name:"", dob:"", age:"", usav_div:"", positions:[], parent_name:"", parent_email:"", parent_email2:"", parent_phone:"" });
    setAddMsg("");
  }, [newPlayer, players, loadPlayers]);

  // Export to CSV
  // Quote any string that contains a comma, quote, or newline (and escape
  // embedded quotes). Numbers / booleans pass through as-is.
  const csvEscape = (v) => {
    if (v == null) return "";
    const s = String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const downloadCSV = (filename, rows) => {
    const csv = rows.map(r => r.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const exportCSV = useCallback(() => {
    // Comprehensive player export — every column we track. Order grouped by
    // identity / division / contact / address / positions / scores / flags.
    const headers = [
      "First Name","Last Name","DOB","Age","Gender",
      "USAV Div","Reg Group","Projected","Team","Roster Pos",
      "Pinny #","Eval Complete","Feedback Session Complete",
      "Supplemental (Eval as Tryout)","Tryout Registered","Eval Registered",
      "SportsEngine","SportsYou","Lone Star","Jersey Tryout",
      "Player Email","Player Phone","Parent Name","Parent Email","Parent Phone",
      "Address Line 1","Address Line 2","City","State","Zip",
      "Primary Position","Secondary Position","Positions",
      "Dominant Hand","School Team","Other Sports","Previous Club/Team",
      "Eval Dates","Clinic Invited","Clinic Attended","Clinic Dates",
      ...SKILLS,"Total","Avg",
      "Reg Position","Strengths/Weakness","Ideal Coach","Goal","Starter Pref","Leaving Reason","Min Level",
      "Coach Notes","Parent Feedback Notes","Created At",
    ];
    const rows = [headers];
    players.forEach(p => {
      rows.push([
        p.first_name, p.last_name, p.dob, p.age, p.gender,
        p.usavDiv || p.usav_div, p.reg_group, p.projected_team, p.team_assignment, p.roster_pos,
        p.tryout_number, p.eval_complete ? "Yes":"No", p.feedback_session_complete ? "Yes":"No",
        p.supplemental === 1 ? "Yes":"No", p.tryout_registered ? "Yes":"No", p.eval_registered ? "Yes":"No",
        p.sportsengine_registered ? "Yes":"No", p.sportsyou_registered ? "Yes":"No",
        p.lonestar_member ? "Yes":"No", p.jersey_tryout_complete ? "Yes":"No",
        p.player_email, p.player_phone, p.parent_name, p.parent_email, p.parent_email2, p.parent_phone,
        p.address_line1, p.address_line2, p.city, p.state, p.zip,
        p.primary_position, p.secondary_position, (p.positions||[]).join("/"),
        p.dominant_hand, p.school_team, p.other_sports, p.current_team,
        (p.eval_dates||[]).join(", "),
        p.id_clinic_invited ? "Yes":"No", p.id_clinic_attended ? "Yes":"No", (p.clinic_dates||[]).join(", "),
        ...SKILLS.map(s => (p.scores||{})[s] || ""),
        tot(p) || "", avg(p),
        p.reg_position, p.strength_weakness, p.ideal_coach, p.goal, p.starter_pref, p.leaving_reason, p.min_level,
        p.notes, p.parent_feedback_notes,
        p.created_at,
      ]);
    });
    downloadCSV("dselite-players-export.csv", rows);
  }, [players]);

  // Focused signup export — just the columns needed for a tryout/eval roster:
  // player + parent name, parent email, age group, and the three signup flags.
  // "Using evaluations for tryouts" is the supplemental (eval-as-tryout) flag.
  const exportSignupCSV = useCallback(() => {
    const splitName = (name) => {
      const s = (name || "").trim();
      if (!s) return ["", ""];
      const parts = s.split(/\s+/);
      return [parts[0], parts.slice(1).join(" ")];
    };
    const headers = [
      "Player First Name","Player Last Name",
      "Parent First Name","Parent Last Name","Parent Email",
      "Age Group","Signed Up For Tryouts","Signed Up For Evaluations","Using Evaluations For Tryouts",
    ];
    const rows = [headers];
    [...players]
      .sort((a,b) => (a.last_name||"").localeCompare(b.last_name||"") || (a.first_name||"").localeCompare(b.first_name||""))
      .forEach(p => {
        const [pf, pl] = splitName(p.parent_name);
        rows.push([
          p.first_name, p.last_name,
          pf, pl, p.parent_email,
          p.usavDiv || p.usav_div,
          p.tryout_registered ? "Yes" : "No",
          p.eval_registered ? "Yes" : "No",
          p.supplemental === 1 ? "Yes" : "No",
        ]);
      });
    downloadCSV("dselite-player-signups.csv", rows);
  }, [players]);

  // Merged coaches export (roster + login account, joined by email).
  const exportCoachesCSV = useCallback(() => {
    const byEmail = new Map();
    for (const r of coachRoster) {
      const k = (r.email||"").toLowerCase().trim() || ("roster-" + r.id);
      byEmail.set(k, { roster: r, account: null });
    }
    for (const c of coachesList) {
      const k = (c.email||"").toLowerCase().trim();
      if (k && byEmail.has(k)) byEmail.get(k).account = c;
      else byEmail.set(k || ("acct-" + c.id), { roster: null, account: c });
    }
    const headers = [
      "First Name","Last Name","Email","Phone",
      "T-shirt Size","Shoe Size","Sweatshirt Size",
      "Has Login","Approved","Admin","Can View Teams","Age Groups",
      "Display Name","Last Seen","Joined","Notes",
    ];
    const rows = [headers];
    Array.from(byEmail.values())
      .sort((a,b) => {
        const an = (a.roster?.first_name || a.account?.display_name || "").toLowerCase();
        const bn = (b.roster?.first_name || b.account?.display_name || "").toLowerCase();
        return an.localeCompare(bn);
      })
      .forEach(({roster: r, account: c}) => {
        const first = r?.first_name || (c?.display_name || "").split(/\s+/)[0] || "";
        const last  = r?.last_name  || (c?.display_name || "").split(/\s+/).slice(1).join(" ") || "";
        rows.push([
          first, last, (r?.email || c?.email || ""), r?.phone,
          r?.tshirt_size, r?.shoe_size, r?.sweatshirt_size,
          c ? "Yes" : "No",
          c ? (c.is_approved ? "Yes":"No") : "",
          c ? (c.is_admin ? "Yes":"No") : "",
          c ? (c.can_view_teams ? "Yes":"No") : "",
          c ? ((c.team_divs||[]).join(", ") || "(all)") : "",
          c?.display_name,
          c?.last_seen_at ? new Date(c.last_seen_at).toISOString() : "",
          c?.created_at ? new Date(c.created_at).toISOString() : "",
          r?.notes,
        ]);
      });
    downloadCSV("dselite-coaches-export.csv", rows);
  }, [coachRoster, coachesList]);

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
    if (filterAttend === "attended") l = l.filter(p => p.tryout_attended);
    else if (filterAttend === "not") l = l.filter(p => !p.tryout_attended);
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
  }, [divP, search, filterPos, filterProj, filterEval, filterDate, filterClinic, filterClinicDate, regSince, filterAttend, sortBy]);

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
      // Guest / shared-device login — password only, fixed internal email.
      if (loginMode === "guest") {
        const pw = loginPassword;
        if (!pw) { setLoginError("Enter the guest password."); return; }
        setLoginBusy(true); setLoginError(""); setLoginInfo("");
        try {
          const { error } = await supabase.auth.signInWithPassword({ email: GUEST_EMAIL, password: pw });
          if (error) throw error;
        } catch (err) {
          setLoginError((err && err.message) || "Guest sign-in failed. Check the password, or ask the admin to set up the guest login.");
        } finally { setLoginBusy(false); }
        return;
      }
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
          {loginMode === "guest" ? (
            <div style={{textAlign:"center",marginBottom:16,fontSize:12,color:C.mut}}>Shared-device guest login — enter the guest password.</div>
          ) : (
            <div style={{display:"flex",gap:4,marginBottom:18,background:C.bg,borderRadius:8,padding:3}}>
              {["login","signup"].map(m => (
                <button key={m} type="button" onClick={()=>{setLoginMode(m);setLoginError("");setLoginInfo("");}}
                  style={{flex:1,padding:"8px 0",borderRadius:6,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,background:loginMode===m?C.gold:"transparent",color:loginMode===m?"#000":C.mut}}>
                  {m === "login" ? "Sign In" : "Sign Up"}
                </button>
              ))}
            </div>
          )}
          {loginMode === "signup" && (
            <label style={{display:"block",marginBottom:10}}>
              <span style={{fontSize:11,fontWeight:700,color:C.mut,textTransform:"uppercase"}}>Display Name</span>
              <input type="text" value={loginDisplayName} onChange={e=>setLoginDisplayName(e.target.value)} placeholder="e.g. Sarah Smith" autoComplete="name"
                style={{...inpStyle,width:"100%",padding:"10px 14px",fontSize:14,marginTop:3}} />
            </label>
          )}
          {loginMode !== "guest" && (
            <label style={{display:"block",marginBottom:10}}>
              <span style={{fontSize:11,fontWeight:700,color:C.mut,textTransform:"uppercase"}}>Email</span>
              <input type="email" value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} autoComplete="email" autoFocus
                style={{...inpStyle,width:"100%",padding:"10px 14px",fontSize:14,marginTop:3}} />
            </label>
          )}
          <label style={{display:"block",marginBottom:14}}>
            <span style={{fontSize:11,fontWeight:700,color:C.mut,textTransform:"uppercase"}}>Password</span>
            <input type="password" value={loginPassword} onChange={e=>setLoginPassword(e.target.value)} autoComplete={loginMode==="signup"?"new-password":"current-password"} minLength={6}
              style={{...inpStyle,width:"100%",padding:"10px 14px",fontSize:14,marginTop:3}} />
          </label>
          {loginError && <div style={{fontSize:12,color:C.red,marginBottom:10,whiteSpace:"pre-wrap"}}>{loginError}</div>}
          {loginInfo  && <div style={{fontSize:12,color:C.grn,marginBottom:10,whiteSpace:"pre-wrap"}}>{loginInfo}</div>}
          <button type="submit" disabled={loginBusy}
            style={{width:"100%",padding:"12px",borderRadius:8,border:"none",background:loginBusy?C.border:C.gold,color:loginBusy?C.mut:"#000",fontFamily:"inherit",fontSize:14,fontWeight:700,cursor:loginBusy?"default":"pointer"}}>
            {loginBusy ? "Please wait…" : (loginMode==="signup" ? "Create Account" : loginMode==="guest" ? "Sign in as guest" : "Sign In")}
          </button>
          <div style={{textAlign:"center",marginTop:12}}>
            {loginMode === "guest"
              ? <button type="button" onClick={()=>{setLoginMode("login");setLoginError("");setLoginInfo("");setLoginPassword("");}} style={{background:"none",border:"none",color:C.mut,fontFamily:"inherit",fontSize:11,cursor:"pointer",textDecoration:"underline"}}>← Back to coach sign in</button>
              : <button type="button" onClick={()=>{setLoginMode("guest");setLoginError("");setLoginInfo("");setLoginPassword("");}} style={{background:"none",border:"none",color:C.mut,fontFamily:"inherit",fontSize:11,cursor:"pointer",textDecoration:"underline"}}>Guest / shared-device login →</button>}
          </div>
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

  const divsWithPlayers = DIVS.filter(d => allowedDivSet.has(d) && players.some(p => (p.usavDiv||p.usav_div) === d));

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

  // ─── HOME (coach landing) ───
  // Highlights the logged-in coach's teams: practice days/times (all phases,
  // merged), tournaments, and roster. Matches the coach to teams by name.
  // ── Operational checklist render helpers (used on Home + All Teams) ──
  // Status badge for a checklist item; cycles Not Started → In Progress → Done.
  const taskStatusBtn = (team, itemKey, canEdit = true, big = false) => {
    const st = (teamTasks[team + "|" + itemKey] && teamTasks[team + "|" + itemKey].status) || "not_started";
    const m = taskStatusMeta(st);
    return (
      <button disabled={!canEdit}
        onClick={canEdit ? (e) => { e.stopPropagation(); updateTeamTask(team, itemKey, { status: TASK_NEXT[st] }); } : undefined}
        title={canEdit ? "Click to change: Not Started → In Progress → Done" : "Status set by the directors"}
        style={{fontSize:big?13:10,fontWeight:800,padding:big?"5px 12px":"2px 8px",borderRadius:8,cursor:canEdit?"pointer":"default",fontFamily:"inherit",color:m.fg,background:m.bg,border:m.border,whiteSpace:"nowrap",opacity:canEdit?1:0.9}}>
        {m.label}
      </button>
    );
  };
  // Coach To-Do list for a team: status + notes + ask-a-question per item.
  const renderCoachChecklist = (team) => {
    const sectionBox = {background:C.bg,borderRadius:10,padding:12,marginTop:10};
    const head = {fontSize:10,fontWeight:800,letterSpacing:0.5,textTransform:"uppercase",color:C.gold,marginBottom:8};
    return (
      <div style={sectionBox}>
        <div style={head}>Coach To-Do</div>
        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          {COACH_TASKS.map((item, idx) => {
            const k = team + "|" + item.key;
            const notes = (teamTasks[k] && teamTasks[k].notes) || "";
            const qs = teamQuestions.filter(q => q.team_name === team && q.item_key === item.key)
              .slice().sort((a,b) => (a.created_at||"").localeCompare(b.created_at||""));
            const draft = qDraft[k] || "";
            return (
              <div key={item.key} style={{paddingTop:8,borderTop:idx?"1px solid "+C.border:"none"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
                  <span style={{fontSize:12,fontWeight:700,color:C.text}}>{item.label}</span>
                  {taskStatusBtn(team, item.key, true)}
                </div>
                {(taskMeta[item.key] || item.detail) && <div style={{fontSize:10,color:C.mut,marginTop:3,lineHeight:1.4,whiteSpace:"pre-wrap"}}>{taskMeta[item.key] || item.detail}</div>}
                <DebouncedField multiline placeholder="Notes…" value={notes}
                  onCommit={v => updateTeamTask(team, item.key, { notes: v })}
                  style={{...inpStyle, width:"100%", minHeight:30, padding:"6px 8px", fontSize:11, marginTop:6, resize:"vertical"}} />
                {qs.length > 0 && (
                  <div style={{marginTop:6,display:"flex",flexDirection:"column",gap:5}}>
                    {qs.map(q => (
                      <div key={q.id} style={{fontSize:11,background:C.card,border:"1px solid "+C.border,borderRadius:6,padding:"6px 8px"}}>
                        <div><span style={{color:C.acc,fontWeight:700}}>Q:</span> {q.question}{q.asked_by_name ? <span style={{color:C.mut,fontSize:9}}> — {q.asked_by_name}</span> : null}</div>
                        {q.answer
                          ? <div style={{marginTop:3,color:C.grn}}><span style={{fontWeight:700}}>A:</span> {q.answer}{q.answered_by_name ? <span style={{color:C.mut,fontSize:9}}> — {q.answered_by_name}</span> : null}</div>
                          : <div style={{marginTop:3,color:"#f59e0b",fontSize:10,fontStyle:"italic"}}>Awaiting director response…</div>}
                      </div>
                    ))}
                  </div>
                )}
                <div style={{display:"flex",gap:6,marginTop:6}}>
                  <input value={draft} onChange={e=>setQDraft(prev=>({...prev,[k]:e.target.value}))} placeholder="Ask the directors a question…"
                    style={{...inpStyle, flex:1, padding:"5px 8px", fontSize:11}} />
                  <button onClick={()=>askTeamQuestion(team, item.key, draft)} disabled={!draft.trim()}
                    style={{padding:"5px 10px",borderRadius:6,border:"none",background:draft.trim()?C.gold:C.border,color:draft.trim()?"#000":C.mut,fontWeight:700,fontSize:11,cursor:draft.trim()?"pointer":"default",fontFamily:"inherit"}}>Ask</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };
  // Operations To-Do for a team. canEdit (admins) → statuses are clickable.
  // prominent → bigger, with items laid out across a row (used on Home).
  const renderOpsChecklist = (team, canEdit, prominent = false) => {
    const sectionBox = prominent
      ? {background:C.bg,borderRadius:12,padding:16,marginTop:12,border:"2px solid rgba(233,30,140,0.35)"}
      : {background:C.bg,borderRadius:10,padding:12,marginTop:10};
    const head = {fontSize:prominent?14:10,fontWeight:800,letterSpacing:0.5,textTransform:"uppercase",color:C.gold,marginBottom:prominent?12:8};
    return (
      <div style={sectionBox}>
        <div style={head}>Operations To-Do{!canEdit && <span style={{color:C.mut,fontWeight:600,textTransform:"none",letterSpacing:0,fontSize:prominent?11:9}}> · set by directors</span>}</div>
        {prominent ? (
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:10}}>
            {OPS_TASKS.map(item => {
              const desc = taskMeta[item.key] || item.detail || "";
              return (
                <div key={item.key} style={{background:C.card,border:"1px solid "+C.border,borderRadius:10,padding:"12px 14px",display:"flex",flexDirection:"column",gap:8}}>
                  <span style={{fontSize:13,fontWeight:700,color:C.text,lineHeight:1.3}}>{item.label}</span>
                  <div>{taskStatusBtn(team, item.key, canEdit, true)}</div>
                  {desc && <div style={{fontSize:10,color:C.mut,lineHeight:1.4,whiteSpace:"pre-wrap"}}>{desc}</div>}
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {OPS_TASKS.map(item => {
              const desc = taskMeta[item.key] || item.detail || "";
              return (
                <div key={item.key}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                    <span style={{fontSize:12,color:C.text}}>{item.label}</span>
                    {taskStatusBtn(team, item.key, canEdit)}
                  </div>
                  {desc && <div style={{fontSize:10,color:C.mut,marginTop:2,lineHeight:1.4,whiteSpace:"pre-wrap"}}>{desc}</div>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };
  // Admin notification panel: coach questions awaiting a director answer.
  const renderQuestionsPanel = () => {
    if (!canOps) return null;
    const sorted = teamQuestions.slice().sort((a,b) => (a.answer?1:0)-(b.answer?1:0) || (b.created_at||"").localeCompare(a.created_at||""));
    const pending = teamQuestions.filter(q => !q.answer).length;
    if (teamQuestions.length === 0) return null;
    return (
      <div style={{background:C.card,border:"1px solid "+(pending?"#f59e0b":C.border),borderRadius:12,padding:"14px 16px",marginBottom:18}}>
        <div style={{fontSize:13,fontWeight:800,color:pending?"#f59e0b":C.gold,marginBottom:8}}>Coach Questions{pending>0?" · "+pending+" pending":""}</div>
        <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:320,overflowY:"auto"}}>
          {sorted.map(q => (
            <div key={q.id} style={{background:C.bg,border:"1px solid "+C.border,borderRadius:8,padding:"8px 10px"}}>
              <div style={{fontSize:10,color:C.mut,marginBottom:3}}>{q.team_name} · {TASK_LABELS[q.item_key] || q.item_key}{q.asked_by_name?" · "+q.asked_by_name:""}</div>
              <div style={{fontSize:12,color:C.text}}><span style={{color:C.acc,fontWeight:700}}>Q:</span> {q.question}</div>
              {q.answer ? (
                <div style={{fontSize:12,color:C.grn,marginTop:4}}><span style={{fontWeight:700}}>A:</span> {q.answer}{q.answered_by_name?<span style={{color:C.mut,fontSize:9}}> — {q.answered_by_name}</span>:null}</div>
              ) : (
                <div style={{display:"flex",gap:6,marginTop:6}}>
                  <input value={aDraft[q.id]||""} onChange={e=>setADraft(prev=>({...prev,[q.id]:e.target.value}))} placeholder="Type an answer…"
                    style={{...inpStyle, flex:1, padding:"5px 8px", fontSize:11}} />
                  <button onClick={()=>answerTeamQuestion(q.id, aDraft[q.id]||"")} disabled={!(aDraft[q.id]||"").trim()}
                    style={{padding:"5px 10px",borderRadius:6,border:"none",background:(aDraft[q.id]||"").trim()?C.gold:C.border,color:(aDraft[q.id]||"").trim()?"#000":C.mut,fontWeight:700,fontSize:11,cursor:(aDraft[q.id]||"").trim()?"pointer":"default",fontFamily:"inherit"}}>Answer</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Updates feed — shown to everyone on Home (i.e. on login). Club-wide updates
  // go to all; team-specific updates only to that team's coaches (admins see all).
  const renderUpdatesPanel = (myTeamNames = []) => {
    const myTeamSet = new Set(myTeamNames);
    const visible = updates.filter(u => !u.team_name || canOps || myTeamSet.has(u.team_name));
    if (visible.length === 0) return null;
    const recentMs = Date.now() - 3 * 24 * 60 * 60 * 1000;
    const fmt = (iso) => new Date(iso).toLocaleDateString(undefined, { month:"short", day:"numeric" });
    return (
      <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:12,padding:"14px 16px",marginBottom:18}}>
        <div style={{fontSize:13,fontWeight:800,color:C.gold,marginBottom:8}}>Updates</div>
        <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:280,overflowY:"auto"}}>
          {visible.map(u => {
            const isNew = new Date(u.created_at).getTime() > recentMs;
            return (
              <div key={u.id} style={{background:C.bg,border:"1px solid "+C.border,borderRadius:8,padding:"8px 10px"}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:8,marginBottom:3,alignItems:"center"}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                    <span style={{fontSize:10,color:C.mut}}>{fmt(u.created_at)}{u.created_by_name?" · "+u.created_by_name:""}</span>
                    {u.team_name
                      ? <span style={{fontSize:8,fontWeight:800,color:C.acc,border:"1px solid "+C.acc,borderRadius:5,padding:"1px 5px"}}>{u.team_name}</span>
                      : <span style={{fontSize:8,fontWeight:800,color:C.mut,border:"1px solid "+C.border,borderRadius:5,padding:"1px 5px"}}>ALL</span>}
                  </div>
                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    {isNew && <span style={{fontSize:8,fontWeight:800,color:C.grn,border:"1px solid "+C.grn,borderRadius:5,padding:"1px 5px"}}>NEW</span>}
                    {canOps && <button onClick={()=>deleteUpdate(u.id)} title="Delete update" style={{background:"none",border:"none",color:C.red,cursor:"pointer",fontSize:13,fontWeight:800,lineHeight:1,padding:0}}>×</button>}
                  </div>
                </div>
                <div style={{fontSize:12,color:C.text,whiteSpace:"pre-wrap",lineHeight:1.4}}>{u.body}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };
  // Admin: bulk-edit checklist item descriptions + post an update.
  const renderChecklistSetup = () => {
    if (!canOps) return null;
    // Team options for targeting an update: every board team + any practice team.
    const allTeamNames = Array.from(new Set([
      ...Object.values(TM).flat(),
      ...practiceTeams.map(t => t.team_name).filter(Boolean),
    ])).sort((a, b) => a.localeCompare(b));
    const itemRow = (item) => (
      <div key={item.key} style={{marginBottom:8}}>
        <div style={{fontSize:11,fontWeight:700,color:C.text,marginBottom:3}}>{item.label}</div>
        <DebouncedField multiline placeholder="Description / instructions shown on every team's card for this item…"
          value={taskMeta[item.key] || ""} onCommit={v=>saveTaskMeta(item.key, v)}
          style={{...inpStyle,width:"100%",minHeight:34,padding:"6px 8px",fontSize:11,resize:"vertical"}} />
      </div>
    );
    return (
      <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:12,padding:"14px 16px",marginBottom:18}}>
        <button onClick={()=>setShowChecklistSetup(v=>!v)}
          style={{display:"flex",alignItems:"center",gap:8,background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",padding:0,color:C.gold,fontSize:13,fontWeight:800}}>
          <span style={{fontSize:9,transform:showChecklistSetup?"rotate(90deg)":"none"}}>▶</span> Manage Checklist &amp; Post Update
        </button>
        {showChecklistSetup && (
          <div style={{marginTop:12}}>
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",color:C.gold,marginBottom:6}}>Post an Update</div>
            <textarea value={updateDraft} onChange={e=>setUpdateDraft(e.target.value)} placeholder={updateTeamTarget ? "Share an update with " + updateTeamTarget + "…" : "Share an update with all coaches…"}
              style={{...inpStyle,width:"100%",minHeight:50,padding:"8px 10px",fontSize:12,resize:"vertical",boxSizing:"border-box"}} />
            <div style={{marginTop:6,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
              <label style={{display:"flex",alignItems:"center",gap:5,fontSize:11,fontWeight:700,color:C.mut}}>Audience
                <select value={updateTeamTarget} onChange={e=>setUpdateTeamTarget(e.target.value)}
                  style={{...inpStyle,padding:"5px 8px",fontSize:12,cursor:"pointer",color:updateTeamTarget?C.gold:C.text}}>
                  <option value="">Club-wide (all coaches)</option>
                  {allTeamNames.map(tn => <option key={tn} value={tn}>{tn}</option>)}
                </select>
              </label>
              <button onClick={()=>postUpdate(updateDraft, updateTeamTarget)} disabled={!updateDraft.trim()}
                style={{padding:"6px 14px",borderRadius:8,border:"none",background:updateDraft.trim()?C.gold:C.border,color:updateDraft.trim()?"#000":C.mut,fontWeight:700,fontSize:12,cursor:updateDraft.trim()?"pointer":"default",fontFamily:"inherit"}}>Post Update</button>
            </div>
            <div style={{marginTop:8,paddingTop:10,borderTop:"1px solid "+C.border,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
              <span style={{fontSize:11,color:C.mut}}>Ask every coach to approve their team's practice schedule (no conflicts).</span>
              <button onClick={requestPracticeApproval}
                style={{padding:"6px 14px",borderRadius:8,border:"1px solid #f59e0b",background:"rgba(245,158,11,0.12)",color:"#f59e0b",fontWeight:800,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Request Practice Approval</button>
            </div>
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",color:C.gold,margin:"14px 0 6px",borderTop:"1px solid "+C.border,paddingTop:12}}>Coach To-Do descriptions</div>
            {COACH_TASKS.map(itemRow)}
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",color:C.gold,margin:"12px 0 6px"}}>Operations To-Do descriptions</div>
            {OPS_TASKS.map(itemRow)}
            <div style={{fontSize:10,color:C.mut,marginTop:8}}>Descriptions are shared across every team's card and save automatically.</div>
          </div>
        )}
      </div>
    );
  };

  function renderHome() {
    const norm = s => (s || "").toString().trim().toLowerCase();
    const myRoster = coachRoster.find(r => coach?.email && norm(r.email) === norm(coach.email));
    const cand = new Set();
    if (coach?.display_name) cand.add(norm(coach.display_name));
    if (myRoster) {
      const f = norm(myRoster.first_name), l = norm(myRoster.last_name);
      if (f) { cand.add((f + " " + l).trim()); cand.add(f); if (l) cand.add((f + " " + l[0] + ".").trim()); }
    }
    const isMine = field => !!field && cand.has(norm(field));
    const myTeams = practiceTeams
      .filter(t => isMine(t.head_coach) || isMine(t.assistant_coach))
      .map(t => ({ ...t, role: isMine(t.head_coach) ? "Head Coach" : "Assistant Coach" }))
      .sort((a, b) => (a.team_name || "").localeCompare(b.team_name || ""));
    const tournamentById = new Map(tournaments.map(t => [t.id, t]));
    const firstName = (myRoster ? (myRoster.first_name || "") : (coach?.display_name || "")).split(/\s+/)[0] || "Coach";

    const lbl = {fontSize:9,fontWeight:800,letterSpacing:0.5,textTransform:"uppercase",color:C.mut,marginBottom:5};
    const box = {background:C.bg,borderRadius:10,padding:"10px 12px",marginBottom:8};
    const fmtDate = d => d ? new Date(d + "T00:00").toLocaleDateString(undefined,{month:"short",day:"numeric"}) : "";

    return (
      <div>
        <div style={{marginBottom:14}}>
          <h2 style={{margin:0,fontSize:22,fontWeight:800,color:C.gold}}>Welcome, {firstName}</h2>
          <div style={{fontSize:12,color:C.mut,marginTop:3}}>Your teams — practices, tournaments, and rosters at a glance.{myTeams.length ? "" : ""}</div>
        </div>
        {renderUpdatesPanel(myTeams.map(t => t.team_name))}
        {renderQuestionsPanel()}
        {myTeams.length === 0 ? (
          <div style={{padding:24,textAlign:"center",color:C.mut,fontSize:13,background:C.card,borderRadius:12,border:"1px solid "+C.border,lineHeight:1.6}}>
            You're not listed as a coach on any team yet — coaches are matched by name on each team.
            <div style={{marginTop:10,display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
              {canOps && <button onClick={()=>setView("teamdir")} style={{padding:"6px 14px",borderRadius:8,border:"1px solid "+C.gold,background:"transparent",color:C.gold,fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Browse all teams</button>}
              <button onClick={()=>setView("dashboard")} style={{padding:"6px 14px",borderRadius:8,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Open dashboard</button>
            </div>
          </div>
        ) : (
          <div style={{display:"flex",flexDirection:"column",gap:18}}>
            {myTeams.map(t => {
              const phases = summarizePractices(practiceAssignments.filter(a => a.team_name === t.team_name));
              // Speed & Agility sessions for this team, grouped by phase (block).
              // All S&A sessions fall on Sundays, so the day label is "Sun".
              const saByPhase = {};
              saSessions.forEach(s => {
                if (s.team_name !== t.team_name) return;
                const ph = s.block || "fall1";
                (saByPhase[ph] = saByPhase[ph] || new Set()).add(s.slot);
              });
              // Ordered rows combining practices + S&A; a phase shows if it has either.
              const phaseRows = PRACTICE_PHASES.map(P => {
                const pr = phases.find(x => x.id === P.id);
                const saSlots = saByPhase[P.id] ? Array.from(saByPhase[P.id]) : [];
                if (!pr && !saSlots.length) return null;
                return { id: P.id, label: P.label, entries: pr ? pr.entries : [], sa: mergeAdjacentSlots(saSlots) };
              }).filter(Boolean);
              const teamTns = tournamentAssignments
                .filter(ta => ta.team_id === t.team_name || ta.team_name === t.team_name)
                .map(ta => tournamentById.get(ta.tournament_id)).filter(Boolean)
                .sort((a, b) => (a.start_date || "").localeCompare(b.start_date || ""));
              // "On the team" = assigned AND accepted/committed (accepted or locked).
              const roster = players.filter(p => p.team_assignment === t.team_name && (p.offer_status === "accepted" || p.offer_status === "locked"))
                .sort((a, b) => (a.roster_pos || "").localeCompare(b.roster_pos || "") || (a.last_name || "").localeCompare(b.last_name || ""));
              const coLine = [t.head_coach && "HC: " + t.head_coach, t.assistant_coach && "AC: " + t.assistant_coach].filter(Boolean).join(" · ");
              return (
                <div key={t.team_name} style={{background:C.card,borderRadius:12,border:"1px solid "+C.border,padding:"14px 16px"}}>
                  <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:8,marginBottom:2}}>
                    <span onClick={()=>setTeamCardName(t.team_name)} title="Open team card" style={{fontSize:17,fontWeight:800,color:C.gold,cursor:"pointer"}}>{t.team_name}</span>
                    <span style={{fontSize:9,fontWeight:800,letterSpacing:0.5,color:t.role==="Head Coach"?C.gold:C.acc}}>{t.role.toUpperCase()}</span>
                  </div>
                  <div style={{fontSize:10,color:C.mut,marginBottom:10}}>{coLine}</div>

                  {/* Team info across one row (wraps on narrow screens). */}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:12}}>
                    <div style={{...box,marginBottom:0}}>
                      <div style={lbl}>Practice &amp; S&amp;A</div>
                      {phaseRows.length === 0 && <div style={{fontSize:11,color:C.mut,fontStyle:"italic"}}>None scheduled.</div>}
                      {phaseRows.map(ph => (
                        <div key={ph.id} style={{fontSize:11,marginBottom:3}}>
                          <span style={{color:C.gold,fontWeight:700}}>{ph.label}:</span>{" "}
                          {ph.entries.length > 0 && <span style={{color:C.text}}>{ph.entries.map(e => e.day + " " + e.slot).join(", ")}</span>}
                          {ph.sa.length > 0 && <span style={{color:C.acc}}>{ph.entries.length ? " · " : ""}S&amp;A {ph.sa.map(slot => "Sun " + slot).join(", ")}</span>}
                        </div>
                      ))}
                      {(() => {
                        const appr = practiceApprovals[t.team_name];
                        const fmtA = appr && appr.approved_at ? new Date(appr.approved_at).toLocaleDateString(undefined,{month:"short",day:"numeric"}) : "";
                        return appr && appr.approved ? (
                          <div style={{marginTop:8,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
                            <span style={{fontSize:11,fontWeight:700,color:C.grn}}>✓ Schedule approved{appr.approved_by_name?" by "+appr.approved_by_name:""}{fmtA?" · "+fmtA:""}</span>
                            <button onClick={()=>approvePractice(t.team_name,false)} title="Undo approval"
                              style={{fontSize:9,fontWeight:700,padding:"2px 8px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,cursor:"pointer",fontFamily:"inherit"}}>Undo</button>
                          </div>
                        ) : (
                          <button onClick={()=>{ if (window.confirm("Approve this practice schedule and confirm there are no conflicts?")) approvePractice(t.team_name,true); }}
                            style={{marginTop:8,width:"100%",padding:"8px 12px",borderRadius:8,border:"1px solid #f59e0b",background:"rgba(245,158,11,0.12)",color:"#f59e0b",fontWeight:800,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
                            ⚠ Approve practice schedule — confirm no conflicts
                          </button>
                        );
                      })()}
                      {(() => {
                        const open = !!schedChangeOpen[t.team_name];
                        const draft = schedChangeDraft[t.team_name] || "";
                        const sending = schedChangeSending === t.team_name;
                        return (
                          <div style={{marginTop:6}}>
                            {!open ? (
                              <button onClick={()=>setSchedChangeOpen(prev=>({...prev,[t.team_name]:true}))}
                                style={{background:"none",border:"none",color:C.acc,cursor:"pointer",fontFamily:"inherit",fontSize:10,fontWeight:700,textDecoration:"underline",padding:0}}>Request a schedule change</button>
                            ) : (
                              <div>
                                <textarea value={draft} onChange={e=>setSchedChangeDraft(prev=>({...prev,[t.team_name]:e.target.value}))}
                                  placeholder="Describe the change you'd like (day/time) and why…"
                                  style={{...inpStyle,width:"100%",minHeight:44,padding:"6px 8px",fontSize:11,resize:"vertical",boxSizing:"border-box"}} />
                                <div style={{fontSize:9,color:C.mut,marginTop:3,fontStyle:"italic",lineHeight:1.4}}>Heads up: changes can be hard to accommodate — many coaches are on two teams, so this may create conflicts elsewhere.</div>
                                <div style={{display:"flex",gap:6,marginTop:6,justifyContent:"flex-end"}}>
                                  <button onClick={()=>setSchedChangeOpen(prev=>({...prev,[t.team_name]:false}))} disabled={sending}
                                    style={{padding:"5px 10px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontWeight:700,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
                                  <button onClick={()=>requestScheduleChange(t.team_name, draft)} disabled={!draft.trim()||sending}
                                    style={{padding:"5px 10px",borderRadius:6,border:"none",background:(draft.trim()&&!sending)?C.gold:C.border,color:(draft.trim()&&!sending)?"#000":C.mut,fontWeight:700,fontSize:11,cursor:(draft.trim()&&!sending)?"pointer":"default",fontFamily:"inherit"}}>{sending?"Sending…":"Email director"}</button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    <div style={{...box,marginBottom:0}}>
                      <div style={lbl}>Tournaments · {teamTns.length}</div>
                      {teamTns.length === 0 && <div style={{fontSize:11,color:C.mut,fontStyle:"italic"}}>None assigned.</div>}
                      {teamTns.map(tn => (
                        <div key={tn.id} style={{fontSize:11,marginBottom:2}}>
                          <span style={{color:C.text,fontWeight:600}}>{tn.name}</span>
                          <span style={{color:C.mut}}> · {fmtDate(tn.start_date)}{tn.end_date && tn.end_date!==tn.start_date ? "–"+fmtDate(tn.end_date) : ""}</span>
                          {tn.is_qualifier && <span style={{color:"#a855f7",fontWeight:700,marginLeft:5,fontSize:9}}>QUAL</span>}
                        </div>
                      ))}
                    </div>

                    <div style={{...box,marginBottom:0}}>
                      <div style={lbl} title="Players assigned to this team who have accepted their offer">Players · {roster.length}</div>
                      {roster.length === 0 && <div style={{fontSize:11,color:C.mut,fontStyle:"italic"}}>No accepted players yet.</div>}
                      {roster.length > 0 && (
                        <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                          {roster.map(p => (
                            <button key={p.id} onClick={()=>setProfileId(p.id)} title="Open player card"
                              style={{padding:"3px 8px",borderRadius:8,border:"1px solid "+C.border,background:C.bg,color:C.text,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                              {p.first_name} {p.last_name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Operations status — enlarged and prominent. */}
                  {renderOpsChecklist(t.team_name, canOps, true)}
                  {renderCoachChecklist(t.team_name)}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
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
              <button onClick={exportSignupCSV} title="Player + parent + age group + tryout/eval signup flags" style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+C.gold,background:"transparent",color:C.gold,fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                Export Signups
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
                const emails = [...new Set(group.flatMap(p => [p.parent_email, p.parent_email2].map(e => (e||"").trim()).filter(Boolean)))];
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
          <select style={{...inpStyle,padding:"7px 10px",fontSize:12,color:filterAttend!=="all"?C.gold:C.text}} value={filterAttend} onChange={e=>setFilterAttend(e.target.value)} title="Filter by tryout attendance">
            <option value="all">All Attendance</option>
            <option value="attended">Attended tryout</option>
            <option value="not">Not attended</option>
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
            const emails = filtered.flatMap(p => [p.parent_email, p.parent_email2].map(e => (e||"").trim()).filter(Boolean));
            const uniq = [...new Set(emails)];
            if (!uniq.length) { window.alert("No parent emails found for the current filter."); return; }
            navigator.clipboard.writeText(uniq.join(", ")).then(()=>{ setCopiedEmails(true); setTimeout(()=>setCopiedEmails(false), 2000); });
          }} title="Copy parent emails of currently visible players to clipboard, comma-separated" style={{padding:"6px 10px",borderRadius:6,border:"1px solid "+C.gold,background:"transparent",color:C.gold,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
            {copiedEmails ? "Copied ✓" : "Copy emails"}
          </button>
          <button onClick={() => {
            // Strip everything but digits and a leading + so the resulting
            // string drops cleanly into the recipient field of any messaging app.
            const phones = filtered.map(p => (p.parent_phone||"").trim()).filter(Boolean)
              .map(s => s.replace(/[^\d+]/g,""));
            const uniq = [...new Set(phones)].filter(Boolean);
            if (!uniq.length) { window.alert("No parent phone numbers found for the current filter."); return; }
            navigator.clipboard.writeText(uniq.join(", ")).then(()=>{ setCopiedPhones(true); setTimeout(()=>setCopiedPhones(false), 2000); });
          }} title="Copy parent phone numbers of currently visible players to clipboard, comma-separated" style={{padding:"6px 10px",borderRadius:6,border:"1px solid "+C.gold,background:"transparent",color:C.gold,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
            {copiedPhones ? "Copied ✓" : "Copy phones"}
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
                  {label:"Att",full:"Tryout attendance"},
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
                      <div style={{display:"flex",alignItems:"flex-start",gap:4}}>
                      <span onClick={()=>toggleFavorite(p.id)} title={favorites.includes(p.id)?"Remove from your favorites":"Add to your favorites"}
                        style={{cursor:"pointer",fontSize:14,lineHeight:1.1,color:favorites.includes(p.id)?C.gold:C.border,userSelect:"none"}}>
                        {favorites.includes(p.id)?"★":"☆"}
                      </span>
                      <div style={{cursor:"pointer",flex:1}} onClick={()=>setProfileId(p.id)}>
                        <div style={{display:"flex",alignItems:"center",gap:5}}>
                          {isReturningDSE(p) && <span title="DS Elite returning athlete" style={{color:C.gold,fontSize:14,fontWeight:800,lineHeight:1}}>◆</span>}{newIcon(p)}
                          <span style={{fontWeight:700,fontSize:12,color:C.gold}}>{p.first_name} {p.last_name}</span>
                        </div>
                        <div style={{fontSize:10,color:C.mut}}>Age {p.age} • {p.usavDiv||p.usav_div}</div>
                        {p.min_level && <Tag c={C.gold}>Min: {p.min_level}</Tag>}
                        {p.supplemental===1 && <Tag c={C.acc}>SUPP</Tag>}
                        {p.status && p.status !== "In Progress" && <Tag c={STATUS_COLORS[p.status]}>{p.status}</Tag>}
                        {p.id_clinic_invited && <Tag c={C.gold}>INV</Tag>}
                        {p.id_clinic_attended && <Tag c={C.grn}>ATT</Tag>}
                      </div>
                      </div>
                    </td>
                    <td style={tdS}><PosChips player={p} /></td>
                    <td style={tdS}><select style={{...inpStyle,width:40,fontSize:10,padding:"3px 1px"}} value={p.projected_team||""} onChange={e=>upd(p.id,{projected_team:e.target.value})}>{PROJ_OPTS.map(o=><option key={o} value={o}>{o||"—"}</option>)}</select></td>
                    {SKILLS.map(sk=><td key={sk} style={tdS}><ScoreB player={p} skill={sk} /></td>)}
                    <td style={tdS}><span style={{fontWeight:800,fontSize:14,color:tot(p)?C.gold:C.mut}}>{tot(p)||"—"}</span></td>
                    <td style={tdS}><span style={{fontWeight:600,fontSize:12}}>{avg(p)}</span></td>
                    <td style={tdS}>
                      <select style={{...inpStyle,fontSize:10,padding:"3px",width:74}} value={teamSelectValue(p)} onChange={e=>assignTeamOrStatus(p,e.target.value)}>
                        <option value="">{"—"}</option>{(TM[p.usavDiv||p.usav_div]||[]).map(t=><option key={t} value={t}>{t}</option>)}
                        <option disabled>──────</option>
                        <option value="__not_invited">Not invited</option>
                        <option value="__declined">Decline offer</option>
                      </select>
                      {p.team_assignment && <select style={{...inpStyle,fontSize:9,padding:"2px",width:54,marginTop:2,display:"block"}} value={p.roster_pos||""} onChange={e=>upd(p.id,{roster_pos:e.target.value})}>
                        <option value="">Roster</option>
                        {ROSTER_POS.map(rp => { const taken = players.some(o=>o.id!==p.id&&o.team_assignment===p.team_assignment&&o.roster_pos===rp); return <option key={rp} value={rp} disabled={taken}>{rp}{taken?" ✓":""}</option>; })}
                      </select>}
                    </td>
                    <td style={tdS}><DebouncedField style={{...inpStyle,width:90,fontSize:11,padding:"4px 6px"}} placeholder="Notes..." value={p.notes||""} onCommit={v=>upd(p.id,{notes:v})} /></td>
                    <td style={tdS}><input type="checkbox" checked={!!p.tryout_attended} onChange={e=>upd(p.id,{tryout_attended:e.target.checked})} title="Tryout attended" style={{width:16,height:16,cursor:"pointer",accentColor:C.grn}} /></td>
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
                // Mirror the Teams-board build status (same team_status row).
                // Skip the synthetic "(no team yet)" bucket.
                const isRealTeam = team !== "(no team yet)";
                const ts = teamStatus[team] || { status:"in_progress", looking_positions:[] };
                const tStatus = ts.status || "in_progress";
                const lookingPos = ts.looking_positions || [];
                const sMeta = {
                  in_progress: { label:"In Progress", fg:C.mut,    bg:"transparent",            border:"1px solid "+C.border },
                  looking:     { label:"Looking For", fg:"#f59e0b", bg:"rgba(245,158,11,0.18)", border:"1px solid #f59e0b" },
                  completed:   { label:"✓ Completed", fg:C.grn,    bg:"rgba(34,197,94,0.22)",   border:"1px solid "+C.grn },
                }[tStatus];
                const completed = isRealTeam && tStatus === "completed";
                return (
                  <div key={team} style={{marginBottom:16,background:completed?"rgba(34,197,94,0.06)":C.card,borderRadius:12,border:(completed?"2px solid "+C.grn:"1px solid "+C.border),overflow:"hidden"}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",background:C.bg,borderBottom:"1px solid "+C.border,flexWrap:"wrap",gap:8}}>
                      <div style={{fontSize:13,fontWeight:800,color:C.gold}}>{team} <span style={{color:C.mut,fontWeight:600,fontSize:11,marginLeft:6}}>· {roster.length} accepted</span></div>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                        {isRealTeam && (
                          <button onClick={() => updateTeamStatus(team, { status: { in_progress:"looking", looking:"completed", completed:"in_progress" }[tStatus] })}
                            title="Click to change status: In Progress → Looking For → Completed"
                            style={{fontSize:10,fontWeight:800,padding:"3px 8px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",color:sMeta.fg,background:sMeta.bg,border:sMeta.border,whiteSpace:"nowrap"}}>{sMeta.label}</button>
                        )}
                        {COLS.map(([k,label],i) => (
                          <span key={k} style={{fontSize:10,fontWeight:700,padding:"3px 8px",borderRadius:8,background:totals[i]===roster.length?"rgba(34,197,94,0.18)":"rgba(255,255,255,0.04)",color:totals[i]===roster.length?C.grn:C.mut,border:"1px solid "+C.border}}>
                            {label}: {totals[i]}/{roster.length}
                          </span>
                        ))}
                      </div>
                    </div>
                    {isRealTeam && tStatus === "looking" && lookingPos.length > 0 && (
                      <div style={{fontSize:10,fontWeight:700,color:"#f59e0b",padding:"6px 14px",background:"rgba(245,158,11,0.06)",borderBottom:"1px solid "+C.border}}>Looking for: {lookingPos.join(", ")}</div>
                    )}
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
                                  {favStar(p.id)}{" "}
                                  <span onClick={()=>setProfileId(p.id)} style={{cursor:"pointer",fontWeight:700,color:hi?hi.color:C.text}}>
                                    {newIcon(p)}{p.first_name} {p.last_name}
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
        upd(playerId, { team_assignment: "", roster_pos: "", offer_status: "declined", offer_decision_at: now, status: "Declined" });
        return;
      }
      if (overId === "bucket-not_invited") {
        if (player.offer_status === "not_invited" && !player.team_assignment) return;
        upd(playerId, { team_assignment: "", roster_pos: "", offer_status: "not_invited", offer_made_at: null, offer_decision_at: null, status: "Not Invited" });
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
          updates.status = "In Progress";
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
      // Keep the player-card Status tag in sync with the chip.
      updates.status = OFFER_TO_STATUS[updates.offer_status] || "In Progress";
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
            // Average per-player avg score across players who have a roster
            // position on this team (i.e. real positional assignments, not
            // unslotted overflow). Skip players whose avg is "—" / not scored.
            const slotted = tp.filter(p => p.roster_pos);
            const scoredAvgs = slotted
              .map(p => parseFloat(avg(p)))
              .filter(v => !isNaN(v) && v > 0);
            const teamAvg = scoredAvgs.length
              ? (scoredAvgs.reduce((s,v) => s+v, 0) / scoredAvgs.length).toFixed(2)
              : null;
            // Per-team build status: in_progress (default) → looking → completed.
            const ts = teamStatus[team] || { status: "in_progress", looking_positions: [] };
            const tStatus = ts.status || "in_progress";
            const lookingPos = ts.looking_positions || [];
            const STATUS_NEXT = { in_progress: "looking", looking: "completed", completed: "in_progress" };
            const statusMeta = {
              in_progress: { label: "In Progress", fg: C.mut,    bg: "transparent",            border: "1px solid "+C.border },
              looking:     { label: "Looking For", fg: "#f59e0b", bg: "rgba(245,158,11,0.18)", border: "1px solid #f59e0b" },
              completed:   { label: "✓ Completed", fg: C.grn,    bg: "rgba(34,197,94,0.22)",   border: "1px solid "+C.grn },
            }[tStatus];
            const cardStyle = tStatus === "completed"
              ? { background:"rgba(34,197,94,0.08)", borderRadius:12, padding:"16px 18px", border:"2px solid "+C.grn }
              : tStatus === "looking"
              ? { background:C.card, borderRadius:12, padding:"16px 18px", border:"2px solid rgba(245,158,11,0.7)" }
              : { background:C.card, borderRadius:12, padding:"16px 18px", border:"1px solid "+C.border };
            const toggleLookingPos = (pos) => {
              const next = lookingPos.includes(pos) ? lookingPos.filter(x => x !== pos) : [...lookingPos, pos];
              updateTeamStatus(team, { looking_positions: next });
            };
            return (
              <DropZone key={team} id={"team-"+team} style={cardStyle}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,gap:6,flexWrap:"wrap"}}>
                  <h3 style={{margin:0,fontSize:17,fontWeight:800,color:C.gold,display:"flex",alignItems:"baseline",gap:8}}>
                    <span onClick={()=>setTeamCardName(team)} title="Open team card" style={{cursor:"pointer",textDecoration:"underline",textDecorationColor:"transparent",textUnderlineOffset:3}}
                      onMouseEnter={e=>e.currentTarget.style.textDecorationColor=C.gold}
                      onMouseLeave={e=>e.currentTarget.style.textDecorationColor="transparent"}>{team}</span>
                    {teamAvg && <span title="Average of per-player avg scores across players in roster positions" style={{fontSize:12,fontWeight:600,color:C.grn}}>avg {teamAvg}</span>}
                  </h3>
                  <div style={{display:"flex",gap:4,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>
                    <button onClick={() => updateTeamStatus(team, { status: STATUS_NEXT[tStatus] })}
                      title="Click to change team status: In Progress → Looking For → Completed"
                      style={{fontSize:10,fontWeight:800,padding:"2px 8px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",color:statusMeta.fg,background:statusMeta.bg,border:statusMeta.border,whiteSpace:"nowrap"}}>
                      {statusMeta.label}
                    </button>
                    <Tag c={C.acc}>{tp.length} players</Tag>
                    {offerLocked   > 0 && <Tag c="#a855f7">{offerLocked} locked</Tag>}
                    {offerAccepted > 0 && <Tag c={C.grn}>{offerAccepted} accepted</Tag>}
                    {offerPending  > 0 && <Tag c="#f59e0b">{offerPending} pending</Tag>}
                    {offerWaiting  > 0 && <Tag c="#06b6d4">{offerWaiting} waiting</Tag>}
                  </div>
                </div>
                {tStatus === "looking" && (
                  <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:10,padding:"6px 8px",background:"rgba(245,158,11,0.08)",borderRadius:8,border:"1px solid rgba(245,158,11,0.35)"}}>
                    <span style={{fontSize:10,fontWeight:800,color:"#f59e0b",textTransform:"uppercase"}}>Looking for:</span>
                    {POSITIONS.map(pos => {
                      const on = lookingPos.includes(pos);
                      return <button key={pos} onClick={()=>toggleLookingPos(pos)} title={POS_LABELS[pos]}
                        style={{fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",border:on?"1px solid #f59e0b":"1px solid "+C.border,background:on?"rgba(245,158,11,0.25)":"transparent",color:on?"#f59e0b":C.mut}}>{pos}</button>;
                    })}
                    {lookingPos.length === 0 && <span style={{fontSize:10,color:C.mut,fontStyle:"italic"}}>pick position(s)</span>}
                  </div>
                )}
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
                            {favStar(player.id,13)}
                            <span style={{display:"flex",alignItems:"center",gap:4,fontSize:12,fontWeight:600,flex:1,cursor:"pointer",color:nameColor}} onClick={()=>setProfileId(player.id)}>
                              {isReturningDSE(player) && <span title="DS Elite returning athlete" style={{color:C.gold,fontSize:14,fontWeight:800,lineHeight:1}}>◆</span>}{newIcon(player)}
                              {player.first_name} {player.last_name}
                              {hi && <span title={hi.label} style={{fontSize:8,fontWeight:800,color:hi.color,padding:"1px 5px",borderRadius:5,border:"1px solid "+hi.color,letterSpacing:0.5,marginLeft:2}}>{hi.label}</span>}
                            </span>
                            <div style={{display:"flex",gap:3,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>{offerChip(player)}{pinnyChip(player)}{posRankTags(player)}</div>
                            <span title="Average score" style={{fontWeight:800,fontSize:13,color:C.gold,minWidth:28,textAlign:"right"}}>{tot(player) ? avg(player) : "—"}</span>
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
                        {favStar(p.id,13)}
                        <span style={{display:"flex",alignItems:"center",gap:4,fontSize:12,fontWeight:600,flex:1,cursor:"pointer",color:nameColor}} onClick={()=>setProfileId(p.id)}>
                          {isReturningDSE(p) && <span title="DS Elite returning athlete" style={{color:C.gold,fontSize:14,fontWeight:800,lineHeight:1}}>◆</span>}{newIcon(p)}
                          {p.first_name} {p.last_name}
                          {hi && <span title={hi.label} style={{fontSize:8,fontWeight:800,color:hi.color,padding:"1px 5px",borderRadius:5,border:"1px solid "+hi.color,letterSpacing:0.5,marginLeft:2}}>{hi.label}</span>}
                        </span>
                        <div style={{display:"flex",gap:3,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>{offerChip(p)}{pinnyChip(p)}{posRankTags(p)}</div>
                        <span title="Average score" style={{fontWeight:800,fontSize:13,color:C.gold,minWidth:28,textAlign:"right"}}>{tot(p) ? avg(p) : "—"}</span>
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
                                {favStar(p.id,13)}
                                <span style={{display:"flex",alignItems:"center",gap:4,flex:1,fontWeight:600,cursor:"pointer",color:nameColor}} onClick={()=>setProfileId(p.id)}>
                                  {isReturningDSE(p) && <span title="DS Elite returning athlete" style={{color:C.gold,fontSize:14,fontWeight:800,lineHeight:1}}>◆</span>}{newIcon(p)}
                                  {p.first_name} {p.last_name}
                                  {hi && <span title={hi.label} style={{fontSize:8,fontWeight:800,color:hi.color,padding:"1px 5px",borderRadius:5,border:"1px solid "+hi.color,letterSpacing:0.5,marginLeft:2}}>{hi.label}</span>}
                                </span>
                                {pinnyChip(p)}
                                {p.projected_team && <Tag c={C.gold}>{p.projected_team}</Tag>}
                                <span title="Average score" style={{fontWeight:700,color:C.gold,minWidth:28,textAlign:"right"}}>{tot(p) ? avg(p) : "—"}</span>
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
                        {favStar(p.id,13)}
                        <span style={{display:"flex",alignItems:"center",gap:4,flex:1,fontWeight:600,cursor:"pointer"}} onClick={()=>setProfileId(p.id)}>
                          {isReturningDSE(p) && <span title="DS Elite returning athlete" style={{color:C.gold,fontSize:14,fontWeight:800,lineHeight:1}}>◆</span>}{newIcon(p)}
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
                          {isReturningDSE(p) && <span title="DS Elite returning athlete" style={{color:C.gold,fontSize:14,fontWeight:800,lineHeight:1}}>◆</span>}{newIcon(p)}
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
  function renderFavorites() {
    // Coach-private shortlist. favorites holds player_ids; show them best-first.
    const favPlayers = players.filter(p => favorites.includes(p.id))
      .sort((a, b) => (tot(b) || 0) - (tot(a) || 0) || (a.last_name || "").localeCompare(b.last_name || ""));
    return (
      <div>
        <div style={{display:"flex",alignItems:"baseline",gap:10,flexWrap:"wrap",marginBottom:4}}>
          <h2 style={{margin:0,fontSize:18,fontWeight:800,color:C.gold}}>My Favorites</h2>
          <span style={{fontSize:12,color:C.mut}}>{favPlayers.length} player{favPlayers.length===1?"":"s"}</span>
        </div>
        <div style={{fontSize:11,color:C.mut,marginBottom:14}}>
          Private to you — no other coach sees this list. Tap the ☆ star next to any player in Evaluate (or in their profile) to add them. Great for keeping a short list of ~10 to watch.
        </div>
        {favPlayers.length === 0
          ? <div style={{textAlign:"center",padding:40,color:C.mut,background:C.card,borderRadius:12,border:"1px dashed "+C.border}}>
              No favorites yet. Open <b style={{color:C.text}}>Evaluate</b> and tap the ☆ next to a player.
            </div>
          : <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:12}}>
              {favPlayers.map(p => {
                const score = tot(p);
                return (
                  <div key={p.id} style={{background:C.card,borderRadius:12,border:"1px solid "+C.border,padding:14,position:"relative"}}>
                    <button onClick={()=>toggleFavorite(p.id)} title="Remove from your favorites"
                      style={{position:"absolute",top:10,right:10,background:"none",border:"none",fontSize:18,cursor:"pointer",color:C.gold,lineHeight:1}}>★</button>
                    <div onClick={()=>setProfileId(p.id)} style={{cursor:"pointer"}}>
                      <div style={{display:"flex",alignItems:"center",gap:5,paddingRight:20}}>
                        {isReturningDSE(p) && <span title="DS Elite returning athlete" style={{color:C.gold,fontSize:13,fontWeight:800,lineHeight:1}}>◆</span>}
                        <span style={{fontWeight:800,fontSize:14,color:C.gold}}>{p.first_name} {p.last_name}</span>
                      </div>
                      <div style={{fontSize:11,color:C.mut,marginTop:3}}>Age {p.age} • {p.usavDiv||p.usav_div}{p.tryout_number?" • #"+p.tryout_number:""}</div>
                      <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:6}}>
                        {(p.positions||[]).map(pos => <Tag key={pos} c={C.grn}>{pos}</Tag>)}
                      </div>
                      <div style={{display:"flex",gap:14,marginTop:10,alignItems:"baseline"}}>
                        <div><span style={{fontSize:9,color:C.mut,textTransform:"uppercase",fontWeight:700}}>Total </span><span style={{fontWeight:800,fontSize:16,color:score?C.gold:C.mut}}>{score||"—"}</span></div>
                        <div><span style={{fontSize:9,color:C.mut,textTransform:"uppercase",fontWeight:700}}>Avg </span><span style={{fontWeight:700,fontSize:13}}>{avg(p)}</span></div>
                      </div>
                      <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:8}}>
                        {p.team_assignment && <Tag c={C.acc}>{p.team_assignment}</Tag>}
                        {p.status && p.status !== "In Progress" && <Tag c={STATUS_COLORS[p.status]}>{p.status}</Tag>}
                        {p.projected_team && <Tag c={C.gold}>Proj {p.projected_team}</Tag>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>}
      </div>
    );
  }

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
      { key:"dash",   label:"10yd Dash", sortable:true, defDir:"asc", get:p=>{ const v=parseFloat(p.sprint_10y); return Number.isFinite(v)?v:Infinity; } },
      { key:"jumpt",  label:"Jump Tch",  sortable:true, defDir:"desc", get:p=>{ const v=parseFloat(p.jump_touch);     return Number.isFinite(v)?v:-1; } },
      { key:"appt",   label:"Appr Tch",  sortable:true, defDir:"desc", get:p=>{ const v=parseFloat(p.approach_touch); return Number.isFinite(v)?v:-1; } },
      { key:"vert",   label:"Vert",   sortable:true,  defDir:"desc", get:p=>{ const v=vertical(p); return v==null?-1:v; } },
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
      // All players in the selected age groups, including those not yet
      // evaluated (unscored players sort to the bottom on score-based columns).
      .filter(p => !rankDate || (p.eval_dates||[]).includes(rankDate))
      .sort((a,b) => {
        const av = activeCol.get(a), bv = activeCol.get(b);
        if (av < bv) return -1 * dirMul;
        if (av > bv) return  1 * dirMul;
        return cmpName(a,b);
      });
    let shown = filterPos ? ranked.filter(p=>(p.positions||[]).includes(filterPos)) : ranked;
    if (rankAttended) shown = shown.filter(p => p.tryout_attended);
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
          <label title="Show only players marked as having attended tryouts" style={{display:"flex",alignItems:"center",gap:6,marginLeft:6,padding:"6px 10px",borderRadius:8,background:rankAttended?"rgba(34,197,94,0.14)":"transparent",border:"1px solid "+(rankAttended?C.grn:C.border),cursor:"pointer",fontSize:11,fontWeight:700,color:rankAttended?C.grn:C.mut,userSelect:"none",whiteSpace:"nowrap"}}>
            <input type="checkbox" checked={rankAttended} onChange={e=>setRankAttended(e.target.checked)} style={{width:14,height:14,cursor:"pointer",accentColor:C.grn}} />
            Attended tryouts
          </label>
          <span style={{fontSize:11,color:C.mut,marginLeft:"auto"}}>{shown.length} players</span>
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
                  <td style={tdS}><span style={{display:"inline-flex",alignItems:"center",gap:5}}>{favStar(p.id)}<span style={{display:"inline-flex",alignItems:"center",gap:5,fontWeight:700,fontSize:12,color:C.gold,cursor:"pointer"}} onClick={()=>setProfileId(p.id)}>{isReturningDSE(p) && <span title="DS Elite returning athlete" style={{color:C.gold,fontSize:14,fontWeight:800,lineHeight:1}}>◆</span>}{newIcon(p)}{p.first_name} {p.last_name}</span></span></td>
                  <td style={tdS}><span style={{fontWeight:700,color:p.tryout_number?C.gold:C.mut}}>{p.tryout_number ? "#"+p.tryout_number : "—"}</span></td>
                  <td style={tdS}>{p.age}</td>
                  <td style={tdS}><div style={{display:"flex",gap:2,flexWrap:"wrap"}}>{(p.positions||[]).map(pos=><Tag key={pos} c={C.grn}>{pos}</Tag>)}</div></td>
                  <td style={tdS}>{p.projected_team && <Tag c={C.gold}>{p.projected_team}</Tag>}</td>
                  {SKILLS.map(sk=><td key={sk} style={tdS}><span style={{fontWeight:600,color:(p.scores||{})[sk]>=4?C.grn:(p.scores||{})[sk]>=3?C.gold:(p.scores||{})[sk]?C.red:C.mut}}>{(p.scores||{})[sk]||"—"}</span></td>)}
                  <td style={tdS}><span style={{fontWeight:800,fontSize:15,color:C.gold}}>{tot(p)}</span></td>
                  <td style={tdS}><span style={{fontWeight:600}}>{avg(p)}</span></td>
                  <td style={tdS}><span style={{fontWeight:600,color:(p.sprint_10y!=null&&p.sprint_10y!=="")?C.text:C.mut}}>{(p.sprint_10y!=null&&p.sprint_10y!=="")?p.sprint_10y+"s":"—"}</span></td>
                  <td style={tdS}><span style={{fontWeight:600,color:(p.jump_touch!=null&&p.jump_touch!=="")?C.text:C.mut}}>{(p.jump_touch!=null&&p.jump_touch!=="")?p.jump_touch+'"':"—"}</span></td>
                  <td style={tdS}><span style={{fontWeight:600,color:(p.approach_touch!=null&&p.approach_touch!=="")?C.text:C.mut}}>{(p.approach_touch!=null&&p.approach_touch!=="")?p.approach_touch+'"':"—"}</span></td>
                  <td style={tdS}><span style={{fontWeight:700,color:vertical(p)!=null?C.grn:C.mut}}>{vertical(p)!=null?vertical(p).toFixed(1)+'"':"—"}</span></td>
                  <td style={tdS}>{p.team_assignment
                    ? <span onClick={e=>{e.stopPropagation();setTeamCardName(p.team_assignment);}} style={{cursor:"pointer"}} title="Open team card"><Tag c={C.grn}>{p.team_assignment}</Tag></span>
                    : <Tag c={C.mut}>—</Tag>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {!shown.length && <div style={{textAlign:"center",padding:28,color:C.mut}}>No players{filterPos?" at "+filterPos:""}</div>}
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
    const verticalVal = vertical(p);
    return (
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:1000,display:"flex",justifyContent:"center",padding:"30px 16px",overflowY:"auto"}} onClick={()=>setProfileId(null)}>
        <div style={{background:C.card,borderRadius:16,border:"1px solid "+C.border,maxWidth:700,width:"100%",maxHeight:"90vh",overflowY:"auto",padding:24}} onClick={e=>e.stopPropagation()}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}>
            <div>
              <h2 style={{margin:0,fontSize:22,fontWeight:800,color:C.gold,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                {isReturningDSE(p) && <span title="DS Elite returning athlete" style={{color:C.gold,fontSize:14,fontWeight:800,lineHeight:1}}>◆</span>}{newIcon(p)}
                {p.first_name} {p.last_name}
              </h2>
              <div style={{display:"flex",gap:5,marginTop:6,flexWrap:"wrap"}}>
                <Tag c={C.gold}>USAV: {p.usavDiv||p.usav_div}</Tag><Tag c={C.acc}>Reg: {p.reg_group}</Tag><Tag c={C.mut}>Age {p.age}</Tag>
                {(p.positions||[]).map(pos=><Tag key={pos} c={C.grn}>{pos}</Tag>)}
                {p.supplemental===1 && <Tag c={C.acc}>SUPPLEMENTAL</Tag>}
              </div>
            </div>
            <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
              <button onClick={()=>toggleFavorite(p.id)} title={favorites.includes(p.id)?"Remove from your favorites":"Add to your favorites"}
                style={{background:"none",border:"none",fontSize:26,cursor:"pointer",color:favorites.includes(p.id)?C.gold:C.border,lineHeight:1}}>
                {favorites.includes(p.id)?"★":"☆"}
              </button>
              <button style={{background:"none",border:"none",color:C.mut,fontSize:24,cursor:"pointer"}} onClick={()=>setProfileId(null)}>✕</button>
            </div>
          </div>
          {/* Score Summary */}
          <div style={{background:totalScore>0?"linear-gradient(135deg,rgba(233,30,140,0.15),rgba(34,197,94,0.1))":C.bg,borderRadius:12,padding:"14px 18px",marginBottom:16,border:"1px solid "+(totalScore>0?C.gold:C.border)}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div><div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut}} title="Sum of stat-skill scores (Blocking excluded)">Total</div><div style={{fontSize:36,fontWeight:800,color:totalScore>0?C.gold:C.mut}}>{totalScore||0}<span style={{fontSize:16,fontWeight:400,color:C.mut}}>/40</span></div></div>
              <div style={{textAlign:"center"}}><div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut}}>Avg</div><div style={{fontSize:28,fontWeight:800,color:totalScore>0?C.grn:C.mut}}>{avg(p)}</div></div>
              <div style={{textAlign:"right"}}><div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut}}>Scored</div><div style={{fontSize:28,fontWeight:800,color:scoredCount===9?C.grn:C.gold}}>{scoredCount}<span style={{fontSize:16,fontWeight:400,color:C.mut}}>/9</span></div></div>
            </div>
          </div>
          {/* Tryout — Physical Testing */}
          {(() => {
            const CM = 2.54;
            const isCm = phUnit === "cm";
            const u = isCm ? "cm" : "in";
            const toDisp = (inches) => inches == null ? "" : String(isCm ? +(inches * CM).toFixed(1) : inches);
            const fromInput = (v) => { const n = parseFloat(v); if (v.trim() === "" || isNaN(n)) return null; return isCm ? +(n / CM).toFixed(3) : n; };
            const heightField = (key, phIn, phCm) => (
              <DebouncedField key={key + "-" + phUnit} style={editInp} placeholder={isCm ? phCm : phIn}
                value={toDisp(p[key])} onCommit={v => upd(p.id, { [key]: fromInput(v) })} />
            );
            return (
            <div style={{marginBottom:16}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6,gap:8,flexWrap:"wrap"}}>
                <span style={{...lbl,marginBottom:0}}>Tryout — Physical Testing</span>
                <div style={{display:"inline-flex",border:"1px solid "+C.border,borderRadius:8,overflow:"hidden"}} title="Jump Touch & Approach Touch — type in inches or cm (stored as inches). Stand & Reach is always inches.">
                  <span style={{fontSize:9,fontWeight:700,color:C.mut,alignSelf:"center",padding:"0 6px",textTransform:"uppercase"}}>Touch</span>
                  {["in","cm"].map(opt => (
                    <button key={opt} type="button" onClick={()=>setPhUnit(opt)}
                      style={{padding:"3px 12px",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:800,textTransform:"uppercase",background:phUnit===opt?C.gold:"transparent",color:phUnit===opt?"#000":C.mut}}>{opt}</button>
                  ))}
                </div>
              </div>
              <div style={{background:C.bg,borderRadius:10,padding:14,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:12,alignItems:"start"}}>
                <div><span style={lbl}>Stand &amp; Reach (in)</span><DebouncedField style={editInp} placeholder='e.g. 84' value={p.stand_reach==null?"":String(p.stand_reach)} onCommit={v=>{const n=parseFloat(v); upd(p.id,{stand_reach:(v.trim()===""||isNaN(n))?null:n});}} /></div>
                <div><span style={lbl}>Jump Touch ({u})</span>{heightField("jump_touch","e.g. 102","e.g. 259")}</div>
                <div><span style={lbl}>Approach Touch ({u})</span>{heightField("approach_touch","e.g. 108","e.g. 274")}</div>
                <div><span style={lbl}>Vertical (auto, in)</span><div style={{...editInp,display:"flex",alignItems:"center",minHeight:36,fontWeight:800,color:verticalVal!=null?C.grn:C.mut,background:C.card}} title="Jump Touch − Stand &amp; Reach">{verticalVal!=null?verticalVal.toFixed(1)+'"':"—"}</div></div>
                <div><span style={lbl}>10 Yard Run (sec)</span><DebouncedField style={editInp} placeholder='e.g. 1.85' value={p.sprint_10y==null?"":String(p.sprint_10y)} onCommit={v=>{const n=parseFloat(v); upd(p.id,{sprint_10y:(v.trim()===""||isNaN(n))?null:n});}} /></div>
                <div><span style={lbl}>Tryout Attended</span><label style={{display:"flex",alignItems:"center",gap:8,padding:"9px 4px",cursor:"pointer"}}><input type="checkbox" checked={!!p.tryout_attended} onChange={e=>upd(p.id,{tryout_attended:e.target.checked})} style={{width:18,height:18,accentColor:C.gold,cursor:"pointer"}} /><span style={{fontSize:13,fontWeight:600,color:p.tryout_attended?C.grn:C.mut}}>{p.tryout_attended?"Present":"Not marked"}</span></label></div>
              </div>
              {isCm && <div style={{fontSize:10,color:C.mut,marginTop:6}}>Jump Touch &amp; Approach Touch entered in cm are converted to inches (÷ 2.54) for storage. Stand &amp; Reach and Vertical stay in inches.</div>}
            </div>
            );
          })()}
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
            <div><span style={lbl}>Team</span><select style={editInp} value={p.team_assignment||""} onChange={e=>assignTeamOrStatus(p,e.target.value)}><option value="">--</option>{(TM[p.usavDiv||p.usav_div]||[]).map(t=><option key={t} value={t}>{t}</option>)}</select></div>
            <div><span style={lbl}>Roster Pos</span><select style={editInp} value={p.roster_pos||""} onChange={e=>upd(p.id,{roster_pos:e.target.value})}><option value="">--</option>{ROSTER_POS.map(rp=>{const taken=players.some(o=>o.id!==p.id&&o.team_assignment===p.team_assignment&&o.roster_pos===rp);return <option key={rp} value={rp} disabled={taken}>{rp}{taken?" (taken)":""}</option>;})}</select></div>
            <div><span style={lbl}>Status</span><select style={{...editInp,color:STATUS_COLORS[p.status||"In Progress"]}} value={p.status||"In Progress"} onChange={e=>setPlayerStatus(p,e.target.value)}>{STATUS_OPTS.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
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
              <div><span style={lbl}>Parent Email 2</span><DebouncedField type="email" style={editInp} placeholder="email@example.com" value={p.parent_email2||""} onCommit={v=>upd(p.id,{parent_email2:v})} /></div>
              <div>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:6}}>
                  <span style={lbl}>Parent Phone</span>
                  {p.parent_phone && (
                    <div style={{display:"flex",gap:4}}>
                      {canOps && <button
                        title="Open SMS conversation with this parent"
                        onClick={async () => {
                          // Normalize to E.164 to find/create thread.
                          let phone = (p.parent_phone||"").replace(/[^\d+]/g,"");
                          if (!phone) return;
                          if (!phone.startsWith("+")) {
                            if (phone.length === 10) phone = "+1" + phone;
                            else if (phone.length === 11 && phone.startsWith("1")) phone = "+" + phone;
                          }
                          // Look up or create the thread, then switch to the Messages tab.
                          let { data: t } = await supabase.from("sms_threads").select("*").eq("phone", phone).maybeSingle();
                          if (!t) {
                            const ins = await supabase.from("sms_threads").insert({ phone, player_id: p.id }).select().single();
                            if (ins.error) { window.alert("Open chat failed: " + ins.error.message); return; }
                            t = ins.data;
                          } else if (!t.player_id) {
                            await supabase.from("sms_threads").update({ player_id: p.id }).eq("id", t.id);
                          }
                          setProfileId(null);
                          setSelectedThreadId(t.id);
                          setView("messages");
                        }}
                        style={{padding:"1px 8px",borderRadius:6,border:"1px solid "+C.gold,background:"transparent",color:C.gold,fontSize:9,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>
                        ✉ Text
                      </button>}
                      <button
                        title="Copy parent phone to clipboard"
                        onClick={() => {
                          const num = (p.parent_phone||"").replace(/[^\d+]/g,"");
                          if (!num) return;
                          if (navigator.clipboard) navigator.clipboard.writeText(num).catch(()=>{});
                        }}
                        style={{padding:"1px 8px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontSize:9,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>
                        Copy
                      </button>
                    </div>
                  )}
                </div>
                <DebouncedField style={editInp} placeholder="555-555-5555" value={p.parent_phone||""} onCommit={v=>upd(p.id,{parent_phone:v})} />
              </div>
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
          {/* Change History — on-demand audit trail for this player from change_log. */}
          {(() => {
            const fmtVal = (v) => {
              if (v === null || v === undefined || v === "") return "(empty)";
              let s = typeof v === "object" ? (() => { try { return JSON.stringify(v); } catch { return String(v); } })() : String(v);
              return s.length > 80 ? s.slice(0, 80) + "…" : s;
            };
            const loadHistory = async () => {
              setHistoryLoading(true);
              const { data, error } = await supabase.from("change_log")
                .select("*").eq("player_id", p.id)
                .order("created_at", { ascending: false }).limit(100);
              if (error) console.error("Load player history error:", error);
              setHistoryRows(data || []);
              setHistoryPlayerId(p.id);
              setHistoryLoading(false);
            };
            const toggleHistory = () => {
              const next = !historyOpen;
              setHistoryOpen(next);
              if (next && (historyPlayerId !== p.id || historyRows.length === 0)) loadHistory();
            };
            const rows = scrubScholarship(historyPlayerId === p.id ? historyRows : []);
            return (
              <div style={{marginTop:24,paddingTop:16,borderTop:"1px solid "+C.border}}>
                <button onClick={toggleHistory}
                  style={{display:"flex",alignItems:"center",gap:8,background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",padding:0,color:C.gold,fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5}}>
                  <span style={{fontSize:9,transform:historyOpen?"rotate(90deg)":"none",transition:"transform .15s"}}>▶</span>
                  Change History
                  {historyOpen && historyPlayerId === p.id && !historyLoading && <span style={{color:C.mut,fontWeight:600,textTransform:"none"}}>({rows.length})</span>}
                </button>
                {historyOpen && (
                  <div style={{marginTop:10}}>
                    {historyLoading && <div style={{fontSize:12,color:C.mut}}>Loading…</div>}
                    {!historyLoading && rows.length === 0 && <div style={{fontSize:12,color:C.mut}}>No recorded changes yet.</div>}
                    {!historyLoading && rows.length > 0 && (
                      <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:320,overflowY:"auto"}}>
                        {rows.map(e => {
                          const when = new Date(e.created_at).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
                          const who = e.actor_name || e.actor_email || "Unknown";
                          const fc = e.field_changes || {};
                          return (
                            <div key={e.id} style={{background:C.bg,border:"1px solid "+C.border,borderRadius:8,padding:"8px 10px"}}>
                              <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap",marginBottom:4}}>
                                <span style={{fontSize:11,fontWeight:700,color:e.action==="delete"?C.red:e.action==="insert"?C.grn:C.text}}>
                                  {e.action==="insert"?"Player added":e.action==="delete"?"Player deleted":"Edited"}
                                </span>
                                <span style={{fontSize:10,color:C.mut}}>{who} · {when}</span>
                              </div>
                              {e.action==="update" && (
                                <div style={{display:"flex",flexDirection:"column",gap:2}}>
                                  {Object.entries(fc).map(([field, val]) => (
                                    <div key={field} style={{fontSize:11,color:C.text,lineHeight:1.4}}>
                                      <span style={{color:C.gold,fontWeight:600}}>{field}</span>:{" "}
                                      <span style={{color:C.mut}}>{fmtVal(val && typeof val==="object" && "old" in val ? val.old : undefined)}</span>
                                      {" → "}
                                      <span>{fmtVal(val && typeof val==="object" && "new" in val ? val.new : val)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
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

  function renderAskAI() {
    if (!isOwner) return <div style={{padding:24,color:C.mut,textAlign:"center"}}>This tool is restricted to the club administrator.</div>;
    const examples = [
      "Find all players requesting scholarships or help with payments.",
      "Which players look undervalued — strong scores or notes but projected to a lower team?",
      "List players with no scores yet who still need evaluating.",
      "Who are the strongest setters, with the notes that back it up?",
    ];
    const runAsk = async () => {
      const q = askQ.trim();
      if (!q) return;
      setAskBusy(true); setAskErr(""); setAskAnswer("");
      try {
        const payload = players.map(p => ({
          name: ((p.first_name||"")+" "+(p.last_name||"")).trim(),
          div: p.usavDiv||p.usav_div||"",
          pos: (p.positions||[]).join("/"),
          scores: p.scores||{},
          avg: avg(p), tot: tot(p),
          proj: p.projected_team||"", team: p.team_assignment||"", status: p.status||"",
          minLvl: p.min_level||"",
          notes: p.notes||"", parentFeedback: p.parent_feedback_notes||"",
          strengths: p.strength_weakness||"", goal: p.goal||"", leaving: p.leaving_reason||"",
          currentTeam: p.current_team||"", school: p.school_team||"",
        }));
        const res = await fetch("/api/ask-players", { method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({ question: q, players: payload }) });
        let data = {}; try { data = await res.json(); } catch {}
        if (!res.ok) throw new Error(data.error || ("Request failed ("+res.status+")"));
        setAskAnswer(data.answer || "(no answer returned)");
      } catch (e) { setAskErr((e && e.message) || "Something went wrong."); }
      setAskBusy(false);
    };
    return (
      <div style={{maxWidth:860}}>
        <h2 style={{margin:0,fontSize:18,fontWeight:800,color:C.gold}}>Ask AI</h2>
        <div style={{fontSize:12,color:C.mut,marginTop:3,lineHeight:1.5}}>Ask questions about your players in plain language. The AI reads names, scores, projected teams, status, and every free-text note/feedback field across all {players.length} players, and answers with evidence.</div>
        <textarea value={askQ} onChange={e=>setAskQ(e.target.value)} placeholder="e.g. Find players who mentioned needing a scholarship or payment help"
          style={{...inpStyle,width:"100%",minHeight:70,padding:"10px 12px",fontSize:14,fontFamily:"inherit",resize:"vertical",marginTop:12}} />
        <div style={{display:"flex",gap:6,flexWrap:"wrap",margin:"8px 0"}}>
          {examples.map(ex => <button key={ex} onClick={()=>setAskQ(ex)} style={{padding:"5px 10px",borderRadius:14,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{ex}</button>)}
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <button onClick={runAsk} disabled={askBusy||!askQ.trim()} style={{padding:"9px 18px",borderRadius:8,border:"none",background:(askBusy||!askQ.trim())?C.border:C.gold,color:(askBusy||!askQ.trim())?C.mut:"#000",fontFamily:"inherit",fontSize:13,fontWeight:700,cursor:(askBusy||!askQ.trim())?"default":"pointer"}}>{askBusy?"Thinking…":"Ask"}</button>
          {askAnswer && !askBusy && <button onClick={()=>{navigator.clipboard.writeText(askAnswer);}} style={{padding:"9px 14px",borderRadius:8,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontFamily:"inherit",fontSize:12,fontWeight:700,cursor:"pointer"}}>Copy</button>}
        </div>
        {askErr && <div style={{marginTop:12,fontSize:13,color:"#ffb4b4",background:"rgba(239,68,68,0.12)",border:"1px solid rgba(239,68,68,0.4)",borderRadius:8,padding:"10px 12px"}}>⚠ {askErr}</div>}
        {askBusy && <div style={{marginTop:14,fontSize:13,color:C.mut}}>Reading {players.length} players and thinking… this can take several seconds.</div>}
        {askAnswer && !askBusy && <div style={{marginTop:14,background:C.card,border:"1px solid "+C.border,borderRadius:10,padding:"14px 16px",fontSize:13.5,lineHeight:1.6,whiteSpace:"pre-wrap",color:C.text}}>{askAnswer}</div>}
        <div style={{marginTop:14,fontSize:11,color:C.mut,lineHeight:1.5}}>Answers are AI-generated from your player data — double-check anything important before acting on it. Player notes/feedback are sent to the AI provider (Anthropic) to answer your question.</div>
      </div>
    );
  }

  // Add-Coach modal — fill in the new coach's details, then insert on Save
  // (no roster row is created until Save).
  function renderAddCoach() {
    const lbl = {fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut,marginBottom:4,display:"block"};
    const editInp = {...inpStyle,width:"100%",padding:"8px 10px",fontSize:13};
    const setF = (k,v) => setNewCoach(prev => ({...prev,[k]:v}));
    const close = () => setAddingCoach(false);
    const save = async () => {
      const c = newCoach;
      if (!c.first_name.trim() && !c.last_name.trim()) { window.alert("Enter at least a first or last name."); return; }
      const row = {
        first_name: c.first_name.trim() || "?",
        last_name:  c.last_name.trim()  || "",
        email:      c.email.trim() || null,
        phone:      c.phone.trim() || null,
        tshirt_size: c.tshirt_size.trim() || null,
        shoe_size:   c.shoe_size.trim() || null,
        sweatshirt_size: c.sweatshirt_size.trim() || null,
        notes:      c.notes.trim() || null,
      };
      const { error } = await supabase.from("coach_roster").insert(row);
      if (error) { window.alert("Add failed: " + error.message); return; }
      setAddingCoach(false);
      await loadCoachRoster();
    };
    return (
      <div onClick={close} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:1000,display:"flex",justifyContent:"center",padding:"30px 16px",overflowY:"auto"}}>
        <div onClick={e=>e.stopPropagation()} style={{background:C.card,borderRadius:16,border:"1px solid "+C.border,maxWidth:520,width:"100%",maxHeight:"90vh",overflowY:"auto",padding:24}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
            <h2 style={{margin:0,fontSize:18,fontWeight:800,color:C.gold}}>Add Coach</h2>
            <button onClick={close} style={{background:"none",border:"none",color:C.mut,fontSize:22,cursor:"pointer"}}>×</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
            <div><span style={lbl}>First Name *</span><input autoFocus style={editInp} value={newCoach.first_name} onChange={e=>setF("first_name",e.target.value)} placeholder="First" /></div>
            <div><span style={lbl}>Last Name</span><input style={editInp} value={newCoach.last_name} onChange={e=>setF("last_name",e.target.value)} placeholder="Last" /></div>
            <div><span style={lbl}>Email</span><input type="email" style={editInp} value={newCoach.email} onChange={e=>setF("email",e.target.value)} placeholder="name@example.com" /></div>
            <div><span style={lbl}>Phone</span><input style={editInp} value={newCoach.phone} onChange={e=>setF("phone",e.target.value)} placeholder="555-555-5555" /></div>
            <div><span style={lbl}>T-shirt</span><input style={editInp} value={newCoach.tshirt_size} onChange={e=>setF("tshirt_size",e.target.value)} placeholder="M" /></div>
            <div><span style={lbl}>Shoe</span><input style={editInp} value={newCoach.shoe_size} onChange={e=>setF("shoe_size",e.target.value)} placeholder="9.5 W" /></div>
            <div><span style={lbl}>Sweatshirt</span><input style={editInp} value={newCoach.sweatshirt_size} onChange={e=>setF("sweatshirt_size",e.target.value)} placeholder="L" /></div>
            <div style={{gridColumn:"1 / -1"}}><span style={lbl}>Notes</span><textarea style={{...editInp,minHeight:60,resize:"vertical"}} value={newCoach.notes} onChange={e=>setF("notes",e.target.value)} /></div>
          </div>
          <div style={{fontSize:11,color:C.mut,marginBottom:12}}>Account-only settings (Approved, Admin, Teams access, Age groups) appear once the coach signs up with this email, or you can set them in the table after saving.</div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <button onClick={close} style={{padding:"10px 18px",borderRadius:8,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
            <button onClick={save} style={{padding:"10px 18px",borderRadius:8,border:"none",background:C.gold,color:"#000",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Save coach</button>
          </div>
        </div>
      </div>
    );
  }

  function renderCoaches() {
    if (!isAdmin) {
      return <div style={{padding:24,color:C.mut,textAlign:"center"}}>The Coaches screen is restricted to admins.</div>;
    }
    const th = {padding:"8px 10px",textAlign:"left",fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut,borderBottom:"1px solid "+C.border,background:C.card,whiteSpace:"nowrap"};
    const td = {padding:"8px 10px",fontSize:12,borderBottom:"1px solid "+C.border,verticalAlign:"middle"};
    const pending = coachesList.filter(c => !c.is_approved);
    const guestCoach = coachesList.find(c => (c.email||"").toLowerCase() === GUEST_EMAIL);
    const toggleGuestDiv = (dv) => setGuestAgeGroups(prev => prev.includes(dv) ? prev.filter(x=>x!==dv) : [...prev, dv]);
    const saveGuestLogin = async () => {
      if (guestPassword.trim().length < 6) { setGuestMsg("Password must be at least 6 characters."); return; }
      setGuestBusy(true); setGuestMsg("");
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch("/api/guest-access", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + (session?.access_token || "") },
          body: JSON.stringify({ password: guestPassword.trim(), ageGroups: guestAgeGroups }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed");
        setGuestMsg("✓ Guest login saved — age groups: " + (guestAgeGroups.join(", ") || "(all)") + ". Share the password for shared devices; replies come to you.");
        setGuestPassword("");
        loadCoaches();
      } catch (e) { setGuestMsg("Error: " + ((e && e.message) || "request failed")); }
      finally { setGuestBusy(false); }
    };
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

        {/* Guest / shared-device login — one password-only login scoped to
            chosen age groups, for tablets at tryouts etc. */}
        <div style={{background:C.card,borderRadius:12,border:"1px solid "+C.border,padding:"16px 18px",marginBottom:18}}>
          <div style={{marginBottom:8}}>
            <h3 style={{margin:0,fontSize:14,fontWeight:800,color:C.gold,letterSpacing:0.5}}>GUEST / SHARED-DEVICE LOGIN</h3>
            <div style={{fontSize:11,color:C.mut,marginTop:2,lineHeight:1.5}}>
              One password-only login for shared devices. It has full access to the age groups you pick (no email needed — coaches just enter the password via the "Guest / shared-device login" link on the sign-in screen).
              {guestCoach
                ? <> Currently scoped to: <b style={{color:C.text}}>{(guestCoach.team_divs||[]).join(", ") || "all age groups"}</b>.</>
                : <> Not set up yet.</>}
            </div>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:10}}>
            {DIVS.map(dv => {
              const on = guestAgeGroups.includes(dv);
              return (
                <button key={dv} onClick={()=>toggleGuestDiv(dv)}
                  style={{padding:"4px 10px",borderRadius:8,border:"1px solid "+(on?C.gold:C.border),background:on?C.gold+"22":"transparent",color:on?C.gold:C.mut,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                  {dv}
                </button>
              );
            })}
            <span style={{fontSize:10,color:C.mut,alignSelf:"center",marginLeft:4}}>{guestAgeGroups.length===0?"none selected = all age groups":guestAgeGroups.length+" selected"}</span>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <input type="text" value={guestPassword} onChange={e=>setGuestPassword(e.target.value)} placeholder="Set guest password (min 6 chars)"
              style={{...inpStyle,flex:"1 1 240px",padding:"9px 12px",fontSize:13}} />
            <button onClick={saveGuestLogin} disabled={guestBusy || guestPassword.trim().length<6}
              style={{padding:"9px 18px",borderRadius:8,border:"none",background:(guestBusy||guestPassword.trim().length<6)?C.border:C.gold,color:(guestBusy||guestPassword.trim().length<6)?C.mut:"#000",fontFamily:"inherit",fontSize:13,fontWeight:700,cursor:(guestBusy||guestPassword.trim().length<6)?"default":"pointer"}}>
              {guestBusy ? "Saving…" : (guestCoach ? "Update guest login" : "Create guest login")}
            </button>
          </div>
          {guestMsg && <div style={{marginTop:8,fontSize:12,fontWeight:600,color:guestMsg.startsWith("Error")?C.red:C.grn}}>{guestMsg}</div>}
        </div>

        {/* Merged coach directory — every club coach (roster + login
            account) in one editable table. Joined by lowercased email. */}
        {(() => {
        const byEmail = new Map();
        for (const r of coachRoster) {
          const k = (r.email||"").toLowerCase().trim() || ("roster-" + r.id);
          byEmail.set(k, { roster: r, account: null });
        }
        for (const c of coachesList) {
          const k = (c.email||"").toLowerCase().trim();
          if (k && byEmail.has(k)) byEmail.get(k).account = c;
          else byEmail.set(k || ("acct-" + c.id), { roster: null, account: c });
        }
        const merged = Array.from(byEmail.values()).sort((a, b) => {
          const an = (a.roster?.first_name || a.account?.display_name || "").toLowerCase();
          const bn = (b.roster?.first_name || b.account?.display_name || "").toLowerCase();
          return an.localeCompare(bn);
        });
        return (
          <>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8}}>
          <div>
            <h2 style={{margin:0,fontSize:18,fontWeight:800,color:C.gold}}>Coaches</h2>
            <div style={{fontSize:11,color:C.mut,marginTop:2}}>{merged.length} total · {coachesList.length} with login · {pending.length} awaiting approval</div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={() => { setNewCoach({ first_name:"", last_name:"", email:"", phone:"", tshirt_size:"", shoe_size:"", sweatshirt_size:"", notes:"" }); setAddingCoach(true); }}
              style={{padding:"6px 14px",borderRadius:8,border:"1px solid "+C.gold,background:"transparent",color:C.gold,fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
              + Add Coach
            </button>
            <button onClick={exportCoachesCSV}
              title="Download every coach (roster + login) as a single CSV with all columns"
              style={{padding:"6px 12px",borderRadius:6,border:"1px solid "+C.gold,background:"transparent",color:C.gold,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
              Export CSV
            </button>
            <button onClick={() => { loadCoaches(); loadCoachRoster(); }} disabled={coachesLoading}
              style={{padding:"6px 12px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
              {coachesLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>
        {pending.length > 0 && (
          <div style={{background:"rgba(245,158,11,0.08)",border:"1px solid rgba(245,158,11,0.35)",borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:12,color:"#f59e0b"}}>
            {pending.length} coach{pending.length===1?" is":"es are"} waiting to be approved.
          </div>
        )}
        <div style={{background:C.card,borderRadius:12,border:"1px solid "+C.border,overflow:"hidden"}}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0,minWidth:1500}}>
              <thead><tr>
                <th style={th}>First</th>
                <th style={th}>Last</th>
                <th style={th}>Email</th>
                <th style={th}>Phone</th>
                <th style={th}>Approved</th>
                <th style={th}>Admin</th>
                <th style={th}>Teams</th>
                <th style={th}>Age Groups</th>
                <th style={th}>T-shirt</th>
                <th style={th}>Shoe</th>
                <th style={th}>Sweatshirt</th>
                <th style={th}>Last seen</th>
                <th style={th}>Notes</th>
                <th style={th}></th>
              </tr></thead>
              <tbody>
                {merged.map(({roster: r, account: c}) => {
                  const rowKey = (r && "ros-"+r.id) || (c && "acc-"+c.id);
                  const isSelf = c && c.id === coach.id;
                  const hasAccount = !!c;
                  const hasRoster = !!r;
                  const firstName = r?.first_name || ((c?.display_name||"").split(/\s+/)[0]) || "";
                  const lastName  = r?.last_name  || ((c?.display_name||"").split(/\s+/).slice(1).join(" ")) || "";
                  // Roster upsert — create the row if it doesn't exist yet.
                  const upsertRoster = async (patch) => {
                    if (r) {
                      const { error } = await supabase.from("coach_roster")
                        .update({ ...patch, updated_at: new Date().toISOString() })
                        .eq("id", r.id);
                      if (error) { window.alert("Save failed: " + error.message); return; }
                    } else {
                      const insert = {
                        first_name: firstName || "?",
                        last_name:  lastName  || "?",
                        email:      c?.email  || "",
                        ...patch,
                      };
                      const { error } = await supabase.from("coach_roster").insert(insert);
                      if (error) { window.alert("Save failed: " + error.message); return; }
                    }
                    await loadCoachRoster();
                  };
                  const rcell = (key, placeholder, width) => (
                    <td style={td}>
                      <DebouncedField style={{...inpStyle,padding:"5px 8px",fontSize:12,width:width||"100%",minWidth:width||70}}
                        value={(r && r[key])||""}
                        placeholder={placeholder}
                        onCommit={v => upsertRoster({ [key]: v })} />
                    </td>
                  );
                  return (
                    <tr key={rowKey} style={{background: (hasAccount && !c.is_approved) ? "rgba(245,158,11,0.05)" : "transparent"}}>
                      <td style={td}>
                        <span onClick={() => setCoachCardName((firstName + " " + lastName).trim() || firstName)}
                          title="Open coach card — teams, practices, tournaments"
                          style={{fontSize:12,fontWeight:700,color:C.text,cursor:"pointer",textDecoration:"underline",textDecorationColor:"transparent",textUnderlineOffset:2}}
                          onMouseEnter={e=>e.currentTarget.style.textDecorationColor=C.gold}
                          onMouseLeave={e=>e.currentTarget.style.textDecorationColor="transparent"}>
                          {firstName || <i style={{color:C.mut,fontWeight:400}}>—</i>}
                        </span>
                      </td>
                      <td style={td}>
                        <span onClick={() => setCoachCardName((firstName + " " + lastName).trim() || firstName)}
                          title="Open coach card — teams, practices, tournaments"
                          style={{fontSize:12,fontWeight:700,color:C.text,cursor:"pointer",textDecoration:"underline",textDecorationColor:"transparent",textUnderlineOffset:2}}
                          onMouseEnter={e=>e.currentTarget.style.textDecorationColor=C.gold}
                          onMouseLeave={e=>e.currentTarget.style.textDecorationColor="transparent"}>
                          {lastName || <i style={{color:C.mut,fontWeight:400}}>—</i>}
                        </span>
                      </td>
                      <td style={td}>
                        {hasAccount ? (
                          <span style={{fontSize:12,color:C.text}}>{c.email}{isSelf && <span style={{color:C.gold,marginLeft:6,fontSize:10}}>(you)</span>}</span>
                        ) : (
                          <DebouncedField style={{...inpStyle,padding:"5px 8px",fontSize:12,minWidth:180}}
                            value={(r && r.email)||""}
                            placeholder="name@example.com"
                            onCommit={v => upsertRoster({ email: v })} />
                        )}
                      </td>
                      {rcell("phone","555-555-5555",130)}
                      {/* Approved */}
                      <td style={td}>
                        {hasAccount ? (
                          <label style={{display:"inline-flex",alignItems:"center",gap:6,cursor:isSelf?"default":"pointer"}}>
                            <input type="checkbox" checked={!!c.is_approved} disabled={isSelf}
                              onChange={e => updateCoach(c.id, { is_approved: e.target.checked })}
                              style={{width:16,height:16,accentColor:C.grn,cursor:isSelf?"default":"pointer"}} />
                            <span style={{fontSize:11,color:c.is_approved?C.grn:C.mut,fontWeight:600}}>{c.is_approved?"Yes":"No"}</span>
                          </label>
                        ) : <span style={{fontSize:10,color:C.mut,fontStyle:"italic"}}>no login</span>}
                      </td>
                      {/* Admin */}
                      <td style={td}>
                        {hasAccount ? (
                          <label style={{display:"inline-flex",alignItems:"center",gap:6,cursor:isSelf?"default":"pointer"}}>
                            <input type="checkbox" checked={!!c.is_admin} disabled={isSelf}
                              onChange={e => updateCoach(c.id, { is_admin: e.target.checked })}
                              style={{width:16,height:16,accentColor:C.gold,cursor:isSelf?"default":"pointer"}} />
                            <span style={{fontSize:11,color:c.is_admin?C.gold:C.mut,fontWeight:600}}>{c.is_admin?"Yes":"No"}</span>
                          </label>
                        ) : <span style={{color:C.mut}}>—</span>}
                      </td>
                      {/* Teams */}
                      <td style={td}>
                        {hasAccount ? (
                          <label style={{display:"inline-flex",alignItems:"center",gap:6,cursor:"pointer"}}>
                            <input type="checkbox" checked={!!c.can_view_teams}
                              onChange={e => updateCoach(c.id, { can_view_teams: e.target.checked })}
                              style={{width:16,height:16,accentColor:C.acc,cursor:"pointer"}} />
                            <span style={{fontSize:11,color:c.can_view_teams?C.acc:C.mut,fontWeight:600}}>{c.can_view_teams?"Yes":"No"}</span>
                          </label>
                        ) : <span style={{color:C.mut}}>—</span>}
                      </td>
                      {/* Age groups */}
                      <td style={td}>
                        {hasAccount ? (
                          <div style={{display:"flex",flexWrap:"wrap",gap:3,maxWidth:220}}>
                            {DIVS.map(dv => {
                              const on = (c.team_divs||[]).includes(dv);
                              return (
                                <button key={dv} title={dv}
                                  onClick={() => {
                                    const cur = c.team_divs || [];
                                    const next = on ? cur.filter(x => x !== dv) : [...cur, dv];
                                    updateCoach(c.id, { team_divs: next });
                                  }}
                                  style={{padding:"2px 6px",borderRadius:6,border:"1px solid "+(on?C.gold:C.border),background:on?C.gold+"22":"transparent",color:on?C.gold:C.mut,fontSize:9,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                                  {dv.replace("U","")}
                                </button>
                              );
                            })}
                          </div>
                        ) : <span style={{color:C.mut}}>—</span>}
                      </td>
                      {rcell("tshirt_size","M",60)}
                      {rcell("shoe_size","9.5 W",80)}
                      {rcell("sweatshirt_size","L",60)}
                      {/* Last seen */}
                      <td style={{...td,color:C.mut,whiteSpace:"nowrap",fontSize:11}}>{c?.last_seen_at ? new Date(c.last_seen_at).toLocaleDateString() : "—"}</td>
                      {rcell("notes","",140)}
                      {/* Actions */}
                      <td style={{...td,textAlign:"right",whiteSpace:"nowrap"}}>
                        {hasRoster && (
                          <button onClick={async () => {
                            const name = (firstName + " " + lastName).trim();
                            if (!window.confirm("Remove " + name + " from the coach roster? Their login account (if any) is not affected.")) return;
                            const { error } = await supabase.from("coach_roster").delete().eq("id", r.id);
                            if (error) { window.alert("Delete failed: " + error.message); return; }
                            await loadCoachRoster();
                          }} title="Remove from roster"
                            style={{padding:"3px 9px",borderRadius:5,border:"1px solid "+C.red,background:"transparent",color:C.red,fontFamily:"inherit",fontSize:10,fontWeight:700,cursor:"pointer"}}>
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!merged.length && <div style={{padding:24,textAlign:"center",color:C.mut,fontSize:12}}>{coachesLoading ? "Loading…" : "No coaches yet — click '+ Add Coach' or run the seed SQL."}</div>}
          </div>
        </div>
        <div style={{fontSize:11,color:C.mut,marginTop:10,lineHeight:1.6}}>
          Single merged directory. Roster fields (name, phone, sizes, notes) live in coach_roster; the Approved / Admin / Teams / Age Groups toggles only apply to coaches who've created a login account. Edit a roster field for a login-only coach and a roster row is created automatically.
        </div>
          </>
        );
        })()}
      </div>
    );
  }

  // ─── TEAM CARD (unified detail modal) ────────────────────────────────
  // One stop view: coaches, players, practice slots, and tournament
  // assignments for the selected team. Opened by clicking any team name
  // in the Practice grid.
  // ─── ALL TEAMS DIRECTORY ─────────────────────────────────────────────
  // Browse every team across all age groups; click any card to open the
  // unified team card (coaches, roster, practice, tournaments). Pulls from
  // practice_teams (the canonical team list).
  function renderTeamDirectory() {
    if (!canViewTeams) return <div style={{padding:24,color:C.mut,textAlign:"center"}}>Team lists are restricted. Ask the club administrator (Drew) for access.</div>;
    const q = teamDirSearch.trim().toLowerCase();
    const ageOf = (t) => parseInt((t.age_div || t.team_name || "").replace(/[^0-9]/g, "")) || 0;
    const levelColor = lv =>
      lv === "National" ? C.gold : lv === "Regional" ? C.acc : lv === "Developmental" ? "#06b6d4" : C.mut;
    const teams = practiceTeams
      .filter(t => !q
        || (t.team_name||"").toLowerCase().includes(q)
        || (t.head_coach||"").toLowerCase().includes(q)
        || (t.assistant_coach||"").toLowerCase().includes(q)
        || (t.level||"").toLowerCase().includes(q))
      .slice()
      .sort((a, b) => ageOf(a) - ageOf(b) || (a.team_name||"").localeCompare(b.team_name||""));
    const groups = {};
    teams.forEach(t => { const g = t.age_div || ("U" + ageOf(t)); (groups[g] = groups[g] || []).push(t); });
    const groupKeys = Object.keys(groups).sort((a, b) =>
      (parseInt(a.replace(/\D/g, "")) || 0) - (parseInt(b.replace(/\D/g, "")) || 0));
    const counts = (t) => ({
      players: players.filter(p => p.team_assignment === t.team_name).length,
      practices: practiceAssignments.filter(a => a.team_name === t.team_name && (a.phase || "fall1") === schedulePhase).length,
      tournaments: tournamentAssignments.filter(ta => ta.team_id === t.team_name || ta.team_name === t.team_name).length,
    });
    return (
      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:10,marginBottom:14}}>
          <div>
            <h2 style={{margin:0,fontSize:20,fontWeight:800,color:C.gold}}>All Teams</h2>
            <div style={{fontSize:12,color:C.mut,marginTop:4}}>{practiceTeams.length} team{practiceTeams.length===1?"":"s"}. Click a team for its coaches, roster, practice, and tournaments.</div>
          </div>
          <input value={teamDirSearch} onChange={e=>setTeamDirSearch(e.target.value)} placeholder="Search team or coach…"
            style={{...inpStyle,padding:"8px 12px",fontSize:13,minWidth:220}} />
        </div>
        {renderChecklistSetup()}
        {practiceTeams.length === 0 ? (
          <div style={{padding:30,textAlign:"center",color:C.mut,fontSize:13,background:C.card,borderRadius:12,border:"1px solid "+C.border}}>
            No teams found. Add teams in the Practice tab.
          </div>
        ) : teams.length === 0 ? (
          <div style={{padding:24,textAlign:"center",color:C.mut,fontSize:13}}>No teams match “{teamDirSearch}”.</div>
        ) : groupKeys.map(g => (
          <div key={g} style={{marginBottom:18}}>
            <h3 style={{margin:"0 0 8px 0",fontSize:13,fontWeight:800,color:C.gold,textTransform:"uppercase",letterSpacing:1,borderBottom:"1px solid "+C.border,paddingBottom:6}}>{g} <span style={{color:C.mut,fontWeight:600}}>· {groups[g].length}</span></h3>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(248px,1fr))",gap:10}}>
              {groups[g].map(t => {
                const c = counts(t);
                // Mirror the Teams-board status here (same team_status row).
                const ts = teamStatus[t.team_name] || { status:"in_progress", looking_positions:[] };
                const tStatus = ts.status || "in_progress";
                const lookingPos = ts.looking_positions || [];
                const sMeta = {
                  in_progress: { label:"In Progress", fg:C.mut,    bg:"transparent",            border:"1px solid "+C.border },
                  looking:     { label:"Looking For", fg:"#f59e0b", bg:"rgba(245,158,11,0.18)", border:"1px solid #f59e0b" },
                  completed:   { label:"✓ Completed", fg:C.grn,    bg:"rgba(34,197,94,0.22)",   border:"1px solid "+C.grn },
                }[tStatus];
                const completed = tStatus === "completed";
                const cardBg = completed ? "rgba(34,197,94,0.08)" : C.card;
                const baseBorder = completed ? C.grn : C.border;
                return (
                  <div key={t.id || t.team_name} onClick={()=>setTeamCardName(t.team_name)} title="Open team card"
                    style={{background:cardBg,borderRadius:12,border:(completed?"2px solid ":"1px solid ")+baseBorder,padding:"12px 14px",cursor:"pointer"}}
                    onMouseEnter={e=>e.currentTarget.style.borderColor=C.gold}
                    onMouseLeave={e=>e.currentTarget.style.borderColor=baseBorder}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                      <span style={{fontSize:16,fontWeight:800,color:levelColor(t.level)}}>{t.team_name}</span>
                      {t.level && <span style={{fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:0.5,color:levelColor(t.level)}}>{t.level}</span>}
                    </div>
                    <div style={{fontSize:11,color:C.mut,marginTop:6,lineHeight:1.5}}>
                      <div><span style={{color:C.mut}}>HC:</span> <span style={{color:t.head_coach?C.text:C.mut}}>{t.head_coach||"—"}</span></div>
                      <div><span style={{color:C.mut}}>AC:</span> <span style={{color:t.assistant_coach?C.text:C.mut}}>{t.assistant_coach||"—"}</span></div>
                    </div>
                    <div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap",alignItems:"center"}}>
                      <button onClick={(e)=>{ e.stopPropagation(); updateTeamStatus(t.team_name, { status: { in_progress:"looking", looking:"completed", completed:"in_progress" }[tStatus] }); }}
                        title="Click to change status: In Progress → Looking For → Completed"
                        style={{fontSize:10,fontWeight:800,padding:"2px 8px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",color:sMeta.fg,background:sMeta.bg,border:sMeta.border,whiteSpace:"nowrap"}}>{sMeta.label}</button>
                      <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:8,background:C.bg,border:"1px solid "+C.border,color:c.players?C.text:C.mut}}>{c.players} player{c.players===1?"":"s"}</span>
                      <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:8,background:C.bg,border:"1px solid "+C.border,color:c.practices?C.text:C.mut}}>{c.practices} practice{c.practices===1?"":"s"}</span>
                      <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:8,background:C.bg,border:"1px solid "+C.border,color:c.tournaments?C.text:C.mut}}>{c.tournaments} tourney{c.tournaments===1?"":"s"}</span>
                      {(() => {
                        const appr = practiceApprovals[t.team_name];
                        const ok = appr && appr.approved;
                        return <span title={ok ? "Practice schedule approved"+(appr.approved_by_name?" by "+appr.approved_by_name:"") : "Practice schedule not yet approved by the coach"}
                          style={{fontSize:10,fontWeight:800,padding:"2px 8px",borderRadius:8,background:ok?"rgba(34,197,94,0.18)":"rgba(245,158,11,0.15)",border:"1px solid "+(ok?C.grn:"#f59e0b"),color:ok?C.grn:"#f59e0b",whiteSpace:"nowrap"}}>{ok?"✓ Practice OK":"⚠ Practice pending"}</span>;
                      })()}
                    </div>
                    {tStatus === "looking" && lookingPos.length > 0 && (
                      <div style={{fontSize:10,fontWeight:700,color:"#f59e0b",marginTop:8}}>Looking for: {lookingPos.join(", ")}</div>
                    )}
                    <div onClick={(e)=>e.stopPropagation()}>{renderOpsChecklist(t.team_name, canOps)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderTeamCard() {
    const team = practiceTeams.find(t => t.team_name === teamCardName);
    const close = () => setTeamCardName(null);
    const divFromName = teamCardName ? teamCardName.match(/^\d+/)?.[0] : null;
    const teamDiv = divFromName ? "U" + divFromName : null;
    const teamPlayers = players
      .filter(p => p.team_assignment === teamCardName)
      .sort((a, b) => {
        const ra = (a.roster_pos||"").localeCompare(b.roster_pos||"");
        if (ra !== 0) return ra;
        return (a.last_name||"").localeCompare(b.last_name||"");
      });
    // Tournament assignments — match this team_name across the assignments table.
    const teamTournamentAssignments = tournamentAssignments.filter(ta => ta.team_id === teamCardName || ta.team_name === teamCardName);
    const tournamentById = new Map(tournaments.map(t => [t.id, t]));
    const teamTournaments = teamTournamentAssignments
      .map(ta => ({ ...ta, tournament: tournamentById.get(ta.tournament_id) }))
      .filter(x => x.tournament)
      .sort((a, b) => (a.tournament.start_date || "").localeCompare(b.tournament.start_date || ""));

    const lbl = {fontSize:10,fontWeight:800,letterSpacing:0.5,textTransform:"uppercase",color:C.mut,marginBottom:6};
    const sectionBox = {background:C.bg,borderRadius:10,padding:14,marginBottom:14};
    const levelColor = !team ? C.gold :
      team.level === "National"      ? C.gold :
      team.level === "Regional"      ? C.acc  :
      team.level === "Developmental" ? "#06b6d4" : C.mut;

    return (
      <div onClick={close} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:1000,display:"flex",justifyContent:"center",padding:"30px 16px",overflowY:"auto"}}>
        <div onClick={e=>e.stopPropagation()} style={{background:C.card,borderRadius:16,border:"1px solid "+C.border,maxWidth:780,width:"100%",maxHeight:"90vh",overflowY:"auto",padding:24}}>
          <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:10,marginBottom:16}}>
            <div>
              <h2 style={{margin:0,fontSize:22,fontWeight:800,color:levelColor}}>{teamCardName}</h2>
              {team && <div style={{fontSize:11,color:C.mut,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",marginTop:2}}>{team.level||"—"} · {team.age_div||"—"} · {team.practices_per_week} practice{team.practices_per_week===1?"":"s"}/wk</div>}
            </div>
            <button onClick={close} style={{background:"none",border:"none",color:C.mut,fontSize:22,cursor:"pointer",lineHeight:1}}>✕</button>
          </div>

          {/* Coaches */}
          <div style={sectionBox}>
            <div style={lbl}>Coaches</div>
            {!team && <div style={{fontSize:11,color:C.mut,fontStyle:"italic"}}>No practice_teams record for this team.</div>}
            {team && (
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                <div>
                  <div style={{fontSize:9,fontWeight:700,color:C.mut,textTransform:"uppercase",letterSpacing:0.5,marginBottom:4}}>Head</div>
                  {team.head_coach
                    ? <span onClick={()=>{ setTeamCardName(null); setCoachCardName(team.head_coach); }} title="Open coach card" style={{fontSize:14,fontWeight:700,color:C.text,cursor:"pointer",textDecoration:"underline",textDecorationColor:"transparent"}}
                        onMouseEnter={e=>e.currentTarget.style.textDecorationColor=C.gold}
                        onMouseLeave={e=>e.currentTarget.style.textDecorationColor="transparent"}>{team.head_coach}</span>
                    : <i style={{color:C.mut,fontWeight:400}}>not assigned</i>}
                </div>
                <div>
                  <div style={{fontSize:9,fontWeight:700,color:C.mut,textTransform:"uppercase",letterSpacing:0.5,marginBottom:4}}>Assistant</div>
                  {team.assistant_coach
                    ? <span onClick={()=>{ setTeamCardName(null); setCoachCardName(team.assistant_coach); }} title="Open coach card" style={{fontSize:14,fontWeight:700,color:C.text,cursor:"pointer",textDecoration:"underline",textDecorationColor:"transparent"}}
                        onMouseEnter={e=>e.currentTarget.style.textDecorationColor=C.gold}
                        onMouseLeave={e=>e.currentTarget.style.textDecorationColor="transparent"}>{team.assistant_coach}</span>
                    : <i style={{color:C.mut,fontWeight:400}}>not assigned</i>}
                </div>
              </div>
            )}
          </div>

          {/* Players */}
          <div style={sectionBox}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
              <div style={lbl}>Players · {teamPlayers.length}</div>
            </div>
            {teamPlayers.length === 0 && <div style={{fontSize:11,color:C.mut,fontStyle:"italic"}}>No players assigned to this team yet.</div>}
            {teamPlayers.length > 0 && (
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                {teamPlayers.map(p => (
                  <div key={p.id} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 8px",background:C.card,borderRadius:6,border:"1px solid "+C.border,fontSize:12}}>
                    <span style={{fontWeight:700,fontSize:11,color:p.roster_pos?C.gold:C.mut,minWidth:36}}>{p.roster_pos || "—"}</span>
                    {favStar(p.id,13)}
                    <span onClick={()=>{ setTeamCardName(null); setProfileId(p.id); }}
                      style={{fontWeight:600,cursor:"pointer",flex:1,color:C.text}}>
                      {p.first_name} {p.last_name}
                    </span>
                    {(p.positions||[]).map(pos => <Tag key={pos} c={C.grn}>{pos}</Tag>)}
                    {p.tryout_number && <span style={{fontSize:10,color:C.mut}}>#{p.tryout_number}</span>}
                    <span style={{fontWeight:800,fontSize:13,color:C.gold,minWidth:30,textAlign:"right"}}>{tot(p)||"—"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Practice schedule — all phases, adjacent slots merged */}
          {(() => {
            const summary = summarizePractices(practiceAssignments.filter(a => a.team_name === teamCardName));
            return (
              <div style={sectionBox}>
                <div style={lbl}>Practice Schedule · all phases</div>
                {summary.length === 0 && <div style={{fontSize:11,color:C.mut,fontStyle:"italic"}}>No practice slots assigned. Open the Practice tab to schedule.</div>}
                {summary.map(ph => (
                  <div key={ph.id} style={{marginBottom:8}}>
                    <div style={{fontSize:9,fontWeight:800,color:C.gold,textTransform:"uppercase",letterSpacing:0.5,marginBottom:4}}>{ph.label}</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {ph.entries.map((e, i) => (
                        <span key={i} style={{fontSize:11,fontWeight:700,padding:"4px 10px",borderRadius:8,background:C.card,color:C.text,border:"1px solid "+C.border}}>
                          {e.day} · {e.slot}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Tournament schedule */}
          <div style={sectionBox}>
            <div style={lbl}>Tournament Schedule · {teamTournaments.length}</div>
            {teamTournaments.length === 0 && <div style={{fontSize:11,color:C.mut,fontStyle:"italic"}}>No tournament assignments. Open the Tournaments tab to assign.</div>}
            {teamTournaments.length > 0 && (
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {teamTournaments.map(({tournament:tn, ...a}, i) => (
                  <div key={i} style={{padding:"6px 10px",background:C.card,borderRadius:6,border:"1px solid "+C.border,fontSize:12}}>
                    <div style={{fontWeight:700,color:C.text}}>{tn.name}</div>
                    <div style={{fontSize:10,color:C.mut,marginTop:2}}>
                      {tn.start_date}{tn.end_date && tn.end_date !== tn.start_date ? " – " + tn.end_date : ""}
                      {tn.location && " · " + tn.location}
                      {tn.is_qualifier && <span style={{color:"#a855f7",marginLeft:8,fontWeight:700}}>QUALIFIER</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── COACH CARD (unified detail modal) ───────────────────────────────
  // One-stop view for a coach: contact info, teams they lead or assist,
  // weekly practice load, and tournament assignments. Opened from any
  // coach name display.
  function renderCoachCard() {
    const name = coachCardName;
    const close = () => setCoachCardName(null);
    // Match against coach_roster. Coach name strings in practice_teams are
    // freeform (e.g. "Sam R.", "Jayden", "David Stanley"), so try a few
    // shapes — exact "first last", first-name only, "first lastInitial".
    const norm = (s) => (s||"").toString().trim().toLowerCase();
    const target = norm(name);
    const roster = coachRoster.find(r => {
      const first = norm(r.first_name);
      const last  = norm(r.last_name);
      const li    = last ? last[0] : "";
      const full  = (first + " " + last).trim();
      const fli   = (first + " " + li + ".").trim();
      return target === full || target === first || target === fli || target === (first + " " + li);
    });
    // Find teams this coach leads or assists.
    const matchesCoach = (coachField) => norm(coachField) === target;
    const headOf = practiceTeams.filter(t => matchesCoach(t.head_coach)).map(t => t.team_name);
    const assistOf = practiceTeams.filter(t => matchesCoach(t.assistant_coach)).map(t => t.team_name);
    const allTeamNames = Array.from(new Set([...headOf, ...assistOf]));
    // Practice slots across all their teams.
    const dayOrder = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4 };
    const coachPractices = practiceAssignments
      .filter(a => allTeamNames.includes(a.team_name) && (a.phase || "fall1") === schedulePhase)
      .sort((a, b) => {
        const da = dayOrder[a.day] ?? 99, db = dayOrder[b.day] ?? 99;
        if (da !== db) return da - db;
        const sa = a.slot||"", sb = b.slot||"";
        if (sa !== sb) return sa.localeCompare(sb);
        return (a.team_name||"").localeCompare(b.team_name||"");
      });
    // Tournament assignments via the teams they coach.
    const teamSet = new Set(allTeamNames);
    const tournamentById = new Map(tournaments.map(t => [t.id, t]));
    const coachTournaments = tournamentAssignments
      .filter(ta => teamSet.has(ta.team_id) || teamSet.has(ta.team_name))
      .map(ta => ({ ...ta, tournament: tournamentById.get(ta.tournament_id), team: ta.team_id || ta.team_name }))
      .filter(x => x.tournament)
      .sort((a, b) => (a.tournament.start_date||"").localeCompare(b.tournament.start_date||""));

    const lbl = {fontSize:10,fontWeight:800,letterSpacing:0.5,textTransform:"uppercase",color:C.mut,marginBottom:6};
    const sectionBox = {background:C.bg,borderRadius:10,padding:14,marginBottom:14};
    const displayName = roster ? ((roster.first_name||"") + " " + (roster.last_name||"")).trim() : name;
    // Assign/unassign this coach to a team's head/assistant slot (practice_teams).
    // Uses the same name string this card matches on, so it shows up immediately.
    const assignCoachTeam = async (teamName, role) => {
      const field = role === "assistant" ? "assistant_coach" : "head_coach";
      const { error } = await supabase.from("practice_teams").update({ [field]: name, updated_at: new Date().toISOString() }).eq("team_name", teamName);
      if (error) { window.alert("Assign failed: " + error.message); return; }
      await loadPractice();
    };
    const unassignCoachTeam = async (teamName, role) => {
      const field = role === "assistant" ? "assistant_coach" : "head_coach";
      const { error } = await supabase.from("practice_teams").update({ [field]: null, updated_at: new Date().toISOString() }).eq("team_name", teamName);
      if (error) { window.alert("Remove failed: " + error.message); return; }
      await loadPractice();
    };
    // Edit the coach's roster attributes (contact, sizes, notes) from the card.
    const updateRoster = async (patch) => {
      if (!roster) return;
      const { error } = await supabase.from("coach_roster").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", roster.id);
      if (error) { window.alert("Save failed: " + error.message); return; }
      await loadCoachRoster();
    };
    const cFieldLbl = {fontSize:9,fontWeight:700,color:C.mut,textTransform:"uppercase",letterSpacing:0.5,marginBottom:3};
    const cInp = {...inpStyle,width:"100%",padding:"7px 9px",fontSize:12};

    return (
      <div onClick={close} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:1000,display:"flex",justifyContent:"center",padding:"30px 16px",overflowY:"auto"}}>
        <div onClick={e=>e.stopPropagation()} style={{background:C.card,borderRadius:16,border:"1px solid "+C.border,maxWidth:780,width:"100%",maxHeight:"90vh",overflowY:"auto",padding:24}}>
          <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:10,marginBottom:16}}>
            <div>
              <h2 style={{margin:0,fontSize:22,fontWeight:800,color:C.gold}}>{displayName}</h2>
              {!roster && <div style={{fontSize:11,color:"#f59e0b",fontWeight:700,marginTop:2}}>No roster record found for "{name}" — add them in the Coaches tab to track contact info.</div>}
              {roster && (
                <div style={{fontSize:11,color:C.mut,fontWeight:600,marginTop:2}}>
                  {headOf.length} head · {assistOf.length} assistant · {coachPractices.length} practice slot{coachPractices.length===1?"":"s"}/wk
                </div>
              )}
            </div>
            <button onClick={close} style={{background:"none",border:"none",color:C.mut,fontSize:22,cursor:"pointer",lineHeight:1}}>✕</button>
          </div>

          {/* Contact info — editable */}
          {roster && (
            <div style={sectionBox}>
              <div style={lbl}>Contact <span style={{color:C.mut,fontWeight:600,textTransform:"none",letterSpacing:0}}>· edit any field</span></div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><div style={cFieldLbl}>First Name</div><DebouncedField style={cInp} placeholder="First" value={roster.first_name||""} onCommit={v=>updateRoster({first_name:v})} /></div>
                <div><div style={cFieldLbl}>Last Name</div><DebouncedField style={cInp} placeholder="Last" value={roster.last_name||""} onCommit={v=>updateRoster({last_name:v})} /></div>
                <div><div style={cFieldLbl}>Email</div><DebouncedField type="email" style={cInp} placeholder="email@example.com" value={roster.email||""} onCommit={v=>updateRoster({email:v})} /></div>
                <div><div style={cFieldLbl}>Phone</div><DebouncedField style={cInp} placeholder="555-555-5555" value={roster.phone||""} onCommit={v=>updateRoster({phone:v})} /></div>
                <div><div style={cFieldLbl}>T-shirt</div><DebouncedField style={cInp} placeholder="M" value={roster.tshirt_size||""} onCommit={v=>updateRoster({tshirt_size:v})} /></div>
                <div><div style={cFieldLbl}>Shoe</div><DebouncedField style={cInp} placeholder="9.5 W" value={roster.shoe_size||""} onCommit={v=>updateRoster({shoe_size:v})} /></div>
                <div><div style={cFieldLbl}>Sweatshirt</div><DebouncedField style={cInp} placeholder="L" value={roster.sweatshirt_size||""} onCommit={v=>updateRoster({sweatshirt_size:v})} /></div>
                <div style={{gridColumn:"1 / -1"}}><div style={cFieldLbl}>Notes</div><DebouncedField multiline style={{...cInp,minHeight:54,resize:"vertical"}} placeholder="Notes…" value={roster.notes||""} onCommit={v=>updateRoster({notes:v})} /></div>
              </div>
              <div style={{fontSize:10,color:C.mut,marginTop:6,fontStyle:"italic"}}>Changing the name here won't rename their team assignments — if you rename a coach, re-pick their teams below (or update the team's HC/AC).</div>
            </div>
          )}

          {/* Teams coached — editable: assign this coach as head/assistant to
              any team, straight from their card. */}
          <div style={sectionBox}>
            <div style={lbl}>Teams · {allTeamNames.length}</div>
            {allTeamNames.length === 0 && <div style={{fontSize:11,color:C.mut,fontStyle:"italic",marginBottom:8}}>Not assigned to any team yet — add one below.</div>}
            {allTeamNames.length > 0 && (
              <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:10}}>
                {headOf.map(tn => (
                  <div key={"h-"+tn} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 8px",background:C.card,borderRadius:6,border:"1px solid "+C.border,fontSize:12}}>
                    <span onClick={()=>{ setCoachCardName(null); setTeamCardName(tn); }} style={{fontWeight:700,cursor:"pointer",flex:1,color:C.text,textDecoration:"underline",textDecorationColor:"transparent"}}
                      onMouseEnter={e=>e.currentTarget.style.textDecorationColor=C.gold}
                      onMouseLeave={e=>e.currentTarget.style.textDecorationColor="transparent"}>{tn}</span>
                    <span style={{fontSize:9,fontWeight:800,color:C.gold,padding:"1px 6px",borderRadius:5,border:"1px solid "+C.gold,letterSpacing:0.5}}>HEAD</span>
                    <button onClick={()=>unassignCoachTeam(tn,"head")} title="Remove from this team" style={{width:18,height:18,borderRadius:9,border:"none",background:"transparent",color:C.mut,cursor:"pointer",fontFamily:"inherit",fontSize:14,lineHeight:1,padding:0}}>×</button>
                  </div>
                ))}
                {assistOf.map(tn => (
                  <div key={"a-"+tn} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 8px",background:C.card,borderRadius:6,border:"1px solid "+C.border,fontSize:12}}>
                    <span onClick={()=>{ setCoachCardName(null); setTeamCardName(tn); }} style={{fontWeight:700,cursor:"pointer",flex:1,color:C.text,textDecoration:"underline",textDecorationColor:"transparent"}}
                      onMouseEnter={e=>e.currentTarget.style.textDecorationColor=C.acc}
                      onMouseLeave={e=>e.currentTarget.style.textDecorationColor="transparent"}>{tn}</span>
                    <span style={{fontSize:9,fontWeight:800,color:C.acc,padding:"1px 6px",borderRadius:5,border:"1px solid "+C.acc,letterSpacing:0.5}}>ASSISTANT</span>
                    <button onClick={()=>unassignCoachTeam(tn,"assistant")} title="Remove from this team" style={{width:18,height:18,borderRadius:9,border:"none",background:"transparent",color:C.mut,cursor:"pointer",fontFamily:"inherit",fontSize:14,lineHeight:1,padding:0}}>×</button>
                  </div>
                ))}
              </div>
            )}
            {/* Assign to a team */}
            <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
              <select id="coach-assign-team" defaultValue="" style={{...inpStyle,fontSize:12,padding:"6px 8px",flex:"1 1 160px"}}>
                <option value="">+ Assign to team…</option>
                {[...practiceTeams].sort((a,b)=>(a.team_name||"").localeCompare(b.team_name||"")).map(t => (
                  <option key={t.team_name} value={t.team_name}>
                    {t.team_name}{t.head_coach?" · HC "+t.head_coach:""}{t.assistant_coach?" · AC "+t.assistant_coach:""}
                  </option>
                ))}
              </select>
              <select id="coach-assign-role" defaultValue="head" style={{...inpStyle,fontSize:12,padding:"6px 8px"}}>
                <option value="head">Head</option>
                <option value="assistant">Assistant</option>
              </select>
              <button onClick={()=>{
                  const ts = document.getElementById("coach-assign-team");
                  const rs = document.getElementById("coach-assign-role");
                  if (!ts || !ts.value) return;
                  const teamName = ts.value, role = (rs && rs.value) || "head";
                  const existing = practiceTeams.find(t => t.team_name === teamName);
                  const cur = role === "assistant" ? existing?.assistant_coach : existing?.head_coach;
                  if (cur && norm(cur) !== target && !window.confirm(teamName + " already has " + (role==="assistant"?"assistant":"head") + " coach \"" + cur + "\". Replace with " + displayName + "?")) return;
                  assignCoachTeam(teamName, role);
                  ts.value = "";
                }}
                style={{padding:"6px 14px",borderRadius:6,border:"1px solid "+C.gold,background:"transparent",color:C.gold,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                Add
              </button>
            </div>
            {practiceTeams.length === 0 && <div style={{fontSize:10,color:C.mut,marginTop:6,fontStyle:"italic"}}>No teams exist yet — add teams in the Practice tab first.</div>}
          </div>

          {/* Practice schedule — all phases, adjacent slots merged */}
          {(() => {
            const summary = summarizePractices(practiceAssignments.filter(a => allTeamNames.includes(a.team_name)));
            return (
              <div style={sectionBox}>
                <div style={lbl}>Practice Schedule · all phases</div>
                {summary.length === 0 && <div style={{fontSize:11,color:C.mut,fontStyle:"italic"}}>No practices scheduled.</div>}
                {summary.map(ph => (
                  <div key={ph.id} style={{marginBottom:8}}>
                    <div style={{fontSize:9,fontWeight:800,color:C.gold,textTransform:"uppercase",letterSpacing:0.5,marginBottom:4}}>{ph.label}</div>
                    <div style={{display:"flex",flexDirection:"column",gap:4}}>
                      {ph.entries.map((e, i) => (
                        <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"4px 8px",background:C.card,borderRadius:6,border:"1px solid "+C.border,fontSize:12}}>
                          <span style={{fontWeight:700,minWidth:60,color:C.text}}>{e.day}</span>
                          <span style={{minWidth:80,color:C.text}}>{e.slot}</span>
                          <span onClick={()=>{ setCoachCardName(null); setTeamCardName(e.team); }} style={{fontWeight:600,cursor:"pointer",flex:1,color:C.gold,textDecoration:"underline",textDecorationColor:"transparent"}}
                            onMouseEnter={ev=>ev.currentTarget.style.textDecorationColor=C.gold}
                            onMouseLeave={ev=>ev.currentTarget.style.textDecorationColor="transparent"}>{e.team}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Tournament schedule */}
          <div style={sectionBox}>
            <div style={lbl}>Tournament Schedule · {coachTournaments.length}</div>
            {coachTournaments.length === 0 && <div style={{fontSize:11,color:C.mut,fontStyle:"italic"}}>No tournament assignments.</div>}
            {coachTournaments.length > 0 && (
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {coachTournaments.map(({tournament:tn, team}, i) => (
                  <div key={i} style={{padding:"6px 10px",background:C.card,borderRadius:6,border:"1px solid "+C.border,fontSize:12}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontWeight:700,color:C.text,flex:1}}>{tn.name}</span>
                      <span onClick={()=>{ setCoachCardName(null); setTeamCardName(team); }} style={{fontSize:11,fontWeight:700,color:C.gold,cursor:"pointer",textDecoration:"underline",textDecorationColor:"transparent"}}
                        onMouseEnter={e=>e.currentTarget.style.textDecorationColor=C.gold}
                        onMouseLeave={e=>e.currentTarget.style.textDecorationColor="transparent"}>{team}</span>
                    </div>
                    <div style={{fontSize:10,color:C.mut,marginTop:2}}>
                      {tn.start_date}{tn.end_date && tn.end_date !== tn.start_date ? " – " + tn.end_date : ""}
                      {tn.location && " · " + tn.location}
                      {tn.is_qualifier && <span style={{color:"#a855f7",marginLeft:8,fontWeight:700}}>QUALIFIER</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── PRACTICE SCHEDULE ────────────────────────────────────────────────
  // Grid view of the practice schedule. Rows = teams, columns = the 10
  // weekly time slots. Click a cell to toggle a team in/out of a slot.
  // Inline conflict detection flags court overflow, coach double-booking,
  // wrong practice count for level, and the U11/U12 timing rules.
  function renderPractice() {
    const DAYS = ["Sun","Mon","Tue","Wed","Thu"];
    // Per-phase slot capacity. Preseason runs Sunday-only and the gym
    // has 4 courts that day. Season uses the full week with the regular
    // weekday capacities.
    // Sundays run on 1-hour granularity in every phase. A team practicing
    // a 2-hour block just occupies two consecutive cells.
    const SUN_HOURS = ["1-2pm","2-3pm","3-4pm","4-5pm","5-6pm","6-7pm","7-8pm","8-9pm"];
    const SEASON_SLOTS = {
      Sun: SUN_HOURS.map(label => ({ label, capacity: 6 })),
      Mon: [
        { label:"5-7pm",       capacity:4 },
        { label:"7-9pm",       capacity:4 },
      ],
      Tue: [
        { label:"5-7pm",       capacity:1 },
        { label:"7-9pm",       capacity:1 },
      ],
      Wed: [
        { label:"5-7pm",       capacity:4 },
        { label:"7-9pm",       capacity:4 },
      ],
      Thu: [
        { label:"5-7pm",  capacity:4 },
        { label:"7-9pm",  capacity:4 },
      ],
    };
    const PRESEASON_SLOTS = {
      Sun: SUN_HOURS.map(label => ({ label, capacity: 5 })),
      Mon: [], Tue: [], Wed: [], Thu: [],
    };
    // Summer + Fall 1/Fall 2 are Sunday-only (preseason). Only the Regular
    // Season uses the full week. Fall keeps 6 Sunday courts; summer has 5.
    const FALL_SLOTS = { Sun: SUN_HOURS.map(label => ({ label, capacity: 6 })), Mon: [], Tue: [], Wed: [], Thu: [] };
    const SLOTS = schedulePhase === "season" ? SEASON_SLOTS
                : schedulePhase === "summer" ? PRESEASON_SLOTS
                : FALL_SLOTS;
    // Hide weekday columns entirely when a phase has no weekday slots.
    const VISIBLE_DAYS = DAYS.filter(d => SLOTS[d].length > 0);
    const YOUNG_DIVS = new Set(["U11","U12"]);
    const WEEKDAYS = new Set(["Mon","Tue","Wed","Thu"]);
    // Slots that are "late" for U11/U12 purposes.
    const LATE_SLOTS = new Set(["7-9pm"]);

    // Only consider assignments belonging to the active phase. Rows from
    // the seed migration that pre-date the phase column default to 'season'.
    const phaseAssignments = practiceAssignments.filter(a => (a.phase || "fall1") === schedulePhase);

    // Index assignments by team and by slot for O(1) lookup.
    const byTeamSlot = new Map();
    const bySlot = new Map();
    for (const a of phaseAssignments) {
      byTeamSlot.set(a.team_name + "|" + a.day + "|" + a.slot, a);
      const sk = a.day + "|" + a.slot;
      if (!bySlot.has(sk)) bySlot.set(sk, []);
      bySlot.get(sk).push(a);
    }
    const teamByName = new Map(practiceTeams.map(t => [t.team_name, t]));

    // Coach load per slot — head_coach AND assistant_coach both count, so
    // an assistant covering two simultaneous teams is also flagged.
    const coachInSlot = new Map(); // "day|slot" -> Map<coach, [team,...]>
    for (const a of phaseAssignments) {
      const t = teamByName.get(a.team_name);
      if (!t) continue;
      const sk = a.day + "|" + a.slot;
      if (!coachInSlot.has(sk)) coachInSlot.set(sk, new Map());
      const m = coachInSlot.get(sk);
      for (const c of [t.head_coach, t.assistant_coach]) {
        if (!c) continue;
        if (!m.has(c)) m.set(c, []);
        m.get(c).push(a.team_name);
      }
    }

    const toggleAssignment = async (teamName, day, slot) => {
      // Locked teams' rows are read-only — bail before any DB write.
      const team = teamByName.get(teamName);
      if (team?.locked) return;
      await remindSaveOnce();
      const key = teamName + "|" + day + "|" + slot;
      const existing = byTeamSlot.get(key);
      if (existing) {
        const { error } = await supabase.from("practice_assignments").delete().eq("id", existing.id);
        if (error) { window.alert("Remove failed: " + error.message); return; }
      } else {
        const { error } = await supabase.from("practice_assignments").insert({ team_name: teamName, day, slot, phase: schedulePhase });
        if (error) { window.alert("Add failed: " + error.message); return; }
      }
      await loadPractice();
    };

    // ─── S&A overlay ─────────────────────────────────────────────────
    // Fall 1 and Fall 2 layer a Speed & Agility schedule on top of the
    // court grid. Each phase covers 5 specific Sundays and a list of
    // 1-hour S&A slots. One team at a time per slot.
    const SA_BLOCKS = {
      fall1: {
        // 9 slots — same shape as Fall 2 (12-1 through 8-9pm).
        slots: ["12-1pm","1-2pm","2-3pm","3-4pm","4-5pm","5-6pm","6-7pm","7-8pm","8-9pm"],
        dates: ["2026-09-13","2026-09-20","2026-09-27","2026-10-04","2026-10-11"],
      },
      fall2: {
        slots: ["12-1pm","1-2pm","2-3pm","3-4pm","4-5pm","5-6pm","6-7pm","7-8pm","8-9pm"],
        dates: ["2026-10-18","2026-10-25","2026-11-01","2026-11-08","2026-11-15"],
      },
    };
    const sa = SA_BLOCKS[schedulePhase];           // undefined for summer
    const SA_SLOTS = sa ? sa.slots : [];
    const SA_DATES = sa ? sa.dates : [];

    // (team_name|slot) -> array of session rows (one per Sunday).
    // (slot) -> Set of team_name occupants — for the "1-at-a-time" check.
    const saByTeamSlot = new Map();
    const saBySlot = new Map();
    if (sa) {
      for (const s of saSessions) {
        if (s.block !== schedulePhase) continue;
        const k = s.team_name + "|" + s.slot;
        if (!saByTeamSlot.has(k)) saByTeamSlot.set(k, []);
        saByTeamSlot.get(k).push(s);
        if (!saBySlot.has(s.slot)) saBySlot.set(s.slot, new Set());
        saBySlot.get(s.slot).add(s.team_name);
      }
    }

    // Toggle a team into / out of every Sunday of the current S&A block
    // at the given slot. Locked teams (or non-S&A phases) are no-ops.
    const toggleSA = async (teamName, slot) => {
      if (!sa) return;
      const team = teamByName.get(teamName);
      if (team?.locked) return;
      const existing = saByTeamSlot.get(teamName + "|" + slot) || [];
      if (existing.length) {
        const ids = existing.map(r => r.id);
        const { error } = await supabase.from("sa_sessions").delete().in("id", ids);
        if (error) { window.alert("Remove S&A failed: " + error.message); return; }
      } else {
        // Refuse if someone else already owns that slot — single-occupancy rule.
        const occupants = saBySlot.get(slot);
        if (occupants && occupants.size > 0) {
          window.alert("S&A " + slot + " is already taken by " + Array.from(occupants).join(", ") + ".");
          return;
        }
        const rows = SA_DATES.map(d => ({
          block: schedulePhase, session_date: d, slot, team_name: teamName,
        }));
        const { error } = await supabase.from("sa_sessions").insert(rows);
        if (error) { window.alert("Add S&A failed: " + error.message); return; }
      }
      await loadPractice();
    };

    // Fall Sundays: one cell that cycles a team's hour through three states —
    //   empty → Practice (green ✓) → Speed & Agility (orange dumbbell) → empty.
    // Practice is a practice_assignments row; S&A is a set of sa_sessions rows
    // (one per Sunday in the block). A team's hour is one or the other, never both.
    const cycleSunCell = async (teamName, slot) => {
      if (!sa) return;
      const team = teamByName.get(teamName);
      if (team?.locked) return;
      await remindSaveOnce();
      const practiceRow = byTeamSlot.get(teamName + "|Sun|" + slot);
      const saRows = saByTeamSlot.get(teamName + "|" + slot) || [];
      if (saRows.length) {
        // S&A → empty.
        const { error } = await supabase.from("sa_sessions").delete().in("id", saRows.map(r => r.id));
        if (error) { window.alert("Clear S&A failed: " + error.message); return; }
      } else if (practiceRow) {
        // Practice → S&A: drop the court, add the S&A sessions.
        const { error: delErr } = await supabase.from("practice_assignments").delete().eq("id", practiceRow.id);
        if (delErr) { window.alert("Remove practice failed: " + delErr.message); return; }
        const rows = SA_DATES.map(d => ({ block: schedulePhase, session_date: d, slot, team_name: teamName }));
        const { error: insErr } = await supabase.from("sa_sessions").insert(rows);
        if (insErr) { window.alert("Add S&A failed: " + insErr.message); return; }
      } else {
        // empty → Practice.
        const { error } = await supabase.from("practice_assignments").insert({ team_name: teamName, day: "Sun", slot, phase: schedulePhase });
        if (error) { window.alert("Add practice failed: " + error.message); return; }
      }
      await loadPractice();
    };
    // Mark / unmark a coach as "floating" — they absorb a short (<=2h) Sunday gap.
    const toggleFloating = async (coach) => {
      if (floatingSet.has(coach)) {
        const { error } = await supabase.from("floating_coaches").delete().eq("name", coach);
        if (error) { window.alert("Remove floating failed: " + error.message); return; }
      } else {
        const { error } = await supabase.from("floating_coaches").insert({ name: coach });
        if (error) { window.alert("Mark floating failed: " + error.message); return; }
      }
      await loadPractice();
    };
    // ─── Snapshots: save / revert the whole practice schedule ─────────
    const saveSnapshot = async () => {
      const label = window.prompt("Name this restore point (e.g. \"before coach swaps\"):", "");
      if (label === null) return; // cancelled
      const assignments = practiceAssignments.map(a => ({ team_name: a.team_name, day: a.day, slot: a.slot, phase: a.phase || "fall1" }));
      const sa = saSessions.map(s => ({ block: s.block, session_date: s.session_date, slot: s.slot, team_name: s.team_name }));
      const { error } = await supabase.from("practice_snapshots").insert({
        label: label.trim() || "Snapshot",
        created_by: coach?.display_name || coach?.email || "",
        assignments, sa_sessions: sa,
      });
      if (error) { window.alert("Save snapshot failed: " + error.message); return; }
      practiceEditReminded.current = true; // they've now saved — don't nag this session
      await loadSnapshots();
      window.alert("Saved restore point: \"" + (label.trim() || "Snapshot") + "\" (" + assignments.length + " assignments).");
    };
    // Nudge (once per session) to save a restore point before the first edit.
    const remindSaveOnce = async () => {
      if (!isAdmin || practiceEditReminded.current) return;
      practiceEditReminded.current = true;
      if (window.confirm("Save a restore point before changing the schedule?\n\nRecommended — it lets you revert if these edits go wrong. Click OK to save one now, or Cancel to edit without saving.")) {
        await saveSnapshot();
      }
    };
    const revertSnapshot = async (snap) => {
      if (!window.confirm(
        "Revert the ENTIRE practice schedule to:\n\n\"" + snap.label + "\"  ·  " + new Date(snap.created_at).toLocaleString() +
        "\n\nThis replaces all current practice assignments and S&A sessions across every phase. " +
        "Tip: Save a snapshot first so you can undo this too.")) return;
      // Fetch the full snapshot (the list only holds metadata).
      const { data: full, error: fErr } = await supabase.from("practice_snapshots").select("*").eq("id", snap.id).single();
      if (fErr || !full) { window.alert("Couldn't load that snapshot: " + (fErr?.message || "not found")); return; }
      const d1 = await supabase.from("practice_assignments").delete().gte("id", 0);
      if (d1.error) { window.alert("Revert failed clearing assignments: " + d1.error.message); return; }
      if (Array.isArray(full.assignments) && full.assignments.length) {
        const i1 = await supabase.from("practice_assignments").insert(full.assignments);
        if (i1.error) { window.alert("Revert failed restoring assignments: " + i1.error.message + "\n\nThe schedule may be incomplete — re-run revert."); return; }
      }
      const d2 = await supabase.from("sa_sessions").delete().gte("id", 0);
      if (d2.error) { window.alert("Revert failed clearing S&A: " + d2.error.message); return; }
      if (Array.isArray(full.sa_sessions) && full.sa_sessions.length) {
        const i2 = await supabase.from("sa_sessions").insert(full.sa_sessions);
        if (i2.error) { window.alert("Revert failed restoring S&A: " + i2.error.message); return; }
      }
      await loadPractice();
      window.alert("Reverted to \"" + snap.label + "\".");
    };
    const deleteSnapshot = async (snap) => {
      if (!window.confirm("Delete the saved snapshot \"" + snap.label + "\"? This does NOT change the schedule — it just removes the restore point.")) return;
      const { error } = await supabase.from("practice_snapshots").delete().eq("id", snap.id);
      if (error) { window.alert("Delete snapshot failed: " + error.message); return; }
      await loadSnapshots();
    };
    // Flip the lock flag on a team row. Used by the lock icon in the team-label cell.
    const toggleTeamLock = async (teamName, currentLocked) => {
      const { error } = await supabase.from("practice_teams")
        .update({ locked: !currentLocked, updated_at: new Date().toISOString() })
        .eq("team_name", teamName);
      if (error) { window.alert("Lock toggle failed: " + error.message); return; }
      await loadPractice();
    };

    // Each assignment row represents 1 hour on Sunday (after the 2026-06-21
    // migration) or 2 hours on a weekday. Convert to total hours so we can
    // compare against the team's expected weekly load.
    const hoursOf = (a) => a.day === "Sun" ? 1 : 2;

    // Each distinct (team, S&A slot) in this block = 1 hour/week of strength & conditioning.
    const isFallPhase = schedulePhase === "fall1" || schedulePhase === "fall2";
    const saHoursByTeam = new Map();
    if (sa) {
      const seenTS = new Set();
      for (const s of saSessions) {
        if (s.block !== schedulePhase) continue;
        const k = s.team_name + "|" + s.slot;
        if (seenTS.has(k)) continue;
        seenTS.add(k);
        saHoursByTeam.set(s.team_name, (saHoursByTeam.get(s.team_name) || 0) + 1);
      }
    }
    // Fall 1/Fall 2 expect 2h/week of ANY combination of practice + S&A.
    // Count exactly what the Sunday grid shows: 1h per hour where the team is
    // Practice or S&A (one or the other — never both, and weekday rows are
    // hidden and don't count). Regular season uses practices_per_week × 2;
    // summer is freeform.
    const teamLoad = (t, assigns) => {
      if (isFallPhase) {
        let actual = 0;
        for (const label of SUN_HOURS) {
          const onPractice = byTeamSlot.has(t.team_name + "|Sun|" + label);
          const onSA = (saByTeamSlot.get(t.team_name + "|" + label) || []).length > 0;
          if (onPractice || onSA) actual += 1;
        }
        return { actual, expected: 2 };
      }
      const practiceH = assigns.reduce((s, a) => s + hoursOf(a), 0);
      return { actual: practiceH, expected: (t.practices_per_week || 0) * 2 };
    };

    // Compute per-team and per-slot warnings up front.
    const warnings = [];
    for (const t of practiceTeams) {
      const tAssigns = phaseAssignments.filter(a => a.team_name === t.team_name);
      const { actual: actualHours, expected: expectedHours } = teamLoad(t, tAssigns);
      // Summer is freeform — coaches choose.
      if (schedulePhase !== "summer" && actualHours !== expectedHours) {
        warnings.push({
          kind: "count",
          team: t.team_name,
          text: t.team_name + " has " + actualHours + "h, expected " + expectedHours + "h" + (isFallPhase ? " (practice + S&A)" : " of practice (" + (t.level||"?") + ")"),
        });
      }
      if (YOUNG_DIVS.has(t.age_div)) {
        const hasLate = tAssigns.some(a => LATE_SLOTS.has(a.slot));
        if (hasLate) warnings.push({ kind:"young_late", team:t.team_name, text: t.team_name + " is U11/U12 but practices in a late (7pm+) slot" });
        const has57Weekday = tAssigns.some(a => WEEKDAYS.has(a.day) && a.slot === "5-7pm");
        const anyWeekday = tAssigns.some(a => WEEKDAYS.has(a.day));
        if (anyWeekday && !has57Weekday) warnings.push({ kind:"young_weekday", team:t.team_name, text: t.team_name + " (U11/U12) practices on a weekday but not in the 5-7pm slot" });
      }
    }
    for (const day of VISIBLE_DAYS) {
      for (const s of SLOTS[day]) {
        const sk = day + "|" + s.label;
        const count = (bySlot.get(sk) || []).length;
        if (count > s.capacity) {
          warnings.push({ kind:"overflow", slot:sk, text:"Court overflow at " + day + " " + s.label + " — " + count + " teams in " + s.capacity + " courts" });
        }
        const cMap = coachInSlot.get(sk);
        if (cMap) {
          for (const [coach, teams] of cMap) {
            if (teams.length > 1) {
              warnings.push({ kind:"coach_clash", slot:sk, text:"Coach " + coach + " double-booked at " + day + " " + s.label + " (" + teams.join(", ") + ")" });
            }
          }
        }
      }
    }

    // ─── Coach efficiency ────────────────────────────────────────────
    // Goal: a coach with two teams should work contiguous blocks — back-to-
    // back, no idle gap the same day, and ideally pair both teams on one day
    // rather than two separate trips. Flag the two inefficiencies:
    //   coach_gap   — idle time between a coach's sessions on the same day.
    //   coach_split — a coach's teams sit on different weekdays that could be
    //                 combined onto one day, back-to-back.
    // A coach marked "floating" absorbs a SHORT gap (<= 2h) — that becomes an
    // info note (coach_float), not a warning. Gaps over 2h are never floatable.
    const floatingSet = new Set(floatingCoaches);
    const slotRange = (label) => {
      const m = /^(\d+)-(\d+)pm$/.exec(label);
      if (!m) return null;
      const to24 = (h) => (h === 12 ? 12 : h + 12);
      return [to24(+m[1]), to24(+m[2])];
    };
    const fmtHr = (h) => (h === 12 ? "12pm" : h > 12 ? (h - 12) + "pm" : h + "am");
    const coachSessions = new Map(); // coach -> [{day, slot, team}]
    for (const a of phaseAssignments) {
      const t = teamByName.get(a.team_name);
      if (!t) continue;
      for (const c of [t.head_coach, t.assistant_coach]) {
        if (!c) continue;
        if (!coachSessions.has(c)) coachSessions.set(c, []);
        coachSessions.get(c).push({ day: a.day, slot: a.slot, team: a.team_name });
      }
    }
    for (const [coach, sessions] of coachSessions) {
      // Same-day idle gaps (merge a team's consecutive Sunday cells first).
      for (const day of DAYS) {
        const items = sessions.filter(s => s.day === day).map(s => {
          const r = slotRange(s.slot); return r ? { start: r[0], end: r[1] } : null;
        }).filter(Boolean).sort((a, b) => a.start - b.start);
        if (items.length < 2) continue;
        const merged = [];
        for (const it of items) {
          const last = merged[merged.length - 1];
          if (last && it.start <= last.end) last.end = Math.max(last.end, it.end);
          else merged.push({ ...it });
        }
        for (let i = 1; i < merged.length; i++) {
          const gapH = merged[i].start - merged[i - 1].end;
          const base = coach + " has a " + gapH + "h gap on " + day + " — idle " + fmtHr(merged[i - 1].end) + "–" + fmtHr(merged[i].start);
          if (gapH <= 2 && floatingSet.has(coach)) {
            warnings.push({ kind: "coach_float", coach, text: base + " · floating coach (covered)" });
          } else if (gapH <= 2) {
            warnings.push({ kind: "coach_gap", coach, floatable: true, text: base });
          } else {
            warnings.push({ kind: "coach_gap", coach, floatable: false, text: base + " — over 2h, too long to float" });
          }
        }
      }
      // Two teams split across separate weekdays (could pair on one day).
      const wd = sessions.filter(s => WEEKDAYS.has(s.day));
      const wdDays = new Set(wd.map(s => s.day));
      const wdTeams = new Set(wd.map(s => s.team));
      if (wdTeams.size >= 2 && wd.length <= 2 && wdDays.size >= 2) {
        warnings.push({ kind: "coach_split", coach,
          text: coach + " coaches on separate weekdays (" + wd.map(s => s.day + " " + s.slot + " " + s.team).join(", ") + ") — pair both on one day, back-to-back" });
      }
    }

    // Group warnings by kind for the summary banner. Floating-coach notes are
    // info, not problems — they don't count toward the red warning tally.
    const grouped = warnings.reduce((acc, w) => { (acc[w.kind] ||= []).push(w); return acc; }, {});
    const problemCount = warnings.filter(w => w.kind !== "coach_float").length;
    const warnColor = (k) =>
      k === "overflow"      ? C.red :
      k === "coach_clash"   ? C.red :
      k === "count"         ? "#f59e0b" :
      k === "young_late"    ? "#f59e0b" :
      k === "young_weekday" ? "#f59e0b" :
      k === "coach_gap"     ? "#f59e0b" :
      k === "coach_split"   ? "#f59e0b" :
      k === "coach_float"   ? "#06b6d4" : C.mut;
    const warnLabel = (k) => ({
      overflow:      "Court overflow",
      coach_clash:   "Coach double-booked",
      count:         "Wrong practice count",
      young_late:    "U11/U12 in 7-9pm",
      young_weekday: "U11/U12 weekday wrong slot",
      coach_gap:     "Coach idle gap (same day)",
      coach_split:   "Coach split across weekdays",
      coach_float:   "Floating coaches (gap covered)",
    })[k] || k;

    const thS = { padding:"6px 6px", fontSize:10, fontWeight:700, textTransform:"uppercase", color:C.mut, borderBottom:"1px solid "+C.border, background:C.card, position:"sticky", top:0, zIndex:2, whiteSpace:"nowrap" };
    const tdS = { padding:"6px 4px", fontSize:11, borderBottom:"1px solid "+C.border, textAlign:"center", verticalAlign:"middle" };

    // Distinct coach names across head + assistant. Sorted alphabetically
    // so the dropdown reads predictably.
    const allCoaches = new Set();
    for (const t of practiceTeams) {
      if (t.head_coach) allCoaches.add(t.head_coach);
      if (t.assistant_coach) allCoaches.add(t.assistant_coach);
    }
    const coachOptions = Array.from(allCoaches).sort((a,b) => a.localeCompare(b));
    const visibleTeams = practiceCoachFilter
      ? practiceTeams.filter(t => t.head_coach === practiceCoachFilter || t.assistant_coach === practiceCoachFilter)
      : practiceTeams;

    // Specific Sundays each preseason block runs. Fall dates reuse the S&A
    // block dates; summer is every Sunday Jul 12 – Sep 6, 2026.
    const PHASE_DATES = {
      summer: ["2026-07-12","2026-07-19","2026-07-26","2026-08-02","2026-08-09","2026-08-16","2026-08-23","2026-08-30","2026-09-06"],
      fall1: SA_BLOCKS.fall1.dates,
      fall2: SA_BLOCKS.fall2.dates,
    };
    const fmtDates = (iso) => {
      const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const byMonth = new Map();
      for (const d of iso) {
        const [, m, day] = d.split("-").map(Number);
        if (!byMonth.has(m)) byMonth.set(m, []);
        byMonth.get(m).push(day);
      }
      return Array.from(byMonth.entries()).map(([m, days]) => MON[m - 1] + " " + days.join(", ")).join(" · ");
    };

    return (
      <div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",marginBottom:10}}>
          <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <h2 style={{margin:0,fontSize:18,fontWeight:800,color:C.gold}}>Practice Schedule</h2>
            {/* Phase toggle — Summer (Jul-Sep, 4 courts) / Fall1 (Sep 13-Oct 11
                + S&A Block 1) / Fall2 (Oct 18-Nov 15 + S&A Block 2). */}
            <div role="tablist" aria-label="Practice phase"
              style={{display:"inline-flex",border:"1px solid "+C.border,borderRadius:8,overflow:"hidden"}}>
              {[
                { id:"summer", label:"Summer", tip:"Jul 12 – Sep 12 · Sundays · 5 courts · no S&A" },
                { id:"fall1",  label:"Fall 1", tip:"Sep 13 – Oct 11 · 6 courts · S&A Block 1 (8 Nationals)" },
                { id:"fall2",  label:"Fall 2", tip:"Oct 18 – Nov 15 · 6 courts · S&A Block 2 (9 Regionals)" },
                { id:"season", label:"Regular Season", tip:"Full week · the regular 2–3×/week team practice schedule" },
              ].map(({id,label,tip}) => {
                const on = schedulePhase === id;
                return (
                  <button key={id} role="tab" aria-selected={on}
                    onClick={()=>setSchedulePhase(id)}
                    title={tip}
                    style={{padding:"6px 14px",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:800,letterSpacing:0.5,textTransform:"uppercase",
                      background:on ? C.gold : "transparent",
                      color:on ? "#000" : C.mut}}>
                    {label}
                  </button>
                );
              })}
            </div>
            <span style={{fontSize:11,color:C.mut,fontWeight:600,letterSpacing:0.5,textTransform:"uppercase"}}>Coach:</span>
            <select value={practiceCoachFilter} onChange={e=>setPracticeCoachFilter(e.target.value)}
              title="Show only teams where this coach is head or assistant"
              style={{...inpStyle,padding:"6px 10px",fontSize:12,minWidth:160,color:practiceCoachFilter?C.gold:C.text,fontWeight:practiceCoachFilter?700:400}}>
              <option value="">All coaches</option>
              {coachOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {practiceCoachFilter && (
              <button onClick={()=>setPracticeCoachFilter("")} title="Clear coach filter"
                style={{padding:"4px 10px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                Clear
              </button>
            )}
          </div>
          <div style={{fontSize:11,color:C.mut}}>
            {visibleTeams.length} of {practiceTeams.length} teams · {phaseAssignments.length} {schedulePhase} assignments
            {problemCount > 0 && <> · <b style={{color:C.red}}>{problemCount} warning{problemCount===1?"":"s"}</b></>}
          </div>
        </div>
        {/* Save / Revert restore points (admin only). */}
        {isAdmin && (
          <details style={{marginBottom:12,background:C.card,border:"1px solid "+C.border,borderRadius:8,padding:"8px 12px"}}>
            <summary style={{cursor:"pointer",fontSize:12,fontWeight:800,color:C.gold,letterSpacing:0.3}}>
              Save / Revert schedule ({snapshots.length} restore point{snapshots.length===1?"":"s"})
            </summary>
            <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:10}}>
              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <button onClick={saveSnapshot} title="Capture the whole schedule (all phases + S&A) as a restore point"
                  style={{padding:"6px 14px",borderRadius:6,border:"none",background:C.gold,color:"#000",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>
                  + Save current schedule
                </button>
                <span style={{fontSize:10,color:C.mut}}>Snapshots every phase + S&amp;A. Save before big edits so you can revert.</span>
              </div>
              {snapshots.length === 0
                ? <div style={{fontSize:11,color:C.mut,fontStyle:"italic"}}>No restore points yet.</div>
                : <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {snapshots.map(s => (
                      <div key={s.id} style={{display:"flex",alignItems:"center",gap:10,fontSize:11,padding:"6px 8px",borderRadius:6,background:"rgba(255,255,255,0.02)",border:"1px solid "+C.border}}>
                        <span style={{flex:1,minWidth:0}}>
                          <b style={{color:C.text}}>{s.label}</b>
                          <span style={{color:C.mut}}> · {new Date(s.created_at).toLocaleString()}{s.created_by ? " · " + s.created_by : ""}</span>
                        </span>
                        <button onClick={()=>revertSnapshot(s)} title="Replace the live schedule with this restore point"
                          style={{padding:"3px 12px",borderRadius:6,border:"1px solid #f59e0b",background:"transparent",color:"#f59e0b",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
                          Revert
                        </button>
                        <button onClick={()=>deleteSnapshot(s)} title="Delete this restore point (does not change the schedule)"
                          style={{padding:"3px 10px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>}
            </div>
          </details>
        )}
        {/* Block dates — which specific Sundays this preseason phase runs. */}
        {PHASE_DATES[schedulePhase] && (
          <div style={{marginBottom:12,fontSize:11,color:C.mut,background:C.card,border:"1px solid "+C.border,borderRadius:8,padding:"7px 12px"}}>
            <b style={{color:C.gold,letterSpacing:0.5,textTransform:"uppercase",fontSize:10}}>
              {schedulePhase==="summer"?"Summer":schedulePhase==="fall1"?"Fall 1":"Fall 2"} Sundays
            </b>
            <span style={{marginLeft:8,color:C.text}}>{fmtDates(PHASE_DATES[schedulePhase])}</span>
            <span style={{marginLeft:8,color:C.mut}}>({PHASE_DATES[schedulePhase].length} weeks)</span>
          </div>
        )}
        {/* Warnings banner */}
        {warnings.length > 0 && (
          <details open style={{marginBottom:14,background:"rgba(239,68,68,0.06)",border:"1px solid "+C.border,borderRadius:10,padding:"10px 14px"}}>
            <summary style={{cursor:"pointer",fontSize:12,fontWeight:800,color:problemCount>0?C.red:"#06b6d4"}}>
              {problemCount > 0
                ? problemCount + " conflict" + (problemCount===1?"":"s") + " & warning" + (problemCount===1?"":"s") + " detected"
                : "All clear — floating-coach notes below"}
            </summary>
            <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:8}}>
              {Object.keys(grouped).map(k => (
                <div key={k}>
                  <div style={{fontSize:10,fontWeight:800,letterSpacing:0.5,textTransform:"uppercase",color:warnColor(k),marginBottom:4}}>
                    {warnLabel(k)} ({grouped[k].length})
                  </div>
                  {grouped[k].map((w,i) => (
                    <div key={i} style={{fontSize:11,color:C.text,paddingLeft:10,lineHeight:1.5,display:"flex",alignItems:"center",gap:8}}>
                      <span>• {w.text}</span>
                      {k === "coach_gap" && w.coach && w.floatable && (
                        <button onClick={()=>toggleFloating(w.coach)} title={"Mark " + w.coach + " as a floating coach — covers gaps up to 2h"}
                          style={{padding:"1px 8px",borderRadius:6,border:"1px solid #06b6d4",background:"transparent",color:"#06b6d4",fontSize:10,fontWeight:800,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
                          Make floating
                        </button>
                      )}
                      {k === "coach_float" && w.coach && (
                        <button onClick={()=>toggleFloating(w.coach)} title={"Remove floating status from " + w.coach}
                          style={{padding:"1px 8px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontSize:10,fontWeight:800,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
                          Undo float
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </details>
        )}
        {/* Grid */}
        <div style={{background:C.card,borderRadius:12,border:"1px solid "+C.border,overflow:"hidden"}}>
          <div style={{overflow:"auto",maxHeight:"calc(100vh - 280px)"}}>
            <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0,minWidth:1000}}>
              <thead>
                <tr>
                  <th style={{...thS,textAlign:"left",minWidth:220}}>Team</th>
                  {VISIBLE_DAYS.map(day => SLOTS[day].map(s => {
                    const sk = day + "|" + s.label;
                    const count = (bySlot.get(sk) || []).length;
                    const over = count > s.capacity;
                    // Fall Sundays use a single cycling cell (Practice / S&A);
                    // everything else is a single court cell. One <th> either way.
                    return (
                      <th key={sk} style={{...thS,color:over?C.red:C.mut}}>
                        <div>{day}</div>
                        <div style={{fontSize:9,fontWeight:600}}>{s.label}</div>
                        <div style={{fontSize:9,fontWeight:800,color:over?C.red:(count===s.capacity?C.grn:C.mut)}}>{count}/{s.capacity}</div>
                      </th>
                    );
                  }))}
                  <th style={{...thS,textAlign:"center",minWidth:60}}>Count</th>
                </tr>
              </thead>
              <tbody>
                {visibleTeams.map(t => {
                  const tAssigns = phaseAssignments.filter(a => a.team_name === t.team_name);
                  const { actual: actualHours, expected: expectedHours } = teamLoad(t, tAssigns);
                  // Summer is freeform — other phases compare hours against the team's target.
                  const countOff = schedulePhase !== "summer" && actualHours !== expectedHours;
                  const levelColor =
                    t.level === "National"      ? C.gold :
                    t.level === "Regional"      ? C.acc  :
                    t.level === "Developmental" ? "#06b6d4" : C.mut;
                  return (
                    <tr key={t.team_name} style={{opacity: t.locked ? 0.85 : 1}}>
                      <td style={{...tdS,textAlign:"left",padding:"6px 10px"}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <button onClick={() => toggleTeamLock(t.team_name, t.locked)}
                            title={t.locked ? "Unlock team — cells become editable again" : "Lock team — prevents changes to this team's slots"}
                            style={{padding:"1px 5px",borderRadius:5,border:"1px solid "+(t.locked?"#f59e0b":C.border),background:t.locked?"rgba(245,158,11,0.18)":"transparent",color:t.locked?"#f59e0b":C.mut,fontSize:11,cursor:"pointer",fontFamily:"inherit",lineHeight:1}}>
                            {t.locked ? "🔒" : "🔓"}
                          </button>
                          <span onClick={() => setTeamCardName(t.team_name)}
                            title="Open team card — coaches, players, practices, tournaments"
                            style={{fontWeight:700,fontSize:13,color:levelColor,cursor:"pointer",textDecoration:"underline",textDecorationColor:"transparent",textUnderlineOffset:2}}
                            onMouseEnter={e=>e.currentTarget.style.textDecorationColor=levelColor}
                            onMouseLeave={e=>e.currentTarget.style.textDecorationColor="transparent"}>
                            {t.team_name}
                          </span>
                        </div>
                        <div style={{fontSize:9,color:C.mut,fontWeight:600,letterSpacing:0.5,textTransform:"uppercase"}}>{t.level || "—"} · {t.age_div || "—"}{t.locked && <span style={{color:"#f59e0b",marginLeft:6,fontWeight:800}}>· LOCKED</span>}</div>
                        <div style={{fontSize:10,color:C.text,marginTop:2}}>
                          {t.head_coach
                            ? <span onClick={()=>setCoachCardName(t.head_coach)} title="Open coach card" style={{cursor:"pointer",textDecoration:"underline",textDecorationColor:"transparent"}}
                                onMouseEnter={e=>e.currentTarget.style.textDecorationColor=C.text}
                                onMouseLeave={e=>e.currentTarget.style.textDecorationColor="transparent"}>{t.head_coach}</span>
                            : <i style={{color:C.mut}}>no head coach</i>}
                          {t.assistant_coach && <> · <span onClick={()=>setCoachCardName(t.assistant_coach)} title="Open coach card" style={{cursor:"pointer",textDecoration:"underline",textDecorationColor:"transparent"}}
                            onMouseEnter={e=>e.currentTarget.style.textDecorationColor=C.text}
                            onMouseLeave={e=>e.currentTarget.style.textDecorationColor="transparent"}>{t.assistant_coach}</span></>}
                        </div>
                      </td>
                      {VISIBLE_DAYS.map(day => SLOTS[day].map(s => {
                        const key = t.team_name + "|" + day + "|" + s.label;
                        const isOn = byTeamSlot.has(key);
                        const sk = day + "|" + s.label;
                        const over = (bySlot.get(sk) || []).length > s.capacity;
                        const young = YOUNG_DIVS.has(t.age_div);
                        const youngLate = young && LATE_SLOTS.has(s.label) && isOn;
                        const cMap = coachInSlot.get(sk);
                        const coachClash = isOn && cMap && (
                          (t.head_coach && cMap.get(t.head_coach)?.length > 1) ||
                          (t.assistant_coach && cMap.get(t.assistant_coach)?.length > 1)
                        );
                        const bg = !isOn ? "transparent"
                                 : coachClash ? "rgba(239,68,68,0.18)"
                                 : over ? "rgba(239,68,68,0.12)"
                                 : youngLate ? "rgba(245,158,11,0.18)"
                                 : "rgba(34,197,94,0.18)";
                        const fg = !isOn ? C.mut
                                 : coachClash || over ? C.red
                                 : youngLate ? "#f59e0b"
                                 : C.grn;
                        const isSunHour = day === "Sun" && sa;
                        // Fall Sundays: one cell cycling empty → Practice → S&A.
                        const saOn = isSunHour && (saByTeamSlot.get(t.team_name + "|" + s.label) || []).length > 0;
                        if (isSunHour) {
                          const state = saOn ? "sa" : isOn ? "practice" : "empty";
                          const cbg = state === "sa" ? "rgba(245,158,11,0.20)" : state === "practice" ? bg : "transparent";
                          const title = t.locked ? "Team is locked — unlock to edit"
                            : state === "empty" ? "Click: set Practice"
                            : state === "practice" ? "Click: switch to Speed & Agility"
                            : "Click: clear";
                          return (
                            <td key={sk} onClick={()=>cycleSunCell(t.team_name, s.label)} title={title}
                              style={{...tdS,cursor:t.locked?"not-allowed":"pointer",userSelect:"none",background:cbg,fontWeight:800,fontSize:14}}>
                              {state === "practice" && <span style={{color:fg}}>✓</span>}
                              {state === "sa" && (
                                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.2" strokeLinecap="round" style={{display:"block",margin:"0 auto"}}>
                                  <line x1="6.5" y1="12" x2="17.5" y2="12"/>
                                  <line x1="4" y1="9" x2="4" y2="15"/>
                                  <line x1="6.5" y1="7.5" x2="6.5" y2="16.5"/>
                                  <line x1="17.5" y1="7.5" x2="17.5" y2="16.5"/>
                                  <line x1="20" y1="9" x2="20" y2="15"/>
                                </svg>
                              )}
                            </td>
                          );
                        }
                        return (
                          <td key={sk} onClick={()=>toggleAssignment(t.team_name, day, s.label)}
                            title={t.locked ? "Team is locked — unlock to edit" : (isOn ? "Click to remove court" : "Click to add court")}
                            style={{...tdS,cursor:t.locked?"not-allowed":"pointer",userSelect:"none",background:bg,color:fg,fontWeight:800,fontSize:14}}>
                            {isOn ? "✓" : ""}
                          </td>
                        );
                      }))}
                      <td style={{...tdS,fontWeight:700,color:countOff?"#f59e0b":C.grn,minWidth:40}}>
                        {schedulePhase === "summer" ? actualHours + "h" : actualHours + "/" + expectedHours + "h"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div style={{marginTop:10,fontSize:11,color:C.mut,lineHeight:1.5}}>
          {sa
            ? <>Click a Sunday cell to cycle it: empty → <b style={{color:C.grn}}>green ✓ Practice</b> → <b style={{color:"#f59e0b"}}>orange dumbbell = Speed &amp; Agility</b> → empty. Each team's hour is one or the other. <b style={{color:C.red}}>Red</b> = court overflow or coach double-booked; <b style={{color:"#f59e0b"}}>amber ✓</b> = U11/U12 practicing 7-9pm.</>
            : <><b style={{color:C.grn}}>Green ✓</b> = court (up to {schedulePhase==="summer"?5:6} teams per hour). Click to toggle. <b style={{color:C.red}}>Red</b> means court overflow or coach double-booked; <b style={{color:"#f59e0b"}}>amber</b> means U11/U12 in 7-9pm.</>}
        </div>
      </div>
    );
  }

  // S&A per-Sunday detail grid. Kept for reference but no longer used —
  // the S&A schedule now lives inside the practice grid as pink columns.
  // eslint-disable-next-line no-unused-vars
  function renderSASchedule() {
    const BLOCKS = {
      fall_b1: {
        label: "Fall Block 1",
        sub: "Sep 13 – Oct 11 · 8 Nationals · 12-8pm",
        dates: ["2026-09-13","2026-09-20","2026-09-27","2026-10-04","2026-10-11"],
        slots: ["12-1pm","1-2pm","2-3pm","3-4pm","4-5pm","5-6pm","6-7pm","7-8pm"],
      },
      fall_b2: {
        label: "Fall Block 2",
        sub: "Oct 18 – Nov 15 · 9 Regionals · 12-9pm",
        dates: ["2026-10-18","2026-10-25","2026-11-01","2026-11-08","2026-11-15"],
        slots: ["12-1pm","1-2pm","2-3pm","3-4pm","4-5pm","5-6pm","6-7pm","7-8pm","8-9pm"],
      },
    };
    const block = BLOCKS[saBlock] || BLOCKS.fall_b1;
    // Index assignments by (date|slot) for O(1) lookup.
    const byKey = new Map();
    for (const s of saSessions) {
      if (s.block !== saBlock) continue;
      // session_date can come back as 'YYYY-MM-DD' or ISO with a T — normalize.
      const d = (s.session_date||"").slice(0,10);
      byKey.set(d + "|" + s.slot, s);
    }
    const fmtDate = (iso) => {
      const [, m, d] = (iso||"").split("-").map(n => parseInt(n,10));
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return months[m-1] + " " + d;
    };
    // Distinct teams in this block (for the summary line).
    const teamsInBlock = Array.from(new Set(
      saSessions.filter(s => s.block === saBlock).map(s => s.team_name)
    )).sort((a,b) => a.localeCompare(b));

    const th  = {padding:"6px 8px",fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut,borderBottom:"1px solid "+C.border,background:C.card,position:"sticky",top:0,zIndex:1,whiteSpace:"nowrap",textAlign:"left"};
    const td  = {padding:"6px 8px",fontSize:12,borderBottom:"1px solid "+C.border,verticalAlign:"middle"};
    const slotCell = {...td, fontWeight:700, color:C.mut, background:C.card, position:"sticky", left:0, zIndex:1};

    return (
      <div style={{marginTop:24,paddingTop:24,borderTop:"2px solid "+C.border}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",marginBottom:12}}>
          <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <h2 style={{margin:0,fontSize:18,fontWeight:800,color:C.gold}}>Speed &amp; Agility</h2>
            <div role="tablist" aria-label="S&A block"
              style={{display:"inline-flex",border:"1px solid "+C.border,borderRadius:8,overflow:"hidden"}}>
              {["fall_b1","fall_b2"].map(b => {
                const on = saBlock === b;
                return (
                  <button key={b} role="tab" aria-selected={on}
                    onClick={()=>setSaBlock(b)}
                    style={{padding:"6px 14px",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:800,letterSpacing:0.5,textTransform:"uppercase",
                      background:on ? C.gold : "transparent",
                      color:on ? "#000" : C.mut}}>
                    {BLOCKS[b].label}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{fontSize:11,color:C.mut}}>
            {block.sub} · {teamsInBlock.length} teams · {byKey.size} sessions
          </div>
        </div>

        <div style={{background:C.card,borderRadius:12,border:"1px solid "+C.border,overflow:"hidden"}}>
          <div style={{overflow:"auto",maxHeight:"60vh"}}>
            <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0,minWidth:720}}>
              <thead>
                <tr>
                  <th style={th}>Slot</th>
                  {block.dates.map(d => (
                    <th key={d} style={{...th,textAlign:"center"}}>{fmtDate(d)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.slots.map(slot => (
                  <tr key={slot}>
                    <td style={slotCell}>{slot}</td>
                    {block.dates.map(d => {
                      const cell = byKey.get(d + "|" + slot);
                      const name = cell?.team_name;
                      return (
                        <td key={d} style={{...td,textAlign:"center"}}>
                          {name
                            ? <span onClick={()=>setTeamCardName(name)}
                                title="Open team card"
                                style={{fontWeight:700,color:C.text,cursor:"pointer",textDecoration:"underline",textDecorationColor:"transparent",textUnderlineOffset:2}}
                                onMouseEnter={e=>e.currentTarget.style.textDecorationColor=C.gold}
                                onMouseLeave={e=>e.currentTarget.style.textDecorationColor="transparent"}>
                                {name}
                              </span>
                            : <span style={{color:C.mut,fontStyle:"italic"}}>—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div style={{marginTop:10,fontSize:11,color:C.mut,lineHeight:1.5}}>
          One team at a time in the S&amp;A space. <b>Fall B1</b> serves the 8 Nationals; <b>Fall B2</b> serves 9 Regionals (excludes 11 Diamond). Each team gets the same slot every week for 5 Sundays. Click a team name to open the team card.
        </div>
      </div>
    );
  }

  // ─── TRYOUT COACHING ASSIGNMENTS ──────────────────────────────────────
  // One card per division tryout. Each card has three role groups
  // (Lead, Court, Evaluating) with chips for assigned coaches and a
  // text input to add more. Coach names are free-text so you can put
  // anyone (not just registered Practice coaches).
  function renderTryouts() {
    const ROLES = [
      { key:"lead_coaches",       label:"Lead Coach",       color:C.gold },
      { key:"court_coaches",      label:"Court Coach",      color:"#06b6d4" },
      { key:"evaluating_coaches", label:"Evaluating Coach", color:C.acc },
      { key:"checkin_coaches",     label:"Check In",              color:"#22c55e" },
      { key:"stand_reach_coaches", label:"Stand & Reach",        color:"#f59e0b" },
      { key:"jump_touch_coaches",  label:"Approach & Jump Touch", color:"#a855f7" },
      { key:"shuttle_coaches",     label:"Shuttle Run",          color:"#3b82f6" },
    ];
    // Coach roster is the single source of truth for who can be assigned.
    // Names formatted "First Last" — sorted alphabetically — and de-duped
    // (case-insensitive) so the dropdown reads predictably.
    const rosterNames = (() => {
      const seen = new Set();
      const out = [];
      for (const c of coachRoster) {
        const full = ((c.first_name||"").trim() + " " + (c.last_name||"").trim()).trim();
        if (!full) continue;
        const k = full.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(full);
      }
      return out.sort((a,b) => a.localeCompare(b));
    })();

    const addCoach = async (tryout, roleKey, name) => {
      const n = (name||"").trim();
      if (!n) return;
      const current = tryout[roleKey] || [];
      if (current.includes(n)) return;
      const next = [...current, n];
      const { error } = await supabase.from("tryouts").update({ [roleKey]: next }).eq("id", tryout.id);
      if (error) { window.alert("Add failed: " + error.message); return; }
      await loadTryouts();
    };
    const removeCoach = async (tryout, roleKey, name) => {
      const next = (tryout[roleKey] || []).filter(c => c !== name);
      const { error } = await supabase.from("tryouts").update({ [roleKey]: next }).eq("id", tryout.id);
      if (error) { window.alert("Remove failed: " + error.message); return; }
      await loadTryouts();
    };

    const fmtDateTime = (start, end) => {
      const s = new Date(start), e = new Date(end);
      const day = s.toLocaleDateString(undefined, { weekday:"long", month:"long", day:"numeric" });
      const t = (d) => d.toLocaleTimeString(undefined, { hour:"numeric", minute: d.getMinutes() ? "2-digit" : undefined });
      return day + " · " + t(s) + " – " + t(e);
    };

    return (
      <div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",marginBottom:12}}>
          <h2 style={{margin:0,fontSize:18,fontWeight:800,color:C.gold}}>Tryout Coach Assignments</h2>
          <div style={{fontSize:11,color:C.mut}}>{tryouts.length} tryout{tryouts.length===1?"":"s"} · Add coach names below each role</div>
        </div>
        {rosterNames.length === 0 && (
          <div style={{background:"rgba(245,158,11,0.08)",border:"1px solid rgba(245,158,11,0.35)",borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:12,color:"#f59e0b"}}>
            No coaches in the coach roster yet. Add coaches under <b>Coaches</b> → Coach Roster first, then come back to assign them to tryouts.
          </div>
        )}
        {/* Shared datalist powers the autocomplete on every role's input. */}
        <datalist id="tryout-roster-suggestions">
          {rosterNames.map(n => <option key={n} value={n} />)}
        </datalist>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))",gap:14}}>
          {tryouts.map(tr => {
            // Count players whose USAV division matches and who are flagged
            // tryout_registered=true. Drives the per-card signup badge.
            const signedUp = players.filter(p =>
              (p.usavDiv || p.usav_div) === tr.division && p.tryout_registered
            ).length;
            // 1 court per 12 players, capped at 4. 0 signups → 0 courts.
            const courtsNeeded = signedUp === 0 ? 0 : Math.min(4, Math.ceil(signedUp / 12));
            return (
            <div key={tr.id} style={{background:C.card,borderRadius:12,border:"1px solid "+C.border,padding:"16px 18px"}}>
              <div style={{borderBottom:"1px solid "+C.border,paddingBottom:10,marginBottom:12}}>
                <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
                  <div style={{fontSize:18,fontWeight:800,color:C.gold}}>{tr.division}</div>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                    <span title="Players signed up for this tryout (tryout_registered=true)"
                      style={{fontSize:11,fontWeight:800,padding:"3px 9px",borderRadius:10,background:signedUp>0?"rgba(34,197,94,0.18)":"rgba(255,255,255,0.04)",color:signedUp>0?C.grn:C.mut,border:"1px solid "+(signedUp>0?C.grn:C.border),letterSpacing:0.3}}>
                      {signedUp} signed up
                    </span>
                    <span title={"1 court per 12 players, max 4. " + signedUp + " players → " + courtsNeeded + " court" + (courtsNeeded===1?"":"s")}
                      style={{fontSize:11,fontWeight:800,padding:"3px 9px",borderRadius:10,background:courtsNeeded>0?"rgba(6,182,212,0.18)":"rgba(255,255,255,0.04)",color:courtsNeeded>0?"#06b6d4":C.mut,border:"1px solid "+(courtsNeeded>0?"#06b6d4":C.border),letterSpacing:0.3}}>
                      {courtsNeeded} court{courtsNeeded===1?"":"s"}
                    </span>
                  </div>
                </div>
                <div style={{fontSize:11,color:C.mut,marginTop:2}}>{fmtDateTime(tr.start_at, tr.end_at)}</div>
              </div>
              {ROLES.map(role => {
                const list = tr[role.key] || [];
                return (
                  <div key={role.key} style={{marginBottom:12}}>
                    <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:0.5,color:role.color,marginBottom:6}}>
                      {role.label}{list.length > 0 && <span style={{color:C.mut,marginLeft:6,fontWeight:600}}>· {list.length}</span>}
                    </div>
                    <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:6}}>
                      {list.length === 0 && <span style={{fontSize:11,color:C.mut,fontStyle:"italic"}}>none assigned</span>}
                      {list.map(name => (
                        <span key={name} onClick={()=>removeCoach(tr, role.key, name)}
                          title="Click to remove"
                          style={{fontSize:11,fontWeight:700,padding:"4px 10px",borderRadius:14,border:"1px solid "+role.color,color:role.color,background:"rgba(255,255,255,0.02)",cursor:"pointer",userSelect:"none"}}>
                          {name} <span style={{opacity:0.6,marginLeft:4}}>×</span>
                        </span>
                      ))}
                    </div>
                    {/* Typeahead input — backed by the shared roster datalist
                        so the browser shows live suggestions as you type.
                        Only commits when the entered text matches a roster
                        coach (case-insensitive). Free text that doesn't
                        match a roster entry is rejected with an inline hint. */}
                    <input
                      list="tryout-roster-suggestions"
                      disabled={rosterNames.length === 0}
                      placeholder={rosterNames.length === 0 ? "No coaches in roster" : ("Start typing " + role.label.toLowerCase() + "…")}
                      autoComplete="off"
                      onKeyDown={e => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        const v = (e.target.value||"").trim();
                        if (!v) return;
                        // Exact > prefix > substring. Picks the first roster
                        // name that satisfies the strongest rule available.
                        const lo = v.toLowerCase();
                        const match =
                          rosterNames.find(n => n.toLowerCase() === lo) ||
                          rosterNames.find(n => n.toLowerCase().startsWith(lo)) ||
                          rosterNames.find(n => n.toLowerCase().includes(lo));
                        if (!match) {
                          window.alert("No coach in the roster matches \"" + v + "\". Add them under Coaches → Coach Roster first.");
                          return;
                        }
                        if (list.includes(match)) {
                          e.target.value = "";
                          return;
                        }
                        addCoach(tr, role.key, match);
                        e.target.value = "";
                      }}
                      onBlur={e => {
                        const v = (e.target.value||"").trim();
                        if (!v) return;
                        const lo = v.toLowerCase();
                        const match =
                          rosterNames.find(n => n.toLowerCase() === lo) ||
                          rosterNames.find(n => n.toLowerCase().startsWith(lo)) ||
                          rosterNames.find(n => n.toLowerCase().includes(lo));
                        if (match && !list.includes(match)) addCoach(tr, role.key, match);
                        e.target.value = "";
                      }}
                      style={{...inpStyle,width:"100%",padding:"6px 10px",fontSize:12,cursor:rosterNames.length===0?"not-allowed":"text"}}
                    />
                  </div>
                );
              })}
              {/* SMS export button — opens the device messaging app with
                  the assigned coaches' phone numbers prefilled and a fully
                  composed message body. */}
              <div style={{borderTop:"1px solid "+C.border,paddingTop:10,marginTop:4}}>
                <button onClick={() => {
                  const start = new Date(tr.start_at);
                  const end = new Date(tr.end_at);
                  const showtime = new Date(start.getTime() - 45*60000);
                  const endStay  = new Date(end.getTime()   + 60*60000);
                  const fmtT = d => d.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});
                  const fmtD = d => d.toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"});
                  const join = (arr) => (arr && arr.length ? arr.join(", ") : "TBD");
                  const message =
                    "DS Elite " + tr.division + " Tryout\n" +
                    fmtD(start) + "\n" +
                    "Tryout: " + fmtT(start) + " – " + fmtT(end) + "\n" +
                    "Showtime: " + fmtT(showtime) + " (please arrive 45 min before)\n" +
                    "Plan to stay until: " + fmtT(endStay) + " (1 hr after end)\n\n" +
                    "Players signed up: " + signedUp + "\n\n" +
                    "Lead Coach: " + join(tr.lead_coaches) + "\n" +
                    "Court Coach: " + join(tr.court_coaches) + "\n" +
                    "Evaluating Coach: " + join(tr.evaluating_coaches);
                  // Look phone numbers up from coach_roster by first-name or full-name match.
                  const findPhone = (name) => {
                    const n = (name||"").toLowerCase().trim();
                    if (!n) return null;
                    for (const c of coachRoster) {
                      const full  = ((c.first_name||"") + " " + (c.last_name||"")).toLowerCase().trim();
                      const first = (c.first_name||"").toLowerCase().trim();
                      if (full === n || first === n) return (c.phone||"").replace(/[^\d+]/g,"");
                    }
                    return null;
                  };
                  const allNames = [...(tr.lead_coaches||[]), ...(tr.court_coaches||[]), ...(tr.evaluating_coaches||[])];
                  const phones  = [...new Set(allNames.map(findPhone).filter(Boolean))];
                  const missing = [...new Set(allNames.filter(n => n && !findPhone(n)))];
                  // Silent copy to clipboard — no popup. Composed body has
                  // a "To: <phones>" line up top so the user can paste
                  // straight into a group thread.
                  const phoneBlock = phones.length
                    ? "To: " + phones.join(", ") + (missing.length ? "\n(No phone on file: " + missing.join(", ") + ")" : "") + "\n\n"
                    : (missing.length ? "(No phone numbers on file for: " + missing.join(", ") + ")\n\n" : "");
                  const composed = phoneBlock + message;
                  if (navigator.clipboard) navigator.clipboard.writeText(composed).catch(()=>{});
                }}
                  title="Copy a composed message + this tryout's coach phone numbers to clipboard"
                  style={{width:"100%",padding:"8px 14px",borderRadius:8,border:"1px solid "+C.gold,background:"transparent",color:C.gold,fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
                  ✉ Text Coaches
                </button>
                <button onClick={() => {
                  // Bulk player text — every player tryout_registered=true for this
                  // tryout's division. Composes a short reminder and prepends the
                  // unique parent phone numbers. Silently copies to clipboard.
                  const signups = players.filter(p =>
                    (p.usavDiv || p.usav_div) === tr.division && p.tryout_registered
                  );
                  const phones = [...new Set(
                    signups
                      .map(p => (p.parent_phone||"").replace(/[^\d+]/g,""))
                      .filter(Boolean)
                  )];
                  if (!phones.length) {
                    window.alert("No parent phone numbers found for " + tr.division + " tryout signups.");
                    return;
                  }
                  const start = new Date(tr.start_at);
                  const end = new Date(tr.end_at);
                  const showtime = new Date(start.getTime() - 45*60000);
                  const fmtT = d => d.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});
                  const fmtD = d => d.toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"});
                  const message =
                    "Hi! Reminder about the DS Elite " + tr.division + " tryout:\n" +
                    fmtD(start) + "\n" +
                    "Tryout: " + fmtT(start) + " – " + fmtT(end) + "\n" +
                    "Please arrive by " + fmtT(showtime) + " (45 min before start).\n\n" +
                    "Reply with any questions. Looking forward to seeing your athlete!";
                  const composed = "To: " + phones.join(", ") + "\n\n" + message;
                  if (navigator.clipboard) navigator.clipboard.writeText(composed).catch(()=>{});
                }}
                  title={"Copy a composed message + parent phones for every " + tr.division + " tryout signup"}
                  style={{width:"100%",padding:"8px 14px",borderRadius:8,border:"1px solid #06b6d4",background:"transparent",color:"#06b6d4",fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit",marginTop:6}}>
                  ✉ Text Players ({signedUp})
                </button>
              </div>
            </div>
            );
          })}
        </div>
        {tryouts.length === 0 && (
          <div style={{padding:30,textAlign:"center",color:C.mut,fontSize:12,background:C.card,borderRadius:10,border:"1px solid "+C.border}}>
            No tryouts loaded yet. Run the seed SQL in Supabase.
          </div>
        )}
      </div>
    );
  }

  // ─── SCHOLARSHIPS (admin-only Operations page) ───────────────────────
  // Track a scholarship offer ($ or %) per player. Admin gating is handled by
  // the OPS_VIEWS/canOps wrapper around the view switch.
  function renderScholarships() {
    const norm = (s) => (s || "").trim();
    const byName = (a,b) => (a.last_name||"").localeCompare(b.last_name||"") || (a.first_name||"").localeCompare(b.first_name||"");
    const offers = players.filter(p => norm(p.scholarship_amount)).sort(byName);
    // Best-effort dollar total: sum entries that look like dollars (ignore %).
    const parseDollar = (s) => {
      if (/%/.test(s || "")) return null;
      const n = parseFloat(norm(s).replace(/[$,\s]/g, ""));
      return isNaN(n) ? null : n;
    };
    const dollarTotal = offers.reduce((sum, p) => sum + (parseDollar(p.scholarship_amount) || 0), 0);
    const amtInp = {...inpStyle, width:120, padding:"6px 10px", fontSize:13, textAlign:"right"};
    const q = scholarSearch.trim().toLowerCase();
    const matches = q
      ? players.filter(p => ((p.first_name||"") + " " + (p.last_name||"")).toLowerCase().includes(q)).sort(byName).slice(0, 25)
      : [];
    const ageOf = (p) => p.usavDiv || p.usav_div || "—";

    const amountField = (p) => (
      <DebouncedField style={amtInp} placeholder="$ or %" value={p.scholarship_amount || ""}
        onCommit={v => upd(p.id, { scholarship_amount: v })} />
    );

    return (
      <div style={{maxWidth:860}}>
        <div style={{marginBottom:14}}>
          <h2 style={{margin:0,fontSize:18,fontWeight:800,color:C.gold}}>Scholarship Offers</h2>
          <div style={{fontSize:12,color:C.mut,marginTop:4}}>Admin-only. Record a scholarship offer per player as a dollar amount ($2,000) or a percentage (50%). Clearing the field removes the offer. Changes are logged in each player's Change History.</div>
        </div>

        {/* Summary */}
        <div style={{display:"flex",gap:18,flexWrap:"wrap",marginBottom:16,background:C.card,border:"1px solid "+C.border,borderRadius:12,padding:"12px 16px"}}>
          <div><div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut}}>Players with offers</div><div style={{fontSize:24,fontWeight:800,color:C.gold}}>{offers.length}</div></div>
          <div><div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut}} title="Sum of offers entered as dollar amounts; percentage offers are not included.">Est. dollar total</div><div style={{fontSize:24,fontWeight:800,color:C.grn}}>${dollarTotal.toLocaleString()}</div></div>
        </div>

        {/* Add / find a player */}
        <div style={{marginBottom:16}}>
          <span style={{fontSize:11,fontWeight:700,color:C.mut}}>Add or update an offer — search a player</span>
          <input value={scholarSearch} onChange={e=>setScholarSearch(e.target.value)} placeholder="Type a player name…"
            style={{...inpStyle,display:"block",width:"100%",maxWidth:360,padding:"8px 12px",fontSize:13,marginTop:6}} />
          {q && (
            <div style={{marginTop:8,background:C.bg,border:"1px solid "+C.border,borderRadius:8,padding:"6px 8px",maxHeight:240,overflowY:"auto"}}>
              {matches.length === 0 && <div style={{fontSize:12,color:C.mut,padding:6}}>No players match “{scholarSearch}”.</div>}
              {matches.map(p => (
                <div key={p.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:"6px 8px",borderRadius:6}}>
                  <button onClick={()=>setProfileId(p.id)} style={{background:"none",border:"none",color:C.text,fontFamily:"inherit",fontSize:13,fontWeight:600,cursor:"pointer",textAlign:"left",padding:0}}>
                    {p.first_name} {p.last_name} <span style={{color:C.mut,fontSize:11}}>· {ageOf(p)}</span>
                  </button>
                  {amountField(p)}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Current offers */}
        <div style={{fontSize:11,fontWeight:700,color:C.gold,textTransform:"uppercase",letterSpacing:0.5,marginBottom:8}}>Current Offers ({offers.length})</div>
        {offers.length === 0 ? (
          <div style={{padding:24,textAlign:"center",color:C.mut,fontSize:13,background:C.card,borderRadius:12,border:"1px solid "+C.border}}>
            No scholarship offers yet. Search for a player above and enter an amount.
          </div>
        ) : (
          <div style={{background:C.card,border:"1px solid "+C.border,borderRadius:12,overflow:"hidden"}}>
            {offers.map((p, i) => (
              <div key={p.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:"10px 14px",borderTop:i?"1px solid "+C.border:"none"}}>
                <button onClick={()=>setProfileId(p.id)} style={{background:"none",border:"none",color:C.text,fontFamily:"inherit",fontSize:13,fontWeight:600,cursor:"pointer",textAlign:"left",padding:0}}>
                  {p.first_name} {p.last_name} <span style={{color:C.mut,fontSize:11}}>· {ageOf(p)}{p.team_assignment?" · "+p.team_assignment:""}</span>
                </button>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  {amountField(p)}
                  <button onClick={()=>upd(p.id, { scholarship_amount: "" })} title="Remove this offer"
                    style={{background:"none",border:"none",color:C.red,fontFamily:"inherit",fontSize:16,fontWeight:800,cursor:"pointer",lineHeight:1,padding:"0 2px"}}>×</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── MESSAGES (SMS INBOX) ────────────────────────────────────────────
  // ─── EMAIL (bulk, send-only) ─────────────────────────────────────────
  // Compose one message and send it to every parent in scope as an
  // individual email from the DS Elite address; replies go to the coach's
  // inbox. Scope = players in the selected age groups, optionally narrowed.
  function renderEmailBlast() {
    const divSet = new Set(selectedDivs);
    const scopeOf = (div) => emailGroupScope[div] || "all";
    const divPlayersOf = (div) => players.filter(p => (p.usavDiv || p.usav_div) === div);
    const applySubset = (list, scope) =>
      scope === "tryout" ? list.filter(p => p.tryout_registered)
      : scope === "eval" ? list.filter(p => p.eval_registered)
      // "evaltryout" mirrors the Teams "Using eval as tryout" filter: players
      // who signed up for the eval and can't attend tryout (supplemental).
      : scope === "evaltryout" ? list.filter(p => p.supplemental === 1)
      : list; // "all"
    // Build the pool per age group from each group's chosen subset.
    let pool = [];
    selectedDivs.forEach(div => {
      const scope = scopeOf(div);
      if (scope === "none") return;
      pool.push(...applySubset(divPlayersOf(div), scope));
    });
    // Cross-cutting filters.
    if (emailTeam === "__has")       pool = pool.filter(p => p.team_assignment);
    else if (emailTeam === "__none") pool = pool.filter(p => !p.team_assignment);
    else if (emailTeam)              pool = pool.filter(p => p.team_assignment === emailTeam);
    // Match the *effective* status: when a player has an offer_status (the
    // Teams-board buckets — declined, not_invited, offered, etc.), derive the
    // status from it so the filter still works when the plain `status` column
    // is stale. The "Decline offer" dropdown sets offer_status only, so without
    // this a "Declined" filter would miss those players.
    const effStatus = (p) => {
      const o = p.offer_status || "";
      return (o && OFFER_TO_STATUS[o]) ? OFFER_TO_STATUS[o] : (p.status || "In Progress");
    };
    if (emailStatus)                 pool = pool.filter(p => effStatus(p) === emailStatus);
    // Teams available for the team dropdown (within the selected ages).
    const teamOptions = [...new Set(players.filter(p => divSet.has(p.usavDiv || p.usav_div)).map(p => p.team_assignment).filter(Boolean))].sort();
    // A player may have up to two parent/guardian emails; both receive messages.
    const emailsOf = p => [p.parent_email, p.parent_email2].map(e => (e || "").trim()).filter(Boolean);
    const byName = (a,b) => (a.last_name||"").localeCompare(b.last_name||"") || (a.first_name||"").localeCompare(b.first_name||"");
    // Manual opt-out: players the coach X'd out of THIS send (e.g. a parent who
    // is also on a distro list). They stay out of recipients but can be added back.
    const toggleExcluded = (id) => setEmailExcluded(prev => {
      const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
    });
    const excludedPlayers = pool.filter(p => emailExcluded.has(p.id) && emailsOf(p).length > 0).sort(byName);
    const sendPool = pool.filter(p => !emailExcluded.has(p.id));
    const recipients = [...new Set(sendPool.flatMap(emailsOf).map(e => e.toLowerCase()))].sort();
    const missingPlayers = sendPool.filter(p => emailsOf(p).length === 0).sort(byName);
    const missing = missingPlayers.length;
    const recipientPlayers = sendPool.filter(p => emailsOf(p).length > 0).sort(byName);

    const TEST_EMAIL = "drew@dselitevolleyball.com";
    const postEmail = async (to, isTest) => {
      if (!emailSubject.trim() || !emailBody.trim() || !to.length) return;
      setEmailSending(true); setEmailErr(""); setEmailResult(null);
      try {
        const res = await fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject: emailSubject.trim(), body: emailBody.trim(), recipients: to }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Send failed");
        setEmailResult({ ...data, test: !!isTest });
      } catch (e) { setEmailErr(e.message || "Something went wrong."); }
      finally { setEmailSending(false); }
    };
    const twoEmailCount = recipientPlayers.filter(p => emailsOf(p).length >= 2).length;
    const send = () => {
      if (!recipients.length) return;
      const lines = [
        "Send this email to " + recipients.length + " email address" + (recipients.length === 1 ? "" : "es") + "?",
        "",
        "Covers " + recipientPlayers.length + " player" + (recipientPlayers.length === 1 ? "" : "s") + " in scope.",
      ];
      if (twoEmailCount > 0) {
        lines.push(twoEmailCount + " of them have two parent emails — both addresses will be emailed.");
      }
      if (excludedPlayers.length > 0) {
        lines.push(excludedPlayers.length + " player" + (excludedPlayers.length === 1 ? "" : "s") + " you removed will NOT be emailed.");
      }
      if (!window.confirm(lines.join("\n"))) return;
      postEmail(recipients, false);
    };
    const sendTest = () => postEmail([TEST_EMAIL], true);

    // Templates (saved in this browser).
    const persistTemplates = (list) => {
      setEmailTemplates(list);
      try { localStorage.setItem("dse_email_templates", JSON.stringify(list)); } catch {}
    };
    const loadTemplate = (name) => {
      setEmailTemplateSel(name);
      const t = emailTemplates.find(x => x.name === name);
      if (t) { setEmailSubject(t.subject || ""); setEmailBody(t.body || ""); }
    };
    const saveTemplate = () => {
      const name = (window.prompt("Save this email as a template named:", emailTemplateSel || emailSubject.trim()) || "").trim();
      if (!name) return;
      const next = [...emailTemplates.filter(x => x.name !== name), { name, subject: emailSubject, body: emailBody }]
        .sort((a, b) => a.name.localeCompare(b.name));
      persistTemplates(next);
      setEmailTemplateSel(name);
    };
    const deleteTemplate = () => {
      if (!emailTemplateSel) return;
      if (!window.confirm("Delete template “" + emailTemplateSel + "”?")) return;
      persistTemplates(emailTemplates.filter(x => x.name !== emailTemplateSel));
      setEmailTemplateSel("");
    };


    return (
      <div style={{maxWidth:760}}>
        <div style={{marginBottom:12}}>
          <h2 style={{margin:0,fontSize:18,fontWeight:800,color:C.gold}}>Email parents</h2>
          <div style={{fontSize:12,color:C.mut,marginTop:4}}>Sends an individual email to each parent (they never see each other) from the DS Elite address. Replies come to your inbox. Scope follows the age-group chips above.</div>
        </div>

        {/* Per-age-group subset selectors */}
        <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:10}}>
          {selectedDivs.length === 0 && <div style={{fontSize:12,color:C.mut,fontStyle:"italic"}}>Pick age groups with the chips above.</div>}
          {selectedDivs.slice().sort().map(div => {
            const dp = divPlayersOf(div);
            const cnt = (scope) => new Set(applySubset(dp, scope).flatMap(p => [p.parent_email, p.parent_email2].map(e => (e||"").trim().toLowerCase()).filter(Boolean))).size;
            const scope = scopeOf(div);
            return (
              <div key={div} style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:12,fontWeight:800,color:C.gold,minWidth:42}}>{div}</span>
                <select value={scope} onChange={e=>setEmailGroupScope(prev=>({...prev,[div]:e.target.value}))}
                  style={{...inpStyle,padding:"6px 10px",fontSize:12,cursor:"pointer",minWidth:190,color:scope==="none"?C.mut:C.text}}>
                  <option value="none">None</option>
                  <option value="all">All ({cnt("all")})</option>
                  <option value="tryout">Tryout signups ({cnt("tryout")})</option>
                  <option value="eval">Eval signups ({cnt("eval")})</option>
                  <option value="evaltryout">Using eval as tryout ({cnt("evaltryout")})</option>
                </select>
              </div>
            );
          })}
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:10}}>
          <label style={{display:"flex",alignItems:"center",gap:5,fontSize:11,fontWeight:700,color:C.mut}}>Team
            <select value={emailTeam} onChange={e=>setEmailTeam(e.target.value)} style={{...inpStyle,padding:"6px 10px",fontSize:12,cursor:"pointer",color:emailTeam?C.gold:C.text}}>
              <option value="">Any</option>
              <option value="__has">Has a team</option>
              <option value="__none">No team yet</option>
              {teamOptions.length > 0 && <option disabled>──────</option>}
              {teamOptions.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label style={{display:"flex",alignItems:"center",gap:5,fontSize:11,fontWeight:700,color:C.mut}}>Status
            <select value={emailStatus} onChange={e=>setEmailStatus(e.target.value)} style={{...inpStyle,padding:"6px 10px",fontSize:12,cursor:"pointer",color:emailStatus?C.gold:C.text}}>
              <option value="">Any</option>
              {STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          {(emailTeam || emailStatus || Object.keys(emailGroupScope).length > 0 || emailExcluded.size > 0) && (
            <button onClick={()=>{ setEmailGroupScope({}); setEmailTeam(""); setEmailStatus(""); setEmailExcluded(new Set()); }} style={{padding:"5px 10px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Clear filters</button>
          )}
        </div>

        {/* Recipient count */}
        <div style={{fontSize:12,color:C.mut,marginBottom:12,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <span><strong style={{color:recipients.length?C.grn:C.red}}>{recipients.length}</strong> email address{recipients.length===1?"":"es"} · {recipientPlayers.length} player{recipientPlayers.length===1?"":"s"}{twoEmailCount>0?" ("+twoEmailCount+" with 2 parent emails — both sent)":""}</span>
          {missing > 0 && <button onClick={()=>setEmailShowMissing(v=>!v)} title="Show these players so you can add their parent email"
            style={{background:"none",border:"none",color:"#f59e0b",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,textDecoration:"underline",padding:0}}>· {missing} player{missing===1?"":"s"} in scope have no parent email</button>}
          {recipients.length > 0 && <button onClick={()=>setEmailShowList(v=>!v)} style={{background:"none",border:"none",color:C.gold,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,textDecoration:"underline"}}>{emailShowList?"hide":"show"} list</button>}
          {excludedPlayers.length > 0 && <button onClick={()=>setEmailShowExcluded(v=>!v)} title="Players you removed from this send"
            style={{background:"none",border:"none",color:C.red,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,textDecoration:"underline",padding:0}}>· {excludedPlayers.length} excluded</button>}
        </div>
        {emailShowMissing && missing > 0 && (
          <div style={{maxHeight:180,overflowY:"auto",background:C.bg,border:"1px solid rgba(245,158,11,0.4)",borderRadius:8,padding:"8px 10px",marginBottom:12}}>
            <div style={{fontSize:10,color:"#f59e0b",fontWeight:700,marginBottom:6}}>Click a player to open their card and add a parent email:</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {missingPlayers.map(p => (
                <button key={p.id} onClick={()=>setProfileId(p.id)}
                  style={{padding:"4px 10px",borderRadius:8,border:"1px solid "+C.border,background:C.card,color:C.text,fontFamily:"inherit",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                  {p.first_name} {p.last_name} <span style={{color:C.mut,fontSize:10}}>{p.usavDiv||p.usav_div}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {emailShowList && recipients.length > 0 && (
          <div style={{maxHeight:180,overflowY:"auto",background:C.bg,border:"1px solid "+C.border,borderRadius:8,padding:"8px 10px",marginBottom:12}}>
            <div style={{fontSize:10,color:C.mut,marginBottom:6}}>Click a name to open the card · click <strong style={{color:C.red}}>×</strong> to remove from this send</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {recipientPlayers.map(p => (
                <span key={p.id} title={emailsOf(p).join(", ")}
                  style={{display:"inline-flex",alignItems:"center",gap:6,padding:"4px 6px 4px 10px",borderRadius:8,border:"1px solid "+C.border,background:C.card,fontSize:12,fontWeight:600}}>
                  <button onClick={()=>setProfileId(p.id)} style={{background:"none",border:"none",color:C.text,fontFamily:"inherit",fontSize:12,fontWeight:600,cursor:"pointer",padding:0}}>
                    {p.first_name} {p.last_name} <span style={{color:C.mut,fontSize:10}}>{p.usavDiv||p.usav_div}</span>
                  </button>
                  <button onClick={()=>toggleExcluded(p.id)} title="Remove from this send"
                    style={{background:"none",border:"none",color:C.red,fontFamily:"inherit",fontSize:14,fontWeight:800,cursor:"pointer",lineHeight:1,padding:"0 2px"}}>×</button>
                </span>
              ))}
            </div>
          </div>
        )}
        {emailShowExcluded && excludedPlayers.length > 0 && (
          <div style={{maxHeight:180,overflowY:"auto",background:C.bg,border:"1px solid rgba(239,68,68,0.4)",borderRadius:8,padding:"8px 10px",marginBottom:12}}>
            <div style={{fontSize:10,color:C.red,fontWeight:700,marginBottom:6}}>Removed from this send — click a name to add them back:</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {excludedPlayers.map(p => (
                <button key={p.id} onClick={()=>toggleExcluded(p.id)} title={"Add back: " + emailsOf(p).join(", ")}
                  style={{display:"inline-flex",alignItems:"center",gap:6,padding:"4px 10px",borderRadius:8,border:"1px solid rgba(239,68,68,0.4)",background:C.card,color:C.mut,fontFamily:"inherit",fontSize:12,fontWeight:600,cursor:"pointer",textDecoration:"line-through"}}>
                  {p.first_name} {p.last_name} <span style={{fontSize:10}}>{p.usavDiv||p.usav_div}</span> <span style={{color:C.grn,fontWeight:800,textDecoration:"none"}}>＋</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Templates */}
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,flexWrap:"wrap"}}>
          <span style={{fontSize:11,fontWeight:700,color:C.mut}}>Template</span>
          <select value={emailTemplateSel} onChange={e=>loadTemplate(e.target.value)}
            style={{...inpStyle,padding:"6px 10px",fontSize:12,cursor:"pointer",minWidth:160,color:emailTemplateSel?C.gold:C.text}}>
            <option value="">— Load a template —</option>
            {emailTemplates.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
          </select>
          <button onClick={saveTemplate} title="Save the current subject + message as a reusable template"
            style={{padding:"6px 12px",borderRadius:6,border:"1px solid "+C.gold,background:"transparent",color:C.gold,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>+ Save as template</button>
          {emailTemplateSel && (
            <button onClick={deleteTemplate} title="Delete this template"
              style={{padding:"6px 10px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Delete</button>
          )}
        </div>

        {/* Compose */}
        <input value={emailSubject} onChange={e=>setEmailSubject(e.target.value)} placeholder="Subject"
          style={{...inpStyle,width:"100%",padding:"10px 12px",fontSize:14,marginBottom:8}} />
        <textarea value={emailBody} onChange={e=>setEmailBody(e.target.value)} placeholder="Write your message…"
          style={{...inpStyle,width:"100%",minHeight:200,padding:"10px 12px",fontSize:14,fontFamily:"inherit",resize:"vertical",lineHeight:1.5}} />

        <div style={{display:"flex",alignItems:"center",gap:12,marginTop:12,flexWrap:"wrap"}}>
          <button onClick={send} disabled={emailSending || !emailSubject.trim() || !emailBody.trim() || !recipients.length}
            style={{padding:"10px 20px",borderRadius:8,border:"none",background:(emailSending||!emailSubject.trim()||!emailBody.trim()||!recipients.length)?C.border:C.gold,color:(emailSending||!emailSubject.trim()||!emailBody.trim()||!recipients.length)?C.mut:"#000",fontFamily:"inherit",fontSize:14,fontWeight:800,cursor:(emailSending||!emailSubject.trim()||!emailBody.trim()||!recipients.length)?"default":"pointer"}}>
            {emailSending ? "Sending…" : "Send to " + recipients.length}
          </button>
          <button onClick={sendTest} disabled={emailSending || !emailSubject.trim() || !emailBody.trim()}
            title={"Send only to " + TEST_EMAIL + " so you can preview it"}
            style={{padding:"10px 16px",borderRadius:8,border:"1px solid "+C.border,background:"transparent",color:(emailSending||!emailSubject.trim()||!emailBody.trim())?C.mut:C.text,fontFamily:"inherit",fontSize:13,fontWeight:700,cursor:(emailSending||!emailSubject.trim()||!emailBody.trim())?"default":"pointer"}}>
            Send test to me
          </button>
          {emailErr && <span style={{color:C.red,fontSize:12,fontWeight:600}}>{emailErr}</span>}
          {emailResult && (
            <span style={{fontSize:12,fontWeight:600,color:emailResult.failed?.length?"#f59e0b":C.grn}}>
              {emailResult.test ? "Test sent to " + TEST_EMAIL : "Sent " + emailResult.sent}{emailResult.failed?.length ? " · " + emailResult.failed.length + " failed" : (emailResult.test ? "" : " · all delivered to Resend")}
            </span>
          )}
        </div>
        {emailResult?.failed?.length > 0 && (
          <div style={{marginTop:10,fontSize:11,color:"#f59e0b",background:"rgba(245,158,11,0.08)",border:"1px solid rgba(245,158,11,0.4)",borderRadius:8,padding:"8px 12px"}}>
            Failed: {emailResult.failed.map(f => f.email + " (" + f.error + ")").join("; ")}
          </div>
        )}
      </div>
    );
  }

  // Two-column view: thread list on the left, selected conversation on
  // the right. Realtime push (in the parent component) keeps both up
  // to date as Twilio delivers inbound + status updates.
  function renderMessages() {
    const fmtPhone = (p) => {
      if (!p) return "";
      const s = String(p).replace(/[^\d]/g, "");
      if (s.length === 11 && s.startsWith("1")) return "(" + s.slice(1,4) + ") " + s.slice(4,7) + "-" + s.slice(7);
      if (s.length === 10) return "(" + s.slice(0,3) + ") " + s.slice(3,6) + "-" + s.slice(6);
      return p;
    };
    const fmtWhen = (iso) => {
      if (!iso) return "";
      const d = new Date(iso);
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      return sameDay
        ? d.toLocaleTimeString(undefined, { hour:"numeric", minute:"2-digit" })
        : d.toLocaleDateString(undefined, { month:"short", day:"numeric" });
    };
    const playerById = new Map(players.map(p => [p.id, p]));
    const selected = smsThreads.find(t => t.id === selectedThreadId);
    const send = async () => {
      if (!selected || !smsCompose.trim()) return;
      const ok = await sendSms({ to: selected.phone, body: smsCompose.trim(), player_id: selected.player_id });
      if (ok) setSmsCompose("");
    };
    return (
      <div style={{display:"grid",gridTemplateColumns:"320px 1fr",gap:14,height:"calc(100vh - 160px)"}}>
        {/* Thread list */}
        <div style={{background:C.card,borderRadius:12,border:"1px solid "+C.border,overflowY:"auto"}}>
          <div style={{padding:"10px 14px",borderBottom:"1px solid "+C.border,position:"sticky",top:0,background:C.card,zIndex:2}}>
            <div style={{fontSize:12,fontWeight:800,color:C.gold,letterSpacing:0.5}}>INBOX</div>
            <div style={{fontSize:10,color:C.mut,marginTop:2}}>{smsThreads.length} thread{smsThreads.length===1?"":"s"}{totalUnread>0 ? " · " + totalUnread + " unread" : ""}</div>
          </div>
          {smsThreads.length === 0 && <div style={{padding:24,textAlign:"center",color:C.mut,fontSize:11}}>No conversations yet.</div>}
          {smsThreads.map(t => {
            const player = t.player_id ? playerById.get(t.player_id) : null;
            const label = t.display_name
              || (player ? player.first_name + " " + player.last_name : null)
              || fmtPhone(t.phone);
            const isSel = t.id === selectedThreadId;
            return (
              <div key={t.id}
                onClick={() => { setSelectedThreadId(t.id); if (t.unread_count) markThreadRead(t.id); }}
                style={{padding:"10px 14px",borderBottom:"1px solid "+C.border,cursor:"pointer",background:isSel?"rgba(233,30,140,0.10)":(t.unread_count?"rgba(34,197,94,0.06)":"transparent")}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:6}}>
                  <span style={{fontSize:13,fontWeight:700,color:t.unread_count?C.grn:C.text,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label}</span>
                  <span style={{fontSize:9,color:C.mut,whiteSpace:"nowrap"}}>{fmtWhen(t.last_message_at)}</span>
                </div>
                <div style={{fontSize:11,color:C.mut,marginTop:3,maxWidth:280,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {t.last_message_direction === "outbound" && <span style={{color:C.gold,marginRight:4}}>→</span>}
                  {t.last_message_preview || <i>(no messages yet)</i>}
                </div>
                {t.unread_count > 0 && <span style={{fontSize:9,fontWeight:800,padding:"1px 6px",borderRadius:8,background:C.grn,color:"#000",marginTop:4,display:"inline-block"}}>{t.unread_count} new</span>}
              </div>
            );
          })}
        </div>
        {/* Right pane */}
        <div style={{background:C.card,borderRadius:12,border:"1px solid "+C.border,display:"flex",flexDirection:"column",overflow:"hidden"}}>
          {!selected && (
            <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:C.mut,fontSize:12,padding:20,textAlign:"center"}}>
              {smsThreads.length === 0
                ? "Send a player's parent their first message from any player profile card."
                : "Pick a thread on the left to read or reply."}
            </div>
          )}
          {selected && (() => {
            const player = selected.player_id ? playerById.get(selected.player_id) : null;
            const title = selected.display_name
              || (player ? player.first_name + " " + player.last_name + (player.usavDiv ? " · " + player.usavDiv : "") : null)
              || fmtPhone(selected.phone);
            return (
              <>
                <div style={{padding:"12px 16px",borderBottom:"1px solid "+C.border}}>
                  <div style={{fontSize:14,fontWeight:800,color:C.gold}}>{title}</div>
                  <div style={{fontSize:11,color:C.mut,marginTop:2}}>{fmtPhone(selected.phone)}{player && <button onClick={()=>setProfileId(player.id)} style={{marginLeft:8,padding:"2px 8px",borderRadius:5,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Open player card</button>}</div>
                </div>
                <div style={{flex:1,overflowY:"auto",padding:"14px 16px",display:"flex",flexDirection:"column",gap:8}}>
                  {smsMessages.map(m => {
                    const out = m.direction === "outbound";
                    return (
                      <div key={m.id} style={{display:"flex",justifyContent:out?"flex-end":"flex-start"}}>
                        <div style={{maxWidth:"75%",padding:"8px 12px",borderRadius:14,background:out?"rgba(233,30,140,0.18)":"rgba(255,255,255,0.06)",color:C.text,fontSize:13,lineHeight:1.4,border:"1px solid "+(out?C.acc:C.border)}}>
                          <div style={{whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{m.body}</div>
                          <div style={{fontSize:9,color:C.mut,marginTop:4,textAlign:out?"right":"left"}}>
                            {fmtWhen(m.sent_at || m.created_at)}
                            {out && m.status && <span style={{marginLeft:6,fontWeight:700,color:m.status==="delivered"?C.grn:m.status==="failed"?C.red:C.mut}}>· {m.status}</span>}
                            {out && m.sent_by_label && <span style={{marginLeft:6}}>· {m.sent_by_label}</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {smsMessages.length === 0 && <div style={{textAlign:"center",color:C.mut,fontSize:11,padding:20}}>No messages in this thread yet.</div>}
                </div>
                <div style={{borderTop:"1px solid "+C.border,padding:"10px 14px",display:"flex",gap:8,alignItems:"flex-end"}}>
                  <textarea value={smsCompose} onChange={e=>setSmsCompose(e.target.value)}
                    placeholder="Type a message…"
                    rows={2}
                    onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
                    style={{...inpStyle,flex:1,padding:"8px 10px",fontSize:13,resize:"vertical",minHeight:40,maxHeight:140,fontFamily:"inherit"}} />
                  <button onClick={send} disabled={smsSending || !smsCompose.trim()}
                    style={{padding:"10px 16px",borderRadius:8,border:"none",background:smsCompose.trim()?C.gold:C.border,color:smsCompose.trim()?"#000":C.mut,fontFamily:"inherit",fontSize:13,fontWeight:700,cursor:smsCompose.trim()?"pointer":"default"}}>
                    {smsSending ? "Sending…" : "Send"}
                  </button>
                </div>
              </>
            );
          })()}
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
    // Scholarship amounts are admin-only — scrub them from the feed for non-admins.
    const activityFeed = scrubScholarship(activityLog);
    // Distinct actors / actions for the filter dropdowns. We compute from the
    // currently-loaded log so a freshly-loaded feed has the right options.
    const distinctActors = Array.from(new Map(
      activityFeed.filter(e => e.actor_id).map(e => [e.actor_id, e.actor_name || e.actor_email || "Unknown"])
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
    const ascending = [...activityFeed].reverse();
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
  // Age rows for the per-tournament division×age grid (oldest first).
  const TN_AGES = [18, 17, 16, 15, 14, 13, 12, 11];
  // An "entry" token is "<age> <tier>", e.g. "17 American".
  const entryToken = (age, tier) => age + " " + tier;
  const entryTier = (token) => token.slice(token.indexOf(" ") + 1);
  const entryAge  = (token) => parseInt(token);
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

  // Easter Sunday (Gregorian computus / Anonymous algorithm) → ISO date string.
  const easterSunday = (year) => {
    const a = year % 19, b = Math.floor(year/100), c = year % 100;
    const d = Math.floor(b/4), e = b % 4, f = Math.floor((b+8)/25);
    const g = Math.floor((b - f + 1)/3), h = (19*a + b - d - g + 15) % 30;
    const i = Math.floor(c/4), k = c % 4;
    const l = (32 + 2*e + 2*i - h - k) % 7;
    const m = Math.floor((a + 11*h + 22*l)/451);
    const month = Math.floor((h + l - 7*m + 114)/31); // 3=Mar, 4=Apr
    const day = ((h + l - 7*m + 114) % 31) + 1;
    return year + "-" + String(month).padStart(2,"0") + "-" + String(day).padStart(2,"0");
  };
  // Does a date range overlap Easter weekend (Good Friday → Easter Sunday)?
  const isEasterRange = (startDate, endDate) => {
    const years = new Set([startDate, endDate].map(d => parseInt(d.slice(0,4))));
    for (const y of years) {
      const es = easterSunday(y);
      const gf = new Date(es + "T00:00"); gf.setDate(gf.getDate() - 2); // Good Friday
      const gfISO = gf.toISOString().slice(0,10);
      if (startDate <= es && endDate >= gfISO) return true;
    }
    return false;
  };
  // Is a tournament on a 3-day weekend? True when a school-out (blackout) day
  // lands on the day before start, the day after end, or within the range.
  const isThreeDayWeekendRange = (startDate, endDate) => {
    const shift = (iso, days) => { const x = new Date(iso + "T00:00"); x.setDate(x.getDate() + days); return x.toISOString().slice(0,10); };
    const dayBefore = shift(startDate, -1), dayAfter = shift(endDate, 1);
    return blackoutDates.some(b =>
      (b.date_start <= dayBefore && b.date_end >= dayBefore) ||
      (b.date_start <= dayAfter  && b.date_end >= dayAfter)  ||
      (b.date_start <= endDate   && b.date_end >= startDate)
    );
  };

  // ─── TOURNAMENT TAGS ─────────────────────────────────────────────────
  // Tags are a mix of auto-computed badges (Easter, 3-Day Weekend, holiday
  // names) and user-created custom tags. Auto tags can be removed per
  // tournament (stored in hidden_tags); custom tags live in tags.
  const tnAutoTags = (tn) => {
    const tags = [];
    if (isEasterRange(tn.start_date, tn.end_date)) tags.push("Easter");
    if (isThreeDayWeekendRange(tn.start_date, tn.end_date)) tags.push("3-Day Weekend");
    blackoutsForRange(tn.start_date, tn.end_date)
      .filter(b => !/good\s*friday/i.test(b.name || ""))
      .forEach(b => { if (b.name) tags.push(b.name); });
    return [...new Set(tags)];
  };
  // The full set of tags shown on a tournament: auto tags not hidden, plus custom.
  const tnEffectiveTags = (tn) => {
    const hidden = new Set(Array.isArray(tn.hidden_tags) ? tn.hidden_tags : []);
    const custom = Array.isArray(tn.tags) ? tn.tags : [];
    return [...new Set([...tnAutoTags(tn).filter(t => !hidden.has(t)), ...custom])];
  };
  const isAutoTag = (tn, tag) => tnAutoTags(tn).includes(tag);
  // Remove a tag from a tournament: custom → drop from tags; auto → hide it.
  const removeTournamentTag = async (tn, tag) => {
    const custom = Array.isArray(tn.tags) ? tn.tags : [];
    let patch;
    if (custom.includes(tag)) {
      patch = { tags: custom.filter(t => t !== tag) };
    } else {
      const hidden = Array.isArray(tn.hidden_tags) ? tn.hidden_tags : [];
      if (hidden.includes(tag)) return;
      patch = { hidden_tags: [...hidden, tag] };
    }
    const { error } = await supabase.from("tournaments").update(patch).eq("id", tn.id);
    if (error) { window.alert("Update failed: " + error.message); return; }
    loadTournaments();
  };
  // Add a tag: re-show a hidden auto tag, else append a custom tag.
  const addTournamentTag = async (tn, raw) => {
    const tag = (raw || "").trim();
    if (!tag) return;
    const hidden = Array.isArray(tn.hidden_tags) ? tn.hidden_tags : [];
    let patch;
    if (hidden.includes(tag)) {
      patch = { hidden_tags: hidden.filter(t => t !== tag) };
    } else {
      const custom = Array.isArray(tn.tags) ? tn.tags : [];
      if (custom.includes(tag) || tnAutoTags(tn).includes(tag)) return; // already shown
      patch = { tags: [...custom, tag] };
    }
    const { error } = await supabase.from("tournaments").update(patch).eq("id", tn.id);
    if (error) { window.alert("Update failed: " + error.message); return; }
    loadTournaments();
  };
  // Color a tag chip by kind.
  const tagColor = (tag) =>
    tag === "Easter" ? "#a78bfa" :
    tag === "3-Day Weekend" ? "#06b6d4" :
    /break|dsisd|holiday|day\b|christmas|thanksgiving|spring|winter/i.test(tag) ? "#f59e0b" :
    C.gold;

  // Tournament-schedule Q&A. Builds a compact, pre-computed snapshot of every
  // tournament (dates, entries, holiday/Easter/3-day flags, committed teams)
  // and sends it with the question to /api/ask-tournaments.
  const runTnAsk = async () => {
    const q = tnAskQ.trim();
    if (!q) return;
    setTnAskBusy(true); setTnAskErr(""); setTnAskAnswer("");
    try {
      const payload = tournaments.map(t => ({
        name: t.name,
        start: t.start_date,
        end: t.end_date,
        location: t.location || "",
        venue: t.venue || "",
        ageLow: t.age_low,
        ageHigh: t.age_high,
        entries: Array.isArray(t.entries) ? t.entries : [],
        qualifier: !!t.is_qualifier,
        status: t.status || "",
        cancelled: !!t.cancelled,
        easter: isEasterRange(t.start_date, t.end_date),
        threeDay: isThreeDayWeekendRange(t.start_date, t.end_date),
        tags: tnEffectiveTags(t),
        holidays: blackoutsForRange(t.start_date, t.end_date).map(b => b.name),
        committed: tournamentAssignments
          .filter(a => a.tournament_id === t.id)
          .map(a => ({ team: a.team_id || a.team_name || "", division: a.division || "" })),
      }));
      const res = await fetch("/api/ask-tournaments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, tournaments: payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setTnAskAnswer(data.answer || "");
    } catch (e) {
      setTnAskErr(e.message || "Something went wrong.");
    } finally {
      setTnAskBusy(false);
    }
  };

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
      entries: Array.isArray(t.entries) ? t.entries : [],
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
    setNewTournament({ name: "", start_date: "", end_date: "", location: "", venue: "", age_low: "", age_high: "", gender: "Female", is_qualifier: false, source: "manual", status: "", notes: "", divisions: [], wish_list: [], entries: [] });
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
      entries: Array.isArray(tn.entries) ? [...tn.entries] : [],
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
  // Selectable age×tier grid. `entries` is the current selection; onToggle(token)
  // flips a cell. Reused by tournament cards and the add/edit modal.
  const renderEntryGrid = (entries, onToggle) => {
    const sel = Array.isArray(entries) ? entries : [];
    const cell = (on) => ({ width: 24, height: 18, borderRadius: 4, cursor: "pointer", margin: "0 auto", border: "1px solid " + (on ? C.gold : C.border), background: on ? "rgba(233,30,140,0.30)" : "transparent" });
    return (
      <div style={{ overflowX: "auto", marginTop: 6 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 10 }}>
          <thead>
            <tr>
              <th style={{ padding: "2px 6px" }} />
              {TN_DIVISIONS.map(tier => (
                <th key={tier} style={{ padding: "2px 4px", color: C.mut, fontWeight: 700, fontSize: 9, whiteSpace: "nowrap", textAlign: "center" }}>{tier}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TN_AGES.map(age => (
              <tr key={age}>
                <td style={{ padding: "1px 6px", color: C.text, fontWeight: 700, fontSize: 10, whiteSpace: "nowrap", textAlign: "right" }}>{age}</td>
                {TN_DIVISIONS.map(tier => {
                  const token = entryToken(age, tier);
                  const on = sel.includes(token);
                  return (
                    <td key={tier} style={{ padding: 1 }}>
                      <div onClick={() => onToggle(token)} title={token} style={cell(on)} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
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
              {tnEffectiveTags(tn).map(tag => (
                <span key={tag} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 5px 2px 8px",borderRadius:10,fontSize:9,fontWeight:800,letterSpacing:0.3,textTransform:"uppercase",border:"1px solid "+tagColor(tag),background:tagColor(tag)+"22",color:tagColor(tag)}}>
                  {tag}
                  <span onClick={e=>{ e.stopPropagation(); removeTournamentTag(tn, tag); }} title={"Remove “"+tag+"” tag"} style={{cursor:"pointer",fontSize:12,lineHeight:1,fontWeight:700,opacity:0.8}}>×</span>
                </span>
              ))}
              <span onClick={e=>{ e.stopPropagation(); const v = window.prompt("Add a tag to “"+tn.name+"”:"); if (v) addTournamentTag(tn, v); }}
                title="Add a custom tag" style={{cursor:"pointer",fontSize:9,fontWeight:800,letterSpacing:0.3,textTransform:"uppercase",padding:"2px 8px",borderRadius:10,border:"1px dashed "+C.border,color:C.mut,userSelect:"none"}}>+ Tag</span>
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

        {/* Selected division×age entries (read-only). Edit them via the
            grid in the tournament's Edit form. Hidden entirely when none. */}
        {(tn.entries || []).length > 0 && (
          <div style={{marginTop:8,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
            <span style={{fontSize:9,fontWeight:700,color:C.mut,textTransform:"uppercase",letterSpacing:0.5}}>Entries:</span>
            {(tn.entries || []).map(token => (
              <span key={token}
                style={{padding:"2px 8px",borderRadius:10,fontSize:10,fontWeight:700,border:"1px solid "+C.gold,background:"rgba(233,30,140,0.18)",color:C.gold}}>
                {token}
              </span>
            ))}
          </div>
        )}

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
                  <span onClick={()=>setTeamCardName(a.team_id)} title="Open team card" style={{fontWeight:700,cursor:"pointer",textDecoration:"underline",textDecorationColor:"transparent",textUnderlineOffset:2}}
                    onMouseEnter={e=>e.currentTarget.style.textDecorationColor=fg}
                    onMouseLeave={e=>e.currentTarget.style.textDecorationColor="transparent"}>{a.team_id}</span>
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
      // Age and division both match against the tournament's age×division
      // entries (e.g. "17 American") — a single entry must satisfy both when
      // both are set. When the tournament has no entries, the age filter falls
      // back to its age_low/age_high range (a tier filter can't match).
      if (tnFilters.ageFor || tnFilters.divisions.length > 0) {
        const ageSel = tnFilters.ageFor ? parseInt(tnFilters.ageFor) : null;
        const divs = tnFilters.divisions;
        const entries = t.entries || [];
        if (entries.length > 0) {
          const match = entries.some(tok =>
            (ageSel == null || entryAge(tok) === ageSel) &&
            (divs.length === 0 || divs.includes(entryTier(tok)))
          );
          if (!match) return false;
        } else {
          if (divs.length > 0) return false;
          if (ageSel != null) {
            if (t.age_low != null && ageSel < t.age_low) return false;
            if (t.age_high != null && ageSel > t.age_high) return false;
          }
        }
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
      if (tnFilters.tags.length > 0) {
        const eff = tnEffectiveTags(t);
        if (!tnFilters.tags.some(tag => eff.includes(tag))) return false;
      }
      return true;
    });
    const hasActiveFilters = tnFilters.search || tnFilters.ageFor || tnFilters.qualifierOnly || tnFilters.hideClosed || tnFilters.dateFrom || tnFilters.dateTo || tnFilters.startsOn.length || tnFilters.state || tnFilters.numDays || tnFilters.divisions.length || tnFilters.tags.length;
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
            <button onClick={()=>{ setEditingTournament(null); setNewTournament({ name: "", start_date: "", end_date: "", location: "", venue: "", age_low: "", age_high: "", gender: "Female", is_qualifier: false, source: "manual", status: "", notes: "", divisions: [], wish_list: [], entries: [] }); setAddingTournament(true); }}
              style={{padding:"6px 14px",borderRadius:6,border:"1px solid "+C.gold,background:"transparent",color:C.gold,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
              + Add tournament
            </button>
            <button onClick={loadTournaments} disabled={tournamentsLoading}
              style={{padding:"6px 12px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
              {tournamentsLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>
        {/* AI schedule Q&A (owner-only) */}
        {isOwner && (
          <div style={{marginBottom:8,background:C.card,borderRadius:10,border:"1px solid "+(tnAskOpen?C.gold:C.border),overflow:"hidden"}}>
            <div onClick={()=>setTnAskOpen(o=>!o)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 12px",cursor:"pointer"}}>
              <span style={{fontSize:12,fontWeight:800,color:C.gold}}>✨ Ask AI about the schedule</span>
              <span style={{fontSize:11,color:C.mut}}>{tnAskOpen?"▴":"▾"}</span>
            </div>
            {tnAskOpen && (
              <div style={{padding:"0 12px 12px"}}>
                <div style={{fontSize:11,color:C.mut,marginBottom:8,lineHeight:1.5}}>
                  Plain English — e.g. “What tournaments are available for 14 Diamond that are Liberty or USA, not on Easter or spring break, and don’t conflict with 14 Diamond’s other commitments?”
                </div>
                <div style={{display:"flex",gap:8,alignItems:"flex-start",flexWrap:"wrap"}}>
                  <textarea value={tnAskQ} onChange={e=>setTnAskQ(e.target.value)}
                    onKeyDown={e=>{ if (e.key==="Enter" && (e.metaKey||e.ctrlKey)) runTnAsk(); }}
                    placeholder="Ask about the tournament schedule…  (⌘/Ctrl+Enter to send)"
                    style={{...inpStyle,flex:"1 1 320px",minHeight:54,padding:"8px 10px",fontSize:13,resize:"vertical",fontFamily:"inherit"}} />
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    <button onClick={runTnAsk} disabled={tnAskBusy||!tnAskQ.trim()}
                      style={{padding:"9px 18px",borderRadius:8,border:"none",background:(tnAskBusy||!tnAskQ.trim())?C.border:C.gold,color:(tnAskBusy||!tnAskQ.trim())?C.mut:"#000",fontFamily:"inherit",fontSize:13,fontWeight:700,cursor:(tnAskBusy||!tnAskQ.trim())?"default":"pointer"}}>{tnAskBusy?"Thinking…":"Ask"}</button>
                    {tnAskAnswer && !tnAskBusy && <button onClick={()=>{navigator.clipboard.writeText(tnAskAnswer);}} style={{padding:"7px 14px",borderRadius:8,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer"}}>Copy</button>}
                  </div>
                </div>
                {tnAskBusy && <div style={{marginTop:10,fontSize:12,color:C.mut}}>Reading {tournaments.length} tournaments and thinking… this can take several seconds.</div>}
                {tnAskErr && !tnAskBusy && <div style={{marginTop:10,fontSize:12,color:C.red}}>{tnAskErr}</div>}
                {tnAskAnswer && !tnAskBusy && <div style={{marginTop:10,background:C.bg,border:"1px solid "+C.border,borderRadius:8,padding:"12px 14px",fontSize:13,lineHeight:1.6,whiteSpace:"pre-wrap",color:C.text}}>{tnAskAnswer}</div>}
              </div>
            )}
          </div>
        )}
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
        {/* Filter row 4 — tags */}
        {(() => {
          const allTags = [...new Set(tournaments.flatMap(t => tnEffectiveTags(t)))].sort((a,b)=>a.localeCompare(b));
          if (allTags.length === 0) return null;
          return (
            <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:12,padding:"6px 10px",background:C.card,borderRadius:10,border:"1px solid "+C.border}}>
              <span style={{fontSize:11,color:C.mut,fontWeight:600}}>Tags:</span>
              {allTags.map(tag => {
                const on = tnFilters.tags.includes(tag);
                return (
                  <span key={tag} onClick={()=>setTnFilters(prev=>({...prev,tags: on ? prev.tags.filter(x=>x!==tag) : [...prev.tags, tag]}))}
                    style={{padding:"3px 9px",borderRadius:10,fontSize:11,fontWeight:700,cursor:"pointer",border:"1px solid "+(on?tagColor(tag):C.border),background:on?tagColor(tag)+"22":"transparent",color:on?tagColor(tag):C.mut,userSelect:"none"}}>
                    {tag}
                  </span>
                );
              })}
              {tnFilters.tags.length > 0 && (
                <span onClick={()=>setTnFilters(prev=>({...prev,tags:[]}))} style={{fontSize:10,color:C.mut,marginLeft:6,cursor:"pointer",fontStyle:"italic",textDecoration:"underline"}}>clear</span>
              )}
            </div>
          );
        })()}
        {/* Conflict alert */}
        {tournamentConflicts.length > 0 && (
          <details open style={{marginBottom:14,background:"rgba(239,68,68,0.08)",border:"1px solid "+C.red,borderRadius:10,padding:"10px 14px"}}>
            <summary style={{cursor:"pointer",fontSize:12,fontWeight:800,color:C.red}}>
              {tournamentConflicts.length} coach conflict{tournamentConflicts.length===1?"":"s"} detected
            </summary>
            <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:5}}>
              {tournamentConflicts.map((c, i) => (
                <div key={i} style={{fontSize:11,color:C.text,lineHeight:1.5}}>
                  <b onClick={()=>setCoachCardName(c.coach)} style={{color:C.red,cursor:"pointer",textDecoration:"underline"}} title="Open coach card">{c.coach}</b> would be at <b onClick={()=>setTeamCardName(c.a.team_id)} style={{cursor:"pointer",textDecoration:"underline"}} title="Open team card">{c.a.team_id}</b> (<i>{c.a.tournament.name}</i>) AND <b onClick={()=>setTeamCardName(c.b.team_id)} style={{cursor:"pointer",textDecoration:"underline"}} title="Open team card">{c.b.team_id}</b> (<i>{c.b.tournament.name}</i>) on {new Date(c.a.tournament.start_date+"T00:00").toLocaleDateString()}.
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
    // Generate Saturdays between tnCalFrom and tnCalTo. The tournament season
    // runs December–June, so off-season weekends (Jul–Nov) are never shown.
    const SEASON_MONTHS = new Set([12, 1, 2, 3, 4, 5, 6]);
    const weeks = [];
    {
      const start = new Date(tnCalFrom + "T00:00");
      const end = new Date(tnCalTo + "T00:00");
      // advance to first Saturday on or after start
      let d = new Date(start);
      while (d.getDay() !== 6) d.setDate(d.getDate() + 1);
      while (d <= end) {
        const sat = new Date(d);
        const satISO = sat.toISOString().slice(0,10);
        if (SEASON_MONTHS.has(parseInt(satISO.slice(5,7)))) {
          const fri = new Date(sat); fri.setDate(fri.getDate() - 1);
          const sun = new Date(sat); sun.setDate(sun.getDate() + 1);
          weeks.push({
            fri: fri.toISOString().slice(0,10),
            sat: satISO,
            sun: sun.toISOString().slice(0,10),
          });
        }
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
                      <span onClick={()=>setTeamCardName(team.id)} title="Open team card" style={{cursor:"pointer",textDecoration:"underline",textDecorationColor:"transparent",textUnderlineOffset:2}}
                        onMouseEnter={e=>e.currentTarget.style.textDecorationColor=C.gold}
                        onMouseLeave={e=>e.currentTarget.style.textDecorationColor="transparent"}>{team.id}</span>
                      <div style={{fontSize:8,fontWeight:600,color:C.mut,textTransform:"none"}}>
                        {team.head_coach && <span onClick={e=>{e.stopPropagation();setCoachCardName(team.head_coach);}} title="Open coach card" style={{cursor:"pointer",textDecoration:"underline",textDecorationColor:"transparent"}}
                          onMouseEnter={e=>e.currentTarget.style.textDecorationColor=C.mut}
                          onMouseLeave={e=>e.currentTarget.style.textDecorationColor="transparent"}>{team.head_coach}</span>}
                        {team.assistant_coach && <>/<span onClick={e=>{e.stopPropagation();setCoachCardName(team.assistant_coach);}} title="Open coach card" style={{cursor:"pointer",textDecoration:"underline",textDecorationColor:"transparent"}}
                          onMouseEnter={e=>e.currentTarget.style.textDecorationColor=C.mut}
                          onMouseLeave={e=>e.currentTarget.style.textDecorationColor="transparent"}>{team.assistant_coach}</span></>}
                      </div>
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
                    {Array.isArray(t.entries) && t.entries.length > 0 && (
                      <span style={{display:"inline-flex",gap:3,flexWrap:"wrap"}}>
                        {t.entries.slice(0,6).map(d => (
                          <span key={d} style={{fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:8,background:"rgba(233,30,140,0.18)",color:C.gold,whiteSpace:"nowrap"}}>{d}</span>
                        ))}
                        {t.entries.length > 6 && <span style={{fontSize:9,color:C.mut}}>+{t.entries.length-6}</span>}
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
              <span style={lbl}>Divisions &amp; Ages (tap cells, e.g. 17 × American)</span>
              {(newTournament.entries||[]).length > 0 && (
                <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:4}}>
                  {(newTournament.entries||[]).map(token => (
                    <span key={token} style={{padding:"3px 9px",borderRadius:10,fontSize:11,fontWeight:700,border:"1px solid "+C.gold,background:"rgba(233,30,140,0.18)",color:C.gold}}>{token}</span>
                  ))}
                </div>
              )}
              {renderEntryGrid(newTournament.entries, (token)=>setNewTournament(prev => {
                const cur = prev.entries||[];
                return {...prev, entries: cur.includes(token) ? cur.filter(x=>x!==token) : [...cur, token]};
              }))}
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
              <div><span style={lbl}>Email 2</span><input type="email" style={editInp} value={newPlayer.parent_email2} onChange={e=>setF("parent_email2", e.target.value)} /></div>
              <div style={{gridColumn:"1 / -1"}}><span style={lbl}>Phone</span><input style={editInp} value={newPlayer.parent_phone} onChange={e=>setF("parent_phone", e.target.value)} placeholder="e.g. 512-555-1234" /></div>
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

  // Physical Testing — X/Y scatter plot. One dot per player, positioned by two
  // physical metrics (default: 10-yd Sprint on X, Vertical on Y). Dot color =
  // average eval score (red→green). Age group filters via the global chips
  // above; team/position filter locally.
  function renderPhysicalTesting() {
    const METRICS = {
      jump_touch:     { label:"Jump Touch",     unit:'"', get:p=>{const v=parseFloat(p.jump_touch);     return Number.isFinite(v)?v:null;}, lowerBetter:false, fmt:v=>v.toFixed(1) },
      approach_touch: { label:"Approach Touch", unit:'"', get:p=>{const v=parseFloat(p.approach_touch); return Number.isFinite(v)?v:null;}, lowerBetter:false, fmt:v=>v.toFixed(1) },
      vertical:       { label:"Vertical",       unit:'"', get:p=>vertical(p),                                                            lowerBetter:false, fmt:v=>v.toFixed(1) },
      sprint_10y:     { label:"10 Yard Run",    unit:"s", get:p=>{const v=parseFloat(p.sprint_10y);     return Number.isFinite(v)?v:null;}, lowerBetter:true,  fmt:v=>v.toFixed(2) },
      stand_reach:    { label:"Stand & Reach",  unit:'"', get:p=>{const v=parseFloat(p.stand_reach);    return Number.isFinite(v)?v:null;}, lowerBetter:false, fmt:v=>v.toFixed(1) },
    };
    const xCfg = METRICS[ptX], yCfg = METRICS[ptY];
    const divSet = new Set(selectedDivs);
    // Continuous red→yellow→green by average eval score (1–5).
    const avgColor = a => a==null ? C.mut : "hsl(" + Math.max(0, Math.min(120, ((a-1)/4)*120)) + ",72%,48%)";
    const avgNum = p => { const x = avg(p); return x === "—" ? null : parseFloat(x); };

    const teamOptions = [...new Set(players.filter(p=>divSet.has(p.usavDiv||p.usav_div)).map(p=>p.team_assignment).filter(Boolean))].sort();

    let pool = players.filter(p => divSet.has(p.usavDiv||p.usav_div));
    if (ptTeam) pool = pool.filter(p => p.team_assignment === ptTeam);
    if (ptPos)  pool = pool.filter(p => (p.positions||[]).includes(ptPos));
    // A dot needs BOTH metrics. Track players who have only one (fixable by data entry).
    const rows = pool.map(p => ({ p, x:xCfg.get(p), y:yCfg.get(p), a:avgNum(p) })).filter(r => r.x != null && r.y != null);
    const partial = pool.filter(p => { const hx = xCfg.get(p) != null, hy = yCfg.get(p) != null; return (hx || hy) && !(hx && hy); }).length;

    const axisRange = (vals) => {
      const mn = vals.length ? Math.min(...vals) : 0, mx = vals.length ? Math.max(...vals) : 1;
      const pad = (mx - mn) * 0.1 || (mx * 0.05) || 1;
      return { lo: mn - pad, hi: mx + pad };
    };
    const xR = axisRange(rows.map(r => r.x)), yR = axisRange(rows.map(r => r.y));
    // For lower-is-better metrics (e.g. 10 Yard Run) invert the axis so the
    // better (lower) value sits at the "good" end — right on X, top on Y.
    const xFrac = v => xR.hi === xR.lo ? 0.5 : (v - xR.lo) / (xR.hi - xR.lo);
    const yFrac = v => yR.hi === yR.lo ? 0.5 : (v - yR.lo) / (yR.hi - yR.lo);
    const xPct = v => 100 * (xCfg.lowerBetter ? 1 - xFrac(v) : xFrac(v));
    const yPct = v => 100 * (yCfg.lowerBetter ? 1 - yFrac(v) : yFrac(v));
    // Tick value at a given left→right (X) / bottom→top (Y) percent, honoring inversion.
    const xTickVal = t => xCfg.lowerBetter ? xR.hi - (t/100)*(xR.hi-xR.lo) : xR.lo + (t/100)*(xR.hi-xR.lo);
    const yTickVal = t => yCfg.lowerBetter ? yR.hi - (t/100)*(yR.hi-yR.lo) : yR.lo + (t/100)*(yR.hi-yR.lo);

    const sel = {...inpStyle,padding:"7px 10px",fontSize:12,cursor:"pointer"};
    const metricOpts = (exclude) => Object.entries(METRICS).map(([k,cfg]) =>
      <option key={k} value={k} disabled={k===exclude}>{cfg.label}</option>);
    const PLOT_H = 440, GUTTER = 46; // left gutter for Y labels

    return (
      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:10,marginBottom:14}}>
          <div>
            <h2 style={{margin:0,fontSize:20,fontWeight:800,color:C.gold}}>Physical Testing</h2>
            <div style={{fontSize:12,color:C.mut,marginTop:4}}>One dot per player at (X, Y). Dot color = average eval score. Age groups follow the chips above.</div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <label style={{display:"flex",alignItems:"center",gap:5,fontSize:11,fontWeight:700,color:C.mut}}>X
              <select style={sel} value={ptX} onChange={e=>setPtX(e.target.value)}>{metricOpts(ptY)}</select>
            </label>
            <label style={{display:"flex",alignItems:"center",gap:5,fontSize:11,fontWeight:700,color:C.mut}}>Y
              <select style={sel} value={ptY} onChange={e=>setPtY(e.target.value)}>{metricOpts(ptX)}</select>
            </label>
            <select style={sel} value={ptTeam} onChange={e=>setPtTeam(e.target.value)}>
              <option value="">All Teams</option>
              {teamOptions.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select style={sel} value={ptPos} onChange={e=>setPtPos(e.target.value)}>
              <option value="">All Positions</option>
              {POSITIONS.map(pos => <option key={pos} value={pos}>{POS_LABELS[pos]||pos}</option>)}
            </select>
          </div>
        </div>

        {/* Avg-score color legend */}
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,fontSize:11,color:C.mut,flexWrap:"wrap"}}>
          <span style={{fontWeight:700,textTransform:"uppercase",fontSize:10}}>Avg eval</span>
          <span style={{display:"flex",alignItems:"center",gap:6}}>
            1
            <span style={{width:120,height:10,borderRadius:5,background:"linear-gradient(90deg,"+avgColor(1)+","+avgColor(3)+","+avgColor(5)+")"}} />
            5
          </span>
        </div>

        {rows.length === 0 ? (
          <div style={{padding:30,textAlign:"center",color:C.mut,fontSize:13,background:C.card,borderRadius:12,border:"1px solid "+C.border}}>
            No players have both {xCfg.label} and {yCfg.label} for the selected filters. Enter both on each player's card (Physical Testing section).
          </div>
        ) : (
          <div style={{background:C.card,borderRadius:12,border:"1px solid "+C.border,padding:"16px 18px"}}>
            <div style={{fontSize:11,color:C.mut,marginBottom:12}}>
              {rows.length} player{rows.length===1?"":"s"} plotted
              {partial > 0 && <> · <span style={{color:C.gold}}>{partial} hidden</span> (missing {xCfg.label} or {yCfg.label})</>}
            </div>
            {/* Plot: Y axis label + (Y ticks | plot area), then X ticks + X label */}
            <div style={{display:"flex"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",width:20}}>
                <span style={{transform:"rotate(-90deg)",whiteSpace:"nowrap",fontSize:11,fontWeight:700,color:C.text}}>
                  {yCfg.label} ({yCfg.unit}){yCfg.lowerBetter?" · better ↑":""}
                </span>
              </div>
              <div style={{flex:1}}>
                <div style={{display:"flex"}}>
                  {/* Y tick labels */}
                  <div style={{position:"relative",width:GUTTER,height:PLOT_H}}>
                    {[0,25,50,75,100].map(t => (
                      <span key={t} style={{position:"absolute",right:6,bottom:"calc("+t+"% - 6px)",fontSize:10,color:C.mut}}>
                        {yCfg.fmt(yTickVal(t))}
                      </span>
                    ))}
                  </div>
                  {/* Plot area */}
                  <div style={{position:"relative",flex:1,height:PLOT_H,borderLeft:"1px solid "+C.border,borderBottom:"1px solid "+C.border}}>
                    {/* gridlines */}
                    {[25,50,75,100].map(t => <div key={"x"+t} style={{position:"absolute",left:t+"%",top:0,bottom:0,width:1,background:"rgba(255,255,255,0.05)"}} />)}
                    {[25,50,75,100].map(t => <div key={"y"+t} style={{position:"absolute",bottom:t+"%",left:0,right:0,height:1,background:"rgba(255,255,255,0.05)"}} />)}
                    {/* dots */}
                    {rows.map(({p,x,y,a}) => {
                      const L = xPct(x), B = yPct(y);
                      return (
                        <div key={p.id} onClick={()=>setProfileId(p.id)}
                          title={p.first_name+" "+p.last_name+" — "+xCfg.label+" "+xCfg.fmt(x)+xCfg.unit+", "+yCfg.label+" "+yCfg.fmt(y)+yCfg.unit+(a!=null?" · avg "+a.toFixed(1):"")}
                          style={{position:"absolute",left:L+"%",bottom:B+"%",transform:"translate(-50%,50%)",cursor:"pointer",display:"flex",alignItems:"center",gap:4,whiteSpace:"nowrap"}}>
                          <span style={{width:13,height:13,borderRadius:"50%",background:avgColor(a),border:"2px solid "+C.card,boxShadow:"0 0 0 1px rgba(0,0,0,0.45)"}} />
                          <span style={{fontSize:9,color:C.mut,pointerEvents:"none"}}>{p.first_name}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {/* X tick labels */}
                <div style={{display:"flex"}}>
                  <div style={{width:GUTTER}} />
                  <div style={{position:"relative",flex:1,height:16,fontSize:10,color:C.mut,marginTop:2}}>
                    {[0,25,50,75,100].map(t => (
                      <span key={t} style={{position:"absolute",left:t+"%",transform:t===0?"none":t===100?"translateX(-100%)":"translateX(-50%)"}}>
                        {xCfg.fmt(xTickVal(t))}
                      </span>
                    ))}
                  </div>
                </div>
                {/* X axis label */}
                <div style={{textAlign:"center",marginLeft:GUTTER,marginTop:6,fontSize:11,fontWeight:700,color:C.text}}>
                  {xCfg.label} ({xCfg.unit}){xCfg.lowerBetter?" · faster → (right)":""}
                </div>
              </div>
            </div>
          </div>
        )}
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
          <nav style={{display:"flex",gap:3,flexWrap:"wrap",position:"relative",zIndex:50}}>
            {(() => {
              const btn = (active) => ({padding:"6px 14px",borderRadius:8,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600,background:active?C.gold:"transparent",color:active?"#000":C.mut});
              const item = (v,l) =>
                <button key={v} style={btn(view===v)} onClick={()=>{ setView(v); setOpenMenu(null); }}>{l}</button>;
              const groups = [
                { title:"Tryouts", items:[["dashboard","Dashboard"], ["evaluate","Evaluate"], ["favorites","My Favorites" + (favorites.length ? " (" + favorites.length + ")" : "")], ...(canViewTeams ? [["teams","Teams"]] : []), ["rankings","Rankings"], ["physical","Physical Testing"], ["tryouts","Coach Assignments"]] },
                ...(canOps ? [{ title:"Operations", items:[["tracker","Tracker"], ["teamdir","All Teams"], ["coaches","Coaches"], ["scholarships","Scholarships"], ["practice","Practice"], ["email","Email"], ["messages", "Messages (SMS)" + (totalUnread > 0 ? " (" + totalUnread + ")" : "")]] }] : []),
              ];
              return <>
                {item("home","Home")}
                {groups.map(g => {
                  const activeInGroup = g.items.some(([v]) => v === view);
                  const open = openMenu === g.title;
                  return (
                    <div key={g.title} style={{position:"relative"}}>
                      <button style={btn(activeInGroup)} onClick={()=>setOpenMenu(open ? null : g.title)}>
                        {g.title} <span style={{fontSize:9,opacity:.8}}>▾</span>
                      </button>
                      {open && (
                        <div style={{position:"absolute",top:"100%",left:0,marginTop:4,background:C.card,border:"1px solid "+C.border,borderRadius:8,padding:4,minWidth:150,boxShadow:"0 10px 28px rgba(0,0,0,0.45)"}}>
                          {g.items.map(([v,l]) =>
                            <button key={v} style={{display:"block",width:"100%",textAlign:"left",padding:"8px 12px",borderRadius:6,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600,background:view===v?C.gold:"transparent",color:view===v?"#000":C.text}} onClick={()=>{ setView(v); setOpenMenu(null); }}>{l}</button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {item("tournaments","Tournaments")}
                {item("activity","Activity")}
                {isOwner && item("askai","Ask AI")}
                <button style={btn(false)} onClick={()=>{ window.location.href = "/practice"; }} title="Open the practice planner">Practice Planning</button>
              </>;
            })()}
          </nav>
          {openMenu && <div onClick={()=>setOpenMenu(null)} style={{position:"fixed",inset:0,zIndex:40}} />}
          <button onClick={openAddPlayer} title="Add a player from any view"
            style={{padding:"6px 12px",borderRadius:8,border:"1px solid "+C.gold,background:"transparent",color:C.gold,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700}}>
            + Add Player
          </button>
          <div style={{position:"relative",marginLeft:6}}>
            <button onClick={()=>{ const opening = !notifOpen; setNotifOpen(opening); if (opening) markNotifsRead(); }} title="Notifications"
              style={{position:"relative",background:"none",border:"none",cursor:"pointer",fontSize:18,lineHeight:1,color:unreadCount>0?C.gold:C.mut,padding:"2px 4px"}}>
              🔔
              {unreadCount>0 && <span style={{position:"absolute",top:-3,right:-3,minWidth:15,height:15,padding:"0 3px",borderRadius:8,background:C.gold,color:"#000",fontSize:9,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>{unreadCount>9?"9+":unreadCount}</span>}
            </button>
            {notifOpen && (<>
              <div onClick={()=>setNotifOpen(false)} style={{position:"fixed",inset:0,zIndex:60}} />
              <div style={{position:"fixed",top:56,right:8,left:"auto",width:"min(360px, calc(100vw - 16px))",maxHeight:"72vh",overflowY:"auto",background:C.card,border:"1px solid "+C.border,borderRadius:10,boxShadow:"0 12px 32px rgba(0,0,0,0.55)",zIndex:61,padding:6}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,padding:"6px 8px"}}>
                  <span style={{fontSize:12,fontWeight:800,color:C.gold}}>Notifications</span>
                  {pushState==="on" && <button onClick={disablePush} title="Turn off push on this device" style={{fontSize:9,fontWeight:800,padding:"2px 8px",borderRadius:8,border:"1px solid "+C.grn,background:"rgba(34,197,94,0.18)",color:C.grn,cursor:"pointer",fontFamily:"inherit"}}>Push on ✓</button>}
                  {(pushState==="off") && <button onClick={enablePush} title="Get alerts on this device even when the app is closed" style={{fontSize:9,fontWeight:800,padding:"2px 8px",borderRadius:8,border:"none",background:C.gold,color:"#000",cursor:"pointer",fontFamily:"inherit"}}>Enable push</button>}
                  {pushState==="denied" && <span style={{fontSize:9,color:C.red,fontWeight:700}} title="Notifications are blocked for this site in your browser settings">Push blocked</span>}
                </div>
                {notifications.length===0 && <div style={{fontSize:12,color:C.mut,padding:"10px 8px"}}>You're all caught up.</div>}
                {notifications.slice(0,40).map(n => {
                  const d = n.ts ? new Date(n.ts) : null;
                  const when = d ? d.toLocaleDateString(undefined,{month:"short",day:"numeric"}) + " " + d.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"}) : "";
                  const text = (n.text||"").length>110 ? (n.text||"").slice(0,110)+"…" : (n.text||"");
                  return (
                    <button key={n.id} onClick={()=>{ setView(n.view||"home"); setOpenMenu(null); setNotifOpen(false); }}
                      style={{display:"block",width:"100%",textAlign:"left",background:"transparent",border:"none",borderTop:"1px solid "+C.border,padding:"8px",cursor:"pointer",fontFamily:"inherit"}}>
                      <div style={{fontSize:9,fontWeight:800,letterSpacing:0.4,textTransform:"uppercase",color:n.label==="Question"?"#f59e0b":n.label==="Answered"?C.grn:C.acc}}>{n.label} · {when}</div>
                      <div style={{fontSize:12,color:C.text,marginTop:2,lineHeight:1.4,whiteSpace:"pre-wrap"}}>{text}</div>
                    </button>
                  );
                })}
              </div>
            </>)}
          </div>
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
      {isOwner && (() => {
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
      {view !== "home" && view !== "dashboard" && view !== "activity" && view !== "coaches" && view !== "tournaments" && view !== "teamdir" && (
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
        {OPS_VIEWS.has(view) && !canOps ? opsDenied : <>
        {view==="home" && renderHome()}
        {view==="dashboard" && renderDashboard()}
        {view==="evaluate" && renderEval()}
        {view==="favorites" && renderFavorites()}
        {view==="teams" && (canViewTeams ? renderTeams() : <div style={{padding:24,color:C.mut,textAlign:"center"}}>Team lists are restricted. Ask the club administrator (Drew) for access.</div>)}
        {view==="teamdir" && renderTeamDirectory()}
        {view==="tracker" && renderTracker()}
        {view==="rankings" && renderRankings()}
        {view==="activity" && renderActivity()}
        {view==="coaches"  && renderCoaches()}
        {view==="scholarships" && renderScholarships()}
        {view==="tournaments" && renderTournaments()}
        {view==="practice" && renderPractice()}
        {view==="physical" && renderPhysicalTesting()}
        {view==="tryouts" && renderTryouts()}
        {view==="email" && renderEmailBlast()}
        {view==="messages" && renderMessages()}
        {view==="askai" && renderAskAI()}
        </>}
      </div>
      {profileId !== null && renderProfile()}
      {teamCardName && renderTeamCard()}
      {coachCardName && renderCoachCard()}
      {addingPlayer && renderAddPlayer()}
      {addingTournament && renderAddTournament()}
      {addingCoach && renderAddCoach()}
      {bulkImportOpen && renderBulkImport()}
    </div>
  );
}
