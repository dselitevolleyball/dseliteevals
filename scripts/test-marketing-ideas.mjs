// Checks the idea scout, coach spotlights and the one-tap email links
// (api/_lib/marketing-scout.js, marketing-spotlight.js, marketing-links.js,
// api/spotlight-form.js, api/marketing-act.js, the cron's spotlight + scout
// steps) against an in-memory Supabase, with Claude, Resend and Twilio
// stubbed. Reads the live programs feed (one GET); nothing else leaves.
//
//   node scripts/test-marketing-ideas.mjs

import { fakeSupabase } from "./lib/fake-supabase.mjs";

Object.assign(process.env, {
  ANTHROPIC_API_KEY: "sk-test", RESEND_API_KEY: "re_test", DSSC_FROM_EMAIL: "Dripping Springs Sports Club <info@drippingsportsclub.com>",
  MARKETING_UNSUB_SECRET: "unsub-secret", TWILIO_ACCOUNT_SID: "ACtest", TWILIO_AUTH_TOKEN: "tok", DSSC_TWILIO_FROM_NUMBER: "+15125550000",
});
const calls = [];
let ideaReply = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith("https://www.drippingsportsclub.com/api/programs")) return realFetch(url, init);
  if (u.startsWith("https://api.anthropic.com/")) {
    const req = JSON.parse(init.body);
    calls.push({ to: "anthropic", req });
    return new Response(JSON.stringify(claude(req)), { status: 200, headers: { "content-type": "application/json", "request-id": "req_test" } });
  }
  if (u.startsWith("https://api.resend.com/")) { calls.push({ to: "resend", body: JSON.parse(init.body) }); return new Response(JSON.stringify({ id: "em_1" })); }
  if (u.startsWith("https://api.twilio.com/")) { calls.push({ to: "twilio", body: Object.fromEntries(new URLSearchParams(String(init.body))) }); return new Response(JSON.stringify({ sid: "SM1", status: "queued" })); }
  throw new Error("Unexpected fetch in test: " + u);
};
const base = { id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5", usage: { input_tokens: 10, output_tokens: 10 } };
let searchTurns = 0;
function claude(req) {
  const text = (o) => ({ ...base, content: [{ type: "text", text: typeof o === "string" ? o : JSON.stringify(o) }], stop_reason: "end_turn" });
  if ((req.tools || []).some(t => t.type === "web_search_20260209")) {
    searchTurns++;
    const result = { type: "web_search_tool_result", tool_use_id: "srv_1", content: [{ type: "web_search_result", url: "https://www.drippingsprings.org/events/holiday-lighting", title: "Dripping Springs holiday lighting" }] };
    if (req.messages.length === 1) return { ...base, content: [{ type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "Dripping Springs events" } }, result], stop_reason: "pause_turn" };
    return { ...base, content: [result, { type: "text", text: "Dec 4 - Dripping Springs holiday lighting on Mercer Street (https://www.drippingsprings.org/events/holiday-lighting)" }], stop_reason: "end_turn" };
  }
  const schema = req.output_config?.format?.schema;
  if (schema?.properties?.ideas) return text(ideaReply);
  if (schema?.properties?.questions) return text({ intro: "Hi Hunter! You're up next in Meet the Coaches.", questions: ["How did you get into volleyball?", "Favorite drill?", "Pre-game ritual?", "Fun fact?", "Advice for a nervous kid?"] });
  if (schema?.properties?.quote) return text({ quote: "Championship mindset unlocks greatness for every athlete in America.", caption: "Meet Coach Hunter! Find out his favorite drill in this week's email.", hashtags: ["DrippingSprings", "MeetTheCoaches"], story_sub: "Director of Volleyball", subject: "Meet the Coaches #1: Coach Hunter", preheader: "Pepper, playlists and pancakes", intro: "Every few weeks we introduce a coach.", qa: [{ q: "How did you get into volleyball?", a: "My older sister dragged me to a clinic when I was nine and I never left the gym." }, { q: "Favorite drill?", a: "Pepper. The kids groan, then they ask for it." }, { q: "Pre-game ritual?", a: "Same playlist every time." }], cta_text: "See volleyball programs" });
  throw new Error("Unexpected Claude request");
}

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) fails++; };
const mockRes = () => { const r = { code: 200, headers: {}, body: null, status(c) { this.code = c; return this; }, setHeader(k, v) { this.headers[k] = v; return this; }, send(b) { this.body = b; return this; } }; return r; };

