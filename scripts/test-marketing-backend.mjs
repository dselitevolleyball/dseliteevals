// Offline checks for the Marketing Machine's server side - no Supabase, Meta,
// Resend, Twilio or Anthropic calls. Uses the LIVE programs feed (one public
// GET) unless --feed <file> is given; everything else is stubbed:
//   - an in-memory Supabase (just the query-builder calls the code uses)
//   - fetch: the programs feed passes through; graph.facebook.com and
//     api.resend.com answer with fakes and are recorded
//
//   NODE_USE_ENV_PROXY=1 node scripts/test-marketing-backend.mjs
//
// 1. template copy (no ANTHROPIC_API_KEY) for the 4 Thanksgiving weeks: every
//    item has copy, a real https CTA, a graphic spec; no rule breaks
// 2. generateWeek against the fake DB (inserts drafts, replace_drafts keeps
//    edited ones, fills only gaps)
// 3. marketing-cron: ?dry=1 writes nothing; a real run publishes due approved
//    items (FB + IG via fake Graph, email via fake Resend batch with
//    unsubscribe links, text -> sms_campaigns row), resumes nothing twice
// 4. the unsubscribe token round trip

import { readFileSync } from "node:fs";

delete process.env.ANTHROPIC_API_KEY;
Object.assign(process.env, {
  META_PAGE_ACCESS_TOKEN: "test-token", META_PAGE_ID: "111", META_IG_USER_ID: "222",
  RESEND_API_KEY: "re_test", DSSC_FROM_EMAIL: "Dripping Springs Sports Club <hello@drippingsportsclub.com>",
  MARKETING_UNSUB_SECRET: "unit-test-secret", TWILIO_ACCOUNT_SID: "AC_test", TWILIO_AUTH_TOKEN: "x", DSSC_TWILIO_FROM_NUMBER: "+15125550000",
});

const args = process.argv.slice(2);
const feedPath = args.includes("--feed") ? args[args.indexOf("--feed") + 1] : null;
const realFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith("https://www.drippingsportsclub.com/api/programs")) {
    if (feedPath) return new Response(readFileSync(feedPath, "utf8"), { status: 200, headers: { "content-type": "application/json" } });
    return realFetch(url, init);
  }
  if (u.startsWith("https://www.drippingsportsclub.com/photos.json")) {
    return new Response(JSON.stringify({ photos: [
      { key: "vb1", url: "https://www.drippingsportsclub.com/photos/vb1.jpg", width: 1600, height: 1067, alt: "Volleyball", tags: ["volleyball", "kids"], line: "volleyball" },
      { key: "camp1", url: "https://www.drippingsportsclub.com/photos/camp1.jpg", width: 1600, height: 1067, alt: "Camp", tags: ["camp", "kids"], line: "camp_elevate" },
      { key: "bb1", url: "https://www.drippingsportsclub.com/photos/bb1.jpg", width: 1600, height: 1067, alt: "Hoops", tags: ["basketball"], line: "basketball" },
      { key: "party1", url: "https://www.drippingsportsclub.com/photos/party1.jpg", width: 1600, height: 1067, alt: "Party", tags: ["parties", "kids"], line: "parties" },
      { key: "fac1", url: "https://www.drippingsportsclub.com/photos/fac1.jpg", width: 1600, height: 1067, alt: "The Warehouse", tags: ["facility"], line: null },
    ] }), { status: 200 });
  }
  if (u.startsWith("https://graph.facebook.com/")) {
    calls.push({ to: "meta", url: u.split("?")[0], body: init.body ? String(init.body) : null });
    if (u.includes("/photo_stories")) return new Response(JSON.stringify({ success: true, post_id: "111_story" }));
    if (u.includes("/photos")) return new Response(JSON.stringify({ id: "ph1", post_id: "111_999" }));
    if (u.includes("/media_publish")) return new Response(JSON.stringify({ id: "ig_media_1" }));
    if (u.includes("/media")) return new Response(JSON.stringify({ id: "container_1" }));
    return new Response(JSON.stringify({ status_code: "FINISHED" }));
  }
  if (u.startsWith("https://api.resend.com/")) {
    const payload = JSON.parse(init.body);
    calls.push({ to: "resend", url: u, count: Array.isArray(payload) ? payload.length : 1, sample: Array.isArray(payload) ? payload[0] : payload, idem: init.headers?.["Idempotency-Key"] });
    return new Response(JSON.stringify(Array.isArray(payload) ? { data: payload.map((_, i) => ({ id: "em_" + i })) } : { id: "em_1" }));
  }
  if (u.startsWith("https://api.anthropic.com/")) {
    const req = JSON.parse(init.body);
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    calls.push({ to: "anthropic", req, headers });
    return new Response(JSON.stringify(anthropicReply(req)), { status: 200, headers: { "content-type": "application/json", "request-id": "req_test" } });
  }
  throw new Error("Unexpected outbound fetch in test: " + u);
};

