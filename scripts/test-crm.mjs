// Offline checks for the DSSC CRM: Playbook spend import, old mailing lists,
// email segments, the marketing email audience (segments, suppression, the
// cold-list cap), and the Resend webhook's signature + event handling.
// No Supabase / Resend calls — an in-memory stand-in (scripts/fake-supabase.mjs)
// and a fake fetch. Synthetic families only.
//
//   node scripts/test-crm.mjs

import { createHmac } from "node:crypto";
import { fakeSupabase } from "./fake-supabase.mjs";
import { importPlaybookSpend, importMailingList, pbTimestamp, categoryOf, statusOf } from "../api/_lib/dssc-crm.js";
import { buildFamilies, resolveSegment, gradeOf, ageOn, describeSegment, EMPTY_SEGMENT } from "../shared/crm-segments.js";
import { registrationHeatmap, recommendCadence, bestTimeFor, lineOfPurchase } from "../shared/marketing-timing.js";

Object.assign(process.env, { RESEND_API_KEY: "re_test", DSSC_FROM_EMAIL: "Dripping Springs Sports Club <hello@drippingsportsclub.com>", MARKETING_UNSUB_SECRET: "unit-test-secret" });
const { emailAudience, sendEmailItem } = await import("../api/_lib/marketing-publish.js");
const { verifySvix, eventEffect } = await import("../api/resend-webhook.js");

let failed = 0;
const check = (ok, label) => { console.log((ok ? "PASS  " : "FAIL  ") + label); if (!ok) failed++; };
const addList = (db, { p_emails, p_list }) => { let n = 0; for (const c of db.dssc_contacts) if (p_emails.includes(c.email)) { c.lists = [...new Set([...(c.lists || []), p_list])]; c.sources = [...new Set([...(c.sources || []), "list"])]; n++; } return n; };
const blank = () => fakeSupabase({ dssc_contacts: [], dssc_participants: [], dssc_participation: [], dssc_purchases: [], dssc_orders: [], mkt_unsubscribes: [], dssc_segments: [], mkt_items: [] }, { rpc: { dssc_add_list: addList } });

// ── 1. Playbook spend ────────────────────────────────────────────────────────
console.log("== 1. Playbook spend import ==");
const reg = (o) => ({ participant_name: "Ava Smith", participant_pk: "N/A", user_first_name: "Jen", user_last_name: "Smith", user_email: "Jen@Example.com", type: "ClassRegistration", source: "U13-15 National Pins", date_created: "02-Sep-2026, 6:30 PM", invoice_number: "Invoice #1001", user_phone: "512-555-0101", participant_DOB: "15-Dec-2013", participant_age: "12", participant_gender: "Female", registration_base_price: "$87.50", club_team_discounts: "N/A", ...o });
const spendRows = [
  ...Array.from({ length: 4 }, () => reg({})),                                           // a $350 package over 4 sessions
  reg({ source: "Shooting Lab MS - HS Advanced", participant_name: "Max Smith", participant_DOB: "03-Mar-2011", participant_gender: "Male", registration_base_price: "$40.00", invoice_number: "Invoice #1002", date_created: "10-Oct-2026, 9:00 AM" }),
  reg({ participant_name: "Kim Lee", user_first_name: "Kim", user_last_name: "Lee", user_email: "kim@example.com", user_phone: "(512) 555-0199", source: "Volleyball Court 2", registration_base_price: "$1,040.00", invoice_number: "Invoice #2001", participant_DOB: "", participant_gender: "Female", date_created: "05-Aug-2026, 8:00 AM" }),
];
const sb1 = blank();
const r1 = await importPlaybookSpend(sb1, spendRows);
check(r1.purchases === 3 && r1.cents === 35000 + 4000 + 104000, `3 purchases, $${r1.cents / 100} (package rows fold into one $350 purchase): ${JSON.stringify(r1)}`);
const pkg = sb1.db.dssc_purchases.find(p => p.program === "U13-15 National Pins");
check(pkg.sessions === 4 && pkg.amount_cents === 35000 && pkg.category === "volleyball" && pkg.purchased_at === "2026-09-02T23:30:00.000Z", `package: 4 sessions, $350, volleyball, 6:30 PM CDT = 23:30Z (${pkg.purchased_at})`);
await importPlaybookSpend(sb1, spendRows);
check(sb1.db.dssc_purchases.length === 3 && sb1.db.dssc_purchases.reduce((s, p) => s + p.amount_cents, 0) === r1.cents, "re-importing the same export changes nothing");
const jen = sb1.db.dssc_contacts.find(c => c.email === "jen@example.com");
const ava = sb1.db.dssc_participants.find(p => p.first_name === "Ava");
check(jen && jen.phone === "+15125550101" && ava.dob === "2013-12-15" && ava.gender === "female", "parent phone, kid birthday and gender carried into People");
await importPlaybookSpend(sb1, [reg({ participant_DOB: "", participant_gender: "", invoice_number: "Invoice #1003", source: "Love the Floor: All-Skills Clinic", registration_base_price: "$65" })]);
check(sb1.db.dssc_participants.find(p => p.first_name === "Ava").dob === "2013-12-15", "a later export without the birthday doesn't blank it");
check(categoryOf("Shooting Lab MS - HS Advanced") === "basketball" && categoryOf("Skill Lab 6-8th Grade") === "basketball" && categoryOf("Hunter H. Private Lessons") === "volleyball" && categoryOf("Volleyball Court 2") === "facility" && categoryOf("Elite Athlete Development") === "reach", "program categories (labs, privates, courts, Reach)");
check(pbTimestamp("15-Jan-2027, 9:05 AM") === "2027-01-15T15:05:00.000Z", "winter times are CST (UTC-6)");

