// Court rentals from Playbook's Events export (Drew, Oct 14 2026: "is this
// helpful?" - events.csv, the staff-side list of every Rented Session with its
// date, times, sub location and renter). Shared by the upload on Court
// Availability (POST /api/court-availability) and
// scripts/import-court-rentals.mjs.
//
// An upload replaces this source's rows for the dates it was exported for (the
// uploader says; never narrower than the rows in the file), so a rental cancelled
// in Playbook drops out on the next upload - even an export with no rentals left
// clears its dates. New rows go in first under a batch id; only then are the
// older rows in that range removed, so a failed upload changes nothing. Each
// upload is recorded (dssc_court_rental_uploads) with its range and when the
// file was exported: for those dates the export is the source of truth.
import { rentalCourts, clockHours, rentalWho } from "../../shared/courts.js";

export const RENTAL_SOURCE = "playbook-events-csv";
const key = (k) => String(k || "").toLowerCase().replace(/[^a-z]/g, "");
const pick = (row, ...names) => { for (const [k, v] of Object.entries(row || {})) if (names.includes(key(k))) return String(v ?? "").trim(); return ""; };
const hhmm = (h) => String(Math.floor(h)).padStart(2, "0") + ":" + String(Math.round((h % 1) * 60)).padStart(2, "0");

// rows: the CSV parsed with a header row ({ Date, Locations, ... }).
// -> { rentals: [db rows], window: {from, to}, skipped: {type: n}, bad: [...], unplaced: [...] }
export function parseRentalRows(rows) {
  const rentals = [], skipped = {}, bad = [], unplaced = [];
  let from = null, to = null;
  for (const [i, row] of (rows || []).entries()) {
    const date = pick(row, "date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { if (Object.values(row || {}).some(v => String(v ?? "").trim())) bad.push({ line: i + 2, why: "no date" }); continue; }
    if (!from || date < from) from = date;
    if (!to || date > to) to = date;
    const type = pick(row, "eventtype");
    if (!/rented\s*session/i.test(type)) { skipped[type || "(blank)"] = (skipped[type || "(blank)"] || 0) + 1; continue; }
    const s = clockHours(pick(row, "starttime")), e = clockHours(pick(row, "endtime"));
    if (s == null || e == null || e <= s) { bad.push({ line: i + 2, date, why: "times don't read" }); continue; }
    const location = pick(row, "locations", "location"), sub = pick(row, "sublocations", "sublocation");
    const program = pick(row, "program"), details = pick(row, "eventdetails");
    const who = rentalWho({ program, details });
    const courts = rentalCourts(location, sub);
    const r = { date, start_time: hhmm(s), end_time: hhmm(e), courts, label: who.label, renter: who.person, item: who.item, internal: who.internal,
      location: location || null, sub_location: sub || null, program: program || null, note: pick(row, "eventnote") || null, source: RENTAL_SOURCE };
    if (!courts.length) unplaced.push({ date, time: r.start_time + "-" + r.end_time, label: r.label, location, sub });
    rentals.push(r);
  }
  return { rentals, window: from ? { from, to } : null, skipped, bad, unplaced };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
// range: { from, to } the export was made for (widened to the rows in it), and
// exportedAt: when the file came out of Playbook (the file's own timestamp).
// A file with no rentals in it needs the range: it clears those dates.
export async function importRentals(sb, rows, who, range = {}) {
  const p = parseRentalRows(rows);
  const hasRange = ISO.test(range.from || "") && ISO.test(range.to || "") && range.from <= range.to;
  if (!p.rentals.length && !hasRange) {
    if (!p.window) throw new Error("No dated rows in that file. Is it Playbook's Events export (events.csv)?");
    throw new Error("That file has no Rented Session rows" + (Object.keys(p.skipped).length ? " (only: " + Object.keys(p.skipped).join(", ") + ")" : "") + ".");
  }
  let from = hasRange ? range.from : p.window.from, to = hasRange ? range.to : p.window.to;
  if (p.window) { if (p.window.from < from) from = p.window.from; if (p.window.to > to) to = p.window.to; }
  if ((Date.parse(to) - Date.parse(from)) / 864e5 > 400) throw new Error("That date range is over a year; upload a shorter export.");
  const now = new Date().toISOString();
  const ex = Date.parse(range.exportedAt || "");
  const exportedAt = Number.isFinite(ex) && ex <= Date.now() + 60e3 && ex > Date.now() - 400 * 864e5 ? new Date(ex).toISOString() : now;
  const batch = "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  for (let i = 0; i < p.rentals.length; i += 500) {
    const { error } = await sb.from("dssc_court_rentals").insert(p.rentals.slice(i, i + 500).map(r => ({ ...r, batch, window_from: from, window_to: to, imported_by: who || null, imported_at: now })));
    if (error) { await sb.from("dssc_court_rentals").delete().eq("batch", batch); throw new Error("Couldn't save the rentals: " + error.message); }
  }
  // Older rows in the range go. Only rows imported before this upload: if two
  // uploads overlap in time, the later one's rows survive instead of each
  // deleting the other's.
  const { data: old, error: oldErr } = await sb.from("dssc_court_rentals").delete().eq("source", RENTAL_SOURCE).gte("date", from).lte("date", to).neq("batch", batch).lt("imported_at", now).select("id");
  if (oldErr) throw new Error("Saved, but the older rentals for those dates weren't cleared: " + oldErr.message);
  const replaced = (old || []).length;
  const { error: upErr } = await sb.from("dssc_court_rental_uploads").insert({ batch, window_from: from, window_to: to, exported_at: exportedAt, imported_at: now, imported_by: who || null, added: p.rentals.length, replaced });
  if (upErr) throw new Error("Saved, but the upload wasn't recorded: " + upErr.message);
  return { added: p.rentals.length, replaced, window: { from, to }, exportedAt, skipped: p.skipped, bad: p.bad, unplaced: p.unplaced };
}

// Rentals between start (inclusive) and end (exclusive), as hours.
export async function loadRentals(sb, start, end) {
  const { data, error } = await sb.from("dssc_court_rentals").select("id, date, start_time, end_time, courts, label, renter, item, internal").gte("date", start).lt("date", end);
  if (error) throw new Error("Rentals didn't load: " + error.message);
  return (data || []).map(r => ({ ...r, start: clockHours(r.start_time), end: clockHours(r.end_time) })).filter(r => r.start != null && r.end != null && r.end > r.start);
}

// Every upload's date range and export time, overlapping start..end (or all).
// For a date inside a range the export is the source of truth.
export async function rentalWindows(sb, start, end) {
  let q = sb.from("dssc_court_rental_uploads").select("window_from, window_to, exported_at, imported_at, imported_by").order("imported_at", { ascending: false });
  if (start) q = q.gte("window_to", start);
  if (end) q = q.lt("window_from", end);
  const { data, error } = await q.limit(500);
  if (error) throw new Error("Rental uploads didn't load: " + error.message);
  return (data || []).map(u => ({ from: u.window_from, to: u.window_to, exportedAt: u.exported_at, at: u.imported_at, by: u.imported_by }));
}

// For the screen: the latest upload, and the upload ranges that touch these dates.
export async function rentalsMeta(sb, start, end) {
  const [{ data: last }, windows] = await Promise.all([
    sb.from("dssc_court_rental_uploads").select("imported_at, imported_by, window_to").order("imported_at", { ascending: false }).limit(1),
    rentalWindows(sb, start, end),
  ]);
  if (!last?.length) return { windows };
  return { at: last[0].imported_at, by: last[0].imported_by, windows: windows.map(w => ({ from: w.from, to: w.to })) };
}
