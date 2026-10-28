// DSSC Tasks & Projects. Projects (Drew, Oct 14 2026): projects of task cards -
// details, checklist, files, comments - assigned to staff, with Slack updates
// as cards move, a Monday email of what needs an update (api/projects-weekly.js),
// and Claude drafting a whole project from a typed brief.
// Tasks (Oct 28 2026: "a full task tracking application for all of my team
// members"): a task no longer needs a project. Tasks repeat daily, weekly or
// monthly (dssc_task_series, shared/task-recurrence.js), sit in a category and
// any number of departments, carry a blocker and a help request, and can point
// at the HQ screen the work happens in. A daily run (api/tasks-daily.js) makes
// the repeats, closes missed daily ones and posts the Slack digest.
//
// POST /api/projects  { action, ... }   Authorization: Bearer <session token>
//   bootstrap                       -> { me, people, projects (with counts), tasks, series, myTasks, settings }
//   project   { id }                -> { project, tasks, files, updates }
//   task      { id }                -> { task, project, series, updates, files }
//   create_project { project, tasks[], quiet? }  (managers) one project + its cards
//                  (quiet, scripts only: no Slack post, no assignment emails)
//   save_project   { project }            (managers) edit name/summary/status/owner/team/dates
//   save_task      { task }               add or edit a task; no project_id = a standalone task
//   delete_task    { id }                 managers, or whoever added it
//   comment        { project_id?, task_id?, body }
//   help           { task_id, note, from_email? }   ask for help (from_email: one person, else anyone)
//   help_done      { task_id }            the help request is sorted
//   save_series    { series }             add or edit a repeating task (managers; anyone for their own)
//   delete_series  { id }                 stop it repeating and drop its open future copies
//   upload_url     { project_id?, task_id?, name, size, mime } -> { path, token }  (then the
//                  browser uploads to the private bucket and calls file_done)
//   file_done      { project_id?, task_id?, name, path, size, mime }
//   file_url       { id } -> { url }      a one-hour signed link
//   delete_file    { id }
//   ai_draft       { brief } -> { draft }  Claude turns a brief into a project + cards (not saved)
//   settings       { slack_webhook?, weekly_email?, daily_digest?, categories?, departments?, slack_ids? }   (managers)
//   test_slack                            (managers)
//
// Slack: new tasks, status changes, blockers, assignments, comments, help
// requests and files post one line to the webhook in settings (skipped if
// none), @mentioning people whose Slack member ID is in settings. Email:
// whoever is assigned a task by someone else gets one email (a new project
// sends each person one email listing their cards); a help request emails the
// person asked (or the managers).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, RESEND_API_KEY,
//      DSSC_FROM_EMAIL (or DSE_FROM_EMAIL), optional SLACK_PROJECTS_WEBHOOK_URL.
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { claudeClient } from "./_lib/ai-client.js";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { whoIs, OWNER_EMAILS, people as listPeople, slack, slackHook, slackLine, slackText, SLACK_HOOK, sendMail, emailShell, esc, link, fmtDate,
  centralToday, addDays, BUCKET, STATUS, STATUS_LABEL, PROJECT_STATUS, APP_URL } from "./_lib/projects.js";
import { taskLink, mention, taskSlackLine, settingsRow, seriesTaskFields, generateRecurring, generateIfStale } from "./_lib/tasks.js";
import { HQ_VIEWS } from "../shared/task-meta.js";
import { describeRepeat } from "../shared/task-recurrence.js";

export const config = { maxDuration: 120 };

const MODEL = "claude-opus-5-5";
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const nrm = (v) => String(v || "").trim().toLowerCase();
const clip = (s, n) => String(s ?? "").trim().slice(0, n);
const dateOrNull = (v) => (ISO.test(String(v || "")) ? String(v) : null);
const STATUS_ICON = { todo: "⬜", doing: "🔄", blocked: "⛔", done: "✅", skipped: "⏭" };

class Bad extends Error { constructor(msg, code = 400) { super(msg); this.code = code; } }

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const me = await whoIs(sb, req, SUPABASE_SERVICE_ROLE_KEY);
  if (!me) return res.status(403).json({ error: "Tasks & Projects are for DSSC staff." });
  let body = req.body;
  try { body = typeof body === "string" ? JSON.parse(body) : (body || {}); } catch { return res.status(400).json({ error: "Invalid JSON" }); }
  res.setHeader("Cache-Control", "no-store");
  try {
    const fn = ACTIONS[body.action];
    if (!fn) throw new Bad("Unknown action");
    return res.status(200).json({ ok: true, ...(await fn(sb, me, body)) });
  } catch (e) {
    return res.status(e.code || 500).json({ error: e.message || "Something went wrong" });
  }
}

const must = (cond, msg, code) => { if (!cond) throw new Bad(msg, code); };
const managerOnly = (me) => must(me.manager, "Only the DSSC admins can do that.", 403);
async function projectRow(sb, id) {
  const { data, error } = await sb.from("dssc_projects").select("*").eq("id", Number(id)).maybeSingle();
  if (error) throw new Error(error.message);
  must(data, "That project isn't there any more.", 404);
  return data;
}
async function taskRow(sb, id) {
  const { data, error } = await sb.from("dssc_project_tasks").select("*").eq("id", Number(id)).maybeSingle();
  if (error) throw new Error(error.message);
  must(data, "That task isn't there any more.", 404);
  return data;
}
const projectOf = async (sb, t) => (t.project_id ? projectRow(sb, t.project_id) : null);
async function logUpdate(sb, me, project_id, task_id, kind, body) {
  await sb.from("dssc_project_updates").insert({ project_id: project_id || null, task_id: task_id || null, kind, body: body || null, author_name: me.name, author_email: me.email });
}
const first = (name) => String(name || "").split(/\s+/)[0] || name;
const isOpen = (t) => t.status !== "done" && t.status !== "skipped";

