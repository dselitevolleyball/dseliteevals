// Who a marketing EMAIL reaches. The text-campaign engine (campaign-audience.js)
// is keyed by phone; this one is keyed by the family's email (dssc_contacts),
// and adds what email marketing needs: spend, lapsed families, the old mailing
// lists, grades, and email health. One engine for the People screen's segment
// builder (live count) and the sender (api/_lib/marketing-publish.js), so the
// count a director sees is who gets it.
//
// A segment is a filter object (EMPTY_SEGMENT). Kid filters (age, grade,
// gender, DS Elite) match a family when ANY kid matches; when program filters
// are set too, that same kid has to have done the program. Activity is every
// sign-up (dssc_participation) plus every purchase (dssc_purchases); spend is
// Playbook purchases at list price plus Upper Hand orders.
//
// Never included, whatever the filter: unsubscribed (mkt_unsubscribes),
// bounced / complained / invalid (dssc_contacts.email_status), no email.

export const EMPTY_SEGMENT = {
  categories: [], program: "", since: "", until: "",   // took part in … between …
  lapsedSince: "",                                       // …but nothing on or after this date
  minAge: "", maxAge: "", grades: [], gender: "",        // a kid in the family
  dse: "any", levels: [],                                // any | members | non; national | regional | rise
  spendMin: "", spendMax: "", spendWindow: "all",        // dollars; all | 12m | ytd
  customers: "any",                                      // any | customers | prospects (list / form only)
  engaged: "any",                                        // any | opened90 | never_opened
  tags: [], excludeTags: [], lists: [], sources: [], cities: [], zips: [],
};
export const SEGMENT_CATEGORIES = [["volleyball", "Volleyball"], ["basketball", "Basketball"], ["reach", "Reach / performance"], ["facility", "Rentals / open gym"], ["other", "Other"]];
export const GRADES = [[-1, "Pre-K"], [0, "K"], ...Array.from({ length: 12 }, (_, i) => [i + 1, String(i + 1)])];

const nrm = (v) => String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const day = (v) => String(v || "").slice(0, 10);
const num = (v) => v === "" || v == null || !Number.isFinite(+v) ? null : +v;

export function ageOn(dob, today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob || ""); if (!m) return null;
  const [ty, tm, td] = today.split("-").map(Number);
  let a = ty - +m[1]; if (tm < +m[2] || (tm === +m[2] && td < +m[3])) a--;
  return a >= 0 && a < 110 ? a : null;
}
// Texas school grade: kindergarten is 5 by September 1; the school year
// turns over August 1. -1 = pre-K, 13+ = out of school (null).
export function gradeOf(dob, today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob || ""); if (!m) return null;
  const [ty, tm] = today.split("-").map(Number);
  const startYear = tm >= 8 ? ty : ty - 1;
  const age = ageOn(dob, `${startYear}-09-01`);
  if (age == null) return null;
  const g = age - 5;
  return g < -1 ? null : g > 12 ? null : g;
}
export const gradeLabel = (g) => g == null ? "" : g === -1 ? "Pre-K" : g === 0 ? "K" : g + (g === 1 ? "st" : g === 2 ? "nd" : g === 3 ? "rd" : "th");

// Everything the engine needs, with the browser client (directors' session) or
// the service-role client.
export async function loadSegmentData(sb) {
  const page = async (table, sel, order = "id") => { const out = []; for (let from = 0; ; from += 1000) { const { data, error } = await sb.from(table).select(sel).order(order).range(from, from + 999); if (error) throw new Error(table + ": " + error.message); out.push(...(data || [])); if (!data || data.length < 1000) break; } return out; };
  const [contacts, participants, participation, purchases, orders, unsubscribes] = await Promise.all([
    page("dssc_contacts", "id, email, first_name, last_name, phone, city, zip, tags, sources, lists, email_status, last_emailed_at, last_opened_at, last_clicked_at"),
    page("dssc_participants", "id, contact_id, first_name, last_name, dob, gender, is_contact, dse_level, dse_team"),
    page("dssc_participation", "id, contact_id, participant_id, program, category, event_date"),
    page("dssc_purchases", "id, contact_id, participant_id, program, category, amount_cents, purchased_at"),
    page("dssc_orders", "id, contact_id, total_cents, ordered_at"),
    page("mkt_unsubscribes", "email", "email"),
  ]);
  return { contacts, participants, participation, purchases, orders, unsubscribes };
}

