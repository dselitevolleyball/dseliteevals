// POST /api/stat-report — send one player's performance testing report.
//   { player_id, test_to?, flagged?, include_flagged? }
//       test_to = send only to that address, subject [TEST]
//       flagged = metric keys HQ is holding back as likely typos
//       include_flagged = flagged keys someone ticked back in on purpose
//   { sample: true, test_to }  the template with a made-up player, to any address
//   { team, test_to?, resend?, dry? }  every current player on the team, one
//       email per family (see the team section at the bottom)
// The email is rebuilt here from the saved template + the player's saved draft
// with shared/stat-report.js (the same builder as the app's preview), sent from
// brandon@drippingsportsclub.com (replies to him) whoever sends it, and logged in
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
// The service-role key may send tests only (as Brandon), for operator scripts.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DSSC_RESEND_API_KEY (the DSSC Resend
// account, where drippingsportsclub.com is verified), REPORT_FROM_EMAIL (optional).

import { createClient } from "@supabase/supabase-js";
import { appOrigin } from "../shared/app-origin.js";
import { buildReport, statFlags, reviewFlags, statPeerStats, flaggedReportKeys, METRICS, SAMPLE_PLAYER, SAMPLE_TESTS, SAMPLE_DRAFT, SAMPLE_TEAM } from "../shared/stat-report.js";

