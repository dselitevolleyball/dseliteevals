// Court availability (Drew, Oct 12 2026): what's on each court, hour by hour,
// and where the open time is. Pure functions - the API route resolves Playbook
// events to courts, the screen places DS Elite practices and draws the grid.
//
// Courts: Warehouse I has V1-V4 (Basketball Court 1 = V1+V2, BB2 = V3+V4);
// Warehouse II (Playbook still calls it "DSSC Flex"; renamed Oct 26 2026) has
// V5-V6 (BB3 = V5+V6). A booking on a basketball court or a whole
// building takes every volleyball court under it.

export const COURTS = [
  { id: "V1", label: "Court 1", building: "Warehouse I" },
  { id: "V2", label: "Court 2", building: "Warehouse I" },
  { id: "V3", label: "Court 3", building: "Warehouse I" },
  { id: "V4", label: "Court 4", building: "Warehouse I" },
  { id: "V5", label: "Court 5", building: "Warehouse II" },
  { id: "V6", label: "Court 6", building: "Warehouse II" },
];
const WAREHOUSE = ["V1", "V2", "V3", "V4"], FLEX = ["V5", "V6"];

// Playbook resource ids (from the public calendar's own filter list).
// U6499 Reach Performance and the per-staff "S…" rental resources hold no court.
export const RESOURCE_COURTS = {
  L19309: WAREHOUSE,           // DSSC Warehouse (whole building)
  U6248: ["V1", "V2"],         // Basketball Court 1
  U6249: ["V3", "V4"],         // Basketball Court 2
  U6250: ["V1"], U6251: ["V2"], U6252: ["V3"], U6253: ["V4"],   // Volleyball Court 1-4
  L19321: FLEX,                // DSSC Flex (whole building)
  U6334: FLEX,                 // Basketball Court 3
  U6335: ["V5"], U6336: ["V6"],  // Volleyball Court 5-6
};

const field = (html, label) => { const m = new RegExp("<p>" + label + "\\s*-\\s*<b>([^<]*)</b>", "i").exec(String(html || "")); return m ? m[1].trim() : null; };

// Courts a Playbook event takes. resourceIds first; the text is the fallback
// for an event that carries none.
export function courtsForEvent(ext = {}) {
  const fromIds = [...new Set((ext.resourceIds || []).flatMap(r => RESOURCE_COURTS[r] || []))];
  if (fromIds.length || (ext.resourceIds || []).length) return fromIds;
  const sub = field(ext.contents, "Sub Location"), loc = field(ext.contents, "Location") || "";
  if (sub) {
    const out = new Set();
    for (const part of sub.split(/\s*,\s*/)) {
      let m = /volleyball court\s*(\d)/i.exec(part); if (m && +m[1] >= 1 && +m[1] <= 6) { out.add("V" + m[1]); continue; }
      m = /basketball court\s*(\d)/i.exec(part);
      if (m) ({ 1: ["V1", "V2"], 2: ["V3", "V4"], 3: FLEX }[m[1]] || []).forEach(c => out.add(c));
    }
    if (out.size || /reach/i.test(sub)) return [...out];
  }
  if (/flex/i.test(loc)) return FLEX;
  return [];
}

// Standing DS Elite reservations (Drew, Oct 12): the whole Warehouse is DS
// Elite's 1-9pm every Sunday. It's booked in Playbook as a reservation, which
// the public calendar doesn't show, so it's declared here. DS Elite teams are
// placed inside it; anything else booked in it is flagged as a conflict.
export const DSE_RESERVED = [
  { dow: 0, start: 13, end: 21, courts: ["V1", "V2", "V3", "V4"], label: "DS Elite Sunday block", detail: "Warehouse reserved for DS Elite, 1-9pm" },
];
export const reservedFor = (ymd) => { const dow = new Date(ymd + "T12:00:00").getDay(); return DSE_RESERVED.filter(r => r.dow === dow); };

