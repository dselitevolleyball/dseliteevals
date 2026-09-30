// Playbook's registrations report → dssc_pod_roster, class by class.
//
// Shared by scripts/import-pod-roster.mjs (CLI) and api/dssc-roster-import.js
// (the admin board's upload). A row is one registration: for one session date,
// or (type "Program", end_date N/A) for the whole program. source_pk is the Playbook program id, which is what
// dssc_clinics.source_ref holds — so matching on it is also the volleyball
// filter, since only volleyball programs are synced into dssc_clinics.
// registration_pk is kept as source_ref, so a newer export just tops up.

const toISO = (mdy) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(mdy || "").trim()); return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null; };
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

// rows: parsed CSV objects (header names as Playbook exports them).
export async function importRoster(supabase, rows, { dry = false, addedBy = "playbook import" } = {}) {
  if (!Array.isArray(rows) || !rows.length) return { error: "No rows in the file." };
  if (!("source_pk" in rows[0]) || !("participant_name" in rows[0]) || !("start_date" in rows[0])) {
    return { error: "That doesn't look like Playbook's registrations report (expected source_pk, participant_name, start_date columns)." };
  }
  const { data: clinics, error } = await supabase.from("dssc_clinics").select("id, name, source_ref, sessions");
  if (error) return { error: error.message };
  const byRef = new Map(clinics.filter(c => c.source_ref).map(c => [String(c.source_ref), c]));

  const out = [], skipped = new Map(), noSession = [];
  for (const r of rows) {
    const c = byRef.get(String(r.source_pk || "").trim());
    if (!c) { const k = clean(r.source); skipped.set(k, (skipped.get(k) || 0) + 1); continue; }
    const date = toISO(r.start_date);
    const base = {
      clinic_id: c.id,
      player_name: clean(r.participant_name) || clean(r.user_name),
      parent_name: clean(r.user_name) || null, parent_email: clean(r.user_email).toLowerCase() || null,
      source: "playbook", added_by: addedBy, updated_at: new Date().toISOString(),
    };
    // A WHOLE-PROGRAM sign-up is one row: type "Program", start_date the
    // program's first day, end_date "N/A". She is registered for every
    // session, not just the first — reading it as a single date left the
    // seven girls who bought all of Guaranteed to Jump Serve off every roster
    // after week one (and 267 spots club-wide). She goes on each session from
    // the day she signed up; the first keeps the plain registration id so the
    // row an earlier import made is moved rather than duplicated.
    const wholeProgram = /^program$/i.test(clean(r.type)) || /^n\/?a$/i.test(clean(r.end_date));
    if (wholeProgram) {
      const signed = /^(\d{4}-\d{2}-\d{2})/.exec(String(r.date_created || ""))?.[1] || null;
      const from = [date, signed].filter(Boolean).sort().pop() || "0000-00-00";
      const seen = new Set();
      const list = (c.sessions || []).filter(x => x.date && x.date >= from && !seen.has(x.date) && seen.add(x.date))
        .sort((a, b) => a.date.localeCompare(b.date));
      if (!list.length) { noSession.push({ program: c.name, date, player: base.player_name }); continue; }
      list.forEach((s, i) => out.push({ ...base, session_id: String(s.id), source_ref: i === 0 ? String(r.registration_pk) : String(r.registration_pk) + "@" + s.id }));
      continue;
    }
    const s = (c.sessions || []).find(x => x.date === date);
    if (!s) { noSession.push({ program: c.name, date, player: base.player_name }); continue; }
    out.push({ ...base, session_id: String(s.id), source_ref: String(r.registration_pk) });
  }
  const perProgram = {};
  for (const o of out) { const n = clinics.find(x => x.id === o.clinic_id)?.name || "?"; perProgram[n] = (perProgram[n] || 0) + 1; }

  let written = 0, added = 0;
  if (!dry && out.length) {
    // Looked up in batches: a thousand ids in one filter overruns the request
    // and comes back empty, which made every row count as newly added.
    const have = new Set();
    const refs = out.map(o => o.source_ref);
    for (let i = 0; i < refs.length; i += 150) {
      const { data: known } = await supabase.from("dssc_pod_roster").select("source_ref").in("source_ref", refs.slice(i, i + 150));
      (known || []).forEach(k => have.add(k.source_ref));
    }
    added = out.filter(o => !have.has(o.source_ref)).length;
    for (let i = 0; i < out.length; i += 200) {
      const { error: e } = await supabase.from("dssc_pod_roster").upsert(out.slice(i, i + 200), { onConflict: "source_ref" });
      if (e) return { error: "upsert: " + e.message, written };
      written += Math.min(200, out.length - i);
    }
  }
  return {
    ok: true, dry, rows: rows.length, matched: out.length, written, added,
    programs: Object.entries(perProgram).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n })),
    skippedRows: [...skipped.values()].reduce((a, b) => a + b, 0), skippedPrograms: skipped.size,
    noSession,
  };
}
