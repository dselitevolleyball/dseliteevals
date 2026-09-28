// Saturday: every coach gets her week ahead — text and app notification —
// listing each shift, what she's covering for someone else, and what she is
// NOT working because someone is covering her (and who).
//
// Built from the same facts the clock-in screen uses: practice_assignments by
// phase and weekday, the team's head/assistant/third coach, S&A sessions,
// floats, orientation nights, minus cancellations, minus her call-outs
// (practice_coverage.coach_out and approved time-off), plus the practices she
// was named as the sub on. Back-to-back hours with the same team merge into
// one block, as on the clock-in screen.
//
// Auth: Vercel Cron `Authorization: Bearer <CRON_SECRET>` (or ?token=), the
// service-role key as bearer (operator script), or a signed-in owner/admin.
// Query: ?test=1 (Drew only)  ?dry=1 (list, send nothing)  ?week=YYYY-MM-DD
//        (the Sunday to start from; default next Sunday)  ?channels=sms,push
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET (+ Twilio for SMS).

import { createClient } from "@supabase/supabase-js";
import { appOrigin } from "../shared/app-origin.js";
import { sendOneSms, normalizePhone, twilioReady } from "./_lib/sms.js";

const OWNERS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];
const DREW = { name: "Drew Rose", email: "drew@dselitevolleyball.com", phone: "+15122029099" };
const PHASE_DATES = [
  { id: "summer", from: "2026-07-12", to: "2026-09-12" },
  { id: "fall1", from: "2026-09-13", to: "2026-10-11" },
  { id: "fall2", from: "2026-10-18", to: "2026-11-15" },
  { id: "season", from: "2026-12-01", to: "2027-05-06" },
  { id: "postseason", from: "2027-05-07", to: "2027-06-15" },
];
const phaseForDate = (iso) => { const p = PHASE_DATES.find(p => iso >= p.from && iso <= p.to); return p ? p.id : null; };
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekdayOf = (iso) => WD[new Date(iso + "T12:00:00Z").getUTCDay()];
const centralToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const isPlaceholder = (nm) => /assistant coach|head coach|tbd|coach needed|floater/i.test(nm || "");
const fmtD = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "UTC" });
const fmtRange = (a, b) => { const A = new Date(a + "T12:00:00Z"), B = new Date(b + "T12:00:00Z"); const o = { month: "short", day: "numeric", timeZone: "UTC" }; return A.toLocaleDateString("en-US", o) + "–" + B.toLocaleDateString("en-US", A.getUTCMonth() === B.getUTCMonth() ? { day: "numeric", timeZone: "UTC" } : o); };

