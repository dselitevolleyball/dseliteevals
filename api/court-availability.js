// Court availability (Drew, Oct 12 2026): every booking Playbook's public
// calendar has on the six courts, for a day or a week, resolved to courts,
// plus the court reservations Playbook holds (court + date, no time).
//
//   GET /api/court-availability?start=YYYY-MM-DD&days=1..14
//   -> { ok, start, end, bookings:[{ id, kind:"dssc"|"hold", label, category,
//        date, start, end, courts:[...] }], reservations:[{ date, courts, who,
//        internal, name }], offCourt: n }
//   GET /api/court-availability?link=1  -> { url } the members' public link
//
// Times are Central wall clock in hours (18.5 = 6:30pm). Classes on no court
// (Reach Performance) and holds on a staff resource only are counted in
// offCourt and left out.
// Auth: signed-in owner, approved admin, or DSSC director (Bearer access token).
import { createClient } from "@supabase/supabase-js";
import { addDays, centralToday } from "./_lib/playbook-calendar.js";
import { loadCourtBookings, courtsToken } from "./_lib/court-data.js";
import { appOrigin } from "../shared/app-origin.js";

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
  res.setHeader("Cache-Control", "no-store");
  if (url.searchParams.get("link") === "1") return res.status(200).json({ ok: true, url: appOrigin(req) + "/courts?t=" + courtsToken(SUPABASE_SERVICE_ROLE_KEY) });

  const start = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("start") || "") ? url.searchParams.get("start") : centralToday();
  const days = Math.min(14, Math.max(1, Number(url.searchParams.get("days")) || 1));
  const end = addDays(start, days);
  try {
    const { bookings, reservations, offCourt } = await loadCourtBookings(sb, start, end);
    return res.status(200).json({ ok: true, start, end, bookings, reservations, offCourt });
  } catch (e) { return res.status(502).json({ error: "Couldn't load court data: " + e.message }); }
}
