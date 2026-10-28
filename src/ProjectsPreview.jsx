// Dev-only harness for src/dssc/Projects.jsx: /?projectspreview in npm run dev.
// An in-memory stand-in for /api/projects (sample data, nothing saved), so the
// task views, repeats, scorecard, project boards, the task window, the Claude
// draft review and settings can be clicked through without a login. Not in
// production builds.
import Projects from "./dssc/Projects.jsx";
import { dueToCreate } from "../shared/task-recurrence.js";
import { DEFAULT_CATEGORIES, DEFAULT_DEPARTMENTS } from "../shared/task-meta.js";

const today = new Date().toLocaleDateString("en-CA");
const plus = (n) => { const d = new Date(today + "T12:00:00"); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
const people = [
  { email: "drew@example.com", name: "Drew Rose", role: "admin" },
  { email: "hunter@example.com", name: "Hunter Haley", role: "admin" },
  { email: "kristen@example.com", name: "Kristen Alexandrov", role: "admin" },
  { email: "jonathan@example.com", name: "Jonathan Dela Rosa", role: "admin" },
  { email: "brandon@example.com", name: "Brandon Butler", role: "staff" },
  { email: "adrian@example.com", name: "Adrian Thomas", role: "admin" },
];
const realMe = { email: "drew@example.com", name: "Drew Rose", manager: true, owner: true };
let me = realMe;
const P = (e) => people.find(p => p.email === e);
let id = 100;
const db = {
  settings: { slack: true, slackFromEnv: false, weeklyEmail: true, lastWeeklyAt: null, dailyDigest: true, lastDailyAt: null, categories: DEFAULT_CATEGORIES, departments: DEFAULT_DEPARTMENTS, slackIds: { "jonathan@example.com": "U01JONATHAN" } },
  series: [],
  projects: [
    { id: 1, name: "Heatwave - Inaugural Winter Edition", summary: "Launch the first Heatwave Winter Edition (Dec 21-22 and Dec 26-27): coaches locked, marketing out, swag ordered, players selected.", status: "active", owner_email: "drew@example.com", owner_name: "Drew Rose", team: [{ email: "hunter@example.com", name: "Hunter Haley" }, { email: "kristen@example.com", name: "Kristen Alexandrov" }], start_date: today, due_date: plus(60) },
    { id: 2, name: "DS Fall Fest Activations", summary: "", status: "planning", owner_email: "jonathan@example.com", owner_name: "Jonathan Dela Rosa", team: [], due_date: plus(20) },
  ],
  tasks: [
    { id: 11, project_id: 1, section: "Coaching", title: "Lock in a lead coach for each session", status: "doing", priority: "high", assignee_email: "hunter@example.com", assignee_name: "Hunter Haley", due_date: plus(-2), checklist: [{ id: "a", text: "Shortlist", done: true }, { id: "b", text: "Offer", done: false }], helpers: [], details: "Two sessions, one lead each.", last_activity_at: new Date().toISOString(), created_by: "drew@example.com" },
    { id: 12, project_id: 1, section: "Launch", title: "Write the launch plan", status: "todo", priority: "normal", assignee_email: "drew@example.com", assignee_name: "Drew Rose", due_date: plus(5), checklist: [], helpers: [], last_activity_at: new Date().toISOString(), created_by: "drew@example.com" },
    { id: 13, project_id: 1, section: "Brand & swag", title: "Finalize the brand order and swag", status: "blocked", priority: "normal", assignee_email: "kristen@example.com", assignee_name: "Kristen Alexandrov", due_date: plus(12), checklist: [], helpers: [], last_activity_at: new Date().toISOString(), created_by: "drew@example.com" },
    { id: 14, project_id: 1, section: "Marketing", title: "Marketing plan", status: "done", priority: "normal", assignee_email: null, assignee_name: null, due_date: plus(-5), checklist: [], helpers: [], last_activity_at: new Date().toISOString(), completed_at: new Date().toISOString(), created_by: "drew@example.com" },
    { id: 21, project_id: 2, section: "Plan", title: "List the Fall Fest activations", status: "todo", priority: "normal", assignee_email: "jonathan@example.com", assignee_name: "Jonathan Dela Rosa", due_date: plus(7), checklist: [], helpers: [], last_activity_at: new Date().toISOString(), created_by: "drew@example.com" },
    // Standalone tasks across the team.
    { id: 31, project_id: null, title: "Build the January clinic schedule", category: "Programming", departments: ["Volleyball", "Basketball"], hq_view: "clinics", status: "doing", priority: "high", assignee_email: "jonathan@example.com", assignee_name: "Jonathan Dela Rosa", due_date: plus(3), checklist: [{ id: "a", text: "Volleyball", done: true }, { id: "b", text: "Basketball", done: false }], helpers: [{ email: "adrian@example.com", name: "Adrian Thomas" }], last_activity_at: new Date().toISOString(), created_by: "drew@example.com" },
    { id: 32, project_id: null, title: "Reach athlete testing day plan", category: "Programming", departments: ["Reach"], hq_view: "reachstats", status: "blocked", blocker: "Waiting on the gym schedule from Jonathan", priority: "normal", assignee_email: "brandon@example.com", assignee_name: "Brandon Butler", due_date: plus(-1), checklist: [], helpers: [], last_activity_at: new Date().toISOString(), created_by: "drew@example.com" },
    { id: 33, project_id: null, title: "Basketball league referee list", category: "Operations", departments: ["Basketball"], status: "todo", priority: "normal", assignee_email: "adrian@example.com", assignee_name: "Adrian Thomas", due_date: plus(-3), checklist: [], helpers: [], help_requested_at: new Date(Date.now() - 7200e3).toISOString(), help_note: "Who did we use last spring?", help_by: "adrian@example.com", help_from: "hunter@example.com", last_activity_at: new Date().toISOString(), created_by: "adrian@example.com" },
    { id: 34, project_id: null, title: "Order replacement nets for Warehouse II", category: "Facilities", departments: ["Volleyball", "Front desk"], status: "todo", priority: "normal", assignee_email: "hunter@example.com", assignee_name: "Hunter Haley", due_date: today, checklist: [], helpers: [], last_activity_at: new Date().toISOString(), created_by: "drew@example.com" },
    { id: 35, project_id: null, title: "Holiday camp flyer", category: "Marketing", departments: ["Volleyball"], hq_view: "dsscmarketing", status: "done", priority: "normal", assignee_email: "jonathan@example.com", assignee_name: "Jonathan Dela Rosa", due_date: plus(-4), completed_at: new Date(Date.now() - 5 * 864e5).toISOString(), checklist: [], helpers: [], last_activity_at: new Date().toISOString(), created_by: "drew@example.com" },
    { id: 36, project_id: null, title: "Update the front desk FAQ", category: "Customer service", departments: ["Front desk"], status: "done", priority: "low", assignee_email: "hunter@example.com", assignee_name: "Hunter Haley", due_date: plus(-6), completed_at: new Date(Date.now() - 2 * 864e5).toISOString(), checklist: [], helpers: [], last_activity_at: new Date().toISOString(), created_by: "drew@example.com" },
  ],
  updates: [{ id: 1, project_id: 1, task_id: 11, kind: "comment", body: "Two names on the shortlist, calls this week.", author_name: "Hunter Haley", created_at: new Date(Date.now() - 3600e3).toISOString() }],
  files: [],
};
const seedSeries = [
  { id: 901, title: "Approve DSSC time cards", frequency: "weekly", weekdays: [1], every_n: 1, starts_on: plus(-30), category: "Staffing & payroll", departments: ["Admin"], hq_view: "dssctime", assignee_email: "hunter@example.com", assignee_name: "Hunter Haley", active: true, priority: "high" },
  { id: 902, title: "Check the info@ inbox", frequency: "daily", weekdays: [1, 2, 3, 4, 5], every_n: 1, starts_on: plus(-30), category: "Customer service", departments: ["Front desk"], hq_view: "dsscinbox", assignee_email: "jonathan@example.com", assignee_name: "Jonathan Dela Rosa", active: true, priority: "normal" },
  { id: 903, title: "Plan next month's programming", frequency: "monthly", monthday: 15, every_n: 1, starts_on: plus(-60), category: "Programming", departments: ["Volleyball", "Basketball", "Reach"], hq_view: "dsscplan", assignee_email: "jonathan@example.com", assignee_name: "Jonathan Dela Rosa", active: true, priority: "normal" },
];
const named = (t) => ({ ...t, project_name: t.project_id ? db.projects.find(p => p.id === t.project_id)?.name : null });
const makeRepeats = (s) => { for (const d of dueToCreate(s, today)) if (!db.tasks.some(t => t.series_id === s.id && t.due_date === d)) db.tasks.push({ id: ++id, project_id: null, series_id: s.id, title: s.title, details: s.details, category: s.category, departments: s.departments || [], hq_view: s.hq_view, priority: s.priority || "normal", assignee_email: s.assignee_email, assignee_name: P(s.assignee_email)?.name, status: "todo", due_date: d, checklist: [], helpers: [], last_activity_at: new Date().toISOString(), created_by: me.email }); s.last_generated_on = plus({ daily: 0, weekly: 6, monthly: 13 }[s.frequency]); };
const counts = (p) => { const ts = db.tasks.filter(t => t.project_id === p.id), op = ts.filter(t => t.status !== "done"); return { total: ts.length, done: ts.length - op.length, overdue: op.filter(t => t.due_date && t.due_date < today).length, blocked: op.filter(t => t.status === "blocked").length, mine: op.filter(t => t.assignee_email === me.email).length }; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function mock(action, b) {
  await wait(150);
  switch (action) {
    case "bootstrap": me = b.as_email ? { ...P(b.as_email), manager: P(b.as_email).role === "admin", owner: false, viewAs: true } : realMe; return { me, today, people, settings: db.settings, series: db.series, projects: db.projects.map(p => ({ ...p, counts: counts(p) })), tasks: db.tasks.map(named), myTasks: db.tasks.filter(t => !["done", "skipped"].includes(t.status) && t.assignee_email === me.email).map(named) };
    case "project": { const p = db.projects.find(x => x.id === b.id); if (!p) throw new Error("That project isn't there any more."); return { project: p, tasks: db.tasks.filter(t => t.project_id === p.id).map(t => ({ ...t, files: db.files.filter(f => f.task_id === t.id).length, comments: db.updates.filter(u => u.task_id === t.id && u.kind === "comment").length })), files: [], updates: db.updates.filter(u => u.project_id === p.id).slice().reverse() }; }
    case "task": { const t = db.tasks.find(x => x.id === b.id); return { task: t, project: db.projects.find(p => p.id === t.project_id) || null, series: db.series.find(s => s.id === t.series_id) || null, updates: db.updates.filter(u => u.task_id === t.id), files: db.files.filter(f => f.task_id === t.id) }; }
    case "help": { const t = db.tasks.find(x => x.id === b.task_id); Object.assign(t, { help_requested_at: new Date().toISOString(), help_note: b.note, help_from: b.from_email, help_by: me.email }); db.updates.push({ id: ++id, task_id: t.id, kind: "help", body: "Asked for help: " + b.note, author_name: me.name, created_at: new Date().toISOString() }); return {}; }
    case "help_done": { const t = db.tasks.find(x => x.id === b.task_id); Object.assign(t, { help_requested_at: null, help_note: null, help_from: null, help_by: null }); return {}; }
    case "save_series": { const x = b.series; if (x.id) { const i = db.series.findIndex(s => s.id === x.id); db.series[i] = { ...db.series[i], ...x, assignee_name: P(x.assignee_email ?? db.series[i].assignee_email)?.name }; makeRepeats(db.series[i]); return { series: db.series[i] }; } const s = { id: ++id, active: true, ...x, assignee_name: P(x.assignee_email)?.name, created_by: me.email }; db.series.push(s); makeRepeats(s); return { series: s }; }
    case "delete_series": db.series = db.series.filter(s => s.id !== b.id); db.tasks = db.tasks.filter(t => !(t.series_id === b.id && t.status === "todo" && t.due_date >= today)); return {};
    case "save_task": {
      const t = b.task; const ppl = (e) => (e ? { assignee_email: e, assignee_name: P(e)?.name } : { assignee_email: null, assignee_name: null });
      const patch = { ...t, ...("assignee_email" in t ? ppl(t.assignee_email) : {}), ...("helpers" in t ? { helpers: t.helpers.map(e => ({ email: e, name: P(e)?.name })) } : {}), last_activity_at: new Date().toISOString() };
      if (!t.id) { const n = { id: ++id, project_id: null, status: "todo", priority: "normal", checklist: [], helpers: [], departments: [], created_by: me.email, ...patch }; db.tasks.push(n); return { task: n }; }
      if (t.status) patch.completed_at = ["done", "skipped"].includes(t.status) ? new Date().toISOString() : null;
      const i = db.tasks.findIndex(x => x.id === t.id); db.tasks[i] = { ...db.tasks[i], ...patch };
      if (t.status) db.updates.push({ id: ++id, project_id: db.tasks[i].project_id, task_id: t.id, kind: "status", body: "Moved to " + t.status + ".", author_name: me.name, created_at: new Date().toISOString() });
      return { task: db.tasks[i] };
    }
    case "save_project": { const i = db.projects.findIndex(x => x.id === b.project.id); const p = b.project; db.projects[i] = { ...db.projects[i], ...p, ...("owner_email" in p ? { owner_name: P(p.owner_email)?.name } : {}), ...("team" in p ? { team: p.team.map(e => ({ email: e, name: P(e)?.name })) } : {}) }; return { project: db.projects[i] }; }
    case "create_project": { const p = { id: ++id, status: "active", ...b.project, owner_name: P(b.project.owner_email)?.name, team: (b.project.team || []).map(e => ({ email: e, name: P(e)?.name })) }; db.projects.push(p); for (const t of b.tasks) db.tasks.push({ id: ++id, project_id: p.id, status: "todo", helpers: [], ...t, assignee_name: P(t.assignee_email)?.name, last_activity_at: new Date().toISOString() }); return { project: p }; }
    case "comment": db.updates.push({ id: ++id, project_id: b.project_id, task_id: b.task_id, kind: "comment", body: b.body, author_name: me.name, created_at: new Date().toISOString() }); return {};
    case "upload_url": return { local: true, path: "local/" + b.name };
    case "file_done": db.files.push({ id: ++id, project_id: b.project_id, task_id: b.task_id, name: b.name, size: b.size, uploaded_by: me.name, created_at: new Date().toISOString() }); return {};
    case "file_url": return { url: "data:text/plain,preview" };
    case "delete_file": db.files = db.files.filter(f => f.id !== b.id); return {};
    case "delete_task": db.tasks = db.tasks.filter(t => t.id !== b.id); return {};
    case "ai_draft": await wait(600); return { draft: { name: "Heatwave - Inaugural Winter Edition", summary: "Get the first Winter Edition launched and full.", owner_email: "drew@example.com", start_date: today, due_date: plus(60), tasks: [
      { section: "Coaching", title: "Confirm the lead coach for Winter Edition I", details: "Signed agreement and travel booked.", assignee_email: "hunter@example.com", due_date: plus(14), priority: "high", checklist: [{ id: "c0", text: "Shortlist", done: false }] },
      { section: "Marketing", title: "Write the marketing plan", details: "Channels, timeline, content owners.", assignee_email: null, due_date: plus(10), priority: "normal", checklist: [] },
    ] } };
    case "settings": if ("slack_webhook" in b) db.settings.slack = !!b.slack_webhook; if ("weekly_email" in b) db.settings.weeklyEmail = !!b.weekly_email; if ("daily_digest" in b) db.settings.dailyDigest = !!b.daily_digest; if (b.categories) db.settings.categories = b.categories; if (b.departments) db.settings.departments = b.departments; if (b.slack_ids) db.settings.slackIds = b.slack_ids; return {};
    case "test_slack": return {};
    default: throw new Error("Preview doesn't do " + action);
  }
}

db.series.push(...seedSeries);
for (const s of db.series) makeRepeats(s);
// A little history for the scorecard.
db.tasks.push({ id: 801, project_id: null, series_id: 902, title: "Check the info@ inbox", category: "Customer service", departments: ["Front desk"], status: "skipped", priority: "normal", assignee_email: "jonathan@example.com", assignee_name: "Jonathan Dela Rosa", due_date: plus(-5), checklist: [], helpers: [], last_activity_at: new Date().toISOString() });
db.tasks.push({ id: 802, project_id: null, series_id: 901, title: "Approve DSSC time cards", category: "Staffing & payroll", departments: ["Admin"], status: "done", priority: "high", assignee_email: "hunter@example.com", assignee_name: "Hunter Haley", due_date: plus(-9), completed_at: new Date(Date.now() - 7 * 864e5).toISOString(), checklist: [], helpers: [], last_activity_at: new Date().toISOString() });

export default function ProjectsPreview() {
  return <div style={{ background: "#104946", minHeight: "100vh", padding: "14px 16px" }}><Projects apiFn={mock} onOpenView={(v) => window.alert("Would open the HQ screen: " + v)} /></div>;
}
