// Offline checks for DSSC People v2: family profiles (stage, products, how
// they answer texts and emails, birthdays, spend tiers), the new segment
// filters, the text audience of a segment, the revenue ideas, and campaigns
// (template draft, scheduling onto the Marketing calendar, status, results).
// No Supabase / Claude calls - scripts/fake-supabase.mjs and synthetic families.
//
//   node scripts/test-crm-v2.mjs

import { fakeSupabase } from "./fake-supabase.mjs";
import { buildFamilies, familyMatches, resolveSegment, resolveSegmentPhones, describeSegment, EMPTY_SEGMENT } from "../shared/crm-segments.js";
import { nextBirthday, privateCoach, hasProduct, channelLine } from "../shared/crm-profile.js";
import { revenueIdeas, typicalPrices, offerText, nextBestFor } from "../shared/crm-ideas.js";
import { buildPeople, resolveAudience } from "../shared/campaign-audience.js";

delete process.env.ANTHROPIC_API_KEY;
const { draftCampaign, scheduleCampaign, removeItems, campaignResults, lineFor } = await import("../api/_lib/crm-campaigns.js");
const { run } = await import("../api/crm-campaigns.js");

let failed = 0;
const check = (ok, label) => { console.log((ok ? "PASS  " : "FAIL  ") + label); if (!ok) failed++; };
const S = (x) => ({ ...EMPTY_SEGMENT, ...x });
const TODAY = "2026-10-29";

// ── the families ─────────────────────────────────────────────────────────────
const contact = (id, o = {}) => ({ id, first_name: "P" + id, last_name: "Fam", email: `p${id}@example.com`, phone: `51255500${String(id).padStart(2, "0")}`, sources: [], lists: [], tags: [], ...o });
const buy = (id, contact_id, program, date, cents, o = {}) => ({ id, contact_id, participant_id: null, program, category: "volleyball", kind: "ClassRegistration", amount_cents: cents, purchased_at: date + "T15:00:00Z", ...o });
const data = {
  contacts: [
    contact(1, { first_name: "Pat" }),                                   // prospect, filled a form
    contact(2),                                                          // new
    contact(3),                                                          // active, open gym member, answers texts
    contact(4),                                                          // cooling, lapsed open gym
    contact(5, { email: "gone@example.com" }),                           // lapsed, unsubscribed
    contact(6, { email_status: "bounced" }),                             // lost, bounced
    contact(7, { phone: null }),                                         // only a booking next week; no phone
    contact(8, { do_not_text: true }),                                   // privates; do not text
    contact(9),                                                          // opted out; rentals + party
    contact(10, { email: "not-an-email", phone: "5125550003" }),         // same phone as #3
  ],
  participants: [
    { id: 101, contact_id: 3, first_name: "Ava", last_name: "Fam", dob: "2014-11-10", gender: "female" },     // birthday in 12 days, turns 12
    { id: 102, contact_id: 3, first_name: "Max", last_name: "Fam", dob: "2016-03-01", gender: "male" },
    { id: 103, contact_id: 2, first_name: "Zoe", last_name: "Fam", dob: "2013-05-05", gender: "female", dse_level: "Regional" },
    { id: 104, contact_id: 3, first_name: "Parent", last_name: "Fam", dob: "1985-01-01", is_contact: true },
  ],
  participation: [
    { id: 201, contact_id: 7, participant_id: null, program: "U12 Fall Skills", category: "volleyball", event_date: "2026-11-05" },
    { id: 202, contact_id: 2, participant_id: 103, program: "U14 Clinic", category: "volleyball", event_date: "2026-10-01" },
  ],
  purchases: [
    buy(301, 3, "U12 Fall Skills", "2025-09-01", 15000),
    buy(302, 3, "Open Gym Monthly", "2026-06-10", 4000, { category: "facility", kind: "UserSubscription" }),
    buy(303, 3, "Open Gym Monthly", "2026-08-10", 4000, { category: "facility", kind: "UserSubscription" }),
    buy(304, 3, "Open Gym Monthly", "2026-10-10", 4000, { category: "facility", kind: "UserSubscription" }),
    buy(305, 4, "Open Gym Monthly", "2026-06-01", 4000, { category: "facility", kind: "UserSubscription" }),
    buy(306, 5, "Shooting Lab", "2026-01-15", 4000, { category: "basketball" }),
    buy(307, 6, "Summer Camp", "2025-06-01", 20000),
    buy(308, 8, "Hunter H. Private Lessons", "2026-10-20", 9000),
    buy(309, 8, "Hunter Private Lesson", "2026-10-27", 9000),
    buy(310, 9, "Volleyball Court 2", "2026-10-01", 21000, { category: "facility" }),
    buy(311, 9, "Birthday Party - Gold", "2026-09-15", 45000, { category: "other" }),
  ],
  orders: [],
  unsubscribes: [{ email: "gone@example.com" }],
  smsStats: [{ phone10: "5125550003", sent: 4, replies: 2, last_reply_at: "2026-10-20T15:00:00Z" }, { phone10: "5125550004", sent: 3, replies: 0 }],
  emailStats: [{ email: "p3@example.com", opens: 5, clicks: 1, last_open_at: "2026-10-25T12:00:00Z" }],
  optouts: [{ phone: "+15125550009" }],
  touches: [{ id: 1, contact_id: 1, kind: "inquiry", source: "website", detail: "Asked about Reach", at: "2026-10-27T12:00:00Z" }],
};
data.contacts[0].interests = ["reach"];
const index = buildFamilies(data, TODAY);
const P = (id) => index.fams.get(id).profile;