// ── 2. Old mailing lists ─────────────────────────────────────────────────────
console.log("== 2. mailing list import ==");
const listRows = [
  { "Email Address": "JEN@example.com", "First Name": "Jennifer", "Last Name": "S", "Phone Number": "", "Member Status": "subscribed", "Zip": "78620" },
  { "Email Address": "new.family@example.com", "First Name": "Pat", "Last Name": "Doe", "Phone Number": "5125550123", "Member Status": "subscribed", "Zip": "78620-1234" },
  { "Email Address": "gone@example.com", "First Name": "Old", "Last Name": "Family", "Member Status": "unsubscribed" },
  { "Email Address": "dead@example.com", "First Name": "Bad", "Last Name": "Address", "Member Status": "cleaned" },
  { "Email Address": "not-an-email", "First Name": "X" },
  { "Email Address": "new.family@example.com", "First Name": "Pat", "Last Name": "Doe" },
];
const r2 = await importMailingList(sb1, listRows, { list: "Mailchimp 2023" });
check(r2.contacts === 4 && r2.unsubscribed === 1 && r2.bounced === 1 && r2.invalid === 1, `4 addresses, 1 unsubscribed, 1 bounced, 1 invalid: ${JSON.stringify(r2)}`);
const jen2 = sb1.db.dssc_contacts.find(c => c.email === "jen@example.com");
check(jen2.first_name === "Jen" && jen2.lists.includes("Mailchimp 2023") && jen2.sources.includes("playbook") && jen2.sources.includes("list"), "an existing customer keeps their name and sources, gains the list");
check(sb1.db.dssc_contacts.find(c => c.email === "new.family@example.com")?.zip === "78620-1234" && sb1.db.mkt_unsubscribes.some(u => u.email === "gone@example.com") && sb1.db.dssc_contacts.find(c => c.email === "dead@example.com")?.email_status === "bounced", "zip filled, unsubscribe kept, cleaned address marked bounced");
check(statusOf("Opted Out") === "unsubscribed" && statusOf("Bounced") === "bounced" && statusOf("Active") === "ok", "status words (Constant Contact / Mailchimp)");
const r2b = await importMailingList(sb1, [{ Email: "x@example.com" }], { list: "Mailchimp unsub", status: "unsubscribed" });
check(r2b.unsubscribed === 1, "a Mailchimp 'unsubscribed' export (status from the file name) unsubscribes everyone in it");