// Court reservations Playbook has on the books (synced hourly from the
// registrations report into dssc_participation): a court and a date, no time.
// "Volleyball court 5 Rentals - Dssc flex" -> V5, "DSSC Flex" -> V5+V6, ...
export function courtsForName(name) {
  const s = String(name || "");
  let m = /volleyball court\s*(\d)/i.exec(s); if (m && +m[1] >= 1 && +m[1] <= 6) return ["V" + m[1]];
  m = /basketball court\s*(\d)/i.exec(s); if (m) return { 1: ["V1", "V2"], 2: ["V3", "V4"], 3: FLEX }[m[1]] || [];
  if (/dssc flex|^flex$|warehouse\s*(ii|2)\b/i.test(s.trim())) return FLEX;
  if (/warehouse/i.test(s)) return WAREHOUSE;
  return [];
}
// DS Elite's Sunday block, going by the calendar (Drew, Oct 12): the courts
// the club has reserved in Playbook that Sunday, 1-9pm. When the rentals export
// gives those bookings their times (Oct 14) the block takes them; a Sunday with
// nothing reserved yet falls back to the standing Warehouse rule above.
const courtOrder = (cs) => { const order = COURTS.map(c => c.id); return [...new Set(cs)].sort((a, b) => order.indexOf(a) - order.indexOf(b)); };
//
// Weeknights too (Drew, Oct 23 2026: "use DS HQ as the source of record for DS
// Elite rentals, with their team names"). DS Elite's own timed rentals on any
// day are courts held for DS Elite, not bookings: HQ's practice schedule places
// its teams inside them by name, and a team only conflicts when the held courts
// plus the free ones can't take it. Held courts no team uses stay held.
export function dseBlock(ymd, reservations = []) {
  const sunday = new Date(ymd + "T12:00:00").getDay() === 0;
  const name = sunday ? "DS Elite Sunday block" : "DS Elite courts";
  const mine = reservations.filter(r => r.date === ymd && r.internal);
  const timed = mine.filter(r => r.start != null && r.end != null && r.end > r.start);
  if (!sunday) return groupBlocks(timed, name);
  if (timed.length) {
    const out = groupBlocks(timed, name);
    // A court DS Elite has reserved with no time that the export doesn't
    // account for (booked after it - not "covered") still gets 1-9pm.
    const rest = mine.filter(r => !(r.start != null && r.end != null && r.end > r.start) && !r.covered).flatMap(r => r.courts);
    if (rest.length) out.push({ dow: 0, start: 13, end: 21, courts: courtOrder(rest), label: "DS Elite Sunday block", detail: "Reserved for DS Elite in Playbook (time not on the export), 1-9pm" });
    return out;
  }
  const courts = mine.flatMap(r => r.courts);
  if (!courts.length) return reservedFor(ymd);
  return [{ dow: 0, start: 13, end: 21, courts: courtOrder(courts), label: "DS Elite Sunday block", detail: "Reserved for DS Elite in Playbook, 1-9pm" }];
}
// Older name, kept for callers that still use it.
export const sundayBlock = dseBlock;
// DS Elite's timed reservations, one block per time window.
function groupBlocks(timed, label) {
  const g = new Map();
  for (const r of timed) { const k = r.start + "|" + r.end; if (!g.has(k)) g.set(k, { start: r.start, end: r.end, courts: [] }); g.get(k).courts.push(...r.courts); }
  return [...g.values()].map(x => ({ start: x.start, end: x.end, courts: courtOrder(x.courts), label, detail: "Reserved for DS Elite in Playbook, " + fmtHour(x.start) + "-" + fmtHour(x.end) }));
}

