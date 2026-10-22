// Vercel serverless function: the team parent check-in (Drew, Oct 22 2026).
//
// GET  /team-parent?t=<team_volunteers.checkin_token>  → that parent's one-page form
// POST /team-parent?t=<token>                           → saves it and returns { ok }
// GET  /team-parent?preview=1                           → sample page, nothing saved
//
// Three questions, all taps: are you the team parent for <team>? (yes/no), are your contact details
// right, and which of the other parents on file for your team are team parents — plus anyone we're
// missing. Applying it (see migrations/20261022_team_parent_checkin.sql):
//   yes → confirmed = true, confirmed_by 'self: team parent check-in', declined_at cleared
//   no  → confirmed = false, declined_at = now()
//   added people → new unconfirmed team_parent rows, note "Added by <name> (check-in <date>)"
// Other people's yes/no answers are only recorded (team_parent_checkins.others), never applied to
// their rows: only a parent can confirm or decline themselves.
//
// Not part of the React app, like /kickoff: it opens from a text on a phone.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clean = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const isEmail = (s) => /^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i.test(s);
const digits = (s) => String(s || "").replace(/\D/g, "");
const usPhone = (s) => { const d = digits(s).replace(/^1(?=\d{10}$)/, ""); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : null; };
const firstName = (n) => String(n || "").split(/[\s/&,]+/)[0] || "there";
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

