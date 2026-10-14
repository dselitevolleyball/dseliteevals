// Load Playbook's Events export (events.csv) into dssc_court_rentals - the same
// import as the "Upload rentals" button on Court Availability.
//
//   node scripts/import-court-rentals.mjs <events.csv>          # show what it found
//   node scripts/import-court-rentals.mjs <events.csv> --write [--from YYYY-MM-DD --to YYYY-MM-DD]
//        replaces HQ's rentals for the dates the export was made for (default:
//        the file's first to last date)
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { parseRentalRows, importRentals } from "../api/_lib/court-rentals.js";
const Papa = createRequire(import.meta.url)("papaparse");

const args = process.argv.slice(2), file = args[0], flag = args.includes("--write") ? "--write" : "";
const arg = (n) => { const i = args.indexOf(n); return i > 0 ? args[i + 1] : undefined; };
if (!file) { console.error("usage: node scripts/import-court-rentals.mjs <events.csv> [--write]"); process.exit(1); }
const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }

const { data: rows } = Papa.parse(readFileSync(file, "utf8").replace(/^﻿/, ""), { header: true, skipEmptyLines: true });
const p = parseRentalRows(rows);
const hm = (t) => t;
console.log(`${p.rentals.length} rented sessions, ${p.window?.from} to ${p.window?.to}` + (Object.keys(p.skipped).length ? `; skipped other types: ${JSON.stringify(p.skipped)}` : ""));
for (const r of p.rentals) console.log(`  ${r.date} ${hm(r.start_time)}-${hm(r.end_time)}  ${(r.courts.join("+") || "NO COURT").padEnd(14)} ${r.label}${r.internal ? " (DS Elite)" : ""}`);
if (p.bad.length) console.log("Couldn't read:", p.bad);
if (p.unplaced.length) console.log("No court in Playbook (saved, not drawn):", p.unplaced);
if (flag !== "--write") { console.log("\nDry run. Add --write to load these."); process.exit(0); }
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const out = await importRentals(sb, rows, "import script", { from: arg("--from"), to: arg("--to"), exportedAt: statSync(file).mtime.toISOString() });
console.log(`\nLoaded ${out.added} (replaced ${out.replaced}) for ${out.window.from} to ${out.window.to}.`);