// ── Rentals from Playbook's Events export (Drew, Oct 14 2026) ─────────────────
// Each Rented Session row: Locations ("DSSC Flex", "DSSC Warehouse, DSSC Flex",
// "Not Provided"), Sub Locations ("Volleyball Court 4", "Basketball Court 3",
// "N/A"), Start/End Time ("17:00:00"), Program, Event Details ("Tressa
// Aleshire - DS Storm").
// The courts: the sub location when it names one, else a single building
// (the whole Flex or Warehouse); a booking on "DSSC" with no court -> [].
const NONE = /^(n\/?a|not provided|none|--|-)?$/i;
export function rentalCourts(location, sub) {
  const subs = String(sub || "").split(/\s*,\s*/).filter(x => !NONE.test(x.trim()));
  const fromSub = subs.flatMap(x => courtsForName(x));
  if (fromSub.length) return courtOrder(fromSub);
  const locs = String(location || "").split(/\s*,\s*/).filter(x => !NONE.test(x.trim()));
  return locs.length === 1 ? courtOrder(courtsForName(locs[0])) : [];
}
// "17:00:00" / "5:00 PM" -> 17 (hours).
export function clockHours(t) {
  const m = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?\s*$/i.exec(String(t || ""));
  if (!m) return null;
  let h = +m[1]; const min = +m[2];
  if (m[3]) { h = h % 12; if (/p/i.test(m[3])) h += 12; }
  return h > 24 || min > 59 ? null : h + min / 60;
}
// "Tionne Graves-Brown session" -> "Tionne"; a court or building session -> null.
function coachSession(s) {
  const m = /^\s*([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*)+)\s+session\s*$/.exec(String(s || ""));
  if (!m || /court|flex|warehouse|dssc|gym|field|room/i.test(m[1])) return null;
  return m[1].split(/\s+/)[0];
}
// Who the booking is for, the way the court screen should say it.
export function rentalWho({ program, details }) {
  const d = String(details || "").trim(), p = String(program || "").trim();
  const cut = d.indexOf(" - "), person = cut > 0 ? d.slice(0, cut).trim() : "", item = cut > 0 ? d.slice(cut + 3).trim() : d;
  const t = (p + " " + d).toLowerCase();
  const internal = /^drew rose$/i.test(person) || /\bdsev\b|ds elite/i.test(p + " " + item);
  let label;
  if (/ds storm|aleshire/.test(t)) label = "DS Storm";
  else if (/\baces\b|madavane/.test(t)) label = "Aces";
  else if (/aesa/.test(t)) label = "AESA Prep Academy";
  else if (/veritas|lisa jasper/.test(t)) label = "Veritas Academy";
  else if (/birthday/.test(t)) label = "Birthday party";
  else if (/private/.test(t)) { const coach = (/^(.+?)\s+private/i.exec(item) || [])[1]; label = "Private lesson" + (coach ? " (" + coach.trim() + ")" : ""); }
  // A coach's own booking page: "Breanna Coward session", "Hunter Haley session".
  else if (!internal && coachSession(item || p)) label = "Private lesson (" + coachSession(item || p) + ")";
  else if (internal) label = /positional/i.test(p) ? "DS Elite positional training" : "DS Elite";
  else label = person || p || "Rental";
  return { label, person: person || null, item: item || p || null, internal };
}

// "Program Package" name, or the hold's own title ("Hold - Aces Private Rental").
export function eventLabel(ev) {
  const c = ev.ext?.contents || "";
  if (ev.ext?.event_type === "CalendarHold") return (field(c, "Hold") || String(ev.title || "").replace(/^Hold\s*-\s*/i, "")).trim() || "Hold";
  return field(c, "Program Package") || ev.title || "Program";
}
export const eventCategory = (ev) => field(ev.ext?.contents, "Category") || (ev.ext?.event_type === "CalendarHold" ? "Hold" : "");

// "2026-10-14T18:30:00" -> 18.5 (Central wall clock, as the fetcher writes it).
export const hourOf = (iso) => { const m = /T(\d{2}):(\d{2})/.exec(String(iso || "")); return m ? +m[1] + +m[2] / 60 : null; };
export const fmtHour = (h) => { const hh = Math.floor(h), mm = Math.round((h - hh) * 60), ap = hh >= 12 && hh < 24 ? "pm" : "am", h12 = hh % 12 === 0 ? 12 : hh % 12; return h12 + (mm ? ":" + String(mm).padStart(2, "0") : "") + ap; };

