// DSSC birthday emails (Drew, Oct 29 2026).
//
//   party     75 days before a kid's birthday (turning 3 to 13): "have the
//             party at the Warehouse", $50 off with a code, the open party
//             times on the weekends around the birthday (live from Playbook),
//             and party photos.
//   birthday  on the day (kids turning up to 18): happy birthday and $35 off
//             anything at DSSC.
//
// Every kid in DSSC People with a date of birth and a parent email that can be
// emailed (not unsubscribed, not bounced). Twins share one email. A family with
// a party already booked around the birthday isn't invited again. Each email is
// claimed in dssc_birthday_sends before it goes, so nobody gets it twice; a
// failed one is retried the next day. Off until a director turns each email on
// (DSSC People -> Birthdays). The codes are plain Playbook coupon codes the
// directors create; nothing here makes them.
//
// Party times: Playbook's public party page (resource groups 175 / 176, the 12
// and 20 kid packages) loads a day's open times with a POST anyone can make
// (action=load_resource_timeslot); the times are read from that.

import { buildEmail, UNSUB_TOKEN } from "./marketing-ai.js";
import { unsubUrl } from "./marketing-publish.js";
import { loadPhotos } from "./marketing-core.js";
import { sendResend, dsscFrom, inboxAddress } from "./site-inbox.js";
import { LINE_LINKS } from "../../shared/marketing-plan.js";
import { nextBirthday } from "../../shared/crm-profile.js";

export const DEFAULTS = { party_on: false, birthday_on: false, party_days: 75, party_min_age: 3, party_max_age: 13, party_off: 50, party_code: "BDAY50", party_book_days: 0, birthday_max_age: 18, birthday_off: 35, birthday_code: "BDAY35", birthday_valid_days: 0 };
// The codes are set up in Playbook (Drew, Oct 29 2026): BDAY50 = $50 off one
// party package, once per customer, expires Dec 1 2027; BDAY35 = $35 off
// anything, once per customer, no expiration.
export const SETTING_KEYS = Object.keys(DEFAULTS);
const CATCH_UP = 14;            // a kid added late still gets the party invite up to 14 days after the usual day
const BOOKED_AROUND = 120;      // a party booked within this many days of the birthday = no invite
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY = 864e5;

const nrm = (s) => String(s || "").trim().toLowerCase();
const cap = (s) => String(s || "").trim().replace(/\b\w/g, c => c.toUpperCase());
export const addDays = (ymd, n) => new Date(Date.parse(ymd + "T12:00:00Z") + n * DAY).toISOString().slice(0, 10);
const dow = (ymd) => new Date(ymd + "T12:00:00Z").getUTCDay();
export const fmtDay = (ymd, o = { weekday: "long", month: "long", day: "numeric" }) => new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", ...o });
export const ctToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const names = (kids) => { const n = [...new Set(kids.map(k => k.first))]; return n.length <= 1 ? n[0] || "" : n.slice(0, -1).join(", ") + " and " + n[n.length - 1]; };

export async function loadSettings(sb) {
  const { data, error } = await sb.from("dssc_birthday_settings").select("*").eq("id", 1).maybeSingle();
  if (error && /dssc_birthday_settings|schema cache/.test(error.message)) throw Object.assign(new Error("Run migrations/20261111_dssc_birthdays.sql first"), { status: 500 });
  return { ...DEFAULTS, ...(data || {}) };
}

// The weekends to offer: the one before the birthday and the one after, or -
// when the birthday is on a weekend - the weekend before and the birthday
// weekend itself. -> [{ label, days: [sat, sun] }], only days after today.
export function weekendsAround(bday, today = "0000-00-00", who = "the") {
  const d = dow(bday);
  const own = who === "the" ? "The birthday weekend" : `${who}'s birthday weekend`;
  const pairs = d === 6 ? [["The weekend before", addDays(bday, -7)], [own, bday]]
    : d === 0 ? [["The weekend before", addDays(bday, -8)], [own, addDays(bday, -1)]]
    : [["The weekend before", addDays(bday, -(d + 1))], ["The weekend after", addDays(bday, 6 - d)]];
  return pairs.map(([label, sat]) => ({ label, days: [sat, addDays(sat, 1)].filter(x => x > today) })).filter(w => w.days.length);
}

