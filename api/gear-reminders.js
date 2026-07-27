// Vercel Cron: daily nudge to coaches who haven't submitted their gear sizes.
//
// Runs every morning up to and including the deadline, then goes quiet — the
// order is placed after that, so a reminder afterwards is just noise. Coaches
// who have answered are never contacted.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; also ?token=.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
//      VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (opt), APP_URL (opt),
//      RESEND_API_KEY (or resend_api_key), DSE_FROM_EMAIL,
//      GEAR_DEADLINE (opt, YYYY-MM-DD — default below).

import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const DEFAULT_DEADLINE = "2026-07-30"; // Thursday
const nrm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
// Mirrors isPlaceholderCoach / isRealSub in src/App.jsx — these aren't people.
const PLACEHOLDER = /^(tbd|tba|n\/a|na|none|pending|sub|open|needed|\?+|-+|—)$/i;
const isPlaceholder = (c) => { const v = String(c || "").trim(); return !v || PLACEHOLDER.test(v) || /new coach|floater coach|assistant coach$/i.test(v); };
// Every answer is required — a half-filled row can't be ordered against.
const complete = (g) => !!g && ["shoe_size","shoe_gender","tshirt_size","sweatshirt_size","sweatshirt_style","longsleeve_size","longsleeve_style","backpack_name"]
  .every(k => String(g[k] || "").trim());

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, APP_URL, DSE_FROM_EMAIL, GEAR_DEADLINE } = process.env;
  const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.resend_api_key;

  const urlToken = (() => { try { return new URL(req.url, "https://x").searchParams.get("token") || ""; } catch { return ""; } })();
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!CRON_SECRET || (bearer !== CRON_SECRET && urlToken !== CRON_SECRET)) return res.status(403).json({ error: "Forbidden" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });

  const deadline = GEAR_DEADLINE || DEFAULT_DEADLINE;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  if (today > deadline) return res.status(200).json({ ok: true, skipped: "past deadline", deadline, today });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const [{ data: teams }, { data: cover }, { data: roster }, { data: accounts }, { data: gear }] = await Promise.all([
    supabase.from("practice_teams").select("head_coach, assistant_coach, third_coach"),
    supabase.from("practice_coverage").select("sub_name"),
    supabase.from("coach_roster").select("first_name, last_name, email"),
    supabase.from("coaches").select("display_name, email"),
    supabase.from("coach_gear").select("*"),
  ]);

  // Active coaches, resolved from BOTH the roster and app accounts — a coach
  // can have one without the other, and a roster-only lookup silently drops them.
  const active = new Set();
  (teams || []).forEach(t => [t.head_coach, t.assistant_coach, t.third_coach].forEach(c => { if (c && !isPlaceholder(c)) active.add(nrm(c)); }));
  (cover || []).forEach(c => { if (c.sub_name && !isPlaceholder(c.sub_name)) active.add(nrm(c.sub_name)); });
  const byName = new Map();
  const put = (name, email, fromRoster) => {
    const k = nrm(name); if (!k || !active.has(k)) return;
    const e = String(email || "").trim().toLowerCase();
    const cur = byName.get(k);
    if (!cur) { byName.set(k, { name: String(name).trim(), email: e }); return; }
    if (!cur.email && e) cur.email = e;
    if (fromRoster && String(name).trim()) cur.name = String(name).trim();
  };
  (accounts || []).forEach(a => put(a.display_name, a.email, false));
  (roster || []).forEach(r => put(`${r.first_name || ""} ${r.last_name || ""}`.trim(), r.email, true));

  const gearBy = new Map((gear || []).map(g => [nrm(g.coach_name), g]));
  const outstanding = [...byName.values()].filter(s => !complete(gearBy.get(nrm(s.name))));
  const reachable = outstanding.filter(s => s.email);
  const unreachable = outstanding.filter(s => !s.email).map(s => s.name);
  if (!outstanding.length) return res.status(200).json({ ok: true, outstanding: 0, deadline, note: "everyone has answered" });

  const base = APP_URL || ("https://" + (req.headers["x-forwarded-host"] || req.headers.host || "dseliteevals.vercel.app"));
  const url = base + "/?view=home";
  const dlLabel = new Date(deadline + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
  const daysLeft = Math.round((new Date(deadline + "T00:00:00Z") - new Date(today + "T00:00:00Z")) / 86400000);
  const urgency = daysLeft <= 0 ? "Today is the deadline." : daysLeft === 1 ? "Tomorrow is the deadline." : daysLeft + " days left.";

  // Push (best-effort — a coach without notifications still gets the email).
  let pushed = 0;
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_SUBJECT || "mailto:drew@dselitevolleyball.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    const { data: subs } = await supabase.from("push_subscriptions").select("endpoint, p256dh, auth, email");
    const wanted = new Set(reachable.map(s => s.email));
    const mine = (subs || []).filter(s => wanted.has(String(s.email || "").toLowerCase()));
    const payload = JSON.stringify({
      title: "Gear sizes needed by " + dlLabel,
      body: urgency + " One minute — shoes, tee, sweatshirt, long sleeve, backpack name. No answer, no gear.",
      url,
    });
    await Promise.all(mine.map(s => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload).catch(() => {})));
    pushed = mine.length;
  }

  // Email, one per coach so it's addressed to them by name.
  let emailed = 0;
  if (RESEND_API_KEY && DSE_FROM_EMAIL) {
    for (const s of reachable) {
      const first = s.name.split(/\s+/)[0];
      const text = `Hi ${first},\n\nWe're placing the coaches gear order and still need your sizes — shoes, t-shirt, sweatshirt, performance long sleeve, and the name you want printed on your backpack.\n\nIt takes about a minute. Open the DS Elite app and the form is at the top of your dashboard:\n${url}\n\n${urgency} Please have it in by ${dlLabel}. After that the order goes in, and anyone who hasn't answered won't have gear in their size.\n\nThanks,\nDrew`;
      const html = `<div style="font-family:sans-serif;font-size:14px;line-height:1.6"><p>Hi ${first},</p><p>We're placing the coaches gear order and still need your sizes — shoes, t-shirt, sweatshirt, performance long sleeve, and the name you want printed on your backpack.</p><p>It takes about a minute:</p><p><a href="${url}" style="background:#e91e8c;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700">Fill out my sizes →</a></p><p><b>${urgency}</b> Please have it in by <b>${dlLabel}</b>. After that the order goes in, and anyone who hasn't answered won't have gear in their size.</p><p>Thanks,<br>Drew</p></div>`;
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST", headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: DSE_FROM_EMAIL, to: [s.email], subject: `Action needed: your coaches gear sizes (due ${dlLabel})`, html, text }),
        });
        if (r.ok) emailed++;
      } catch { /* one bad address shouldn't stop the rest */ }
    }
  }

  if (reachable.length) {
    await supabase.from("coach_gear_reminders").insert(reachable.map(s => ({ coach_name: s.name, channel: "cron" })));
  }

  return res.status(200).json({ ok: true, deadline, daysLeft, outstanding: outstanding.length,
    names: outstanding.map(s => s.name), unreachable, emailed, pushed });
}