// The fake Claude: echoes one item per slot; slot 1 breaks a rule (a price)
// so it must fall back to the template; mode "refusal" declines.
let anthropicMode = "ok";
function anthropicReply(req) {
  const base = { id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5", usage: { input_tokens: 10, output_tokens: 10 } };
  if (anthropicMode === "refusal") return { ...base, content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: null } };
  if (Array.isArray(req.messages[0].content)) {      // the photo librarian
    const url = req.messages[0].content.find(b => b.type === "image")?.source?.url || "";
    const ai = /bad/.test(url) ? null : { line: "basketball", tags: ["basketball", "kids", "action", "made_up_tag"], description: "Kids in a basketball skill lab shooting layups.", alt: "Kids shooting layups at DSSC", people: "kids", setting: "court", uses: ["social_post", "story", "nope"], quality: 4, minors: true };
    return ai ? { ...base, content: [{ type: "text", text: JSON.stringify(ai) }], stop_reason: "end_turn" } : { ...base, content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: null } };
  }
  const reqJson = JSON.parse(req.messages[0].content.slice(req.messages[0].content.indexOf("{")));
  const slots = reqJson.slots || [reqJson.slot];
  const items = slots.map((s, i) => ({
    slot: s.slot ?? i, headline: i === 0 ? "Camp Elevate Is Back" : "Big Week At DSSC", accent: i === 0 ? "Elevate" : "Week", sub: "Nov 23–25 · 9 am–3 pm", tag: "CAMP ELEVATE",
    body: i === 1 ? "Only $40 a day!" : "A full day of games for your kids over Thanksgiving break 🏐 Sign up at https://evil.example.com today.",
    cta_text: "Sign up now", hashtags: ["#DrippingSprings", "CampElevate"], email_subject: s.channel === "email" ? "Camp Elevate: Nov 23–25 🎉🎉" : "", email_preheader: s.channel === "email" ? "Pick one day or all three" : "",
    email_blocks: (s.programs || []).map(p => ({ ref: p.id, blurb: `${p.name} - ${p.first_date_label}.` })), photo_tags: ["camp"],
  }));
  return { ...base, content: [{ type: "text", text: JSON.stringify({ items }) }], stop_reason: "end_turn" };
}

import { fakeSupabase } from "./lib/fake-supabase.mjs";

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) fails++; };

const { planWeek } = await import("../shared/marketing-plan.js");
const { composeItems, ruleProblems, buildEmail, ctIso } = await import("../api/_lib/marketing-ai.js");
const core = await import("../api/_lib/marketing-core.js");
const { runCron } = await import("../api/marketing-cron.js");
const pub = await import("../api/_lib/marketing-publish.js");

const feed = await core.fetchPrograms();
const THANKSGIVING = { id: 1, title: "Thanksgiving break — push Camp Elevate", notes: "Thanksgiving break (Nov 23–25): push Camp Elevate hard, plus the volleyball and basketball break camps/clinics. Camp Elevate is a full-day, every-sport camp — pick one day or all three.", lines: ["camp_elevate", "volleyball", "basketball"], avoid_lines: [], weight: 5, starts_on: "2026-10-26", ends_on: "2026-11-24", channels: ["social", "email", "sms"], active: true };
const settings = { ...core.SETTINGS_DEFAULTS };

