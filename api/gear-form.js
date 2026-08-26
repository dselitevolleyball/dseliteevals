// Vercel serverless function: the public jersey & gear order form.
//
// GET  /gear?t=<token>  → the form, pre-filled from the roster and from any
//                         order this family has already submitted
// POST /gear?t=<token>  → saves the order and re-renders with a confirmation
//
// Replaces the Google Form. The three fields that ruin an order — last-name
// spelling, jersey number, team — come pre-filled from our own roster, so the
// parent confirms instead of transcribing a paper worksheet, and anything they
// change is visible to us as a change rather than as a mystery.
//
// Deliberately NOT part of the React app: the app is behind a login, and this
// has to open from an email on a phone with no account and no install.
//
// Sizes are validated against the same lists the form offers, so the order that
// reaches the vendor can't contain a value nobody sells.
//
// Product photos are optional files under public/gear/<key>.png. A missing one
// removes itself rather than showing a broken image, so the form works before
// the photos are dropped in.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Every team that orders gear, in roster order (oldest first) so a parent scans
// down to their age group the way the club talks about them.
export const TEAMS = [
  "16 Diamond",
  "15 Diamond", "15 Ruby", "15 Sapphire", "15 Emerald",
  "14 Diamond", "14 Ruby", "14 Sapphire", "14 Emerald", "14 Topaz",
  "13 Diamond", "13 Ruby", "13 Sapphire", "13 Emerald",
  "12 Diamond", "12 Ruby",
  "11 Diamond",
];

