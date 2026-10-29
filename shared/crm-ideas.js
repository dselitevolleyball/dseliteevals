// Revenue ideas for DSSC People (Drew, Oct 29 2026: "create ideas for
// campaigns to help drive revenue" and "rebound campaigns and offers like come
// back and try a class 50% off").
//
// Each idea is a ready-to-run campaign: an audience (a segment, so the count
// here is exactly who the campaign reaches), a goal, a suggested offer and the
// channels, plus a rough revenue estimate:
//   families × expected take-up × the club's typical price for that thing,
// with prices read from the club's own Playbook purchases over the last year
// (median paid price), not guessed. The take-up rates are conservative
// rules of thumb for small-club email + text campaigns; the estimate is there
// to rank the ideas, not to promise a number.

import { EMPTY_SEGMENT, resolveSegment, resolveSegmentPhones, familyMatches } from "./crm-segments.js";

const DAY = 864e5;
const median = (a) => { const s = a.filter(x => x > 0).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const minus = (today, days) => new Date(Date.parse(today + "T12:00:00Z") - days * DAY).toISOString().slice(0, 10);

// Typical prices (cents) from the last 12 months of purchases.
export function typicalPrices(index) {
  const y12 = minus(index.today, 365);
  const acts = [...index.fams.values()].flatMap(f => f.acts.filter(a => a.cents > 0 && a.date >= y12));
  const of = (fn, fallback) => median(acts.filter(fn).map(a => a.cents)) ?? fallback;
  const isClass = (a) => ["volleyball", "basketball"].includes(a.category) && !/private|camp|rental|court|party|member/i.test(a.program);
  return {
    class: of(isClass, 15000),
    volleyball: of(a => isClass(a) && a.category === "volleyball", 15000),
    basketball: of(a => isClass(a) && a.category === "basketball", 12000),
    private: of(a => /private/i.test(a.program), 6000),
    open_gym: of(a => /open gym/i.test(a.program), 4000),
    reach: of(a => a.category === "reach", 10000),
    camp: of(a => /camp/i.test(a.program), 20000),
    party: of(a => /birthday|party/i.test(a.program) && !/viewing/i.test(a.program), 35000),
    rental: of(a => /rental|\bcourts?\b/i.test(a.program), 8000),
  };
}

export const GOALS = [
  ["winback", "Win them back"], ["second", "Second program"], ["membership", "Membership"], ["privates", "Privates"],
  ["try_new", "Try something new"], ["parties", "Birthday parties"], ["referral", "Referrals"], ["rentals", "Rentals"],
  ["camps", "Camps"], ["followup", "Follow up a lead"], ["promo", "Promote a program"], ["custom", "Something else"],
];
export const OFFER_KINDS = [
  ["percent", "% off"], ["dollars", "$ off"], ["free_class", "Free class"], ["free_week", "Free week"], ["bring_friend", "Bring a friend free"], ["none", "No offer, just an invite"], ["custom", "Custom"],
];
// "50% off your next class (code COMEBACK50, until Nov 30)"
export function offerText(o = {}) {
  const v = Number(o.value) || 0;
  const what = o.applies_to || "your next class";
  const head = o.kind === "percent" ? `${v}% off ${what}` : o.kind === "dollars" ? `$${v} off ${what}` : o.kind === "free_class" ? `a free ${o.applies_to || "class"}` : o.kind === "free_week" ? `a free week of ${o.applies_to || "open gym"}` : o.kind === "bring_friend" ? `bring a friend free to ${o.applies_to || "any class"}` : o.kind === "custom" ? (o.text || "") : "";
  const tail = [o.code ? `code ${o.code}` : "", o.expires ? `until ${new Date(o.expires + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""].filter(Boolean).join(", ");
  return head ? head + (tail ? ` (${tail})` : "") : "";
}

// The ideas, best first. index: buildFamilies(); today: "YYYY-MM-DD".
export function revenueIdeas(index, { offerDays = 21 } = {}) {
  const today = index.today, P = typicalPrices(index);
  const until = new Date(Date.parse(today + "T12:00:00Z") + offerDays * DAY).toISOString().slice(0, 10);
  const S = (x) => ({ ...EMPTY_SEGMENT, ...x });
  const $ = (c) => "$" + Math.round(c / 100).toLocaleString();
  const ideas = [
    { key: "comeback_cooling", emoji: "🔁", goal: "winback", title: "Come back this season", conv: 0.12, price: P.class,
      pitch: "Families who did something 3-6 months ago and haven't been back. They already like you; a good offer and a reminder of what's on brings a lot of them back.",
      segment: S({ stages: ["cooling"] }), offer: { kind: "percent", value: 50, applies_to: "your next class", code: "COMEBACK50", expires: until }, channels: ["email", "text"] },
    { key: "winback_lapsed", emoji: "💌", goal: "winback", title: "We miss you: a free class back", conv: 0.05, price: P.class,
      pitch: "Families last seen 6+ months ago. A free class is the lowest-friction way back in.",
      segment: S({ stages: ["lapsed", "lost"] }), offer: { kind: "free_class", applies_to: "class of your choice", code: "WEMISSYOU", expires: until }, channels: ["email", "text"] },
    { key: "new_second", emoji: "✌️", goal: "second", title: "New families: a second program", conv: 0.15, price: P.class,
      pitch: "Families who started in the last 60 days with one sign-up. The second program is what turns a try-out into a regular.",
      segment: S({ stages: ["new"], maxBuys: "1" }), offer: { kind: "percent", value: 25, applies_to: "a second program", code: "NEXTUP25", expires: until }, channels: ["email", "text"] },
    { key: "open_gym_upsell", emoji: "🏟", goal: "membership", title: "Open gym membership for active players", conv: 0.08, price: P.open_gym * 3,
      pitch: "Active volleyball and basketball families with a player 10+ who don't have open gym. A free week gets them in the habit; members stay for months.",
      segment: S({ stages: ["new", "active"], products: ["volleyball", "basketball"], noProducts: ["open_gym_active"], minAge: "10" }), offer: { kind: "free_week", applies_to: "open gym", code: "OPENGYMWEEK", expires: until }, channels: ["email", "text"] },
    { key: "open_gym_comeback", emoji: "🏟", goal: "membership", title: "Lapsed open gym members", conv: 0.2, price: P.open_gym * 3,
      pitch: "They paid for open gym before and stopped. Half off the first month back.",
      segment: S({ products: ["open_gym_lapsed"] }), offer: { kind: "percent", value: 50, applies_to: "your first month of open gym", code: "GYMBACK50", expires: until }, channels: ["text", "email"] },
    { key: "privates_try", emoji: "🤝", goal: "privates", title: "Try a private lesson", conv: 0.05, price: P.private * 2,
      pitch: "Active volleyball families spending with you who've never booked a private. A private is the fastest way to a skill jump, and the highest-value hour you sell.",
      segment: S({ stages: ["new", "active"], products: ["volleyball"], noProducts: ["privates"], tiers: ["vip", "high", "regular"], minAge: "10" }), offer: { kind: "percent", value: 20, applies_to: "your first private lesson", code: "FIRSTPRIVATE", expires: until }, channels: ["email"] },
    { key: "privates_pack", emoji: "🎯", goal: "privates", title: "Privates clients: a 4-pack", conv: 0.2, price: P.private * 4,
      pitch: "Families who already book privates. A pack locks in the next month of lessons.",
      segment: S({ products: ["privates"] }), offer: { kind: "custom", text: "book 4 privates, get the 4th at half price", code: "PACK4", expires: until }, channels: ["text"] },
    { key: "reach_crosssell", emoji: "⚡", goal: "try_new", title: "Reach for volleyball and basketball players", conv: 0.06, price: P.reach,
      pitch: "Players 11-18 in volleyball or basketball who've never done Reach. Speed, strength and jump training is the natural add-on for a competitive athlete.",
      segment: S({ stages: ["new", "active", "cooling"], products: ["volleyball", "basketball"], noProducts: ["reach"], minAge: "11", maxAge: "18" }), offer: { kind: "free_class", applies_to: "Reach session", code: "REACHFREE", expires: until }, channels: ["email", "text"] },
    { key: "try_basketball", emoji: "🏀", goal: "try_new", title: "Volleyball families: try basketball", conv: 0.04, price: P.basketball,
      pitch: "Families with kids 6-14 in volleyball who've never done basketball here.",
      segment: S({ stages: ["new", "active"], products: ["volleyball"], noProducts: ["basketball"], minAge: "6", maxAge: "14" }), offer: { kind: "percent", value: 50, applies_to: "your first basketball class", code: "HOOPS50", expires: until }, channels: ["email"] },
    { key: "try_volleyball", emoji: "🏐", goal: "try_new", title: "Basketball families: try volleyball", conv: 0.04, price: P.volleyball,
      pitch: "Families with kids 6-14 in basketball who've never done volleyball here.",
      segment: S({ stages: ["new", "active"], products: ["basketball"], noProducts: ["volleyball"], minAge: "6", maxAge: "14" }), offer: { kind: "percent", value: 50, applies_to: "your first volleyball class", code: "SPIKE50", expires: until }, channels: ["email"] },
    { key: "birthday_party", emoji: "🎉", goal: "parties", title: "Birthdays coming up: party at DSSC", conv: 0.04, price: P.party,
      pitch: "Families with a kid 4-13 whose birthday is in the next 60 days. Parties are high-ticket and bring 10-20 new families through the door.",
      segment: S({ birthdayDays: "60", minAge: "4", maxAge: "13" }), offer: { kind: "dollars", value: 50, applies_to: "a birthday party booked this month", code: "BDAY50", expires: until }, channels: ["email", "text"] },
    { key: "siblings", emoji: "👯", goal: "second", title: "Sibling discount", conv: 0.05, price: P.class,
      pitch: "Active families with two or more kids. Getting the second kid in doubles the family's value for the same effort.",
      segment: S({ stages: ["new", "active", "cooling"], minKids: "2" }), offer: { kind: "percent", value: 25, applies_to: "a class for a brother or sister", code: "SIBLING25", expires: until }, channels: ["email"] },
    { key: "camps_next", emoji: "🏕", goal: "camps", title: "Camp families: next camp early bird", conv: 0.15, price: P.camp,
      pitch: "Families who've done a camp. Camp families come back for the next school break when they hear first.",
      segment: S({ products: ["camps"] }), offer: { kind: "dollars", value: 25, applies_to: "the next camp, booked early", code: "EARLYCAMP", expires: until }, channels: ["email", "text"] },
    { key: "renters", emoji: "🏐", goal: "rentals", title: "Court renters: lock in winter", conv: 0.15, price: P.rental * 4,
      pitch: "Teams and families who rented courts. Book the winter block before it fills.",
      segment: S({ products: ["rentals"] }), offer: { kind: "custom", text: "book 4 court hours, get the 5th free", code: "COURT5", expires: until }, channels: ["email", "text"] },
    { key: "vip_referral", emoji: "⭐", goal: "referral", title: "VIP families: bring a friend", conv: 0.1, price: P.class,
      pitch: "Your top 10% of families by spend. They're your best advocates; give them something to share.",
      segment: S({ tiers: ["vip"] }), offer: { kind: "bring_friend", applies_to: "any class", code: "FRIEND", expires: until }, channels: ["email", "text"] },
    { key: "lead_followup", emoji: "📬", goal: "followup", title: "Follow up recent inquiries", conv: 0.15, price: P.class,
      pitch: "People who filled a form or emailed info@ and haven't booked. A quick personal follow-up converts the warmest leads you have.",
      segment: S({ stages: ["prospect"], reached: "yes" }), offer: { kind: "percent", value: 25, applies_to: "your first program", code: "WELCOME25", expires: until }, channels: ["text", "email"] },
    { key: "prospects_first", emoji: "🚪", goal: "followup", title: "Never bought: first class free", conv: 0.02, price: P.class,
      pitch: "People on your lists who've never bought (old Upper Hand accounts, the newsletter, old mailing lists). A free first class is the easiest yes.",
      segment: S({ stages: ["prospect"] }), offer: { kind: "free_class", applies_to: "first class", code: "FIRSTFREE", expires: until }, channels: ["email"] },
  ];
  return ideas.map(i => {
    const emails = resolveSegment(index, i.segment);
    const texts = resolveSegmentPhones(index, i.segment);
    const families = emails.matched;
    const reach = new Set([...emails.recipients.map(r => r.contact_id), ...texts.recipients.map(r => r.contact_id)]).size;
    const est = Math.round(reach * i.conv * (i.price || 0) / 100);   // dollars (prices are cents)
    return { ...i, families, reach, emailable: emails.recipients.length, textable: texts.recipients.length, est,
      why: `${families.toLocaleString()} famil${families === 1 ? "y" : "ies"} · ${emails.recipients.length.toLocaleString()} by email · ${texts.recipients.length.toLocaleString()} by text · typical price ${$(i.price || 0)}`,
      offer_text: offerText(i.offer) };
  }).filter(i => i.reach > 0).sort((a, b) => b.est - a.est);
}

// How a family's own story maps to a single next best offer, for the profile.
export function nextBestFor(f, ideas, index) {
  for (const i of ideas) if (familyMatches(f, i.segment, { today: index.today })) return i;
  return null;
}