// Index once; evaluate many filters against it.
export function buildFamilies(d, today = new Date().toISOString().slice(0, 10)) {
  const y12 = new Date(new Date(today + "T12:00:00Z").getTime() - 365 * 864e5).toISOString().slice(0, 10);
  const ytd = today.slice(0, 4) + "-01-01";
  const fams = new Map();
  for (const c of d.contacts || []) fams.set(c.id, { c, kids: [], acts: [], spend: { all: 0, "12m": 0, ytd: 0 }, last: "" });
  for (const p of d.participants || []) { const f = fams.get(p.contact_id); if (f) f.kids.push({ ...p, age: ageOn(p.dob, today), grade: gradeOf(p.dob, today) }); }
  const act = (f, a) => { f.acts.push(a); if (a.date && a.date > f.last) f.last = a.date; };
  const spend = (f, cents, date) => { f.spend.all += cents; if (date >= y12) f.spend["12m"] += cents; if (date >= ytd) f.spend.ytd += cents; };
  for (const r of d.participation || []) { const f = fams.get(r.contact_id); if (f) act(f, { program: r.program || "", category: r.category || "other", date: day(r.event_date), pid: r.participant_id || null }); }
  for (const r of d.purchases || []) { const f = fams.get(r.contact_id); if (!f) continue; const dt = day(r.purchased_at); act(f, { program: r.program || "", category: r.category || "other", date: dt, pid: r.participant_id || null }); spend(f, r.amount_cents || 0, dt); }
  for (const o of d.orders || []) { const f = fams.get(o.contact_id); if (!f) continue; const dt = day(o.ordered_at); spend(f, o.total_cents || 0, dt); if (dt && dt > f.last) f.last = dt; }
  for (const f of fams.values()) f.customer = f.acts.length > 0 || f.spend.all > 0;
  const unsub = new Set((d.unsubscribes || []).map(u => nrm(u.email)));
  return { fams, unsub, today };
}

const hasKidFilters = (s) => num(s.minAge) != null || num(s.maxAge) != null || s.grades?.length || s.gender || s.dse !== "any" || s.levels?.length;
const hasActFilters = (s) => s.categories?.length || s.program || s.since || s.until;

function kidOk(k, s) {
  if (num(s.minAge) != null && !(k.age != null && k.age >= num(s.minAge))) return false;
  if (num(s.maxAge) != null && !(k.age != null && k.age <= num(s.maxAge))) return false;
  if (s.grades?.length && !s.grades.map(Number).includes(k.grade)) return false;
  if (s.gender && k.gender !== s.gender) return false;
  if (s.dse === "members" && !k.dse_level) return false;
  if (s.dse === "non" && k.dse_level) return false;
  if (s.levels?.length && !s.levels.includes(k.dse_level)) return false;
  return true;
}
function actOk(a, s) {
  if (s.categories?.length && !s.categories.includes(a.category)) return false;
  if (s.program && !nrm(a.program).includes(nrm(s.program))) return false;
  if (s.since && !(a.date && a.date >= s.since)) return false;
  if (s.until && !(a.date && a.date <= s.until)) return false;
  return true;
}

// Does this family match? -> { kids: [matched kids], program } or null.
export function familyMatches(f, seg, { today } = {}) {
  const s = { ...EMPTY_SEGMENT, ...(seg || {}) };
  const c = f.c;
  if (s.sources?.length && !s.sources.some(x => (c.sources || []).includes(x))) return null;
  if (s.lists?.length && !s.lists.some(x => (c.lists || []).includes(x))) return null;
  if (s.tags?.length && !s.tags.some(x => (c.tags || []).includes(x))) return null;
  if (s.excludeTags?.length && s.excludeTags.some(x => (c.tags || []).includes(x))) return null;
  if (s.cities?.length && !s.cities.map(nrm).includes(nrm(c.city))) return null;
  if (s.zips?.length && !s.zips.map(z => String(z).slice(0, 5)).includes(String(c.zip || "").slice(0, 5))) return null;
  if (s.customers === "customers" && !f.customer) return null;
  if (s.customers === "prospects" && f.customer) return null;
  const sp = f.spend[s.spendWindow] ?? f.spend.all;
  if (num(s.spendMin) != null && sp < num(s.spendMin) * 100) return null;
  if (num(s.spendMax) != null && sp > num(s.spendMax) * 100) return null;
  if (s.lapsedSince && !(f.last && f.last < s.lapsedSince)) return null;
  if (s.engaged !== "any") {
    const t = today || new Date().toISOString().slice(0, 10);
    const d90 = new Date(new Date(t + "T12:00:00Z").getTime() - 90 * 864e5).toISOString();
    const opened = [c.last_opened_at, c.last_clicked_at].some(x => x && x >= d90);
    if (s.engaged === "opened90" && !opened) return null;
    if (s.engaged === "never_opened" && !(c.last_emailed_at && !c.last_opened_at && !c.last_clicked_at)) return null;
  }
  const kidF = hasKidFilters(s), actF = hasActFilters(s);
  let kids = f.kids.filter(k => !k.is_contact);
  let hits = actF ? f.acts.filter(a => actOk(a, s)) : f.acts;
  if (kidF) {
    // The same kid has to fit and (if asked) have done the program; a sign-up
    // with no person attached counts for every kid in the family.
    const matched = f.kids.filter(k => kidOk(k, s) && (!actF || hits.some(a => !a.pid || a.pid === k.id)));
    if (!matched.length) return null;
    kids = matched.filter(k => !k.is_contact);
    if (actF) hits = hits.filter(a => !a.pid || matched.some(k => k.id === a.pid));
  } else if (actF && !hits.length) return null;
  const program = hits.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0]?.program || "";
  return { kids, program };
}

