// DSSC People -> Campaigns: the screen's API (directors only). POST
// { action, ... } with the director's Supabase token. The work is in
// api/_lib/crm-campaigns.js.
//
//   list                          campaigns, newest first
//   audience {segment}            who it would reach right now
//   draft {campaign}              Claude writes the steps (nothing saved)
//   save {campaign}               create or update a draft / scheduled campaign
//   schedule {id, starts_on}      put its steps on the Marketing calendar (as drafts to approve)
//   cancel {id}                   take unsent steps off the calendar
//   delete {id}                   a draft that was never scheduled
//   results {id}                  sends, replies, who booked, revenue

import { createClient } from "@supabase/supabase-js";
import { verifyDirector } from "./_lib/site-inbox.js";
import { draftCampaign, scheduleCampaign, removeItems, campaignResults, audienceOf, lineFor, CADENCES } from "./_lib/crm-campaigns.js";
import { EMPTY_SEGMENT } from "../shared/crm-segments.js";

export const config = { maxDuration: 120 };
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const EDITABLE = ["name", "goal", "segment", "offer", "channels", "steps", "starts_on", "idea_key", "notes"];

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "POST only" }); }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const who = await verifyDirector(sb, req);
  if (who.error) return res.status(who.status).json({ error: who.status === 403 ? "Campaigns are for the club's directors" : who.error });
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  try { return res.status(200).json({ ok: true, ...(await run(sb, who, b || {})) }); }
  catch (e) { console.error("crm-campaigns", b?.action, e); return res.status(e.status || 500).json({ error: e.message || String(e) }); }
}

async function getCampaign(sb, id) {
  const { data } = await sb.from("crm_campaigns").select("*").eq("id", Number(id)).maybeSingle();
  if (!data) throw fail(404, "That campaign no longer exists");
  return data;
}

export async function run(sb, { me, name }, b) {
  const by = String(name || me).split(/[\s@]/)[0];
  switch (b.action) {
    case "list": {
      const { data, error } = await sb.from("crm_campaigns").select("*").order("created_at", { ascending: false }).limit(100);
      if (error) throw fail(500, /crm_campaigns|schema cache/.test(error.message) ? "Run migrations/20261110_crm_v2.sql first" : error.message);
      // On the calendar -> live once a step has gone out -> done when they all have.
      const going = (data || []).filter(c => ["scheduled", "live"].includes(c.status));
      if (going.length) {
        const { data: items } = await sb.from("mkt_items").select("id, crm_campaign_id, status").in("crm_campaign_id", going.map(c => c.id));
        for (const c of going) {
          const mine = (items || []).filter(i => i.crm_campaign_id === c.id);
          c.sent_item_ids = mine.filter(i => ["publishing", "published"].includes(i.status)).map(i => i.id);
          const sent = mine.filter(i => i.status === "published").length, open = mine.filter(i => !["published", "rejected", "failed"].includes(i.status)).length;
          const next = !mine.length ? c.status : !open ? "done" : sent ? "live" : "scheduled";
          if (next !== c.status) { await sb.from("crm_campaigns").update({ status: next }).eq("id", c.id); c.status = next; }
        }
      }
      return { campaigns: data || [], cadences: Object.keys(CADENCES) };
    }
    case "audience": return { audience: await audienceOf(sb, { ...EMPTY_SEGMENT, ...(b.segment || {}) }) };
    case "draft": {
      const c = b.campaign || {};
      const segment = { ...EMPTY_SEGMENT, ...(c.segment || {}) };
      const aud = await audienceOf(sb, segment);
      const camp = { ...c, segment, line: c.offer?.line || lineFor({ ...c, segment }) };
      return { ...(await draftCampaign(sb, camp, { ...aud, notes: c.audience_notes || "" })), audience: { ...aud, ids: undefined } };
    }
    case "save": {
      const c = b.campaign || {};
      const row = Object.fromEntries(Object.entries(c).filter(([k]) => EDITABLE.includes(k)));
      if (row.segment) row.segment = { ...EMPTY_SEGMENT, ...row.segment };
      if (!row.name && !c.id) row.name = "Campaign";
      row.updated_at = new Date().toISOString();
      if (c.id) {
        const cur = await getCampaign(sb, c.id);
        if (!["draft", "scheduled", "live"].includes(cur.status)) throw fail(400, `This campaign is ${cur.status}`);
        // A step that has gone out can't be rewritten.
        if (cur.status !== "draft" && Array.isArray(row.steps)) {
          const { data: items } = await sb.from("mkt_items").select("id, status").eq("crm_campaign_id", cur.id);
          const sent = new Set((items || []).filter(i => ["publishing", "published"].includes(i.status)).map(i => i.id));
          row.steps = row.steps.map((s, i) => sent.has(cur.steps?.[i]?.item_id) ? cur.steps[i] : s);
        }
        const { data, error } = await sb.from("crm_campaigns").update(row).eq("id", cur.id).select().single();
        if (error) throw fail(500, error.message);
        // Words changed on a scheduled or live campaign: put the new (unsent) steps on the calendar.
        if (["scheduled", "live"].includes(cur.status) && (row.steps || row.segment || row.offer)) return { campaign: await scheduleCampaign(sb, data, { by }) };
        return { campaign: data };
      }
      const { data, error } = await sb.from("crm_campaigns").insert({ ...row, status: "draft", created_by: by }).select().single();
      if (error) throw fail(500, error.message);
      return { campaign: data };
    }
    case "schedule": return { campaign: await scheduleCampaign(sb, await getCampaign(sb, b.id), { by, startsOn: b.starts_on || null }) };
    case "cancel": {
      const c = await getCampaign(sb, b.id);
      const removed = await removeItems(sb, c, { onlyUnsent: true });
      const { data } = await sb.from("crm_campaigns").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", c.id).select().single();
      return { campaign: data, removed };
    }
    case "delete": {
      const c = await getCampaign(sb, b.id);
      if (c.status !== "draft") throw fail(400, "Only a draft can be deleted - cancel it instead");
      await sb.from("crm_campaigns").delete().eq("id", c.id);
      return {};
    }
    case "results": return { results: await campaignResults(sb, await getCampaign(sb, b.id)) };
    default: throw fail(400, "Unknown action");
  }
}
