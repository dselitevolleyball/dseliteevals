// Offline checks for DS Elite Social (api/_lib/dse-social*.js): the photo
// picking rules, batching, the coach quote check, Central-time scheduling,
// the rendered images, the survey page, the Slack approval card, and
// publishing - with Facebook, Instagram and Slack stubbed (no network, no
// database). Run: node scripts/test-dse-social.mjs
import assert from "node:assert/strict";
import { loadImage } from "@napi-rs/canvas";
import * as S from "../api/_lib/dse-social.js";
import { layout, renderCollage, renderPoster, renderFrame } from "../api/_lib/dse-social-render.js";
import { signState, readState, likelyDse } from "../api/_lib/dse-social-meta.js";
import { handleIntroForm } from "../api/coach-intro-form.js";

let n = 0;
const ok = (name) => { n++; console.log("  ✓ " + name); };

// ── planFrom: only usable photos, sensible formats ─────────────────────────
{
  const v = (i, usable, score = 5) => ({ i, usable, score, reason: "", focus_x: 0.5, focus_y: 0.4 });
  let p = S.planFrom({ photos: [v(0, true, 9), v(1, false), v(2, true, 7)], format: "collage", picks: [1, 0, 2] }, 3);
  assert.deepEqual(p.picks, [0, 2], "an unusable pick is dropped");
  p = S.planFrom({ photos: [0, 1, 2, 3, 4, 5, 6, 7].map(i => v(i, true)), format: "collage", picks: [0, 1, 2, 3, 4, 5, 6, 7] }, 8);
  assert.equal(p.format, "carousel", "more than 6 is a carousel");
  p = S.planFrom({ photos: [v(0, true), v(1, true)], format: "carousel", picks: [1] }, 2);
  assert.equal(p.format, "single");
  p = S.planFrom({ photos: [v(0, false), v(1, false)], format: "collage", picks: [0, 1] }, 2);
  assert.equal(p.format, "none", "nothing usable, nothing posted");
  p = S.planFrom({ photos: [v(0, true, 3), v(1, true, 8)], format: "collage", picks: [] }, 2);
  assert.deepEqual(p.picks, [1, 0], "no picks: best score first");
  p = S.planFrom({ photos: [v(0, true), v(9, true)], format: "single", picks: [9] }, 2);
  assert.deepEqual(p.picks, [0], "an index that isn't a photo is ignored");
  ok("planFrom keeps only usable photos and fixes the format");
}

// ── batches ────────────────────────────────────────────────────────────────
{
  const now = Date.parse("2026-10-28T20:00:00Z");
  const ph = (id, team, ctx, label, at) => ({ id, team_name: team, context: ctx, event_label: label, taken_on: null, created_at: at });
  const rows = [
    ph(1, "14 Diamond", "team_event", "Team event", "2026-10-26T01:00:00Z"), ph(2, "14 Diamond", "team_event", "Team event", "2026-10-26T01:10:00Z"), ph(3, "14 Diamond", "team_event", "Team event", "2026-10-26T01:20:00Z"),
    ph(4, "13 Ruby", "tournament", "Lone Star Classic", "2026-10-28T19:30:00Z"), ph(5, "13 Ruby", "tournament", "Lone Star Classic", "2026-10-28T19:00:00Z"), ph(6, "13 Ruby", "tournament", "Lone Star Classic", "2026-10-28T18:00:00Z"),
    ph(7, "12 Rise 1", "other", "Other", "2026-10-20T15:00:00Z"),
  ];
  const b = S.groupBatches(rows, { min: 3, now });
  const diamond = b.find(x => x.team === "14 Diamond"), ruby = b.find(x => x.team === "13 Ruby"), rise = b.find(x => x.team === "12 Rise 1");
  assert.equal(diamond.count, 3); assert.equal(diamond.ready, true);
  assert.equal(ruby.ready, false, "a batch still getting uploads waits 2 hours"); assert.equal(ruby.event, "Lone Star Classic");
  assert.equal(rise.ready, false, "one photo isn't a batch");
  assert.equal(diamond.day, "2026-10-25", "the day is Central time");
  assert.equal(S.teamLabel("12 Rise 1"), "12 Rise"); assert.equal(S.teamLabel("14 Diamond"), "14 Diamond");
  ok("photos group by team, event and day; ready after 2 quiet hours");
}