// ── 1. profiles ──────────────────────────────────────────────────────────────
console.log("== 1. profiles ==");
check([1, 2, 3, 4, 5, 6].map(i => P(i).stage).join() === "prospect,new,active,cooling,lapsed,lost", `stages: ${[1, 2, 3, 4, 5, 6].map(i => P(i).stage).join()}`);
check(P(7).stage === "new" && P(7).lastPast === null && P(7).next === "2026-11-05", `a booking next week only: new, nothing past, next Nov 5 (${P(7).stage}, ${P(7).lastPast}, ${P(7).next})`);
check(P(3).lastPast === "2026-10-10" && P(3).next === null, "last past purchase, nothing ahead");
check(P(3).products.open_gym?.active === true && P(4).products.open_gym?.active === false, "open gym: Oct 10 = member, June = lapsed");
check(hasProduct(P(3), "open_gym_active") && hasProduct(P(4), "open_gym_lapsed") && !hasProduct(P(4), "open_gym_active"), "hasProduct open gym active / lapsed");
check(P(8).products.privates?.count === 2 && P(8).products.privates.coaches.join() === "Hunter", `privates with Hunter (two spellings): ${JSON.stringify(P(8).products.privates)}`);
check(P(9).products.rentals && P(9).products.parties && !P(9).products.privates, "court rental + birthday party");
check(privateCoach("Breanna C Private Lessons") === "Breanna" && privateCoach("Open Gym") === null, "private coach from the program name");
check(P(3).buys12 === 3 && P(3).every === 61, `3 purchase days in 12 months, every ~61 days (${P(3).buys12}, ${P(3).every})`);
check(P(3).text.state === "ok" && P(3).text.responds === "yes" && P(3).text.replies === 2, "answers texts");
check(P(4).text.responds === "no" && P(2).text.responds === "untested", "texted and silent vs never texted");
check(P(9).text.state === "opted_out" && P(8).text.state === "opted_out" && P(7).text.state === "none", "opted out, do not text, no phone");
check(P(3).email.state === "ok" && P(3).email.opens === 5 && P(5).email.state === "unsubscribed" && P(6).email.state === "bounced" && P(10).email.state === "none", "email: opens, unsubscribed, bounced, none");
check(P(1).reached.count === 1 && P(1).reached.kinds.join() === "inquiry" && P(1).reached.interests.join() === "reach", "a form: reached, asked about Reach");
check(P(3).kids === 2 && P(3).birthdays[0]?.name === "Ava" && P(3).birthdays[0].days === 12 && P(3).birthdays[0].turns === 12, `kids exclude the parent; Ava's birthday in 12 days (${JSON.stringify(P(3).birthdays[0])})`);
check(nextBirthday("2012-02-29", "2027-03-01")?.date === "2028-02-28" && nextBirthday("2010-10-29", TODAY)?.days === 0, "Feb 29 birthdays and today's birthday");
check(P(2).dse === true && P(3).dse === false, "DS Elite family");
check(P(9).tier === "vip" && P(1).tier === null, `tiers: biggest spender VIP, prospects none (${P(9).tier}, ${P(1).tier})`);
check(channelLine(P(3)) === "✉ opens (5) · 💬 replies (2)", channelLine(P(3)));

