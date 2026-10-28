// A coach's "Meet the Coach" survey page for DS Elite Social
// (api/_lib/dse-social.js). Linked from their email / text as
// https://dseliteevals.vercel.app/coach-intro?t=<dse_coach_intros.token>.
//
// GET                        the questions, a photo picker and "OK to share"
// POST &action=sign {files}  signed upload URLs (dse-social: intros/<id>/...)
// POST &action=submit        answers + photos -> status answered
// GET ?preview=1             a sample page, nothing saved
//
// Photos are scaled to an 1800px JPEG on the phone (iPhone HEIC included) and
// PUT straight to Supabase Storage, never through this function. The poster
// is drafted by the cron (within 15 minutes), so the coach isn't kept waiting.

import { createClient } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = "dse-social";
const MAX_PHOTOS = 6;
const LOGO = "https://dseliteevals.vercel.app/logos/ds-elite-white-logo.png";
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const first = (n) => String(n || "").trim().replace(/^coach\s+/i, "").split(/\s+/)[0] || "Coach";
const json = (res, status, body) => res.status(status).setHeader("Content-Type", "application/json").send(JSON.stringify(body));
const html = (res, status, body) => res.status(status).setHeader("Content-Type", "text/html; charset=utf-8").send(body);

const page = (inner) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex"><title>Meet the Coach · DS Elite Volleyball</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@800;900&family=Outfit:wght@400;600;700&display=swap">
<style>
  :root { --bg:#0a0a0a; --card:#141414; --line:#2a2a2a; --pink:#e91e8c; --hot:#ff69b4; --mut:#a3a3a3; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  body { margin:0; background:var(--bg); color:#fff; font-family:Outfit,system-ui,sans-serif; font-size:17px; line-height:1.55; }
  .wrap { max-width:620px; margin:0 auto; padding:22px 16px 72px; }
  .logo { display:block; width:200px; height:auto; margin:4px 0 22px; }
  .tag { display:inline-block; background:var(--pink); color:#fff; font:900 13px/1 Archivo,sans-serif; letter-spacing:1.5px; text-transform:uppercase; padding:7px 11px; transform:skewX(-12deg); }
  h1 { font:900 40px/1 Archivo,Impact,sans-serif; text-transform:uppercase; margin:14px 0 12px; }
  h1 em { font-style:normal; color:var(--pink); }
  .intro { color:var(--mut); margin:0 0 22px; }
  .q { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px; margin:0 0 12px; }
  .q label { display:block; font-weight:700; margin:0 0 8px; }
  textarea, input[type=text] { width:100%; background:var(--bg); color:#fff; border:1px solid var(--line); border-radius:8px; font:inherit; font-size:16px; padding:11px 12px; }
  textarea { min-height:84px; resize:vertical; }
  h2 { font:900 24px/1 Archivo,sans-serif; text-transform:uppercase; margin:28px 0 6px; }
  .hint { color:var(--mut); font-size:15px; margin:0 0 12px; }
  .pick { display:block; width:100%; padding:16px; border:2px dashed var(--pink); border-radius:12px; background:transparent; color:var(--hot); font:800 18px Archivo,sans-serif; text-transform:uppercase; cursor:pointer; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:10px; margin-top:12px; }
  .ph { background:var(--card); border:1px solid var(--line); border-radius:10px; overflow:hidden; position:relative; }
  .ph img { width:100%; aspect-ratio:1; object-fit:cover; display:block; }
  .ph .x { position:absolute; top:6px; right:6px; background:rgba(0,0,0,.75); color:#fff; border:0; border-radius:50%; width:30px; height:30px; font-size:16px; cursor:pointer; }
  .ph .st { position:absolute; left:6px; top:6px; background:rgba(0,0,0,.75); color:var(--hot); font-size:12px; font-weight:700; padding:2px 7px; border-radius:6px; }
  .ok { display:flex; gap:12px; align-items:flex-start; margin:26px 0 18px; font-size:16px; }
  .ok input { width:24px; height:24px; accent-color:var(--pink); flex:none; margin-top:2px; }
  .send { width:100%; padding:16px; background:var(--pink); color:#fff; border:0; border-radius:12px; font:900 22px Archivo,sans-serif; text-transform:uppercase; cursor:pointer; }
  .send:disabled { opacity:.5; cursor:default; }
  .msg { margin-top:12px; font-weight:700; } .msg.err { color:#ff8a7a; } .msg.good { color:var(--hot); }
  .done { background:var(--card); border:1px solid var(--pink); border-radius:14px; padding:20px; }
</style></head><body><div class="wrap">
<img class="logo" src="${LOGO}" alt="DS Elite Volleyball">
${inner}
</div></body></html>`;

function form(intro, preview) {
  const qs = (intro.questions || []).map((x, i) => `<div class="q"><label for="q${i}">${esc(x.q)}</label><textarea id="q${i}" maxlength="1500" placeholder="A sentence or two is perfect">${esc(x.a || "")}</textarea></div>`).join("");
  return page(`<span class="tag">Meet the Coach</span>
<h1>Hey Coach <em>${esc(first(intro.name))}</em>!</h1>
<p class="intro">We're introducing DS Elite's coaches to our families on Instagram and Facebook. Answer whatever you like (short is great) and add a photo or two. We'll turn it into a "Meet the Coach" post, and nothing goes out until it's been checked.</p>
<form id="f" novalidate>
${qs}
<h2>Your photos</h2>
<p class="hint">1 to 3 is perfect: a clear photo of you (this is the one on the poster), you coaching, you as a player. Please no photos with kids in swimwear.</p>
<input id="files" type="file" accept="image/*" multiple hidden>
<button type="button" class="pick" id="pick">+ Add photos</button>
<div class="grid" id="grid"></div>
<label class="ok"><input type="checkbox" id="ok"> <span>It's OK for DS Elite to share my answers and these photos on social media and the website.</span></label>
<button class="send" id="send" type="submit"${preview ? " disabled" : ""}>${preview ? "Preview - nothing is saved" : "Send it"}</button>
<div class="msg" id="msg"></div>
</form>
<script>
(function () {
  var MAX = ${MAX_PHOTOS}, chosen = [], busy = false;
  var grid = document.getElementById("grid"), files = document.getElementById("files"), msg = document.getElementById("msg"), send = document.getElementById("send");
  function say(t, cls) { msg.textContent = t; msg.className = "msg " + (cls || ""); }
  document.getElementById("pick").onclick = function () { files.click(); };
  function shrink(f) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(f), img = new Image();
      img.onload = function () {
        var s = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
        var c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h);
        c.toBlob(function (b) { URL.revokeObjectURL(url); b ? resolve({ blob: b, w: w, h: h }) : reject(new Error("couldn't read")); }, "image/jpeg", 0.88);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("couldn't read " + f.name)); };
      img.src = url;
    });
  }
  function draw() {
    grid.innerHTML = "";
    chosen.forEach(function (c, i) {
      var d = document.createElement("div"); d.className = "ph";
      d.innerHTML = '<img alt=""><button type="button" class="x" aria-label="Remove">×</button>' + (c.state ? '<span class="st">' + c.state + '</span>' : '');
      d.querySelector("img").src = c.preview;
      d.querySelector(".x").onclick = function () { if (!busy) { chosen.splice(i, 1); draw(); } };
      grid.appendChild(d);
    });
    document.getElementById("pick").style.display = chosen.length >= MAX ? "none" : "block";
  }
  files.onchange = async function () {
    var list = Array.prototype.slice.call(files.files || []).slice(0, MAX - chosen.length);
    for (var i = 0; i < list.length; i++) {
      try { var r = await shrink(list[i]); chosen.push({ name: list[i].name, blob: r.blob, w: r.w, h: r.h, preview: URL.createObjectURL(r.blob) }); }
      catch (e) { say("One photo couldn't be read - try a different one.", "err"); }
    }
    files.value = ""; draw();
  };
  function put(url, blob) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest(); x.open("PUT", url, true); x.setRequestHeader("content-type", "image/jpeg");
      x.onload = function () { x.status >= 200 && x.status < 300 ? resolve() : reject(new Error("HTTP " + x.status)); };
      x.onerror = function () { reject(new Error("network")); }; x.send(blob);
    });
  }
  document.getElementById("f").onsubmit = async function (e) {
    e.preventDefault();
    if (busy || ${preview ? "true" : "false"}) return;
    var answers = Array.prototype.map.call(document.querySelectorAll("textarea"), function (t) { return t.value.trim(); });
    if (!answers.some(Boolean)) { say("Answer at least one question.", "err"); return; }
    if (!document.getElementById("ok").checked) { say("Tick the box to say it's OK to share.", "err"); return; }
    busy = true; send.disabled = true;
    try {
      var photos = [];
      if (chosen.length) {
        say("Uploading photos…");
        var r = await fetch(location.pathname + location.search + "&action=sign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: chosen.map(function (c) { return { name: c.name }; }) }) });
        var j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error || "upload slots");
        for (var i = 0; i < chosen.length; i++) {
          var c = chosen[i], s = j.files[i];
          if (!s || !s.signedUrl) { c.state = "failed"; draw(); continue; }
          c.state = "uploading"; draw();
          try { await put(s.signedUrl, c.blob); c.state = "✓"; photos.push({ path: s.path, name: c.name, w: c.w, h: c.h }); }
          catch (err) { c.state = "failed"; }
          draw();
        }
      }
      say("Saving…");
      var r2 = await fetch(location.pathname + location.search + "&action=submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers: answers, photos: photos, consent: true }) });
      var j2 = await r2.json(); if (!r2.ok || !j2.ok) throw new Error(j2.error || "save failed");
      document.querySelector(".wrap").innerHTML = '<img class="logo" src="${LOGO}" alt=""><div class="done"><span class="tag">Got it</span><h1>Thanks, Coach <em>${esc(first(intro.name))}</em>!</h1><p>Your answers' + (photos.length ? " and " + photos.length + " photo" + (photos.length === 1 ? "" : "s") : "") + ' are in. We\\'ll make your "Meet the Coach" post and check it before it goes out.</p></div>';
    } catch (err) { say("Something went wrong: " + err.message + ". Please try again.", "err"); busy = false; send.disabled = false; }
  };
})();
</script>`);
}

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const sb = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  return handleIntroForm(sb, req, res);
}

export async function handleIntroForm(sb, req, res) {
  res.setHeader("Cache-Control", "no-store");
  const url = new URL(req.url, "https://x");
  const t = url.searchParams.get("t") || "", action = url.searchParams.get("action") || "";
  if (url.searchParams.get("preview") === "1" && req.method === "GET") {
    const { DEFAULT_QUESTIONS } = await import("./_lib/dse-social.js");
    return html(res, 200, form({ name: "Tara Fisher", questions: DEFAULT_QUESTIONS.map(q => ({ q })) }, true));
  }
  const gone = (why) => html(res, 404, page(`<h1>Link not found</h1><p class="intro">${why}</p>`));
  if (!UUID_RE.test(t)) return gone("This link isn't right - check the text or email we sent, or reply to it and we'll help.");
  if (!sb) return res.status(500).send("Server not configured");
  const { data: intro } = await sb.from("dse_coach_intros").select("*").eq("token", t).maybeSingle();
  if (!intro || intro.status === "cancelled") return gone("This link isn't active any more. Reply to the email or text and we'll sort it out.");
  const answered = ["answered", "drafted", "posted"].includes(intro.status);
  if (req.method === "GET") {
    if (answered) return html(res, 200, page(`<div class="done"><span class="tag">All set</span><h1>Thanks, Coach <em>${esc(first(intro.name))}</em>!</h1><p>Your answers are in. Want to change something? Reply to our email or text and we'll update it.</p></div>`));
    return html(res, 200, form(intro, false));
  }
  if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return json(res, 405, { ok: false, error: "GET or POST" }); }
  if (answered) return json(res, 409, { ok: false, error: "Your answers are already in - thank you!" });
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }

  if (action === "sign") {
    const files = Array.isArray(body?.files) ? body.files.slice(0, MAX_PHOTOS) : [];
    if (!files.length) return json(res, 400, { ok: false, error: "No photos listed" });
    const out = [];
    for (const f of files) {
      const path = `intros/${intro.id}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.jpg`;
      const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
      out.push(error ? { name: f?.name, error: error.message } : { name: f?.name, path, signedUrl: data.signedUrl });
    }
    return json(res, 200, { ok: true, files: out });
  }
  if (action === "submit") {
    const answers = Array.isArray(body?.answers) ? body.answers.map(a => String(a ?? "").trim().slice(0, 1500)) : [];
    if (!answers.some(Boolean)) return json(res, 400, { ok: false, error: "Answer at least one question" });
    if (body?.consent !== true) return json(res, 400, { ok: false, error: "Tick the box to say it's OK to share" });
    const prefix = `intros/${intro.id}/`;
    const photos = (Array.isArray(body?.photos) ? body.photos : []).filter(p => String(p?.path || "").startsWith(prefix) && /^[\w/.-]+$/.test(p.path)).slice(0, MAX_PHOTOS)
      .map(p => ({ path: p.path, url: sb.storage.from(BUCKET).getPublicUrl(p.path).data.publicUrl, name: String(p.name || "").slice(0, 120), w: Number(p.w) || null, h: Number(p.h) || null }));
    const questions = (intro.questions || []).map((x, i) => ({ q: x.q, a: answers[i] || "" }));
    const { error } = await sb.from("dse_coach_intros").update({ questions, photos, consent: true, status: "answered", answered_at: new Date().toISOString(), error: null }).eq("id", intro.id).in("status", ["draft", "sent"]);
    if (error) return json(res, 500, { ok: false, error: "Couldn't save - please try again" });
    return json(res, 200, { ok: true, photos: photos.length });
  }
  return json(res, 400, { ok: false, error: "Unknown action" });
}
