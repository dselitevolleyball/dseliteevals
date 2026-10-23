// Website newsletter sign-ups → HQ People. Run: node scripts/test-site-subscribers.mjs
import assert from "node:assert/strict";
import { syncSiteSubscribers, SITE_LIST } from "../api/_lib/site-subscribers.js";

const site = [
  { email: "new@x.com", first_name: "New", last_signup_at: "2026-10-23T10:00:00Z", unsubscribed_at: null },
  { email: "Known@X.com", first_name: null, last_signup_at: "2026-10-23T10:00:00Z", unsubscribed_at: null },
  { email: "listed@x.com", last_signup_at: "2026-10-01T10:00:00Z", unsubscribed_at: null },
  { email: "left@x.com", last_signup_at: "2026-10-01T10:00:00Z", unsubscribed_at: "2026-10-10T10:00:00Z" },
  { email: "back@x.com", last_signup_at: "2026-10-20T10:00:00Z", unsubscribed_at: null },
  { email: "stillout@x.com", last_signup_at: "2026-09-01T10:00:00Z", unsubscribed_at: null },
  { email: "not-an-email", unsubscribed_at: null },
];
globalThis.fetch = async (url, o) => { assert.match(url, /site_subscribers/); assert.equal(o.headers.apikey, "k"); return new Response(JSON.stringify(site)); };
const db = {
  contacts: [{ email: "known@x.com", first_name: "Kay", lists: [] }, { email: "listed@x.com", lists: [SITE_LIST] }, { email: "back@x.com", lists: [SITE_LIST] }, { email: "stillout@x.com", lists: [SITE_LIST] }],
  unsubs: [{ email: "back@x.com", created_at: "2026-10-05T00:00:00Z" }, { email: "stillout@x.com", created_at: "2026-10-05T00:00:00Z" }],
};
const T = { dssc_contacts: "contacts", mkt_unsubscribes: "unsubs" };
const sb = {
  from: (t) => {
    const rows = () => db[T[t]];
    const q = { _in: null, select() { return q; }, in(_, v) { q._in = v; return q; },
      then(res) { res({ data: rows().filter(r => !q._in || q._in.includes(r.email)), error: null }); },
      upsert(list, o) { for (const r of list) if (!rows().some(x => x.email === r.email)) rows().push({ lists: [], created_at: new Date().toISOString(), ...r }); else assert.ok(o.ignoreDuplicates); return Promise.resolve({ error: null }); },
      delete() { return { in: (_, v) => { db[T[t]] = rows().filter(r => !v.includes(r.email)); return Promise.resolve({ error: null }); } }; } };
    return q;
  },
  rpc: async (fn, a) => { assert.equal(fn, "dssc_add_list"); for (const e of a.p_emails) { const c = db.contacts.find(x => x.email === e); c.lists = [...new Set([...(c.lists || []), a.p_list])]; } return { error: null }; },
};
const env = { SITE_SUPABASE_URL: "https://site.supabase.co/", SITE_SUPABASE_SERVICE_KEY: "k" };

assert.deepEqual(await syncSiteSubscribers(sb, { env: {} }), { skipped: "SITE_SUPABASE_URL / SITE_SUPABASE_SERVICE_KEY not set" });
const dry = await syncSiteSubscribers(sb, { env, dry: true });
assert.deepEqual(dry.added, ["new@x.com", "known@x.com"]); assert.equal(db.contacts.length, 4);
const r = await syncSiteSubscribers(sb, { env });
assert.deepEqual(r.added, ["new@x.com", "known@x.com"]);
assert.deepEqual(r.unsubscribed, ["left@x.com"]);
assert.deepEqual(r.rejoined, ["back@x.com"]);
assert.deepEqual(db.contacts.find(c => c.email === "new@x.com").lists, [SITE_LIST]);
assert.equal(db.contacts.find(c => c.email === "known@x.com").first_name, "Kay");      // existing contact not overwritten
assert.deepEqual(db.unsubs.map(u => u.email).sort(), ["left@x.com", "stillout@x.com"]);   // back@ rejoined; stillout@ unsubscribed after signing up
const again = await syncSiteSubscribers(sb, { env });
assert.deepEqual([again.added, again.unsubscribed, again.rejoined], [[], [], []]);
console.log("all site subscriber checks passed");
