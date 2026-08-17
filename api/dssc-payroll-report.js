// DSSC clinic payroll, SEPARATE from DS Elite. Skill Pods pay the coach's tier
// rate — a base plus a bonus for every player past the first, pro-rated for a
// 90-minute package session; all other clinic coaching is a flat $25/hr.
// Emailed with an hours CSV. Sent by a director from the DSSC pay card
// ("Approve & email pay") or on a schedule; approval-gated by default.
//
// Auth: cron secret (Bearer/​?token=) OR an admin's Supabase session token.
// Query: ?week=YYYY-MM-DD reports the Mon–Sun week containing that date;
//        default is the week BEFORE the current one (Central).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
//      RESEND_API_KEY (or resend_api_key), DSE_FROM_EMAIL, DSE_REPLY_TO (opt),
//      DSSC_PAYROLL_TO (opt comma list).

import { createClient } from "@supabase/supabase-js";

const RATE = 25;
// Must stay identical to DSSC_TIERS / dsscPodPay in src/App.jsx. Pay is
// base + perPlayer x (players - 1): the base IS the 1-player private rate, and
// each additional player adds the bonus.
// Competitive -> Elite -> Master, lowest to highest. "Competitive" is the entry
// tier on $30 here; an earlier naming had it as the $50 middle tier.
const TIERS = {
  competitive: { label: "Competitive", base: 30, perPlayer: 15 },
  elite:       { label: "Elite",       base: 50, perPlayer: 20 },
  master:      { label: "Master",      base: 80, perPlayer: 30 },
};
const DEFAULT_TO = ["bpounds@generalledgerpartners.com", "rparker@generalledgerpartners.com", "hunterhaleysc10@gmail.com", "hunter@drippingsportsclub.com", "drew@dselitevolleyball.com"];
const OWNER_EMAILS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtD = (iso) => { try { return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }); } catch { return iso; } };
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// The approver can name recipients for a given send, so the body has to be read.
async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let raw = "";
  await new Promise((resolve) => { req.on("data", (c) => (raw += c)); req.on("end", resolve); req.on("error", resolve); });
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, DSE_FROM_EMAIL, DSE_REPLY_TO, DSSC_PAYROLL_TO } = process.env;
  const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.resend_api_key;
  const url = (() => { try { return new URL(req.url, "https://x"); } catch { return null; } })();
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  if (!RESEND_API_KEY || !DSE_FROM_EMAIL) return res.status(500).json({ error: "Email not configured" });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  let authed = !!CRON_SECRET && (bearer === CRON_SECRET || (url?.searchParams.get("token") === CRON_SECRET));
  let approvedBy = null;
  if (!authed && bearer) {
    const { data: { user } = {} } = await supabase.auth.getUser(bearer).catch(() => ({ data: {} }));
    const email = (user?.email || "").trim().toLowerCase();
    if (email) {
      if (OWNER_EMAILS.includes(email)) { authed = true; approvedBy = email; }
      else { const { data: c } = await supabase.from("coaches").select("is_admin, is_approved, display_name").ilike("email", email).maybeSingle(); if (c && c.is_approved && c.is_admin) { authed = true; approvedBy = c.display_name || email; } }
    }
  }
  if (!authed) return res.status(403).json({ error: "Forbidden" });
  const body = await readBody(req);

  const chicagoToday = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const anchor = url?.searchParams.get("week") || null;
  const mondayOf = (iso) => { const d = new Date(iso + "T12:00:00Z"); return addDays(iso, -((d.getUTCDay() + 6) % 7)); };
  const weekStart = anchor ? mondayOf(anchor) : addDays(mondayOf(chicagoToday), -7);
  const weekEnd = addDays(weekStart, 6);

  // Only APPROVED hours leave the building. Hunter reviews the week in
  // DS Elite HQ → DSSC Hours; anything he hasn't got to yet is held back and
  // reported at the top of the email rather than silently paid or silently
  // dropped — either one loses a coach's hours.
  const { data: allChecks } = await supabase.from("dssc_checkins").select("*").gte("session_date", weekStart).lte("session_date", weekEnd);
  const checks = (allChecks || []).filter(c => c.approved && !c.rejected);
  const held = (allChecks || []).filter(c => !c.approved && !c.rejected);
  const heldHours = held.reduce((s, c) => s + Number(c.hours || 0), 0);
  // Skill Pods don't pay the flat hourly rate: the coach earns a tier base plus
  // a bonus for each player past the first, pro-rated for a 90-minute package
  // session. This has to mirror dsscPodPay in the app exactly — two different
  // answers for the same shift is the one thing payroll can't have. Anything
  // that isn't a pod, or a pod with no tier or no player count, stays hourly.
  const nrm = (v) => String(v || "").trim().toLowerCase();
  const [{ data: podClinics }, { data: attendance }, { data: avail }] = await Promise.all([
    supabase.from("dssc_clinics").select("id, name, category"),
    supabase.from("dssc_pod_attendance").select("clinic_id, session_id, players"),
    supabase.from("dssc_availability").select("coach_name, tier"),
  ]);
  const isPod = new Map((podClinics || []).map(c => [c.id, /pod/i.test(String(c.category || "") + " " + String(c.name || ""))]));
  const attOf = new Map((attendance || []).map(a => [a.clinic_id + "|" + String(a.session_id), a.players]));
  const tierOf = new Map((avail || []).map(a => [nrm(a.coach_name), a.tier]));
  const amountFor = (c) => {
    const h = Number(c.hours || 0);
    if (!isPod.get(c.clinic_id)) return { amount: h * RATE, basis: `$${RATE}/hr` };
    const players = attOf.get(c.clinic_id + "|" + String(c.session_id));
    if (players == null) return { amount: h * RATE, basis: "pod — not counted" };
    const t = TIERS[tierOf.get(nrm(c.coach_name))];
    if (!t) return { amount: h * RATE, basis: "pod — no tier" };
    const n = Math.max(1, Math.floor(Number(players) || 1));
    const amount = Math.round((t.base + t.perPlayer * (n - 1)) * Math.max(0, h) * 100) / 100;
    return { amount, basis: `${t.label} pod · ${n}p`, players: n };
  };

  const byCoach = new Map();
  for (const c of (checks || [])) {
    const g = byCoach.get(c.coach_name) || { coach: c.coach_name, hours: 0, unpaid: 0, amount: 0, shifts: [] };
    const h = Number(c.hours || 0); g.hours += h; if (!c.paid) g.unpaid += h;
    const { amount, basis, players } = amountFor(c);
    g.amount += amount;
    g.shifts.push({ date: c.session_date, clinic: c.clinic_name || "", hours: h, paid: !!c.paid, amount, basis, players });
    byCoach.set(c.coach_name, g);
  }
  const rows = [...byCoach.values()].sort((a, b) => a.coach.localeCompare(b.coach));
  const totH = rows.reduce((s, g) => s + g.hours, 0);
  const totAmt = rows.reduce((s, g) => s + g.amount, 0);
  // Unpaid is still hour-weighted for non-pods; for pods take the shift amounts.
  const totUnpaid = rows.reduce((s, g) => s + g.shifts.filter(x => !x.paid).reduce((t, x) => t + x.amount, 0), 0);
  const rangeLabel = `${fmtD(weekStart)} – ${fmtD(weekEnd)}`;

  const th = 'style="text-align:left;padding:6px 10px;border-bottom:2px solid #ccc;font-size:12px"';
  const td = 'style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px"';
  const tdR = 'style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;text-align:right"';
  const summary = rows.map(g => `<tr><td ${td}><b>${esc(g.coach)}</b></td><td ${tdR}>${g.hours}</td><td ${tdR}>${money(g.amount)}</td><td ${tdR}>${money(g.shifts.filter(x=>!x.paid).reduce((t,x)=>t+x.amount,0))}</td></tr>`).join("");
  const badge = `<span style="display:inline-block;background:#16a34a;color:#fff;font-size:12px;font-weight:700;border-radius:5px;padding:2px 9px">✓ APPROVED</span>`;
  const html = rows.length === 0
    ? `<div style="font-family:sans-serif;font-size:14px"><h2>DSSC clinic pay — ${rangeLabel} ${badge}</h2><p>No <b>approved</b> clinic hours for this week.${heldHours ? ` ${heldHours}h are still waiting on Hunter's approval.` : ""}</p></div>`
    : `<div style="font-family:sans-serif;font-size:14px">
        <h2 style="margin:0 0 6px">DSSC clinic pay — ${rangeLabel} ${badge}</h2>
        <p style="margin:0 0 12px;color:#555">${badge} Approved${approvedBy ? " by " + esc(approvedBy) : ""} · Skill Pods paid by coach tier + players; other clinic coaching <b>${money(RATE)}/hr</b> · ${rows.length} coach${rows.length === 1 ? "" : "es"} · <b>${totH} hours</b> · <b>${money(totAmt)}</b> (${money(totUnpaid)} unpaid). Separate from DS Elite payroll.</p>${heldHours ? `<p style="margin:0 0 12px;padding:8px 10px;background:#fff4e5;border-left:3px solid #f59e0b;color:#7a4b00"><b>${heldHours}h held back</b> — logged but not yet approved, so not included above.</p>` : ""}
        <table style="border-collapse:collapse"><thead><tr><th ${th}>Coach</th><th ${th}>Hours</th><th ${th}>Amount</th><th ${th}>Unpaid</th></tr></thead>
        <tbody>${summary}</tbody>
        <tfoot><tr><td ${td}><b>Total</b></td><td ${tdR}><b>${totH}</b></td><td ${tdR}><b>${money(totAmt)}</b></td><td ${tdR}><b>${money(totUnpaid)}</b></td></tr></tfoot></table></div>`;
  const text = `DSSC clinic pay — ${rangeLabel} (APPROVED${approvedBy ? " by " + approvedBy : ""})\n$${RATE}/hr\n` + rows.map(g => `${g.coach}: ${g.hours}h · ${money(g.amount)}`).join("\n") + `\nTOTAL: ${totH}h · ${money(totAmt)}`
    + (heldHours ? `\n(${heldHours}h logged but not yet approved — held back)` : "");

  const csvEsc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = [["Date", "Coach", "Clinic", "Hours", "Basis", "Players", "Amount", "Paid"].join(",")]
    .concat(rows.flatMap(g => g.shifts.sort((a, b) => a.date.localeCompare(b.date)).map(s => [s.date, csvEsc(g.coach), csvEsc(s.clinic), s.hours, csvEsc(s.basis), s.players || "", s.amount.toFixed(2), s.paid ? "yes" : "no"].join(","))))
    .concat([["", "TOTAL", "", totH, "", "", totAmt.toFixed(2), ""].join(",")]).join("\n");

  // Recipients: an explicit list from the approver wins, then the env override,
  // then the default. Passing them at send time is what lets Hunter add or drop
  // the General Ledger Partners addresses for a given week without a redeploy.
  // Only a signed-in admin can name recipients — the cron path always uses the
  // configured list, so a leaked cron token can't redirect payroll anywhere.
  const asked = (() => {
    if (!approvedBy) return null;                       // cron, not a person
    const raw = body?.to;
    const list = (Array.isArray(raw) ? raw : String(raw || "").split(","))
      .map(s => String(s || "").trim().toLowerCase())
      .filter(s => /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(s));
    return list.length ? [...new Set(list)] : null;
  })();
  const to = asked || (DSSC_PAYROLL_TO ? DSSC_PAYROLL_TO.split(",").map(s => s.trim()).filter(Boolean) : DEFAULT_TO);
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: DSE_FROM_EMAIL, to, reply_to: (DSE_REPLY_TO || DSE_FROM_EMAIL).trim(), subject: `APPROVED — DSSC clinic pay ${rangeLabel} (${totH}h · ${money(totAmt)})`, html, text, attachments: [{ filename: `dssc_clinic_hours_${weekStart}.csv`, content: Buffer.from(csv, "utf8").toString("base64") }] }),
  });
  if (!resp.ok) return res.status(502).json({ error: "Email send failed", detail: (await resp.text().catch(() => "")).slice(0, 300) });
  return res.status(200).json({ ok: true, weekStart, weekEnd, coaches: rows.length, hours: totH, amount: totAmt, heldHours, to });
}
