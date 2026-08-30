// Vercel serverless function: the public jersey & gear order form.
//
// GET  /gear?t=<token>  → the form, pre-filled from the roster and from any
//                         order this family has already submitted
// POST /gear?t=<token>  → saves the order and re-renders with a confirmation
//
// Replaces the Google Form. The three fields that ruin an order — last-name
// spelling, jersey number, team — come pre-filled from our own roster, so the
// parent checks our details instead of retyping them, and anything they change
// is visible to us as a change rather than as a mystery.
//
// Deliberately NOT part of the React app: the app is behind a login, and this
// has to open from an email on a phone with no account and no install.
//
// Sizes are validated against the same lists the form offers, so the order that
// reaches the vendor can't contain a value nobody sells.
//
// Families who never answered the school-team form get those questions tacked
// on the end of this one. They're already filling a form for us; asking again
// in a separate email is how you get 45 non-answers a second time. Anyone who
// already answered doesn't see the section at all.
//
// The contacts block is here for the same reason. The roster holds one parent
// for every girl and a second for barely a fifth of them, which is fine right
// up until a try-on table where the parent in front of you is the one we don't
// have, and the girl herself is reachable only through a phone we never asked
// for. Pre-filled with what we hold, and stored on the ORDER rather than
// written back over the roster: a form anyone holding the link can open must
// not be able to silently rewrite how we reach a family. The board shows what
// came in against what we hold, and the roster is corrected from there.
//
// GET /gear?preview=1 renders the same page with no player and no saving, so
// staff can look at what families get without opening a real family's order and
// risking a submission in their name.
//
// Product photos are optional files under public/gear/<key>.jpg. A missing one
// removes itself rather than showing a broken image, so the form works before
// the photos are dropped in.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";
import { saveSchoolGames } from "./_lib/school-games.js";
import { GEAR_TEAMS as TEAMS } from "../shared/gear-teams.js";
import { SCHOOL_DIVS } from "../shared/school-divs.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SIZES_JERSEY  = ["Youth M", "Youth L", "XXXS", "XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];
const SIZES_TEE     = ["Youth M", "Youth L", "Youth XL", "Adult S", "Adult M", "Adult L", "Adult XL"];
const SIZES_APPAREL = ["XS", "S", "M", "L", "XL", "XXL"];
const SPANDEX_LEN   = ['3"', '4"', '5"'];
const KNEEPADS      = ["XS/S", "M/L", "XL"];
const SOCKS         = ["M (shoe size 5-10)", "L (shoe size 10-13)"];
const SLEEVES       = ["Youth", "Adult S", "Adult M", "Adult L"];
const SHOES         = ["5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5",
                       "10", "10.5", "11", "11.5", "12", "12.5", "13"];

// School-team questions, only asked of girls old enough to be on one. Same
// options as api/school-form.js — two lists that drift apart would file one
// school team under two names on the board. The age list is shared with the
// board that chases the missing answers.
const SCHOOL_GRADES = ["6th", "7th", "8th", "9th", "10th", "11th", "12th"];
const SCHOOL_LEVELS = ["Varsity", "JV", "Freshman", "Flex", "8th A", "8th B", "7th A", "7th B", "Other"];

// One list drives the form, the validation, and the saved row, so a new item is
// a single edit and can't be added to the page without being saved.
const ITEMS = [
  { key: "jersey_size",       label: "Sleeveless Jersey",        img: "jersey",       opts: SIZES_JERSEY },
  { key: "warmup_tee_size",   label: "Long Sleeve Warm-Up Tee",  img: "warmup-tee",   opts: SIZES_JERSEY },
  { key: "practice_tee_size", label: "Practice T-shirt",         img: "practice-tee", opts: SIZES_TEE,
    hint: "There's no sample of this one to try on — go by the size of her pink practice shirt from tryouts." },
  { key: "hoodie_size",       label: "Hooded Sweatshirt",        img: "hoodie",       opts: SIZES_APPAREL },
  { key: "spandex_size",      label: "Adidas Spandex Shorts",    img: "spandex",      opts: SIZES_APPAREL },
  { key: "spandex_length",    label: "Spandex Shorts — inseam",  img: "spandex",      opts: SPANDEX_LEN },
  { key: "jogger_size",       label: "Jogger Pants",             img: "joggers",      opts: SIZES_APPAREL },
  { key: "kneepad_size",      label: "Kneepads",                 img: "kneepads",     opts: KNEEPADS },
  { key: "sock_size",         label: "Socks",                    img: "socks",        opts: SOCKS },
  { key: "arm_sleeve_size",   label: "Arm Sleeves",              img: "arm-sleeves",  opts: SLEEVES },
  { key: "shoe_size",         label: "Shoe Size",                img: "shoes",        opts: SHOES,
    hint: "These run true to size. Shoes are ordered as a group and invoiced separately." },
];

