// Every other Monday: remind each coach whose team has no check-ins yet this
// round to do the Quick Check-in. Push to the app, mirrored to email.
//
// Rounds are two-week windows starting on the Monday of an odd ISO week; the
// cron fires every Monday and this does nothing on the even ones, so the
// schedule line in vercel.json stays a plain weekly cron.
//
// Auth: Vercel Cron `Authorization: Bearer <CRON_SECRET>`; also ?token=.
// Query: ?dry=1 — list who would be nudged, send nothing.  ?force=1 — ignore the odd-week rule.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET.

import { createClient } from "@supabase/supabase-js";
import { appOrigin } from "../shared/app-origin.js";

const isPlaceholder = (nm) => /assistant coach|head coach|tbd|coach needed|floater/i.test(nm || "");
const nrm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

// ISO week number and the Monday that starts the current two-week round.
export function currentRound(today = new Date()) {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);                       // Thursday of this ISO week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - 3);
  if (week % 2 === 0) monday.setUTCDate(monday.getUTCDate() - 7);  // even week → round began last Monday
  return { round: monday.toISOString().slice(0, 10), week, startsThisWeek: week % 2 === 1 };
}

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET } = process.env;
  const url = (() => { try { return new URL(req.url, "https://x"); } catch { return null; } })();
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!CRON_SECRET || (bearer !== CRON_SECRET && (url?.searchParams.get("token") || "") !== CRON_SECRET)) return res.status(403).json({ error: "Forbidden" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const dry = url?.searchParams.get("dry") === "1", force = url?.searchParams.get("force") === "1";
  const { round, startsThisWeek } = currentRound();
  if (!startsThisWeek && !force) return res.status(200).json({ ok: true, round, note: "not a round-start week; nothing sent" });

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const [{ data: teams }, { data: roster }, { data: done }] = await Promise.all([
    sb.from("practice_teams").select("team_name, head_coach, assistant_coach, third_coach, practices_per_week"),
    sb.from("coach_roster").select("first_name, last_name, email"),
    sb.from("player_checkins").select("team_name, coach_email").eq("round", round),
  ]);
  const doneTeams = new Set((done || []).map(d => d.team_name));
  const emailOf = (name) => { const r = (roster || []).find(x => nrm((x.first_name || "") + " " + (x.last_name || "")) === nrm(name)); return r?.email ? String(r.email).trim().toLowerCase() : null; };

  // coach email → the teams of theirs still untouched this round
  const todo = new Map();
  for (const t of teams || []) {
    if (t.practices_per_week != null && Number(t.practices_per_week) === 0) continue;   // event teams
    if (doneTeams.has(t.team_name)) continue;
    for (const n of [t.head_coach, t.assistant_coach, t.third_coach]) {
      if (!n || isPlaceholder(n)) continue;
      const em = emailOf(n); if (!em) continue;
      if (!todo.has(em)) todo.set(em, { name: n, teams: [] });
      todo.get(em).teams.push(t.team_name);
    }
  }
  const list = [...todo.entries()].map(([email, v]) => ({ email, name: v.name, teams: v.teams }));
  if (dry) return res.status(200).json({ ok: true, dry: true, round, count: list.length, coaches: list });

  const origin = appOrigin(req);
  let sent = 0;
  for (const c of list) {
    const first = c.name.split(/\s+/)[0];
    const teamsTxt = c.teams.join(" and ");
    const body = `Hi ${first} — new check-in round. Two minutes per team: which way each player is trending, what she is to the team right now, a high and a low. ${teamsTxt} ${c.teams.length === 1 ? "is" : "are"} waiting.`;
    try {
      await fetch(origin + "/api/send-push", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Quick Check-in — " + teamsTxt, body: "A few taps per player. Open the app and start.", url: "/?view=checkin", audience: { type: "email", email: c.email },
          emailSubject: "Quick Check-in time — " + teamsTxt, emailBody: body + "\n\nOpen DS Elite HQ → Quick Check-in: " + origin + "/?view=checkin" }) });
      sent++;
    } catch { /* best effort */ }
  }
  return res.status(200).json({ ok: true, round, sent, coaches: list.map(c => c.name) });
}
