// DS Elite Time Cards: asking a coach who was expected but didn't clock in
// whether they worked (Drew, Oct 27 2026). The text says "Reply YES or NO, or
// tap to answer", and either way the answer lands where the admin buttons
// would have put it:
//   yes -> a coach_checkins row, like "+ Was there" (hours from the slot)
//   no  -> a practice_coverage row, like "Called out" (no cover recorded)
// so the coach drops off "Expected but didn't clock in". Hours still wait for
// the week's "Approve & email hours" like any other check-in.

import crypto from "node:crypto";
import { sendOneSms, normalizePhone } from "./sms.js";

export const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

// The same readings the app uses for clock-in (src/App.jsx parseSlotClock /
// slotHours / PHASE_DATES), so a text answer logs what "+ Was there" would.
function parseSlotClock(part) {
  const m = String(part || "").trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = parseInt(m[1], 10), min = m[2] ? parseInt(m[2], 10) : 0;
  if (h < 1 || h > 12 || min > 59) return null;
  const h24 = h === 12 ? 12 : (h >= 9 && h <= 11 ? h : h + 12);
  return h24 * 60 + min;
}
export function slotHours(slot) {
  const m = /^\s*(\d{1,2}(?::\d{2})?)\s*-\s*(\d{1,2}(?::\d{2})?)\s*(am|pm)?\s*$/i.exec(slot || "");
  if (!m) return 0;
  let start = parseSlotClock(m[1]), end = parseSlotClock(m[2]);
  if (start == null || end == null) return 0;
  if (m[3]) {
    const pm = /p/i.test(m[3]);
    const fix = (mins, wantPm) => { const h = Math.floor(mins / 60) % 12; return (wantPm ? h + 12 : h) * 60 + (mins % 60); };
    end = fix(end, pm); start = fix(start, pm);
    if (start >= end) start = fix(start, !pm);
  }
  return Math.max(0, Math.round((end - start) / 6) / 10);
}
const PHASE_DATES = [
  { id: "summer", from: "2026-07-12", to: "2026-09-12" },
  { id: "fall1", from: "2026-09-13", to: "2026-10-11" },
  { id: "fall2", from: "2026-10-18", to: "2026-11-15" },
  { id: "season", from: "2026-12-01", to: "2027-05-06" },
  { id: "postseason", from: "2027-05-07", to: "2027-06-15" },
];
export const phaseForDate = (iso) => PHASE_DATES.find(p => iso >= p.from && iso <= p.to)?.id || null;

// What people read: "12 Rise", not "12 Rise 1" (CLAUDE.md); "Mon 10/26".
export const teamLabel = (t) => String(t || "").replace(/^(\d+ Rise) 1$/, "$1");
export const dayLabel = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "UTC" });
export const shiftLabel = (s) => `${teamLabel(s.team)}, ${dayLabel(s.date)}${s.slot ? ", " + s.slot : ""}`;

export const newToken = () => crypto.randomBytes(9).toString("base64url");
export const linkFor = (origin, token) => `${origin}/api/shift-confirm?t=${token}`;

export function askText(shifts, link) {
  if (shifts.length === 1) {
    const s = shifts[0];
    return `Hi {first}, DS Elite has you on the schedule for ${teamLabel(s.team)} practice ${dayLabel(s.date)}${s.slot ? ", " + s.slot : ""}, but no clock-in. Did you work it? Reply YES or NO, or tap to answer: ${link}`;
  }
  return `Hi {first}, DS Elite has you on the schedule but not clocked in for:\n${shifts.map(s => "- " + shiftLabel(s)).join("\n")}\nDid you work them? Reply YES (worked all) or NO (missed all), or tap to answer each one: ${link}`;
}

