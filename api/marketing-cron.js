// GET /api/marketing-cron — the Marketing Machine's clock (Vercel Cron, every 15 min).
//
//   1. Publish what's due (and email the directors what failed; a day ahead,
//      warn them when an approved post is due but Facebook can't post -
//      api/_lib/marketing-alerts.js): approved mkt_items with scheduled_at <= now
//      (social -> Facebook/Instagram, email -> Resend, text -> an sms_campaigns
//      row the texts cron sends). An email cut short mid-send resumes; a post
//      stuck in 'publishing' for 10+ minutes is marked failed so nobody
//      double-posts it blind.
//   2. Auto-draft: with auto_generate on, every empty week in the next
//      settings.plan_ahead weeks (default 2) is drafted (one per run) and
//      settings.notify_emails get a digest with the HQ link; on generate_day
//      after 5 pm Central, a reminder if next week still has drafts waiting.
//   3. Once a day: pull the website's photos.json into mkt_photos.
//   4. Every run: Claude catalogues up to 6 photos nobody has had looked at
//      yet (new uploads are usually done by HQ right away; this catches the rest).
//   5. Coach spotlights: answered interviews become drafts (and the directors
//      get a "drafts ready" email); an interview sent 3+ days ago with no
//      answer gets one reminder.
//   6. Weekly, on settings.scout.day after 9 am Central: the idea scout runs
//      and emails the directors its ideas with one-tap buttons.
//   7. A video whose sorting never finished (the page was closed mid-way) is
//      sorted here - one per run.
//   8. Newsletter sign-ups on drippingsportsclub.com join People on the
//      "Website newsletter" list; website unsubscribes stop HQ emails too
//      (api/_lib/site-subscribers.js).
//
//   ?dry=1           list what it would do; writes nothing, sends nothing
//   ?at=<ISO time>   (with dry=1) pretend it's that time - to check step 2
//
// Auth: Authorization: Bearer <CRON_SECRET> (Vercel Cron), ?token=<CRON_SECRET>,
// or the service-role key.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET + what api/_lib/marketing-publish.js needs.

import { safeEqual } from "./_lib/site-inbox.js";
import { syncSiteSubscribers } from "./_lib/site-subscribers.js";
import { failureAlert, metaHeadsUp } from "./_lib/marketing-alerts.js";
import { mondayOf, addDays } from "../shared/marketing-plan.js";
import { publishItem } from "./_lib/marketing-publish.js";
import { serviceSb, loadSettings, generateWeek, sendDigest, syncPhotos, log } from "./_lib/marketing-core.js";
import { tagPhotos } from "./_lib/marketing-photos-ai.js";
import { runScout, sendIdeasDigest, scoutSettings, sendSpotlightReady } from "./_lib/marketing-scout.js";
import { sendSpotlight, draftSpotlight } from "./_lib/marketing-spotlight.js";
import { analyzeVideo } from "./_lib/marketing-video.js";
import { aiReady } from "./_lib/marketing-ai.js";
import { registrationHeatmap, recommendCadence } from "../shared/marketing-timing.js";

// Recompute the schedule from Playbook purchases and save it when it changed.
async function retimeFromRegistrations(sb, settings, { dry = false } = {}) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("dssc_purchases").select("id, invoice, program, category, amount_cents, purchased_at").order("id").range(from, from + 999);
    if (error) throw new Error("dssc_purchases: " + error.message);
    rows.push(...(data || [])); if (!data || data.length < 1000) break;
  }
  const rec = recommendCadence(registrationHeatmap(rows), settings.cadence);
  if (!rec.ok) return { skipped: rec.reason };
  if (!rec.changes.length) { if (!dry) await log(sb, null, "timing", { changes: [] }); return { changes: [] }; }
  const cadence = { ...rec.cadence, social: { ...rec.cadence.social, auto_times: true } };
  if (!dry) {
    const { error } = await sb.from("mkt_settings").update({ cadence }).eq("id", 1);
    if (error) throw new Error("mkt_settings: " + error.message);
    await log(sb, null, "timing", { changes: rec.changes, summary: rec.summary });
  }
  return { changes: rec.changes, cadence: dry ? undefined : cadence };
}

