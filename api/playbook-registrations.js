// Every hour: pull Playbook's registrations report into the class rosters.
//
// Playbook has no API, but its "Export All" on the registrations report is a
// plain GET that a signed-in session can fetch, and its sign-in is an ordinary
// Django form (csrf cookie + hidden token, email, password — no captcha). So
// this signs in as the HQ sync login, fetches the report, and runs it through
// the same importer the admin upload and the bookmarklet use. Class rosters are
// only ever added to. The one removal: a future court reservation that's no
// longer on the report was deleted in Playbook, so it comes off Court
// Availability (pruneDeletedReservations, with guards against a bad export).
//
// Registrations for classes HQ doesn't have yet (a month not synced on the
// calendar) are counted and reported once, so the director knows to run the
// calendar sync; the next pull then attaches them.
//
// Auth: Vercel Cron `Authorization: Bearer <CRON_SECRET>`; also ?token=.
// Query: ?dry=1 — sign in, fetch, match, write nothing.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
//      PLAYBOOK_SYNC_EMAIL, PLAYBOOK_SYNC_PASSWORD  (a Playbook staff login
//      with access to Reports → Registrations; a dedicated "HQ Sync" user is
//      better than a person's own account).

import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";
import { importRoster } from "./_lib/dssc-roster-import.js";
import { importPlaybookRegistrations, pruneDeletedReservations, importPlaybookSpend, isPlaybookSpendExport } from "./_lib/dssc-crm.js";
import { appOrigin } from "../shared/app-origin.js";

const BASE = "https://drippingsports.playbookapi.com";
const SIGNIN = BASE + "/account/signin/";
const REPORT = BASE + "/control_panel/dashboards/all_registrations_report/?action=export-all-pages&results_per_page=50&min_age=0&max_age=65";
const NOTIFY = ["drew@dselitevolleyball.com", "hunterhaleysc10@gmail.com", "hunter@drippingsportsclub.com"];
const UA = "Mozilla/5.0 (DS Elite HQ registrations sync)";

