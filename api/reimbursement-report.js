// Vercel Cron: Monday-morning reimbursement report.
//
// Goes out alongside the payroll report, to the same accountants, because both
// answer the same question: who does the club owe money to this week. Payroll
// covers hours; this covers what coaches paid for out of pocket and claimed
// back with a receipt.
//
// Everything APPROVED and not yet marked reimbursed is listed, split into what
// was approved in the last seven days and what is still carried over from
// before. Carried-over items keep appearing until somebody marks them paid —
// an approved claim that quietly drops off a report is how a coach ends up
// chasing Drew in March for a $40 parking receipt from December.
//
// Each row carries a signed link to its receipt, good for 7 days, so the
// accountant can open the evidence without a login. The bucket stays private.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; also ?token=.
// An admin can re-send from the app with their Supabase access token.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
//      RESEND_API_KEY (or resend_api_key), DSE_FROM_EMAIL, DSE_REPLY_TO (opt),
//      REIMBURSEMENT_REPORT_TO (opt comma list).

import { createClient } from "@supabase/supabase-js";

const DEFAULT_TO = ["bpounds@generalledgerpartners.com", "rparker@generalledgerpartners.com", "drew@dselitevolleyball.com"];
const OWNER_EMAILS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];
const SIGNED_FOR = 7 * 24 * 3600;   // a week — long enough to be actioned

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtD = (iso) => { try { return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); } catch { return iso || "—"; } };
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, DSE_FROM_EMAIL, DSE_REPLY_TO, REIMBURSEMENT_REPORT_TO } = process.env;
  const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.resend_api_key;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });
  if (!RESEND_API_KEY || !DSE_FROM_EMAIL) return res.status(500).json({ error: "Email not configured" });

  const url = (() => { try { return new URL(req.url, "https://x"); } catch { return null; } })();
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  let authed = !!CRON_SECRET && (bearer === CRON_SECRET || url?.searchParams.get("token") === CRON_SECRET);
  let sentBy = null;
  if (!authed && bearer) {
    const { data: { user } = {} } = await supabase.auth.getUser(bearer).catch(() => ({ data: {} }));
    const email = (user?.email || "").trim().toLowerCase();
    if (email) {
      if (OWNER_EMAILS.includes(email)) { authed = true; sentBy = email; }
      else {
        const { data: c } = await supabase.from("coaches").select("is_admin, is_approved, display_name").ilike("email", email).maybeSingle();
        if (c?.is_approved && c.is_admin) { authed = true; sentBy = c.display_name || email; }
      }
    }
  }
  if (!authed) return res.status(403).json({ error: "Forbidden" });

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const since = addDays(today, -7);

  // Approved and still owed. reimbursed is the "we've actually paid them" flag.
  const { data: claims, error } = await supabase.from("expenses")
    .select("id, submitted_by, reimburse_to, item, category, amount, expense_date, tournament_id, receipt_path, receipt_name, approved_at, approved_by, notes")
    // reimbursed is nullable with no default, and NULL <> true is NULL, not
    // true — so .neq("reimbursed", true) silently drops every unpaid claim and
    // the report finds nothing, forever. Match NULL and false explicitly.
    .eq("status", "approved").not("submitted_by", "is", null)
    .or("reimbursed.is.null,reimbursed.eq.false")
    .order("expense_date", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  if (!claims?.length) {
    return res.status(200).json({ ok: true, claims: 0, note: "nothing owed — no email sent" });
  }

  const { data: tns } = await supabase.from("tournaments").select("id, name");
  const tnById = new Map((tns || []).map(t => [t.id, t.name]));

  // One signed URL per receipt. Sequential and best-effort: a missing file must
  // not take the whole report down, it just shows as unavailable.
  for (const c of claims) {
    if (!c.receipt_path) continue;
    const { data } = await supabase.storage.from("receipts").createSignedUrl(c.receipt_path, SIGNED_FOR).catch(() => ({ data: null }));
    c.signed = data?.signedUrl || null;
  }

  const byCoach = new Map();
  for (const c of claims) {
    const who = c.reimburse_to || c.submitted_by || "Unknown";
    if (!byCoach.has(who)) byCoach.set(who, { who, total: 0, rows: [] });
    const g = byCoach.get(who);
    g.total += Number(c.amount || 0);
    g.rows.push(c);
  }
  const groups = [...byCoach.values()].sort((a, b) => b.total - a.total);
  const grand = groups.reduce((s, g) => s + g.total, 0);
  const isNew = (c) => c.approved_at && String(c.approved_at).slice(0, 10) >= since;
  const newCount = claims.filter(isNew).length;
  const carried = claims.length - newCount;
  const noReceipt = claims.filter(c => !c.receipt_path).length;

  const td  = 'style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px"';
  const tdR = 'style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;text-align:right;white-space:nowrap"';
  const body = groups.map(g => `
    <tr><td colspan="4" style="padding:12px 10px 4px;font-size:14px;font-weight:700;border-bottom:2px solid #ddd">
      ${esc(g.who)} — ${money(g.total)}</td></tr>
    ${g.rows.map(c => `<tr>
      <td ${td}>${fmtD(c.expense_date)}${isNew(c) ? ' <span style="background:#e91e8c;color:#fff;font-size:10px;font-weight:700;border-radius:4px;padding:1px 5px">NEW</span>' : ""}</td>
      <td ${td}>${esc(c.item || "—")}<div style="color:#777;font-size:11px">${esc([c.category, tnById.get(c.tournament_id)].filter(Boolean).join(" · "))}</div></td>
      <td ${td}>${c.signed ? `<a href="${c.signed}">receipt</a>` : '<span style="color:#b91c1c">no receipt</span>'}</td>
      <td ${tdR}>${money(c.amount)}</td></tr>`).join("")}`).join("");

  const html = `<div style="font-family:sans-serif;font-size:14px;line-height:1.5">
    <h2 style="margin:0 0 6px">Coach reimbursements owed — ${fmtD(today)}</h2>
    <p style="margin:0 0 14px;color:#555">
      <b>${money(grand)}</b> across <b>${groups.length}</b> coach${groups.length === 1 ? "" : "es"} and ${claims.length} claim${claims.length === 1 ? "" : "s"}.
      ${newCount} approved in the last 7 days${carried ? `, ${carried} carried over from before` : ""}.
      ${sentBy ? "Sent by " + esc(sentBy) + "." : ""}
    </p>
    ${noReceipt ? `<p style="margin:0 0 14px;padding:8px 10px;background:#fef2f2;border-left:3px solid #b91c1c;color:#7f1d1d">
      <b>${noReceipt} claim${noReceipt === 1 ? " has" : "s have"} no receipt attached.</b> They are listed below but should not be paid without one.</p>` : ""}
    <table style="border-collapse:collapse;min-width:520px">
      <thead><tr>
        <th style="text-align:left;padding:6px 10px;border-bottom:2px solid #ccc;font-size:12px">Date</th>
        <th style="text-align:left;padding:6px 10px;border-bottom:2px solid #ccc;font-size:12px">What</th>
        <th style="text-align:left;padding:6px 10px;border-bottom:2px solid #ccc;font-size:12px">Receipt</th>
        <th style="text-align:right;padding:6px 10px;border-bottom:2px solid #ccc;font-size:12px">Amount</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td ${td} colspan="3"><b>Total owed</b></td><td ${tdR}><b>${money(grand)}</b></td>
      </tr></tfoot>
    </table>
    <p style="color:#777;font-size:12px;margin-top:14px">
      Receipt links work for 7 days. Anything already paid should be marked reimbursed in DS Elite HQ,
      otherwise it appears again next week.</p></div>`;

  const text = `Coach reimbursements owed — ${fmtD(today)}\n\n${money(grand)} across ${groups.length} coach(es), ${claims.length} claim(s).\n`
    + `${newCount} newly approved, ${carried} carried over.\n\n`
    + groups.map(g => `${g.who} — ${money(g.total)}\n` + g.rows.map(c =>
        `   ${fmtD(c.expense_date)}  ${c.item || "—"}  ${money(c.amount)}${c.receipt_path ? "" : "  [NO RECEIPT]"}`).join("\n")).join("\n\n")
    + `\n\nTOTAL: ${money(grand)}`;

  const csvEsc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = [["Date", "Coach", "What", "Category", "Tournament", "Amount", "Receipt", "Approved by"].join(",")]
    .concat(claims.map(c => [c.expense_date || "", csvEsc(c.reimburse_to || c.submitted_by), csvEsc(c.item),
      csvEsc(c.category), csvEsc(tnById.get(c.tournament_id) || ""), Number(c.amount || 0).toFixed(2),
      c.receipt_path ? "yes" : "NO", csvEsc(c.approved_by || "")].join(",")))
    .concat([["", "TOTAL", "", "", "", grand.toFixed(2), "", ""].join(",")]).join("\n");

  const to = (REIMBURSEMENT_REPORT_TO ? REIMBURSEMENT_REPORT_TO.split(",").map(s => s.trim()).filter(Boolean) : DEFAULT_TO);
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: DSE_FROM_EMAIL, to, reply_to: (DSE_REPLY_TO || DSE_FROM_EMAIL).trim(),
      subject: `Coach reimbursements owed — ${money(grand)} across ${groups.length} coach${groups.length === 1 ? "" : "es"}`,
      html, text,
      attachments: [{ filename: `coach_reimbursements_${today}.csv`, content: Buffer.from(csv, "utf8").toString("base64") }],
    }),
  });
  if (!resp.ok) return res.status(502).json({ error: "Email send failed", detail: (await resp.text().catch(() => "")).slice(0, 300) });

  return res.status(200).json({ ok: true, coaches: groups.length, claims: claims.length, total: grand, newCount, carried, noReceipt, to });
}