// ── 2. segment filters ───────────────────────────────────────────────────────
console.log("== 2. segment filters ==");
const ids = (seg) => [...index.fams.values()].filter(f => familyMatches(f, seg, { today: TODAY })).map(f => f.c.id).sort((a, b) => a - b).join();
check(ids(S({ stages: ["cooling", "lapsed"] })) === "4,5", "stages");
check(ids(S({ products: ["open_gym_active"] })) === "3", "has open gym");
check(ids(S({ stages: ["active", "new"], noProducts: ["open_gym_active"] })) === "2,7,8,9", "active without open gym");
check(ids(S({ texts: "replies" })) === "3,10" && ids(S({ texts: "silent" })) === "4", "answers texts (#10 shares #3's phone) / never answers");
check(ids(S({ reached: "yes" })) === "1" && ids(S({ interests: ["reach"] })) === "1", "reached out, asked about Reach");
check(ids(S({ birthdayDays: "30" })) === "3", "a birthday in 30 days");
check(ids(S({ minKids: "2" })) === "3", "2+ kids");
check(ids(S({ minBuys: "2" })) === "3,8,9" && ids(S({ customers: "customers", maxBuys: "0" })) === "2,6,7", "purchases a year");
check(ids(S({ ids: [4, "5"] })) === "4,5", "hand-picked");
check(ids(S({ products: ["privates"], notSince: "2026-10-25" })) === "" && ids(S({ products: ["privates"], notSince: "2026-10-28" })) === "8", "hasn't booked since");
check(ids(S({ products: ["rentals"], notSince: "2026-09-01", notSinceCats: ["basketball"] })) === "9", "hasn't booked since, in one category");
check(ids(S({ tiers: ["vip"] })) === "9", "VIP");
check(describeSegment(S({ stages: ["cooling"], products: ["open_gym_active"], texts: "replies", notSince: "2026-11-01" })) === "cooling · has open gym · answers texts · no booking since 2026-11-01", describeSegment(S({ stages: ["cooling"], products: ["open_gym_active"], texts: "replies", notSince: "2026-11-01" })));

// ── 3. who a segment reaches ─────────────────────────────────────────────────
console.log("== 3. email and text audiences ==");
const all = S({});
const em = resolveSegment(index, all), tx = resolveSegmentPhones(index, all);
check(em.recipients.length === 7 && em.suppressed.unsubscribed === 1 && em.suppressed.bounced === 1 && em.suppressed.no_email === 1, `email: 7 (unsubscribed, bounced, bad address left out): ${JSON.stringify(em.suppressed)}`);
check(tx.recipients.length === 6 && tx.noPhone === 1 && tx.optedOut === 2, `text: 6 (no phone, opted out and do-not-text left out; #10 shares #3's phone): ${tx.recipients.length} ${tx.noPhone} ${tx.optedOut}`);
const r3 = tx.recipients.find(r => r.contact_id === 3);
check(r3?.to === "+15125550003" && r3.first === "P3" && r3.players.join() === "Ava Fam,Max Fam" && r3.kind === "parent", `text recipient shape: ${JSON.stringify(r3)}`);
// The text engine still checks its own opt-out list on a ready list.
const people = buildPeople({ contacts: [], participants: [], participation: [], players: [], teams: [], roster: [], clinics: [], coaches: [], optouts: [{ phone: "+15125550002", brand: "dssc" }] }, TODAY);
const list = resolveAudience(people, { target: "list", list: [...tx.recipients, { to: "+15125550003", name: "dup", players: ["Ava Fam", "New Kid"] }, { to: "+15125550099", name: "x", doNotText: true }] }, "dssc");
check(list.recipients.length === 5 && list.skipped.some(s => s.reason === "opted out") && list.skipped.some(s => s.reason === "do not text"), `list target: opt-outs and do-not-text skipped (${list.recipients.length}, ${JSON.stringify(list.skipped.map(s => s.reason))})`);
check(list.recipients.find(r => r.to === "+15125550003")?.players.join() === "Ava Fam,Max Fam,New Kid", "list target: same phone merges players");

