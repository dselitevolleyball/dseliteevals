// The coach's "Meet the Coaches" interview page (api/_lib/marketing-spotlight.js).
//
// GET  /api/spotlight-form?t=<mkt_spotlights.token>              → the questions, photo picker, OK to share
// POST /api/spotlight-form?t=<token>&action=sign {files:[{name}]} → signed upload URLs (spotlights/<id>/…)
// POST /api/spotlight-form?t=<token>&action=submit               → saves answers + photos, status answered
// GET  /api/spotlight-form?preview=1                             → a sample page, nothing saved
//
// Linked from the coach's email and text as www.drippingsportsclub.com/hq/api/spotlight-form
// (the club site passes /hq/api/* to HQ). Photos are scaled to a 1800px JPEG
// in the browser (iPhone HEIC included) and PUT straight to Supabase Storage
// on a signed URL - they never pass through this function. The drafts are
// written by the marketing cron (or "Make the drafts" in HQ), so the coach
// isn't kept waiting on Claude.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";
import { addSpotlightPhotos, SERIES } from "./_lib/marketing-spotlight.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = "marketing";
const MAX_PHOTOS = 8;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "Coach";
const json = (res, status, body) => res.status(status).setHeader("Content-Type", "application/json").send(JSON.stringify(body));

const page = (inner, title = `${SERIES} · Dripping Springs Sports Club`) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@800;900&family=Schibsted+Grotesk:wght@400;600;700&display=swap">
<style>
  :root { --ink:#061a18; --bg:#0a2422; --card:#104946; --lime:#B2D049; --orange:#FF7300; --paper:#F4F0E8; --mut:#a9b7b1; --rule:rgba(255,255,255,.14); }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  body { margin:0; background:var(--ink); color:var(--paper); font-family:"Schibsted Grotesk",system-ui,sans-serif; font-size:17px; line-height:1.55; }
  .wrap { max-width:620px; margin:0 auto; padding:22px 16px 72px; }
  .logo { display:block; width:190px; height:auto; margin:4px 0 22px; }
  .tag { display:inline-block; background:var(--lime); color:var(--ink); font:800 13px/1 "Barlow Condensed",sans-serif; letter-spacing:2px; text-transform:uppercase; padding:6px 10px; transform:skewX(-12deg); }
  h1 { font:900 46px/.95 "Barlow Condensed",Impact,sans-serif; text-transform:uppercase; margin:14px 0 12px; }
  h1 em { font-style:normal; color:var(--lime); }
  .intro { color:var(--mut); margin:0 0 22px; }
  .q { background:var(--bg); border:1px solid var(--rule); padding:14px; margin:0 0 12px; }
  .q label { display:block; font-weight:700; margin:0 0 8px; }
  textarea, input[type=text] { width:100%; background:var(--ink); color:var(--paper); border:1px solid var(--rule); font:inherit; font-size:16px; padding:11px 12px; border-radius:0; }
  textarea { min-height:84px; resize:vertical; }
  h2 { font:900 28px/1 "Barlow Condensed",sans-serif; text-transform:uppercase; margin:28px 0 6px; }
  .hint { color:var(--mut); font-size:15px; margin:0 0 12px; }
  .pick { display:block; width:100%; padding:16px; border:2px dashed var(--lime); background:transparent; color:var(--lime); font:800 20px "Barlow Condensed",sans-serif; letter-spacing:1px; text-transform:uppercase; cursor:pointer; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:10px; margin-top:12px; }
  .ph { background:var(--bg); border:1px solid var(--rule); position:relative; }
  .ph img { width:100%; aspect-ratio:1; object-fit:cover; display:block; }
  .ph input { border:0; border-top:1px solid var(--rule); font-size:14px; padding:8px; }
  .ph .x { position:absolute; top:6px; right:6px; background:rgba(6,26,24,.85); color:#fff; border:0; width:30px; height:30px; font-size:16px; cursor:pointer; }
  .ph .st { position:absolute; left:6px; top:6px; background:rgba(6,26,24,.85); color:var(--lime); font-size:12px; font-weight:700; padding:2px 7px; }
  .ok { display:flex; gap:12px; align-items:flex-start; margin:26px 0 18px; font-size:16px; }
  .ok input { width:24px; height:24px; accent-color:var(--lime); flex:none; margin-top:2px; }
  .send { width:100%; padding:16px; background:var(--orange); color:var(--ink); border:0; font:900 24px "Barlow Condensed",sans-serif; letter-spacing:1px; text-transform:uppercase; cursor:pointer; clip-path:polygon(0 0,100% 0,100% 70%,96% 100%,0 100%); }
  .send:disabled { opacity:.5; cursor:default; }
  .msg { margin-top:12px; font-weight:700; } .msg.err { color:#ff9a6b; } .msg.good { color:var(--lime); }
  .done { background:var(--bg); border:1px solid var(--lime); padding:20px; }
</style></head><body><div class="wrap">
<img class="logo" src="https://www.drippingsportsclub.com/brand/logo-light.png" alt="Dripping Springs Sports Club">
${inner}
</div></body></html>`;

function form(sp, preview) {
  const qs = (sp.questions || []).map((x, i) => `<div class="q"><label for="q${i}">${esc(x.q)}</label><textarea id="q${i}" data-i="${i}" maxlength="1500" placeholder="A sentence or two is perfect">${esc(x.a || "")}</textarea></div>`).join("");
  return page(`<span class="tag">${esc(SERIES)}</span>
<h1>Hey <em>${esc(first(sp.name))}</em>, you're up!</h1>
<p class="intro">${esc(sp.intro || "")}</p>
<form id="f" novalidate>
${qs}
<h2>Fun photos</h2>
<p class="hint">2 to 5 is perfect: you in action, you as a young athlete, your team, anything that shows your personality. Add a caption if there's a story.</p>
<input id="files" type="file" accept="image/*" multiple hidden>
<button type="button" class="pick" id="pick">+ Add photos</button>
<div class="grid" id="grid"></div>
<label class="ok"><input type="checkbox" id="ok"> <span>It's OK for DSSC to share my answers and these photos on social media, in emails and on the website. (A director reviews everything first.)</span></label>
<button class="send" id="send" type="submit"${preview ? " disabled" : ""}>${preview ? "Preview - nothing is saved" : "Send it"}</button>
<div class="msg" id="msg"></div>
</form>
<script>
(function () {
  var MAX = ${MAX_PHOTOS}, chosen = [], busy = false;
  var grid = document.getElementById("grid"), files = document.getElementById("files"), msg = document.getElementById("msg"), send = document.getElementById("send");
  function say(t, cls) { msg.textContent = t; msg.className = "msg " + (cls || ""); }
  document.getElementById("pick").onclick = function () { files.click(); };
  // Scale to an 1800px JPEG in the browser (HEIC from an iPhone included).
  function shrink(f) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(f), img = new Image();
      img.onload = function () {
        var s = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
        var c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h);
        c.toBlob(function (b) { URL.revokeObjectURL(url); b ? resolve({ blob: b, w: w, h: h }) : reject(new Error("couldn't read")); }, "image/jpeg", 0.86);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("couldn't read " + f.name)); };
      img.src = url;
    });
  }
  function draw() {
    grid.innerHTML = "";
    chosen.forEach(function (c, i) {
      var d = document.createElement("div"); d.className = "ph";
      d.innerHTML = '<img alt=""><button type="button" class="x" aria-label="Remove">×</button>' + (c.state ? '<span class="st">' + c.state + '</span>' : '') + '<input type="text" placeholder="Caption (optional)" maxlength="200">';
      d.querySelector("img").src = c.preview;
      var cap = d.querySelector("input"); cap.value = c.caption || ""; cap.oninput = function () { c.caption = cap.value; };
      d.querySelector(".x").onclick = function () { if (!busy) { chosen.splice(i, 1); draw(); } };
      grid.appendChild(d);
    });
    document.getElementById("pick").style.display = chosen.length >= MAX ? "none" : "block";
  }
  files.onchange = async function () {
    var list = Array.prototype.slice.call(files.files || []).slice(0, MAX - chosen.length);
    for (var i = 0; i < list.length; i++) {
      try { var r = await shrink(list[i]); chosen.push({ name: list[i].name, blob: r.blob, w: r.w, h: r.h, preview: URL.createObjectURL(r.blob), caption: "" }); }
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
          try { await put(s.signedUrl, c.blob); c.state = "✓"; photos.push({ path: s.path, name: c.name, caption: c.caption || "", w: c.w, h: c.h }); }
          catch (err) { c.state = "failed"; }
          draw();
        }
      }
      say("Saving…");
      var r2 = await fetch(location.pathname + location.search + "&action=submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers: answers, photos: photos, consent: true }) });
      var j2 = await r2.json(); if (!r2.ok || !j2.ok) throw new Error(j2.error || "save failed");
      document.querySelector(".wrap").innerHTML = '<img class="logo" src="https://www.drippingsportsclub.com/brand/logo-light.png" alt=""><div class="done"><span class="tag">Got it</span><h1>Thanks, <em>${esc(first(sp.name))}</em>!</h1><p>Your answers' + (photos.length ? " and " + photos.length + " photo" + (photos.length === 1 ? "" : "s") : "") + ' are in. We\\'ll turn them into a post and an email, and a director reviews everything before it goes out.</p></div>';
    } catch (err) { say("Something went wrong: " + err.message + ". Please try again.", "err"); busy = false; send.disabled = false; }
  };
})();
</script>`);
}

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const sb = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  return handleSpotlightForm(sb, req, res);
}

export async function handleSpotlightForm(sb, req, res) {
  res.setHeader("Cache-Control", "no-store");
  const url = new URL(req.url, "https://x");
  const t = url.searchParams.get("t") || "";
  const action = url.searchParams.get("action") || "";
  if (url.searchParams.get("preview") === "1" && req.method === "GET") {
    return res.status(200).setHeader("Content-Type", "text/html; charset=utf-8").send(form({ name: "Hunter Haley", intro: `Hi Hunter! You're up next in DSSC's "${SERIES}" series. Answer whatever you like (short is great) and add a few fun photos.`, questions: [{ q: "How did you get into volleyball, and what keeps you hooked?" }, { q: "Favorite drill - do the kids love it or love to hate it?" }, { q: "Pre-game ritual, walk-up song or go-to snack?" }] }, true));
  }
  if (!UUID_RE.test(t)) return res.status(404).setHeader("Content-Type", "text/html; charset=utf-8").send(page(`<h1>Link not found</h1><p class="intro">This link isn't right - check the text or email we sent, or reply to it and we'll help.</p>`));
  if (!sb) return res.status(500).send("Server not configured");
  const { data: sp } = await sb.from("mkt_spotlights").select("*").eq("token", t).maybeSingle();
  if (!sp || ["cancelled", "declined"].includes(sp.status)) return res.status(404).setHeader("Content-Type", "text/html; charset=utf-8").send(page(`<h1>Link not found</h1><p class="intro">This interview link isn't active any more. Reply to the email or text and we'll sort it out.</p>`));
  const answered = ["answered", "drafted"].includes(sp.status);

  if (req.method === "GET") {
    if (answered) return res.status(200).setHeader("Content-Type", "text/html; charset=utf-8").send(page(`<div class="done"><span class="tag">All set</span><h1>Thanks, <em>${esc(first(sp.name))}</em>!</h1><p>Your answers are in. Want to change something? Reply to our email or text and we'll update it.</p></div>`));
    return res.status(200).setHeader("Content-Type", "text/html; charset=utf-8").send(form(sp, false));
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
      const path = `spotlights/${sp.id}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.jpg`;
      const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
      out.push(error ? { name: f?.name, error: error.message } : { name: f?.name, path, signedUrl: data.signedUrl });
    }
    return json(res, 200, { ok: true, files: out });
  }

  if (action === "submit") {
    const answers = Array.isArray(body?.answers) ? body.answers.map(a => String(a ?? "").trim().slice(0, 1500)) : [];
    if (!answers.some(Boolean)) return json(res, 400, { ok: false, error: "Answer at least one question" });
    if (body?.consent !== true) return json(res, 400, { ok: false, error: "Tick the box to say it's OK to share" });
    const prefix = `spotlights/${sp.id}/`;
    const photos = (Array.isArray(body?.photos) ? body.photos : []).filter(p => String(p?.path || "").startsWith(prefix) && /^[\w/.-]+$/.test(p.path)).slice(0, MAX_PHOTOS)
      .map(p => ({ path: p.path, url: sb.storage.from(BUCKET).getPublicUrl(p.path).data.publicUrl, name: String(p.name || "").slice(0, 120), caption: String(p.caption || "").trim().slice(0, 200), w: Number(p.w) || null, h: Number(p.h) || null }));
    const questions = (sp.questions || []).map((x, i) => ({ q: x.q, a: answers[i] || "" }));
    const { error } = await sb.from("mkt_spotlights").update({ questions, photos, consent: true, status: "answered", answered_at: new Date().toISOString() }).eq("id", sp.id).in("status", ["draft", "sent"]);
    if (error) return json(res, 500, { ok: false, error: "Couldn't save - please try again" });
    await addSpotlightPhotos(sb, sp, photos).catch(() => 0);
    await sb.from("mkt_log").insert({ kind: "spotlight_answered", detail: { id: sp.id, name: sp.name, photos: photos.length } }).then(() => {}, () => {});
    return json(res, 200, { ok: true, photos: photos.length });
  }
  return json(res, 400, { ok: false, error: "Unknown action" });
}
