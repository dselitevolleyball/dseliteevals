// Vercel Cron: tell coaches they're on at a clinic today or tomorrow.
//
// Covers both programmes, because a coach doesn't think of them as two systems:
//   DSSC   — sessions inside dssc_clinics.sessions, where she's the session
//            coach or an APPROVED staff pick
//   DSYSA  — dsysa_signups, the Monday-night clinics she volunteered for
//
// One message per coach per day, listing everything she's on today and
// tomorrow, so a coach on three things gets one email rather than three. The
// day-before line is the point: "you're on tomorrow" is still actionable, and
// "you're on tonight" mostly isn't.
//
// Someone whose email we can't resolve is NEVER guessed at — she's returned in
// `unresolved` so a human can fix the name, because a reminder sent to the
// wrong coach is worse than one not sent.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; also ?token=.
// Query:
//   ?dry=1        compute and return the plan, send nothing, log nothing
//   ?force=1      send even if today's digest was already logged
//   ?to=<email>   only this recipient (testing)
//   ?date=<iso>   pretend today is this date (testing)
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
//      RESEND_API_KEY (or resend_api_key), DSE_FROM_EMAIL,
//      VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (opt), APP_URL (opt).

import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const TZ = "America/Chicago";

// Names arrive from three places that don't agree with each other: "ella
// hinkle", "Coach Tara Fisher", "Tara Fisher". Compare on this, never on the
// raw string.
const nrm = (s) => String(s || "").trim().toLowerCase()
  .replace(/^coach\s+/, "").replace(/\s+/g, " ");

