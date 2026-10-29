// Everything DSSC People knows about one family, boiled down so a director
// can read it at a glance and filter on it (Drew, Oct 29 2026: "all the data
// that we have available on the people, do they respond to text messages,
// emails, how often do they buy... who has open gym membership, or does
// privates").
//
// profileOf(family, ctx) is run for every family by shared/crm-segments.js
// buildFamilies(), so the People list, a family's profile, the segment
// builder, the campaign audiences and the revenue ideas all read the same
// numbers.
//
//   stage     prospect · new · active · cooling · lapsed · lost   (from the last thing they did)
//   tier      vip · high · regular · light                        (lifetime spend vs the other customers)
//   buys      purchase days in the last 12 months, and the usual gap between them
//   products  open gym (active / lapsed), privates (with whom), Reach membership,
//             rentals, birthday parties, camps, pods, DS Elite
//   email     ok / unsubscribed / bounced / none, opens, clicks
//   text      can text / opted out / no phone, texts sent, replies, last reply
//   reached   forms and emails to info@, text opt-in, newsletter (dssc_touches)

export const STAGES = [
  ["prospect", "Prospect", "Never bought: a form, a list, the newsletter", "#7FD1C3"],
  ["new", "New", "First sign-up in the last 60 days", "#B2D049"],
  ["active", "Active", "Did something in the last 90 days", "#22c55e"],
  ["cooling", "Cooling", "Last seen 3-6 months ago", "#F2C230"],
  ["lapsed", "Lapsed", "Last seen 6-12 months ago", "#FF7300"],
  ["lost", "Lost", "Nothing in over a year", "#a9b7b1"],
];
export const stageMeta = (k) => STAGES.find(s => s[0] === k) || STAGES[0];
export const TIERS = [["vip", "VIP", "Top 10% by lifetime spend"], ["high", "High", "Top 30%"], ["regular", "Regular", "The middle"], ["light", "Light", "Bottom 30%"]];

// What a family has bought, by program name (and Playbook's purchase kind).
// Memberships renew monthly: "active" when the latest is within 35 days.
export const PRODUCTS = [
  { key: "open_gym", label: "Open gym", icon: "🏟", membership: true, test: (a) => /open gym/i.test(a.program) },
  { key: "reach_member", label: "Reach membership", icon: "⚡", membership: true, test: (a) => a.category === "reach" && (a.kind === "UserSubscription" || /member|unlimited|monthly/i.test(a.program)) },
  { key: "privates", label: "Privates", icon: "🤝", test: (a) => /private/i.test(a.program) },
  { key: "rentals", label: "Court rentals", icon: "🏐", test: (a) => /rental|\bcourts?\b/i.test(a.program) && !/private/i.test(a.program) },
  { key: "parties", label: "Birthday party", icon: "🎉", test: (a) => /birthday|party/i.test(a.program) && !/viewing/i.test(a.program) },
  { key: "camps", label: "Camps", icon: "🏕", test: (a) => /camp/i.test(a.program) },
  { key: "pods", label: "Skill pods", icon: "🧠", test: (a) => /\bpods?\b/i.test(a.program) },
];
export const PRODUCT_FILTERS = [
  ["open_gym_active", "Open gym member"], ["open_gym_lapsed", "Open gym (lapsed)"], ["privates", "Privates"], ["reach_member_active", "Reach member"],
  ["rentals", "Rents courts"], ["parties", "Had a party"], ["camps", "Camps"], ["pods", "Pods"], ["dse", "DS Elite family"],
  ["volleyball", "Volleyball"], ["basketball", "Basketball"], ["reach", "Reach"],
];
const DAY = 864e5;
const day = (v) => String(v || "").slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / DAY);
const last10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// "Hunter H. Private Lessons" / "Breanna C Private Lessons" -> "Hunter" / "Breanna"
// (the same coach is spelled several ways in Playbook).
export const privateCoach = (program) => { const n = (/^(.+?)\s+private/i.exec(String(program || "")) || [])[1]?.trim(); return n ? n.split(/\s+/)[0] : null; };

// The next birthday of a date of birth, on or after today -> { date, days, turns }.
export function nextBirthday(dob, today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob || ""); if (!m) return null;
  const y = +today.slice(0, 4);
  for (const yy of [y, y + 1]) {
    const mmdd = m[2] === "02" && m[3] === "29" ? "02-28" : `${m[2]}-${m[3]}`;
    const d = `${yy}-${mmdd}`;
    if (d >= today) return { date: d, days: daysBetween(today, d), turns: yy - +m[1] };
  }
  return null;
}

