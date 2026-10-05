// Vercel Cron: nightly "open practice shifts" notification.
//
// Finds upcoming practices that are marked out with no sub and not combined
// (i.e. need coverage), and if there are any, notifies coaches so they can pick
// one up in the app: a push to everyone + an email digest to the coach roster.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; also accepts ?token=.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
//      RESEND_API_KEY (or resend_api_key), DSE_FROM_EMAIL, DSE_REPLY_TO (opt),
//      VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (opt), APP_URL (opt).

import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { appOrigin } from "../shared/app-origin.js";

const RESEND_BATCH = "https://api.resend.com/emails/batch";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const extractAddress = (from) => { const m = String(from || "").match(/<([^>]+)>/); return (m ? m[1] : String(from || "")).trim(); };
const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtDate = (iso) => { try { return new Date(iso + "T00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }); } catch { return iso; } };

export default async function handler(req, res) {
  const {
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
    DSE_FROM_EMAIL, DSE_REPLY_TO, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, APP_URL,
  } = process.env;
  const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.resend_api_key;

  const urlToken = (() => { try { return new URL(req.url, "https://x").searchParams.get("token") || ""; } catch { return ""; } })();
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!CRON_SECRET || (bearer !== CRON_SECRET && urlToken !== CRON_SECRET)) return res.status(403).json({ error: "Forbidden" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const today = new Date().toISOString().slice(0, 10);

  const { data: cov } = await supabase.from("practice_coverage")
    .select("practice_date, team_name, slot, coach_out, sub_name, combine_with_team")
    .gte("practice_date", today);
  // An absence only needs a sub when the team is left with fewer than two of
  // its own coaches on the floor (a third coach covers one absence) — the same
  // rule as the practice board and the Day Schedule. Otherwise every coach got
  // a nightly "open shift" for practices that were already fully staffed.
  const { data: teams } = await supabase.from("practice_teams").select("team_name, head_coach, assistant_coach, third_coach");
  const nrm = (x) => String(x || "").trim().toLowerCase().replace(/\s+/g, " ");
  const isPh = (x) => !String(x || "").trim() || /^(tbd|tba|open|needed|sub|pending|n\/a|none|\?+)$/i.test(String(x).trim()) || /new coach|floater coach|assistant coach$/i.test(String(x));
  const realSub = (x) => !!String(x || "").trim() && !isPh(x);
  const staffLeft = (c) => {
    const t = (teams || []).find(x => x.team_name === c.team_name); if (!t) return 0;
    const outs = new Set((cov || []).filter(o => o.practice_date === c.practice_date && o.team_name === c.team_name && !realSub(o.sub_name) && !o.combine_with_team).map(o => nrm(o.coach_out)));
    return [t.head_coach, t.assistant_coach, t.third_coach].filter(x => x && !isPh(x) && !outs.has(nrm(x))).length;
  };
  const open = (cov || [])
    .filter(c => !c.sub_name && !c.combine_with_team && staffLeft(c) < 2)
    .sort((a, b) => (a.practice_date || "").localeCompare(b.practice_date || "") || (a.slot || "").localeCompare(b.slot || ""));

  if (!open.length) return res.status(200).json({ ok: true, openShifts: 0, note: "nothing to notify" });

  const url = appOrigin(req);

  // App push to everyone subscribed.
  let pushSent = 0;
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_SUBJECT || "mailto:drew@dselitevolleyball.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    const { data: subs } = await supabase.from("push_subscriptions").select("endpoint, p256dh, auth");
    const payload = JSON.stringify({
      title: `${open.length} open practice shift${open.length === 1 ? "" : "s"}`,
      body: "A coach is out and needs a sub — tap to pick one up.", url,
    });
    const stale = [];
    await Promise.all((subs || []).map(async (s) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload); pushSent++; }
      catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) stale.push(s.endpoint); }
    }));
    if (stale.length) await supabase.from("push_subscriptions").delete().in("endpoint", stale);
  }

  // Email digest to the coach roster.
  let emailsSent = 0;
  if (RESEND_API_KEY && DSE_FROM_EMAIL) {
    const { data: roster } = await supabase.from("coach_roster").select("email");
    const emails = [...new Set((roster || []).map(r => (r.email || "").trim().toLowerCase()).filter(e => EMAIL_RE.test(e)))];
    if (emails.length) {
      const replyTo = (DSE_REPLY_TO || extractAddress(DSE_FROM_EMAIL)).trim();
      const rows = open.map(c => `<tr><td style="padding:4px 10px;border-bottom:1px solid #eee">${escapeHtml(fmtDate(c.practice_date))}</td><td style="padding:4px 10px;border-bottom:1px solid #eee">${escapeHtml(c.team_name)}</td><td style="padding:4px 10px;border-bottom:1px solid #eee">${escapeHtml(c.slot)}</td><td style="padding:4px 10px;border-bottom:1px solid #eee">${escapeHtml(c.coach_out)} out</td></tr>`).join("");
      const html = `<div style="font-family:sans-serif;font-size:14px"><p><b>${open.length}</b> practice${open.length === 1 ? "" : "s"} still need${open.length === 1 ? "s" : ""} a sub. If you can cover one, open the DS Elite app and tap <b>Pick up</b> on the home screen.</p>` +
        `<table style="border-collapse:collapse;font-size:13px"><thead><tr><th style="text-align:left;padding:4px 10px;border-bottom:2px solid #ccc">Date</th><th style="text-align:left;padding:4px 10px;border-bottom:2px solid #ccc">Team</th><th style="text-align:left;padding:4px 10px;border-bottom:2px solid #ccc">Time</th><th style="text-align:left;padding:4px 10px;border-bottom:2px solid #ccc">Coach out</th></tr></thead><tbody>${rows}</tbody></table>` +
        `<p style="margin-top:12px"><a href="${url}" style="color:#a78bfa;font-weight:700">Open the app →</a></p></div>`;
      const text = `${open.length} practice(s) need a sub:\n` + open.map(c => `• ${fmtDate(c.practice_date)} — ${c.team_name} ${c.slot} (${c.coach_out} out)`).join("\n") + `\n\nPick one up on the home screen: ${url}`;
      const subject = `${open.length} open practice shift${open.length === 1 ? "" : "s"} need coverage`;
      for (let i = 0; i < emails.length; i += 100) {
        const group = emails.slice(i, i + 100).map(email => ({ from: DSE_FROM_EMAIL, to: [email], reply_to: replyTo, subject, html, text }));
        try {
          const r = await fetch(RESEND_BATCH, { method: "POST", headers: { Authorization: "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify(group) });
          if (r.ok) emailsSent += group.length; else console.error("Resend error:", await r.text());
        } catch (e) { console.error("Resend send failed:", e.message); }
      }
    }
  }

  return res.status(200).json({ ok: true, openShifts: open.length, pushSent, emailsSent });
}
