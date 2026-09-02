// Vercel Cron: chase the head coaches whose kickoff party still isn't settled.
//
// Every coach was emailed on 1 September with orientation and, attached to it,
// their own kickoff status. Thirteen of seventeen teams owed something back:
// ten had never opened the form, three had promised a date and not set one, and
// two were booked into November, outside the September/October window Drew
// wants them in.
//
// This is the follow-up, and it is deliberately not a one-shot. A single chase
// on 12 September catches whoever happens to be at their desk that morning; a
// weekly one keeps asking until the answer arrives and then stops, which is the
// behaviour you actually want from a chase. Once a team is settled it is never
// contacted again.
//
// SILENT UNTIL IT ISN'T
//
//   before START      nothing — the 1 September email is still recent
//   after END         nothing — the window has closed, chasing is pointless
//   nothing owed      nothing — a quiet Saturday sends no mail at all
//
// So an email from this endpoint means one thing: your team is still the
// problem. Drew gets a digest on the same run, and only when coaches were
// written to, so he sees who is holding out without having to ask.
//
// A team is settled when its party is HELD, or SCHEDULED for a date inside the
// window. Three states are chased, each with its own wording, because "please
// fill in the form" is the wrong sentence for a coach who filled it in and
// simply picked November.
//
// Rise teams are excluded — they don't run a kickoff party.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; also ?token=.
// Query: ?dry=1 to see who would be written to without sending.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
//      RESEND_API_KEY (or resend_api_key), DSE_FROM_EMAIL,
//      VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (opt), APP_URL (opt),
//      KICKOFF_CHASE_START / _END / _FROM / _TO (all optional).

import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

// Ten days after the orientation email, then weekly until the window shuts.
const DEFAULT_START = "2026-09-12";
const DEFAULT_END   = "2026-11-01";
// The window a kickoff party is expected to land in.
const WINDOW_FROM = "2026-09-01";
const WINDOW_TO   = "2026-10-31";
const DIGEST_TO   = "drew@dselitevolleyball.com";

