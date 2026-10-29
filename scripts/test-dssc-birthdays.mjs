// Offline checks for the DSSC birthday emails (api/_lib/dssc-birthdays.js):
// the weekends offered, Playbook's party times, who gets which email when,
// the two emails, and the daily run (claims, never twice, retries, skips).
// No Supabase / Resend / Playbook calls - fake-supabase, a fake sender and a
// fake Playbook. Synthetic families only.
//
//   node scripts/test-dssc-birthdays.mjs

import { fakeSupabase } from "./fake-supabase.mjs";
Object.assign(process.env, { MARKETING_UNSUB_SECRET: "unit-test", DSSC_FROM_EMAIL: "DSSC <hello@drippingsportsclub.com>", RESEND_API_KEY: "re_test" });
const B = await import("../api/_lib/dssc-birthdays.js");

let failed = 0;
const check = (ok, label) => { console.log((ok ? "PASS  " : "FAIL  ") + label); if (!ok) failed++; };
const TODAY = "2026-10-29";   // a Thursday
const S = { ...B.DEFAULTS, party_on: true, birthday_on: true };

// ── 1. weekends and party times ──────────────────────────────────────────────
console.log("== 1. weekends and party times ==");
const w = (b) => B.weekendsAround(b, TODAY, "Ava").map(x => `${x.label}: ${x.days.join(" ")}`).join(" | ");
check(w("2027-01-13") === "The weekend before: 2027-01-09 2027-01-10 | The weekend after: 2027-01-16 2027-01-17", "a Wednesday birthday: the weekend before and after - " + w("2027-01-13"));
check(w("2027-01-16") === "The weekend before: 2027-01-09 2027-01-10 | Ava's birthday weekend: 2027-01-16 2027-01-17", "a Saturday birthday: the weekend before and the birthday weekend");
check(w("2027-01-17") === "The weekend before: 2027-01-09 2027-01-10 | Ava's birthday weekend: 2027-01-16 2027-01-17", "a Sunday birthday: the Saturday before it counts");
check(B.weekendsAround("2026-11-02", "2026-10-31").map(x => x.days.join(" ")).join(" | ") === "2026-11-01 | 2026-11-07 2026-11-08", "days already gone are left out");
const html = `<div>Any Locations</div><a>9:00a.m. - 11:00a.m.</a><a>11:30a.m. - 1:30p.m.</a><a>4:30p.m. - 6:30p.m.</a><a>9:00a.m. - 11:00a.m.</a>`;
check(B.parseSlots(html).join(",") === "9-11am,11:30am-1:30pm,4:30-6:30pm", "Playbook times, in order, once each: " + B.parseSlots(html).join(","));
check(B.parseSlots("No Results").length === 0, "a full day has no times");
const calls = [];
const fakePlaybook = async (url, o = {}) => {
  calls.push(o.method || "GET");
  if (!o.method) return { headers: { getSetCookie: () => ["csrftoken=abc; Path=/", "sessionid=xyz; Path=/"] }, text: async () => `x 'csrfmiddlewaretoken': 'tok123', y` };
  const date = new URLSearchParams(o.body).get("date");
  if (!/tok123/.test(o.headers["X-CSRFToken"]) || !/csrftoken=abc/.test(o.headers.Cookie)) throw new Error("no session");
  const open = { "12/12/2026": "<a>9:00a.m. - 11:00a.m.</a><a>2:00p.m. - 4:00p.m.</a>", "12/13/2026": "No Results" }[date];
  return { json: async () => open === undefined ? [{ resource_pk: "76191", html: "No Results" }] : [{ resource_pk: "76191", html: open }, { resource_pk: "76192", html: open }] };
};
const slots = await B.partySlots(["2026-12-12", "2026-12-13", "2026-12-12"], { fetchImpl: fakePlaybook });
check(slots.get("2026-12-12").join(",") === "9-11am,2-4pm" && slots.get("2026-12-13").length === 0 && calls.filter(c => c === "POST").length === 2, "party times per day, with Playbook's session and form token; each day asked once");

