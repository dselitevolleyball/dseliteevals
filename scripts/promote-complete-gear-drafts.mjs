// Promote gear-order drafts that are actually finished into real orders.
//
// Autosave stores an order from the first keystroke, so every family who opened
// the form has a row. Most drafts are genuinely half-done. Some are complete —
// every size chosen, both contacts given — and the family simply closed the tab
// instead of pressing Send. Those are orders in everything but the flag, and
// leaving them as drafts means chasing families who already answered.
//
// Completeness is the FORM'S OWN RULE, not a looser one invented here: the same
// fields api/gear-form.js refuses to submit without. A draft that would have
// been rejected at the button is not promoted, because the family would have
// been sent back to fix it.
//
// DRY RUN BY DEFAULT. Prints what would be promoted and what each of the rest
// is still missing; changes nothing until --write.
//
// Usage:
//   node scripts/promote-complete-gear-drafts.mjs           # dry run
//   node scripts/promote-complete-gear-drafts.mjs --write   # promote them
//   node scripts/promote-complete-gear-drafts.mjs --list    # full missing-field report
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  const raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
const args = process.argv.slice(2);
const doWrite = args.includes("--write");
const listAll = args.includes("--list");

// Mirrors ITEMS in api/gear-form.js. Every one is required at the button.
const SIZES = [
  ["jersey_size", "jersey"], ["warmup_tee_size", "warm-up tee"], ["practice_tee_size", "practice tee"],
  ["hoodie_size", "hoodie"], ["spandex_size", "spandex"], ["spandex_length", "spandex length"],
  ["jogger_size", "joggers"], ["kneepad_size", "kneepads"], ["sock_size", "socks"],
  ["arm_sleeve_size", "arm sleeves"], ["shoe_size", "shoes"],
];
const has = (v) => !!String(v ?? "").trim();

// The same checks, in the same order, as the form's `missing` array.
function whatsMissing(r) {
  const out = [];
  if (!has(r.first_name)) out.push("first name");
  if (!has(r.last_name)) out.push("last name");
  if (!has(r.team_name)) out.push("team");
  if (!has(r.parent1_name)) out.push("parent 1 name");
  if (!has(r.parent1_phone)) out.push("parent 1 phone");
  if (!has(r.parent1_email)) out.push("parent 1 email");
  const hasP2 = has(r.parent2_name) || has(r.parent2_phone) || has(r.parent2_email);
  if (!hasP2 && !r.single_parent) out.push("parent 2 (or the only-one tick)");
  if (hasP2 && !has(r.parent2_name)) out.push("parent 2 name");
  if (hasP2 && !has(r.parent2_phone)) out.push("parent 2 phone");
  if (hasP2 && !has(r.parent2_email)) out.push("parent 2 email");
  for (const [k, label] of SIZES) if (!has(r[k])) out.push(label);
  if (!r.details_confirmed) out.push("the confirmation box");
  return out;
}

const env = loadEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: drafts, error } = await supabase.from("player_gear_orders")
  .select("*").eq("is_draft", true);
if (error) { console.error("Load failed:", error.message); process.exit(1); }

const graded = (drafts || []).map(r => ({ r, missing: whatsMissing(r) }))
  .sort((a, b) => a.missing.length - b.missing.length ||
    String(a.r.team_name).localeCompare(String(b.r.team_name)) ||
    String(a.r.last_name).localeCompare(String(b.r.last_name)));

const ready = graded.filter(x => !x.missing.length);
// One tick from being an order. Worth naming separately: these families did all
// the work and stopped at a checkbox, so they are the cheapest ones to chase.
const oneBox = graded.filter(x => x.missing.length === 1 && x.missing[0] === "the confirmation box");
const partial = graded.filter(x => x.missing.length && !(x.missing.length === 1 && x.missing[0] === "the confirmation box"));

const name = (r) => `${r.first_name || "?"} ${r.last_name || "?"}`;

console.log(`${drafts.length} drafts on file`);
console.log(`  ${ready.length} complete — every required answer given, never sent`);
console.log(`  ${oneBox.length} complete except the confirmation box`);
console.log(`  ${partial.length} genuinely part-filled`);

if (ready.length) {
  console.log(`\n─── would be promoted to ordered ───────────────────────`);
  ready.forEach(({ r }) => console.log("   " + String(r.team_name || "—").padEnd(13) + name(r)));
}
if (oneBox.length) {
  console.log(`\n─── one tick short (NOT promoted) ──────────────────────`);
  oneBox.forEach(({ r }) => console.log("   " + String(r.team_name || "—").padEnd(13) + name(r)));
}
if (partial.length && listAll) {
  console.log(`\n─── still part-filled ─────────────────────────────────`);
  partial.forEach(({ r, missing }) =>
    console.log("   " + String(r.team_name || "—").padEnd(13) + name(r).padEnd(24) +
      missing.length + " missing: " + missing.slice(0, 4).join(", ") + (missing.length > 4 ? "…" : "")));
} else if (partial.length) {
  const byCount = {};
  partial.forEach(({ missing }) => { const k = missing.length; byCount[k] = (byCount[k] || 0) + 1; });
  console.log(`\nPart-filled, by how much is left (--list for names):`);
  Object.keys(byCount).map(Number).sort((a, b) => a - b)
    .forEach(k => console.log(`   ${String(byCount[k]).padStart(3)} missing ${k} answer${k === 1 ? "" : "s"}`));
}

if (!doWrite) {
  console.log("\nDRY RUN — nothing changed. Re-run with --write to promote the complete ones.");
} else if (!ready.length) {
  console.log("\nNothing to promote.");
} else {
  const ids = ready.map(x => x.r.id);
  const now = new Date().toISOString();
  const { error: uErr } = await supabase.from("player_gear_orders")
    .update({ is_draft: false, submitted_at: now, updated_at: now }).in("id", ids);
  if (uErr) console.error("Promote failed:", uErr.message);
  else console.log(`\nDone. ${ids.length} drafts are now orders.`);
}