// A team of ~14 at Resend's 2 a second, plus the season read.
export const config = { maxDuration: 120 };

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
// Everything the email needs about the girl herself.
const PLAYER_COLS = "id, first_name, last_name, team_assignment, season, usav_div, offer_status, parent_name, parent2_name, parent_email, parent_email2, parent_email3, stand_reach, approach_touch, jump_touch, sprint_10y, stat_baseline_date";
// Every row, past PostgREST's 1,000-row page.
const every = async (q) => { const out = []; for (let from = 0; ; from += 1000) { const { data, error } = await q().range(from, from + 999); if (error) throw error; out.push(...(data || [])); if (!data || data.length < 1000) return out; } };

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "POST only" }); }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const DSSC_RESEND = process.env.DSSC_RESEND_API_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  let b = req.body; try { b = typeof b === "string" ? JSON.parse(b) : (b || {}); } catch { return res.status(400).json({ error: "Invalid JSON" }); }
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  // The service-role key (operator scripts) may only send tests, as Brandon.
  const operator = bearer === SUPABASE_SERVICE_ROLE_KEY;
  if (operator && !b.test_to) return res.status(403).json({ error: "The service key can only send tests." });
  const { data: { user } = {} } = operator ? { data: { user: { email: REPORT_SENDERS[0] } } } : await sb.auth.getUser(bearer).catch(() => ({ data: {} }));
  const email = nrm(user?.email);
  if (!email) return res.status(401).json({ error: "Sign in first" });
  const { data: me } = await sb.from("coaches").select("display_name, is_admin, is_approved").ilike("email", email).maybeSingle();
  const allowed = operator || OWNER_EMAILS.includes(email) || REPORT_SENDERS.includes(email) || !!(me?.is_approved && me?.is_admin);
  if (!allowed) return res.status(403).json({ error: "Only admins and the performance coach can send testing reports." });
  const senderName = me?.display_name || (operator ? "Coach Brandon" : email);

  const sample = !!b.sample;
  const playerId = Number(b.player_id) || null;
  const teamName = String(b.team || "").trim() || null;
  if (!playerId && !teamName && !sample) return res.status(400).json({ error: "player_id or team required" });
  const testTo = b.test_to ? nrm(b.test_to) : null;
  if (testTo && !EMAIL_RE.test(testTo)) return res.status(400).json({ error: "That test address doesn't look right." });
  if (sample && !testTo) return res.status(400).json({ error: "A sample can only go to a test address." });
  if (!DSSC_RESEND && !b.dry) return res.status(500).json({ error: "Testing reports send from brandon@drippingsportsclub.com, which needs DSSC_RESEND_API_KEY (the DSSC Resend account) set on the server. Nothing was sent." });

  // Shared by every email in this call: the template, practice nights (her
  // Reach slot), and — for real players — the season pool for the flag check.
  const [{ data: set }, { data: practice }] = await Promise.all([
    sb.from("stat_report_settings").select("data").eq("id", "main").maybeSingle(),
    sb.from("practice_assignments").select("team_name, day, slot, phase"),
  ]);
  const settings = set?.data || {}, origin = appOrigin(req);
  // From Brandon's own address, whoever presses send (Drew, Oct 12 2026: "send
  // this email from brandon@drippingsportsclub.com … I don't want it coming
  // from DS Elite"); replies go to him. drippingsportsclub.com is verified on
  // the DSSC Resend account, not DS Elite's, so these go out with that
  // account's key (DSSC_RESEND_API_KEY) and never fall back to a DS Elite address.
  const REPORT_FROM = process.env.REPORT_FROM_EMAIL || `Coach Brandon <${REPORT_SENDERS[0]}>`;
  const replyTo = REPORT_SENDERS[0];
  const mail = async ({ to, subject, rep, pid }) => {
    if (!DSSC_RESEND) throw new Error("DSSC_RESEND_API_KEY isn't set on the server, so the report can't go out from brandon@drippingsportsclub.com.");
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + DSSC_RESEND, "Content-Type": "application/json" },
      body: JSON.stringify({ from: REPORT_FROM, to, reply_to: replyTo, subject, html: rep.html, text: rep.text }) });
    if (!r.ok) throw new Error("Email failed: " + r.status + " " + (await r.text()).slice(0, 200));
    await Promise.all([
      pid ? sb.from("stat_report_sends").insert({ player_id: pid, recipients: to, subject, body: rep.text, test: !!testTo, sent_by: senderName }) : Promise.resolve(),
      sb.from("email_log").insert({ subject, body: rep.text, recipient_count: to.length, recipients: to, sent_count: to.length, failed_count: 0, sent_by: senderName, sent_by_email: email }),
    ]);
  };

  if (sample) {
    const rep = buildReport({ player: SAMPLE_PLAYER, tests: SAMPLE_TESTS, settings, draft: SAMPLE_DRAFT, parentFirst: "Jordan", teammates: SAMPLE_TEAM, practice: practice || [], origin });
    try { await mail({ to: [testTo], subject: "[TEST] " + rep.subject, rep, pid: null }); } catch (e) { return res.status(502).json({ error: e.message }); }
    return res.status(200).json({ ok: true, to: [testTo], test: true, held: [] });
  }

  let club, allTests;
  try {
    [club, allTests] = await Promise.all([
      every(() => sb.from("players").select(STAT_COLS).eq("season", "2026-27").order("id")),
      every(() => sb.from("player_stat_tests").select("*").order("id")),
    ]);
  } catch (e) { return res.status(500).json({ error: "Couldn't check the numbers: " + (e.message || e) }); }
  const peers = statPeerStats(club, allTests);
  const testsOf = (id) => allTests.filter(t => t.player_id === id).sort((x, y) => String(x.test_date).localeCompare(String(y.test_date)));
  const live = (m) => !TERMINAL.includes(m.offer_status || "");

  const ids = playerId ? [playerId] : club.filter(m => m.team_assignment === teamName && live(m)).map(m => m.id);
  if (!ids.length) return res.status(404).json({ error: playerId ? "Player not found" : "No current players on " + teamName + "." });
  const [{ data: roster, error: rErr }, { data: drafts }, { data: sent }, { data: reviews }] = await Promise.all([
    sb.from("players").select(PLAYER_COLS).in("id", ids),
    sb.from("stat_report_drafts").select("*").in("player_id", ids),
    sb.from("stat_report_sends").select("player_id").in("player_id", ids).eq("test", false),
    sb.from("stat_flag_reviews").select("player_id, flag_id, decision").in("player_id", ids),
  ]);
  if (rErr) return res.status(500).json({ error: rErr.message });
  if (!roster?.length) return res.status(404).json({ error: "Player not found" });
  const sentIds = new Set((sent || []).map(s => s.player_id));

  // One player's email with the flag holds applied. A team send goes by the
  // ticks saved on each draft only; a single send also honours the page's
  // own flag list.
  const prepare = (player) => {
    const tests = testsOf(player.id), draft = (drafts || []).find(d => d.player_id === player.id) || {};
    // Accepted flags are numbers staff said are right; ignored ones still hold.
    const flags = reviewFlags(statFlags(player, tests, { peers }), reviews, player.id).live;
    const mine = new Set(flaggedReportKeys(player, tests, flags));
    const held = new Set([...mine, ...(playerId ? keysIn(b.flagged) : [])]);
    // A tick counts for a metric flagged here only if the saved draft holds the
    // token for these flags; one only the client flagged is clean by this
    // check, so its tick stands.
    const saved = Array.isArray(draft.metrics) ? draft.metrics : [];
    const asked = playerId ? keysIn(b.include_flagged) : [...mine].filter(k => saved.includes(ackOf(flags, k)));
    const include = new Set(asked.filter(k => !mine.has(k) || saved.includes(ackOf(flags, k))));
    const omit = KEYS.filter(k => held.has(k) && !include.has(k));
    const teammates = player.team_assignment ? club.filter(m => m.team_assignment === player.team_assignment && live(m)).map(m => ({ player: m, tests: testsOf(m.id) })) : [];
    const firsts = [...new Set([player.parent_name, player.parent2_name].map(x => String(x || "").trim().split(/\s+/)[0]).filter(Boolean))];
    const parentFirst = firsts.length <= 1 ? (firsts[0] || "") : firsts.slice(0, -1).join(", ") + " and " + firsts[firsts.length - 1];
    const args = { player, tests, settings, draft, parentFirst, teammates, practice: practice || [], origin };
    const rep = buildReport({ ...args, omit });
    // The held metrics her email would otherwise have shown (the pick with no
    // omit); a flagged metric that was never picked isn't news to staff.
    const wanted = omit.length ? buildReport(args).picked.map(r => r.key).filter(k => omit.includes(k)) : [];
    const to = testTo ? [testTo] : [...new Set([player.parent_email, player.parent_email2, player.parent_email3].map(nrm).filter(e => EMAIL_RE.test(e)))];
    const why = !rep.picked.length ? (wanted.length
        ? `Nothing left to send for ${player.first_name}: the numbers picked for her report look like typos (${wanted.map(k => LABEL[k]).join(", ")}). Fix them, or tick them back in, first.`
        : "No testing numbers on file for " + player.first_name + " yet.")
      : !to.length ? "No parent email on file for " + player.first_name + "." : null;
    return { player, rep, to, held: wanted, why };
  };

  if (playerId) {
    const j = prepare(roster[0]);
    if (j.why) return res.status(400).json({ error: j.why });
    try { await mail({ to: j.to, subject: (testTo ? "[TEST] " : "") + j.rep.subject, rep: j.rep, pid: j.player.id }); } catch (e) { return res.status(502).json({ error: e.message }); }
    return res.status(200).json({ ok: true, to: j.to, test: !!testTo, held: j.held });
  }

  // Whole team (Drew, Oct 12 2026: "send to the whole team in 1 fell swoop").
  // One email per family. Skipped: no numbers, everything picked held as a
  // likely typo, no parent email, and (unless resend:true) anyone already
  // sent. A test send puts every girl's email in the test inbox. dry:true
  // lists who would get one without sending anything.
  const resend = !!b.resend, dry = !!b.dry;
  const done = [], skipped = [];
  const order = roster.slice().sort((x, y) => String(x.first_name).localeCompare(String(y.first_name)));
  for (const p of order) {
    const name = p.first_name + " " + p.last_name;
    if (!testTo && !resend && sentIds.has(p.id)) { skipped.push({ player_id: p.id, name, why: "Already sent" }); continue; }
    const j = prepare(p);
    if (j.why) { skipped.push({ player_id: p.id, name, why: j.why }); continue; }
    if (dry) { done.push({ player_id: p.id, name, to: j.to, held: j.held }); continue; }
    try {
      await mail({ to: j.to, subject: (testTo ? `[TEST · ${name}] ` : "") + j.rep.subject, rep: j.rep, pid: p.id });
      done.push({ player_id: p.id, name, to: j.to, held: j.held });
    } catch (e) { skipped.push({ player_id: p.id, name, why: e.message }); }
    await new Promise(r => setTimeout(r, 600));   // Resend allows 2 a second
  }
  return res.status(200).json({ ok: true, team: teamName, test: !!testTo, dry, sent: done, skipped });
}
