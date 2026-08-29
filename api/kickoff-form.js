// Vercel serverless function: the head coach's kickoff check-in.
//
// GET  /kickoff?t=<token>  → the form for that one team, pre-filled with the
//                            parents who signed up and any answer already given
// POST /kickoff?t=<token>  → saves it and re-renders with a confirmation
//
// Two questions, asked together because they're the same conversation: who is
// your team parent, and have you had your kickoff party.
//
// We already have a guess at the first — parents signed up at the season
// meeting and those names are in team_volunteers — but some teams have six on
// that list, which is a list of people who offered, not the person doing the
// job. So the coach ticks rather than types. Confirmation is stored on the
// person (team_volunteers.confirmed), so the team card and this form read the
// same list instead of two that drift.
//
// The third kickoff answer is the point of the whole thing. "Held" and
// "scheduled" are facts to file; "not scheduled yet" is the one that needs
// something to happen, so answering it turns the page into the ask — go talk
// to your team parent — and takes a date they'll have it booked by, which is
// what the Kickoffs board then chases.
//
// Deliberately NOT part of the React app: this opens from a push notification
// or an email on a phone in a gym, and not every coach has the app installed.
//
// GET /kickoff?preview=1 renders the page with no team and no saving, so staff
// can look at what coaches get without answering on some team's behalf.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ["held", "scheduled", "not_scheduled"];

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmtDate = (iso) => {
  if (!DATE_RE.test(String(iso || ""))) return "";
  try {
    return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US",
      { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  } catch { return iso; }
};
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

const page = (inner, { title = "Kickoff check-in — DS Elite" } = {}) => `<!doctype html>
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
  .wrap { max-width:620px; margin:0 auto; padding:28px 18px 64px; }
  .eyebrow { font-size:11px; letter-spacing:.18em; text-transform:uppercase; color:var(--gold); font-weight:700; }
  h1 { margin:6px 0 4px; color:var(--ink); font-family:"Barlow Condensed",sans-serif; font-weight:700;
       font-size:clamp(2rem,8vw,2.7rem); line-height:1; text-transform:uppercase; }
  .sub { margin:0 0 22px; color:var(--mut); font-size:.95rem; }
  .card { background:var(--card); border:1px solid var(--rule); border-radius:14px; padding:20px 18px; }
  .card + .card { margin-top:14px; }
  .sect { font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:var(--gold);
          font-weight:700; margin:0 0 14px; }
  label { display:block; margin-bottom:18px; }
  .lb { display:block; font-size:12px; letter-spacing:.09em; text-transform:uppercase;
        color:var(--mut); font-weight:700; margin-bottom:7px; }
  .lb .req { color:var(--pink); }
  input[type=text], input[type=date], input[type=email], input[type=tel], select, textarea {
    width:100%; padding:13px 13px; font:inherit; font-size:17px; color:var(--ink);
    background:#151312; border:1px solid var(--rule); border-radius:10px; }
  input:focus, select:focus, textarea:focus { outline:2px solid var(--gold); outline-offset:1px; border-color:var(--gold); }
  textarea { min-height:80px; resize:vertical; line-height:1.5; }
  .hint { color:var(--mut); font-size:.83rem; margin:6px 0 0; }
  .hint b { color:var(--ink); }
  /* One tap per answer, thumb-sized — coaches fill this in standing up. */
  .seg { display:flex; flex-direction:column; gap:9px; }
  .seg button { width:100%; text-align:left; padding:14px 15px; font:inherit; font-weight:700; font-size:15px;
    cursor:pointer; background:transparent; color:var(--body); border:1px solid var(--rule); border-radius:10px; }
  .seg button small { display:block; font-weight:400; font-size:.79rem; color:var(--mut); margin-top:2px; }
  .seg button[aria-pressed="true"] { background:rgba(224,180,85,.16); border-color:var(--gold); color:var(--gold); }
  .seg button[aria-pressed="true"] small { color:var(--gold); opacity:.8; }
  .hide { display:none; }
  /* The signup list: a tick box, the parent's name, and whose parent they are —
     the last one is how a coach recognises a name they only know as Ivy's mom. */
  .who { display:flex; gap:11px; align-items:flex-start; padding:11px 12px; margin-bottom:8px;
         border:1px solid var(--rule); border-radius:10px; cursor:pointer; }
  .who input { flex:0 0 22px; width:22px; height:22px; margin:2px 0 0; accent-color:var(--gold); }
  .who .nm { display:block; color:var(--ink); font-weight:700; font-size:15px; }
  .who .mt { display:block; color:var(--mut); font-size:.82rem; }
  .chk { display:flex; gap:11px; align-items:flex-start; margin-bottom:14px; cursor:pointer; }
  .chk input { flex:0 0 22px; width:22px; height:22px; margin:1px 0 0; accent-color:var(--gold); }
  .chk span { font-size:.93rem; line-height:1.45; }
  button.go { width:100%; padding:16px; font:inherit; font-weight:800; font-size:17px; cursor:pointer;
    background:var(--gold); color:#1a1613; border:none; border-radius:11px; margin-top:6px; }
  .ok { border-left:3px solid var(--grn); background:rgba(74,222,128,.09); padding:14px 16px; border-radius:0 8px 8px 0; }
  .ok b { color:var(--grn); }
  .err { border-left:3px solid var(--err); background:rgba(248,113,113,.09); padding:14px 16px;
         border-radius:0 8px 8px 0; margin-bottom:16px; }
  .note { border-left:3px solid var(--gold); background:rgba(224,180,85,.08); padding:13px 15px;
          border-radius:0 8px 8px 0; font-size:.9rem; }
  .note ul { margin:7px 0 0; padding-left:18px; }
  .note b { color:var(--gold); }
  .foot { margin-top:20px; color:var(--mut); font-size:.82rem; text-align:center; }
  .recap { width:100%; border-collapse:collapse; font-size:.93rem; }
  .recap td { padding:6px 0; border-bottom:1px solid var(--rule); vertical-align:top; }
  .recap td:last-child { text-align:right; color:var(--ink); font-weight:700; }
</style></head><body><div class="wrap">${inner}</div></body></html>`;

const notFound = (msg) => page(`
  <span class="eyebrow">DS Elite Volleyball</span>
  <h1>Link not found</h1>
  <div class="card"><div class="err">${esc(msg)}</div>
  <p style="margin:16px 0 0;font-size:.9rem;color:var(--mut)">Reply to the email you received and we'll send a fresh link.</p></div>
`, { title: "Link not found — DS Elite" });

// The preview needs a team that looks like a real one. A coach shown an empty
// page can't tell whether the form is broken or their team just has no signups.
const SAMPLE_TEAM = { team_name: "14 Sample", head_coach: "Coach" };
const SAMPLE_VOLS = [
  { id: -1, name: "Elaine King-FitzGibbon", role: "team_parent", email: "parent@example.com", phone: null, player_name: "Sienna", confirmed: false },
  { id: -2, name: "Thomas/Charissa Aguilar", role: "team_parent", email: null, phone: "512-555-0134", player_name: "Ivy", confirmed: false },
  { id: -3, name: "Colette Lockwood", role: "volunteer", email: null, phone: null, player_name: null, note: "GameChanger", confirmed: false },
];

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).send("Server not configured");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const token = String((req.query && req.query.t) || "").trim();
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // A form nobody should be indexing, or caching between coaches.
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");

  // Staff preview. No token, no team, no write — the page and nothing else.
  if (String((req.query && req.query.preview) || "") === "1") {
    if (req.method === "POST") {
      return res.status(200).send(page(`
        <span class="eyebrow">DS Elite Volleyball</span>
        <h1>Nothing saved</h1>
        <div class="card">
          <div class="note">This is the staff preview, so submitting does nothing. A coach opening their own link would have their answer recorded.</div>
          <p style="margin:16px 0 0"><a href="/kickoff?preview=1" style="color:var(--gold)">Back to the preview</a></p>
        </div>`, { title: "Preview — kickoff check-in — DS Elite" }));
    }
    return res.status(200).send(renderForm(SAMPLE_TEAM, SAMPLE_VOLS, {}, { preview: true }));
  }

  if (!UUID_RE.test(token)) return res.status(400).send(notFound("That link is missing its code, or it was cut in half by the email app."));

  const { data: team } = await supabase
    .from("practice_teams").select("team_name,head_coach,assistant_coach,age_div")
    .eq("kickoff_form_token", token).maybeSingle();
  if (!team) return res.status(404).send(notFound("We can't find that link. It may have been re-issued."));

  const [{ data: vols }, { data: prev }] = await Promise.all([
    supabase.from("team_volunteers").select("*").eq("team_name", team.team_name).order("role").order("name"),
    supabase.from("team_kickoffs").select("*").eq("team_name", team.team_name).maybeSingle(),
  ]);
  const volunteers = vols || [];

  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") body = Object.fromEntries(new URLSearchParams(body));

    // A checkbox group arrives as a string when one is ticked and an array when
    // several are; normalising here means the rest of the handler sees one shape.
    const ticked = new Set(
      [].concat(body?.tp ?? []).map(x => parseInt(String(x), 10)).filter(Number.isFinite)
    );
    const status = STATUSES.includes(String(body?.kickoff_status || "")) ? String(body.kickoff_status) : "";
    const date = DATE_RE.test(String(body?.kickoff_date || "")) ? String(body.kickoff_date) : null;
    const planBy = DATE_RE.test(String(body?.plan_by || "")) ? String(body.plan_by) : null;
    const added = {
      name: String(body?.new_name || "").trim().slice(0, 120),
      email: String(body?.new_email || "").trim().slice(0, 200) || null,
      phone: String(body?.new_phone || "").trim().slice(0, 40) || null,
      player_name: String(body?.new_player || "").trim().slice(0, 120) || null,
    };
    const noParent = !!body?.no_team_parent;
    const draft = {
      kickoff_status: status, kickoff_date: date, plan_by: planBy,
      kickoff_where: String(body?.kickoff_where || "").trim().slice(0, 300) || null,
      no_team_parent: noParent,
      notes: String(body?.notes || "").trim().slice(0, 2000),
      submitted_at: prev?.submitted_at || null,
    };

    const missing = [];
    if (!ticked.size && !added.name && !noParent) missing.push("who your team parent is — tick a name, add one, or say you don't have one yet");
    if (!status) missing.push("whether you've had your kickoff");
    if (status === "held" && !date) missing.push("the date you had it");
    if (status === "scheduled" && !date) missing.push("the date it's booked for");
    if (status === "not_scheduled" && !planBy) missing.push("the date you'll have it booked by");
    if (missing.length) {
      return res.status(200).send(renderForm(team, volunteers, { ...draft, ticked, added }, {
        error: "Still needs: " + missing.join("; ") + ".",
      }));
    }

    // A held or scheduled kickoff has a real date; "not scheduled" has a
    // promise instead, and carrying a stale date on it would put a party on the
    // board that nobody booked.
    const now = new Date().toISOString();
    const row = {
      team_name: team.team_name,
      kickoff_status: status,
      kickoff_date: status === "not_scheduled" ? null : date,
      kickoff_where: status === "not_scheduled" ? null : draft.kickoff_where,
      plan_by: status === "not_scheduled" ? planBy : null,
      no_team_parent: noParent,
      notes: draft.notes,
      submitted_by: team.head_coach || null,
      submitted_at: now,
      updated_at: now,
    };
    const { error } = await supabase.from("team_kickoffs").upsert(row, { onConflict: "team_name" });
    if (error) {
      return res.status(500).send(page(`
        <span class="eyebrow">DS Elite Volleyball</span><h1>Didn't save</h1>
        <div class="card"><div class="err">Something went wrong saving that. Please try again, or reply to the email and we'll take it down by hand.</div></div>`,
        { title: "Didn't save — DS Elite" }));
    }

    // Confirmation is a tick on the person, not a copy of their name: the team
    // card already lists these rows, so this makes that same list say which one
    // is doing the job, rather than starting a second list to keep in step.
    //
    // Role is left alone on purpose. A coach often confirms someone who signed
    // up to run GameChanger; they're the team parent now, but what they
    // originally offered is still worth being able to read back.
    const stamp = { confirmed_by: team.head_coach || null, confirmed_at: now, updated_at: now };
    const on  = volunteers.filter(x => ticked.has(x.id)).map(x => x.id);
    const off = volunteers.filter(x => !ticked.has(x.id) && x.confirmed).map(x => x.id);
    if (on.length)  await supabase.from("team_volunteers").update({ confirmed: true,  ...stamp }).in("id", on);
    if (off.length) await supabase.from("team_volunteers").update({ confirmed: false, ...stamp }).in("id", off);
    // Someone the signup sheet never had. Upserted on (team, name) so a coach
    // opening the link twice corrects the entry instead of adding a twin.
    if (added.name) {
      await supabase.from("team_volunteers").upsert({
        team_name: team.team_name, name: added.name, role: "team_parent",
        email: added.email, phone: added.phone, player_name: added.player_name,
        confirmed: true, ...stamp,
      }, { onConflict: "team_name,name" });
    }

    const { data: after } = await supabase.from("team_volunteers")
      .select("name").eq("team_name", team.team_name).eq("confirmed", true).order("name");
    const named = (after || []).map(x => x.name);

    const recap = [
      ["Team", team.team_name],
      ["Team parent", named.length ? named.join(", ") : "none yet"],
      ["Kickoff", status === "held" ? "held " + fmtDate(row.kickoff_date)
        : status === "scheduled" ? "booked for " + fmtDate(row.kickoff_date)
        : "not scheduled — booking it by " + fmtDate(row.plan_by)],
      ...(row.kickoff_where ? [["Where", row.kickoff_where]] : []),
    ];
    return res.status(200).send(page(`
      <span class="eyebrow">DS Elite Volleyball</span>
      <h1>Got it</h1>
      <p class="sub">Recorded for <b style="color:var(--ink)">${esc(team.team_name)}</b>.</p>
      <div class="card">
        <div class="ok"><b>Saved.</b> ${status === "not_scheduled"
          ? "The next step is yours: get hold of your team parent and pick a date. Open this same link once it's booked and change the answer."
          : "Nothing else to do. If anything changes, open this same link again — it updates this answer rather than adding a second one."}</div>
        <table class="recap" style="margin-top:16px">
          ${recap.map(([k, val]) => `<tr><td>${esc(k)}</td><td>${esc(val)}</td></tr>`).join("")}
        </table>
      </div>
      <div class="foot">Questions? Drew — drew@dselitevolleyball.com</div>`,
      { title: "Saved — kickoff check-in — DS Elite" }));
  }

  return res.status(200).send(renderForm(team, volunteers, prev || {}, {}));
}

