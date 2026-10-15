// Shared plumbing for the public website's form endpoints (api/site-optin.js,
// api/site-contact.js): CORS for dselitevolleyball.com (any origin — the forms
// hold no session), body parsing, US phone normalizing, the honeypot and a
// small per-IP throttle. Every response is JSON with a sentence a parent can read.

import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export function cors(res, methods = "POST, OPTIONS") {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Site-Test");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
}

// JSON (the site's fetch), text/plain JSON (no-preflight posts) or a plain form post.
export function readBody(req) {
  let b = req.body;
  if (Buffer.isBuffer(b)) b = b.toString("utf8");
  if (typeof b === "string") {
    const s = b.trim();
    if (!s) return {};
    try { const j = JSON.parse(s); return j && typeof j === "object" ? j : {}; }
    catch { const o = {}; for (const [k, v] of new URLSearchParams(s)) o[k] = v; return o; }
  }
  return b && typeof b === "object" ? b : {};
}

export const str = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
export const longStr = (v, max) => String(v ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
export const isEmail = (s) => /^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i.test(String(s || ""));
export const truthy = (v) => v === true || /^(1|true|yes|on)$/i.test(String(v ?? "").trim());

// US mobile → E.164 (+1XXXXXXXXXX), or null when it isn't a real-looking US number.
export function usPhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10 || !/^[2-9]\d{2}[2-9]\d{6}$/.test(d)) return null;
  return "+1" + d;
}

export const clientIp = (req) => String(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "").split(",")[0].trim().slice(0, 60) || null;

// Test mode is for the people building the site, not for visitors: the
// x-site-test header must carry a secret whose SHA-256 is the constant below
// (this repo is public, so only the hash lives here; the secret itself is
// SITE_TEST_TOKEN in the gitignored .env and is never deployed).
//   'none'    no header — a normal request
//   'valid'   the secret → test mode (nothing is emailed or texted; opt-in writes nothing)
//   'invalid' anything else → the endpoint answers 403, never a real submission
export const SITE_TEST_TOKEN_SHA256 = "8a7b376abdb86254731f9ff32592d772a619bb25c542f5626cd9eb7815ecda10";
export function testMode(req) {
  const raw = String(req.headers["x-site-test"] ?? "").trim();
  if (!raw) return "none";
  const got = createHash("sha256").update(raw).digest();
  return timingSafeEqual(got, Buffer.from(SITE_TEST_TOKEN_SHA256, "hex")) ? "valid" : "invalid";
}
export const badTestToken = (res) => res.status(403).json({ ok: false, error: "That test token isn't valid." });

// Per warm function instance: a burst from one IP is turned away politely.
const hits = new Map();
export function throttled(key, { max = 8, windowMs = 10 * 60 * 1000 } = {}) {
  if (!key) return false;
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 2000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return list.length > max;
}

export function serviceClient() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
