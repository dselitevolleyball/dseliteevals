// POST /api/stat-report — send one player's performance testing report.
//   { player_id, test_to?, flagged?, include_flagged? }
//       test_to = send only to that address, subject [TEST]
//       flagged = metric keys HQ is holding back as likely typos
//       include_flagged = flagged keys someone ticked back in on purpose
//   { sample: true, test_to }  the template with a made-up player, to any address
// The email is rebuilt here from the saved template + the player's saved draft
// with shared/stat-report.js (the same builder as the app's preview), sent from
// DS Elite with replies going to the coach who sent it, and logged in
// stat_report_sends + email_log. Replies { ok, to, test, held } — held = the
// flagged metric keys her email would have shown and left out instead (not a
// flagged metric that was never picked for her).
//
// Red flags (Drew, Oct 12 2026: "red-flag potential issues with players'
// metrics … potentially a data entry issue"): a metric whose number looks like
// a data-entry slip never goes to a family unless someone ticked it back in.
// This runs the same shared statFlags check HQ does (over the whole season, so
// the age-group pool matches) AND honours whatever the client marked flagged.
// include_flagged only counts for a metric this check flags when her saved
// draft still holds the tick token for the flags found here
// ("ok:<key>:<fingerprint>", see ackOf): a tab opened before a new /stats save
// put a typo in that metric sends the old tick, the fingerprint no longer
// matches, and the metric is held back. Without that, Jemma Gong's ticked Oct
// 11 standing touch let an Oct 25 "252" (cm) through as "+152.79" better" from
// a stale tab (offline run, Oct 12 2026). Flag reasons never go in the email —
// buildReport has no way to print them.
//
// Who may send: owners/admins, or a coach listed in REPORT_SENDERS (Brandon).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, DSE_FROM_EMAIL.

import { createClient } from "@supabase/supabase-js";
import { buildReport, statFlags, statPeerStats, flaggedReportKeys, METRICS, SAMPLE_PLAYER, SAMPLE_TESTS, SAMPLE_DRAFT, SAMPLE_TEAM } from "../shared/stat-report.js";

