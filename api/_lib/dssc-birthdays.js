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

// The party packages and their prices, from the same public page (it lists them
// over a websocket: "Birthday Parties (12 kid package) | $175.00/hour"). A party
// is two hours. If Playbook doesn't answer, the prices as of Oct 29 2026.
export const PARTY_HOURS = 2;
export const PACKAGES_FALLBACK = [{ kids: 12, hourly: 175 }, { kids: 20, hourly: 225 }];
export function parsePackages(html) {
  const text = String(html || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, "\n");
  const out = [];
  for (const m of text.matchAll(/Birthday Part[^\n]*?\((\d+)\s*kid[^)]*\)[\s\S]{0,80}?\$\s*([\d,]+(?:\.\d+)?)\s*\/\s*hour/gi)) out.push({ kids: +m[1], hourly: +m[2].replace(/,/g, "") });
  return out.sort((a, b) => a.kids - b.kids);
}
export async function partyPackages({ fetchImpl = fetch, WS = globalThis.WebSocket } = {}) {
  try {
    if (!WS) return PACKAGES_FALLBACK;
    const r0 = await fetchImpl(PB + PARTY_PAGE, { headers: { "User-Agent": "Mozilla/5.0 (DSSC HQ birthday emails)" } });
    const cookies = (r0.headers.getSetCookie?.() || []).map(c => c.split(";")[0]).join("; ");
    const csrf = (/'csrfmiddlewaretoken': '([^']+)'/.exec(await r0.text()) || [])[1];
    const html = await new Promise((res, rej) => {
      const ws = new WS("wss://drippingsports.playbookapi.com" + PARTY_PAGE, { headers: { Cookie: cookies, Origin: PB } });
      const t = setTimeout(() => { try { ws.close(); } catch { /* */ } rej(new Error("timeout")); }, 12000);
      ws.onopen = () => ws.send(JSON.stringify({ csrf_token: csrf, action: "load_rental_resources", date: "", location_pk: "", staff_pk: "", resource_type: "resource_group", initial_load: false, selected_passes_have_future_location_based_rentals: "True", selected_participant: "[]" }));
      ws.onmessage = (e) => { clearTimeout(t); try { ws.close(); } catch { /* */ } try { res(JSON.parse(e.data).rentals_table_html || ""); } catch (er) { rej(er); } };
      ws.onerror = () => { clearTimeout(t); rej(new Error("websocket")); };
    });
    const p = parsePackages(html);
    return p.length ? p : PACKAGES_FALLBACK;
  } catch { return PACKAGES_FALLBACK; }
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
  // Landscape only, so the gallery's 2x2 grid lines up (a size we don't know counts as landscape).
  const p = (photos || []).filter(x => x.url && (x.line === "parties" || (x.tags || []).includes("parties")) && !(x.width && x.height && x.height > x.width)).sort((a, b) => (b.quality || 0) - (a.quality || 0) || String(a.url).localeCompare(String(b.url)));
  if (!p.length) return [];
  const n = p.length, start = Math.abs(Number(seed) || 0) % n;
  return [...p.slice(start), ...p.slice(0, start)].map(x => x.url);
}

// ── the emails ──────────────────────────────────────────────────────────────
export function partyEmail(g, s, { today, slots = new Map(), photos = [], packages = PACKAGES_FALLBACK }) {
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
    headline: "Party at the Warehouse", hero_html: partyBanner(),
    graphic: { tag: "Birthday", accent: "Warehouse", sub: `${who} ${plural ? "turn" : "turns"} ${g.turns} on ${fmtDay(g.birthday)}` },
    body: [
      `${who}'s birthday is coming up on ${fmtDay(g.birthday)}, and we'd love to throw the party.`,
      `A DSSC party is two hours on a court of your own at the Warehouse, with our party hosts running the games - so the kids play hard and you get to enjoy the day.`,
    ].join("\n\n"),
    extra_html: partyDetails(s, packages),
    coupon: { amount: `$${s.party_off} off`, what: "any party package at DSSC", code: s.party_code, note: bookBy ? `Book by ${fmtDay(bookBy, { month: "long", day: "numeric" })} · one per family` : "Enter it when you book · one per family" },
    cta_url: book, cta_text: "Book the party",
    email_blocks: anyOpen && !notOpenYet ? [{ ...blocks[0], blurb: `What's open right now - weekends go fast.${blocks[0].blurb ? " " + blocks[0].blurb : ""}` }, ...blocks.slice(1)] : blocks,
    gallery: pics.slice(0, 4),
  };
  const built = buildEmail(item);
  const text = built.text.replace(/\n\n(\$\d+ off - code)/, `\n\n${partyDetailsText(s, packages)}\n\n$1`);
  return { ...built, text, subject: item.email_subject, slotsShown: Object.fromEntries(weekends.flatMap(w => w.days).map(day => [day, slots.get(day) ?? null])) };
}