// "9:00a.m. - 11:00a.m." -> "9-11am"; "11:30a.m. - 1:30p.m." -> "11:30am-1:30pm"
const clock = (s) => { const m = /(\d{1,2}):(\d{2})\s*([ap])\.?m\.?/i.exec(s); return m ? { h: +m[1], m: m[2], ap: m[3].toLowerCase() + "m" } : null; };
const hm = (c) => c.h + (c.m === "00" ? "" : ":" + c.m);
export function slotLabel(a, b) { const x = clock(a), y = clock(b); if (!x || !y) return `${a}-${b}`; return x.ap === y.ap ? `${hm(x)}-${hm(y)}${y.ap}` : `${hm(x)}${x.ap}-${hm(y)}${y.ap}`; }
const sortKey = (a) => { const c = clock(a); return c ? ((c.h % 12) + (c.ap === "pm" ? 12 : 0)) * 60 + +c.m : 0; };
// The open times in Playbook's timeslot html (any of the party packages).
export function parseSlots(html) {
  const text = String(html || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
  const out = new Map();
  for (const m of text.matchAll(/(\d{1,2}:\d{2}\s*[ap]\.?m\.?)\s*-\s*(\d{1,2}:\d{2}\s*[ap]\.?m\.?)/gi)) out.set(sortKey(m[1]), slotLabel(m[1], m[2]));
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(x => x[1]);
}

// Open party times for some days: Map(ymd -> [labels]); a day Playbook didn't answer is left out.
const PB = "https://drippingsports.playbookapi.com";
const PARTY_PAGE = "/programs/rentals/?resource_type=resource_group&resource_group_pks=175,176";
const PARTY_RESOURCES = [["76191", "all", "175"], ["76192", "all", "176"]];   // the 12 and 20 kid packages
export async function partySlots(days, { fetchImpl = fetch } = {}) {
  const out = new Map();
  if (!days.length) return out;
  const r0 = await fetchImpl(PB + PARTY_PAGE, { headers: { "User-Agent": "Mozilla/5.0 (DSSC HQ birthday emails)" } });
  const cookies = (r0.headers.getSetCookie?.() || []).map(c => c.split(";")[0]).join("; ");
  const csrf = (/'csrfmiddlewaretoken': '([^']+)'/.exec(await r0.text()) || [])[1];
  if (!csrf) throw new Error("Playbook's party page changed (no form token)");
  for (const ymd of [...new Set(days)].sort()) {
    const [y, m, d] = ymd.split("-");
    const body = new URLSearchParams({ csrfmiddlewaretoken: csrf, action: "load_resource_timeslot", resource_info: JSON.stringify(PARTY_RESOURCES), date: `${m}/${d}/${y}`, staff_pk: "", location_pk: "" });
    try {
      const r = await fetchImpl(PB + "/programs/rentals/", { method: "POST", body, headers: { "User-Agent": "Mozilla/5.0 (DSSC HQ birthday emails)", Cookie: cookies, "X-CSRFToken": csrf, "X-Requested-With": "XMLHttpRequest", Referer: PB + PARTY_PAGE, "Content-Type": "application/x-www-form-urlencoded" } });
      const j = await r.json();
      if (Array.isArray(j)) out.set(ymd, parseSlots(j.map(o => o.html).join(" ")));
    } catch { /* that day stays unknown */ }
  }
  return out;
}

// Everyone the emails could go to, and what's already been sent.
export async function loadBirthdayData(sb, today) {
  const page = async (t, sel, f) => { const out = []; for (let i = 0; ; i += 1000) { let q = sb.from(t).select(sel).order("id").range(i, i + 999); if (f) q = f(q); const { data, error } = await q; if (error) throw new Error(t + ": " + error.message); out.push(...(data || [])); if (!data || data.length < 1000) break; } return out; };
  const from = addDays(today, -BOOKED_AROUND - 30), to = addDays(today, 400);
  const [kids, contacts, unsubs, sends, buys, parts] = await Promise.all([
    page("dssc_participants", "id, contact_id, first_name, last_name, dob, is_contact", q => q.not("dob", "is", null)),
    page("dssc_contacts", "id, email, first_name, last_name, email_status"),
    sb.from("mkt_unsubscribes").select("email").then(r => r.data || []),
    page("dssc_birthday_sends", "id, participant_id, kind, birthday, status, reason, email, turns, created_at, sent_at", q => q.gte("birthday", addDays(today, -400))),
    page("dssc_purchases", "id, contact_id, program, purchased_at", q => q.gte("purchased_at", from)),
    page("dssc_participation", "id, contact_id, program, event_date", q => q.gte("event_date", from).lte("event_date", to)),
  ]);
  return { kids, contacts, unsubs, sends, buys, parts };
}

