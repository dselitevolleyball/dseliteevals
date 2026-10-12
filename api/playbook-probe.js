// TEMPORARY (Oct 12 2026): find where Playbook keeps court reservations with
// their times, so Court Availability can show rentals and DS Elite's own
// reservations. Read-only. Service-role bearer only. Delete once answered.
const BASE = "https://drippingsports.playbookapi.com";
const SIGNIN = BASE + "/account/signin/";
const UA = "Mozilla/5.0 (DS Elite HQ court probe)";

function jar() {
  const c = {};
  return {
    take(res) { for (const line of (res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")].filter(Boolean))) { const m = /^([^=]+)=([^;]*)/.exec(line); if (m) c[m[1].trim()] = m[2]; } },
    header() { return Object.entries(c).map(([k, v]) => k + "=" + v).join("; "); },
    get(k) { return c[k]; },
  };
}
async function signIn(email, password) {
  const j = jar(); const next = "/control_panel/";
  const page = await fetch(SIGNIN + "?next=" + encodeURIComponent(next), { headers: { "User-Agent": UA } }); j.take(page);
  const html = await page.text();
  const token = (/name="csrfmiddlewaretoken" value="([^"]+)"/.exec(html) || [])[1];
  const r = await fetch(SIGNIN + "?next=" + encodeURIComponent(next), { method: "POST", redirect: "manual", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", Cookie: j.header(), Referer: SIGNIN, Origin: BASE }, body: new URLSearchParams({ csrfmiddlewaretoken: token, next, email, password }).toString() });
  j.take(r); if (r.status !== 302 && r.status !== 303) throw new Error("sign-in HTTP " + r.status); return j;
}
const snip = (html, re, n = 12) => { const out = []; let m; const rx = new RegExp(re, "gi"); while ((m = rx.exec(html)) && out.length < n) out.push(html.slice(Math.max(0, m.index - 120), m.index + 220).replace(/\s+/g, " ")); return out; };

export default async function handler(req, res) {
  const { SUPABASE_SERVICE_ROLE_KEY, PLAYBOOK_SYNC_EMAIL, PLAYBOOK_SYNC_PASSWORD } = process.env;
  if (String(req.headers.authorization || "").replace(/^Bearer\s+/i, "") !== SUPABASE_SERVICE_ROLE_KEY) return res.status(403).json({ error: "no" });
  const url = new URL(req.url, "https://x");
  const day = url.searchParams.get("day") || "2026-10-18";
  const out = {};
  const j = await signIn(PLAYBOOK_SYNC_EMAIL, PLAYBOOK_SYNC_PASSWORD);
  const get = async (path) => { const r = await fetch(BASE + path, { headers: { "User-Agent": UA, Cookie: j.header() }, redirect: "manual" }); const t = await r.text().catch(() => ""); return { status: r.status, len: t.length, html: t }; };

  // 1. Control-panel pages that might hold a facility calendar / reservations.
  const cp = await get("/control_panel/");
  out.cpLinks = [...new Set((cp.html.match(/href="(\/control_panel\/[^"#?]*)"/g) || []).map(s => s.slice(6, -1)))].filter(h => /calend|reserv|rent|facil|court|schedul|book|resource|timeslot/i.test(h)).slice(0, 40);
  for (const p of [...out.cpLinks.slice(0, 6), "/programs/calendar/"]) {
    const g = await get(p);
    out["page " + p] = { status: g.status, len: g.len, actions: [...new Set((g.html.match(/action["']?\s*[:=]\s*["']([a-z_]+)["']/gi) || []).map(s => s.replace(/.*["']([a-z_]+)["']$/i, "$1")))].slice(0, 40), ws: snip(g.html, "new WebSocket|wss?://|socket", 4), types: snip(g.html, "RentableTimeslot|reservation", 4) };
  }

  // 2. The calendar socket with the signed-in cookies, asking for reservations.
  const cal = await get("/programs/calendar/");
  const token = (/const csrf_token = '([^']+)'/.exec(cal.html) || [])[1], site = (/'site_pk':\s*'(\d+)'/.exec(cal.html) || [])[1];
  const ask = (types) => new Promise((resolve) => {
    let ws; try { ws = new WebSocket(BASE.replace("https", "wss") + "/programs/calendar/", { headers: { Cookie: j.header(), "User-Agent": UA } }); } catch (e) { return resolve({ error: "ctor: " + e.message }); }
    const t = setTimeout(() => { try { ws.close(); } catch {} resolve({ error: "timeout" }); }, 25000);
    ws.addEventListener("open", () => ws.send(JSON.stringify({ csrf_token: token, site_pk: site, action: "get_site_calendar_events", start: day, end: day.replace(/\d\d$/, d => String(+d + 1).padStart(2, "0")), types_from_filter: types, resources_from_filter: [], programs_from_filter: [], seasons_from_filter: [], categories_from_filter: [], teams_from_filter: [] })));
    ws.addEventListener("message", (m) => { let d; try { d = JSON.parse(m.data); } catch { return; } if (d.action_name !== "get_site_calendar_events") return; clearTimeout(t); try { ws.close(); } catch {} const ev = d.events || []; resolve({ n: ev.length, types: [...new Set(ev.map(e => e.event_type))], sample: ev.filter(e => e.event_type !== "ClassSession").slice(0, 6).map(e => ({ type: e.event_type, title: e.title, start: e.start, end: e.end, res: e.resourceIds, contents: String(e.contents || "").slice(0, 200) })) }); });
    ws.addEventListener("error", (e) => { clearTimeout(t); resolve({ error: "ws error " + (e.message || "") }); });
  });
  out.socketAll = await ask([]);
  out.socketRentable = await ask(["RentableTimeslot"]);
  out.socketPractice = await ask(["Practice"]);

  // 3. Raw registrations-report rows for court rentals (does start_date carry a time?).
  const rep = await get("/control_panel/dashboards/all_registrations_report/?action=export-all-pages&results_per_page=50&min_age=0&max_age=65");
  const lines = rep.html.split(/\r?\n/);
  out.reportHeader = lines[0]?.slice(0, 600);
  out.reportCourtRows = lines.filter(l => /court|flex/i.test(l) && l.includes(day.slice(5).replace("-", "/").replace(/^0/, ""))).slice(0, 6).map(l => l.replace(/[^,]*@[^,]*/g, "<email>").slice(0, 400));
  if (!out.reportCourtRows.length) out.reportCourtRows = lines.filter(l => /volleyball court|dssc flex/i.test(l)).slice(0, 4).map(l => l.replace(/[^,]*@[^,]*/g, "<email>").slice(0, 400));
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(out);
}