// ── 4. revenue ideas ─────────────────────────────────────────────────────────
console.log("== 4. revenue ideas ==");
const prices = typicalPrices(index);
check(prices.open_gym === 4000 && prices.private === 9000 && prices.party === 45000 && prices.rental === 21000, `typical prices from purchases: ${JSON.stringify(prices)}`);
const ideas = revenueIdeas(index);
check(ideas.length > 0 && ideas.every(i => i.reach > 0) && ideas.every((i, k) => !k || ideas[k - 1].est >= i.est), `${ideas.length} ideas, each reaches someone, best first`);
const og = ideas.find(i => i.key === "open_gym_comeback");
check(og && og.families === 1 && og.est === Math.round(1 * 0.2 * 12000 / 100), `lapsed open gym: 1 family × 20% × $120 = $${og?.est} (dollars, not cents)`);
check(ideas.find(i => i.key === "renters")?.offer_text.startsWith("book 4 court hours, get the 5th free (code COURT5, until "), "offer text with code and end date");
check(nextBestFor(index.fams.get(4), ideas, index)?.segment.stages?.includes("cooling") || nextBestFor(index.fams.get(4), ideas, index)?.key === "open_gym_comeback", "next best offer for a cooling open gym family");
check(offerText({ kind: "percent", value: 50, code: "COMEBACK50", expires: "2026-11-19" }) === "50% off your next class (code COMEBACK50, until Nov 19)", offerText({ kind: "percent", value: 50, code: "COMEBACK50", expires: "2026-11-19" }));
check(offerText({ kind: "free_week" }) === "a free week of open gym" && offerText({ kind: "none" }) === "", "free week; no offer");

// ── 5. campaigns ─────────────────────────────────────────────────────────────
console.log("== 5. campaigns ==");
check(lineFor({ goal: "membership", segment: {} }) === "open_gym" && lineFor({ goal: "try_new", segment: { noProducts: ["basketball"] } }) === "basketball" && lineFor({ goal: "winback", segment: {} }) === "club", "program area from goal and audience");
const camp0 = { goal: "winback", cadence: "three", channels: ["email", "text"], offer: { kind: "percent", value: 50, code: "COMEBACK50" }, line: "club" };
const dr = await draftCampaign(fakeSupabase({ mkt_settings: [] }), camp0, { label: "cooling", families: 2, emailable: 2, textable: 1 });
check(dr.error && dr.steps.map(s => `${s.day}${s.channel}${s.who}`).join() === "0emaileveryone,3textnot_booked,7emailnot_booked" && dr.steps[1].sms.includes("50% off"), `no API key: template steps in the cadence (${dr.error})`);
const dr2 = await draftCampaign(fakeSupabase({ mkt_settings: [] }), { ...camp0, channels: ["email"] }, { label: "x", families: 1, emailable: 1, textable: 0 });
check(dr2.steps.length === 2 && dr2.steps.every(s => s.channel === "email"), "email only drops the text step");