// ── 1. template copy ─────────────────────────────────────────────────────────
console.log("== 1. template copy (no ANTHROPIC_API_KEY) ==");
check(ctIso("2026-11-02", "18:30") === "2026-11-03T00:30:00.000Z", `ctIso CST: 2026-11-02 18:30 CT -> ${ctIso("2026-11-02", "18:30")}`);
check(ctIso("2026-10-28", "18:30") === "2026-10-28T23:30:00.000Z", `ctIso CDT: 2026-10-28 18:30 CT -> ${ctIso("2026-10-28", "18:30")}`);
const photos = [
  { url: "https://x/vb.jpg", key: "vb", tags: ["volleyball"], line: "volleyball", active: true },
  { url: "https://x/camp.jpg", key: "camp", tags: ["camp", "kids"], line: "camp_elevate", active: true },
  { url: "https://x/camp2.jpg", key: "camp2", tags: ["kids"], line: null, active: true },
  { url: "https://x/party.jpg", key: "party", tags: ["parties"], line: "parties", active: true },
];
let hist = [];
for (const w of ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"]) {
  const plan = planWeek({ weekOf: w, programs: feed.programs, priorities: [THANKSGIVING], settings, history: hist });
  const { rows, ai } = await composeItems({ slots: plan.slots, weekOf: w, programs: feed.programs, priorities: [THANKSGIVING], settings, photos });
  check(!ai.used && /ANTHROPIC_API_KEY/.test(ai.error || ""), `${w}: template fallback used (${ai.error})`);
  check(rows.length === plan.slots.length, `${w}: ${rows.length} rows for ${plan.slots.length} slots`);
  for (const r of rows) {
    const text = [r.headline, r.body, r.email_subject, r.email_preheader, ...(r.email_blocks || []).map(b => b.blurb)].join(" ");
    const probs = ruleProblems(text);
    const okUrl = /^https:\/\/(www\.drippingsportsclub\.com|drippingsports\.playbookapi\.com)\//.test(r.cta_url);
    if (probs.length || !okUrl || !r.body || !r.headline || (r.channel !== "sms" && !r.graphic)) check(false, `${w} ${r.channel} ${r.line}: problems=${probs} url=${r.cta_url}`);
    if (r.channel === "email") check(r.email_html.includes("{{unsubscribe_url}}") && r.email_html.includes("15113 Fitzhugh Rd") && !/flex/i.test(r.email_html), `${w}: email html has unsubscribe placeholder + address, no Flex (${r.email_html.length} chars)`);
    if (r.channel === "sms") check(/Reply STOP to opt out\.$/.test(r.body) && r.body.includes(r.cta_url) && r.audience?.target === "parents", `${w}: text ends with link + STOP, audience = campaign filters`);
  }
  if (w === "2026-10-26" || w === "2026-11-16") {
    for (const r of rows) console.log(`  [${r.channel}/${r.line}/${r.angle}] ${r.scheduled_at}  ${r.headline} | ${r.channel === "email" ? r.email_subject + " | " : ""}${String(r.body).replace(/\n/g, " ").slice(0, 150)}  -> ${r.cta_text}: ${r.cta_url}  graphic=${r.graphic ? `${r.graphic.template}/${r.graphic.date_label || "-"}/${r.graphic.photo_key || "no photo"}` : "-"}`);
  }
  hist = hist.concat(plan.slots.map(s => ({ week_of: w, channel: s.channel, line: s.line, status: "draft" })));
}
check(ruleProblems("Only $40 a session!").length && ruleProblems("Just 3 spots left").length && ruleProblems("at the Flex").length && !ruleProblems("Free throws and layups").length, "rule checks catch price / spots left / Flex, allow 'free throws'");

// ── 2. generateWeek against the fake DB ──────────────────────────────────────
console.log("\n== 2. generateWeek (fake DB) ==");
const sb = fakeSupabase({
  mkt_settings: [{ id: 1, ...core.SETTINGS_DEFAULTS }],
  mkt_priorities: [THANKSGIVING],
  mkt_items: [], mkt_photos: [], mkt_log: [], mkt_unsubscribes: [{ email: "gone@example.com" }], mkt_spotlights: [], mkt_ideas: [],
  dssc_contacts: Array.from({ length: 230 }, (_, i) => ({ id: i + 1, email: i === 5 ? "GONE@example.com" : i === 7 ? null : `family${i}@example.com`, first_name: "F" + i })),
  sms_campaigns: [],
});
const ps = await core.syncPhotos(sb);
check(ps.ok && ps.added === 5 && sb.db.mkt_photos.length === 5, `photos_sync added ${ps.added} of ${ps.total}`);
const g1 = await core.generateWeek(sb, { weekOf: "2026-11-02", by: "drew@drippingsportsclub.com" });
check(g1.items.length >= 5 && g1.items.every(i => i.status === "draft"), `generated ${g1.items.length} drafts for 2026-11-02 (ai: ${g1.ai.error})`);
// PostgREST inserts a batch with the union of its rows' keys and NULL for a
// missing one, so every row must carry the same keys (email_blocks is NOT NULL).
const keySets = new Set(sb.inserted.mkt_items.map(r => Object.keys(r).sort().join(",")));
check(keySets.size === 1 && sb.inserted.mkt_items.every(r => Array.isArray(r.email_blocks)), `every drafted row has the same columns (${keySets.size} shape${keySets.size === 1 ? "" : "s"}) and an email_blocks array`);
check(g1.items.filter(i => i.channel === "social").every(i => i.graphic?.photo_url), "every social draft has a library photo");
const kinds = g1.items.map(i => i.kind);
check(["post", "follow_up", "roundup"].every(k => kinds.includes(k)) && g1.items.every(i => i.kind), `calendar rhythm kinds: ${kinds.join(", ")}`);
const fu = g1.items.filter(i => i.kind === "follow_up");
check(fu.length && fu.every(i => i.graphic.format === "story" && i.platforms.join() === "instagram_story,facebook_story" && i.theme), `follow-up stories: story format, story platforms, a theme (${fu.map(i => i.graphic.template).join(", ")})`);
check(g1.items.filter(i => i.kind === "post").every(i => i.graphic.format === "post" && i.platforms.join() === "facebook,instagram"), "posts stay feed posts");
const g2 = await core.generateWeek(sb, { weekOf: "2026-11-02", by: "drew@drippingsportsclub.com" });
check(g2.items.length === 0, `generate again without replace adds nothing (${g2.notes.slice(-1)[0]})`);
const edited = sb.db.mkt_items.find(i => i.channel === "social");
edited.headline = "DREW'S EDIT"; edited.updated_at = new Date(Date.now() + 60000).toISOString();
const g3 = await core.generateWeek(sb, { weekOf: "2026-11-02", replaceDrafts: true, by: "drew@drippingsportsclub.com" });
check(g3.kept === 1 && g3.removed === g1.items.length - 1 && sb.db.mkt_items.some(i => i.headline === "DREW'S EDIT") && sb.db.mkt_items.length === g1.items.length, `replace_drafts kept the edited draft, removed ${g3.removed}, re-made ${g3.items.length}`);
const one = await core.generateWeek(sb, { weekOf: "2026-11-02", single: { program_id: "78326" }, instruction: "Make a post about Camp Elevate", by: "drew@drippingsportsclub.com" });
check(one.items.length === 1 && one.items[0].line === "camp_elevate" && /Requested/.test(one.items[0].reason), `single draft: ${one.items[0]?.line} on ${one.items[0]?.scheduled_at}`);