// ── 3. Segments ──────────────────────────────────────────────────────────────
console.log("== 3. segments ==");
check(gradeOf("2013-12-15", "2026-10-22") === 7 && gradeOf("2014-09-01", "2026-10-22") === 7 && gradeOf("2014-09-02", "2026-10-22") === 6 && gradeOf("2021-08-30", "2026-10-22") === 0 && gradeOf("2011-03-03", "2027-03-01") === 10, "Texas grades (Sept 1 cutoff, year turns over Aug 1)");
check(ageOn("2013-12-15", "2026-10-22") === 12, "age");
const T = "2026-10-22";
const seg = (d) => buildFamilies(d, T);
const data = {
  contacts: [
    { id: 1, email: "a@x.com", first_name: "Amy", sources: ["playbook"], lists: [], tags: ["vip"], email_status: "ok" },
    { id: 2, email: "b@x.com", first_name: "Ben", sources: ["upperhand"], lists: [], tags: [], email_status: "ok", last_emailed_at: "2026-09-01T00:00:00Z", last_opened_at: "2026-09-02T00:00:00Z" },
    { id: 3, email: "c@x.com", first_name: "Cat", sources: ["list"], lists: ["Mailchimp 2023"], tags: [], email_status: "ok" },
    { id: 4, email: "d@x.com", first_name: "Dan", sources: ["playbook"], lists: [], tags: [], email_status: "bounced" },
    { id: 5, email: "e@x.com", first_name: "Eve", sources: ["playbook"], lists: [], tags: [], email_status: "ok" },
    { id: 6, email: "", first_name: "NoEmail", sources: ["dse"], lists: [], tags: [], email_status: "ok" },
  ],
  participants: [
    { id: 11, contact_id: 1, first_name: "Ava", dob: "2013-12-15", gender: "female" },           // 12, 7th grade
    { id: 12, contact_id: 1, first_name: "Max", dob: "2011-03-03", gender: "male" },             // 15, 10th
    { id: 21, contact_id: 2, first_name: "Bea", dob: "2015-05-05", gender: "female", dse_level: "rise", dse_team: "11 Ruby" },
    { id: 41, contact_id: 4, first_name: "Dot", dob: "2013-01-01", gender: "female" },
    { id: 51, contact_id: 5, first_name: "Eli", dob: "2012-02-02", gender: "male" },
  ],
  participation: [
    { contact_id: 1, participant_id: 12, program: "Shooting Lab", category: "basketball", event_date: "2026-10-01" },
    { contact_id: 2, participant_id: 21, program: "DS Elite 11 Ruby", category: "volleyball", event_date: "2025-09-01" },
    { contact_id: 4, participant_id: 41, program: "Volleyball 101", category: "volleyball", event_date: "2026-09-10" },
    { contact_id: 5, participant_id: 51, program: "Volleyball 101", category: "volleyball", event_date: "2026-09-10" },
  ],
  purchases: [
    { contact_id: 1, participant_id: 11, program: "U13-15 National Pins", category: "volleyball", amount_cents: 35000, purchased_at: "2026-09-02T23:30:00Z" },
    { contact_id: 5, participant_id: 51, program: "Volleyball 101", category: "volleyball", amount_cents: 20000, purchased_at: "2026-09-01T00:00:00Z" },
  ],
  orders: [{ contact_id: 2, total_cents: 90000, ordered_at: "2024-06-01T00:00:00Z" }],
  unsubscribes: [{ email: "e@x.com" }],
};
const ix = seg(data);
const emails = (s) => resolveSegment(ix, s).recipients.map(r => r.email).join(",");
check(emails({}) === "a@x.com,b@x.com,c@x.com", `everyone, minus bounced / unsubscribed / no email: ${emails({})}`);
const all = resolveSegment(ix, {});
check(all.matched === 6 && all.suppressed.bounced === 1 && all.suppressed.unsubscribed === 1 && all.suppressed.no_email === 1, `suppression counts ${JSON.stringify(all.suppressed)}`);
check(emails({ categories: ["volleyball"], gender: "female", minAge: 10, maxAge: 13 }) === "a@x.com,b@x.com", "girls 10–13 who did volleyball");
check(emails({ categories: ["basketball"], gender: "female" }) === "", "the SAME kid must fit and have done it (Amy's daughter didn't play basketball)");
check(emails({ grades: [7] }) === "a@x.com", "7th graders");
check(emails({ spendMin: 300 }) === "a@x.com,b@x.com" && emails({ spendMin: 300, spendWindow: "12m" }) === "a@x.com", "spent $300+ ever vs in the last 12 months");
check(emails({ lapsedSince: "2026-01-01" }) === "b@x.com", "lapsed: did something, nothing since Jan 1");
check(emails({ customers: "prospects" }) === "c@x.com" && emails({ lists: ["Mailchimp 2023"] }) === "c@x.com", "prospects / an old list");
check(emails({ dse: "members" }) === "b@x.com" && emails({ levels: ["rise"] }) === "b@x.com", "DS Elite members / Rise");
check(emails({ engaged: "opened90" }) === "b@x.com", "opened in the last 90 days");
check(emails({ tags: ["vip"] }) === "a@x.com" && emails({ excludeTags: ["vip"] }) === "b@x.com,c@x.com", "tags / not tagged");
check(resolveSegment(ix, {}).recipients.find(r => r.email === "c@x.com").cold === true && resolveSegment(ix, {}).recipients.find(r => r.email === "a@x.com").cold === false, "cold = never bought and never emailed");
check(describeSegment({ categories: ["volleyball"], since: "2026-08-01", gender: "female", minAge: 10, maxAge: 13, spendMin: 200 }) === "Volleyball since 2026-08-01 · girls 10–13 · spent $200+" && describeSegment(EMPTY_SEGMENT) === "everyone", `describe: ${describeSegment({ categories: ["volleyball"], since: "2026-08-01", gender: "female", minAge: 10, maxAge: 13, spendMin: 200 })}`);

