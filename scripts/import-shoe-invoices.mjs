// Import Playbook's sale export for the Avoli club shoe into shoe_invoices,
// matched to players. The gear board's upload button does the same thing.
//
//   node scripts/import-shoe-invoices.mjs "C:/Users/drewr/Downloads/SaleItem_20260925194922.csv"
//   node scripts/import-shoe-invoices.mjs file.csv --dry      # match and report, write nothing
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import Papa from "papaparse";
import { createClient } from "@supabase/supabase-js";
import { parseSaleRows, matchInvoicesToPlayers } from "../shared/shoe-invoices.js";

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith("--"));
const dry = args.includes("--dry");
if (!file) { console.error("Need the CSV path."); process.exit(1); }

const rows = Papa.parse(readFileSync(file, "utf8"), { header: true, skipEmptyLines: true }).data;
const invoices = parseSaleRows(rows);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: players } = await sb.from("players").select("id, first_name, last_name, team_assignment, offer_status, roster_status, parent_name, parent2_name");
const { matched, unmatched } = matchInvoicesToPlayers(invoices, players || []);

const paid = invoices.filter(i => i.status === "Paid").length;
console.log(`${invoices.length} shoe invoices · ${paid} paid · ${invoices.length - paid} unpaid · ${matched} matched to players`);
const iffy = invoices.filter(i => i.player_id && i.match_note);
if (iffy.length) { console.log(`\nMatched with a note (${iffy.length}):`); iffy.forEach(i => console.log("  " + i.match_note)); }
if (unmatched.length) { console.log(`\nNOT matched (${unmatched.length}):`); unmatched.forEach(i => console.log(`  ${i.participant.padEnd(28)} ${i.status.padEnd(7)} ${i.account_owner}  — ${i.match_note}`)); }
if (dry) { console.log("\nDRY RUN — nothing written."); process.exit(0); }

const stamp = new Date().toISOString();
const { error } = await sb.from("shoe_invoices").upsert(invoices.map(i => ({ ...i, imported_at: stamp, imported_by: "script" })), { onConflict: "sale_id" });
if (error) { console.error("Upsert failed:", error.message); process.exit(1); }
console.log(`\nWrote ${invoices.length} rows to shoe_invoices.`);
