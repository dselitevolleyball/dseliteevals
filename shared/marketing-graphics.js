// DSSC Marketing Machine — on-brand social / email graphics, drawn with the
// canvas 2D API only (no libraries), in the club's Night Game style:
// Barlow Condensed 900 uppercase headlines with one lime/orange accent word,
// Schibsted Grotesk body, skewed tags, clipped-corner bars, a dark scrim over
// photos, the white DSSC lockup (and the 4QA mark on basketball).
//
//   await ensureFonts();
//   const imgs = await loadGraphicImages(spec);        // photo + logo (+ 4QA)
//   renderGraphic(canvas, spec, imgs);                 // sizes the canvas itself
//   const blob = await renderGraphicBlob(spec);        // → image/png Blob
//
// spec = mkt_items.graphic (+ optional `line` and `cta`):
//   { template: 'photo'|'starts'|'list'|'countdown'|'quote', format: 'post'|'square'|'story'|'email',
//     photo_url, headline, accent, sub, tag, date_label, items: [string], quote?, line?, cta? }
// 'overlay' and 'endcard' (reels, story format): the overlay is transparent
// apart from a dark fade at the top behind the tag and headline, laid over the
// clips; the end card is the club lockup, the call to action and the site.
// 'quote' (coach spotlights): the photo, a big lime quotation mark, the
// quote in bold body type, then the headline (the person) and sub (their role).
//
// Every piece of text is fitted: headlines shrink and wrap, body lines wrap
// and end with "…" — nothing ever runs off the canvas. Images load with
// crossOrigin="anonymous" (the website and Supabase storage both send CORS
// headers) so the canvas stays exportable; an image that can't load that way
// is skipped rather than tainting the canvas.

export const FORMATS = {
  post:   { w: 1080, h: 1350, label: "Feed 4:5" },
  square: { w: 1080, h: 1080, label: "Square" },
  story:  { w: 1080, h: 1920, label: "Story" },
  email:  { w: 1200, h: 630,  label: "Email" },
};
export const TEMPLATES = [
  ["photo", "Photo"],
  ["starts", "Starts"],
  ["list", "List"],
  ["countdown", "Countdown"],
  ["quote", "Quote"],
];
export const BRAND = {
  ink: "#061a18", ink2: "#0a2422", evergreen: "#104946", teal: "#0F8B76",
  lime: "#B2D049", orange: "#FF7300", paper: "#F4F0E8", mute: "#a9b7b1",
};
const SITE = "https://www.drippingsportsclub.com";
export const BRAND_URLS = {
  logo: SITE + "/brand/logo-light.png",        // white lockup 1200×309
  shield: SITE + "/brand/logo-mark-light.png", // white shield 320×497
  mark4qa: SITE + "/brand/4qa-mark.png",       // 4th Quarter Athlete (basketball only)
  fallbackPhoto: SITE + "/brand/og.jpg",
};
const FONT_HREF = "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800;900&family=Schibsted+Grotesk:wght@400;500;700&display=swap";
const HEAD = '"Barlow Condensed", "Arial Narrow", "Roboto Condensed", Impact, sans-serif';
const BODY = '"Schibsted Grotesk", "Helvetica Neue", Arial, sans-serif';

// ── Fonts ───────────────────────────────────────────────────────────────────
let fontsP = null;
export function ensureFonts() {
  if (typeof document === "undefined" || !document.fonts) return Promise.resolve(false);
  if (fontsP) return fontsP;
  fontsP = (async () => {
    let link = document.querySelector("link[data-mkt-fonts]")
      || [...document.querySelectorAll('link[rel="stylesheet"]')].find(l => /Barlow\+Condensed/.test(l.href) && /Schibsted/.test(l.href) && /900/.test(l.href));
    if (!link) {
      link = document.createElement("link");
      link.rel = "stylesheet"; link.href = FONT_HREF; link.setAttribute("data-mkt-fonts", "1");
      const loaded = new Promise(res => { link.onload = res; link.onerror = res; setTimeout(res, 6000); });
      document.head.appendChild(link);
      await loaded;
    } else if (!link.sheet) {
      await new Promise(res => { link.addEventListener("load", res, { once: true }); link.addEventListener("error", res, { once: true }); setTimeout(res, 6000); });
    }
    const faces = ['900 100px "Barlow Condensed"', '800 100px "Barlow Condensed"', '700 100px "Barlow Condensed"', '400 40px "Schibsted Grotesk"', '500 40px "Schibsted Grotesk"', '700 40px "Schibsted Grotesk"'];
    await Promise.race([Promise.all(faces.map(f => document.fonts.load(f, "AZaz09 –·→").catch(() => null))), new Promise(r => setTimeout(r, 8000))]);
    const ok = document.fonts.check('900 100px "Barlow Condensed"') && document.fonts.check('400 40px "Schibsted Grotesk"');
    if (!ok) fontsP = null; // try again next time (offline, slow network)
    return ok;
  })();
  return fontsP;
}

// ── Images ──────────────────────────────────────────────────────────────────
const imgCache = new Map();
export function loadImage(url) {
  if (!url) return Promise.resolve(null);
  if (imgCache.has(url)) return imgCache.get(url);
  const p = new Promise(res => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.decoding = "async";
    const t = setTimeout(() => res(null), 20000);
    im.onload = () => { clearTimeout(t); res(im); };
    im.onerror = () => { clearTimeout(t); res(null); };
    im.src = url;
  });
  p.then(im => { if (!im) imgCache.delete(url); });
  imgCache.set(url, p);
  return p;
}
export async function loadGraphicImages(spec = {}) {
  const [photoImg, logoImg, shieldImg, markImg] = await Promise.all([
    loadImage(spec.photo_url),
    loadImage(BRAND_URLS.logo),
    loadImage(BRAND_URLS.shield),
    spec.line === "basketball" ? loadImage(BRAND_URLS.mark4qa) : Promise.resolve(null),
  ]);
  return { photoImg, logoImg, shieldImg, markImg };
}

