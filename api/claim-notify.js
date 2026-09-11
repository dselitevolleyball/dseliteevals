// Coach expense claims: tell the right person at the three moments that matter.
//
//   filed     → Drew. A claim exists and is waiting on him.
//   approved  → the coach. It's on Monday's list to the accountant.
//   rejected  → the coach, with Drew's reason.
//   paid      → the coach. The money has gone.
//
// Until this existed nobody was told anything. Karissa Lee's $14 background
// check sat pending for twenty-three days because it landed in the same review
// list as 120 receipts pulled from club email, and neither side heard a word.
//
// POST /api/claim-notify  { id, event }  Authorization: Bearer <supabase token>
//
// TRUSTS THE DATABASE, NOT THE CALLER. The request only names a claim and an
// event; the endpoint reads the row and sends only if the row really is in that
// state. A coach can't produce an "approved" email for her own claim, because
// under RLS she can't make it approved. And every send is stamped on the row,
// so a double-click or retry is a no-op rather than a second email.
//
// Mail goes through /api/send-email, so it lands in sent history like every
// other message and is mirrored as an app notification to whoever receives it —
// which is how Drew gets the push for a new claim, and a coach gets hers.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_URL (opt),
//      CLAIMS_NOTIFY_TO (opt, comma list — defaults to Drew).

import { createClient } from "@supabase/supabase-js";

