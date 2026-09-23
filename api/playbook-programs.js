// Daily: what has Playbook published that we haven't seen?
//
// Playbook has no API, but the public /programs/register/ page lists every
// live listing by name in its filter dropdown — programs, seasons, memberships,
// pass packages — even to an anonymous visitor. (Program ids and session
// tables only render for a logged-in family, so names are the key here.)
//
// Each run: fetch the page, diff its names against playbook_programs, record
// the run, and email Drew if anything appeared, came back, or dropped off.
// A quiet day sends nothing. A fetch that finds zero names is treated as a
// broken page, not as "everything was unpublished" — nothing is marked gone
// and the run is logged with a note.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; also ?token=.
// Query: ?dry=1   report the diff, write nothing, send nothing
//        ?test=1  email Drew only; still writes
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
//      PLAYBOOK_PROGRAMS_TO (opt, comma list; default Drew).

import { createClient } from "@supabase/supabase-js";

const SOURCE = "https://drippingsports.playbookapi.com/programs/register/";
const TO_DEFAULT = "drew@dselitevolleyball.com";
const TEST_TO = "drew@dselitevolleyball.com";
const APP = "https://dseliteevals.vercel.app";
const KIND_LABEL = { programs: "Programs", seasons: "Seasons / leagues", memberships: "Memberships", pass_packages: "Pass packages" };

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unescapeHtml = (s) => String(s).replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

