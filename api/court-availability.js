// Court availability (Drew, Oct 12 2026): every booking Playbook's public
// calendar has on the six courts, for a day or a week, resolved to courts.
//
//   GET /api/court-availability?start=YYYY-MM-DD&days=1..14
//   -> { ok, start, end, bookings:[{ id, kind:"dssc"|"hold", label, category,
//        date, start, end, courts:[...] }], offCourt: n }
//
// Times are Central wall clock in hours (18.5 = 6:30pm). Classes on no court
// (Reach Performance) and holds on a staff resource only are counted in
// offCourt and left out. Rentals booked as Playbook reservations are not on
// the public calendar, so they can't show here.
// Auth: signed-in owner, approved admin, or DSSC director (Bearer access token).
import { createClient } from "@supabase/supabase-js";
import { fetchPlaybookEvents, addDays, centralToday } from "./_lib/playbook-calendar.js";
import { courtsForEvent, eventLabel, eventCategory, hourOf } from "../shared/courts.js";

const OWNERS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];
const DIRECTORS = ["hunterhaleysc10@gmail.com", "hunter@drippingsportsclub.com"];

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (bearer !== SUPABASE_SERVICE_ROLE_KEY) {
    if (!bearer) return res.status(401).json({ error: "Not signed in" });
    const { data: { user } = {} } = await sb.auth.getUser(bearer).catch(() => ({ data: {} }));
    const email = (user?.email || "").trim().toLowerCase();
    if (!email) return res.status(401).json({ error: "Not signed in" });
    let ok = OWNERS.includes(email) || DIRECTORS.includes(email);
    if (!ok) { const { data: c } = await sb.from("coaches").select("is_admin, is_approved").ilike("email", email).maybeSingle(); ok = !!(c && c.is_approved && c.is_admin); }
    if (!ok) return res.status(403).json({ error: "Admins and DSSC directors only" });
  }

  const url = new URL(req.url, "https://x");
  const start = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("start") || "") ? url.searchParams.get("start") : centralToday();
  const days = Math.min(14, Math.max(1, Number(url.searchParams.get("days")) || 1));
  const end = addDays(start, days);
  let events;
  try { events = await fetchPlaybookEvents(start, end, { byId: true, allowEmpty: true, chunkDays: 7, timeoutMs: 40000 }); }
  catch (e) { return res.status(502).json({ error: "Couldn't reach Playbook: " + e.message }); }

  const bookings = []; let offCourt = 0;
  for (const ev of events) {
    const courts = courtsForEvent(ev.ext);
    if (!courts.length) { offCourt++; continue; }
    const date = String(ev.start).slice(0, 10), endDate = String(ev.end).slice(0, 10);
    const s = hourOf(ev.start); let e = hourOf(ev.end);
    if (s == null || e == null) continue;
    if (endDate > date) e = 24;        // runs past midnight: this screen stops at the end of the day
    bookings.push({ id: ev.ext.id ?? null, kind: ev.ext.event_type === "CalendarHold" ? "hold" : "dssc", label: eventLabel(ev), category: eventCategory(ev), date, start: s, end: e, courts });
  }
  bookings.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true, start, end, bookings, offCourt });
}
