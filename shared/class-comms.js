// Class comms (Drew, Oct 28 2026, for Hunter): "how many classes are getting
// comms before and/or after the class regarding what we are working on, focus,
// practice-at-home ideas... which coaches are performing these tasks on time".
//
// Worked out from what HQ already records, nothing for coaches to log:
//   dssc_clinics.sessions     each class: date, start time, staff (lead/assist), recap
//   dssc_class_messages       each message a coach sent a class's families
//                             (api/dssc-class-message.js), with who and when
// A message counts as "before" if it went out before the class started
// (Central time) and "after" if it went out once it had started. The class
// belongs to its lead coach (the approved lead, else the only coach on it).
// Shared by src/dssc/ClassComms.jsx and the morning Slack digest (api/tasks-daily.js).

const TZ = "America/Chicago";
// "6:00pm" / "18:00" -> "18:00"
export function clock24(t) {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?\s*$/i.exec(String(t || ""));
  if (!m) return "00:00";
  let h = +m[1]; const min = m[2] || "00", ap = (m[3] || "").toLowerCase();
  if (ap === "p" && h < 12) h += 12;
  if (ap === "a" && h === 12) h = 0;
  return String(h).padStart(2, "0") + ":" + min;
}
// A timestamp as "YYYY-MM-DD HH:MM" in Central time, comparable as a string.
export const centralStamp = (iso) => new Date(iso).toLocaleString("sv-SE", { timeZone: TZ, hour12: false }).slice(0, 16);
export const centralToday = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const nrm = (v) => String(v || "").trim().toLowerCase();

export function leadOf(c, s) {
  const staff = (Array.isArray(s.staff) ? s.staff : []).filter(x => x && x.status !== "declined" && x.name);
  const lead = staff.find(x => x.role === "lead") || (staff.length === 1 ? staff[0] : null) || staff[0];
  return (lead && lead.name) || s.coach_name || c.coach_name || "No coach set";
}

// One row per class held between from and to (inclusive) - not cancelled, and
// already started by `now` ("YYYY-MM-DD HH:MM", Central).
export function classRows({ clinics = [], messages = [], from, to, sport = "", now }) {
  const bySession = new Map();
  for (const m of messages) {
    const k = m.clinic_id + "|" + m.session_id;
    if (!bySession.has(k)) bySession.set(k, []);
    bySession.get(k).push(m);
  }
  const rows = [];
  for (const c of clinics) {
    if (sport && (c.sport || "volleyball") !== sport) continue;
    for (const s of Array.isArray(c.sessions) ? c.sessions : []) {
      if (!s || !s.date || s.cancelled || s.date < from || s.date > to) continue;
      const start = s.date + " " + clock24(s.start_time);
      if (now && start > now) continue;
      const msgs = (bySession.get(c.id + "|" + s.id) || []).map(m => ({ ...m, at: centralStamp(m.created_at) })).sort((a, b) => a.at.localeCompare(b.at));
      const lead = leadOf(c, s);
      const before = msgs.filter(m => m.at < start), after = msgs.filter(m => m.at >= start);
      rows.push({
        clinicId: c.id, sessionId: s.id, name: c.name, sport: c.sport || "volleyball", date: s.date, startTime: s.start_time, start,
        lead, before: before.length > 0, after: after.length > 0, recap: !!String(s.recap || "").trim(),
        messages: msgs, byLead: msgs.some(m => nrm(m.sent_by) === nrm(lead)),
        state: before.length && after.length ? "both" : before.length || after.length ? "one" : "none",
      });
    }
  }
  return rows.sort((a, b) => b.start.localeCompare(a.start));
}

// Per lead coach: classes, both / one / none, before, after, recap, sent by the coach themself.
export function coachStats(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = nrm(r.lead);   // "Mia de la Rosa" and "Mia De la Rosa" are one coach
    if (!m.has(k)) m.set(k, { coach: r.lead, classes: 0, both: 0, one: 0, none: 0, before: 0, after: 0, recap: 0, byLead: 0 });
    const x = m.get(k);
    x.classes++; x[r.state]++; if (r.before) x.before++; if (r.after) x.after++; if (r.recap) x.recap++; if (r.byLead) x.byLead++;
  }
  const pct = (x) => (x.classes ? (x.both + x.one) / x.classes : 0);
  return [...m.values()].sort((a, b) => pct(b) - pct(a) || b.classes - a.classes || a.coach.localeCompare(b.coach));
}

// Classes and messaged classes per week (Monday start), oldest first.
export function weeklyStats(rows) {
  const monday = (ymd) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  const m = new Map();
  for (const r of rows) {
    const w = monday(r.date);
    if (!m.has(w)) m.set(w, { week: w, classes: 0, messaged: 0, before: 0, after: 0 });
    const x = m.get(w); x.classes++; if (r.state !== "none") x.messaged++; if (r.before) x.before++; if (r.after) x.after++;
  }
  return [...m.values()].sort((a, b) => a.week.localeCompare(b.week));
}

export const totals = (rows) => ({
  classes: rows.length,
  messaged: rows.filter(r => r.state !== "none").length,
  before: rows.filter(r => r.before).length,
  after: rows.filter(r => r.after).length,
  both: rows.filter(r => r.state === "both").length,
  recap: rows.filter(r => r.recap).length,
});
