// Court availability (Drew, Oct 12 2026): every booking Playbook's public
// calendar has on the six courts, for a day or a week, resolved to courts,
// plus the court reservations Playbook holds (court + date, no time).
//
//   GET /api/court-availability?start=YYYY-MM-DD&days=1..14
//   -> { ok, start, end, bookings:[{ id, kind:"dssc"|"hold", label, category,
//        date, start, end, courts:[...] }], reservations:[{ date, courts, who,
//        internal, name }], offCourt: n }
//        + hides: court_block_hides rows that can touch the range (shared/courts.js applyHides)
//   GET /api/court-availability?usage=YYYY-MM -> { days:[{ date, teams, used, held, heldUnused }], total }
//        DS Elite court-hours in use vs held in Playbook, per day (what DS Elite owes DSSC)
//   GET /api/court-availability?link=1  -> { url } the members' public link
//   POST { action: "hide", kind: "booking"|"dse", label, start, end, courts, date, weekly }
//        -> { id }  takes a block off the chart (one date, or every week on that weekday)
//   POST { action: "unhide", id } -> shows it again
//   POST { action: "import-rentals", rows: [...] } -> Playbook's Events export
//        (events.csv, parsed with its header row), from/to = the dates it was
//        exported for, exportedAt = the file's timestamp; replaces the timed
//        rentals in that range:
//        { added, replaced, window, skipped, unplaced }
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
import { loadCourtBookings, courtsToken, loadHides } from "./_lib/court-data.js";
import { COURTS, describeChange, clockHours, buildCourtDay, dseBlock, applyHides } from "../shared/courts.js";
import { loadDseCourtInputs } from "../shared/court-inputs.js";
import { sendMail, emailShell } from "./_lib/projects.js";
import { DSSC_DIRECTORS } from "../shared/dssc-directors.js";
import { importRentals, rentalsMeta } from "./_lib/court-rentals.js";
import { appOrigin } from "../shared/app-origin.js";
import { parseClock } from "../shared/dssc-clinics.js";