const { moments } = await import("../shared/marketing-seasons.js");
const scout = await import("../api/_lib/marketing-scout.js");
const spot = await import("../api/_lib/marketing-spotlight.js");
const links = await import("../api/_lib/marketing-links.js");
const core = await import("../api/_lib/marketing-core.js");
const { handleSpotlightForm } = await import("../api/spotlight-form.js");
const { handleAct } = await import("../api/marketing-act.js");
const { runCron } = await import("../api/marketing-cron.js");

// ── 1. the season calendar ──
console.log("\n== 1. seasons ==");
const m = moments("2026-11-01", 55);
check(m.some(x => x.key === "thanksgiving-2026" && x.start === "2026-11-26") && m.some(x => x.key === "veterans-2026") && m.some(x => x.key === "winter-break-2026" && x.approx) && !m.some(x => x.key === "halloween-2026"), `Nov 1 + 55 days: ${m.map(x => x.name).join(", ")}`);

// ── 2. the scout ──
console.log("\n== 2. scout ==");
const sb = fakeSupabase({
  mkt_settings: [{ id: 1, ...core.SETTINGS_DEFAULTS, flair: 2 }], mkt_priorities: [], mkt_items: [], mkt_photos: [], mkt_log: [], mkt_ideas: [], mkt_spotlights: [],
  coaches: [{ email: "hunter@drippingsportsclub.com", display_name: "Hunter Haley", dssc_role: "admin", sports: ["volleyball"], is_approved: true }],
  dssc_people: [], coach_roster: [{ first_name: "Hunter", last_name: "Haley", email: "hunter@drippingsportsclub.com", phone: "(512) 555-0101" }, { first_name: "Adrian", last_name: "Thomas", email: "adrian@drippingsportsclub.com", phone: "512-555-0102" }],
  sms_threads: [], sms_messages: [], sms_optouts: [],
});
const today = "2026-10-24";
ideaReply = { ideas: [
  { kind: "holiday", title: "Halloween costume practice", pitch: "Wear a costume to practice the week of Halloween.", hook: "POV: your setter is a dinosaur", line: "volleyball", channel: "social", format: "post", best_day: "2026-10-29", source_urls: [] },
  { kind: "local", title: "See you at the holiday lighting", pitch: "Wave at families at the Dripping Springs holiday lighting.", hook: "Tag who you're bringing", line: "club", channel: "social", format: "story", best_day: "2026-12-03", source_urls: ["https://www.drippingsprings.org/events/holiday-lighting"] },
  { kind: "local", title: "Invented parade", pitch: "A parade nobody found.", hook: "", line: "club", channel: "social", format: "post", best_day: "2026-11-05", source_urls: ["https://made-up.example.com"] },
  { kind: "fun", title: "Half-price Halloween", pitch: "Only $20 this week!", hook: "", line: "club", channel: "social", format: "post", best_day: "2026-10-30", source_urls: [] },
  { kind: "season", title: "Winter break camp countdown", pitch: "Camp Elevate is the move over winter break.", hook: "3 weeks till break - who's ready?", line: "camp_elevate", channel: "email", format: "post", best_day: "2026-09-01", source_urls: [] },
] };
const now = new Date("2026-10-24T15:00:00Z");   // Saturday 10 am Central
const r1 = await scout.runScout(sb, { now, by: "scout" });
const web = calls.filter(c => c.to === "anthropic" && (c.req.tools || []).length);
const localWeb = web.filter(c => !/trending on TikTok/.test(JSON.stringify(c.req.messages[0])));   // the trend scan searches too
check(searchTurns >= 2 && localWeb.length === 2 && localWeb[1].req.messages.length === 2 && localWeb[1].req.messages[1].role === "assistant", "local scan: a paused web search is resumed by sending the assistant turn back");
check(web[0].req.model === "claude-opus-5-5" && web[0].req.fallbacks === "default" && web[0].req.tools[0].user_location?.city === "Dripping Springs", "web search: Opus 5.5, fallbacks, located in Dripping Springs");
const ideaCall = calls.filter(c => c.to === "anthropic" && c.req.output_config?.format?.schema?.properties?.ideas).pop();
check(ideaCall && ideaCall.req.messages[0].content.includes("holiday lighting") && /bold/i.test(JSON.stringify(ideaCall.req.system)) && ideaCall.req.messages[0].content.includes("Halloween"), "ideas request carries the local scan, the calendar and the bold flair");
const titles = r1.ideas.map(i => i.title);
check(!titles.includes("Invented parade") && !titles.includes("Half-price Halloween"), `dropped: a local idea without a found source, a price (${titles.join(" | ")})`);
const lighting = r1.ideas.find(i => i.title === "See you at the holiday lighting");
check(lighting && lighting.sources[0]?.url === "https://www.drippingsprings.org/events/holiday-lighting" && lighting.format === "story", "a local idea keeps its source");
const winter = r1.ideas.find(i => i.title === "Winter break camp countdown");
check(winter && winter.best_day >= today && winter.format === "email", `a past best_day is moved up (${winter?.best_day}) and email ideas are emails`);
// Volleyball, basketball and Reach have never had a spotlight, so a sport
// director comes first (alphabetical between them), with the roster's phone.
check(r1.spotlight && r1.spotlight.name === "Adrian Thomas" && r1.spotlight.line === "basketball" && r1.spotlight.phone === "+15125550102" && r1.spotlight.questions.length === 5 && r1.spotlight.status === "draft", `spotlight lined up: ${r1.spotlight?.name}, ${r1.spotlight?.line} (${r1.spotlight?.questions.length} questions)`);
check(r1.ideas[0].kind === "spotlight" && r1.ideas[0].spotlight_id === r1.spotlight.id, "the spotlight is the first idea");
check(new Set(sb.inserted.mkt_ideas.map(r => Object.keys(r).sort().join())).size === 1, "every idea row has the same columns");
const r2 = await scout.runScout(sb, { now: new Date("2026-10-25T15:00:00Z"), by: "scout", web: false, ask: "something for Veterans Day" });
check(!r2.spotlight && /Veterans Day/.test(calls.filter(c => c.to === "anthropic").pop().req.messages[0].content), "an ask goes to Claude; no second spotlight while one is open");