// -> { recipients: [{ email, first_name, last_name, contact_id, kids, program, cold }],
//      matched, suppressed: { unsubscribed, bounced, no_email } }
export function resolveSegment(index, seg) {
  const out = [], suppressed = { unsubscribed: 0, bounced: 0, no_email: 0 };
  let matched = 0;
  const seen = new Set();
  for (const f of index.fams.values()) {
    const m = familyMatches(f, seg, { today: index.today });
    if (!m) continue;
    matched++;
    const email = nrm(f.c.email);
    if (!EMAIL_RE.test(email)) { suppressed.no_email++; continue; }
    if (index.unsub.has(email)) { suppressed.unsubscribed++; continue; }
    if (f.c.email_status && f.c.email_status !== "ok") { suppressed.bounced++; continue; }
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({ email, first_name: f.c.first_name || "", last_name: f.c.last_name || "", contact_id: f.c.id, kids: m.kids.map(k => k.first_name).filter(Boolean), program: m.program, cold: !f.customer && !f.c.last_emailed_at });
  }
  out.sort((a, b) => a.email.localeCompare(b.email));
  return { recipients: out, matched, suppressed };
}

// One line a person can read: "Volleyball since Aug 1 · girls 10–13 · spent $200+".
export function describeSegment(seg) {
  const s = { ...EMPTY_SEGMENT, ...(seg || {}) };
  const bits = [];
  const cats = (s.categories || []).map(c => (SEGMENT_CATEGORIES.find(x => x[0] === c) || [c, c])[1]);
  if (cats.length || s.program) bits.push([cats.join(" or "), s.program ? `"${s.program}"` : ""].filter(Boolean).join(" · ") + (s.since ? ` since ${s.since}` : "") + (s.until ? ` until ${s.until}` : ""));
  else if (s.since || s.until) bits.push(`active${s.since ? " since " + s.since : ""}${s.until ? " until " + s.until : ""}`);
  if (s.lapsedSince) bits.push(`nothing since ${s.lapsedSince}`);
  const who = s.gender === "female" ? "girls" : s.gender === "male" ? "boys" : "kids";
  if (num(s.minAge) != null || num(s.maxAge) != null) bits.push(`${who} ${num(s.minAge) ?? ""}–${num(s.maxAge) ?? ""}`.replace(/ –(\d)/, " up to $1").replace(/(\d)–$/, "$1+"));
  else if (s.gender) bits.push(who);
  if (s.grades?.length) bits.push("grade " + s.grades.map(g => gradeLabel(+g)).join(", "));
  if (s.dse === "members" || s.levels?.length) bits.push("DS Elite" + (s.levels?.length ? " " + s.levels.join("/") : ""));
  if (s.dse === "non") bits.push("not DS Elite");
  const w = s.spendWindow === "12m" ? " (12 mo)" : s.spendWindow === "ytd" ? " (this year)" : "";
  if (num(s.spendMin) != null && num(s.spendMax) != null) bits.push(`spent $${s.spendMin}–$${s.spendMax}${w}`);
  else if (num(s.spendMin) != null) bits.push(`spent $${s.spendMin}+${w}`);
  else if (num(s.spendMax) != null) bits.push(`spent under $${s.spendMax}${w}`);
  if (s.customers === "customers") bits.push("customers");
  if (s.customers === "prospects") bits.push("never bought");
  if (s.engaged === "opened90") bits.push("opened in 90 days");
  if (s.engaged === "never_opened") bits.push("never opened");
  if (s.lists?.length) bits.push("list: " + s.lists.join(", "));
  if (s.tags?.length) bits.push("tag: " + s.tags.join(", "));
  if (s.excludeTags?.length) bits.push("not tagged " + s.excludeTags.join(", "));
  if (s.sources?.length) bits.push("from " + s.sources.join(", "));
  if (s.cities?.length) bits.push(s.cities.join(", "));
  if (s.zips?.length) bits.push("zip " + s.zips.join(", "));
  return bits.join(" · ") || "everyone";
}
