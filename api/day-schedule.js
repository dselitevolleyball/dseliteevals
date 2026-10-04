// One day's practice schedule, hour by hour — who is with each team and what's
// wrong. Built by shared/day-schedule.js so the app screen and the email agree.
//
//   GET ?date=YYYY-MM-DD           → JSON for the "Day Schedule" screen
//   Vercel Cron (Saturday morning) → emails Drew tomorrow's (Sunday's) schedule
//   ?email=1[&date=]               → send that email now (admin / operator)
//   ?dry=1                         → with email, return the HTML instead of sending
//   POST { date, keys: [...] }      → text those coaches their updated plan for the date
//
// Updated-plan texts: day_plan_texts remembers what each coach was last told
// about a date (a baseline taken by the Saturday run or the first time the
// screen opens the day, then every text sent). The JSON lists each person's
// plan now vs. that, so the screen can offer "text everyone who changed".
//
// Auth: Vercel Cron `Authorization: Bearer <CRON_SECRET>` (or ?token=), the
// service-role key as bearer (operator script), or a signed-in owner/admin.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
//      RESEND_API_KEY (or resend_api_key), DSE_FROM_EMAIL, DSE_REPLY_TO (opt),
//      DAY_SCHEDULE_TO (opt, comma-separated — defaults to Drew).

import { createClient } from "@supabase/supabase-js";
import { appOrigin } from "../shared/app-origin.js";
import { daySchedule, fmtSpan, plansFor, samePerson } from "../shared/day-schedule.js";
import { sendOneSms, normalizePhone, twilioReady } from "./_lib/sms.js";

const OWNERS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];
const TO_DEFAULT = "drew@dselitevolleyball.com";
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const centralToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nextSunday = (iso) => addDays(iso, ((7 - new Date(iso + "T12:00:00Z").getUTCDay()) % 7) || 7);
const prettyDate = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, DSE_FROM_EMAIL, DSE_REPLY_TO, DAY_SCHEDULE_TO } = process.env;
  const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.resend_api_key;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const url = (() => { try { return new URL(req.url, "https://x"); } catch { return null; } })();
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const isCron = !!CRON_SECRET && (bearer === CRON_SECRET || (url?.searchParams.get("token") || "") === CRON_SECRET);
  let who = isCron ? "cron" : "operator";
  if (!isCron && !(bearer && bearer === SUPABASE_SERVICE_ROLE_KEY)) {
    if (!bearer) return res.status(401).json({ error: "Not signed in" });
    const { data: { user } = {} } = await sb.auth.getUser(bearer).catch(() => ({ data: {} }));
    const email = (user?.email || "").trim().toLowerCase();
    if (!email) return res.status(401).json({ error: "Not signed in" });
    let ok = OWNERS.includes(email);
    if (!ok) { const { data: c } = await sb.from("coaches").select("is_admin, is_approved").ilike("email", email).maybeSingle(); ok = !!(c && c.is_approved && c.is_admin); }
    if (!ok) return res.status(403).json({ error: "Admins only" });
    who = email;
  }

  if (req.method === "POST") return sendPlans(sb, req, res, who);

  const qDate = url?.searchParams.get("date") || "";
  const wantEmail = url?.searchParams.get("email") === "1" || (isCron && !qDate);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(qDate) ? qDate : wantEmail ? nextSunday(centralToday()) : centralToday();

  let day;
  try { day = await daySchedule(sb, date); }
  catch (e) { return res.status(500).json({ error: e.message }); }
  let plans = [];
  try { plans = await planState(sb, day); } catch (e) { console.error("plan state:", e.message); }
  if (!wantEmail) return res.status(200).json({ ok: true, ...day, plans, smsReady: twilioReady() });

  // ── Email ──────────────────────────────────────────────────────────────
  if (!day.cancelled && !day.teams.length) return res.status(200).json({ ok: true, emailed: false, date, note: "no practice that day" });
  const link = `${appOrigin(req)}/?view=dayschedule&date=${date}`;
  const { html, text, subject } = renderEmail(day, link);
  if (url?.searchParams.get("dry") === "1") { res.setHeader("Content-Type", "text/html; charset=utf-8"); return res.status(200).send(html); }
  if (!RESEND_API_KEY || !DSE_FROM_EMAIL) return res.status(500).json({ error: "Email not configured" });
  const to = String(DAY_SCHEDULE_TO || TO_DEFAULT).split(",").map(s => s.trim()).filter(Boolean);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: DSE_FROM_EMAIL, to, reply_to: DSE_REPLY_TO || undefined, subject, html, text }),
  });
  if (!r.ok) return res.status(500).json({ error: "Resend " + r.status + ": " + (await r.text()).slice(0, 200) });
  return res.status(200).json({ ok: true, emailed: true, to, date, issues: day.issues.length });
}

