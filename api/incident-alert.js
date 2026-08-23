// Vercel serverless function: tell the admins a coach filed an incident.
//
// Runs server-side rather than from the browser so the alert does not depend on
// the reporting coach's tab staying open, and so the admin list is read with the
// service role instead of trusting whatever the client sends. The client passes
// an incident id and nothing else that matters.
//
// Marks player_incidents.notified_at on success, so a report that never raised
// an alert is visible as such on the admin board instead of silently sitting
// there looking like everyone had seen it.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, plus whatever send-email and
// send-push already need.

import { createClient } from "@supabase/supabase-js";

const KIND_LABEL = {
  injury: "Injury or health",
  playing_time: "Playing time",
  player_conflict: "Between players",
  parent_concern: "Parent concern",
  behavior: "Behavior",
  other: "Something else",
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: "Invalid JSON body" }); }

  const id = Number(body?.incidentId);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "incidentId is required" });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: inc, error: ie } = await supabase
    .from("player_incidents").select("*").eq("id", id).single();
  if (ie || !inc) return res.status(404).json({ error: "Incident not found" });
  // Idempotent: a retry, a double-submit, or a client that fires twice must not
  // produce two alerts for the same report.
  if (inc.notified_at) return res.status(200).json({ ok: true, alreadySent: true });

  const { data: player } = await supabase
    .from("players").select("first_name,last_name").eq("id", inc.player_id).maybeSingle();
  const who = player ? (player.first_name + " " + player.last_name).trim() : "a player";

  const { data: admins } = await supabase
    .from("coaches").select("email,is_admin,is_approved").eq("is_admin", true).eq("is_approved", true);
  const emails = [...new Set((admins || []).map(a => (a.email || "").trim().toLowerCase()).filter(Boolean))];

  const kind = KIND_LABEL[inc.kind] || inc.kind;
  const subject = `${kind} — ${who} (${inc.team_name})`;
  const text =
    `${inc.reported_by || "A coach"} filed a report on ${who}, ${inc.team_name}.\n\n` +
    `Type: ${kind}\n` +
    `When it happened: ${inc.occurred_on || "not given"}\n\n` +
    `${inc.summary}\n\n—\n` +
    `Open the board to pick it up:\n${(process.env.APP_URL || "https://dseliteevals.vercel.app")}/?view=incidents\n\n` +
    `You're getting this because you're an administrator.`;

  const origin = process.env.APP_URL || ("https://" + (req.headers["x-forwarded-host"] || req.headers.host));
  let sent = 0, pushed = 0;
  try {
    if (emails.length) {
      const r = await fetch(origin + "/api/send-email", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: "DS Elite HQ — " + subject, body: text, recipients: emails,
          skipPush: true, sentBy: inc.reported_by || null, source: "incident-alert",
          url: "/?view=incidents",
        }),
      });
      const d = await r.json().catch(() => ({}));
      sent = Number(d?.sent) || 0;
    }
    // Push separately from the email mirror so it can carry its own deep link
    // and reach admins who never open mail on their phone.
    const r2 = await fetch(origin + "/api/send-push", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "New report · " + inc.team_name,
        body: `${kind} — ${who}`,
        url: "/?view=incidents",
        audience: { type: "admins" },
        skipEmail: true,
      }),
    });
    const d2 = await r2.json().catch(() => ({}));
    pushed = Number(d2?.sent) || 0;
  } catch (e) {
    console.error("incident alert failed:", e?.message);
    return res.status(200).json({ ok: false, error: "Alert failed to send", sent, pushed });
  }

  await supabase.from("player_incidents").update({ notified_at: new Date().toISOString() }).eq("id", id);
  return res.status(200).json({ ok: true, sent, pushed, admins: emails.length });
}