// ── Field cleaning ──────────────────────────────────────────────────────────
function cleanTeam(arr, ppl) {
  const byEmail = new Map(ppl.map(p => [p.email, p]));
  return (Array.isArray(arr) ? arr : []).map(x => nrm(typeof x === "string" ? x : x?.email)).filter((e, i, a) => e && a.indexOf(e) === i && byEmail.has(e)).slice(0, 15)
    .map(e => ({ email: e, name: byEmail.get(e).name }));
}
function cleanChecklist(arr) {
  return (Array.isArray(arr) ? arr : []).slice(0, 100).map((x, i) => ({
    id: clip(x?.id || ("c" + Date.now().toString(36) + i), 20), text: clip(typeof x === "string" ? x : x?.text, 300), done: !!x?.done,
  })).filter(x => x.text);
}
function personFor(email, ppl) {
  const e = nrm(email);
  if (!e) return { assignee_email: null, assignee_name: null };
  const p = ppl.find(x => x.email === e);
  must(p, "Pick someone from the staff list.");
  return { assignee_email: p.email, assignee_name: p.name };
}
const cleanList = (arr, n = 12) => [...new Set((Array.isArray(arr) ? arr : []).map(x => clip(x, 60)).filter(Boolean))].slice(0, n);
const cleanUrl = (v) => { const u = clip(v, 1000); if (!u) return null; must(/^https?:\/\/\S+$/i.test(u), "A link has to start with http:// or https://."); return u; };
const cleanView = (v) => { const x = clip(v, 40); if (!x) return null; must(HQ_VIEWS.some(h => h[0] === x), "Unknown HQ screen."); return x; };
// The fields a task and a series share.
function cleanCommon(t, ppl, out = {}) {
  if ("details" in t) out.details = clip(t.details, 20000) || null;
  if ("priority" in t) { must(["low", "normal", "high"].includes(t.priority), "Unknown priority."); out.priority = t.priority; }
  if ("checklist" in t) out.checklist = cleanChecklist(t.checklist);
  if ("helpers" in t) out.helpers = cleanTeam(t.helpers, ppl);
  if ("assignee_email" in t) Object.assign(out, personFor(t.assignee_email, ppl));
  if ("category" in t) out.category = clip(t.category, 60) || null;
  if ("departments" in t) out.departments = cleanList(t.departments);
  if ("hq_view" in t) out.hq_view = cleanView(t.hq_view);
  if ("link_url" in t) out.link_url = cleanUrl(t.link_url);
  return out;
}
function cleanTaskFields(t, ppl) {
  const out = {};
  if ("title" in t) { out.title = clip(t.title, 300); must(out.title, "A task needs a title."); }
  if ("section" in t) out.section = clip(t.section, 80) || null;
  if ("status" in t) { must(STATUS.includes(t.status), "Unknown status."); out.status = t.status; }
  if ("due_date" in t) out.due_date = dateOrNull(t.due_date);
  if ("sort" in t && Number.isFinite(+t.sort)) out.sort = Math.round(+t.sort);
  if ("blocker" in t) out.blocker = clip(t.blocker, 2000) || null;
  if ("project_id" in t) out.project_id = t.project_id ? Number(t.project_id) : null;
  return cleanCommon(t, ppl, out);
}
function cleanSeriesFields(s, ppl) {
  const out = {};
  if ("title" in s) { out.title = clip(s.title, 300); must(out.title, "A repeating task needs a title."); }
  if ("frequency" in s) { must(["daily", "weekly", "monthly"].includes(s.frequency), "Pick daily, weekly or monthly."); out.frequency = s.frequency; }
  if ("every_n" in s) out.every_n = Math.min(12, Math.max(1, Math.round(Number(s.every_n) || 1)));
  if ("weekdays" in s) out.weekdays = [...new Set((Array.isArray(s.weekdays) ? s.weekdays : []).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))];
  if ("monthday" in s) { const m = s.monthday == null || s.monthday === "" ? null : Math.round(Number(s.monthday)); must(m == null || m === -1 || (m >= 1 && m <= 31), "Pick a day of the month (1-31, or the last day)."); out.monthday = m; }
  if ("starts_on" in s) { out.starts_on = dateOrNull(s.starts_on); must(out.starts_on, "Pick the date it starts."); }
  if ("ends_on" in s) out.ends_on = dateOrNull(s.ends_on);
  if ("active" in s) out.active = !!s.active;
  return cleanCommon(s, ppl, out);
}
function cleanProjectFields(p, ppl) {
  const out = {};
  if ("name" in p) { out.name = clip(p.name, 160); must(out.name, "A project needs a name."); }
  if ("summary" in p) out.summary = clip(p.summary, 5000) || null;
  if ("status" in p) { must(PROJECT_STATUS.includes(p.status), "Unknown project status."); out.status = p.status; }
  if ("start_date" in p) out.start_date = dateOrNull(p.start_date);
  if ("due_date" in p) out.due_date = dateOrNull(p.due_date);
  if ("icon" in p) out.icon = clip(p.icon, 8) || null;
  if ("team" in p) out.team = cleanTeam(p.team, ppl);
  if ("owner_email" in p) { const o = personFor(p.owner_email, ppl); out.owner_email = o.assignee_email; out.owner_name = o.assignee_name; }
  return out;
}

