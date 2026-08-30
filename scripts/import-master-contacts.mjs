// Import parent and player contacts from the two master team workbooks.
//
// The workbooks are the authority: they came out of registration, they carry
// both parents in full for most girls, and the roster has only ever held one.
//
// What lands where:
//   Parent 1 First/Last  → parent_name          Parent 2 First/Last  → parent2_name
//   Parent 1 Phone       → parent_phone         Parent 2 Phone       → parent2_phone
//   Parent 1 Email       → parent_email         Parent 2 Email       → parent_email2
//   Phone (the player's) → player_phone
//
// parent_email2 rather than a new parent2_email column because every parent
// blast reads parent_email/2/3 — see PARENT_EMAIL_FIELDS in src/App.jsx. An
// address that lands anywhere else is an address nobody mails.
//
// NOTHING IS EVER DROPPED. If parent_email2 already holds a DIFFERENT address
// from the one on the sheet, the old one is moved down to parent_email3 rather
// than overwritten, so a third contact someone added by hand survives the
// import and still receives club email. If parent_email3 is also taken and
// differs, the row is reported and left alone rather than losing an address.
//
// DRY RUN BY DEFAULT. It prints every field it would change, old value → new,
// and writes nothing until --write is passed. A backup of every affected row's
// current values is saved next to the repo first.
//
// Usage:
//   node scripts/import-master-contacts.mjs                 # dry run
//   node scripts/import-master-contacts.mjs --team "14 Ruby"
//   node scripts/import-master-contacts.mjs --write         # apply
//   node scripts/import-master-contacts.mjs --write --fill-only   # only fill blanks
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { readXlsx } from "./lib/xlsx-read.mjs";

const BOOKS = [
  ["National", "C:/Users/drewr/Downloads/26-27 National Teams.xlsx"],
  ["Regional", "C:/Users/drewr/Downloads/26-27 Regional Teams.xlsx"],
];
const TERMINAL = ["declined", "not_invited", "opted_out"];

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
const flag = (n) => args.includes("--" + n);
const value = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const doWrite = flag("write");
const fillOnly = flag("fill-only");
const onlyTeam = value("team");

const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const clean = (s) => String(s ?? "").trim().replace(/\s+/g, " ");
// A handful of names were typed into the workbook in one case or the other —
// "lana rowder", "RILEY Suffel". Titled here so the import doesn't carry a
// registration typo onto the roster and into every email that reads it.
const titled = (s) => {
  const v = clean(s);
  if (!v || (v !== v.toLowerCase() && v !== v.toUpperCase())) return v;   // mixed case: leave it
  return v.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
};
// Names on the sheets carry stray double spaces and parenthetical nicknames.
const variants = (first) => {
  const raw = String(first ?? "").trim();
  const paren = [...raw.matchAll(/\(([^)]*)\)/g)].map(m => norm(m[1])).filter(Boolean);
  const bare = norm(raw.replace(/\([^)]*\)/g, ""));
  const out = new Set([bare, ...paren].filter(Boolean));
  if (bare.includes(" ")) out.add(bare.split(" ")[0]);
  return out;
};
const nameKeys = (f, l) => [...variants(f)].map(v => v + "|" + norm(l));
// Addresses are compared case-insensitively so a capitalisation difference
// isn't reported as a change worth making.
const sameEmail = (a, b) => !!norm(a) && norm(a) === norm(b);
// Phones compare on their last ten digits. The roster stores E.164
// (+15128091492) because that's what the SMS sending needs; the sheets store
// 512-809-1492. Those are one number, and rewriting the roster to the sheet's
// punctuation would be churn at best and a broken text at worst — so a match
// means leave the roster's version exactly as it is.
const digits = (s) => String(s ?? "").replace(/\D/g, "");
const last10 = (s) => digits(s).slice(-10);
const samePhone = (a, b) => last10(a).length === 10 && last10(a) === last10(b);
// Three Parent 2 Phone cells in the workbooks hold "87", "864", "449" — the
// front of a number that got cut off at entry. Importing those puts a value in
// a phone field that looks filled in and can never be dialled, which is worse
// than the blank it replaced.
const realPhone = (s) => digits(s).length >= 10 ? clean(s) : "";