// ctx: { today, smsByPhone: Map(phone10 -> {sent, replies, last_reply_at, last_sent_at}),
//        emailByAddr: Map(email -> {opens, clicks, last_open_at, last_click_at}),
//        optedOut: Set(phone10), unsub: Set(email), touchesByContact: Map(id -> [touch]) }
export function profileOf(f, ctx) {
  const { today } = ctx;
  const c = f.c;
  const acts = f.acts || [];
  const dates = [...acts.map(a => a.date), ...(f.orderDates || [])].filter(Boolean).sort();
  const first = dates[0] || null, lastAny = dates[dates.length - 1] || null;
  const lastPast = dates.filter(d => d <= today).pop() || null, next = dates.find(d => d > today) || null;
  // A sign-up for a class next month counts as "now".
  const last = lastAny && lastAny > today ? today : lastAny;
  const since = last ? daysBetween(last, today) : null;
  const customer = acts.length > 0 || (f.spend?.all || 0) > 0 || (f.orderDates || []).length > 0;
  const stage = !customer ? "prospect"
    : since <= 90 ? (first && daysBetween(first, today) <= 60 ? "new" : "active")
    : since <= 180 ? "cooling" : since <= 365 ? "lapsed" : "lost";

  // How often they buy: distinct purchase days in the last 12 months, and the usual gap.
  const y12 = new Date(Date.parse(today + "T12:00:00Z") - 365 * DAY).toISOString().slice(0, 10);
  const buyDays = [...new Set([...(f.buyDates || []), ...(f.orderDates || [])].filter(d => d && d >= y12 && d <= today))].sort();
  const gaps = buyDays.slice(1).map((d, i) => daysBetween(buyDays[i], d)).sort((a, b) => a - b);
  const every = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;

  // Products.
  const products = {};
  for (const p of PRODUCTS) {
    const hits = acts.filter(p.test);
    if (!hits.length) continue;
    const lastP = hits.map(a => a.date).filter(Boolean).sort().pop() || null;
    const entry = { count: hits.length, last: lastP };
    if (p.membership) entry.active = !!lastP && daysBetween(lastP > today ? today : lastP, today) <= 35;
    if (p.key === "privates") entry.coaches = [...new Set(hits.map(a => privateCoach(a.program)).filter(Boolean))];
    products[p.key] = entry;
  }
  const sports = [...new Set(acts.map(a => a.category).filter(k => ["volleyball", "basketball", "reach"].includes(k)))];
  const dse = (f.kids || []).some(k => k.dse_level);

  // Channels.
  const email = String(c.email || "").trim().toLowerCase();
  const es = ctx.emailByAddr?.get(email) || null;
  const emailState = !EMAIL_RE.test(email) ? "none" : ctx.unsub?.has(email) ? "unsubscribed" : c.email_status && c.email_status !== "ok" ? "bounced" : "ok";
  const ph = last10(c.phone);
  const ss = ph.length === 10 ? ctx.smsByPhone?.get(ph) || null : null;
  const textState = ph.length !== 10 ? "none" : (c.do_not_text || ctx.optedOut?.has(ph)) ? "opted_out" : "ok";
  const touches = ctx.touchesByContact?.get(c.id) || [];
  const birthdays = (f.kids || []).filter(k => !k.is_contact).map(k => ({ name: k.first_name, ...(nextBirthday(k.dob, today) || {}) })).filter(b => b.date).sort((a, b) => a.days - b.days);

  return {
    stage, since, first, last: lastAny, lastPast, next, customer,
    spend: f.spend || { all: 0, "12m": 0, ytd: 0 },
    buys12: buyDays.length, every,
    products, sports, dse,
    email: { state: emailState, opens: es?.opens || 0, clicks: es?.clicks || 0, lastOpen: es?.last_open_at || c.last_opened_at || null, lastEmailed: c.last_emailed_at || null },
    text: { state: textState, sent: ss?.sent || 0, replies: ss?.replies || 0, lastReply: ss?.last_reply_at || null, lastSent: ss?.last_sent_at || null,
      responds: (ss?.replies || 0) > 0 ? "yes" : (ss?.sent || 0) > 0 ? "no" : "untested" },
    reached: { count: touches.length, last: touches[0]?.at || c.last_touch_at || null, kinds: [...new Set(touches.map(t => t.kind))], interests: c.interests || [] },
    kids: (f.kids || []).filter(k => !k.is_contact).length,
    birthdays,
  };
}

// Spend tiers across all customers (lifetime): VIP = top 10%, high = next 20%,
// light = bottom 30%.
export function assignTiers(fams) {
  fams = [...fams];
  const list = fams.filter(f => f.profile?.customer).sort((a, b) => (b.profile.spend.all || 0) - (a.profile.spend.all || 0));
  const n = list.length;
  list.forEach((f, i) => { const r = n ? i / n : 1; f.profile.tier = (f.profile.spend.all || 0) <= 0 ? "light" : r < 0.1 ? "vip" : r < 0.3 ? "high" : r < 0.7 ? "regular" : "light"; });
  for (const f of fams) if (f.profile && !f.profile.tier) f.profile.tier = null;
}

// Does a family have a product filter (PRODUCT_FILTERS keys)?
export function hasProduct(p, key) {
  if (!p) return false;
  if (key === "open_gym_active") return !!p.products.open_gym?.active;
  if (key === "open_gym_lapsed") return !!p.products.open_gym && !p.products.open_gym.active;
  if (key === "reach_member_active") return !!p.products.reach_member?.active;
  if (key === "dse") return p.dse;
  if (["volleyball", "basketball", "reach"].includes(key)) return p.sports.includes(key);
  return !!p.products[key];
}

// One short line about how to reach them, for lists.
export function channelLine(p) {
  const e = p.email.state === "ok" ? (p.email.opens ? `✉ opens (${p.email.opens})` : "✉ ok") : p.email.state === "none" ? "no email" : `✉ ${p.email.state}`;
  const t = p.text.state === "ok" ? (p.text.replies ? `💬 replies (${p.text.replies})` : p.text.sent ? "💬 no replies yet" : "💬 ok") : p.text.state === "opted_out" ? "💬 opted out" : "no phone";
  return `${e} · ${t}`;
}