const OWNERS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];
const DIRECTORS = ["hunterhaleysc10@gmail.com", "hunter@drippingsportsclub.com"];

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  let who = "HQ";
  if (bearer !== SUPABASE_SERVICE_ROLE_KEY) {
    if (!bearer) return res.status(401).json({ error: "Not signed in" });
    const { data: { user } = {} } = await sb.auth.getUser(bearer).catch(() => ({ data: {} }));
    const email = (user?.email || "").trim().toLowerCase();
    if (!email) return res.status(401).json({ error: "Not signed in" });
    let ok = OWNERS.includes(email) || DIRECTORS.includes(email);
    if (!ok) { const { data: c } = await sb.from("coaches").select("is_admin, is_approved, dssc_role").ilike("email", email).maybeSingle(); ok = !!(c && c.is_approved && (c.is_admin || c.dssc_role === "admin")); }
    if (!ok) return res.status(403).json({ error: "Admins and DSSC directors only" });
    who = email;
  }

  if (req.method === "POST") {
    let body = req.body;
    try { body = typeof body === "string" ? JSON.parse(body) : (body || {}); } catch { return res.status(400).json({ error: "Invalid JSON" }); }
    // Hide or move a block (one date, or every week on that weekday from the date on).
    const ids = COURTS.map(c => c.id);
    const toPlace = (m) => m && { to_courts: [...new Set((m.courts || []).filter(c => ids.includes(c)))], to_start_h: Number(m.start), to_end_h: Number(m.end) };
    const badPlace = (t) => !t.to_courts.length || !(t.to_end_h > t.to_start_h) || t.to_start_h < 6 || t.to_end_h > 23;
    if (body.action === "hide") {
      const move = toPlace(body.move);
      if (move && badPlace(move)) return res.status(400).json({ error: "Pick at least one court and an end after the start" });
      const row = { action: move ? "move" : "hide", ...(move || {}), kind: body.kind, label: body.kind === "booking" ? String(body.label || "").slice(0, 200) : null, start_h: Number(body.start), end_h: Number(body.end),
        courts: [...new Set((body.courts || []).filter(c => ids.includes(c)))], date: body.date, weekly: !!body.weekly, created_by: who };
      if (!["booking", "dse"].includes(row.kind) || !/^\d{4}-\d{2}-\d{2}$/.test(row.date || "") || !(row.end_h > row.start_h) || !row.courts.length || (row.kind === "booking" && !row.label))
        return res.status(400).json({ error: "That block can't be hidden" });
      const { data, error } = await sb.from("court_block_hides").insert(row).select("id").single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true, id: data.id });
    }
    // Change where a moved block goes (not yet sent to Playbook, or sent - it's sent again).
    if (body.action === "edit-move") {
      const move = toPlace(body.move);
      if (!move || badPlace(move)) return res.status(400).json({ error: "Pick at least one court and an end after the start" });
      const { error } = await sb.from("court_block_hides").update({ ...move, sent_at: null, sent_to: null }).eq("id", Number(body.id)).eq("action", "move");
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    // The change log for Playbook: what HQ has changed that Jonathan hasn't been sent.
    if (body.action === "changes") return res.status(200).json({ ok: true, ...(await playbookChanges(sb)) });
    if (body.action === "send-changes") {
      const { pending } = await playbookChanges(sb);
      const pick = Array.isArray(body.keys) ? pending.filter(c => body.keys.includes(c.key)) : pending;
      if (!pick.length) return res.status(400).json({ error: "Nothing new to send" });
      const to = DSSC_DIRECTORS.find(d => /jonathan/i.test(d.name))?.email || "jonathan@drippingsportsclub.com";
      const sender = DSSC_DIRECTORS.find(d => d.email === who)?.name || (who === "HQ" ? "Drew Rose" : who);
      const note = String(body.note || "").trim().slice(0, 2000);
      const esc = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;");
      const lines = pick.map(c => describeChange(c));
      const text = "Hi Jonathan,\n\nPlease make these changes in Playbook:\n\n" + lines.map(l => "- " + l.when + ": " + l.text).join("\n") + (note ? "\n\n" + note : "") + "\n\nThanks,\n" + sender;
      const html = emailShell("<p>Hi Jonathan,</p><p>Please make these changes in Playbook:</p><ul>" + lines.map(l => "<li><b>" + esc(l.when) + ":</b> " + esc(l.text) + "</li>").join("") + "</ul>" + (note ? "<p>" + esc(note).replace(/\n/g, "<br>") + "</p>" : "") + "<p>Thanks,<br>" + esc(sender) + "</p>");
      const replyTo = /@/.test(who) ? who : "drew@drippingsportsclub.com";
      const subject = "Playbook changes: " + pick.length + " court change" + (pick.length === 1 ? "" : "s");
      const sent = await sendMail({ to, subject, html, text, replyTo });
      if (!sent.ok) return res.status(502).json({ error: "Email didn't send: " + sent.error });
      await sendMail({ to: replyTo, subject: "Copy: " + subject, html, text });
      const now = new Date().toISOString();
      const hideIds = pick.filter(c => c.source === "change").map(c => c.id), rentIds = pick.filter(c => c.source === "rental").map(c => c.id);
      if (hideIds.length) await sb.from("court_block_hides").update({ sent_at: now, sent_to: to }).in("id", hideIds);
      if (rentIds.length) await sb.from("dssc_court_rentals").update({ playbook_sent_at: now }).in("id", rentIds);
      return res.status(200).json({ ok: true, sent: pick.length, to });
    }
    if (body.action === "unhide") {
      const { error } = await sb.from("court_block_hides").delete().eq("id", Number(body.id));
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    if (body.action !== "import-rentals" || !Array.isArray(body.rows)) return res.status(400).json({ error: "Unknown request" });
    if (body.rows.length > 10000) return res.status(413).json({ error: "That file is too big; export a few months at a time." });
    try { return res.status(200).json({ ok: true, ...(await importRentals(sb, body.rows, who, { from: body.from, to: body.to, exportedAt: body.exportedAt })) }); }
    catch (e) { return res.status(400).json({ error: e.message }); }
  }

  const url = new URL(req.url, "https://x");
  res.setHeader("Cache-Control", "no-store");
  // The link families get: the DSSC site (www.drippingsportsclub.com) proxies
  // /opengym to this app's /courts?t=. "direct" is the same page on this domain.
  if (url.searchParams.get("link") === "1") return res.status(200).json({ ok: true, url: "https://www.drippingsportsclub.com/opengym", direct: appOrigin(req) + "/courts?t=" + courtsToken(SUPABASE_SERVICE_ROLE_KEY) });

  // DS Elite's court use for a month, per day: court-hours its teams are on vs
  // held in Playbook. What DS Elite owes DSSC is the used hours (Drew, Oct 26 2026).
  const um = url.searchParams.get("usage");
  if (um) {
    if (!/^\d{4}-\d{2}$/.test(um)) return res.status(400).json({ error: "usage=YYYY-MM" });
    const first = um + "-01", [yy, mm] = um.split("-").map(Number), n = new Date(yy, mm, 0).getDate();
    const dates = Array.from({ length: n }, (_, i) => addDays(first, i)), end = addDays(first, n);
    try {
      const bookings = [], reservations = [];
      for (let s0 = first; s0 < end; s0 = addDays(s0, 14)) { const e0 = addDays(s0, 14) < end ? addDays(s0, 14) : end; const r = await loadCourtBookings(sb, s0, e0); bookings.push(...r.bookings); reservations.push(...r.reservations); }
      const [dse, hides] = await Promise.all([loadDseCourtInputs(sb, dates), loadHides(sb, first, end)]);
      const days = dates.map(d => {
        const x = dse[d] || { teams: [], scrims: [], tourn: [] };
        const shown = applyHides(d, { bookings: bookings.filter(b => b.date === d), reserved: dseBlock(d, reservations) }, hides);
        const g = buildCourtDay({ bookings: shown.bookings.map(b => ({ courts: b.courts, start: b.start, end: b.end, kind: b.kind, label: b.label })).concat(x.tourn || []), teams: x.teams, scrims: x.scrims, reserved: shown.reserved });
        return { date: d, teams: x.teams.length, cancelled: x.cancelled || null, ...g.usage };
      });
      const total = days.reduce((a, d) => ({ used: a.used + d.used, held: a.held + d.held, heldUnused: a.heldUnused + d.heldUnused }), { used: 0, held: 0, heldUnused: 0 });
      return res.status(200).json({ ok: true, month: um, days, total });
    } catch (e) { return res.status(502).json({ error: "Couldn't add up the month: " + e.message }); }
  }

  const start = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("start") || "") ? url.searchParams.get("start") : centralToday();
  const days = Math.min(14, Math.max(1, Number(url.searchParams.get("days")) || 1));
  const end = addDays(start, days);
  try {
    const { bookings, reservations, offCourt } = await loadCourtBookings(sb, start, end);
    const [rosterAt, rentals, hides] = await Promise.all([attachSignups(sb, bookings), rentalsMeta(sb, start, end).catch(() => null), loadHides(sb, start, end)]);
    return res.status(200).json({ ok: true, start, end, bookings, reservations, offCourt, rosterAt, rentals, hides });
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

// Everything HQ has changed on the courts that Playbook should match: hides and
// moves (court_block_hides) and rentals added in HQ (dssc_court_rentals with
// source "hq"). pending = not sent to Jonathan yet; sent = the last 20 that were.
async function playbookChanges(sb) {
  const [{ data: ch }, { data: rent }] = await Promise.all([
    sb.from("court_block_hides").select("id, action, kind, label, start_h, end_h, courts, to_courts, to_start_h, to_end_h, date, weekly, created_by, created_at, sent_at, sent_to").order("date"),
    sb.from("dssc_court_rentals").select("id, date, start_time, end_time, courts, label, renter, imported_by, imported_at, playbook_sent_at").eq("source", "hq").order("date"),
  ]);
  const all = [
    ...(ch || []).map(c => ({ ...c, key: "c" + c.id, source: "change", start_h: Number(c.start_h), end_h: Number(c.end_h), to_start_h: c.to_start_h == null ? null : Number(c.to_start_h), to_end_h: c.to_end_h == null ? null : Number(c.to_end_h) })),
    ...(rent || []).map(r => ({ id: r.id, key: "r" + r.id, source: "rental", action: "add", kind: "booking", label: r.label, renter: r.renter, courts: r.courts, start_h: clockHours(r.start_time), end_h: clockHours(r.end_time), date: r.date, weekly: false, created_by: r.imported_by, created_at: r.imported_at, sent_at: r.playbook_sent_at })),
  ].map(c => ({ ...c, line: describeChange(c) }));
  return { pending: all.filter(c => !c.sent_at), sent: all.filter(c => c.sent_at).sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at))).slice(0, 20) };
}
