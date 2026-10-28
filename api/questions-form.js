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
// GET  /questions?r=<results token>  → Drew's copy: every question and answer
//
// Not part of the React app, like /poll and /kickoff: it opens from a Slack or
// text link with nothing to log into. DSSC forms are linked as
// www.drippingsportsclub.com/hq/api/questions-form (the club site passes
// /hq/api/* to HQ).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (+ the HQ Slack bot, Product -> Settings).

import { createClient } from "@supabase/supabase-js";
import { dmPerson } from "./_lib/product-slack.js";

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
</style></head><body><div class="wrap">
<img class="logo" src="${esc(b.logo)}" alt="${esc(b.name)}">
${inner}
</div>${script}</body></html>`;
const sorry = (msg) => page(BRAND.dssc, `<h1>Hmm.</h1><p class="sub">${esc(msg)}</p>`, "Questions");
const answered = (form, id) => String(form.answers?.[id]?.text || "").trim();

// The answers, read-only (Drew's copy, and the page after submitting).
function answersHtml(form) {
  return form.questions.map((q, i) => `<div class="qa"><div class="t">${i + 1}. ${esc(q.title)}</div><div class="sub" style="margin:0 0 6px">${esc(q.ask)}</div>${answered(form, q.id) ? `<div class="a">${esc(answered(form, q.id))}</div>` : `<div class="none">Not answered yet</div>`}</div>`).join("");
}

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).send("Server not configured");
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const q = req.query || {};
  res.setHeader("Cache-Control", "no-store");

  // ---- Drew's copy ----
  const rtok = String(q.r || "").trim();
  if (rtok) {
    if (!UUID_RE.test(rtok)) return res.status(400).send(sorry("That link isn't right."));
    const { data: form } = await sb.from("question_forms").select("*").eq("results_token", rtok).maybeSingle();
    if (!form) return res.status(404).send(sorry("We can't find that form."));
    const n = form.questions.filter(x => answered(form, x.id)).length;
    const when = (t) => new Date(t).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const state = form.status === "completed" ? `Submitted ${when(form.completed_at)}` : form.opened_at ? `In progress: ${n} of ${form.questions.length} answered` : "Not opened yet";
    return res.status(200).send(page(BRAND[form.brand] || BRAND.dssc, `<div class="eyebrow">${esc(form.recipient_name)}'s answers</div><h1>${esc(form.title)}</h1><p class="sub">${esc(state)}</p><div class="card">${answersHtml(form)}</div>`, form.title + " - answers"));
  }

  const tok = String(q.t || "").trim();
  if (!UUID_RE.test(tok)) return res.status(400).send(sorry("That link isn't right. Use the one from your message."));
  const { data: form } = await sb.from("question_forms").select("*").eq("token", tok).maybeSingle();
  if (!form) return res.status(404).send(sorry("We can't find that form."));
  const b = BRAND[form.brand] || BRAND.dssc;

  if (req.method === "POST") {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
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

  if (form.status === "completed") {
    return res.status(200).send(page(b, `<div class="card done"><h2>Sent to Drew ✓</h2><p class="sub" style="margin:0">Thanks, ${esc(String(form.recipient_name).split(" ")[0])}. Need to change something? Message Drew.</p></div><div class="card">${answersHtml(form)}</div>`, form.title));
  }
  if (!form.opened_at) await sb.from("question_forms").update({ opened_at: new Date().toISOString() }).eq("id", form.id);

  // One screen at a time, drawn in the browser from this data.
  const data = { title: form.title, intro: form.intro || "", first: String(form.recipient_name).split(" ")[0], questions: form.questions, answers: Object.fromEntries(Object.entries(form.answers || {}).map(([k, v]) => [k, v?.text || ""])) };
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const script = `<script>
const D = ${json};
const Q = D.questions, A = D.answers, app = document.getElementById("app");
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
const prog = (i) => { const n = Q.filter(has).length; return '<div class="prog"><span>Question ' + (i + 1) + ' of ' + Q.length + '</span><div class="track"><div class="fill" style="width:' + Math.round(100 * n / Q.length) + '%"></div></div><span>' + n + ' answered</span></div>'; };
function ctx(q) {
  let s = (q.context || []).map(p => '<p>' + h(p) + '</p>').join("");
  if (q.table) s += '<table><thead><tr>' + q.table.head.map((c, i) => '<th' + (i ? ' style="text-align:right"' : '') + '>' + h(c) + '</th>').join("") + '</tr></thead><tbody>' + q.table.rows.map(r => '<tr>' + r.map((c, i) => '<td' + (i ? ' class="n"' : '') + '>' + h(c) + '</td>').join("") + '</tr>').join("") + '</tbody></table>';
  if (q.bullets) s += '<ul>' + q.bullets.map(x => '<li>' + h(x) + '</li>').join("") + '</ul>';
  return s;
}
function draw() {
  window.scrollTo(0, 0);
  if (at < 0) {
    app.innerHTML = '<h1>' + h(D.title) + '</h1><p class="sub">' + h(D.intro) + '</p><div class="card"><p style="margin:0">' + Q.length + ' questions, one at a time. Each answer saves when you move on, so you can stop and come back with this same link.</p><div class="row"><button class="go" id="go">Start</button></div></div>';
    document.getElementById("go").onclick = () => { at = 0; draw(); };
    return;
  }
  if (at >= Q.length) return review();
  const q = Q[at];
  app.innerHTML = prog(at) + '<div class="card">' + (q.section ? '<div class="eyebrow">' + h(q.section) + '</div>' : '') + '<h2>' + (at + 1) + '. ' + h(q.title) + '</h2><div class="ctx">' + ctx(q) + '</div><div class="ask">' + h(q.ask) + '</div><label for="ans" class="sub" style="display:block;margin:0 0 6px">Your answer</label><textarea id="ans" placeholder="Type your answer…">' + h(A[q.id] || "") + '</textarea><div class="saved" id="note"></div><div class="row">' + (at > 0 ? '<button class="back" id="back">Back</button>' : '') + '<button class="go" id="next">' + (at === Q.length - 1 ? 'Save and review' : 'Save and next') + '</button></div><div class="err" id="err"></div></div>';
  const ta = document.getElementById("ans"), next = document.getElementById("next");
  const sync = () => { next.disabled = !ta.value.trim(); };
  ta.oninput = sync; sync();
  const save = async (to) => {
    const text = ta.value;
    if (text === (A[q.id] || "")) { at = to; return draw(); }
    next.disabled = true; document.getElementById("err").textContent = ""; document.getElementById("note").textContent = "Saving…";
    try { await post({ action: "save", id: q.id, text }); A[q.id] = text; at = to; draw(); }
    catch (e) { document.getElementById("err").textContent = e.message; document.getElementById("note").textContent = ""; sync(); }
  };
  next.onclick = () => save(at + 1);
  const back = document.getElementById("back"); if (back) back.onclick = () => (ta.value.trim() ? save(at - 1) : (at = at - 1, draw()));
}
function review() {
  const missing = Q.filter(q => !has(q)).length;
  app.innerHTML = '<h1>Review your answers</h1><p class="sub">' + (missing ? missing + ' still need an answer.' : 'All ' + Q.length + ' answered. Read them over, then send them to Drew.') + '</p><div class="card">' + Q.map((q, i) => '<div class="qa"><div class="t">' + (i + 1) + '. ' + h(q.title) + '</div>' + (has(q) ? '<div class="a">' + h(A[q.id]) + '</div>' : '<div class="none">Not answered yet</div>') + '<button class="edit" data-i="' + i + '">Edit</button></div>').join("") + '</div><div class="row"><button class="back" id="back">Back</button><button class="go" id="send"' + (missing ? ' disabled' : '') + '>Send to Drew</button></div><div class="err" id="err"></div>';
  app.querySelectorAll(".edit").forEach(b => b.onclick = () => { at = +b.dataset.i; draw(); });
  document.getElementById("back").onclick = () => { at = Q.length - 1; draw(); };
  const send = document.getElementById("send");
  send.onclick = async () => {
    send.disabled = true; send.textContent = "Sending…";
    try { await post({ action: "submit" }); app.innerHTML = '<div class="card done"><h2>Sent to Drew ✓</h2><p class="sub" style="margin:0">Thanks, ' + h(D.first) + '. Drew has your answers.</p></div>'; window.scrollTo(0, 0); }
    catch (e) { document.getElementById("err").textContent = e.message; send.disabled = false; send.textContent = "Send to Drew"; }
  };
}
draw();
</script>`;
  return res.status(200).send(page(b, `<div id="app"><noscript><p class="sub">This form needs JavaScript turned on.</p></noscript></div>`, form.title, script));
}
