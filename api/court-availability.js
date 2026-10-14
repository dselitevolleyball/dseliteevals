// Court availability (Drew, Oct 12 2026): every booking Playbook's public
// calendar has on the six courts, for a day or a week, resolved to courts,
// plus the court reservations Playbook holds (court + date, no time).
//
//   GET /api/court-availability?start=YYYY-MM-DD&days=1..14
//   -> { ok, start, end, bookings:[{ id, kind:"dssc"|"hold", label, category,
//        date, start, end, courts:[...] }], reservations:[{ date, courts, who,
//        internal, name }], offCourt: n }
//   GET /api/court-availability?link=1  -> { url } the members' public link
// Each DSSC booking that is a Clinics & Camps class also carries signups (the
// registrations the board counts) so empty classes show; null = not tracked.
// signups is for that one session (Playbook sells most classes by the date),
// plus anyone registered for the whole program. clinicId/sessionId open the card.
//
// Times are Central wall clock in hours (18.5 = 6:30pm). Classes on no court
// (Reach Performance) and holds on a staff resource only are counted in
// offCourt and left out.
// Auth: signed-in owner, approved admin, or DSSC director (Bearer access token).
import { createClient } from "@supabase/supabase-js";
import { addDays, centralToday } from "./_lib/playbook-calendar.js";
import { loadCourtBookings, courtsToken } from "./_lib/court-data.js";
import { appOrigin } from "../shared/app-origin.js";
import { parseClock } from "../shared/dssc-clinics.js";

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
    if (!ok) { const { data: c } = await sb.from("coaches").select("is_admin, is_approved, dssc_role").ilike("email", email).maybeSingle(); ok = !!(c && c.is_approved && (c.is_admin || c.dssc_role === "admin")); }
    if (!ok) return res.status(403).json({ error: "Admins and DSSC directors only" });
  }

  const url = new URL(req.url, "https://x");
  res.setHeader("Cache-Control", "no-store");
  // The link families get: the DSSC site (www.drippingsportsclub.com) proxies
  // /opengym to this app's /courts?t=. "direct" is the same page on this domain.
  if (url.searchParams.get("link") === "1") return res.status(200).json({ ok: true, url: "https://www.drippingsportsclub.com/opengym", direct: appOrigin(req) + "/courts?t=" + courtsToken(SUPABASE_SERVICE_ROLE_KEY) });

  const start = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("start") || "") ? url.searchParams.get("start") : centralToday();
  const days = Math.min(14, Math.max(1, Number(url.searchParams.get("days")) || 1));
  const end = addDays(start, days);
  try {
    const { bookings, reservations, offCourt } = await loadCourtBookings(sb, start, end);
    const rosterAt = await attachSignups(sb, bookings);
    return res.status(200).json({ ok: true, start, end, bookings, reservations, offCourt, rosterAt });
  } catch (e) { return res.status(502).json({ error: "Couldn't load court data: " + e.message }); }
}


// Every row, not just Supabase's first 1,000 per request (dssc_pod_roster
// passed 1,000 rows in Oct 2026). build() returns a fresh query each call.
async function fetchAll(build, page = 1000) {
  const out = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await build().order("id").range(from, from + page - 1);
    if (error) return { data: out.length ? out : null, error };
    out.push(...(data || []));
    if (!data || data.length < page) return { data: out, error: null };
  }
}

// Same numbers as the Clinics & Camps board: dssc_pod_roster rows per session,
// plus rows on the whole program. The class is the clinic whose source_ref is
// the Playbook program, the session the one on that date at that start time.
async function attachSignups(sb, bookings) {
  const progs = [...new Set(bookings.map(b => b.program).filter(Boolean))];
  if (!progs.length) return null;
  const [{ data: clinics, error: e1 }, { data: sync }] = await Promise.all([
    sb.from("dssc_clinics").select("id, source_ref, sessions").eq("source", "playbook").in("source_ref", progs),
    sb.from("dssc_sync").select("registrations_at").eq("id", 1).maybeSingle(),
  ]);
  if (e1 || !clinics?.length) return sync?.registrations_at || null;
  const { data: roster, error: e2 } = await fetchAll(() => sb.from("dssc_pod_roster").select("id, clinic_id, session_id").in("clinic_id", clinics.map(c => c.id)));
  if (e2) return sync?.registrations_at || null;   // unknown, not zero
  const n = {};
  for (const r of roster || []) { const k = r.clinic_id + "|" + (r.session_id || "*"); n[k] = (n[k] || 0) + 1; }
  const byProg = new Map(clinics.map(c => [c.source_ref, c]));
  for (const b of bookings) {
    const c = b.program && byProg.get(b.program); if (!c) continue;
    const s = (Array.isArray(c.sessions) ? c.sessions : []).find(x => x?.date === b.date && Math.abs((parseClock(x.start_time) ?? -9) - b.start) < 0.02);
    if (!s) continue;
    b.signups = (n[c.id + "|" + s.id] || 0) + (n[c.id + "|*"] || 0);
    b.clinicId = c.id; b.sessionId = s.id;
  }
  return sync?.registrations_at || null;
}