// ── 4. Marketing email audience + send ───────────────────────────────────────
console.log("== 4. marketing email ==");
const mk = () => {
  const sb = fakeSupabase({
    dssc_contacts: data.contacts.map(c => ({ ...c })), dssc_participants: data.participants, dssc_participation: data.participation.map((p, i) => ({ id: i + 1, ...p })),
    dssc_purchases: data.purchases.map((p, i) => ({ id: i + 1, ...p })), dssc_orders: data.orders.map((o, i) => ({ id: "o" + i, ...o })), mkt_unsubscribes: data.unsubscribes,
    dssc_segments: [{ id: 7, name: "VB girls", filters: { categories: ["volleyball"], gender: "female" } }],
    mkt_items: [],
  });
  for (let i = 0; i < 250; i++) sb.db.dssc_contacts.push({ id: 100 + i, email: `cold${String(i).padStart(3, "0")}@list.com`, first_name: "", sources: ["list"], lists: ["Old"], tags: [], email_status: "ok" });
  return sb;
};
const sb4 = mk();
const a1 = await emailAudience(sb4, { segment_id: 7 });
check(a1.recipients.map(r => r.email).join(",") === "a@x.com,b@x.com", "a saved segment as the audience");
const a2 = await emailAudience(sb4, { source: "dssc_contacts" });
check(a2.recipients.length === 253 && a2.bounced === 1 && a2.unsubscribed === 1, `everyone: bounced and unsubscribed skipped (${a2.recipients.length}, bounced ${a2.bounced})`);
const a3 = await emailAudience(sb4, { segment: {}, cold_cap: 100 });
check(a3.recipients.length === 102 && a3.held_cold === 151, `cold cap 100: 2 warm + 100 cold (Cat from the old list counts), 151 held (${a3.recipients.length}, held ${a3.held_cold})`);
let resend = [];
globalThis.fetch = async (url, init = {}) => {
  if (String(url).startsWith("https://api.resend.com/emails/batch")) { const p = JSON.parse(init.body); resend.push(p); return new Response(JSON.stringify({ data: p.map((_, i) => ({ id: "em" + i })) }), { status: 200 }); }
  throw new Error("unexpected fetch " + url);
};
const item = { id: 42, channel: "email", status: "publishing", audience: { segment: {}, cold_cap: 100 }, headline: "Camp Elevate", body: "Thanksgiving camp", email_subject: "Camp Elevate", cta_url: "https://www.drippingsportsclub.com/camp-elevate", cta_text: "Sign up", external_ids: {} };
sb4.db.mkt_items.push(item);
const s1 = await sendEmailItem(sb4, item, { deadline: Date.now() - 1 });   // deadline already passed: nothing sent
check(s1.sent === 0 && !s1.done, "past the deadline: nothing sent, resumes later");
const s2 = await sendEmailItem(sb4, item, { deadline: Date.now() + 60000 });
const sentTo = resend.flat().map(m => m.to[0]);
check(s2.done && sentTo.length === 102 && new Set(sentTo).size === 102, `sent 102 in ${resend.length} batches`);
check(resend.flat().every(m => m.tags?.[0]?.name === "mkt_item" && m.tags[0].value === "42" && m.headers["List-Unsubscribe"]), "every message tagged with the item and carries List-Unsubscribe");
check(sb4.db.dssc_contacts.filter(c => c.last_emailed_at && (c.email.startsWith("cold") || c.email === "c@x.com")).length === 100 && sb4.db.dssc_contacts.find(c => c.email === "a@x.com").last_emailed_at, "last_emailed_at stamped on who got it");
// A send cut short and resumed must not go past the cap.
const sb5 = mk(); resend = [];
const it5 = { ...item, id: 43, external_ids: {} }; sb5.db.mkt_items.push(it5);
const first = await sendEmailItem(sb5, it5, { deadline: Date.now() + 60000 });
check(first.done && resend.flat().filter(m => m.to[0].startsWith("cold") || m.to[0] === "c@x.com").length === 100, "cap respected on a single run");
const again2 = await emailAudience(sb5, it5.audience, { coldUsed: it5.external_ids.email.cold_sent });
check(it5.external_ids.email.cold_sent === 100 && again2.recipients.filter(r => r.cold).length === 0, "a resumed send has no cold allowance left");