const isRise = (t) => /\brise\b/i.test(String(t || ""));
const PLACEHOLDER = /^(tbd|tba|n\/a|na|none|pending|sub|open|needed|\?+|-+|—)$/i;
const isPlaceholder = (c) => {
  const s = String(c || "").trim();
  return !s || PLACEHOLDER.test(s) || /new coach|floater coach|assistant coach$/i.test(s);
};
const nrm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (iso) => {
  if (!iso) return "";
  try { return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }); }
  catch { return iso; }
};

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, DSE_FROM_EMAIL, APP_URL,
          VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT,
          KICKOFF_CHASE_START, KICKOFF_CHASE_END, KICKOFF_CHASE_FROM, KICKOFF_CHASE_TO } = process.env;
  const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.resend_api_key;

  const url = (() => { try { return new URL(req.url, "https://x"); } catch { return null; } })();
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!CRON_SECRET || (bearer !== CRON_SECRET && (url?.searchParams.get("token") || "") !== CRON_SECRET)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });

  const dry = url?.searchParams.get("dry") === "1";
  const start = KICKOFF_CHASE_START || DEFAULT_START;
  const end   = KICKOFF_CHASE_END   || DEFAULT_END;
  const winFrom = KICKOFF_CHASE_FROM || WINDOW_FROM;
  const winTo   = KICKOFF_CHASE_TO   || WINDOW_TO;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

  if (today < start) return res.status(200).json({ ok: true, skipped: "before start", start, today });
  if (today > end)   return res.status(200).json({ ok: true, skipped: "window closed", end, today });

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const [{ data: teams }, { data: kicks }, { data: roster }, { data: accounts }] = await Promise.all([
    sb.from("practice_teams").select("team_name, head_coach, kickoff_form_token"),
    sb.from("team_kickoffs").select("team_name, kickoff_status, kickoff_date, plan_by"),
    sb.from("coach_roster").select("first_name, last_name, email"),
    sb.from("coaches").select("display_name, email"),
  ]);

  const kickBy = new Map((kicks || []).map(k => [k.team_name, k]));
  const emailFor = new Map();
  const put = (name, email) => {
    const k = nrm(name), e = String(email || "").trim().toLowerCase();
    if (!k || !EMAIL_RE.test(e) || emailFor.has(k)) return;
    emailFor.set(k, e);
  };
  (accounts || []).forEach(a => put(a.display_name, a.email));
  (roster || []).forEach(r => put(`${r.first_name || ""} ${r.last_name || ""}`.trim(), r.email));

  const base = APP_URL || ("https://" + (req.headers["x-forwarded-host"] || req.headers.host || "dseliteevals.vercel.app"));

  // One row per unsettled team, then grouped by the coach who owns it.
  const open = [];
  for (const t of (teams || [])) {
    if (isRise(t.team_name) || isPlaceholder(t.head_coach)) continue;
    const k = kickBy.get(t.team_name);
    const link = t.kickoff_form_token ? `${base}/kickoff?t=${t.kickoff_form_token}` : base;
    if (k?.kickoff_status === "held") continue;
    if (k?.kickoff_status === "scheduled" && k.kickoff_date >= winFrom && k.kickoff_date <= winTo) continue;

    const row = { team: t.team_name, coach: String(t.head_coach).trim(), link };
    if (!k) {
      open.push({ ...row, state: "no answer",
        text: `${t.team_name} — I still don't have your form at all. Who is your team parent, and when is your party?`,
        html: `<b>${esc(t.team_name)}</b> &mdash; I still don&rsquo;t have your form at all. Who is your team parent, and when is your party?` });
    } else if (k.kickoff_status === "scheduled") {
      open.push({ ...row, state: "outside the window",
        text: `${t.team_name} — booked for ${fmt(k.kickoff_date)}, which is outside the September/October window. Can you move it up? Update the same link with the new date.`,
        html: `<b>${esc(t.team_name)}</b> &mdash; booked for <b>${esc(fmt(k.kickoff_date))}</b>, which is outside the September/October window. Can you move it up? Update the same link with the new date.` });
    } else {
      const late = k.plan_by && k.plan_by < today;
      open.push({ ...row, state: late ? "past their own date" : "not scheduled",
        text: `${t.team_name} — still no date. You said you'd have one by ${fmt(k.plan_by)}${late ? ", which has passed" : ""}. Pick a day in September or October with your team parent and update the same link.`,
        html: `<b>${esc(t.team_name)}</b> &mdash; still no date. You said you&rsquo;d have one by <b>${esc(fmt(k.plan_by))}</b>${late ? ", which has passed" : ""}. Pick a day in September or October with your team parent and update the same link.` });
    }
  }

  if (!open.length) {
    return res.status(200).json({ ok: true, outstanding: 0, emailed: 0, note: "every team is settled" });
  }

  const byCoach = new Map();
  for (const o of open) {
    const k = nrm(o.coach);
    if (!byCoach.has(k)) byCoach.set(k, { name: o.coach, email: emailFor.get(k), items: [] });
    byCoach.get(k).items.push(o);
  }
  const targets = [...byCoach.values()];
  const reachable = targets.filter(t => t.email);
  const unreachable = targets.filter(t => !t.email).map(t => t.name);

  if (dry) {
    return res.status(200).json({ ok: true, dry: true, today, outstanding: open.length,
      coaches: targets.map(t => ({ coach: t.name, email: t.email || null,
        teams: t.items.map(i => `${i.team} (${i.state})`) })), unreachable });
  }
  if (!RESEND_API_KEY || !DSE_FROM_EMAIL) return res.status(500).json({ error: "Email not configured" });

  let emailed = 0;
  for (const t of reachable) {
    const first = t.name.split(/\s+/)[0];
    const many = t.items.length > 1;
    const text = `Hi ${first},

Still chasing your kickoff part${many ? "ies" : "y"}. I'm trying to finish planning and ${many ? "these are" : "this is"} what's outstanding:

${t.items.map(i => "  " + i.text + "\n  " + i.link).join("\n\n")}

The party itself is simple — a couple of hours somewhere, players and parents, before the season swallows everyone. Your team parent should be doing the organising; you just need to agree a date and tell me.

Thanks,
Drew`;
    const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:600px">'
      + `<p style="margin:0 0 14px">Hi ${esc(first)},</p>`
      + `<p style="margin:0 0 16px">Still chasing your kickoff part${many ? "ies" : "y"}. I&rsquo;m trying to finish planning and ${many ? "these are" : "this is"} what&rsquo;s outstanding:</p>`
      + t.items.map(i => `<p style="margin:0 0 10px">${i.html}</p>`
          + `<p style="margin:0 0 18px"><a href="${i.link}" style="display:inline-block;background:#e91e8c;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:700">Open ${esc(i.team)}&rsquo;s form &rarr;</a></p>`).join("")
      + `<p style="margin:0 0 14px">The party itself is simple &mdash; a couple of hours somewhere, players and parents, before the season swallows everyone. Your team parent should be doing the organising; you just need to agree a date and tell me.</p>`
      + '<p style="margin:0">Thanks,<br>Drew</p></div>';
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: DSE_FROM_EMAIL, to: [t.email],
          subject: many ? "Your kickoff parties — still need dates" : `${t.items[0].team} — still need your kickoff date`,
          text, html }),
      });
      if (r.ok) emailed++;
    } catch { /* one bad address shouldn't stop the rest */ }
  }

  // Push, best-effort. A coach without notifications still got the email.
  let pushed = 0;
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    try {
      webpush.setVapidDetails(VAPID_SUBJECT || "mailto:drew@dselitevolleyball.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
      const { data: subs } = await sb.from("push_subscriptions").select("endpoint, p256dh, auth, email");
      const wanted = new Map(reachable.map(t => [t.email, t]));
      const mine = (subs || []).filter(s => wanted.has(String(s.email || "").toLowerCase()));
      await Promise.all(mine.map(s => {
        const t = wanted.get(String(s.email || "").toLowerCase());
        return webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({
            title: "Kickoff party — still need a date",
            body: t.items.map(i => i.team).join(" and ") + ". Agree a day in September or October with your team parent.",
            url: t.items[0].link,
          })).catch(() => {});
      }));
      pushed = mine.length;
    } catch { /* push is never the reason this endpoint fails */ }
  }

  // Digest to Drew — only on a run that actually wrote to somebody.
  if (emailed) {
    const rows = open.map(o =>
      `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap;font-weight:600">${esc(o.team)}</td>` +
      `<td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(o.coach)}</td>` +
      `<td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(o.state)}</td></tr>`).join("");
    await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: DSE_FROM_EMAIL, to: [DIGEST_TO],
        subject: `Kickoff chase sent — ${open.length} team${open.length === 1 ? "" : "s"} still open`,
        text: `Chased ${emailed} coach${emailed === 1 ? "" : "es"} about ${open.length} team${open.length === 1 ? "" : "s"}:\n\n` +
          open.map(o => `  ${o.team} — ${o.coach} — ${o.state}`).join("\n") +
          (unreachable.length ? `\n\nNo email on file: ${unreachable.join(", ")}` : "") +
          `\n\nThis runs weekly and stops on its own once every team is settled.`,
        html: '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:600px">'
          + `<p style="margin:0 0 14px">Chased <b>${emailed}</b> coach${emailed === 1 ? "" : "es"} about <b>${open.length}</b> team${open.length === 1 ? "" : "s"}.</p>`
          + `<table style="border-collapse:collapse;width:100%;font-size:14px"><tbody>${rows}</tbody></table>`
          + (unreachable.length ? `<p style="margin:14px 0 0;color:#b62d2d">No email on file: ${esc(unreachable.join(", "))}</p>` : "")
          + `<p style="margin:18px 0 0;font-size:13px;color:#666">Weekly. Stops on its own once every team is settled, and after ${esc(end)}.</p></div>`,
      }),
    }).catch(() => {});
  }

  return res.status(200).json({ ok: true, today, outstanding: open.length,
    coaches: reachable.length, emailed, pushed, unreachable });
}
