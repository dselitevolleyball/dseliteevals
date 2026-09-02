// Vercel Cron: tell Kristen about travel that has appeared and isn't booked.
//
// The same check as scripts/coach-travel-gaps.mjs, run every morning instead of
// when somebody remembers. It was remembered for Kelli Hardge's move to 15 Ruby
// and not for Dillyn Austin, whose three unbooked trips nobody was told about —
// which is the whole argument for this being a cron.
//
// ONLY WHAT IS NEW
//
// There are around 74 unbooked overnight trips at any time, most of them known
// and deliberate. Sending that list daily would be filtered to junk inside a
// week, and then the one that mattered would go with it. So every reported
// (coach, tournament) is written to travel_gap_notices and never reported
// again. A quiet morning sends nothing at all.
//
// That makes the email mean one thing: this is new since yesterday. Which is
// exactly the case that gets missed — a coach added to a team, a team entered
// into a tournament, an override cleared.
//
// The first run is the exception and says so: everything outstanding is new to
// a table that has never seen it. It reports a count and a link rather than
// listing all 74, so the habit starts with a readable email.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; also ?token=.
// Query: ?dry=1 to see what it would send.  ?seed=1 to mark everything
//        currently outstanding as already-known WITHOUT emailing, so tomorrow
//        starts clean.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
//      RESEND_API_KEY (or resend_api_key), DSE_FROM_EMAIL,
//      TRAVEL_ALERT_TO (opt — defaults to Kristen).

import { createClient } from "@supabase/supabase-js";

