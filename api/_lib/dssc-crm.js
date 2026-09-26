// DSSC CRM loaders. Everything the club knows about a family, from three
// sources, folded into dssc_contacts / dssc_participants / dssc_participation
// / dssc_orders. Each loader is idempotent — run it again with a newer export
// and it tops up.
//
//   importUpperHand(sb, { contacts, participants, orders })  — Upper Hand CSV rows
//   syncPlaybook(sb)   — families and classes from dssc_pod_roster / dssc_clinics
//   syncDsElite(sb)    — DS Elite roster families, as volleyball participation
//
// Upper Hand's order export has no line items, so orders give spend and
// recency, not what was bought; program history from Upper Hand needs its
// event-attendance / registrations export, loaded through importUpperHand's
// `attendance` rows when Drew has it.

const lower = (s) => String(s || "").trim().toLowerCase();
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
const cap = (s) => clean(s).replace(/\b\w/g, c => c.toUpperCase());
export const nameKey = (f, l) => lower(clean(f) + " " + clean(l)).replace(/[^a-z0-9 ]/g, "");
export const e164 = (raw) => { const d = String(raw || "").replace(/\D/g, ""); if (d.length === 10) return "+1" + d; if (d.length === 11 && d.startsWith("1")) return "+" + d; return d.length > 10 ? "+" + d : null; };
const isoDate = (s) => { s = clean(s); if (!s) return null; let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return m[0]; m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s); if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; return null; };
const isoTs = (s) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(clean(s)); if (!m) return null; let h = +m[4] % 12; if (/pm/i.test(m[6])) h += 12; return new Date(Date.UTC(+m[3], +m[1] - 1, +m[2], h + 5, +m[5])).toISOString(); };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// What kind of program a name is. Only volleyball is synced from Playbook, but
// Upper Hand history and future exports carry everything the club sells.
export function categoryOf(name) {
  const n = lower(name);
  if (/volley|vball|setter|libero|hitter|passing|middles|pins|serve|elite tots|ds elite|rise|guaranteed to|skill lab v/.test(n)) return "volleyball";
  if (/basket|hoop|shooting|point guard|playmaker|dribbl/.test(n)) return "basketball";
  if (/reach|performance|strength|speed|agility|s&a/.test(n)) return "reach";
  if (/rental|court|open gym|party|membership/.test(n)) return "facility";
  return "other";
}

async function upsertContacts(sb, rows) {
  // rows: [{ email, first_name, last_name, phone, address, city, state, zip, dob, sources:[..], uh_added_at, uh_last_login }]
  const byEmail = new Map();
  for (const r of rows) { if (!r.email) continue; const cur = byEmail.get(r.email); byEmail.set(r.email, cur ? { ...cur, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v != null && v !== "")), sources: [...new Set([...(cur.sources || []), ...(r.sources || [])])] } : r); }
  const list = [...byEmail.values()];
  const { data: existing } = await sb.from("dssc_contacts").select("id, email, phone, first_name, last_name, sources, dob, city").in("email", list.map(r => r.email));
  const ex = new Map((existing || []).map(e => [e.email, e]));
  const up = list.map(r => { const e = ex.get(r.email) || {}; return {
    ...(e.id ? { id: e.id } : {}), email: r.email,
    first_name: r.first_name || e.first_name || null, last_name: r.last_name || e.last_name || null,
    phone: r.phone || e.phone || null, address: r.address ?? undefined, city: r.city ?? undefined, state: r.state ?? undefined, zip: r.zip ?? undefined,
    dob: r.dob || e.dob || null, sources: [...new Set([...(e.sources || []), ...(r.sources || [])])],
    uh_added_at: r.uh_added_at ?? undefined, uh_last_login: r.uh_last_login ?? undefined, updated_at: new Date().toISOString(),
  }; });
  for (let i = 0; i < up.length; i += 300) {
    const { error } = await sb.from("dssc_contacts").upsert(up.slice(i, i + 300).map(o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))), { onConflict: "email" });
    if (error) throw new Error("contacts: " + error.message);
  }
  const { data: all } = await sb.from("dssc_contacts").select("id, email").in("email", list.map(r => r.email));
  return new Map((all || []).map(c => [c.email, c.id]));
}

async function upsertParticipants(sb, rows) {
  // rows: [{ contact_id, first_name, last_name, dob, gender, is_contact, dse_player_id, sources }]
  const seen = new Map();
  for (const r of rows) { if (!r.contact_id || !clean(r.first_name)) continue; const k = r.contact_id + "|" + nameKey(r.first_name, r.last_name); const cur = seen.get(k); seen.set(k, cur ? { ...cur, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v != null && v !== "")), sources: [...new Set([...(cur.sources || []), ...(r.sources || [])])] } : { ...r, name_key: nameKey(r.first_name, r.last_name) }); }
  const list = [...seen.values()].map(r => ({ contact_id: r.contact_id, first_name: cap(r.first_name), last_name: cap(r.last_name), name_key: r.name_key, dob: r.dob || null, gender: r.gender || null, is_contact: !!r.is_contact, dse_player_id: r.dse_player_id || null, sources: r.sources || [], updated_at: new Date().toISOString() }));
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
    const rows = [];
    for (const r of attendance) {
      const e = lower(r.email || r.user_email || r["Email"]); const cid = ids.get(e); if (!cid) continue;
      const first = r.first_name || r["Participant First Name"] || r["First Name"] || "", last = r.last_name || r["Participant Last Name"] || r["Last Name"] || "";
      const program = r.event || r.program || r["Event Title"] || r["Event"] || r["Product"] || "";
      if (!program) continue;
      const pid = pids.get(cid + "|" + nameKey(first, last)) || null;
      rows.push({ participant_id: pid, contact_id: cid, program, event_date: isoDate(r.date || r["Event Date"] || r["Date"]), source: "upperhand", source_ref: [e, nameKey(first, last), lower(program), isoDate(r.date || r["Event Date"] || r["Date"]) || ""].join("|") });
    }
    out.participation = await upsertParticipation(sb, rows);
  }
  return out;
}

// ── Playbook (current classes) ───────────────────────────────────────────────
export async function syncPlaybook(sb) {
  const [{ data: roster }, { data: clinics }] = await Promise.all([sb.from("dssc_pod_roster").select("*"), sb.from("dssc_clinics").select("id, name, category, sessions")]);
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

// ── DS Elite roster ──────────────────────────────────────────────────────────
export async function syncDsElite(sb) {
  const { data: players } = await sb.from("players").select("id, first_name, last_name, dob, gender, team_assignment, offer_status, parent_name, parent2_name, parent_email, parent_email2, parent_phone, parent2_phone, city, zip, address_line1, state, created_at");
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