// The birthday email is its own bright card, not the club's dark newsletter
// look (Drew, Oct 29 2026: "make it more fun - bright, live!") - in DSSC's own
// colors, never DS Elite's pink ("the branding should be DSSC"): lime,
// evergreen, orange, teal and cream, confetti, a big age badge and a gift
// ticket - no photo (Drew: "lets not use a picture for happy birthday").
// Plain tables and inline styles, so it holds up in Gmail, Apple Mail and Outlook.
const SITE = "https://www.drippingsportsclub.com";
const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const H = "'Barlow Condensed','Arial Narrow',Impact,'Helvetica Neue',Arial,sans-serif";
const F = "'Schibsted Grotesk',Helvetica,Arial,sans-serif";
const EVER = "#082C2A", TEAL = "#0F8B76", INK = "#061a18", LIME = "#B2D049", ORANGE = "#FF7300", CREAM = "#F4F0E8", MINT = "#7FD1C3";
const confetti = (n = 26, size = 18) => { const c = [LIME, ORANGE, MINT, CREAM, "#ffffff", TEAL], ch = ["&#9679;", "&#9650;", "&#9632;", "&#9733;", "&#9670;"]; return Array.from({ length: n }, (_, i) => `<span style="color:${c[(i * 7) % c.length]};font-size:${size - (i % 3) * 4}px;line-height:1">${ch[(i * 3) % ch.length]}</span>`).join("&nbsp;"); };

// What every party includes (from drippingsportsclub.com/parties) and the two
// packages with their prices, before and after the code.
const INCLUDED = [
  ["🎈", "A court of your own for two hours"],
  ["🙌", "A DSSC party host on the floor the whole time"],
  ["🏃", "Warm-ups, relays and games built for the ages in the room - running, throwing and catching for younger kids, real games for older kids"],
  ["⭐", "The birthday kid picks the last game"],
  ["👨‍👩‍👧", "Parents watch from the side or jump in for the last game"],
  ["🎂", "You bring the food, cake and decorations"],
];
const money = (n) => "$" + (Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0 });
function partyDetails(s, packages) {
  const pk = (packages?.length ? packages : PACKAGES_FALLBACK).map(p => ({ ...p, price: p.hourly * PARTY_HOURS }));
  const card = (p) => `<td width="50%" valign="top" style="padding:6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:${EVER};border-radius:14px;padding:16px 12px;text-align:center">
    <div style="font-family:${H};font-weight:900;font-size:15px;letter-spacing:2px;text-transform:uppercase;color:${LIME}">Up to</div>
    <div style="font-family:${H};font-weight:900;font-size:44px;line-height:1;color:#ffffff">${p.kids} kids</div>
    <div style="font-family:${F};font-size:15px;color:${CREAM};margin-top:6px"><span style="text-decoration:line-through;opacity:.7">${money(p.price)}</span> &nbsp;<b style="color:${ORANGE};font-size:22px">${money(Math.max(0, p.price - s.party_off))}</b></div>
    <div style="font-family:${F};font-size:12px;color:${MINT};margin-top:2px">${PARTY_HOURS} hours, with code ${esc(s.party_code)}</div>
  </td></tr></table></td>`;
  const rows = []; for (let i = 0; i < pk.length; i += 2) rows.push(pk.slice(i, i + 2));
  return `<div style="font-family:${H};font-weight:900;font-size:28px;line-height:1;text-transform:uppercase;color:${TEAL};margin:8px 0 10px">What's in every party</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px">${INCLUDED.map(([ic, t]) => `<tr><td width="34" valign="top" style="font-size:20px;line-height:1.4;padding:3px 0">${ic}</td><td style="font-family:${F};font-size:16px;line-height:1.45;color:${INK};padding:3px 0">${esc(t)}</td></tr>`).join("")}</table>
<div style="font-family:${H};font-weight:900;font-size:28px;line-height:1;text-transform:uppercase;color:${TEAL};margin:18px 0 6px">Pick your package</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px">${rows.map(r => `<tr>${r.map(card).join("")}</tr>`).join("")}</table>
<p style="margin:0 0 14px">As an early birthday gift from DSSC, take <b>$${s.party_off} off either package</b>:</p>`;
}
function partyDetailsText(s, packages) {
  const pk = (packages?.length ? packages : PACKAGES_FALLBACK);
  return ["WHAT'S IN EVERY PARTY", ...INCLUDED.map(([, t]) => "- " + t), "", "PACKAGES (" + PARTY_HOURS + " hours)",
    ...pk.map(p => `- Up to ${p.kids} kids: ${money(p.hourly * PARTY_HOURS)}, ${money(Math.max(0, p.hourly * PARTY_HOURS - s.party_off))} with code ${s.party_code}`)].join("\n");
}