const page = (inner, { title = "Gear order — DS Elite" } = {}) => `<!doctype html>
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
  input[type=text], select, textarea {
    width:100%; padding:13px 13px; font:inherit; font-size:17px; color:var(--ink);
    background:#151312; border:1px solid var(--rule); border-radius:10px; }
  input:focus, select:focus, textarea:focus { outline:2px solid var(--gold); outline-offset:1px; border-color:var(--gold); }
  textarea { min-height:80px; resize:vertical; line-height:1.5; }
  /* Each item is a photo beside its size picker: a parent matching the gym
     table to the list should not have to guess which shirt is which. */
  .item { display:flex; gap:14px; align-items:flex-start; margin-bottom:18px; }
  .item .pic { flex:0 0 76px; width:76px; height:76px; border-radius:10px; background:#f6f4f1;
               display:flex; align-items:center; justify-content:center; overflow:hidden; }
  .item .pic img { width:100%; height:100%; object-fit:contain; }
  .item .fields { flex:1; min-width:0; }
  .item label { margin-bottom:0; }
  .hint { color:var(--mut); font-size:.83rem; margin:6px 0 0; }
  .seg { display:flex; gap:9px; }
  .seg button { flex:1; padding:14px 8px; font:inherit; font-weight:700; font-size:15px; cursor:pointer;
    background:transparent; color:var(--body); border:1px solid var(--rule); border-radius:10px; }
  .seg button[aria-pressed="true"] { background:rgba(224,180,85,.16); border-color:var(--gold); color:var(--gold); }
  .hide { display:none; }
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
  .foot { margin-top:20px; color:var(--mut); font-size:.82rem; text-align:center; }
  .recap { width:100%; border-collapse:collapse; font-size:.93rem; }
  .recap td { padding:6px 0; border-bottom:1px solid var(--rule); }
  .recap td:last-child { text-align:right; color:var(--ink); font-weight:700; }
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

  // Staff preview. No token, no player, no write — the page and nothing else.
  if (String((req.query && req.query.preview) || "") === "1") {
    if (req.method === "POST") {
      return res.status(200).send(page(`
        <span class="eyebrow">DS Elite Volleyball</span>
        <h1>Nothing saved</h1>
        <div class="card">
          <div class="note">This is the staff preview, so submitting does nothing. A family opening their own link would have their order recorded.</div>
          <p style="margin:16px 0 0"><a href="/gear?preview=1" style="color:var(--gold)">Back to the preview</a></p>
        </div>`, { title: "Preview — gear order — DS Elite" }));
    }
    return res.status(200).send(renderForm(
      { first_name: "", last_name: "", team_assignment: "", jersey_number: "" }, {},
      { preview: true, askSchool: true }));
  }

  if (!UUID_RE.test(token)) return res.status(400).send(notFound("That link is missing its code, or it was cut in half by the email app."));

  const { data: player } = await supabase
    .from("players").select("id,first_name,last_name,team_assignment,jersey_number,usav_div," +
      "parent_name,parent_phone,parent_email,parent_email2,parent2_name,parent2_phone,player_phone")
    .eq("gear_form_token", token).maybeSingle();
  if (!player) return res.status(404).send(notFound("We can't find that link. It may have been re-issued."));

  const [{ data: prev }, { data: school }] = await Promise.all([
    supabase.from("player_gear_orders").select("*").eq("player_id", player.id).maybeSingle(),
    supabase.from("school_team_reports").select("*").eq("player_id", player.id).maybeSingle(),
  ]);
  // Only ask the girls old enough for a school team, and only the ones who
  // haven't already told us.
  const askSchool = !school && SCHOOL_DIVS.includes(player.usav_div);

  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") body = Object.fromEntries(new URLSearchParams(body));

    // Only ever store a value the form itself offered. A size nobody sells is
    // worse than a blank: blanks get chased, junk gets ordered.
    const pick = (key, opts) => {
      const v = String(body?.[key] || "").trim();
      return opts.includes(v) ? v : null;
    };
    const text = (key, max) => String(body?.[key] || "").trim().slice(0, max) || null;
    const row = {
      player_id: player.id,
      first_name: String(body?.first_name || "").trim().slice(0, 80) || null,
      last_name: String(body?.last_name || "").trim().slice(0, 80) || null,
      // The number is ours to assign, not theirs to type. Taken from the
      // roster rather than the request body, so a changed field, a stale
      // form, or devtools all save the same thing: what we assigned. Two
      // girls on one team answering #5 is a problem no vendor can fix.
      jersey_number: player.jersey_number == null ? null : String(player.jersey_number),
      team_name: pick("team_name", TEAMS),
      parent1_name: text("parent1_name", 120),
      parent1_phone: text("parent1_phone", 40),
      parent1_email: text("parent1_email", 200),
      parent2_name: text("parent2_name", 120),
      parent2_phone: text("parent2_phone", 40),
      parent2_email: text("parent2_email", 200),
      single_parent: !!body?.single_parent,
      player_phone: text("player_phone", 40),
      details_confirmed: !!body?.details_confirmed,
      shoe_invoice_ack: !!body?.shoe_invoice_ack,
      notes: String(body?.notes || "").trim().slice(0, 2000) || null,
      // A family filling in their own order clears any correction we made on
      // their behalf — from here on the row is theirs.
      edited_by: null,
      edited_at: null,
    };
    for (const it of ITEMS) row[it.key] = pick(it.key, it.opts);

    // The school answer rides along, but it must never block a gear order: the
    // only required part is the one-tap yes/no, and "not sure yet" is a real
    // answer. School/grade/level are required only once she says yes, because
    // that's the point at which they exist.
    const madeRaw = String(body?.made_team || "").trim();
    const schoolRow = askSchool ? {
      player_id: player.id,
      made_team: madeRaw === "yes" ? true : madeRaw === "no" ? false : null,
      school: String(body?.school || "").trim().slice(0, 200) || null,
      grade: pick("grade", SCHOOL_GRADES),
      team_level: pick("team_level", SCHOOL_LEVELS),
      schedule: String(body?.schedule || "").trim().slice(0, 4000) || null,
    } : null;
    if (schoolRow && schoolRow.made_team === false) { schoolRow.team_level = null; schoolRow.schedule = null; }

    // A single parent is a normal family, so the second contact can't just be
    // required — but a blank one has to be a stated answer rather than a
    // skipped section, or nobody can tell it apart from a form filled in at a
    // red light. Name is what makes the second contact "given": a phone with
    // nobody attached to it is not a person we can ask for.
    const hasParent2 = !!(row.parent2_name || row.parent2_phone || row.parent2_email);

    const missing = [];
    if (!row.first_name) missing.push("player first name");
    if (!row.last_name) missing.push("player last name");

    if (!row.team_name) missing.push("team");
    if (!row.parent1_name) missing.push("first parent's name");
    if (!row.parent1_phone) missing.push("first parent's phone");
    if (!row.parent1_email) missing.push("first parent's email");
    if (!hasParent2 && !row.single_parent) missing.push("the second parent — fill them in, or tick that there's only one");
    if (hasParent2 && !row.parent2_name) missing.push("second parent's name");
    if (hasParent2 && !row.parent2_phone) missing.push("second parent's phone");
    if (hasParent2 && !row.parent2_email) missing.push("second parent's email");
    for (const it of ITEMS) if (!row[it.key]) missing.push(it.label.toLowerCase());
    if (!row.details_confirmed) missing.push("the confirmation box");
    if (askSchool) {
      if (!madeRaw) missing.push("whether she made a school team");
      if (madeRaw === "yes") {
        if (!schoolRow.school) missing.push("her school");
        if (!schoolRow.grade) missing.push("her grade");
        if (!schoolRow.team_level) missing.push("which school team");
      }
    }

    if (missing.length) {
      return res.status(200).send(renderForm(player, { ...prev, ...row }, {
        error: "Still needs: " + missing.join(", ") + ".",
        askSchool, school: { ...(school || {}), ...(schoolRow || {}), made_raw: madeRaw },
      }));
    }

    // Ticking "only one parent" and then filling one in is a family changing
    // their mind halfway down the section, not a contradiction to argue with.
    // The details they typed are the later answer, so they win.
    if (hasParent2) row.single_parent = false;

    const { error } = await supabase.from("player_gear_orders")
      .upsert(row, { onConflict: "player_id" });
    if (error) {
      return res.status(500).send(page(`
        <span class="eyebrow">DS Elite Volleyball</span><h1>Didn't save</h1>
        <div class="card"><div class="err">Something went wrong saving that order. Please try again, or reply to the email and we'll take it down by hand.</div></div>`));
    }

    // Saved after the order, and never allowed to fail the whole submission —
    // the family did the work either way, and a lost gear order is the more
    // expensive thing to lose.
    // "Don't know yet" deliberately writes NOTHING. A row — even an empty one —
    // would count her as answered on the school board and drop her off the chase
    // list, when the whole point of that answer is "ask me again".
    let schoolSaved = false;
    if (schoolRow && (madeRaw === "yes" || madeRaw === "no")) {
      const { error: sErr } = await supabase.from("school_team_reports")
        .upsert(schoolRow, { onConflict: "player_id" });
      schoolSaved = !sErr;
      if (schoolSaved) await saveSchoolGames(supabase, { ...schoolRow, id: null });
    }

    const recap = [
      ["Player", (row.first_name || "") + " " + (row.last_name || "")],
      ["Jersey number", row.jersey_number],
      ["Team", row.team_name],
      ["Parent 1", [row.parent1_name, row.parent1_phone, row.parent1_email].filter(Boolean).join(" · ")],
      ["Parent 2", hasParent2
        ? [row.parent2_name, row.parent2_phone, row.parent2_email].filter(Boolean).join(" · ")
        : "one parent/guardian"],
      ...(row.player_phone ? [["Her phone", row.player_phone]] : []),
      ...ITEMS.map(it => [it.label, row[it.key]]),
      ...(schoolSaved ? [
        ["School team", schoolRow.made_team === false ? "not playing this year"
          : [schoolRow.school, schoolRow.team_level].filter(Boolean).join(" · ") || "yes"],
      ] : []),
    ];
    return res.status(200).send(page(`
      <span class="eyebrow">DS Elite Volleyball</span>
      <h1>Order received</h1>
      <p class="sub">Recorded for ${esc(row.first_name)} ${esc(row.last_name)}.</p>
      <div class="card">
        <div class="ok"><b>Saved.</b> Nothing else to do. If you spot a mistake, open this same link again — it edits this order rather than adding a second one.</div>
        <table class="recap" style="margin-top:16px">
          ${recap.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}
        </table>
      </div>
      <div class="foot">Questions? Coach Kristen — kristen@dselitevolleyball.com</div>`,
      { title: "Order received — DS Elite" }));
  }

  return res.status(200).send(renderForm(player, prev || {}, { askSchool, school: school || {} }));
}