const DEFAULT_TO = "drew@dselitevolleyball.com";
const REPLY_TO = "drew@dselitevolleyball.com";
const EVENTS = ["filed", "approved", "rejected", "paid"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtD = (iso) => { try { return new Date(String(iso).slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); } catch { return iso || ""; } };
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "there";

const wrap = (inner) => '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:560px">' + inner + '</div>';
const p = (t) => `<p style="margin:0 0 14px">${t}</p>`;
const btn = (href, label) => `<p style="margin:4px 0 18px"><a href="${href}" style="display:inline-block;background:#e91e8c;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:700">${label} &rarr;</a></p>`;
const detailRows = (c, tn) => [
  ["Amount", money(c.amount)],
  ["For", c.item],
  ["Category", c.category],
  ["Date", fmtD(c.expense_date)],
  ...(tn ? [["Tournament", tn]] : []),
];
const table = (rows) => `<table style="border-collapse:collapse;font-size:14px;margin:0 0 16px">${rows.map(([k, v]) =>
  `<tr><td style="padding:4px 14px 4px 0;color:#777;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:4px 0;font-weight:600">${esc(v)}</td></tr>`).join("")}</table>`;
const textRows = (rows) => rows.map(([k, v]) => `  ${k}: ${v}`).join("\n");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_URL, CLAIMS_NOTIFY_TO } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const id = Number(body?.id);
  const event = String(body?.event || "");
  if (!Number.isFinite(id) || !EVENTS.includes(event)) return res.status(400).json({ error: "id and a valid event are required" });

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // Signed-in callers only — or the server's own CRON_SECRET, so a script or
  // job can send without a user session, as the other endpoints allow. Which
  // user doesn't matter; the row's state does.
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Sign in required" });
  if (!(process.env.CRON_SECRET && token === process.env.CRON_SECRET)) {
    const { data: who, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !who?.user) return res.status(401).json({ error: "Sign in required" });
  }

  const { data: c, error } = await sb.from("expenses").select("*").eq("id", id).maybeSingle();
  if (error || !c) return res.status(404).json({ error: "Claim not found" });
  if (!c.submitted_by) return res.status(400).json({ error: "Not a coach claim" });

  let tn = null;
  if (c.tournament_id) {
    const { data: t } = await sb.from("tournaments").select("name").eq("id", c.tournament_id).maybeSingle();
    tn = t?.name ? String(t.name).replace(/\s+/g, " ").trim() : null;
  }
  const base = APP_URL || ("https://" + (req.headers["x-forwarded-host"] || req.headers.host || "dseliteevals.vercel.app"));
  const coachEmail = String(c.submitted_by_email || "").trim().toLowerCase();
  const now = new Date().toISOString();

  // What this event requires of the row, who it goes to, and what it says.
  let to, subject, text, html, stamp;
  if (event === "filed") {
    if (c.status !== "pending") return res.status(200).json({ ok: true, skipped: "not pending" });
    if (c.claim_filed_notified_at) return res.status(200).json({ ok: true, skipped: "already notified" });
    to = (CLAIMS_NOTIFY_TO || DEFAULT_TO).split(",").map(s => s.trim()).filter(Boolean);
    subject = `Coach claim: ${c.submitted_by} — ${money(c.amount)} (${c.category || "Other"})`;
    const rows = detailRows(c, tn);
    text = `${c.submitted_by} has filed an expense claim.\n\n${textRows(rows)}\n\nReview it, with the receipt:\n${base}/?view=claims`;
    html = wrap(p(`<b>${esc(c.submitted_by)}</b> has filed an expense claim.`) + table(rows) + btn(`${base}/?view=claims`, "Review with the receipt"));
    stamp = { claim_filed_notified_at: now };
  } else {
    if (!EMAIL_RE.test(coachEmail)) return res.status(200).json({ ok: true, skipped: "no coach email on the claim" });
    to = [coachEmail];
    const rows = detailRows(c, tn);
    const mine = `${base}/?view=myexpenses`;
    if (event === "approved" || event === "rejected") {
      if (c.status !== event) return res.status(200).json({ ok: true, skipped: "status is " + c.status });
      if (c.claim_decision_notified === event) return res.status(200).json({ ok: true, skipped: "already notified" });
      if (event === "approved") {
        subject = `Approved: your ${money(c.amount)} expense claim`;
        text = `Hi ${first(c.submitted_by)},\n\nYour expense claim has been approved.\n\n${textRows(rows)}\n\nIt goes on the list to the club's accountant on Monday for payment. You'll get one more email when it has been paid.\n\n${mine}\n\nDrew`;
        html = wrap(p(`Hi ${esc(first(c.submitted_by))},`) + p("Your expense claim has been <b>approved</b>.") + table(rows)
          + p("It goes on the list to the club&rsquo;s accountant on Monday for payment. You&rsquo;ll get one more email when it has been paid.")
          + btn(mine, "See your claims") + p("Drew"));
      } else {
        const why = String(c.reject_note || "").trim() || "No reason was recorded.";
        subject = `Not approved: your ${money(c.amount)} expense claim`;
        text = `Hi ${first(c.submitted_by)},\n\nYour expense claim wasn't approved.\n\n${textRows(rows)}\n\nReason: ${why}\n\nIf you think that's wrong, or you can fix it, reply to this email.\n\n${mine}\n\nDrew`;
        html = wrap(p(`Hi ${esc(first(c.submitted_by))},`) + p("Your expense claim <b>wasn&rsquo;t approved</b>.") + table(rows)
          + `<p style="margin:0 0 16px;padding:12px 14px;background:#fff7ed;border-left:3px solid #f59e0b;border-radius:0 6px 6px 0"><b>Reason:</b> ${esc(why)}</p>`
          + p("If you think that&rsquo;s wrong, or you can fix it, reply to this email.") + btn(mine, "See your claims") + p("Drew"));
      }
      stamp = { claim_decision_notified: event, claim_decision_notified_at: now };
    } else {
      if (!c.reimbursed) return res.status(200).json({ ok: true, skipped: "not reimbursed" });
      if (c.claim_paid_notified_at) return res.status(200).json({ ok: true, skipped: "already notified" });
      subject = `Paid: your ${money(c.amount)} expense claim`;
      text = `Hi ${first(c.submitted_by)},\n\nYour expense claim has been reimbursed.\n\n${textRows(rows)}\n\nThanks for keeping the receipt.\n\nDrew`;
      html = wrap(p(`Hi ${esc(first(c.submitted_by))},`) + p("Your expense claim has been <b>reimbursed</b>.") + table(rows)
        + p("Thanks for keeping the receipt.") + p("Drew"));
      stamp = { claim_paid_notified_at: now };
    }
  }

  // Stamp FIRST, conditionally, so two simultaneous calls can't both send: only
  // the one whose update actually changes the row goes on to email.
  let q = sb.from("expenses").update(stamp).eq("id", id);
  if (event === "filed") q = q.is("claim_filed_notified_at", null);
  else if (event === "paid") q = q.is("claim_paid_notified_at", null);
  else q = q.or(`claim_decision_notified.is.null,claim_decision_notified.neq.${event}`);
  const { data: won, error: stampErr } = await q.select("id");
  if (stampErr) return res.status(500).json({ error: "Couldn't record the notification: " + stampErr.message });
  if (!won?.length) return res.status(200).json({ ok: true, skipped: "already notified" });

  const r = await fetch(base + "/api/send-email", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject, body: text, bodyHtml: html, recipients: to, replyTo: REPLY_TO,
      sentBy: "DS Elite HQ", source: "claims",
      url: event === "filed" ? "/?view=claims" : "/?view=myexpenses" }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok || out.error) {
    // Un-stamp so the next attempt can try again rather than the email being
    // recorded as sent when it wasn't.
    const undo = event === "filed" ? { claim_filed_notified_at: null }
      : event === "paid" ? { claim_paid_notified_at: null }
      : { claim_decision_notified: c.claim_decision_notified || null, claim_decision_notified_at: c.claim_decision_notified_at || null };
    await sb.from("expenses").update(undo).eq("id", id);
    return res.status(502).json({ error: "Email failed: " + (out.error || r.status) });
  }
  return res.status(200).json({ ok: true, event, to, pushed: out.pushed || 0 });
}
