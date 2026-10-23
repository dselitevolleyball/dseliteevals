// Court Availability data, server side. Shared by the admin route
// (api/court-availability.js) and the members' public page (api/courts-public.js).
import crypto from "crypto";
import { fetchPlaybookEvents, addDays } from "./playbook-calendar.js";
import { courtsForEvent, courtsForName, eventLabel, eventCategory, hourOf, buildCourtDay, dseBlock, COURTS } from "../../shared/courts.js";
import { loadDseCourtInputs } from "../../shared/court-inputs.js";
import { loadRentals, rentalWindows } from "./court-rentals.js";

// Playbook's public calendar resolved to courts, plus the court reservations the
// hourly registrations sync stores (court + date, no time; the booker's email
// domain says who has it).
export async function loadCourtBookings(sb, start, end) {
  const events = await fetchPlaybookEvents(start, end, { byId: true, allowEmpty: true, chunkDays: 7, timeoutMs: 40000 });
  const bookings = []; let offCourt = 0;
  for (const ev of events) {
    const courts = courtsForEvent(ev.ext);
    if (!courts.length) { offCourt++; continue; }
    const date = String(ev.start).slice(0, 10), endDate = String(ev.end).slice(0, 10);
    const s = hourOf(ev.start); let e = hourOf(ev.end);
    if (s == null || e == null) continue;
    if (endDate > date) e = 24;        // runs past midnight: this screen stops at the end of the day
    bookings.push({ id: ev.ext.id ?? null, kind: ev.ext.event_type === "CalendarHold" ? "hold" : "dssc", label: eventLabel(ev), category: eventCategory(ev), program: ev.ext.event_program ? String(ev.ext.event_program) : null, date, start: s, end: e, courts });
  }
  bookings.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);

  const reservations = [];
  const { data: rs, error } = await sb.from("dssc_participation").select("program, event_date, contact_id, created_at").eq("category", "facility").gte("event_date", start).lt("event_date", end);
  if (error) throw new Error("Reservations didn't load: " + error.message);
  const ids = [...new Set((rs || []).map(r => r.contact_id).filter(Boolean))];
  const { data: cs } = ids.length ? await sb.from("dssc_contacts").select("id, email").in("id", ids) : { data: [] };
  const emailOf = new Map((cs || []).map(c => [c.id, String(c.email || "").trim().toLowerCase()]));
  const domainOf = new Map([...emailOf].map(([id, e]) => [id, e.split("@")[1] || ""]));
  const PRIVATE = /^(gmail|yahoo|icloud|hotmail|outlook|aol|me|live|msn)\./;
  const KNOWN = { "acesintexas.com": "Aces", "aesaprepacademy.com": "AESA Prep Academy", "veritasacademy.net": "Veritas Academy", "4thquarterathlete.com": "4th Quarter Athlete" };
  // Renters who book from a personal address (Drew, Oct 14 2026: Tressa
  // Aleshire's Tue/Thu Flex rentals are DS Storm).
  const BY_EMAIL = { "tressaaleshire@gmail.com": "DS Storm" };
  const nice = (d) => KNOWN[d] || d.replace(/\.(com|net|org|edu|us)$/, "").replace(/[-_.]/g, " ").replace(/\b\w/g, x => x.toUpperCase());
  for (const r of rs || []) {
    const courts = courtsForName(r.program); if (!courts.length) continue;
    const d = domainOf.get(r.contact_id) || "";
    const internal = /^(drippingsportsclub\.com|dselitevolleyball\.com)$/.test(d);
    reservations.push({ date: r.event_date, courts, name: r.program, internal, who: internal ? "DSSC / DS Elite" : BY_EMAIL[emailOf.get(r.contact_id)] || (PRIVATE.test(d) || !d ? "Private rental" : nice(d)), synced: r.created_at || null });
  }
  // Rentals with their times (Playbook's Events export, uploaded on the screen).
  // DS Elite's own bookings, any day, are courts held for DS Elite: HQ's
  // practice schedule is the record of who is on them (teams are placed in
  // them by name), so they join the reservations, timed; everything else is a
  // booking.
  const rentals = await loadRentals(sb, start, end);
  for (const r of rentals) {
    if (!r.courts?.length) continue;
    if (r.internal) {
      reservations.push({ date: r.date, courts: r.courts, name: r.item || r.label, internal: true, who: "DSSC / DS Elite", start: r.start, end: r.end, timed: true });
      continue;
    }
    bookings.push({ id: "rental-" + r.id, kind: r.internal ? "dse" : "hold", label: r.label, category: (r.internal ? "DS Elite rental" : "Rental" + (r.renter && r.renter !== r.label ? " · " + r.renter : "")) + (r.note ? " · Note: " + r.note : ""), date: r.date, start: r.start, end: r.end, courts: r.courts, rental: true });
  }
  // For a date an upload covered, the export is the source of truth: a
  // reservation with no time that HQ already had when the file was exported is
  // in the file (drawn with its time), so it's "covered" and not listed as
  // "time?". One synced after the export - a court booked since - keeps its tag
  // until the next upload. (Matching renter or court names instead hid
  // bookings made after the export; review, Oct 14 2026.)
  const windows = await rentalWindows(sb, start, end);
  for (const res of reservations) {
    if (res.timed) continue;
    res.covered = windows.some(w => res.date >= w.from && res.date <= w.to && (!res.synced || Date.parse(res.synced) <= Date.parse(w.exportedAt)));
  }
  bookings.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  return { bookings, reservations, offCourt };
}

