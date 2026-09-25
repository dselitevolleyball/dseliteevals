// Coach privates at DSSC — the coach's own page.
//
// GET  /privates?t=<token>[&m=YYYY-MM]  → "are you in?" then a tap-grid of the
//                                          days and hours she can work that month
// POST /privates?t=<token>&m=YYYY-MM     → { interested, slots, note } saved
//
// The token is coach_roster.privates_token, a per-coach capability link sent
// by text, push and email (api/privates-ask.js). No login: the link is the
// key, same as the photo and gear links. Hours are 24h starts ("15" = the
// 3pm–4pm block) so Playbook's schedule can be built straight from them.

import { createClient } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const HOURS = Array.from({ length: 15 }, (_, i) => 7 + i);   // 7am … 9pm starts
export const hourLabel = (h) => (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? "am" : "pm");
const monthLabel = (m) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }); };
const centralToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
// The month we're asking about: this one until the 20th, then next month —
// the ask goes out on the 25th for the month ahead.
export const askMonth = () => {
  const t = centralToday(); const [y, m, d] = t.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + (d >= 20 ? 1 : 0), 1));
  return dt.toISOString().slice(0, 7);
};
const prevMonth = (m) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7); };

const page = (inner, title) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Source+Sans+3:wght@400;600;700&display=swap">
<style>
  :root { --bg:#0f1418; --card:#171e24; --ink:#f4f6f8; --body:#c9d1d8; --mut:#8a959f; --rule:#273038; --acc:#22d3ee; --grn:#4ade80; --err:#f87171; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  body { margin:0; background:var(--bg); color:var(--body); font-family:"Source Sans 3",system-ui,sans-serif; font-size:17px; line-height:1.5; }
  .wrap { max-width:560px; margin:0 auto; padding:22px 16px 64px; }
  .logo { height:34px; margin-bottom:18px; }
  h1 { margin:6px 0 4px; color:var(--ink); font-family:"Barlow Condensed",sans-serif; font-weight:700; font-size:clamp(1.9rem,8vw,2.5rem); line-height:1; text-transform:uppercase; }
  .sub { margin:0 0 18px; color:var(--mut); font-size:.95rem; }
  .card { background:var(--card); border:1px solid var(--rule); border-radius:14px; padding:18px 16px; }
  .card + .card { margin-top:12px; }
  .sect { font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:var(--acc); font-weight:700; margin:0 0 12px; }
  .big { display:flex; gap:10px; }
  .big button { flex:1; padding:18px 10px; font:inherit; font-weight:700; font-size:17px; cursor:pointer; background:transparent; color:var(--body); border:1px solid var(--rule); border-radius:12px; }
  .big button[aria-pressed="true"] { background:rgba(34,211,238,.14); border-color:var(--acc); color:var(--acc); }
  .day { display:flex; align-items:flex-start; gap:10px; padding:10px 0; border-top:1px solid var(--rule); }
  .day:first-of-type { border-top:none; }
  .day .dn { flex:0 0 44px; font-weight:700; color:var(--ink); padding-top:6px; }
  .day .hrs { display:flex; flex-wrap:wrap; gap:6px; flex:1; }
  .hr { padding:7px 0; width:54px; text-align:center; font:inherit; font-size:13px; font-weight:700; cursor:pointer; background:transparent; color:var(--body); border:1px solid var(--rule); border-radius:8px; user-select:none; }
  .hr[aria-pressed="true"] { background:rgba(74,222,128,.16); border-color:var(--grn); color:var(--grn); }
  .presets { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; }
  .presets button { padding:7px 11px; font:inherit; font-size:13px; font-weight:700; cursor:pointer; background:transparent; color:var(--mut); border:1px solid var(--rule); border-radius:999px; }
  textarea { width:100%; padding:12px; font:inherit; font-size:16px; color:var(--ink); background:#10161b; border:1px solid var(--rule); border-radius:10px; min-height:70px; }
  .save { width:100%; margin-top:14px; padding:16px; font:inherit; font-weight:700; font-size:18px; cursor:pointer; background:var(--acc); color:#04252b; border:none; border-radius:12px; }
  .save:disabled { opacity:.5; cursor:default; }
  .hint { color:var(--mut); font-size:.85rem; margin-top:8px; }
  .ok { border-color:var(--grn); }
  .ok h2 { color:var(--grn); margin:0 0 6px; font-family:"Barlow Condensed",sans-serif; text-transform:uppercase; font-size:1.6rem; }
  .err { color:var(--err); font-weight:700; margin-top:10px; }
  .hide { display:none; }
  a { color:var(--acc); }
  .sum { margin:0; padding-left:18px; }
</style></head><body><div class="wrap">
<img class="logo" src="/dssc/logo-horizontal-white.png" alt="DSSC">
${inner}
</div></body></html>`;

const notFound = (msg) => page(`<h1>Hmm.</h1><p class="sub">${esc(msg)}</p>`, "DSSC privates");

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).send("Server not configured");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const q = req.query || {};
  const token = String(q.t || "").trim();
  if (!UUID_RE.test(token)) return res.status(400).send(notFound("That link is missing its code, or it was cut in half by the messaging app. Open it from the text or email again."));
  const month = /^\d{4}-\d{2}$/.test(String(q.m || "")) ? String(q.m) : askMonth();

  const { data: c } = await supabase.from("coach_roster").select("id, first_name, last_name").eq("privates_token", token).maybeSingle();
  if (!c) return res.status(404).send(notFound("We can't find that link. It may have been re-issued — ask Drew for a fresh one."));
  const name = `${c.first_name || ""} ${c.last_name || ""}`.trim();
  const first = (c.first_name || name).trim();

  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const interested = body?.interested === true ? true : body?.interested === false ? false : null;
    const slots = {};
    if (interested && body?.slots && typeof body.slots === "object") {
      for (const d of DAYS) {
        const hs = Array.isArray(body.slots[d]) ? body.slots[d].map(Number).filter(h => HOURS.includes(h)).sort((a, b) => a - b) : [];
        if (hs.length) slots[d] = hs.map(String);
      }
    }
    const row = { coach_id: c.id, coach_name: name, month, interested, slots, note: String(body?.note || "").trim().slice(0, 1000) || null, submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const { error } = await supabase.from("coach_privates").upsert(row, { onConflict: "coach_id,month" });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  const [{ data: cur }, { data: prev }] = await Promise.all([
    supabase.from("coach_privates").select("*").eq("coach_id", c.id).eq("month", month).maybeSingle(),
    supabase.from("coach_privates").select("*").eq("coach_id", c.id).eq("month", prevMonth(month)).maybeSingle(),
  ]);
  const seed = cur || null;
  const seedSlots = (cur && cur.interested && Object.keys(cur.slots || {}).length) ? cur.slots : ((prev && prev.interested) ? prev.slots : {});
  const label = monthLabel(month);

  const inner = `
<div class="sub">Hi ${esc(first)} — ${seed ? "you've answered for " + esc(label) + "; change anything below." : "two minutes, all taps."}</div>
<h1>Privates at DSSC</h1>
<p class="sub">DSSC is opening private lessons on its courts, coached by our staff and booked through Playbook. We build each month's schedule from what you tell us here.</p>

<div class="card">
  <div class="sect">1 · Are you in?</div>
  <div class="big" id="ask">
    <button type="button" data-v="yes" aria-pressed="${seed?.interested === true ? "true" : "false"}">Yes — I'd like to run privates</button>
    <button type="button" data-v="no" aria-pressed="${seed?.interested === false ? "true" : "false"}">Not right now</button>
  </div>
  <div class="hint">Say yes and we'll check in once a month for the month ahead. Say no and we'll leave you be.</div>
</div>

<div class="card ${seed?.interested === true ? "" : "hide"}" id="grid">
  <div class="sect">2 · When can you work in ${esc(label)}?</div>
  <p class="hint" style="margin:0 0 12px">Tap every hour you're available to start a lesson. Lessons are an hour. Tap again to clear.</p>
  <div class="presets">
    <button type="button" data-preset="wkeve">Weekday evenings 4–8pm</button>
    <button type="button" data-preset="wkend">Weekend mornings 9–12</button>
    ${prev && prev.interested && Object.keys(prev.slots || {}).length ? `<button type="button" data-preset="prev">Same as ${esc(monthLabel(prevMonth(month)))}</button>` : ""}
    <button type="button" data-preset="clear">Clear all</button>
  </div>
  ${DAYS.map(d => `<div class="day"><div class="dn">${d}</div><div class="hrs" data-day="${d}">${HOURS.map(h => `<button type="button" class="hr" data-h="${h}" aria-pressed="false">${hourLabel(h)}</button>`).join("")}</div></div>`).join("")}
  <div style="margin-top:14px">
    <div class="sect" style="margin-bottom:6px">Anything we should know?</div>
    <textarea id="note" placeholder="Age groups or skills you'd rather focus on, weeks you're away, anything else">${esc(seed?.note || "")}</textarea>
  </div>
</div>

<div class="card hide" id="noCard">
  <p style="margin:0">No problem — we won't ask again unless you tell Drew you've changed your mind.</p>
</div>

<button class="save" id="save" type="button">Save</button>
<div class="err hide" id="err"></div>
<div class="card ok hide" id="done" style="margin-top:14px"><h2>Saved — thank you</h2><p id="doneText" style="margin:0"></p><p class="hint">You can come back to this link any time to change it.</p></div>

<script>
(function(){
  var DAYS=${JSON.stringify(DAYS)}, seed=${JSON.stringify(seedSlots || {})}, prevSlots=${JSON.stringify((prev && prev.interested) ? prev.slots : {})};
  var interested=${seed?.interested === true ? "true" : seed?.interested === false ? "false" : "null"};
  var ask=document.getElementById('ask'), grid=document.getElementById('grid'), noCard=document.getElementById('noCard'), save=document.getElementById('save'), err=document.getElementById('err'), done=document.getElementById('done');
  function setPressed(btn,on){btn.setAttribute('aria-pressed',on?'true':'false');}
  function apply(slots){DAYS.forEach(function(d){var hs=(slots[d]||[]).map(String);grid.querySelectorAll('[data-day="'+d+'"] .hr').forEach(function(b){setPressed(b,hs.indexOf(String(b.dataset.h))>=0);});});}
  apply(seed);
  ask.querySelectorAll('button').forEach(function(b){b.addEventListener('click',function(){interested=b.dataset.v==='yes';ask.querySelectorAll('button').forEach(function(x){setPressed(x,x===b);});grid.classList.toggle('hide',!interested);noCard.classList.toggle('hide',interested);done.classList.add('hide');});});
  grid.querySelectorAll('.hr').forEach(function(b){b.addEventListener('click',function(){setPressed(b,b.getAttribute('aria-pressed')!=='true');});});
  grid.querySelectorAll('[data-preset]').forEach(function(b){b.addEventListener('click',function(){var p=b.dataset.preset;
    if(p==='clear'){apply({});return;}
    if(p==='prev'){apply(prevSlots);return;}
    var cur={};DAYS.forEach(function(d){cur[d]=[];grid.querySelectorAll('[data-day="'+d+'"] .hr[aria-pressed="true"]').forEach(function(x){cur[d].push(x.dataset.h);});});
    var add=p==='wkeve'?{days:['Mon','Tue','Wed','Thu','Fri'],hours:[16,17,18,19]}:{days:['Sat','Sun'],hours:[9,10,11]};
    add.days.forEach(function(d){add.hours.forEach(function(h){if(cur[d].indexOf(String(h))<0)cur[d].push(String(h));});});
    apply(cur);});});
  save.addEventListener('click',function(){
    if(interested===null){err.textContent='Pick yes or not right now first.';err.classList.remove('hide');return;}
    var slots={};DAYS.forEach(function(d){var hs=[];grid.querySelectorAll('[data-day="'+d+'"] .hr[aria-pressed="true"]').forEach(function(x){hs.push(Number(x.dataset.h));});if(hs.length)slots[d]=hs;});
    if(interested&&!Object.keys(slots).length){err.textContent='Tap at least one hour you can work, or choose "Not right now".';err.classList.remove('hide');return;}
    err.classList.add('hide');save.disabled=true;save.textContent='Saving…';
    fetch(location.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({interested:interested,slots:slots,note:document.getElementById('note').value})})
      .then(function(r){return r.json();}).then(function(o){
        if(!o.ok)throw new Error(o.error||'save failed');
        var n=0;Object.keys(slots).forEach(function(d){n+=slots[d].length;});
        document.getElementById('doneText').textContent=interested?('We have '+n+' hour'+(n===1?'':'s')+' across '+Object.keys(slots).length+' day'+(Object.keys(slots).length===1?'':'s')+' for ${esc(label)}. Drew will build the Playbook schedule from this and be in touch.'):'You\\'re marked as not running privates for now.';
        done.classList.remove('hide');done.scrollIntoView({behavior:'smooth'});
      }).catch(function(e){err.textContent='That didn\\'t save — '+e.message+'. Please try once more.';err.classList.remove('hide');})
      .finally(function(){save.disabled=false;save.textContent='Save';});
  });
})();
</script>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(page(inner, "Privates at DSSC — " + name));
}
