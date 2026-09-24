// DSSC clinic helpers shared by App.jsx and the coach hub (src/dssc/).
// Moved out of App.jsx so the hub doesn't have to import the 30k-line app.

export const TN_SUB_PLACEHOLDERS = new Set(["tbd", "tba", "t.b.d.", "?", "??", "???", "-", "--", "—", "n/a", "na", "none", "pending", "sub", "open", "needed", "?tbd"]);

// Slot names that aren't people: "13-1 Assistant Coach", "Tournament Floater
// Coach". Mirrors the test in api/gear-reminders.js.
export const isPlaceholderPerson = (s) => {
  const v = String(s || "").trim();
  return !v || TN_SUB_PLACEHOLDERS.has(v.toLowerCase()) || /new coach|floater coach|assistant coach$/i.test(v);
};

// --- DSSC clinic staffing -------------------------------------------------
// A session's crew lives in dssc_clinics.sessions[].staff. Sessions written
// before staffing existed only carry coach_name, so read that as an approved
// lead rather than showing them as unstaffed — 31 real assignments depend on it.
// The crew is Playbook's own instructor (coach_name) PLUS whoever the director
// added in the app (staff[]) — not one or the other. The lead is listed first
// and counts as approved, unless they already appear in staff[] — in which
// case that entry wins, so a lead who declined or is pending stays that way.
export function sessionStaff(s) {
  const list = Array.isArray(s?.staff) ? s.staff : [];
  const nm = String(s?.coach_name || "").trim();
  if (!nm || isPlaceholderPerson(nm)) return list;
  const k = (v) => String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (list.some(x => k(x?.name) === k(nm))) return list;
  return [{ name: nm, role: "lead", status: "approved" }, ...list];
}
export function staffNeeded(s, clinic) { return Math.max(1, Number(s?.coaches_needed ?? clinic?.coaches_needed ?? 1) || 1); }
export const staffApproved = (s) => sessionStaff(s).filter(x => x.status === "approved");
export const staffPending  = (s) => sessionStaff(s).filter(x => x.status === "pending");
export const sessionShort  = (s, clinic) => Math.max(0, staffNeeded(s, clinic) - staffApproved(s).length);
export const onStaff = (s, matches) => sessionStaff(s).some(x => x.status !== "declined" && matches(x.name));

// A clinic plan pasted from a doc or spreadsheet, turned into session blocks.
//
// Drew plans in a table — "0–10 | 🏈 Football Throwing Warm-Up | Start close…"
// — one row per segment, columns separated by tabs (pasted from Sheets/Docs),
// pipes, or two-plus spaces. The time column can be a range ("35–47", "0-10")
// or a plain minute count ("12"). A title row and a "Time / Segment / Focus"
// header row are skipped, and a row with no time and no second column is
// treated as a continuation of the previous block's notes.
export function parsePlanPaste(text) {
  const rows = String(text || "").replace(/\r/g, "").split("\n").map(l => l.replace(/\s+$/, "")).filter(l => l.trim());
  const split = (l) => {
    if (l.includes("\t")) return l.split("\t").map(s => s.trim());
    if (/\s\|\s/.test(l)) return l.split(/\s\|\s/).map(s => s.trim());
    return l.split(/\s{2,}/).map(s => s.trim());
  };
  const range = (s) => { const m = /^(\d+)\s*[–—-]\s*(\d+)$/.exec(String(s || "").trim()); return m ? [+m[1], +m[2]] : null; };
  const blocks = [];
  for (const line of rows) {
    const cols = split(line).filter(c => c !== "");
    if (!cols.length) continue;
    const first = cols[0];
    if (/^time$/i.test(first) && cols.length >= 2) continue;                     // header row
    const r = range(first);
    const plain = /^\d+$/.test(first) ? +first : null;
    if (r || plain != null) {
      const minutes = r ? Math.max(0, r[1] - r[0]) : plain;
      const name = (cols[1] || "").trim();
      const desc = cols.slice(2).join(" · ").trim();
      if (!name) continue;
      blocks.push({ id: Math.random().toString(36).slice(2, 10), name, minutes, desc, at: r ? r[0] : null });
    } else if (blocks.length && cols.length === 1) {
      // Wrapped text from the previous row's Focus column.
      const b = blocks[blocks.length - 1];
      b.desc = (b.desc ? b.desc + " " : "") + first;
    }
    // Anything else (a title line, a stray label) is skipped.
  }
  return blocks.map(({ at, ...b }) => b);
}

// "9am" / "9:30 am" / "3pm" → hours since midnight (9, 9.5, 15); null if unreadable.
export const parseClock = (t) => { const m = /(\d+)(?::(\d+))?\s*(am|pm)/i.exec(t || ""); if (!m) return null; let h = +m[1] % 12; if (/pm/i.test(m[3])) h += 12; return h + (m[2] ? +m[2] / 60 : 0); };
// Paid hours for a session — quarter-hour rounded, never under half an hour, 1h when unreadable.
export const sessionHours = (s) => { const a = parseClock(s.start_time), b = parseClock(s.end_time); return (a != null && b != null) ? Math.max(0.5, Math.round((b - a) * 4) / 4) : 1; };
export const localDateISO = (d) => { const x = d ? new Date(d) : new Date(); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