// ── the coach's quote must be their own words ──────────────────────────────
{
  const answers = ["I played at Texas State. I want every player to believe she belongs on the court!", "Sour Patch Kids."];
  assert.equal(S.checkQuote("I want every player to believe she belongs on the court!", answers), "I want every player to believe she belongs on the court!");
  assert.equal(S.checkQuote("“I want every player to believe she belongs…”", answers), "I want every player to believe she belongs…", "a trimmed quote is still theirs");
  assert.equal(S.checkQuote("Volleyball is life and I live it every day", answers), "I played at Texas State.", "made-up words are replaced by theirs");
  ok("checkQuote only lets the coach's own words through");
}

// ── Central time: coach intros one an evening ──────────────────────────────
{
  assert.equal(S.ctInstant("2026-10-28", "18:30").toISOString(), "2026-10-28T23:30:00.000Z", "CDT");
  assert.equal(S.ctInstant("2026-11-02", "18:30").toISOString(), "2026-11-03T00:30:00.000Z", "CST after the clocks change");
  const taken = [{ scheduled_at: "2026-10-28T23:30:00.000Z" }];
  const sb = fakeDb({ dse_social_posts: taken.map(t => ({ kind: "coach_intro", status: "approved", ...t })) });
  const at = await S.nextIntroSlot(sb, { intro_time: "18:30" }, new Date("2026-10-28T15:00:00Z"));
  assert.equal(at.toISOString(), "2026-10-29T23:30:00.000Z", "today is taken, so tomorrow evening");
  const late = await S.nextIntroSlot(fakeDb({ dse_social_posts: [] }), { intro_time: "18:30" }, new Date("2026-10-29T00:00:00Z"));
  assert.equal(late.toISOString(), "2026-10-29T23:30:00.000Z", "after 6:30 pm it's the next evening");
  ok("intros take the next free 6:30 pm Central");
}

// ── captions and the Slack card ────────────────────────────────────────────
{
  const post = { id: 7, kind: "photos", format: "carousel", title: "14 Diamond · Oct 25", caption: "Saturday <energy> & smiles", hashtags: ["14Diamond", "#DSElite", "DSElite", "Club Volleyball"], platforms: ["facebook", "instagram"], photos: [1, 2, 3, 4, 5].map(i => ({ url: `https://x/${i}.jpg` })) };
  assert.equal(S.captionFor(post), "Saturday <energy> & smiles\n\n#14Diamond #DSElite #ClubVolleyball", "hashtags deduped and cleaned");
  const m = S.approvalMessage(post);
  assert.equal(m.blocks.filter(b => b.type === "image").length, 4, "a carousel shows up to 4 photos");
  assert.ok(m.blocks.some(b => b.type === "section" && /&lt;energy&gt; &amp;/.test(b.text.text)), "the caption is escaped for Slack");
  const actions = m.blocks.find(b => b.type === "actions").elements.map(e => e.action_id);
  assert.deepEqual(actions, ["dse_social_approve", "dse_social_now", "dse_social_skip", "dse_social_open"]);
  const planned = S.approvalMessage({ ...post, scheduled_at: new Date(Date.now() + 86400e3).toISOString() });
  assert.match(planned.blocks[0].text.text, /planned for/); assert.match(planned.blocks.find(b => b.type === "actions").elements[0].text.text, /^✓ Approve for /);
  const done = S.approvalMessage(post, { done: "Posted" });
  assert.ok(!done.blocks.some(b => b.type === "actions") && done.blocks.some(b => b.type === "context"), "a decided card loses its buttons");
  ok("captions, and the Slack approval card");
}

// ── the Facebook login state ───────────────────────────────────────────────
{
  process.env.CRON_SECRET ||= "test-secret";
  const st = signState("drew@dselitevolleyball.com", Date.now());
  assert.equal(readState(st)?.e, "drew@dselitevolleyball.com");
  assert.equal(readState(st.slice(0, -2) + "xx"), null, "a tampered state is refused");
  assert.equal(readState(signState("d", Date.now() - 31 * 60e3)), null, "a stale state is refused");
  assert.equal(likelyDse([{ id: "1", name: "Dripping Springs Sports Club" }, { id: "2", name: "DS Elite Volleyball" }]).id, "2");
  ok("the connect state is signed and expires; DS Elite's Page is suggested");
}