// ── 3. the director's answers ──
console.log("\n== 3. accept / dismiss ==");
const d1 = await scout.dismissIdea(sb, r1.ideas.find(i => i.title === "Halloween costume practice").id, { by: "drew@drippingsportsclub.com", feedback: "Too silly for volleyball" });
check(d1.status === "dismissed" && d1.feedback === "Too silly for volleyball", "dismissed with a reason");
await scout.runScout(sb, { now: new Date("2026-10-26T15:00:00Z"), web: false, ask: "more" });
check(calls.filter(c => c.to === "anthropic").pop().req.messages[0].content.includes("Too silly for volleyball"), "the reason goes back to the scout next time");
const acc = await scout.acceptIdea(sb, lighting.id, { by: "drew@drippingsportsclub.com", now });
check(acc.item && acc.item.kind === "story" && acc.item.platforms.join() === "instagram_story,facebook_story" && acc.item.week_of === "2026-11-23" && acc.item.scheduled_at.startsWith("2026-11-29T00:30") && /holiday lighting/i.test(acc.item.reason) && acc.idea.status === "accepted" && acc.idea.item_id === acc.item.id, `idea -> draft on its best day (Dec 3 was past the 5-week window, so Sat Nov 28): ${acc.item?.kind} ${acc.item?.scheduled_at}`);
const again = await scout.acceptIdea(sb, lighting.id, { by: "x", now });
check(again.already && again.item.id === acc.item.id, "making it twice returns the same draft");

