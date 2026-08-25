// Vercel serverless function: the public "did you make a school team?" form.
//
// GET  /school?t=<token>  → the form, pre-filled with anything already saved
// POST /school?t=<token>  → saves the answer and re-renders with a confirmation
//
// Deliberately NOT part of the React app. The app is behind a login, and this
// has to open from a text message on a phone with no account and no install.
// Rendering the whole thing here also means the page is one request with no
// bundle to download.
//
// The token is a per-player uuid, so the URL cannot be walked to another
// family's form by editing a number. It grants exactly one thing: filling in
// that player's row.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const GRADES = ["6th", "7th", "8th", "9th", "10th", "11th", "12th"];
// High school levels first, then the middle school grade teams. Flex sits with
// the high school group because that is where schools run it.
const LEVELS = ["Varsity", "JV", "Freshman", "Flex", "8th A", "8th B", "7th A", "7th B", "Other"];

const page = (inner, { title = "School team — DS Elite" } = {}) => `<!doctype html>
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
          --rule:#332f2b; --gold:#e0b455; --grn:#4ade80; --err:#f87171; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  body { margin:0; background:var(--bg); color:var(--body);
         font-family:"Source Sans 3",system-ui,sans-serif; font-size:17px; line-height:1.55; }
  .wrap { max-width:560px; margin:0 auto; padding:28px 18px 64px; }
  .eyebrow { font-size:11px; letter-spacing:.18em; text-transform:uppercase; color:var(--gold); font-weight:700; }
  h1 { margin:6px 0 4px; color:var(--ink); font-family:"Barlow Condensed",sans-serif; font-weight:700;
       font-size:clamp(2rem,8vw,2.7rem); line-height:1; text-transform:uppercase; }
  .sub { margin:0 0 22px; color:var(--mut); font-size:.95rem; }
  .card { background:var(--card); border:1px solid var(--rule); border-radius:14px; padding:20px 18px; }
  label { display:block; margin-bottom:18px; }
  .lb { display:block; font-size:12px; letter-spacing:.09em; text-transform:uppercase;
        color:var(--mut); font-weight:700; margin-bottom:7px; }
  input[type=text], select, textarea {
    width:100%; padding:13px 13px; font:inherit; font-size:17px; color:var(--ink);
    background:#151312; border:1px solid var(--rule); border-radius:10px; }
  input:focus, select:focus, textarea:focus { outline:2px solid var(--gold); outline-offset:1px; border-color:var(--gold); }
  textarea { min-height:96px; resize:vertical; line-height:1.5; }
  .seg { display:flex; gap:9px; }
  .seg button { flex:1; padding:14px 8px; font:inherit; font-weight:700; font-size:15px; cursor:pointer;
    background:transparent; color:var(--body); border:1px solid var(--rule); border-radius:10px; }
  .seg button[aria-pressed="true"] { background:rgba(224,180,85,.16); border-color:var(--gold); color:var(--gold); }
  .hide { display:none; }
  button.go { width:100%; padding:16px; font:inherit; font-weight:800; font-size:17px; cursor:pointer;
    background:var(--gold); color:#1a1613; border:none; border-radius:11px; margin-top:4px; }
  button.go:disabled { opacity:.5; cursor:default; }
  .ok { border-left:3px solid var(--grn); background:rgba(74,222,128,.09); padding:14px 16px; border-radius:0 8px 8px 0; }
  .ok b { color:var(--grn); }
  .err { border-left:3px solid var(--err); background:rgba(248,113,113,.09); padding:14px 16px; border-radius:0 8px 8px 0; }
  .foot { margin-top:20px; color:var(--mut); font-size:.82rem; text-align:center; }
  .hint { color:var(--mut); font-size:.83rem; margin-top:-12px; margin-bottom:18px; }
</style></head><body><div class="wrap">${inner}</div></body></html>`;

