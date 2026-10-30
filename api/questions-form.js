// Vercel serverless function: a one-person question form (question_forms).
// Drew, Oct 28 2026: "a form to send to Deroald where he has to respond to
// each question 1 by 1 - and let me know when it's completed".
//
// GET  /questions?t=<token>          → the form: one question per screen, his
//                                      answers so far, picking up at the first
//                                      one not answered
// POST /questions?t=<token>          → { action: "save", id, text } saves one answer
//                                      { action: "submit" } finishes it (every
//                                      question answered), Slacks Drew and marks
//                                      its Tasks & Projects card (task_id) done
// GET  /questions?r=<results token>  → Drew's copy: every question and answer,
//                                      and once they're in, a reply box under
//                                      each one (Drew, Oct 30 2026: "respond to
//                                      questions on the financial reports to
//                                      send comments back to Deroald")
// POST /questions?r=<results token>  → { action: "draft", id, text } saves a reply
//                                      { action: "send" } sends the filled-in
//                                      replies: Slacks the person a link back
//                                      to their form and adds a Tasks card
//
// Follow-ups: when Drew sends replies, the person's link (?t=) asks just
// those, one at a time, with their answer and the back-and-forth so far
// ("reply_save" / "reply_submit"); sending them Slacks Drew and closes the
// card. Then it's Drew's turn again - as many rounds as it takes.
//
// Not part of the React app, like /poll and /kickoff: it opens from a Slack or
// text link with nothing to log into. DSSC forms are linked as
// www.drippingsportsclub.com/hq/api/questions-form (the club site passes
// /hq/api/* to HQ).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (+ the HQ Slack bot, Product -> Settings).

import { createClient } from "@supabase/supabase-js";
import { dmPerson } from "./_lib/product-slack.js";
import { directorName } from "../shared/dssc-directors.js";

export const config = { maxDuration: 30 };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slackEsc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const BASE = { dssc: "https://www.drippingsportsclub.com/hq/api/questions-form", dse: "https://dseliteevals.vercel.app/questions" };

const BRAND = {
  dssc: { name: "Dripping Springs Sports Club", logo: "https://dseliteevals.vercel.app/dssc/logo-horizontal-white.png", bg: "#082C2A", card: "#0C3A37", rule: "#1F5A55", acc: "#B2D049", onAcc: "#082C2A", mut: "#A9C7C3", field: "#06211F" },
  dse: { name: "DS Elite Volleyball", logo: "https://dseliteevals.vercel.app/logos/ds-elite-white-logo.png", bg: "#0a0a0a", card: "#151515", rule: "#2a2a2a", acc: "#e91e8c", onAcc: "#ffffff", mut: "#999999", field: "#0f0f0f" },
};