// ── 2. who gets what ─────────────────────────────────────────────────────────
console.log("== 2. who gets what ==");
const bdayIn = (days, turns) => { const d = B.addDays(TODAY, days); return `${+d.slice(0, 4) - turns}${d.slice(4)}`; };
const data = () => ({
  contacts: [
    { id: 1, email: "jen@example.com", first_name: "Jen", last_name: "Smith" },
    { id: 2, email: "gone@example.com", first_name: "Gone" },
    { id: 3, email: "bounce@example.com", first_name: "Bo", email_status: "bounced" },
    { id: 4, email: "partied@example.com", first_name: "Pat" },
    { id: 5, email: "twins@example.com", first_name: "Tia" },
    { id: 6, email: "", first_name: "No" },
  ],
  kids: [
    { id: 11, contact_id: 1, first_name: "ava", last_name: "Smith", dob: bdayIn(75, 9) },     // party today
    { id: 12, contact_id: 1, first_name: "Max", last_name: "Smith", dob: bdayIn(75, 14) },    // too old for the party
    { id: 13, contact_id: 1, first_name: "Leo", last_name: "Smith", dob: bdayIn(0, 16) },     // birthday today
    { id: 14, contact_id: 1, first_name: "Old", last_name: "Smith", dob: bdayIn(0, 19) },     // too old for wishes
    { id: 15, contact_id: 1, first_name: "Jen", last_name: "Smith", dob: bdayIn(0, 40), is_contact: true },   // the parent
    { id: 16, contact_id: 1, first_name: "Late", last_name: "Smith", dob: bdayIn(65, 6) },    // missed day 75, inside the catch-up
    { id: 17, contact_id: 1, first_name: "Early", last_name: "Smith", dob: bdayIn(76, 6) },   // tomorrow
    { id: 18, contact_id: 1, first_name: "Toolate", last_name: "Smith", dob: bdayIn(60, 6) }, // past the catch-up
    { id: 21, contact_id: 2, first_name: "Un", last_name: "Sub", dob: bdayIn(75, 8) },
    { id: 31, contact_id: 3, first_name: "Bo", last_name: "Unce", dob: bdayIn(0, 8) },
    { id: 41, contact_id: 4, first_name: "Pia", last_name: "Party", dob: bdayIn(75, 8) },
    { id: 51, contact_id: 5, first_name: "Tia", last_name: "Twin", dob: bdayIn(75, 7) },
    { id: 52, contact_id: 5, first_name: "Tom", last_name: "Twin", dob: bdayIn(75, 7) },
    { id: 61, contact_id: 6, first_name: "No", last_name: "Email", dob: bdayIn(0, 8) },
  ],
  unsubs: [{ email: "Gone@Example.com" }], sends: [],
  buys: [{ id: 1, contact_id: 4, program: "Birthday Parties (12 kid package)", purchased_at: "2026-10-20T12:00:00Z" }],
  parts: [{ id: 1, contact_id: 1, program: "Viewing Party - USC Volleyball", event_date: "2026-10-01" }],
});
const plan = B.birthdayPlan(data(), S, TODAY);
const who = (gs) => gs.map(g => g.kids.map(k => k.first).join("+")).sort().join(",");
check(who(plan.party) === "Ava,Late,Tia+Tom", "party invites: day 75 and the catch-up window, ages 3-13, twins together - " + who(plan.party));
check(who(plan.birthday) === "Leo", "birthday wishes: today, up to 18, not the parent - " + who(plan.birthday));
check(plan.party.find(g => g.kids[0].first === "Ava").turns === 9 && plan.party.find(g => g.kids[0].first === "Ava").email === "jen@example.com", "goes to the parent's email; turns 9");
const reasons = Object.fromEntries(plan.skipped.map(x => [x.kid.first, x.reason]));
check(reasons.Un === "unsubscribed" && reasons.Bo === "email bounced" && reasons.Pia === "party already booked" && reasons.No === "no email", "skipped: unsubscribed, bounced, party already booked, no email - " + JSON.stringify(reasons));
check(!reasons.Ava, "a viewing party doesn't count as a booked birthday party");
const off = B.birthdayPlan(data(), { ...S, party_on: false }, TODAY);
check(!off.party.length && off.birthday.length === 1, "an email that's off sends nothing");
const d2 = data(); d2.sends = [{ participant_id: 11, kind: "party", birthday: B.addDays(TODAY, 75), status: "sent" }, { participant_id: 13, kind: "birthday", birthday: TODAY, status: "failed" }];
const p2 = B.birthdayPlan(d2, S, TODAY);
check(!p2.party.some(g => g.kids.some(k => k.pid === 11)) && p2.birthday.some(g => g.kids.some(k => k.pid === 13)), "never twice; a failed one goes again");
// The same child on two parents' accounts (or twice), staff accounts and test records.
const d3 = data();
d3.contacts.push({ id: 7, email: "dad@example.com", first_name: "Sam", last_name: "Smith" }, { id: 8, email: "coach@drippingsportsclub.com", first_name: "Hunter" }, { id: 9, email: "x@example.com", first_name: "Playbook", last_name: "Admin" });
d3.kids.push({ id: 71, contact_id: 7, first_name: "Ava", last_name: "smith", dob: bdayIn(75, 9) }, { id: 19, contact_id: 1, first_name: "Ava", last_name: "Smith", dob: bdayIn(75, 9) },
  { id: 81, contact_id: 8, first_name: "Crew", last_name: "Haley", dob: bdayIn(75, 9) }, { id: 91, contact_id: 9, first_name: "Kid", last_name: "Playbook", dob: bdayIn(0, 9) }, { id: 92, contact_id: 1, first_name: "10 Year Old", last_name: "Smith", dob: bdayIn(0, 10) });
