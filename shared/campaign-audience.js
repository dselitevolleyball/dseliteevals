// Who a text campaign reaches. One engine for the Campaigns screen (live count
// and preview) and the sending API (the snapshot actually texted), so what the
// director sees is exactly who gets it.
//
// People come from four places, keyed by phone (last 10 digits) so a family
// that shows up in several is one recipient:
//   • DS Elite players on a team (players.team_assignment, non-terminal offer)
//     — team, level (practice_teams.level; Developmental = Rise), age group
//     from the team name, positions; parent, second parent, and the player's
//     own phone
//   • DSSC People: dssc_contacts (families), dssc_participants (kids, and the
//     adult themselves when is_contact), dssc_participation (every sign-up:
//     program, category, date)
//   • current DSSC class lists (dssc_pod_roster on clinics with a session
//     today or later)
//   • coaches (coach_roster), with the DS Elite teams they coach
// Filters on a kid (level, team, age, position, gender, programs) match a
// family when ANY of its kids matches; the message can name the kids who did.
// Opt-outs (sms_optouts for the brand) and do-not-text families are never
// included.

export const LEVELS = ["National", "Regional", "Rise"];
export const POSITIONS = [["S", "Setter"], ["OH", "Outside"], ["RS", "Right side"], ["M", "Middle"], ["L", "Libero / DS"]];
export const CATEGORIES = ["volleyball", "basketball", "reach", "facility", "other"];
export const MERGE_FIELDS = [
  ["{parent_first}", "Parent's first name", "there"],
  ["{players}", "Matched kids' first names", "your player"],
  ["{player_first}", "First matched kid", "your player"],
  ["{team}", "DS Elite team", "the team"],
  ["{program}", "Latest matched program", "the program"],
];
export const EMPTY_FILTERS = { target: "parents", dse: "any", levels: [], teams: [], ageGroups: [], positions: [], gender: "", categories: [], program: "", since: "", current: false, minAge: "", maxAge: "", exclude: [] };

const last10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);
const e164 = (s) => { const d = String(s || "").replace(/\D/g, ""); if (d.length === 10) return "+1" + d; if (d.length === 11 && d.startsWith("1")) return "+" + d; return null; };
const nrm = (v) => String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
const firstOf = (s) => String(s || "").trim().split(/\s+/)[0] || "";
const levelOf = (l) => /develop|rise/i.test(l || "") ? "Rise" : /national/i.test(l || "") ? "National" : /regional/i.test(l || "") ? "Regional" : "";
const ageGroupOfTeam = (t) => { const m = /^(\d{1,2})\b/.exec(String(t || "").trim()); return m ? +m[1] : null; };
const ageOn = (dob, today) => {
  if (!dob) return null; let y, mo, d;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob); if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else { m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(dob); if (!m) return null; mo = +m[1]; d = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
  const [ty, tm, td] = today.split("-").map(Number); let a = ty - y; if (tm < mo || (tm === mo && td < d)) a--; return a >= 0 && a < 100 ? a : null;
};
// Every way a position gets written → the five codes.
export const positionCodes = (vals) => {
  const out = new Set();
  for (const raw of [].concat(vals || [])) {
    const v = String(raw || "").trim().toLowerCase(); if (!v) continue;
    if (/^s$|setter/.test(v)) out.add("S");
    if (/^oh$|outside/.test(v)) out.add("OH");
    if (/^rs$|^opp|right/.test(v)) out.add("RS");
    if (/pin/.test(v)) { out.add("OH"); out.add("RS"); }
    if (/^m$|^mb$|middle/.test(v)) out.add("M");
    if (/^l$|libero|^ds$|def/.test(v)) out.add("L");
  }
  return out;
};