// ── Drawing helpers ─────────────────────────────────────────────────────────
const up = (s) => String(s || "").replace(/\s+/g, " ").trim().toUpperCase();
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
const TAN12 = Math.tan(12 * Math.PI / 180);
function setSpacing(ctx, px) { if ("letterSpacing" in ctx) ctx.letterSpacing = (px || 0) + "px"; }

function drawCover(ctx, img, x, y, w, h, fy = 0.38) {
  const s = Math.max(w / img.width, h / img.height);
  const sw = w / s, sh = h / s;
  const sx = (img.width - sw) / 2, sy = Math.max(0, Math.min(img.height - sh, (img.height - sh) * fy));
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}
// No photo (or it wouldn't load with CORS): an evergreen field with the shield
// watermark and two teal slashes — still on brand, never a broken image.
function drawPhotoFallback(ctx, x, y, w, h, shieldImg) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = BRAND.evergreen; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "rgba(15,139,118,0.35)";
  const sl = w * 0.18;
  for (const [fx, fw] of [[0.52, 0.16], [0.74, 0.07]]) {
    ctx.beginPath(); ctx.moveTo(x + w * fx, y); ctx.lineTo(x + w * (fx + fw), y); ctx.lineTo(x + w * (fx + fw) - sl, y + h); ctx.lineTo(x + w * fx - sl, y + h); ctx.closePath(); ctx.fill();
  }
  if (shieldImg) {
    const sh = h * 0.8, sw = sh * shieldImg.width / shieldImg.height;
    ctx.globalAlpha = 0.08; ctx.drawImage(shieldImg, x + w - sw * 0.82, y + h * 0.1, sw, sh); ctx.globalAlpha = 1;
  }
  ctx.restore();
}
function drawPhoto(ctx, img, x, y, w, h, shieldImg, fy) {
  if (img) { ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); drawCover(ctx, img, x, y, w, h, fy); ctx.restore(); }
  else drawPhotoFallback(ctx, x, y, w, h, shieldImg);
}
function vScrim(ctx, x, y, w, h, stops) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  for (const [at, a] of stops) g.addColorStop(at, `rgba(6,26,24,${a})`);
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
}
function hScrim(ctx, x, y, w, h, stops) {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  for (const [at, a] of stops) g.addColorStop(at, `rgba(6,26,24,${a})`);
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
}
// Clipped-corner box: top-right and bottom-left corners cut at 45°.
function clipPath(ctx, x, y, w, h, c) {
  c = Math.min(c, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + w - c, y); ctx.lineTo(x + w, y + c);
  ctx.lineTo(x + w, y + h); ctx.lineTo(x + c, y + h); ctx.lineTo(x, y + h - c);
  ctx.closePath();
}
// Greedy word wrap at the current ctx.font.
function wrap(ctx, text, maxW) {
  const words = clean(text).split(" ").filter(Boolean);
  const lines = []; let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (!cur || ctx.measureText(t).width <= maxW) cur = t;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}
function ellipsize(ctx, s, maxW) {
  if (ctx.measureText(s).width <= maxW) return s;
  let t = s;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1).trimEnd();
  return t + "…";
}
// Body copy: wraps, steps the size down to `min`, then cuts with "…".
function fitBody(ctx, text, maxW, { size, min, maxLines, weight = 400, lh = 1.28, family = BODY }) {
  text = clean(text);
  if (!text) return { lines: [], size, lh, height: 0, font: "" };
  for (let s = size; s >= min; s -= 2) {
    ctx.font = `${weight} ${s}px ${family}`;
    const lines = wrap(ctx, text, maxW);
    if (lines.length <= maxLines && lines.every(l => ctx.measureText(l).width <= maxW)) return { lines, size: s, lh, height: lines.length * s * lh, font: ctx.font };
  }
  ctx.font = `${weight} ${min}px ${family}`;
  let lines = wrap(ctx, text, maxW).map(l => ellipsize(ctx, l, maxW));
  if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = ellipsize(ctx, lines[maxLines - 1] + "…", maxW); }
  return { lines, size: min, lh, height: lines.length * min * lh, font: ctx.font };
}
function drawBody(ctx, fit, x, top, color, align = "left") {
  if (!fit.lines.length) return;
  ctx.font = fit.font; ctx.fillStyle = color; ctx.textBaseline = "alphabetic"; ctx.textAlign = align;
  fit.lines.forEach((l, i) => ctx.fillText(l, x, top + fit.size * 0.92 + i * fit.size * fit.lh));
  ctx.textAlign = "left";
}

