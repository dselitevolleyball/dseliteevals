// 12 Diamond staffing update, 5 Oct 2026 — Jillian Beck 1st assistant, Rene
// Sandoval 3rd coach (Tue/Thu + Sundays he's free, travels when free of
// 14 Ruby). Every upcoming practice with who's coaching it, and every
// tournament with who's going, read live from the schedule (Day Schedule
// builder + tournament assignments), so time off and tournament conflicts show.
//
// DRY RUN BY DEFAULT (writes the HTML so it can be looked at).
//   node scripts/send-12diamond-update.mjs --html out.html
//   node scripts/send-12diamond-update.mjs --test drew@dselitevolleyball.com
//   node scripts/send-12diamond-update.mjs --send

import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { daySchedule, fmtSpan } from "../shared/day-schedule.js";

const TEAM = "12 Diamond";
const TO = ["renealbertosandoval@gmail.com", "taraanne888@yahoo.com", "jillian.beck2@gmail.com", "kristen@dselitevolleyball.com", "tionne@drippingsportsclub.com"];
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const testTo = val("test"), doSend = args.includes("--send"), htmlOut = val("html");
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const first = (n) => String(n || "").split(" ")[0];
const tidy = (s) => String(s || "").replace(/\s+—.*$/, "").replace(/Girls Junior National Qualifier/, "National Qualifier").replace(/Girls National Qualifier/, "National Qualifier");
const clip = (w) => { w = String(w || "").replace(/\s+/g, " ").trim(); return w.length > 60 ? w.slice(0, 57).replace(/\s\S*$/, "") + "..." : w; };
const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const fmtD = (iso, o = { weekday: "short", month: "short", day: "numeric" }) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", ...o });
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ── Practices ─────────────────────────────────────────────────────────────
const practices = [];
for (let d = addDays(today, 1); d <= "2027-06-15"; d = addDays(d, 1)) {
  const wd = new Date(d + "T12:00:00Z").getUTCDay(); if (![0, 1, 2, 3, 4].includes(wd)) continue;
  if (wd !== 0 && d < "2026-11-29") continue;
  let s = null; for (let i = 0; i < 4 && !s; i++) { try { s = await daySchedule(sb, d); } catch { await new Promise(r => setTimeout(r, 1500)); } }
  if (!s) throw new Error("couldn't load " + d);
  const off = s.offTeams.find(o => o.team === TEAM);
  if (s.cancelled) { if (wd === 0 || wd === 2 || wd === 4) practices.push({ d, cancelled: s.cancelled }); continue; }
  if (off) { practices.push({ d, away: tidy(off.why) }); continue; }
  const t = s.teams.find(x => x.team === TEAM); if (!t) continue;
  const coaching = t.floor.map(f => f.role === "Sub" ? `${first(f.name)} (sub for ${first(f.forWhom)})` : first(f.name));
  // Jillian's standing Tue/Thu absence is explained once at the top, not on every row.
  const out = t.coaches.filter(c => (c.status === "out" || c.status === "away") && !/Tuesdays\/Thursdays/.test(c.why || "")).map(c => `${first(c.name)} out${c.why ? " - " + clip(tidy(c.why)) : ""}`);
  practices.push({ d, time: t.blocks.map(([a, b]) => fmtSpan(a, b)).join(", "), coaching, out, short: t.floor.length < 2 });
}

// ── Tournaments ───────────────────────────────────────────────────────────
const { data: tas } = await sb.from("tournament_assignments").select("tournament_id, status, head_override, asst_override, sub_coach").eq("team_id", TEAM);
const { data: tns } = await sb.from("tournaments").select("id, name, start_date, end_date, location, stay_over, cancelled").in("id", tas.map(a => a.tournament_id)).gte("end_date", today).order("start_date");
const { data: team } = await sb.from("practice_teams").select("head_coach, assistant_coach, third_coach").eq("team_name", TEAM).single();
const { data: rubyTas } = await sb.from("tournament_assignments").select("tournament_id, status, asst_override").eq("team_id", "14 Ruby");
const tourneys = (tns || []).filter(t => !t.cancelled).map(t => {
  const a = tas.find(x => x.tournament_id === t.id);
  if (a?.status === "dropped") return null;
  const staff = [first(a.head_override || team.head_coach), first(a.asst_override || team.assistant_coach), a.sub_coach ? first(a.sub_coach) : null].filter(Boolean);
  const when = t.end_date && t.end_date !== t.start_date ? fmtD(t.start_date, { month: "short", day: "numeric" }) + "-" + fmtD(t.end_date, { day: "numeric" }) : fmtD(t.start_date);
  const rubyHere = (rubyTas || []).find(x => x.tournament_id === t.id && x.status !== "dropped" && (!x.asst_override || x.asst_override === "Rene Sandoval"));
  if (rubyHere && !a.sub_coach) staff.push("(Rene there with 14 Ruby)");
  return { when, name: tidy(t.name), where: t.location, overnight: !!t.stay_over, staff, rene: !!a.sub_coach };
}).filter(Boolean);

