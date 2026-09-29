// Ask HQ — the assistant built into the admin screens.
//
// An admin types a question in plain English ("who from the Red Rock Rave
// teams hasn't booked their room?", "which 13s haven't signed the
// commitment?", "how many hours did Jaalin clock last week?"). Claude answers
// by writing read-only SQL against the database (public.hq_query — a single
// SELECT, read-only transaction, 8s timeout), reading the results, and
// explaining. It can also draft an email for the admin to send — it never
// sends anything itself — and, for an uploaded spreadsheet, propose changes
// (propose_changes → hq_change_proposals). It cannot write to the database:
// the admin reviews the proposal and api/hq-apply.js applies what they tick.
//
// POST { question, history: [{role, content}], context: { view },
//        attachments: [{ name, type, path }] }   — files in the hq-uploads bucket;
//        PDFs and images go to Claude as documents/images via a signed URL,
//        CSV/text files are read and passed inline (first 200KB);
//        Excel workbooks are converted to one CSV per sheet.
//   Authorization: Bearer <Supabase session token of an owner/admin>
// Response { answer, tools: [{name, summary}], drafts: [{to, subject, body}], proposals: [{id, summary, changes, skipped}], usage }
//
// Env: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { checkChanges, MAX_CHANGES } from "./_lib/hq-changes.js";

export const config = { maxDuration: 120 };

const OWNER_EMAILS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];
const MODEL = "claude-opus-5";
const MAX_TURNS = 16;   // matching a long sheet takes a few more lookups
const SECRET_KEY = /token|secret|password|api_key|signed_ip|user_agent|raw_email/i;