// A short reply that starts with yes / no. Anything longer or unclear is left
// for a person to read in the inbox.
export function readYesNo(body) {
  const t = norm(body).replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim();
  if (!t || t.length > 60) return null;
  if (/^(no (worries|problem|prob|biggie)|yes (please|and)|nope not yet)\b/.test(t)) return null;
  if (/^(y|yes|yeah|yea|yep|yup|ya|yes ma'?am|yes sir|i did|i worked|worked|si)\b/.test(t)) return "yes";
  if (/^(n|no|nope|nah|i did not|i didn'?t|didn'?t|did not)\b/.test(t)) return "no";
  return null;
}

// The coach's phone from the coach roster, matched on the name Time Cards shows.
export async function phoneForCoach(sb, coachName) {
  const { data: roster } = await sb.from("coach_roster").select("first_name, last_name, phone");
  const want = norm(String(coachName || "").replace(/^\s*coach\s+/i, ""));
  const full = (r) => norm(`${r.first_name || ""} ${r.last_name || ""}`);
  const withPhone = (roster || []).filter(r => r.phone);
  let hit = withPhone.find(r => full(r) === want);
  if (!hit) {
    const t = want.split(" "), first = t[0], last = t[t.length - 1];
    const sameLast = withPhone.filter(r => norm(r.last_name) === last && (norm(r.first_name).startsWith(first) || first.startsWith(norm(r.first_name))));
    if (sameLast.length === 1) hit = sameLast[0];
    else { const sameFirst = withPhone.filter(r => norm(r.first_name) === first); if (t.length === 1 && sameFirst.length === 1) hit = sameFirst[0]; }
  }
  return hit ? { phone: normalizePhone(hit.phone), name: `${hit.first_name || ""} ${hit.last_name || ""}`.trim() } : null;
}

// The newest unanswered ask to this number in the last 10 days.
export async function openAskFor(sb, phone) {
  const d10 = String(phone || "").replace(/\D/g, "").slice(-10);
  if (d10.length !== 10) return null;
  const since = new Date(Date.now() - 10 * 86400000).toISOString();
  const { data } = await sb.from("shift_confirms").select("*").eq("status", "sent").like("phone", "%" + d10).gte("sent_at", since).order("sent_at", { ascending: false }).limit(1);
  return data?.[0] || null;
}

// answers: { [index]: "yes" | "no" } for shifts not answered yet.
// Returns { row, worked: [shift], missed: [shift] }.
export async function applyAnswers(sb, row, answers, { via, replyText = null } = {}) {
  const now = new Date().toISOString();
  const shifts = (row.shifts || []).map(s => ({ ...s }));
  const worked = [], missed = [];
  for (const [k, a] of Object.entries(answers || {})) {
    const s = shifts[Number(k)];
    if (!s || s.answer || !["yes", "no"].includes(a)) continue;
    if (a === "yes") {
      // Not twice: an admin may have logged it already.
      const { data: have } = await sb.from("coach_checkins").select("id, coach_name").eq("check_date", s.date).eq("team_name", s.team);
      if (!(have || []).some(c => norm(c.coach_name) === norm(row.coach_name))) {
        const { error } = await sb.from("coach_checkins").insert({
          coach_name: row.coach_name, check_date: s.date, team_name: s.team, slot: s.slot || null, hours: slotHours(s.slot) || 2,
          role: "scheduled", status: "present", source: via === "sms" ? "sms" : "link", phase: phaseForDate(s.date) || "none", paid: false,
          note: via === "sms" ? `Confirmed by text: "${String(replyText || "").slice(0, 80)}"` : "Confirmed from the text's link",
          created_by: `${row.coach_name} (${via === "sms" ? "text reply" : "text link"})`,
        });
        if (error) throw new Error("Couldn't log the shift: " + error.message);
      }
      worked.push(s);
    } else {
      await sb.from("practice_coverage").delete().eq("practice_date", s.date).eq("team_name", s.team).eq("coach_out", row.coach_name);
      const { error } = await sb.from("practice_coverage").insert({
        practice_date: s.date, team_name: s.team, slot: s.slot || null, phase: phaseForDate(s.date) || "season", coach_out: row.coach_name, sub_name: null,
        note: via === "sms" ? `Said by text they didn't work${replyText && norm(replyText).length > 3 ? `: "${String(replyText).slice(0, 80)}"` : ""}` : "Said from the text's link they didn't work",
      });
      if (error) throw new Error("Couldn't record the absence: " + error.message);
      missed.push(s);
    }
    s.answer = a; s.at = now;
  }
  const done = shifts.every(s => s.answer);
  const patch = { shifts, answered_via: via, answered_at: now, ...(replyText ? { reply_text: String(replyText).slice(0, 300) } : {}), ...(done ? { status: "answered" } : {}) };
  const { data } = await sb.from("shift_confirms").update(patch).eq("id", row.id).select("*").single();
  return { row: data || { ...row, ...patch }, worked, missed };
}

export const thanksText = ({ worked, missed }) => [
  worked.length ? `logged ${worked.reduce((h, s) => h + (slotHours(s.slot) || 2), 0)}h for ${worked.map(shiftLabel).join("; ")}` : "",
  missed.length ? `noted you didn't work ${missed.map(shiftLabel).join("; ")}` : "",
].filter(Boolean).join(", and ");

// Called by the SMS webhook for every inbound DS Elite text. Returns true when
// the text was an answer (and the coach has been texted back).
export async function handleShiftReply(sb, phone, body) {
  const a = readYesNo(body);
  if (!a) return false;
  const row = await openAskFor(sb, phone);
  if (!row) return false;
  const answers = Object.fromEntries((row.shifts || []).map((s, i) => [i, s.answer ? null : a]).filter(([, v]) => v));
  const r = await applyAnswers(sb, row, answers, { via: "sms", replyText: body });
  const msg = thanksText(r);
  if (msg) await sendOneSms(sb, { to: normalizePhone(phone), brand: "dse", name: row.coach_name, kind: "coach" }, `Thanks {first} - ${msg}.`, { sent_by_label: "Time Cards (auto)" }).catch(e => console.error("shift reply thanks failed", e.message));
  return true;
}
