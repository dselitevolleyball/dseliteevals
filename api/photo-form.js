// Vercel serverless function: the family photo upload page.
//
// GET  /photos?t=<token>                 → the page for that family
// POST /photos?t=<token>&action=sign     → signed upload URLs for a batch
// POST /photos?t=<token>&action=record   → records the files that landed
//
// Families take the good photos. They currently arrive as texts to a coach and
// in group chats nobody can search a month later, so the club has no library.
// This is a link a parent bookmarks once and opens from the stands.
//
// THE FILES DO NOT PASS THROUGH HERE. Vercel caps a request body at 4.5MB and
// an iPhone photo is routinely bigger, so the browser uploads straight to
// Supabase Storage on a short-lived signed URL that this endpoint mints. We
// only ever handle the metadata, which is small.
//
// Everything hangs off the event. A photo tagged with a team and a tournament
// can be found by either; a folder of IMG_4471.HEIC cannot be found at all. The
// tournament comes from that team's own schedule as a dropdown, so twelve
// families can't produce nine spellings of the same weekend.
//
// GET /photos?preview=1 renders the page with no family and no uploading.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";

const BUCKET = "team-photos";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTEXTS = ["tournament", "practice", "team_event", "other"];
const MAX_BYTES = 26214400;                 // matches the bucket's own limit
const MAX_PER_BATCH = 40;

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "misc";
const fmtDate = (iso) => {
  try { return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); }
  catch { return iso; }
};

const page = (inner, { title = "Send us your photos — DS Elite" } = {}) => `<!doctype html>
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
  input[type=text], input[type=date], select, textarea {
    width:100%; padding:13px; font:inherit; font-size:17px; color:var(--ink);
    background:#151312; border:1px solid var(--rule); border-radius:10px; }
  input:focus, select:focus, textarea:focus, button:focus-visible {
    outline:2px solid var(--gold); outline-offset:1px; }
  textarea { min-height:64px; resize:vertical; }
  .hint { color:var(--mut); font-size:.83rem; margin:6px 0 0; }
  .seg { display:flex; flex-direction:column; gap:9px; }
  .seg button { width:100%; text-align:left; padding:14px 15px; font:inherit; font-weight:700; font-size:15px;
    cursor:pointer; background:transparent; color:var(--body); border:1px solid var(--rule); border-radius:10px; }
  .seg button small { display:block; font-weight:400; font-size:.79rem; color:var(--mut); margin-top:2px; }
  .seg button[aria-pressed="true"] { background:rgba(224,180,85,.16); border-color:var(--gold); color:var(--gold); }
  .seg button[aria-pressed="true"] small { color:var(--gold); opacity:.8; }
  .hide { display:none; }
  /* The picker is the whole point on a phone: one big target that opens the
     photo library, and it must not look like a form field. */
  .drop { border:2px dashed var(--rule); border-radius:14px; padding:26px 18px; text-align:center;
    cursor:pointer; background:#151312; }
  .drop:hover, .drop.over { border-color:var(--gold); background:rgba(224,180,85,.06); }
  .drop b { display:block; color:var(--ink); font-size:1.05rem; margin-bottom:4px; }
  .drop span { color:var(--mut); font-size:.86rem; }
  #file { display:none; }
  .files { display:flex; flex-direction:column; gap:7px; margin-top:14px; }
  .f { display:flex; gap:10px; align-items:center; padding:8px 10px; border:1px solid var(--rule);
       border-radius:9px; background:#151312; }
  .f .thumb { flex:0 0 40px; width:40px; height:40px; border-radius:6px; object-fit:cover; background:#221f1d; }
  .f .meta { flex:1; min-width:0; }
  .f .nm { color:var(--ink); font-size:.86rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .f .st { font-size:.76rem; color:var(--mut); }
  .f .st.ok  { color:var(--grn); }
  .f .st.bad { color:var(--err); }
  .f .x { background:none; border:none; color:var(--mut); font-size:19px; cursor:pointer; line-height:1; padding:0 4px; }
  .bar { height:3px; background:var(--rule); border-radius:2px; overflow:hidden; margin-top:4px; }
  .bar i { display:block; height:100%; width:0; background:var(--gold); transition:width .2s; }
  button.go { width:100%; padding:16px; font:inherit; font-weight:800; font-size:17px; cursor:pointer;
    background:var(--gold); color:#1a1613; border:none; border-radius:11px; margin-top:6px; }
  button.go[disabled] { background:var(--rule); color:var(--mut); cursor:default; }
  .ok { border-left:3px solid var(--grn); background:rgba(74,222,128,.09); padding:14px 16px; border-radius:0 8px 8px 0; }
  .ok b { color:var(--grn); }
  .err { border-left:3px solid var(--err); background:rgba(248,113,113,.09); padding:14px 16px;
         border-radius:0 8px 8px 0; margin-bottom:16px; }
  .note { border-left:3px solid var(--gold); background:rgba(224,180,85,.08); padding:13px 15px;
          border-radius:0 8px 8px 0; font-size:.9rem; }
  .foot { margin-top:20px; color:var(--mut); font-size:.82rem; text-align:center; }
</style></head><body><div class="wrap">${inner}</div></body></html>`;

