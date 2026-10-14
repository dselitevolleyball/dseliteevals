// TEMPORARY (Oct 12-14 2026, approved by Drew): find where Playbook keeps court
// reservations with their times and courts, so Court Availability can draw
// every rental. Read-only: GETs and the calendar socket's read action only.
// Service-role bearer only. Delete once answered.
const BASE = "https://drippingsports.playbookapi.com";
const SIGNIN = BASE + "/account/signin/";
const UA = "Mozilla/5.0 (DS Elite HQ court probe)";

function jar() {
  const c = {};
  return {
    take(res) { for (const line of (res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")].filter(Boolean))) { const m = /^([^=]+)=([^;]*)/.exec(line); if (m) c[m[1].trim()] = m[2]; } },
    header() { return Object.entries(c).map(([k, v]) => k + "=" + v).join("; "); },
    get(k) { return c[k]; },
    names() { return Object.keys(c); },
  };
}
async function signIn(email, password) {
  const j = jar(); const next = "/control_panel/";
  const page = await fetch(SIGNIN + "?next=" + encodeURIComponent(next), { headers: { "User-Agent": UA } }); j.take(page);
  const html = await page.text();
  const token = (/name="csrfmiddlewaretoken" value="([^"]+)"/.exec(html) || [])[1];
  const r = await fetch(SIGNIN + "?next=" + encodeURIComponent(next), { method: "POST", redirect: "manual", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", Cookie: j.header(), Referer: SIGNIN, Origin: BASE }, body: new URLSearchParams({ csrfmiddlewaretoken: token, next, email, password }).toString() });
  j.take(r); if (r.status !== 302 && r.status !== 303) throw new Error("sign-in HTTP " + r.status);
  return { j, location: r.headers.get("location") };
}
const snip = (html, re, n = 8, w = 260) => { const out = []; let m; const rx = new RegExp(re, "gi"); while ((m = rx.exec(html)) && out.length < n) out.push(html.slice(Math.max(0, m.index - 100), m.index + w).replace(/\s+/g, " ")); return out; };

export default async function handler(req, res) {
  const { SUPABASE_SERVICE_ROLE_KEY, PLAYBOOK_SYNC_EMAIL, PLAYBOOK_SYNC_PASSWORD } = process.env;
  if (String(req.headers.authorization || "").replace(/^Bearer\s+/i, "") !== SUPABASE_SERVICE_ROLE_KEY) return res.status(403).json({ error: "no" });
  const url = new URL(req.url, "https://x");
  const day = url.searchParams.get("day") || "2026-10-13";
  const end = new Date(Date.parse(day + "T12:00:00Z") + 864e5).toISOString().slice(0, 10);
  const only = url.searchParams.get("path");
  const out = {};
  const { j, location } = await signIn(PLAYBOOK_SYNC_EMAIL, PLAYBOOK_SYNC_PASSWORD);
  out.signin = { location, cookies: j.names() };
  // GET that follows redirects by hand, keeping cookies.
  const get = async (path) => {
    let u = path.startsWith("http") ? path : BASE + path, hops = [];
    for (let i = 0; i < 6; i++) {
      const r = await fetch(u, { headers: { "User-Agent": UA, Cookie: j.header(), Referer: BASE + "/control_panel/" }, redirect: "manual" });
      j.take(r);
      if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { hops.push(r.status + " " + r.headers.get("location")); u = new URL(r.headers.get("location"), u).toString(); continue; }
      const t = await r.text().catch(() => "");
      return { status: r.status, url: u.replace(BASE, ""), hops, len: t.length, html: t };
    }
    return { status: 0, url: u, hops, len: 0, html: "" };
  };
  const describe = (g) => ({
    status: g.status, url: g.url, hops: g.hops, len: g.len,
    title: (/<title>([^<]*)<\/title>/i.exec(g.html) || [])[1],
    links: [...new Set((g.html.match(/href="(\/control_panel\/[^"#]*)"/g) || []).map(s => s.slice(6, -1)))].slice(0, 120),
    ws: snip(g.html, "WebSocket\\(|wss?://|socket_url|ws_path|ws\\.init", 6),
    actions: [...new Set((g.html.match(/["']?action["']?\s*:\s*["']([a-z_]+)["']/gi) || []).map(s => s.replace(/.*["']([a-z_]+)["']$/i, "$1")))].slice(0, 60),
    tokens: { csrf: /csrf_token\s*=\s*'[^']+'/.test(g.html), site: (/'site_pk':\s*'(\d+)'/.exec(g.html) || [])[1] || null },
    reserv: snip(g.html, "RentableTimeslot|reservation|rentable", 6),
  });

  if (only) { const g = await get(only); out.page = describe(g); out.raw = g.html.slice(0, 4000); res.setHeader("Cache-Control", "no-store"); return res.status(200).json(out); }

  for (const p of ["/control_panel/", "/control_panel/calendar/", "/control_panel/facilities/calendar/", "/control_panel/schedule/", "/control_panel/facilities/", "/control_panel/reservations/"]) {
    const g = await get(p);
    out["page " + p] = describe(g);
  }

  // The calendar socket on the staff calendar path, signed in, asking for reservations.
  const tryWs = async (path, types) => {
    const g = await get(path);
    const token = (/csrf_token\s*=\s*'([^']+)'/.exec(g.html) || [])[1], site = (/'site_pk':\s*'(\d+)'/.exec(g.html) || [])[1];
    if (!token) return { error: "no csrf_token on " + path, status: g.status, url: g.url };
    return await new Promise((resolve) => {
      let ws; try { ws = new WebSocket(BASE.replace("https", "wss") + path, { headers: { Cookie: j.header(), "User-Agent": UA, Origin: BASE } }); } catch (e) { return resolve({ error: "ctor: " + e.message }); }
      const t = setTimeout(() => { try { ws.close(); } catch {} resolve({ error: "timeout" }); }, 25000);
      ws.addEventListener("open", () => ws.send(JSON.stringify({ csrf_token: token, site_pk: site, action: "get_site_calendar_events", start: day, end, types_from_filter: types, resources_from_filter: [], programs_from_filter: [], seasons_from_filter: [], categories_from_filter: [], teams_from_filter: [] })));
      ws.addEventListener("message", (m) => { let d; try { d = JSON.parse(m.data); } catch { return; } clearTimeout(t); try { ws.close(); } catch {} const ev = d.events || []; resolve({ action: d.action_name, keys: Object.keys(d).slice(0, 20), n: ev.length, types: [...new Set(ev.map(e => e.event_type))], sample: ev.filter(e => e.event_type !== "ClassSession").slice(0, 8).map(e => ({ type: e.event_type, title: e.title, start: e.start, end: e.end, res: e.resourceIds, contents: String(e.contents || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 300) })) }); });
      ws.addEventListener("error", (e) => { clearTimeout(t); resolve({ error: "ws error " + (e.message || "") }); });
    });
  };
  out.wsControlCal = await tryWs("/control_panel/calendar/", ["RentableTimeslot"]);
  out.wsControlCalAll = await tryWs("/control_panel/calendar/", []);
  out.wsFacilitiesCal = await tryWs("/control_panel/facilities/calendar/", ["RentableTimeslot"]);
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(out);
}
