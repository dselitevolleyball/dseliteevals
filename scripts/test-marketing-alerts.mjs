// Publishing alerts: a day-ahead warning when Facebook can't post an approved
// item, and an email listing what just failed. Run: node scripts/test-marketing-alerts.mjs
import assert from "node:assert/strict";
process.env.RESEND_API_KEY = "re_test"; process.env.DSSC_FROM_EMAIL = "DSSC <hello@drippingsportsclub.com>";
const sent = [];
globalThis.fetch = async (url, o) => { assert.match(String(url), /api\.resend\.com/); sent.push(JSON.parse(o.body)); return new Response(JSON.stringify({ id: "em_" + sent.length })); };
const { metaHeadsUp, failureAlert } = await import("../api/_lib/marketing-alerts.js");

const now = new Date("2026-10-24T22:00:00Z");
const db = {
  mkt_items: [
    { id: 23, channel: "social", kind: "reel", line: "volleyball", headline: "POV: NOTHING HITS THE FLOOR", platforms: ["instagram", "facebook"], status: "approved", scheduled_at: "2026-10-25T20:00:00Z", week_of: "2026-10-20" },
    { id: 24, channel: "social", kind: "post", line: "basketball", headline: "Later", platforms: ["facebook"], status: "approved", scheduled_at: "2026-10-27T20:00:00Z" },
    { id: 25, channel: "email", kind: "roundup", line: "club", email_subject: "This week", status: "approved", scheduled_at: "2026-10-24T23:00:00Z" },
    { id: 22, channel: "social", kind: "post", line: "parties", headline: "Book Fall Birthdays Early", status: "failed", scheduled_at: "2026-10-23T19:00:00Z", week_of: "2026-10-20", error: "x" },
  ],
  mkt_log: [],
};
const q = (t) => {
  const f = []; let lim = null;
  const b = { select() { return b; }, eq(k, v) { f.push(r => r[k] === v); return b; }, gte(k, v) { f.push(r => r[k] >= v); return b; }, lte(k, v) { f.push(r => r[k] <= v); return b; }, in(k, v) { f.push(r => v.includes(r[k])); return b; }, order() { return b; }, limit(n) { lim = n; return b; },
    insert(row) { db[t].push({ id: db[t].length + 1, at: new Date().toISOString(), ...row }); return Promise.resolve({ error: null }); },
    then(res) { let d = db[t].filter(r => f.every(fn => fn(r))); if (t === "mkt_log") d = d.reverse(); res({ data: lim ? d.slice(0, lim) : d, error: null }); } };
  return b;
};
const sb = { from: q };
const settings = { notify_emails: ["drew@drippingsportsclub.com", "not-an-email"] };
let checks = 0;
const broken = async () => { checks++; return { ok: false, problems: ["Missing permissions: pages_manage_posts"] }; };

// Due in 24h and Facebook broken → one email naming the reel (not the later post or the email).
const a = await metaHeadsUp(sb, settings, { now, check: broken });
assert.equal(a.due, 1); assert.equal(a.emailed, true); assert.equal(sent.length, 1);
assert.match(sent[0].subject, /Facebook is disconnected — 1 approved post/);
assert.match(sent[0].html, /NOTHING HITS THE FLOOR/); assert.doesNotMatch(sent[0].html, /Later/);
assert.match(sent[0].html, /mtab=settings/); assert.deepEqual(sent[0].to, ["drew@drippingsportsclub.com"]);
// Next run: health cached (no new check), already alerted → no second email.
const b = await metaHeadsUp(sb, settings, { now, check: broken });
assert.equal(checks, 1); assert.equal(sent.length, 1); assert.ok(b.alerted);
// Healthy connection → nothing.
db.mkt_log = [];
assert.deepEqual(await metaHeadsUp(sb, settings, { now, check: async () => ({ ok: true, problems: [] }) }), { due: 1, ok: true });
assert.equal(sent.length, 1);
// Nothing due → doesn't even check.
db.mkt_items[0].status = "published"; checks = 0;
assert.deepEqual(await metaHeadsUp(sb, settings, { now, check: broken }), { due: 0 }); assert.equal(checks, 0);

// Failures → one email with each reason; a Meta error points at Reconnect.
assert.equal(await failureAlert(sb, settings, [{ id: 23, status: "published" }]), null);
const f = await failureAlert(sb, settings, [{ id: 22, status: "failed", error: "Meta photos: Any of the pages_read_engagement ... permission(s) must be granted before impersonating a user's page." }, { id: 25, status: "error", error: "Resend 422" }, { id: 23, status: "published" }]);
assert.equal(f.failed, 2); assert.equal(sent.length, 2);
assert.match(sent[1].subject, /2 marketing items didn't go out — Facebook needs reconnecting/);
assert.match(sent[1].html, /impersonating/); assert.match(sent[1].html, /Resend 422/); assert.match(sent[1].html, /Reconnect in HQ/);
const g = await failureAlert(sb, settings, [{ id: 25, status: "failed", error: "Resend 422" }]);
assert.doesNotMatch(sent[2].subject, /Facebook/); assert.match(sent[2].html, /Open the Calendar/);
console.log("all marketing alert checks passed");
