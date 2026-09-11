// Tell every coach the expense-claim system exists and how it works.
//
// It has been in the app since August under More → My Expenses and one coach
// has found it in six weeks. Everyone else is presumably either absorbing
// small costs or texting Drew receipts, which is the untracked mess the system
// was built to end. The mechanics below are exactly what the app now does —
// Drew notified on filing, reject-with-reason, Monday to the accountant, and
// emails on approval and payment (api/claim-notify.js) — so nothing here
// promises more than will happen.
//
// HQ notification + individual email, per coach. DRY RUN BY DEFAULT.
//
// Usage:
//   node scripts/send-claims-announcement.mjs
//   node scripts/send-claims-announcement.mjs --test drew@dselitevolleyball.com
//   node scripts/send-claims-announcement.mjs --send
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APP = "https://dseliteevals.vercel.app";
const LINK = APP + "/?view=myexpenses";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
const PLACEHOLDER = /^(tbd|tba|n\/a|na|none|pending|sub|open|needed|\?+|-+|—)$/i;
const isPlaceholder = (c) => { const s = String(c || "").trim(); return !s || PLACEHOLDER.test(s) || /new coach|floater coach|assistant coach$/i.test(s); };
const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const args = process.argv.slice(2);
const doSend = args.includes("--send");
const ti = args.indexOf("--test"); const testTo = ti >= 0 ? args[ti + 1] : null;

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const [{ data: teams }, { data: roster }, { data: accounts }] = await Promise.all([
  sb.from("practice_teams").select("head_coach, assistant_coach, third_coach"),
  sb.from("coach_roster").select("first_name, last_name, email"),
  sb.from("coaches").select("display_name, email"),
]);
const emailFor = new Map();
const put = (n, e) => { const k = norm(n), v = String(e || "").trim().toLowerCase(); if (k && EMAIL_RE.test(v) && !emailFor.has(k)) emailFor.set(k, v); };
(accounts || []).forEach(a => put(a.display_name, a.email));
(roster || []).forEach(r => put(`${r.first_name || ""} ${r.last_name || ""}`, r.email));
const people = new Map();
for (const t of teams || []) for (const n of [t.head_coach, t.assistant_coach, t.third_coach]) {
  if (isPlaceholder(n)) continue;
  const k = norm(n); if (!people.has(k)) people.set(k, String(n).trim());
}

const build = (name) => {
  const first = name.split(/\s+/)[0];
  const subject = "Paid for something for the club? Here's how to get it back";
  const text = `Hi ${first},

If you pay for something for the club out of your own pocket — parking at a tournament, a team meal, supplies, a background check — you can claim it back in the app.

HOW TO FILE A CLAIM

  1. Open My Expenses: ${LINK}
     (In the app it's under More → My Expenses.)
  2. Add a photo of the receipt, the amount, the date, what it was for, and the category. If it was for a tournament, pick the tournament.
  3. Submit.

WHAT HAPPENS NEXT

  - I'm notified straight away, and I approve it or reject it. If I reject it, you'll get the reason.
  - Approved claims go to the club's accountant every Monday for payment.
  - You get an email when it's approved, and another when it's been paid.

A receipt is required — the app won't take a claim without one — so keep them.

— Drew`;

  const li = (t) => `<li style="margin-bottom:7px">${t}</li>`;
  const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:580px">'
    + `<p style="margin:0 0 14px">Hi ${esc(first)},</p>`
    + `<p style="margin:0 0 18px">If you pay for something for the club out of your own pocket &mdash; parking at a tournament, a team meal, supplies, a background check &mdash; you can claim it back in the app.</p>`
    + `<p style="margin:0 0 8px;font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#c2186f">How to file a claim</p>`
    + `<ol style="margin:0 0 14px;padding-left:22px">`
    + li(`Open <b>My Expenses</b> in the app &mdash; it&rsquo;s under <b>More &rarr; My Expenses</b>.`)
    + li(`Add a <b>photo of the receipt</b>, the amount, the date, what it was for, and the category. If it was for a tournament, pick the tournament.`)
    + li(`Submit.`)
    + `</ol>`
    + `<p style="margin:0 0 20px"><a href="${LINK}" style="display:inline-block;background:#e91e8c;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700">Open My Expenses &rarr;</a></p>`
    + `<p style="margin:0 0 8px;font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#c2186f">What happens next</p>`
    + `<ul style="margin:0 0 16px;padding-left:20px">`
    + li(`I&rsquo;m notified straight away, and I approve it or reject it. If I reject it, you&rsquo;ll get the reason.`)
    + li(`Approved claims go to the club&rsquo;s accountant <b>every Monday</b> for payment.`)
    + li(`You get an email when it&rsquo;s approved, and another when it&rsquo;s been paid.`)
    + `</ul>`
    + `<p style="margin:0 0 16px"><b>A receipt is required</b> &mdash; the app won&rsquo;t take a claim without one &mdash; so keep them.</p>`
    + `<p style="margin:0">&mdash; Drew</p></div>`;
  return { subject, text, html, push: { title: "Getting paid back for club expenses", body: "Paid for something for the club? File it in My Expenses with a photo of the receipt.", url: LINK } };
};

const jobs = [...people.values()].sort().map(n => ({ name: n, to: emailFor.get(norm(n)), ...build(n) }));
const sendable = jobs.filter(j => j.to);
console.log(`${jobs.length} coaches · ${sendable.length} reachable` + (jobs.length - sendable.length ? ` · no email: ${jobs.filter(j => !j.to).map(j => j.name).join(", ")}` : ""));

const email = async (j, to) => {
  const r = await fetch(APP + "/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: j.subject, body: j.text, bodyHtml: j.html, recipients: [to], skipPush: true,
      sentBy: SENDER.name, sentByEmail: SENDER.email, source: "script" }) });
  const o = await r.json().catch(() => ({})); return r.ok && !o.error ? null : (o.error || r.status);
};

if (testTo) {
  const err = await email({ ...sendable[0], subject: "[TEST] " + sendable[0].subject }, testTo);
  console.log(err ? "FAILED: " + err : "test sent to " + testTo);
} else if (!doSend) {
  const j = sendable[0];
  console.log("\nSUBJECT: " + j.subject + "\n" + "─".repeat(64) + "\n" + j.text + "\n\nDRY RUN — nothing sent.");
} else {
  let sent = 0, pushed = 0, failed = 0;
  for (const j of sendable) {
    try {
      const pr = await fetch(APP + "/api/send-push", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...j.push, skipEmail: true, sentBy: SENDER.name, audience: { type: "email", email: j.to } }) });
      const po = await pr.json().catch(() => ({})); if (pr.ok && po.sent) pushed += po.sent;
    } catch { /* email still goes */ }
    const err = await email(j, j.to);
    if (err) { failed++; console.error("FAILED " + j.name + ": " + err); continue; }
    sent++; console.log("sent " + j.name.padEnd(22) + "→ " + j.to);
  }
  console.log(`\nDone. ${sent} emailed, ${pushed} notifications, ${failed} failed.`);
}
