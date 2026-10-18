// POST /api/site-track — first-party, cookie-free analytics for dselitevolleyball.com.
//
// The site sends small batches with navigator.sendBeacon (text/plain JSON, so no CORS preflight):
//   { v: visitorId, s: sessionId, d: 'mobile'|'tablet'|'desktop', events: [{ t: 'view'|'click'|'scroll'|'signup'|'feedback', p: path, l?: label, r?: refHost, us?, um?, uc? }] }
// visitorId is a random string the browser keeps in localStorage: no cookie, no name, email or IP stored.
// Country/region come from Vercel's geo headers. Read by site_stats() for HQ → Website → Visitors and the
// monthly report (api/site-report.js).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { cors, readBody, str, clientIp, throttled, serviceClient } from "./_lib/site-forms.js";

const TYPES = new Set(["view", "click", "scroll", "signup", "feedback"]);
const DEVICES = new Set(["mobile", "tablet", "desktop"]);
const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|monitor/i;

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  if (BOT.test(String(req.headers["user-agent"] || ""))) return res.status(204).end();
  if (throttled("track:" + clientIp(req), { max: 300 })) return res.status(204).end();

  const b = readBody(req);
  const visitor = str(b.v, 40), session = str(b.s, 40);
  if (!visitor || !session || !Array.isArray(b.events)) return res.status(204).end();
  const device = DEVICES.has(b.d) ? b.d : null;
  const country = str(req.headers["x-vercel-ip-country"], 4) || null;
  const region = decodeURIComponent(str(req.headers["x-vercel-ip-country-region"], 40)) || null;
  const rows = b.events.slice(0, 40).filter((e) => e && TYPES.has(e.t) && typeof e.p === "string").map((e) => ({
    type: e.t, path: str(e.p, 200) || "/", label: str(e.l, 160) || null, ref_host: str(e.r, 120) || null,
    utm_source: str(e.us, 80) || null, utm_medium: str(e.um, 80) || null, utm_campaign: str(e.uc, 120) || null,
    visitor, session, device, country, region,
  }));
  if (!rows.length) return res.status(204).end();
  const sb = serviceClient();
  if (sb) { const { error } = await sb.from("site_events").insert(rows); if (error) console.error("site-track", error.message); }
  return res.status(204).end();
}