// Slot → [start, end] in hours, reading the am/pm off the end like the app.
const span = (sl) => {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(sl || "");
  if (!m) return [99, 99];
  let s = +m[1] + (+(m[2] || 0)) / 60, e = +m[3] + (+(m[4] || 0)) / 60;
  const h24 = (h) => (h === 12 ? 12 : h >= 9 && h <= 11 ? h : h + 12);
  if (m[5]) { const pm = /p/i.test(m[5]); const fx = (h, p) => (h % 12) + (p ? 12 : 0); e = fx(e, pm); s = fx(s, pm); if (s >= e) s = fx(s, !pm); }
  else { s = h24(Math.floor(s)) + (s % 1); e = h24(Math.floor(e)) + (e % 1); }
  return [s, e];
};
const hr12 = (h) => { const w = Math.floor(h), mm = Math.round((h - w) * 60); const x = w % 12 === 0 ? 12 : w % 12; return x + (mm ? ":" + String(mm).padStart(2, "0") : ""); };
const slotOf = (s, e) => hr12(s) + "-" + hr12(e) + (e >= 12 ? "pm" : "am");
const hoursOf = (sl) => { const [s, e] = span(sl); return e > s && s < 99 ? Math.round((e - s) * 10) / 10 : 0; };

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const url = (() => { try { return new URL(req.url, "https://x"); } catch { return null; } })();
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  let who = "cron";
  const ok0 = (CRON_SECRET && (bearer === CRON_SECRET || (url?.searchParams.get("token") || "") === CRON_SECRET)) || (bearer && bearer === SUPABASE_SERVICE_ROLE_KEY);
  if (bearer && bearer === SUPABASE_SERVICE_ROLE_KEY) who = "operator";
  if (!ok0) {
    if (!bearer) return res.status(401).json({ error: "Not signed in" });
    const { data: { user } = {} } = await sb.auth.getUser(bearer).catch(() => ({ data: {} }));
    const email = (user?.email || "").trim().toLowerCase();
    if (!email) return res.status(401).json({ error: "Not signed in" });
    let ok = OWNERS.includes(email);
    if (!ok) { const { data: c } = await sb.from("coaches").select("is_admin, is_approved").ilike("email", email).maybeSingle(); ok = !!(c && c.is_approved && c.is_admin); }
    if (!ok) return res.status(403).json({ error: "Admins only" });
    who = email;
  }
  const test = url?.searchParams.get("test") === "1", dry = url?.searchParams.get("dry") === "1";
  const want = new Set(String(url?.searchParams.get("channels") || "sms,push").split(",").map(x => x.trim()).filter(Boolean));
  // The week: the Sunday on or after today (a Saturday send is about tomorrow's week).
  const today = centralToday();
  const start = /^\d{4}-\d{2}-\d{2}$/.test(url?.searchParams.get("week") || "") ? url.searchParams.get("week") : addDays(today, (7 - new Date(today + "T12:00:00Z").getUTCDay()) % 7);
  const end = addDays(start, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  const [{ data: teams }, { data: assigns }, { data: sas }, { data: floats }, { data: cover }, { data: reqs }, { data: cancels }, { data: nights }, { data: roster }, { data: accounts }] = await Promise.all([
    sb.from("practice_teams").select("team_name, head_coach, assistant_coach, third_coach, practices_per_week"),
    sb.from("practice_assignments").select("team_name, phase, day, slot"),
    sb.from("sa_sessions").select("team_name, session_date, slot").gte("session_date", start).lte("session_date", end),
    sb.from("coach_floats").select("coach_name, day, slot, phase"),
    sb.from("practice_coverage").select("practice_date, team_name, slot, coach_out, sub_name, combine_with_team, note").gte("practice_date", start).lte("practice_date", end),
    sb.from("coach_requests").select("coach_name, request_date, team_name, status").gte("request_date", start).lte("request_date", end),
    sb.from("practice_cancellations").select("practice_date, team_name").gte("practice_date", start).lte("practice_date", end),
    sb.from("orientation_nights").select("night_date, label, ages, teams, start_time, end_time, cancelled").gte("night_date", start).lte("night_date", end),
    sb.from("coach_roster").select("first_name, last_name, email, phone"),
    sb.from("coaches").select("display_name, email"),
  ]);

  // Who is who: every spelling of a coach → one roster identity (email is the key).
  const people = new Map();   // email → { name, email, phone, keys:Set }
  const keyOf = new Map();    // normalised name variant → email
  for (const r of roster || []) {
    const email = norm(r.email); if (!email) continue;
    const f = norm(r.first_name), l = norm(r.last_name), full = (f + " " + l).trim();
    if (!full || isPlaceholder(full)) continue;
    const p = { name: `${r.first_name || ""} ${r.last_name || ""}`.trim(), first: (r.first_name || "").trim(), email, phone: normalizePhone(r.phone), keys: new Set([full, f, l ? f + " " + l[0] : ""]) };
    people.set(email, p); for (const k of p.keys) if (k) keyOf.set(k, email);
  }
  for (const a of accounts || []) { const email = norm(a.email); const p = people.get(email); if (p && a.display_name) { keyOf.set(norm(a.display_name), email); } }
  // "Kelli R Hardge" ↔ "Kelli Hardge": drop a middle initial.
  const emailFor = (raw) => { const n = norm(raw); if (!n) return null; if (keyOf.has(n)) return keyOf.get(n); const parts = n.split(" "); if (parts.length >= 3) { const alt = parts[0] + " " + parts[parts.length - 1]; if (keyOf.has(alt)) return keyOf.get(alt); } if (keyOf.has(parts[0])) return keyOf.get(parts[0]); return null; };

  const eventTeams = new Set((teams || []).filter(t => t.practices_per_week != null && Number(t.practices_per_week) === 0).map(t => t.team_name));
  const cancelledDay = (d) => (cancels || []).some(c => c.practice_date === d && !c.team_name);
  const cancelledTeam = (d, t) => (cancels || []).some(c => c.practice_date === d && c.team_name === t);
  const outRows = (d, t, email) => (cover || []).filter(c => c.practice_date === d && (!t || c.team_name === t) && emailFor(c.coach_out) === email);
  const offReq = (d, t, email) => (reqs || []).some(r => r.request_date === d && !/denied|declined|rejected/i.test(r.status || "") && emailFor(r.coach_name) === email && (!r.team_name || !t || r.team_name === t));

  // Every shift for every coach in the week: { email, date, team, slot, role, note }.
  const shifts = [];
  for (const d of days) {
    const ph = phaseForDate(d); const wd = weekdayOf(d);
    if (cancelledDay(d)) continue;
    const blocks = [];   // scheduled team hours, merged later per coach
    if (ph) for (const a of assigns || []) {
      if ((a.phase || "season") !== ph || a.day !== wd || eventTeams.has(a.team_name) || cancelledTeam(d, a.team_name)) continue;
      blocks.push({ team: a.team_name, slot: a.slot, sa: false });
    }
    for (const s of sas || []) if (s.session_date === d && !cancelledTeam(d, s.team_name)) blocks.push({ team: s.team_name, slot: s.slot, sa: true });
    for (const b of blocks) {
      const t = (teams || []).find(x => x.team_name === b.team);
      for (const raw of [t?.head_coach, t?.assistant_coach, t?.third_coach]) {
        if (!raw || isPlaceholder(raw)) continue;
        const email = emailFor(raw); if (!email) continue;
        const outs = outRows(d, b.team, email);
        if (outs.length) { const o = outs[0]; shifts.push({ email, date: d, team: b.team, slot: b.slot, role: "out", cover: o.sub_name || (o.combine_with_team ? "combined with " + o.combine_with_team : null), note: o.note }); continue; }
        if (offReq(d, b.team, email)) { shifts.push({ email, date: d, team: b.team, slot: b.slot, role: "out", cover: null, note: "time off" }); continue; }
        shifts.push({ email, date: d, team: b.team, slot: b.slot, role: "scheduled", sa: b.sa });
      }
    }
    // Subs: the coach named on a coverage row works that team for the one who's out.
    for (const c of cover || []) {
      if (c.practice_date !== d || !c.sub_name) continue;
      const email = emailFor(c.sub_name); if (!email) continue;
      const slot = c.slot || (blocks.find(b => b.team === c.team_name) || {}).slot || "";
      shifts.push({ email, date: d, team: c.team_name, slot, role: "sub", forWhom: c.coach_out });
    }
    if (ph) for (const f of floats || []) {
      if ((f.phase || "season") !== ph || f.day !== wd) continue;
      const email = emailFor(f.coach_name); if (!email) continue;
      shifts.push({ email, date: d, team: "", slot: f.slot, role: "float" });
    }
    for (const n of nights || []) {
      if (n.night_date !== d || n.cancelled) continue;
      const only = n.teams || [], ages = only.length ? [] : (n.ages || []);
      for (const t of teams || []) {
        const mine = only.length ? only.includes(t.team_name) : (ages.includes(String(t.team_name).trim().split(/\s+/)[0]) && !/\brise\b/i.test(t.team_name) && !eventTeams.has(t.team_name));
        if (!mine) continue;
        for (const raw of [t.head_coach, t.assistant_coach, t.third_coach]) {
          const email = raw && !isPlaceholder(raw) ? emailFor(raw) : null; if (!email) continue;
          const hh = (x) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(x || "")); return m ? +m[1] + (+m[2]) / 60 : null; };
          const s = hh(n.start_time), e = hh(n.end_time);
          shifts.push({ email, date: d, team: t.team_name, slot: s != null && e != null ? slotOf(s, e) : "", role: "orientation", note: n.label });
        }
      }
    }
  }

  // Per coach: merge same-team back-to-back scheduled hours, drop duplicates, sort.
  const byCoach = new Map();
  for (const s of shifts) { if (!byCoach.has(s.email)) byCoach.set(s.email, []); byCoach.get(s.email).push(s); }
  // One payable shift per stretch of clock time, same priority as the clock-in
  // screen: orientation → scheduled → sub → S&A → float. Whatever loses is
  // reported back as a double-booking rather than silently dropped — a coach
  // listed on two teams at 8pm is a scheduling error someone has to fix.
  const tier = (s) => s.role === "orientation" ? 0 : s.role === "scheduled" && !s.sa ? 1 : s.role === "sub" ? 2 : s.role === "scheduled" ? 3 : 4;
  const lines = (list) => {
    const outs = list.filter(s => s.role === "out");
    const kept = [], clashes = [];
    for (const s of list.filter(s => s.role !== "out").sort((a, b) => a.date.localeCompare(b.date) || tier(a) - tier(b) || span(a.slot)[0] - span(b.slot)[0] || (span(b.slot)[1] - span(b.slot)[0]) - (span(a.slot)[1] - span(a.slot)[0]))) {
      const [st, en] = span(s.slot);
      const hit = kept.find(k => k.date === s.date && st < span(k.slot)[1] && span(k.slot)[0] < en);
      // Same team at the same hour (her own practice plus a sub row on it, or
      // an S&A hour beside practice) is one shift, not a clash.
      if (hit) { if (hit.team !== s.team) clashes.push({ ...s, with: hit }); continue; }
      kept.push({ ...s });
    }
    const merged = [];
    for (const s of kept.sort((a, b) => a.date.localeCompare(b.date) || span(a.slot)[0] - span(b.slot)[0])) {
      const prev = merged[merged.length - 1];
      if (prev && prev.date === s.date && prev.team === s.team && prev.role === s.role && span(prev.slot)[1] === span(s.slot)[0]) { prev.slot = slotOf(span(prev.slot)[0], span(s.slot)[1]); prev.sa = prev.sa && s.sa; continue; }
      merged.push(s);
    }
    return { work: merged, out: outs, clashes };
  };
  const textFor = (p, list) => {
    const { work, out, clashes } = lines(list);
    const hrs = work.reduce((n, s) => n + hoursOf(s.slot), 0);
    const line = (s) => {
      const when = fmtD(s.date) + " " + (s.slot || "");
      if (s.role === "scheduled") return `${when} — ${s.team}${s.sa ? " (S&A)" : ""}`;
      if (s.role === "sub") return `${when} — ${s.team}, covering for ${s.forWhom || "a coach"}`;
      if (s.role === "float") return `${when} — floating`;
      if (s.role === "orientation") return `${when} — ${s.team} orientation${s.note ? " (" + s.note + ")" : ""}`;
      return when;
    };
    const outLine = (s) => `${fmtD(s.date)} ${s.slot || ""} — ${s.team}: ${s.cover ? "covered by " + s.cover : "NO COVER YET — tell Drew"}${s.note && s.note !== "time off" ? "" : s.note === "time off" ? " (time off)" : ""}`;
    const head = `DS Elite — your week, ${fmtRange(start, end)}`;
    const body = [
      work.length ? work.map(line).join("\n") : "Nothing scheduled for you this week.",
      out.length ? "NOT working (covered):\n" + out.slice().sort((a, b) => a.date.localeCompare(b.date) || span(a.slot)[0] - span(b.slot)[0]).map(outLine).join("\n") : "",
      clashes.length ? "Double-booked, tell Drew which one:\n" + clashes.map(c => `${fmtD(c.date)} ${c.slot} — ${c.team || "floating"} vs ${c.with.team || "floating"}`).join("\n") : "",
      `${work.length ? Math.round(hrs * 10) / 10 + "h total. " : ""}Clock in on the day in the app; anything wrong, reply here.`,
    ].filter(Boolean).join("\n\n");
    const push = { title: `Your week: ${work.length} shift${work.length === 1 ? "" : "s"}${out.length ? ", " + out.length + " covered" : ""}`, body: work.length ? work.slice(0, 3).map(line).join(" · ") : "Nothing scheduled this week." };
    return { sms: `${head}\n${body}\n— Drew`, push, work: work.length, out: out.length, hours: Math.round(hrs * 10) / 10 };
  };

  const targets = [...byCoach.entries()].map(([email, list]) => ({ p: people.get(email), list })).filter(x => x.p);
  if (dry) return res.status(200).json({ ok: true, dry: true, week: { start, end }, count: targets.length, coaches: targets.map(x => ({ name: x.p.name, ...textFor(x.p, x.list) })) });

  const origin = appOrigin(req);
  const sendTo = test ? targets.filter(x => OWNERS.includes(x.p.email)) : targets;
  const results = [];
  for (const x of sendTo) {
    const w = textFor(x.p, x.list);
    const channels = [];
    const phone = test ? DREW.phone : x.p.phone, email = test ? DREW.email : x.p.email;
    if (want.has("sms") && phone && /^\+\d{10,15}$/.test(phone) && twilioReady()) {
      try { await sendOneSms(sb, { to: phone, name: x.p.name, kind: "coach" }, w.sms, { sent_by_label: "weekly schedule" }); channels.push("sms"); } catch (e) { results.push({ name: x.p.name, sms_error: e.message }); }
    }
    if (want.has("push") && email) {
      try {
        const r = await fetch(origin + "/api/send-push", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skipEmail: true, title: w.push.title, body: w.push.body, url: "/?view=clockin", audience: { type: "email", email } }) });
        const o = await r.json().catch(() => ({})); if (o.sent > 0) channels.push("push");
      } catch { /* best effort */ }
    }
    results.push({ name: x.p.name, shifts: w.work, covered: w.out, hours: w.hours, channels });
  }
  return res.status(200).json({ ok: true, week: { start, end }, test, sent_by: who, sent: results.filter(r => r.channels?.length).length, results });
}