function renderForm(team, volunteers, v, { error, preview } = {}) {
  const has = (k) => v && v[k] != null && v[k] !== "";
  // A rejected submission shows what the coach just typed; a first load shows
  // what they told us last time. Neither is ever overwritten by a default.
  const status = has("kickoff_status") ? v.kickoff_status : "";
  const date   = has("kickoff_date")  ? v.kickoff_date  : "";
  const planBy = has("plan_by")       ? v.plan_by       : "";
  const where  = has("kickoff_where") ? v.kickoff_where : "";
  const notes  = has("notes")         ? v.notes         : "";
  const noParent = !!v.no_team_parent;
  const added = v.added || {};
  // On a re-render the ticks are whatever they just ticked, including none.
  // Falling back to the saved rows there would silently re-tick a name the
  // coach had just cleared.
  const ticked = v.ticked instanceof Set ? v.ticked : null;
  const isOn = (row) => ticked ? ticked.has(row.id) : !!row.confirmed;

  const parents = volunteers.filter(x => x.role === "team_parent");
  const others  = volunteers.filter(x => x.role !== "team_parent");
  const answered = !!v.submitted_at;

  const whoRow = (x, tag) => `
    <label class="who">
      <input type="checkbox" name="tp" value="${x.id}"${isOn(x) ? " checked" : ""}>
      <span>
        <span class="nm">${esc(x.name)}</span>
        <span class="mt">${[
          x.player_name ? esc(x.player_name) + "'s parent" : "",
          tag,
          esc(x.email || x.phone || ""),
        ].filter(Boolean).join(" &middot; ")}</span>
      </span>
    </label>`;

  const seg = (val, label, sub) =>
    `<button type="button" data-v="${val}" aria-pressed="${status === val}">${label}<small>${sub}</small></button>`;

  return page(`
  <span class="eyebrow">DS Elite Volleyball</span>
  <h1>Kickoff check-in</h1>
  <p class="sub">${preview
    ? `<span style="color:var(--gold)">Preview — this is what a head coach sees, except theirs lists their own team's parent signups. Nothing you enter here is saved.</span>`
    : `<b style="color:var(--ink)">${esc(team.team_name)}</b>${team.head_coach ? " &middot; " + esc(team.head_coach) : ""}.
       ${answered
         ? `<span style="color:var(--gold)">You've already answered — this is what you told us. Change anything and send it again.</span>`
         : "Two questions, about a minute."}`}</p>

  <form method="POST" id="f">
    ${error ? `<div class="err">${esc(error)}</div>` : ""}

    <div class="card">
      <p class="sect">1 &middot; Your team parent</p>
      ${parents.length || others.length ? `
        <p class="hint" style="margin:-6px 0 14px">These parents signed up at the season kickoff meeting.
        Tick whoever is <b>actually</b> doing it — one, or two if you have co-team parents.</p>
        ${parents.map(x => whoRow(x, "")).join("")}
        ${others.length ? `
          <p class="hint" style="margin:14px 0 8px">Also volunteered on your team — tick one of these instead if that's who it turned out to be:</p>
          ${others.map(x => whoRow(x, esc(x.note || "volunteer"))).join("")}` : ""}
      ` : `
        <p class="hint" style="margin:-6px 0 14px">Nobody from your team signed up at the season kickoff meeting,
        so we have no name for you at all. If you have one, add them here.</p>`}

      <div style="height:6px"></div>
      <p class="sect" style="margin-bottom:10px">Not listed?</p>
      <label><span class="lb">Their name</span>
        <input type="text" name="new_name" value="${esc(added.name)}" placeholder="first and last" autocomplete="off"></label>
      <label><span class="lb">Their email</span>
        <input type="email" name="new_email" value="${esc(added.email)}" placeholder="so we can reach them directly" autocomplete="off"></label>
      <label><span class="lb">Their phone</span>
        <input type="tel" name="new_phone" value="${esc(added.phone)}" autocomplete="off"></label>
      <label><span class="lb">Whose parent</span>
        <input type="text" name="new_player" value="${esc(added.player_name)}" placeholder="player's name" autocomplete="off"></label>

      <label class="chk" style="margin-bottom:0">
        <input type="checkbox" name="no_team_parent" value="1"${noParent ? " checked" : ""}>
        <span>We don't have a team parent yet — tick this and we'll help you find one.</span>
      </label>
    </div>

    <div class="card">
      <p class="sect">2 &middot; Your kickoff party</p>
      <label style="margin-bottom:14px">
        <div class="seg">
          ${seg("held", "We've had it", "Tell us when and we'll mark it done.")}
          ${seg("scheduled", "It's on the calendar", "Not held yet, but there's a date.")}
          ${seg("not_scheduled", "Not scheduled yet", "That's fine — this is the nudge.")}
        </div>
        <input type="hidden" name="kickoff_status" id="ks" value="${esc(status)}">
      </label>

      <div id="dated" class="${status === "held" || status === "scheduled" ? "" : "hide"}">
        <label><span class="lb" id="datelb">${status === "held" ? "What date did you have it?" : "What date is it booked for?"} <span class="req">*</span></span>
          <input type="date" name="kickoff_date" value="${esc(date)}"></label>
        <label style="margin-bottom:0"><span class="lb">Where <span style="text-transform:none;letter-spacing:0">(optional)</span></span>
          <input type="text" name="kickoff_where" value="${esc(where)}" placeholder="a family's house, a restaurant, the gym" autocomplete="off"></label>
      </div>

      <div id="unsched" class="${status === "not_scheduled" ? "" : "hide"}">
        <div class="note">
          <b>Then it's time to call your team parent.</b> The kickoff is how the families on your
          team meet each other, and it doesn't happen until someone picks a date.
          <ul>
            <li>Ring or text the parent you ticked above — don't wait for the next practice.</li>
            <li>Let them host it and pick the place. That's the job they volunteered for.</li>
            <li>Any evening or weekend afternoon works. It doesn't have to be at the gym.</li>
          </ul>
        </div>
        <div style="height:16px"></div>
        <label style="margin-bottom:0"><span class="lb">I'll have a date booked by <span class="req">*</span></span>
          <input type="date" name="plan_by" value="${esc(planBy)}" min="${today()}">
          <p class="hint">We'll check back with you then, not before.</p></label>
      </div>
    </div>

    <div class="card">
      <p class="sect">Anything else</p>
      <label style="margin-bottom:0"><span class="lb">Notes <span style="text-transform:none;letter-spacing:0">(optional)</span></span>
        <textarea name="notes" placeholder="A parent who's stepped back, a date that keeps moving, anything we should know.">${esc(notes)}</textarea></label>
    </div>

    <button class="go" type="submit">${answered ? "Update my answer" : "Send it in"}</button>
  </form>
  <div class="foot">Questions? Drew — drew@dselitevolleyball.com</div>
  <script>
    var ks = document.getElementById('ks');
    var dated = document.getElementById('dated');
    var unsched = document.getElementById('unsched');
    var datelb = document.getElementById('datelb');
    document.querySelectorAll('.seg button').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.seg button').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true');
        var v = b.dataset.v;
        ks.value = v;
        dated.classList.toggle('hide', v !== 'held' && v !== 'scheduled');
        unsched.classList.toggle('hide', v !== 'not_scheduled');
        // "The date you had it" and "the date it's booked for" are one field
        // asking two different questions. Labelling it once for both reads as
        // if we weren't listening to the answer just given.
        datelb.innerHTML = (v === 'held' ? 'What date did you have it?' : 'What date is it booked for?') +
          ' <span class="req">*</span>';
      });
    });
  </script>`,
  { title: preview ? "Preview — kickoff check-in — DS Elite" : team.team_name + " — kickoff check-in — DS Elite" });
}
