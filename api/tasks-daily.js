// DSSC Tasks - the morning run (Drew, Oct 28 2026). Every day, 7:45am Central:
//   1. makes the repeating tasks due in the next few days (api/_lib/tasks.js),
//   2. closes daily repeats nobody finished two days on (as missed),
//   3. posts one Slack digest: per person, what's due today, overdue (new
//      overdue ones called out once), blocked, and open help requests -
//      @mentioning anyone whose Slack member ID is in settings.
// Nothing due and nothing late = no Slack post.
//
// Auth: Vercel Cron (Authorization: Bearer <CRON_SECRET>) or the service-role key.
// Query: ?dry=1 (build the digest, change nothing, post nothing)
//        ?force=1 (post even if the daily digest is switched off)
import { createClient } from "@supabase/supabase-js";
import { centralToday, fmtDate, slack, slackLink, slackText } from "./_lib/projects.js";
import { taskLink, mention, settingsRow, generateRecurring, closeMissedDaily } from "./_lib/tasks.js";

const nrm = (v) => String(v || "").trim().toLowerCase();

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET } = process.env;
  const url = new URL(req.url, "https://x");
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer || (bearer !== CRON_SECRET && bearer !== SUPABASE_SERVICE_ROLE_KEY)) return res.status(403).json({ error: "Forbidden" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const dry = url.searchParams.get("dry") === "1", force = url.searchParams.get("force") === "1";
  const today = centralToday();
  const st = await settingsRow(sb);

  const gen = dry ? null : await generateRecurring(sb, today);
  const missed = dry ? 0 : await closeMissedDaily(sb, today);

  const [{ data: tasks }, { data: projects }] = await Promise.all([
    sb.from("dssc_project_tasks").select("id, project_id, title, status, due_date, assignee_email, assignee_name, blocker, help_requested_at, help_note, help_from, help_by, overdue_notified_at").in("status", ["todo", "doing", "blocked"]),
    sb.from("dssc_projects").select("id, name, status"),
  ]);
  const live = new Map((projects || []).filter(p => !["done", "archived"].includes(p.status)).map(p => [p.id, p]));
  const open = (tasks || []).filter(t => !t.project_id || live.has(t.project_id));
  const line = (t, extra = "") => `${slackLink(taskLink(t), t.title)}${t.project_id ? ` _(${slackText(live.get(t.project_id).name)})_` : ""}${extra}`;

  // Per person: today, overdue (✨ = went overdue since the last digest), blocked.
  const byPerson = new Map();
  const bucket = (t) => { const k = nrm(t.assignee_email) || "_none"; if (!byPerson.has(k)) byPerson.set(k, { name: t.assignee_name || "Not assigned", email: k, today: [], late: [], blocked: [] }); return byPerson.get(k); };
  const newlyLate = [];
  for (const t of open) {
    const late = t.due_date && t.due_date < today, due = t.due_date === today;
    if (!late && !due && t.status !== "blocked") continue;
    const b = bucket(t);
    if (t.status === "blocked") b.blocked.push(t);
    else if (late) { b.late.push(t); if (!t.overdue_notified_at) newlyLate.push(t.id); }
    else b.today.push(t);
  }
  const help = open.filter(t => t.help_requested_at);
  const people = [...byPerson.values()].sort((a, b) => (a.email === "_none") - (b.email === "_none") || a.name.localeCompare(b.name));
  const blocks = people.map(p => {
    const who = p.email === "_none" ? "*Not assigned*" : `*${slackText(p.name)}* ${mention(st, p.email, "").trim()}`.trim();
    const rows = [
      ...p.late.map(t => `   🔴 ${line(t, ` - due ${fmtDate(t.due_date)}${newlyLate.includes(t.id) ? " ✨" : ""}`)}`),
      ...p.today.map(t => `   ⬜ ${line(t)}`),
      ...p.blocked.map(t => `   ⛔ ${line(t, t.blocker ? ` - "${slackText(t.blocker)}"` : "")}`),
    ];
    return `${who}  ${[p.today.length && `${p.today.length} today`, p.late.length && `${p.late.length} overdue`, p.blocked.length && `${p.blocked.length} blocked`].filter(Boolean).join(" · ")}\n${rows.slice(0, 12).join("\n")}${rows.length > 12 ? `\n   …and ${rows.length - 12} more` : ""}`;
  });
  const helpBlock = help.length ? `\n🙋 *Asking for help*\n${help.map(t => `   ${line(t)} - ${slackText(t.help_note || "")}${t.help_from ? ` → ${mention(st, t.help_from, "")}` : ""}`).join("\n")}` : "";
  const text = blocks.length || helpBlock ? `☀️ *Today's tasks* - ${fmtDate(today)}\n\n${blocks.join("\n\n")}${helpBlock}` : null;

  let posted = null;
  const on = st.daily_digest !== false || force;
  if (text && on && !dry) {
    posted = await slack(sb, text);
    if (posted?.ok && newlyLate.length) await sb.from("dssc_project_tasks").update({ overdue_notified_at: new Date().toISOString() }).in("id", newlyLate);
  }
  if (!dry) await sb.from("dssc_project_settings").update({ last_daily_at: new Date().toISOString() }).eq("id", 1);
  return res.status(200).json({ ok: true, today, generated: gen, missedClosed: missed, people: people.length, help: help.length, newlyLate: newlyLate.length, slack: posted, digest: dry ? text : undefined, digestOn: on });
}