const addDays = (iso, n) => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const fmtDay = (iso) => {
  try {
    return new Date(iso + "T12:00:00Z")
      .toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
  } catch { return iso; }
};
// DSYSA stores "18:00", DSSC stores "5:00pm". Both end up readable.
const fmtTime = (t) => {
  const s = String(t || "").trim();
  if (!s) return "";
  const m24 = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m24) {
    const h = parseInt(m24[1], 10), mm = m24[2];
    const ampm = h >= 12 ? "pm" : "am";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + (mm === "00" ? "" : ":" + mm) + ampm;
  }
  return s.replace(/\s+/g, "").toLowerCase();
};
const range = (a, b) => {
  const s = fmtTime(a), e = fmtTime(b);
  if (s && e) return s.replace(/(am|pm)$/, (x) => (e.endsWith(x) ? "" : x)) + "–" + e;
  return s || e || "";
};
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, DSE_FROM_EMAIL,
          VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, APP_URL } = process.env;
  const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.resend_api_key;

  const q = (() => { try { return new URL(req.url, "https://x").searchParams; } catch { return new URLSearchParams(); } })();
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!CRON_SECRET || (bearer !== CRON_SECRET && q.get("token") !== CRON_SECRET)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });

  const dry = q.get("dry") === "1";
  const force = q.get("force") === "1";
  const only = String(q.get("to") || "").trim().toLowerCase();

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const today = q.get("date") || new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const tomorrow = addDays(today, 1);
  const window = [today, tomorrow];

  const [{ data: dsscClinics }, { data: dsysaClinics }, { data: dsysaSignups },
         { data: availability }, { data: roster }, { data: coaches }] = await Promise.all([
    supabase.from("dssc_clinics").select("id,name,sessions,location"),
    supabase.from("dsysa_clinics").select("*").in("clinic_date", window),
    supabase.from("dsysa_signups").select("*"),
    supabase.from("dssc_availability").select("coach_name,coach_email"),
    supabase.from("coach_roster").select("first_name,last_name,email"),
    supabase.from("coaches").select("display_name,email"),
  ]);

  // Email lookup, best source first. dssc_availability is the only one keyed by
  // the same name string the clinic sessions use.
  const byName = new Map();
  // The roster is where a person's name is actually spelled — sessions carry
  // "ella hinkle" and "Coach Tara Fisher". Used for the greeting.
  const displayByEmail = new Map();
  const put = (name, email, display) => {
    const k = nrm(name), em = String(email || "").trim();
    if (!k || !em) return;
    if (!byName.has(k)) byName.set(k, em);
    if (display && !displayByEmail.has(em.toLowerCase())) displayByEmail.set(em.toLowerCase(), display);
  };
  (availability || []).forEach(a => put(a.coach_name, a.coach_email));
  (roster || []).forEach(r => {
    const full = `${r.first_name || ""} ${r.last_name || ""}`.trim();
    put(full, r.email, full);
  });
  (coaches || []).forEach(c => put(c.display_name, c.email, c.display_name));

  // Keyed on the EMAIL, not the name: the roster has one person as both "Rob
  // Roberts" and "Adriel Roberts", and keying on name would send her two
  // separate digests for the same evening.
  const perCoach = new Map();
  const unresolved = new Set();
  const addItem = (name, item) => {
    const k = nrm(name);
    if (!k) return;
    if (!byName.has(k)) { unresolved.add(String(name).trim()); return; }
    const email = byName.get(k);
    const key = email.toLowerCase();
    if (!perCoach.has(key)) {
      perCoach.set(key, { name: displayByEmail.get(key) || String(name).trim(), email, items: [] });
    }
    perCoach.get(key).items.push(item);
  };

  // ── DSSC ──────────────────────────────────────────────────────────────
  for (const c of dsscClinics || []) {
    for (const s of Array.isArray(c.sessions) ? c.sessions : []) {
      if (!s || !window.includes(s.date)) continue;
      const where = s.court || c.location || "";
      const base = { source: "DSSC", title: c.name, date: s.date, time: range(s.start_time, s.end_time), where };
      if (s.coach_name) addItem(s.coach_name, { ...base, role: "coaching" });
      // Only approved staff. Someone still pending hasn't been given the shift,
      // and telling her she's on it would be the app making the decision.
      for (const st of Array.isArray(s.staff) ? s.staff : []) {
        if (!st || String(st.status || "").toLowerCase() !== "approved") continue;
        if (nrm(st.name) === nrm(s.coach_name)) continue;
        addItem(st.name, { ...base, role: st.role === "lead" ? "leading" : "assisting" });
      }
    }
  }

  // ── DSYSA ─────────────────────────────────────────────────────────────
  const dsysaById = new Map((dsysaClinics || []).filter(c => !c.cancelled).map(c => [c.id, c]));
  for (const su of dsysaSignups || []) {
    const c = dsysaById.get(su.clinic_id);
    if (!c) continue;
    addItem(su.coach_name, {
      source: "DSYSA",
      title: "DSYSA clinic",
      date: c.clinic_date,
      // These all carry 6–8pm with time_tbc set, so dropping the time on the
      // flag would leave the reminder with no time in it at all. Show it, say
      // it's unconfirmed.
      time: range(c.start_time, c.end_time) + (c.time_tbc ? " (to be confirmed)" : ""),
      where: c.location || "",
      role: su.is_lead ? "leading" : "helping",
    });
  }

  // Already-sent digests for today, so a cron retry doesn't tell anyone twice.
  const { data: already } = await supabase.from("clinic_reminder_log")
    .select("coach_email").eq("for_date", today);
  const sentTo = new Set((already || []).map(r => String(r.coach_email || "").toLowerCase()));

  const plan = [...perCoach.values()]
    .map(c => ({ ...c, items: c.items.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)) }))
    .filter(c => c.items.length)
    .filter(c => !only || c.email.toLowerCase() === only)
    .filter(c => force || !sentTo.has(c.email.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (dry) {
    return res.status(200).json({
      ok: true, dry: true, today, tomorrow,
      wouldSend: plan.length,
      skippedAlreadySent: [...sentTo].length,
      unresolved: [...unresolved],
      plan: plan.map(c => ({ name: c.name, email: c.email, items: c.items })),
    });
  }

  const appUrl = APP_URL || ("https://" + (req.headers["x-forwarded-host"] || req.headers.host));
  const line = (it) => `${it.source} · ${it.title} — ${it.time}${it.where ? " · " + it.where : ""} (${it.role})`;

  let emailed = 0, pushedTotal = 0;
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_SUBJECT || "mailto:drew@dselitevolleyball.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  }
  const { data: subs } = await supabase.from("push_subscriptions").select("endpoint,p256dh,auth,email");

  for (const c of plan) {
    const todayItems = c.items.filter(i => i.date === today);
    const tomItems = c.items.filter(i => i.date === tomorrow);
    const first = c.name.split(/\s+/)[0];

    const sections = [];
    if (todayItems.length) sections.push(`TODAY — ${fmtDay(today)}\n` + todayItems.map(i => "• " + line(i)).join("\n"));
    if (tomItems.length) sections.push(`TOMORROW — ${fmtDay(tomorrow)}\n` + tomItems.map(i => "• " + line(i)).join("\n"));

    const text = `Hi ${first},

You're on the schedule:

${sections.join("\n\n")}

Log your hours in DS Elite HQ afterwards so payroll picks them up.

Can't make one of these? Reply here as early as you can so we can cover it.

DS Elite / DSSC`;

    const htmlSection = (label, items) => items.length
      ? `<p style="margin:16px 0 4px"><b>${esc(label)}</b></p><ul style="margin:0;padding-left:18px">${
          items.map(i => `<li style="margin:3px 0">${esc(i.source)} · <b>${esc(i.title)}</b> — ${esc(i.time)}${i.where ? " · " + esc(i.where) : ""} <span style="color:#777">(${esc(i.role)})</span></li>`).join("")
        }</ul>` : "";
    const html = `<div style="font-family:sans-serif;font-size:14px;line-height:1.5;color:#111">
      <p>Hi ${esc(first)}, you're on the schedule:</p>
      ${htmlSection("Today — " + fmtDay(today), todayItems)}
      ${htmlSection("Tomorrow — " + fmtDay(tomorrow), tomItems)}
      <p style="margin-top:16px"><a href="${appUrl}" style="color:#e91e8c;font-weight:700">Log your hours in DS Elite HQ →</a></p>
      <p style="color:#777">Can't make one of these? Reply here as early as you can so we can cover it.</p>
    </div>`;

    const count = c.items.length;
    const soonest = todayItems.length ? "today" : "tomorrow";
    const subject = todayItems.length
      ? `You're coaching today — ${todayItems.map(i => i.title).join(", ")}`
      : `Coaching tomorrow — ${tomItems.map(i => i.title).join(", ")}`;

    let didEmail = false;
    if (RESEND_API_KEY && DSE_FROM_EMAIL) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: DSE_FROM_EMAIL, to: [c.email], subject, html, text }),
      }).catch(() => null);
      didEmail = !!(r && r.ok);
      if (didEmail) emailed++;
    }

    let pushed = 0;
    if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
      const mine = (subs || []).filter(s => String(s.email || "").toLowerCase() === c.email.toLowerCase());
      const payload = JSON.stringify({
        title: todayItems.length ? "You're coaching today" : "You're coaching tomorrow",
        body: `${count} clinic${count === 1 ? "" : "s"} ${soonest === "today" && tomItems.length ? "today and tomorrow" : soonest}. Tap for the details.`,
        url: appUrl,
      });
      await Promise.all(mine.map(s => webpush
        .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
        .then(() => { pushed++; })
        .catch(() => {})));
      pushedTotal += pushed;
    }

    // Logged whether or not the channels worked, so a retry can't double-send;
    // `emailed` records which of them actually did.
    await supabase.from("clinic_reminder_log").upsert({
      coach_email: c.email, coach_name: c.name, for_date: today,
      items: c.items, emailed: didEmail, pushed,
    }, { onConflict: "coach_email,for_date" });
  }

  return res.status(200).json({
    ok: true, today, tomorrow,
    reminded: plan.length, emailed, pushed: pushedTotal,
    unresolved: [...unresolved],
  });
}