// ── Emails ──────────────────────────────────────────────────────────────────
const button = (href, text) => `<p><a href="${esc(href)}" style="display:inline-block;background:#B2D049;color:#104946;font-weight:700;padding:9px 14px;border-radius:8px;text-decoration:none">${esc(text)}</a></p>`;
async function emailAssigned(project, tasks, to, by) {
  if (!to?.email || nrm(to.email) === nrm(by.email)) return;
  const rows = tasks.map(t => `<li style="margin-bottom:6px"><a href="${esc(taskLink(t))}" style="color:#0F8B76;font-weight:600">${esc(t.title)}</a>${t.due_date ? ` <span style="color:#667">- due ${esc(fmtDate(t.due_date))}</span>` : ""}</li>`).join("");
  const where = project ? ` on <b>${esc(project.name)}</b>` : "";
  const html = emailShell(`<p>Hi ${esc(first(to.name))},</p>
    <p>${esc(by.name)} assigned you ${tasks.length === 1 ? "a task" : tasks.length + " tasks"}${where}:</p>
    <ul style="padding-left:18px">${rows}</ul>
    ${button(project ? link(project.id) : taskLink(tasks[0]), project ? "Open the project" : "Open the task")}
    <p style="color:#667">Open a task to add notes, files and updates, flag a blocker or ask for help. You'll get a Monday email with anything that's due or needs an update.</p>`);
  const text = `Hi ${first(to.name)},\n\n${by.name} assigned you ${tasks.length === 1 ? "a task" : tasks.length + " tasks"}${project ? " on " + project.name : ""}:\n${tasks.map(t => `- ${t.title}${t.due_date ? " (due " + fmtDate(t.due_date) + ")" : ""}: ${taskLink(t)}`).join("\n")}\n`;
  await sendMail({ to: to.email, subject: `${project ? project.name + ": " : ""}${tasks.length === 1 ? tasks[0].title : tasks.length + " tasks"} assigned to you`, html, text, replyTo: by.email });
}

