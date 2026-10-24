// DSSC CRM loaders. Everything the club knows about a family, from three
// sources, folded into dssc_contacts / dssc_participants / dssc_participation
// / dssc_orders. Each loader is idempotent — run it again with a newer export
// and it tops up.
//
//   importUpperHand(sb, { contacts, participants, orders })  — Upper Hand CSV rows
//   syncPlaybook(sb)   — families and classes from dssc_pod_roster / dssc_clinics
//   importPlaybookRegistrations(sb, rows) — every Playbook sign-up, any program
//                        (the hourly registrations pull calls this)
//   syncDsElite(sb)    — DS Elite roster families, as volleyball participation
//
// Upper Hand's order export has no line items, so orders give spend and
// recency, not what was bought; program history from Upper Hand needs its
// event-attendance / registrations export, loaded through importUpperHand's
// `attendance` rows when Drew has it.

import { usE164 } from "../../shared/phone.js";

const lower = (s) => String(s || "").trim().toLowerCase();
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
const cap = (s) => clean(s).replace(/\b\w/g, c => c.toUpperCase());
export const nameKey = (f, l) => lower(clean(f) + " " + clean(l)).replace(/[^a-z0-9 ]/g, "");
// A US number must be a real one (shared/phone.js); longer ones are international.
export const e164 = (raw) => { const d = String(raw || "").replace(/\D/g, ""); if (d.length === 10 || (d.length === 11 && d.startsWith("1"))) return usE164(d); return d.length > 11 ? "+" + d : null; };
const isoDate = (s) => { s = clean(s); if (!s) return null; let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return m[0]; m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s); if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; return null; };
const isoTs = (s) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(clean(s)); if (!m) return null; let h = +m[4] % 12; if (/pm/i.test(m[6])) h += 12; return new Date(Date.UTC(+m[3], +m[1] - 1, +m[2], h + 5, +m[5])).toISOString(); };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// What kind of program a name is. Only volleyball is synced from Playbook, but
// Upper Hand history and future exports carry everything the club sells.
export function categoryOf(name) {
  const n = lower(name);
  // Rentals first: "Volleyball Court 2" and "Basketball Court 1" are court time, not a program.
  if (/\bcourts?\b|rental|dssc flex|warehouse|open gym|membership|birthday|parent'?s night/.test(n)) return "facility";
  if (/volley|vball|setter|libero|hitter|hitting|passing|middles|pins|serve|elite tots|ds elite|rise|guaranteed to|skill lab v|\bpods?\b|all-skills|love the floor|private lesson/.test(n)) return "volleyball";
  if (/basket|hoop|shooting|point guard|playmaker|dribbl|skill lab|3v3|4qa|4th quarter/.test(n)) return "basketball";
  if (/reach|performance|strength|speed|agility|s&a|athlete development|small group training/.test(n)) return "reach";
  if (/rental|court|open gym|party|membership/.test(n)) return "facility";
  return "other";
}

async function upsertContacts(sb, rows) {
  // rows: [{ email, first_name, last_name, phone, address, city, state, zip, dob, sources:[..], uh_added_at, uh_last_login }]
  const byEmail = new Map();
  for (const r of rows) { if (!r.email) continue; const cur = byEmail.get(r.email); byEmail.set(r.email, cur ? { ...cur, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v != null && v !== "")), sources: [...new Set([...(cur.sources || []), ...(r.sources || [])])] } : r); }
  const list = [...byEmail.values()];
  // Lookups in chunks — a single .in() with 800 emails overflows the URL and
  // silently returns nothing, which is how the first Upper Hand load reported
  // 0 contacts while inserting 764.
  const chunked = async (emails) => { const out = []; for (let i = 0; i < emails.length; i += 150) { const { data } = await sb.from("dssc_contacts").select("id, email, phone, first_name, last_name, sources, dob, city").in("email", emails.slice(i, i + 150)); out.push(...(data || [])); } return out; };
  const ex = new Map((await chunked(list.map(r => r.email))).map(e => [e.email, e]));
  // No id in the payload: email is the conflict key, and mixing rows with and
  // without id makes PostgREST send id = null for the ones without.
  const up = list.map(r => { const e = ex.get(r.email) || {}; return {
    email: r.email,
    first_name: r.first_name || e.first_name || null, last_name: r.last_name || e.last_name || null,
    phone: r.phone || e.phone || null, address: r.address ?? undefined, city: r.city ?? undefined, state: r.state ?? undefined, zip: r.zip ?? undefined,
    dob: r.dob || e.dob || null, sources: [...new Set([...(e.sources || []), ...(r.sources || [])])],
    uh_added_at: r.uh_added_at ?? undefined, uh_last_login: r.uh_last_login ?? undefined, updated_at: new Date().toISOString(),
  }; });
  for (let i = 0; i < up.length; i += 300) {
    const { error } = await sb.from("dssc_contacts").upsert(up.slice(i, i + 300).map(o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))), { onConflict: "email" });
    if (error) throw new Error("contacts: " + error.message);
  }
  return new Map((await chunked(list.map(r => r.email))).map(c => [c.email, c.id]));
}

