// Vercel Cron (every 15 min): text DSSC staff who have been clocked in for 4
// hours, in case they forgot to clock out (Drew, 13 Oct 2026). One text per
// shift (dssc_staff_shifts.reminder_sent_at). If they ignore it, they - or an
// administrator in Staff Hours - fix the clock-out time in the app later.
//
// Auth: Vercel Cron bearer CRON_SECRET (or ?token=), or the service-role key.
// ?dry=1 lists who would be texted.

import { createClient } from "@supabase/supabase-js";
import { sendOneSms, normalizePhone, twilioReady } from "./_lib/sms.js";

const DSSC_APP_URL = "https://www.drippingsportsclub.com/hq";
const HOURS = 4;
const nrm = (v) => String(v || "").trim().toLowerCase();

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET } = process.env;
  const q = (() => { try { return new URL(req.url, "https://x").searchParams; } catch { return new URLSearchParams(); } })();
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const okAuth = (CRON_SECRET && (bearer === CRON_SECRET || q.get("token") === CRON_SECRET)) || (SUPABASE_SERVICE_ROLE_KEY && bearer === SUPABASE_SERVICE_ROLE_KEY);
  if (!okAuth) return res.status(403).json({ error: "Forbidden" });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const cutoff = new Date(Date.now() - HOURS * 3600000).toISOString();
  const { data: open, error } = await sb.from("dssc_staff_shifts").select("*").is("clock_out", null).is("reminder_sent_at", null).lte("clock_in", cutoff);
  if (error) return res.status(500).json({ error: error.message });
  if (!open?.length) return res.status(200).json({ ok: true, reminded: 0 });

  const [{ data: people }, { data: roster }] = await Promise.all([
    sb.from("dssc_people").select("email, first_name, last_name, phone"),
    sb.from("coach_roster").select("email, first_name, last_name, phone"),
  ]);
  const phoneOf = (email) => { const p = (people || []).find(x => nrm(x.email) === nrm(email) && x.phone) || (roster || []).find(x => nrm(x.email) === nrm(email) && x.phone); return p ? { phone: normalizePhone(p.phone), name: `${p.first_name || ""} ${p.last_name || ""}`.trim() } : null; };

  const out = [];
  for (const s of open) {
    const who = phoneOf(s.person_email);
    const since = new Date(s.clock_in).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
    const text = `Hi {first}, you've been clocked in at DSSC since ${since} (4 hours). Still working? If you're done, clock out here - and if you left earlier, enter when you actually stopped:\n${DSSC_APP_URL}/?view=staffhours`;
    if (q.get("dry") === "1") { out.push({ who: s.person_name, phone: who?.phone || null, text }); continue; }
    let status = "no phone";
    if (who?.phone && twilioReady("dssc")) {
      try { await sendOneSms(sb, { to: who.phone, brand: "dssc", name: who.name || s.person_name, kind: "staff" }, text, { sent_by_label: "DSSC 4-hour clock reminder" }); status = "texted"; }
      catch (e) { status = "failed: " + e.message; }
    }
    // Marked either way, so a missing phone doesn't retry every 15 minutes.
    await sb.from("dssc_staff_shifts").update({ reminder_sent_at: new Date().toISOString() }).eq("id", s.id);
    out.push({ who: s.person_name, status });
  }
  return res.status(200).json({ ok: true, reminded: out.length, out });
}