// ── Read the workbooks ──────────────────────────────────────────────────────
const sheetRows = [];
for (const [book, path] of BOOKS) {
  const wb = readXlsx(path);
  for (const [sheetName, rows] of Object.entries(wb)) {
    if (/^totals?$/i.test(sheetName)) continue;
    const hdrIdx = (rows || []).findIndex(r => r && norm(r[0]) === "first name");
    if (hdrIdx < 0) continue;
    const hdr = rows[hdrIdx].map(norm);
    const col = (name) => hdr.indexOf(name);
    const C = {
      first: col("first name"), last: col("last name"),
      phone: col("phone"),
      p1f: col("parent 1 first"), p1l: col("parent 1 last"), p1p: col("parent 1 phone"), p1e: col("parent 1 email"),
      p2f: col("parent 2 first"), p2l: col("parent 2 last"), p2p: col("parent 2 phone"), p2e: col("parent 2 email"),
    };
    for (let i = hdrIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;
      const g = (c) => c >= 0 ? clean(r[c]) : "";
      const first = g(C.first), last = g(C.last);
      // The roster ends at the Total footer; below it some sheets carry a
      // second, differently-shaped block that would read as invented players.
      if (/^total$/i.test(first.replace(/[^a-z]/gi, ""))) break;
      if (!first && !last) continue;
      const join = (a, b) => [a, b].filter(Boolean).join(" ").trim();
      sheetRows.push({
        book, team: sheetName.trim(), row: i + 1, first, last,
        player_phone: realPhone(g(C.phone)),
        parent_name: titled(join(g(C.p1f), g(C.p1l))),
        parent_phone: realPhone(g(C.p1p)),
        parent_email: g(C.p1e),
        parent2_name: titled(join(g(C.p2f), g(C.p2l))),
        parent2_phone: realPhone(g(C.p2p)),
        parent2_email: g(C.p2e),
      });
    }
  }
}

// ── Load the roster ─────────────────────────────────────────────────────────
const env = loadEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: players, error } = await supabase.from("players")
  .select("id, first_name, last_name, team_assignment, roster_status, season, offer_status," +
    "parent_name, parent_phone, parent_email, parent_email2, parent_email3," +
    "parent2_name, parent2_phone, player_phone");
if (error) { console.error("Load players failed:", error.message); process.exit(1); }
const roster = (players || []).filter(p =>
  p.roster_status === "active" && (p.season || "2026-27") === "2026-27" &&
  !TERMINAL.includes(p.offer_status || "") && String(p.team_assignment || "").trim());

const byKey = new Map();
for (const p of roster) for (const k of nameKeys(p.first_name, p.last_name)) {
  if (!byKey.has(k)) byKey.set(k, []);
  if (!byKey.get(k).includes(p)) byKey.get(k).push(p);
}
const lookup = (f, l) => {
  for (const k of nameKeys(f, l)) { const hit = byKey.get(k); if (hit?.length) return hit; }
  return null;
};

