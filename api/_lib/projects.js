// DSSC Projects - shared server pieces for /api/projects and the Monday email
// (/api/projects-weekly): who may use it, the staff you can assign, Slack, email.
//
// Who: owners (Drew), DS Elite admins, and anyone with a DSSC role (admin,
// staff, coach) - the people projects get assigned to. Managers (owners,
// admins, DSSC admins, the DSSC directors) create and edit projects and the
// Slack/email settings; everyone in can work their cards.
import { resendKeyFor } from "./resend-key.js";

export const OWNER_EMAILS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];
const DIRECTOR_EMAILS = ["hunterhaleysc10@gmail.com", "hunter@drippingsportsclub.com"];
export const APP_URL = "https://www.drippingsportsclub.com/hq/";
export const BUCKET = "dssc-projects";
export const STATUS = ["todo", "doing", "blocked", "done"];
export const STATUS_LABEL = { todo: "To do", doing: "In progress", blocked: "Blocked", done: "Done" };
export const PROJECT_STATUS = ["planning", "active", "on_hold", "done", "archived"];
const nrm = (v) => String(v || "").trim().toLowerCase();

export const centralToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
export const addDays = (ymd, n) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const fmtDate = (ymd) => ymd ? new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "";
export const link = (projectId, taskId) => `${APP_URL}?view=projects&project=${projectId}${taskId ? "&task=" + taskId : ""}`;
export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The signed-in person, or null. The service-role key (scripts) counts as Drew.
export async function whoIs(sb, req, serviceKey) {
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return null;
  if (bearer === serviceKey) return { email: "drew@dselitevolleyball.com", name: "Drew Rose", manager: true, service: true };
  const { data: { user } = {} } = await sb.auth.getUser(bearer).catch(() => ({ data: {} }));
  const email = nrm(user?.email);
  if (!email) return null;
  const { data: c } = await sb.from("coaches").select("display_name, is_admin, is_approved, dssc_role").ilike("email", email).maybeSingle();
  const owner = OWNER_EMAILS.includes(email);
  const approved = owner || !!c?.is_approved;
  const inProjects = owner || (approved && (c?.is_admin || !!c?.dssc_role));
  if (!inProjects) return null;
  const manager = owner || !!c?.is_admin || c?.dssc_role === "admin" || DIRECTOR_EMAILS.includes(email);
  return { email, name: c?.display_name || email, manager };
}

// Everyone a card can be assigned to: approved logins with a DSSC role, or HQ admins.
export async function people(sb) {
  const { data } = await sb.from("coaches").select("email, display_name, is_admin, dssc_role, is_approved").eq("is_approved", true);
  const out = (data || []).filter(c => c.email && (c.is_admin || c.dssc_role || OWNER_EMAILS.includes(nrm(c.email))))
    .map(c => ({ email: nrm(c.email), name: c.display_name || c.email, role: c.dssc_role || (c.is_admin ? "admin" : "") }));
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// Slack: an incoming webhook (saved in the Projects settings, or the
// SLACK_PROJECTS_WEBHOOK_URL env var). No webhook = quietly skipped.
export const SLACK_HOOK = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/;
const slackEsc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const slackLink = (url, text) => `<${url}|${slackEsc(text).replace(/\|/g, "-")}>`;
export async function slackHook(sb) {
  const { data } = await sb.from("dssc_project_settings").select("slack_webhook").eq("id", 1).maybeSingle();
  return data?.slack_webhook || process.env.SLACK_PROJECTS_WEBHOOK_URL || null;
}
export async function slack(sb, text, hook) {
  const url = hook === undefined ? await slackHook(sb) : hook;
  if (!url) return { skipped: true };
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, unfurl_links: false, unfurl_media: false }) });
    return { ok: r.ok, status: r.status, error: r.ok ? undefined : (await r.text().catch(() => "")).slice(0, 200) };
  } catch (e) { return { ok: false, error: e.message }; }
}
// "*<link|Heatwave - Winter Edition>* · ✅ Hunter finished *Order swag*"
export const slackLine = (project, text, taskId) => `*${slackLink(link(project.id, taskId), project.name)}* · ${text}`;
export const slackText = slackEsc;

// Email from the DSSC address (Resend), one message per recipient.
export async function sendMail({ to, subject, html, text, replyTo }) {
  const { DSSC_FROM_EMAIL, DSE_FROM_EMAIL } = process.env;
  const from = DSSC_FROM_EMAIL || (DSE_FROM_EMAIL ? "Dripping Springs Sports Club <" + ((DSE_FROM_EMAIL.match(/<([^>]+)>/) || [])[1] || DSE_FROM_EMAIL) + ">" : "");
  const key = resendKeyFor(from);
  if (!key || !from) return { ok: false, error: "Email isn't configured on the server." };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
  }).catch(e => ({ ok: false, statusText: e.message }));
  return { ok: !!r.ok, error: r.ok ? undefined : (r.statusText || "send failed") };
}
export const emailShell = (inner) => `<div style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#191919;max-width:640px">${inner}<p style="color:#7a8a88;font-size:12px;margin-top:22px">DSSC HQ · Projects</p></div>`;
