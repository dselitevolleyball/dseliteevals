// Dev-only harness for src/dssc/Projects.jsx: /?projectspreview in npm run dev.
// An in-memory stand-in for /api/projects (sample data, nothing saved), so the
// board, the card, the Claude draft review and settings can be clicked through
// without a login. Not in production builds.
import Projects from "./dssc/Projects.jsx";

const today = new Date().toLocaleDateString("en-CA");
const plus = (n) => { const d = new Date(today + "T12:00:00"); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
const people = [
  { email: "drew@example.com", name: "Drew Rose", role: "admin" },
  { email: "hunter@example.com", name: "Hunter Haley", role: "admin" },
  { email: "kristen@example.com", name: "Kristen Alexandrov", role: "admin" },
  { email: "jonathan@example.com", name: "Jonathan Dela Rosa", role: "admin" },
  { email: "brandon@example.com", name: "Brandon Butler", role: "staff" },
];
const me = { email: "drew@example.com", name: "Drew Rose", manager: true };
const P = (e) => people.find(p => p.email === e);
let id = 100;
const db = {
  settings: { slack: false, slackFromEnv: false, weeklyEmail: true, lastWeeklyAt: null },
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
  ],
  updates: [{ id: 1, project_id: 1, task_id: 11, kind: "comment", body: "Two names on the shortlist, calls this week.", author_name: "Hunter Haley", created_at: new Date(Date.now() - 3600e3).toISOString() }],
  files: [],
};
const counts = (p) => { const ts = db.tasks.filter(t => t.project_id === p.id), op = ts.filter(t => t.status !== "done"); return { total: ts.length, done: ts.length - op.length, overdue: op.filter(t => t.due_date && t.due_date < today).length, blocked: op.filter(t => t.status === "blocked").length, mine: op.filter(t => t.assignee_email === me.email).length }; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function mock(action, b) {
  await wait(150);
  switch (action) {
    case "bootstrap": return { me, today, people, settings: db.settings, projects: db.projects.map(p => ({ ...p, counts: counts(p) })), myTasks: db.tasks.filter(t => t.status !== "done" && t.assignee_email === me.email).map(t => ({ ...t, project_name: db.projects.find(p => p.id === t.project_id).name })) };
    case "project": { const p = db.projects.find(x => x.id === b.id); if (!p) throw new Error("That project isn't there any more."); return { project: p, tasks: db.tasks.filter(t => t.project_id === p.id).map(t => ({ ...t, files: db.files.filter(f => f.task_id === t.id).length, comments: db.updates.filter(u => u.task_id === t.id && u.kind === "comment").length })), files: [], updates: db.updates.filter(u => u.project_id === p.id).slice().reverse() }; }
    case "task": { const t = db.tasks.find(x => x.id === b.id); return { task: t, updates: db.updates.filter(u => u.task_id === t.id), files: db.files.filter(f => f.task_id === t.id) }; }
    case "save_task": {
      const t = b.task; const ppl = (e) => (e ? { assignee_email: e, assignee_name: P(e)?.name } : { assignee_email: null, assignee_name: null });
      const patch = { ...t, ...("assignee_email" in t ? ppl(t.assignee_email) : {}), ...("helpers" in t ? { helpers: t.helpers.map(e => ({ email: e, name: P(e)?.name })) } : {}), last_activity_at: new Date().toISOString() };
      if (!t.id) { const n = { id: ++id, status: "todo", priority: "normal", checklist: [], helpers: [], created_by: me.email, ...patch }; db.tasks.push(n); return { task: n }; }
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
    case "settings": if ("slack_webhook" in b) db.settings.slack = !!b.slack_webhook; if ("weekly_email" in b) db.settings.weeklyEmail = !!b.weekly_email; return {};
    case "test_slack": return {};
    default: throw new Error("Preview doesn't do " + action);
  }
}

export default function ProjectsPreview() {
  return <div style={{ background: "#104946", minHeight: "100vh", padding: "14px 16px" }}><Projects apiFn={mock} /></div>;
}
