// 50 work matches for one team, dealt and balanced exactly like Work Duty's
// "Plan the season", written to Excel: every lineup + a fairness tab.
//   node scripts/work-duty-demo.mjs [--team "12 Diamond"] [--matches 50] [--sets 3] [--computer]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";
import { planMatch, tally, balanceSeason } from "../shared/work-duty.js";

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const args = process.argv.slice(2);
const val = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };
const TEAM = val("team", "12 Diamond"), N = +val("matches", 50), SETS = +val("sets", 3), COMP = args.includes("--computer");
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data } = await sb.from("players").select("id, first_name, last_name, offer_status").eq("team_assignment", TEAM).eq("season", "2026-27");
const roster = data.filter(p => !["declined", "not_invited", "opted_out"].includes(p.offer_status || "")).sort((a, b) => a.first_name.localeCompare(b.first_name));
const name = new Map(roster.map(p => [String(p.id), p.first_name.trim() + " " + String(p.last_name || "").trim()[0] + "."]));
const nm = (id) => name.get(String(id)) || "";

const counts = {};
let list = Array.from({ length: N }, () => ({ assignments: planMatch({ players: roster, counts, sets: SETS, computer: COMP }) }));
list = balanceSeason(list, roster, { iterations: 30000 });

const rows = list.map((m, i) => {
  const a = m.assignments, r = { "Match": i + 1, "Score book + VolleyStation": nm(a.book), "Libero tracker": nm(a.libero) };
  a.sets.forEach((s, k) => { r[`Set ${k + 1} line judge 1`] = nm(s.lj1); r[`Set ${k + 1} line judge 2`] = nm(s.lj2); r[`Set ${k + 1} flipper`] = nm(s.flip); if (COMP) r[`Set ${k + 1} computer`] = nm(s.comp); });
  return r;
});
const t = tally(list);
const fair = roster.map(p => { const c = t[String(p.id)] || {}; return { Player: nm(p.id), "Score book + VS": c.book || 0, "Libero tracker": c.libero || 0, "Line judge": c.line || 0, "Score flipper": c.flip || 0, ...(COMP ? { "Computer": c.comp || 0 } : {}), "Total jobs": c.total || 0 }; });
const spread = (k) => { const v = fair.map(f => f[k]); return `${Math.min(...v)}-${Math.max(...v)}`; };
fair.push({}, { Player: "Range (fewest-most)", ...Object.fromEntries(Object.keys(fair[0]).filter(k => k !== "Player").map(k => [k, spread(k)])) });

const wb = XLSX.utils.book_new();
const ws1 = XLSX.utils.json_to_sheet(rows); ws1["!cols"] = Object.keys(rows[0]).map(k => ({ wch: Math.max(9, k.length + 1) }));
const ws2 = XLSX.utils.json_to_sheet(fair); ws2["!cols"] = Object.keys(fair[0]).map(() => ({ wch: 18 }));
XLSX.utils.book_append_sheet(wb, ws2, "Fairness");
XLSX.utils.book_append_sheet(wb, ws1, `${N} matches`);
mkdirSync(new URL("../exports/", import.meta.url), { recursive: true });
const out = fileURLToPath(new URL(`../exports/Work Duty ${TEAM} - ${N} matches.xlsx`, import.meta.url));
writeFileSync(out, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
console.log(out);
console.log(fair.map(f => Object.values(f).join(" | ")).join("\n"));
