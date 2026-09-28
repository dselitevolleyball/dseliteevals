// Vercel serverless function: Girls Global Challenge interest form.
//
// GET  /global?t=<players.global_token>  → the trip, and a short form
// POST /global?t=<token>                 → saves (or updates) the answer
// GET  /global?preview=1                 → sample player, nothing saves
//
// Not part of the React app, same as /commitment and /gear: it opens from an
// email on a parent's phone with nothing to log into. The token is a per-player
// uuid, so the URL can't be walked to another family's answer.
//
// This asks about interest only. Nobody is committing or paying here; Hunter
// uses the answers to decide whether there's a team to take.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";
import {
  GC_PRICE, GC_SINGLE_SUPPLEMENT, GC_FAMILY_PRICE, GC_ITINERARY, GC_CITIES, GC_INTEREST,
  GC_POSITIONS, GC_TRAVEL,
} from "../shared/global-challenge.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n) => "$" + Number(n).toLocaleString("en-US");
const fmtWhen = (iso) => {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      timeZone: "America/Chicago",
    });
  } catch { return ""; }
};

const page = (inner, { title = "Girls Global Challenge · DS Elite" } = {}) => `<!doctype html>
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
  <p style="font-size:.9rem;color:var(--mut)">Reply to the email this came in and we'll send you a fresh link.</p></div>
`, { title: "Link not found · DS Elite" });

const SAMPLE = { id: -1, first_name: "Sample", last_name: "Player", team_assignment: "15 Diamond", parent_name: "A Parent" };

const radio = (name, o, cur, attrs = "") => `
  <label class="opt"><input type="radio" name="${name}" value="${o.key}" ${cur === o.key ? "checked" : ""} ${attrs}>
    <span><span class="t">${esc(o.label)}</span>${o.sub ? `<span class="s">${esc(o.sub)}</span>` : ""}</span></label>`;

