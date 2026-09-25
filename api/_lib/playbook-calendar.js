// Pull DSSC's Playbook calendar without a browser.
//
// The public calendar page (/programs/calendar/ — no login) draws its events
// from a WebSocket on the same path: the page sends
//   { csrf_token, site_pk, action: "get_site_calendar_events", start, end, ...filters }
// and gets back { action_name, events: [...] }. The token and site id are
// printed into the page's script, so one GET of the page is enough to ask.
// This is exactly what the sync bookmarklet read out of FullCalendar; doing it
// here is what lets the hourly cron keep classes current on its own.
//
// Times: the socket returns UTC ("2026-11-04T23:00:00+00:00"). FullCalendar in
// the browser rendered them in Central, and the sync reads the clock straight
// off the string, so each event is rewritten as Central wall time here.
//
// A pull that comes back empty throws rather than returning [] — an empty
// answer fed to the sync would read as "Playbook cancelled everything".

const BASE = "https://drippingsports.playbookapi.com";
const CAL = BASE + "/programs/calendar/";
const UA = "Mozilla/5.0 (DS Elite HQ calendar sync)";

const partsFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
export const centralISO = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(partsFmt.formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}:${p.second}`;
};
export const centralToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
export const addDays = (ymd, n) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// start inclusive, end exclusive (FullCalendar's convention, which the socket follows).
export async function fetchPlaybookEvents(start, end, { timeoutMs = 50000 } = {}) {
  if (typeof WebSocket !== "function") throw new Error("This runtime has no WebSocket client (needs Node 22+).");
  const page = await fetch(CAL, { headers: { "User-Agent": UA } });
  if (!page.ok) throw new Error("Playbook calendar page returned HTTP " + page.status);
  const html = await page.text();
  const token = (/const csrf_token = '([^']+)'/.exec(html) || [])[1];
  const site = (/'site_pk':\s*'(\d+)'/.exec(html) || [])[1];
  if (!token || !site) throw new Error("Playbook calendar page didn't expose its token/site id — layout changed?");

  const raw = await new Promise((resolve, reject) => {
    const ws = new WebSocket(CAL.replace(/^https:/, "wss:"));
    let settled = false;
    const done = (fn, v) => { if (settled) return; settled = true; clearTimeout(timer); try { ws.close(); } catch { /* already closed */ } fn(v); };
    const timer = setTimeout(() => done(reject, new Error("Playbook calendar socket timed out after " + Math.round(timeoutMs / 1000) + "s")), timeoutMs);
    ws.addEventListener("open", () => ws.send(JSON.stringify({
      csrf_token: token, site_pk: site, action: "get_site_calendar_events", start, end,
      types_from_filter: [], resources_from_filter: [], programs_from_filter: [], seasons_from_filter: [], categories_from_filter: [], teams_from_filter: [],
    })));
    ws.addEventListener("message", (m) => {
      let d; try { d = JSON.parse(m.data); } catch { return; }
      if (d.action_name !== "get_site_calendar_events") return;
      done(resolve, Array.isArray(d.events) ? d.events : []);
    });
    ws.addEventListener("error", () => done(reject, new Error("Playbook calendar socket errored")));
    ws.addEventListener("close", (e) => done(reject, new Error("Playbook calendar socket closed before answering (" + e.code + ")")));
  });
  if (!raw.length) throw new Error("Playbook returned no events for " + start + " → " + end + "; not syncing an empty calendar.");

  // Same shape the bookmarklet posts: { start, end, ext: {...} }.
  return raw.map(e => ({
    title: e.title, start: centralISO(e.start), end: centralISO(e.end),
    ext: { event_type: e.event_type, event_program: e.event_program, event_category: e.event_category, event_teams: e.event_teams, contents: e.contents },
  })).filter(e => e.start);
}