// Pull everything the engine needs. Works with the browser client or the
// service-role client.
export async function loadAudienceData(sb) {
  const page = async (table, sel) => { const out = []; for (let from = 0; ; from += 1000) { const { data, error } = await sb.from(table).select(sel).order("id").range(from, from + 999); if (error) throw new Error(table + ": " + error.message); out.push(...(data || [])); if (!data || data.length < 1000) break; } return out; };
  const all = async (table, sel) => { const { data, error } = await sb.from(table).select(sel); if (error) throw new Error(table + ": " + error.message); return data || []; };
  const [contacts, participants, participation, players, teams, roster, clinics, coaches, optouts] = await Promise.all([
    page("dssc_contacts", "id, first_name, last_name, phone, tags, sources, do_not_text"),
    page("dssc_participants", "id, contact_id, first_name, last_name, dob, gender, is_contact, dse_player_id, position, position2"),
    page("dssc_participation", "id, participant_id, contact_id, program, category, event_date, source"),
    page("players", "id, first_name, last_name, dob, age, gender, team_assignment, offer_status, positions, primary_position, secondary_position, parent_name, parent_phone, parent2_name, parent2_phone, player_phone"),
    all("practice_teams", "team_name, level, head_coach, assistant_coach, third_coach, practices_per_week"),
    page("dssc_pod_roster", "id, clinic_id, player_name, parent_name, parent_phone, age"),
    page("dssc_clinics", "id, name, category, age_group, sessions"),
    page("coach_roster", "id, first_name, last_name, phone"),
    all("sms_optouts", "phone, brand"),
  ]);
  return { contacts, participants, participation, players, teams, roster, clinics, coaches, optouts };
}

// Index everything into families (by phone), DS Elite players with their own
// phone, and coaches.
export function buildPeople(d, today = new Date().toISOString().slice(0, 10)) {
  const teamInfo = new Map((d.teams || []).map(t => [t.team_name, { level: levelOf(t.level), ageGroup: ageGroupOfTeam(t.team_name), event: t.practices_per_week != null && Number(t.practices_per_week) === 0 }]));
  const families = new Map();      // last10 -> family
  const fam = (phone, name) => {
    const k = last10(phone), to = e164(phone); if (!to || k.length !== 10) return null;
    if (!families.has(k)) families.set(k, { key: k, to, name: (name || "").trim(), kids: new Map(), doNotText: false, sources: new Set() });
    const f = families.get(k); if (!f.name && name) f.name = name.trim(); return f;
  };
  const kids = new Map();          // kid key -> kid (shared across the families it belongs to)
  const kidFor = (key, base) => { if (!kids.has(key)) kids.set(key, { key, programs: [], positions: new Set(), current: false, currentPrograms: [], ...base }); return kids.get(key); };

  // DS Elite players on a team.
  const dseById = new Map();
  const playerPhones = [];
  for (const p of d.players || []) {
    if (!p.team_assignment || /declin|releas|withdr|cancel/i.test(p.offer_status || "")) continue;
    const ti = teamInfo.get(p.team_assignment) || {}; if (ti.event) continue;
    const name = ((p.first_name || "") + " " + (p.last_name || "")).trim();
    const k = kidFor("dse:" + p.id, { name, first: p.first_name || firstOf(name), dse: true, team: p.team_assignment, level: ti.level || "", ageGroup: ti.ageGroup, age: ageOn(p.dob, today) ?? (p.age ? +p.age : null), gender: /^f/i.test(p.gender || "") ? "female" : /^m/i.test(p.gender || "") ? "male" : "female" });
    for (const c of positionCodes([...(p.positions || []), p.primary_position, p.secondary_position])) k.positions.add(c);
    dseById.set(String(p.id), k);
    for (const [ph, nm] of [[p.parent_phone, p.parent_name], [p.parent2_phone, p.parent2_name]]) { const f = fam(ph, nm); if (f) { f.kids.set(k.key, k); f.sources.add("dse"); } }
    if (e164(p.player_phone)) playerPhones.push({ to: e164(p.player_phone), key: last10(p.player_phone), name, kid: k });
  }

  // DSSC People: contacts, their kids (and themselves), every sign-up.
  const contactById = new Map((d.contacts || []).map(c => [c.id, c]));
  const partById = new Map();
  for (const pp of d.participants || []) {
    const c = contactById.get(pp.contact_id); if (!c) continue;
    const name = ((pp.first_name || "") + " " + (pp.last_name || "")).trim();
    const k = pp.dse_player_id && dseById.has(String(pp.dse_player_id)) ? dseById.get(String(pp.dse_player_id))
      : kidFor("p:" + pp.id, { name, first: pp.first_name || firstOf(name), dse: false, self: !!pp.is_contact, team: "", level: "", ageGroup: null, age: ageOn(pp.dob, today), gender: /^f/i.test(pp.gender || "") ? "female" : /^m/i.test(pp.gender || "") ? "male" : "" });
    for (const cd of positionCodes([pp.position, pp.position2])) k.positions.add(cd);
    if (k.ageGroup == null && k.age != null) k.ageGroup = k.age;
    partById.set(pp.id, k);
    const f = fam(c.phone, ((c.first_name || "") + " " + (c.last_name || "")).trim());
    if (f) { f.kids.set(k.key, k); if (c.do_not_text) f.doNotText = true; (c.sources || []).forEach(s => f.sources.add(s)); }
  }
  for (const r of d.participation || []) {
    if (!r.program || r.source === "dse") continue;
    let k = r.participant_id ? partById.get(r.participant_id) : null;
    if (!k) { const c = contactById.get(r.contact_id); if (!c) continue; const f = fam(c.phone, ((c.first_name || "") + " " + (c.last_name || "")).trim()); if (!f) continue; k = kidFor("c:" + c.id, { name: f.name, first: firstOf(f.name), self: true, dse: false, team: "", level: "", ageGroup: null, age: null, gender: "" }); f.kids.set(k.key, k); }
    k.programs.push({ program: r.program, category: r.category || "other", date: r.event_date || "" });
  }

  // Current DSSC classes.
  const clinicById = new Map((d.clinics || []).map(c => [String(c.id), c]));
  const catOf = (c) => /basket/i.test((c?.category || "") + " " + (c?.name || "")) ? "basketball" : /reach/i.test((c?.category || "") + " " + (c?.name || "")) ? "reach" : "volleyball";
  for (const r of d.roster || []) {
    const cl = clinicById.get(String(r.clinic_id)); if (!cl || !(cl.sessions || []).some(s => s?.date >= today)) continue;
    const f = fam(r.parent_phone, r.parent_name || ""); if (!f) continue;
    const name = String(r.player_name || "").trim();
    let k = [...f.kids.values()].find(x => nrm(x.name) === nrm(name));
    if (!k) { k = kidFor("r:" + r.id, { name, first: firstOf(name), dse: false, team: "", level: "", ageGroup: r.age ? +r.age : null, age: r.age ? +r.age : null, gender: "" }); f.kids.set(k.key, k); }
    k.current = true; k.currentPrograms.push(cl.name);
    k.programs.push({ program: cl.name, category: catOf(cl), date: today });
  }

  // Coaches and the DS Elite teams they coach.
  const coaches = [];
  for (const c of d.coaches || []) {
    const name = ((c.first_name || "") + " " + (c.last_name || "")).trim(); const to = e164(c.phone); if (!name || !to) continue;
    const teams = (d.teams || []).filter(t => [t.head_coach, t.assistant_coach, t.third_coach].some(x => nrm(x).replace(/ [a-z] /, " ") === nrm(name))).map(t => t.team_name);
    coaches.push({ to, key: last10(to), name, first: c.first_name || firstOf(name), teams });
  }
  const optouts = { dssc: new Set(), dse: new Set() };
  for (const o of d.optouts || []) (optouts[o.brand === "dse" ? "dse" : "dssc"]).add(last10(o.phone));
  return { families, playerPhones, coaches, teamInfo, optouts };
}

