// Every hour, ten minutes before the registrations pull: bring the DSSC clinic
// schedule in from Playbook's public calendar, so a class never has to wait
// for someone to click the sync bookmark before its sign-ups can attach.
//
// Same merge as the bookmarklet (api/_lib/dssc-clinics-sync.js): new sessions
// added, times refreshed, coaches/plans kept, and future classes Playbook no
// longer lists removed — but only inside the window actually pulled, which is
// passed in explicitly so a thin month can't widen the prune.
//
// Window: today through ~4 months out, Central. Playbook publishes a season
// at a time, so that reaches everything on the books; the socket takes about
// 35s for it, which is why this route gets a longer maxDuration in vercel.json.
//
// Auth: Vercel Cron `Authorization: Bearer <CRON_SECRET>`; also ?token=.
// Query: ?dry=1 — pull and parse, write nothing.   ?days=N — window length.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET.

import { createClient } from "@supabase/supabase-js";
import { syncClinics, parsePlaybookEvents } from "./_lib/dssc-clinics-sync.js";
import { fetchPlaybookEvents, centralToday, addDays } from "./_lib/playbook-calendar.js";
import { appOrigin } from "../shared/app-origin.js";

const NOTIFY = ["drew@dselitevolleyball.com", "hunterhaleysc10@gmail.com", "hunter@drippingsportsclub.com"];

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET } = process.env;
  const url = (() => { try { return new URL(req.url, "https://x"); } catch { return null; } })();
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!CRON_SECRET || (bearer !== CRON_SECRET && (url?.searchParams.get("token") || "") !== CRON_SECRET)) return res.status(403).json({ error: "Forbidden" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const dry = url?.searchParams.get("dry") === "1";
  const days = Math.min(200, Math.max(7, Number(url?.searchParams.get("days")) || 120));
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: prev } = await sb.from("dssc_sync").select("calendar_error").eq("id", 1).maybeSingle();
  const now = new Date().toISOString();

  const notify = async (subject, body) => {
    try { await fetch(appOrigin(req) + "/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skipPush: true, subject, body, recipients: NOTIFY, sentBy: "Playbook sync", source: "playbook-calendar" }) }); } catch { /* best effort */ }
  };
  const fail = async (msg) => {
    if (!dry) {
      await sb.from("dssc_sync").upsert({ id: 1, calendar_error: msg, calendar_error_at: now }, { onConflict: "id" });
      // The same failure every hour is noise; a new one is worth a note.
      if (prev?.calendar_error !== msg) await notify("Playbook calendar pull failed", msg + "\n\nIt runs every hour. Until it recovers, the 🔄 Sync DSSC clinics bookmark on the Clinics page still works.");
    }
    return res.status(502).json({ ok: false, error: msg });
  };

  const start = centralToday(), end = addDays(start, days);
  let events;
  try { events = await fetchPlaybookEvents(start, end); }
  catch (e) { return fail(e.message); }

  if (dry) {
    const progs = Object.values(parsePlaybookEvents(events));
    return res.status(200).json({ ok: true, dry: true, window: { start, end }, events: events.length, volleyballPrograms: progs.length,
      programs: progs.map(p => ({ name: p.name, sessions: p.sessions.length, first: p.sessions[0]?.date, last: p.sessions[p.sessions.length - 1]?.date })) });
  }
  try {
    const summary = await syncClinics(sb, events, { syncedBy: "playbook auto-pull", window: { min: start, max: addDays(end, -1) } });
    await sb.from("dssc_sync").upsert({ id: 1, calendar_error: null, calendar_error_at: null }, { onConflict: "id" });
    return res.status(200).json({ ok: true, window: { start, end }, events: events.length, ...summary });
  } catch (e) { return fail("Sync: " + e.message); }
}