// ── 5. Resend webhook ────────────────────────────────────────────────────────
console.log("== 5. Resend webhook ==");
const secret = "whsec_" + Buffer.from("test-secret-key-0123456789").toString("base64");
const body = JSON.stringify({ type: "email.bounced", created_at: "2026-10-22T20:00:00Z", data: { email_id: "re_1", to: ["Dead@Example.com"], tags: { mkt_item: "42" }, bounce: { type: "Permanent" } } });
const ts = String(Math.floor(Date.now() / 1000));
const sig = createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`msg_1.${ts}.${body}`).digest("base64");
check(verifySvix(secret, { "svix-id": "msg_1", "svix-timestamp": ts, "svix-signature": "v1," + sig }, body), "a correctly signed event verifies");
check(!verifySvix(secret, { "svix-id": "msg_1", "svix-timestamp": ts, "svix-signature": "v1," + sig }, body + " "), "a tampered body doesn't");
check(!verifySvix(secret, { "svix-id": "msg_1", "svix-timestamp": String(+ts - 3600), "svix-signature": "v1," + sig }, body), "an old timestamp doesn't");
const eb = eventEffect(JSON.parse(body));
check(eb.type === "bounced" && eb.emails[0] === "dead@example.com" && eb.item_id === 42 && eb.patch?.email_status === "bounced", "permanent bounce → bounced, tied to item 42");
check(eventEffect({ type: "email.bounced", data: { to: ["x@y.com"], bounce: { type: "Transient" } } }).patch === null, "a temporary bounce is only logged");
const ec = eventEffect({ type: "email.complained", data: { to: ["x@y.com"], tags: [{ name: "mkt_item", value: "9" }] } });
check(ec.unsubscribe && ec.patch.email_status === "complained" && ec.item_id === 9, "spam complaint → complained + unsubscribed (array-style tags too)");
check(eventEffect({ type: "email.clicked", created_at: "2026-10-22T21:00:00Z", data: { to: ["x@y.com"], click: { link: "https://a" } } }).patch.last_clicked_at === "2026-10-22T21:00:00Z", "click → last_clicked_at");