// Headline words, with the accent phrase marked (one accent per graphic).
function headWords(headline, accent) {
  const words = up(headline).split(" ").filter(Boolean);
  const out = words.map(w => ({ w, acc: false }));
  const strip = (s) => s.replace(/[^A-Z0-9]/g, "");
  const aw = up(accent).split(" ").filter(Boolean).map(strip).filter(Boolean);
  let hit = false;
  if (aw.length) {
    for (let i = 0; i + aw.length <= words.length && !hit; i++) {
      if (aw.every((a, k) => strip(words[i + k]) === a)) { for (let k = 0; k < aw.length; k++) out[i + k].acc = true; hit = true; }
    }
    if (!hit && aw.length === 1) { const i = words.findIndex(w => strip(w).includes(aw[0])); if (i >= 0) { out[i].acc = true; hit = true; } }
  }
  if (!hit && out.length > 1) out[out.length - 1].acc = true;
  return out;
}
// Biggest size at which the headline wraps into ≤ maxLines lines inside maxW
// and stacks inside maxH. Always returns something that fits.
function fitHead(ctx, words, maxW, maxH, { max, min = 40, maxLines = 4, lh = 0.9, weight = 900 }) {
  const tryAt = (s, lim) => {
    ctx.font = `${weight} ${s}px ${HEAD}`;
    const sp = ctx.measureText(" ").width;
    const lines = []; let cur = [], curW = 0;
    for (const t of words) {
      const ww = ctx.measureText(t.w).width;
      if (ww > maxW) return null;
      const nw = cur.length ? curW + sp + ww : ww;
      if (cur.length && nw > maxW) { lines.push({ words: cur, width: curW }); cur = [t]; curW = ww; }
      else { cur.push(t); curW = nw; }
    }
    if (cur.length) lines.push({ words: cur, width: curW });
    const cap = s * 0.7;
    const height = cap + (lines.length - 1) * s * lh;
    if (lines.length > lim || height > maxH) return null;
    return { lines, size: s, lh, cap, height, sp, font: ctx.font };
  };
  // Same size, narrowest width that keeps the line count: balanced lines.
  const balance = (f, s, lim) => {
    if (!f || f.lines.length < 2) return f;
    // Only to rescue a lone short word on the last line; otherwise the
    // natural break reads better (it keeps "CAMP ELEVATE" together).
    const last = f.lines[f.lines.length - 1], widest = Math.max(...f.lines.map(l => l.width));
    if (last.words.length > 1 || last.width > widest * 0.3) return f;
    const full = maxW; let best = f;
    for (let k = 0.96; k >= 0.6; k -= 0.04) {
      maxW = full * k; const g = tryAt(s, lim);
      if (!g || g.lines.length !== f.lines.length) break;
      best = g;
    }
    maxW = full; return best;
  };
  for (let s = Math.round(max); s >= min; s -= 2) { const f = tryAt(s, maxLines); if (f) return balance(f, s, maxLines); }
  for (let s = Math.round(min) - 2; s >= 10; s -= 2) { const f = tryAt(s, 99); if (f) return f; }
  return tryAt(10, 999) || { lines: [], size: 10, lh, cap: 7, height: 0, sp: 3, font: "" };
}
function drawHead(ctx, fit, x, top, { color = "#fff", accent = BRAND.lime, align = "left", width = 0 } = {}) {
  if (!fit.lines.length) return;
  ctx.font = fit.font; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
  fit.lines.forEach((ln, i) => {
    let cx = align === "center" ? x + (width - ln.width) / 2 : x;
    const y = top + fit.cap + i * fit.size * fit.lh;
    for (const t of ln.words) {
      ctx.fillStyle = t.acc ? accent : color;
      ctx.fillText(t.w, cx, y);
      cx += ctx.measureText(t.w).width + fit.sp;
    }
  });
}
// Skewed label (skewX -12°): lime box, ink caps.
function drawTag(ctx, text, x, y, u, maxW, { fill = BRAND.lime, color = BRAND.ink, size = 30 } = {}) {
  text = up(text);
  if (!text) return 0;
  const h = Math.round(size * 1.9 * u), off = h * TAN12, pad = 22 * u;
  let s = size * u;
  setSpacing(ctx, 1.5 * u);
  ctx.font = `800 ${s}px ${HEAD}`;
  while (ctx.measureText(text).width + pad * 2 + off > maxW && s > 16 * u) { s -= 1; ctx.font = `800 ${s}px ${HEAD}`; }
  const t = ellipsize(ctx, text, maxW - pad * 2 - off);
  const w = ctx.measureText(t).width + pad * 2;
  ctx.fillStyle = fill;
  ctx.beginPath(); ctx.moveTo(x + off, y); ctx.lineTo(x + w + off, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = color; ctx.textBaseline = "middle";
  ctx.fillText(t, x + pad + off / 2, y + h / 2 + s * 0.04);
  ctx.textBaseline = "alphabetic"; setSpacing(ctx, 0);
  return h;
}
// The call to action: an orange clipped-corner bar.
function drawCta(ctx, text, x, y, h, maxW, u) {
  text = up(text || "Sign up");
  if (!/→$/.test(text)) text += "  →";
  const pad = 30 * u;
  let s = h * 0.46;
  setSpacing(ctx, 1 * u);
  ctx.font = `800 ${s}px ${HEAD}`;
  while (ctx.measureText(text).width + pad * 2 > maxW && s > h * 0.28) { s -= 1; ctx.font = `800 ${s}px ${HEAD}`; }
  const t = ellipsize(ctx, text, maxW - pad * 2);
  const w = Math.min(maxW, ctx.measureText(t).width + pad * 2);
  ctx.fillStyle = BRAND.orange; clipPath(ctx, x, y, w, h, 20 * u); ctx.fill();
  ctx.fillStyle = BRAND.ink; ctx.textBaseline = "middle";
  ctx.fillText(t, x + pad, y + h / 2 + s * 0.05);
  ctx.textBaseline = "alphabetic"; setSpacing(ctx, 0);
  return w;
}
// White DSSC lockup, right-aligned at (right, centerY); 4QA mark to its left
// with a hairline divider for basketball. Returns the width used.
function drawLockup(ctx, imgs, right, cy, h) {
  const { logoImg, markImg } = imgs;
  let used = 0;
  if (logoImg) {
    const lw = h * logoImg.width / logoImg.height;
    ctx.drawImage(logoImg, right - lw, cy - h / 2, lw, h);
    used = lw;
  } else {
    ctx.font = `900 ${h * 0.62}px ${HEAD}`; ctx.fillStyle = "#fff"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
    ctx.fillText("DRIPPING SPRINGS SPORTS CLUB", right, cy); used = ctx.measureText("DRIPPING SPRINGS SPORTS CLUB").width;
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }
  if (markImg) {
    const gap = h * 0.38, mh = h * 1.0, mw = mh * markImg.width / markImg.height;
    const dx = right - used - gap;
    ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.fillRect(dx - 1, cy - h * 0.5, 2, h);
    ctx.drawImage(markImg, dx - gap - mw, cy - mh / 2, mw, mh);
    used += gap * 2 + mw;
  }
  return used;
}
function lockupWidth(imgs, h) {
  let w = imgs.logoImg ? h * imgs.logoImg.width / imgs.logoImg.height : h * 3.9;
  if (imgs.markImg) { const mh = h * 1.0; w += h * 0.76 + mh * imgs.markImg.width / imgs.markImg.height; }
  return w;
}
// Bottom row: CTA left, lockup right (lockup drops when there's no room).
function drawFooter(ctx, spec, imgs, x, y, w, h, u) {
  const logoH = h * 0.7;
  const lw = lockupWidth(imgs, logoH);
  const room = w - lw - 36 * u;
  if (room >= w * 0.36) { drawCta(ctx, spec.cta, x, y, h, room, u); drawLockup(ctx, imgs, x + w, y + h / 2, logoH); }
  else { drawCta(ctx, spec.cta, x, y, h, w, u); }
}
// Orange starburst ("3 DAYS" / "LAST CALL").
function drawBurst(ctx, label, cx, cy, r, u) {
  const n = 16, inner = r * 0.86, rot = -0.14;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) { const a = (Math.PI * i) / n; const rr = i % 2 ? inner : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  ctx.closePath(); ctx.fillStyle = BRAND.orange; ctx.fill();
  ctx.lineWidth = 3 * u; ctx.strokeStyle = BRAND.ink; ctx.beginPath(); ctx.arc(0, 0, inner * 0.86, 0, Math.PI * 2); ctx.stroke();
  const text = up(label || "Last call");
  const m = /^(\d{1,3})\s+(.+)$/.exec(text);
  ctx.fillStyle = BRAND.ink; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  const box = inner * 1.32;
  if (m) {
    let ns = r * 0.92; ctx.font = `900 ${ns}px ${HEAD}`;
    while (ctx.measureText(m[1]).width > box && ns > 20) { ns -= 2; ctx.font = `900 ${ns}px ${HEAD}`; }
    let ws = r * 0.3; ctx.font = `800 ${ws}px ${HEAD}`;
    while (ctx.measureText(m[2]).width > box && ws > 12) { ws -= 1; ctx.font = `800 ${ws}px ${HEAD}`; }
    const total = ns * 0.7 + ws * 0.72 + r * 0.06;
    const top = -total / 2;
    ctx.font = `900 ${ns}px ${HEAD}`; ctx.fillText(m[1], 0, top + ns * 0.7);
    setSpacing(ctx, 2 * u); ctx.font = `800 ${ws}px ${HEAD}`; ctx.fillText(m[2], 0, top + ns * 0.7 + r * 0.06 + ws * 0.72); setSpacing(ctx, 0);
  } else {
    const words = headWords(text, "").map(t => ({ ...t, acc: false }));
    const f = fitHead(ctx, words, box * 0.92, box * 0.8, { max: r * 0.5, min: 14, maxLines: 3, lh: 0.92 });
    ctx.textAlign = "left";
    drawHead(ctx, f, -box * 0.46, -f.height / 2, { color: BRAND.ink, accent: BRAND.ink, align: "center", width: box * 0.92 });
  }
  ctx.restore(); ctx.textAlign = "left";
}

// Margins per format: the story keeps clear of Instagram's top/bottom UI.
function frame(fmt) {
  const { w: W, h: H } = FORMATS[fmt] || FORMATS.post;
  const u = Math.min(W, H) / 1080;
  const land = W > H;
  const m = land ? 52 * u * 1.15 : 64 * u;
  const top = fmt === "story" ? 230 : m;
  const bottom = fmt === "story" ? 250 : m;
  return { W, H, u, land, m, top, bottom };
}

// ── Templates ───────────────────────────────────────────────────────────────
function tPhoto(ctx, spec, imgs, F, burst) {
  const { W, H, u, land, m, top, bottom } = F;
  const accent = burst ? BRAND.orange : BRAND.lime;
  const footH = Math.round((land ? 96 : 84) * u);
  const colW = land ? W * 0.6 - m : W - 2 * m;
  // Measure bottom-up: footer, sub, headline.
  const sub = fitBody(ctx, spec.sub, colW, { size: (land ? 44 : 36) * u, min: (land ? 34 : 28) * u, maxLines: land ? 2 : 3 });
  const footY = H - bottom - footH;
  const subTop = footY - (sub.lines.length ? 40 * u : 0) - sub.height;
  const tagH = Math.round(30 * 1.9 * u);
  const burstR = burst ? (land ? 150 : 170) * u : 0;
  const headTopLimit = top + tagH + 36 * u + (burst && !land ? burstR * 1.4 : 0);
  const maxHeadH = Math.min(subTop - 28 * u - headTopLimit, H * (land ? 0.5 : 0.36));
  const head = fitHead(ctx, headWords(spec.headline, spec.accent), colW, maxHeadH, { max: (land ? 170 : 172) * u, min: (land ? 64 : 72) * u, maxLines: land ? 3 : 4 });
  const headTop = subTop - 28 * u - head.height;

  drawPhoto(ctx, imgs.photoImg, 0, 0, W, H, imgs.shieldImg, land ? 0.35 : 0.3);
  vScrim(ctx, 0, 0, W, top + tagH + 120 * u, [[0, 0.55], [1, 0]]);
  if (land) {
    hScrim(ctx, 0, 0, W, H, [[0, 0.94], [0.5, 0.82], [0.78, 0.15], [1, 0]]);
    vScrim(ctx, 0, H * 0.55, W, H * 0.45, [[0, 0], [1, 0.7]]);
  } else {
    const s0 = Math.max(0, headTop - 260 * u);
    vScrim(ctx, 0, s0, W, H - s0, [[0, 0], [0.32, 0.72], [0.62, 0.9], [1, 0.96]]);
  }
  drawTag(ctx, spec.tag, m, top, u, colW);
  drawHead(ctx, head, m, headTop, { accent });
  drawBody(ctx, sub, m, subTop, BRAND.paper);
  drawFooter(ctx, spec, imgs, m, footY, W - 2 * m, footH, u);
  if (burst) {
    const cx = W - m - burstR * 0.95, cy = top + burstR * (land ? 0.95 : 1.02);
    drawBurst(ctx, spec.date_label, cx, cy, burstR, u);
  }
}

function dateParts(label) {
  const t = up(label);
  const m = /^(?:(STARTS|BEGINS|OPENS|FROM)\s+)?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\.?\s+(\d{1,2})(?:\s*[–-]\s*(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  return { pre: m[1] || "", mon: m[2].slice(0, 3), day: m[3] + (m[4] ? "–" + m[4] : "") };
}
function drawDateBlock(ctx, label, x, y, w, h, u) {
  ctx.fillStyle = BRAND.lime; clipPath(ctx, x, y, w, h, 24 * u); ctx.fill();
  const p = dateParts(label);
  ctx.fillStyle = BRAND.ink; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  const inner = w - 28 * u;
  if (p) {
    let ms = h * 0.22; setSpacing(ctx, 3 * u); ctx.font = `800 ${ms}px ${HEAD}`;
    const monText = p.pre ? p.mon : p.mon;
    while (ctx.measureText(monText).width > inner && ms > 10) { ms -= 1; ctx.font = `800 ${ms}px ${HEAD}`; }
    let ds = h * 0.6; setSpacing(ctx, 0); ctx.font = `900 ${ds}px ${HEAD}`;
    while (ctx.measureText(p.day).width > inner && ds > 12) { ds -= 2; ctx.font = `900 ${ds}px ${HEAD}`; }
    const total = ms * 0.7 + h * 0.07 + ds * 0.7;
    const t0 = y + (h - total) / 2;
    setSpacing(ctx, 3 * u); ctx.font = `800 ${ms}px ${HEAD}`; ctx.fillText(monText, x + w / 2, t0 + ms * 0.7);
    setSpacing(ctx, 0); ctx.font = `900 ${ds}px ${HEAD}`; ctx.fillText(p.day, x + w / 2, t0 + ms * 0.7 + h * 0.07 + ds * 0.7);
  } else {
    const f = fitHead(ctx, headWords(label || "Soon", "").map(t => ({ ...t, acc: false })), inner, h - 36 * u, { max: h * 0.36, min: 14, maxLines: 3, lh: 0.95 });
    ctx.textAlign = "left";
    drawHead(ctx, f, x + 14 * u, y + (h - f.height) / 2, { color: BRAND.ink, accent: BRAND.ink, align: "center", width: inner });
  }
  ctx.textAlign = "left"; setSpacing(ctx, 0);
}
function tStarts(ctx, spec, imgs, F) {
  const { W, H, u, land, m, top, bottom } = F;
  ctx.fillStyle = BRAND.ink; ctx.fillRect(0, 0, W, H);
  const footH = Math.round((land ? 96 : 84) * u);
  if (land) {
    const pw = W * 0.44, slant = 70 * u;
    drawPhoto(ctx, imgs.photoImg, 0, 0, pw + slant, H, imgs.shieldImg, 0.35);
    ctx.fillStyle = BRAND.ink; ctx.beginPath(); ctx.moveTo(pw + slant, 0); ctx.lineTo(W, 0); ctx.lineTo(W, H); ctx.lineTo(pw, H); ctx.closePath(); ctx.fill();
    ctx.fillStyle = BRAND.lime; ctx.beginPath(); ctx.moveTo(pw + slant - 8 * u, 0); ctx.lineTo(pw + slant, 0); ctx.lineTo(pw, H); ctx.lineTo(pw - 8 * u, H); ctx.closePath(); ctx.fill();
    const x = pw + slant + 10 * u, cw = W - m - x;
    const tagH = drawTag(ctx, spec.tag, x, m, u, cw);
    const footY = H - m - footH;
    const rowTop = m + tagH + 40 * u, rowH = footY - 40 * u - rowTop;
    const bw = Math.min(rowH * 0.95, cw * 0.36), bh = Math.min(rowH, bw * 1.1);
    drawDateBlock(ctx, spec.date_label, x, rowTop + (rowH - bh) / 2, bw, bh, u);
    const tx = x + bw + 32 * u, tw = cw - bw - 32 * u;
    const sub = fitBody(ctx, spec.sub, tw, { size: 40 * u, min: 30 * u, maxLines: 2, weight: 500 });
    const head = fitHead(ctx, headWords(spec.headline, spec.accent), tw, rowH - sub.height - (sub.lines.length ? 22 * u : 0), { max: 130 * u, min: 54 * u, maxLines: 3 });
    const blockH = head.height + (sub.lines.length ? 22 * u + sub.height : 0);
    const t0 = rowTop + (rowH - blockH) / 2;
    drawHead(ctx, head, tx, t0);
    drawBody(ctx, sub, tx, t0 + head.height + 22 * u, BRAND.mute);
    drawFooter(ctx, spec, imgs, x, footY, cw, footH, u);
    return;
  }
  const pH = Math.round(H * (F.H > 1500 ? 0.5 : 0.58));
  const slant = 56 * u;
  drawPhoto(ctx, imgs.photoImg, 0, 0, W, pH + slant, imgs.shieldImg, 0.3);
  vScrim(ctx, 0, 0, W, top + 180 * u, [[0, 0.5], [1, 0]]);
  // Panel with a slanted top edge and a lime rule along it.
  ctx.fillStyle = BRAND.lime; ctx.beginPath(); ctx.moveTo(0, pH + slant - 10 * u); ctx.lineTo(W, pH - 10 * u); ctx.lineTo(W, pH); ctx.lineTo(0, pH + slant); ctx.closePath(); ctx.fill();
  ctx.fillStyle = BRAND.ink; ctx.beginPath(); ctx.moveTo(0, pH + slant); ctx.lineTo(W, pH); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
  drawTag(ctx, spec.tag, m, top, u, W - 2 * m);
  const footY = H - bottom - footH;
  const rowTop = pH + slant + 44 * u, rowH = footY - 44 * u - rowTop;
  const tall = H > 1500;
  const bw = Math.min((tall ? 300 : 250) * u, rowH * 0.92), bh = Math.min(rowH, bw * 1.12);
  drawDateBlock(ctx, spec.date_label, m, rowTop + (rowH - bh) / 2, bw, bh, u);
  const tx = m + bw + 40 * u, tw = W - m - tx;
  const sub = fitBody(ctx, spec.sub, tw, { size: 36 * u, min: 26 * u, maxLines: 2, weight: 500 });
  const head = fitHead(ctx, headWords(spec.headline, spec.accent), tw, rowH - sub.height - (sub.lines.length ? 20 * u : 0), { max: (tall ? 136 : 116) * u, min: 44 * u, maxLines: 3 });
  const blockH = head.height + (sub.lines.length ? 20 * u + sub.height : 0);
  const t0 = rowTop + (rowH - blockH) / 2;
  drawHead(ctx, head, tx, t0);
  drawBody(ctx, sub, tx, t0 + head.height + 20 * u, BRAND.mute);
  drawFooter(ctx, spec, imgs, m, footY, W - 2 * m, footH, u);
}

function drawRows(ctx, items, x, y, w, rowH, gap, u) {
  ctx.font = `900 ${rowH * 0.5}px ${HEAD}`;
  const split = items.map(s => { const i = s.indexOf(" · "); return i > 0 && i < 18 ? [up(s.slice(0, i)), s.slice(i + 3)] : ["", s]; });
  const hasLab = split.some(([l]) => l);
  const labW = hasLab ? Math.min(w * 0.3, Math.max(...split.map(([l]) => l ? ctx.measureText(l).width : 0)) + 44 * u) : 0;
  // One text size for every row (the smallest any row needs, within reason).
  const textW = x + w - 28 * u - (x + 30 * u + labW);
  const rowSize = Math.min(...split.map(([, t]) => fitBody(ctx, t, textW, { size: rowH * 0.36, min: rowH * 0.3, maxLines: 1, weight: 700 }).size));
  split.forEach(([lab, text], i) => {
    const ry = y + i * (rowH + gap);
    ctx.fillStyle = BRAND.ink2; clipPath(ctx, x, ry, w, rowH, 18 * u); ctx.fill();
    ctx.fillStyle = BRAND.lime; ctx.fillRect(x, ry, 6 * u, rowH - 18 * u);
    let tx = x + 30 * u;
    if (hasLab) {
      let ls = rowH * 0.5; ctx.font = `900 ${ls}px ${HEAD}`;
      while (ctx.measureText(lab).width > labW - 40 * u && ls > 10) { ls -= 1; ctx.font = `900 ${ls}px ${HEAD}`; }
      ctx.fillStyle = BRAND.lime; ctx.textBaseline = "middle"; ctx.fillText(lab, tx, ry + rowH / 2 + ls * 0.04);
      tx = x + 30 * u + labW;
    }
    const tw = x + w - 28 * u - tx;
    const f = fitBody(ctx, text, tw, { size: rowSize, min: Math.min(rowSize, rowH * 0.26), maxLines: 1, weight: 700 });
    ctx.font = f.font; ctx.fillStyle = "#fff"; ctx.textBaseline = "middle";
    if (f.lines[0]) ctx.fillText(f.lines[0], tx, ry + rowH / 2 + f.size * 0.04);
    ctx.textBaseline = "alphabetic";
  });
}
function tList(ctx, spec, imgs, F) {
  const { W, H, u, land, m, top, bottom } = F;
  const items = (Array.isArray(spec.items) ? spec.items : []).map(clean).filter(Boolean).slice(0, 4);
  ctx.fillStyle = BRAND.ink; ctx.fillRect(0, 0, W, H);
  const footH = Math.round((land ? 96 : 84) * u);
  if (land) {
    const px = W * 0.58;
    drawPhoto(ctx, imgs.photoImg, px, 0, W - px, H, imgs.shieldImg, 0.35);
    hScrim(ctx, px, 0, W - px, H, [[0, 1], [0.45, 0.55], [1, 0.15]]);
  } else {
    const ph = H * (H > 1500 ? 0.36 : 0.42);
    drawPhoto(ctx, imgs.photoImg, 0, 0, W, ph, imgs.shieldImg, 0.3);
    vScrim(ctx, 0, 0, W, ph, [[0, 0.45], [0.5, 0.62], [1, 1]]);
  }
  if (imgs.shieldImg && !land) {
    const sh = H * 0.5, sw = sh * imgs.shieldImg.width / imgs.shieldImg.height;
    ctx.globalAlpha = 0.05; ctx.drawImage(imgs.shieldImg, W - sw * 0.7, H - sh * 0.92, sw, sh); ctx.globalAlpha = 1;
  }
  const cw = land ? W * 0.62 - m : W - 2 * m;
  const footY = H - bottom - footH;
  const n = Math.max(items.length, 1);
  const rowH = Math.round((land ? 104 : 104) * u), gap = Math.round(14 * u);
  let rowsH = items.length ? n * rowH + (n - 1) * gap : 0;
  const tagH = Math.round(30 * 1.9 * u);
  const headLimitTop = top + tagH + 36 * u;
  let rowsTop = footY - 48 * u - rowsH;
  let rh = rowH;
  // Not enough room (square/email with four rows): shrink the rows.
  const minHead = 110 * u;
  if (rowsTop - 36 * u - headLimitTop < minHead && items.length) {
    const avail = footY - 48 * u - headLimitTop - minHead - 36 * u;
    rh = Math.max(46 * u, Math.floor((avail - (n - 1) * gap) / n));
    rowsH = n * rh + (n - 1) * gap; rowsTop = footY - 48 * u - rowsH;
  }
  const sub = fitBody(ctx, spec.sub, cw, { size: 34 * u, min: 26 * u, maxLines: 2 });
  const subH = sub.lines.length ? sub.height + 20 * u : 0;
  const headBottom = (items.length ? rowsTop - 40 * u : footY - 48 * u) - subH;
  const head = fitHead(ctx, headWords(spec.headline, spec.accent), cw, Math.min(headBottom - headLimitTop, H * 0.34), { max: 150 * u, min: 56 * u, maxLines: 3 });
  const headTop = headBottom - head.height;
  drawTag(ctx, spec.tag, m, top, u, cw);
  drawHead(ctx, head, m, headTop);
  drawBody(ctx, sub, m, headTop + head.height + 20 * u, BRAND.mute);
  if (items.length) drawRows(ctx, items, m, rowsTop, cw, rh, gap, u);
  drawFooter(ctx, spec, imgs, m, footY, W - 2 * m, footH, u);
}

function tQuote(ctx, spec, imgs, F) {
  const { W, H, u, land, m, top, bottom } = F;
  ctx.fillStyle = BRAND.ink; ctx.fillRect(0, 0, W, H);
  const footH = Math.round((land ? 96 : 84) * u);
  const footY = H - bottom - footH;
  const tagH = Math.round(30 * 1.9 * u);
  let cw, qTop;
  if (land) {
    const px = W * 0.56;
    drawPhoto(ctx, imgs.photoImg, px, 0, W - px, H, imgs.shieldImg, 0.3);
    hScrim(ctx, px, 0, W - px, H, [[0, 1], [0.3, 0.45], [1, 0]]);
    drawTag(ctx, spec.tag, m, m, u, px - 2 * m);
    cw = px - m - 24 * u; qTop = m + tagH + 18 * u;
  } else {
    const ph = Math.round(H * (H > 1500 ? 0.46 : 0.5));
    drawPhoto(ctx, imgs.photoImg, 0, 0, W, ph, imgs.shieldImg, 0.28);
    vScrim(ctx, 0, ph * 0.5, W, ph * 0.5 + 2, [[0, 0], [1, 1]]);
    vScrim(ctx, 0, 0, W, top + 160 * u, [[0, 0.5], [1, 0]]);
    drawTag(ctx, spec.tag, m, top, u, W - 2 * m);
    cw = W - 2 * m; qTop = ph - 70 * u;
  }
  const sub = fitBody(ctx, spec.sub, cw, { size: 32 * u, min: 24 * u, maxLines: 1, weight: 500 });
  const name = fitHead(ctx, headWords(spec.headline, spec.accent), cw, 150 * u, { max: (land ? 80 : 96) * u, min: 40 * u, maxLines: 2 });
  const nameTop = footY - 36 * u - (sub.lines.length ? sub.height + 12 * u : 0) - name.height;
  const markS = (land ? 220 : 300) * u;
  const qText = qTop + markS * 0.42;
  const avail = nameTop - 64 * u - qText;
  const qSize = (land ? 52 : 76) * u;
  // The biggest size whose wrapped quote fits the space above the name.
  let q = null;
  for (let sz = qSize; sz >= 26 * u; sz -= 2 * u) {
    q = fitBody(ctx, spec.quote || "", cw, { size: sz, min: sz, maxLines: 8, weight: 700, lh: 1.22 });
    if (q.height <= avail) break;
  }
  ctx.font = `900 ${markS}px ${HEAD}`; ctx.fillStyle = BRAND.lime; ctx.textBaseline = "alphabetic";
  ctx.fillText("\u201C", m - 8 * u, qTop + markS * 0.72);
  drawBody(ctx, q, m, qText + Math.max(0, Math.min(40 * u, (avail - q.height) / 2)), "#fff");
  drawHead(ctx, name, m, nameTop, { accent: BRAND.lime });
  drawBody(ctx, sub, m, nameTop + name.height + 12 * u, BRAND.mute);
  drawFooter(ctx, spec, imgs, m, footY, land ? cw : W - 2 * m, footH, u);
}

function tOverlay(ctx, spec, imgs, F) {
  const { W, u, m, top } = F;
  const cw = W - 2 * m;
  const head = fitHead(ctx, headWords(spec.headline, spec.accent), cw, 300 * u, { max: 132 * u, min: 60 * u, maxLines: 3 });
  const tagH = Math.round(30 * 1.9 * u);
  const headTop = top + (spec.tag ? tagH + 26 * u : 0);
  vScrim(ctx, 0, 0, W, headTop + head.height + 170 * u, [[0, 0.72], [0.62, 0.5], [1, 0]]);
  if (spec.tag) drawTag(ctx, spec.tag, m, top, u, cw);
  drawHead(ctx, head, m, headTop);
}
function tEndcard(ctx, spec, imgs, F) {
  const { W, H, u, m } = F;
  ctx.fillStyle = BRAND.ink; ctx.fillRect(0, 0, W, H);
  if (imgs.shieldImg) { const sh = H * 0.62, sw = sh * imgs.shieldImg.width / imgs.shieldImg.height; ctx.globalAlpha = 0.06; ctx.drawImage(imgs.shieldImg, (W - sw) / 2, (H - sh) / 2, sw, sh); ctx.globalAlpha = 1; }
  const cw = W - 2 * m;
  const head = fitHead(ctx, headWords("Where Dripping Springs plays.", "plays."), cw, 380 * u, { max: 150 * u, min: 70 * u, maxLines: 3 });
  const logoH = 120 * u, lw = lockupWidth(imgs, logoH);
  const ctaH = 96 * u;
  const site = fitBody(ctx, "drippingsportsclub.com", cw, { size: 40 * u, min: 30 * u, maxLines: 1, weight: 700 });
  const block = logoH + 90 * u + head.height + 70 * u + ctaH + 40 * u + site.height;
  let y = (H - block) / 2;
  drawLockup(ctx, imgs, (W + Math.min(lw, cw)) / 2, y + logoH / 2, logoH); y += logoH + 90 * u;
  drawHead(ctx, head, m, y); y += head.height + 70 * u;
  drawCta(ctx, spec.cta || "See what's coming up", m, y, ctaH, cw, u); y += ctaH + 40 * u;
  drawBody(ctx, site, m, y, BRAND.lime);
}

// ── Public ─────────────────────────────────────────────────────────────────
// Draws `spec` on `canvas` (resized to the format). Synchronous: load fonts
// (ensureFonts) and images (loadGraphicImages) first.
// "Custom": a finished graphic Drew uploaded (made in Canva, a flyer…) posted
// exactly as is — no brand text on top. Filled edge to edge when its shape is
// close to the format; otherwise shown whole on the brand ink (a 4:5 post in
// a 9:16 story, say) rather than cropped.
function tCustom(ctx, imgs, F) {
  const { W, H } = F;
  ctx.fillStyle = BRAND.ink; ctx.fillRect(0, 0, W, H);
  const img = imgs.photoImg;
  if (!img) { drawPhotoFallback(ctx, 0, 0, W, H, imgs.shieldImg); return; }
  const r = (img.width / img.height) / (W / H);
  if (r > 0.92 && r < 1.08) { drawCover(ctx, img, 0, 0, W, H, 0.5); return; }
  const s = Math.min(W / img.width, H / img.height);
  const w = img.width * s, h = img.height * s;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

export function renderGraphic(canvas, spec = {}, imgs = {}) {
  const fmt = FORMATS[spec.format] ? spec.format : "post";
  const F = frame(fmt);
  if (canvas.width !== F.W) canvas.width = F.W;
  if (canvas.height !== F.H) canvas.height = F.H;
  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, F.W, F.H);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; setSpacing(ctx, 0);
  const s = { ...spec, tag: spec.tag ?? "", headline: spec.headline || "Where Dripping Springs plays" };
  const t = spec.template;
  if (t === "custom") tCustom(ctx, imgs, F);
  else if (t === "starts") tStarts(ctx, s, imgs, F);
  else if (t === "list") tList(ctx, s, imgs, F);
  else if (t === "countdown") tPhoto(ctx, s, imgs, F, true);
  else if (t === "quote") tQuote(ctx, s, imgs, F);
  else if (t === "overlay") tOverlay(ctx, s, imgs, F);
  else if (t === "endcard") tEndcard(ctx, s, imgs, F);
  else tPhoto(ctx, s, imgs, F, false);
  ctx.restore();
  return canvas;
}

// Fonts + images + render → PNG Blob (for upload on approve).
export async function renderGraphicBlob(spec = {}, { format, type = "image/png", quality } = {}) {
  const s = { ...spec, format: format || spec.format || "post" };
  await ensureFonts();
  const imgs = await loadGraphicImages(s);
  const canvas = document.createElement("canvas");
  renderGraphic(canvas, s, imgs);
  return new Promise((res, rej) => {
    try { canvas.toBlob(b => b ? res(b) : rej(new Error("Couldn't export the graphic (image blocked by CORS?)")), type, quality); }
    catch (e) { rej(e); }
  });
}
