// One-click Playbook → DSSC clinics sync. Called by a bookmarklet the director
// runs FROM the Playbook calendar page: it reads window.fullCalendar.getEvents()
// and POSTs { secret, events } here. We merge volleyball clinics into
// dssc_clinics (see api/_lib/dssc-clinics-sync.js) — preserving coach
// assignments, focus/recap and plans; adding new sessions; refreshing times.
//
// Because the bookmarklet runs on drippingsports.playbookapi.com (a different
// origin), this endpoint answers the CORS preflight and allows POST from any
// origin — auth is the shared secret, not the origin.
//
// Auth: body.secret | ?token= | Bearer  ==  DSSC_SYNC_SECRET (or CRON_SECRET).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DSSC_SYNC_SECRET (or CRON_SECRET).

import { createClient } from "@supabase/supabase-js";
import { syncClinics } from "./_lib/dssc-clinics-sync.js";

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
};

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let raw = "";
  await new Promise((resolve) => { req.on("data", (c) => (raw += c)); req.on("end", resolve); req.on("error", resolve); });
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DSSC_SYNC_SECRET, CRON_SECRET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const secretExpected = DSSC_SYNC_SECRET || CRON_SECRET;
  if (!secretExpected) return res.status(500).json({ error: "DSSC_SYNC_SECRET not set" });

  const body = await readBody(req);
  const url = (() => { try { return new URL(req.url, "https://x"); } catch { return null; } })();
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const provided = body.secret || url?.searchParams.get("token") || bearer || "";
  if (provided !== secretExpected) return res.status(403).json({ error: "Forbidden" });

  const events = Array.isArray(body.events) ? body.events : null;
  if (!events) return res.status(400).json({ error: "Body must include an `events` array from Playbook getEvents()" });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const summary = await syncClinics(supabase, events, { syncedBy: body.by || "bookmarklet" });
    return res.status(200).json(summary);
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e).slice(0, 300) });
  }
}