// One day's grid.
//   bookings : [{ courts:[...], start, end (hours), kind: "dssc"|"hold"|"tourn", label, detail }]
//   teams    : [{ team, blocks:[[s,e]], court (1-6|null), venue ("flex"|null) }]   (DS Elite)
//   scrims   : [{ start, end, teams:[...], court (1-6|null) }]                   (teams sharing a court)
// Returns { slots:[hour...], cells: { [courtId]: [cell per slot] }, free: { [courtId]: [[s,e]] }, issues:[...] }
// A cell is null (free) or { kind, label, detail, key, auto?, conflict? }.
export function buildCourtDay({ bookings = [], teams = [], scrims = [], reserved = [], startHour = 7, endHour = 22, step = 0.5, releaseHeld = false }) {
  const slots = []; for (let h = startHour; h < endHour - 1e-9; h += step) slots.push(Math.round(h * 100) / 100);
  const cells = Object.fromEntries(COURTS.map(c => [c.id, slots.map(() => null)]));
  const issues = [];
  const idx = (s, e) => slots.map((h, i) => (h < e - 1e-9 && h + step > s + 1e-9 ? i : -1)).filter(i => i >= 0);
  // Free for DS Elite: empty, or inside DS Elite's own reserved block.
  const openForDse = (court, i) => !cells[court][i] || cells[court][i].reserved;
  const put = (court, i, cell) => {
    const cur = cells[court][i];
    // A booking inside DS Elite's reserved block takes the cell and is flagged
    // (the in-house tournament is DS Elite's own, so it isn't a conflict).
    if (cur && cur.reserved) { cells[court][i] = cell.kind === "tourn" ? cell : { ...cell, conflict: true, also: [cur.label] }; return true; }
    if (cur) { cur.conflict = true; if (!cur.also) cur.also = []; cur.also.push(cell.label); return false; }
    cells[court][i] = cell; return true;
  };
  // 0. Standing DS Elite reservations (the Sunday Warehouse block).
  // Each held court carries what a "hide" of it would match (applyHides).
  // A moved block carries its original place (origin) and the change row (change).
  reserved.forEach((r, n) => { const o = r.origin || r; for (const c of r.courts) for (const i of idx(r.start, r.end)) cells[c][i] = { kind: "dse", label: r.label, detail: r.detail || "", key: "r" + n, reserved: true, hide: { kind: "dse", start: o.start, end: o.end, courts: r.origin ? o.courts : [c] }, change: r.change || null }; });
  // 1. Playbook bookings and the in-house tournament, exactly where they are.
  bookings.forEach((b, n) => {
    const o = b.origin || b;
    const hide = b.kind === "tourn" ? null : { kind: "booking", label: b.hideLabel || b.label, start: o.start, end: o.end, courts: o.courts };
    for (const c of b.courts) for (const i of idx(b.start, b.end)) put(c, i, { kind: b.kind, label: b.label, detail: b.detail || "", key: "b" + n, ref: b.ref || null, hide, change: b.change || null });
  });

  // 2. DS Elite: scrimmage pairs share one court; everyone else gets their own.
  const units = [];
  const scrimsOf = new Map(); // team -> [[start,end]...]
  scrims.forEach((s, n) => {
    const u = { label: (s.teams || []).join(" vs "), detail: "DS Elite scrimmage", start: s.start, end: s.end, court: s.court || null, venue: null, key: "s" + n, kind: "dse" };
    units.push(u); for (const t of s.teams || []) { if (!scrimsOf.has(t)) scrimsOf.set(t, []); scrimsOf.get(t).push([s.start, s.end]); }
  });
  teams.forEach((t, n) => (t.blocks || []).forEach(([s, e], k) => {
    // Hours a scrimmage covers are already on that scrimmage's court: take
    // every one of the team's scrimmages out of the block, keep what's left.
    let parts = [[s, e]];
    for (const [a, b] of scrimsOf.get(t.team) || []) parts = parts.flatMap(([x, y]) => (b <= x || a >= y) ? [[x, y]] : [[x, Math.max(x, a)], [Math.min(y, b), y]].filter(([p, q]) => q - p > 1e-9));
    // Sundays set a court per hour (courtAt); split the block wherever it changes.
    const at = (t.courtAt || []).filter(c => c.court >= 1 && c.court <= 6);
    const courtAt = (h) => (at.find(c => h >= c.s - 1e-9 && h < c.e - 1e-9) || {}).court || null;
    parts.forEach(([x, y], j) => {
      const cuts = [...new Set([x, y, ...at.flatMap(c => [c.s, c.e]).filter(h => h > x && h < y)])].sort((a, b) => a - b);
      const pieces = [];
      for (let m = 0; m < cuts.length - 1; m++) {
        const court = at.length ? courtAt(cuts[m]) : (t.court || null), last = pieces[pieces.length - 1];
        if (last && last.court === court && Math.abs(last.end - cuts[m]) < 1e-9) last.end = cuts[m + 1];
        else pieces.push({ start: cuts[m], end: cuts[m + 1], court });
      }
      pieces.forEach((pc, q) => units.push({ label: t.team, detail: "DS Elite practice", start: pc.start, end: pc.end, court: pc.court, venue: t.venue, key: "t" + n + "_" + k + "_" + j + "_" + q, kind: "dse" }));
    });
  }));
  const heldCells = COURTS.reduce((a, c) => a + cells[c.id].filter(x => x && x.reserved).length, 0);
  const teamCell = (u, extra = {}) => ({ kind: "dse", label: u.label, detail: u.detail, key: u.key, team: [u.label], ...extra });
  // Fixed courts first. Two teams set to the same court at the same time share
  // it ("13 Ruby + 14 Topaz"). A court taken by a class, rental or the
  // tournament sends the team to an open court instead, and says so.
  const fixed = units.filter(u => u.court >= 1 && u.court <= 6), loose = units.filter(u => !(u.court >= 1 && u.court <= 6));
  for (const u of fixed) {
    const c = "V" + u.court, span = idx(u.start, u.end);
    const blocker = span.map(i => cells[c][i]).find(x => x && !x.reserved && !x.team);
    if (blocker) {
      issues.push(`${u.label} is set to ${c.replace("V", "Court ")} at ${fmtHour(u.start)} but ${blocker.label} has it, so it's shown on an open court`);
      loose.push({ ...u, court: null, detail: u.detail + " · set to " + c.replace("V", "Court ") + " (taken)" });
      continue;
    }
    for (const i of span) {
      const cur = cells[c][i];
      cells[c][i] = !cur || cur.reserved ? teamCell(u)
        : cur.team.includes(u.label) ? cur
        : { ...cur, label: cur.label + " + " + u.label, team: [...cur.team, u.label], detail: "DS Elite practice · sharing the court", key: cur.key + "+" + u.key };
    }
  }
  loose.sort((a, b) => a.start - b.start || b.end - a.end || a.label.localeCompare(b.label));
  for (const u of loose) {
    const span = idx(u.start, u.end); if (!span.length) continue;
    const order = u.venue === "flex" ? [...FLEX, ...WAREHOUSE] : [...WAREHOUSE, ...FLEX];
    const court = order.find(c => span.every(i => openForDse(c, i)));
    if (court) { for (const i of span) cells[court][i] = teamCell(u, { detail: u.detail + (u.court === null && /taken/.test(u.detail) ? "" : " · court not set, placed on a free court"), auto: true }); continue; }
    // No single court free for the whole block: fill hour by hour, and say so.
    let placed = true;
    for (const i of span) { const c = order.find(x => openForDse(x, i)); if (c) cells[c][i] = teamCell(u, { detail: u.detail + " · court not set", key: u.key + "@" + i, auto: true }); else placed = false; }
    if (!placed) issues.push(`${u.label} ${fmtHour(u.start)}-${fmtHour(u.end)}: not enough free courts`);
  }

  // What DS Elite actually uses vs holds, in court-hours: a shared court counts once.
  const count = (f) => COURTS.reduce((a, c) => a + cells[c.id].filter(f).length, 0) * step;
  const usage = { used: count(x => x && x.team), held: heldCells * step, heldUnused: count(x => x && x.reserved) };
  // On the staff chart, held courts no team uses show as open: DS Elite won't
  // pay for them (Drew, Oct 26 2026). The members' page keeps them booked.
  if (releaseHeld) for (const c of COURTS) cells[c.id] = cells[c.id].map((x, i) => x && x.reserved
    ? { kind: "open", open: true, label: "Open", detail: "Held for DS Elite in Playbook, no team on it", key: "o" + x.key, hide: x.hide, change: x.change } : x);

  // Free windows per court.
  const free = {};
  for (const c of COURTS) {
    const w = []; let s = null;
    slots.forEach((h, i) => { if (!cells[c.id][i] || cells[c.id][i].open) { if (s == null) s = h; } else if (s != null) { w.push([s, h]); s = null; } });
    if (s != null) w.push([s, endHour]);
    free[c.id] = w;
  }
  return { slots, cells, free, issues, usage };
}

