// Run SQL against the Supabase database via the Management API.
// Lets migrations run directly instead of copy-pasting into the SQL editor.
//
// Auth: reads SUPABASE_ACCESS_TOKEN (a Supabase personal access token) and
// SUPABASE_URL from the gitignored .env. The project ref is derived from the URL.
//
// Usage:
//   node scripts/run-sql.mjs migrations/xxxx.sql       # run a migration file
//   node scripts/run-sql.mjs -e "select count(*) from players;"   # inline SQL
//
// Safety: refuses obviously destructive statements (DROP TABLE/SCHEMA/DATABASE,
// TRUNCATE) unless --force is passed. DROP POLICY / additive DDL are allowed.

import { readFileSync } from "node:fs";

function loadEnv() {
  let raw = "";
  try { raw = readFileSync(new URL("../.env", import.meta.url), "utf8"); }
  catch { console.error("Missing .env next to package.json."); process.exit(1); }
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv();
const token = env.SUPABASE_ACCESS_TOKEN;
const url = env.SUPABASE_URL;
if (!token) { console.error("Set SUPABASE_ACCESS_TOKEN in .env (Supabase → Account → Access Tokens)."); process.exit(1); }
if (!url) { console.error("Set SUPABASE_URL in .env."); process.exit(1); }
const ref = new URL(url).hostname.split(".")[0];

const args = process.argv.slice(2);
const force = args.includes("--force");
const rest = args.filter(a => a !== "--force");
let sql;
if (rest[0] === "-e") sql = rest.slice(1).join(" ");
else if (rest[0]) sql = readFileSync(rest[0], "utf8");
else { console.error("Give a .sql file path or -e \"<sql>\"."); process.exit(1); }

if (!force && /\b(drop\s+(table|schema|database)|truncate)\b/i.test(sql)) {
  console.error("Refusing: SQL contains DROP TABLE/SCHEMA/DATABASE or TRUNCATE. Re-run with --force if truly intended.");
  process.exit(1);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();
if (!res.ok) { console.error("FAILED — HTTP " + res.status + "\n" + text); process.exit(1); }
console.log("OK ✓");
try { const j = JSON.parse(text); if (Array.isArray(j) && j.length) console.log(JSON.stringify(j, null, 2).slice(0, 4000)); }
catch { /* non-JSON (e.g. DDL) — OK is enough */ }
