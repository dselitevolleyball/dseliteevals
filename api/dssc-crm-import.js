// DSSC People — imports from the screen.
//
// POST { files: [{ name, rows }] }   CSVs parsed in the browser; each is
//                                    recognised by its columns:
//                                    Playbook participants (student_pk…),
//                                    Upper Hand contacts_list / contact_list /
//                                    order_list / attendance
// POST { sync: true }                Playbook class rosters + DS Elite roster
//   Authorization: Bearer <Supabase session token of an owner/admin/DSSC director>
// Same loaders as scripts/import-dssc-crm.mjs (api/_lib/dssc-crm.js).

import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";
import { importUpperHand, importPlaybookParticipants, syncPlaybook, syncDsElite, parseUpperHandEvent } from "./_lib/dssc-crm.js";

export const config = { maxDuration: 300 };
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
  if (!ok) { const { data: c } = await sb.from("coaches").select("is_admin, is_approved").ilike("email", email).maybeSingle(); ok = !!(c?.is_approved && c?.is_admin); }
  if (!ok) return res.status(403).json({ error: "Directors and admins only" });

  let body = req.body;
  try { body = typeof body === "string" ? JSON.parse(body) : (body || {}); } catch { return res.status(400).json({ error: "Invalid JSON" }); }
  try {
    if (body.sync) {
      const a = await syncPlaybook(sb), b = await syncDsElite(sb);
      return res.status(200).json({ ok: true, summary: `Rosters synced — Playbook: ${a.participation} class records across ${a.contacts} families; DS Elite: ${b.participation} players across ${b.contacts} families.` });
    }
    const files = Array.isArray(body.files) ? body.files : [];
    if (!files.length) return res.status(400).json({ error: "No files." });
    const parts = [];
    const uh = { contacts: [], participants: [], orders: [], attendance: [] };
    let events = 0;
    for (const f of files) {
      // A per-event export has metadata rows above its header; the browser's
      // header-based parse can't read it, so it also sends the raw text.
      const ev = typeof f.text === "string" ? parseUpperHandEvent(f.text, Papa) : null;
      if (ev) { uh.attendance.push(...ev); events++; parts.push(`${f.name}: event "${ev[0]?.event || "?"}" · ${ev.length} attendees`); continue; }
      const rows = Array.isArray(f.rows) ? f.rows : [];
      const cols = Object.keys(rows[0] || {});
      if (cols.includes("student_pk") && cols.includes("guardian_email")) { const r = await importPlaybookParticipants(sb, rows); parts.push(`${f.name}: ${r.participants} players under ${r.contacts} families (${r.rosterPhones} roster phones filled)`); }
      else if (cols.includes("phone_number") && cols.includes("added_date")) uh.contacts.push(...rows);
      else if (cols.includes("gender") && cols.includes("date_of_birth") && cols.includes("phone")) uh.participants.push(...rows);
      else if (cols.includes("Order Number") && cols.includes("Buyer")) uh.orders.push(...rows);
      else if (cols.some(c => /event|attend|product|item|program|class/i.test(c))) uh.attendance.push(...rows);
      else parts.push(`${f.name}: didn't recognise the columns (${cols.slice(0, 5).join(", ")}…)`);
    }
    if (uh.contacts.length || uh.participants.length || uh.orders.length || uh.attendance.length) {
      const r = await importUpperHand(sb, uh);
      parts.push(`Upper Hand: ${r.contacts} families, ${r.participants} players, ${r.orders} orders (${r.ordersMatched} matched to a family)${r.participation ? `, ${r.participation} event records` : ""}`);
    }
    return res.status(200).json({ ok: true, summary: parts.join(" · ") });
  } catch (e) { return res.status(500).json({ error: e.message }); }
}