const script = `
(function () {
  var f = document.getElementById('gc'); if (!f) return;
  var more = document.getElementById('more');
  var fam = document.getElementById('fam');
  var btn = f.querySelector('button.go');
  function val(n) { var r = f.querySelector('input[name=' + n + ']:checked'); return r ? r.value : ''; }
  function sync() {
    var i = val('interest');
    // A "no" only needs the one tap. Everything else is for families who might go.
    more.classList.toggle('hide', !i || i === 'no');
    var t = val('travel');
    fam.classList.toggle('hide', !(t === 'parent' || t === 'family'));
    var pos = f.querySelectorAll('input[name=positions]:checked').length;
    var name = f.querySelector('input[name=respondent_name]').value.trim().length > 1;
    var missing = !i ? 'Choose whether you\\'re interested'
      : i !== 'no' && !pos ? 'Pick at least one position'
      : i !== 'no' && !t ? 'Tell us how she\\'d travel'
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

  let player = SAMPLE, prev = null, justSaved = false, problem = "";
  if (!preview) {
    if (!UUID_RE.test(token)) return res.status(404).send(notFound("That link is missing its code."));
    const { data } = await supabase.from("players")
      .select("id, first_name, last_name, team_assignment, parent_name")
      .eq("global_token", token).maybeSingle();
    if (!data) return res.status(404).send(notFound("We can't find that link."));
    player = data;
    const { data: row } = await supabase.from("global_challenge_interest")
      .select("*").eq("player_id", player.id).maybeSingle();
    prev = row;
  }

  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") {
      const sp = new URLSearchParams(body);
      body = { ...Object.fromEntries(sp), positions: sp.getAll("positions") };
    }
    // Checkbox groups arrive as an array from Vercel's parser, or as a single
    // string when only one is ticked, or not at all.
    const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]).map(String);
    const pick = (list, v) => (list.some((o) => o.key === v) ? v : null);

    const interest = pick(GC_INTEREST, body?.interest);
    const isNo = interest === "no";
    const positions = isNo ? [] : [...new Set(arr(body?.positions).filter((k) => GC_POSITIONS.some((o) => o.key === k)))];
    const travel = isNo ? null : pick(GC_TRAVEL, body?.travel);
    const n = parseInt(body?.travelers, 10);
    const travelers = !isNo && (travel === "parent" || travel === "family") && n >= 1 && n <= 12 ? n : null;
    const city = isNo ? null : pick(GC_CITIES, body?.city);
    const passport = isNo ? null : (["yes", "no", "unsure"].includes(body?.passport) ? body.passport : null);
    const respondent_name = String(body?.respondent_name || "").trim().slice(0, 120);
    const questions = String(body?.questions || "").trim().slice(0, 2000) || null;

    // The browser disables the button until these are filled, but the server
    // is where it gets decided.
    problem = !interest ? "Let us know whether you're interested."
      : !isNo && !positions.length ? "Pick at least one position she'd be open to playing."
      : !isNo && !travel ? "Tell us how she'd travel."
      : respondent_name.length < 2 ? "Type your name so we know who answered." : "";

    const answer = { interest, positions, travel, travelers, city, passport, respondent_name, questions };
    if (!problem && !preview) {
      const now = new Date().toISOString();
      const { error } = await supabase.from("global_challenge_interest").upsert({
        player_id: player.id, ...answer, updated_at: now,
        submitted_ip: String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || null,
      }, { onConflict: "player_id" });
      if (error) problem = "Something went wrong saving that. Please try again.";
      else {
        const { data: fresh } = await supabase.from("global_challenge_interest")
          .select("*").eq("player_id", player.id).maybeSingle();
        prev = fresh; justSaved = true;
      }
    } else if (!problem && preview) {
      prev = { ...answer, updated_at: new Date().toISOString() }; justSaved = true;
    } else {
      // Keep what they typed so a missed field doesn't wipe the rest.
      prev = { ...(prev || {}), ...answer };
    }
  }

  const v = prev || {};
  const who = esc(player.first_name);
  const done = justSaved || (prev && prev.updated_at && !problem);
  const qs = preview ? "?preview=1" : "?t=" + esc(token);

  return res.status(problem ? 400 : 200).send(page(`
    <span class="eyebrow">DS Elite Volleyball · Summer 2027</span>
    <h1>Girls Global Challenge</h1>
    <p class="sub">Croatia · July 7–18, 2027 · for <b style="color:var(--ink)">${who} ${esc(player.last_name)}</b>${
      player.team_assignment ? " · " + esc(player.team_assignment) : ""}${
      preview ? ' <span style="color:var(--gold)">· preview, nothing saves</span>' : ""}</p>

    ${problem ? `<div class="err">${esc(problem)}</div>` : ""}
    ${done ? `<div class="tick"><span class="k">&#10003;</span><span>
        <b>${justSaved ? "Thanks, we have your answer." : "We have your answer."}</b>
        <small>${v.updated_at ? "Saved " + esc(fmtWhen(v.updated_at)) + ". " : ""}Change anything below and send it again any time.</small>
      </span></div>` : ""}

    <div class="card">
      <p class="sect">The trip</p>
      <p>We've been invited to bring a team to the <b style="color:var(--ink)">Girls Global Challenge</b>, an international
        tournament that has run for more than 20 years. Teams come from across Europe and beyond, and most of them speak English.
        Mick Haley (Hunter's dad) has been at it every year for the last six.</p>
      <p>We'd enter the <b style="color:var(--ink)">U17 division</b>, so we're asking our 14 and 15 National and Regional
        players first to see if there are enough to field a team.</p>
      <p>The timing is ideal for Texas club players. It starts right after club tryouts and gets everyone
        home before school tryouts.</p>
      <p>Think of it as a school trip more than a family vacation. The girls travel, eat, play and
        sightsee together as a team.</p>
      <p>Families are more than welcome to come. During the day the players are mostly with the team for
        scrimmages and matches, so families are free to explore the city on their own. Group sightseeing
        we all do together.</p>
    </div>

    <div class="card">
      <p class="sect">The plan</p>
      <ul class="it">${GC_ITINERARY.map((d) => `<li><span class="d">${esc(d.when)}</span><span>${esc(d.what)}</span></li>`).join("")}</ul>
    </div>

    <div class="card">
      <p class="sect">Pre-tour options</p>
      <p>We'll fly into one of these cities for the first three days. Vote for your favorite on the form below.</p>
      <ul class="it">${GC_CITIES.filter((c) => c.blurb).map((c) => `<li><span><b style="color:var(--ink)">${esc(c.label)}</b><br><span style="color:var(--mut);font-size:.9rem">${esc(c.blurb)}</span></span></li>`).join("")}</ul>
    </div>

    <div class="card">
      <p class="sect">Cost</p>
      <div class="price"><b>${money(GC_PRICE)}</b><span>per player, plus airfare</span></div>
      <ul class="inc">
        <li>Hotels, with players sharing rooms two or three to a room</li>
        <li>Meals</li>
        <li>Tournament entry</li>
        <li>Team sightseeing</li>
        <li>Travel between cities in Europe</li>
      </ul>
      <div class="price" style="margin-top:14px"><b style="font-size:1.8rem">${money(GC_FAMILY_PRICE)}</b><span>per parent or family member, plus airfare</span></div>
      <p style="color:var(--mut);font-size:.9rem">A private room is ${money(GC_SINGLE_SUPPLEMENT)} extra.</p>
    </div>

    <div class="note"><b>This isn't a commitment.</b> We're only checking interest. Nothing is owed, and
      nobody is signed up by filling this in.</div>

    <form method="POST" action="${qs}" class="card" id="gc">
      <p class="sect">Your answer</p>

      <p class="q">Would ${who} be interested in going? <span class="req">*</span></p>
      ${GC_INTEREST.map((o) => radio("interest", o, v.interest)).join("")}

      <div id="more">
        <p class="q">Which positions would she be open to playing? <span class="req">*</span>
          <small>Tick all that apply. A travel roster is small, so flexibility helps.</small></p>
        <div class="grid">${GC_POSITIONS.map((o) => `
          <label class="opt"><input type="checkbox" name="positions" value="${o.key}" ${(v.positions || []).includes(o.key) ? "checked" : ""}>
            <span><span class="t">${esc(o.label)}</span></span></label>`).join("")}</div>

        <p class="q">How would she travel? <span class="req">*</span></p>
        ${GC_TRAVEL.map((o) => radio("travel", o, v.travel)).join("")}

        <div id="fam">
          <p class="q">About how many family members would come, not counting ${who}?</p>
          <input type="number" name="travelers" min="1" max="12" inputmode="numeric" value="${esc(v.travelers ?? "")}" placeholder="e.g. 2">
        </div>

        <p class="q">Which pre-tour city sounds best? <small>Optional. We'll go with what most families prefer.</small></p>
        <select name="city">
          <option value="">Choose one</option>
          ${GC_CITIES.map((o) => `<option value="${o.key}" ${v.city === o.key ? "selected" : ""}>${esc(o.label)}</option>`).join("")}
        </select>

        <p class="q">Does ${who} have a passport valid through January 2028? <small>Optional. Most of Europe wants six months left on it.</small></p>
        ${[["yes", "Yes"], ["no", "No, we'd need to get or renew one"], ["unsure", "Not sure"]]
          .map(([k, l]) => radio("passport", { key: k, label: l }, v.passport)).join("")}
      </div>

      <p class="q">Your name <span class="req">*</span></p>
      <input type="text" name="respondent_name" autocomplete="name" value="${esc(v.respondent_name || "")}" placeholder="Parent or guardian">

      <p class="q">Questions or anything we should know? <small>Optional</small></p>
      <textarea name="questions" placeholder="Dates, cost, rooming, anything">${esc(v.questions || "")}</textarea>

      <button class="go" type="submit">Send our answer</button>
    </form>

    <div class="foot">DS Elite Volleyball · Girls Global Challenge 2027<br>
      Questions? Hunter Haley · <a href="mailto:hunter@drippingsportsclub.com">hunter@drippingsportsclub.com</a></div>
    <script>${script}</script>`,
    { title: player.first_name + " · Girls Global Challenge · DS Elite" }));
}
