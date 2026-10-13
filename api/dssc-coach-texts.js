// Vercel Cron: the 10am DSSC coach texts (Drew, 13 Oct 2026).
//
//   1. Class day — every coach on a DSSC class today (the lead and approved
//      staff) gets one text at 10am Central listing each class: time, court and
//      how many players are signed up. For PODS (Playbook category "Volleyball
//      PODs" — U13-15 National Pins, Regional Libero/DS, ...) the text also says
//      whether the practice plan is in and whether the note to parents has gone
//      out, with a link straight to the class.
//   2. Day after a pod — the coach who led it gets a text asking for the recap,
//      with a link that opens that class on its Recap tab.
//   0. First, any class today (starting 11am or later) with NOBODY signed up is
//      cancelled: the session is flagged cancelled (it stays listed, tagged),
//      its coaches are told in their 10am text, and Hunter gets a text to turn
//      off registration for it in Playbook. Held back - and flagged in the
//      email instead - when the hourly Playbook sign-up import hasn't run
//      cleanly in 3 hours, or when most of the day shows no sign-ups (both
//      mean the counts can't be trusted).
//   3. The DSSC directors get a 10am email: today's pods with plan / parent-note
//      status, and yesterday's pods with recap status.
//
// Texts go from the club's own number (brand "dssc"), so a coach's reply lands
// in DSSC Texts. One text per coach per kind per day (dssc_coach_texts), so a
// retry never doubles up.
//
// Two crons (15:00 and 16:00 UTC) cover daylight and standard time; the run
// that isn't 10am in Dripping Springs does nothing.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; also ?token=, or the
// service-role key as the bearer (scripts).
// Query:
//   ?dry=1        return what would be sent, send nothing
//   ?test=1       send every text to Drew only, marked with who it was for
//   ?date=<iso>   pretend today is this date (runs regardless of the hour)
//   ?force=1      run now even if it isn't 10am / already sent today
//   ?only=day|recap|email   one part only
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, TWILIO_*,
//      DSSC_TWILIO_FROM_NUMBER, RESEND_API_KEY, DSE_FROM_EMAIL,
//      DSSC_PLANNER_EMAILS (opt — who gets the director email).

import { createClient } from "@supabase/supabase-js";
import { appOrigin } from "../shared/app-origin.js";
import { sessionStaff, parseClock } from "../shared/dssc-clinics.js";
import { sendOneSms, normalizePhone, twilioReady } from "./_lib/sms.js";

const TZ = "America/Chicago";
const DREW_PHONE = "+15122029099";
const DIRECTORS_DEFAULT = ["hunter@drippingsportsclub.com", "drew@dselitevolleyball.com"];

const nrm = (s) => String(s || "").trim().toLowerCase().replace(/^coach\s+/, "").replace(/\s+/g, " ");
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fmtDay = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cleanName = (s) => String(s || "").replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();   // emoji out of program names
const timeRange = (s) => [s.start_time, s.end_time].filter(Boolean).join("-");

