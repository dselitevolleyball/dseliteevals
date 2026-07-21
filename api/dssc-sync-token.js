// Serves the DSSC sync secret to an authenticated admin/director so the app can
// build the one-click "Sync DSSC clinics" bookmarklet without ever putting the
// secret in client source. GET with a Supabase session token (Bearer).
//
// Auth: owner email, a DSSC director email, or coaches.is_admin+is_approved.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DSSC_SYNC_SECRET (or CRON_SECRET).

import { createClient } from "@supabase/supabase-js";

const OWNER_EMAILS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];
const DIRECTOR_EMAILS = ["hunterhaleysc10@gmail.com"];

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DSSC_SYNC_SECRET, CRON_SECRET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const secret = DSSC_SYNC_SECRET || CRON_SECRET;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return res.status(401).json({ error: "Not signed in" });
  const { data: { user } = {} } = await supabase.auth.getUser(bearer).catch(() => ({ data: {} }));
  const email = (user?.email || "").trim().toLowerCase();
  if (!email) return res.status(401).json({ error: "Not signed in" });

  let ok = OWNER_EMAILS.includes(email) || DIRECTOR_EMAILS.includes(email);
  if (!ok) { const { data: c } = await supabase.from("coaches").select("is_admin, is_approved").ilike("email", email).maybeSingle(); ok = !!(c && c.is_approved && c.is_admin); }
  if (!ok) return res.status(403).json({ error: "Forbidden" });

  if (!secret) return res.status(200).json({ configured: false });
  return res.status(200).json({ configured: true, secret, endpoint: "https://dseliteevals.vercel.app/api/dssc-clinic-sync", calendarUrl: "https://drippingsports.playbookapi.com/programs/calendar/" });
}