const hasKidFilters = (f) => f.dse !== "any" || f.levels?.length || f.teams?.length || f.ageGroups?.length || f.positions?.length || f.gender || f.categories?.length || f.program || f.since || f.current || f.minAge !== "" && f.minAge != null || f.maxAge !== "" && f.maxAge != null;

export function kidMatches(k, f) {
  if (f.dse === "members" && !k.dse) return false;
  if (f.dse === "non" && k.dse) return false;
  if (f.levels?.length && !f.levels.includes(k.level)) return false;
  if (f.teams?.length && !f.teams.includes(k.team)) return false;
  if (f.ageGroups?.length && !f.ageGroups.map(Number).includes(Number(k.ageGroup))) return false;
  if (f.positions?.length && !f.positions.some(p => k.positions.has(p))) return false;
  if (f.gender && k.gender && k.gender !== f.gender) return false;
  if (f.gender && !k.gender) return false;
  if (f.minAge !== "" && f.minAge != null && !(k.age != null && k.age >= +f.minAge)) return false;
  if (f.maxAge !== "" && f.maxAge != null && !(k.age != null && k.age <= +f.maxAge)) return false;
  if (f.current && !k.current) return false;
  if (f.categories?.length || f.program || f.since) {
    const q = nrm(f.program);
    const ok = k.programs.some(p => (!f.categories?.length || f.categories.includes(p.category)) && (!q || nrm(p.program).includes(q)) && (!f.since || (p.date || "") >= f.since));
    if (!ok) return false;
  }
  return true;
}

