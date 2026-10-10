// Oct 18 + Oct 25, 2026 (Drew, Oct 10): scrimmages run on Court 3 (the big
// far court), the other teams in that hour use Courts 1 and 2, and only 3 nets
// go up those days - the first practice of the day sets up 3, not 4. One text
// per coach covering just their teams; ASCII, {first}.
//   node scripts/send-scrimmage-sundays.mjs            # dry run
//   node scripts/send-scrimmage-sundays.mjs --send

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { daySchedule, personKey } from "../shared/day-schedule.js";

const APP = "https://dseliteevals.vercel.app";
const DATES = [["2026-10-18", "Oct 18"], ["2026-10-25", "Oct 25"]];
const SKIP = ["drew rose"];             // Drew wrote it
const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const send = process.argv.includes("--send");
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const h12 = (h) => (h % 12 === 0 ? 12 : h % 12);
const span = (s, e) => `${h12(s)}-${h12(e)}pm`;
const hrsOf = (lbl) => { const m = /^(\d{1,2})-(\d{1,2})/.exec(lbl || ""); if (!m) return null; const h = (n) => (n === 12 ? 12 : n < 9 ? n + 12 : n); return [h(+m[1]), h(+m[2])]; };

const { data: scr } = await sb.from("practice_scrimmages").select("*").in("practice_date", DATES.map(d => d[0]));
const [{ data: roster }, { data: outs }] = await Promise.all([sb.from("coach_roster").select("first_name, last_name, phone"), sb.from("sms_optouts").select("phone")]);
const out = new Set((outs || []).map(o => String(o.phone).replace(/\D/g, "").slice(-10)));

// coach key -> { name, items: Map(text -> Set(dateLabel)) }
const coaches = new Map();
const note = (name, text, dateLabel) => {
  const k = personKey(name); if (!k || SKIP.includes(k)) return;
  if (!coaches.has(k)) coaches.set(k, { name, items: new Map() });
  const it = coaches.get(k).items; if (!it.has(text)) it.set(text, new Set()); it.get(text).add(dateLabel);
};
for (const [date, label] of DATES) {
  const day = await daySchedule(sb, date);
  const scrims = (scr || []).filter(x => x.practice_date === date).map(x => ({ ...x, hrs: hrsOf(x.slot) }));
  const first = Math.min(...day.teams.map(t => t.blocks[0][0]));
  for (const t of day.teams) {
    const who = t.floor.map(p => p.name);
    for (const [s, e] of t.blocks) {
      if (s === first) for (const c of who) note(c, `first on at ${span(s, e)} (${t.team}): please set up only 3 nets - Courts 1, 2 and 3`, label);
      for (let h = s; h < e; h++) {
        const sc = scrims.find(x => x.hrs && x.hrs[0] <= h && h < x.hrs[1] && x.teams.includes(t.team));
        const anyScrim = scrims.some(x => x.hrs && x.hrs[0] <= h && h < x.hrs[1]);
        if (sc) for (const c of who) note(c, `${span(h, h + 1)}: ${t.team} scrimmages ${sc.teams.filter(x => x !== t.team).join(" and ")} on Court 3`, label);
        else if (anyScrim) for (const c of who) note(c, `${span(h, h + 1)}: ${t.team} practices on Court 1 or 2`, label);
      }
    }
  }
}
// Merge consecutive "Court 1 or 2" hours into one line per team is overkill; texts stay short anyway.
const jobs = [];
for (const c of coaches.values()) {
  const lines = [...c.items.entries()].map(([text, ds]) => `- ${[...ds].length === 2 ? "Oct 18 + 25" : [...ds][0]}, ${text}`);
  const relevant = lines.length > 0;
  if (!relevant) continue;
  const head = `Hi {first}, Sun Oct 18 + 25: scrimmages are on Court 3 (the big far court) and we are only setting up 3 nets, not 4.\n${lines.join("\n")}`;
  const tail = "Want to set up another scrimmage? Let me know so we can put it on a bigger court, not a small practice court. - Drew";
  const one = head + "\n" + tail;
  // Over ~600 characters a carrier can block the text, so long ones go as two.
  const texts = one.length <= 600 ? [one] : [head, "{first}, one more thing: " + tail];
  const r = roster.find(x => personKey(x.first_name + " " + x.last_name) === personKey(c.name));
  const d = String(r?.phone || "").replace(/\D/g, "").slice(-10);
  jobs.push({ name: c.name, to: d.length === 10 && !out.has(d) ? "+1" + d : null, texts });
}
for (const j of jobs) {
  for (const t of j.texts) if (t.length > 600 || /[^\x20-\x7E\n]/.test(t)) throw new Error("bad text for " + j.name + " (" + t.length + ")");
  console.log(`\n== ${j.name} ${j.to || "(NO PHONE)"} [${j.texts.map(t => t.length).join(" + ")}]\n${j.texts.map(t => t.replace("{first}", j.name.split(" ")[0])).join("\n  ---\n")}`);
}
console.log(`\n${jobs.length} coaches, ${jobs.filter(j => j.to).length} with phones`);
if (!send) { console.log("DRY RUN"); process.exit(0); }
let ok = 0;
for (const j of jobs.filter(j => j.to)) for (const body of j.texts) {
  const r = await fetch(APP + "/api/send-sms", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY },
    body: JSON.stringify({ to: j.to, body, contact_name: j.name, contact_kind: "coach", sent_by_label: "Drew Rose" }) });
  const o = await r.json().catch(() => ({})); if (r.ok && !o.error) ok++; else console.log("FAILED " + j.name + ": " + (o.error || r.status));
}
console.log(`Sent ${ok}.`);