// The kids the emails can go to: not club / Playbook staff accounts or test
// records, and each child once - the same child (name + birthday) on two
// parents' accounts, or listed twice, goes to the parent who can be emailed
// and was in most recently. -> [{ k, c }]
const STAFF_EMAIL = /@(drippingsportsclub\.com|dselitevolleyball\.com|drippingsports\.com|(call)?playbook(api)?\.com)$/i;
const TEST_NAME = /\btest\b|year old|^kid$|\badmin\b|^coach$|\bsample\b|\bdemo\b/i;
export function eligibleKids(d) {
  const contacts = new Map(d.contacts.map(c => [c.id, c]));
  const unsub = new Set(d.unsubs.map(u => nrm(u.email)));
  const lastSeen = new Map();
  for (const r of [...d.buys.map(b => [b.contact_id, String(b.purchased_at || "")]), ...d.parts.map(p => [p.contact_id, String(p.event_date || "")])]) if (r[1] > (lastSeen.get(r[0]) || "")) lastSeen.set(r[0], r[1]);
  const ok = (c) => EMAIL_RE.test(nrm(c.email)) && !unsub.has(nrm(c.email)) && !(c.email_status && c.email_status !== "ok");
  const best = new Map();
  for (const k of d.kids) {
    if (k.is_contact || !k.dob) continue;
    const c = contacts.get(k.contact_id); if (!c) continue;
    if (STAFF_EMAIL.test(nrm(c.email)) || TEST_NAME.test(`${k.first_name || ""} ${k.last_name || ""}`) || TEST_NAME.test(`${c.first_name || ""} ${c.last_name || ""}`)) continue;
    const key = `${nrm(k.first_name)}|${nrm(k.last_name)}|${String(k.dob).slice(0, 10)}`;
    const score = [ok(c) ? 1 : 0, lastSeen.get(c.id) || "", -c.id];
    const cur = best.get(key);
    const better = !cur || score[0] > cur.score[0] || (score[0] === cur.score[0] && (score[1] > cur.score[1] || (score[1] === cur.score[1] && score[2] > cur.score[2])));
    if (better) best.set(key, { k, c, score });
  }
  return [...best.values()].map(({ k, c }) => ({ k, c }));
}

// Who gets what today. -> { party: [group], birthday: [group], skipped: [{ kid, kind, birthday, reason }] }
// group = { kind, email, contact, birthday, turns, kids: [{ pid, first }] }
export function birthdayPlan(d, s, today) {
  const unsub = new Set(d.unsubs.map(u => nrm(u.email)));
  const done = new Set(d.sends.filter(x => x.status !== "failed").map(x => `${x.participant_id}|${x.kind}|${String(x.birthday).slice(0, 10)}`));
  const partyDates = new Map();
  for (const r of [...d.buys.map(b => ({ c: b.contact_id, p: b.program, at: String(b.purchased_at || "").slice(0, 10) })), ...d.parts.map(p => ({ c: p.contact_id, p: p.program, at: String(p.event_date || "").slice(0, 10) }))]) {
    if (!/birthday|party/i.test(r.p || "") || /viewing/i.test(r.p || "") || !r.at) continue;
    if (!partyDates.has(r.c)) partyDates.set(r.c, []); partyDates.get(r.c).push(r.at);
  }
  const groups = new Map(), skipped = [];
  for (const { k, c } of eligibleKids(d)) {
    const nb = nextBirthday(String(k.dob).slice(0, 10), today); if (!nb) continue;
    const email = nrm(c.email);
    const kinds = [];
    if (s.party_on && nb.turns >= s.party_min_age && nb.turns <= s.party_max_age && nb.days <= s.party_days && nb.days >= s.party_days - CATCH_UP) kinds.push("party");
    if (s.birthday_on && nb.days === 0 && nb.turns >= 1 && nb.turns <= s.birthday_max_age) kinds.push("birthday");
    for (const kind of kinds) {
      const key = `${k.id}|${kind}|${nb.date}`;
      if (done.has(key)) continue;
      const kid = { pid: k.id, first: cap(k.first_name), contact_id: c.id };
      const why = !EMAIL_RE.test(email) ? "no email" : unsub.has(email) ? "unsubscribed" : (c.email_status && c.email_status !== "ok") ? "email bounced"
        : kind === "party" && (partyDates.get(c.id) || []).some(at => Math.abs(Date.parse(at) - Date.parse(nb.date)) <= BOOKED_AROUND * DAY) ? "party already booked" : null;
      if (why) { skipped.push({ kid, kind, birthday: nb.date, turns: nb.turns, email, reason: why }); continue; }
      const gk = `${kind}|${email}|${nb.date}`;
      if (!groups.has(gk)) groups.set(gk, { kind, email, contact: c, birthday: nb.date, turns: nb.turns, kids: [] });
      groups.get(gk).kids.push(kid);
    }
  }
  const all = [...groups.values()];
  return { party: all.filter(g => g.kind === "party"), birthday: all.filter(g => g.kind === "birthday"), skipped };
}