// ── the images ─────────────────────────────────────────────────────────────
{
  for (let k = 1; k <= 6; k++) {
    const boxes = layout(k, 1080, 1150);
    assert.equal(boxes.length, k);
    for (const b of boxes) assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 1080.5 && b.y + b.h <= 1150.5, `box inside the area (${k})`);
  }
  const { createCanvas } = await import("@napi-rs/canvas");
  const mk = (w, h, c) => { const cv = createCanvas(w, h); const x = cv.getContext("2d"); x.fillStyle = c; x.fillRect(0, 0, w, h); return cv.encode("jpeg"); };
  const imgs = await Promise.all([[1200, 1600, "#c33"], [1600, 900, "#3c3"], [900, 900, "#33c"]].map(async ([w, h, c]) => loadImage(await mk(w, h, c))));
  for (const buf of [await renderCollage(imgs.map(img => ({ img })), { title: "14 Diamond", sub: "Lone Star Classic · Oct 25" }), await renderFrame(imgs[1], { x: 0.2, y: 0.5 }), await renderPoster({ img: imgs[0], name: "Tara Fisher", teams: ["12 Rise"], quote: "Compete every rep.", facts: [{ label: "Played", value: "Texas State" }] }), await renderPoster({ name: "Rob Roberts", teams: [], quote: "", facts: [] })]) {
    const im = await loadImage(buf);
    assert.equal(buf[0], 0xff, "a JPEG"); assert.equal(im.width, 1080); assert.equal(im.height, 1350, "4:5 for Instagram");
  }
  ok("collages, frames and posters render 1080x1350 JPEGs (with and without a photo)");
}

// ── the survey page ────────────────────────────────────────────────────────
{
  const res = fakeRes();
  await handleIntroForm(null, { method: "GET", url: "/api/coach-intro-form?preview=1" }, res);
  assert.equal(res.statusCode, 200); assert.match(res.body, /Hey Coach <em>Tara<\/em>/); assert.match(res.body, /OK for DS Elite to share/);
  const bad = fakeRes();
  await handleIntroForm(null, { method: "GET", url: "/api/coach-intro-form?t=nope" }, bad);
  assert.equal(bad.statusCode, 404);
  const intro = { id: 3, token: "11111111-2222-3333-4444-555555555555", name: "Sam Robinson", status: "sent", questions: [{ q: "Q1", a: "" }, { q: "Q2", a: "" }] };
  const sb = fakeDb({ dse_coach_intros: [intro] });
  const noOk = fakeRes();
  await handleIntroForm(sb, { method: "POST", url: `/coach-intro?t=${intro.token}&action=submit`, body: { answers: ["A1"], photos: [] } }, noOk);
  assert.equal(noOk.statusCode, 400, "no OK to share, no save");
  const good = fakeRes();
  await handleIntroForm(sb, { method: "POST", url: `/coach-intro?t=${intro.token}&action=submit`, body: { answers: ["A1", ""], consent: true, photos: [{ path: "intros/3/a.jpg" }, { path: "intros/9/evil.jpg" }] } }, good);
  assert.equal(good.statusCode, 200);
  const saved = sb.tables.dse_coach_intros[0];
  assert.equal(saved.status, "answered"); assert.equal(saved.questions[0].a, "A1"); assert.equal(saved.photos.length, 1, "another coach's upload path is refused");
  ok("the survey page: preview, bad links, consent required, only its own photos");
}