const TZ = "America/Chicago";
export const centralClock = (d) => ({
  date: d.toLocaleDateString("en-CA", { timeZone: TZ }),
  dow: d.toLocaleDateString("en-US", { timeZone: TZ, weekday: "short" }).toLowerCase().slice(0, 3),
  hour: Number(d.toLocaleString("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" })),
});

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const { CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const url = (() => { try { return new URL(req.url, "https://x"); } catch { return null; } })();
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  const token = url?.searchParams.get("token") || "";
  const ok = (CRON_SECRET && (safeEqual(bearer, CRON_SECRET) || safeEqual(token, CRON_SECRET))) || (SUPABASE_SERVICE_ROLE_KEY && safeEqual(bearer, SUPABASE_SERVICE_ROLE_KEY));
  if (!ok) return res.status(403).json({ error: "Forbidden" });
  const sb = serviceSb();
  if (!sb) return res.status(500).json({ error: "Server not configured" });
  const dry = /^(1|true|yes)$/i.test(url?.searchParams.get("dry") || "");
  const atParam = dry ? url?.searchParams.get("at") : null;
  const now = atParam && !isNaN(new Date(atParam)) ? new Date(atParam) : new Date();
  try {
    return res.status(200).json({ ok: true, ...(await runCron(sb, { now, dry, deadline: Date.now() + 240000 })) });
  } catch (e) {
    console.error("marketing-cron", e);
    return res.status(500).json({ error: e.message || String(e) });
  }
}

