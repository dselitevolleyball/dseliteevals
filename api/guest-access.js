// Vercel serverless function: create/update the single shared "guest" login.
//
// Admin-only. The caller must send their Supabase access token as a Bearer
// header; we verify that user is an admin before doing anything. Uses the
// service role to create/update the guest auth user and its coaches row.
//
// The guest is a normal (non-admin) approved coach scoped to chosen age
// groups (team_divs). On a shared device it's used via password only — the
// email below is an internal identifier the device user never types.
//
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (same as send-sms).
//
// Request body: { password: string, ageGroups: string[] }  // e.g. ["U12","U14"]
// Response: { ok: true, email, ageGroups } | { error }

import { createClient } from "@supabase/supabase-js";

const GUEST_EMAIL = "guest@dselitevolleyball.com";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", ["POST"]); return res.status(405).json({ error: "Method not allowed" }); }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Supabase service role not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)." });
  }
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // 1. Verify the caller is an authenticated admin.
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Missing auth token." });
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who?.user) return res.status(401).json({ error: "Invalid session." });
  const { data: callerCoach } = await admin.from("coaches").select("is_admin").eq("id", who.user.id).maybeSingle();
  if (!callerCoach?.is_admin) return res.status(403).json({ error: "Admins only." });

  // 2. Parse + validate.
  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: "Invalid JSON body" }); }
  const password = (body && typeof body.password === "string" ? body.password : "").trim();
  const ageGroups = Array.isArray(body && body.ageGroups) ? body.ageGroups.filter(x => typeof x === "string") : [];
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });

  // 2b. Allowlist the guest email — the handle_new_user trigger blocks signups
  //     whose email isn't allowlisted, which otherwise fails user creation.
  const { error: allowErr } = await admin.from("allowed_signup_emails").upsert(
    { email: GUEST_EMAIL, added_by_name: "Guest login", note: "Shared-device guest login" },
    { onConflict: "email" }
  );
  if (allowErr) return res.status(500).json({ error: "Allowlist update failed: " + allowErr.message });

  // 3. Create the guest auth user (or update its password if it exists).
  let guestId;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: GUEST_EMAIL, password, email_confirm: true,
    user_metadata: { display_name: "Guest (shared device)" },
  });
  if (created?.user) {
    guestId = created.user.id;
  } else {
    // Already exists — find it and reset its password.
    const { data: list, error: listErr } = await admin.auth.admin.listUsers();
    if (listErr) return res.status(500).json({ error: "Lookup failed: " + listErr.message });
    const existing = (list?.users || []).find(u => (u.email || "").toLowerCase() === GUEST_EMAIL);
    if (!existing) return res.status(500).json({ error: "Guest create failed: " + (createErr?.message || "unknown") });
    guestId = existing.id;
    const { error: updErr } = await admin.auth.admin.updateUserById(guestId, { password, email_confirm: true });
    if (updErr) return res.status(500).json({ error: "Password update failed: " + updErr.message });
  }

  // 4. Set the guest's coaches row: approved, non-admin, can view teams,
  //    scoped to the chosen age groups. (handle_new_user may have created the
  //    row on user creation; upsert covers both create + update.)
  const { error: upErr } = await admin.from("coaches").upsert({
    id: guestId,
    email: GUEST_EMAIL,
    display_name: "Guest (shared device)",
    is_approved: true,
    is_admin: false,
    can_view_teams: true,
    team_divs: ageGroups,
  }, { onConflict: "id" });
  if (upErr) return res.status(500).json({ error: "Access update failed: " + upErr.message });

  return res.status(200).json({ ok: true, email: GUEST_EMAIL, ageGroups });
}