// The school-team questions, for families who never filled in the separate
// form. Written to be skippable in one tap ("not sure yet") so a girl whose
// school hasn't finished tryouts can still order her gear.
function schoolSection(s) {
  const sel = (val, cur) => val === cur ? " selected" : "";
  const made = s.made_raw != null ? s.made_raw
    : s.made_team === true ? "yes" : s.made_team === false ? "no" : "";
  const opt = (val, label) => `<button type="button" data-v="${val}" aria-pressed="${made === val}">${label}</button>`;
  return `
    <div class="card">
      <p class="sect">School volleyball</p>
      <p class="hint" style="margin:-6px 0 14px">We never got this one from you. It's how we avoid putting a practice
      or a tournament on top of her school matches.</p>
      <label><span class="lb">Did she make a school team? <span class="req">*</span></span>
        <div class="seg">
          ${opt("yes", "Made a team")}
          ${opt("no", "Not this year")}
          ${opt("unknown", "Don't know yet")}
        </div>
        <input type="hidden" name="made_team" id="made" value="${esc(made)}">
      </label>
      <div id="schoolonly" class="${made === "yes" ? "" : "hide"}">
        <label><span class="lb">School <span class="req">*</span></span>
          <input type="text" name="school" value="${esc(s.school)}" placeholder="e.g. Dripping Springs Middle School" autocomplete="off"></label>
        <label><span class="lb">Her grade <span class="req">*</span></span>
          <select name="grade"><option value="">— choose —</option>
            ${SCHOOL_GRADES.map(g => `<option${sel(g, s.grade)}>${g}</option>`).join("")}
          </select></label>
        <label><span class="lb">Which team <span class="req">*</span></span>
          <select name="team_level"><option value="">— choose —</option>
            ${SCHOOL_LEVELS.map(l => `<option${sel(l, s.team_level)}>${l}</option>`).join("")}
          </select></label>
        <label style="margin-bottom:0"><span class="lb">Her schedule <span style="text-transform:none;letter-spacing:0">(optional)</span></span>
          <textarea name="schedule" placeholder="Paste the dates, or a link to the school's schedule page. Rough is fine.">${esc(s.schedule)}</textarea></label>
      </div>
    </div>`;
}