export async function runCron(sb, { now = new Date(), dry = false, deadline = Date.now() + 240000 } = {}) {
  const out = { now: now.toISOString(), dry, published: [], stuck: [], auto: null, photos: null };
  const settings = await loadSettings(sb);
  const nowIso = now.toISOString();

  // ── 1. publish ──
  const { data: due, error } = await sb.from("mkt_items").select("*").eq("status", "approved").lte("scheduled_at", nowIso).order("scheduled_at").limit(25);
  if (error) throw new Error("mkt_items: " + error.message);
  const tenAgo = new Date(now.getTime() - 10 * 60e3).toISOString();
  const twoAgo = new Date(now.getTime() - 2 * 60e3).toISOString();
  const { data: stuck0 } = await sb.from("mkt_items").select("*").eq("status", "publishing").lt("updated_at", twoAgo).limit(25);
  // Emails and posts get 10 minutes before they count as stuck; a reel waiting on Instagram is checked every run.
  const stuck = (stuck0 || []).filter(it => (it.kind === "reel" && it.external_ids?.instagram_container) || it.updated_at < tenAgo);
  const resume = [];
  for (const it of stuck || []) {
    if (it.channel === "email") { resume.push(it); continue; }
    // A reel Instagram is still processing: check on it again (for up to 3 hours).
    if (it.kind === "reel" && it.external_ids?.instagram_container && Date.now() - new Date(it.scheduled_at || it.updated_at).getTime() < 3 * 3600e3) { resume.push(it); continue; }
    out.stuck.push({ id: it.id, channel: it.channel });
    if (!dry) {
      await sb.from("mkt_items").update({ status: "failed", error: "Publishing was interrupted - check Facebook / Instagram (or the text campaign) before trying again" }).eq("id", it.id).eq("status", "publishing");
      await log(sb, it.id, "publish_error", { interrupted: true });
    }
  }
  for (const it of [...resume, ...(due || [])]) {
    if (Date.now() > deadline - 20000) { out.published.push({ id: it.id, channel: it.channel, status: "deferred", error: "out of time - next run" }); continue; }
    out.published.push(await publishItem(sb, it, { settings, dry, deadline: Math.min(deadline - 15000, Date.now() + 120000), resume: it.status === "publishing" }).catch(e => ({ id: it.id, channel: it.channel, status: "error", error: e.message })));
  }
  // Tell the directors what just failed, and warn a day ahead when Facebook can't post.
  out.failure_alert = await failureAlert(sb, settings, [...out.published, ...out.stuck.map(s => ({ ...s, status: "failed", error: "Publishing was interrupted" }))], { dry }).catch(e => ({ error: e.message }));
  out.meta_heads_up = await metaHeadsUp(sb, settings, { now, dry }).catch(e => ({ error: e.message }));

  // ── 1b. best times, re-checked every Sunday morning (Settings: keep optimizing) ──
  const ctT = centralClock(now);
  if (settings.cadence?.social?.auto_times && ctT.dow === "sun" && ctT.hour >= 6) {
    const { data: tl } = await sb.from("mkt_log").select("id").eq("kind", "timing").gte("at", new Date(now.getTime() - 5 * 86400e3).toISOString()).limit(1);
    if (!tl?.length) {
      out.timing = await retimeFromRegistrations(sb, settings, { dry }).catch(e => ({ error: e.message }));
      if (out.timing?.cadence && !dry) settings.cadence = out.timing.cadence;
    }
  }

  // ── 2. keep the coming weeks drafted ──
  // Every empty week inside the horizon (settings.plan_ahead, default 2: next
  // week and the one after) is drafted - one week per run, each takes about a
  // minute - and the directors get the "drafts ready" email. A week the
  // machine already drafted once isn't redrafted if someone cleared it. On
  // generate_day after 5 pm, if next week still has drafts waiting, one
  // reminder goes out.
  const ct = centralClock(now);
  const thisMon = mondayOf(ct.date);
  const ahead = Math.max(0, Math.min(6, Number.isFinite(+settings.plan_ahead) ? +settings.plan_ahead : 2));
  out.auto = { enabled: !!settings.auto_generate, plan_ahead: ahead, weeks: [], ran: false };
  if (settings.auto_generate) {
    for (let i = 1; i <= ahead; i++) {
      const wk = addDays(thisMon, 7 * i);
      const { count } = await sb.from("mkt_items").select("id", { count: "exact", head: true }).eq("week_of", wk);
      const { data: done } = await sb.from("mkt_log").select("id").eq("kind", "auto_generate").contains("detail", { week_of: wk }).limit(1);
      if (count || done?.length) { out.auto.weeks.push({ week_of: wk, items: count || 0, already: !!done?.length }); continue; }
      out.auto.week_of = wk;
      if (dry) { out.auto.would = `draft the week of ${wk} and email ${(settings.notify_emails || []).join(", ")}`; break; }
      if (Date.now() > deadline - 110000) { out.auto.deferred = "out of time - next run"; break; }
      try {
        const r = await generateWeek(sb, { weekOf: wk, by: "auto", timeoutMs: Math.max(30000, Math.min(95000, deadline - Date.now() - 20000)) });
        out.auto.ran = true; out.auto.created = r.items.length; out.auto.ai = r.ai && { used: r.ai.used, error: r.ai.error };
        if (r.items.length) out.auto.digest = await sendDigest(sb, settings, wk, r.items).then(x => ({ ok: x.ok, error: x.error || null }));
      } catch (e) { out.auto.error = e.message; await log(sb, null, "auto_generate_error", { week_of: wk, error: e.message }); }
      break;
    }
    const nextWeek = addDays(thisMon, 7);
    if (ct.dow === String(settings.generate_day || "sun").slice(0, 3) && ct.hour >= 17) {
      const { data: waiting } = await sb.from("mkt_items").select("*").eq("week_of", nextWeek).eq("status", "draft");
      const { data: sent } = await sb.from("mkt_log").select("id").eq("kind", "review_reminder").contains("detail", { week_of: nextWeek }).limit(1);
      // Not on the heels of the "drafts ready" email: drafts made in the last 20 hours don't need a reminder yet.
      const justDrafted = (out.auto.ran && out.auto.week_of === nextWeek) || (waiting || []).some(i => i.created_at && now - new Date(i.created_at) < 20 * 3600e3);
      if (waiting?.length && !sent?.length && !justDrafted) {
        if (dry) out.auto.would_remind = `${waiting.length} drafts waiting for the week of ${nextWeek}`;
        else out.auto.reminder = await sendDigest(sb, settings, nextWeek, waiting, { reminder: true }).then(x => ({ ok: x.ok, error: x.error || null }));
      }
    }
  }

  // ── 3. photo library, once a day ──
  const dayAgo = new Date(now.getTime() - 20 * 3600e3).toISOString();
  const { data: synced } = await sb.from("mkt_log").select("id").eq("kind", "photos_sync").gte("at", dayAgo).limit(1);
  if (!synced?.length) out.photos = await syncPhotos(sb, { dry }).catch(e => ({ ok: false, error: e.message }));
  else out.photos = { skipped: "synced in the last 20 hours" };

  // ── 5. coach spotlights ──
  out.spotlights = { drafted: [], reminded: [] };
  const { data: answered } = await sb.from("mkt_spotlights").select("*").eq("status", "answered").limit(3);
  for (const sp of answered || []) {
    if (dry) { out.spotlights.drafted.push({ id: sp.id, would: "draft" }); continue; }
    if (Date.now() > deadline - 100000) break;
    try {
      const r = await draftSpotlight(sb, sp, { settings, today: centralClock(now).date });
      out.spotlights.drafted.push({ id: sp.id, items: r.items.length, ai: r.ai });
      await sendSpotlightReady(sb, settings, r.spotlight, r.items).catch(() => null);
    } catch (e) { out.spotlights.drafted.push({ id: sp.id, error: e.message }); await sb.from("mkt_spotlights").update({ error: e.message.slice(0, 300) }).eq("id", sp.id); }
  }
  const threeDays = new Date(now.getTime() - 3 * 86400e3).toISOString();
  const { data: quiet } = await sb.from("mkt_spotlights").select("*").eq("status", "sent").is("reminded_at", null).lt("sent_at", threeDays).limit(3);
  for (const sp of quiet || []) {
    if (dry) { out.spotlights.reminded.push({ id: sp.id, would: "remind" }); continue; }
    const r = await sendSpotlight(sb, sp, { via: sp.sent_via?.length ? sp.sent_via : ["email", "sms"], by: "auto", reminder: true }).catch(e => ({ error: e.message }));
    out.spotlights.reminded.push({ id: sp.id, sent: r.sent || null, error: r.error || null });
  }

  // ── 6. the weekly idea scout ──
  const sc = scoutSettings(settings);
  out.scout = { day: sc.day, enabled: sc.enabled, ran: false };
  if (sc.enabled && ct.dow === sc.day && ct.hour >= 9) {
    const { data: ran } = await sb.from("mkt_log").select("id").eq("kind", "scout").gte("at", new Date(now.getTime() - 5 * 86400e3).toISOString()).limit(1);
    if (ran?.length) out.scout.already = true;
    else if (dry) out.scout.would = `suggest ideas and email ${(settings.notify_emails || []).join(", ")}`;
    else if (Date.now() < deadline - 120000) {
      try {
        const r = await runScout(sb, { now, by: "scout", deadline: Math.min(deadline - 15000, Date.now() + 110000) });
        out.scout = { ...out.scout, ran: true, ideas: r.ideas.length, spotlight: r.spotlight?.id || null, error: r.error || null };
        if (r.ideas.length) out.scout.digest = await sendIdeasDigest(sb, settings, r.ideas, r.spotlight).then(x => ({ ok: x.ok, error: x.error || null }));
      } catch (e) { out.scout.error = e.message; await log(sb, null, "scout_error", { error: e.message }); }
    } else out.scout.deferred = "out of time - next run";
  }

  // ── 7. videos left half-sorted ──
  const eightAgo = new Date(now.getTime() - 8 * 60e3).toISOString();
  const { data: stale } = await sb.from("mkt_videos").select("*").eq("status", "analyzing").is("ai_at", null).lt("updated_at", eightAgo).limit(1);
  if (stale?.length) {
    if (dry) out.videos = { would: `sort video #${stale[0].id}` };
    else if (Date.now() < deadline - 150000) out.videos = await analyzeVideo(sb, stale[0], { deadline: Math.min(deadline - 20000, Date.now() + 200000), settings }).then(v => ({ id: v.id, status: v.status, moments: (v.moments || []).length }), e => ({ id: stale[0].id, error: e.message }));
  }

  // ── 8. website newsletter sign-ups ──
  out.site_subscribers = await syncSiteSubscribers(sb, { dry }).catch(e => ({ error: e.message }));
  if (!dry && (out.site_subscribers.added?.length || out.site_subscribers.unsubscribed?.length)) await log(sb, null, "site_subscribers", out.site_subscribers);

  // ── 4. the AI librarian ──
  if (aiReady() && !dry && Date.now() < deadline - 60000) {
    const { data: todo } = await sb.from("mkt_photos").select("*").is("ai_at", null).eq("active", true).order("id").limit(6);
    if (todo?.length) {
      const r = await tagPhotos(sb, todo, { mode: "fill", deadline: Math.min(deadline - 10000, Date.now() + 90000) });
      out.photo_ai = { tagged: r.photos.length, errors: r.errors.length };
    }
  }
  return out;
}