async function upsertParticipants(sb, rows) {
  // rows: [{ contact_id, first_name, last_name, dob, gender, is_contact, dse_player_id, sources }]
  const seen = new Map();
  for (const r of rows) { if (!r.contact_id || !clean(r.first_name)) continue; const k = r.contact_id + "|" + nameKey(r.first_name, r.last_name); const cur = seen.get(k); seen.set(k, cur ? { ...cur, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v != null && v !== "")), sources: [...new Set([...(cur.sources || []), ...(r.sources || [])])] } : { ...r, name_key: nameKey(r.first_name, r.last_name) }); }
  // What's already on file: an export without a birthday (or from one source)
  // mustn't blank the birthday, gender, DS Elite link or sources another gave.
  const have = new Map();
  const cids = [...new Set([...seen.values()].map(r => r.contact_id))];
  for (let i = 0; i < cids.length; i += 300) { const { data } = await sb.from("dssc_participants").select("contact_id, name_key, dob, gender, dse_player_id, sources").in("contact_id", cids.slice(i, i + 300)); for (const p of data || []) have.set(p.contact_id + "|" + p.name_key, p); }
  const list = [...seen.values()].map(r => { const e = have.get(r.contact_id + "|" + r.name_key) || {}; return { contact_id: r.contact_id, first_name: cap(r.first_name), last_name: cap(r.last_name), name_key: r.name_key, dob: r.dob || e.dob || null, gender: r.gender || e.gender || null, is_contact: !!r.is_contact, dse_player_id: r.dse_player_id || e.dse_player_id || null, sources: [...new Set([...(e.sources || []), ...(r.sources || [])])], updated_at: new Date().toISOString() }; });
  for (let i = 0; i < list.length; i += 300) {
    const { error } = await sb.from("dssc_participants").upsert(list.slice(i, i + 300), { onConflict: "contact_id,name_key", ignoreDuplicates: false });
    if (error) throw new Error("participants: " + error.message);
  }
  const ids = [...new Set(list.map(r => r.contact_id))];
  const out = new Map();
  for (let i = 0; i < ids.length; i += 300) { const { data } = await sb.from("dssc_participants").select("id, contact_id, name_key").in("contact_id", ids.slice(i, i + 300)); for (const p of data || []) out.set(p.contact_id + "|" + p.name_key, p.id); }
  return out;
}

async function upsertParticipation(sb, rows) {
  const list = rows.filter(r => r.contact_id && r.program && r.source_ref).map(r => ({ participant_id: r.participant_id || null, contact_id: r.contact_id, program: clean(r.program), category: r.category || categoryOf(r.program), event_date: r.event_date || null, source: r.source, source_ref: String(r.source_ref), amount_cents: r.amount_cents ?? null }));
  for (let i = 0; i < list.length; i += 300) { const { error } = await sb.from("dssc_participation").upsert(list.slice(i, i + 300), { onConflict: "source,source_ref" }); if (error) throw new Error("participation: " + error.message); }
  return list.length;
}

// Upper Hand's per-event export (Events → an event → Clients → Export): five
// metadata rows ("Event Title,DS Elite Tryout - 15s", dates, URL…), then a
// header row starting "First Name". One of these per event is the only way
// Upper Hand says who did WHAT, so this turns one into attendance rows the
// importer already understands. Returns null if the text isn't that shape.
export function parseUpperHandEvent(text, Papa) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const hi = lines.findIndex((l, i) => i < 15 && /^"?First Name"?\s*,/i.test(l));
  if (hi < 0) return null;
  const meta = Papa.parse(lines.slice(0, hi).join("\n"), { header: false, skipEmptyLines: true }).data;
  const cell = (re) => { const r = meta.find(x => re.test(String(x[0] || ""))); return r ? clean(r.slice(1).join(" ")) : ""; };   // a date like "Oct 4, 2025" splits across cells
  const title = cell(/event\s*title|^event$|^title$/i) || cell(/name/i);
  const dateRaw = cell(/start|date|when/i);
  const date = isoDate(dateRaw) || (() => { const m = /([A-Z][a-z]{2,8})\s+(\d{1,2}),?\s+(\d{4})/.exec(dateRaw); return m ? isoDate(new Date(m[0]).toLocaleDateString("en-US")) : null; })();
  if (!title) return null;
  const rows = Papa.parse(lines.slice(hi).join("\n"), { header: true, skipEmptyLines: true }).data;
  const get = (r, ...keys) => { for (const k of keys) { const kk = Object.keys(r).find(x => x.trim().toLowerCase() === k.toLowerCase()); if (kk && String(r[kk]).trim()) return String(r[kk]).trim(); } return ""; };
  return rows.map(r => ({ first_name: get(r, "First Name"), last_name: get(r, "Last Name"), email: lower(get(r, "Email", "Email Address", "Parent Email", "Account Email", "Guardian Email")), phone: get(r, "Phone", "Phone Number", "Parent Phone"), date_of_birth: get(r, "Date of Birth", "DOB", "Birthdate"), event: title, date })).filter(r => r.first_name && r.email);
}