// The filter dropdown: <option class="name-option" value="programs -- Skill Lab 3-5th Grade">
export function parseListings(html) {
  const out = [];
  const seen = new Set();
  for (const m of String(html).matchAll(/<option class="name-option" value="([a-z_]+) -- ([^"]+)">/g)) {
    const kind = m[1], name = unescapeHtml(m[2]).replace(/\s+/g, " ").trim();
    const key = kind + "|" + name;
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, name });
  }
  return out;
}

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, PLAYBOOK_PROGRAMS_TO } = process.env;
  const url = (() => { try { return new URL(req.url, "https://x"); } catch { return null; } })();
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!CRON_SECRET || (bearer !== CRON_SECRET && (url?.searchParams.get("token") || "") !== CRON_SECRET)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const dry = url?.searchParams.get("dry") === "1";
  const test = url?.searchParams.get("test") === "1";
  const to = test ? [TEST_TO] : (PLAYBOOK_PROGRAMS_TO || TO_DEFAULT).split(",").map(s => s.trim()).filter(Boolean);
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }); // YYYY-MM-DD, Central

  let html = "";
  try {
    const r = await fetch(SOURCE, { headers: { "User-Agent": "Mozilla/5.0 (DS Elite HQ program watch)", "Accept": "text/html" }, redirect: "follow" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    html = await r.text();
  } catch (e) {
    if (!dry) await sb.from("playbook_program_runs").insert({ listed: 0, note: "fetch failed: " + e.message });
    return res.status(502).json({ error: "Playbook fetch failed: " + e.message });
  }
  const listed = parseListings(html);
  if (!listed.length) {
    if (!dry) await sb.from("playbook_program_runs").insert({ listed: 0, note: "page had no name-option list — layout changed?" });
    return res.status(502).json({ error: "No listings found on the page — Playbook's page layout may have changed." });
  }

  const { data: known, error } = await sb.from("playbook_programs").select("kind, name, active, first_seen, gone_since");
  if (error) return res.status(500).json({ error: error.message });
  const knownBy = new Map((known || []).map(k => [k.kind + "|" + k.name, k]));
  const listedKeys = new Set(listed.map(l => l.kind + "|" + l.name));

  const added = listed.filter(l => !knownBy.has(l.kind + "|" + l.name));
  const returned = listed.filter(l => knownBy.get(l.kind + "|" + l.name)?.active === false);
  const removed = (known || []).filter(k => k.active && !listedKeys.has(k.kind + "|" + k.name));
  const firstRun = !(known || []).length;

  if (dry) {
    return res.status(200).json({ ok: true, dry: true, first_run: firstRun, listed: listed.length, to,
      added: added.map(a => a.kind + ": " + a.name), returned: returned.map(a => a.kind + ": " + a.name), removed: removed.map(a => a.kind + ": " + a.name) });
  }

  // Keep the table current before deciding whether to email, so a failed
  // send never leaves a listing unrecorded and re-reported forever.
  const upserts = listed.map(l => ({ kind: l.kind, name: l.name, last_seen: today, active: true, gone_since: null,
    ...(knownBy.has(l.kind + "|" + l.name) ? {} : { first_seen: today }) }));
  for (let i = 0; i < upserts.length; i += 100) {
    const { error: uErr } = await sb.from("playbook_programs").upsert(upserts.slice(i, i + 100), { onConflict: "kind,name" });
    if (uErr) return res.status(500).json({ error: "upsert: " + uErr.message });
  }
  for (const k of removed) {
    await sb.from("playbook_programs").update({ active: false, gone_since: today }).eq("kind", k.kind).eq("name", k.name);
  }

  const changes = added.length + returned.length + removed.length;
  // The first run just seeds the table — telling Drew about 44 "new" listings
  // he already knows about is noise.
  const shouldEmail = !firstRun && changes > 0;
  if (!shouldEmail) {
    await sb.from("playbook_program_runs").insert({ listed: listed.length, added: added.length, removed: removed.length, returned: returned.length, emailed: false, note: firstRun ? "first run — table seeded" : null });
    return res.status(200).json({ ok: true, emailed: false, first_run: firstRun, listed: listed.length, added: added.length, returned: returned.length, removed: removed.length });
  }

  const group = (list) => {
    const by = new Map();
    for (const l of list) { if (!by.has(l.kind)) by.set(l.kind, []); by.get(l.kind).push(l.name); }
    return [...by.entries()];
  };
  const section = (title, list, color) => list.length
    ? `<p style="margin:22px 0 6px;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${color}">${esc(title)} &middot; ${list.length}</p>`
      + group(list).map(([kind, names]) => `<p style="margin:8px 0 2px;font-size:12px;color:#777">${esc(KIND_LABEL[kind] || kind)}</p><ul style="margin:0 0 6px;padding-left:20px">${names.map(n => `<li>${esc(n)}</li>`).join("")}</ul>`).join("")
    : "";
  const sectionText = (title, list) => list.length
    ? `${title.toUpperCase()} (${list.length})\n` + group(list).map(([kind, names]) => `  ${KIND_LABEL[kind] || kind}\n` + names.map(n => "    • " + n).join("\n")).join("\n") + "\n\n"
    : "";

  const html2 = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;max-width:600px">'
    + `<p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#c2186f">DSSC &middot; Playbook listings</p>`
    + `<p style="margin:0 0 4px">Playbook's public program list changed since yesterday's check.</p>`
    + section("New on Playbook", added, "#15803d")
    + section("Back on Playbook", returned, "#0369a1")
    + section("No longer listed", removed, "#b45309")
    + `<p style="margin:26px 0 0;font-size:12px;color:#999">${listed.length} listings live right now &middot; <a href="${SOURCE}" style="color:#c2186f">open Playbook</a></p></div>`;
  const text = "Playbook's public program list changed since yesterday's check.\n\n"
    + sectionText("New on Playbook", added) + sectionText("Back on Playbook", returned) + sectionText("No longer listed", removed)
    + `${listed.length} listings live right now: ${SOURCE}`;
  const headline = [added.length && `${added.length} new`, returned.length && `${returned.length} back`, removed.length && `${removed.length} removed`].filter(Boolean).join(", ");

  const r = await fetch(APP + "/api/send-email", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: (test ? "[TEST] " : "") + `Playbook programs: ${headline}`, body: text, bodyHtml: html2, recipients: to, sentBy: "DS Elite HQ", source: "playbook-programs", skipPush: true }),
  });
  const out = await r.json().catch(() => ({}));
  const emailed = r.ok && !out.error && !!out.sent;
  await sb.from("playbook_program_runs").insert({ listed: listed.length, added: added.length, removed: removed.length, returned: returned.length, emailed, note: emailed ? null : "email failed: " + (out.error || r.status) });
  return res.status(emailed ? 200 : 502).json({ ok: emailed, emailed, test, to, listed: listed.length, added: added.map(a => a.name), returned: returned.map(a => a.name), removed: removed.map(a => a.name) });
}