// Minimal cookie jar: Playbook sets csrftoken + sessionid; keep whatever it sends.
function jar() {
  const c = {};
  return {
    take(res) { for (const line of (res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")].filter(Boolean))) { const m = /^([^=]+)=([^;]*)/.exec(line); if (m) c[m[1].trim()] = m[2]; } },
    header() { return Object.entries(c).map(([k, v]) => k + "=" + v).join("; "); },
    get(k) { return c[k]; },
  };
}

async function signIn(email, password) {
  const j = jar();
  const next = "/control_panel/dashboards/all_registrations_report/";
  const page = await fetch(SIGNIN + "?next=" + encodeURIComponent(next), { headers: { "User-Agent": UA } });
  j.take(page);
  const html = await page.text();
  const token = (/name="csrfmiddlewaretoken" value="([^"]+)"/.exec(html) || [])[1];
  if (!token || !j.get("csrftoken")) throw new Error("Playbook sign-in page didn't give a CSRF token — layout changed?");
  const form = new URLSearchParams({ csrfmiddlewaretoken: token, next, email, password });
  const r = await fetch(SIGNIN + "?next=" + encodeURIComponent(next), {
    method: "POST", redirect: "manual",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", Cookie: j.header(), Referer: SIGNIN, Origin: BASE },
    body: form.toString(),
  });
  j.take(r);
  // Django answers a good login with a redirect to `next`; a bad one re-renders
  // the form with a 200.
  if (r.status !== 302 && r.status !== 303) {
    const body = await r.text().catch(() => "");
    throw new Error(/invalid|incorrect|not match|try again/i.test(body) ? "Playbook rejected the sync login (email/password)." : "Playbook sign-in returned HTTP " + r.status);
  }
  return j;
}

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, PLAYBOOK_SYNC_EMAIL, PLAYBOOK_SYNC_PASSWORD } = process.env;
  const url = (() => { try { return new URL(req.url, "https://x"); } catch { return null; } })();
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!CRON_SECRET || (bearer !== CRON_SECRET && (url?.searchParams.get("token") || "") !== CRON_SECRET)) return res.status(403).json({ error: "Forbidden" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const dry = url?.searchParams.get("dry") === "1";
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: prev } = await sb.from("dssc_sync").select("registrations_summary, registrations_error").eq("id", 1).maybeSingle();
  const now = new Date().toISOString();

  const fail = async (msg) => {
    if (!dry) {
      await sb.from("dssc_sync").upsert({ id: 1, registrations_error: msg, registrations_error_at: now }, { onConflict: "id" });
      // Same failure every 4 hours is noise; a new one is worth a note.
      if (prev?.registrations_error !== msg) await notify("Playbook registrations pull failed", msg + "\n\nThe sync runs every hour; the admin board's upload button still works meanwhile.");
    }
    return res.status(502).json({ ok: false, error: msg });
  };
  const notify = async (subject, body) => {
    const origin = appOrigin(req);
    try { await fetch(origin + "/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skipPush: true, subject, body, recipients: NOTIFY, sentBy: "Playbook sync", source: "playbook-registrations" }) }); } catch { /* best effort */ }
  };

  if (!PLAYBOOK_SYNC_EMAIL || !PLAYBOOK_SYNC_PASSWORD) return fail("PLAYBOOK_SYNC_EMAIL / PLAYBOOK_SYNC_PASSWORD aren't set in Vercel, so HQ can't sign in to Playbook.");

  let csv;
  try {
    const j = await signIn(PLAYBOOK_SYNC_EMAIL, PLAYBOOK_SYNC_PASSWORD);
    const r = await fetch(REPORT, { headers: { "User-Agent": UA, Cookie: j.header(), Referer: BASE + "/control_panel/dashboards/all_registrations_report/" } });
    csv = await r.text();
    if (!r.ok) throw new Error("Report fetch returned HTTP " + r.status);
    if (!/^registration_pk,/.test(csv.trim())) throw new Error(/Login/i.test(csv.slice(0, 2000)) ? "Signed in, but the report bounced to the login page — does the sync login have report access?" : "Playbook returned something other than the registrations CSV.");
  } catch (e) { return fail(e.message); }

  const rows = Papa.parse(csv, { header: true, skipEmptyLines: true }).data;
  const out = await importRoster(sb, rows, { dry, addedBy: "playbook auto-pull" });
  if (out.error) return fail("Import: " + out.error);

  // Every sign-up — any program, not just the classes above — into DSSC People,
  // so "everyone who ever did the Women's Academy" can be found. A failure here
  // is reported in the summary but never fails the roster pull.
  let people = null;
  if (!dry) { try { people = await importPlaybookRegistrations(sb, rows); } catch (e) { people = { error: e.message }; } }
  // Spend: prices come from the Registrations report (invoice_number +
  // registration_base_price), uploaded in People. If this export ever carries
  // those columns too, spend keeps itself current from here.
  const cols = Object.keys(rows[0] || {});
  let spend = null;
  if (!dry && isPlaybookSpendExport(cols)) { try { spend = await importPlaybookSpend(sb, rows); } catch (e) { spend = { error: e.message }; } }
  // Court bookings deleted in Playbook come off Court Availability.
  let reservations = null;
  try { reservations = await pruneDeletedReservations(sb, rows, { dry }); } catch (e) { reservations = { error: e.message }; }

  // beforeHq = sign-ups for dates before HQ had the class (they'll never attach);
  // counted, never alerted on.
  const summary = { added: out.added, matched: out.matched, rows: out.rows, noSession: out.noSession.length, beforeHq: (out.beforeHq || []).length,
    waiting: [...new Set(out.noSession.map(x => x.program + " " + x.date))].slice(0, 12), people, reservations, spend, columns: cols };
  if (!dry) {
    await sb.from("dssc_sync").upsert({ id: 1, registrations_at: now, registrations_summary: summary, registrations_error: null, registrations_error_at: null }, { onConflict: "id" });
    // Tell the director once when registrations are piling up for classes HQ
    // doesn't have — that means a calendar month hasn't been synced.
    const prevWaiting = Number(prev?.registrations_summary?.noSession || 0);
    if (summary.noSession > 0 && summary.noSession !== prevWaiting) {
      await notify(`${summary.noSession} Playbook registrations are waiting on a calendar sync`,
        `${summary.noSession} sign-ups are for classes DSSC HQ doesn't have yet. The calendar pulls itself every hour, so they normally attach on the next pass; if this is still here in a couple of hours, open that month on the Playbook calendar and click the sync bookmark.\n\n` + summary.waiting.map(w => "• " + w).join("\n"));
    }
    // A class auto-cancelled at noon for no sign-ups (api/dssc-coach-texts.js)
    // whose registration was left open can still take a sign-up - and that
    // family thinks their kid has a class tonight. Say so once per class.
    try {
      const todayCT = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
      const { data: cl } = await sb.from("dssc_clinics").select("id,name,sessions");
      const hits = [];
      for (const c of cl || []) for (const s of Array.isArray(c.sessions) ? c.sessions : []) if (s?.cancelled && s.date >= todayCT && !s.late_signup_alerted_at) hits.push({ c, s });
      if (hits.length) {
        const { data: kids } = await sb.from("dssc_pod_roster").select("clinic_id,session_id,player_name,parent_name,parent_phone").in("clinic_id", [...new Set(hits.map(h => h.c.id))]);
        const late = hits.map(h => ({ ...h, kids: (kids || []).filter(k => k.clinic_id === h.c.id && (!k.session_id || String(k.session_id) === String(h.s.id))) })).filter(h => h.kids.length);
        if (late.length) {
          await notify(`Sign-up for a CANCELLED DSSC class`,
            `Someone signed up after these classes were auto-cancelled for having no players. Either un-cancel and staff the class, or contact the family and refund - and turn off registration for it in Playbook.\n\n` +
            late.map(h => `• ${h.c.name} - ${h.s.date} ${h.s.start_time || ""}: ` + h.kids.map(k => `${k.player_name}${k.parent_name ? " (" + k.parent_name + (k.parent_phone ? ", " + k.parent_phone : "") + ")" : ""}`).join("; ")).join("\n"));
          const at = new Date().toISOString();
          for (const id of [...new Set(late.map(h => h.c.id))]) {
            const { data: fresh } = await sb.from("dssc_clinics").select("sessions").eq("id", id).maybeSingle();
            const ids = new Set(late.filter(h => h.c.id === id).map(h => String(h.s.id)));
            await sb.from("dssc_clinics").update({ sessions: (fresh?.sessions || []).map(x => ids.has(String(x.id)) ? { ...x, late_signup_alerted_at: at } : x) }).eq("id", id);
          }
        }
      }
    } catch (e) { console.error("cancelled-class sign-up check:", e.message); }
  }
  return res.status(200).json({ ok: true, dry, ...summary });
}