const ctToday = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const db = () => fakeSupabase({
  dssc_contacts: data.contacts, dssc_participants: data.participants, dssc_participation: data.participation.map(p => ({ ...p, created_at: "2026-09-01T00:00:00Z" })),
  dssc_purchases: data.purchases, dssc_orders: [], mkt_unsubscribes: data.unsubscribes, dssc_sms_stats: data.smsStats, dssc_email_stats: [], sms_optouts: [{ phone: "+15125550009", brand: "dssc" }],
  dssc_touches: data.touches, mkt_photos: [], mkt_settings: [], mkt_items: [], sms_campaigns: [],
  crm_campaigns: [{ id: 7, name: "Come back", status: "draft", goal: "winback", segment: S({ ids: [3, 4, 5] }), offer: { kind: "percent", value: 50, code: "COMEBACK50" }, steps: dr.steps, starts_on: null }],
});
const sb = db();
const row = await scheduleCampaign(sb, sb.db.crm_campaigns[0], { by: "Drew", startsOn: ctToday });
const items = sb.db.mkt_items;
check(row.status === "scheduled" && items.length === 3 && row.item_ids.length === 3 && row.audience_count === 3, `scheduled: 3 calendar items for 3 families (${row.status}, ${items.length}, ${row.audience_count})`);
check(items[0].channel === "email" && items[0].kind === "dedicated" && items[0].status === "draft" && items[0].crm_campaign_id === 7 && /<html|<table/i.test(items[0].email_html || "") && items[0].scheduled_at.includes("T12:30") || items[0].scheduled_at.includes("T13:30"), `email step: a dedicated email draft at 7:30 CT (${items[0].scheduled_at})`);
check(items[1].channel === "sms" && items[1].kind === "text" && items[1].audience.target === "crm" && items[1].audience.segment.notSince === ctToday && items[1].body.includes("COMEBACK50"), "text step: CRM audience, drops anyone who booked since the start");
check(!items[0].audience.segment.notSince && items[2].audience.segment.notSince === ctToday, "day-0 email goes to everyone; the last call only to who hasn't booked");
check(row.steps.every(s => s.item_id) && row.audience_ids.join() === "3,4,5", "steps remember their calendar items; the audience is kept for results");
await scheduleCampaign(sb, { ...sb.db.crm_campaigns[0], starts_on: "2020-01-01" }, { by: "Drew" }).then(() => check(false, "past start refused"), e => check(/passed/.test(e.message), "a start date in the past is refused"));
await scheduleCampaign(sb, { ...sb.db.crm_campaigns[0], segment: S({ ids: [999] }) }, { by: "Drew", startsOn: ctToday }).then(() => check(false, "empty audience refused"), e => check(/Nobody/.test(e.message) && sb.db.mkt_items.length === 3, "an empty audience is refused, and the calendar is left alone"));
// Rescheduling after the first email went out: it stays, the rest are replaced, the start doesn't move.
const sentId = items[0].id;
items[0].status = "published";
const again = await scheduleCampaign(sb, { ...sb.db.crm_campaigns[0] }, { by: "Drew", startsOn: "2099-01-01" });
check(sb.db.mkt_items.length === 3 && sb.db.mkt_items.filter(i => i.status === "published").length === 1 && again.item_ids[0] === sentId && again.item_ids.length === 3, `rescheduling keeps the sent step and replaces the others (${sb.db.mkt_items.length} items)`);
check(again.status === "live" && again.starts_on === ctToday && sb.db.mkt_items.every(i => !i.audience.segment.notSince || i.audience.segment.notSince === ctToday), "a live campaign keeps its start date");

// Status through the API's list: scheduled -> live -> done.
const who = { me: "drew@example.com", name: "Drew Rose" };
sb.db.crm_campaigns[0].status = "scheduled";
let L = await run(sb, who, { action: "list" });
check(L.campaigns[0].status === "live" && L.campaigns[0].sent_item_ids.join() === String(sentId), `one step sent: live, and the editor knows which (${L.campaigns[0].status})`);
// Rewriting a live campaign can't change the step that went out.
await run(sb, who, { action: "save", campaign: { id: 7, steps: sb.db.crm_campaigns[0].steps.map(s => ({ ...s, item_id: undefined, headline: "Rewritten" })) } });
check(sb.db.crm_campaigns[0].steps[0].headline !== "Rewritten" && sb.db.crm_campaigns[0].steps[0].item_id === sentId && sb.db.mkt_items.length === 3 && sb.db.mkt_items.filter(i => i.headline === "Rewritten").length === 2, "saving a live campaign keeps the sent step, refreshes the rest");
for (const i of sb.db.mkt_items) i.status = "published";
L = await run(sb, who, { action: "list" });
check(L.campaigns[0].status === "done", `every step sent: done (${L.campaigns[0].status})`);
await run(sb, who, { action: "delete", id: 7 }).then(() => check(false, "delete a done campaign"), e => check(/draft/.test(e.message), "only a draft can be deleted"));
const n = await removeItems(sb, sb.db.crm_campaigns[0], { onlyUnsent: true });
check(n === 0 && sb.db.mkt_items.length === 3, "cancel never removes sent steps");

// Results: who booked within 45 days of the start, and what they spent.
sb.db.crm_campaigns[0].starts_on = "2026-10-01";
const res = await campaignResults(sb, sb.db.crm_campaigns[0]);
check(res.booked === 1 && res.revenue === 4000 && res.families[0].id === 3 && res.families[0].what.includes("Open Gym Monthly"), `results: family #3 booked open gym, $40 (${res.booked}, ${res.revenue})`);
check(res.window.to === "2026-11-15" && res.audience === 3, "45-day window over the planned audience");

