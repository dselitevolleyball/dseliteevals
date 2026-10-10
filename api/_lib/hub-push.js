// Tournament Hub push — Web Push to everyone following a DS Elite team at a
// tournament: parents who tapped "Notify me" on /hub (hub_push_subscriptions)
// and the team's own coaches (push_subscriptions rows whose teams include it).
//
// The two tables stay apart on purpose: coach broadcasts (api/send-push.js)
// read only push_subscriptions, so nothing a director sends coaches can ever
// reach a parent. Hub alerts read both, and a device that is in both (a coach
// who also tapped "Notify me" on /hub registers the same /sw.js, so the same
// endpoint) gets one notification, not two.
//
// Admins are NOT added to every team here (send-push's "team" audience does
// that): a tournament weekend is ~40 results across 20 teams, and Drew asked
// for alerts to go to the people following that team (design contract, 10
// Oct 2026: "exclude admins unless their teams contain it").
//
// Expired subscriptions (404/410 from the push service) are deleted from
// whichever table they came from, and so is one whose keys web-push can't
// even encrypt to (not a real P-256 point — it can never work). Any other
// failure bumps hub_push_subscriptions.failures (consecutive — reset on the
// next success, with last_ok_at); a parent row is deleted on its third 400 /
// 403 in a row, but only when the same push service took another device's
// message in that send (so a bad VAPID config on our side, which fails every
// device, never wipes the table). Network errors and 5xx never delete.
//
// TTL is 3 hours: "Next: 2:30 PM · Court 7" delivered the next morning is
// worse than nothing, and a phone that was off all evening shouldn't wake up
// to a stack of stale match alerts. Each send times out after 6 s so one hung
// push service can't carry the sync past its 120 s limit.
//
// Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (opt) — the same
// keys as api/send-push.js, so the SPA's and /hub's subscriptions both work.

import webpush from "web-push";

const TTL_SECONDS = 3 * 3600;
const SEND_CONCURRENCY = 10;
const SEND_TIMEOUT_MS = 6000;
const PRUNE_AFTER = 3;             // consecutive 400/403 answers before a parent row goes
const PAGE = 1000, MAX_PAGES = 50; // PostgREST max_rows is 1000 on this project

// "14 Diamond" → "14-diamond" — the /hub?team= slug (design contract).
export const teamSlug = (name) => String(name || "").trim().toLowerCase().replace(/\s+/g, "-");

export const hubPushReady = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

let vapidSet = false;
function realSender(ttl) {
  if (!vapidSet) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:drew@dselitevolleyball.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    vapidSet = true;
  }
  return (sub, data) => webpush.sendNotification(sub, data, { TTL: ttl, urgency: "high", timeout: SEND_TIMEOUT_MS });
}

// Every row of a table. PostgREST silently stops at max_rows (1000 here), so
// one plain select would drop whoever sorts past it — read in pages ordered
// by endpoint (unique in both tables) until a page comes back empty.
async function readAll(sb, table, cols) {
  const out = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await sb.from(table).select(cols).order("endpoint").range(out.length, out.length + PAGE - 1);
    if (r.error) throw new Error(table + ": " + r.error.message);
    if (!r.data?.length) break;
    out.push(...r.data);
  }
  return out;
}

// Both subscription tables, once per sync run.
export async function loadPushTargets(sb) {
  const [hub, coach] = await Promise.all([
    readAll(sb, "hub_push_subscriptions", "endpoint, p256dh, auth, teams, failures"),
    readAll(sb, "push_subscriptions", "endpoint, p256dh, auth, teams, is_admin"),
  ]);
  return { hub, coach };
}

// web-push refused the subscription itself before sending anything (p256dh
// not a P-256 point, wrong length, no endpoint): it can never be delivered.
// Our own VAPID problems and network errors don't match.
const BAD_SUB = /^(The subscription |You must pass in a subscription|No user (public key|auth)|Public key is not valid)/;
const unusable = (e) => !e?.statusCode && (e?.code === "ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY" || BAD_SUB.test(String(e?.message || "")));
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ""; } };

