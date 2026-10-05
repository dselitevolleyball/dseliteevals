// Text campaigns: resolve the audience, snapshot one personalised text per
// number, and send them in batches with per-recipient status.
//
//   GET  ?config=1                      → which numbers are ready to send
//   GET  (Vercel Cron, every 10 min)    → start due scheduled campaigns and keep
//                                          working through any still sending
//   POST { action: "test", id, to? }    → one sample text to the sender's phone
//   POST { action: "send", id }         → snapshot recipients, start sending
//   POST { action: "continue", id }     → send the next batch (the screen loops)
//   POST { action: "cancel", id }       → stop; unsent rows stay unsent
//
// Each recipient row is claimed (pending → sent) before its text goes out, so
// the screen's loop and the cron can't text anyone twice.
//
// Auth: CRON_SECRET (cron), the service-role key (operator), or a signed-in
// owner / DSSC director / admin coach.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, TWILIO_*,
//      DSSC_TWILIO_FROM_NUMBER (club number) — see api/_lib/sms.js.

import { createClient } from "@supabase/supabase-js";
import { sendOneSms, twilioReady, notReadyMessage, normalizePhone } from "./_lib/sms.js";
import { loadAudienceData, buildPeople, resolveAudience, renderBody } from "../shared/campaign-audience.js";

