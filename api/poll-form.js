// Vercel serverless function: a coach poll (coach_polls / coach_poll_invites).
//
// GET  /poll?t=<invite token>   → that coach's poll, pre-filled if they answered
// POST /poll?t=<invite token>   → saves their answers (they can change them later)
// GET  /poll?r=<results token>  → Drew's tallies and who said what
//
// Not part of the React app, like /kickoff and /privates: it opens from a text
// on a phone, and not every coach has the app installed.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const page = (inner, title) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
  :root { --bg:#0a0a0a; --card:#151515; --ink:#fff; --body:#d6d6d6; --mut:#999; --rule:#2a2a2a; --acc:#e91e8c; --grn:#22c55e; --err:#f87171; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  body { margin:0; background:var(--bg); color:var(--body); font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif; font-size:17px; line-height:1.5; }
  .wrap { max-width:560px; margin:0 auto; padding:22px 16px 64px; }
  .logo { height:44px; width:44px; border-radius:10px; margin-bottom:12px; }
  h1 { margin:4px 0 6px; color:var(--ink); font-size:clamp(1.7rem,7vw,2.2rem); line-height:1.1; }
  .sub { margin:0 0 16px; color:var(--mut); font-size:.97rem; white-space:pre-line; }
  .card { background:var(--card); border:1px solid var(--rule); border-radius:14px; padding:16px; margin-top:12px; }
  .q { font-weight:700; color:var(--ink); margin:0 0 10px; }
  .opts { display:flex; flex-direction:column; gap:8px; }
  .opt { text-align:left; padding:14px; font:inherit; font-weight:600; cursor:pointer; background:transparent; color:var(--body); border:1px solid var(--rule); border-radius:12px; }
  .opt[aria-pressed="true"] { background:rgba(233,30,140,.14); border-color:var(--acc); color:#f9a8d4; }
  textarea { width:100%; padding:12px; font:inherit; font-size:16px; color:var(--ink); background:#0f0f0f; border:1px solid var(--rule); border-radius:10px; min-height:64px; }
  .save { width:100%; margin-top:16px; padding:16px; font:inherit; font-weight:800; font-size:18px; cursor:pointer; background:var(--acc); color:#fff; border:none; border-radius:12px; }
  .save:disabled { opacity:.5; }
  .err { color:var(--err); font-weight:700; margin-top:10px; }
  .ok { border-color:var(--grn); } .ok h2 { color:var(--grn); margin:0 0 6px; }
  .hide { display:none; }
  table { width:100%; border-collapse:collapse; font-size:14px; } td, th { text-align:left; padding:7px 6px; border-top:1px solid var(--rule); vertical-align:top; }
  .bar { height:8px; background:var(--acc); border-radius:4px; margin-top:3px; }
</style></head><body><div class="wrap">
<img class="logo" src="/icon-192.png" alt="DS Elite">
${inner}
</div></body></html>`;
const sorry = (msg) => page(`<h1>Hmm.</h1><p class="sub">${esc(msg)}</p>`, "DS Elite poll");

const answerText = (q, v) => {
  if (v == null || v === "" || (Array.isArray(v) && !v.length)) return "";
  if (q.kind === "text") return String(v);
  const lab = (k) => (q.options || []).find(o => o.k === k)?.label || k;
  return Array.isArray(v) ? v.map(lab).join(", ") : lab(v);
};

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).send("Server not configured");
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const q = req.query || {};
  res.setHeader("Cache-Control", "no-store");

  // ---- results (Drew) ----
  const rtok = String(q.r || "").trim();
  if (rtok) {
    if (!UUID_RE.test(rtok)) return res.status(400).send(sorry("That results link isn't right."));
    const { data: poll } = await sb.from("coach_polls").select("*").eq("results_token", rtok).maybeSingle();
    if (!poll) return res.status(404).send(sorry("We can't find that poll."));
    const { data: inv } = await sb.from("coach_poll_invites").select("name, answers, answered_at").eq("poll_id", poll.id).order("name");
    const done = (inv || []).filter(i => i.answered_at), waiting = (inv || []).filter(i => !i.answered_at);
    const tallies = poll.questions.filter(x => x.kind !== "text").map(x => {
      const rows = x.options.map(o => { const who = done.filter(i => { const v = i.answers?.[x.id]; return Array.isArray(v) ? v.includes(o.k) : v === o.k; }).map(i => i.name); return { o, who }; });
      return `<div class="card"><p class="q">${esc(x.label)}</p><table>${rows.map(({ o, who }) => `<tr><td style="width:45%">${esc(o.label)}<div class="bar" style="width:${done.length ? Math.round(100 * who.length / done.length) : 0}%"></div></td><td><b>${who.length}</b> ${who.length ? "· " + esc(who.join(", ")) : ""}</td></tr>`).join("")}</table></div>`;
    }).join("");
    const notes = poll.questions.filter(x => x.kind === "text").map(x => {
      const said = done.filter(i => String(i.answers?.[x.id] || "").trim());
      return `<div class="card"><p class="q">${esc(x.label)}</p>${said.length ? `<table>${said.map(i => `<tr><td style="width:35%">${esc(i.name)}</td><td>${esc(i.answers[x.id])}</td></tr>`).join("")}</table>` : `<p class="sub">Nothing yet.</p>`}</div>`;
    }).join("");
    return res.status(200).send(page(`<h1>${esc(poll.title)}: results</h1>
<p class="sub">${done.length} of ${(inv || []).length} coaches answered.</p>${tallies}${notes}
<div class="card"><p class="q">Haven't answered (${waiting.length})</p><p class="sub" style="margin:0">${esc(waiting.map(i => i.name).join(", ") || "Everyone has answered.")}</p></div>`, poll.title + " results"));
  }

  // ---- a coach's own poll ----
  const token = String(q.t || "").trim();
  if (!UUID_RE.test(token)) return res.status(400).send(sorry("That link is missing its code, or the messaging app cut it in half. Open it from the text again."));
  const { data: inv } = await sb.from("coach_poll_invites").select("*").eq("token", token).maybeSingle();
  if (!inv) return res.status(404).send(sorry("We can't find that link. Ask Drew for a fresh one."));
  const { data: poll } = await sb.from("coach_polls").select("*").eq("id", inv.poll_id).maybeSingle();
  if (!poll) return res.status(404).send(sorry("That poll has been closed."));

  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const answers = {};
    for (const x of poll.questions) {
      const v = body?.[x.id], keys = (x.options || []).map(o => o.k);
      if (x.kind === "text") { const t = String(v || "").trim().slice(0, 1000); if (t) answers[x.id] = t; }
      else if (x.kind === "multi") { const a = (Array.isArray(v) ? v : []).filter(k => keys.includes(k)); if (a.length) answers[x.id] = a; }
      else if (keys.includes(v)) answers[x.id] = v;
    }
    const { error } = await sb.from("coach_poll_invites").update({ answers, answered_at: new Date().toISOString() }).eq("token", token);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  const prev = inv.answers || {};
  const first = String(inv.name || "").split(" ")[0];
  const qs = poll.questions.map(x => {
    const v = prev[x.id];
    const on = (k) => Array.isArray(v) ? v.includes(k) : v === k;
    const body = x.kind === "text"
      ? `<textarea data-q="${esc(x.id)}" placeholder="${esc(x.placeholder || "")}">${esc(v || "")}</textarea>`
      : `<div class="opts" data-q="${esc(x.id)}" data-kind="${x.kind}">${x.options.map(o => `<button type="button" class="opt" data-k="${esc(o.k)}" aria-pressed="${on(o.k)}">${esc(o.label)}</button>`).join("")}</div>`;
    return `<div class="card"><p class="q">${esc(x.label)}</p>${body}</div>`;
  }).join("");
  return res.status(200).send(page(`
<div id="form">
<p class="sub" style="margin:0 0 4px">Hi ${esc(first)}${inv.answered_at ? " (you've answered; change anything below)" : ""}</p>
<h1>${esc(poll.title)}</h1>
<p class="sub">${esc(poll.intro || "")}</p>
${qs}
<button class="save" id="save">Send my answers</button>
<div class="err hide" id="err"></div>
</div>
<div class="card ok hide" id="done"><h2>Thanks, ${esc(first)}!</h2><p style="margin:0">Got it. You can open this link again any time to change your answers.</p></div>
<script>
document.querySelectorAll(".opts").forEach(g => g.addEventListener("click", e => {
  const b = e.target.closest(".opt"); if (!b) return;
  if (g.dataset.kind === "multi") b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true");
  else g.querySelectorAll(".opt").forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
}));
document.getElementById("save").addEventListener("click", async () => {
  const out = {};
  document.querySelectorAll(".opts").forEach(g => { const on = [...g.querySelectorAll('.opt[aria-pressed="true"]')].map(b => b.dataset.k); out[g.dataset.q] = g.dataset.kind === "multi" ? on : (on[0] || null); });
  document.querySelectorAll("textarea[data-q]").forEach(t => out[t.dataset.q] = t.value);
  const btn = document.getElementById("save"), err = document.getElementById("err");
  btn.disabled = true; err.classList.add("hide");
  try {
    const r = await fetch(location.href, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(out) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Couldn't save");
    document.getElementById("form").classList.add("hide"); document.getElementById("done").classList.remove("hide"); scrollTo(0, 0);
  } catch (e) { err.textContent = "That didn't save: " + e.message + ". Try again."; err.classList.remove("hide"); btn.disabled = false; }
});
</script>`, poll.title));
}