function renderForm(player, v, { error, preview, askSchool, school } = {}) {
  const sel = (val, cur) => val === cur ? " selected" : "";
  const has = (k) => v && v[k] != null && v[k] !== "";
  // Roster values are the default; anything the family already submitted wins,
  // because they know how her name is spelled and we only think we do.
  const firstName = has("first_name") ? v.first_name : (player.first_name || "");
  const lastName = has("last_name") ? v.last_name : (player.last_name || "");
  const jersey = has("jersey_number") ? v.jersey_number
    : (player.jersey_number == null ? "" : String(player.jersey_number));
  const team = has("team_name") ? v.team_name : (player.team_assignment || "");
  const submitted = !!v.updated_at;

  // Both parents are pre-filled from the roster now that it holds them — the
  // 26-27 master workbooks were imported into parent2_name/parent2_phone (see
  // scripts/import-master-contacts.mjs), so most families are confirming what
  // we already have rather than typing it in on a phone.
  const pre = (k, fallback) => has(k) ? v[k] : (fallback || "");
  const p1 = {
    name: pre("parent1_name", player.parent_name),
    phone: pre("parent1_phone", player.parent_phone),
    email: pre("parent1_email", player.parent_email),
  };
  const p2 = {
    name: pre("parent2_name", player.parent2_name),
    phone: pre("parent2_phone", player.parent2_phone),
    email: pre("parent2_email", player.parent_email2),
  };
  const playerPhone = pre("player_phone", player.player_phone);

  const itemHtml = (it) => `
    <div class="item">
      <div class="pic"><img src="/gear/${it.img}.jpg" alt="" loading="lazy" onerror="this.parentNode.remove()"></div>
      <div class="fields">
        <label><span class="lb">${esc(it.label)} <span class="req">*</span></span>
          <select name="${it.key}" required>
            <option value="">— choose —</option>
            ${it.opts.map(o => `<option${sel(o, v[it.key])}>${esc(o)}</option>`).join("")}
          </select></label>
        ${it.hint ? `<p class="hint">${esc(it.hint)}</p>` : ""}
      </div>
    </div>`;

  return page(`
  <span class="eyebrow">DS Elite Volleyball</span>
  <h1>Jersey &amp; gear order</h1>
  <p class="sub">${preview
    ? `<span style="color:var(--gold)">Preview — this is exactly what a family sees, except theirs arrives with her name, number and team already filled in. Nothing you enter here is saved.</span>`
    : `For <b style="color:var(--ink)">${esc(player.first_name)} ${esc(player.last_name)}</b>${player.team_assignment ? " · " + esc(player.team_assignment) : ""}.
       ${submitted
         ? `<span style="color:var(--gold)">You've already sent this in — this is your saved order. Change anything and send it again.</span>`
         : "Takes a couple of minutes."}`}</p>

  <form method="POST" id="f">
    ${error ? `<div class="err">${esc(error)}</div>` : ""}

    <div class="card">
      <p class="sect">Check this before you send</p>
      <div class="note">
        These come from our roster and we order from exactly what's below.
        <ul>
          <li>Fix the <b>spelling of her last name</b> here if it's wrong — that's what gets printed.</li>
          <li>Her <b>number and team</b> are set by the club and can't be changed on this form.
              If either looks wrong, tell us in the notes at the bottom or grab a coach —
              don't work around it, because two girls can't wear the same number.</li>
        </ul>
      </div>
      <div style="height:16px"></div>
      <label><span class="lb">Player first name <span class="req">*</span></span>
        <input type="text" name="first_name" value="${esc(firstName)}" required autocomplete="off"></label>
      <label><span class="lb">Player last name <span class="req">*</span></span>
        <input type="text" name="last_name" value="${esc(lastName)}" required autocomplete="off"></label>
      <label><span class="lb">Assigned jersey number</span>
        <input type="text" value="${esc(jersey) || "not assigned yet"}" readonly disabled
          style="opacity:.72;cursor:not-allowed" autocomplete="off">
        <p class="hint">Set by the club. ${esc(jersey) ? "" : "We'll assign hers before the order goes in."}</p></label>
      <label><span class="lb">Team <span class="req">*</span></span>
        <select name="team_name" required>
          <option value="">— choose —</option>
          ${TEAMS.map(t => `<option${sel(t, team)}>${esc(t)}</option>`).join("")}
        </select></label>
      <label class="chk" style="margin-bottom:0">
        <input type="checkbox" name="details_confirmed" value="1" required${v.details_confirmed ? " checked" : ""}>
        <span>I've checked her last name spelling above, and the number and team we've assigned her are right. <span class="req">*</span></span>
      </label>
    </div>

    <div class="card">
      <p class="sect">Who we contact</p>
      <div class="note">
        We hold one parent for most families and nothing for the second, which is
        how a girl ends up at a try-on with nobody we can call. Both, please —
        and her own number if she has one.
      </div>
      <div style="height:16px"></div>

      <p class="lb" style="color:var(--ink);font-size:13px;letter-spacing:.04em">Parent / guardian 1</p>
      <label><span class="lb">Name <span class="req">*</span></span>
        <input type="text" name="parent1_name" value="${esc(p1.name)}" required autocomplete="off"></label>
      <label><span class="lb">Mobile <span class="req">*</span></span>
        <input type="tel" name="parent1_phone" value="${esc(p1.phone)}" required autocomplete="off"></label>
      <label><span class="lb">Email <span class="req">*</span></span>
        <input type="email" name="parent1_email" value="${esc(p1.email)}" required autocomplete="off"></label>

      <p class="lb" style="color:var(--ink);font-size:13px;letter-spacing:.04em;margin-top:22px">Parent / guardian 2</p>
      <label><span class="lb">Name</span>
        <input type="text" name="parent2_name" value="${esc(p2.name)}" autocomplete="off"></label>
      <label><span class="lb">Mobile</span>
        <input type="tel" name="parent2_phone" value="${esc(p2.phone)}" autocomplete="off"></label>
      <label><span class="lb">Email</span>
        <input type="email" name="parent2_email" value="${esc(p2.email)}" autocomplete="off"></label>
      <label class="chk">
        <input type="checkbox" name="single_parent" value="1"${v.single_parent ? " checked" : ""}>
        <span>There's only one parent or guardian for her — nothing to add here.</span>
      </label>

      <label style="margin-bottom:0"><span class="lb">Her own mobile <span style="text-transform:none;letter-spacing:0">(if she has one)</span></span>
        <input type="tel" name="player_phone" value="${esc(playerPhone)}" autocomplete="off">
        <p class="hint">Only used to reach her at a tournament or a try-on — she won't be added to any list.</p></label>
    </div>

    <div class="card">
      <p class="sect">Sizes</p>
      ${ITEMS.map(itemHtml).join("")}
      <label class="chk" style="margin-bottom:0">
        <input type="checkbox" name="shoe_invoice_ack" value="1"${v.shoe_invoice_ack ? " checked" : ""}>
        <span>I understand shoes are ordered as a group at a discount and will be invoiced separately by email.</span>
      </label>
    </div>

    ${askSchool ? schoolSection(school || {}) : ""}

    <div class="card">
      <p class="sect">Anything else</p>
      <label style="margin-bottom:0"><span class="lb">Notes <span style="text-transform:none;letter-spacing:0">(optional)</span></span>
        <textarea name="notes" placeholder="Between sizes, an old injury, anything we should know before ordering.">${esc(v.notes)}</textarea></label>
    </div>

    <button class="go" type="submit">${submitted ? "Update our order" : "Send our order"}</button>
    <p class="hint" style="text-align:center">All gear is provided by DS Elite except shoes.</p>
  </form>
  <div class="foot">Questions? Coach Kristen — kristen@dselitevolleyball.com</div>
  ${askSchool ? `<script>
    var made = document.getElementById('made');
    var only = document.getElementById('schoolonly');
    document.querySelectorAll('.seg button').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.seg button').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true');
        made.value = b.dataset.v;
        // Asking a family that didn't make a team which team they made is a
        // small thing that reads as not listening, so those fields go away.
        only.classList.toggle('hide', b.dataset.v !== 'yes');
      });
    });
  </script>` : ""}`,
  { title: preview ? "Preview — gear order — DS Elite" : player.first_name + " — gear order — DS Elite" });
}