const OWNERS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];
const DIRECTORS = ["hunterhaleysc10@gmail.com", "hunter@drippingsportsclub.com"];
const centralToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const url = (() => { try { return new URL(req.url, "https://x"); } catch { return null; } })();
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const isCron = !!CRON_SECRET && (bearer === CRON_SECRET || url?.searchParams.get("token") === CRON_SECRET);
  let who = isCron ? "schedule" : "operator", whoEmail = "";
  if (!isCron && bearer !== SUPABASE_SERVICE_ROLE_KEY) {
    if (!bearer) return res.status(401).json({ error: "Not signed in" });
    const { data: { user } = {} } = await sb.auth.getUser(bearer).catch(() => ({ data: {} }));
    const email = (user?.email || "").trim().toLowerCase();
    if (!email) return res.status(401).json({ error: "Not signed in" });
    let ok = OWNERS.includes(email) || DIRECTORS.includes(email);
    const { data: c } = await sb.from("coaches").select("display_name, is_admin, is_approved").ilike("email", email).maybeSingle();
    if (!ok) ok = !!(c && c.is_approved && c.is_admin);
    if (!ok) return res.status(403).json({ error: "Campaigns are for directors and admins" });
    who = c?.display_name || email; whoEmail = email;
  }

  if (req.method === "GET") {
    if (url?.searchParams.get("config") === "1") return res.status(200).json({ ok: true, ready: { dssc: twilioReady("dssc"), dse: twilioReady("dse") } });
    if (!isCron && bearer !== SUPABASE_SERVICE_ROLE_KEY) return res.status(405).json({ error: "POST an action" });
    return res.status(200).json(await runSchedule(sb, Date.now() + 240000));
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const id = Number(body.id);
  if (!id) return res.status(400).json({ error: "id required" });
  const { data: camp } = await sb.from("sms_campaigns").select("*").eq("id", id).maybeSingle();
  if (!camp) return res.status(404).json({ error: "Campaign not found" });
  try {
    if (body.action === "test") return res.status(200).json(await sendTest(sb, camp, body.to, whoEmail, who));
    if (body.action === "send") { await startCampaign(sb, camp, who); return res.status(200).json(await processCampaign(sb, id, Date.now() + 45000)); }
    if (body.action === "continue") return res.status(200).json(await processCampaign(sb, id, Date.now() + 45000));
    if (body.action === "cancel") { await sb.from("sms_campaigns").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", id).in("status", ["scheduled", "sending", "draft"]); return res.status(200).json({ ok: true }); }
    return res.status(400).json({ error: "Unknown action" });
  } catch (e) {
    await sb.from("sms_campaigns").update({ last_error: e.message, updated_at: new Date().toISOString() }).eq("id", id);
    return res.status(500).json({ error: e.message });
  }
}

async function resolve(sb, camp) {
  const people = buildPeople(await loadAudienceData(sb), centralToday());
  return resolveAudience(people, camp.filters || {}, camp.brand);
}

async function sendTest(sb, camp, toRaw, email, who) {
  if (!twilioReady(camp.brand)) throw new Error(notReadyMessage(camp.brand));
  let to = normalizePhone(toRaw || "");
  if (!to && email) {
    const { data: r } = await sb.from("coach_roster").select("phone").ilike("email", email).maybeSingle();
    to = normalizePhone(r?.phone || "");
  }
  if (!/^\+\d{10,15}$/.test(to)) throw new Error("No phone to send the test to — enter one.");
  const { recipients } = await resolve(sb, camp);
  const sample = recipients[0] || { first: "Drew", kind: "parent", players: ["Sample Player"], team: "", program: "" };
  const text = "[TEST] " + renderBody(camp.body, sample);
  await sendOneSms(sb, { to, name: who, kind: "coach", brand: camp.brand }, text, { sent_by_label: who + " (campaign test)", media_urls: camp.media_urls || [] });
  await sb.from("sms_campaigns").update({ test_sent_at: new Date().toISOString() }).eq("id", camp.id);
  return { ok: true, to, sample: sample.name || null, text };
}

async function startCampaign(sb, camp, who) {
  if (!["draft", "scheduled"].includes(camp.status)) throw new Error("This campaign has already been sent (" + camp.status + ").");
  if (!String(camp.body || "").trim() && !(camp.media_urls || []).length) throw new Error("The message is empty.");
  if (!twilioReady(camp.brand)) throw new Error(notReadyMessage(camp.brand));
  // Claim the campaign so two clicks (or a click and the cron) can't both start it.
  const { data: claimed } = await sb.from("sms_campaigns").update({ status: "sending", started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", camp.id).in("status", ["draft", "scheduled"]).select("id");
  if (!claimed?.length) throw new Error("Already started.");
  const { recipients, skipped } = await resolve(sb, camp);
  if (!recipients.length) { await sb.from("sms_campaigns").update({ status: "failed", last_error: "No one matches this audience." }).eq("id", camp.id); throw new Error("No one matches this audience."); }
  const rows = recipients.map(r => ({ campaign_id: camp.id, phone: r.to, name: r.name, kind: r.kind, players: r.players || [], team_name: r.team || null, program: r.program || null, body: renderBody(camp.body, r) }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("sms_campaign_recipients").upsert(rows.slice(i, i + 500), { onConflict: "campaign_id,phone", ignoreDuplicates: true });
    if (error) throw new Error("Saving recipients: " + error.message);
  }
  const { data: bc, error: be } = await sb.from("sms_broadcasts").insert({ brand: camp.brand, body: camp.body, media_urls: camp.media_urls || [], recipient_count: rows.length, sent_by_label: who, audience: { type: "campaign", campaign_id: camp.id, label: camp.name } }).select("id").single();
  if (be) throw new Error("Creating the group: " + be.message);
  await sb.from("sms_campaigns").update({ broadcast_id: bc.id, recipient_count: rows.length, skipped_count: skipped.length, last_error: null }).eq("id", camp.id);
}

// Send pending rows until the deadline. Returns progress.
export async function processCampaign(sb, id, deadline) {
  const { data: camp } = await sb.from("sms_campaigns").select("*").eq("id", id).maybeSingle();
  if (!camp) return { error: "not found" };
  if (camp.status !== "sending") return progress(sb, camp);
  const { data: outs } = await sb.from("sms_optouts").select("phone").eq("brand", camp.brand);
  const opted = new Set((outs || []).map(o => String(o.phone).replace(/\D/g, "").slice(-10)));
  while (Date.now() < deadline) {
    const { data: batch } = await sb.from("sms_campaign_recipients").select("*").eq("campaign_id", id).eq("status", "pending").order("id").limit(20);
    if (!batch?.length) break;
    for (const r of batch) {
      if (Date.now() >= deadline) break;
      const { data: still } = await sb.from("sms_campaigns").select("status").eq("id", id).maybeSingle();
      if (still?.status !== "sending") return progress(sb, { ...camp, status: still?.status });
      // Claim the row first: whoever flips it from pending sends it.
      const { data: mine } = await sb.from("sms_campaign_recipients").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", r.id).eq("status", "pending").select("id");
      if (!mine?.length) continue;
      if (opted.has(String(r.phone).replace(/\D/g, "").slice(-10))) { await sb.from("sms_campaign_recipients").update({ status: "skipped", error: "opted out" }).eq("id", r.id); continue; }
      try {
        const out = await sendOneSms(sb, { to: r.phone, name: r.name, kind: r.kind, brand: camp.brand, team_name: camp.brand === "dse" ? r.team_name : null, dssc_program: camp.brand === "dssc" ? (r.program || camp.name) : null, dssc_player: (r.players || [])[0] || null }, r.body, { broadcast_id: camp.broadcast_id, sent_by_label: camp.created_by || "campaign", media_urls: camp.media_urls || [] });
        await sb.from("sms_campaign_recipients").update({ message_id: out.message_id }).eq("id", r.id);
      } catch (e) {
        await sb.from("sms_campaign_recipients").update({ status: "failed", error: String(e.message || e).slice(0, 300) }).eq("id", r.id);
      }
    }
  }
  return progress(sb, camp, true);
}

async function progress(sb, camp, finishIfDone = false) {
  const { data: rows } = await sb.from("sms_campaign_recipients").select("status").eq("campaign_id", camp.id);
  const n = { pending: 0, sent: 0, failed: 0, skipped: 0 };
  for (const r of rows || []) n[r.status] = (n[r.status] || 0) + 1;
  const patch = { sent_count: n.sent, failed_count: n.failed, updated_at: new Date().toISOString() };
  let status = camp.status;
  if (finishIfDone && camp.status === "sending" && n.pending === 0) { patch.status = status = "sent"; patch.sent_at = new Date().toISOString(); }
  await sb.from("sms_campaigns").update(patch).eq("id", camp.id);
  if (camp.broadcast_id) await sb.from("sms_broadcasts").update({ sent_count: n.sent, failed_count: n.failed }).eq("id", camp.broadcast_id);
  return { ok: true, id: camp.id, status, ...n, total: (rows || []).length };
}

async function runSchedule(sb, deadline) {
  const now = new Date().toISOString();
  const { data: due } = await sb.from("sms_campaigns").select("*").eq("status", "scheduled").lte("scheduled_at", now);
  const started = [], errors = [];
  for (const c of due || []) { try { await startCampaign(sb, c, c.created_by || "schedule"); started.push(c.id); } catch (e) { errors.push({ id: c.id, error: e.message }); await sb.from("sms_campaigns").update({ last_error: e.message }).eq("id", c.id); } }
  const { data: sending } = await sb.from("sms_campaigns").select("id").eq("status", "sending");
  const results = [];
  for (const c of sending || []) { if (Date.now() >= deadline) break; results.push(await processCampaign(sb, c.id, deadline)); }
  return { ok: true, started, errors, results };
}
