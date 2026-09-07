// Vercel serverless function: the orientation-night commitment.
//
// GET  /commitment?t=<token>  → the contract, with both sides' boxes and a
//                               name field each; shows what's already signed
// POST /commitment?t=<token>  → records one side's signature and re-renders
// GET  /commitment?preview=1  → the page with a sample player and no saving,
//                               so staff can see it without signing for a family
//
// Deliberately NOT part of the React app. This opens on a phone in a gym while
// Drew is on slide 24, from an email, with no login and nothing to install.
//
// The token is a per-player uuid, so the URL cannot be walked to another
// family's form by editing a number. It grants exactly one thing: signing for
// that player.
//
// TWO SIGNATURES, TAKEN SEPARATELY
//
// The player and the parent agree to different things and sign in their own
// names, so each side is its own form post. Either can go first, and one can be
// done on a phone in the gym and the other later at home on the same link. Only
// when both are in does the player card read "commitment signed".
//
// Every box on a side must be ticked before that side saves. A half-ticked
// commitment is a family who stopped reading, and filing it as agreement would
// make the whole exercise decorative. The clause wording and the completeness
// rule both live in shared/commitment.js, which the app reads too.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";
import {
  PLAYER_CLAUSES, PARENT_CLAUSES, ALL_KEYS, VERSION, SEASON, isComplete, pointCount,
} from "../shared/commitment.js";

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

const page = (inner, { title = "The commitment — DS Elite" } = {}) => `<!doctype html>
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
  .card + .card { margin-top:14px; }
  .sect { font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:var(--gold);
          font-weight:700; margin:0 0 4px; }
  .sect-sub { color:var(--mut); font-size:.88rem; margin:0 0 16px; }
  /* One clause = one tap target. Thumb-sized, because this gets signed
     standing up in a gym with the lights down. */
  .cl { display:flex; gap:12px; align-items:flex-start; padding:13px 13px; margin-bottom:10px;
        border:1px solid var(--rule); border-radius:11px; cursor:pointer; }
  .cl:has(input:checked) { border-color:var(--gold); background:rgba(224,180,85,.07); }
  .cl input { flex:0 0 24px; width:24px; height:24px; margin:2px 0 0; accent-color:var(--gold); }
  .cl .t { display:block; color:var(--ink); font-weight:700; font-size:15.5px; line-height:1.35; }
  .cl .d { display:block; color:var(--body); font-size:.9rem; margin-top:5px; }
  /* One box covers several specific actions, so they're listed rather than run
     together as prose — a family scanning this in a gym has to be able to see
     each thing they're agreeing to. */
  .cl .pts { margin:7px 0 0; padding-left:18px; color:var(--body); font-size:.89rem; }
  .cl .pts li { margin:0 0 6px; line-height:1.42; }
  .cl .pts li:last-child { margin-bottom:0; }
  .cl:has(input:checked) .t { color:var(--gold); }
  label.nm { display:block; margin:18px 0 0; }
  .lb { display:block; font-size:12px; letter-spacing:.09em; text-transform:uppercase;
        color:var(--mut); font-weight:700; margin-bottom:7px; }
  .lb .req { color:var(--pink); }
  input[type=text] { width:100%; padding:14px 13px; font:inherit; font-size:17px; color:var(--ink);
    background:#151312; border:1px solid var(--rule); border-radius:10px; }
  input[type=text]:focus { outline:2px solid var(--gold); outline-offset:1px; border-color:var(--gold); }
  .hint { color:var(--mut); font-size:.83rem; margin:7px 0 0; }
  button.go { width:100%; padding:16px; font:inherit; font-weight:800; font-size:17px; cursor:pointer;
    background:var(--gold); color:#1a1613; border:none; border-radius:11px; margin-top:16px; }
  button.go[disabled] { opacity:.4; cursor:not-allowed; }
  .tick { display:flex; gap:10px; align-items:center; padding:14px 15px; border-radius:11px;
          border:1px solid rgba(74,222,128,.35); background:rgba(74,222,128,.08); }
  .tick .k { color:var(--grn); font-weight:800; font-size:20px; line-height:1; }
  .tick b { color:var(--grn); }
  .tick small { display:block; color:var(--mut); font-size:.84rem; margin-top:2px; }
  .err { border-left:3px solid var(--err); background:rgba(248,113,113,.09); padding:14px 16px;
         border-radius:0 8px 8px 0; margin-bottom:16px; }
  .note { border-left:3px solid var(--gold); background:rgba(224,180,85,.08); padding:13px 15px;
          border-radius:0 8px 8px 0; font-size:.9rem; margin-bottom:18px; }
  .note b { color:var(--gold); }
  .foot { margin-top:22px; color:var(--mut); font-size:.82rem; text-align:center; }
  .count { color:var(--mut); font-size:.85rem; text-align:center; margin-top:10px; }
  .count b { color:var(--gold); }
</style></head><body><div class="wrap">${inner}</div></body></html>`;