// ── Hidden and moved blocks (Drew, Oct 23 2026: "I want to be able to delete
// or hide blocks", then "move volleyball101 because it conflicts with the
// court"). court_block_hides rows take a booking or DS Elite's held courts off
// the chart (action "hide") or draw it somewhere else (action "move"), on one
// date or every week on that weekday from a date on.
//   rows: [{ id, action: "hide"|"move", kind: "booking"|"dse", label, start_h,
//            end_h, courts, to_courts, to_start_h, to_end_h, date, weekly }]
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;
const dowOf = (ymd) => new Date(ymd + "T12:00:00").getDay();
export const hidesOn = (ymd, hides = []) => hides.filter(h => h.date === ymd || (h.weekly && ymd >= h.date && dowOf(ymd) === dowOf(h.date)));
const hits = (h, x) => near(h.start_h, x.start) && near(h.end_h, x.end) && (x.courts || []).some(c => (h.courts || []).includes(c));
const courtWord = (cs) => (cs || []).map(c => c.replace("V", "")).join(" + ");
export const movedNote = (h) => "Moved in HQ from Court" + ((h.courts || []).length > 1 ? "s " : " ") + courtWord(h.courts) + ", " + fmtHour(h.start_h) + "-" + fmtHour(h.end_h);
// The day's bookings (raw, with their own labels) and DS Elite's held blocks,
// with whatever is hidden that day taken off and whatever is moved redrawn.
export function applyHides(ymd, { bookings = [], reserved = [] }, hides = []) {
  const on = hidesOn(ymd, hides);
  if (!on.length) return { bookings, reserved };
  const bk = on.filter(h => h.kind === "booking"), dk = on.filter(h => h.kind === "dse");
  const outB = [];
  for (const b of bookings) {
    const h = bk.find(x => String(x.label || "") === String(b.label || "") && hits(x, b));
    if (!h) { outB.push(b); continue; }
    if (h.action === "move") outB.push({ ...b, courts: h.to_courts, start: Number(h.to_start_h), end: Number(h.to_end_h), origin: { start: b.start, end: b.end, courts: b.courts }, change: h, category: [b.category, movedNote(h)].filter(Boolean).join(" · ") });
  }
  const outR = [];
  for (const r of reserved) {
    const keep = [];
    for (const c of r.courts) {
      const h = dk.find(x => hits(x, { ...r, courts: [c] }));
      if (!h) keep.push(c);
      else if (h.action === "move" && !outR.some(x => x.change === h)) outR.push({ ...r, courts: h.to_courts, start: Number(h.to_start_h), end: Number(h.to_end_h), origin: { start: r.start, end: r.end, courts: h.courts }, change: h, detail: movedNote(h) });
    }
    if (keep.length) outR.push({ ...r, courts: keep });
  }
  return { bookings: outB, reserved: outR };
}

// One line per change, the way Jonathan reads it to fix Playbook.
//   change: a court_block_hides row, or { action: "add", ...dssc_court_rentals row (start/end as hours) }
const fmtDate = (ymd) => new Date(ymd + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const weekdayName = (ymd) => new Date(ymd + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
const place = (cs, s, e) => "Court" + ((cs || []).length > 1 ? "s " : " ") + courtWord(cs) + ", " + fmtHour(Number(s)) + "-" + fmtHour(Number(e));
export function describeChange(c) {
  const when = c.weekly ? "Every " + weekdayName(c.date) + " from " + fmtDate(c.date) : fmtDate(c.date);
  const what = c.kind === "dse" ? "DS Elite courts" : (c.label || "Booking");
  if (c.action === "add") return { when, text: "Add " + what + (c.renter ? " (" + c.renter + ")" : "") + ": " + place(c.courts, c.start_h, c.end_h) };
  if (c.action === "move") return { when, text: what + ": move from " + place(c.courts, c.start_h, c.end_h) + " to " + place(c.to_courts, c.to_start_h, c.to_end_h) };
  return { when, text: (c.kind === "dse" ? "Release " : "Remove ") + what + ": " + place(c.courts, c.start_h, c.end_h) };
}