// ── Upper Hand ──────────────────────────────────────────────────────────────
export async function importUpperHand(sb, { contacts = [], participants = [], orders = [], attendance = [] } = {}) {
  const out = { contacts: 0, participants: 0, orders: 0, ordersMatched: 0, participation: 0 };
  // Account holders.
  const holders = contacts.map(r => ({ email: lower(r.email), first_name: cap(r.first_name), last_name: cap(r.last_name), phone: e164(r.phone_number || r.phone), address: clean(r.address_line_1) || null, city: cap(r.city) || null, state: clean(r.state).toUpperCase() || null, zip: clean(r.postal_code) || null, dob: isoDate(r.date_of_birth), sources: ["upperhand"], uh_added_at: isoDate(r.added_date), uh_last_login: isoDate(r.last_login_at) })).filter(r => EMAIL_RE.test(r.email));
  // Participants whose email isn't an account holder are their own account (adults, or a
  // family whose holder row is missing): give them a contact so nothing is dropped.
  const holderEmails = new Set(holders.map(h => h.email));
  const orphanAdults = participants.filter(r => EMAIL_RE.test(lower(r.email)) && !holderEmails.has(lower(r.email)));
  const orphanByEmail = new Map();
  for (const r of orphanAdults) { const e = lower(r.email); if (!orphanByEmail.has(e)) orphanByEmail.set(e, { email: e, first_name: cap(r.first_name), last_name: cap(r.last_name), phone: e164(r.phone), dob: isoDate(r.date_of_birth), sources: ["upperhand"] }); else if (e164(r.phone) && !orphanByEmail.get(e).phone) orphanByEmail.get(e).phone = e164(r.phone); }
  const ids = await upsertContacts(sb, [...holders, ...orphanByEmail.values()]);
  out.contacts = ids.size;
  // Participants under their contact. A participant that IS the holder (same name) is flagged.
  const holderName = new Map(holders.map(h => [h.email, nameKey(h.first_name, h.last_name)]));
  const prows = participants.map(r => { const e = lower(r.email); const cid = ids.get(e); if (!cid) return null; const nk = nameKey(r.first_name, r.last_name); return { contact_id: cid, first_name: r.first_name, last_name: r.last_name, dob: isoDate(r.date_of_birth), gender: lower(r.gender) || null, is_contact: holderName.get(e) === nk || orphanByEmail.has(e) && nameKey(orphanByEmail.get(e).first_name, orphanByEmail.get(e).last_name) === nk, sources: ["upperhand"] }; }).filter(Boolean);
  const pids = await upsertParticipants(sb, prows);
  out.participants = pids.size;
  // Orders → spend, matched to a contact by buyer name.
  const { data: allContacts } = await sb.from("dssc_contacts").select("id, first_name, last_name");
  const byName = new Map(); for (const c of allContacts || []) { const k = nameKey(c.first_name, c.last_name); if (!byName.has(k)) byName.set(k, c.id); }
  const orows = orders.filter(r => r.Id).map(r => { const cid = byName.get(nameKey(...clean(r.Buyer).split(/\s+(?=\S+$)/))) || null; if (cid) out.ordersMatched++; return { id: r.Id, contact_id: cid, buyer: clean(r.Buyer) || null, order_number: clean(r["Order Number"]) || null, total_cents: Math.round(Number(r.Total) || 0), method: clean(r.Method) || null, sale_source: clean(r["Sale Source"]) || null, ordered_at: isoTs(r["Date & Time"]) }; });
  for (let i = 0; i < orows.length; i += 300) { const { error } = await sb.from("dssc_orders").upsert(orows.slice(i, i + 300), { onConflict: "id" }); if (error) throw new Error("orders: " + error.message); }
  out.orders = orows.length;
  // Attendance/registration export (when available): participant name + event title + date.
  if (attendance.length) {
    // Anyone on an event list we haven't seen becomes a contact too — the
    // attendee export carries the account email, and a family that only ever
    // bought through an event is exactly who the CRM is for.
    const extra = attendance.map(r => ({ email: lower(r.email || r.user_email || r["Email"]), first_name: cap(r.first_name || ""), last_name: cap(r.last_name || ""), phone: e164(r.phone), sources: ["upperhand"] })).filter(r => EMAIL_RE.test(r.email) && !ids.has(r.email));
    if (extra.length) for (const [k, v] of await upsertContacts(sb, extra)) ids.set(k, v);
    const rows = [];
    const newParts = attendance.map(r => { const e = lower(r.email || r.user_email || r["Email"]); const cid = ids.get(e); return cid ? { contact_id: cid, first_name: r.first_name || r["Participant First Name"] || r["First Name"] || "", last_name: r.last_name || r["Participant Last Name"] || r["Last Name"] || "", dob: isoDate(r.date_of_birth), sources: ["upperhand"] } : null; }).filter(p => p && clean(p.first_name));
    if (newParts.length) for (const [k, v] of await upsertParticipants(sb, newParts)) pids.set(k, v);
    for (const r of attendance) {
      const e = lower(r.email || r.user_email || r["Email"]); const cid = ids.get(e); if (!cid) continue;
      const first = r.first_name || r["Participant First Name"] || r["First Name"] || "", last = r.last_name || r["Participant Last Name"] || r["Last Name"] || "";
      const program = r.event || r.program || r["Event Title"] || r["Event"] || r["Event Name"] || r["Product"] || r["Product Name"] || r["Item"] || r["Item Name"] || r["Program"] || r["Class"] || "";
      if (!program) continue;
      const pid = pids.get(cid + "|" + nameKey(first, last)) || null;
      rows.push({ participant_id: pid, contact_id: cid, program, event_date: isoDate(r.date || r["Event Date"] || r["Date"]), source: "upperhand", source_ref: [e, nameKey(first, last), lower(program), isoDate(r.date || r["Event Date"] || r["Date"]) || ""].join("|") });
    }
    out.participation = await upsertParticipation(sb, rows);
  }
  return out;
}