// ── Actions ─────────────────────────────────────────────────────────────────
const ACTIONS = {
  async bootstrap(sb, me, b) {
    const today = centralToday();
    const settings = await settingsRow(sb);
    await generateIfStale(sb, today, settings);
    // Every open task, and the closed ones from the last 120 days (for the scorecard).
    const since = new Date(Date.now() - 120 * 864e5).toISOString();
    const COLS = "id, project_id, series_id, title, section, status, priority, due_date, assignee_email, assignee_name, helpers, category, departments, blocker, help_requested_at, help_note, help_from, help_by, hq_view, link_url, checklist, created_by, created_at, completed_at, completed_by, last_activity_at";
    const [{ data: projects, error: pErr }, { data: openTasks, error: tErr }, { data: closed, error: cErr }, ppl, { data: series }] = await Promise.all([
      sb.from("dssc_projects").select("*").order("due_date", { ascending: true, nullsFirst: false }).order("id"),
      sb.from("dssc_project_tasks").select(COLS).in("status", ["todo", "doing", "blocked"]).limit(3000),
      sb.from("dssc_project_tasks").select(COLS).in("status", ["done", "skipped"]).or(`completed_at.gte.${since},and(completed_at.is.null,updated_at.gte.${since})`).limit(5000),
      listPeople(sb),
      sb.from("dssc_task_series").select("*").order("title"),
    ]);
    if (pErr || tErr || cErr) throw new Error((pErr || tErr || cErr).message);
    const all = [...(openTasks || []), ...(closed || [])];
    const byP = new Map();
    for (const t of all) { if (!t.project_id) continue; if (!byP.has(t.project_id)) byP.set(t.project_id, []); byP.get(t.project_id).push(t); }
    // Older finished cards still count toward a project's progress.
    const { data: counts } = await sb.from("dssc_project_tasks").select("project_id, status").not("project_id", "is", null);
    const totals = new Map();
    for (const t of counts || []) { const c = totals.get(t.project_id) || { total: 0, done: 0 }; c.total++; if (!isOpen(t)) c.done++; totals.set(t.project_id, c); }
    const mine = (t) => nrm(t.assignee_email) === me.email || (t.helpers || []).some(h => nrm(h.email) === me.email);
    const out = (projects || []).filter(p => b.archived || p.status !== "archived").map(p => {
      const ts = (byP.get(p.id) || []).filter(isOpen);
      const c = totals.get(p.id) || { total: 0, done: 0 };
      return { ...p, counts: { total: c.total, done: c.done, overdue: ts.filter(t => t.due_date && t.due_date < today).length, blocked: ts.filter(t => t.status === "blocked").length, mine: ts.filter(mine).length } };
    });
    const pmap = new Map((projects || []).map(p => [p.id, p]));
    const tasks = all.filter(t => !t.project_id || (pmap.has(t.project_id) && pmap.get(t.project_id).status !== "archived"))
      .map(t => ({ ...t, project_name: t.project_id ? pmap.get(t.project_id)?.name || null : null }));
    const myTasks = tasks.filter(t => isOpen(t) && mine(t)).sort((a, c) => (a.due_date || "9999").localeCompare(c.due_date || "9999"));
    const hook = settings.slack_webhook || process.env.SLACK_PROJECTS_WEBHOOK_URL || "";
    return { me, today, people: ppl, projects: out, tasks, myTasks, series: series || [],
      settings: { slack: !!hook, slackFromEnv: !settings.slack_webhook && !!process.env.SLACK_PROJECTS_WEBHOOK_URL, weeklyEmail: settings.weekly_email !== false, lastWeeklyAt: settings.last_weekly_at || null,
        dailyDigest: settings.daily_digest !== false, lastDailyAt: settings.last_daily_at || null,
        categories: settings.categories, departments: settings.departments, slackIds: settings.slack_ids } };
  },

  async project(sb, me, b) {
    const project = await projectRow(sb, b.id);
    const [{ data: tasks }, { data: files }, { data: updates }] = await Promise.all([
      sb.from("dssc_project_tasks").select("*").eq("project_id", project.id).order("sort").order("id"),
      sb.from("dssc_project_files").select("id, task_id, name, size, mime, uploaded_by, created_at").eq("project_id", project.id),
      sb.from("dssc_project_updates").select("id, task_id, kind, body, author_name, created_at").eq("project_id", project.id).order("created_at", { ascending: false }).limit(300),
    ]);
    const fileCount = {}, commentCount = {};
    for (const f of files || []) if (f.task_id) fileCount[f.task_id] = (fileCount[f.task_id] || 0) + 1;
    for (const u of updates || []) if (u.task_id && u.kind === "comment") commentCount[u.task_id] = (commentCount[u.task_id] || 0) + 1;
    return {
      project,
      tasks: (tasks || []).map(t => ({ ...t, files: fileCount[t.id] || 0, comments: commentCount[t.id] || 0 })),
      files: (files || []).filter(f => !f.task_id),
      updates: (updates || []).slice(0, 40),
    };
  },

  async task(sb, me, b) {
    const task = await taskRow(sb, b.id);
    const [{ data: updates }, { data: files }, project, { data: series }] = await Promise.all([
      sb.from("dssc_project_updates").select("id, kind, body, author_name, author_email, created_at").eq("task_id", task.id).order("created_at"),
      sb.from("dssc_project_files").select("id, name, size, mime, uploaded_by, created_at").eq("task_id", task.id).order("created_at"),
      task.project_id ? sb.from("dssc_projects").select("id, name, status").eq("id", task.project_id).maybeSingle().then(r => r.data) : null,
      task.series_id ? sb.from("dssc_task_series").select("*").eq("id", task.series_id).maybeSingle() : { data: null },
    ]);
    return { task, project, series: series || null, updates: updates || [], files: files || [] };
  },

  async create_project(sb, me, b) {
    managerOnly(me);
    const ppl = await listPeople(sb);
    const p = cleanProjectFields({ status: "active", ...(b.project || {}) }, ppl);
    must(p.name, "A project needs a name.");
    const cards = (Array.isArray(b.tasks) ? b.tasks : []).slice(0, 200);
    // Every row carries every column: a bulk insert fills a column one row
    // leaves out with null, not its default.
    const cleaned = cards.map((t, i) => ({ section: null, details: null, due_date: null, assignee_email: null, assignee_name: null, checklist: [], helpers: [], category: null, departments: [],
      ...cleanTaskFields({ status: "todo", priority: "normal", ...t }, ppl), sort: (i + 1) * 10 }));
    for (const t of cleaned) delete t.project_id;
    const { data: project, error } = await sb.from("dssc_projects").insert({ ...p, created_by: me.email }).select().single();
    if (error) throw new Error(error.message);
    let tasks = [];
    if (cleaned.length) {
      const { data, error: tErr } = await sb.from("dssc_project_tasks").insert(cleaned.map(t => ({ ...t, project_id: project.id, created_by: me.email }))).select();
      if (tErr) { await sb.from("dssc_projects").delete().eq("id", project.id); throw new Error("Couldn't add the cards: " + tErr.message); }
      tasks = data || [];
    }
    await logUpdate(sb, me, project.id, null, "created", `Created the project with ${tasks.length} card${tasks.length === 1 ? "" : "s"}.`);
    // quiet: a script setting a project up for review - no Slack, no emails.
    if (me.service && b.quiet) return { project, tasks };
    const lines = [`📌 ${slackText(me.name)} started a new project${project.owner_name ? ` (owner: ${slackText(project.owner_name)})` : ""}${project.due_date ? `, due ${fmtDate(project.due_date)}` : ""} - ${tasks.length} card${tasks.length === 1 ? "" : "s"}.`];
    await slack(sb, slackLine(project, lines.join(" ")));
    // One email per person with all of their cards.
    const byPerson = new Map();
    for (const t of tasks) if (t.assignee_email) { if (!byPerson.has(t.assignee_email)) byPerson.set(t.assignee_email, { name: t.assignee_name, list: [] }); byPerson.get(t.assignee_email).list.push(t); }
    for (const [email, x] of byPerson) await emailAssigned(project, x.list, { email, name: x.name }, me);
    return { project, tasks };
  },

  async save_project(sb, me, b) {
    managerOnly(me);
    const ppl = await listPeople(sb);
    const before = await projectRow(sb, b.project?.id);
    const fields = cleanProjectFields(b.project || {}, ppl);
    delete fields.id;
    const { data: project, error } = await sb.from("dssc_projects").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", before.id).select().single();
    if (error) throw new Error(error.message);
    if (fields.status && fields.status !== before.status) {
      await logUpdate(sb, me, project.id, null, "status", `Project marked ${fields.status.replace("_", " ")}.`);
      await slack(sb, slackLine(project, `${fields.status === "done" ? "🏁" : "🔁"} ${slackText(me.name)} marked the project *${fields.status.replace("_", " ")}*.`));
    }
    if ("owner_email" in fields && fields.owner_email !== before.owner_email && fields.owner_email) {
      await logUpdate(sb, me, project.id, null, "assigned", `Owner is now ${fields.owner_name}.`);
      await slack(sb, slackLine(project, `👤 ${slackText(me.name)} made ${slackText(fields.owner_name)} the owner.`));
    }
    return { project };
  },

  async save_task(sb, me, b) {
    const [ppl, st] = await Promise.all([listPeople(sb), settingsRow(sb)]);
    const t = b.task || {};
    const now = new Date().toISOString();
    if (!t.id) {
      const project = t.project_id ? await projectRow(sb, t.project_id) : null;
      const fields = cleanTaskFields({ status: "todo", priority: "normal", ...t }, ppl);
      must(fields.title, "A task needs a title.");
      fields.project_id = project?.id || null;
      if (project && !("sort" in fields)) { const { data: last } = await sb.from("dssc_project_tasks").select("sort").eq("project_id", project.id).order("sort", { ascending: false }).limit(1); fields.sort = ((last?.[0]?.sort) || 0) + 10; }
      if (fields.status === "done") { fields.completed_at = now; fields.completed_by = me.name; }
      const { data: task, error } = await sb.from("dssc_project_tasks").insert({ ...fields, created_by: me.email }).select().single();
      if (error) throw new Error(error.message);
      await logUpdate(sb, me, project?.id, task.id, "created", "Added this task.");
      const who = task.assignee_email ? ` for ${mention(st, task.assignee_email, task.assignee_name)}` : "";
      await slack(sb, taskSlackLine(task, project, `🆕 ${slackText(me.name)} added it${who}${task.due_date ? `, due ${fmtDate(task.due_date)}` : ""}${task.category ? ` (${slackText(task.category)})` : ""}.`));
      if (task.assignee_email) await emailAssigned(project, [task], { email: task.assignee_email, name: task.assignee_name }, me);
      return { task };
    }
    const before = await taskRow(sb, t.id);
    const fields = cleanTaskFields(t, ppl);
    if ("project_id" in fields && fields.project_id) await projectRow(sb, fields.project_id);
    if ("project_id" in fields && fields.project_id === before.project_id) delete fields.project_id;
    if (fields.status && fields.status !== before.status) {
      fields.completed_at = fields.status === "done" || fields.status === "skipped" ? now : null;
      fields.completed_by = fields.status === "done" ? me.name : null;
      // A blocker belongs to the blocked spell: moving on clears it (it stays in the trail).
      if (fields.status !== "blocked" && !("blocker" in fields)) fields.blocker = null;
    }
    const { data: task, error } = await sb.from("dssc_project_tasks").update({ ...fields, updated_at: now, last_activity_at: now }).eq("id", before.id).select().single();
    if (error) throw new Error(error.message);
    const project = await projectOf(sb, task);
    // The trail and Slack: status, blocker, assignee, due date. Text edits are quiet.
    const notes = [];
    if (fields.status && fields.status !== before.status) {
      await logUpdate(sb, me, task.project_id, task.id, "status", `Moved to ${STATUS_LABEL[fields.status]}.${fields.status === "blocked" && task.blocker ? " Blocked on: " + task.blocker : ""}`);
      if (fields.status === "done") notes.push(`✅ ${slackText(me.name)} finished it${task.due_date && task.due_date < centralToday() ? ` (${fmtDate(task.due_date)} due date)` : ""}`);
      else if (fields.status === "blocked") notes.push(`⛔ ${slackText(me.name)} is blocked${task.blocker ? `: "${slackText(task.blocker)}"` : ""}`);
      else notes.push(`${STATUS_ICON[fields.status]} ${slackText(me.name)} moved it to ${STATUS_LABEL[fields.status]}`);
    } else if ("blocker" in fields && fields.blocker && fields.blocker !== before.blocker && task.status === "blocked") {
      await logUpdate(sb, me, task.project_id, task.id, "status", "Blocked on: " + fields.blocker);
      notes.push(`⛔ Blocker: "${slackText(fields.blocker)}"`);
    }
    if ("assignee_email" in fields && fields.assignee_email !== before.assignee_email) {
      await logUpdate(sb, me, task.project_id, task.id, "assigned", fields.assignee_name ? `Assigned to ${fields.assignee_name}.` : "Unassigned.");
      notes.push(fields.assignee_name ? `👤 ${slackText(me.name)} assigned it to ${mention(st, fields.assignee_email, fields.assignee_name)}` : "👤 now unassigned");
      if (fields.assignee_email) await emailAssigned(project, [task], { email: fields.assignee_email, name: fields.assignee_name }, me);
    }
    if ("due_date" in fields && fields.due_date !== before.due_date) {
      await logUpdate(sb, me, task.project_id, task.id, "due", fields.due_date ? `Due ${fmtDate(fields.due_date)}.` : "No due date.");
      if (!notes.length) notes.push(`📅 now ${fields.due_date ? "due " + fmtDate(fields.due_date) : "undated"}`);
      if (fields.due_date && fields.due_date >= centralToday()) await sb.from("dssc_project_tasks").update({ overdue_notified_at: null }).eq("id", task.id);
    }
    if (notes.length) await slack(sb, taskSlackLine(task, project, notes.join(" · ") + "."));
    return { task };
  },

  async delete_task(sb, me, b) {
    const task = await taskRow(sb, b.id);
    must(me.manager || nrm(task.created_by) === me.email, "Only the DSSC admins, or whoever added it, can delete a task.", 403);
    const { data: files } = await sb.from("dssc_project_files").select("path").eq("task_id", task.id);
    if (files?.length) await sb.storage.from(BUCKET).remove(files.map(f => f.path));
    const { error } = await sb.from("dssc_project_tasks").delete().eq("id", task.id);
    if (error) throw new Error(error.message);
    if (task.project_id) await logUpdate(sb, me, task.project_id, null, "edit", `Deleted the card "${task.title}".`);
    return { deleted: task.id };
  },

  async comment(sb, me, b) {
    const text = clip(b.body, 5000);
    must(text, "Write something first.");
    let task = null, project = null;
    if (b.task_id) { task = await taskRow(sb, b.task_id); project = await projectOf(sb, task); }
    else project = await projectRow(sb, b.project_id);
    must(!b.project_id || !task || task.project_id === Number(b.project_id), "That task is on another project.");
    await logUpdate(sb, me, project?.id, task?.id, "comment", text);
    if (task) await sb.from("dssc_project_tasks").update({ last_activity_at: new Date().toISOString() }).eq("id", task.id);
    const snip = text.length > 220 ? text.slice(0, 217) + "…" : text;
    if (task) {
      // Feedback reaches the person doing it (or whoever added it, if that's who's writing).
      const st = await settingsRow(sb);
      const to = nrm(task.assignee_email) && nrm(task.assignee_email) !== me.email ? mention(st, task.assignee_email, task.assignee_name)
        : nrm(task.created_by) && nrm(task.created_by) !== me.email ? mention(st, task.created_by, "") : "";
      await slack(sb, taskSlackLine(task, project, `💬 ${slackText(me.name)}${to ? " → " + to : ""}: "${slackText(snip)}"`));
    } else await slack(sb, slackLine(project, `💬 ${slackText(me.name)}: "${slackText(snip)}"`));
    return { ok: true };
  },

  // "The ability to ask for help": flags the task, tells Slack (pinging the
  // person asked), and emails them - or the managers when it's open to anyone.
  async help(sb, me, b) {
    const task = await taskRow(sb, b.task_id);
    const note = clip(b.note, 2000);
    must(note, "Say what you need help with.");
    const ppl = await listPeople(sb);
    const from = nrm(b.from_email) ? ppl.find(p => p.email === nrm(b.from_email)) : null;
    must(!nrm(b.from_email) || from, "Pick someone from the staff list.");
    const now = new Date().toISOString();
    await sb.from("dssc_project_tasks").update({ help_requested_at: now, help_note: note, help_from: from?.email || null, help_by: me.email, last_activity_at: now }).eq("id", task.id);
    await logUpdate(sb, me, task.project_id, task.id, "help", `Asked ${from ? from.name : "the team"} for help: ${note}`);
    const [st, project] = await Promise.all([settingsRow(sb), projectOf(sb, task)]);
    await slack(sb, taskSlackLine(task, project, `🙋 ${slackText(me.name)} needs help${from ? " from " + mention(st, from.email, from.name) : ""}: "${slackText(note)}"`));
    // Open to anyone: Slack carries it to the team; Drew gets the email.
    const to = from ? [from] : ppl.filter(p => OWNER_EMAILS.includes(p.email) && p.email !== me.email).slice(0, 1);
    for (const p of to) {
      const html = emailShell(`<p>Hi ${esc(first(p.name))},</p><p><b>${esc(me.name)}</b> asked ${from ? "you" : "the team"} for help on <b>${esc(task.title)}</b>${project ? ` (${esc(project.name)})` : ""}:</p><blockquote style="margin:0 0 12px;padding:8px 12px;border-left:3px solid #B2D049;color:#333">${esc(note)}</blockquote>${button(taskLink(task), "Open the task")}<p style="color:#667">Reply on the task so everyone can see it, and press "Help sorted" when it's done.</p>`);
      await sendMail({ to: p.email, subject: `${me.name} needs help: ${task.title}`, html, text: `${me.name} asked for help on "${task.title}": ${note}\n\n${taskLink(task)}`, replyTo: me.email });
    }
    return { ok: true };
  },

  async help_done(sb, me, b) {
    const task = await taskRow(sb, b.task_id);
    if (!task.help_requested_at) return { ok: true };
    await sb.from("dssc_project_tasks").update({ help_requested_at: null, help_note: null, help_from: null, help_by: null, last_activity_at: new Date().toISOString() }).eq("id", task.id);
    await logUpdate(sb, me, task.project_id, task.id, "help", "Help sorted.");
    const project = await projectOf(sb, task);
    await slack(sb, taskSlackLine(task, project, `🤝 ${slackText(me.name)} marked the help request sorted.`));
    return { ok: true };
  },

  // A repeating task. Managers set them for anyone; others for themselves.
  async save_series(sb, me, b) {
    const [ppl, st] = await Promise.all([listPeople(sb), settingsRow(sb)]);
    const s = b.series || {};
    const today = centralToday();
    const fields = cleanSeriesFields(s, ppl);
    const forOther = (email) => nrm(email) && nrm(email) !== me.email;
    if (!s.id) {
      must(fields.title && fields.frequency, "A repeating task needs a title and how often it repeats.");
      must(me.manager || !forOther(fields.assignee_email), "Only the DSSC admins can set repeating tasks for someone else.", 403);
      if (!fields.starts_on) fields.starts_on = today;
      const { data: series, error } = await sb.from("dssc_task_series").insert({ ...fields, created_by: me.email }).select().single();
      if (error) throw new Error(error.message);
      const gen = await generateRecurring(sb, today, { only: series.id });
      await slack(sb, `🔁 ${slackText(me.name)} set up a repeating task: *${slackText(series.title)}* - ${slackText(describeRepeat(series))}${series.assignee_email ? ` for ${mention(st, series.assignee_email, series.assignee_name)}` : ""}.`);
      if (series.assignee_email && forOther(series.assignee_email)) {
        const p = { email: series.assignee_email, name: series.assignee_name };
        const html = emailShell(`<p>Hi ${esc(first(p.name))},</p><p>${esc(me.name)} gave you a repeating task: <b>${esc(series.title)}</b> (${esc(describeRepeat(series))}).</p><p>Each one shows up in HQ ahead of its due date. Mark it done each time.</p>${button(APP_URL + "?view=projects", "Open Tasks")}`);
        await sendMail({ to: p.email, subject: `Repeating task: ${series.title} (${describeRepeat(series)})`, html, text: `${me.name} gave you a repeating task: ${series.title} (${describeRepeat(series)}).\n${APP_URL}?view=projects`, replyTo: me.email });
      }
      return { series, created: gen.created };
    }
    const { data: before } = await sb.from("dssc_task_series").select("*").eq("id", Number(s.id)).maybeSingle();
    must(before, "That repeating task isn't there any more.", 404);
    must(me.manager || (!forOther(before.assignee_email) && !forOther(fields.assignee_email ?? before.assignee_email)), "Only the DSSC admins can change someone else's repeating task.", 403);
    const timing = ["frequency", "every_n", "weekdays", "monthday", "starts_on", "ends_on"].some(k => k in fields && JSON.stringify(fields[k]) !== JSON.stringify(before[k]));
    const { data: series, error } = await sb.from("dssc_task_series").update({ ...fields, updated_at: new Date().toISOString(), ...(timing ? { last_generated_on: addDays(today, -1) } : {}) }).eq("id", before.id).select().single();
    if (error) throw new Error(error.message);
    // Copies not started yet follow the change: the wording and owner always,
    // and a new schedule replaces the not-started future ones.
    const copy = seriesTaskFields(series); delete copy.checklist;
    await sb.from("dssc_project_tasks").update({ ...copy, updated_at: new Date().toISOString() }).eq("series_id", series.id).in("status", ["todo", "doing", "blocked"]).gte("due_date", today);
    if (timing || series.active === false) await sb.from("dssc_project_tasks").delete().eq("series_id", series.id).eq("status", "todo").gt("due_date", today).is("help_requested_at", null);
    const gen = series.active ? await generateRecurring(sb, today, { only: series.id }) : { created: 0 };
    return { series, created: gen.created };
  },

  async delete_series(sb, me, b) {
    const { data: s } = await sb.from("dssc_task_series").select("*").eq("id", Number(b.id)).maybeSingle();
    must(s, "That repeating task isn't there any more.", 404);
    must(me.manager || nrm(s.assignee_email) === me.email || nrm(s.created_by) === me.email, "Only the DSSC admins can stop someone else's repeating task.", 403);
    // Future copies nobody has started go; anything done or started stays (with its history).
    await sb.from("dssc_project_tasks").delete().eq("series_id", s.id).eq("status", "todo").gte("due_date", centralToday()).is("help_requested_at", null);
    const { error } = await sb.from("dssc_task_series").delete().eq("id", s.id);
    if (error) throw new Error(error.message);
    await slack(sb, `🛑 ${slackText(me.name)} stopped the repeating task *${slackText(s.title)}*.`);
    return { deleted: s.id };
  },

  async upload_url(sb, me, b) {
    const task = b.task_id ? await taskRow(sb, b.task_id) : null;
    const project = b.project_id ? await projectRow(sb, b.project_id) : null;
    must(task || project, "Pick a task or project for the file.");
    must(!task || !project || task.project_id === project.id, "That task is on another project.");
    must(Number(b.size) > 0 && Number(b.size) <= 25 * 1024 * 1024, "Files can be up to 25 MB.");
    const safe = clip(b.name, 120).replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_") || "file";
    const path = `${filePrefix(project, task)}${Date.now().toString(36)}-${safe}`;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) throw new Error("Couldn't start the upload: " + error.message);
    return { path: data.path || path, token: data.token };
  },

  async file_done(sb, me, b) {
    const task = b.task_id ? await taskRow(sb, b.task_id) : null;
    const project = b.project_id ? await projectRow(sb, b.project_id) : task?.project_id ? await projectRow(sb, task.project_id) : null;
    must(task || project, "Pick a task or project for the file.");
    must(String(b.path || "").startsWith(filePrefix(b.project_id ? project : null, task)), "That upload doesn't belong here.");
    const { data: file, error } = await sb.from("dssc_project_files").insert({ project_id: project?.id || null, task_id: task?.id || null, name: clip(b.name, 200) || "file", path: b.path, size: Number(b.size) || null, mime: clip(b.mime, 120) || null, uploaded_by: me.name }).select().single();
    if (error) throw new Error(error.message);
    await logUpdate(sb, me, project?.id, task?.id, "file", `Added ${file.name}.`);
    if (task) await sb.from("dssc_project_tasks").update({ last_activity_at: new Date().toISOString() }).eq("id", task.id);
    await slack(sb, task ? taskSlackLine(task, project, `📎 ${slackText(me.name)} added ${slackText(file.name)}.`) : slackLine(project, `📎 ${slackText(me.name)} added ${slackText(file.name)}.`));
    return { file };
  },

  async file_url(sb, me, b) {
    const { data: f } = await sb.from("dssc_project_files").select("path, name").eq("id", Number(b.id)).maybeSingle();
    must(f, "That file isn't there any more.", 404);
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(f.path, 3600, b.download ? { download: f.name } : undefined);
    if (error) throw new Error(error.message);
    return { url: data.signedUrl };
  },

  async delete_file(sb, me, b) {
    const { data: f } = await sb.from("dssc_project_files").select("*").eq("id", Number(b.id)).maybeSingle();
    must(f, "That file isn't there any more.", 404);
    must(me.manager || f.uploaded_by === me.name, "Only the DSSC admins, or whoever added it, can delete a file.", 403);
    await sb.storage.from(BUCKET).remove([f.path]);
    await sb.from("dssc_project_files").delete().eq("id", f.id);
    await logUpdate(sb, me, f.project_id, f.task_id, "file", `Removed ${f.name}.`);
    return { deleted: f.id };
  },

  async ai_draft(sb, me, b) {
    managerOnly(me);
    const brief = clip(b.brief, 8000);
    must(brief.length >= 8, "Describe the project first.");
    must(process.env.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY isn't set on the server.", 500);
    const today = centralToday();
    const ppl = await listPeople(sb);
    // What HQ already knows that a brief might lean on: upcoming Heatwave sessions.
    const { data: camp } = await sb.from("dssc_camp_sessions").select("name, start_date, days").gte("start_date", today).order("start_date").limit(12);
    const context = (camp || []).map(s => `- Heatwave ${s.name}: ${s.start_date}, ${s.days} day${s.days === 1 ? "" : "s"}`).join("\n");
    const prompt = [
      `Today is ${today}.`,
      `Staff you can assign (use the email exactly; leave unassigned when the brief doesn't say or clearly imply who):\n${ppl.map(p => `- ${p.name} <${p.email}>${p.role ? " (" + p.role + ")" : ""}`).join("\n")}`,
      `The person writing the brief: ${me.name} <${me.email}>.`,
      context ? `Dates HQ already has:\n${context}` : "",
      `The brief:\n"""\n${brief}\n"""`,
    ].filter(Boolean).join("\n\n");
    const client = claudeClient("projects-draft", { apiKey: process.env.ANTHROPIC_API_KEY });
    let msg;
    try {
      msg = await client.beta.messages.parse({
        model: MODEL, max_tokens: 16000,
        // Fallback to another model if this one declines (server-side).
        betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
        output_config: { effort: "medium", format: jsonSchemaOutputFormat(DRAFT_SCHEMA) },
        system: DRAFT_SYSTEM,
        messages: [{ role: "user", content: prompt }],
      });
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) throw new Bad("Claude is busy right now - try again in a minute.", 503);
      if (e instanceof Anthropic.APIError) throw new Bad("Claude couldn't draft it (" + (e.status || "error") + "): " + e.message, 502);
      throw e;
    }
    if (msg.stop_reason === "refusal") throw new Bad("Claude declined to draft that one. Try rewording the brief.", 422);
    if (msg.stop_reason === "max_tokens") throw new Bad("That brief made a very long plan - try a shorter brief or split it into two projects.", 422);
    let d = msg.parsed_output;
    if (!d) { const txt = (msg.content || []).filter(x => x.type === "text").map(x => x.text).join(""); try { d = JSON.parse(txt); } catch { throw new Bad("Claude's draft didn't come back readable. Try again.", 502); } }
    // Keep only staff it was allowed to pick.
    const ok = new Set(ppl.map(p => p.email));
    const pick = (e) => (ok.has(nrm(e)) ? nrm(e) : null);
    const draft = {
      name: clip(d.name, 160), summary: clip(d.summary, 5000),
      owner_email: pick(d.owner_email), start_date: dateOrNull(d.start_date), due_date: dateOrNull(d.due_date),
      tasks: (d.tasks || []).slice(0, 60).map(t => ({
        section: clip(t.section, 80) || null, title: clip(t.title, 300), details: clip(t.details, 4000) || null,
        assignee_email: pick(t.assignee_email), due_date: dateOrNull(t.due_date), priority: ["low", "normal", "high"].includes(t.priority) ? t.priority : "normal",
        checklist: (t.checklist || []).slice(0, 12).map((x, i) => ({ id: "c" + i, text: clip(x, 300), done: false })).filter(x => x.text),
      })).filter(t => t.title),
    };
    return { draft };
  },

  async settings(sb, me, b) {
    managerOnly(me);
    const patch = { updated_by: me.name, updated_at: new Date().toISOString() };
    let test = null;
    if ("slack_webhook" in b) {
      const hook = String(b.slack_webhook || "").trim();
      must(!hook || SLACK_HOOK.test(hook), "That doesn't look like a Slack incoming-webhook URL (https://hooks.slack.com/services/...).");
      patch.slack_webhook = hook || null;
      if (hook) {
        test = await slack(sb, `📌 DSSC HQ Tasks & Projects is connected. Task updates will post here (set by ${slackText(me.name)}).`, hook);
        must(test.ok, "Slack didn't accept that webhook" + (test.error ? ": " + test.error : "") + ". Nothing was saved.");
      }
    }
    if ("weekly_email" in b) patch.weekly_email = !!b.weekly_email;
    if ("daily_digest" in b) patch.daily_digest = !!b.daily_digest;
    if ("categories" in b) { patch.categories = cleanList(b.categories, 30); must(patch.categories.length, "Keep at least one category."); }
    if ("departments" in b) { patch.departments = cleanList(b.departments, 30); must(patch.departments.length, "Keep at least one department."); }
    if ("slack_ids" in b) {
      const ids = {};
      for (const [e, v] of Object.entries(b.slack_ids || {})) { const id = clip(v, 20).toUpperCase(); if (!id) continue; must(/^[UW][A-Z0-9]{6,}$/.test(id), `"${v}" isn't a Slack member ID (it looks like U0123ABCD).`); ids[nrm(e)] = id; }
      patch.slack_ids = ids;
    }
    const { error } = await sb.from("dssc_project_settings").upsert({ id: 1, ...patch });
    if (error) throw new Error(error.message);
    return { saved: true, slackTest: test };
  },

  async test_slack(sb, me) {
    managerOnly(me);
    const hook = await slackHook(sb);
    must(hook, "No Slack webhook is set yet.");
    const st = await settingsRow(sb);
    const r = await slack(sb, `🧪 Test from DSSC HQ Tasks & Projects (${mention(st, me.email, me.name)}).`, hook);
    must(r.ok, "Slack didn't take it" + (r.error ? ": " + r.error : "") + ".");
    return { sent: true };
  },
};