// Saving words on a scheduled campaign puts the new steps on the calendar.
const sb2 = db();
await scheduleCampaign(sb2, sb2.db.crm_campaigns[0], { by: "Drew", startsOn: ctToday });
const firstIds = sb2.db.mkt_items.map(i => i.id).join();
const steps = sb2.db.crm_campaigns[0].steps.map((s, i) => i === 0 ? { ...s, headline: "New words" } : s);
await run(sb2, who, { action: "save", campaign: { id: 7, steps } });
check(sb2.db.mkt_items.length === 3 && sb2.db.mkt_items[0].headline === "New words" && sb2.db.mkt_items.map(i => i.id).join() !== firstIds, "editing a scheduled campaign refreshes its calendar drafts");
const c2 = await run(sb2, who, { action: "cancel", id: 7 });
check(c2.campaign.status === "cancelled" && c2.removed === 3 && sb2.db.mkt_items.length === 0, "cancel takes the unsent steps off the calendar");

// ── 6. Upper Hand re-import ──────────────────────────────────────────────────
console.log("== 6. Upper Hand ==");
const { importUpperHand } = await import("../api/_lib/dssc-crm.js");
const uhdb = fakeSupabase({
  dssc_contacts: [
    { id: 1, email: "jen@example.com", first_name: "Jennifer", last_name: "Smith", phone: "+15125550101", address: null, city: null, sources: ["playbook"] },
    ...Array.from({ length: 1100 }, (_, i) => ({ id: 100 + i, email: `filler${i}@example.com`, first_name: "Filler", last_name: "N" + i, sources: ["playbook"] })),
    { id: 2000, email: "late@example.com", first_name: "Lee", last_name: "Late", sources: ["playbook"] },
  ],
  dssc_participants: [], dssc_orders: [{ id: "o4", contact_id: 2000, buyer: "Jen Smith", total_cents: 100 }],
});
const uh = await importUpperHand(uhdb, {
  contacts: [
    { email: "Jen@Example.com", first_name: "Jen", last_name: "Smith", phone_number: "(512) 555-0199", address_line_1: "1 Main St", city: "dripping springs", postal_code: "78620" },
    { email: "late@example.com", first_name: "Lee", last_name: "Late", phone_number: "" },
  ],
  participants: [
    { email: "jen@example.com", first_name: "Ava", last_name: "Smith", gender: "Female", date_of_birth: "2014-11-10", phone: "" },
    { email: "jen@example.com", first_name: "Mark", last_name: "Smith", gender: "Male", date_of_birth: "1980-02-02", phone: "" },
  ],
  orders: [
    { Id: "o1", Buyer: "Jen Smith", Total: "7500", "Date & Time": "07/31/2026 3:04 pm" },     // the holder's name in this export
    { Id: "o2", Buyer: "Mark Smith", Total: "4000", "Date & Time": "07/30/2026 9:00 am" },    // a second parent on the account
    { Id: "o3", Buyer: "Lee Late", Total: "1000", "Date & Time": "07/29/2026 9:00 am" },      // a family past the first 1,000 rows
    { Id: "o4", Buyer: "Jen Smith", Total: "100", "Date & Time": "07/28/2026 9:00 am" },      // already linked: stays
    { Id: "o5", Buyer: "Nobody Known", Total: "0", "Date & Time": "07/27/2026 9:00 am" },
  ],
});
const jen2 = uhdb.db.dssc_contacts.find(c => c.id === 1);
check(jen2.first_name === "Jennifer" && jen2.phone === "+15125550101" && jen2.address === "1 Main St" && jen2.city === "Dripping Springs" && jen2.zip === "78620" && jen2.sources.join() === "playbook,upperhand", `fills gaps only: name and phone kept, address added (${jen2.first_name}, ${jen2.phone}, ${jen2.address})`);
check(uhdb.db.dssc_participants.filter(p => p.contact_id === 1).map(p => p.first_name).sort().join() === "Ava,Mark", "people on the account added to the family");
const oc = Object.fromEntries(uhdb.db.dssc_orders.map(o => [o.id, o.contact_id]));
check(oc.o1 === 1 && oc.o2 === 1 && oc.o3 === 2000 && oc.o4 === 2000 && oc.o5 === null && uh.ordersMatched === 4, `orders linked by holder, second parent, past 1,000 families; unknown left (${JSON.stringify(oc)})`);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