// Every row, not just Supabase's first 1,000 per request (dssc_pod_roster
// passed 1,000 rows in Oct 2026). build() returns a fresh query each call.
async function fetchAll(build, page = 1000) {
  const out = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await build().order("id").range(from, from + page - 1);
    if (error) return { data: out.length ? out : null, error };
    out.push(...(data || []));
    if (!data || data.length < page) return { data: out, error: null };
  }
}

// ── Playbook (current classes) ───────────────────────────────────────────────
export async function syncPlaybook(sb) {
  const [{ data: roster }, { data: clinics }] = await Promise.all([fetchAll(() => sb.from("dssc_pod_roster").select("*")), sb.from("dssc_clinics").select("id, name, category, sessions")]);
  const cl = new Map((clinics || []).map(c => [c.id, c]));
  const contacts = [], parts = [], parts2 = [];
  for (const r of roster || []) {
    const e = lower(r.parent_email); if (!EMAIL_RE.test(e)) continue;
    const [pf, ...pl] = clean(r.parent_name || "").split(" ");
    contacts.push({ email: e, first_name: cap(pf || ""), last_name: cap(pl.join(" ")), phone: e164(r.parent_phone), sources: ["playbook"] });
  }
  const ids = await upsertContacts(sb, contacts);
  for (const r of roster || []) {
    const e = lower(r.parent_email); const cid = ids.get(e); if (!cid) continue;
    const [f, ...l] = clean(r.player_name).split(" ");
    parts.push({ contact_id: cid, first_name: f, last_name: l.join(" ") || "", sources: ["playbook"] });
    parts2.push({ r, cid, nk: nameKey(f, l.join(" ")) });
  }
  const pids = await upsertParticipants(sb, parts);
  const rows = parts2.map(({ r, cid, nk }) => { const c = cl.get(r.clinic_id); const s = (c?.sessions || []).find(x => String(x.id) === String(r.session_id)); return { participant_id: pids.get(cid + "|" + nk) || null, contact_id: cid, program: c?.name || "DSSC class", category: "volleyball", event_date: s?.date || null, source: "playbook", source_ref: r.source_ref || ("roster-" + r.id) }; });
  return { contacts: ids.size, participants: pids.size, participation: await upsertParticipation(sb, rows) };
}

// ── Playbook registrations report (every program, every date) ───────────────
// The same "Export All" the hourly roster pull fetches. syncPlaybook only sees
// classes HQ tracks (volleyball, from the calendar), so a family whose only
// sign-up was the Women's Academy, a basketball lab or a court rental never
// reached People. This takes every row: the account holder (user_*) is the
// contact, participant_name the person under them, source the program.
// source_ref is the registration_pk — the same key the roster import gives a
// volleyball class row — so the two meet in one record instead of doubling.
// Only registrations People doesn't have yet are written, so the hourly run is
// cheap once the backlog is in.
export async function importPlaybookRegistrations(sb, rows) {
  const out = { rows: rows.length, new: 0, contacts: 0, participants: 0, participation: 0 };
  const regs = rows.filter(r => clean(r.registration_pk) && clean(r.source) && EMAIL_RE.test(lower(r.user_email)));
  const have = new Set();
  const refs = regs.map(r => clean(r.registration_pk));
  for (let i = 0; i < refs.length; i += 150) {
    const { data, error } = await sb.from("dssc_participation").select("source_ref").eq("source", "playbook").in("source_ref", refs.slice(i, i + 150));
    if (error) throw new Error("participation lookup: " + error.message);
    (data || []).forEach(d => have.add(d.source_ref));
  }
  const fresh = regs.filter(r => !have.has(clean(r.registration_pk)));
  out.new = fresh.length;
  if (!fresh.length) return out;
  const split = (n) => { const [f, ...l] = clean(n).split(" "); return [f || "", l.join(" ")]; };
  const ids = await upsertContacts(sb, fresh.map(r => { const [f, l] = split(r.user_name); return { email: lower(r.user_email), first_name: cap(f), last_name: cap(l), sources: ["playbook"] }; }));
  out.contacts = ids.size;
  const parts = fresh.map(r => {
    const cid = ids.get(lower(r.user_email)); const [f, l] = split(r.participant_name || r.user_name);
    return cid && f ? { contact_id: cid, first_name: f, last_name: l, is_contact: nameKey(f, l) === nameKey(...split(r.user_name)), sources: ["playbook"] } : null;
  }).filter(Boolean);
  const pids = await upsertParticipants(sb, parts);
  out.participants = pids.size;
  out.participation = await upsertParticipation(sb, fresh.map(r => {
    const cid = ids.get(lower(r.user_email)); const [f, l] = split(r.participant_name || r.user_name);
    // "Volleyball 101 - 3rd - 5th Grade(15415)": the number is Playbook's session id, not part of the name.
    const program = clean(r.source).replace(/\s*\(\d+\)\s*$/, "");
    return { participant_id: pids.get(cid + "|" + nameKey(f, l)) || null, contact_id: cid, program, event_date: isoDate(r.start_date) || isoDate(r.date_created), source: "playbook", source_ref: clean(r.registration_pk) };
  }));
  return out;
}