function renderEmail(day, link) {
  const crit = day.issues.filter(i => i.level === "critical"), warn = day.issues.filter(i => i.level === "warn"), info = day.issues.filter(i => i.level === "info");
  const problems = crit.length + warn.length;
  const subject = day.cancelled ? `${day.weekday} ${day.date.slice(5).replace("-", "/")} — practice cancelled`
    : `${prettyDate(day.date)} schedule — ` + (crit.length ? `${crit.length} need${crit.length === 1 ? "s" : ""} fixing` : problems ? `${problems} to check` : "all covered");
  const F = "font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;";
  const box = (bg, bd, title, items) => items.length ? `<div style="background:${bg};border-left:4px solid ${bd};border-radius:6px;padding:10px 14px;margin:0 0 12px"><div style="font-weight:700;font-size:13px;margin-bottom:4px;color:#111">${title}</div><ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.5;color:#222">${items.map(i => `<li>${esc(i.text)}</li>`).join("")}</ul></div>` : "";
  const teamBy = new Map(day.teams.map(t => [t.team, t]));
  const critTeams = new Set(crit.map(i => i.team).filter(Boolean));
  const coachLine = (t) => {
    const parts = t.floor.map(p => p.role === "Sub" ? `<span style="color:#0369a1;font-weight:600">${esc(p.name)}</span> <span style="color:#888">(sub for ${esc(p.forWhom)})</span>` : esc(p.name));
    const missing = t.coaches.filter(c => (c.status === "out" || c.status === "away") && !c.sub).map(c => `<span style="color:#b91c1c;text-decoration:line-through">${esc(c.name)}</span>`);
    const open = t.coaches.filter(c => c.status === "open").map(c => `<span style="color:#b45309">${c.role} open</span>`);
    const all = [...parts, ...missing, ...open];
    return (all.length ? all.join(", ") : `<b style="color:#b91c1c">NO COACH</b>`) + (t.combined ? ` <span style="color:#7c3aed">(combined with ${esc(t.combined)})</span>` : "");
  };
  let rows = "";
  for (const h of day.hours) {
    const cells = h.teams.map(x => {
      const t = teamBy.get(x.team); const bad = critTeams.has(x.team);
      const when = t.blocks.map(([s, e]) => fmtSpan(s, e)).join(", ");
      if (!x.starts) return `<div style="padding:3px 0;color:#999;font-size:12px">${esc(x.team)} <span>continues (${when})</span></div>`;
      return `<div style="padding:4px 0;${bad ? "background:#fef2f2;" : ""}font-size:13px"><b style="color:${bad ? "#b91c1c" : "#111"}">${esc(x.team)}</b> <span style="color:#888;font-size:12px">${when}${t.venue ? " · " + esc(t.venue) : ""}</span><br>${coachLine(t)}</div>`;
    }).join("");
    const extra = [h.sa.length ? `S&amp;A: ${h.sa.map(esc).join(", ")}` : "", h.floaters.length ? `Floating: ${h.floaters.map(esc).join(", ")}` : ""].filter(Boolean).join(" · ");
    rows += `<tr><td style="vertical-align:top;padding:8px 10px;border-top:1px solid #eee;font-weight:700;white-space:nowrap;font-size:13px;color:#e91e8c">${esc(h.label)}</td><td style="vertical-align:top;padding:6px 10px;border-top:1px solid #eee">${cells || '<span style="color:#aaa;font-size:12px">No practice</span>'}${extra ? `<div style="color:#666;font-size:12px;padding-top:3px">${extra}</div>` : ""}</td></tr>`;
  }
  const coachRows = day.coaches.map(c => `<tr><td style="padding:3px 10px 3px 0;font-size:13px;white-space:nowrap">${esc(c.name)}</td><td style="padding:3px 0;font-size:12px;color:#555">${c.shifts.map(s => `${fmtSpan(s.start, s.end)} ${esc(s.team)}${/^Sub/.test(s.role) ? " (" + esc(s.role.toLowerCase()) + ")" : ""}`).join(" · ")}</td></tr>`).join("");
  const html = `<div style="${F}max-width:680px;margin:0 auto;color:#111">
<h2 style="margin:0 0 2px;font-size:20px">${esc(prettyDate(day.date))}</h2>
<div style="color:#666;font-size:13px;margin-bottom:14px">${esc(day.phaseLabel)} · ${day.teams.length} teams practicing · ${day.coaches.length} coaches working</div>
${day.cancelled ? `<div style="background:#fef2f2;border-left:4px solid #dc2626;padding:12px;border-radius:6px;font-weight:700">Practice is cancelled: ${esc(day.cancelled)}</div>` : `
${crit.length ? box("#fef2f2", "#dc2626", "Needs fixing", crit) : box("#f0fdf4", "#16a34a", "Every team has two coaches", [{ text: "Nothing missing." }])}
${box("#fffbeb", "#d97706", "Worth checking", warn)}
${box("#f5f5f5", "#9ca3af", "Subs &amp; changes already handled", info)}
${day.offTeams.length ? `<div style="font-size:13px;color:#555;margin:0 0 12px"><b>Not practicing:</b> ${day.offTeams.map(o => esc(o.team) + " (" + esc(o.why) + ")").join(", ")}</div>` : ""}
<h3 style="font-size:15px;margin:18px 0 6px">Hour by hour</h3>
<table style="border-collapse:collapse;width:100%">${rows}</table>
<h3 style="font-size:15px;margin:18px 0 6px">Who's working</h3>
<table style="border-collapse:collapse">${coachRows}</table>`}
<p style="margin:18px 0"><a href="${link}" style="background:#e91e8c;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;font-weight:700;font-size:14px">Open in DS Elite HQ</a></p>
<p style="color:#999;font-size:11px">Built from the practice grid, coach coverage, time-off requests and tournaments at send time. Changes after this go live in the app, not here.</p></div>`;
  const text = [
    prettyDate(day.date) + " — " + day.phaseLabel,
    day.cancelled ? "CANCELLED: " + day.cancelled : "",
    crit.length ? "NEEDS FIXING:\n" + crit.map(i => "- " + i.text).join("\n") : "Every team has two coaches.",
    warn.length ? "WORTH CHECKING:\n" + warn.map(i => "- " + i.text).join("\n") : "",
    info.length ? "SUBS & CHANGES:\n" + info.map(i => "- " + i.text).join("\n") : "",
    day.hours.map(h => h.label + "\n" + h.teams.filter(x => x.starts).map(x => { const t = teamBy.get(x.team); return "  " + x.team + " (" + t.blocks.map(([s, e]) => fmtSpan(s, e)).join(", ") + "): " + (t.floor.map(p => p.name + (p.role === "Sub" ? " (sub)" : "")).join(", ") || "NO COACH"); }).join("\n")).join("\n"),
    link,
  ].filter(Boolean).join("\n\n");
  return { html, text, subject };
}