// ── Work out the changes ────────────────────────────────────────────────────
const plans = [], unmatched = [], stuck = [];
for (const s of sheetRows) {
  if (onlyTeam && s.team !== onlyTeam) continue;
  const hits = lookup(s.first, s.last);
  if (!hits) { unmatched.push(s); continue; }
  // Two girls can share a name (there are two Harper Wards), so the team
  // decides which record this row is about.
  const p = hits.find(x => norm(x.team_assignment) === norm(s.team)) || (hits.length === 1 ? hits[0] : null);
  if (!p) { unmatched.push(s); continue; }

  const changes = [];

  // ── Which sheet parent is the roster's parent 1? ──────────────────────────
  // The workbooks list whichever parent registered first; the roster lists
  // whoever the club has actually been contacting. On a good number of rows
  // those are opposite people, and applying the sheet's order blindly demotes
  // the parent who answers the phone — Reagan Obersteller's mother becomes
  // parent 2 so her father can become parent 1, for no gain at all.
  //
  // So identity, not position, decides: if the roster's parent 1 IS the sheet's
  // parent 2 (same email, or same number), the sheet's two parents are swapped
  // before anything is written.
  const s1 = { name: s.parent_name, phone: s.parent_phone, email: s.parent_email };
  const s2 = { name: s.parent2_name, phone: s.parent2_phone, email: s.parent2_email };
  // Which of the sheet's two parents is this roster slot: 1, 2, or can't tell.
  //
  // A field is only allowed to answer that if it actually tells the two apart.
  // Plenty of families put one phone and one address against both parents, and
  // a shared value matches whichever it is compared to first — which is how
  // Elise Calhoun came out as her husband. So each field is used only when s1
  // and s2 genuinely differ on it, strongest first.
  const which = (cur) => {
    const tries = [
      [last10(cur.phone), last10(s1.phone), last10(s2.phone)],
      [norm(cur.name),    norm(s1.name),    norm(s2.name)],
      [norm(cur.email),   norm(s1.email),   norm(s2.email)],
    ];
    for (const [c, a, b] of tries) {
      if (!c || !a || !b || a === b) continue;   // missing, or can't discriminate
      if (c === a) return 1;
      if (c === b) return 2;
    }
    return 0;
  };
  const isSame = (slot, cand) => {
    if (last10(slot.phone) && last10(cand.phone)) return samePhone(slot.phone, cand.phone);
    if (norm(slot.name) && norm(cand.name)) return norm(slot.name) === norm(cand.name);
    return sameEmail(slot.email, cand.email);
  };
  const cur1 = { name: p.parent_name, phone: p.parent_phone, email: p.parent_email };
  const cur2 = { name: p.parent2_name, phone: p.parent2_phone, email: p.parent_email2 };
  // When the roster already holds both of the sheet's parents, one in each
  // slot, the two sources agree about the family and differ only on which one
  // to call first. That is not a correction, and acting on it flips the same
  // row back and forth on every run — so an already-complete pair is left
  // exactly as it stands.
  const slot1Is = which(cur1);
  // An empty slot 1 has nothing to preserve, so the sheet's order stands. When
  // we can't tell who slot 1 is, the roster's order is left alone rather than
  // guessed at — the cost of a wrong guess is the parent who answers the phone
  // being demoted, and the gain from a right one is nothing.
  const blank1 = !norm(p.parent_name) && !norm(p.parent_email) && !norm(p.parent_phone);
  const swap = blank1 ? false : slot1Is === 2;
  const [first, second] = swap ? [s2, s1] : [s1, s2];
  const settled = !blank1 && slot1Is === 0;
  if (swap) changes.push({ field: "(order)", from: "sheet order", to: "kept roster's parent 1", note: true });

  // A slot may be rewritten when it's blank, or when we can tell it's the same
  // person being written back in a fuller form. Overwriting a slot that holds a
  // DIFFERENT person is how a working phone number gets lost, so it doesn't
  // happen — the other person lands in the second slot or gets reported.
  const trusted1 = settled ? false
    : (!norm(p.parent_name) && !norm(p.parent_email) && !norm(p.parent_phone)) ? true
    : isSame(cur1, first);
  const put = (field, cur, next, allow, { same } = {}) => {
    if (!next) return;
    if (same ? same(cur, next) : norm(cur) === norm(next)) return;   // already agrees
    if (cur && (fillOnly || !allow)) return;
    changes.push({ field, from: cur || "", to: next });
  };
  put("parent_name",  p.parent_name,  first.name,  trusted1);
  put("parent_phone", p.parent_phone, first.phone, trusted1, { same: samePhone });
  // Last guard against the failure that keeps trying to happen: one person in
  // both slots. If the sheet only ever named one parent, slot 2 stays as it is.
  const twoPeople = !!norm(second.name) && norm(second.name) !== norm(first.name);
  put("parent2_name",  p.parent2_name,  twoPeople ? second.name : "",  true);
  put("parent2_phone", p.parent2_phone, twoPeople ? second.phone : "", true, { same: samePhone });
  put("player_phone",  p.player_phone,  s.player_phone, true, { same: samePhone });

  // ── Emails: three slots, and nothing is ever deleted ──────────────────────
  // Collected as a set so the row ends up holding every address we knew plus
  // every address the sheet knows, in a sensible order: parent 1, parent 2,
  // then whatever else was already on file. parent_email/2/3 are exactly the
  // fields the club's parent blasts read, so an address that lands in any of
  // them still gets mailed.
  const wanted = [];
  const push = (e) => { const v = clean(e); if (v && !wanted.some(x => sameEmail(x, v))) wanted.push(v); };
  push(first.email);
  push(second.email);
  push(p.parent_email); push(p.parent_email2); push(p.parent_email3);
  const curEmails = [p.parent_email, p.parent_email2, p.parent_email3];
  if (wanted.length > 3) {
    stuck.push({ p, s, keep: curEmails.filter(Boolean), wanted: wanted.slice(3).join(", ") });
  } else if (!fillOnly) {
    ["parent_email", "parent_email2", "parent_email3"].forEach((f, i) => {
      const next = wanted[i] || null;
      if (!next) return;                       // never blank a slot out
      if (sameEmail(p[f], next)) return;
      changes.push({ field: f, from: p[f] || "", to: next, moved: !!p[f] });
    });
  } else {
    ["parent_email", "parent_email2", "parent_email3"].forEach((f, i) => {
      if (!clean(p[f]) && wanted[i]) changes.push({ field: f, from: "", to: wanted[i] });
    });
  }

  if (changes.some(c => !c.note)) plans.push({ p, s, changes });
}