// The party invite's top: a party banner, not a photo - the library's photos of
// older kids are all of them playing a sport (Drew, Oct 29 2026: "I dont want a
// sport specific photo in the birthday party email").
function partyBanner() {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="background:${EVER};padding:26px 20px 24px;border-top:4px solid ${LIME};border-bottom:4px solid ${LIME}">
  <div style="font-size:34px;line-height:1">🎈 🎉 🎂 🎁 🎈</div>
  <div style="padding:14px 0 6px">${confetti(22, 16)}</div>
  <div style="font-family:${H};font-weight:900;font-size:72px;line-height:.9;text-transform:uppercase;color:${LIME};letter-spacing:1px">Let's</div>
  <div style="font-family:${H};font-weight:900;font-size:72px;line-height:.9;text-transform:uppercase;color:${ORANGE};letter-spacing:1px">Party!</div>
  <div style="font-family:${F};font-weight:700;font-size:15px;color:${CREAM};margin-top:12px">2 hours &nbsp;·&nbsp; 12 or 20 kids &nbsp;·&nbsp; our party hosts run the fun</div>
  <div style="padding:12px 0 0">${confetti(22, 16)}</div>
</td></tr></table>`;
}

export function birthdayEmail(g, s, { today }) {
  const who = names(g.kids), plural = g.kids.length > 1, first = g.kids[0]?.first || who;
  const until = s.birthday_valid_days > 0 ? addDays(today, s.birthday_valid_days) : null;
  const shop = LINE_LINKS.club.book;
  const subject = `Happy birthday, ${who}! 🎉 A gift from DSSC`;
  const pre = `It's party time! $${s.birthday_off} off anything at DSSC, just for ${plural ? "you two" : "you"}.`;
  const note = until ? `Good through ${fmtDay(until, { month: "long", day: "numeric" })} · one per family` : "One per family · it never expires";
  const lines = [
    `${plural ? "Another trip around the sun for both of you" : "One more trip around the sun"} - and we think that deserves a party. Everyone at Dripping Springs Sports Club hopes ${g.turns} is your biggest, boldest, most fun year yet, on the court and off it.`,
    `So here's a present from all of us: <b>$${s.birthday_off} off anything at DSSC</b>. A class, a camp, a pod, a private, Reach, open gym - you pick!`,
  ];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@800;900&family=Schibsted+Grotesk:wght@400;700&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:${LIME}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(pre)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${LIME}"><tr><td align="center" style="padding:18px 10px 28px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
<tr><td align="center" style="padding:0 0 12px;font-size:30px;line-height:1">🎈 🎉 🎂 🎁 🎈</td></tr>
<tr><td style="background:${EVER};border-radius:22px 22px 0 0;padding:22px 24px 8px" align="center">
  <a href="${SITE}"><img src="${SITE}/brand/logo-light.png" width="150" alt="Dripping Springs Sports Club" style="display:block;width:150px;height:auto;border:0;margin:0 auto 14px"></a>
  <div style="text-align:center">${confetti(22, 16)}</div>
  <div style="font-family:${H};font-weight:900;font-size:64px;line-height:.9;text-transform:uppercase;color:#ffffff;margin-top:14px;letter-spacing:1px">Happy</div>
  <div style="font-family:${H};font-weight:900;font-size:64px;line-height:.9;text-transform:uppercase;color:${LIME};letter-spacing:1px">Birthday,</div>
  <div style="font-family:${H};font-weight:900;font-size:${who.length > 14 ? 44 : 64}px;line-height:.95;text-transform:uppercase;color:${ORANGE};letter-spacing:1px">${esc(who)}!</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:18px auto 6px"><tr><td align="center" width="120" height="120" style="width:120px;height:120px;background:${ORANGE};border:6px solid ${LIME};border-radius:999px;text-align:center;vertical-align:middle">
    <div style="font-family:${H};font-weight:900;font-size:60px;line-height:.9;color:#ffffff">${g.turns}</div>
    <div style="font-family:${H};font-weight:900;font-size:16px;letter-spacing:2px;text-transform:uppercase;color:${INK}">today!</div>
  </td></tr></table>
  <div style="text-align:center;padding:10px 0 22px">${confetti(22, 16)}</div>
</td></tr>
<tr><td style="background:${CREAM};padding:28px 26px 8px;font-family:${F};font-size:17px;line-height:1.55;color:${INK}">
  <div style="font-family:${H};font-weight:900;font-size:30px;line-height:1;text-transform:uppercase;color:${TEAL};margin-bottom:12px">It's your day, ${esc(first)}! 🥳</div>
  ${lines.map(l => `<p style="margin:0 0 14px">${l}</p>`).join("")}
</td></tr>
<tr><td style="background:${CREAM};padding:6px 26px 10px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#ffffff;border:4px dashed ${ORANGE};border-radius:16px;padding:20px 18px;text-align:center">
    <div style="font-family:${H};font-weight:900;font-size:18px;letter-spacing:3px;text-transform:uppercase;color:${INK}">🎁 Your birthday gift 🎁</div>
    <div style="font-family:${H};font-weight:900;font-size:68px;line-height:1;text-transform:uppercase;color:${ORANGE};margin-top:4px">$${s.birthday_off} off</div>
    <div style="font-family:${F};font-weight:700;font-size:17px;color:${INK}">anything at DSSC</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:14px auto 6px"><tr><td style="background:${EVER};border-radius:10px;padding:8px 18px;font-family:${H};font-weight:900;font-size:26px;letter-spacing:4px;color:${LIME}">${esc(s.birthday_code)}</td></tr></table>
    <div style="font-family:${F};font-size:13px;color:${INK}">Enter the code at checkout · ${esc(note)}</div>
  </td></tr></table>
</td></tr>
<tr><td align="center" style="background:${CREAM};padding:14px 26px 30px">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:${ORANGE};border-radius:999px;padding:15px 30px"><a href="${esc(shop)}" style="font-family:${H};font-weight:900;font-size:22px;letter-spacing:.5px;text-transform:uppercase;color:${INK};text-decoration:none">Pick your present &rarr;</a></td></tr></table>
</td></tr>
<tr><td style="background:${EVER};border-radius:0 0 22px 22px;padding:16px 24px;text-align:center">
  <div>${confetti(18, 14)}</div>
  <div style="font-family:${H};font-weight:900;font-size:22px;text-transform:uppercase;color:#ffffff;margin-top:8px">Where Dripping Springs <span style="color:${LIME}">plays.</span></div>
</td></tr>
<tr><td style="padding:16px 18px 0;font-family:${F};font-size:12px;line-height:1.6;color:${EVER};text-align:center">
  Dripping Springs Sports Club · Warehouse I · 15113 Fitzhugh Rd, Suite 1400, Dripping Springs, TX<br>
  <a href="${SITE}" style="color:${EVER}">drippingsportsclub.com</a> · You're getting this because your family has signed up for a program at DSSC. <a href="${UNSUB_TOKEN}" style="color:${EVER};text-decoration:underline">Unsubscribe</a>.
</td></tr>
</table></td></tr></table></body></html>`;
  const text = [`HAPPY BIRTHDAY, ${who.toUpperCase()}!`, `${g.turns} today!`, "", ...lines.map(l => l.replace(/<[^>]+>/g, "")), "",
    `YOUR BIRTHDAY GIFT: $${s.birthday_off} off anything at DSSC`, `Code: ${s.birthday_code} (${note})`, `Pick your present: ${shop}`, "",
    "Where Dripping Springs plays.", "Dripping Springs Sports Club · Warehouse I · 15113 Fitzhugh Rd, Suite 1400, Dripping Springs, TX", SITE, "", `Unsubscribe: ${UNSUB_TOKEN}`].join("\n");
  return { html, text, subject };
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
  const packages = plan.party.length ? await partyPackages({ fetchImpl }) : PACKAGES_FALLBACK;
  const from = dsscFrom(), reply_to = inboxAddress();
  for (const g of [...plan.party, ...plan.birthday]) {
    // Claim it (a failed one from an earlier day is cleared first so it can go again).
    await sb.from("dssc_birthday_sends").delete().in("participant_id", g.kids.map(k => k.pid)).eq("kind", g.kind).eq("birthday", g.birthday).eq("status", "failed");
    const { data: claimed } = await sb.from("dssc_birthday_sends").upsert(g.kids.map(k => ({ participant_id: k.pid, contact_id: g.contact.id, kind: g.kind, birthday: g.birthday, turns: g.turns, email: g.email, status: "sending" })), { onConflict: "participant_id,kind,birthday", ignoreDuplicates: true }).select("id");
    if (!claimed?.length) continue;
    const ids = claimed.map(x => x.id);
    const e = g.kind === "party" ? partyEmail(g, s, { today, slots, photos, packages }) : birthdayEmail(g, s, { today });
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
  const packages = kind === "party" ? await partyPackages({ fetchImpl }) : null;
  const e = kind === "party" ? partyEmail(g, s, { today: sendDay, slots, photos, packages }) : birthdayEmail(g, s, { today: sendDay });
  const r = await send({ from: dsscFrom(), to, reply_to: inboxAddress(), subject: "[Preview] " + e.subject, html: personalize(e.html, to), text: personalize(e.text, to) });
  if (!r.ok) throw new Error(r.error || "Couldn't send the preview");
  return { to, subject: e.subject, for: pick ? `${pick.first} ${pick.last}, turning ${pick.turns} on ${pick.birthday}` : "a sample kid", sends_on: sendDay };
}
