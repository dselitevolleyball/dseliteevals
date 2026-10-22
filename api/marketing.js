// POST /api/marketing — the DSSC Marketing Machine (HQ -> DSSC -> Marketing).
//
//   Authorization: Bearer <Supabase session token> of a DSSC director
//   Body: JSON { action, ... }  ->  200 { ok: true, ... } | 4xx/5xx { error }
//
//   status                                  connections + missing env, settings, priorities
//   programs                                the programs feed + signals
//   plan        { week_of }                 planWeek (no writes)
//   flow        { start_week, weeks? }      { flow: planFlow(...) }
//   items       { week_of }                 that week's items
//   generate    { week_of, replace_drafts?, instruction?, program_id?, line?, channel? }
//               plans + writes drafts; with program_id / line it makes ONE draft
//   revise      { id, instruction }         Claude rewrites one item
//   brief       { week_of, instruction }    stores a one-week priority, regenerates the week's drafts
//   update      { id, patch }               edit fields (content edits send an approved item back to draft)
//   approve     { ids }  · unapprove { id } · reject { id, reason? } · delete { id }
//   publish_now { id }                      publish an approved (or failed) item now
//   test        { id, to? }                 email -> you; text -> your phone; social -> preview only
//   photos_sync · settings_save { patch } · priority_save { priority } · priority_delete { id }
//   ideas_refresh { ask?, web? }            the idea scout runs now (an ask: "something fun for Halloween")
//   idea_accept { id, instruction? }        the idea becomes a draft on its best day
//   idea_dismiss { id, feedback? }          turned down - the reason goes back to the scout
//   spotlight_candidates · spotlight_create { person } · spotlight_update { id, patch }
//   spotlight_send { id, via? } · spotlight_remind { id } · spotlight_draft { id } · spotlight_cancel { id }
//   photos_tag  { ids?, mode? }             Claude catalogues photos (line, tags, description,
//                                           uses, quality, kids visible); no ids = the next
//                                           untagged ones. mode "replace" overwrites line/tags/alt.
//
// Nothing reaches families without an approved item: generate/revise/brief
// only write drafts, and publishing (here or in api/marketing-cron.js) only
// takes status 'approved'.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY; ANTHROPIC_API_KEY; META_*;
//      RESEND_API_KEY, DSSC_FROM_EMAIL, MARKETING_UNSUB_SECRET; TWILIO_* (see MARKETING_SETUP.md).

import { readBody } from "./_lib/site-forms.js";
import { verifyDirector, isEmailish, nrm } from "./_lib/site-inbox.js";
import { normalizePhone } from "./_lib/sms.js";
import { planWeek, planFlow, signalsFor, mondayOf, addDays, parseBrief, fmtDay, normRhythm, LINE_KEYS } from "../shared/marketing-plan.js";
import { reviseItem, buildEmail, withHero, aiReady, ctToday } from "./_lib/marketing-ai.js";
import { connections, publishItem, captionFor, testEmail, testSms } from "./_lib/marketing-publish.js";
import { serviceSb, loadSettings, loadPriorities, loadHistory, loadPhotos, fetchPrograms, syncPhotos, generateWeek, log } from "./_lib/marketing-core.js";
import { tagPhotos } from "./_lib/marketing-photos-ai.js";
import { runScout, acceptIdea, dismissIdea } from "./_lib/marketing-scout.js";
import { candidates, createSpotlight, sendSpotlight, draftSpotlight } from "./_lib/marketing-spotlight.js";