const SYSTEM = `You are HQ, the assistant inside DS Elite HQ — the operations app for DS Elite Volleyball (a youth club volleyball program in Dripping Springs, TX) and its sister business Dripping Springs Sports Club (DSSC, a facility that runs clinics and skill pods). You are talking to a club administrator. Today's date is given in each question.

You answer by querying the database with the sql tool and reading what comes back. Never guess at data you could look up. If a question can't be answered from the data, say so plainly. Keep answers tight: lead with the answer, then the supporting list. Use short bullet lists for people; never markdown tables or headers. When you list people, include the detail an admin needs to act (team, parent name, email, phone) unless asked for names only.

RULES
- You cannot write to the database. The one exception is propose_changes (below): you file a proposal, the admin reviews it and taps Apply. You can never delete, send, or change logins. If the admin asks for something else, do the lookup and hand them what they need (a draft, a list) — the app has buttons for the rest.
- Never select or reveal columns whose names contain token, secret, password, signed_ip or user_agent. They are stripped anyway.
- Dates: compare with today's date. "This week" is Monday–Sunday in Central time. Tournament and practice dates are DATE columns; check_date/session_date likewise.
- Be precise about counts. If a query returns the row cap (200 by default), say the list may be truncated and narrow it.
- When a name is ambiguous (two Smiths), show both rather than picking.
- You may run several queries per question. Prefer one good query with joins over many small ones. Use ILIKE for names.

HOW THE CLUB'S DATA FITS TOGETHER
Teams are named like "15 Diamond", "12 Ruby", "11 Rise 1" (age then color; Rise = developmental, Crystal = event-only). Whether a team is National or Regional comes from practice_teams.level, never the color. Only 14 Ruby and 15 Ruby are National; every other Ruby team is Regional (and 11 Diamond is Regional). practice_teams(team_name, level, head_coach, assistant_coach, third_coach, age_div, practices_per_week) is the team list; teams(id = the team name, division, level, head_coach, assistant_coach) is an older mirror. A team's coaches are the head/assistant/third columns; coach contact info is in coach_roster(first_name, last_name, email, phone). A coach's app login is coaches(email, display_name, is_admin, is_approved).

players: one row per player. team_assignment is the team; the CURRENT roster of a team is players where team_assignment = team AND offer_status NOT IN ('declined','not_invited','opted_out') (roster_status is not reliable). Parent contacts: parent_name, parent_email, parent_email2, parent_email3, parent_phone, parent2_name, parent2_phone; player_email/player_phone. Other useful columns: dob, primary_position, secondary_position, jersey_number, school_team, tryout_number, rise_tryout, offer_status (accepted/made/locked/declined/not_invited/opted_out), notes, parent_feedback_notes, scores (jsonb of 1-5 skill ratings), projected_team.
player_commitments(player_id, season, player_signed_at, parent_signed_at, player_attended, parent_attended): the signed commitment. Unsigned = no row or a null signed_at.
global_challenge_interest(player_id, interest yes/maybe/no, primary_position (the one she plays), positions text[] (others she is open to), travel solo (just the player)/family/unsure, travelers, city, passport, respondent_name, questions, updated_at): the 2027 Girls Global Challenge (Croatia, U17) interest form sent to the 14 and 15 National teams: 14 Diamond, 14 Ruby, 15 Diamond, 15 Ruby. No row = hasn't answered.
player_gear_orders(player_id, team_name, sizes…, shoe_size, details_confirmed, needs_fitting, is_draft): uniform sizes.
player_incidents(player_id, team_name, kind, summary, status, urgency, occurred_on): issues.
player_evaluations(player_id, team_name, season, scores jsonb, strengths, focus, goal, coach_name).
change_log(player_id, table_name, action, field_changes, actor_name, created_at): audit trail of edits.

Schedule: practice_assignments(team_name, day 'Sun'|'Mon'…, slot like '5-7pm', phase) — phases: summer 2026-07-12..09-12, fall1 09-13..10-11, fall2 10-18..11-15, season 2026-12-01..2027-05-06, postseason 2027-05-07..06-15. sa_sessions(team_name, session_date, slot, block) = strength & agility sessions. team_events(team_name, title, event_date, start_time, duration_min, location, description). orientation_nights(night_date, label, ages text[], teams text[], start_time, end_time). practice_coverage(practice_date, team_name, slot, coach_out, sub_name, phase) = subs.
Tournaments: tournaments(id, name, start_date, end_date, location, venue, is_qualifier, stay_over, stay_to_play, cost, registration_deadline, cancelled, housing_url, housing_deadline, housing_report_at). tournament_assignments(tournament_id, team_id = the team NAME, division, status, sub_coach). tournament_housing_bookings(tournament_id, last_name, first_name, team_raw, email, phone, check_in, check_out, nights, hotel, room_type, ack_number, share_with, matched_player_id → players.id, matched_team, is_staff, match_how): the housing bureau's pickup report; a player with no matched booking hasn't booked. coach_travel(tournament_id, coach_name, airline, depart_date, return_date, flight_cost, hotel_cost, flight_purchased, room_booked, travel_mode, traveler_type) and coach_travel_rooms(tournament_id, hotel_name, confirmation, check_in, check_out) = staff travel.
Pay (DS Elite): coach_checkins(coach_name, check_date, team_name, slot, hours, role scheduled|sub|float|dsysa, status, source, paid, note) = clock-ins, one row per hour block; coach_rates(coach_name, hourly_rate, head_rate, team_rates jsonb). Pay weeks are Monday–Sunday. expenses(season, category, team_name, item, expense_date, amount, status, submitted_by, reimbursed) = expenses and coach reimbursement claims.
Email: email_log(subject, body, recipient_count, recipients, sent_by, created_at) = every email the app sent.
DSSC (the club facility, separate payroll): dssc_clinics(id, name, category, age_group, location, sessions jsonb — each session {id, date, start_time, end_time, court, coach_name, staff[], focus, recap, blocks[]}, plan jsonb, source_ref = Playbook program id). Query sessions with jsonb_array_elements(sessions). dssc_pod_roster(clinic_id, session_id, player_name, parent_name, parent_email, parent_phone, sms_consent) = who signed up for a class (session_id null = whole program). dssc_pod_attendance(clinic_id, session_id, session_date, players, present jsonb). dssc_checkins(coach_name, clinic_id, session_id, session_date, clinic_name, hours, approved, paid) = DSSC clock-ins at $25/hr. dssc_availability(coach_name, available, can_lead, tier, skills, note) = the DSSC coach pool.
DSSC CRM (People): dssc_contacts(id, email, first_name, last_name, phone, city, zip, dob, sources text[] playbook|upperhand|dse|form, tags text[], notes, do_not_text, playbook_user_pk) = families/account holders; dssc_participants(id, contact_id, first_name, last_name, dob, gender, is_contact, dse_player_id, playbook_student_pk, position, position2, dse_team, dse_level rise|regional|national) = the players (kids) under a family; dssc_participation(participant_id, contact_id, program, category volleyball|basketball|reach|facility|other, event_date, source playbook|upperhand|dse) = every program/class/season someone took part in; dssc_orders(contact_id, buyer, total_cents, ordered_at, sale_source) = Upper Hand purchases (no line items). Age = from dssc_participants.dob. "Can we text them" = dssc_contacts.phone, minus sms_optouts (brand='dssc') and do_not_text — the club is opt-out, everyone registered agreed to texts.
School: school_games(school games the players' school teams play). DSYSA: dsysa_clinics + dsysa_signups(coach_name, is_lead) = rec-league clinics staffed by our coaches.

The admin may attach documents (a housing bureau's pickup report, a Playbook export, an invoice, a screenshot). Read them fully and combine them with the database — e.g. match names in an attached report against a roster query. Quote the document where it matters.

UPDATING HQ FROM AN UPLOADED DOCUMENT
When the admin attaches a spreadsheet, export or report and asks you to update HQ from it (or asks "what would this change?"):
1. Work out which table and columns the document speaks to (describe_table if unsure). Common ones: players (jersey_number, positions, parent contacts, school_team, dob…), coach_travel / coach_travel_rooms (flights, hotels, confirmations), tournaments and tournament_assignments, player_gear_orders, practice_teams, coach_roster.
2. Match EVERY row of the document to an HQ record with sql, by name plus a second detail (team, parent, email, date) where names could collide. Use the current-roster rule for players.
3. Call propose_changes once with every change, each naming the row by its primary key (look the id up; never guess), a label a person recognises ("Mia Paz · 14 Diamond"), and a short reason quoting the document. Only set columns the document actually gives a value for; a blank cell means "no information", never "clear it". Don't re-state values HQ already has — they're dropped anyway. Insert only when the document clearly adds something new (a new flight, a new tournament entry), never for a person you failed to match.
4. In your answer: how many changes you proposed, then list every document row you could NOT match or weren't sure about, and anything skipped. End with: "Review the changes below and tap Apply."
Never propose deletes. Never propose changes to coaches (logins), message logs, or token/secret columns. Keep to ${MAX_CHANGES} changes per proposal; if there are more, propose the first batch and say so.

If you need a table's columns, call describe_table. Tables you don't know about exist too (list them with describe_table on '').`;