d3.buys.push({ id: 2, contact_id: 7, program: "U12 Skills", purchased_at: "2026-10-25T12:00:00Z" });
const p3 = B.birthdayPlan(d3, S, TODAY);
const avas = p3.party.filter(g => g.kids.some(k => k.first === "Ava"));
check(avas.length === 1 && avas[0].kids.length === 1 && avas[0].email === "dad@example.com", "one child on two accounts = one email, to the parent who was in last - " + avas.map(g => g.email + ":" + g.kids.length).join(","));
check(!p3.party.some(g => g.kids.some(k => k.first === "Crew")) && !p3.birthday.some(g => g.kids.some(k => /Kid|10 Year Old/.test(k.first))), "staff accounts and test records are left out");
const up = B.upcomingPlan(data(), S, TODAY, 30);
check(up.some(r => r.kind === "party" && r.first === "Early" && r.on === B.addDays(TODAY, 1)) && up.some(r => r.kind === "party" && r.first === "Late" && r.on === TODAY) && up.some(r => r.kind === "birthday" && r.first === "Leo" && r.on === TODAY), "next 30 days: tomorrow's invite, today's catch-up, today's birthday");

// ── 3. the emails ────────────────────────────────────────────────────────────
console.log("== 3. the emails ==");
const photos = [1, 2, 3, 4, 5, 6].map(i => ({ url: `https://x/p${i}.jpg`, line: "parties", quality: 5 })).concat([{ url: "https://x/vb.jpg", line: "volleyball", quality: 5 }]);
const g = { kind: "party", email: "jen@example.com", contact: { id: 1 }, birthday: "2026-12-16", turns: 9, kids: [{ pid: 11, first: "Ava" }] };
const pe = B.partyEmail(g, S, { today: "2026-10-02", slots: new Map([["2026-12-12", ["9-11am", "2-4pm"]], ["2026-12-13", []], ["2026-12-19", ["7-9pm"]], ["2026-12-20", []]]), photos });
check(pe.subject === "Celebrate Ava's birthday at DSSC ($50 off)", pe.subject);
check(/BDAY50/.test(pe.html) && /\$50 off/i.test(pe.html) && /one per family/.test(pe.html) && /Warehouse II/.test(pe.html), "the $50 code, one per family, Warehouse II");
check(/Saturday, December 12/.test(pe.html) && /9-11am  ·  2-4pm/.test(pe.html) && /Saturday, December 19/.test(pe.html) && !/Sunday, December 13/.test(pe.html), "open times by day; a full day is left out");
check(/resource_group_pks=175,176/.test(pe.html) && /\{\{unsubscribe_url\}\}/.test(pe.html), "book links to Playbook's party page; an unsubscribe link");
check((pe.html.match(/x\/p\d\.jpg/g) || []).length === 5 && !/vb\.jpg/.test(pe.html), "a party photo up top and four in the gallery, party photos only");
const notYet = B.partyEmail(g, S, { today: "2026-10-02", slots: new Map([["2026-12-12", []], ["2026-12-13", []], ["2026-12-19", []], ["2026-12-20", []]]), photos });
check(/Booking opens soon/.test(notYet.html) && /mailto:/.test(notYet.html) && /Hold a date/.test(notYet.html) && !/are booked/.test(notYet.html), "no times on any day = not open in Playbook yet: hold a date by reply");
const booked = B.partyEmail(g, S, { today: "2026-10-02", slots: new Map([["2026-12-12", []], ["2026-12-13", []], ["2026-12-19", []]]), photos });
check(!/Booking opens soon/.test(booked.html) && /Sunday, December 20/.test(booked.html) && /See the open times when you book/.test(booked.html), "a day Playbook didn't answer is still offered, with no times promised");
const twins = B.partyEmail({ ...g, kids: [{ pid: 51, first: "Tia" }, { pid: 52, first: "Tom" }] }, S, { today: "2026-10-02", slots: new Map(), photos });
check(twins.subject === "Celebrate Tia and Tom's birthday at DSSC ($50 off)" && /Tia and Tom turn 9/.test(twins.html), "twins: one email, both names");
const be = B.birthdayEmail({ ...g, kind: "birthday", birthday: TODAY, turns: 16, kids: [{ pid: 13, first: "Leo" }] }, S, { today: TODAY, photos });
check(be.subject === "Happy birthday, Leo! A gift from DSSC" && /BDAY35/.test(be.html) && /no expiration/.test(be.html) && /anything at DSSC/.test(be.html), "birthday: $35 off anything, BDAY35, no expiration");
check(/16 today/.test(be.html), "says how old");

