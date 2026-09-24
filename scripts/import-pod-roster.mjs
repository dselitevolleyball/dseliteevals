// Load Playbook's registrations report into dssc_pod_roster — class by class.
//
//   node scripts/import-pod-roster.mjs <registrations_report.csv> [--dry]
//
// Same importer the admin board's "Upload registrations" button uses
// (api/_lib/dssc-roster-import.js); this is the command-line way in.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";
import { importRoster } from "../api/_lib/dssc-roster-import.js";

const env = {};
for (const l of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const file = process.argv.slice(2).find(a => !a.startsWith("--"));
const dry = process.argv.includes("--dry");
if (!file) { console.error("usage: node scripts/import-pod-roster.mjs <csv> [--dry]"); process.exit(1); }

const { data: rows } = Papa.parse(readFileSync(file, "utf8"), { header: true, skipEmptyLines: true });
const out = await importRoster(sb, rows, { dry, addedBy: "playbook import" });
if (out.error) { console.error(out.error); process.exit(1); }
console.log(`${out.rows} rows in file → ${out.matched} class registrations across ${out.programs.length} programs`);
for (const p of out.programs) console.log(`  ${String(p.n).padStart(4)}  ${p.name}`);
console.log(`\nSkipped ${out.skippedRows} rows from ${out.skippedPrograms} programs we don't track (rentals, basketball, privates…)`);
if (out.noSession.length) { console.log(`\n${out.noSession.length} rows whose date has no session on the clinic (skipped):`); out.noSession.slice(0, 15).forEach(x => console.log(`  ${x.program} · ${x.date} · ${x.player}`)); if (out.noSession.length > 15) console.log("  …"); }
console.log(dry ? "\n--dry: nothing written" : `\nWrote ${out.written} roster rows (${out.added} new).`);
