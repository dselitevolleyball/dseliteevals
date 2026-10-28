// DSSC Projects - the Monday check-in (Drew, Oct 14 2026: "reminders that get
// emailed weekly about tasks that need updates"; Oct 28: "task notifications
// should be sent just via Slack"). Mondays 8am Central.
//
// Each person with open cards gets one Slack DM from the HQ bot: overdue, due in the next 7 days,
// blocked, and anything with no update in 7+ days - project cards and standalone
// tasks alike (daily repeats are left to the morning Slack digest). Project owners also get a
// line per project they own (cards done, overdue, blocked). Slack gets a
// one-message digest. Nothing to report = no DM. Someone the bot can't find in
// Slack is listed under "skipped".
//
// Auth: Vercel Cron (Authorization: Bearer <CRON_SECRET>) or the service-role key.
// Query: ?dry=1 (build, send nothing, return what would go out)
//        ?to=<email> (send every DM to that person instead - for a preview)
//        ?force=1 (run even if the Monday check-in is switched off in settings)
import { createClient } from "@supabase/supabase-js";
import { link, fmtDate, centralToday, addDays, slack, slackLink, slackText, STATUS_LABEL, APP_URL } from "./_lib/projects.js";
import { taskLink } from "./_lib/tasks.js";
import { dmPerson } from "./_lib/product-slack.js";

const nrm = (v) => String(v || "").trim().toLowerCase();

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET } = process.env;
  const url = new URL(req.url, "https://x");
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer || (bearer !== CRON_SECRET && bearer !== SUPABASE_SERVICE_ROLE_KEY)) return res.status(403).json({ error: "Forbidden" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const dry = url.searchParams.get("dry") === "1", force = url.searchParams.get("force") === "1";
  const to = nrm(url.searchParams.get("to"));

  const { data: st } = await sb.from("dssc_project_settings").select("weekly_email").eq("id", 1).maybeSingle();
  if (st && st.weekly_email === false && !force && !dry) return res.status(200).json({ ok: true, skipped: "The Monday check-in is switched off in Projects settings." });

  const today = centralToday(), soon = addDays(today, 7), stale = Date.now() - 7 * 864e5;
  const [{ data: projects }, { data: tasks }, { data: coaches }, { data: daily }] = await Promise.all([
    sb.from("dssc_projects").select("*").in("status", ["planning", "active", "on_hold"]),
    sb.from("dssc_project_tasks").select("*"),
    sb.from("coaches").select("email, display_name"),
    sb.from("dssc_task_series").select("id").eq("frequency", "daily"),
  ]);
  const proj = new Map((projects || []).map(p => [p.id, p]));
  const nameOf = new Map((coaches || []).map(c => [nrm(c.email), c.display_name || c.email]));
  const dailyIds = new Set((daily || []).map(s => s.id));
  const open = (tasks || []).filter(t => !["done", "skipped"].includes(t.status) && (t.project_id ? proj.has(t.project_id) : true) && !dailyIds.has(t.series_id));

  // Why a card is on someone's list (first match wins).
  const reason = (t) => t.due_date && t.due_date < today ? "overdue"
    : t.status === "blocked" ? "blocked"
    : t.due_date && t.due_date <= soon ? "soon"
    : Date.parse(t.last_activity_at || t.created_at) < stale ? "stale" : null;
  const people = new Map();   // email -> { name, cards: [{t, why}], owns: [project] }
  const person = (email, name) => { const e = nrm(email); if (!people.has(e)) people.set(e, { name: name || nameOf.get(e) || e, cards: [], owns: [] }); return people.get(e); };
  for (const t of open) {
    const why = reason(t); if (!why) continue;
    if (t.assignee_email) person(t.assignee_email, t.assignee_name).cards.push({ t, why });
    else { const p = proj.get(t.project_id); if (p?.owner_email) person(p.owner_email, p.owner_name).cards.push({ t, why, unassigned: true }); }
  }
  const stats = (p) => { const ts = (tasks || []).filter(t => t.project_id === p.id), op = ts.filter(t => !["done", "skipped"].includes(t.status)); return { total: ts.length, done: ts.length - op.length, overdue: op.filter(t => t.due_date && t.due_date < today).length, blocked: op.filter(t => t.status === "blocked").length }; };
  for (const p of projects || []) if (p.owner_email) person(p.owner_email, p.owner_name).owns.push({ p, s: stats(p) });

  const GROUPS = [["overdue", "🔴 Overdue"], ["blocked", "⛔ Blocked"], ["soon", "📅 Due in the next week"], ["stale", "💤 No update in a week or more"]];
  const sent = [], skipped = [];
  for (const [email, x] of people) {
    const ownsWithNews = x.owns.filter(o => o.s.total);
    if (!x.cards.length && !ownsWithNews.length) continue;
    const first = String(x.name).split(/\s+/)[0];
    const row = ({ t, unassigned }) => { const p = proj.get(t.project_id); return `• ${slackLink(taskLink(t), t.title)} - ${p ? slackText(p.name) + " · " : ""}${STATUS_LABEL[t.status]}${t.due_date ? " · due " + fmtDate(t.due_date) : ""}${unassigned ? " · _not assigned yet_" : ""}`; };
    const sections = GROUPS.map(([k, title]) => { const list = x.cards.filter(c => c.why === k); return list.length ? `\n*${title} (${list.length})*\n${list.map(row).join("\n")}` : ""; }).filter(Boolean).join("\n");
    const owns = ownsWithNews.length ? `\n\n*Projects you own*\n${ownsWithNews.map(({ p, s }) => `• ${slackLink(link(p.id), p.name)} - ${s.done} of ${s.total} done${s.overdue ? ` · *${s.overdue} overdue*` : ""}${s.blocked ? ` · ${s.blocked} blocked` : ""}${p.due_date ? " · due " + fmtDate(p.due_date) : ""}`).join("\n")}` : "";
    const n = x.cards.length;
    const text = `${to ? `_[Preview of ${slackText(x.name)}'s check-in]_\n` : ""}📋 Hi ${slackText(first)}, ${n ? `here's what needs your attention on DSSC tasks this week (${n} task${n === 1 ? "" : "s"}). Open a task to post an update, flag a blocker, ask for help or mark it done.` : "here's where your projects stand this week."}\n${sections}${owns}\n\n${slackLink(APP_URL + "?view=projects", "Open Tasks & Projects")}`;
    if (dry) { sent.push({ to: email, name: x.name, cards: n, text }); continue; }
    const r = await dmPerson(sb, to || email, { text }).catch(e => ({ ok: false, error: e.message }));
    (r.ok ? sent : skipped).push({ to: email, name: x.name, cards: n, error: r.error });
  }

  // Slack digest: one line per active project.
  const lines = (projects || []).filter(p => p.status !== "on_hold").map(p => { const s = stats(p); return s.total ? `• ${slackLink(link(p.id), p.name)}: ${s.done}/${s.total} done${s.overdue ? `, *${s.overdue} overdue*` : ""}${s.blocked ? `, ${s.blocked} blocked` : ""}${p.owner_name ? ` (${slackText(p.owner_name)})` : ""}` : null; }).filter(Boolean);
  let slackResult = null;
  if (lines.length && !dry && !to) slackResult = await slack(sb, `📋 *Weekly project check-in* - ${fmtDate(today)}\n${lines.join("\n")}`);
  if (!dry && !to) await sb.from("dssc_project_settings").update({ last_weekly_at: new Date().toISOString() }).eq("id", 1);
  return res.status(200).json({ ok: true, today, sent, skipped, slack: slackResult, dry });
}