// ── Report ──────────────────────────────────────────────────────────────────
console.log(`Master sheets: ${sheetRows.length} players` + (onlyTeam ? ` (filtered to ${onlyTeam})` : ""));
console.log(`Roster: ${roster.length} active players`);
console.log(`${plans.length} player${plans.length === 1 ? "" : "s"} would change, ` +
  `${plans.reduce((n, x) => n + x.changes.length, 0)} field${plans.length === 1 ? "" : "s"} total` +
  (fillOnly ? "  (--fill-only: blanks only)" : ""));

const tally = new Map();
for (const pl of plans) for (const c of pl.changes) {
  const k = c.field + (c.from ? " (overwrite)" : " (fill blank)");
  tally.set(k, (tally.get(k) || 0) + 1);
}
console.log("");
[...tally.entries()].sort().forEach(([k, n]) => console.log("   " + String(n).padStart(4) + "  " + k));

if (unmatched.length) {
  console.log(`\n⚠ ${unmatched.length} sheet row${unmatched.length === 1 ? "" : "s"} matched no roster player:`);
  unmatched.forEach(s => console.log(`   ${s.team.padEnd(13)} ${s.first} ${s.last}  (${s.book} row ${s.row})`));
}
if (stuck.length) {
  console.log(`\n⚠ ${stuck.length} row${stuck.length === 1 ? "" : "s"} already hold three different addresses — left alone so none is lost:`);
  stuck.forEach(x => console.log(`   ${x.p.first_name} ${x.p.last_name} (${x.p.team_assignment}): has ${x.keep.filter(Boolean).join(", ")} · sheet wants ${x.wanted}`));
}

const overwrites = plans.flatMap(pl => pl.changes.filter(c => c.from && !c.moved).map(c => ({ pl, c })));
if (overwrites.length) {
  console.log(`\n─── ${overwrites.length} value${overwrites.length === 1 ? "" : "s"} that would be REPLACED (not just filled in) ───`);
  overwrites.forEach(({ pl, c }) =>
    console.log(`   ${(pl.p.first_name + " " + pl.p.last_name).padEnd(24)} ${c.field.padEnd(14)} ${String(c.from).padEnd(30)} → ${c.to}`));
}

if (!doWrite) {
  const sample = plans.slice(0, 3);
  if (sample.length) {
    console.log("\n─── first few players in full ──────────────────────────");
    sample.forEach(({ p, changes }) => {
      console.log(`   ${p.first_name} ${p.last_name} (${p.team_assignment})`);
      changes.forEach(c => console.log(`      ${c.field.padEnd(14)} ${(c.from || "(blank)").padEnd(30)} → ${c.to}${c.moved ? "   [moved, not lost]" : ""}`));
    });
  }
  console.log("\nDRY RUN — nothing written. Re-run with --write to apply.");
} else {
  // Every current value of every row we touch, saved before anything changes.
  const stampFile = new URL("../.contact-import-backup.json", import.meta.url);
  writeFileSync(stampFile, JSON.stringify(plans.map(({ p }) => p), null, 2));
  console.log(`\nBackup of ${plans.length} rows' current values → .contact-import-backup.json`);

  let ok = 0, failed = 0;
  for (const { p, changes } of plans) {
    const patch = {};
    // `note` entries are commentary for the report — "(order)" is not a column.
    for (const c of changes) if (!c.note) patch[c.field] = c.to;
    if (!Object.keys(patch).length) continue;
    const { error: uErr } = await supabase.from("players").update(patch).eq("id", p.id);
    if (uErr) { failed++; console.error(`FAILED ${p.first_name} ${p.last_name}: ${uErr.message}`); }
    else ok++;
  }
  console.log(`\nDone. ${ok} players updated, ${failed} failed.`);
}