// ── 4. one-tap links ──
console.log("\n== 4. one-tap links ==");
const url = new URL(links.actUrl("spot_send", r1.spotlight.id));
const q = Object.fromEntries(url.searchParams);
check(url.pathname === "/hq/api/marketing-act" && links.verifyAct(q.a, q.id, q.x, q.t) && !links.verifyAct("idea", q.id, q.x, q.t) && !links.verifyAct(q.a, q.id, String(Number(q.x) + 1), q.t), "signed: right action/id/expiry only");
check(!links.verifyAct(q.a, q.id, q.x, q.t, { now: (Number(q.x) + 10) * 1000 }), "expired links are refused");
const g = mockRes();
await handleAct(sb, { method: "GET", url: url.pathname + url.search }, g);
check(g.code === 200 && /Yes, do it/.test(g.body) && sb.db.mkt_spotlights[0].status === "draft" && !calls.some(c => c.to === "twilio"), "GET only asks - nothing sent");
const p = mockRes();
await handleAct(sb, { method: "POST", url: url.pathname + url.search }, p);
const sp1 = sb.db.mkt_spotlights[0];
const tw = calls.find(c => c.to === "twilio"), em = calls.filter(c => c.to === "resend").find(c => /Meet the Coaches/.test(c.body.subject));
check(p.code === 200 && /Sent to Adrian Thomas/.test(p.body) && sp1.status === "sent" && sp1.sent_via.join() === "email,sms", `POST sends: status ${sp1.status} via ${sp1.sent_via}`);
check(tw && tw.body.To === "+15125550102" && tw.body.Body.includes("/hq/api/spotlight-form?t=" + sp1.token) && em && em.body.html.includes(sp1.token) && em.body.reply_to === "info@drippingsportsclub.com", "the text and the email carry the coach's own link; replies go to info@");
check(sb.db.mkt_ideas.find(i => i.spotlight_id === sp1.id).status === "accepted", "the spotlight idea is marked done");
const bad = mockRes(); await handleAct(sb, { method: "POST", url: url.pathname + url.search.replace(/t=[^&]+/, "t=nope") }, bad);
check(bad.code === 403, "a tampered link is refused");

// ── 5. the coach's page ──
console.log("\n== 5. the interview page ==");
const form = `/api/spotlight-form?t=${sp1.token}`;
const pg = mockRes(); await handleSpotlightForm(sb, { method: "GET", url: form }, pg);
check(pg.code === 200 && pg.body.includes("How did you get into volleyball?") && pg.body.includes("Adrian"), "GET shows the questions");
const sg = mockRes(); await handleSpotlightForm(sb, { method: "POST", url: form + "&action=sign", body: { files: [{ name: "IMG_1.HEIC" }, { name: "b.jpg" }] } }, sg);
const signed = JSON.parse(sg.body);
check(signed.ok && signed.files.length === 2 && signed.files.every(f => f.path.startsWith(`spotlights/${sp1.id}/`) && f.path.endsWith(".jpg")), "sign: upload slots inside this spotlight's folder");
const sub = mockRes();
await handleSpotlightForm(sb, { method: "POST", url: form + "&action=submit", body: { answers: ["My older sister dragged me to a clinic when I was nine and I never left the gym.", "Pepper. The kids groan, then they ask for it.", "Same playlist every time.", "", ""], consent: true,
  photos: [{ path: signed.files[0].path, caption: "Me at 9", w: 1350, h: 1800 }, { path: signed.files[1].path, caption: "" }, { path: "spotlights/999/evil.jpg" }] } }, sub);
const sp2 = sb.db.mkt_spotlights[0];
check(JSON.parse(sub.body).ok && sp2.status === "answered" && sp2.consent && sp2.photos.length === 2 && sp2.questions[0].a.startsWith("My older sister"), `submit: answered, ${sp2.photos.length} photos (another folder's path dropped)`);
check(sb.db.mkt_photos.filter(p => p.source === "spotlight").length === 2 && sb.db.mkt_photos.every(p => p.release_ok == null), "the photos join the library, pending the AI librarian");
const twice = mockRes(); await handleSpotlightForm(sb, { method: "POST", url: form + "&action=submit", body: { answers: ["x"], consent: true } }, twice);
check(twice.code === 409, "answers can't be overwritten from the link");
const nc = mockRes(); await handleSpotlightForm(sb, { method: "GET", url: "/api/spotlight-form?t=not-a-token" }, nc);
check(nc.code === 404, "a bad token is a 404");