const page = (b, inner, title, script = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="robots" content="noindex">
<style>
  :root { --bg:${b.bg}; --card:${b.card}; --ink:#fff; --body:#dfe9e6; --mut:${b.mut}; --rule:${b.rule}; --acc:${b.acc}; --on:${b.onAcc}; --field:${b.field}; --err:#f87171; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  body { margin:0; background:var(--bg); color:var(--body); font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif; font-size:17px; line-height:1.5; }
  .wrap { max-width:640px; margin:0 auto; padding:22px 16px 72px; }
  .logo { height:34px; margin-bottom:18px; }
  h1 { margin:4px 0 8px; color:var(--ink); font-size:clamp(1.6rem,6vw,2.1rem); line-height:1.15; }
  h2 { margin:0 0 10px; color:var(--ink); font-size:1.3rem; line-height:1.25; }
  .sub { margin:0 0 14px; color:var(--mut); font-size:.97rem; white-space:pre-line; }
  .eyebrow { font-size:12px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:var(--acc); margin-bottom:6px; }
  .card { background:var(--card); border:1px solid var(--rule); border-radius:14px; padding:18px; margin-top:12px; }
  .ctx p { margin:0 0 10px; } .ctx ul { margin:0 0 10px; padding-left:20px; } .ctx li { margin-bottom:6px; }
  .ask { border-left:3px solid var(--acc); padding:10px 12px; background:rgba(255,255,255,.04); border-radius:0 10px 10px 0; color:var(--ink); font-weight:600; margin:12px 0 14px; }
  table { width:100%; border-collapse:collapse; font-size:15px; margin:4px 0 12px; } td, th { text-align:left; padding:7px 6px; border-top:1px solid var(--rule); } th { color:var(--mut); font-size:12px; text-transform:uppercase; letter-spacing:.05em; } td.n { text-align:right; font-variant-numeric:tabular-nums; }
  textarea { width:100%; padding:12px; font:inherit; font-size:16px; color:var(--ink); background:var(--field); border:1px solid var(--rule); border-radius:10px; min-height:150px; resize:vertical; }
  textarea:focus { outline:2px solid var(--acc); outline-offset:1px; }
  .row { display:flex; gap:10px; margin-top:14px; }
  button { font:inherit; cursor:pointer; border-radius:12px; }
  .go { flex:1; padding:15px; font-weight:800; font-size:17px; background:var(--acc); color:var(--on); border:none; }
  .back { padding:15px 18px; font-weight:700; background:transparent; color:var(--body); border:1px solid var(--rule); }
  .go:disabled { opacity:.45; cursor:default; }
  .prog { display:flex; align-items:center; gap:10px; font-size:13px; color:var(--mut); margin-bottom:12px; }
  .track { flex:1; height:6px; background:var(--rule); border-radius:6px; overflow:hidden; } .fill { height:100%; background:var(--acc); }
  .err { color:var(--err); font-weight:700; margin-top:10px; }
  .saved { color:var(--mut); font-size:13px; margin-top:8px; min-height:18px; }
  .qa { border-top:1px solid var(--rule); padding:14px 0; } .qa:first-child { border-top:0; padding-top:0; }
  .qa .t { color:var(--ink); font-weight:700; margin-bottom:4px; } .qa .a { white-space:pre-wrap; } .qa .none { color:var(--err); }
  .edit { background:none; border:none; color:var(--acc); font-weight:700; padding:0; font-size:14px; }
  .done h2 { color:var(--acc); }
  .msg { background:rgba(255,255,255,.04); border:1px solid var(--rule); border-radius:12px; padding:10px 12px; margin-top:8px; }
  .msg.me { border-color:var(--acc); background:transparent; }
  .msg .who, .ask .who { font-size:12px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; color:var(--mut); margin-bottom:4px; }
  .msg.me .who { color:var(--acc); }
  .ask .txt { white-space:pre-wrap; font-weight:500; }
  details.mine { margin:0 0 4px; } details.mine summary { cursor:pointer; color:var(--acc); font-weight:700; font-size:14px; }
  details.mine .a { margin-top:6px; font-size:15px; }
  .rl { display:block; margin:12px 0 6px; font-size:13px; font-weight:700; color:var(--mut); }
  textarea.reply { min-height:70px; }
  .tag { display:inline-block; margin-top:10px; font-size:12px; font-weight:800; color:var(--acc); border:1px solid var(--acc); border-radius:20px; padding:3px 10px; }
  .bar { position:sticky; bottom:0; background:var(--bg); padding:12px 0 16px; margin-top:8px; }
  .bar .go { width:100%; }
</style></head><body><div class="wrap">
<img class="logo" src="${esc(b.logo)}" alt="${esc(b.name)}">
${inner}
</div>${script}</body></html>`;
const sorry = (msg) => page(BRAND.dssc, `<h1>Hmm.</h1><p class="sub">${esc(msg)}</p>`, "Questions");
const answered = (form, id) => String(form.answers?.[id]?.text || "").trim();
const firstName = (n) => String(n || "").split(/\s+/)[0];
const when = (t) => new Date(t).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Follow-ups: the back-and-forth after an answer, and whose turn it is.
const thread = (form, id) => Array.isArray(form.replies?.[id]) ? form.replies[id] : [];
const waitingOn = (form) => form.followup === "waiting" ? form.questions.filter(q => thread(form, q.id).at(-1)?.by === "asker") : [];
const askerName = (form) => firstName(directorName(form.notify_email)) || "Drew";
const formLink = (form) => `${BASE[form.brand] || BASE.dssc}?t=${form.token}`;
const resultsLink = (form) => `${BASE[form.brand] || BASE.dssc}?r=${form.results_token}`;
function threadHtml(form, id) {
  return thread(form, id).map(m => `<div class="msg ${m.by === "asker" ? "me" : ""}"><div class="who">${esc(m.by === "asker" ? askerName(form) : firstName(form.recipient_name))} · ${esc(when(m.at))}</div><div class="a">${esc(m.text)}</div></div>`).join("");
}

// The answers, read-only (Drew's copy, and the page after submitting).
function answersHtml(form) {
  return form.questions.map((q, i) => `<div class="qa"><div class="t">${i + 1}. ${esc(q.title)}</div><div class="sub" style="margin:0 0 6px">${esc(q.ask)}</div>${answered(form, q.id) ? `<div class="a">${esc(answered(form, q.id))}</div>` : `<div class="none">Not answered yet</div>`}${threadHtml(form, q.id)}</div>`).join("");
}

// Drew's copy once the answers are in: each answer, the follow-ups so far, and
// a reply box under each (unless his last replies are still with them).
function askerPage(form) {
  const them = firstName(form.recipient_name), waiting = form.followup === "waiting";
  const pend = new Set(waitingOn(form).map(q => q.id)), drafts = form.drafts?.asker || {};
  const state = waiting ? `You sent ${plural(pend.size, "follow-up", "follow-ups")} ${when(form.followup_sent_at)}. Waiting on ${them}.`
    : form.followup === "answered" ? `${them} answered your follow-ups ${when(form.followup_answered_at)}.`
    : `${them} sent these ${when(form.completed_at)}.`;
  const lead = waiting ? `<p class="sub">You can reply again once ${esc(them)} sends answers back. You'll get a Slack message.</p>`
    : `<p class="sub">Reply under any answer you want to follow up on and leave the rest blank. Replies save as you type. Nothing goes to ${esc(them)} until you press Send.</p>`;
  const items = form.questions.map((q, i) => {
    const head = q.section && q.section !== form.questions[i - 1]?.section ? `<div class="eyebrow" style="margin-top:${i ? 10 : 0}px">${esc(q.section)}</div>` : "";
    const box = waiting ? (pend.has(q.id) ? `<div class="tag">Waiting on ${esc(them)}</div>` : "")
      : `<label class="rl" for="r-${esc(q.id)}">Reply to ${esc(them)}</label><textarea class="reply" id="r-${esc(q.id)}" data-id="${esc(q.id)}" placeholder="Leave blank if this one's fine">${esc(drafts[q.id] || "")}</textarea><div class="saved"></div>`;
    return `${head}<div class="qa"><div class="t">${i + 1}. ${esc(q.title)}</div><div class="sub" style="margin:0 0 8px">${esc(q.ask)}</div><div class="msg"><div class="who">${esc(them)}'s answer</div>${answered(form, q.id) ? `<div class="a">${esc(answered(form, q.id))}</div>` : `<div class="none">Not answered</div>`}</div>${threadHtml(form, q.id)}${box}</div>`;
  }).join("");
  const bar = waiting ? "" : `<div class="bar"><div class="err" id="err"></div><button class="go" id="send" disabled>Write a reply to send</button></div>`;
  const script = waiting ? "" : `<script>
const THEM = ${JSON.stringify(them).replace(/</g, "\\u003c")};
const tas = [...document.querySelectorAll("textarea[data-id]")], send = document.getElementById("send"), err = document.getElementById("err");
let chain = Promise.resolve();
const post = (body) => (chain = chain.catch(() => {}).then(async () => {
  const r = await fetch(location.href, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Couldn't save - check your connection and try again.");
  return d;
}));
const dirty = new Set(), timers = {};
const fit = (ta) => { ta.style.height = "auto"; ta.style.height = Math.max(70, ta.scrollHeight + 2) + "px"; };
const count = () => tas.filter(t => t.value.trim()).length;
const label = () => { const n = count(); send.disabled = !n; send.textContent = n ? "Send " + n + (n === 1 ? " reply" : " replies") + " to " + THEM : "Write a reply to send"; };
function save(ta) {
  const id = ta.dataset.id, note = ta.nextElementSibling, text = ta.value;
  clearTimeout(timers[id]); dirty.delete(id);
  return post({ action: "draft", id, text }).then(() => { note.style.color = ""; note.textContent = text.trim() ? "Saved" : ""; }, (e) => { dirty.add(id); note.style.color = "var(--err)"; note.textContent = e.message; throw e; });
}
tas.forEach(ta => {
  fit(ta);
  ta.oninput = () => { fit(ta); label(); ta.nextElementSibling.textContent = ""; dirty.add(ta.dataset.id); clearTimeout(timers[ta.dataset.id]); timers[ta.dataset.id] = setTimeout(() => save(ta).catch(() => {}), 800); };
  ta.onblur = () => { if (dirty.has(ta.dataset.id)) save(ta).catch(() => {}); };
});
label();
send.onclick = async () => {
  const n = count(); err.textContent = "";
  if (!confirm("Send " + n + (n === 1 ? " reply" : " replies") + " to " + THEM + "? They'll get a Slack message with a link to answer.")) return;
  send.disabled = true; send.textContent = "Sending…";
  try { await Promise.all(tas.filter(t => dirty.has(t.dataset.id)).map(save)); await post({ action: "send" }); location.reload(); }
  catch (e) { err.textContent = e.message; label(); }
};
window.addEventListener("beforeunload", (e) => { if (dirty.size) { e.preventDefault(); e.returnValue = ""; } });
</script>`;
  return page(BRAND[form.brand] || BRAND.dssc, `<div class="eyebrow">${esc(form.recipient_name)}'s answers</div><h1>${esc(form.title)}</h1><p class="sub" style="margin-bottom:4px">${esc(state)}</p>${lead}<div class="card">${items}</div>${bar}`, form.title + " - answers", script);
}

// This round's Tasks & Projects card, copied from the form's own card.
async function followupTask(sb, form, n) {
  const { data: orig } = form.task_id ? await sb.from("dssc_project_tasks").select("project_id, category, departments").eq("id", form.task_id).maybeSingle() : { data: null };
  const about = /^questions on /i.test(form.title) ? form.title.replace(/^questions on /i, "") : `"${form.title}"`;
  const asker = askerName(form);
  const { data: t, error } = await sb.from("dssc_project_tasks").insert({
    project_id: orig?.project_id ?? null, title: `Answer ${asker}'s ${plural(n, "follow-up", "follow-ups")} on ${about}`,
    details: `${asker} read your answers on ${about} and replied to ${n === 1 ? "one of them" : `${n} of them`}.\n\nAnswer each one in the form (link below). Replies save as you go. When you press "Send to ${asker}", this task is marked done.`,
    status: "todo", priority: "normal", assignee_email: form.recipient_email, assignee_name: form.recipient_name,
    due_date: new Date(Date.now() + 3 * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }),
    category: orig?.category ?? null, departments: orig?.departments ?? [], link_url: formLink(form), created_by: form.notify_email,
  }).select("id, project_id").single();
  if (error) { console.error("questions-form follow-up task", error.message); return null; }
  await sb.from("dssc_project_updates").insert({ project_id: t.project_id, task_id: t.id, kind: "created", body: "Added this task.", author_name: directorName(form.notify_email) || asker, author_email: form.notify_email });
  return t.id;
}