const notFound = (msg) => page(`
  <span class="eyebrow">DS Elite Volleyball</span>
  <h1>Link not found</h1>
  <div class="card"><div class="err">${esc(msg)}</div>
  <p style="margin:16px 0 0;font-size:.9rem;color:var(--mut)">Reply to the email you received and we'll send a fresh link.</p></div>
`, { title: "Link not found — DS Elite" });

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).send("Server not configured");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const token = String((req.query && req.query.t) || "").trim();
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // A form nobody should be indexing or caching between families.
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");

  if (!UUID_RE.test(token)) return res.status(400).send(notFound("That link is missing its code, or it was cut in half by the email app."));

  const { data: player } = await supabase
    .from("players").select("id,first_name,last_name,team_assignment")
    .eq("school_form_token", token).maybeSingle();
  if (!player) return res.status(404).send(notFound("We can't find that link. It may have been re-issued."));

  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") {
      body = Object.fromEntries(new URLSearchParams(body));
    }
    const made = String(body?.made_team || "");
    const row = {
      player_id: player.id,
      made_team: made === "yes" ? true : made === "no" ? false : null,
      school: String(body?.school || "").trim().slice(0, 200) || null,
      grade: String(body?.grade || "").trim().slice(0, 40) || null,
      team_level: String(body?.team_level || "").trim().slice(0, 80) || null,
      schedule: String(body?.schedule || "").trim().slice(0, 4000) || null,
      notes: String(body?.notes || "").trim().slice(0, 2000) || null,
    };
    // Not-made-the-team is a real answer worth keeping, so only the school-team
    // fields are cleared — the note stays either way.
    if (row.made_team === false) { row.team_level = null; row.schedule = null; }
    const { error } = await supabase.from("school_team_reports")
      .upsert(row, { onConflict: "player_id" });
    if (error) {
      return res.status(500).send(page(`
        <span class="eyebrow">DS Elite Volleyball</span><h1>Didn't save</h1>
        <div class="card"><div class="err">Something went wrong saving that. Please try again, or just reply to the email.</div></div>`));
    }
    return res.status(200).send(page(`
      <span class="eyebrow">DS Elite Volleyball</span>
      <h1>Got it — thank you</h1>
      <p class="sub">Recorded for ${esc(player.first_name)} ${esc(player.last_name)}.</p>
      <div class="card">
        <div class="ok"><b>Saved.</b> ${row.made_team === false
          ? "Thanks for letting us know either way — it genuinely helps us plan around school season."
          : "Your coach will see this. If anything changes — you move up, or the schedule comes out later — open this same link again and update it."}</div>
        <p style="margin:16px 0 0;font-size:.9rem;color:var(--mut)">You can close this page.</p>
      </div>
      <div class="foot">DS Elite Volleyball</div>`, { title: "Thanks — DS Elite" }));
  }

  const { data: prev } = await supabase
    .from("school_team_reports").select("*").eq("player_id", player.id).maybeSingle();
  const v = prev || {};
  const sel = (val, cur) => val === cur ? " selected" : "";
  const madeYes = v.made_team === true, madeNo = v.made_team === false;

  return res.status(200).send(page(`
  <span class="eyebrow">DS Elite Volleyball</span>
  <h1>School volleyball</h1>
  <p class="sub">For <b style="color:var(--ink)">${esc(player.first_name)} ${esc(player.last_name)}</b>${player.team_assignment ? " · " + esc(player.team_assignment) : ""}. Takes about a minute.${prev ? " <span style=\"color:var(--gold)\">You've answered before — this is your saved answer, edit anything and save again.</span>" : ""}</p>
  <form method="POST" class="card" id="f">
    <label><span class="lb">Did she make a school team?</span>
      <div class="seg">
        <button type="button" data-v="yes" aria-pressed="${madeYes}">Yes</button>
        <button type="button" data-v="no"  aria-pressed="${madeNo}">Not this year</button>
      </div>
      <input type="hidden" name="made_team" id="made" value="${madeYes ? "yes" : madeNo ? "no" : ""}">
    </label>

    <label><span class="lb">School</span>
      <input type="text" name="school" value="${esc(v.school)}" placeholder="e.g. Dripping Springs Middle School" autocomplete="off"></label>

    <label><span class="lb">Grade</span>
      <select name="grade"><option value="">— choose —</option>
        ${GRADES.map(g => `<option${sel(g, v.grade)}>${g}</option>`).join("")}
      </select></label>

    <div id="teamonly" class="${madeNo ? "hide" : ""}">
      <label><span class="lb">Which team</span>
        <select name="team_level"><option value="">— choose —</option>
          ${LEVELS.map(l => `<option${sel(l, v.team_level)}>${l}</option>`).join("")}
        </select></label>

      <label><span class="lb">Schedule <span style="text-transform:none;letter-spacing:0">(optional)</span></span>
        <textarea name="schedule" placeholder="Paste the dates, or a link to the school's schedule page. Rough is fine.">${esc(v.schedule)}</textarea></label>
      <p class="hint">This is the part that helps us most — it's how we avoid scheduling over her school matches.</p>
    </div>

    <label><span class="lb">Anything else <span style="text-transform:none;letter-spacing:0">(optional)</span></span>
      <textarea name="notes" placeholder="">${esc(v.notes)}</textarea></label>

    <button class="go" type="submit">${prev ? "Update my answer" : "Send it in"}</button>
  </form>
  <div class="foot">DS Elite Volleyball · reply to the email if anything here looks wrong</div>
  <script>
    var made = document.getElementById('made');
    var only = document.getElementById('teamonly');
    document.querySelectorAll('.seg button').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.seg button').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true');
        made.value = b.dataset.v;
        // Asking a family that did not make a team which team they made is a
        // small thing that reads as not listening, so those fields go away.
        only.classList.toggle('hide', b.dataset.v === 'no');
      });
    });
  </script>`, { title: player.first_name + " — school team — DS Elite" }));
}