const page = (inner, title = "Team parent check-in · DS Elite") => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@800&family=Source+Sans+3:wght@400;600;700&display=swap">
<style>
  :root { --bg:#0d0b10; --card:#18141c; --ink:#f7f3f8; --body:#d8d0dc; --mut:#958c9b; --rule:#2f2836; --pink:#e91e8c; --pinkl:#ff8cc2; --grn:#4ade80; --err:#f87171; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  body { margin:0; background:var(--bg); color:var(--body); font-family:"Source Sans 3",system-ui,sans-serif; font-size:17px; line-height:1.55; }
  .wrap { max-width:600px; margin:0 auto; padding:26px 16px 64px; }
  .eyebrow { font-size:11px; letter-spacing:.18em; text-transform:uppercase; color:var(--pinkl); font-weight:700; }
  h1 { margin:6px 0 4px; color:var(--ink); font-family:Montserrat,sans-serif; font-weight:800; font-size:clamp(1.7rem,7vw,2.3rem); line-height:1.08; text-transform:uppercase; }
  .sub { margin:0 0 18px; color:var(--mut); font-size:.97rem; }
  .card { background:var(--card); border:1px solid var(--rule); border-radius:14px; padding:18px 16px; margin-top:14px; }
  .sect { font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:var(--pinkl); font-weight:700; margin:0 0 12px; }
  .q { color:var(--ink); font-weight:700; margin:0 0 12px; font-size:1.05rem; }
  .seg { display:flex; flex-direction:column; gap:9px; }
  .seg button, .tri button { font:inherit; cursor:pointer; background:transparent; color:var(--body); border:1px solid var(--rule); border-radius:10px; }
  .seg button { width:100%; text-align:left; padding:14px 15px; font-weight:700; font-size:16px; }
  .seg button small { display:block; font-weight:400; font-size:.82rem; color:var(--mut); margin-top:2px; }
  .seg button[aria-pressed="true"], .tri button[aria-pressed="true"] { background:rgba(233,30,140,.15); border-color:var(--pink); color:var(--pinkl); }
  label.f { display:block; margin-bottom:12px; }
  .lb { display:block; font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:var(--mut); font-weight:700; margin-bottom:6px; }
  input[type=text], input[type=email], input[type=tel], textarea { width:100%; padding:12px; font:inherit; font-size:16px; color:var(--ink); background:#100d13; border:1px solid var(--rule); border-radius:10px; }
  input:focus, textarea:focus { outline:2px solid var(--pink); outline-offset:1px; }
  textarea { min-height:70px; resize:vertical; }
  .who { padding:11px 0; border-top:1px solid var(--rule); }
  .who:first-of-type { border-top:none; }
  .who .nm { color:var(--ink); font-weight:700; }
  .who .mt { color:var(--mut); font-size:.85rem; }
  .tri { display:flex; gap:6px; margin-top:8px; }
  .tri button { flex:1; padding:9px 4px; font-weight:700; font-size:14px; }
  .add { border:1px dashed var(--rule); border-radius:10px; padding:12px; margin-top:10px; }
  .add .row { display:grid; gap:8px; }
  .link { background:none; border:none; color:var(--pinkl); font:inherit; font-weight:700; cursor:pointer; padding:6px 0; }
  button.go { width:100%; padding:16px; margin-top:16px; font:inherit; font-weight:800; font-size:17px; cursor:pointer; color:#fff; border:none; border-radius:12px; background:linear-gradient(110deg,#d12c74,#b02a8c 50%,#7c2fa8); }
  button.go:disabled { opacity:.6; }
  .err { color:var(--err); font-weight:700; margin-top:10px; }
  .ok { border-left:3px solid var(--grn); background:rgba(74,222,128,.08); padding:16px; border-radius:0 10px 10px 0; }
  .ok h2 { margin:0 0 6px; color:var(--grn); font-family:Montserrat,sans-serif; text-transform:uppercase; font-size:1.3rem; }
  .hide { display:none; }
  .foot { margin-top:20px; color:var(--mut); font-size:.82rem; text-align:center; }
</style></head><body><div class="wrap">${inner}</div></body></html>`;

const notFound = (msg) => page(`<span class="eyebrow">DS Elite Volleyball</span><h1>Link not found</h1><div class="card"><p>${esc(msg)}</p></div>`);

function form(me, others, preview) {
  const first = firstName(me.name);
  const otherRows = others.map((o) => `
    <div class="who" data-id="${o.id}">
      <div class="nm">${esc(o.name)}</div>
      <div class="mt">${o.player_name ? "Parent of " + esc(o.player_name) : ""}</div>
      <div class="tri">
        <button type="button" data-v="yes" aria-pressed="false">Team parent</button>
        <button type="button" data-v="no" aria-pressed="false">Not a team parent</button>
        <button type="button" data-v="unsure" aria-pressed="false">Not sure</button>
      </div>
    </div>`).join("");
  return page(`
<span class="eyebrow">DS Elite Volleyball · ${esc(me.team_name)}</span>
<h1>Team parent <span style="white-space:nowrap">check-in</span></h1>
<p class="sub">Hi ${esc(first)}! We're making sure every team has its team parent and that we have the right contact details. It takes about a minute.</p>
<form id="f" novalidate>
  <div class="card">
    <p class="sect">1 · You</p>
    <p class="q">Are you a team parent for ${esc(me.team_name)} this season?</p>
    <div class="seg" id="me">
      <button type="button" data-v="yes" aria-pressed="${me.confirmed ? "true" : "false"}">Yes, I'm a team parent<small>We'll list you as ${esc(me.team_name)}'s team parent.</small></button>
      <button type="button" data-v="no" aria-pressed="${me.declined_at ? "true" : "false"}">No, not this season<small>No problem. We'll take you off the team parent list.</small></button>
    </div>
  </div>
  <div class="card" id="contact">
    <p class="sect">2 · Your contact details</p>
    <label class="f"><span class="lb">Name</span><input type="text" name="name" value="${esc(me.name)}" maxlength="120" autocomplete="name"></label>
    <label class="f"><span class="lb">Email</span><input type="email" name="email" value="${esc(me.email || "")}" maxlength="200" autocomplete="email" inputmode="email"></label>
    <label class="f"><span class="lb">Mobile</span><input type="tel" name="phone" value="${esc(usPhone(me.phone) || me.phone || "")}" maxlength="40" autocomplete="tel" inputmode="tel"></label>
  </div>
  <div class="card">
    <p class="sect">3 · Your team's team parents</p>
    ${others.length ? `<p class="q">These parents also signed up as team parent for ${esc(me.team_name)}. Are they team parents?</p>${otherRows}` : `<p class="q">You're the only team parent we have on file for ${esc(me.team_name)}.</p>`}
    <p class="q" style="margin-top:16px">Are we missing a team parent for ${esc(me.team_name)}?</p>
    <div id="adds"></div>
    <button type="button" class="link" id="addBtn">+ Add a team parent</button>
  </div>
  <div class="card">
    <p class="sect">Anything else? (optional)</p>
    <textarea name="note" maxlength="1000" placeholder="For example: we split the job, or someone else is taking over in January"></textarea>
  </div>
  <button class="go" type="submit" id="go">Send</button>
  <div class="err hide" id="err"></div>
</form>
<div class="card ok hide" id="done"><h2>Thank you, ${esc(first)}!</h2><p style="margin:0">Got it. If anything changes, open this link again and update your answers.</p></div>
<p class="foot">DS Elite Volleyball · Questions? Reply to Drew's text or email.</p>
<template id="addTpl"><div class="add"><div class="row">
  <input type="text" data-k="name" placeholder="Their name" maxlength="120">
  <input type="email" data-k="email" placeholder="Their email (if you have it)" maxlength="200" inputmode="email">
  <input type="tel" data-k="phone" placeholder="Their mobile (if you have it)" maxlength="40" inputmode="tel">
</div></div></template>
<script>
(function () {
  var PREVIEW = ${preview ? "true" : "false"};
  function pick(group, btn) { group.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", b === btn ? "true" : "false"); }); }
  var me = document.getElementById("me");
  me.addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) pick(me, b); });
  document.querySelectorAll(".who .tri").forEach(function (g) { g.addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) pick(g, b); }); });
  var adds = document.getElementById("adds"), tpl = document.getElementById("addTpl");
  document.getElementById("addBtn").addEventListener("click", function () { if (adds.children.length < 5) adds.appendChild(tpl.content.cloneNode(true)); });
  document.getElementById("f").addEventListener("submit", async function (e) {
    e.preventDefault();
    var err = document.getElementById("err"), go = document.getElementById("go");
    err.classList.add("hide");
    var sel = me.querySelector('button[aria-pressed="true"]');
    if (!sel) { err.textContent = "Please tap Yes or No for question 1."; err.classList.remove("hide"); window.scrollTo(0, 0); return; }
    var f = e.target;
    var body = { answer: sel.dataset.v, name: f.elements.namedItem("name").value, email: f.email.value, phone: f.phone.value, note: f.note.value, others: [], added: [] };
    document.querySelectorAll(".who").forEach(function (w) { var b = w.querySelector('button[aria-pressed="true"]'); body.others.push({ id: Number(w.dataset.id), is_team_parent: b ? b.dataset.v : "unsure" }); });
    adds.querySelectorAll(".add").forEach(function (a) { var o = {}; a.querySelectorAll("input").forEach(function (i) { o[i.dataset.k] = i.value; }); if (o.name && o.name.trim()) body.added.push(o); });
    if (PREVIEW) { document.getElementById("f").classList.add("hide"); document.getElementById("done").classList.remove("hide"); return; }
    go.disabled = true;
    try {
      var r = await fetch(location.href, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok || !j.ok) throw new Error(j.error || "That didn't save");
      document.getElementById("f").classList.add("hide"); document.getElementById("done").classList.remove("hide"); window.scrollTo(0, 0);
    } catch (x) { err.textContent = x.message + ". Please try again."; err.classList.remove("hide"); go.disabled = false; }
  });
})();
</script>`);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const q = req.query || {};
  if (q.preview) {
    const me = { id: 0, name: "Jordan Sample", team_name: "14 Demo", email: "jordan@example.com", phone: "5125550100", confirmed: false };
    return res.status(200).send(form(me, [{ id: 1, name: "Casey Example", player_name: "Avery Example" }, { id: 2, name: "Riley Sample", player_name: "Quinn Sample" }], true));
  }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).send("Server not configured");
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const token = String(q.t || "").trim();
  if (!UUID_RE.test(token)) return res.status(400).send(notFound("That link is missing its code, or the messaging app cut it in half. Open it from the text or email again."));
  const { data: me } = await sb.from("team_volunteers").select("*").eq("checkin_token", token).maybeSingle();
  if (!me) return res.status(404).send(notFound("We can't find that link. Ask Drew for a fresh one."));
  const { data: teamRows } = await sb.from("team_volunteers").select("id, name, player_name, role").eq("team_name", me.team_name).eq("role", "team_parent").neq("id", me.id).order("name");
  const others = teamRows || [];

  if (req.method === "POST") {
    let b = req.body;
    if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
    const answer = b?.answer === "yes" ? "yes" : b?.answer === "no" ? "no" : null;
    if (!answer) return res.status(400).json({ ok: false, error: "Please tap Yes or No for question 1" });
    const name = clean(b.name, 120) || me.name;
    const emailIn = clean(b.email, 200).toLowerCase(), email = isEmail(emailIn) ? emailIn : (emailIn ? null : me.email);
    if (emailIn && !email) return res.status(400).json({ ok: false, error: "That email address doesn't look right" });
    const phoneIn = clean(b.phone, 40), phone = phoneIn ? (usPhone(phoneIn) ? "+1" + digits(phoneIn).slice(-10) : null) : me.phone;
    if (phoneIn && !phone) return res.status(400).json({ ok: false, error: "That phone number doesn't look right. Use a 10-digit US number" });
    const now = new Date().toISOString();
    const patch = { email, phone, updated_at: now,
      ...(answer === "yes" ? { confirmed: true, confirmed_by: "self: team parent check-in", confirmed_at: now, declined_at: null } : { confirmed: false, declined_at: now }) };
    // Rename only when it doesn't collide with another row on the team (unique on team_name, name).
    if (name !== me.name && !others.some((o) => o.name.toLowerCase() === name.toLowerCase())) patch.name = name;
    const { error: e1 } = await sb.from("team_volunteers").update(patch).eq("id", me.id);
    if (e1) return res.status(500).json({ ok: false, error: "Couldn't save: " + e1.message });

    const known = new Set(others.map((o) => o.id));
    const othersAns = (Array.isArray(b.others) ? b.others : []).filter((o) => known.has(Number(o?.id))).map((o) => ({
      id: Number(o.id), name: others.find((x) => x.id === Number(o.id))?.name, is_team_parent: ["yes", "no", "unsure"].includes(o.is_team_parent) ? o.is_team_parent : "unsure" }));
    const added = [];
    for (const a of (Array.isArray(b.added) ? b.added : []).slice(0, 5)) {
      const an = clean(a?.name, 120); if (!an) continue;
      const ae = clean(a?.email, 200).toLowerCase(), ap = clean(a?.phone, 40);
      const row = { team_name: me.team_name, name: an, role: "team_parent", email: isEmail(ae) ? ae : null, phone: usPhone(ap) ? "+1" + digits(ap).slice(-10) : null,
        note: `Added by ${name} (team parent check-in ${today()})`, confirmed: false };
      const exists = [...others, { name: me.name }].find((o) => o.name.toLowerCase() === an.toLowerCase());
      if (exists) { added.push({ name: an, email: row.email, phone: row.phone, existing: true }); continue; }
      const { data: ins, error: e2 } = await sb.from("team_volunteers").insert(row).select("id").single();
      added.push({ name: an, email: row.email, phone: row.phone, new_id: ins?.id || null, ...(e2 ? { error: e2.message } : {}) });
    }
    const { error: e3 } = await sb.from("team_parent_checkins").insert({ volunteer_id: me.id, team_name: me.team_name, respondent: name, answer,
      email, phone, others: othersAns, added, note: clean(b.note, 1000) || null });
    if (e3) console.error("team-parent checkin log", e3.message);
    return res.status(200).json({ ok: true });
  }
  return res.status(200).send(form(me, others, false));
}
