// Daily registration check — what AES and OTTO say about every DS Elite
// team's tournament entries vs tournament_assignments in HQ. All the logic is
// runRegistrationCheck() in api/_lib/registration-check.js; this is the HTTP
// wrapper.
//
//   GET    the daily cron (13:30 UTC, after aes-poll at 13:00)
//   POST   "Run check now" from the Tournaments view in HQ
//   ?dry=1     write nothing, email nothing — returns everything it would
//              write, flag and email (with the matched events and rows)
//   ?apply=0   write registrations / flags / the run row, but leave
//              tournament_assignments alone (auto-updates are only reported)
//   ?email=0   no email this run (the flags stay un-emailed for the next one,
//              and so do this run's auto-update notices: the next run that
//              emails includes every auto-update of the last 14 days not yet
//              emailed — the same after a failed send)
//   ?detail=1  the full report (events, rows) on a real run too
//
// Auth: Vercel Cron `Authorization: Bearer <CRON_SECRET>` (or ?token=), the
// service-role key as bearer (operator scripts), or a signed-in owner /
// approved admin (Supabase session bearer) — authCaller, as tournament-sync.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET (+ send-email's).
// vercel.json: cron "30 13 * * *", functions maxDuration 300 (also set below).

import { createClient } from "@supabase/supabase-js";
import { authCaller } from "./_lib/tournament-sync-core.js";
import { runRegistrationCheck, emailSender } from "./_lib/registration-check.js";
import { appOrigin } from "../shared/app-origin.js";

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const url = (() => { try { return new URL(req.url, "https://x"); } catch { return null; } })();
  const q = (k) => url?.searchParams.get(k) ?? null;
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  res.setHeader("Cache-Control", "no-store");

  const auth = await authCaller(sb, req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const dry = q("dry") === "1";
  const origin = appOrigin(req);
  try {
    const out = await runRegistrationCheck(sb, {
      dry,
      applyUpdates: q("apply") !== "0",
      send: dry || q("email") === "0" ? null : emailSender(origin),
      appOrigin: origin,
      maxMs: 250000,
    });
    out.by = auth.who;
    if (!dry && q("detail") !== "1") { delete out.events; if (out.registrations) delete out.registrations.rows; }
    return res.status(out.error ? 500 : 200).json(out);
  } catch (e) {
    console.error("registration-check:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
