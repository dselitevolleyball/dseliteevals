// DSSC Tasks (Drew, Oct 28 2026) - the server pieces shared by /api/projects
// and the daily run (/api/tasks-daily): making repeating tasks, closing missed
// daily ones, links, and Slack @mentions.
import { APP_URL, link, slack, slackLink, slackText } from "./projects.js";
import { dueToCreate, addDays } from "../../shared/task-recurrence.js";
import { DEFAULT_CATEGORIES, DEFAULT_DEPARTMENTS } from "../../shared/task-meta.js";

const nrm = (v) => String(v || "").trim().toLowerCase();

// A task's page: inside its project, or on its own.
export const taskLink = (t) => (t.project_id ? link(t.project_id, t.id) : `${APP_URL}?view=projects&task=${t.id}`);
// "<@U0123>" when HQ knows the person's Slack member ID (they get pinged), else their name.
export const mention = (settings, email, name) => {
  const id = (settings?.slack_ids || {})[nrm(email)];
  return id ? `<@${id}>` : slackText(name || email || "");
};
// One Slack line about a task: "*<link|Project>* › *<link|Task>* · text".
export function taskSlackLine(t, project, text) {
  const head = project ? `*${slackLink(link(project.id), project.name)}* › ` : "";
  return `${head}*${slackLink(taskLink(t), t.title)}* · ${text}`;
}
export async function settingsRow(sb) {
  const { data } = await sb.from("dssc_project_settings").select("*").eq("id", 1).maybeSingle();
  return {
    ...(data || {}),
    categories: Array.isArray(data?.categories) && data.categories.length ? data.categories : DEFAULT_CATEGORIES,
    departments: Array.isArray(data?.departments) && data.departments.length ? data.departments : DEFAULT_DEPARTMENTS,
    slack_ids: data?.slack_ids && typeof data.slack_ids === "object" ? data.slack_ids : {},
  };
}
export async function postSlack(sb, text) { return slack(sb, text); }

// The fields a series copies onto each occurrence.
export const seriesTaskFields = (s) => ({
  title: s.title, details: s.details || null, category: s.category || null, departments: s.departments || [],
  priority: s.priority || "normal", assignee_email: s.assignee_email || null, assignee_name: s.assignee_name || null,
  helpers: s.helpers || [], checklist: (s.checklist || []).map(x => ({ ...x, done: false })),
  hq_view: s.hq_view || null, link_url: s.link_url || null,
});

// Make the tasks for every active series up to its lead window. Safe to run
// any number of times: (series_id, due_date) is unique, and last_generated_on
// moves forward, so a task someone deleted doesn't come back.
export async function generateRecurring(sb, today, { only } = {}) {
  let q = sb.from("dssc_task_series").select("*").eq("active", true);
  if (only) q = q.eq("id", only);
  const { data: series, error } = await q;
  if (error) throw new Error(error.message);
  let created = 0;
  for (const s of series || []) {
    const dates = dueToCreate(s, today);
    const lead = { daily: 0, weekly: 6, monthly: 13 }[s.frequency] ?? 6;
    const through = addDays(today, lead);
    if (dates.length) {
      const rows = dates.map(d => ({ ...seriesTaskFields(s), series_id: s.id, due_date: d, status: "todo", sort: 0, created_by: s.created_by || null }));
      const { data, error: iErr } = await sb.from("dssc_project_tasks").upsert(rows, { onConflict: "series_id,due_date", ignoreDuplicates: true }).select("id");
      if (iErr) throw new Error(iErr.message);
      created += (data || []).length;
    }
    if (!s.last_generated_on || s.last_generated_on < through) await sb.from("dssc_task_series").update({ last_generated_on: through }).eq("id", s.id);
  }
  await sb.from("dssc_project_settings").update({ last_generated_at: new Date().toISOString() }).eq("id", 1);
  return { created, series: (series || []).length };
}

// A daily repeat nobody finished is closed as missed two days on, so the list
// doesn't fill with old copies (yesterday's stays up as overdue). Weekly and
// monthly ones stay open until someone deals with them.
export async function closeMissedDaily(sb, today) {
  const { data: daily } = await sb.from("dssc_task_series").select("id").eq("frequency", "daily");
  const ids = (daily || []).map(s => s.id);
  if (!ids.length) return 0;
  const { data, error } = await sb.from("dssc_project_tasks").update({ status: "skipped", updated_at: new Date().toISOString() })
    .in("series_id", ids).in("status", ["todo", "doing", "blocked"]).lt("due_date", addDays(today, -1)).select("id");
  if (error) throw new Error(error.message);
  return (data || []).length;
}

// Generate at most every 10 minutes when someone opens HQ, so repeats appear
// even between the daily runs.
export async function generateIfStale(sb, today, settings) {
  const last = settings?.last_generated_at ? Date.parse(settings.last_generated_at) : 0;
  if (Date.now() - last < 10 * 60 * 1000) return null;
  try { return await generateRecurring(sb, today); } catch (e) { console.error("tasks generate", e.message); return null; }
}