// Everyone following `teamName`, one entry per endpoint. srcs says which
// table(s) the endpoint is in, so cleanup hits the right rows.
export function targetsForTeam(targets, teamName) {
  const byEndpoint = new Map();
  const follows = (s) => Array.isArray(s?.teams) && s.teams.includes(teamName);
  for (const [src, list] of [["hub", targets?.hub], ["coach", targets?.coach]]) {
    for (const s of list || []) {
      if (!s?.endpoint || !s.p256dh || !s.auth || !follows(s)) continue;
      const cur = byEndpoint.get(s.endpoint);
      if (cur) { if (!cur.srcs.includes(src)) cur.srcs.push(src); continue; }
      byEndpoint.set(s.endpoint, { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth, failures: s.failures ?? 0, srcs: [src] });
    }
  }
  return [...byEndpoint.values()];
}

// What /sw.js shows: title, body, the team's hub page on tap, and a per-team
// tag so a team's newer alert replaces its older one in the tray.
export function hubPayload(teamName, body) {
  const slug = teamSlug(teamName);
  return { title: `DS Elite ${teamName}`, body: String(body || "").slice(0, 900), url: `/hub?team=${encodeURIComponent(slug)}`, tag: `hub-${slug}` };
}

// Send one payload to targets. opts.sender(sub, json) replaces web-push (tests
// pass a stub — nothing leaves the machine); opts.cleanup:false skips the
// table writes (tests again). → { sent, removed, failed, gone, errors }
export async function sendPush(sb, targets, payload, { sender = null, cleanup = true, ttl = TTL_SECONDS } = {}) {
  const data = typeof payload === "string" ? payload : JSON.stringify(payload);
  const send = sender || realSender(ttl);
  const out = { sent: 0, removed: 0, failed: 0, gone: [], errors: [] };
  const goneBy = { hub: [], coach: [] }, okHub = [], badHub = [], okHosts = new Set();
  const list = [...(targets || [])];
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const t = list[i++];
      try {
        await send({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, data);
        out.sent++;
        okHosts.add(hostOf(t.endpoint));
        if (t.srcs.includes("hub")) okHub.push(t.endpoint);
      } catch (e) {
        const code = Number(e?.statusCode);
        if (code === 404 || code === 410 || unusable(e)) {
          out.removed++; out.gone.push(t.endpoint);
          for (const s of t.srcs) goneBy[s].push(t.endpoint);
        } else {
          out.failed++;
          if (out.errors.length < 5) out.errors.push(String(code || "") + " " + String(e?.body || e?.message || e).slice(0, 120));
          if (t.srcs.includes("hub")) badHub.push({ t, code });
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, list.length) }, worker));

  // Third 400/403 in a row for a parent device, while the same push service
  // took someone else's message just now → that subscription is dead.
  const prune = [];
  for (const b of badHub) {
    const n = (Number(b.t.failures) || 0) + 1;
    if ((b.code === 400 || b.code === 403) && n >= PRUNE_AFTER && okHosts.has(hostOf(b.t.endpoint))) { prune.push(b.t.endpoint); out.removed++; out.gone.push(b.t.endpoint); }
    else b.n = n;
  }

  if (cleanup && sb) {
    const now = new Date().toISOString();
    const jobs = [];
    // Endpoints ride in the URL (~190 chars each), so lists go 40 at a time.
    const each = (eps, fn) => { for (let k = 0; k < eps.length; k += 40) jobs.push(fn(eps.slice(k, k + 40))); };
    each([...goneBy.hub, ...prune], (eps) => sb.from("hub_push_subscriptions").delete().in("endpoint", eps));
    each(goneBy.coach, (eps) => sb.from("push_subscriptions").delete().in("endpoint", eps));
    each(okHub, (eps) => sb.from("hub_push_subscriptions").update({ last_ok_at: now, failures: 0, updated_at: now }).in("endpoint", eps));
    const byCount = new Map();
    for (const b of badHub) if (b.n) byCount.set(b.n, [...(byCount.get(b.n) || []), b.t.endpoint]);
    for (const [n, eps] of byCount) each(eps, (part) => sb.from("hub_push_subscriptions").update({ failures: n, updated_at: now }).in("endpoint", part));
    const res = await Promise.allSettled(jobs);
    for (const r of res) if (r.status === "fulfilled" && r.value?.error) out.errors.push("cleanup: " + r.value.error.message);
  }
  return out;
}
