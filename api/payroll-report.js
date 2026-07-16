// Vercel Cron: Monday-morning payroll report.
//
// Every Monday (12:00 UTC ≈ 7am Central) this emails the previous week's
// (Mon–Sun) coach hours and pay — computed from coach_checkins × coach_rates —
// to the bookkeeper and club admins. Rate resolution matches the app's Time
// Cards ledger: head_rate applies to shifts for a team the coach head-coaches,
// hourly_rate covers everything else (assisting, subbing, floating).
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; also accepts ?token=.
// Admins can also re-send any week from the app: `Authorization: Bearer <supabase
// access token>` — verified server-side and checked for owner/is_admin.
// Optional query: ?week=YYYY-MM-DD (any date inside the week to report on).
//
// The email includes an hours CSV attachment (one row per shift).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
//      RESEND_API_KEY (or resend_api_key), DSE_FROM_EMAIL, DSE_REPLY_TO (opt),
//      PAYROLL_REPORT_TO (opt comma list — overrides the default recipients).

import { createClient } from "@supabase/supabase-js";

const DEFAULT_TO = ["bpounds@generalledgerpartners.com", "drew@dselitevolleyball.com", "kristen@dselitevolleyball.com"];
const OWNER_EMAILS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];
const escapeHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const norm = (s) => String(s || "").trim().toLowerCase();
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtD = (iso) => { try { return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }); } catch { return iso; } };
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, DSE_FROM_EMAIL, DSE_REPLY_TO, PAYROLL_REPORT_TO } = process.env;
  const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.resend_api_key;

  const url = (() => { try { return new URL(req.url, "https://x"); } catch { return null; } })();
  const urlToken = url?.searchParams.get("token") || "";
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  if (!RESEND_API_KEY || !DSE_FROM_EMAIL) return res.status(500).json({ error: "Email not configured" });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // Allowed either by the cron secret, or by an admin's Supabase session token
  // (so Time Cards can re-send any week on demand).
  let authed = !!CRON_SECRET && (bearer === CRON_SECRET || urlToken === CRON_SECRET);
  if (!authed && bearer) {
    const { data: { user } = {} } = await supabase.auth.getUser(bearer).catch(() => ({ data: {} }));
    const email = (user?.email || "").trim().toLowerCase();
    if (email) {
      if (OWNER_EMAILS.includes(email)) authed = true;
      else {
        const { data: c } = await supabase.from("coaches").select("is_admin, is_approved").ilike("email", email).maybeSingle();
        authed = !!(c && c.is_approved && c.is_admin);
      }
    }
  }
  if (!authed) return res.status(403).json({ error: "Forbidden" });

  // Report window: the Mon–Sun week BEFORE the current week (Central time).
  // ?week=YYYY-MM-DD reports the week containing that date instead.
  const chicagoToday = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const anchor = url?.searchParams.get("week") || null;
  const mondayOf = (iso) => { const d = new Date(iso + "T12:00:00Z"); return addDays(iso, -((d.getUTCDay() + 6) % 7)); };
  const weekStart = anchor ? mondayOf(anchor) : addDays(mondayOf(chicagoToday), -7);
  const weekEnd = addDays(weekStart, 6);

  const [{ data: checks }, { data: rates }, { data: teams }, { data: roster }] = await Promise.all([
    supabase.from("coach_checkins").select("*").gte("check_date", weekStart).lte("check_date", weekEnd),
    supabase.from("coach_rates").select("*"),
    supabase.from("practice_teams").select("team_name, head_coach, assistant_coach"),
    supabase.from("coach_roster").select("first_name, last_name, email"),
  ]);

  // Resolve a check-in's free-text coach_name to a canonical First-Last, so
  // hours group under the real name (coaches log in with varied display names).
  const rosterByEmail = new Map();
  (roster || []).forEach(r => { if (r.email) rosterByEmail.set(norm(r.email), `${r.first_name || ""} ${r.last_name || ""}`.trim()); });
  const canonNames = new Map();
  (roster || []).forEach(r => { const full = `${r.first_name || ""} ${r.last_name || ""}`.trim(); if (full) canonNames.set(norm(full), full); });
  (teams || []).forEach(t => [t.head_coach, t.assistant_coach].forEach(n => { if (n && n.trim()) canonNames.set(norm(n), n.trim()); }));
  (rates || []).forEach(r => { if (r.coach_name) canonNames.set(norm(r.coach_name), r.coach_name.trim()); });
  const canonicalName = (raw, email) => {
    if (email) { const e = rosterByEmail.get(norm(email)); if (e) return e; }
    const base = String(raw || "").replace(/^\s*coach\s+/i, "").trim();
    const n = norm(base);
    if (canonNames.has(n)) return canonNames.get(n);
    const toks = n.split(/\s+/).filter(Boolean);
    if (toks.length) {
      const first = toks[0], last = toks[toks.length - 1];
      for (const [k, v] of canonNames) { const kt = k.split(/\s+/), kf = kt[0], kl = kt[kt.length - 1];
        if (kl === last && (kf === first || kf.startsWith(first) || first.startsWith(kf))) return v; }
      const firstOnly = [...canonNames.values()].filter(v => norm(v).split(/\s+/)[0] === first);
      if (firstOnly.length === 1) return firstOnly[0];
    }
    return base || raw;
  };

  const rateRow = (nm) => (rates || []).find(r => norm(r.coach_name) === norm(nm));
  const isHeadOf = (nm, team) => !!team && (teams || []).some(t => t.team_name === team && norm(t.head_coach) === norm(nm));
  const rateFor = (nm, team) => {
    const r = rateRow(nm);
    if (!r) return null;
    if (r.head_rate != null && isHeadOf(nm, team)) return Number(r.head_rate);
    return r.hourly_rate != null ? Number(r.hourly_rate) : null;
  };

  // Group by canonical coach.
  const byCoach = new Map();
  for (const c of (checks || [])) {
    const coach = canonicalName(c.coach_name, c.coach_email);
    const g = byCoach.get(coach) || { coach, hours: 0, amount: 0, unpaidAmount: 0, missingRate: false, lateCount: 0, shifts: [] };
    const hrs = Number(c.hours || 0);
    const rate = rateFor(coach, c.team_name);
    const amt = rate != null ? hrs * rate : null;
    const late = c.source === "app-late";
    g.hours += hrs;
    if (amt != null) { g.amount += amt; if (!c.paid) g.unpaidAmount += amt; }
    else g.missingRate = true;
    if (late) g.lateCount += 1;
    g.shifts.push({ date: c.check_date, team: c.team_name || "Floating", slot: c.slot || "", role: c.role, hours: hrs, rate, amount: amt, paid: !!c.paid, late });
    byCoach.set(coach, g);
  }
  const rows = [...byCoach.values()].sort((a, b) => a.coach.localeCompare(b.coach));
  const totLate = rows.reduce((s, g) => s + g.lateCount, 0);
  const totHours = rows.reduce((s, g) => s + g.hours, 0);
  const totAmount = rows.reduce((s, g) => s + g.amount, 0);
  const totUnpaid = rows.reduce((s, g) => s + g.unpaidAmount, 0);
  const anyMissing = rows.some(g => g.missingRate);

  const rangeLabel = `${fmtD(weekStart)} – ${fmtD(weekEnd)}`;
  const th = 'style="text-align:left;padding:6px 10px;border-bottom:2px solid #ccc;font-size:12px"';
  const thR = 'style="text-align:right;padding:6px 10px;border-bottom:2px solid #ccc;font-size:12px"';
  const td = 'style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px"';
  const tdR = 'style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;text-align:right"';

  const summaryRows = rows.map(g =>
    `<tr><td ${td}><b>${escapeHtml(g.coach)}</b>${g.lateCount ? ` <span style="color:#b45309;font-size:11px">⏱ ${g.lateCount} late</span>` : ""}</td><td ${tdR}>${g.hours}</td><td ${tdR}>${g.missingRate ? "⚠ rate missing" : money(g.amount)}</td><td ${tdR}>${g.missingRate ? "—" : money(g.unpaidAmount)}</td></tr>`).join("");
  const detailRows = rows.map(g => g.shifts
    .sort((a, b) => a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot))
    .map(s => `<tr${s.late ? ' style="background:#fff7ed"' : ""}><td ${td}>${escapeHtml(g.coach)}</td><td ${td}>${escapeHtml(fmtD(s.date))}</td><td ${td}>${escapeHtml(s.team)}</td><td ${td}>${escapeHtml(s.slot)}</td><td ${td}>${escapeHtml(s.role)}</td><td ${tdR}>${s.hours}</td><td ${tdR}>${s.rate != null ? "$" + s.rate : "—"}</td><td ${tdR}>${s.amount != null ? money(s.amount) : "—"}</td><td ${td}>${s.paid ? "✓ paid" : "unpaid"}${s.late ? ' · <span style="color:#b45309;font-weight:700">⏱ late</span>' : ""}</td></tr>`).join("")).join("");

  const html = rows.length === 0
    ? `<div style="font-family:sans-serif;font-size:14px"><h2 style="margin:0 0 6px">DS Elite payroll — ${rangeLabel}</h2><p>No coach hours were logged this week.</p></div>`
    : `<div style="font-family:sans-serif;font-size:14px">
        <h2 style="margin:0 0 6px">DS Elite payroll — ${rangeLabel}</h2>
        <p style="margin:0 0 12px;color:#555">${rows.length} coach${rows.length === 1 ? "" : "es"} · <b>${totHours} hours</b> · <b>${money(totAmount)}</b> total (${money(totUnpaid)} unpaid)${totLate ? ` · <span style="color:#b45309">⏱ ${totLate} late clock-in${totLate === 1 ? "" : "s"} (highlighted below — verify)</span>` : ""}${anyMissing ? ' · <span style="color:#b45309">⚠ some coaches have no rate set — set it in Operations → Time Cards</span>' : ""}</p>
        <table style="border-collapse:collapse;margin-bottom:18px"><thead><tr><th ${th}>Coach</th><th ${thR}>Hours</th><th ${thR}>Amount</th><th ${thR}>Unpaid</th></tr></thead>
        <tbody>${summaryRows}</tbody>
        <tfoot><tr><td ${td}><b>Total</b></td><td ${tdR}><b>${totHours}</b></td><td ${tdR}><b>${money(totAmount)}</b></td><td ${tdR}><b>${money(totUnpaid)}</b></td></tr></tfoot></table>
        <h3 style="margin:0 0 6px;font-size:14px">Shift detail</h3>
        <table style="border-collapse:collapse"><thead><tr><th ${th}>Coach</th><th ${th}>Date</th><th ${th}>Team</th><th ${th}>Time</th><th ${th}>Role</th><th ${thR}>Hrs</th><th ${thR}>Rate</th><th ${thR}>Amount</th><th ${th}>Status</th></tr></thead><tbody>${detailRows}</tbody></table>
        <p style="margin-top:14px;font-size:12px;color:#777">Head-coach shifts pay the HC rate; assisting, subbing, and floating pay the default rate. Full ledger: DS Elite HQ → Operations → Time Cards.</p>
      </div>`;

  const text = rows.length === 0
    ? `DS Elite payroll ${rangeLabel}: no coach hours logged.`
    : `DS Elite payroll — ${rangeLabel}\n` + rows.map(g => `${g.coach}: ${g.hours}h · ${g.missingRate ? "rate missing" : money(g.amount)} (${g.missingRate ? "—" : money(g.unpaidAmount)} unpaid)${g.lateCount ? ` [${g.lateCount} late]` : ""}`).join("\n") + `\nTOTAL: ${totHours}h · ${money(totAmount)} (${money(totUnpaid)} unpaid)${totLate ? ` · ${totLate} late clock-in(s)` : ""}`;

  // Hours CSV — one row per shift, same columns as the Time Cards export.
  const csvEsc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csvLines = [["Date", "Coach", "Role", "Team", "Slot", "Hours", "Rate", "Amount", "Paid", "Late"].join(",")];
  rows.forEach(g => g.shifts.slice().sort((a, b) => a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot)).forEach(s => {
    csvLines.push([s.date, csvEsc(g.coach), s.role, csvEsc(s.team), csvEsc(s.slot), s.hours, s.rate ?? "", s.amount != null ? s.amount.toFixed(2) : "", s.paid ? "yes" : "no", s.late ? "yes" : "no"].join(","));
  }));
  csvLines.push(["", "TOTAL", "", "", "", totHours, "", totAmount.toFixed(2), "", ""].join(","));
  const csv = csvLines.join("\n");

  const to = (PAYROLL_REPORT_TO ? PAYROLL_REPORT_TO.split(",").map(s => s.trim()).filter(Boolean) : DEFAULT_TO);
  const replyTo = (DSE_REPLY_TO || DSE_FROM_EMAIL).trim();
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: DSE_FROM_EMAIL, to, reply_to: replyTo,
      subject: `DS Elite payroll — ${rangeLabel} (${totHours}h · ${money(totAmount)})`, html, text,
      attachments: [{ filename: `dse_hours_${weekStart}.csv`, content: Buffer.from(csv, "utf8").toString("base64") }],
    }),
  });
  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    return res.status(502).json({ error: "Email send failed", detail: err.slice(0, 300) });
  }
  return res.status(200).json({ ok: true, weekStart, weekEnd, coaches: rows.length, hours: totHours, amount: totAmount, unpaid: totUnpaid, to });
}
