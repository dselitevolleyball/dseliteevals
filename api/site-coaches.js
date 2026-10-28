// GET /api/site-coaches — who coaches at Dripping Springs Sports Club, by sport,
// for drippingsportsclub.com's "Meet the director" / "Meet the coaches".
//
// Public, read-only, no secrets. A coach is anyone who has been on a DSSC class
// (dssc_clinics.sessions[].coach_name / staff[]) in the last ~4 months or has one
// coming up, plus active dssc_people with that sport. Their public profile —
// title, bio, photo — is the same site_staff row the DS Elite website uses
// (HQ → Website → Staff profiles), matched by name, so a bio is written once.
// The directors are fixed here (Drew, 20 Oct 2026): Hunter volleyball, Adrian
// basketball (4th Quarter Athlete), Brandon Butler Reach (not Brandon Blahnik, the
// DS Elite coach — migration 20261009).
//
//   200 { ok, generated_at, sports: { volleyball: { director, coaches[] }, basketball: …, reach: … } }
//   person: { name, slug, title, bio, photo_url, director: bool, classes: n, has_profile: bool }
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from "@supabase/supabase-js";

const SPORTS = ["volleyball", "basketball", "reach"];
const DIRECTORS = [
  { sport: "volleyball", name: "Hunter Haley", emails: ["hunter@drippingsportsclub.com", "hunterhaleysc10@gmail.com"], title: "Director of Volleyball" },
  { sport: "basketball", name: "Adrian Thomas", emails: ["adrian@drippingsportsclub.com", "adrian@4thquarterathlete.com"], title: "Director of Basketball · 4th Quarter Athlete" },
  { sport: "reach", name: "Brandon Butler", emails: ["brandon@drippingsportsclub.com"], title: "Reach Performance" },
];
// Never a public coach card, whatever the clinic rows say.
const SKIP = new Set(["tbd", "open", "needs coverage", "unassigned", "coach", "staff", "n/a", "none"]);

const key = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\bcoach\b/g, "").replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
const slugify = (s) => key(s).replace(/ /g, "-");
const first = (s) => key(s).split(" ")[0] || "";
const nrmSport = (s) => { const t = String(s || "").toLowerCase(); return t.includes("basket") ? "basketball" : /reach|perform|strength|speed/.test(t) ? "reach" : "volleyball"; };
const ymd = (d) => d.toISOString().slice(0, 10);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "HEAD") { res.setHeader("Allow", "GET, HEAD, OPTIONS"); return res.status(405).json({ ok: false, error: "GET only" }); }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ ok: false, error: "Server not configured" });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const since = new Date(); since.setDate(since.getDate() - 120);
  const until = new Date(); until.setDate(until.getDate() + 120);
  const [staffRes, peopleRes, clinicRes] = await Promise.all([
    sb.from("site_staff").select("name, slug, title, bio, photo_url, show_on_site, sort_order"),
    sb.from("dssc_people").select("first_name, last_name, email, role, sports, active").eq("active", true),
    sb.from("dssc_clinics").select("id, name, sport, coach_name, assistants, sessions, clinic_date, end_date").or(`end_date.gte.${ymd(since)},clinic_date.gte.${ymd(since)}`),
  ]);
  for (const [what, r] of [["site_staff", staffRes], ["dssc_people", peopleRes], ["dssc_clinics", clinicRes]]) {
    if (r.error) { console.error("site-coaches", what, r.error.message); return res.status(502).json({ ok: false, error: `${what}: ${r.error.message}` }); }
  }
  const staff = staffRes.data || [], people = peopleRes.data || [], clinics = clinicRes.data || [];

  // Profiles by full name, and by first name when that first name is unique
  // (clinic rows often say just "Hunter" or "Coach T").
  const byName = new Map(staff.map((r) => [key(r.name), r]));
  const byFirst = new Map();
  for (const r of staff) { const f = first(r.name); byFirst.set(f, byFirst.has(f) ? null : r); }
  const ALIAS = { "t": "tionne graves brown", "coach t": "tionne graves brown" };
  const profileFor = (name) => { const k = ALIAS[key(name)] || key(name); return byName.get(k) || (k.includes(" ") ? null : byFirst.get(k)) || null; };

  // seen[sport] = Map(personKey -> { name, classes })
  const seen = Object.fromEntries(SPORTS.map((s) => [s, new Map()]));
  const add = (sport, name, n = 0) => {
    const k = key(name); if (!k || SKIP.has(k) || k.length < 2) return;
    const prof = profileFor(name);
    const id = prof ? key(prof.name) : k;
    const cur = seen[sport].get(id) || { name: prof ? prof.name : String(name).trim(), classes: 0 };
    cur.classes += n; seen[sport].set(id, cur);
  };
  const lo = ymd(since), hi = ymd(until);
  for (const c of clinics) {
    const sport = nrmSport(c.sport || c.name);
    const sessions = Array.isArray(c.sessions) ? c.sessions : [];
    let counted = false;
    for (const s of sessions) {
      if (!s || (s.date && (s.date < lo || s.date > hi))) continue;
      const names = [s.coach_name, ...((Array.isArray(s.staff) ? s.staff : []).filter((x) => x && x.status !== "declined").map((x) => x.name))].filter(Boolean);
      for (const nm of names) { add(sport, nm, 1); counted = true; }
    }
    if (!counted) for (const nm of [c.coach_name, ...String(c.assistants || "").split(/[,;/&]+/)]) if (nm && nm.trim()) add(sport, nm, 1);
  }
  for (const p of people) {
    if (!["coach", "admin"].includes(String(p.role || "").toLowerCase())) continue;
    const sports = (Array.isArray(p.sports) ? p.sports : []).map(nrmSport).filter((s) => SPORTS.includes(s));
    const nm = [p.first_name, p.last_name].filter(Boolean).join(" ");
    for (const s of sports) add(s, nm, 0);
  }
  for (const d of DIRECTORS) add(d.sport, d.name, 0);

  const person = (entry, sport) => {
    const prof = profileFor(entry.name);
    const dir = DIRECTORS.find((d) => d.sport === sport && key(d.name) === key(entry.name));
    if (prof && prof.show_on_site === false && !dir) return null;
    return {
      name: entry.name, slug: prof?.slug || slugify(entry.name),
      title: dir ? dir.title : (prof?.title || null),
      bio: prof?.bio || null, photo_url: prof?.photo_url || null,
      director: !!dir, classes: entry.classes, has_profile: !!(prof && (prof.bio || prof.photo_url)),
      sort: prof?.sort_order ?? 100,
    };
  };
  const sports = {};
  for (const s of SPORTS) {
    const list = [...seen[s].values()].map((e) => person(e, s)).filter(Boolean)
      .sort((a, b) => Number(b.director) - Number(a.director) || Number(b.has_profile) - Number(a.has_profile) || b.classes - a.classes || a.sort - b.sort || a.name.localeCompare(b.name));
    const director = list.find((p) => p.director) || null;
    if (director) delete director.sort;
    sports[s] = { director, coaches: list.filter((p) => !p.director).map(({ sort, ...p }) => p) };
  }
  res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=86400");
  return res.status(200).json({ ok: true, generated_at: new Date().toISOString(), sports });
}
