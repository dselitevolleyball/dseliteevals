// DS Elite Social graphics, drawn on the server (@napi-rs/canvas), so a draft
// arrives in Slack already finished: the collage, each photo of a carousel
// cropped to Instagram's 4:5, and the "Meet the Coach" poster. DS Elite's
// look: black, pink (#e91e8c), Archivo 900 headlines, Outfit body, the white
// logo. Every image is 1080x1350 JPEG - the tallest a feed post may be on
// Instagram, and fine on Facebook.
//
// Fonts and the logo ship with the function (api/_fonts, vercel.json
// includeFiles). Photos are decoded with their EXIF rotation applied, so an
// iPhone portrait comes out upright. A crop centres on the photo's focus
// point ({x, y} 0-1, from Claude's pick) so heads aren't cut off.

import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const W = 1080, H = 1350;
export const PINK = "#e91e8c", HOT = "#ff69b4", INK = "#0a0a0a", WHITE = "#ffffff", MUT = "#b9b9b9";
const FONT_FILES = [["Archivo-900.ttf", "Archivo"], ["Archivo-800.ttf", "Archivo"], ["Outfit-400.ttf", "Outfit"], ["Outfit-600.ttf", "Outfit"], ["Outfit-700.ttf", "Outfit"]];

function assetDir() {
  const here = (() => { try { return join(dirname(fileURLToPath(import.meta.url)), "..", "_fonts"); } catch { return null; } })();
  for (const d of [here, join(process.cwd(), "api", "_fonts")].filter(Boolean)) if (existsSync(join(d, "Archivo-900.ttf"))) return d;
  return null;
}
let ready = null;
export function ensureFonts() {
  if (ready !== null) return ready;
  const d = assetDir();
  ready = !!d && FONT_FILES.every(([f, fam]) => !!GlobalFonts.registerFromPath(join(d, f), fam));
  return ready;
}
let logoP = null;
const logo = () => (logoP ||= (async () => { const d = assetDir(); return d ? loadImage(join(d, "ds-elite-white-logo.png")).catch(() => null) : null; })());

