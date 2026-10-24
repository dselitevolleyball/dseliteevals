// Telling the directors (settings.notify_emails) when publishing goes wrong,
// before and after:
//
//   metaHeadsUp     an approved Facebook / Instagram item is due in the next
//                   24 hours but the Meta connection can't post (checked at
//                   most every 6 hours) → one email a day naming the items,
//                   with the Reconnect link, so it's fixed before they fail.
//   failureAlert    items that just failed to publish → one email per cron
//                   run listing each with Facebook's / Resend's reason.
//
// Both log to mkt_log (meta_health, meta_alert, failure_alert).

import { sendResend, dsscFrom, isEmailish, esc } from "./site-inbox.js";
import { metaCheck } from "./marketing-publish.js";
import { log, HQ_MARKETING_URL } from "./marketing-core.js";
import { fmtDay, lineLabel, KIND_LABEL } from "../../shared/marketing-plan.js";
import { kindOf } from "./marketing-ai.js";

const SETTINGS_URL = HQ_MARKETING_URL() + "&mtab=settings";
const META_PLATFORMS = ["facebook", "instagram", "instagram_story", "facebook_story"];
const isMetaError = (e) => /permission|token|session|oauth|impersonat|#200|#190|#10\b/i.test(String(e || ""));
const ct = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const what = (i) => `${KIND_LABEL[kindOf(i)] || i.channel} · ${lineLabel(i.line)} · ${i.channel === "email" ? i.email_subject || i.headline : i.headline || "(no headline)"}`;
const wrap = (inner) => `<div style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#061a18;max-width:640px">${inner}</div>`;
const button = (href, label) => `<p style="margin:18px 0"><a href="${href}" style="display:inline-block;background:#B2D049;color:#061a18;padding:11px 20px;text-decoration:none;font-weight:700">${esc(label)} →</a></p>`;
const recently = async (sb, kind, hours) => { const { data } = await sb.from("mkt_log").select("id, detail, at").eq("kind", kind).gte("at", new Date(Date.now() - hours * 3600e3).toISOString()).order("at", { ascending: false }).limit(1); return data?.[0] || null; };

export async function metaHeadsUp(sb, settings, { now = new Date(), dry = false, check = metaCheck } = {}) {
  const soon = new Date(now.getTime() + 24 * 3600e3).toISOString();
  const { data } = await sb.from("mkt_items").select("id, channel, kind, line, headline, platforms, scheduled_at").eq("status", "approved").eq("channel", "social").gte("scheduled_at", now.toISOString()).lte("scheduled_at", soon).order("scheduled_at");
  const due = (data || []).filter(i => (i.platforms || []).some(p => META_PLATFORMS.includes(p)));
  if (!due.length) return { due: 0 };
  // The connection is checked at most every 6 hours.
  const last = await recently(sb, "meta_health", 6);
  let health = last?.detail;
  if (!health) {
    const c = await check().catch(e => ({ ok: false, problems: [e.message] }));
    health = { ok: !!c.ok, problems: c.problems || [] };
    if (!dry) await log(sb, null, "meta_health", health);
  }
  if (health.ok) return { due: due.length, ok: true };
  if (await recently(sb, "meta_alert", 20)) return { due: due.length, ok: false, alerted: "in the last 20 hours" };
  const to = (settings.notify_emails || []).filter(isEmailish);
  if (!to.length) return { due: due.length, ok: false, error: "nobody to tell" };
  if (dry) return { due: due.length, ok: false, would_email: to };
  const n = due.length;
  const subject = `Facebook is disconnected — ${n} approved post${n === 1 ? "" : "s"} due in the next 24 hours will fail`;
  const html = wrap(`<p style="margin:0 0 10px"><b>HQ can't post to Facebook / Instagram right now</b>, and ${n === 1 ? "this approved post is" : `these ${n} approved posts are`} due soon:</p>
<ul style="margin:0 0 10px;padding-left:20px">${due.map(i => `<li>${esc(ct(i.scheduled_at))} — ${esc(what(i))}</li>`).join("")}</ul>
<p style="margin:0 0 6px;color:#555">What Facebook says: ${esc(health.problems.join(" · ") || "unknown")}</p>
<p style="margin:0">Reconnect in HQ → Marketing → Settings → Facebook &amp; Instagram → Reconnect (about 2 minutes). They'll go out on time once it's fixed.</p>${button(SETTINGS_URL, "Reconnect in HQ")}`);
  const text = `HQ can't post to Facebook / Instagram right now, and ${n} approved post${n === 1 ? " is" : "s are"} due in the next 24 hours:\n\n${due.map(i => `- ${ct(i.scheduled_at)} — ${what(i)}`).join("\n")}\n\nWhat Facebook says: ${health.problems.join(" · ")}\n\nReconnect: ${SETTINGS_URL}`;
  const r = await sendResend({ from: dsscFrom(), to, subject, html, text });
  await log(sb, null, "meta_alert", { to, items: due.map(i => i.id), ok: r.ok, error: r.error || null });
  return { due: n, ok: false, emailed: r.ok, error: r.error || null };
}

// results: what publishItem returned this run.
export async function failureAlert(sb, settings, results, { dry = false } = {}) {
  const failed = (results || []).filter(r => r.status === "failed" || r.status === "error");
  if (!failed.length) return null;
  const to = (settings.notify_emails || []).filter(isEmailish);
  if (!to.length) return { failed: failed.length, error: "nobody to tell" };
  const { data } = await sb.from("mkt_items").select("id, channel, kind, line, headline, email_subject, scheduled_at, error, week_of").in("id", failed.map(r => r.id));
  const items = (data || []).map(i => ({ ...i, error: failed.find(r => r.id === i.id)?.error || i.error }));
  if (dry) return { failed: items.length, would_email: to };
  const meta = items.some(i => isMetaError(i.error));
  const n = items.length;
  const subject = `${n} marketing item${n === 1 ? "" : "s"} didn't go out${meta ? " — Facebook needs reconnecting" : ""}`;
  const week = items.map(i => i.week_of).filter(Boolean).sort()[0];
  const html = wrap(`<p style="margin:0 0 10px"><b>${n === 1 ? "This didn't" : `These ${n} didn't`} publish:</b></p>
<ul style="margin:0 0 10px;padding-left:20px">${items.map(i => `<li>${esc(ct(i.scheduled_at))} — ${esc(what(i))}<br><span style="color:#a33">${esc(String(i.error || "unknown error").slice(0, 400))}</span></li>`).join("")}</ul>
${meta ? `<p style="margin:0">Facebook / Instagram need reconnecting: HQ → Marketing → Settings → Facebook &amp; Instagram → Reconnect. Then open the item on the Calendar and publish it again.</p>${button(SETTINGS_URL, "Reconnect in HQ")}` : `<p style="margin:0">Open it on the Calendar to fix and publish it again.</p>${button(HQ_MARKETING_URL(week), "Open the Calendar")}`}`);
  const text = `${n === 1 ? "This didn't" : `These ${n} didn't`} publish:\n\n${items.map(i => `- ${ct(i.scheduled_at)} — ${what(i)}\n  ${i.error || "unknown error"}`).join("\n")}\n\n${meta ? "Reconnect Facebook: " + SETTINGS_URL : "Open HQ: " + HQ_MARKETING_URL(week)}`;
  const r = await sendResend({ from: dsscFrom(), to, subject, html, text });
  await log(sb, null, "failure_alert", { to, items: items.map(i => i.id), ok: r.ok, error: r.error || null });
  return { failed: n, emailed: r.ok, error: r.error || null };
}