// ── 6. the cron drafts it ──
console.log("\n== 6. cron ==");
const before = calls.length;
const cr = await runCron(sb, { now: new Date("2026-10-26T20:00:00Z"), deadline: Date.now() + 240000 });
const drafted = cr.spotlights.drafted[0];
const items = sb.db.mkt_items.filter(i => i.kind === "spotlight");
check(drafted?.items === 3 && items.length === 3 && sb.db.mkt_spotlights[0].status === "drafted" && sb.db.mkt_spotlights[0].episode === 1, `3 drafts: ${items.map(i => i.channel + "/" + (i.graphic?.template)).join(", ")}`);
const post = items.find(i => i.graphic.template === "quote" && i.channel === "social"), mail = items.find(i => i.channel === "email");
check(post.graphic.quote !== "Championship mindset unlocks greatness for every athlete in America." && /sister|Pepper|playlist/i.test(post.graphic.quote), `a quote Claude made up is replaced by the coach's own words: "${post.graphic.quote}"`);
check(/^Meet the Coaches #1: Coach (Hunter|Adrian)/.test(mail.email_subject) && mail.email_blocks.length === 3 && mail.email_html.includes("Pepper") && post.graphic.photo_url.includes(`spotlights/${sp1.id}/`), "the email is the Q&A, the post uses the coach's photo");
check(new Set(sb.inserted.mkt_items.slice(-3).map(r => Object.keys(r).sort().join())).size === 1, "the three spotlight rows have the same columns");
check(calls.slice(before).some(c => c.to === "resend" && /answered - 3 spotlight drafts ready/.test(c.body.subject)), "the directors are told the drafts are ready");
// Reminder: a second coach, sent 4 days ago, no answer.
sb.db.mkt_spotlights.push({ id: 77, name: "Brandon Butler", email: "brandon@drippingsportsclub.com", phone: null, line: "reach", questions: [{ q: "Q?" }], status: "sent", sent_via: ["email"], sent_at: "2026-10-20T15:00:00Z", reminded_at: null, token: "11111111-2222-3333-4444-555555555555", photos: [], item_ids: [] });
const cr2 = await runCron(sb, { now: new Date("2026-10-26T21:00:00Z"), deadline: Date.now() + 240000 });
const cr3 = await runCron(sb, { now: new Date("2026-10-26T22:00:00Z"), deadline: Date.now() + 240000 });
check(cr2.spotlights.reminded[0]?.id === 77 && cr2.spotlights.reminded[0].sent?.email && !cr3.spotlights.reminded.length && sb.db.mkt_spotlights.find(s => s.id === 77).reminded_at, "one reminder after 3 days, never two");
// The weekly scout + digest on the scout day.
sb.db.mkt_log = sb.db.mkt_log.filter(l => l.kind !== "scout");
const sat = await runCron(sb, { now: new Date("2026-10-31T15:30:00Z"), deadline: Date.now() + 240000 });
const digest = calls.filter(c => c.to === "resend").pop();
check(sat.scout.ran && sat.scout.digest?.ok && /marketing ideas/.test(digest.body.subject) && digest.body.html.includes("/hq/api/marketing-act?a=idea"), `Saturday: scout ran (${sat.scout.ideas} ideas) and the digest has one-tap buttons`);
for (const l of sb.db.mkt_log) if (l.kind === "scout") l.at = "2026-10-31T15:30:00.000Z";   // the log stamps the real clock; the test runs in October 31's
const sat2 = await runCron(sb, { now: new Date("2026-10-31T16:30:00Z"), deadline: Date.now() + 240000 });
check(!sat2.scout.ran && sat2.scout.already, "the scout runs once a week");

console.log(`\n${fails ? fails + " FAILED" : "all checks passed"}`);
process.exit(fails ? 1 : 0);