// ── Members' link ───────────────────────────────────────────────────────────
// One link for every open-gym family: an HMAC of a fixed label with the
// service-role key, so it can't be guessed. To retire a link that got passed
// around, bump LINK_VERSION (the old link stops working).
const LINK_VERSION = "v1";
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const courtsToken = (secret) => b64url(crypto.createHmac("sha256", secret).update("dssc-open-courts:" + LINK_VERSION).digest()).slice(0, 24);
export function courtsTokenOk(token, secret) {
  const want = Buffer.from(courtsToken(secret)), got = Buffer.from(String(token || ""));
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// What members see for each day: per court, open and booked times only - no
// program, renter or team names ever leave the server.
export const PUBLIC_START = 7, PUBLIC_END = 22;
export async function publicWeek(sb, start, days) {
  const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
  const [{ bookings, reservations }, dse] = await Promise.all([loadCourtBookings(sb, start, addDays(start, days)), loadDseCourtInputs(sb, dates)]);
  // A whole week with nothing on any court means Playbook didn't really answer:
  // fail (no cache) rather than tell families every court is open.
  // Rentals come from the upload, not Playbook, so they don't count here.
  if (!bookings.some(b => !b.rental)) throw new Error("Playbook returned no court bookings for the week");
  return dates.map(d => {
    const x = dse[d] || { teams: [], scrims: [], tourn: [] };
    const b = bookings.filter(k => k.date === d).map(k => ({ courts: k.courts, start: k.start, end: k.end, kind: k.kind, label: "x" })).concat(x.tourn || []);
    const g = buildCourtDay({ bookings: b, teams: x.teams, scrims: x.scrims, reserved: dseBlock(d, reservations), startHour: PUBLIC_START, endHour: PUBLIC_END });
    const sun = new Date(d + "T12:00:00").getDay() === 0;
    // A DS Elite team with no court set was placed on a guess. For those half
    // hours members see no open courts at all, rather than a guessed court.
    g.slots.forEach((h, i) => { if (COURTS.some(c => g.cells[c.id][i] && g.cells[c.id][i].auto)) COURTS.forEach(c => { if (!g.cells[c.id][i]) g.cells[c.id][i] = { kind: "dse", label: "x", key: "guess" }; }); });
    const open = Object.fromEntries(COURTS.map(c => { const w = []; let s0 = null; g.slots.forEach((h, i) => { if (!g.cells[c.id][i]) { if (s0 == null) s0 = h; } else if (s0 != null) { w.push([s0, h]); s0 = null; } }); if (s0 != null) w.push([s0, PUBLIC_END]); return [c.id, w]; }));
    const untimed = [...new Set(reservations.filter(r => r.date === d && !(sun && r.internal) && !r.timed && !r.covered).flatMap(r => r.courts))];
    return {
      date: d,
      courts: COURTS.map(c => {
        const busy = []; let s = null;
        g.slots.forEach((h, i) => { if (g.cells[c.id][i]) { if (s == null) s = h; } else if (s != null) { busy.push([s, h]); s = null; } });
        if (s != null) busy.push([s, PUBLIC_END]);
        return { id: c.id, label: c.label, building: c.building, open: open[c.id], busy, alsoReserved: untimed.includes(c.id) };
      }),
    };
  });
}