// A court booking deleted in Playbook drops out of the registrations report,
// but the import above only ever adds - so Court Availability kept showing it
// (Drew, Oct 20 2026: ACES deleted from the DSSC calendar, still on Court
// Availability). Future facility reservations the full report no longer has
// are removed. Past rows stay as history. Guards: the report must look
// complete, and a sweep that would remove a lot is refused (a bad export
// shouldn't wipe the courts).
export async function pruneDeletedReservations(sb, rows, { dry = false } = {}) {
  if (!Array.isArray(rows) || rows.length < 500) return { pruned: 0, skipped: "report looks partial (" + (rows?.length || 0) + " rows)" };
  const live = new Set(rows.map(r => clean(r.registration_pk)).filter(Boolean));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const { data, error } = await sb.from("dssc_participation").select("id, source_ref, program, event_date").eq("source", "playbook").eq("category", "facility").gte("event_date", today);
  if (error) throw new Error("reservation lookup: " + error.message);
  const gone = (data || []).filter(d => d.source_ref && !live.has(d.source_ref));
  if (gone.length > 60) return { pruned: 0, skipped: gone.length + " reservations missing from the report - too many to remove automatically" };
  if (!dry) for (let i = 0; i < gone.length; i += 100) {
    const { error: e } = await sb.from("dssc_participation").delete().in("id", gone.slice(i, i + 100).map(d => d.id));
    if (e) throw new Error("reservation prune: " + e.message);
  }
  return { pruned: gone.length, removed: gone.slice(0, 20).map(d => d.program + " " + d.event_date) };
}

// ── DS Elite roster ──────────────────────────────────────────────────────────
// Rise / Regional / National from the practice_teams level, falling back to the
// name (Diamond = National, Rise = Rise, the other gems = Regional).
const levelOf = (team, lvl) => { const l = lower(lvl), t = lower(team); if (/rise|develop/.test(l + " " + t)) return "rise"; if (/national/.test(l) || /diamond/.test(t)) return "national"; if (/regional/.test(l) || t) return "regional"; return null; };
export async function syncDsElite(sb) {
  const { data: players } = await sb.from("players").select("id, first_name, last_name, dob, gender, team_assignment, offer_status, parent_name, parent2_name, parent_email, parent_email2, parent_phone, parent2_phone, city, zip, address_line1, state, created_at, primary_position, secondary_position");
  const { data: pteams } = await sb.from("practice_teams").select("team_name, level");
  const lvlByTeam = new Map((pteams || []).map(t => [t.team_name, t.level]));
  const contacts = [], link = [];
  for (const p of players || []) {
    const e = lower(p.parent_email); if (!EMAIL_RE.test(e)) continue;
    const [pf, ...pl] = clean(p.parent_name || "").split(" ");
    contacts.push({ email: e, first_name: cap(pf || ""), last_name: cap(pl.join(" ")), phone: e164(p.parent_phone), address: clean(p.address_line1) || null, city: cap(p.city) || null, state: clean(p.state).toUpperCase() || null, zip: clean(p.zip) || null, sources: ["dse"] });
    link.push({ p, e });
  }
  const ids = await upsertContacts(sb, contacts);
  const parts = link.map(({ p, e }) => ({ contact_id: ids.get(e), first_name: p.first_name, last_name: p.last_name, dob: isoDate(p.dob), gender: p.gender ? lower(p.gender) : "female", dse_player_id: p.id, sources: ["dse"] }));
  const pids = await upsertParticipants(sb, parts);
  // Position and team level, for sorting the CRM by what a kid plays and where.
  for (const { p, e } of link) {
    const id = pids.get(ids.get(e) + "|" + nameKey(p.first_name, p.last_name)); if (!id) continue;
    const onTeam = p.team_assignment && !["declined", "not_invited", "opted_out"].includes(p.offer_status || "");
    await sb.from("dssc_participants").update({ position: clean(p.primary_position) || null, position2: clean(p.secondary_position) || null, dse_team: onTeam ? p.team_assignment : null, dse_level: onTeam ? levelOf(p.team_assignment, lvlByTeam.get(p.team_assignment)) : null }).eq("id", id);
  }
  const rows = link.filter(({ p }) => p.team_assignment && !["declined", "not_invited", "opted_out"].includes(p.offer_status || "")).map(({ p, e }) => ({ participant_id: pids.get(ids.get(e) + "|" + nameKey(p.first_name, p.last_name)) || null, contact_id: ids.get(e), program: "DS Elite " + p.team_assignment + " (2026-27)", category: "volleyball", event_date: "2026-09-01", source: "dse", source_ref: "player-" + p.id }));
  // Remember which DS Elite players belong to each family.
  const byC = new Map(); for (const { p, e } of link) { const cid = ids.get(e); if (!byC.has(cid)) byC.set(cid, []); byC.get(cid).push(p.id); }
  for (const [cid, list] of byC) await sb.from("dssc_contacts").update({ dse_player_ids: list }).eq("id", cid);
  return { contacts: ids.size, participants: pids.size, participation: await upsertParticipation(sb, rows) };
}

