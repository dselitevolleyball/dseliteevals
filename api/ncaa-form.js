// Vercel serverless function: NCAA Championship group tickets form.
//
// GET  /ncaa?t=<players.global_token>  → the match, and a short form
// POST /ncaa?t=<token>                 → saves (or updates) the family's answer
// GET  /ncaa?preview=1                 → sample family, nothing saves
//
// Not part of the React app, same as /global and /commitment: it opens from an
// email or text on a parent's phone with nothing to log into. It reuses the
// per-player global_token (as /meet does), so the URL can't be walked to
// another family's answer.
//
// One answer per family: the row is saved on the player whose link was used and
// her brothers' and sisters' rows are cleared (shared/ncaa-tickets.js familyOf).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";
import { NCAA_PRICE, NCAA_WHEN, NCAA_ANSWERS, familyOf } from "../shared/ncaa-tickets.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmtWhen = (iso) => {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      timeZone: "America/Chicago",
    });
  } catch { return ""; }
};
const TERMINAL = ["declined", "not_invited", "opted_out"];

const page = (inner, { title = "NCAA Championship tickets · DS Elite" } = {}) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Source+Sans+3:wght@400;600;700&display=swap">
<style>
  :root { --bg:#12100f; --card:#1c1a18; --ink:#f6f2ec; --body:#d5cfc6; --mut:#928b81;
          --rule:#332f2b; --gold:#e0b455; --grn:#4ade80; --err:#f87171; --pink:#ec3f8e; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  body { margin:0; background:var(--bg); color:var(--body);
         font-family:"Source Sans 3",system-ui,sans-serif; font-size:17px; line-height:1.55; }
  .wrap { max-width:640px; margin:0 auto; padding:28px 18px 72px; }
  .eyebrow { font-size:11px; letter-spacing:.18em; text-transform:uppercase; color:var(--gold); font-weight:700; }
  h1 { margin:6px 0 4px; color:var(--ink); font-family:"Barlow Condensed",sans-serif; font-weight:700;
       font-size:clamp(2rem,8vw,2.7rem); line-height:1; text-transform:uppercase; }
  .sub { margin:0 0 22px; color:var(--mut); font-size:.95rem; }
  .card { background:var(--card); border:1px solid var(--rule); border-radius:14px; padding:20px 18px; }
  .card + .card, .card + form, form + .card { margin-top:14px; }
  .sect { font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:var(--gold);
          font-weight:700; margin:0 0 8px; }
  .card p { margin:0 0 12px; } .card p:last-child { margin-bottom:0; }
  .it { list-style:none; margin:0; padding:0; }
  .it li { display:flex; gap:14px; padding:9px 0; border-bottom:1px solid var(--rule); font-size:.95rem; }
  .it li:last-child { border-bottom:none; }
  .it .d { flex:0 0 78px; color:var(--gold); font-weight:700; }
  .price { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; margin:2px 0 10px; }
  .price b { font-family:"Barlow Condensed",sans-serif; font-size:2.4rem; color:var(--ink); line-height:1; }
  .price span { color:var(--mut); }
  .inc { margin:0 0 12px; padding-left:18px; } .inc li { margin-bottom:4px; }
  .q { margin:22px 0 10px; color:var(--ink); font-weight:700; }
  .q:first-of-type { margin-top:4px; }
  .q small { display:block; color:var(--mut); font-weight:400; font-size:.86rem; }
  .req { color:var(--pink); }
  .opt { display:flex; gap:12px; align-items:flex-start; padding:12px 13px; margin-bottom:8px;
         border:1px solid var(--rule); border-radius:11px; cursor:pointer; }
  .opt:has(input:checked) { border-color:var(--gold); background:rgba(224,180,85,.07); }
  .opt input { flex:0 0 22px; width:22px; height:22px; margin:1px 0 0; accent-color:var(--gold); }
  .opt .t { display:block; color:var(--ink); font-weight:700; font-size:15.5px; line-height:1.35; }
  .opt .s { display:block; color:var(--mut); font-size:.86rem; margin-top:2px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .grid .opt { margin:0; }
  @media (max-width:420px) { .grid { grid-template-columns:1fr; } }
  input[type=text], input[type=number], select, textarea { width:100%; padding:13px 12px; font:inherit; font-size:17px;
    color:var(--ink); background:#151312; border:1px solid var(--rule); border-radius:10px; }
  textarea { min-height:92px; resize:vertical; }
  input:focus, select:focus, textarea:focus { outline:2px solid var(--gold); outline-offset:1px; border-color:var(--gold); }
  .hide { display:none; }
  button.go { width:100%; padding:16px; font:inherit; font-weight:800; font-size:17px; cursor:pointer;
    background:var(--gold); color:#1a1613; border:none; border-radius:11px; margin-top:20px; }
  button.go[disabled] { opacity:.4; cursor:not-allowed; }
  .tick { display:flex; gap:10px; align-items:center; padding:14px 15px; border-radius:11px;
          border:1px solid rgba(74,222,128,.35); background:rgba(74,222,128,.08); margin-bottom:14px; }
  .tick .k { color:var(--grn); font-weight:800; font-size:20px; line-height:1; }
  .tick b { color:var(--grn); }
  .tick small { display:block; color:var(--mut); font-size:.84rem; margin-top:2px; }
  .err { border-left:3px solid var(--err); background:rgba(248,113,113,.09); padding:14px 16px;
         border-radius:0 8px 8px 0; margin-bottom:16px; }
  .note { border-left:3px solid var(--gold); background:rgba(224,180,85,.08); padding:13px 15px;
          border-radius:0 8px 8px 0; font-size:.92rem; margin-bottom:14px; }
  .note b { color:var(--gold); }
  .foot { margin-top:22px; color:var(--mut); font-size:.82rem; text-align:center; }
  a { color:var(--gold); }
</style></head><body><div class="wrap">${inner}</div></body></html>`;

const notFound = (msg) => page(`
  <span class="eyebrow">DS Elite Volleyball</span>
  <h1>Link not found</h1>
  <div class="card"><div class="err">${esc(msg)}</div>
  <p style="font-size:.9rem;color:var(--mut)">Reply to the email or text this came in and we'll send you a fresh link.</p></div>
`, { title: "Link not found · DS Elite" });

const SAMPLE = { id: -1, first_name: "Sample", last_name: "Player", team_assignment: "15 Diamond" };

const script = `
(function () {
  var f = document.getElementById('nc'); if (!f) return;
  var btn = f.querySelector('button.go');
  var yes = document.getElementById('yes'), have = document.getElementById('have');
  function val(n) { var r = f.querySelector('input[name=' + n + ']:checked'); return r ? r.value : ''; }
  function num(n) { var v = parseInt(f.querySelector('input[name=' + n + ']').value, 10); return v > 0 ? v : 0; }
  function sync() {
    var a = val('answer');
    yes.classList.toggle('hide', a !== 'yes');
    have.classList.toggle('hide', a !== 'have');
    var t = a === 'yes' ? num('tickets') : a === 'have' ? num('extra') : 0;
    document.getElementById('tot').textContent = num('tickets') ? num('tickets') + ' x $${NCAA_PRICE} = $' + (num('tickets') * ${NCAA_PRICE}) : '';
    document.getElementById('tot2').textContent = num('extra') ? num('extra') + ' x $${NCAA_PRICE} = $' + (num('extra') * ${NCAA_PRICE}) : '';
    var name = f.querySelector('input[name=respondent_name]').value.trim().length > 1;
    var missing = !a ? 'Choose an answer'
      : a === 'yes' && !num('tickets') ? 'How many tickets?'
      : a === 'have' && !num('party') ? 'How many of you will be there?'
      : !name ? 'Type your name to send' : '';
    btn.disabled = !!missing;
    btn.textContent = missing || 'Send our answer';
  }
  f.addEventListener('change', sync); f.addEventListener('input', sync); sync();
})();`;

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).send(notFound("This form isn't configured yet."));
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });

  const url = (() => { try { return new URL(req.url, "https://x"); } catch { return null; } })();
  const preview = url?.searchParams.get("preview") === "1";
  const token = String(url?.searchParams.get("t") || "").trim();

  let player = SAMPLE, kids = [SAMPLE], famIds = [SAMPLE.id], prev = null, justSaved = false, problem = "";
  if (!preview) {
    if (!UUID_RE.test(token)) return res.status(404).send(notFound("That link is missing its code."));
    const { data } = await supabase.from("players")
      .select("id, first_name, last_name, team_assignment, offer_status, parent_email, parent_email2, parent_email3")
      .eq("global_token", token).maybeSingle();
    if (!data) return res.status(404).send(notFound("We can't find that link."));
    player = data;
    const { data: all } = await supabase.from("players")
      .select("id, first_name, last_name, team_assignment, offer_status, parent_email, parent_email2, parent_email3")
      .not("team_assignment", "is", null);
    const fam = familyOf(all || [player], player);
    famIds = [...new Set([player.id, ...fam.map((q) => q.id)])];
    kids = fam.filter((q) => q.id === player.id || !TERMINAL.includes(q.offer_status || ""));
    const { data: rows } = await supabase.from("ncaa_tickets").select("*").in("player_id", famIds);
    prev = (rows || []).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0] || null;
  }

  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") body = Object.fromEntries(new URLSearchParams(body));
    const n = (v) => { const x = parseInt(v, 10); return x >= 1 && x <= 30 ? x : null; };
    const answer = NCAA_ANSWERS.some((o) => o.key === body?.answer) ? body.answer : null;
    const tickets = answer === "yes" ? n(body?.tickets) : answer === "have" ? n(body?.extra) : null;
    const party = answer === "have" ? n(body?.party) : null;
    const respondent_name = String(body?.respondent_name || "").trim().slice(0, 120);
    const notes = String(body?.notes || "").trim().slice(0, 2000) || null;

    // The browser disables the button until these are filled, but the server
    // is where it gets decided.
    problem = !answer ? "Let us know whether your family would like to come."
      : answer === "yes" && !tickets ? "Tell us how many tickets you'd like (1 to 30)."
      : answer === "have" && !party ? "Tell us how many of you will be there."
      : respondent_name.length < 2 ? "Type your name so we know who answered." : "";

    const row = { answer, tickets, party, respondent_name, notes };
    if (!problem && !preview) {
      const now = new Date().toISOString();
      const { error } = await supabase.from("ncaa_tickets").upsert({
        player_id: player.id, ...row, updated_at: now,
        submitted_ip: String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || null,
      }, { onConflict: "player_id" });
      if (error) problem = "Something went wrong saving that. Please try again.";
      else {
        // One answer per family, so a sibling's earlier answer can't double the count.
        const others = famIds.filter((id) => id !== player.id);
        if (others.length) await supabase.from("ncaa_tickets").delete().in("player_id", others);
        prev = { ...row, updated_at: now }; justSaved = true;
      }
    } else if (!problem && preview) {
      prev = { ...row, updated_at: new Date().toISOString() }; justSaved = true;
    } else {
      prev = { ...(prev || {}), ...row };
    }
  }

  const v = prev || {};
  const done = justSaved || (prev && prev.updated_at && !problem);
  const qs = preview ? "?preview=1" : "?t=" + esc(token);
  const lastNames = [...new Set(kids.map((k) => k.last_name).filter(Boolean))];
  const famName = lastNames.length === 1 ? "the " + lastNames[0] + " family" : kids.map((k) => k.first_name).join(" and ") + "'s family";
  const teams = kids.map((k) => k.first_name + (k.team_assignment ? " · " + k.team_assignment : "")).join(", ");

  return res.status(problem ? 400 : 200).send(page(`
    <span class="eyebrow">DS Elite Volleyball · NCAA Championship</span>
    <h1>Let's pack the Alamodome</h1>
    <p class="sub">For <b style="color:var(--ink)">${esc(famName)}</b> · ${esc(teams)}${
      preview ? ' <span style="color:var(--gold)">· preview, nothing saves</span>' : ""}</p>

    ${problem ? `<div class="err">${esc(problem)}</div>` : ""}
    ${done ? `<div class="tick"><span class="k">&#10003;</span><span>
        <b>${justSaved ? "Thanks, we have your answer." : "We have your answer."}</b>
        <small>${v.updated_at ? "Saved " + esc(fmtWhen(v.updated_at)) + ". " : ""}Change anything below and send it again any time.</small>
      </span></div>` : ""}

    <div class="card">
      <p class="sect">The match</p>
      <ul class="it">
        <li><span class="d">When</span><span>${esc(NCAA_WHEN)}</span></li>
        <li><span class="d">Where</span><span>Alamodome, San Antonio</span></li>
        <li><span class="d">Seats</span><span>300 level, with the DS Elite group</span></li>
        <li><span class="d">Price</span><span>$${NCAA_PRICE} per ticket (group rate)</span></li>
      </ul>
    </div>

    <div class="card">
      <p>The NCAA women's volleyball championship match is in San Antonio this year, and they're going for
        the record for the biggest crowd ever at an indoor volleyball match: more than 30,000 fans.</p>
      <p>We've been offered a group rate of $${NCAA_PRICE} a ticket, and we'd love for DS Elite to do our part
        with a big group. Players, parents, brothers and sisters, grandparents: everyone is welcome.</p>
      <p>Already have tickets? Tell us that too. We'd love to know how many DS Elite families will be in the building.</p>
    </div>

    <div class="note"><b>This is just a head count.</b> Nothing is owed yet. Once we know our numbers,
      we'll follow up with how to pay.</div>

    <form method="POST" action="${qs}" class="card" id="nc">
      <p class="sect">Your answer</p>

      <p class="q">Would your family like to come with DS Elite? <span class="req">*</span></p>
      ${NCAA_ANSWERS.map((o) => `
        <label class="opt"><input type="radio" name="answer" value="${o.key}" ${v.answer === o.key ? "checked" : ""}>
          <span><span class="t">${esc(o.label)}</span></span></label>`).join("")}

      <div id="yes">
        <p class="q">How many tickets would you like? <span class="req">*</span>
          <small>$${NCAA_PRICE} each. Count everyone who's coming, players included.</small></p>
        <input type="number" name="tickets" min="1" max="30" inputmode="numeric" value="${esc(v.answer === "yes" ? v.tickets ?? "" : "")}" placeholder="e.g. 4">
        <p class="sub" id="tot" style="margin:6px 0 0"></p>
      </div>

      <div id="have">
        <p class="q">How many of you will be there? <span class="req">*</span></p>
        <input type="number" name="party" min="1" max="30" inputmode="numeric" value="${esc(v.party ?? "")}" placeholder="e.g. 3">
        <p class="q">Would you like any group tickets as well? <small>Optional. $${NCAA_PRICE} each, in the 300 level with the DS Elite group.</small></p>
        <input type="number" name="extra" min="0" max="30" inputmode="numeric" value="${esc(v.answer === "have" ? v.tickets ?? "" : "")}" placeholder="0">
        <p class="sub" id="tot2" style="margin:6px 0 0"></p>
      </div>

      <p class="q">Your name <span class="req">*</span></p>
      <input type="text" name="respondent_name" autocomplete="name" value="${esc(v.respondent_name || "")}" placeholder="Parent or guardian">

      <p class="q">Questions or anything we should know? <small>Optional</small></p>
      <textarea name="notes" placeholder="Seating, kids' ages, anything">${esc(v.notes || "")}</textarea>

      <button class="go" type="submit">Send our answer</button>
    </form>

    <div class="foot">DS Elite Volleyball · NCAA Championship · ${esc(NCAA_WHEN)}<br>
      Questions? Drew Rose · <a href="mailto:drew@dselitevolleyball.com">drew@dselitevolleyball.com</a></div>
    <script>${script}</script>`,
    { title: "NCAA Championship tickets · DS Elite" }));
}