const tools = [
  { name: "sql", description: "Run one read-only SELECT (or WITH … SELECT) against the club database and get the rows back as JSON. Max 200 rows unless max_rows is set (cap 500). Use ILIKE for name matching. Postgres 15.", input_schema: { type: "object", properties: { query: { type: "string" }, max_rows: { type: "integer" } }, required: ["query"] } },
  { name: "describe_table", description: "List the columns of a table (name, type). Pass an empty string to list every table in the database.", input_schema: { type: "object", properties: { table: { type: "string" } }, required: ["table"] } },
  { name: "propose_changes", description: "File database changes for the admin to review and apply (you cannot apply them). Use only when the admin asked to update HQ from a document or asked what it would change. Updates must name the row by its full primary key (usually {id: N}); look ids up with sql first. The result tells you what was accepted, dropped as no-change, or skipped and why — fix skipped ones and call again if you can.", input_schema: { type: "object", properties: {
    summary: { type: "string", description: "one line, e.g. 'Jersey numbers for 14 Ruby from Kristen's sheet'" },
    changes: { type: "array", items: { type: "object", properties: {
      table: { type: "string" }, action: { type: "string", enum: ["update", "insert"] },
      pk: { type: "object", description: "primary key of the row to update, e.g. {\"id\": 412}" },
      set: { type: "object", description: "column → new value" },
      label: { type: "string", description: "who/what this row is, e.g. 'Mia Paz · 14 Diamond'" },
      reason: { type: "string", description: "what in the document says so" } }, required: ["table", "action", "set", "label"] } } }, required: ["summary", "changes"] } },
  { name: "draft_email", description: "Hand the admin a ready-to-send email. Use it when they ask you to write, draft, email, remind or message people. You do not send it — the app shows it with a Send button. One draft per distinct message; for a per-family message with different names, produce one draft per family (max 40).", input_schema: { type: "object", properties: { to: { type: "array", items: { type: "string" }, description: "recipient email addresses" }, subject: { type: "string" }, body: { type: "string", description: "plain text" }, label: { type: "string", description: "who this is for, e.g. 'Jauregui family (Brooklyn, 15 Diamond)'" } }, required: ["to", "subject", "body"] } },
];

