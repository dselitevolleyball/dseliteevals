import { appOrigin } from "../../shared/app-origin.js";
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
    const program = String(ext.event_program || "").trim();
    if (!program) continue;
    // Volleyball only — DSSC runs other sports out of the same calendar. Matched
    // on the category OR the program/package name, because the adult programs
    // are filed under categories that don't carry the word (an "Adult League"
    // category, say), and category-only silently dropped the Womens Adult
    // Volleyball Academy — it never reached the app no matter how often the
    // sync was run.
    const pkg = field(html, "Program Package");
    if (!/volleyball/i.test(category + " " + pkg)) continue;
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
// `window` is the date span the bookmarklet actually had on screen. The
// Playbook calendar only hands over the visible range, so a session outside it
// is not "gone from Playbook" — it simply wasn't in view. Syncing October used
// to delete every unstaffed November class added by the previous sync.
function mergeSessions(existing, incoming, today, window) {
  const inView = (d) => !!window && d >= window.min && d <= window.max;
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
  const removed = [];
  for (const ex of E) {
    if (used.has(ex)) continue;
    // Playbook is the system of record. A future session inside the synced
    // window that Playbook no longer lists was cancelled or moved there, so it
    // goes here too — even when a coach was on it. Those are reported back so
    // the director can tell the coach. History (past dates) is never touched,
    // and neither is anything outside the dates the calendar had on screen.
    if (ex.date < today || !inView(ex.date)) { out.push(ex); continue; }
    removed.push(ex);
  }
  out.sort((a, b) => (a.date || "").localeCompare(b.date || "") || parseHM(a.start_time) - parseHM(b.start_time));
  return { sessions: out, added, removed };
}

// Apply the parsed programs to dssc_clinics via the given Supabase client.
// Returns a summary { ok, created, updated, sessionsAdded, clinics:[{name,sessions}] }.
export async function syncClinics(supabase, events, opts = {}) {
  const byProg = parsePlaybookEvents(events);
  const programs = Object.values(byProg);
  // The prune window. The hourly pull says exactly what dates it asked
  // Playbook for; the bookmarklet can't, so its window is inferred from the
  // volleyball sessions it found (and is null — no pruning — when it found none).
  const dates = programs.flatMap(p => p.sessions.map(x => x.date)).filter(Boolean).sort();
  const window = opts.window || (dates.length ? { min: dates[0], max: dates[dates.length - 1] } : null);
  const today = centralToday();

  const { data: existingRows, error: exErr } = await supabase.from("dssc_clinics").select("*").eq("source", "playbook");
  if (exErr) throw new Error("read clinics: " + exErr.message);
  const byRef = new Map((existingRows || []).map(r => [String(r.source_ref), r]));

  let created = 0, updated = 0, sessionsAdded = 0;
  const touched = [];
  const removed = [];   // [{ clinic, session }] — future classes Playbook no longer lists

  for (const g of programs) {
    const ex = byRef.get(g.program);
    const merged = ex ? mergeSessions(ex.sessions, g.sessions, today, window) : { sessions: g.sessions.map(s => ({ ...s, coach_name: null, needsCoverage: false })), added: g.sessions.length };
    sessionsAdded += merged.added;
    for (const x of (merged.removed || [])) removed.push({ clinic: ex, session: x });
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

  // A program that has no events at all in the synced window is still subject
  // to the same rule: whatever it had scheduled in that window is gone from
  // Playbook, so it goes here too.
  const seen = new Set(programs.map(g => g.program));
  for (const ex of (existingRows || [])) {
    if (seen.has(String(ex.source_ref))) continue;
    const merged = mergeSessions(ex.sessions, [], today, window);
    if (!merged.removed.length) continue;
    for (const x of merged.removed) removed.push({ clinic: ex, session: x });
    const { error } = await supabase.from("dssc_clinics").update({ sessions: merged.sessions, updated_by: opts.syncedBy || "playbook-sync", updated_at: new Date().toISOString() }).eq("id", ex.id);
    if (error) throw new Error("prune " + ex.name + ": " + error.message);
    updated++;
  }

  // Registrations for a class that no longer exists would keep it looking
  // populated on the admin board; Playbook has dropped those too.
  for (const r of removed) {
    await supabase.from("dssc_pod_roster").delete().eq("clinic_id", r.clinic.id).eq("session_id", String(r.session.id));
  }
  const staffedRemovals = removed.filter(r => (r.session.coach_name && String(r.session.coach_name).trim()) || (Array.isArray(r.session.staff) && r.session.staff.some(x => x.status !== "declined")));
  if (staffedRemovals.length) await tellDirectors(staffedRemovals);

  // record sync state (best-effort; table may not exist on very old dbs)
  try {
    await supabase.from("dssc_sync").upsert({ id: 1, last_synced_at: new Date().toISOString(), synced_by: opts.syncedBy || null, summary: { created, updated, sessionsAdded, sessionsRemoved: removed.length, programs: touched.length } }, { onConflict: "id" });
  } catch { /* non-fatal */ }

  return { ok: true, created, updated, sessionsAdded, sessionsRemoved: removed.length,
    removed: removed.map(r => ({ program: r.clinic.name, date: r.session.date, start_time: r.session.start_time, coaches: crewNames(r.session) })),
    clinics: touched, programs: touched.length };
}

const crewNames = (s) => [...new Set([s.coach_name, ...((Array.isArray(s.staff) ? s.staff : []).filter(x => x.status !== "declined").map(x => x.name))].map(v => String(v || "").trim()).filter(Boolean))];

// Push + email Hunter and Drew when a class a coach was on has disappeared
// from Playbook, so somebody tells the coach before they turn up to it.
async function tellDirectors(list) {
  const to = ["hunterhaleysc10@gmail.com", "hunter@drippingsportsclub.com", "drew@dselitevolleyball.com"];
  const origin = appOrigin(null);
  const fmt = (d) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Chicago" });
  const lines = list.map(r => `• ${r.clinic.name} — ${fmt(r.session.date)} ${r.session.start_time || ""} — was staffed by ${crewNames(r.session).join(", ")}`);
  const body = `Playbook no longer lists ${list.length === 1 ? "this class" : "these classes"}, so ${list.length === 1 ? "it has" : "they have"} been removed from DSSC HQ. The coaches were on them — please let them know:\n\n${lines.join("\n")}\n\nIf Playbook is wrong, add the class back there and sync again.`;
  try {
    await fetch(origin + "/api/send-push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skipEmail: true, title: "Playbook removed " + list.length + " staffed class" + (list.length === 1 ? "" : "es"), body: lines[0].slice(2, 110), url: "/?view=clinics", audience: { type: "emails", emails: to } }) });
    await fetch(origin + "/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skipPush: true, subject: "Playbook removed " + list.length + " staffed DSSC class" + (list.length === 1 ? "" : "es"), body, recipients: to, sentBy: "Playbook sync", source: "dssc-clinic-sync" }) });
  } catch { /* the sync itself already succeeded */ }
}