// ── Email ─────────────────────────────────────────────────────────────────
const th = 'style="text-align:left;padding:6px 10px;border-bottom:2px solid #ddd;font-size:12px;color:#555;text-transform:uppercase;letter-spacing:.04em"';
const td = (x, extra = "") => `<td style="padding:6px 10px;border-bottom:1px solid #eee;vertical-align:top;${extra}">${x}</td>`;
const byMonth = new Map(); for (const p of practices) { const k = fmtD(p.d, { month: "long", year: "numeric" }); if (!byMonth.has(k)) byMonth.set(k, []); byMonth.get(k).push(p); }
const practiceRows = [...byMonth.entries()].map(([m, list]) => `<tr><td colspan="3" style="padding:12px 10px 4px;font-weight:800;color:#c2186f">${m}</td></tr>` + list.map(p =>
  p.cancelled ? `<tr>${td(fmtD(p.d))}${td("")}${td(`<i style="color:#888">No practice - ${esc(p.cancelled)}</i>`)}</tr>`
  : p.away ? `<tr>${td(fmtD(p.d))}${td("")}${td(`<i style="color:#888">No practice - team ${esc(p.away.replace(/^At /, "at "))}</i>`)}</tr>`
  : `<tr>${td(fmtD(p.d), "white-space:nowrap")}${td(esc(p.time), "white-space:nowrap")}${td(`<b${p.short ? ' style="color:#b91c1c"' : ""}>${esc(p.coaching.join(", ") || "NO COACH")}</b>${p.out.length ? `<div style="font-size:12px;color:#888">${esc(p.out.join(" · "))}</div>` : ""}`)}</tr>`).join("")).join("");
const tourneyRows = tourneys.map(t => `<tr>${td(esc(t.when), "white-space:nowrap")}${td(`${esc(t.name)}<div style="font-size:12px;color:#888">${esc(t.where)}${t.overnight ? " · overnight" : ""}</div>`)}${td(`<b>${esc(t.staff.join(", "))}</b>`)}</tr>`).join("");
const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:14px;color:#222;max-width:680px;line-height:1.5">
<p>Hi all,</p>
<p>Here's how <b>12 Diamond</b> is staffed from here on, with every upcoming practice and tournament and who's covering each one.</p>
<p style="margin:18px 0 4px;font-weight:800;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#c2186f">What's changing</p>
<ul style="margin:0 0 10px;padding-left:20px">
<li><b>Tara Fisher</b> - head coach.</li>
<li><b>Jillian Beck</b> - now 12 Diamond's 1st assistant, and goes to every 12 Diamond tournament. Jillian can't work Tuesdays or Thursdays, so she coaches the Sunday practices.</li>
<li><b>Rene Sandoval</b> - 3rd coach. Rene coaches the Tuesday and Thursday practices, and Sundays when he isn't out or at a tournament with 14 Ruby (he stays 14 Ruby's assistant). He'll also travel with 12 Diamond to the tournaments he's free for.</li>
</ul>
<p style="margin:18px 0 4px;font-weight:800;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#c2186f">Tournaments</p>
<table style="border-collapse:collapse;width:100%;font-size:14px"><tr><th ${th}>When</th><th ${th}>Tournament</th><th ${th}>Coaches going</th></tr>${tourneyRows}</table>
<p style="margin:18px 0 4px;font-weight:800;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#c2186f">Practices</p>
<p style="font-size:13px;color:#555;margin:0 0 6px">Tuesdays and Thursdays are Tara and Rene (Jillian doesn't work those days). Sundays are Tara, Jillian and Rene unless noted.</p>
<table style="border-collapse:collapse;width:100%;font-size:14px"><tr><th ${th}>Date</th><th ${th}>Time</th><th ${th}>Coaching</th></tr>${practiceRows}</table>
<p style="font-size:12px;color:#888">Fall practices are Sundays only; the season (weekday practices) starts the weekend after Thanksgiving. Built from the app's schedule today; it already accounts for approved time off and tournament weekends. If something changes, the Day Schedule in the app has the latest.</p>
<p>Kristen - travel for Jillian and Rene on these tournaments is on the list I sent earlier.</p>
<p>Any questions or anything that looks wrong, just reply.</p>
<p>Drew</p></div>`;
const NL = "\n";
const text = "12 Diamond staffing and schedule" + NL + NL + "TOURNAMENTS" + NL + tourneys.map(t => `${t.when}  ${t.name} (${t.where})  -  ${t.staff.join(", ")}`).join(NL)
  + NL + NL + "PRACTICES" + NL + practices.map(p => p.cancelled ? `${fmtD(p.d)}  no practice - ${p.cancelled}` : p.away ? `${fmtD(p.d)}  no practice - team ${p.away}` : `${fmtD(p.d)} ${p.time}  ${p.coaching.join(", ")}${p.out.length ? "  (" + p.out.join("; ") + ")" : ""}`).join(NL);
const subject = "12 Diamond - coaching changes, practices and tournaments";

console.log(`practices: ${practices.length} · tournaments: ${tourneys.length} · short-staffed practices: ${practices.filter(p => p.short).map(p => p.d).join(", ") || "none"}`);
if (htmlOut) writeFileSync(htmlOut, html);
const send = async (recipients) => {
  const r = await fetch("https://dseliteevals.vercel.app/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: (testTo ? "[COPY] " : "") + subject, body: text, bodyHtml: html, recipients, replyTo: "drew@dselitevolleyball.com" }) });
  return (await r.json().catch(() => ({})));
};
if (testTo) console.log("copy:", JSON.stringify(await send([testTo])));
else if (doSend) console.log("sent:", JSON.stringify(await send(TO)));