// ── Playbook participant export ─────────────────────────────────────────────
// Reports → Participants. One row per student (a kid, or an adult who is their
// own guardian) with the guardian's email, phone and name — the one export
// that gives every family a phone. Guardian = contact; student = participant.
// Also stamps guardian phones onto the class rosters, so the Texts screen can
// reach families who registered but never used the opt-in form (consent is a
// separate question and stays as it was).
export async function importPlaybookParticipants(sb, rows) {
  const out = { contacts: 0, participants: 0, rosterPhones: 0 };
  const contacts = [];
  for (const r of rows) {
    const e = lower(r.guardian_email); if (!EMAIL_RE.test(e)) continue;
    const [gf, ...gl] = clean(r.guardian_name).split(" ");
    contacts.push({ email: e, first_name: cap(gf || ""), last_name: cap(gl.join(" ")), phone: e164(r.guardian_phone), sources: ["playbook"], playbook_user_pk: clean(r.user_pk) || null });
  }
  const ids = await upsertContacts(sb, contacts);
  // playbook_user_pk isn't part of upsertContacts' shape; set it directly.
  const pk = new Map(contacts.filter(c => c.playbook_user_pk).map(c => [c.email, c.playbook_user_pk]));
  for (const [email, id] of ids) if (pk.get(email)) await sb.from("dssc_contacts").update({ playbook_user_pk: pk.get(email) }).eq("id", id).is("playbook_user_pk", null);
  out.contacts = ids.size;
  const parts = [];
  for (const r of rows) {
    const e = lower(r.guardian_email); const cid = ids.get(e); if (!cid) continue;
    const [f, ...l] = clean(r.student_name).split(" ");
    const g = lower(r.student_gender); const gender = g === "female" || g === "male" ? g : null;
    parts.push({ contact_id: cid, first_name: f, last_name: l.join(" "), dob: isoDate(r.date_of_birth), gender, is_contact: nameKey(f, l.join(" ")) === nameKey(...clean(r.guardian_name).split(/\s+(?=\S+$)/)), sources: ["playbook"], playbook_student_pk: clean(r.student_pk) || null, phone: e164(r.student_phone), waiver_signed: !!clean(r.universal_waiver_status), allergies: clean(r["Participant Food Allergies"]) || null });
  }
  const pids = await upsertParticipants(sb, parts);
  // The extra Playbook columns, set per row (upsertParticipants keeps its narrow shape).
  for (const p of parts) { const id = pids.get(p.contact_id + "|" + nameKey(p.first_name, p.last_name)); if (id) await sb.from("dssc_participants").update({ playbook_student_pk: p.playbook_student_pk, phone: p.phone, waiver_signed: p.waiver_signed, allergies: p.allergies }).eq("id", id); }
  out.participants = pids.size;
  // Rosters: fill parent_phone where we now know it.
  const phoneByEmail = new Map(contacts.filter(c => c.phone).map(c => [c.email, c.phone]));
  const { data: roster } = await sb.from("dssc_pod_roster").select("id, parent_email, parent_phone").is("parent_phone", null);
  for (const r of roster || []) { const ph = phoneByEmail.get(lower(r.parent_email)); if (ph) { const { error } = await sb.from("dssc_pod_roster").update({ parent_phone: ph }).eq("id", r.id); if (!error) out.rosterPhones++; } }
  return out;
}