// Where a file's bytes live: under its project (as before), or under the task alone.
const filePrefix = (project, task) => (project ? `p${project.id}/${task ? "t" + task.id : "project"}/` : `tasks/t${task.id}/`);

// ── Claude: brief -> project ────────────────────────────────────────────────
const DRAFT_SYSTEM = `You turn a short project brief from Dripping Springs Sports Club (DSSC) staff into a project plan for their HQ app, where each task becomes a card someone is assigned.

DSSC is a youth volleyball and basketball facility in Dripping Springs, Texas. DS Elite Volleyball is its club program. Heatwave Volleyball (heatwaveatx.com) is its premium, invite/referral-only training camp with college coaches; its Winter Edition sessions are listed under "Dates HQ already has" when they exist.

Write:
- name: a short project name, the way the staff would say it.
- summary: one to three sentences on the goal and what "done" or "launched" means.
- owner_email: the person the brief puts in charge, else the person writing it.
- start_date / due_date: from the brief or from dates HQ already has; work back from an event so the project finishes before it. Leave null if nothing sets them.
- tasks: every item the brief lists becomes a task (never drop one), plus only the obvious missing steps a club director would expect, for 6-20 tasks in all. Group them into a few sections (e.g. Coaching, Launch, Marketing, Brand & swag, Players, Operations). Each task has a short imperative title; details saying what done looks like in one to three sentences; an assignee only when the brief names or clearly implies a person from the staff list; a due date that sequences the work toward the deadline (null if there is no deadline); a priority; and a checklist of zero to six short steps when that helps.

Don't invent facts the brief doesn't give - prices, vendors, budgets, people outside the staff list. Where a decision is still open, make deciding it the task.`;

const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "summary", "owner_email", "start_date", "due_date", "tasks"],
  properties: {
    name: { type: "string" },
    summary: { type: "string" },
    owner_email: nullable({ type: "string" }),
    start_date: nullable({ type: "string", format: "date" }),
    due_date: nullable({ type: "string", format: "date" }),
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section", "title", "details", "assignee_email", "due_date", "priority", "checklist"],
        properties: {
          section: { type: "string" },
          title: { type: "string" },
          details: { type: "string" },
          assignee_email: nullable({ type: "string" }),
          due_date: nullable({ type: "string", format: "date" }),
          priority: { type: "string", enum: ["low", "normal", "high"] },
          checklist: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};