// ── Updated-plan texts ─────────────────────────────────────────────────────
const SMS_DATE = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "UTC" });

// Everyone with a plan today or a plan they were told about, with what they
// know vs. what's true now. Records a baseline the first time a date is seen.
async function planState(sb, day) {
  const now = new Map(plansFor(day).map(p => [p.key, p]));
  const [{ data: rows, error }, { data: roster }, { data: outs }] = await Promise.all([
    sb.from("day_plan_texts").select("person_key, coach_name, plan_text, kind, created_at").eq("plan_date", day.date).order("created_at", { ascending: true }),
    sb.from("coach_roster").select("first_name, last_name, phone"),
    sb.from("sms_optouts").select("phone").eq("brand", "dse"),
  ]);
  if (error) throw new Error(error.message);
  const known = new Map();   // latest row per person
  for (const r of rows || []) known.set(r.person_key, r);
  if (!(rows || []).length && now.size && (day.teams.length || day.cancelled)) {
    const base = [...now.values()].map(p => ({ plan_date: day.date, person_key: p.key, coach_name: p.name, plan_text: p.body, kind: "baseline" }));
    const ins = await sb.from("day_plan_texts").insert(base);
    if (ins.error) throw new Error(ins.error.message);
    for (const b of base) known.set(b.person_key, { ...b, created_at: new Date().toISOString() });
  }
  const optout = new Set((outs || []).map(o => normalizePhone(o.phone)));
  const phoneFor = (name) => { const r = (roster || []).find(r => samePerson(((r.first_name || "") + " " + (r.last_name || "")).trim(), name)); return r ? normalizePhone(r.phone) : null; };
  const keys = new Set([...now.keys(), ...[...known.values()].filter(k => k.plan_text).map(k => k.person_key)]);
  return [...keys].map(k => {
    const cur = now.get(k), was = known.get(k);
    const name = cur?.name || was?.coach_name || k;
    const body = cur?.body || "";
    const phone = phoneFor(name);
    return { key: k, name, body, known: was ? was.plan_text : null, changed: (was ? was.plan_text : "") !== body, lastKind: was?.kind || null, lastAt: was?.created_at || null,
      phone: phone && /^\+\d{10,15}$/.test(phone) ? phone : null, optedOut: !!(phone && optout.has(phone)) };
  }).sort((a, b) => (b.changed - a.changed) || a.name.localeCompare(b.name));
}

