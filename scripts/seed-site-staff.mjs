// Seed site_staff (the public website's coach profiles) from the coach-folder
// manifest, and upload each headshot to the public site-media bucket.
//
// Source: the research manifest built from Drew's coach folders (OneDrive
// "Coaches"): one entry per coach with the roster name, the verbatim bio from
// their .docx (contact lines already excluded) and a prepared 4:5 headshot crop.
//
// Rules (website spec, 14 Oct 2026):
//   - current coaches only: names on practice_teams (head/assistant/third) or
//     the leadership list. Chloe White, Matt Mercier and Alexa Sandoval are not.
//   - bio = the coach's own bio, minus the spring-2026 "X will serve as ... next
//     season" opener (teams come from the app, not the bio), minus minor
//     coaches' ages / school. NEVER the agent-written draft_bio, so Karissa
//     Hartzell's bio stays NULL until she sends one.
//   - no phone numbers or email addresses: checked with a regex before writing;
//     the script stops if one slips through.
//   - photo: coach-headshots/<slug>.jpg → 800x1000-max WebP q80 (metadata
//     stripped) → site-media/staff/<slug>.webp; photo_url = its public URL
//     (?v=<hash> so a replaced photo isn't served stale). No headshot → NULL.
//   - leadership (Rise orientation deck, 11 Oct 2026): Drew Rose — Founder &
//     Club Director (1), Tionne Graves-Brown — Assistant Director (2), Kristen
//     Alexandrov — Operations Manager (3). Everyone else sort 100, no title.
//
// Idempotent upsert on name. A row someone has since edited in HQ (updated_by
// is a person, not this script) is left alone unless --force.
//
// Usage:
//   node scripts/seed-site-staff.mjs --manifest <coaches-manifest.json> --headshots <dir> [--sharp <dir of sharp module>] [--dry] [--force]
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { isPlaceholder } from "../shared/day-schedule.js";
import { personSlug } from "../shared/site-slug.js";

const SEEDER = "seed-site-staff";
const BUCKET = "site-media";
const LEADERSHIP = [
  { name: "Drew Rose", title: "Founder & Club Director", sort_order: 1 },
  { name: "Tionne Graves-Brown", title: "Assistant Director", sort_order: 2 },
  { name: "Kristen Alexandrov", title: "Operations Manager", sort_order: 3 },
];
const NOT_CURRENT = ["Chloe White", "Matt Mercier", "Alexa Sandoval"];
const NO_BIO = new Set(["Karissa Hartzell"]);   // only an agent-written draft exists
const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i;

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
const MANIFEST = value("manifest");
const HEADSHOTS = value("headshots");
const dry = flag("dry"), force = flag("force");
if (!MANIFEST || !HEADSHOTS) { console.error("Give --manifest <coaches-manifest.json> and --headshots <dir>."); process.exit(1); }

async function loadSharp() {
  const dir = value("sharp");
  if (dir) return createRequire(path.join(path.resolve(dir), "noop.js"))("sharp");
  try { return (await import("sharp")).default; }
  catch { console.error("sharp isn't installed here — pass --sharp <folder whose node_modules has sharp>."); process.exit(1); }
}

// ---- bio clean-up -------------------------------------------------------------

const SENT_SPLIT = /(?<=[.!?]["”’)]?)\s+(?=["“‘(]?[A-Z0-9])/;
// "Ambria Rupp will serve as the Head Coach for 14 Sapphire ... next season at DS Elite!"
// "Brandon Blahnik will be the Head Coach of 11 Diamond next season at DS Elite!"
const isServeSentence = (s) => /\bwill (?:serve as|be)\b/i.test(s) && /next season|at DS Elite/i.test(s);
// Minor coaches: no age, no named school.
const MINOR_FIXES = [
  [/\bAt (?:the age of )?1\d(?: years old)?,\s*/g, ""],                                     // "At 17 years old, Ella brings" → "Ella brings"
  [/\bis currently a student at [^.!?]*?\b(?:High School|Middle School|Academy)\s+and\s+/g, ""],  // "Mia is currently a student at X High School and brings" → "Mia brings"
];
const MINOR_LEFTOVER = /\b1\d years? old\b|\bage(?:d)? 1\d\b|currently a student|high school student/i;

function cleanBio(raw, { minor }) {
  if (!raw) return null;
  const paras = String(raw).replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  let removed = false;
  const out = [];
  for (const p of paras) {
    let sents = p.split(SENT_SPLIT);
    if (!removed) {
      const i = sents.findIndex(isServeSentence);
      if (i >= 0) { sents = sents.filter((_, j) => j !== i); removed = true; }
    }
    let text = sents.join(" ").trim();
    if (minor) for (const [re, to] of MINOR_FIXES) text = text.replace(re, to);
    if (text) out.push(text);
  }
  const bio = out.join("\n\n").trim();
  if (minor && MINOR_LEFTOVER.test(bio)) throw new Error("A minor coach's bio still mentions an age/school — fix the rules before seeding.");
  return bio || null;
}

// ---- main ---------------------------------------------------------------------------

const env = loadEnv();
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data || []; };

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const teams = must(await sb.from("practice_teams").select("team_name, head_coach, assistant_coach, third_coach"), "practice_teams");
const onRoster = new Set(teams.flatMap((t) => [t.head_coach, t.assistant_coach, t.third_coach]).map((s) => String(s || "").trim()).filter((s) => s && !isPlaceholder(s)));
const leaderBy = new Map(LEADERSHIP.map((l) => [l.name, l]));
const existing = new Map(must(await sb.from("site_staff").select("name, updated_by"), "site_staff").map((r) => [r.name, r]));

