// Every hour: pull Playbook's registrations report into the class rosters.
//
// Playbook has no API, but its "Export All" on the registrations report is a
// plain GET that a signed-in session can fetch, and its sign-in is an ordinary
// Django form (csrf cookie + hidden token, email, password — no captcha). So
// this signs in as the HQ sync login, fetches the report, and runs it through
// the same importer the admin upload and the bookmarklet use. Nothing is ever
// removed by this — it only adds sign-ups for classes that exist in HQ.
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

  const summary = { added: out.added, matched: out.matched, rows: out.rows, noSession: out.noSession.length,
    waiting: [...new Set(out.noSession.map(x => x.program + " " + x.date))].slice(0, 12) };
  if (!dry) {
    await sb.from("dssc_sync").upsert({ id: 1, registrations_at: now, registrations_summary: summary, registrations_error: null, registrations_error_at: null }, { onConflict: "id" });
    // Tell the director once when registrations are piling up for classes HQ
    // doesn't have — that means a calendar month hasn't been synced.
    const prevWaiting = Number(prev?.registrations_summary?.noSession || 0);
    if (summary.noSession > 0 && summary.noSession !== prevWaiting) {
      await notify(`${summary.noSession} Playbook registrations are waiting on a calendar sync`,
        `${summary.noSession} sign-ups are for classes DSSC HQ doesn't have yet — open that month on the Playbook calendar and click the sync bookmark, and the next pull will attach them.\n\n` + summary.waiting.map(w => "• " + w).join("\n"));
    }
  }
  return res.status(200).json({ ok: true, dry, ...summary });
}