const notFound = (msg) => page(`
  <span class="eyebrow">DS Elite Volleyball</span>
  <h1>Link not found</h1>
  <div class="card"><div class="err">${esc(msg)}</div>
  <p style="margin:16px 0 0;font-size:.9rem;color:var(--mut)">Find Drew before you leave tonight and we'll get you a fresh link.</p></div>
`, { title: "Link not found — DS Elite" });

const SAMPLE = { id: -1, first_name: "Sample", last_name: "Player", team_assignment: "14 Diamond", parent_name: "A Parent" };

// One side of the contract: its clauses, a name field, and a button that stays
// disabled until every box is ticked.
function sideForm(side, clauses, player, signed, preview) {
  const who = side === "player" ? "Player" : "Parent or guardian";
  const heading = side === "player"
    ? `${esc(player.first_name)}, this is your half`
    : "The parent's half";
  const blurb = side === "player"
    ? "Each box covers the specific things listed under it. Read them, and tick the box only if you mean all of them — this is what your coaches and your teammates will hold you to all season."
    : "Each box covers the specific things listed under it. Read them together with your daughter, and if there is a single line you can't commit to, come talk to Drew instead of signing around it.";

  if (signed?.at) {
    return `<div class="card">
      <p class="sect">${esc(who)}</p>
      <div class="tick"><span class="k">&#10003;</span><span>
        <b>Signed by ${esc(signed.name)}</b>
        <small>${esc(fmtWhen(signed.at))} · all ${pointCount(clauses)} commitments agreed</small>
      </span></div>
    </div>`;
  }

  return `<form method="POST" class="card" data-side="${side}">
    <input type="hidden" name="side" value="${side}">
    <p class="sect">${esc(who)}</p>
    <p style="margin:0 0 4px;color:var(--ink);font-weight:700;font-size:1.05rem">${heading}</p>
    <p class="sect-sub">${blurb}</p>
    ${clauses.map((c) => `
      <label class="cl">
        <input type="checkbox" name="k_${c.key}" value="1">
        <span><span class="t">${esc(c.title)}</span>
          <ul class="pts">${c.points.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
        </span>
      </label>`).join("")}
    <label class="nm"><span class="lb">${side === "player" ? "Player" : "Parent"} full name <span class="req">*</span></span>
      <input type="text" name="name" autocomplete="${side === "player" ? "off" : "name"}"
             placeholder="Type your full name" ${preview ? "disabled" : ""}></label>
    <p class="hint">Typing your name here is your signature. We record the date and time with it.</p>
    <button class="go" type="submit" disabled>Sign — all ${clauses.length} boxes first</button>
    <p class="count"><b class="n">0</b> of ${clauses.length} ticked</p>
  </form>`;
}

const script = `
document.querySelectorAll('form[data-side]').forEach(function (f) {
  var boxes = f.querySelectorAll('input[type=checkbox]');
  var name = f.querySelector('input[name=name]');
  var btn = f.querySelector('button.go');
  var n = f.querySelector('.n');
  var total = boxes.length;
  function sync() {
    var done = 0;
    boxes.forEach(function (b) { if (b.checked) done++; });
    n.textContent = done;
    var ready = done === total && name.value.trim().length > 1;
    btn.disabled = !ready;
    // The button says what is still missing, so nobody taps a dead button and
    // wonders what is wrong with the page.
    btn.textContent = done < total
      ? ('Sign — ' + (total - done) + ' box' + (total - done === 1 ? '' : 'es') + ' left')
      : (ready ? 'Sign the commitment' : 'Type your full name to sign');
  }
  boxes.forEach(function (b) { b.addEventListener('change', sync); });
  name.addEventListener('input', sync);
  sync();
});`;

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

  let player = SAMPLE, prev = null;
  if (!preview) {
    if (!UUID_RE.test(token)) return res.status(404).send(notFound("That link is missing its code."));
    const { data } = await supabase.from("players")
      .select("id, first_name, last_name, team_assignment, parent_name, parent2_name")
      .eq("commitment_token", token).maybeSingle();
    if (!data) return res.status(404).send(notFound("We can't find that link. It may have been re-issued."));
    player = data;
    const { data: row } = await supabase.from("player_commitments")
      .select("*").eq("player_id", player.id).maybeSingle();
    prev = row;
  }

  if (req.method === "POST" && !preview) {
    let body = req.body;
    if (typeof body === "string") body = Object.fromEntries(new URLSearchParams(body));
    const side = body?.side === "parent" ? "parent" : "player";
    const keys = ALL_KEYS[side];
    const items = Object.fromEntries(keys.map((k) => [k, body?.["k_" + k] === "1"]));
    const name = String(body?.name || "").trim().slice(0, 120);

    // Server-side gate. The button is disabled in the browser too, but the
    // browser is not where this gets decided.
    if (!isComplete(items, side) || name.length < 2) {
      return res.status(400).send(page(`
        <span class="eyebrow">DS Elite Volleyball</span><h1>Not quite</h1>
        <div class="card"><div class="err">${name.length < 2
          ? "We need a full name to record the signature."
          : "Every box has to be ticked before this can be signed. If there's one you can't agree to, come talk to Drew rather than signing around it."}</div>
        <p style="margin:16px 0 0"><a href="?t=${esc(token)}" style="color:var(--gold)">Back to the commitment</a></p></div>`,
        { title: "Not quite — DS Elite" }));
    }

    const now = new Date().toISOString();
    const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || null;
    const row = {
      player_id: player.id, season: SEASON, version: VERSION,
      signed_ip: ip, signed_user_agent: String(req.headers["user-agent"] || "").slice(0, 400),
      updated_at: now,
      ...(side === "player"
        ? { player_name: name, player_signed_at: now, player_items: items }
        : { parent_name: name, parent_signed_at: now, parent_items: items }),
    };
    const { error } = await supabase.from("player_commitments")
      .upsert(row, { onConflict: "player_id" });
    if (error) {
      return res.status(500).send(page(`
        <span class="eyebrow">DS Elite Volleyball</span><h1>Didn't save</h1>
        <div class="card"><div class="err">Something went wrong saving that. Try again, or find Drew before you leave.</div></div>`));
    }
    // Re-read so the page shows both sides truthfully, including one the other
    // parent may have signed on their own phone thirty seconds ago.
    const { data: fresh } = await supabase.from("player_commitments")
      .select("*").eq("player_id", player.id).maybeSingle();
    prev = fresh;
  }

  const pSigned = prev?.player_signed_at ? { name: prev.player_name, at: prev.player_signed_at } : null;
  const gSigned = prev?.parent_signed_at ? { name: prev.parent_name, at: prev.parent_signed_at } : null;
  const both = pSigned && gSigned;

  return res.status(200).send(page(`
    <span class="eyebrow">DS Elite Volleyball · ${esc(SEASON)}</span>
    <h1>The commitment</h1>
    <p class="sub">For <b style="color:var(--ink)">${esc(player.first_name)} ${esc(player.last_name)}</b>${
      player.team_assignment ? " · " + esc(player.team_assignment) : ""}${
      preview ? ' <span style="color:var(--gold)">· preview, nothing saves</span>' : ""}</p>

    ${both ? `<div class="card"><div class="tick"><span class="k">&#10003;</span><span>
        <b>You're all set.</b>
        <small>Both signatures are in. You can close this page.</small>
      </span></div></div>` : `<div class="note">
        <b>Nothing in here is new.</b> Every line comes from tonight's meeting. Read it together,
        and if there's something you can't commit to, come talk to Drew instead of signing it.
      </div>`}

    ${sideForm("player", PLAYER_CLAUSES, player, pSigned, preview)}
    ${sideForm("parent", PARENT_CLAUSES, player, gSigned, preview)}

    <div class="foot">DS Elite Volleyball · ${esc(SEASON)} · v${esc(VERSION)}<br>
      Signed ${esc(String(player.first_name))}'s but need to change something? Find Drew or reply to the email.</div>
    <script>${script}</script>`,
    { title: player.first_name + " — the commitment — DS Elite" }));
}