// Best-effort log. Supabase builders are thenables with no .catch, so this is
// the one place that awaits them inside a try — a logging failure must never
// turn into a 500 for the admin.
async function log(sb, row) { try { await sb.from("hq_assistant_log").insert(row); } catch { /* ignore */ } }

const scrub = (v) => {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === "object") { const o = {}; for (const [k, x] of Object.entries(v)) if (!SECRET_KEY.test(k)) o[k] = scrub(x); return o; }
  return v;
};

async function runTool(sb, name, input, drafts, ctx = {}) {
  if (name === "propose_changes") {
    const { ok, skipped, noop } = await checkChanges(sb, input.changes);
    if (!ok.length) return { accepted: 0, no_change: noop, skipped, note: noop ? "Every change matched what HQ already has." : "Nothing valid to propose." };
    const { data, error } = await sb.from("hq_change_proposals").insert({ created_by: ctx.who, summary: String(input.summary || "").slice(0, 300), source_files: ctx.files || [], changes: ok }).select("id").single();
    if (error) return { error: "Couldn't save the proposal: " + error.message };
    ctx.proposals.push({ id: data.id, summary: String(input.summary || ""), changes: ok, skipped, noop });
    return { proposal_id: data.id, accepted: ok.length, no_change: noop, skipped };
  }
  if (name === "sql") {
    const q = String(input.query || "");
    if (SECRET_KEY.test(q)) return { error: "That query touches a protected column (token/secret/password). Leave those out." };
    const { data, error } = await sb.rpc("hq_query", { sql: q, max_rows: Math.min(500, Math.max(1, Number(input.max_rows) || 200)) });
    if (error) return { error: error.message };
    const rows = scrub(data || []);
    return { rows: rows.length, capped: rows.length >= (Number(input.max_rows) || 200), data: rows };
  }
  if (name === "describe_table") {
    const t = String(input.table || "").trim();
    const q = t
      ? `select column_name, data_type from information_schema.columns where table_schema='public' and table_name='${t.replace(/'/g, "")}' order by ordinal_position`
      : `select table_name, (select count(*) from information_schema.columns c where c.table_schema='public' and c.table_name=t.table_name) as columns from information_schema.tables t where table_schema='public' and table_type='BASE TABLE' order by table_name`;
    const { data, error } = await sb.rpc("hq_query", { sql: q, max_rows: 500 });
    if (error) return { error: error.message };
    return { data: scrub((data || []).filter(r => !SECRET_KEY.test(r.column_name || ""))) };
  }
  if (name === "draft_email") {
    const to = (Array.isArray(input.to) ? input.to : []).map(s => String(s).trim().toLowerCase()).filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
    if (!to.length) return { error: "No valid recipient address." };
    if (drafts.length >= 40) return { error: "Draft limit reached." };
    drafts.push({ to, subject: String(input.subject || ""), body: String(input.body || ""), label: String(input.label || "") });
    return { ok: true, drafts: drafts.length };
  }
  return { error: "Unknown tool " + name };
}