const notFound = (msg) => page(`
  <span class="eyebrow">DS Elite Volleyball</span>
  <h1>Link not found</h1>
  <div class="card"><div class="err">${esc(msg)}</div>
  <p style="margin:16px 0 0;font-size:.9rem;color:var(--mut)">Reply to the email you received and we'll send a fresh link.</p></div>
`, { title: "Link not found — DS Elite" });

const json = (res, code, obj) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(code).send(JSON.stringify(obj));
};

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).send("Server not configured");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const q = req.query || {};
  const token = String(q.t || "").trim();
  const action = String(q.action || "").trim();
  const isPreview = String(q.preview || "") === "1";

  if (!action) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex");
  }

  if (isPreview) {
    return res.status(200).send(renderForm(
      { first_name: "", last_name: "", team_assignment: "14 Sample" },
      [{ id: 0, name: "Sample Tournament", start_date: "2027-01-09", location: "San Antonio, TX" }],
      { preview: true }));
  }

  if (!UUID_RE.test(token)) return res.status(400).send(notFound("That link is missing its code, or it was cut in half by the email app."));

  const { data: player } = await supabase
    .from("players").select("id,first_name,last_name,team_assignment")
    .eq("photo_upload_token", token).maybeSingle();
  if (!player) return res.status(404).send(notFound("We can't find that link. It may have been re-issued."));

  // That team's own schedule, so the dropdown offers the weekends she is
  // actually at rather than every tournament the club enters.
  const { data: assigns } = await supabase.from("tournament_assignments")
    .select("tournament_id").eq("team_id", player.team_assignment || "");
  const ids = (assigns || []).map(a => a.tournament_id).filter(Boolean);
  let tournaments = [];
  if (ids.length) {
    const { data: t } = await supabase.from("tournaments")
      .select("id,name,start_date,end_date,location,cancelled").in("id", ids);
    tournaments = (t || []).filter(x => !x.cancelled)
      .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
  }

  // ── Mint signed upload URLs ───────────────────────────────────────────────
  if (req.method === "POST" && action === "sign") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
    const files = Array.isArray(body?.files) ? body.files.slice(0, MAX_PER_BATCH) : [];
    if (!files.length) return json(res, 400, { error: "No files listed." });

    const evt = eventFrom(body, tournaments);
    const folder = [slug(player.team_assignment || "no-team"), evt.folder].join("/");
    const out = [];
    for (const f of files) {
      const size = Number(f?.size) || 0;
      if (size > MAX_BYTES) { out.push({ name: f?.name, error: "bigger than 25MB" }); continue; }
      const ext = (String(f?.name || "").match(/\.([a-z0-9]{1,5})$/i) || [, "jpg"])[1].toLowerCase();
      // A random name, not the family's. Two phones both produce IMG_0001.
      const path = `${folder}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error) { out.push({ name: f?.name, error: error.message }); continue; }
      out.push({ name: f?.name, path, signedUrl: data.signedUrl, token: data.token });
    }
    return json(res, 200, { ok: true, files: out });
  }

  // ── Record what landed ────────────────────────────────────────────────────
  if (req.method === "POST" && action === "record") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
    const photos = Array.isArray(body?.photos) ? body.photos.slice(0, MAX_PER_BATCH) : [];
    if (!photos.length) return json(res, 400, { error: "Nothing to record." });

    const evt = eventFrom(body, tournaments);
    const rows = photos.map(p => ({
      storage_path: String(p?.path || "").slice(0, 400),
      player_id: player.id,
      team_name: player.team_assignment || null,
      uploaded_by: String(body?.uploaded_by || "").trim().slice(0, 120) || null,
      context: evt.context,
      tournament_id: evt.tournamentId,
      event_label: evt.label,
      taken_on: /^\d{4}-\d{2}-\d{2}$/.test(String(body?.taken_on || "")) ? body.taken_on : null,
      caption: String(body?.caption || "").trim().slice(0, 500) || null,
      original_name: String(p?.name || "").slice(0, 200) || null,
      content_type: String(p?.type || "").slice(0, 100) || null,
      size_bytes: Number(p?.size) || null,
    })).filter(r => r.storage_path);

    const { error } = await supabase.from("player_photos").upsert(rows, { onConflict: "storage_path" });
    if (error) return json(res, 500, { error: error.message });
    return json(res, 200, { ok: true, saved: rows.length });
  }

  return res.status(200).send(renderForm(player, tournaments, {}));
}

// The event, resolved the same way for both actions so a signed URL and its
// recorded row can never disagree about where the photo is from.
function eventFrom(body, tournaments) {
  const context = CONTEXTS.includes(String(body?.context || "")) ? String(body.context) : "other";
  if (context === "tournament") {
    const id = Number(body?.tournament_id) || null;
    const t = tournaments.find(x => x.id === id);
    if (t) return { context, tournamentId: t.id, label: t.name.trim(), folder: slug(t.name) };
    return { context, tournamentId: null, label: "Tournament", folder: "tournament" };
  }
  const label = context === "practice" ? "Practice" : context === "team_event" ? "Team event" : "Other";
  return { context, tournamentId: null, label, folder: slug(label) };
}

function renderForm(player, tournaments, { preview } = {}) {
  const who = preview ? "your daughter" : `${player.first_name} ${player.last_name}`;
  const opts = tournaments.map(t =>
    `<option value="${t.id}">${esc(t.name.trim())} — ${esc(fmtDate(t.start_date))}${t.location ? ", " + esc(t.location) : ""}</option>`
  ).join("");

  return page(`
  <span class="eyebrow">DS Elite Volleyball</span>
  <h1>Send us your photos</h1>
  <p class="sub">${preview
    ? `<span style="color:var(--gold)">Preview — this is what families see. Nothing here uploads.</span>`
    : `For <b style="color:var(--ink)">${esc(player.team_assignment || "your team")}</b>. Bookmark this page — it's yours for the whole season, and you can come back to it after every tournament.`}</p>

  <div class="card">
    <p class="sect">1 &middot; Where are they from?</p>
    <label style="margin-bottom:14px">
      <div class="seg">
        <button type="button" data-c="tournament" aria-pressed="false">A tournament<small>Pick which one below.</small></button>
        <button type="button" data-c="practice" aria-pressed="false">Practice<small>Any normal training night.</small></button>
        <button type="button" data-c="team_event" aria-pressed="false">A team event<small>Kickoff party, team dinner, fundraiser.</small></button>
        <button type="button" data-c="other" aria-pressed="false">Something else<small>Tell us in the caption.</small></button>
      </div>
    </label>

    <div id="tsel" class="hide">
      <label style="margin-bottom:14px"><span class="lb">Which tournament?</span>
        <select id="tournament">
          <option value="">— choose —</option>
          ${opts || `<option value="" disabled>No tournaments on this team's schedule yet</option>`}
        </select></label>
    </div>

    <label style="margin-bottom:14px"><span class="lb">Date taken <span style="text-transform:none;letter-spacing:0">(optional)</span></span>
      <input type="date" id="taken_on"></label>

    <label style="margin-bottom:0"><span class="lb">Anything worth saying <span style="text-transform:none;letter-spacing:0">(optional)</span></span>
      <textarea id="caption" placeholder="Which match, who's in them, a good one of the whole team…"></textarea></label>
  </div>

  <div class="card">
    <p class="sect">2 &middot; Choose the photos</p>
    <div class="drop" id="drop" role="button" tabindex="0">
      <b>Tap to choose photos</b>
      <span>Pick as many as you like — up to 40 at a time. Videos are fine too.</span>
    </div>
    <input type="file" id="file" multiple accept="image/*,video/*">
    <div class="files" id="list"></div>
    <p class="hint" id="tally"></p>
  </div>

  <div class="card">
    <p class="sect">3 &middot; Who to thank</p>
    <label style="margin-bottom:0"><span class="lb">Your name</span>
      <input type="text" id="uploaded_by" placeholder="So we know who to credit" autocomplete="name"></label>
  </div>

  <button class="go" id="send" disabled>Send photos</button>
  <p class="hint" style="text-align:center" id="status">They upload straight from this device — big files are fine.</p>

  <div class="card" style="margin-top:14px">
    <div class="note">
      Photos are used for DS Elite's own posts and the team's end-of-season video.
      They're stored privately and only staff can see them. If you'd rather your
      daughter wasn't in anything we post, reply to any club email and tell us —
      that's honoured for the whole season.
    </div>
  </div>

  <div class="foot">Questions? Drew — drew@dselitevolleyball.com</div>
  ${preview ? "" : `<script>
  (function () {
    var ctx = null, chosen = [], busy = false;
    var $ = function (id) { return document.getElementById(id); };
    var drop = $('drop'), file = $('file'), list = $('list'), send = $('send'),
        status = $('status'), tally = $('tally'), tsel = $('tsel');

    document.querySelectorAll('.seg button').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.seg button').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true');
        ctx = b.dataset.c;
        tsel.classList.toggle('hide', ctx !== 'tournament');
        refresh();
      });
    });

    drop.addEventListener('click', function () { file.click(); });
    drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
    ['dragenter','dragover'].forEach(function (n) {
      drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave','drop'].forEach(function (n) {
      drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) { add(e.dataTransfer.files); });
    file.addEventListener('change', function () { add(file.files); file.value = ''; });

    var MB = function (n) { return (n / 1048576).toFixed(1) + 'MB'; };

    function add(fl) {
      Array.prototype.forEach.call(fl || [], function (f) {
        if (chosen.length >= 40) return;
        if (chosen.some(function (c) { return c.f.name === f.name && c.f.size === f.size; })) return;
        chosen.push({ f: f, state: 'ready' });
      });
      draw();
    }

    function draw() {
      list.innerHTML = '';
      chosen.forEach(function (c, i) {
        var row = document.createElement('div');
        row.className = 'f';
        var img = document.createElement('img');
        img.className = 'thumb';
        // A thumbnail is how a parent knows they grabbed the right twelve.
        if (/^image\\//.test(c.f.type)) { try { img.src = URL.createObjectURL(c.f); } catch (e) {} }
        var meta = document.createElement('div');
        meta.className = 'meta';
        var nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = c.f.name;
        var st = document.createElement('div'); st.className = 'st' + (c.state === 'done' ? ' ok' : c.state === 'failed' ? ' bad' : '');
        st.textContent = c.state === 'done' ? 'Sent' : c.state === 'failed' ? (c.err || 'Failed') : MB(c.f.size);
        meta.appendChild(nm); meta.appendChild(st);
        if (c.state === 'uploading') {
          var bar = document.createElement('div'); bar.className = 'bar';
          var fill = document.createElement('i'); fill.style.width = (c.pct || 0) + '%';
          bar.appendChild(fill); meta.appendChild(bar);
        }
        row.appendChild(img); row.appendChild(meta);
        if (!busy) {
          var x = document.createElement('button');
          x.className = 'x'; x.type = 'button'; x.textContent = '\\u00d7';
          x.setAttribute('aria-label', 'Remove ' + c.f.name);
          x.addEventListener('click', function () { chosen.splice(i, 1); draw(); });
          row.appendChild(x);
        }
        list.appendChild(row);
      });
      var bytes = chosen.reduce(function (n, c) { return n + c.f.size; }, 0);
      tally.textContent = chosen.length ? (chosen.length + ' selected \\u00b7 ' + MB(bytes)) : '';
      refresh();
    }

    function refresh() {
      var okCtx = !!ctx && (ctx !== 'tournament' || !!$('tournament').value);
      send.disabled = busy || !chosen.length || !okCtx;
      send.textContent = busy ? 'Sending\\u2026'
        : chosen.length ? ('Send ' + chosen.length + ' photo' + (chosen.length === 1 ? '' : 's')) : 'Send photos';
    }
    $('tournament').addEventListener('change', refresh);

    function meta() {
      return {
        context: ctx,
        tournament_id: ctx === 'tournament' ? Number($('tournament').value) || null : null,
        taken_on: $('taken_on').value || null,
        caption: $('caption').value || '',
        uploaded_by: $('uploaded_by').value || '',
      };
    }

    // One PUT per file, straight to storage. XHR rather than fetch purely for
    // upload progress, which is the difference between "is it working?" and a
    // parent closing the tab on a slow connection at a convention centre.
    function put(url, f, onPct) {
      return new Promise(function (resolve, reject) {
        var x = new XMLHttpRequest();
        x.open('PUT', url, true);
        x.setRequestHeader('content-type', f.type || 'application/octet-stream');
        x.upload.onprogress = function (e) { if (e.lengthComputable) onPct(Math.round(e.loaded / e.total * 100)); };
        x.onload = function () { (x.status >= 200 && x.status < 300) ? resolve() : reject(new Error('HTTP ' + x.status)); };
        x.onerror = function () { reject(new Error('network')); };
        x.send(f);
      });
    }

    send.addEventListener('click', async function () {
      if (busy) return;
      var todo = chosen.filter(function (c) { return c.state !== 'done'; });
      if (!todo.length) return;
      busy = true; refresh(); draw();
      status.textContent = 'Getting ready\\u2026';

      var m = meta();
      var body = Object.assign({}, m, { files: todo.map(function (c) {
        return { name: c.f.name, size: c.f.size, type: c.f.type };
      }) });

      var signed;
      try {
        var r = await fetch(window.location.pathname + window.location.search + '&action=sign', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        signed = await r.json();
        if (!r.ok || signed.error) throw new Error(signed.error || 'could not start');
      } catch (e) {
        busy = false; status.textContent = 'Could not start the upload: ' + e.message; refresh(); draw(); return;
      }

      var landed = [];
      for (var i = 0; i < todo.length; i++) {
        var c = todo[i], s = signed.files[i];
        if (!s || !s.signedUrl) { c.state = 'failed'; c.err = (s && s.error) || 'no upload slot'; draw(); continue; }
        c.state = 'uploading'; c.pct = 0; draw();
        status.textContent = 'Sending ' + (i + 1) + ' of ' + todo.length + '\\u2026';
        try {
          await put(s.signedUrl, c.f, function (p) { c.pct = p; draw(); });
          c.state = 'done';
          landed.push({ path: s.path, name: c.f.name, type: c.f.type, size: c.f.size });
        } catch (e) {
          c.state = 'failed'; c.err = 'Did not send — try again';
        }
        draw();
      }

      if (landed.length) {
        try {
          await fetch(window.location.pathname + window.location.search + '&action=record', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({}, m, { photos: landed })) });
        } catch (e) { /* the files are safely stored; the row can be rebuilt */ }
      }

      busy = false;
      var failed = chosen.filter(function (c) { return c.state === 'failed'; }).length;
      status.textContent = landed.length
        ? ('Thank you \\u2014 ' + landed.length + ' sent.' + (failed ? ' ' + failed + " didn't go through, tap Send again to retry those." : ' You can pick more any time.'))
        : 'Nothing went through. Check your signal and try again.';
      refresh(); draw();
    });
  })();
  </script>`}`,
  { title: preview ? "Preview — send us your photos — DS Elite" : who + " — send us your photos — DS Elite" });
}
