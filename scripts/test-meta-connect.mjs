// Reconnect Facebook: a pasted user token becomes the club Page's token
// (long-lived when the app secret is known); bad tokens are refused, nothing saved.
// Run: node scripts/test-meta-connect.mjs
import assert from "node:assert/strict";
process.env.META_PAGE_ID = "463632080157372"; process.env.META_IG_USER_ID = "17841469408011711";
const { connectMeta, metaCheck } = await import("../api/_lib/marketing-publish.js");

const USER = "EAAuser" + "x".repeat(60), LONG = "EAAlong" + "y".repeat(60), PAGE = "EAApage" + "z".repeat(60), BAD = "EAAbad" + "q".repeat(60);
const ALL = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish"];
const calls = [];
globalThis.fetch = async (u) => {
  const url = new URL(String(u)), p = url.pathname.replace(/^\/v[\d.]+\//, ""), q = Object.fromEntries(url.searchParams), t = q.access_token;
  calls.push(p);
  const j = (o) => new Response(JSON.stringify(o));
  if (p === "debug_token") {
    const it = q.input_token;
    if (it === BAD) return j({ data: { is_valid: false } });
    if (it === USER) return j({ data: { is_valid: true, type: "USER", app_id: "42", expires_at: Math.floor(Date.now() / 1000) + 3600, scopes: ALL } });
    if (it === PAGE) return j({ data: { is_valid: true, type: "PAGE", expires_at: 0, data_access_expires_at: 0, scopes: ALL } });
  }
  if (p === "oauth/access_token") { assert.equal(q.client_secret, "sekret"); assert.equal(q.client_id, "42"); return j({ access_token: LONG }); }
  if (p === "me/accounts") { assert.equal(t, LONG); return j({ data: [{ id: "1", name: "Other", access_token: "nope" }, { id: "463632080157372", name: "Dripping Springs Sports Club", access_token: PAGE }] }); }
  if (p === "me") return j(t === PAGE ? { id: "463632080157372", name: "Dripping Springs Sports Club" } : { id: "u1", name: "Drew" });
  if (p === "463632080157372") return j({ id: "463632080157372", name: "Dripping Springs Sports Club", instagram_business_account: { id: "17841469408011711" } });
  return j({ error: { message: "unexpected " + p } });
};
const saved = {};
const sb = { from: () => ({ upsert: async (r) => { saved[r.key] = r; return { error: null }; }, select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) };

await assert.rejects(() => connectMeta(sb, { token: "short" }), /doesn't look like/);
await assert.rejects(() => connectMeta(sb, { token: BAD }), /isn't valid/);
assert.equal(saved.meta_page_token, undefined);

const r = await connectMeta(sb, { token: USER, appSecret: "sekret", by: "drew" });
assert.equal(saved.meta_page_token.value, PAGE);
assert.equal(saved.meta_app_secret.value, "sekret");
assert.equal(r.check.ok, true); assert.equal(r.check.expires, "never");
assert.deepEqual(r.steps, ["swapped for a long-lived token", "found the Page token for Dripping Springs Sports Club"]);
assert.ok(!JSON.stringify(r).includes(PAGE), "the token is never returned");
const c = await metaCheck(PAGE);
assert.equal(c.ok, true); assert.equal(c.type, "PAGE");
console.log("all meta connect checks passed");