// ── 6. Best times from registrations ─────────────────────────────────────────
console.log("== 6. best times ==");
// Basketball families sign up Mondays 4–7 pm; volleyball Wednesdays 11 am–2 pm; a few others scattered.
const at = (date, hCentral) => new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), hCentral + 5, 10)).toISOString();   // CDT
const buys = [];
let inv = 1;
for (let w = 0; w < 6; w++) {
  const mon = `2026-09-${String(7 + 7 * w).padStart(2, "0")}`.replace("2026-09-42", "2026-10-12").replace("2026-09-35", "2026-10-05");
  const day = (n) => { const d = new Date(mon + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  for (let i = 0; i < 12; i++) buys.push({ id: inv, invoice: String(inv++), program: "Shooting Lab", category: "basketball", amount_cents: 4000, purchased_at: at(day(0), 16 + (i % 3)) });
  for (let i = 0; i < 18; i++) buys.push({ id: inv, invoice: String(inv++), program: "U13-15 Pins", category: "volleyball", amount_cents: 9000, purchased_at: at(day(2), 11 + (i % 3)) });
  for (let i = 0; i < 3; i++) buys.push({ id: inv, invoice: String(inv++), program: "Reach Youth", category: "reach", amount_cents: 2500, purchased_at: at(day(4), 9) });
  buys.push({ id: inv, invoice: String(inv++), program: "Volleyball Court 2", category: "facility", amount_cents: 26000, purchased_at: at(day(5), 8) });
  buys.push({ id: inv, invoice: String(inv++), program: "Elite Athlete Development", category: "reach", amount_cents: 0, purchased_at: at(day(6), 7) });
}
buys.push({ ...buys[0], id: 9999 });   // same invoice twice: one checkout
const heat = registrationHeatmap(buys);
check(heat.total === 6 * 33 && heat.lines.rentals?.total === 6 && !heat.lines.club, `counts paid program checkouts once each, rentals kept apart, $0 left out (${heat.total})`);
check(heat.lines.basketball.m[0][16] === 24 && heat.lines.volleyball.m[2][11] === 36, "Central-time day and hour");
check(lineOfPurchase({ program: "Camp Elevate - Thanksgiving", category: "other" }) === "camp_elevate" && lineOfPurchase({ program: "Birthday Party Package", category: "facility" }) === "parties", "camp / parties lines");
const cad0 = { social: { mode: "rhythm", time: "18:30", month_preview: true, preview_day: "sat", rhythm: [{ day: "mon", lines: ["basketball"], format: "post" }, { day: "tue", follow: "mon", format: "story" }, { day: "thu", lines: ["volleyball"], format: "post" }, { day: "fri", follow: "thu", format: "story" }] }, email: { day: "fri", time: "07:30", dedicated_day: "sat" }, sms: { time: "17:30" } };
const rec = recommendCadence(heat, cad0);
const r = rec.cadence.social.rhythm;
const bb = r.find(e => e.lines?.includes("basketball")), vb = r.find(e => e.lines?.includes("volleyball"));
check(rec.ok && bb.day === "mon" && bb.time === "15:00" && vb.day === "wed" && vb.time === "10:00", `basketball Mon 3 pm (an hour before 4–7), volleyball moves to Wed 10 am: ${JSON.stringify(r)}`);
const fol = r.filter(e => e.follow);
check(fol.length === 2 && fol.every(f => ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].indexOf(f.day) > ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].indexOf(f.follow) && r.some(p => !p.follow && p.day === f.follow)), "each follow-up story comes after its post");
check(!r.some(e => e.day === "sat"), "the month-preview day stays free");
check(rec.cadence.email.day === "wed" && rec.cadence.email.dedicated_day === "mon" && /^0[67]:30$/.test(rec.cadence.email.time), `emails on the biggest days: weekly ${rec.cadence.email.day} ${rec.cadence.email.time}, dedicated ${rec.cadence.email.dedicated_day}`);
check(rec.changes.some(c => /volleyball post: Thu 18:30 → Wed 10:00/.test(c)), `changes listed: ${rec.changes.join(" | ")}`);
check(bestTimeFor(heat, "basketball", "mon", "social") === "15:00" && bestTimeFor(heat, "volleyball", "wed", "email") === "07:30", "one item's best time");
check(!recommendCadence(registrationHeatmap(buys.slice(0, 40)), cad0).ok, "too little data: no recommendation");

console.log(failed ? `\n${failed} FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