const fail = (status, error) => Object.assign(new Error(error), { status });
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const LOCKED = ["publishing", "published"];
const CONTENT = ["headline", "body", "email_subject", "email_preheader", "email_html", "email_blocks", "cta_text", "cta_url", "hashtags", "graphic", "platforms", "audience", "asset_url", "asset_story_url"];
const EDITABLE = [...CONTENT, "scheduled_at"];

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "POST only" }); }
  const sb = serviceSb();
  if (!sb) return res.status(500).json({ error: "Server not configured" });
  const who = await verifyDirector(sb, req);
  if (who.error) return res.status(who.status).json({ error: who.status === 403 ? "Marketing is for the club's directors" : who.error });
  const body = readBody(req);
  try {
    const out = await run(sb, who, body);
    return res.status(200).json({ ok: true, ...out });
  } catch (e) {
    console.error("marketing", body?.action, e);
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

async function getSpotlight(sb, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw fail(400, "id is required");
  const { data, error } = await sb.from("mkt_spotlights").select("*").eq("id", n).maybeSingle();
  if (error) throw fail(500, error.message);
  if (!data) throw fail(404, "That spotlight no longer exists");
  return data;
}

async function getItem(sb, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw fail(400, "id is required");
  const { data, error } = await sb.from("mkt_items").select("*").eq("id", n).maybeSingle();
  if (error) throw fail(500, error.message);
  if (!data) throw fail(404, "That item no longer exists");
  return data;
}

export async function run(sb, { me, name }, b) {
  const today = ctToday();
  switch (b.action) {
    case "status": {
      const [settings, priorities] = await Promise.all([loadSettings(sb), loadPriorities(sb)]);
      return { ...connections(), settings, priorities };
    }

    case "programs": {
      const feed = await fetchPrograms({ fresh: !!b.fresh });
      return { ...feed, signals: signalsFor(feed.programs, today) };
    }

    case "plan": {
      const weekOf = mondayOf(b.week_of || today);
      if (!weekOf) throw fail(400, "week_of must be YYYY-MM-DD");
      const [feed, settings, priorities, history] = await Promise.all([fetchPrograms(), loadSettings(sb), loadPriorities(sb), loadHistory(sb, weekOf)]);
      return { week_of: weekOf, ...planWeek({ weekOf, programs: feed.programs, priorities, settings, history, today: today > weekOf ? today : null }) };
    }

    case "flow": {
      const start = mondayOf(b.start_week || today);
      if (!start) throw fail(400, "start_week must be YYYY-MM-DD");
      const [feed, settings, priorities, history] = await Promise.all([fetchPrograms(), loadSettings(sb), loadPriorities(sb), loadHistory(sb, start)]);
      return { start_week: start, flow: planFlow({ startWeek: start, weeks: Math.max(1, Math.min(12, +b.weeks || 6)), programs: feed.programs, priorities, settings, history, today: today > start ? today : null }) };
    }

    case "items": {
      const weekOf = mondayOf(b.week_of || today);
      const { data, error } = await sb.from("mkt_items").select("*").eq("week_of", weekOf).order("scheduled_at", { ascending: true }).order("id");
      if (error) throw fail(500, error.message);
      return { week_of: weekOf, items: data || [] };
    }

    case "generate": {
      const weekOf = mondayOf(b.week_of || today);
      // One item: a program, a line, or an idea typed on a calendar day (day, time, format, the idea as its theme).
      const ideaLine = !b.line && !b.program_id && b.instruction ? (parseBrief(String(b.instruction)).lines || [])[0] || null : null;
      const single = b.program_id || b.line || b.single || b.day ? { program_id: b.program_id || null, line: b.line || ideaLine, channel: b.channel || "social", day: b.day || null, time: b.time || null, format: b.format || null, theme: b.theme ? String(b.theme).slice(0, 300) : null, reason: b.reason ? String(b.reason).slice(0, 200) : null } : null;
      const r = await generateWeek(sb, { weekOf, replaceDrafts: !!b.replace_drafts, instruction: String(b.instruction || "").slice(0, 1000), by: me, single });
      return { week_of: weekOf, items: r.items, kept: r.kept, removed: r.removed, notes: r.notes, ai: r.ai && { used: r.ai.used, model: r.ai.model, error: r.ai.error, fallbacks: r.ai.fallbacks } };
    }

    case "revise": {
      const item = await getItem(sb, b.id);
      const instruction = String(b.instruction || "").trim().slice(0, 1000);
      if (!instruction) throw fail(400, "Say what to change");
      if (LOCKED.includes(item.status)) throw fail(409, `Already ${item.status} - it can't be changed`);
      if (!aiReady()) throw fail(503, "Claude isn't connected (ANTHROPIC_API_KEY) - edit the text directly");
      const [feed, settings, photos] = await Promise.all([fetchPrograms().catch(() => ({ programs: [] })), loadSettings(sb), loadPhotos(sb)]);
      const r = await reviseItem({ item, instruction, programs: feed.programs, settings, photos });
      if (!r.patch) throw fail(502, r.error || "The rewrite didn't come back");
      const revisions = [...(item.revisions || []), { at: new Date().toISOString(), by: me, instruction, before: { headline: item.headline, body: item.body, email_subject: item.email_subject } }].slice(-20);
      const patch = { ...r.patch, revisions, error: null };
      if (item.status === "approved" || item.status === "failed") Object.assign(patch, { status: "draft", approved_by: null, approved_at: null });
      const { data, error } = await sb.from("mkt_items").update(patch).eq("id", item.id).select("*").single();
      if (error) throw fail(500, error.message);
      await log(sb, item.id, "revise", { by: me, instruction, model: r.model });
      return { item: data };
    }

    case "brief": {
      const weekOf = mondayOf(b.week_of || today);
      const instruction = String(b.instruction || "").trim().slice(0, 1000);
      if (!weekOf || !instruction) throw fail(400, "week_of and instruction are required");
      const { lines, avoid_lines } = parseBrief(instruction);
      const row = {
        title: `Week of ${fmtDay(weekOf)}: ${instruction}`.slice(0, 140), notes: instruction, lines, avoid_lines, weight: 4,
        starts_on: weekOf, ends_on: addDays(weekOf, 6), channels: ["social", "email"], active: true, created_by: me,
      };
      const { data: priority, error } = await sb.from("mkt_priorities").insert(row).select("*").single();
      if (error) throw fail(500, error.message);
      await log(sb, null, "brief", { by: me, week_of: weekOf, instruction, priority_id: priority.id });
      const r = await generateWeek(sb, { weekOf, replaceDrafts: true, instruction, by: me });
      return { week_of: weekOf, priority, items: r.items, kept: r.kept, removed: r.removed, notes: r.notes, ai: r.ai && { used: r.ai.used, model: r.ai.model, error: r.ai.error, fallbacks: r.ai.fallbacks } };
    }

    case "update": {
      const item = await getItem(sb, b.id);
      if (LOCKED.includes(item.status)) throw fail(409, `Already ${item.status} - it can't be changed`);
      const p = b.patch && typeof b.patch === "object" ? b.patch : {};
      const patch = {};
      for (const k of EDITABLE) if (k in p) patch[k] = p[k];
      if ("scheduled_at" in patch && patch.scheduled_at && isNaN(new Date(patch.scheduled_at))) throw fail(400, "scheduled_at isn't a date");
      // Moved to another week on the calendar: it belongs to that week now.
      if (patch.scheduled_at) patch.week_of = mondayOf(new Date(patch.scheduled_at).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }));
      if ("cta_url" in patch && patch.cta_url && !/^https:\/\/\S+$/.test(patch.cta_url)) throw fail(400, "The link must start with https://");
      if ("hashtags" in patch) patch.hashtags = (Array.isArray(patch.hashtags) ? patch.hashtags : String(patch.hashtags || "").split(/[\s,]+/)).map(h => String(h).replace(/[^A-Za-z0-9_]/g, "")).filter(Boolean).slice(0, 10);
      if ("platforms" in patch) patch.platforms = (patch.platforms || []).filter(x => ["facebook", "instagram", "instagram_story", "facebook_story"].includes(x));
      if (!Object.keys(patch).length) throw fail(400, "Nothing to change");
      // An email's HTML follows its fields unless the HTML itself was edited.
      if (item.channel === "email" && !("email_html" in patch) && ["headline", "body", "email_subject", "email_preheader", "email_blocks", "cta_text", "cta_url", "graphic"].some(k => k in patch)) {
        const next = { ...item, ...patch };
        patch.email_html = withHero(buildEmail(next).html, next.asset_url);
      }
      // A reel's words are burned into its cards: new words, new render.
      if (item.kind === "reel" && ["headline", "graphic"].some(k => k in patch)) patch.render_status = "needs_render";
      let unapproved = false;
      if (item.status === "approved" && CONTENT.some(k => k in patch)) { Object.assign(patch, { status: "draft", approved_by: null, approved_at: null }); unapproved = true; }
      const { data, error } = await sb.from("mkt_items").update(patch).eq("id", item.id).select("*").single();
      if (error) throw fail(500, error.message);
      return { item: data, unapproved };
    }

    case "approve": {
      const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).map(Number).filter(n => Number.isInteger(n) && n > 0);
      if (!ids.length) throw fail(400, "ids is required");
      const { data: rows, error } = await sb.from("mkt_items").select("*").in("id", ids);
      if (error) throw fail(500, error.message);
      const items = [], errors = [];
      for (const it of rows || []) {
        const why = !["draft", "failed"].includes(it.status) ? `already ${it.status}`
          : it.kind === "reel" && (!it.asset_video_url || it.render_status !== "rendered") ? "the reel hasn't been rendered"
          : it.channel === "social" && !it.asset_url ? "the graphic hasn't been rendered (asset_url)"
          : it.channel === "social" && !(it.platforms || []).length ? "no platform picked"
          : !String(it.body || "").trim() ? "no text"
          : it.channel === "email" && !String(it.email_subject || "").trim() ? "no subject line"
          : null;
        if (why) { errors.push({ id: it.id, error: why }); continue; }
        const now = new Date().toISOString();
        const { data, error: e2 } = await sb.from("mkt_items").update({ status: "approved", approved_by: me, approved_at: now, error: null, scheduled_at: it.scheduled_at || now }).eq("id", it.id).in("status", ["draft", "failed"]).select("*").single();
        if (e2 || !data) { errors.push({ id: it.id, error: e2?.message || "changed meanwhile" }); continue; }
        items.push(data);
        const photo = it.graphic?.photo_url;
        if (photo) {
          const { data: ph } = await sb.from("mkt_photos").select("id, used_count").eq("url", photo).maybeSingle();
          if (ph) await sb.from("mkt_photos").update({ used_count: (ph.used_count || 0) + 1, last_used_at: now }).eq("id", ph.id);
        }
      }
      for (const id of ids) if (!(rows || []).some(r => r.id === id)) errors.push({ id, error: "not found" });
      if (items.length) await log(sb, null, "approve", { by: me, ids: items.map(i => i.id) });
      return { items, errors };
    }

    case "unapprove": {
      const item = await getItem(sb, b.id);
      if (item.status !== "approved") throw fail(409, `It's ${item.status}, not approved`);
      const { data, error } = await sb.from("mkt_items").update({ status: "draft", approved_by: null, approved_at: null }).eq("id", item.id).eq("status", "approved").select("*").single();
      if (error) throw fail(500, error.message);
      return { item: data };
    }

    case "reject": {
      const item = await getItem(sb, b.id);
      if (LOCKED.includes(item.status)) throw fail(409, `Already ${item.status}`);
      const reason = String(b.reason || "").trim().slice(0, 500);
      const { data, error } = await sb.from("mkt_items").update({ status: "rejected", error: reason ? `Rejected: ${reason}` : null, approved_by: null, approved_at: null }).eq("id", item.id).select("*").single();
      if (error) throw fail(500, error.message);
      await log(sb, item.id, "reject", { by: me, reason });
      return { item: data };
    }

    case "delete": {
      const item = await getItem(sb, b.id);
      if (LOCKED.includes(item.status)) throw fail(409, `Already ${item.status} - it stays on the record`);
      const { error } = await sb.from("mkt_items").delete().eq("id", item.id).not("status", "in", "(publishing,published)");
      if (error) throw fail(500, error.message);
      return { deleted: item.id };
    }

    case "publish_now": {
      const item = await getItem(sb, b.id);
      if (!["approved", "failed"].includes(item.status)) throw fail(409, item.status === "draft" ? "Approve it first" : `It's ${item.status}`);
      if (item.status === "failed" && !item.approved_by) throw fail(409, "Approve it first");
      const settings = await loadSettings(sb);
      const result = await publishItem(sb, item, { settings, deadline: Date.now() + 90000, allowFailed: true });
      return { item: await getItem(sb, item.id), result };
    }

    case "test": {
      const item = await getItem(sb, b.id);
      if (item.channel === "social") return { preview: { platforms: item.platforms, image: item.asset_url || item.graphic?.photo_url || null, caption: captionFor(item) } };
      if (item.channel === "email") {
        const to = isEmailish(b.to) ? nrm(b.to) : me;
        const r = await testEmail(item, to);
        if (!r.ok) throw fail(502, r.error || "The test email didn't send");
        await log(sb, item.id, "test", { by: me, channel: "email", to });
        return { sent: true, to };
      }
      let to = normalizePhone(b.to || "");
      if (!/^\+\d{10,15}$/.test(to)) {
        const { data: r } = await sb.from("coach_roster").select("phone").ilike("email", me).maybeSingle();
        to = normalizePhone(r?.phone || "");
      }
      if (!/^\+\d{10,15}$/.test(to)) throw fail(400, "No phone on file for you - enter one to send the test to");
      const r = await testSms(sb, item, to, name || me);
      await log(sb, item.id, "test", { by: me, channel: "sms", to });
      return { sent: true, to: r.to };
    }

    case "photos_sync":
      return { sync: await syncPhotos(sb) };

    case "ideas_refresh": {
      if (!aiReady() && b.ask) throw fail(503, "Claude isn't connected (ANTHROPIC_API_KEY)");
      const r = await runScout(sb, { by: me, ask: String(b.ask || "").slice(0, 500), web: b.web == null ? null : !!b.web, deadline: Date.now() + 110000 });
      return r;
    }

    case "idea_accept": {
      const r = await acceptIdea(sb, b.id, { by: me, instruction: String(b.instruction || "").slice(0, 1000) });
      return r;
    }

    case "idea_dismiss":
      return { idea: await dismissIdea(sb, b.id, { by: me, feedback: b.feedback }) };

    case "spotlight_candidates":
      return { candidates: await candidates(sb) };

    case "spotlight_create": {
      const settings = await loadSettings(sb);
      return { spotlight: await createSpotlight(sb, b.person || {}, { by: me, flair: settings.flair }) };
    }

    case "spotlight_update": {
      const sp = await getSpotlight(sb, b.id);
      const p = b.patch && typeof b.patch === "object" ? b.patch : {};
      const row = {};
      for (const k of ["name", "role", "intro"]) if (k in p) row[k] = String(p[k] || "").trim().slice(0, k === "intro" ? 1200 : 120) || null;
      if ("email" in p) row.email = isEmailish(p.email) ? nrm(p.email) : null;
      if ("phone" in p) row.phone = normalizePhone(p.phone || "") || null;
      if ("line" in p) row.line = LINE_KEYS.includes(p.line) ? p.line : "club";
      if ("questions" in p) row.questions = (Array.isArray(p.questions) ? p.questions : []).map(x => typeof x === "string" ? { q: x } : x).filter(x => String(x?.q || "").trim()).slice(0, 10).map(x => ({ q: String(x.q).trim().slice(0, 300), ...(x.a ? { a: String(x.a).trim().slice(0, 1500) } : {}) }));
      // A director types in answers that came back another way (a text, a chat).
      if (p.mark_answered) { if (!(row.questions || sp.questions).some(x => String(x.a || "").trim())) throw fail(400, "Add at least one answer"); Object.assign(row, { status: "answered", answered_at: new Date().toISOString(), consent: true }); }
      if (["drafted", "cancelled"].includes(sp.status) && Object.keys(row).length) throw fail(409, `It's ${sp.status} - it can't be changed`);
      if (!Object.keys(row).length) throw fail(400, "Nothing to change");
      const { data, error } = await sb.from("mkt_spotlights").update(row).eq("id", sp.id).select("*").single();
      if (error) throw fail(500, error.message);
      return { spotlight: data };
    }

    case "spotlight_send":
    case "spotlight_remind": {
      const sp = await getSpotlight(sb, b.id);
      const settings = await loadSettings(sb);
      const via = Array.isArray(b.via) && b.via.length ? b.via.filter(v => ["email", "sms"].includes(v)) : (settings.scout?.via || ["email", "sms"]);
      const r = await sendSpotlight(sb, sp, { via, by: me, byName: String(name || me).split(/[\s@]/)[0], reminder: b.action === "spotlight_remind" }).catch(e => { throw fail(400, e.message); });
      if (b.action === "spotlight_send") await sb.from("mkt_ideas").update({ status: "accepted", decided_by: me, decided_at: new Date().toISOString() }).eq("spotlight_id", sp.id).eq("status", "new");
      await log(sb, null, b.action, { id: sp.id, by: me, sent: r.sent, errors: r.errors });
      return r;
    }

    case "spotlight_draft": {
      const sp = await getSpotlight(sb, b.id);
      if (sp.status === "drafted" && (sp.item_ids || []).length && !b.again) throw fail(409, "The drafts are already made - they're in the Approve tab");
      const settings = await loadSettings(sb);
      const r = await draftSpotlight(sb, { ...sp, status: "answered" }, { settings, by: me }).catch(e => { throw fail(400, e.message); });
      return r;
    }

    case "spotlight_cancel": {
      const sp = await getSpotlight(sb, b.id);
      const { data, error } = await sb.from("mkt_spotlights").update({ status: "cancelled" }).eq("id", sp.id).select("*").single();
      if (error) throw fail(500, error.message);
      await sb.from("mkt_ideas").update({ status: "dismissed", feedback: "Spotlight cancelled", decided_by: me, decided_at: new Date().toISOString() }).eq("spotlight_id", sp.id).eq("status", "new");
      return { spotlight: data };
    }

    case "photos_tag": {
      if (!aiReady()) throw fail(503, "Claude isn't connected (ANTHROPIC_API_KEY)");
      const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 8);
      let q = sb.from("mkt_photos").select("*");
      q = ids.length ? q.in("id", ids) : q.is("ai_at", null).eq("active", true).order("id").limit(6);
      const { data, error } = await q;
      if (error) throw fail(500, error.message);
      const r = await tagPhotos(sb, data || [], { mode: b.mode === "replace" ? "replace" : "fill", deadline: Date.now() + 100000 });
      const { count } = await sb.from("mkt_photos").select("id", { count: "exact", head: true }).is("ai_at", null).eq("active", true);
      if (r.photos.length) await log(sb, null, "photos_tag", { by: me, tagged: r.photos.length, errors: r.errors.length });
      return { ...r, remaining: count || 0 };
    }

    case "settings_save": {
      const p = b.patch && typeof b.patch === "object" ? b.patch : {};
      const cur = await loadSettings(sb);
      const row = { id: 1, updated_by: me };
      if ("voice" in p) row.voice = String(p.voice || "").slice(0, 4000);
      if ("weights" in p) { row.weights = { ...cur.weights }; for (const k of LINE_KEYS) if (p.weights && k in p.weights) row.weights[k] = Math.max(0, Math.min(10, Math.round(+p.weights[k] || 0))); }
      if ("cadence" in p && p.cadence && typeof p.cadence === "object") {
        row.cadence = { social: { ...cur.cadence.social, ...(p.cadence.social || {}) }, email: { ...cur.cadence.email, ...(p.cadence.email || {}) }, sms: { ...cur.cadence.sms, ...(p.cadence.sms || {}) } };
        row.cadence.social.rhythm = normRhythm(row.cadence.social.rhythm);
        row.cadence.social.mode = row.cadence.social.mode === "balance" ? "balance" : "rhythm";
        row.cadence.email.dedicated_lines = (row.cadence.email.dedicated_lines || []).filter(l => LINE_KEYS.includes(l));
      }
      if ("themes" in p) { row.themes = {}; for (const k of LINE_KEYS) { const v = (Array.isArray(p.themes?.[k]) ? p.themes[k] : String(p.themes?.[k] || "").split(/\n+/)).map(x => String(x).trim().slice(0, 300)).filter(Boolean).slice(0, 20); if (v.length) row.themes[k] = v; } }
      if ("auto_generate" in p) row.auto_generate = !!p.auto_generate;
      if ("plan_ahead" in p) row.plan_ahead = Math.max(0, Math.min(6, Math.round(+p.plan_ahead || 0)));
      if ("generate_day" in p) { const d = String(p.generate_day || "").slice(0, 3).toLowerCase(); if (!["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(d)) throw fail(400, "generate_day must be mon..sun"); row.generate_day = d; }
      if ("email_audience" in p) row.email_audience = p.email_audience && typeof p.email_audience === "object" ? p.email_audience : { source: "dssc_contacts" };
      if ("sms_filters" in p) row.sms_filters = p.sms_filters && typeof p.sms_filters === "object" ? p.sms_filters : {};
      if ("flair" in p) row.flair = Math.max(0, Math.min(2, Math.round(+p.flair || 0)));
      if ("scout" in p && p.scout && typeof p.scout === "object") {
        const sc = { ...(cur.scout || {}), ...p.scout };
        row.scout = { enabled: sc.enabled !== false, day: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(sc.day) ? sc.day : "sat", web: sc.web !== false,
          spotlight_every_weeks: Math.max(0, Math.min(12, Math.round(+sc.spotlight_every_weeks || 0))), via: (Array.isArray(sc.via) ? sc.via : ["email", "sms"]).filter(v => ["email", "sms"].includes(v)) };
      }
      if ("notify_emails" in p) row.notify_emails = (Array.isArray(p.notify_emails) ? p.notify_emails : String(p.notify_emails || "").split(/[\s,;]+/)).map(nrm).filter(isEmailish);
      const { data, error } = await sb.from("mkt_settings").upsert(row, { onConflict: "id" }).select("*").single();
      if (error) throw fail(500, error.message);
      return { settings: data };
    }

    case "priority_save": {
      const p = b.priority && typeof b.priority === "object" ? b.priority : {};
      const row = {};
      if ("title" in p) row.title = String(p.title || "").trim().slice(0, 200);
      if ("notes" in p) row.notes = String(p.notes || "").slice(0, 4000);
      if ("lines" in p) row.lines = (p.lines || []).filter(l => LINE_KEYS.includes(l));
      if ("avoid_lines" in p) row.avoid_lines = (p.avoid_lines || []).filter(l => LINE_KEYS.includes(l));
      if ("weight" in p) row.weight = Math.max(1, Math.min(5, Math.round(+p.weight || 3)));
      if ("starts_on" in p) row.starts_on = isDate(p.starts_on) ? p.starts_on : null;
      if ("ends_on" in p) row.ends_on = isDate(p.ends_on) ? p.ends_on : null;
      if ("channels" in p) row.channels = (p.channels || []).filter(c => ["social", "email", "sms"].includes(c));
      if ("active" in p) row.active = !!p.active;
      const id = Number(p.id);
      let q;
      if (Number.isInteger(id) && id > 0) q = sb.from("mkt_priorities").update(row).eq("id", id);
      else { if (!row.title) throw fail(400, "Give the priority a title"); q = sb.from("mkt_priorities").insert({ ...row, created_by: me }); }
      const { data, error } = await q.select("*").single();
      if (error) throw fail(500, error.message);
      return { priority: data };
    }

    case "priority_delete": {
      const id = Number(b.id);
      if (!Number.isInteger(id) || id <= 0) throw fail(400, "id is required");
      const { error } = await sb.from("mkt_priorities").delete().eq("id", id);
      if (error) throw fail(500, error.message);
      return { deleted: id };
    }

    default:
      throw fail(400, `Unknown action "${b.action || ""}"`);
  }
}