// The asker's side: save a reply, send the filled-in ones.
async function askerPost(sb, form, body) {
  const them = firstName(form.recipient_name);
  if (form.status !== "completed") return [409, { error: `${them} hasn't sent the answers yet.` }];
  if (form.followup === "waiting") return [409, { error: `Your last replies are still with ${them}. You can reply again once ${them} answers.` }];
  const drafts = { ...(form.drafts || {}) }, mine = { ...(drafts.asker || {}) };
  if (body.action === "draft") {
    if (!form.questions.some(x => x.id === body.id)) return [400, { error: "Unknown question" }];
    const text = String(body.text || "").slice(0, 20000);
    if (text.trim()) mine[body.id] = text; else delete mine[body.id];
    const { error } = await sb.from("question_forms").update({ drafts: { ...drafts, asker: mine } }).eq("id", form.id);
    return error ? [500, { error: error.message }] : [200, { ok: true }];
  }
  if (body.action === "send") {
    const now = new Date().toISOString();
    const sending = form.questions.filter(q => String(mine[q.id] || "").trim());
    if (!sending.length) return [400, { error: "Write a reply under at least one answer first." }];
    const replies = { ...(form.replies || {}) };
    for (const q of sending) replies[q.id] = [...thread(form, q.id), { by: "asker", text: mine[q.id].trim(), at: now }];
    const { error } = await sb.from("question_forms").update({ replies, drafts: { ...drafts, asker: {} }, followup: "waiting", followup_round: (form.followup_round || 0) + 1, followup_sent_at: now, followup_answered_at: null }).eq("id", form.id);
    if (error) return [500, { error: error.message }];
    const task = await followupTask(sb, form, sending.length);
    if (task) await sb.from("question_forms").update({ followup_task_id: task }).eq("id", form.id);
    const asker = askerName(form);
    const r = await dmPerson(sb, form.recipient_email, { text: `💬 ${slackEsc(asker)} read your answers on *${slackEsc(form.title)}* and replied to ${sending.length === 1 ? "one of them" : `${sending.length} of them`}.\n<${formLink(form)}|Answer ${slackEsc(asker)}'s follow-ups>` }).catch(e => ({ ok: false, error: e.message }));
    if (!r.ok) console.error("questions-form follow-up notify", r.error);
    return [200, { ok: true, sent: sending.length, notified: !!r.ok, task_id: task }];
  }
  return [400, { error: "Unknown action" }];
}

