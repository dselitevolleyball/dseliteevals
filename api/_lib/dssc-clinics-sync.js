// Shared Playbook → dssc_clinics sync logic. Consumed by:
//   • api/dssc-clinic-sync.js  (the one-click bookmarklet endpoint)
//   • scripts/dssc-sync-from-json.mjs  (one-off local seed from extracted JSON)
//
// Input: the raw array from Playbook's FullCalendar `getEvents()`, each item
//   { title, start, end, ext:{ event_type, event_program, event_category,
//     event_teams, contents } } where `contents` is an HTML blob like:
//   "<p>Program Package - <b>Guaranteed to Serve 3-4th</b></p>
//    <p>Category - <b>Volleyball Clinic</b></p>
//    <p>Location - <b>DSSC Warehouse</b></p>
//    <p>Sub Location - <b>Court 2</b></p>"
//
// We keep ONLY volleyball clinics (category matches /volleyball/i), group events
// by program id → one clinic each, and MERGE into dssc_clinics keyed on
// source_ref = program id. The merge is careful: it never clobbers a director's
// work — coach assignments, focus, recap, goals, expectations and the plan all
// survive a re-sync. Only session times/courts refresh, brand-new sessions are
// added, and stale FUTURE unassigned sessions (rescheduled/cancelled in
// Playbook) are pruned. Past sessions are always kept for payroll history.

const field = (html, label) => { const m = new RegExp(label + "\\s*-\\s*<b>(.*?)<\\/b>", "i").exec(html || ""); return m ? m[1].trim() : ""; };
// Wall-clock local time straight off the ISO string (Playbook stores Central
// with an explicit offset, so the HH:MM before the offset is the real clock).
const fmtTime = (iso) => { const m = /T(\d{2}):(\d{2})/.exec(iso || ""); if (!m) return null; let h = +m[1]; const ap = h >= 12 ? "pm" : "am"; let h12 = h % 12; if (h12 === 0) h12 = 12; return h12 + ":" + m[2] + ap; };
const time24 = (iso) => { const m = /T(\d{2}):(\d{2})/.exec(iso || ""); return m ? m[1] + m[2] : "0000"; };
const parseHM = (t) => { const m = /^(\d{1,2}):(\d{2})\s*([ap])m$/i.exec((t || "").trim()); if (!m) return 0; let h = +m[1] % 12; if (/p/i.test(m[3])) h += 12; return h * 60 + +m[2]; };
const ageOf = (name) => { const m = (name || "").match(/K\s*-\s*\d(?:st|nd|rd|th)?(?:\s*grade)?|\d(?:st|nd|rd|th)?\s*[-–]\s*\d(?:st|nd|rd|th)?(?:\s*grade)?|U\s?\d{1,2}(?:\/\d{1,2})?/i); return m ? m[0].replace(/\s+/g, " ").trim() : null; };

// Central-time "today" (YYYY-MM-DD) without pulling a tz lib.
const centralToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

