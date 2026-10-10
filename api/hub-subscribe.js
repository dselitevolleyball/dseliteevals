// Tournament Hub — save or remove a "Notify me" web-push subscription from the
// public /hub page (api/hub.js).
//
//   POST   /api/hub-subscribe  {subscription:{endpoint, keys:{p256dh, auth}}, teams:["14 Diamond", ...]}
//          → upserts hub_push_subscriptions (one row per browser endpoint; posting
//            again replaces its team list — the page re-posts when a parent
//            follows or unfollows a team while alerts are on)
//          ← { ok, teams }
//   DELETE /api/hub-subscribe  {endpoint}   (or ?endpoint=)
//          ← { ok, removed }
//
// No login: anyone with the hub link can follow a team, the same as anyone can
// read AES. The rows live in hub_push_subscriptions (service role only, no RLS
// policies), deliberately apart from the coaches' push_subscriptions so a coach
// broadcast from api/send-push.js can never reach a parent. api/tournament-sync.js
// sends from here (state-based alerts, recorded in hub_alerts_sent) and deletes
// a row when the push service answers 404/410.
//
// Guardrails, since the endpoint is open:
//   - bodies over 4 KB are refused (a real subscription + 10 teams is ~700 bytes)
//   - the endpoint must be https on a known browser push service (FCM, Mozilla,
//     Windows, Apple) — never an arbitrary URL our cron would later POST to
//   - keys must be a real P-256 public key (a point on the curve) and a 16-byte
//     auth secret — exactly what web-push can encrypt to, so junk keys never
//     reach the table the sync reads every run
//   - teams must be current, public DS Elite teams (event teams like 14 Crystal
//     excluded, shared/event-teams.js), at most 10; names or /hub slugs accepted
//   - at most MAX_SUBS rows: once full, a NEW endpoint gets 503 (an existing
//     one can still change its teams), so a flood of fake subscriptions can't
//     grow the table without bound — api/_lib/hub-push.js pages through it
//     and prunes dead rows, the cap keeps one sync run's send list bounded
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createECDH } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { isEventTeam } from "../shared/event-teams.js";
import { slugOf } from "./hub-data.js";

const MAX_BODY = 4096;
const MAX_TEAMS = 10;
// DS Elite has ~20 teams; even 100 parents a team is 2000 browsers.
export const MAX_SUBS = 5000;
// Browser push services. Chrome/Edge-on-Android/Samsung/Opera/Brave → FCM,
// Firefox → Mozilla autopush, Edge on Windows → WNS, Safari (macOS and iOS
// Home Screen apps) → web.push.apple.com.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/i,
  /^android\.googleapis\.com$/i,
  /^(?:[a-z0-9-]+\.)*push\.services\.mozilla\.com$/i,
  /^(?:[a-z0-9-]+\.)*notify\.windows\.com$/i,
  /^(?:[a-z0-9-]+\.)*push\.apple\.com$/i,
];
const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

export function validEndpoint(s) {
  const str = String(s || "");
  if (!str || str.length > 1024) return null;
  let u;
  try { u = new URL(str); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
  if (!PUSH_HOSTS.some((re) => re.test(u.hostname))) return null;
  return str;
}

const b64uBytes = (s) => Buffer.from(String(s).replace(/=+$/, ""), "base64url");

// p256dh: the browser's P-256 public key, an uncompressed point (65 bytes,
// 0x04 ‖ X ‖ Y → 87 base64url chars) that must lie on the curve — checked the
// way web-push will use it, an ECDH agreement with a throwaway key (Node
// throws for a point off the curve). auth: exactly 16 bytes (22 chars).
// Anything else web-push refuses at send time.
export function validKeys(keys) {
  const p256dh = String(keys?.p256dh || ""), auth = String(keys?.auth || "");
  if (!B64URL.test(p256dh) || p256dh.length > 100 || !B64URL.test(auth) || auth.length > 32) return null;
  const pub = b64uBytes(p256dh), secret = b64uBytes(auth);
  if (pub.length !== 65 || pub[0] !== 0x04 || secret.length !== 16) return null;
  try {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys(); // computeSecret needs our own key pair first
    ecdh.computeSecret(pub);
  } catch {
    return null;
  }
  return { p256dh, auth };
}

function readBody(req) {
  const len = Number(req.headers["content-length"] || 0);
  if (len > MAX_BODY) return { tooBig: true };
  let b = req.body;
  if (Buffer.isBuffer(b)) b = b.toString("utf8");
  if (typeof b === "string") {
    if (b.length > MAX_BODY) return { tooBig: true };
    try { b = b.trim() ? JSON.parse(b) : {}; } catch { return { bad: true }; }
  }
  if (b && typeof b === "object" && JSON.stringify(b).length > MAX_BODY) return { tooBig: true };
  return { body: b && typeof b === "object" ? b : {} };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST" && req.method !== "DELETE") {
    res.setHeader("Allow", "POST, DELETE");
    return res.status(405).json({ ok: false, error: "POST or DELETE only" });
  }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ ok: false, error: "Not configured" });
  return hubSubscribe(req, res, createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }));
}