// → { recipients: [{ to, name, first, kind, players:[...], team, program }], skipped: [{ name, to, reason }] }
export function resolveAudience(people, filters, brand = "dssc") {
  const f = { ...EMPTY_FILTERS, ...(filters || {}) };
  const out = new Map(), skipped = [];
  const excluded = new Set((f.exclude || []).map(last10));
  const opted = people.optouts[brand === "dse" ? "dse" : "dssc"];
  const add = (r) => {
    const k = last10(r.to);
    if (excluded.has(k)) return;
    if (opted.has(k)) { skipped.push({ name: r.name, to: r.to, reason: "opted out" }); return; }
    if (r.doNotText) { skipped.push({ name: r.name, to: r.to, reason: "do not text" }); return; }
    const cur = out.get(k);
    if (cur) { for (const p of r.players) if (!cur.players.includes(p)) cur.players.push(p); if (!cur.team && r.team) cur.team = r.team; return; }
    out.set(k, r);
  };
  const describe = (matched) => {
    const team = [...new Set(matched.map(k => k.team).filter(Boolean))].join(" & ");
    const progs = matched.flatMap(k => k.programs).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const q = nrm(f.program);
    const prog = (progs.find(p => (!f.categories?.length || f.categories.includes(p.category)) && (!q || nrm(p.program).includes(q))) || progs[0] || {}).program || "";
    return { team, program: prog };
  };
  if (f.target === "coaches") {
    for (const c of people.coaches) {
      if (f.teams?.length && !c.teams.some(t => f.teams.includes(t))) continue;
      if (f.levels?.length && !c.teams.some(t => f.levels.includes(people.teamInfo.get(t)?.level))) continue;
      if (f.ageGroups?.length && !c.teams.some(t => f.ageGroups.map(Number).includes(people.teamInfo.get(t)?.ageGroup))) continue;
      add({ to: c.to, name: c.name, first: c.first, kind: "coach", players: [], team: c.teams.join(" & "), program: "" });
    }
  } else {
    const kidLevel = hasKidFilters(f);
    if (f.target === "parents" || f.target === "both") {
      for (const fm of people.families.values()) {
        const kidsAll = [...fm.kids.values()];
        const matched = kidLevel ? kidsAll.filter(k => kidMatches(k, f)) : kidsAll;
        if (kidLevel && !matched.length) continue;
        const kidsNamed = matched.filter(k => !k.self);
        const { team, program } = describe(matched);
        add({ to: fm.to, name: fm.name || (kidsNamed[0] ? kidsNamed[0].name + "'s parent" : "Family"), first: firstOf(fm.name), kind: "parent", players: kidsNamed.map(k => k.name), team, program, doNotText: fm.doNotText });
      }
    }
    if (f.target === "players" || f.target === "both") {
      for (const p of people.playerPhones) {
        if (kidLevel && !kidMatches(p.kid, f)) continue;
        add({ to: p.to, name: p.name, first: p.kid.first, kind: "player", players: [p.name], team: p.kid.team, program: "" });
      }
    }
  }
  const recipients = [...out.values()].sort((a, b) => (a.team || "").localeCompare(b.team || "") || (a.name || "").localeCompare(b.name || ""));
  return { recipients, skipped };
}

// Carriers refuse long texts with curly quotes / long dashes (they switch the
// whole message to UCS-2) — swap them for plain characters.
export const asciiize = (s) => String(s || "").replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[–—−]/g, "-").replace(/…/g, "...").replace(/ /g, " ");
const joinNames = (names) => { const f = [...new Set(names.map(firstOf).filter(Boolean))]; return f.length <= 1 ? (f[0] || "") : f.slice(0, -1).join(", ") + " and " + f[f.length - 1]; };
export function renderBody(template, r) {
  const vals = { "{parent_first}": r.kind === "parent" ? r.first : r.first, "{players}": joinNames(r.players || []), "{player_first}": firstOf((r.players || [])[0]), "{team}": r.team || "", "{program}": r.program || "" };
  let s = String(template || "");
  for (const [tok, , fallback] of MERGE_FIELDS) s = s.split(tok).join(vals[tok] || fallback);
  return asciiize(s).replace(/[ \t]+\n/g, "\n").trim();
}
export const isGsm = (s) => !/[^\x00-\x7F£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉÄÖÑÜ§¿äöñüà€]/.test(s || "");
export const segmentsOf = (s) => { const n = String(s || "").length; const gsm = isGsm(s); if (n <= (gsm ? 160 : 70)) return 1; return Math.ceil(n / (gsm ? 153 : 67)); };