// Kristen books it; Drew asked to see it too, having found out about Dillyn
// Austin's three unbooked trips by noticing they were missing rather than by
// being told. TRAVEL_ALERT_TO overrides, comma-separated.
const TO_DEFAULT = "kristen@dselitevolleyball.com,drew@dselitevolleyball.com";
const APP = "https://dseliteevals.vercel.app";
const PLACEHOLDER = /^(tbd|tba|n\/a|na|none|pending|sub|open|needed|\?+|-+|—)$/i;
const isPlaceholder = (c) => {
  const s = String(c || "").trim();
  return !s || PLACEHOLDER.test(s) || /new coach|floater coach|assistant coach$/i.test(s);
};
const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const day = (iso) => {
  try { return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); }
  catch { return iso; }
};
const span = (a, b) => (b && b !== a) ? day(a) + "–" + day(b).replace(/^\w+ /, "") : day(a);
const outOfState = (loc) => !!loc && !/,\s*TX\b|texas/i.test(loc);

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, DSE_FROM_EMAIL, TRAVEL_ALERT_TO } = process.env;
  const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.resend_api_key;

  const url = (() => { try { return new URL(req.url, "https://x"); } catch { return null; } })();
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!CRON_SECRET || (bearer !== CRON_SECRET && (url?.searchParams.get("token") || "") !== CRON_SECRET)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });

  const dry = url?.searchParams.get("dry") === "1";
  const seed = url?.searchParams.get("seed") === "1";
  const to = (TRAVEL_ALERT_TO || TO_DEFAULT).split(",").map(x => x.trim()).filter(Boolean);

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const [{ data: teams }, { data: assigns }, { data: tourns }, { data: travel }, { data: notices }] =
    await Promise.all([
      sb.from("practice_teams").select("team_name, head_coach, assistant_coach, third_coach"),
      sb.from("tournament_assignments").select("team_id, tournament_id, head_override, asst_override, sub_coach"),
      sb.from("tournaments").select("id, name, start_date, end_date, location, stay_over, cancelled"),
      sb.from("coach_travel").select("tournament_id, coach_name"),
      sb.from("travel_gap_notices").select("coach_name, tournament_id"),
    ]);

  const tById = new Map((tourns || []).map(t => [t.id, t]));
  const teamBy = new Map((teams || []).map(t => [t.team_name, t]));
  const booked = new Set((travel || []).map(r => r.tournament_id + "|" + norm(r.coach_name)));
  const told = new Set((notices || []).map(r => r.tournament_id + "|" + norm(r.coach_name)));
  const firstRun = (notices || []).length === 0;

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

  const gaps = [];
  for (const a of (assigns || [])) {
    const t = tById.get(a.tournament_id);
    if (!t || t.cancelled || !t.stay_over) continue;
    // A weekend already gone is not a booking anybody can still make.
    if (String(t.start_date) < today) continue;
    const team = teamBy.get(a.team_id);
    if (!team) continue;
    const going = [
      a.head_override || team.head_coach,
      a.asst_override || team.assistant_coach,
      team.third_coach,
      a.sub_coach,
    ].filter(c => !isPlaceholder(c));
    for (const c of [...new Set(going.map(x => String(x).trim()))]) {
      const key = a.tournament_id + "|" + norm(c);
      if (booked.has(key)) continue;
      gaps.push({ coach: c, team: a.team_id, t, key, isNew: !told.has(key), far: outOfState(t.location) });
    }
  }
  // De-duplicate: a coach on two teams at one tournament is one trip.
  const seen = new Set();
  const all = gaps.filter(g => (seen.has(g.key) ? false : seen.add(g.key)));
  const fresh = all.filter(g => g.isNew);
  fresh.sort((a, b) => String(a.coach).localeCompare(String(b.coach))
    || String(a.t.start_date).localeCompare(String(b.t.start_date)));

  const mark = async (rows) => {
    if (!rows.length) return;
    await sb.from("travel_gap_notices").upsert(
      rows.map(g => ({ coach_name: g.coach, tournament_id: g.t.id, team_name: g.team })),
      { onConflict: "coach_name,tournament_id", ignoreDuplicates: true });
  };

  if (seed) {
    if (!dry) await mark(all);
    return res.status(200).json({ ok: true, seeded: all.length, emailed: false,
      note: "Everything outstanding marked as already-known. Tomorrow only new gaps are reported." });
  }

  if (dry) {
    return res.status(200).json({
      ok: true, dry: true, first_run: firstRun,
      outstanding_total: all.length, new_since_last_run: fresh.length,
      would_report: fresh.map(g => ({ coach: g.coach, team: g.team, tournament: g.t.name.trim(),
        when: span(g.t.start_date, g.t.end_date), where: g.t.location, flights: g.far })),
    });
  }

  if (!fresh.length) {
    return res.status(200).json({ ok: true, new_since_last_run: 0, outstanding_total: all.length, emailed: false });
  }
  if (!RESEND_API_KEY || !DSE_FROM_EMAIL) return res.status(500).json({ error: "Email not configured" });

  const byCoach = new Map();
  for (const g of fresh) {
    if (!byCoach.has(g.coach)) byCoach.set(g.coach, []);
    byCoach.get(g.coach).push(g);
  }

  // The first run would otherwise be a wall of 74 rows. Say the number, link to
  // the board, and let the habit start with something readable.
  const bulk = firstRun && fresh.length > 12;
  const sections = bulk ? "" : [...byCoach.entries()].map(([coach, list]) => {
    const far = list.filter(g => g.far).length;
    return `<p style="margin:24px 0 8px;font-weight:700;font-size:15px">${esc(coach)} — ${list.length} unbooked` +
      `${far ? `, <span style="color:#b62d2d">${far} needing flights</span>` : ""}</p>` +
      `<table style="border-collapse:collapse;width:100%;font-size:14px"><tbody>` +
      list.map(g =>
        `<tr><td style="padding:7px 10px;border-bottom:1px solid #eee;white-space:nowrap;font-weight:600">${esc(span(g.t.start_date, g.t.end_date))}</td>` +
        `<td style="padding:7px 10px;border-bottom:1px solid #eee;white-space:nowrap">${esc(g.team)}</td>` +
        `<td style="padding:7px 10px;border-bottom:1px solid #eee">${esc(String(g.t.name).trim())}</td>` +
        `<td style="padding:7px 10px;border-bottom:1px solid #eee;white-space:nowrap">${esc(g.t.location || "")}` +
        `${g.far ? ' <b style="color:#b62d2d">flights</b>' : ""}</td></tr>`).join("") +
      `</tbody></table>`;
  }).join("");

  const lead = bulk
    ? `<p style="margin:0 0 14px">There are <b>${fresh.length}</b> tournaments with a coach due and no travel booked. That is the current backlog rather than anything that changed today — from tomorrow this email only arrives when something <i>new</i> turns up.</p>`
    : `<p style="margin:0 0 14px">${fresh.length === 1 ? "A trip has" : fresh.length + " trips have"} appeared that need travel booked. Staffing changed, or a team was entered into a tournament, and nobody would otherwise have said.</p>`;

  const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:640px">'
    + '<p style="margin:0 0 14px">Kristen,</p>' + lead + sections
    + `<p style="margin:22px 0 8px"><a href="${APP}/?view=travel" style="display:inline-block;background:#e91e8c;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700">Open the travel board &rarr;</a></p>`
    + '<p style="margin:0 0 14px;font-size:13px;color:#666">Weekends where the assistant is listed as somebody else, or as TBD, are left out — those are not their trips. Each trip is reported once; you will not see these again.</p>'
    + '<p style="margin:0">Drew</p></div>';

  const text = "Kristen,\n\n" + (bulk
    ? `There are ${fresh.length} tournaments with a coach due and no travel booked. That is the current backlog; from tomorrow this only arrives when something new turns up.\n`
    : [...byCoach.entries()].map(([coach, list]) =>
        coach + " — " + list.length + " unbooked:\n" + list.map(g =>
          "  " + span(g.t.start_date, g.t.end_date) + "  " + g.team + "  " +
          String(g.t.name).trim() + " — " + (g.t.location || "") + (g.far ? "  (FLIGHTS)" : "")).join("\n")
      ).join("\n\n"))
    + `\n\n${APP}/?view=travel\n\nEach trip is reported once; you won't see these again.\n\nDrew`;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: DSE_FROM_EMAIL, to,
      subject: bulk ? `Travel to book — ${fresh.length} outstanding`
        : `Travel to book — ${fresh.length} new trip${fresh.length === 1 ? "" : "s"}`,
      text, html,
    }),
  });
  if (!r.ok) return res.status(500).json({ error: "Resend " + r.status, new_since_last_run: fresh.length });

  // Marked only after the send succeeds, so a failed email is retried tomorrow
  // rather than silently counted as delivered.
  await mark(fresh);

  return res.status(200).json({ ok: true, emailed: true, to,
    new_since_last_run: fresh.length, outstanding_total: all.length });
}