export default async function handler(req, res) {
  try { return await handle(req, res); }
  catch (e) { return res.status(500).json({ error: "Ask HQ crashed: " + (e?.message || String(e)) }); }
}

async function handle(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY } = process.env;
  if (req.method === "GET") return res.status(200).json({ ok: !!(ANTHROPIC_API_KEY && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY), model: MODEL, key: !!ANTHROPIC_API_KEY, db: !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) });
  if (req.method !== "POST") { res.setHeader("Allow", ["GET", "POST"]); return res.status(405).json({ error: "POST only" }); }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set in Vercel." });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const { data: { user } = {} } = bearer ? await sb.auth.getUser(bearer).catch(() => ({ data: {} })) : { data: {} };
  const email = String(user?.email || "").trim().toLowerCase();
  if (!email) return res.status(401).json({ error: "Sign in first" });
  let who = email;
  if (!OWNER_EMAILS.includes(email)) {
    const { data: c } = await sb.from("coaches").select("is_admin, is_approved, display_name").ilike("email", email).maybeSingle();
    if (!(c?.is_approved && c?.is_admin)) return res.status(403).json({ error: "Ask HQ is for admins." });
    who = c.display_name || email;
  }

  let body = req.body;
  try { body = typeof body === "string" ? JSON.parse(body) : (body || {}); } catch { return res.status(400).json({ error: "Invalid JSON" }); }
  const question = String(body.question || "").trim();
  if (!question) return res.status(400).json({ error: "Ask something first." });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const history = (Array.isArray(body.history) ? body.history : []).slice(-12)
    .filter(m => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.slice(0, 6000) }));
  const view = String(body.context?.view || "");

  // Attachments: the browser already put the file in hq-uploads. Claude reads
  // PDFs and images by URL (signed, 20 minutes); text-ish files are inlined.
  const attachments = (Array.isArray(body.attachments) ? body.attachments : []).slice(0, 6)
    .map(a => ({ name: String(a?.name || "file").slice(0, 120), type: String(a?.type || ""), path: String(a?.path || "") }))
    .filter(a => a.path && !a.path.includes("..") && a.path.split("/")[0] === email.replace(/[^a-z0-9]/gi, "_"));
  const blocks = [];
  for (const a of attachments) {
    if (a.type === "application/pdf" || a.type.startsWith("image/")) {
      const { data: signed, error } = await sb.storage.from("hq-uploads").createSignedUrl(a.path, 1200);
      if (error || !signed?.signedUrl) { blocks.push({ type: "text", text: `(Attachment "${a.name}" couldn't be read: ${error?.message || "no URL"})` }); continue; }
      blocks.push(a.type === "application/pdf"
        ? { type: "document", source: { type: "url", url: signed.signedUrl }, title: a.name }
        : { type: "image", source: { type: "url", url: signed.signedUrl } });
    } else if (/\.(xlsx|xlsm|xls|ods)$/i.test(a.name) || /spreadsheetml|ms-excel|opendocument\.spreadsheet/.test(a.type)) {
      // A workbook becomes one CSV per sheet, so every tab is read.
      const { data: file, error } = await sb.storage.from("hq-uploads").download(a.path);
      if (error || !file) { blocks.push({ type: "text", text: `(Attachment "${a.name}" couldn't be read)` }); continue; }
      try {
        const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { cellDates: true });
        const sheets = wb.SheetNames.map(n => `--- sheet "${n}" ---\n` + XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false, dateNF: "yyyy-mm-dd" }));
        blocks.push({ type: "text", text: `Attached workbook "${a.name}" (${wb.SheetNames.length} sheet${wb.SheetNames.length === 1 ? "" : "s"}):\n\n${sheets.join("\n\n").slice(0, 200000)}` });
      } catch (e) { blocks.push({ type: "text", text: `(Attachment "${a.name}" isn't a workbook I can open: ${e.message})` }); }
    } else if (/^text\/|json$/.test(a.type) || /\.(csv|txt|md|json|tsv)$/i.test(a.name)) {
      const { data: file, error } = await sb.storage.from("hq-uploads").download(a.path);
      if (error || !file) { blocks.push({ type: "text", text: `(Attachment "${a.name}" couldn't be read)` }); continue; }
      const text = (await file.text()).slice(0, 200000);
      blocks.push({ type: "text", text: `Attached file "${a.name}":\n\n${text}` });
    } else {
      blocks.push({ type: "text", text: `(Attachment "${a.name}" is a ${a.type || "file"} — I can read PDFs, images, Excel, CSV and text. Export it as one of those.)` });
    }
  }

  const userText = `Today is ${today} (Central). The admin is on the "${view || "home"}" screen.${attachments.length ? " Attached: " + attachments.map(a => a.name).join(", ") + "." : ""}\n\n${question}`;
  const messages = [...history, { role: "user", content: blocks.length ? [...blocks, { type: "text", text: userText }] : userText }];
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const started = Date.now();
  const trail = [], drafts = [], proposals = [];
  const ctx = { who, files: attachments.map(a => ({ name: a.name, path: a.path })), proposals };
  let usage = { input: 0, output: 0 }, answer = "", turns = 0;
  try {
    while (turns++ < MAX_TURNS) {
      const r = await client.messages.create({
        model: MODEL, max_tokens: 6000,
        thinking: { type: "adaptive" }, output_config: { effort: "medium" },
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        tools, messages,
      });
      usage.input += r.usage?.input_tokens || 0; usage.output += r.usage?.output_tokens || 0;
      messages.push({ role: "assistant", content: r.content });
      const uses = r.content.filter(b => b.type === "tool_use");
      if (r.stop_reason !== "tool_use" || !uses.length) {
        answer = r.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
        break;
      }
      const results = [];
      for (const u of uses) {
        const t0 = Date.now();
        const out = await runTool(sb, u.name, u.input || {}, drafts, ctx);
        trail.push({ name: u.name, input: u.name === "sql" ? String(u.input?.query || "").slice(0, 400) : (u.name === "describe_table" ? u.input?.table : u.name === "propose_changes" ? (u.input?.summary || "") + " · " + (out.accepted ?? 0) + " changes" : u.input?.label || u.input?.subject), ms: Date.now() - t0, rows: out.rows ?? (out.data ? out.data.length : undefined), error: out.error });
        results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out).slice(0, 60000), is_error: !!out.error });
      }
      messages.push({ role: "user", content: results });
    }
    if (!answer) answer = proposals.length ? "Proposed changes are below — review and tap Apply." : drafts.length ? "Drafted — see below." : "I ran out of steps before finishing. Try narrowing the question.";
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `Claude API ${e.status}: ${e.message}` : (e.message || String(e));
    await log(sb, { asked_by: who, question, answer: "ERROR " + msg, tool_calls: trail, view, ms: Date.now() - started });
    return res.status(502).json({ error: msg });
  }
  await log(sb, { asked_by: who, question, answer, tool_calls: trail, view, attachments: attachments.map(a => ({ name: a.name, path: a.path })), input_tokens: usage.input, output_tokens: usage.output, ms: Date.now() - started });
  return res.status(200).json({ answer, tools: trail, drafts, proposals, usage, ms: Date.now() - started });
}
