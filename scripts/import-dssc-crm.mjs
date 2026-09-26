// Load the DSSC CRM from its sources.
//
//   node scripts/import-dssc-crm.mjs playbook <participant_export.csv>   Playbook → Reports → Participants
//   node scripts/import-dssc-crm.mjs upperhand <folder>                  contacts_list.csv, contact_list*.csv, order_list*.csv
//   node scripts/import-dssc-crm.mjs sync                                 Playbook class rosters + DS Elite roster → participation
//
// All idempotent. See api/_lib/dssc-crm.js.

import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";
import { importUpperHand, importPlaybookParticipants, syncPlaybook, syncDsElite } from "../api/_lib/dssc-crm.js";

const env = {};
for (const l of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const csv = (p) => Papa.parse(readFileSync(p, "utf8"), { header: true, skipEmptyLines: true }).data;
const [cmd, arg] = process.argv.slice(2);

if (cmd === "playbook") { console.log(JSON.stringify(await importPlaybookParticipants(sb, csv(arg)))); }
else if (cmd === "upperhand") {
  const files = readdirSync(arg);
  const pick = (re) => { const f = files.filter(x => re.test(x)).sort().at(-1); return f ? csv(arg + "/" + f) : []; };
  console.log(JSON.stringify(await importUpperHand(sb, { contacts: pick(/^contacts_list/i), participants: pick(/^contact_list/i), orders: pick(/^order_list/i), attendance: pick(/attend|registration|event_client/i) })));
} else if (cmd === "sync") { console.log("playbook rosters:", JSON.stringify(await syncPlaybook(sb))); console.log("ds elite:", JSON.stringify(await syncDsElite(sb))); }
else { console.error("usage: playbook <csv> | upperhand <folder> | sync"); process.exit(1); }
