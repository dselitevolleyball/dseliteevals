// What a DSSC task can be filed under and point at (Drew, Oct 28 2026), shared
// by /api/projects and the Tasks & Projects screen.

// Defaults; the lists themselves live in dssc_project_settings and can be edited.
export const DEFAULT_CATEGORIES = ["Programming", "Operations", "Facilities", "Marketing", "Staffing & payroll", "Finance & admin", "Customer service", "Events"];
export const DEFAULT_DEPARTMENTS = ["Volleyball", "Basketball", "Reach", "DS Elite", "Front desk", "Admin"];

// HQ screens a task can open ("tasks for programming, time cards, staff hours
// and other features built into DSSC HQ should be referenceable").
// Keys are the HQ view names (src/Nav.jsx).
export const HQ_VIEWS = [
  ["clinics", "Clinics & Camps Board", "Programming"],
  ["dsscplan", "2027 Planning Calendar", "Programming"],
  ["courts", "Court Availability", "Programming"],
  ["dssccamp", "Heatwave VB ATX", "Programming"],
  ["pods", "Skill Pods", "Programming"],
  ["privates", "Privates", "Programming"],
  ["dssctime", "DSSC Time Cards", "Staff & pay"],
  ["staffadmin", "Staff Hours", "Staff & pay"],
  ["staffhours", "My Hours", "Staff & pay"],
  ["dssccal", "Coverage Calendar", "Staff & pay"],
  ["dsscpay", "Pay rates", "Staff & pay"],
  ["dsscpeople", "Coaches & Staff", "Staff & pay"],
  ["dsscinbox", "Inbox", "Families"],
  ["dssctexts", "DSSC Texts", "Families"],
  ["reachtexts", "Reach Texts", "Families"],
  ["dssccrm", "People", "Families"],
  ["dsscmarketing", "Marketing", "Marketing"],
  ["reachstats", "Reach Stats", "Reach"],
];
export const hqLabel = (v) => (HQ_VIEWS.find(x => x[0] === v) || [])[1] || "";

export const TASK_STATUS = ["todo", "doing", "blocked", "done", "skipped"];
export const TASK_STATUS_LABEL = { todo: "To do", doing: "In progress", blocked: "Blocked", done: "Done", skipped: "Skipped" };
export const isOpen = (t) => t && t.status !== "done" && t.status !== "skipped";

// The Central-time date a timestamp falls on.
export const centralDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }) : null);
// How a task with a due date turned out: "on_time", "late", "missed" (a skipped
// repeat), "overdue" (still open past due), or null (no due date / not due yet).
export function timeliness(t, today) {
  if (!t || !t.due_date) return null;
  if (t.status === "skipped") return "missed";
  if (t.status === "done") { const d = centralDate(t.completed_at); return !d || d <= t.due_date ? "on_time" : "late"; }
  return t.due_date < today ? "overdue" : null;
}
