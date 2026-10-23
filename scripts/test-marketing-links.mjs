// Offline checks: Instagram captions point to the bio link (IG links can't be
// tapped), Facebook keeps the link, the email's hero image links to the call
// to action, and the "link in bio" page (api/links.js) lists what was posted.
//   node scripts/test-marketing-links.mjs
import { fakeSupabase } from "./lib/fake-supabase.mjs";

const { captionFor } = await import("../api/_lib/marketing-publish.js");
const { buildEmail } = await import("../api/_lib/marketing-ai.js");
const { handleLinks } = await import("../api/links.js");
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) fails++; };

const item = { channel: "social", line: "volleyball", body: "First session is tonight.", cta_text: "Register now", cta_url: "https://drippingsports.playbookapi.com/programs/more_info/class_package/79681/", hashtags: ["DrippingSprings", "DSSC"] };
const fb = captionFor(item), ig = captionFor(item, "instagram");
check(fb.includes("Register now: https://drippingsports.playbookapi.com/programs/more_info/class_package/79681/"), "Facebook caption keeps the link (tappable there)");
check(!/https?:\/\//.test(ig) && /Register now: link in bio, or go to drippingsportsclub\.com\/volleyball/.test(ig) && /#DrippingSprings #DSSC/.test(ig), `Instagram caption: no URL, "link in bio" + the address to type:\n      ${ig.replace(/\n+/g, " / ")}`);

const html = buildEmail({ channel: "email", kind: "roundup", headline: "Bigger Birthdays", email_subject: "x", body: "Hi", cta_text: "Book a party", cta_url: "https://example.com/party", asset_url: "https://example.com/hero.png", email_blocks: [], programs: [] }).html;
check(/<a href="https:\/\/example\.com\/party"[^>]*><img data-hero src="https:\/\/example\.com\/hero\.png"/.test(html), "the email's hero image links to the call to action");

const now = Date.now(), ago = (d) => new Date(now - d * 86400e3).toISOString();
const sb = fakeSupabase({ mkt_items: [
  { id: 1, channel: "social", status: "published", kind: "post", line: "parties", headline: "POV: IT'S YOUR PARTY", cta_text: "Book a party", cta_url: "https://pb/party", asset_url: "https://img/1.png", published_at: ago(1), platforms: ["facebook", "instagram"] },
  { id: 2, channel: "social", status: "approved", kind: "post", line: "volleyball", headline: "NOT YET", cta_text: "Go", cta_url: "https://pb/x", asset_url: "https://img/2.png", published_at: null, platforms: ["instagram"] },
  { id: 3, channel: "social", status: "published", kind: "post", line: "basketball", headline: "TOO OLD", cta_text: "Go", cta_url: "https://pb/y", asset_url: "https://img/3.png", published_at: ago(60), platforms: ["instagram"] },
  { id: 4, channel: "social", status: "published", kind: "reel", line: "volleyball", headline: "PRACTICE MODE: ON", cta_text: "See volleyball programs", cta_url: "https://pb/vb", asset_url: "https://img/4.png", published_at: ago(0.2), platforms: ["instagram", "facebook"] },
] });
let out = ""; const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; return this; }, status(n) { this.code = n; return this; }, send(s) { out = s; return this; } };
await handleLinks(sb, {}, res);
check(res.code === 200 && /text\/html/.test(res.headers["Content-Type"]) && /s-maxage/.test(res.headers["Cache-Control"]), "links page: 200, HTML, cached briefly at the edge");
check(out.indexOf("PRACTICE MODE: ON") > 0 && out.indexOf("PRACTICE MODE: ON") < out.indexOf("POV: IT&#39;S YOUR PARTY".replace("&#39;", "'")) && !out.includes("NOT YET") && !out.includes("TOO OLD"), "shows posts published in the last 45 days, newest first; not approved-only or old ones");
check(out.includes('href="https://pb/party"') && /Book a party →/.test(out) && /Programs/.test(out) && out.includes("register/volleyball"), "each post has its own button; program links follow");
await handleLinks(null, {}, res);
check(res.code === 200 && /Programs/.test(out) && !/Just posted/.test(out), "without the database it still shows the program links");

console.log(`\n${fails ? fails + " FAILED" : "all checks passed"}`);
process.exit(fails ? 1 : 0);
