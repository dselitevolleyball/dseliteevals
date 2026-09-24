// Admin board upload: Playbook's registrations report (CSV) → class rosters.
//
// POST { rows: [...parsed CSV objects...], dry?: true }
//   Authorization: Bearer <Supabase session token of an owner/admin/DSSC director>
//
// The browser parses the CSV (Papa) and sends rows, which keeps this well
// under Vercel's request cap for a report this size. See _lib/dssc-roster-import.js.

import { createClient } from "@supabase/supabase-js";
import { importRoster } from "./_lib/dssc-roster-import.js";

const OWNER_EMAILS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];
const DIRECTOR_EMAILS = ["hunterhaleysc10@gmail.com", "hunter@drippingsportsclub.com"];

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", ["POST"]); return res.status(405).json({ error: "POST only" }); }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const { data: { user } = {} } = bearer ? await sb.auth.getUser(bearer).catch(() => ({ data: {} })) : { data: {} };
  const email = String(user?.email || "").trim().toLowerCase();
  if (!email) return res.status(401).json({ error: "Sign in first" });
  let ok = OWNER_EMAILS.includes(email) || DIRECTOR_EMAILS.includes(email);
  if (!ok) { const { data: c } = await sb.from("coaches").select("is_admin, is_approved, display_name").ilike("email", email).maybeSingle(); ok = !!(c?.is_approved && c?.is_admin); }
  if (!ok) return res.status(403).json({ error: "Directors and admins only" });

  let body = req.body;
  try { body = typeof body === "string" ? JSON.parse(body) : (body || {}); } catch { return res.status(400).json({ error: "Invalid JSON" }); }
  const out = await importRoster(sb, body.rows, { dry: !!body.dry, addedBy: "playbook upload · " + email });
  return res.status(out.error ? 400 : 200).json(out);
}