// Turn the raw getEvents() array into { [programId]: {name, category, location, sessions[]} }
export function parsePlaybookEvents(events) {
  const byProg = {};
  for (const e of events || []) {
    const ext = e.ext || e.extendedProps || {};
    const html = ext.contents || "";
    const category = field(html, "Category");
    if (!/volleyball/i.test(category)) continue;            // volleyball clinics only
    const program = String(ext.event_program || "").trim();
    if (!program) continue;
    const start = e.start || e.startStr, end = e.end || e.endStr;
    const date = String(start || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const g = byProg[program] || (byProg[program] = { program, name: field(html, "Program Package") || "Volleyball Clinic", category, location: field(html, "Location") || null, sessions: [] });
    g.sessions.push({ id: "p" + program + "-" + date + "-" + time24(start), date, start_time: fmtTime(start), end_time: fmtTime(end), court: field(html, "Sub Location") || null });
  }
  // de-dupe identical sessions (same id) and sort each program's sessions
  for (const g of Object.values(byProg)) {
    const seen = new Set();
    g.sessions = g.sessions.filter(s => (seen.has(s.id) ? false : seen.add(s.id)));
    g.sessions.sort((a, b) => a.date.localeCompare(b.date) || parseHM(a.start_time) - parseHM(b.start_time));
  }
  return byProg;
}

// Merge one program's incoming sessions with an existing clinic's sessions,
// preserving coach/focus/recap and pruning only stale future-empty sessions.
function mergeSessions(existing, incoming, today) {
  const E = Array.isArray(existing) ? existing : [];
  const used = new Set();
  const keyOf = (s) => s.date + "|" + (s.start_time || "");
  const exByKey = new Map(E.map(s => [keyOf(s), s]));
  const out = [];
  let added = 0;
  for (const inc of incoming) {
    const ex = exByKey.get(keyOf(inc));
    if (ex) { used.add(ex); out.push({ ...ex, end_time: inc.end_time, court: inc.court || ex.court || null }); }
    else { out.push({ id: inc.id, date: inc.date, start_time: inc.start_time, end_time: inc.end_time, court: inc.court || null, coach_name: null, needsCoverage: false }); added++; }
  }
  for (const ex of E) {
    if (used.has(ex)) continue;
    const keep = ex.date < today || ex.coach_name || (ex.focus || "").trim() || (ex.recap || "").trim();
    if (keep) out.push(ex);            // history or hand-entered work — never drop
  }
  out.sort((a, b) => (a.date || "").localeCompare(b.date || "") || parseHM(a.start_time) - parseHM(b.start_time));
  return { sessions: out, added };
}

// Apply the parsed programs to dssc_clinics via the given Supabase client.
// Returns a summary { ok, created, updated, sessionsAdded, clinics:[{name,sessions}] }.
export async function syncClinics(supabase, events, opts = {}) {
  const byProg = parsePlaybookEvents(events);
  const programs = Object.values(byProg);
  const today = centralToday();

  const { data: existingRows, error: exErr } = await supabase.from("dssc_clinics").select("*").eq("source", "playbook");
  if (exErr) throw new Error("read clinics: " + exErr.message);
  const byRef = new Map((existingRows || []).map(r => [String(r.source_ref), r]));

  let created = 0, updated = 0, sessionsAdded = 0;
  const touched = [];

  for (const g of programs) {
    const ex = byRef.get(g.program);
    const merged = ex ? mergeSessions(ex.sessions, g.sessions, today) : { sessions: g.sessions.map(s => ({ ...s, coach_name: null, needsCoverage: false })), added: g.sessions.length };
    sessionsAdded += merged.added;
    const dates = merged.sessions.map(s => s.date).filter(Boolean).sort();
    const first = merged.sessions.find(s => s.date === dates[0]) || merged.sessions[0] || {};
    const common = {
      sessions: merged.sessions,
      category: g.category,
      clinic_date: dates[0] || null,
      end_date: dates[dates.length - 1] || null,
      start_time: first.start_time || null,
      end_time: first.end_time || null,
      source: "playbook",
      source_ref: g.program,
      updated_by: opts.syncedBy || "playbook-sync",
      updated_at: new Date().toISOString(),
    };
    if (ex) {
      const patch = { ...common };
      if (!(ex.age_group || "").trim()) patch.age_group = ageOf(g.name);   // fill only if empty
      const { error } = await supabase.from("dssc_clinics").update(patch).eq("id", ex.id);
      if (error) throw new Error("update " + g.program + ": " + error.message);
      updated++;
    } else {
      const { error } = await supabase.from("dssc_clinics").insert({
        ...common, name: g.name, age_group: ageOf(g.name), location: g.location,
        kind: "clinic", status: "scheduled", created_by: opts.syncedBy || "playbook-sync",
      });
      if (error) throw new Error("insert " + g.program + ": " + error.message);
      created++;
    }
    touched.push({ program: g.program, name: ex ? ex.name : g.name, sessions: merged.sessions.length });
  }

  // record sync state (best-effort; table may not exist on very old dbs)
  try {
    await supabase.from("dssc_sync").upsert({ id: 1, last_synced_at: new Date().toISOString(), synced_by: opts.syncedBy || null, summary: { created, updated, sessionsAdded, programs: touched.length } }, { onConflict: "id" });
  } catch { /* non-fatal */ }

  return { ok: true, created, updated, sessionsAdded, clinics: touched, programs: touched.length };
}