const entries = [];
for (const m of manifest) {
  const name = String(m.roster_name_guess || "").trim();
  if (!name) continue;                                   // folders with no app coach (Chloe White, Matt Mercier)
  if (NOT_CURRENT.includes(name)) continue;
  if (!onRoster.has(name) && !leaderBy.has(name)) { console.log(`skip ${name}: not on a current team`); continue; }
  entries.push({ m, name });
}
for (const l of LEADERSHIP) if (!entries.some((e) => e.name === l.name)) entries.push({ m: {}, name: l.name });
for (const n of NOT_CURRENT) if (entries.some((e) => e.name === n)) throw new Error(n + " must not be seeded");

const sharp = await loadSharp();
const rows = [];
for (const { m, name } of entries) {
  const slug = personSlug(name);
  const minor = (m.flags || []).some((f) => /minor_coach/i.test(f));
  const bio = NO_BIO.has(name) ? null : cleanBio(m.bio, { minor });
  const lead = leaderBy.get(name);
  const title = lead ? lead.title : null;
  for (const [field, v] of [["bio", bio], ["title", title]]) {
    if (v && (PHONE.test(v) || EMAIL.test(v))) throw new Error(`${name}'s ${field} contains a phone number or email — not writing anything.`);
  }
  let photo_url = null;
  const file = path.join(HEADSHOTS, slug + ".jpg");
  if (existsSync(file)) {
    const buf = await sharp(file).rotate().resize({ width: 800, height: 1000, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    const key = `staff/${slug}.webp`;
    if (!dry) {
      const up = await sb.storage.from(BUCKET).upload(key, buf, { contentType: "image/webp", upsert: true, cacheControl: "86400" });
      if (up.error) throw new Error(`upload ${key}: ${up.error.message}`);
    }
    const { data } = sb.storage.from(BUCKET).getPublicUrl(key);
    photo_url = data.publicUrl + "?v=" + createHash("sha1").update(buf).digest("hex").slice(0, 10);
  }
  rows.push({
    name, slug, title, bio, photo_url,
    leadership: !!lead, sort_order: lead ? lead.sort_order : 100, show_on_site: true,
    updated_at: new Date().toISOString(), updated_by: SEEDER,
  });
}

const edited = rows.filter((r) => { const e = existing.get(r.name); return e && e.updated_by && e.updated_by !== SEEDER; });
const toWrite = force ? rows : rows.filter((r) => !edited.includes(r));
if (!dry && toWrite.length) must(await sb.from("site_staff").upsert(toWrite, { onConflict: "name" }).select("name"), "upsert site_staff");

const lead = (r) => (r.leadership ? 0 : 1);
console.table(rows.slice().sort((a, b) => lead(a) - lead(b) || a.sort_order - b.sort_order || a.name.localeCompare(b.name)).map((r) => ({
  name: r.name, slug: r.slug, title: r.title || "", has_bio: !!r.bio, has_photo: !!r.photo_url, leadership: r.leadership,
  written: dry ? "dry run" : toWrite.includes(r) ? "yes" : "kept HQ edit",
})));
console.log(`${dry ? "Would write" : "Wrote"} ${toWrite.length} of ${rows.length} rows${edited.length && !force ? ` (${edited.length} edited in HQ kept; --force overwrites)` : ""}.`);