// A photo from a URL or a Buffer.
export async function photo(src) {
  if (!src) return null;
  if (Buffer.isBuffer(src)) return loadImage(src);
  const r = await fetch(src, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Couldn't load a photo (HTTP ${r.status})`);
  return loadImage(Buffer.from(await r.arrayBuffer()));
}

// Draw `img` to fill the box, cropping around the focus point.
export function cover(ctx, img, x, y, w, h, focus = {}) {
  const fx = clamp01(focus.x ?? 0.5), fy = clamp01(focus.y ?? 0.4);
  const s = Math.max(w / img.width, h / img.height);
  const sw = w / s, sh = h / s;
  const sx = clamp(fx * img.width - sw / 2, 0, img.width - sw), sy = clamp(fy * img.height - sh / 2, 0, img.height - sh);
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clamp01 = (v) => clamp(Number(v) || 0, 0, 1);

// Fit one line of text to a width, shrinking from `size` down to `min`.
function fit(ctx, text, maxW, size, min, font) {
  let s = size;
  for (; s > min; s -= 2) { ctx.font = font(s); if (ctx.measureText(text).width <= maxW) break; }
  ctx.font = font(s);
  return s;
}
// Wrap text into at most `maxLines`, the last ending in "…" if it doesn't fit.
function wrap(ctx, text, maxW, maxLines) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let cur = "";
  for (let i = 0; i < words.length; i++) {
    const t = cur ? cur + " " + words[i] : words[i];
    if (ctx.measureText(t).width <= maxW) { cur = t; continue; }
    if (cur) lines.push(cur);
    cur = words[i];
    if (lines.length === maxLines) { cur = ""; break; }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  const used = lines.join(" ").split(" ").length;
  if (used < words.length && lines.length) {
    let last = lines[lines.length - 1] + "…";
    while (ctx.measureText(last).width > maxW && last.length > 2) last = last.slice(0, -2).trimEnd() + "…";
    lines[lines.length - 1] = last;
  }
  return lines;
}
const archivo = (s) => `900 ${s}px Archivo`;
const outfit = (w) => (s) => `${w} ${s}px Outfit`;
async function drawLogo(ctx, x, y, w, alpha = 1) {
  const l = await logo(); if (!l) return 0;
  const h = Math.round(w * l.height / l.width);
  ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(l, x, y, w, h); ctx.restore();
  return h;
}
const jpeg = (canvas) => canvas.encode("jpeg", 90);

// ── collage ─────────────────────────────────────────────────────────────────
// Boxes for 2-6 photos in a w x h area, with a gutter.
export function layout(n, w, h, g = 8) {
  const R = (x, y, ww, hh) => ({ x, y, w: ww, h: hh });
  const half = (w - g) / 2, third = (w - 2 * g) / 3;
  switch (Math.max(1, Math.min(6, n))) {
    case 1: return [R(0, 0, w, h)];
    case 2: return [R(0, 0, half, h), R(half + g, 0, half, h)];
    case 3: { const top = Math.round(h * 0.6); return [R(0, 0, w, top), R(0, top + g, half, h - top - g), R(half + g, top + g, half, h - top - g)]; }
    case 4: { const hh = (h - g) / 2; return [R(0, 0, half, hh), R(half + g, 0, half, hh), R(0, hh + g, half, hh), R(half + g, hh + g, half, hh)]; }
    case 5: { const top = Math.round(h * 0.55); const bh = h - top - g; return [R(0, 0, half, top), R(half + g, 0, half, top), R(0, top + g, third, bh), R(third + g, top + g, third, bh), R(2 * (third + g), top + g, third, bh)]; }
    default: { const hh = (h - 2 * g) / 3; return [0, 1, 2].flatMap(r => [R(0, r * (hh + g), half, hh), R(half + g, r * (hh + g), half, hh)]); }
  }
}
// photos: [{img, focus}], title: "12 Rise", sub: "Lone Star Classic · Oct 25"
export async function renderCollage(photos, { title = "", sub = "" } = {}) {
  ensureFonts();
  const c = createCanvas(W, H), ctx = c.getContext("2d");
  ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
  const band = 200, area = H - band;
  const boxes = layout(photos.length, W, area);
  photos.slice(0, boxes.length).forEach((p, i) => { const b = boxes[i]; cover(ctx, p.img, b.x, b.y, b.w, b.h, p.focus); });
  // the band: a pink rule, the team, the event, the logo
  ctx.fillStyle = PINK; ctx.fillRect(0, area, W, 10);
  const lw = 300, lh = await drawLogo(ctx, W - 48 - lw, area + 10 + (band - 10 - 72) / 2, lw);
  const textW = W - 48 - (lh ? lw + 40 : 0) - 48;
  ctx.fillStyle = WHITE; ctx.textBaseline = "alphabetic";
  fit(ctx, String(title).toUpperCase(), textW, 84, 44, archivo);
  ctx.fillText(String(title).toUpperCase(), 48, area + (sub ? 112 : 132));
  if (sub) { ctx.fillStyle = HOT; fit(ctx, sub, textW, 38, 24, outfit(600)); ctx.fillText(sub, 48, area + 162); }
  return jpeg(c);
}

// One photo for a carousel / single post: 4:5, cropped around the focus.
export async function renderFrame(img, focus) {
  const c = createCanvas(W, H), ctx = c.getContext("2d");
  ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
  cover(ctx, img, 0, 0, W, H, focus);
  return jpeg(c);
}

// ── Meet the Coach poster ───────────────────────────────────────────────────
// { img?, focus?, name: "Tara Fisher", teams: ["12 Rise", "14 Sapphire"],
//   headline?: "MEET COACH TARA", quote: "their own words", facts: [{label, value}] }
export async function renderPoster(d) {
  ensureFonts();
  const c = createCanvas(W, H), ctx = c.getContext("2d");
  ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
  const ph = 780;
  if (d.img) {
    cover(ctx, d.img, 0, 0, W, ph, d.focus || { x: 0.5, y: 0.3 });
  } else {
    const g = ctx.createLinearGradient(0, 0, W, ph); g.addColorStop(0, "#3a0a24"); g.addColorStop(1, PINK);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, ph);
    ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.font = archivo(420); ctx.textAlign = "center";
    ctx.fillText(initials(d.name), W / 2, ph / 2 + 150); ctx.textAlign = "left";
  }
  // fade the photo into the black
  const fade = ctx.createLinearGradient(0, ph - 360, 0, ph);
  fade.addColorStop(0, "rgba(10,10,10,0)"); fade.addColorStop(1, "rgba(10,10,10,1)");
  ctx.fillStyle = fade; ctx.fillRect(0, ph - 360, W, 360);
  // the tag
  ctx.save(); ctx.translate(48, 52); ctx.transform(1, 0, -0.2, 1, 0, 0);
  ctx.font = archivo(34); const tag = String(d.tag || "MEET THE COACH").toUpperCase(); const tw = ctx.measureText(tag).width;
  ctx.fillStyle = PINK; ctx.fillRect(0, 0, tw + 44, 62); ctx.fillStyle = WHITE; ctx.fillText(tag, 22, 45); ctx.restore();
  // the name
  const headline = String(d.headline || `Coach ${firstName(d.name)}`).toUpperCase();
  ctx.fillStyle = WHITE;
  const hs = fit(ctx, headline, W - 96, 132, 64, archivo);
  let y = ph - 40;
  ctx.fillText(headline, 48, y);
  y += 24;
  // the teams
  if (d.teams?.length) { y += 46; ctx.fillStyle = PINK; fit(ctx, d.teams.join("  ·  "), W - 96, 40, 26, outfit(700)); ctx.fillText(d.teams.join("  ·  "), 48, y); }
  // the quote
  y += 34;
  if (d.quote) {
    ctx.fillStyle = PINK; ctx.font = archivo(150); ctx.fillText("“", 36, y + 118);
    ctx.fillStyle = WHITE; ctx.font = outfit(600)(40);
    const lines = wrap(ctx, d.quote, W - 96 - 90, d.facts?.length ? 4 : 6);
    lines.forEach((l, i) => ctx.fillText(l, 48 + 90, y + 56 + i * 52));
    y += 56 + lines.length * 52;
  }
  // quick facts
  const facts = (d.facts || []).filter(f => f?.label && f?.value).slice(0, 3);
  const footer = H - 120;
  if (facts.length) {
    y = Math.max(y + 20, footer - 24 - facts.length * 56);
    for (const f of facts) {
      if (y > footer - 40) break;
      ctx.fillStyle = PINK; ctx.fillRect(48, y - 22, 14, 14);
      const label = String(f.label).toUpperCase() + "  ";
      ctx.font = outfit(700)(26); ctx.fillStyle = HOT; ctx.fillText(label, 78, y - 8);
      const lw = ctx.measureText(label).width;
      ctx.font = outfit(400)(32); ctx.fillStyle = WHITE;
      const v = wrap(ctx, f.value, W - 96 - 30 - lw, 1)[0] || "";
      ctx.fillText(v, 78 + lw, y - 8);
      y += 56;
    }
  }
  // footer: rule, logo, site
  ctx.fillStyle = PINK; ctx.fillRect(48, footer, W - 96, 4);
  await drawLogo(ctx, 48, footer + 28, 250);
  ctx.fillStyle = MUT; ctx.font = outfit(600)(28); ctx.textAlign = "right"; ctx.fillText(d.site || "dselitevolleyball.com", W - 48, footer + 72); ctx.textAlign = "left";
  void hs;
  return jpeg(c);
}
const firstName = (n) => String(n || "").trim().replace(/^coach\s+/i, "").split(/\s+/)[0] || "";
const initials = (n) => String(n || "").trim().split(/\s+/).map(w => w[0] || "").join("").slice(0, 2).toUpperCase();
