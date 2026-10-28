// /api/site-report — the website's monthly report and recommendations (Drew, Oct 18 2026).
//
// On the 1st of each month (Vercel cron) it gathers last month's numbers from site_stats() (visitors,
// pages, where people came from, what they clicked, how far they scrolled, email sign-ups, feedback
// pop-up ratings and comments), compares them with the month before, asks Claude for a short list of
// specific updates to make to dselitevolleyball.com, saves it in site_reports (HQ → Website → Visitors)
// and emails it to Drew.
//
//   GET  (cron)                      → report for last calendar month (Central time)
//   POST { month: 'YYYY-MM' }        → admin "Generate now" (the current month = month to date); no email
//                                      unless { email: true }
// Auth: Vercel Cron (Bearer CRON_SECRET), the service-role key, or a signed-in HQ admin.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, ANTHROPIC_API_KEY, RESEND_API_KEY, DSE_FROM_EMAIL.

import { createClient } from "@supabase/supabase-js";
import { claudeClient } from "./_lib/ai-client.js";

export const config = { maxDuration: 300 };
const MODELS = ["claude-opus-5-5", "claude-opus-5"];
const TO = "drew@dselitevolleyball.com";
const TZ = "America/Chicago";

// Midnight Central at the start of a month, as a UTC instant.
function monthStart(y, m) {
  const guess = new Date(Date.UTC(y, m - 1, 1, 6));   // 06:00Z ≈ midnight CST/CDT
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(guess));
  return new Date(guess.getTime() - h * 3600e3);
}
const ym = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).format(d).slice(0, 7);
const shift = (month, n) => { const [y, m] = month.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const range = (month) => { const [y, m] = month.split("-").map(Number); const [y2, m2] = shift(month, 1).split("-").map(Number); return [monthStart(y, m), monthStart(y2, m2)]; };
const label = (month) => new Date(month + "-15T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

const SITE_MAP = `dselitevolleyball.com pages (rev 2, Oct 2026: one page per topic, never repeat information across pages):
/ home: short intro, two paths (new families / current families), why we started, join band
/about Who We Are: story, founder, leadership, philosophy and values
/tryouts Tryouts & Pricing: how teams form, last season's timeline, what coaches look for, fees (Rise $2,500, Regional $4,200, National $5,400), what's included, policies
/training Training & Facilities: DSSC programs on Playbook (PODs, clinics, camps, privates, Reach Performance), the Warehouse and Flex
/teams and /teams/<team>: rosters, coaches, practice times, tournaments
/coaches and /coaches/<coach>: coach bios
/parents Parent Hub: live Tournament Hub, tournament schedule, calendar subscribe, SportsYou, chain of command, travel
/text-updates Contact & Text Updates: SMS opt-in (wording is frozen for the carrier campaign) and contact form
/faq: questions no other page answers
Site-wide: a "Get club news by email" sign-up band above the footer, and a feedback pop-up (stars + comments) after 25 seconds.`;

async function authorized(req, sb) {
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return false;
  if (bearer === process.env.CRON_SECRET || bearer === process.env.SUPABASE_SERVICE_ROLE_KEY) return true;
  const { data: { user } = {} } = await sb.auth.getUser(bearer).catch(() => ({ data: {} }));
  if (!user?.email) return false;
  const { data: c } = await sb.from("coaches").select("is_admin, is_approved").ilike("email", user.email).maybeSingle();
  return !!(c?.is_admin && c?.is_approved);
}

async function recommend(stats, prev, month, partial) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const client = claudeClient("website-report", { apiKey: key });
  const prompt = `You advise Drew Rose, founder of DS Elite Volleyball (a girls club volleyball program in Dripping Springs, Texas), on his website.

${SITE_MAP}

Drew's goals for the site: (1) collect more email addresses from families learning about the club, (2) make navigation easy, (3) keep every page short with no repeated information, (4) get families to tryouts.

Here is ${partial ? "the month so far for " : ""}${label(month)} (JSON from the site's own cookie-free analytics, the email sign-up list and the feedback pop-up):
${JSON.stringify(stats)}

The month before, for comparison:
${JSON.stringify(prev || {})}

Write the monthly website report for Drew. Plain text, no markdown tables, under 450 words:
- One line: the headline number change (visitors, email sign-ups, average feedback rating).
- "What's working" (2-3 bullets, each tied to a number).
- "Recommended updates" (4-7 numbered items, most impactful first). Each item names the page, says exactly what to change, and cites the data that justifies it. At least one item must be about getting more email sign-ups. Quote any feedback comments that matter.
- If there is too little data to judge something, say so plainly instead of guessing, and suggest how to get the data (for example tagged links like ?utm_source=instagram on social posts).
Be specific and practical. Do not invent numbers. Use "Drew" not "you" sparingly; write to him directly.`;
  for (const model of MODELS) {
    try {
      const r = await client.messages.create({ model, max_tokens: 1500, messages: [{ role: "user", content: prompt }] });
      return r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
    } catch (e) { console.error("site-report model", model, e.message); }
  }
  return null;
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function emailReport(month, stats, recs, partial) {
  const key = process.env.RESEND_API_KEY || process.env.resend_api_key, from = process.env.DSE_FROM_EMAIL;
  if (!key || !from) throw new Error("email not configured");
  const n = (x) => (x == null ? "–" : Number(x).toLocaleString("en-US"));
  const rows = [["Visitors", stats.visitors], ["Page views", stats.views], ["Pages per visit", stats.pages_per_session], ["New email sign-ups", stats.signups], ["Email list size", stats.list_size], ["Feedback ratings", stats.feedback?.count], ["Average rating", stats.feedback?.avg]];
  const top = (stats.top_pages || []).slice(0, 6).map((p) => `<tr><td style="padding:2px 12px 2px 0">${esc(p.path)}</td><td>${n(p.views)}</td></tr>`).join("");
  const html = `<div style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#191919;max-width:640px">
<h2 style="margin:0 0 10px;color:#c2186f">Website report: ${esc(label(month))}${partial ? " (so far)" : ""}</h2>
<table style="border-collapse:collapse;font-size:14px;margin-bottom:12px">${rows.map(([k, v]) => `<tr><td style="padding:2px 14px 2px 0;color:#666">${k}</td><td style="font-weight:700">${n(v)}</td></tr>`).join("")}</table>
${top ? `<p style="margin:12px 0 4px;color:#666">Most viewed pages</p><table style="border-collapse:collapse;font-size:13px">${top}</table>` : ""}
<div style="margin-top:16px;padding:14px;background:#f6f4f7;border-radius:10px;white-space:pre-wrap">${esc(recs || "Not enough data yet for recommendations.")}</div>
<p style="color:#888;font-size:12px;margin-top:14px">Every month's report is in HQ → Website → Visitors. The email list is in HQ → Website → Email list.</p></div>`;
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [TO], subject: `Website report: ${label(month)}${partial ? " (so far)" : ""}`, html, text: recs || "" }) });
  if (!r.ok) throw new Error("Resend " + r.status);
}

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  if (!(await authorized(req, sb))) return res.status(403).json({ error: "Forbidden" });
  let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const now = new Date(), thisMonth = ym(now);
  const month = req.method === "POST" && /^\d{4}-\d{2}$/.test(body?.month || "") ? body.month : shift(thisMonth, -1);
  const partial = month === thisMonth;
  const [from, to] = range(month), [pf, pt] = range(shift(month, -1));
  const [{ data: stats, error }, { data: prev }] = await Promise.all([
    sb.rpc("site_stats", { p_from: from.toISOString(), p_to: (partial ? now : to).toISOString() }),
    sb.rpc("site_stats", { p_from: pf.toISOString(), p_to: pt.toISOString() }),
  ]);
  if (error) return res.status(500).json({ error: error.message });
  const recs = await recommend(stats, prev, month, partial);
  const { error: e2 } = await sb.from("site_reports").upsert({ month, stats, recommendations: recs, created_at: new Date().toISOString() }, { onConflict: "month" });
  if (e2) return res.status(500).json({ error: e2.message });
  const sendMail = req.method !== "POST" || body?.email === true;
  if (sendMail) {
    try { await emailReport(month, stats, recs, partial); await sb.from("site_reports").update({ emailed_at: new Date().toISOString() }).eq("month", month); }
    catch (e) { console.error("site-report email", e.message); }
  }
  return res.status(200).json({ ok: true, month, partial, emailed: sendMail, stats, recommendations: recs });
}