export const isPod = (c) => /pod/i.test(c?.category || "") || /\bpods?\b/i.test(c?.name || "");
export const hasPlan = (s) => (Array.isArray(s?.blocks) ? s.blocks : []).some(b => String(b?.name || "").trim());

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, DSE_FROM_EMAIL, DSSC_FROM_EMAIL, DSSC_PLANNER_EMAILS } = process.env;
  const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.resend_api_key;
  const q = (() => { try { return new URL(req.url, "https://x").searchParams; } catch { return new URLSearchParams(); } })();
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  // The service-role key also works, so a test can be run from a script.
  const okAuth = (CRON_SECRET && (bearer === CRON_SECRET || q.get("token") === CRON_SECRET)) || (SUPABASE_SERVICE_ROLE_KEY && bearer === SUPABASE_SERVICE_ROLE_KEY);
  if (!okAuth) return res.status(403).json({ error: "Forbidden" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });

  const dry = q.get("dry") === "1", test = q.get("test") === "1", force = q.get("force") === "1";
  const only = q.get("only") || "";
  const hourCT = Number(new Date().toLocaleString("en-US", { timeZone: TZ, hour: "numeric", hour12: false }));
  if (!dry && !test && !force && !q.get("date") && hourCT !== 10) return res.status(200).json({ ok: true, skipped: `It's ${hourCT}:00 in Dripping Springs, not 10am` });

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const today = q.get("date") || new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const yesterday = addDays(today, -1);
  const origin = appOrigin(req);
  const classLink = (c, s, tab) => `${origin}/?view=dssc&clinic=${c.id}&session=${encodeURIComponent(s.id)}${tab ? "&ctab=" + tab : ""}`;

  const [{ data: clinics }, { data: roster }, { data: coaches }, { data: avail }] = await Promise.all([
    sb.from("dssc_clinics").select("id,name,category,location,sessions"),
    sb.from("coach_roster").select("first_name,last_name,email,phone"),
    sb.from("coaches").select("display_name,email"),
    sb.from("dssc_availability").select("coach_name,coach_email"),
  ]);

  // Who is who: a session names a coach as "ella hinkle", "Coach Tara Fisher"
  // or by login name. Resolve to the roster row (name + phone); never guess.
  const byEmail = new Map((roster || []).filter(r => r.email).map(r => [String(r.email).trim().toLowerCase(), r]));
  const byName = new Map();
  for (const r of roster || []) byName.set(nrm(`${r.first_name || ""} ${r.last_name || ""}`), r);
  for (const c of coaches || []) { const r = byEmail.get(String(c.email || "").trim().toLowerCase()); if (r && c.display_name && !byName.has(nrm(c.display_name))) byName.set(nrm(c.display_name), r); }
  for (const a of avail || []) { const r = byEmail.get(String(a.coach_email || "").trim().toLowerCase()); if (r && a.coach_name && !byName.has(nrm(a.coach_name))) byName.set(nrm(a.coach_name), r); }
  const person = (name) => {
    const r = byName.get(nrm(name));
    if (!r) return null;
    const full = `${r.first_name || ""} ${r.last_name || ""}`.trim();
    return { key: nrm(full), name: full, phone: normalizePhone(r.phone || ""), email: r.email || null };
  };

  // Today's and yesterday's classes, with their sign-up counts and whether the
  // parent note actually went out.
  const todays = [], yesterdays = [];
  for (const c of clinics || []) for (const s of Array.isArray(c.sessions) ? c.sessions : []) {
    if (s?.date === today) todays.push({ c, s });
    else if (s?.date === yesterday) yesterdays.push({ c, s });
  }
  const clinicIds = [...new Set([...todays, ...yesterdays].map(x => x.c.id))];
  const [{ data: kids }, { data: msgs }, { data: already }] = await Promise.all([
    clinicIds.length ? sb.from("dssc_pod_roster").select("clinic_id,session_id,player_name").in("clinic_id", clinicIds) : { data: [] },
    clinicIds.length ? sb.from("dssc_class_messages").select("clinic_id,session_id,emails_sent,texts_sent").in("clinic_id", clinicIds) : { data: [] },
    sb.from("dssc_coach_texts").select("coach_key,kind").eq("for_date", today).eq("is_test", false),
  ]);
  const players = (c, s) => new Set((kids || []).filter(k => k.clinic_id === c.id && (!k.session_id || String(k.session_id) === String(s.id))).map(k => nrm(k.player_name)).filter(Boolean)).size;
  const noteSent = (c, s) => (msgs || []).some(m => m.clinic_id === c.id && String(m.session_id) === String(s.id) && (m.emails_sent || 0) + (m.texts_sent || 0) > 0);
  const sentKey = new Set((already || []).map(a => a.coach_key + "|" + a.kind));
  const unresolved = new Set(), noPhone = new Set();
  const keyOf = (c, s) => c.id + "|" + s.id;

  // ── 0. Auto-cancel today's classes with nobody signed up ──────────────────
  // dssc_sync.auto_cancel = false turns this step off (reminders still go).
  const { data: syncRow } = await sb.from("dssc_sync").select("registrations_at,registrations_error,registrations_error_at,auto_cancel").eq("id", 1).maybeSingle();
  const regAt = syncRow?.registrations_at ? new Date(syncRow.registrations_at) : null;
  const regFresh = !!regAt && (Date.now() - regAt.getTime()) < 3 * 3600e3
    && !(syncRow.registrations_error && syncRow.registrations_error_at && new Date(syncRow.registrations_error_at) > regAt);
  const liveToday = todays.filter(x => !x.s.cancelled);
  const empty = liveToday.filter(x => players(x.c, x.s) === 0 && (parseClock(x.s.start_time) ?? 24) >= 11);
  let cancelHold = null;
  if (empty.length && syncRow && syncRow.auto_cancel === false) cancelHold = "auto-cancel is switched off";
  else if (empty.length && !regFresh) cancelHold = "the Playbook sign-up import hasn't run cleanly in the last 3 hours";
  else if (empty.length >= 4 && empty.length > liveToday.length / 2) cancelHold = `${empty.length} of ${liveToday.length} classes show no sign-ups, which looks like a sign-up import problem`;
  const toCancel = cancelHold || (only && only !== "day") ? [] : empty;
  const cancelledKeys = new Set(toCancel.map(x => keyOf(x.c, x.s)));
  const cancelWrites = [];
  if (toCancel.length && !dry && !test) {
    const at = new Date().toISOString();
    for (const id of [...new Set(toCancel.map(x => x.c.id))]) {
      const { data: fresh } = await sb.from("dssc_clinics").select("sessions").eq("id", id).maybeSingle();
      const next = (Array.isArray(fresh?.sessions) ? fresh.sessions : []).map(x => cancelledKeys.has(id + "|" + x.id)
        ? { ...x, cancelled: true, cancelled_at: at, cancelled_by: "auto (10am, no sign-ups)", cancelled_reason: "no players signed up by 10am" } : x);
      const { error } = await sb.from("dssc_clinics").update({ sessions: next, updated_by: "auto-cancel (no sign-ups)", updated_at: at }).eq("id", id);
      cancelWrites.push({ clinic_id: id, ok: !error, error: error?.message || null });
    }
  }

  // ── 1. Class-day texts ────────────────────────────────────────────────────
  const dayPlan = new Map();   // coach key -> { who, items }
  for (const { c, s } of todays) {
    for (const st of sessionStaff(s).filter(x => x.status === "approved")) {
      const who = person(st.name);
      if (!who) { unresolved.add(String(st.name).trim()); continue; }
      if (!dayPlan.has(who.key)) dayPlan.set(who.key, { who, items: [] });
      const it = dayPlan.get(who.key);
      if (!it.items.some(x => x.c.id === c.id && x.s.id === s.id)) it.items.push({ c, s, cancelled: !!s.cancelled || cancelledKeys.has(keyOf(c, s)), pod: isPod(c), players: players(c, s), plan: hasPlan(s), note: noteSent(c, s), noteWritten: !!String(s.focus || "").trim() });
    }
  }
  const dayTexts = [...dayPlan.values()].map(({ who, items }) => {
    items.sort((a, b) => String(a.s.start_time || "").localeCompare(String(b.s.start_time || "")));
    const live = items.filter(i => !i.cancelled), off = items.filter(i => i.cancelled);
    const offLines = off.map(i => `- ${cleanName(i.c.name)}, ${timeRange(i.s)}`).join("\n");
    if (!live.length) return { kind: "day", who, text: `Hi {first}, your DSSC ${off.length === 1 ? "class today is" : "classes today are"} CANCELLED - no players signed up:\n${offLines}\nYou don't need to come in. Questions? Reply here.`, items: off.map(i => ({ clinic: i.c.name, session_id: i.s.id, time: timeRange(i.s), cancelled: true })) };
    const lines = live.map(i => {
      let l = `- ${cleanName(i.c.name)}, ${timeRange(i.s)}${i.s.court ? ", " + i.s.court : ""}: ${i.players ? i.players + " player" + (i.players === 1 ? "" : "s") + " signed up" : "no players signed up yet"}.`;
      if (i.pod) l += ` Practice plan: ${i.plan ? "done" : "NOT DONE"}. Parent note: ${i.note ? "sent" : i.noteWritten ? "written, NOT SENT" : "NOT SENT"}.`;
      return l + `\n${classLink(i.c, i.s)}`;
    });
    const todo = live.some(i => i.pod && (!i.plan || !i.note));
    const text = `Hi {first}, you're coaching at DSSC today:\n${lines.join("\n")}\n${off.length ? "CANCELLED - no players signed up (no need to come in):\n" + offLines + "\n" : ""}${todo ? "Please finish the plan and send the parent note before class. " : ""}Can't make it? Reply here.`;
    return { kind: "day", who, text, items: items.map(i => ({ clinic: i.c.name, session_id: i.s.id, time: timeRange(i.s), players: i.players, pod: i.pod, plan: i.plan, note: i.note, cancelled: i.cancelled })) };
  });

  // ── 2. Recap asks, the day after a pod ────────────────────────────────────
  const recapPlan = new Map();
  for (const { c, s } of yesterdays) {
    if (!isPod(c) || s.cancelled || String(s.recap || "").trim()) continue;
    const crew = sessionStaff(s).filter(x => x.status === "approved");
    const lead = crew.find(x => x.role === "lead") || crew[0];
    if (!lead) continue;
    const who = person(lead.name);
    if (!who) { unresolved.add(String(lead.name).trim()); continue; }
    if (!recapPlan.has(who.key)) recapPlan.set(who.key, { who, items: [] });
    recapPlan.get(who.key).items.push({ c, s });
  }
  const recapTexts = [...recapPlan.values()].map(({ who, items }) => ({
    kind: "recap", who,
    text: items.length === 1
      ? `Hi {first}, how did yesterday's ${cleanName(items[0].c.name)} go? Please add a quick recap so the next coach can build on it. It takes 2 minutes:\n${classLink(items[0].c, items[0].s, "recap")}`
      : `Hi {first}, how did yesterday's pods go? Please add a quick recap for each so the next coach can build on it:\n${items.map(i => `- ${cleanName(i.c.name)}: ${classLink(i.c, i.s, "recap")}`).join("\n")}`,
    items: items.map(i => ({ clinic: i.c.name, session_id: i.s.id })),
  }));

  // Hunter turns registration off in Playbook, or a family can still sign up
  // (and pay) for a class that isn't happening.
  const cancelTexts = [];
  if (toCancel.length) {
    const lines = toCancel.map(x => {
      const crew = sessionStaff(x.s).filter(y => y.status === "approved").map(y => y.name).join(", ");
      return `- ${cleanName(x.c.name)}, ${timeRange(x.s)}${crew ? " (" + crew + ")" : " (no coach)"}`;
    }).join("\n");
    for (const em of (process.env.DSSC_CANCEL_NOTIFY_EMAILS || "hunter@drippingsportsclub.com").split(",").map(x => x.trim().toLowerCase()).filter(Boolean)) {
      const r = byEmail.get(em);
      if (!r) { unresolved.add(em); continue; }
      const name = `${r.first_name || ""} ${r.last_name || ""}`.trim();
      cancelTexts.push({ kind: "cancel", who: { key: "cancel|" + em, name, phone: normalizePhone(r.phone || "") },
        text: `Hi {first}, DSSC auto-cancelled these classes today - nobody signed up by 10am:\n${lines}\nPlease turn off registration for them in Playbook so nobody signs up. The coaches have been told.`,
        items: toCancel.map(x => ({ clinic: x.c.name, session_id: x.s.id, time: timeRange(x.s) })) });
    }
  }
  let texts = [...(only && only !== "day" ? [] : [...dayTexts, ...cancelTexts]), ...(only && only !== "recap" ? [] : recapTexts)];
  texts = texts.filter(t => { if (!t.who.phone || !/^\+\d{10,15}$/.test(t.who.phone)) { noPhone.add(t.who.name); return false; } return true; });
  if (!force && !test) texts = texts.filter(t => !sentKey.has(t.who.key + "|" + t.kind));

  // ── 3. The directors' email ───────────────────────────────────────────────
  const podsToday = todays.filter(x => isPod(x.c) && !x.s.cancelled && !cancelledKeys.has(keyOf(x.c, x.s))).map(({ c, s }) => ({ c, s, coaches: sessionStaff(s).filter(x => x.status === "approved").map(x => x.name).join(", ") || "NO COACH", players: players(c, s), plan: hasPlan(s), note: noteSent(c, s), written: !!String(s.focus || "").trim() }))
    .sort((a, b) => String(a.s.start_time || "").localeCompare(String(b.s.start_time || "")));
  const podsYesterday = yesterdays.filter(x => isPod(x.c)).map(({ c, s }) => ({ c, s, coaches: sessionStaff(s).filter(x => x.status === "approved").map(x => x.name).join(", ") || "NO COACH", recap: !!String(s.recap || "").trim() }));

  if (dry) return res.status(200).json({ ok: true, dry: true, today, yesterday, texting: twilioReady("dssc"), texts: texts.map(t => ({ kind: t.kind, to: t.who.name, phone: t.who.phone, text: t.text })), unresolved: [...unresolved], noPhone: [...noPhone], podsToday: podsToday.map(p => ({ pod: p.c.name, time: timeRange(p.s), coaches: p.coaches, players: p.players, plan: p.plan, note: p.note })), podsYesterday: podsYesterday.map(p => ({ pod: p.c.name, coaches: p.coaches, recap: p.recap })), regFresh, cancelHold, wouldCancel: toCancel.map(x => ({ class: x.c.name, time: timeRange(x.s) })), emptyButHeld: cancelHold ? empty.map(x => x.c.name + " " + timeRange(x.s)) : [] });
  if (!twilioReady("dssc")) return res.status(500).json({ error: "DSSC texting isn't configured on the server." });

  const results = [];
  for (const t of texts) {
    const body = test ? `[TEST - to ${t.kind === "cancel" ? "" : "Coach "}${t.who.name}]\n` + t.text.replace(/\{first\}/g, t.who.name.split(" ")[0]) : t.text;
    const to = test ? DREW_PHONE : t.who.phone;
    let status = "sent", error = null;
    try { await sendOneSms(sb, { to, brand: "dssc", name: test ? "Drew Rose" : t.who.name, kind: "coach" }, body, { sent_by_label: t.kind === "day" ? "DSSC class-day reminder" : t.kind === "cancel" ? "DSSC auto-cancel" : "DSSC recap reminder" }); }
    catch (e) { status = "failed"; error = e.message; }
    results.push({ kind: t.kind, to: t.who.name, status, error });
    await sb.from("dssc_coach_texts").upsert({ coach_key: t.who.key + (test ? "|test" : ""), coach_name: t.who.name, phone: to, for_date: today, kind: t.kind, items: t.items, body, status, error, is_test: test }, { onConflict: "coach_key,for_date,kind" });
  }

  let emailed = false;
  const directors = (DSSC_PLANNER_EMAILS ? DSSC_PLANNER_EMAILS.split(",") : DIRECTORS_DEFAULT).map(s => s.trim()).filter(Boolean);
  if ((!only || only === "email") && (podsToday.length || podsYesterday.length || toCancel.length || cancelHold) && RESEND_API_KEY && (DSSC_FROM_EMAIL || DSE_FROM_EMAIL) && !sentKey.has("directors|email")) {
    const mark = (ok, label) => `<span style="font-weight:700;color:${ok ? "#0F8B76" : "#d9480f"}">${ok ? "✓" : "✗"} ${label}</span>`;
    const rowsToday = podsToday.map(p => `<tr><td style="padding:6px 8px;border-top:1px solid #e3ebe9"><a href="${classLink(p.c, p.s)}" style="color:#104946;font-weight:700">${esc(p.c.name)}</a><br><span style="color:#667">${esc(timeRange(p.s))}${p.s.court ? " · " + esc(p.s.court) : ""}</span></td><td style="padding:6px 8px;border-top:1px solid #e3ebe9">${esc(p.coaches)}</td><td style="padding:6px 8px;border-top:1px solid #e3ebe9;text-align:center">${p.players}</td><td style="padding:6px 8px;border-top:1px solid #e3ebe9">${mark(p.plan, "Plan")}</td><td style="padding:6px 8px;border-top:1px solid #e3ebe9">${mark(p.note, p.note ? "Sent" : p.written ? "Written, not sent" : "Not sent")}</td></tr>`).join("");
    const rowsYest = podsYesterday.map(p => `<tr><td style="padding:6px 8px;border-top:1px solid #e3ebe9"><a href="${classLink(p.c, p.s, "recap")}" style="color:#104946;font-weight:700">${esc(p.c.name)}</a></td><td style="padding:6px 8px;border-top:1px solid #e3ebe9">${esc(p.coaches)}</td><td style="padding:6px 8px;border-top:1px solid #e3ebe9">${mark(p.recap, p.recap ? "Recap in" : "No recap yet (texted)")}</td></tr>`).join("");
    const th = (h) => `<th style="text-align:left;padding:6px 8px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#0F8B76">${h}</th>`;
    const plansDone = podsToday.filter(p => p.plan).length, notesSent = podsToday.filter(p => p.note).length, recapsIn = podsYesterday.filter(p => p.recap).length;
    const crewOf = (x) => sessionStaff(x.s).filter(y => y.status === "approved").map(y => y.name).join(", ") || "no coach";
    const cancelHtml = toCancel.length
      ? `<div style="border:1px solid #d9480f;border-radius:10px;padding:10px 14px;margin-bottom:18px"><p style="margin:0 0 6px"><b style="color:#d9480f">Auto-cancelled today - nobody signed up by 10am</b></p><ul style="margin:0;padding-left:18px">${toCancel.map(x => `<li>${esc(x.c.name)} - ${esc(timeRange(x.s))} (${esc(crewOf(x))})</li>`).join("")}</ul><p style="margin:8px 0 0">The coaches were texted. <b>Turn off registration for these in Playbook</b> so nobody signs up.</p></div>`
      : cancelHold ? `<div style="border:1px solid #d9480f;border-radius:10px;padding:10px 14px;margin-bottom:18px"><b style="color:#d9480f">Nothing was auto-cancelled:</b> ${esc(cancelHold)}. These show no sign-ups - check them by hand: ${esc(empty.map(x => x.c.name + " " + timeRange(x.s)).join("; "))}</div>` : "";
    const html = `<div style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;color:#191919;max-width:720px">${cancelHtml}
      <p><b>Pods today (${fmtDay(today)})</b> - plans ${plansDone}/${podsToday.length}, parent notes sent ${notesSent}/${podsToday.length}</p>
      ${podsToday.length ? `<table style="border-collapse:collapse;width:100%">${"<tr>" + th("Pod") + th("Coach") + th("Players") + th("Practice plan") + th("Parent note") + "</tr>"}${rowsToday}</table>` : "<p style='color:#667'>No pods today.</p>"}
      <p style="margin-top:22px"><b>Yesterday's pods (${fmtDay(yesterday)})</b> - recaps ${recapsIn}/${podsYesterday.length}</p>
      ${podsYesterday.length ? `<table style="border-collapse:collapse;width:100%">${"<tr>" + th("Pod") + th("Coach") + th("Recap") + "</tr>"}${rowsYest}</table>` : "<p style='color:#667'>No pods yesterday.</p>"}
      <p style="color:#667;margin-top:18px">Coaches on today's classes were texted at 10am with their player counts${podsToday.length ? " and what's still missing" : ""}; pod leads from yesterday were texted for their recap.</p></div>`;
    const from = DSSC_FROM_EMAIL || ("Dripping Springs Sports Club <" + ((DSE_FROM_EMAIL || "").match(/<([^>]+)>/)?.[1] || DSE_FROM_EMAIL) + ">");
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: test ? ["drew@dselitevolleyball.com"] : directors, subject: `${test ? "[TEST] " : ""}${toCancel.length ? toCancel.length + " cancelled (no sign-ups) · " : ""}DSSC pods today: plans ${plansDone}/${podsToday.length}, notes ${notesSent}/${podsToday.length} · recaps ${recapsIn}/${podsYesterday.length}`, html }) }).catch(() => null);
    emailed = !!(r && r.ok);
    if (emailed && !test) await sb.from("dssc_coach_texts").upsert({ coach_key: "directors", coach_name: "DSSC directors", for_date: today, kind: "email", items: { podsToday: podsToday.length, podsYesterday: podsYesterday.length }, status: "sent", is_test: false }, { onConflict: "coach_key,for_date,kind" });
  }

  return res.status(200).json({ ok: true, today, test, cancelled: toCancel.map(x => ({ class: x.c.name, time: timeRange(x.s) })), cancelWrites, cancelHold, sent: results.filter(r => r.status === "sent").length, failed: results.filter(r => r.status !== "sent"), results, emailed, unresolved: [...unresolved], noPhone: [...noPhone] });
}
