// Load Playbook's registrations report into dssc_pod_roster — class by class.
//
//   node scripts/import-pod-roster.mjs <registrations_report.csv> [--dry]
//
// Playbook → Reports → Registrations exports one row per registration per
// session date: participant_name, user_name/user_email (the parent), source
// (program name), source_pk (program id), start_date (the class date). We match
// source_pk to dssc_clinics.source_ref — which is exactly the volleyball
// filter, because only volleyball programs are ever synced into dssc_clinics —
// and start_date to that clinic's session, so a registration lands on the one
// class it is for. registration_pk is kept as source_ref, so re-running with a
// newer export is idempotent: new rows are added, existing ones refreshed.
//
// Rows for programs we don't track (court rentals, basketball, privates, open
// gym) are skipped and counted. A row whose date has no session on the clinic
// (usually a past session the sync has since dropped) is skipped and listed.
// Playbook's report has no phone column, so sms_consent stays false until a
// parent opts in.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";

const env = {};
for (const l of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const file = process.argv.slice(2).find(a => !a.startsWith("--"));
const dry = process.argv.includes("--dry");
if (!file) { console.error("usage: node scripts/import-pod-roster.mjs <csv> [--dry]"); process.exit(1); }

const { data: rows } = Papa.parse(readFileSync(file, "utf8"), { header: true, skipEmptyLines: true });
const { data: clinics, error } = await sb.from("dssc_clinics").select("id, name, source_ref, sessions");
if (error) throw error;
const byRef = new Map(clinics.filter(c => c.source_ref).map(c => [String(c.source_ref), c]));
const toISO = (mdy) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(mdy || "").trim()); return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null; };
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

const out = [], skippedPrograms = new Map(), noSession = [];
for (const r of rows) {
  const c = byRef.get(String(r.source_pk || "").trim());
  if (!c) { const k = clean(r.source); skippedPrograms.set(k, (skippedPrograms.get(k) || 0) + 1); continue; }
  const date = toISO(r.start_date);
  const s = (c.sessions || []).find(x => x.date === date);
  if (!s) { noSession.push(`${c.name} · ${date} · ${clean(r.participant_name)}`); continue; }
  out.push({
    clinic_id: c.id, session_id: String(s.id),
    player_name: clean(r.participant_name) || clean(r.user_name),
    parent_name: clean(r.user_name) || null, parent_email: clean(r.user_email).toLowerCase() || null,
    source: "playbook", source_ref: String(r.registration_pk), notes: null, added_by: "playbook import", updated_at: new Date().toISOString(),
  });
}

const perClinic = new Map();
for (const o of out) { const c = clinics.find(x => x.id === o.clinic_id); perClinic.set(c.name, (perClinic.get(c.name) || 0) + 1); }
console.log(`${rows.length} rows in file → ${out.length} class registrations across ${perClinic.size} programs`);
for (const [n, k] of [...perClinic.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(k).padStart(4)}  ${n}`);
console.log(`\nSkipped ${[...skippedPrograms.values()].reduce((a, b) => a + b, 0)} rows from ${skippedPrograms.size} programs we don't track (rentals, basketball, privates…)`);
if (noSession.length) { console.log(`\n${noSession.length} rows whose date has no session on the clinic (skipped):`); noSession.slice(0, 15).forEach(x => console.log("  " + x)); if (noSession.length > 15) console.log("  …"); }

if (dry) { console.log("\n--dry: nothing written"); process.exit(0); }
let written = 0;
for (let i = 0; i < out.length; i += 200) {
  const { error: e } = await sb.from("dssc_pod_roster").upsert(out.slice(i, i + 200), { onConflict: "source_ref" });
  if (e) { console.error("upsert failed:", e.message); process.exit(1); }
  written += Math.min(200, out.length - i);
}
console.log(`\nWrote ${written} roster rows.`);
