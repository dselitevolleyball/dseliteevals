// DS Elite Time Cards → "Expected but didn't clock in" → 📱 Text to confirm.
//
//   POST (admin session) { coaches: [{ coach, shifts: [{ date, team, slot }] }], dry? }
//        texts each coach "Did you work it? Reply YES or NO, or tap to answer"
//        -> { results: [{ coach, ok, phone, error?, text? }] }
//   GET  ?t=<token>   the page the text links to: each shift with
//        "I worked it" / "I didn't" (no sign-in - the token is the key)
//   POST ?t=<token>   (form) the answers from that page
//
// Text replies (YES / NO) are read by api/sms-webhook.js. Both paths go
// through applyAnswers in ./_lib/shift-confirm.js.

import { createClient } from "@supabase/supabase-js";
import { sendOneSms } from "./_lib/sms.js";
import { appOrigin } from "../shared/app-origin.js";
import { OWNER_EMAILS } from "./_lib/projects.js";
import { askText, applyAnswers, linkFor, newToken, phoneForCoach, slotHours, thanksText, teamLabel, dayLabel } from "./_lib/shift-confirm.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

function page(title, inner) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
body{margin:0;background:#0a0a0a;color:#eee;font:16px/1.45 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
.w{max-width:480px;margin:0 auto;padding:22px 16px 40px}
h1{font-size:20px;margin:6px 0 4px;color:#e91e8c}
p{color:#aaa;margin:0 0 16px}
.s{border:1px solid #333;border-radius:12px;padding:14px;margin-bottom:12px;background:#151515}
.s b{display:block;font-size:17px;color:#fff}
.s span{color:#aaa;font-size:14px}
.opts{display:flex;gap:8px;margin-top:12px}
.opts label{flex:1;display:block;cursor:pointer}
.opts input{position:absolute;opacity:0}
.opts div{text-align:center;padding:12px 6px;border:1px solid #444;border-radius:10px;font-weight:700}
.opts input:checked+div.y{background:#16a34a;border-color:#16a34a;color:#fff}
.opts input:checked+div.n{background:#f59e0b;border-color:#f59e0b;color:#000}
.done{margin-top:8px;font-weight:700}
button{width:100%;padding:14px;border:0;border-radius:10px;background:#e91e8c;color:#000;font-weight:800;font-size:16px;margin-top:6px}
.ok{color:#22c55e}.no{color:#f59e0b}
</style></head><body><div class="w"><div style="font-weight:800;letter-spacing:.06em;font-size:12px;color:#888">DS ELITE VOLLEYBALL · TIME CARDS</div>${inner}</div></body></html>`;
}

async function adminFrom(sb, req) {
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return null;
  if (bearer === process.env.SUPABASE_SERVICE_ROLE_KEY) return "admin";
  const { data: { user } = {} } = await sb.auth.getUser(bearer).catch(() => ({ data: {} }));
  const email = (user?.email || "").trim().toLowerCase();
  if (!email) return null;
  if (OWNER_EMAILS.includes(email)) return email;
  const { data: c } = await sb.from("coaches").select("is_admin, is_approved, display_name").ilike("email", email).maybeSingle();
  return c && c.is_approved && c.is_admin ? (c.display_name || email) : null;
}

const formBody = (req) => {
  if (!req.body) return {};
  if (typeof req.body === "string") return Object.fromEntries(new URLSearchParams(req.body));
  return req.body;
};

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const q = (() => { try { return new URL(req.url, "https://x").searchParams; } catch { return new URLSearchParams(); } })();
  const token = q.get("t");

  // ── the coach's page ──────────────────────────────────────────────────────
  if (token) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    const { data: row } = await sb.from("shift_confirms").select("*").eq("token", token).maybeSingle();
    if (!row) return res.status(404).send(page("Not found", `<h1>That link has expired</h1><p>Text Coach Kristen or Drew if your hours need fixing.</p>`));
    let note = "";
    if (req.method === "POST") {
      const f = formBody(req);
      const answers = Object.fromEntries(Object.entries(f).filter(([k, v]) => /^a\d+$/.test(k) && ["yes", "no"].includes(v)).map(([k, v]) => [k.slice(1), v]));
      if (Object.keys(answers).length) {
        try { const r = await applyAnswers(sb, row, answers, { via: "link" }); Object.assign(row, r.row); const t = thanksText(r); note = t ? `<p class="ok">Thanks - ${esc(t)}.</p>` : ""; }
        catch (e) { note = `<p class="no">${esc(e.message)}</p>`; }
      } else note = `<p class="no">Pick "I worked it" or "I didn't" for a practice first.</p>`;
    }
    const first = String(row.coach_name || "").split(/\s+/)[0];
    const open = (row.shifts || []).some(s => !s.answer);
    const items = (row.shifts || []).map((s, i) => `<div class="s"><b>${esc(teamLabel(s.team))} practice</b><span>${esc(dayLabel(s.date))}${s.slot ? " · " + esc(s.slot) + " · " + (slotHours(s.slot) || 2) + "h" : ""}</span>
${s.answer ? `<div class="done ${s.answer === "yes" ? "ok" : "no"}">${s.answer === "yes" ? "✓ Logged - you worked it" : "Noted - you didn't work it"}</div>`
  : `<div class="opts"><label><input type="radio" name="a${i}" value="yes"><div class="y">I worked it</div></label><label><input type="radio" name="a${i}" value="no"><div class="n">I didn't</div></label></div>`}</div>`).join("");
    return res.status(200).send(page("Confirm your practices", `<h1>Hi ${esc(first)}</h1>
<p>${open ? "You were on the schedule for these but didn't clock in. Did you work them?" : "All answered - thank you. If something's wrong, text Coach Kristen or Drew."}</p>${note}
<form method="post" action="?t=${esc(token)}">${items}${open ? `<button type="submit">Send</button>` : ""}</form>`));
  }

  // ── admin: send the texts ─────────────────────────────────────────────────
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const by = await adminFrom(sb, req);
  if (!by) return res.status(403).json({ error: "Admins only" });
  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const list = (Array.isArray(b.coaches) ? b.coaches : []).slice(0, 60);
  if (!list.length) return res.status(400).json({ error: "coaches is required" });
  const origin = appOrigin(req);
  const results = [];
  for (const c of list) {
    const coach = String(c.coach || "").trim();
    const shifts = (Array.isArray(c.shifts) ? c.shifts : []).filter(s => isDate(s.date) && s.team).slice(0, 10).map(s => ({ date: s.date, team: String(s.team), slot: s.slot ? String(s.slot) : null, answer: null }));
    if (!coach || !shifts.length) { results.push({ coach, ok: false, error: "No shifts" }); continue; }
    const who = await phoneForCoach(sb, coach);
    if (!who?.phone) { results.push({ coach, ok: false, error: "No phone on the coach roster" }); continue; }
    const token = newToken();
    const text = askText(shifts, linkFor(origin, token));
    if (b.dry) { results.push({ coach, ok: true, phone: who.phone, text, dry: true }); continue; }
    const { data: row, error } = await sb.from("shift_confirms").insert({ token, coach_name: coach, phone: who.phone, shifts, sent_by: by }).select("*").single();
    if (error) { results.push({ coach, ok: false, error: error.message }); continue; }
    try {
      await sendOneSms(sb, { to: who.phone, brand: "dse", name: who.name || coach, kind: "coach" }, text, { sent_by_label: `Time Cards (${by})` });
      results.push({ coach, ok: true, phone: who.phone, id: row.id });
    } catch (e) {
      await sb.from("shift_confirms").update({ status: "failed", error: e.message }).eq("id", row.id);
      results.push({ coach, ok: false, phone: who.phone, error: e.message });
    }
  }
  return res.status(200).json({ ok: true, results });
}