// ── Playbook spend (Reports → Registrations, the export with prices) ────────
// One row per registration with invoice_number and registration_base_price —
// a package's price arrives split across its sessions ($200 over 6 sessions =
// $33.33 × 6), so the rows add up to what was charged at list price (before
// credits, discounts or refunds, which Playbook doesn't export here). Rows are
// folded into one purchase per invoice × person × program; source_ref is that
// key, so re-importing an overlapping date range replaces instead of doubling.
// It also carries what the hourly export doesn't: the parent's phone and the
// kid's birthday and gender, which top up People.
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const dmy = (s) => { const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(clean(s)); return m && MON[m[2].toLowerCase()] != null ? { y: +m[3], mo: MON[m[2].toLowerCase()], d: +m[1], rest: clean(s).slice(m[0].length) } : null; };
const pbDate = (s) => { const p = dmy(s); return p ? `${p.y}-${String(p.mo + 1).padStart(2, "0")}-${String(p.d).padStart(2, "0")}` : isoDate(s); };
// "22-Oct-2026, 12:15 PM" is Central time; CDT or CST depending on the date.
export function pbTimestamp(s) {
  const p = dmy(s); if (!p) return null;
  const t = /(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(p.rest); let h = 0, mi = 0;
  if (t) { h = +t[1] % 12 + (/pm/i.test(t[3]) ? 12 : 0); mi = +t[2]; }
  let ms = Date.UTC(p.y, p.mo, p.d, h + 6, mi);   // CST guess
  const hh = +new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }).format(new Date(ms));
  if (hh !== h) ms -= 3600000;                     // daylight time
  return new Date(ms).toISOString();
}
const cents = (s) => { const n = Number(String(s || "").replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
export const isPlaybookSpendExport = (cols) => cols.includes("invoice_number") && cols.includes("registration_base_price");

export async function importPlaybookSpend(sb, rows) {
  const out = { rows: rows.length, purchases: 0, contacts: 0, participants: 0, cents: 0, from: null, to: null };
  const regs = rows.filter(r => clean(r.invoice_number) && clean(r.source) && EMAIL_RE.test(lower(r.user_email)));
  if (!regs.length) return out;
  const ids = await upsertContacts(sb, regs.map(r => ({ email: lower(r.user_email), first_name: cap(r.user_first_name), last_name: cap(r.user_last_name), phone: e164(r.user_phone), sources: ["playbook"] })));
  out.contacts = ids.size;
  const split = (n) => { const [f, ...l] = clean(n).split(" "); return [f || "", l.join(" ")]; };
  const g = (x) => /^f/i.test(x || "") ? "female" : /^m/i.test(x || "") ? "male" : null;
  const parts = regs.map(r => {
    const cid = ids.get(lower(r.user_email)); const [f, l] = split(r.participant_name);
    return cid && f ? { contact_id: cid, first_name: f, last_name: l, dob: pbDate(r.participant_DOB), gender: g(r.participant_gender), is_contact: nameKey(f, l) === nameKey(r.user_first_name, r.user_last_name), sources: ["playbook"] } : null;
  }).filter(Boolean);
  const pids = await upsertParticipants(sb, parts);
  out.participants = pids.size;
  const buys = new Map();
  for (const r of regs) {
    const cid = ids.get(lower(r.user_email)); if (!cid) continue;
    const [f, l] = split(r.participant_name);
    const program = clean(r.source).replace(/\s*\(\d+\)\s*$/, "");
    const invoice = clean(r.invoice_number).replace(/^invoice\s*#?/i, "");
    const key = [invoice, nameKey(f, l) || lower(r.user_email), lower(program)].join("|");
    const at = pbTimestamp(r.date_created);
    const b = buys.get(key) || { source: "playbook", source_ref: key, contact_id: cid, participant_id: pids.get(cid + "|" + nameKey(f, l)) || null, invoice, program, category: categoryOf(program), kind: clean(r.type) || null, sessions: 0, amount_cents: 0, purchased_at: at };
    b.sessions++; b.amount_cents += cents(r.registration_base_price);
    if (at && (!b.purchased_at || at < b.purchased_at)) b.purchased_at = at;
    buys.set(key, b);
  }
  const list = [...buys.values()];
  for (let i = 0; i < list.length; i += 300) { const { error } = await sb.from("dssc_purchases").upsert(list.slice(i, i + 300), { onConflict: "source,source_ref" }); if (error) throw new Error("purchases: " + error.message); }
  out.purchases = list.length;
  out.cents = list.reduce((s, b) => s + b.amount_cents, 0);
  const days = list.map(b => (b.purchased_at || "").slice(0, 10)).filter(Boolean).sort();
  out.from = days[0] || null; out.to = days[days.length - 1] || null;
  return out;
}

// ── Old mailing lists (Mailchimp, Constant Contact, a spreadsheet…) ─────────
// Any CSV with an email column. Each address becomes (or tops up) a contact,
// tagged with the list it came from (dssc_contacts.lists) and source 'list'.
// A status column saying unsubscribed / opted out goes to mkt_unsubscribes; one
// saying cleaned / bounced / invalid marks the address bounced. Neither is ever
// emailed. Mailchimp's separate "unsubscribed" / "cleaned" exports work too:
// the file name says what they are (opts.status).
const col = (cols, ...res) => cols.find(c => res.some(re => re.test(String(c).trim())));
export function mailingListColumns(cols) {
  return {
    email: col(cols, /^e-?mail(\s*address)?$/i, /e-?mail/i),
    first: col(cols, /^first[\s_]*name$/i, /^fname$/i, /^first$/i, /^given/i),
    last: col(cols, /^last[\s_]*name$/i, /^lname$/i, /^last$/i, /^surname$/i, /^family name$/i),
    name: col(cols, /^(full[\s_]*)?name$/i, /^contact(\s*name)?$/i, /^parent(\s*name)?$/i),
    phone: col(cols, /mobile|cell/i, /phone/i),
    city: col(cols, /^city$/i),
    zip: col(cols, /zip|postal/i),
    status: col(cols, /^(member\s*)?status$/i, /e-?mail\s*(status|permission)/i, /subscri/i, /opt/i),
  };
}
export const statusOf = (v) => /unsub|opt(ed)?[\s_-]*out|do\s*not|revoked/i.test(v || "") ? "unsubscribed" : /clean|bounc|invalid|undeliver|non-?deliver/i.test(v || "") ? "bounced" : "ok";

export async function importMailingList(sb, rows, { list, status: fileStatus = "ok" } = {}) {
  const name = clean(list) || "Imported list";
  const c = mailingListColumns(Object.keys(rows[0] || {}));
  if (!c.email) throw new Error(`${name}: no email column`);
  const out = { list: name, rows: rows.length, contacts: 0, unsubscribed: 0, bounced: 0, invalid: 0 };
  const byEmail = new Map();
  for (const r of rows) {
    const email = lower(r[c.email]);
    if (!EMAIL_RE.test(email)) { out.invalid++; continue; }
    let [f, l] = [clean(r[c.first]), clean(r[c.last])];
    if (!f && c.name) { const [a, ...b] = clean(r[c.name]).split(" "); f = a || ""; l = l || b.join(" "); }
    const st = fileStatus !== "ok" ? fileStatus : statusOf(c.status ? r[c.status] : "");
    const cur = byEmail.get(email);
    byEmail.set(email, { email, first_name: cap(f) || cur?.first_name || null, last_name: cap(l) || cur?.last_name || null, phone: e164(c.phone ? r[c.phone] : "") || cur?.phone || null, city: cap(c.city ? r[c.city] : "") || cur?.city || null, zip: clean(c.zip ? r[c.zip] : "").slice(0, 10) || cur?.zip || null, sources: ["list"], st: cur?.st && cur.st !== "ok" ? cur.st : st });
  }
  const all = [...byEmail.values()];
  // An old list never overwrites what People already has on a family (a
  // customer's name and phone from Playbook beat a 2019 spreadsheet): for
  // addresses already on file only blanks are filled.
  const known = new Map();
  for (let i = 0; i < all.length; i += 150) { const { data } = await sb.from("dssc_contacts").select("email, first_name, last_name, phone").in("email", all.slice(i, i + 150).map(r => r.email)); for (const k of data || []) known.set(k.email, k); }
  const ids = await upsertContacts(sb, all.map(({ st, city, zip, ...r }) => { const k = known.get(r.email); return k ? { ...r, first_name: k.first_name || r.first_name, last_name: k.last_name || r.last_name, phone: k.phone || r.phone } : r; }));
  out.contacts = ids.size;
  const emails = all.map(r => r.email);
  for (let i = 0; i < emails.length; i += 500) { const { error } = await sb.rpc("dssc_add_list", { p_emails: emails.slice(i, i + 500), p_list: name }); if (error) throw new Error("lists: " + error.message); }
  const fill = all.filter(r => r.city || r.zip);
  for (let i = 0; i < fill.length; i += 150) {
    const chunk = fill.slice(i, i + 150);
    const { data } = await sb.from("dssc_contacts").select("id, email, city, zip").in("email", chunk.map(r => r.email));
    for (const row of data || []) { const r = byEmail.get(row.email); const patch = {}; if (!row.city && r.city) patch.city = r.city; if (!row.zip && r.zip) patch.zip = r.zip; if (Object.keys(patch).length) await sb.from("dssc_contacts").update(patch).eq("id", row.id); }
  }
  const unsub = all.filter(r => r.st === "unsubscribed").map(r => ({ email: r.email }));
  for (let i = 0; i < unsub.length; i += 500) { const { error } = await sb.from("mkt_unsubscribes").upsert(unsub.slice(i, i + 500), { onConflict: "email", ignoreDuplicates: true }); if (error) throw new Error("unsubscribes: " + error.message); }
  out.unsubscribed = unsub.length;
  const bounced = all.filter(r => r.st === "bounced").map(r => r.email);
  for (let i = 0; i < bounced.length; i += 150) { const { error } = await sb.from("dssc_contacts").update({ email_status: "bounced", email_status_at: new Date().toISOString() }).in("email", bounced.slice(i, i + 150)).neq("email_status", "complained"); if (error) throw new Error("bounced: " + error.message); }
  out.bounced = bounced.length;
  return out;
}
