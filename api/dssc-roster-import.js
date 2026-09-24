// Admin board upload: Playbook's registrations report (CSV) → class rosters.
//
// Two ways in:
//   POST { rows: [...parsed CSV objects...], dry?: true }
//     Authorization: Bearer <Supabase session token of an owner/admin/DSSC director>
//     — the admin board's upload button (the browser parses the CSV).
//   POST { secret, csv: "<raw report text>" }
//     — the Playbook bookmarklet. It runs on drippingsports.playbookapi.com,
//     fetches the report's "Export All" (a plain GET with
//     action=export-all-pages, cookies do the auth) and posts the text here.
//     Cross-origin, so CORS is open and the shared sync secret is the auth,
//     exactly like api/dssc-clinic-sync.js.
// See _lib/dssc-roster-import.js for the matching itself.

import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";
import { importRoster } from "./_lib/dssc-roster-import.js";

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
};

const OWNER_EMAILS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];
const DIRECTOR_EMAILS = ["hunterhaleysc10@gmail.com", "hunter@drippingsportsclub.com"];

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") { res.setHeader("Allow", ["POST"]); return res.status(405).json({ error: "POST only" }); }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DSSC_SYNC_SECRET, CRON_SECRET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  let body = req.body;
  try { body = typeof body === "string" ? JSON.parse(body) : (body || {}); } catch { return res.status(400).json({ error: "Invalid JSON" }); }

  let who = null;
  const secretExpected = DSSC_SYNC_SECRET || CRON_SECRET;
  if (body.secret && secretExpected && body.secret === secretExpected) {
    who = "playbook bookmarklet";
  } else {
    const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const { data: { user } = {} } = bearer ? await sb.auth.getUser(bearer).catch(() => ({ data: {} })) : { data: {} };
    const email = String(user?.email || "").trim().toLowerCase();
    if (!email) return res.status(401).json({ error: "Sign in first" });
    let ok = OWNER_EMAILS.includes(email) || DIRECTOR_EMAILS.includes(email);
    if (!ok) { const { data: c } = await sb.from("coaches").select("is_admin, is_approved, display_name").ilike("email", email).maybeSingle(); ok = !!(c?.is_approved && c?.is_admin); }
    if (!ok) return res.status(403).json({ error: "Directors and admins only" });
    who = "playbook upload · " + email;
  }

  let rows = body.rows;
  if (typeof body.csv === "string") {
    const parsed = Papa.parse(body.csv, { header: true, skipEmptyLines: true });
    rows = parsed.data;
  }
  const out = await importRoster(sb, rows, { dry: !!body.dry, addedBy: who });
  return res.status(out.error ? 400 : 200).json(out);
}