const planSms = (date, p) => {
  const now = p.body ? p.body.split("\n") : [];
  const gone = (p.known || "").split("\n").filter(l => l && !now.includes(l));
  return [`DS Elite — UPDATED plan for ${SMS_DATE(date)}:`,
    now.length ? now.join("\n") : "You're not scheduled to coach that day.",
    gone.length ? "No longer:\n" + gone.join("\n") : "",
    "Questions? Reply here. — Drew"].filter(Boolean).join("\n\n");
};

async function sendPlans(sb, req, res, who) {
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const date = String(body.date || "");
  const keys = new Set(Array.isArray(body.keys) ? body.keys.map(String) : []);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !keys.size) return res.status(400).json({ error: "date and keys required" });
  if (!twilioReady()) return res.status(500).json({ error: "Texting isn't configured" });
  const day = await daySchedule(sb, date);
  const plans = (await planState(sb, day)).filter(p => keys.has(p.key));
  const results = [];
  for (const p of plans) {
    if (!p.phone) { results.push({ name: p.name, ok: false, error: "no phone on the coach roster" }); continue; }
    if (p.optedOut) { results.push({ name: p.name, ok: false, error: "opted out of texts (STOP)" }); continue; }
    const text = planSms(date, p);
    try {
      await sendOneSms(sb, { to: p.phone, name: p.name, kind: "coach" }, text, { sent_by_label: "day plan update" });
      await sb.from("day_plan_texts").insert({ plan_date: date, person_key: p.key, coach_name: p.name, phone: p.phone, plan_text: p.body, kind: "sent", sent_by: who });
      results.push({ name: p.name, ok: true });
    } catch (e) { results.push({ name: p.name, ok: false, error: e.message }); }
  }
  return res.status(200).json({ ok: true, sent: results.filter(r => r.ok).length, results });
}