// The handler with its Supabase client passed in (scripts and tests).
export async function hubSubscribe(req, res, sb) {
  const { body, tooBig, bad } = readBody(req);
  if (tooBig) return res.status(413).json({ ok: false, error: "Request too large" });
  if (bad) return res.status(400).json({ ok: false, error: "Body must be JSON" });

  if (req.method === "DELETE") {
    const q = new URL(req.url || "/", "https://x").searchParams.get("endpoint");
    const endpoint = validEndpoint(body.endpoint || body.subscription?.endpoint || q);
    if (!endpoint) return res.status(400).json({ ok: false, error: "endpoint must be a browser push service URL" });
    const { data, error } = await sb.from("hub_push_subscriptions").delete().eq("endpoint", endpoint).select("endpoint");
    if (error) return res.status(500).json({ ok: false, error: "Couldn't remove that subscription" });
    return res.status(200).json({ ok: true, removed: (data || []).length });
  }

  const sub = body.subscription || {};
  const endpoint = validEndpoint(sub.endpoint);
  if (!endpoint) return res.status(400).json({ ok: false, error: "subscription.endpoint must be a browser push service URL" });
  const keys = validKeys(sub.keys);
  if (!keys) return res.status(400).json({ ok: false, error: "subscription.keys (p256dh, auth) are missing or malformed" });
  if (!Array.isArray(body.teams) || !body.teams.length) return res.status(400).json({ ok: false, error: "Pick at least one team" });
  if (body.teams.length > 30) return res.status(400).json({ ok: false, error: `At most ${MAX_TEAMS} teams` });

  const { data: pts, error: ptErr } = await sb.from("practice_teams").select("team_name, practices_per_week");
  if (ptErr) return res.status(500).json({ ok: false, error: "Couldn't check teams" });
  const real = (pts || []).filter((t) => t.team_name && !isEventTeam(t)).map((t) => t.team_name);
  const resolve = (x) => {
    const s = String(x || "").trim().toLowerCase();
    return real.find((n) => n.toLowerCase() === s || slugOf(n) === slugOf(s)) || null;
  };
  const teams = [], unknown = [];
  for (const x of body.teams) {
    const n = resolve(x);
    if (!n) unknown.push(String(x).slice(0, 40));
    else if (!teams.includes(n)) teams.push(n);
  }
  if (unknown.length) return res.status(400).json({ ok: false, error: `Not a DS Elite team: ${unknown.join(", ")}` });
  if (teams.length > MAX_TEAMS) return res.status(400).json({ ok: false, error: `At most ${MAX_TEAMS} teams` });

  // Full table: a browser already on the list can still change its teams; a
  // new one is turned away until dead rows are pruned.
  const { data: have, error: haveErr } = await sb.from("hub_push_subscriptions").select("endpoint").eq("endpoint", endpoint).limit(1);
  if (haveErr) return res.status(500).json({ ok: false, error: "Couldn't save that subscription" });
  if (!have?.length) {
    const { count, error: cntErr } = await sb.from("hub_push_subscriptions").select("endpoint", { count: "exact", head: true });
    if (cntErr || count == null) return res.status(500).json({ ok: false, error: "Couldn't save that subscription" });
    if (count >= MAX_SUBS) {
      res.setHeader("Retry-After", "3600");
      return res.status(503).json({ ok: false, error: "Alerts are full right now. Try again later. The hub page still updates live." });
    }
  }

  const { error } = await sb.from("hub_push_subscriptions").upsert(
    { endpoint, p256dh: keys.p256dh, auth: keys.auth, teams, updated_at: new Date().toISOString(), failures: 0 },
    { onConflict: "endpoint" },
  );
  if (error) return res.status(500).json({ ok: false, error: "Couldn't save that subscription" });
  return res.status(200).json({ ok: true, teams });
}