// The next N days: when each email would go (for the Birthdays screen).
export function upcomingPlan(d, s, today, horizon = 30) {
  const out = [];
  const sent = new Map(d.sends.map(x => [`${x.participant_id}|${x.kind}|${String(x.birthday).slice(0, 10)}`, x]));
  for (const { k, c } of eligibleKids(d)) {
    for (const look of [today, addDays(today, s.party_days)]) {
      const nb = nextBirthday(String(k.dob).slice(0, 10), look); if (!nb) continue;
      const partyOn = addDays(nb.date, -s.party_days);
      const row = (kind, on) => ({ kind, on, birthday: nb.date, turns: nb.turns, pid: k.id, first: cap(k.first_name), last: cap(k.last_name), family: [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email, email: c.email, sent: sent.get(`${k.id}|${kind}|${nb.date}`) || null });
      if (look === today && nb.turns >= 1 && nb.turns <= s.birthday_max_age && nb.days <= horizon) out.push(row("birthday", nb.date));
      if (nb.turns >= s.party_min_age && nb.turns <= s.party_max_age && partyOn >= addDays(today, -CATCH_UP) && partyOn <= addDays(today, horizon) && !out.some(r => r.kind === "party" && r.pid === k.id && r.birthday === nb.date)) out.push(row("party", partyOn < today ? today : partyOn));
    }
  }
  return out.sort((a, b) => a.on.localeCompare(b.on) || a.kind.localeCompare(b.kind) || a.first.localeCompare(b.first));
}

// Party photos for the hero and the gallery, a different set per family.
export function partyPhotos(photos, seed = 0) {
  const p = (photos || []).filter(x => x.url && (x.line === "parties" || (x.tags || []).includes("parties"))).sort((a, b) => (b.quality || 0) - (a.quality || 0) || String(a.url).localeCompare(String(b.url)));
  if (!p.length) return [];
  const n = p.length, start = Math.abs(Number(seed) || 0) % n;
  return [...p.slice(start), ...p.slice(0, start)].map(x => x.url);
}

// ── the emails ──────────────────────────────────────────────────────────────
export function partyEmail(g, s, { today, slots = new Map(), photos = [] }) {
  const who = names(g.kids), first = g.kids[0]?.first || "";
  const plural = g.kids.length > 1;
  const book = LINE_LINKS.parties.book;
  const bookBy = s.party_book_days > 0 ? addDays(today, s.party_book_days) : null;
  const weekends = weekendsAround(g.birthday, today, plural ? "the" : first);
  const blocks = [];
  for (const w of weekends) for (const day of w.days) {
    const t = slots.get(day);
    if (t === undefined) blocks.push({ section: "Open party times", label: w.label, title: fmtDay(day), date_label: "", blurb: "See the open times when you book.", url: book, cta: "Book this day" });
    else if (t.length) blocks.push({ section: "Open party times", label: w.label, title: fmtDay(day), date_label: t.join("  ·  "), blurb: "", url: book, cta: "Book this day" });
  }
  // Every day came back empty = Playbook hasn't opened those dates yet (it
  // only lists party times as far as they've been set up), not booked.
  const asked = weekends.flatMap(w => w.days).map(day => slots.get(day));
  const notOpenYet = asked.length > 0 && asked.every(t => Array.isArray(t) && t.length === 0);
  const hold = `mailto:${inboxAddress()}?subject=${encodeURIComponent(`Party for ${who} - ${fmtDay(g.birthday, { month: "long", day: "numeric" })} birthday`)}`;
  const anyOpen = blocks.length > 0;
  if (notOpenYet) {
    blocks.length = 0;
    for (const w of weekends) blocks.push({ section: "Party dates", label: w.label, title: w.days.map(day => fmtDay(day, { weekday: "short", month: "short", day: "numeric" })).join(" or "), date_label: "Booking opens soon", blurb: `Reply to this email with the day and time you'd like and we'll hold it for ${plural ? "them" : first}.`, url: hold, cta: "Hold a date" });
  } else if (!anyOpen) blocks.push({ section: "Open party times", label: "Filling up", title: "Those weekends are booked", blurb: "The weekends right around the birthday are taken, but there are plenty of other open dates.", url: book, cta: "See every open date" });
  const pics = partyPhotos(photos, g.kids[0]?.pid);
  const item = {
    email_subject: `Celebrate ${who}'s birthday at DSSC ($${s.party_off} off)`,
    email_preheader: `${who} ${plural ? "turn" : "turns"} ${g.turns} on ${fmtDay(g.birthday, { month: "long", day: "numeric" })}. Party times around it are open now.`,
    headline: "Party at the Warehouse", hero_url: pics[0] || "",
    graphic: { tag: "Birthday", accent: "Warehouse", sub: `${who} ${plural ? "turn" : "turns"} ${g.turns} on ${fmtDay(g.birthday)}` },
    body: [
      `${who}'s birthday is coming up on ${fmtDay(g.birthday)}, and we'd love to throw the party.`,
      `Our party hosts run the games on the courts at Warehouse II, so the kids play hard and you get to enjoy the day. Pick a two-hour time, choose the 12 or 20 kid package, and we take care of the rest.`,
      `As an early birthday gift from DSSC, take $${s.party_off} off any party package.`,
    ].join("\n\n"),
    coupon: { amount: `$${s.party_off} off`, what: "any party package at DSSC", code: s.party_code, note: bookBy ? `Book by ${fmtDay(bookBy, { month: "long", day: "numeric" })} · one per family` : "Enter it when you book · one per family" },
    cta_url: book, cta_text: "Book the party",
    email_blocks: anyOpen && !notOpenYet ? [{ ...blocks[0], blurb: `What's open right now - weekends go fast.${blocks[0].blurb ? " " + blocks[0].blurb : ""}` }, ...blocks.slice(1)] : blocks,
    gallery: pics.slice(1, 5),
  };
  return { ...buildEmail(item), subject: item.email_subject, slotsShown: Object.fromEntries(weekends.flatMap(w => w.days).map(day => [day, slots.get(day) ?? null])) };
}

export function birthdayEmail(g, s, { today, photos = [] }) {
  const who = names(g.kids), plural = g.kids.length > 1;
  const until = s.birthday_valid_days > 0 ? addDays(today, s.birthday_valid_days) : null;
  const pics = partyPhotos(photos, (g.kids[0]?.pid || 0) + 7);
  const item = {
    email_subject: `Happy birthday, ${who}! A gift from DSSC`,
    email_preheader: `$${s.birthday_off} off anything at DSSC, from all of us.`,
    headline: `Happy birthday, ${who}!`, hero_url: pics[0] || "",
    graphic: { tag: "Birthday", accent: who.split(/,| and /)[0], sub: plural ? `Turning ${g.turns} today` : `${g.turns} today` },
    body: [
      `Happy birthday, ${who}! Everyone at Dripping Springs Sports Club hopes ${g.turns} is your best year yet, on the court and off it.`,
      `Here's a birthday gift from us: $${s.birthday_off} off anything at DSSC. Classes, camps, pods, privates, Reach or open gym - it's yours to use.`,
    ].join("\n\n"),
    coupon: { amount: `$${s.birthday_off} off`, what: "anything at DSSC", code: s.birthday_code, note: until ? `Good through ${fmtDay(until, { month: "long", day: "numeric" })} · one per family` : "One per family · no expiration" },
    cta_url: LINE_LINKS.club.book, cta_text: "Find something fun",
  };
  return { ...buildEmail(item), subject: item.email_subject };
}

const personalize = (s, email) => String(s).split(UNSUB_TOKEN).join(unsubUrl(email));

// The daily run. -> { party: n, birthday: n, sent, failed, skipped, errors }
export async function runBirthdays(sb, { today = ctToday(), dry = false, send = sendResend, fetchImpl = fetch } = {}) {
  const s = await loadSettings(sb);
  const out = { today, party: 0, birthday: 0, sent: 0, failed: 0, skipped: 0, errors: [] };
  if (!s.party_on && !s.birthday_on) return { ...out, off: true };
  const d = await loadBirthdayData(sb, today);
  const plan = birthdayPlan(d, s, today);
  out.party = plan.party.length; out.birthday = plan.birthday.length;
  if (dry) return { ...out, dry: true, plan };
  // Skips are recorded once, so the screen can say why and they aren't re-checked daily.
  for (const x of plan.skipped) {
    const { data } = await sb.from("dssc_birthday_sends").upsert({ participant_id: x.kid.pid, contact_id: x.kid.contact_id, kind: x.kind, birthday: x.birthday, turns: x.turns, email: x.email || null, status: "skipped", reason: x.reason }, { onConflict: "participant_id,kind,birthday", ignoreDuplicates: true }).select("id");
    if (data?.length) out.skipped++;
  }
  const photos = await loadPhotos(sb).catch(() => []);
  const days = plan.party.flatMap(g => weekendsAround(g.birthday, today).flatMap(w => w.days));
  const slots = days.length ? await partySlots(days, { fetchImpl }).catch(e => { out.errors.push("party times: " + e.message); return new Map(); }) : new Map();
  const from = dsscFrom(), reply_to = inboxAddress();
  for (const g of [...plan.party, ...plan.birthday]) {
    // Claim it (a failed one from an earlier day is cleared first so it can go again).
    await sb.from("dssc_birthday_sends").delete().in("participant_id", g.kids.map(k => k.pid)).eq("kind", g.kind).eq("birthday", g.birthday).eq("status", "failed");
    const { data: claimed } = await sb.from("dssc_birthday_sends").upsert(g.kids.map(k => ({ participant_id: k.pid, contact_id: g.contact.id, kind: g.kind, birthday: g.birthday, turns: g.turns, email: g.email, status: "sending" })), { onConflict: "participant_id,kind,birthday", ignoreDuplicates: true }).select("id");
    if (!claimed?.length) continue;
    const ids = claimed.map(x => x.id);
    const e = g.kind === "party" ? partyEmail(g, s, { today, slots, photos }) : birthdayEmail(g, s, { today, photos });
    const u = unsubUrl(g.email);
    const r = await send({ from, to: g.email, reply_to, subject: e.subject, html: personalize(e.html, g.email), text: personalize(e.text, g.email), headers: { "List-Unsubscribe": `<${u}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
    if (r.ok) {
      out.sent++;
      await sb.from("dssc_birthday_sends").update({ status: "sent", sent_at: new Date().toISOString(), resend_id: r.id || null, slots: e.slotsShown || null }).in("id", ids);
      await sb.from("dssc_contacts").update({ last_emailed_at: new Date().toISOString() }).eq("id", g.contact.id).then(() => {}, () => {});
    } else {
      out.failed++; out.errors.push(`${g.kind} ${g.email}: ${r.error}`);
      await sb.from("dssc_birthday_sends").update({ status: "failed", reason: String(r.error || "send failed").slice(0, 300) }).in("id", ids);
    }
    await new Promise(res => setTimeout(res, 550));   // Resend: 2 a second
  }
  return out;
}

// A preview of either email to a director, built from the next real kid it would go to.
export async function sendPreview(sb, { kind, to, today = ctToday(), send = sendResend, fetchImpl = fetch }) {
  const s = await loadSettings(sb);
  const d = await loadBirthdayData(sb, today);
  const up = upcomingPlan(d, { ...s, party_on: true, birthday_on: true }, today, 60).filter(r => r.kind === kind);
  const pick = up[0];
  const g = pick ? { kind, email: to, contact: { id: 0 }, birthday: pick.birthday, turns: pick.turns, kids: [{ pid: pick.pid, first: pick.first }] }
    : { kind, email: to, contact: { id: 0 }, birthday: addDays(today, kind === "party" ? s.party_days : 0), turns: 9, kids: [{ pid: 1, first: "Avery" }] };
  const photos = await loadPhotos(sb).catch(() => []);
  const sendDay = kind === "party" ? addDays(g.birthday, -s.party_days) < today ? today : addDays(g.birthday, -s.party_days) : g.birthday;
  const slots = kind === "party" ? await partySlots(weekendsAround(g.birthday, sendDay).flatMap(w => w.days), { fetchImpl }).catch(() => new Map()) : new Map();
  const e = kind === "party" ? partyEmail(g, s, { today: sendDay, slots, photos }) : birthdayEmail(g, s, { today: sendDay, photos });
  const r = await send({ from: dsscFrom(), to, reply_to: inboxAddress(), subject: "[Preview] " + e.subject, html: personalize(e.html, to), text: personalize(e.text, to) });
  if (!r.ok) throw new Error(r.error || "Couldn't send the preview");
  return { to, subject: e.subject, for: pick ? `${pick.first} ${pick.last}, turning ${pick.turns} on ${pick.birthday}` : "a sample kid", sends_on: sendDay };
}