// ── 4. the daily run ─────────────────────────────────────────────────────────
console.log("== 4. the daily run ==");
const seed = data();
const sb = fakeSupabase({
  dssc_birthday_settings: [{ id: 1, ...S }], dssc_birthday_sends: [], mkt_photos: photos.map((p, i) => ({ id: i + 1, active: true, ...p })),
  dssc_participants: seed.kids, dssc_contacts: seed.contacts, mkt_unsubscribes: seed.unsubs, dssc_purchases: seed.buys, dssc_participation: seed.parts,
});
const sent = [];
let failNext = 0;
const send = async (m) => { if (failNext > 0) { failNext--; return { ok: false, error: "Resend 500" }; } sent.push(m); return { ok: true, id: "re_" + sent.length }; };
const r1 = await B.runBirthdays(sb, { today: TODAY, send, fetchImpl: fakePlaybook });
check(r1.sent === 4 && r1.failed === 0 && sent.length === 4, `sent 3 party invites + 1 birthday (${JSON.stringify({ sent: r1.sent, party: r1.party, birthday: r1.birthday, errors: r1.errors })})`);
check(sent.every(m => !m.html.includes("{{unsubscribe_url}}") && /marketing-unsubscribe\?e=/.test(m.html) && m.headers["List-Unsubscribe"]), "each email has its own unsubscribe link and header");
check(sb.db.dssc_birthday_sends.filter(x => x.status === "sent").length === 5 && sb.db.dssc_birthday_sends.filter(x => x.status === "skipped").length === 4, "logged: 5 kids sent (twins are two), 4 skipped with reasons");
const r2 = await B.runBirthdays(sb, { today: TODAY, send, fetchImpl: fakePlaybook });
check(r2.sent === 0 && sent.length === 4 && r2.skipped === 0, "the 3pm run sends nothing again and doesn't re-log skips");
// A failure is retried by the next run.
const sb3 = fakeSupabase({ dssc_birthday_settings: [{ id: 1, ...S, party_on: false }], dssc_birthday_sends: [], mkt_photos: [], dssc_participants: seed.kids, dssc_contacts: seed.contacts, mkt_unsubscribes: [], dssc_purchases: [], dssc_participation: [] });
failNext = 1;
const r3 = await B.runBirthdays(sb3, { today: TODAY, send, fetchImpl: fakePlaybook });
const r4 = await B.runBirthdays(sb3, { today: TODAY, send, fetchImpl: fakePlaybook });
check(r3.failed === 1 && r4.sent === 1 && sb3.db.dssc_birthday_sends.filter(x => x.kind === "birthday" && x.status === "sent").length === 1, "a failed send is retried on the next run, once");
const r5 = await B.runBirthdays(fakeSupabase({ dssc_birthday_settings: [{ id: 1, ...B.DEFAULTS }] }), { today: TODAY, send, fetchImpl: fakePlaybook });
check(r5.off === true && r5.sent === 0, "both off (the default): nothing happens");

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