// ── 3. cron ──────────────────────────────────────────────────────────────────
console.log("\n== 3. marketing-cron ==");
// Approve one of each channel, due in the past.
const past = new Date(Date.now() - 3600e3).toISOString();
const pick = (ch) => sb.db.mkt_items.find(i => i.channel === ch && i.status === "draft");
const soc = pick("social"), em = pick("email"), tx = pick("sms") || (sb.db.mkt_items.push({ id: 5000, week_of: "2026-11-02", channel: "sms", line: "camp_elevate", status: "draft", body: "DSSC: Camp Elevate test https://x Reply STOP to opt out.", audience: {}, external_ids: {}, revisions: [], created_at: past, updated_at: past }), sb.db.mkt_items.find(i => i.id === 5000));
for (const it of [soc, em, tx]) Object.assign(it, { status: "approved", approved_by: "drew@drippingsportsclub.com", scheduled_at: past, asset_url: it.channel === "social" ? "https://example.supabase.co/storage/v1/object/public/marketing/items/1/1.png" : it.asset_url });
const story = sb.db.mkt_items.find(i => i.kind === "follow_up" && i.status === "draft");
Object.assign(story, { status: "approved", approved_by: "drew@drippingsportsclub.com", scheduled_at: past, asset_url: "https://x/story.png", asset_story_url: "https://x/story-s.png" });
const later = pick("social"); Object.assign(later, { status: "approved", asset_url: "https://x/y.png", scheduled_at: new Date(Date.now() + 86400e3).toISOString() });
const before = JSON.stringify(sb.db);
const dry = await runCron(sb, { dry: true });
check(JSON.stringify(sb.db) === before && calls.length === 0, `dry run wrote nothing and called nothing (would publish ${dry.published.length}: ${dry.published.map(p => p.channel).join(", ")})`);
console.log("  dry plan:", JSON.stringify(dry.published.map(p => ({ id: p.id, channel: p.channel, plan: p.plan && (p.plan.platforms || p.plan.total || p.plan.sms_campaign?.status) }))));
const live = await runCron(sb, { deadline: Date.now() + 120000 });
const byId = (id) => sb.db.mkt_items.find(i => i.id === id);
check(byId(soc.id).status === "published" && byId(soc.id).external_ids.facebook === "111_999" && byId(soc.id).external_ids.instagram === "ig_media_1", `social published: ${JSON.stringify(byId(soc.id).external_ids)}`);
const metaCalls = calls.filter(c => c.to === "meta").map(c => c.url.replace("https://graph.facebook.com/", ""));
check(metaCalls.includes("v26.0/111/photos") && metaCalls.includes("v26.0/222/media") && metaCalls.includes("v26.0/222/media_publish"), `Graph calls: ${metaCalls.join(", ")}`);
check(byId(story.id).status === "published" && byId(story.id).external_ids.instagram_story === "ig_media_1" && byId(story.id).external_ids.facebook_story === "111_story" && metaCalls.includes("v26.0/111/photo_stories"), `story published to IG + FB stories: ${JSON.stringify(byId(story.id).external_ids)}`);
const fbBody = new URLSearchParams(calls.find(c => c.url.endsWith("/111/photos")).body);
check(fbBody.get("url") === soc.asset_url && fbBody.get("caption").includes(soc.cta_url) && /#DrippingSprings/.test(fbBody.get("caption")), "FB post carries the rendered PNG, the caption with link and hashtags");
const rs = calls.filter(c => c.to === "resend");
check(byId(em.id).status === "published" && byId(em.id).external_ids.email.sent === 228 && rs.length === 3, `email published to ${byId(em.id).external_ids.email.sent} (230 contacts - 1 no email - 1 unsubscribed) in ${rs.length} batches of ≤100`);
const s0 = rs[0].sample;
check(s0.headers["List-Unsubscribe"].includes("/hq/api/marketing-unsubscribe?e=") && s0.html.includes("marketing-unsubscribe?e=" + encodeURIComponent(s0.to[0])) && !s0.html.includes("{{unsubscribe_url}}") && s0.reply_to === "info@drippingsportsclub.com", "each email has its own unsubscribe link + header, replies go to info@");
check(!rs.some(c => JSON.stringify(c.sample).includes("gone@example.com")), "unsubscribed address skipped");
const camp = sb.db.sms_campaigns[0];
check(byId(tx.id).status === "published" && camp && camp.status === "scheduled" && camp.brand === "dssc" && camp.body === tx.body && byId(tx.id).sms_campaign_id === camp.id && camp.filters.target === "parents", `text handed to sms_campaigns #${camp?.id} (scheduled, dssc, filters ok)`);
check(byId(later.id).status === "approved", "an item scheduled for tomorrow waits");
const n = calls.length;
const again = await runCron(sb, {});
check(calls.length === n && again.published.length === 0, "second run publishes nothing twice");
check(live.photos?.skipped || live.photos?.ok, `photos step: ${JSON.stringify(live.photos)}`);

// Auto-generate: a Sunday after 5 pm CT, next week empty.
const sunday = new Date("2026-11-08T23:30:00Z"); // Sun Nov 8, 5:30 pm CST
const autoDry = await runCron(sb, { now: sunday, dry: true });
check(autoDry.auto && autoDry.auto.week_of === "2026-11-09" && /generate the week of 2026-11-09/.test(autoDry.auto.would || ""), `auto-generate (dry) on Sunday 5:30 pm CT: ${autoDry.auto.would}`);
const auto = await runCron(sb, { now: sunday, deadline: Date.now() + 200000 });
check(auto.auto.ran && auto.auto.created > 0 && auto.auto.digest?.ok, `auto-generated ${auto.auto.created} drafts for 2026-11-09 and sent the digest`);
const digest = calls.filter(c => c.to === "resend" && !Array.isArray(c.sample?.to) || (c.to === "resend" && c.count === 1 && /drafts? ready/.test(c.sample.subject || ""))).pop();
check(digest && /drafts? ready for the week of Mon, Nov 9/.test(digest.sample.subject) && digest.sample.html.includes("view=dsscmarketing&week=2026-11-09"), `digest: "${digest?.sample.subject}"`);
const auto2 = await runCron(sb, { now: new Date("2026-11-09T00:00:00Z") });
check(!auto2.auto.ran, "auto-generate doesn't run twice for the same week");
const mon = await runCron(sb, { now: new Date("2026-11-09T23:30:00Z"), dry: true });
check(!mon.auto.would, "nothing auto-generated on a Monday");

// ── 5. Claude request shape + fallbacks (fake API) ───────────────────────────
console.log("\n== 5. Claude call (stubbed API) ==");
process.env.ANTHROPIC_API_KEY = "sk-test";
const planA = planWeek({ weekOf: "2026-11-16", programs: feed.programs, priorities: [THANKSGIVING], settings, history: [] });
const ra = await composeItems({ slots: planA.slots, weekOf: "2026-11-16", programs: feed.programs, priorities: [THANKSGIVING], settings: { ...settings, voice: "Say 'families'." }, photos });
const call = calls.filter(c => c.to === "anthropic").pop();
check(call && call.req.model === "claude-opus-5-5" && call.req.fallbacks === "default" && /server-side-fallback-2026-07-01/.test(call.headers["anthropic-beta"] || ""), `model ${call?.req.model}, fallbacks ${call?.req.fallbacks}, beta header ${call?.headers["anthropic-beta"]}`);
check(call.req.output_config?.effort === "medium" && call.req.output_config?.format?.type === "json_schema" && call.req.max_tokens === 16000, "output_config: effort medium + json_schema; max_tokens 16000");
check(!("temperature" in call.req) && !("top_p" in call.req) && !("top_k" in call.req) && !("thinking" in call.req), "no temperature / top_p / top_k / thinking sent");
check(Array.isArray(call.req.system) && call.req.system[1].cache_control?.type === "ephemeral" && !/\b20\d\d-\d\d-\d\d\b/.test(call.req.system.map(b => b.text).join(" ")), "system prompt cached, no dates in it");
check(call.req.messages[0].content.includes("2026-11-16") && call.req.messages[0].content.includes("Thanksgiving break") && !/flex/i.test(call.req.messages[0].content), "week + priorities in the user message; no Flex in the facts");
check(ra.ai.used && ra.ai.fallbacks.length === 1 && ra.ai.fallbacks[0].slot === 1 && /price/.test(ra.ai.fallbacks[0].why), `AI used; slot 1 fell back (${JSON.stringify(ra.ai.fallbacks)})`);
const r0 = ra.rows[0];
check(!/evil\.example/.test(r0.body) && r0.cta_url.startsWith("https://drippingsports.playbookapi.com/") && (r0.body.match(/\p{Extended_Pictographic}/gu) || []).length <= 2 && r0.hashtags.every(h => !h.startsWith("#")), `AI copy cleaned: URL stripped, CTA from the feed, hashtags bare (${r0.body})`);
const remail = ra.rows.find(r => r.channel === "email");
check((remail.email_subject.match(/\p{Extended_Pictographic}/gu) || []).length <= 1, `email subject has at most one emoji (${remail.email_subject})`);
anthropicMode = "refusal";
const rr = await composeItems({ slots: planA.slots, weekOf: "2026-11-16", programs: feed.programs, priorities: [THANKSGIVING], settings, photos });
check(!rr.ai.used && /declined/.test(rr.ai.error) && rr.rows.length === planA.slots.length, `refusal -> template copy for the whole week (${rr.ai.error})`);
anthropicMode = "ok";
const { reviseItem } = await import("../api/_lib/marketing-ai.js");
const rv = await reviseItem({ item: { ...ra.rows[0], id: 1, graphic: { ...ra.rows[0].graphic } }, instruction: "Shorter, and use a different photo", programs: feed.programs, settings, photos });
check(rv.patch && rv.patch.headline === "Camp Elevate Is Back" && rv.patch.graphic.photo_url !== ra.rows[0].graphic.photo_url && rv.patch.asset_url === null, `revise: new copy, new photo (${rv.patch?.graphic?.photo_url}), asset cleared for re-render`);

// The AI photo librarian.
const { tagPhotos, photoPatch } = await import("../api/_lib/marketing-photos-ai.js");
const { pickPhoto } = await import("../api/_lib/marketing-ai.js");
const psb = fakeSupabase({ mkt_photos: [
  { id: 1, url: "https://x.supabase.co/storage/v1/object/public/marketing/uploads/1-img-4821.jpg", source: "upload", filename: "IMG_4821.jpg", alt: "IMG 4821", tags: [], line: null, active: true },
  { id: 2, url: "https://www.drippingsportsclub.com/photos/vb1.jpg", source: "site", alt: "Volleyball pods", tags: ["volleyball"], line: "volleyball", active: true, release_ok: true },
  { id: 3, url: "https://x/bad.jpg", source: "upload", alt: "", tags: [], line: null, active: true },
] });
const tp = await tagPhotos(psb, psb.db.mkt_photos.slice(), { mode: "fill" });
const pcall = calls.filter(c => c.to === "anthropic" && Array.isArray(c.req.messages[0].content)).pop();
check(pcall && pcall.req.model === "claude-opus-5-5" && pcall.req.output_config?.effort === "low" && pcall.req.output_config?.format?.type === "json_schema" && pcall.req.fallbacks === "default" && pcall.req.messages[0].content[0].source.type === "url" && !("temperature" in pcall.req), "photo request: Opus 5.5, effort low, json_schema, fallbacks, image by URL");
const p1 = psb.db.mkt_photos.find(p => p.id === 1), p2 = psb.db.mkt_photos.find(p => p.id === 2), p3 = psb.db.mkt_photos.find(p => p.id === 3);
check(tp.photos.length === 2 && p1.line === "basketball" && p1.alt === "Kids shooting layups at DSSC" && p1.quality === 4 && p1.minors === true && p1.uses.join() === "social_post,story" && !p1.tags.includes("made_up_tag") && p1.ai_at, `upload catalogued: ${p1.line}, "${p1.alt}", tags ${p1.tags.join(",")}`);
check(p2.line === "volleyball" && p2.alt === "Volleyball pods" && p2.tags.includes("volleyball") && p2.tags.includes("action") && p2.release_ok === true, "fill mode keeps a site photo's line, alt text and tags (adds to them)");
check(tp.errors.length === 1 && tp.errors[0].id === 3 && /declined/.test(p3.ai_error) && p3.line === null, `a refusal leaves the photo alone with ai_error (${p3.ai_error})`);
const rep2 = photoPatch(p2, { line: "club", tags: ["community"], alt: "New alt", people: "mixed", setting: "event", uses: [], quality: 2, minors: false }, { mode: "replace" });
check(rep2.line === "club" && rep2.tags.join() === "community" && rep2.alt === "New alt", "replace mode overwrites line, tags and alt text");
const lib = [
  { url: "https://x/a.jpg", line: "basketball", tags: ["basketball"], width: 1600, height: 1067, quality: 5, active: true },
  { url: "https://x/b.jpg", line: "basketball", tags: ["basketball"], width: 1067, height: 1600, quality: 3, active: true, uses: ["story"] },
  { url: "https://x/c.jpg", line: "basketball", tags: ["basketball"], width: 1600, height: 1067, quality: 5, active: true, release_ok: false },
];
check(pickPhoto(lib, "basketball", { format: "post" }).url === "https://x/a.jpg" && pickPhoto(lib, "basketball", { format: "story" }).url === "https://x/b.jpg" && ![1, 2, 3, 4, 5].some(i => pickPhoto(lib, "basketball", { seed: String(i) }).url === "https://x/c.jpg"), "photo pick: quality wins for posts, a tall photo for stories, never a 'don't post' photo");
delete process.env.ANTHROPIC_API_KEY;

// ── 6. POST /api/marketing actions (run() against the fake DB) ──────────────
console.log("\n== 6. API actions ==");
const { run } = await import("../api/marketing.js");
const sb2 = fakeSupabase({ mkt_settings: [{ id: 1, ...core.SETTINGS_DEFAULTS }], mkt_priorities: [THANKSGIVING], mkt_items: [], mkt_photos: [], mkt_log: [], mkt_unsubscribes: [], dssc_contacts: [], sms_campaigns: [], coach_roster: [] });
const me = { me: "drew@drippingsportsclub.com", name: "Drew Rose" };
const A = (action, extra = {}) => run(sb2, me, { action, ...extra });
const st = await A("status");
check(st.connections && typeof st.connections.facebook === "boolean" && Array.isArray(st.missing.ai) && st.settings.cadence.social.per_week === 4 && st.priorities.length === 1, `status: connections ${JSON.stringify(st.connections)}, missing.ai ${JSON.stringify(st.missing.ai)}`);
const pr = await A("programs");
check(Array.isArray(pr.programs) && Array.isArray(pr.signals) && pr.signals.every(x => x.line && x.angle && x.program?.name), `programs: ${pr.programs.length} programs, ${pr.signals.length} signals`);
const pl = await A("plan", { week_of: "2026-11-11" });
check(pl.week_of === "2026-11-09" && pl.slots.length && pl.scores && Array.isArray(pl.notes), `plan: week_of normalised to ${pl.week_of}, ${pl.slots.length} slots`);
const fl = await A("flow", { start_week: "2026-10-26" });
check(fl.flow.length === 6 && fl.flow[0].weekOf === "2026-10-26" && fl.flow[0].lines.camp_elevate >= 2, `flow: ${fl.flow.length} weeks`);
const gen = await A("generate", { week_of: "2026-11-09" });
check(gen.items.length >= 5 && gen.ai && "fallbacks" in gen.ai, `generate: ${gen.items.length} items, removed ${gen.removed}, kept ${gen.kept}`);
const social = gen.items.find(i => i.channel === "social"), email = gen.items.find(i => i.channel === "email");
let e1 = null; try { await A("approve", { ids: [social.id] }).then(r => { e1 = r; }); } catch (e) { e1 = e; }
check(e1.items.length === 0 && /graphic/.test(e1.errors[0].error), `approve without asset_url refused: ${e1.errors[0].error}`);
const up = await A("update", { id: social.id, patch: { asset_url: "https://x/p.png", headline: "NEW HEADLINE", hashtags: "#One two" , status: "published" } });
check(up.item.headline === "NEW HEADLINE" && up.item.asset_url === "https://x/p.png" && up.item.status === "draft" && JSON.stringify(up.item.hashtags) === '["One","two"]', "update: whitelisted fields only (status ignored), hashtags normalised");
const ap = await A("approve", { ids: [social.id, email.id, 999999] });
check(ap.items.length === 2 && ap.items.every(i => i.status === "approved" && i.approved_by === me.me) && ap.errors.some(e => e.id === 999999), `approve: ${ap.items.length} approved, errors ${JSON.stringify(ap.errors)}`);
const up2 = await A("update", { id: email.id, patch: { body: "New intro for families." } });
check(up2.unapproved && up2.item.status === "draft" && up2.item.email_html.includes("New intro for families."), "editing an approved email sends it back to draft and rebuilds its HTML");
const up3 = await A("update", { id: social.id, patch: { scheduled_at: "2026-11-09T23:30:00.000Z" } });
check(!up3.unapproved && up3.item.status === "approved", "moving the time keeps it approved");
const t1 = await A("test", { id: social.id });
check(t1.preview && t1.preview.caption.includes("NEW HEADLINE") === false && t1.preview.image === "https://x/p.png", "test social -> preview only");
const t2 = await A("test", { id: email.id });
const lastMail = calls.filter(c => c.to === "resend").pop();
check(t2.sent && t2.to === me.me && /^\[TEST\]/.test(lastMail.sample.subject) && lastMail.count === 1, `test email -> ${t2.to} only`);
const un = await A("unapprove", { id: social.id });
check(un.item.status === "draft", "unapprove");
await A("approve", { ids: [social.id] });
const pn = await A("publish_now", { id: social.id });
check(pn.item.status === "published" && pn.result.external_ids.facebook, `publish_now: ${pn.item.status} ${JSON.stringify(pn.result.external_ids)}`);
let locked = null; try { await A("update", { id: social.id, patch: { headline: "x" } }); } catch (e) { locked = e; }
check(locked?.status === 409, "published items can't be edited");
const rj = await A("reject", { id: email.id, reason: "not this week" });
check(rj.item.status === "rejected" && rj.item.error === "Rejected: not this week", "reject with reason");
const dl = await A("delete", { id: email.id });
check(dl.deleted === email.id && !sb2.db.mkt_items.some(i => i.id === email.id), "delete");
const ps2 = await A("priority_save", { priority: { title: "Push Reach", lines: ["reach", "nope"], weight: 9, starts_on: "2026-11-09", ends_on: "bad", channels: ["social", "fax"] } });
check(ps2.priority.id && JSON.stringify(ps2.priority.lines) === '["reach"]' && ps2.priority.weight === 5 && ps2.priority.ends_on === null && JSON.stringify(ps2.priority.channels) === '["social"]', "priority_save sanitises");
const ps3 = await A("priority_save", { priority: { id: ps2.priority.id, active: false } });
check(ps3.priority.active === false && ps3.priority.title === "Push Reach", "priority_save updates by id");
await A("priority_delete", { id: ps2.priority.id });
check(!sb2.db.mkt_priorities.some(p => p.id === ps2.priority.id), "priority_delete");
const ss = await A("settings_save", { patch: { voice: "Warm.", weights: { reach: 4, bogus: 3 }, cadence: { social: { per_week: 5 } }, notify_emails: "drew@drippingsportsclub.com, not-an-email", generate_day: "Saturday" } });
check(ss.settings.voice === "Warm." && ss.settings.weights.reach === 4 && !("bogus" in ss.settings.weights) && ss.settings.cadence.social.per_week === 5 && ss.settings.cadence.social.time === "18:30" && ss.settings.generate_day === "sat" && ss.settings.notify_emails.length === 1 && ss.settings.updated_by === me.me, "settings_save merges and validates");
const br = await A("brief", { week_of: "2026-11-09", instruction: "more Reach, less volleyball" });
check(br.priority.lines[0] === "reach" && br.priority.avoid_lines[0] === "volleyball" && br.priority.starts_on === "2026-11-09" && br.priority.ends_on === "2026-11-15" && br.items.length > 0, `brief: priority "${br.priority.title}", ${br.items.length} new drafts (removed ${br.removed})`);
const its = await A("items", { week_of: "2026-11-12" });
check(its.week_of === "2026-11-09" && its.items.length >= br.items.length, `items: ${its.items.length} in the week`);
const one2 = await A("generate", { week_of: "2026-11-09", program_id: "72263", instruction: "Make a post" });
check(one2.items.length === 1 && one2.items[0].line === "reach", "generate with program_id -> one draft");
let rv2 = null; try { await A("revise", { id: one2.items[0].id, instruction: "shorter" }); } catch (e) { rv2 = e; }
check(rv2?.status === 503, "revise without ANTHROPIC_API_KEY -> 503 with a clear message");
const ss2 = await A("settings_save", { patch: { cadence: { social: { mode: "weird", rhythm: [{ day: "wed", lines: ["reach", "x"] }, { day: "thu", follow: "wed" }, { day: "mon", follow: "fri" }] }, email: { dedicated_lines: ["parties", "zzz"] } }, themes: { reach: "Sell the why\n\nSpeed and strength", nope: ["x"] } } });
check(ss2.settings.cadence.social.mode === "rhythm" && JSON.stringify(ss2.settings.cadence.social.rhythm) === '[{"day":"wed","lines":["reach"],"format":"post"},{"day":"thu","follow":"wed","format":"story"}]' && JSON.stringify(ss2.settings.cadence.email.dedicated_lines) === '["parties"]' && JSON.stringify(ss2.settings.themes) === '{"reach":["Sell the why","Speed and strength"]}', "settings_save cleans the rhythm, dedicated lines and themes");
let pt = null; try { await A("photos_tag", { ids: [1] }); } catch (e) { pt = e; }
check(pt?.status === 503, "photos_tag without ANTHROPIC_API_KEY -> 503");
let unk = null; try { await A("nope"); } catch (e) { unk = e; }
check(unk?.status === 400, "unknown action -> 400");

// ── 4. unsubscribe token ─────────────────────────────────────────────────────
console.log("\n== 4. unsubscribe ==");
const u = new URL(pub.unsubUrl("Family1@Example.com"));
check(pub.verifyUnsub(u.searchParams.get("e"), u.searchParams.get("t")) && !pub.verifyUnsub("other@example.com", u.searchParams.get("t")), `token verifies for its address only (${u.pathname})`);
const unsub = (await import("../api/marketing-unsubscribe.js")).default;
process.env.SUPABASE_URL = ""; // serviceClient() -> null path is covered by a 500; use a fake via module stub below
const resObj = () => { const r = { code: 0, headers: {}, body: null, status(c) { r.code = c; return r; }, setHeader(k, v) { r.headers[k] = v; }, send(b) { r.body = b; return r; }, json(b) { r.body = b; return r; } }; return r; };
const bad = resObj(); await unsub({ method: "GET", query: { e: "a@b.com", t: "nope" } }, bad);
check(bad.code === 400 && /Link incomplete/.test(bad.body), "bad token -> 400 page");

console.log(`\n${fails ? fails + " FAILED" : "all checks passed"}`);
process.exit(fails ? 1 : 0);