// The person's side of a follow-up round: save a reply, send them all back.
async function replyPost(sb, form, body) {
  const asker = askerName(form), open = waitingOn(form);
  const drafts = { ...(form.drafts || {}) }, mine = { ...(drafts.recipient || {}) };
  if (body.action === "reply_save") {
    if (!open.some(x => x.id === body.id)) return [400, { error: "Unknown question" }];
    mine[body.id] = String(body.text || "").slice(0, 20000);
    const { error } = await sb.from("question_forms").update({ drafts: { ...drafts, recipient: mine } }).eq("id", form.id);
    return error ? [500, { error: error.message }] : [200, { ok: true }];
  }
  if (body.action === "reply_submit") {
    const missing = open.map((q, i) => String(mine[q.id] || "").trim() ? null : i + 1).filter(Boolean);
    if (missing.length) return [400, { error: `Follow-up${missing.length === 1 ? "" : "s"} ${missing.join(", ")} still need${missing.length === 1 ? "s" : ""} an answer.` }];
    const now = new Date().toISOString(), replies = { ...(form.replies || {}) };
    for (const q of open) replies[q.id] = [...thread(form, q.id), { by: "recipient", text: mine[q.id].trim(), at: now }];
    const { error } = await sb.from("question_forms").update({ replies, drafts: { ...drafts, recipient: {} }, followup: "answered", followup_answered_at: now }).eq("id", form.id);
    if (error) return [500, { error: error.message }];
    if (form.followup_task_id) {
      const { data: task } = await sb.from("dssc_project_tasks").update({ status: "done", completed_at: now, completed_by: form.recipient_name, last_activity_at: now }).eq("id", form.followup_task_id).neq("status", "done").select("id, project_id").maybeSingle();
      if (task) await sb.from("dssc_project_updates").insert({ project_id: task.project_id, task_id: task.id, kind: "status", body: `Done - replies sent to ${asker}.`, author_name: form.recipient_name, author_email: form.recipient_email });
    }
    const r = await dmPerson(sb, form.notify_email, { text: `✅ *${slackEsc(form.recipient_name)}* answered your ${plural(open.length, "follow-up", "follow-ups")} on *${slackEsc(form.title)}*.\n<${resultsLink(form)}|Read them and reply>` }).catch(e => ({ ok: false, error: e.message }));
    if (!r.ok) console.error("questions-form follow-up answered notify", r.error);
    return [200, { ok: true }];
  }
  return [400, { error: "Unknown action" }];
}

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).send("Server not configured");
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return runQuestionsForm(sb, req, res);
}