// ── publishing: each platform once, retries skip what went out ─────────────
{
  const calls = [];
  let igFails = true;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push(u.replace(/\?.*/, "") + " " + (opts.method || "GET"));
    const J = (o, status = 200) => ({ ok: status < 400, status, json: async () => o });
    if (u.includes("/photos")) return J({ id: "ph" + calls.length, post_id: "page_post" + calls.length });
    if (u.endsWith("/feed")) return J({ id: "page_multi" });
    if (u.includes("/media_publish")) return J({ id: "ig_media" });
    if (u.includes("/ig1/media")) return igFails ? J({ error: { message: "Instagram hiccup" } }, 400) : J({ id: "container" + calls.length });
    if (/graph\.facebook\.com\/v[\d.]+\/container\d+/.test(u)) return J({ status_code: "FINISHED" });
    if (u.includes("permalink")) return J({ permalink_url: "https://fb/p", permalink: "https://ig/p" });
    return J({});
  };
  const post = { id: 1, kind: "photos", format: "carousel", status: "approved", caption: "Hi", hashtags: [], platforms: ["facebook", "instagram"], photos: [{ url: "https://x/1.jpg" }, { url: "https://x/2.jpg" }], external_ids: {} };
  const sb = fakeDb({ dse_social_posts: [post], mkt_secrets: [{ key: "dse_meta_page_token", value: "tok", meta: { page_id: "page1", page_name: "DS Elite Volleyball", ig_id: "ig1" } }], hq_kv: [] });
  let r = await S.publishPost(sb, 1);
  assert.equal(r.post.status, "failed"); assert.equal(r.post.external_ids.facebook, "page_multi", "Facebook went out as one multi-photo post");
  assert.match(r.post.error, /Instagram: .*hiccup/);
  const fbPosts = calls.filter(c => c.endsWith("/feed POST")).length;
  igFails = false;
  r = await S.publishPost(sb, 1);
  assert.equal(r.post.status, "published");
  assert.equal(calls.filter(c => c.endsWith("/feed POST")).length, fbPosts, "the retry didn't post to Facebook again");
  assert.equal(r.post.external_ids.instagram, "ig_media");
  assert.equal(calls.filter(c => /ig1\/media POST/.test(c)).length >= 3, true, "two carousel items + the carousel");
  r = await S.publishPost(sb, 1);
  assert.ok(r.skipped, "a published post isn't posted again");
  // No Instagram linked: Facebook only, with a note - not a failure.
  const sb2 = fakeDb({ dse_social_posts: [{ ...post, id: 2, format: "collage", asset_url: "https://x/c.jpg", status: "approved", external_ids: {}, error: null }], mkt_secrets: [{ key: "dse_meta_page_token", value: "tok", meta: { page_id: "page1" } }], hq_kv: [] });
  r = await S.publishPost(sb2, 2);
  assert.equal(r.post.status, "published"); assert.match(r.post.error || "", /Facebook only/);
  // Not connected: fails with a clear reason.
  const sb3 = fakeDb({ dse_social_posts: [{ ...post, id: 3, status: "approved", external_ids: {}, error: null }], mkt_secrets: [], hq_kv: [] });
  r = await S.publishPost(sb3, 3);
  assert.equal(r.post.status, "failed"); assert.match(r.post.error, /isn't connected/);
  ok("publishing: carousel to both, a failed platform retried alone, never twice");
}

// ── what a file really is; the feed check ──────────────────────────────────
{
  const { imageKind } = await import("../api/_lib/dse-social-render.js");
  const { matchFeed, isFlat, MATCH_MAX } = await import("../api/_lib/dse-social-feed.js");
  assert.equal(imageKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), "jpeg");
  assert.equal(imageKind(Buffer.from("\0\0\0\x18ftypheicmif1", "binary")), "heic", "the HEIC named .jpeg");
  assert.equal(imageKind(Buffer.alloc(0)), null);
  const { photo } = await import("../api/_lib/dse-social-render.js");
  await assert.rejects(photo(Buffer.from("\0\0\0\x18ftypheicmif1\0\0\0\0", "binary")), /HEIC/, "a HEIC is refused, not decoded");
  const rnd = (seed) => { let x = seed, s = ""; for (let i = 0; i < 256; i++) { x = (x * 1103515245 + 12345) % 2147483648; s += (x >> 16) & 1 ? "1" : "0"; } return s; };
  const a = rnd(7), b = rnd(99), flip = (h, k) => h.split("").map((c, i) => i < k ? (c === "1" ? "0" : "1") : c).join("");
  const feed = [{ src: "x", hash: b }, { src: "same", hash: flip(a, 30) }, { src: "flat", hash: "0".repeat(250) + "1".repeat(6) }];
  assert.equal(matchFeed([a], feed)?.src, "same", "a recompressed copy matches");
  assert.equal(matchFeed([a], [{ src: "x", hash: b }]), null, "a different photo doesn't");
  assert.equal(matchFeed([flip(a, MATCH_MAX + 10)], [{ src: "far", hash: a }]), null);
  assert.ok(isFlat("0".repeat(250) + "1".repeat(6)) && !isFlat(a));
  assert.equal(matchFeed(["0".repeat(256)], [{ src: "flat", hash: "0".repeat(256) }]), null, "near-blank images never match");
  // the real scan of Oct 29: every confirmed repeat matches, the screenshot doesn't
  const fs = await import("node:fs"), dir = "/tmp/claude-0/-home-user-dseliteevals/f5b50e17-f915-5571-a07a-ef7a927e74aa/scratchpad/feed/";
  if (fs.existsSync(dir + "matches.json")) {
    const feedReal = JSON.parse(fs.readFileSync(dir + "feedhash.json")).map(f => ({ ...f, aspect: f.w / f.h }));
    const used = new Set(JSON.parse(fs.readFileSync(dir + "used.json")).filter(u => !u.sibling).map(u => u.id));
    let hit = 0, miss = 0, wrong = 0;
    for (const f of fs.readdirSync(dir).filter(f => /^p\d+\.json$/.test(f))) {
      const p = JSON.parse(fs.readFileSync(dir + f)), m = matchFeed([p.hash, ...p.crops], feedReal, p.w / p.h);
      if (used.has(p.id)) m ? hit++ : miss++; else if (m) wrong++;
    }
    assert.equal(miss, 0, "every confirmed repeat is caught"); assert.equal(wrong, 0, "nothing else is");
    console.log(`    (real feed: ${hit} repeats caught, 0 missed, 0 false)`);
  }
  ok("files are sniffed before decoding; the feed check matches repeats, not look-alikes");
}

