// Vercel Cron (every 15 minutes): DS Elite Social's background work
// (api/_lib/dse-social.js runCron) - post approved posts whose time has come,
// remind coaches who haven't answered their intro survey in 3 days, turn new
// answers into poster drafts, and every half hour turn new family photo
// batches into drafts for approval in Slack.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; also ?token=.
// ?dry=1 lists what it would do without doing it.

import { createClient } from "@supabase/supabase-js";
import { runCron } from "./_lib/dse-social.js";

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET } = process.env;
  const url = new URL(req.url, "https://x");
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "") || url.searchParams.get("token") || "";
  if (!CRON_SECRET || token !== CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const out = await runCron(sb, { dry: url.searchParams.get("dry") === "1", deadline: Date.now() + 270e3 });
    return res.status(200).json({ ok: true, ...out });
  } catch (e) {
    console.error("dse-social-cron", e);
    return res.status(500).json({ error: e.message });
  }
}
