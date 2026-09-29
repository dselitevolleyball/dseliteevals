// Apply (or discard) changes Ask HQ proposed from an uploaded document.
//
// POST { proposal_id, include: [indexes] }   → applies those entries
// POST { proposal_id, discard: true }        → marks it discarded
//   Authorization: Bearer <Supabase session token of an owner/admin>
// Response { status, results: [{ i, status: applied|conflict|missing|error, why? }] }
//
// The admin's click is the only thing that writes. Each entry is re-checked
// against the live row in api/_lib/hq-changes.js before it is written, and
// every write lands in change_log with the admin's name.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";
import { applyChanges } from "./_lib/hq-changes.js";

const OWNER_EMAILS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", ["POST"]); return res.status(405).json({ error: "POST only" }); }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const { data: { user } = {} } = bearer ? await sb.auth.getUser(bearer).catch(() => ({ data: {} })) : { data: {} };
  const email = String(user?.email || "").trim().toLowerCase();
  if (!email) return res.status(401).json({ error: "Sign in first" });
  let name = email;
  if (!OWNER_EMAILS.includes(email)) {
    const { data: c } = await sb.from("coaches").select("is_admin, is_approved, display_name").ilike("email", email).maybeSingle();
    if (!(c?.is_approved && c?.is_admin)) return res.status(403).json({ error: "Admins only." });
    name = c.display_name || email;
  } else name = "Drew Rose";

  let body = req.body;
  try { body = typeof body === "string" ? JSON.parse(body) : (body || {}); } catch { return res.status(400).json({ error: "Invalid JSON" }); }
  const id = String(body.proposal_id || "");
  const { data: prop, error } = await sb.from("hq_change_proposals").select("*").eq("id", id).maybeSingle();
  if (error || !prop) return res.status(404).json({ error: "That proposal doesn't exist." });
  if (prop.status !== "pending") return res.status(409).json({ error: "Already " + prop.status + (prop.applied_by ? " by " + prop.applied_by : "") + "." });

  if (body.discard) {
    await sb.from("hq_change_proposals").update({ status: "discarded", applied_by: name, applied_at: new Date().toISOString() }).eq("id", id).eq("status", "pending");
    return res.status(200).json({ status: "discarded", results: [] });
  }

  const include = [...new Set((Array.isArray(body.include) ? body.include : []).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < prop.changes.length))];
  if (!include.length) return res.status(400).json({ error: "Tick at least one change." });
  // Claim it first so two admins tapping Apply at once can't both write.
  const { data: claimed } = await sb.from("hq_change_proposals").update({ status: "partial", applied_by: name, applied_at: new Date().toISOString() }).eq("id", id).eq("status", "pending").select("id");
  if (!claimed?.length) return res.status(409).json({ error: "Someone else is applying this right now." });

  const results = await applyChanges(sb, include.map(i => [i, prop.changes[i]]), { email, name });
  const allApplied = results.length === prop.changes.length && results.every(r => r.status === "applied");
  const status = allApplied ? "applied" : "partial";
  await sb.from("hq_change_proposals").update({ status, results }).eq("id", id);
  return res.status(200).json({ status, results });
}