// ── planned times ──────────────────────────────────────────────────────────
{
  const later = new Date(Date.now() + 2 * 86400e3).toISOString(), past = new Date(Date.now() - 3600e3).toISOString();
  const sb = fakeDb({ dse_social_posts: [
    { id: 1, kind: "photos", status: "draft", scheduled_at: later, slack: {} },
    { id: 2, kind: "photos", status: "draft", scheduled_at: later, slack: {} },
    { id: 3, kind: "photos", status: "draft", scheduled_at: past, slack: {} },
  ], dse_social_settings: [{ id: 1, intro_time: "18:30" }], hq_kv: [] });
  let r = await S.approvePost(sb, 1, "Drew");
  assert.equal(r.post.scheduled_at, later, "approving keeps the planned evening"); assert.equal(r.due, false);
  r = await S.approvePost(sb, 2, "Drew", { now: true });
  assert.ok(r.due, "post now overrides it");
  r = await S.approvePost(sb, 3, "Drew");
  assert.ok(r.due, "a photo post whose evening passed goes out now");
  ok("approval keeps the planned time; post now and passed times go now");
}

console.log(`dse social: ${n} groups passed`);

// ── stand-ins ──────────────────────────────────────────────────────────────
function fakeRes() {
  const r = { statusCode: 200, headers: {}, body: "" };
  r.status = (c) => { r.statusCode = c; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  r.send = (b) => { r.body = String(b); return r; };
  return r;
}
// Just enough of the Supabase query builder for these paths.
function fakeDb(tables) {
  const db = { tables, storage: { from: () => ({ getPublicUrl: (p) => ({ data: { publicUrl: "https://public/" + p } }), upload: async () => ({}), createSignedUploadUrl: async (p) => ({ data: { signedUrl: "https://signed/" + p } }) }) } };
  db.from = (name) => {
    const rows = (tables[name] ||= []);
    let op = "select", payload = null;
    const filters = [];
    const match = (r) => filters.every(f => f(r));
    const q = {
      select() { return q; }, order() { return q; }, limit() { return q; },
      update(p) { op = "update"; payload = p; return q; },
      insert(p) { op = "insert"; payload = p; return q; },
      eq(k, v) { filters.push(r => r[k] === v); return q; },
      in(k, vs) { filters.push(r => vs.includes(r[k])); return q; },
      is(k, v) { filters.push(r => (r[k] ?? null) === v); return q; },
      gte(k, v) { filters.push(r => r[k] == null || r[k] >= v); return q; },
      run() {
        if (op === "insert") { const row = { id: rows.length + 1, ...payload }; rows.push(row); return [row]; }
        const hit = rows.filter(match);
        if (op === "update") hit.forEach(r => Object.assign(r, payload));
        return hit.map(r => ({ ...r }));
      },
      async maybeSingle() { return { data: q.run()[0] || null, error: null }; },
      async single() { const d = q.run()[0]; return { data: d || null, error: d ? null : { message: "no row" } }; },
      then(res, rej) { return Promise.resolve({ data: q.run(), error: null }).then(res, rej); },
    };
    return q;
  };
  return db;
}