const SIZES_JERSEY  = ["Youth M", "Youth L", "XXXS", "XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];
const SIZES_TEE     = ["Youth M", "Youth L", "Youth XL", "Adult S", "Adult M", "Adult L", "Adult XL"];
const SIZES_APPAREL = ["XS", "S", "M", "L", "XL", "XXL"];
const SPANDEX_LEN   = ['3"', '4"', '5"'];
const KNEEPADS      = ["XS/S", "M/L", "XL"];
const SOCKS         = ["M (shoe size 5-10)", "L (shoe size 10-13)"];
const SLEEVES       = ["Youth", "Adult S", "Adult M", "Adult L"];
const SHOES         = ["5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5",
                       "10", "10.5", "11", "11.5", "12", "12.5", "13"];

// One list drives the form, the validation, and the saved row, so a new item is
// a single edit and can't be added to the page without being saved.
const ITEMS = [
  { key: "jersey_size",       label: "Sleeveless Jersey",        img: "jersey",       opts: SIZES_JERSEY },
  { key: "warmup_tee_size",   label: "Long Sleeve Warm-Up Tee",  img: "warmup-tee",   opts: SIZES_JERSEY },
  { key: "practice_tee_size", label: "Practice T-shirt",         img: "practice-tee", opts: SIZES_TEE },
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

  if (!UUID_RE.test(token)) return res.status(400).send(notFound("That link is missing its code, or it was cut in half by the email app."));

  const { data: player } = await supabase
    .from("players").select("id,first_name,last_name,team_assignment,jersey_number")
    .eq("gear_form_token", token).maybeSingle();
  if (!player) return res.status(404).send(notFound("We can't find that link. It may have been re-issued."));

  const { data: prev } = await supabase
    .from("player_gear_orders").select("*").eq("player_id", player.id).maybeSingle();

  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") body = Object.fromEntries(new URLSearchParams(body));

    // Only ever store a value the form itself offered. A size nobody sells is
    // worse than a blank: blanks get chased, junk gets ordered.
    const pick = (key, opts) => {
      const v = String(body?.[key] || "").trim();
      return opts.includes(v) ? v : null;
    };
    const row = {
      player_id: player.id,
      first_name: String(body?.first_name || "").trim().slice(0, 80) || null,
      last_name: String(body?.last_name || "").trim().slice(0, 80) || null,
      jersey_number: String(body?.jersey_number || "").trim().slice(0, 10) || null,
      team_name: pick("team_name", TEAMS),
      worksheet_confirmed: !!body?.worksheet_confirmed,
      shoe_invoice_ack: !!body?.shoe_invoice_ack,
      notes: String(body?.notes || "").trim().slice(0, 2000) || null,
      // A family filling in their own order clears any correction we made on
      // their behalf — from here on the row is theirs.
      edited_by: null,
      edited_at: null,
    };
    for (const it of ITEMS) row[it.key] = pick(it.key, it.opts);

    const missing = [];
    if (!row.first_name) missing.push("player first name");
    if (!row.last_name) missing.push("player last name");
    if (!row.jersey_number) missing.push("jersey number");
    if (!row.team_name) missing.push("team");
    for (const it of ITEMS) if (!row[it.key]) missing.push(it.label.toLowerCase());
    if (!row.worksheet_confirmed) missing.push("the confirmation box");

    if (missing.length) {
      return res.status(200).send(renderForm(player, { ...prev, ...row }, {
        error: "Still needs: " + missing.join(", ") + ".",
      }));
    }

    const { error } = await supabase.from("player_gear_orders")
      .upsert(row, { onConflict: "player_id" });
    if (error) {
      return res.status(500).send(page(`
        <span class="eyebrow">DS Elite Volleyball</span><h1>Didn't save</h1>
        <div class="card"><div class="err">Something went wrong saving that order. Please try again, or reply to the email and we'll take it down by hand.</div></div>`));
    }

    const recap = [
      ["Player", (row.first_name || "") + " " + (row.last_name || "")],
      ["Jersey number", row.jersey_number],
      ["Team", row.team_name],
      ...ITEMS.map(it => [it.label, row[it.key]]),
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

  return res.status(200).send(renderForm(player, prev || {}, {}));
}

function renderForm(player, v, { error } = {}) {
  const sel = (val, cur) => val === cur ? " selected" : "";
  const has = (k) => v && v[k] != null && v[k] !== "";
  // Roster values are the default; anything the family already submitted wins,
  // because they were looking at the worksheet and we were not.
  const firstName = has("first_name") ? v.first_name : (player.first_name || "");
  const lastName = has("last_name") ? v.last_name : (player.last_name || "");
  const jersey = has("jersey_number") ? v.jersey_number
    : (player.jersey_number == null ? "" : String(player.jersey_number));
  const team = has("team_name") ? v.team_name : (player.team_assignment || "");
  const submitted = !!v.updated_at;

  const itemHtml = (it) => `
    <div class="item">
      <div class="pic"><img src="/gear/${it.img}.png" alt="" loading="lazy" onerror="this.parentNode.remove()"></div>
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
  <p class="sub">For <b style="color:var(--ink)">${esc(player.first_name)} ${esc(player.last_name)}</b>${player.team_assignment ? " · " + esc(player.team_assignment) : ""}.
  ${submitted
    ? `<span style="color:var(--gold)">You've already sent this in — this is your saved order. Change anything and send it again.</span>`
    : "Use the worksheet you were given at try-ons."}</p>

  <form method="POST" id="f">
    ${error ? `<div class="err">${esc(error)}</div>` : ""}

    <div class="card">
      <p class="sect">Check these three against your worksheet</p>
      <div class="note">
        We order from exactly what's below, so it has to match your worksheet:
        <ul>
          <li>spelling of the player's last name</li>
          <li>jersey number</li>
          <li>team</li>
        </ul>
      </div>
      <div style="height:16px"></div>
      <label><span class="lb">Player first name <span class="req">*</span></span>
        <input type="text" name="first_name" value="${esc(firstName)}" required autocomplete="off"></label>
      <label><span class="lb">Player last name <span class="req">*</span></span>
        <input type="text" name="last_name" value="${esc(lastName)}" required autocomplete="off"></label>
      <label><span class="lb">Assigned jersey number <span class="req">*</span></span>
        <input type="text" name="jersey_number" value="${esc(jersey)}" required inputmode="numeric" autocomplete="off"></label>
      <label><span class="lb">Team <span class="req">*</span></span>
        <select name="team_name" required>
          <option value="">— choose —</option>
          ${TEAMS.map(t => `<option${sel(t, team)}>${esc(t)}</option>`).join("")}
        </select></label>
      <label class="chk" style="margin-bottom:0">
        <input type="checkbox" name="worksheet_confirmed" value="1" required${v.worksheet_confirmed ? " checked" : ""}>
        <span>I've checked the last name spelling, jersey number, and team above against our worksheet. <span class="req">*</span></span>
      </label>
    </div>

    <div class="card">
      <p class="sect">Sizes</p>
      ${ITEMS.map(itemHtml).join("")}
      <label class="chk" style="margin-bottom:0">
        <input type="checkbox" name="shoe_invoice_ack" value="1"${v.shoe_invoice_ack ? " checked" : ""}>
        <span>I understand shoes are ordered as a group at a discount and will be invoiced separately by email.</span>
      </label>
    </div>

    <div class="card">
      <p class="sect">Anything else</p>
      <label style="margin-bottom:0"><span class="lb">Notes <span style="text-transform:none;letter-spacing:0">(optional)</span></span>
        <textarea name="notes" placeholder="Between sizes, an old injury, anything we should know before ordering.">${esc(v.notes)}</textarea></label>
    </div>

    <button class="go" type="submit">${submitted ? "Update our order" : "Send our order"}</button>
    <p class="hint" style="text-align:center">All gear is provided by DS Elite except shoes.</p>
  </form>
  <div class="foot">Questions? Coach Kristen — kristen@dselitevolleyball.com</div>`,
  { title: player.first_name + " — gear order — DS Elite" });
}