export async function runQuestionsForm(sb, req, res) {
  const q = req.query || {};
  const readBody = () => typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  res.setHeader("Cache-Control", "no-store");

  // ---- Drew's copy ----
  const rtok = String(q.r || "").trim();
  if (rtok) {
    if (!UUID_RE.test(rtok)) return res.status(400).send(sorry("That link isn't right."));
    const { data: form } = await sb.from("question_forms").select("*").eq("results_token", rtok).maybeSingle();
    if (!form) return res.status(404).send(sorry("We can't find that form."));
    if (req.method === "POST") { const [code, out] = await askerPost(sb, form, readBody()); return res.status(code).json(out); }
    if (form.status === "completed") return res.status(200).send(askerPage(form));
    const n = form.questions.filter(x => answered(form, x.id)).length;
    const state = form.status === "completed" ? `Submitted ${when(form.completed_at)}` : form.opened_at ? `In progress: ${n} of ${form.questions.length} answered` : "Not opened yet";
    return res.status(200).send(page(BRAND[form.brand] || BRAND.dssc, `<div class="eyebrow">${esc(form.recipient_name)}'s answers</div><h1>${esc(form.title)}</h1><p class="sub">${esc(state)}</p><div class="card">${answersHtml(form)}</div>`, form.title + " - answers"));
  }

  const tok = String(q.t || "").trim();
  if (!UUID_RE.test(tok)) return res.status(400).send(sorry("That link isn't right. Use the one from your message."));
  const { data: form } = await sb.from("question_forms").select("*").eq("token", tok).maybeSingle();
  if (!form) return res.status(404).send(sorry("We can't find that form."));
  const b = BRAND[form.brand] || BRAND.dssc;

  if (req.method === "POST") {
    const body = readBody();
    if (form.status === "completed" && form.followup === "waiting") { const [code, out] = await replyPost(sb, form, body); return res.status(code).json(out); }
    if (form.status === "completed") return res.status(409).json({ error: "This was already sent to Drew. Message him if you need to change an answer." });
    if (body.action === "save") {
      const qq = form.questions.find(x => x.id === body.id);
      if (!qq) return res.status(400).json({ error: "Unknown question" });
      const text = String(body.text || "").slice(0, 20000);
      const answers = { ...(form.answers || {}), [qq.id]: { text, at: new Date().toISOString() } };
      const { error } = await sb.from("question_forms").update({ answers, status: "started" }).eq("id", form.id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    if (body.action === "submit") {
      const missing = form.questions.map((x, i) => answered(form, x.id) ? null : i + 1).filter(Boolean);
      if (missing.length) return res.status(400).json({ error: `Question${missing.length === 1 ? "" : "s"} ${missing.join(", ")} still need an answer.` });
      const now = new Date().toISOString();
      await sb.from("question_forms").update({ status: "completed", completed_at: now }).eq("id", form.id);
      if (form.task_id) {
        const { data: task } = await sb.from("dssc_project_tasks").update({ status: "done", completed_at: now, completed_by: form.recipient_name, last_activity_at: now }).eq("id", form.task_id).neq("status", "done").select("id, project_id").maybeSingle();
        if (task) await sb.from("dssc_project_updates").insert({ project_id: task.project_id, task_id: task.id, kind: "status", body: "Done - answers sent to Drew.", author_name: form.recipient_name, author_email: form.recipient_email });
      }
      const link = `${BASE[form.brand] || BASE.dssc}?r=${form.results_token}`;
      const r = await dmPerson(sb, form.notify_email, { text: `✅ *${slackEsc(form.recipient_name)}* answered all ${form.questions.length} questions on *${slackEsc(form.title)}*.\n<${link}|Read the answers>` }).catch(e => ({ ok: false, error: e.message }));
      if (r.ok) await sb.from("question_forms").update({ notified_at: now }).eq("id", form.id);
      else console.error("questions-form notify", r.error);
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: "Unknown action" });
  }

  const followups = form.status === "completed" && form.followup === "waiting";
  if (form.status === "completed" && !followups) {
    return res.status(200).send(page(b, `<div class="card done"><h2>Sent to ${esc(askerName(form))} ✓</h2><p class="sub" style="margin:0">Thanks, ${esc(firstName(form.recipient_name))}. Need to change something? Message ${esc(askerName(form))}.</p></div><div class="card">${answersHtml(form)}</div>`, form.title));
  }
  if (!form.opened_at) await sb.from("question_forms").update({ opened_at: new Date().toISOString() }).eq("id", form.id);

  // One screen at a time, drawn in the browser from this data: the questions,
  // or in a follow-up round just the ones with a reply waiting.
  const data = followups
    ? { mode: "followup", asker: askerName(form), title: form.title, first: firstName(form.recipient_name),
        questions: waitingOn(form).map(x => { const t = thread(form, x.id); return { id: x.id, section: x.section, title: x.title, ask: x.ask, answer: answered(form, x.id), earlier: t.slice(0, -1).map(m => ({ who: m.by === "asker" ? askerName(form) : "You", text: m.text })), comment: t.at(-1).text }; }),
        answers: form.drafts?.recipient || {} }
    : { mode: "answer", asker: askerName(form), title: form.title, intro: form.intro || "", first: firstName(form.recipient_name), questions: form.questions, answers: Object.fromEntries(Object.entries(form.answers || {}).map(([k, v]) => [k, v?.text || ""])) };
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const script = `<script>
const D = ${json};
const Q = D.questions, A = D.answers, app = document.getElementById("app"), F = D.mode === "followup";
const SAVE = F ? "reply_save" : "save", SUBMIT = F ? "reply_submit" : "submit", NOUN = F ? "Follow-up" : "Question";
const h = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const has = (q) => String(A[q.id] || "").trim().length > 0;
const firstOpen = () => { const i = Q.findIndex(q => !has(q)); return i < 0 ? Q.length : i; };
let at = Q.some(has) ? firstOpen() : -1;   // -1 intro, 0..n-1 a question, n the review
async function post(body) {
  const r = await fetch(location.href, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Couldn't save - check your connection and try again.");
  return d;
}
const prog = (i) => { const n = Q.filter(has).length; return '<div class="prog"><span>' + NOUN + ' ' + (i + 1) + ' of ' + Q.length + '</span><div class="track"><div class="fill" style="width:' + Math.round(100 * n / Q.length) + '%"></div></div><span>' + n + ' answered</span></div>'; };
function ctx(q) {
  if (F) return '<details class="mine"><summary>Your answer</summary><div class="a">' + h(q.answer) + '</div></details>' + q.earlier.map(m => '<div class="msg"><div class="who">' + h(m.who) + '</div><div class="a">' + h(m.text) + '</div></div>').join("");
  let s = (q.context || []).map(p => '<p>' + h(p) + '</p>').join("");
  if (q.table) s += '<table><thead><tr>' + q.table.head.map((c, i) => '<th' + (i ? ' style="text-align:right"' : '') + '>' + h(c) + '</th>').join("") + '</tr></thead><tbody>' + q.table.rows.map(r => '<tr>' + r.map((c, i) => '<td' + (i ? ' class="n"' : '') + '>' + h(c) + '</td>').join("") + '</tr>').join("") + '</tbody></table>';
  if (q.bullets) s += '<ul>' + q.bullets.map(x => '<li>' + h(x) + '</li>').join("") + '</ul>';
  return s;
}
function draw() {
  window.scrollTo(0, 0);
  if (at < 0) {
    app.innerHTML = F
      ? '<div class="eyebrow">' + h(D.title) + '</div><h1>' + h(D.asker) + ' replied to ' + (Q.length === 1 ? 'one of your answers' : Q.length + ' of your answers') + '</h1><div class="card"><p style="margin:0">Answer ' + (Q.length === 1 ? 'it' : 'each one, one at a time') + ', then send ' + (Q.length === 1 ? 'it' : 'them') + ' back. Replies save when you move on, so you can stop and come back with this same link.</p><div class="row"><button class="go" id="go">Start</button></div></div>'
      : '<h1>' + h(D.title) + '</h1><p class="sub">' + h(D.intro) + '</p><div class="card"><p style="margin:0">' + Q.length + ' questions, one at a time. Each answer saves when you move on, so you can stop and come back with this same link.</p><div class="row"><button class="go" id="go">Start</button></div></div>';
    document.getElementById("go").onclick = () => { at = 0; draw(); };
    return;
  }
  if (at >= Q.length) return review();
  const q = Q[at];
  app.innerHTML = prog(at) + '<div class="card">' + (q.section ? '<div class="eyebrow">' + h(q.section) + '</div>' : '') + '<h2>' + (at + 1) + '. ' + h(q.title) + '</h2>' + (F ? '<p class="sub" style="margin:0 0 10px">' + h(q.ask) + '</p>' : '') + '<div class="ctx">' + ctx(q) + '</div>' + (F ? '<div class="ask"><div class="who">' + h(D.asker) + ' wrote</div><div class="txt">' + h(q.comment) + '</div></div>' : '<div class="ask">' + h(q.ask) + '</div>') + '<label for="ans" class="sub" style="display:block;margin:0 0 6px">' + (F ? 'Your reply' : 'Your answer') + '</label><textarea id="ans" placeholder="' + (F ? 'Type your reply…' : 'Type your answer…') + '">' + h(A[q.id] || "") + '</textarea><div class="saved" id="note"></div><div class="row">' + (at > 0 ? '<button class="back" id="back">Back</button>' : '') + '<button class="go" id="next">' + (at === Q.length - 1 ? 'Save and review' : 'Save and next') + '</button></div><div class="err" id="err"></div></div>';
  const ta = document.getElementById("ans"), next = document.getElementById("next");
  const sync = () => { next.disabled = !ta.value.trim(); };
  ta.oninput = sync; sync();
  const save = async (to) => {
    const text = ta.value;
    if (text === (A[q.id] || "")) { at = to; return draw(); }
    next.disabled = true; document.getElementById("err").textContent = ""; document.getElementById("note").textContent = "Saving…";
    try { await post({ action: SAVE, id: q.id, text }); A[q.id] = text; at = to; draw(); }
    catch (e) { document.getElementById("err").textContent = e.message; document.getElementById("note").textContent = ""; sync(); }
  };
  next.onclick = () => save(at + 1);
  const back = document.getElementById("back"); if (back) back.onclick = () => (ta.value.trim() ? save(at - 1) : (at = at - 1, draw()));
}
function review() {
  const missing = Q.filter(q => !has(q)).length;
  app.innerHTML = '<h1>Review your ' + (F ? 'replies' : 'answers') + '</h1><p class="sub">' + (missing ? missing + ' still need an answer.' : 'All ' + Q.length + ' answered. Read them over, then send them to ' + h(D.asker) + '.') + '</p><div class="card">' + Q.map((q, i) => '<div class="qa"><div class="t">' + (i + 1) + '. ' + h(q.title) + '</div>' + (F ? '<div class="msg me"><div class="who">' + h(D.asker) + '</div><div class="a">' + h(q.comment) + '</div></div><div class="rl">Your reply</div>' : '') + (has(q) ? '<div class="a">' + h(A[q.id]) + '</div>' : '<div class="none">Not answered yet</div>') + '<button class="edit" data-i="' + i + '">Edit</button></div>').join("") + '</div><div class="row"><button class="back" id="back">Back</button><button class="go" id="send"' + (missing ? ' disabled' : '') + '>Send to ' + h(D.asker) + '</button></div><div class="err" id="err"></div>';
  app.querySelectorAll(".edit").forEach(b => b.onclick = () => { at = +b.dataset.i; draw(); });
  document.getElementById("back").onclick = () => { at = Q.length - 1; draw(); };
  const send = document.getElementById("send");
  send.onclick = async () => {
    send.disabled = true; send.textContent = "Sending…";
    try { await post({ action: SUBMIT }); app.innerHTML = '<div class="card done"><h2>Sent to ' + h(D.asker) + ' ✓</h2><p class="sub" style="margin:0">Thanks, ' + h(D.first) + '. ' + h(D.asker) + ' has your ' + (F ? 'replies' : 'answers') + '.</p></div>'; window.scrollTo(0, 0); }
    catch (e) { document.getElementById("err").textContent = e.message; send.disabled = false; send.textContent = "Send to " + D.asker; }
  };
}
draw();
</script>`;
  return res.status(200).send(page(b, `<div id="app"><noscript><p class="sub">This form needs JavaScript turned on.</p></noscript></div>`, form.title, script));
}