const OWNER_EMAILS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];
// The DSSC performance coach (the new Brandon at DSSC - not Brandon Blahnik).
export const REPORT_SENDERS = ["brandon@drippingsportsclub.com"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const nrm = (v) => String(v || "").trim().toLowerCase();
const TERMINAL = ["declined", "not_invited", "opted_out"];
const KEYS = METRICS.map(m => m[0]);
const LABEL = Object.fromEntries(METRICS.map(m => [m[0], m[1]]));
// Only real metric keys from the request — nothing else from it reaches the builder.
const keysIn = (v) => Array.isArray(v) ? KEYS.filter(k => v.includes(k)) : [];
// The tick token HQ saves in stat_report_drafts.metrics when someone includes a
// flagged metric anyway. A copy of flagPrint/ackOf in src/StatReports.jsx —
// keep the two the same. If they ever drift, a real tick stops matching and the
// metric is held back (fails safe, and the reply's `held` names it).
const flagPrint = (flags, k) => {
  const s = flags.filter(f => f.key === k || (f.related || []).includes(k)).map(f => `${f.row}/${f.rule}/${Math.round((+f.value || 0) * 100)}`).sort().join(",");
  let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};
const ackOf = (flags, k) => `ok:${k}:${flagPrint(flags, k)}`;
// The columns statFlags / teamStanding read, for the season pool + teammates.
const STAT_COLS = "id, first_name, team_assignment, season, usav_div, offer_status, stand_reach, approach_touch, jump_touch, sprint_10y, stat_baseline_date";
// Every row, past PostgREST's 1,000-row page.
const every = async (q) => { const out = []; for (let from = 0; ; from += 1000) { const { data, error } = await q().range(from, from + 999); if (error) throw error; out.push(...(data || [])); if (!data || data.length < 1000) return out; } };

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "POST only" }); }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DSE_FROM_EMAIL } = process.env;
  const RESEND = process.env.RESEND_API_KEY || process.env.resend_api_key;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESEND || !DSE_FROM_EMAIL) return res.status(500).json({ error: "Server not configured" });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const { data: { user } = {} } = await sb.auth.getUser(bearer).catch(() => ({ data: {} }));
  const email = nrm(user?.email);
  if (!email) return res.status(401).json({ error: "Sign in first" });
  const { data: me } = await sb.from("coaches").select("display_name, is_admin, is_approved").ilike("email", email).maybeSingle();
  const allowed = OWNER_EMAILS.includes(email) || REPORT_SENDERS.includes(email) || !!(me?.is_approved && me?.is_admin);
  if (!allowed) return res.status(403).json({ error: "Only admins and the performance coach can send testing reports." });
  const senderName = me?.display_name || email;

  let b = req.body; try { b = typeof b === "string" ? JSON.parse(b) : (b || {}); } catch { return res.status(400).json({ error: "Invalid JSON" }); }
  const sample = !!b.sample;
  const playerId = Number(b.player_id);
  if (!playerId && !sample) return res.status(400).json({ error: "player_id required" });
  const testTo = b.test_to ? nrm(b.test_to) : null;
  if (testTo && !EMAIL_RE.test(testTo)) return res.status(400).json({ error: "That test address doesn't look right." });
  if (sample && !testTo) return res.status(400).json({ error: "A sample can only go to a test address." });

  let [{ data: player }, { data: tests }, { data: set }, { data: draft }] = await Promise.all([
    sb.from("players").select("id, first_name, last_name, team_assignment, season, usav_div, parent_name, parent2_name, parent_email, parent_email2, parent_email3, stand_reach, approach_touch, jump_touch, sprint_10y, stat_baseline_date").eq("id", playerId).maybeSingle(),
    sb.from("player_stat_tests").select("*").eq("player_id", playerId).order("test_date"),
    sb.from("stat_report_settings").select("data").eq("id", "main").maybeSingle(),
    sb.from("stat_report_drafts").select("*").eq("player_id", playerId).maybeSingle(),
  ]);
  if (sample) { player = SAMPLE_PLAYER; tests = SAMPLE_TESTS; draft = SAMPLE_DRAFT; }
  if (!player) return res.status(404).json({ error: "Player not found" });
  const firsts = [...new Set([player.parent_name, player.parent2_name].map(x => String(x || "").trim().split(/\s+/)[0]).filter(Boolean))];
  const parentFirst = firsts.length <= 1 ? (firsts[0] || "") : firsts.slice(0, -1).join(", ") + " and " + firsts[firsts.length - 1];
  // The season (flag pool) and teammates (unnamed in the email, for the
  // team-standing chart) come from one read; the sample keeps its made-up team.
  let teammates = sample ? SAMPLE_TEAM : [], omit = [];
  if (!sample) {
    let club, allTests;
    try {
      [club, allTests] = await Promise.all([
        every(() => sb.from("players").select(STAT_COLS).eq("season", player.season || "2026-27").order("id")),
        every(() => sb.from("player_stat_tests").select("*").order("id")),
      ]);
    } catch (e) { return res.status(500).json({ error: "Couldn't check her numbers: " + (e.message || e) }); }
    const flags = statFlags(player, tests || [], { peers: statPeerStats(club, allTests) });
    const mine = new Set(flaggedReportKeys(player, tests || [], flags));
    const held = new Set([...mine, ...keysIn(b.flagged)]);
    // A tick counts for a metric flagged here only if the saved draft holds the
    // token for these flags; one only the client flagged is clean by this
    // check, so its tick stands.
    const saved = Array.isArray(draft?.metrics) ? draft.metrics : [];
    const include = new Set(keysIn(b.include_flagged).filter(k => !mine.has(k) || saved.includes(ackOf(flags, k))));
    omit = KEYS.filter(k => held.has(k) && !include.has(k));
    if (player.team_assignment) teammates = club.filter(m => m.team_assignment === player.team_assignment && !TERMINAL.includes(m.offer_status || ""))
      .map(m => ({ player: m, tests: allTests.filter(t => t.player_id === m.id) }));
  }
  const args = { player, tests: tests || [], settings: set?.data || {}, draft: draft || {}, parentFirst, teammates };
  const rep = buildReport({ ...args, omit });
  // The held metrics her email would otherwise have shown (the pick with no
  // omit); a flagged metric that was never picked isn't news to staff.
  const wanted = omit.length ? buildReport(args).picked.map(r => r.key).filter(k => omit.includes(k)) : [];
  if (!rep.picked.length) {
    return res.status(400).json({ error: wanted.length
      ? `Nothing left to send for ${player.first_name}: the numbers picked for her report look like typos (${wanted.map(k => LABEL[k]).join(", ")}). Fix them, or tick them back in, first.`
      : "No testing numbers on file for " + player.first_name + " yet." });
  }

  const to = testTo ? [testTo] : [...new Set([player.parent_email, player.parent_email2, player.parent_email3].map(nrm).filter(e => EMAIL_RE.test(e)))];
  if (!to.length) return res.status(400).json({ error: "No parent email on file for " + player.first_name + "." });
  const addr = (/<([^>]+)>/.exec(DSE_FROM_EMAIL) || [, DSE_FROM_EMAIL])[1].trim();
  const subject = (testTo ? "[TEST] " : "") + rep.subject;

  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + RESEND, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `${senderName.replace(/[<>"]/g, "")} · DS Elite <${addr}>`, to, reply_to: email, subject, html: rep.html, text: rep.text }) });
  if (!r.ok) return res.status(502).json({ error: "Email failed: " + r.status + " " + (await r.text()).slice(0, 200) });

  await Promise.all([
    sample ? Promise.resolve() : sb.from("stat_report_sends").insert({ player_id: playerId, recipients: to, subject, body: rep.text, test: !!testTo, sent_by: senderName }),
    sb.from("email_log").insert({ subject, body: rep.text, recipient_count: to.length, recipients: to, sent_count: to.length, failed_count: 0, sent_by: senderName, sent_by_email: email }),
  ]);
  return res.status(200).json({ ok: true, to, test: !!testTo, held: wanted });
}
