// The Marketing Machine's shared server plumbing (api/marketing.js and
// api/marketing-cron.js): settings, priorities, history, the programs feed,
// the photo library sync, generating a week of drafts, and the "drafts are
// ready" digest email.

import { createClient } from "@supabase/supabase-js";
import { planWeek, signalsFor, lineOf, programRef, mondayOf, addDays, fmtDay, lineLabel, LINE_KEYS, DEFAULT_WEIGHTS, DEFAULT_CADENCE } from "../../shared/marketing-plan.js";
import { composeItems, ctToday, ctIso } from "./marketing-ai.js";
import { sendResend, dsscFrom, isEmailish, esc } from "./site-inbox.js";
import { EMPTY_FILTERS } from "../../shared/campaign-audience.js";

export const PROGRAMS_URL = () => process.env.MARKETING_PROGRAMS_URL || "https://www.drippingsportsclub.com/api/programs";
export const PHOTOS_URL = () => process.env.MARKETING_PHOTOS_URL || "https://www.drippingsportsclub.com/photos.json";
export const HQ_MARKETING_URL = (week) => `https://www.drippingsportsclub.com/hq/?view=dsscmarketing${week ? `&week=${week}` : ""}`;

export function serviceSb() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
export const log = (sb, item_id, kind, detail = {}) => sb.from("mkt_log").insert({ item_id, kind, detail }).then(() => {}, () => {});

// ── settings / priorities / history ──────────────────────────────────────────
export const SETTINGS_DEFAULTS = {
  id: 1, voice: "", weights: DEFAULT_WEIGHTS, cadence: DEFAULT_CADENCE, auto_generate: true, generate_day: "sun",
  email_audience: { source: "dssc_contacts" }, sms_filters: {}, notify_emails: ["drew@drippingsportsclub.com"],
};
export async function loadSettings(sb) {
  const { data, error } = await sb.from("mkt_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw new Error("mkt_settings: " + error.message + " (has migrations/20261022_marketing.sql been run?)");
  const s = { ...SETTINGS_DEFAULTS, ...(data || {}) };
  s.weights = { ...DEFAULT_WEIGHTS, ...(s.weights || {}) };
  s.cadence = { social: { ...DEFAULT_CADENCE.social, ...(s.cadence?.social || {}) }, email: { ...DEFAULT_CADENCE.email, ...(s.cadence?.email || {}) }, sms: { ...DEFAULT_CADENCE.sms, ...(s.cadence?.sms || {}) } };
  return s;
}
export async function loadPriorities(sb) {
  const { data, error } = await sb.from("mkt_priorities").select("*").order("active", { ascending: false }).order("starts_on", { ascending: true, nullsFirst: true }).order("id");
  if (error) throw new Error("mkt_priorities: " + error.message);
  return data || [];
}
// Items from the 4 weeks before `weekOf` - what the planner calls history.
export async function loadHistory(sb, weekOf) {
  const { data, error } = await sb.from("mkt_items").select("week_of, channel, line, status, scheduled_at")
    .gte("week_of", addDays(weekOf, -28)).lt("week_of", weekOf).neq("status", "rejected");
  if (error) throw new Error("mkt_items: " + error.message);
  return data || [];
}
export async function loadPhotos(sb) {
  const { data } = await sb.from("mkt_photos").select("id, url, key, tags, line, alt, width, height, active, used_count, last_used_at").eq("active", true).limit(2000);
  return data || [];
}

// ── programs feed (5-minute memo per warm function) ──────────────────────────
let feedMemo = { at: 0, data: null };
export async function fetchPrograms({ fresh = false } = {}) {
  if (!fresh && feedMemo.data && Date.now() - feedMemo.at < 5 * 60e3) return feedMemo.data;
  const r = await fetch(PROGRAMS_URL(), { headers: { Accept: "application/json" } });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok || !Array.isArray(j.programs)) {
    if (feedMemo.data) return feedMemo.data;
    throw new Error(`The programs feed didn't answer (HTTP ${r.status})`);
  }
  feedMemo = { at: Date.now(), data: j };
  return j;
}

// ── photo library ────────────────────────────────────────────────────────────
// photos.json -> mkt_photos. New photos are added; rows a director already
// edited (tags, line, active) are left alone.
export async function syncPhotos(sb, { dry = false } = {}) {
  const r = await fetch(PHOTOS_URL(), { headers: { Accept: "application/json" } }).catch(e => ({ ok: false, status: e.message }));
  const j = r.ok ? await r.json().catch(() => null) : null;
  if (!j || !Array.isArray(j.photos)) return { ok: false, added: 0, total: 0, error: `photos.json isn't available (${r.status || "not JSON"})` };
  const rows = j.photos.filter(p => p && /^https:\/\//.test(p.url || "")).map(p => ({
    url: p.url, source: "site", key: p.key || null, tags: Array.isArray(p.tags) ? p.tags.map(String) : [],
    line: LINE_KEYS.includes(p.line) ? p.line : null, alt: p.alt || null, width: Number(p.width) || null, height: Number(p.height) || null,
  }));
  const { data: have } = await sb.from("mkt_photos").select("url").in("url", rows.map(r => r.url).slice(0, 1000));
  const known = new Set((have || []).map(r => r.url));
  const fresh = rows.filter(r => !known.has(r.url));
  if (!dry && fresh.length) {
    const { error } = await sb.from("mkt_photos").upsert(fresh, { onConflict: "url", ignoreDuplicates: true });
    if (error) return { ok: false, added: 0, total: rows.length, error: error.message };
  }
  if (!dry) await log(sb, null, "photos_sync", { added: fresh.length, total: rows.length });
  return { ok: true, added: fresh.length, total: rows.length, dry };
}

// ── generate a week ──────────────────────────────────────────────────────────
// A draft nobody has touched: still a draft, never revised, no graphic
// rendered, not edited since it was made.
const untouched = (it) => it.status === "draft" && !(it.revisions || []).length && !it.asset_url
  && Math.abs(new Date(it.updated_at) - new Date(it.created_at)) < 3000;

// opts: { weekOf, replaceDrafts, instruction, by, single: { program_id?, line?, channel? }, timeoutMs }
// -> { items (created rows), kept, removed, ai, notes, plan }
export async function generateWeek(sb, { weekOf, replaceDrafts = false, instruction = "", by = "auto", single = null, timeoutMs } = {}) {
  weekOf = mondayOf(weekOf);
  if (!weekOf) throw new Error("week_of must be a date (YYYY-MM-DD)");
  const today = ctToday();
  if (addDays(weekOf, 6) < today) throw new Error("That week is over");
  const [feed, settings, priorities, history, photos] = await Promise.all([fetchPrograms(), loadSettings(sb), loadPriorities(sb), loadHistory(sb, weekOf), loadPhotos(sb)]);
  const { data: existing, error: exErr } = await sb.from("mkt_items").select("id, channel, scheduled_at, status, revisions, asset_url, created_at, updated_at").eq("week_of", weekOf).neq("status", "rejected");
  if (exErr) throw new Error("mkt_items: " + exErr.message);
  let keep = existing || [];
  let removed = 0;
  if (replaceDrafts && !single) {
    const drop = keep.filter(untouched).map(i => i.id);
    if (drop.length) {
      const { error } = await sb.from("mkt_items").delete().in("id", drop).eq("status", "draft");
      if (error) throw new Error("Removing old drafts: " + error.message);
      removed = drop.length;
      keep = keep.filter(i => !drop.includes(i.id));
    }
  }
  const dayOf = (iso) => iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }) : null;
  const taken = new Set(keep.map(i => i.channel === "social" ? `social:${dayOf(i.scheduled_at)}` : i.channel));
  const plan = planWeek({ weekOf, programs: feed.programs, priorities, settings, history, today: today > weekOf ? today : null });
  let slots;
  if (single) {
    slots = [singleSlot({ weekOf, today, feed, settings, single, instruction, taken })];
  } else {
    slots = plan.slots.filter(s => !taken.has(s.channel === "social" ? `social:${s.day}` : s.channel));
  }
  if (!slots.length) return { items: [], kept: keep.length, removed, ai: null, notes: [...plan.notes, "Nothing new to add - every planned slot already has an item"], plan };
  const { rows, ai } = await composeItems({ slots, weekOf, programs: feed.programs, priorities, settings, photos, instruction, by, timeoutMs });
  const { data: created, error } = await sb.from("mkt_items").insert(rows).select("*");
  if (error) throw new Error("Saving drafts: " + error.message);
  await log(sb, null, by === "auto" ? "auto_generate" : "generate", { week_of: weekOf, created: (created || []).length, removed, kept: keep.length, ai: { used: ai.used, model: ai.model, error: ai.error, fallbacks: ai.fallbacks }, instruction: instruction || null, single: single || null, by });
  return { items: created || [], kept: keep.length, removed, ai, notes: plan.notes, plan };
}

// One requested draft ("Make a post" on the Plan tab).
function singleSlot({ weekOf, today, feed, settings, single, instruction, taken }) {
  const channel = ["social", "email", "sms"].includes(single.channel) ? single.channel : "social";
  const p = single.program_id ? feed.programs.find(x => String(x.id) === String(single.program_id)) : null;
  const line = p ? lineOf(p) : (LINE_KEYS.includes(single.line) ? single.line : "club");
  const ref = today > weekOf ? today : weekOf;
  const sig = p ? signalsFor([p], ref)[0] : null;
  const DAY = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const cad = settings.cadence || DEFAULT_CADENCE;
  const cands = channel === "social" ? (cad.social?.days || DEFAULT_CADENCE.social.days).map(d => addDays(weekOf, DAY.indexOf(d))).filter(d => d >= today) : [];
  const day = cands.find(d => !taken.has(`social:${d}`)) || cands[0] || (today > weekOf ? today : weekOf);
  const time = channel === "social" ? cad.social?.time || "18:30" : channel === "email" ? cad.email?.time || "07:30" : cad.sms?.time || "17:30";
  return {
    channel, platforms: channel === "social" ? ["facebook", "instagram"] : undefined, day, time, line,
    program: programRef(p), programs: channel === "email" && p ? [{ ...programRef(p), angle: sig?.angle || "evergreen" }] : channel === "email" ? [] : undefined,
    angle: sig?.angle || "evergreen",
    reason: [`Requested by a director`, String(instruction || "").trim() ? `"${String(instruction).trim().slice(0, 140)}"` : null, sig?.reason].filter(Boolean).join(" · "),
  };
}

// ── digest to the directors ──────────────────────────────────────────────────
export async function sendDigest(sb, settings, weekOf, items) {
  const to = (settings.notify_emails || []).filter(isEmailish);
  if (!to.length || !items.length) return { ok: false, error: "nobody to tell" };
  const link = HQ_MARKETING_URL(weekOf);
  const label = { social: "Post", email: "Email", sms: "Text" };
  const rows = items.slice().sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)))
    .map(i => [fmtDay(new Date(i.scheduled_at).toLocaleDateString("en-CA", { timeZone: "America/Chicago" })), label[i.channel] || i.channel, lineLabel(i.line), i.channel === "email" ? i.email_subject : i.headline]);
  const subject = `${items.length} marketing draft${items.length === 1 ? "" : "s"} ready for the week of ${fmtDay(weekOf)} — approve in HQ`;
  const html = `<div style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#061a18;max-width:640px">
<p style="margin:0 0 10px"><b>${esc(items.length)} drafts are ready</b> for the week of ${esc(fmtDay(weekOf))}. Nothing goes out until a director approves it.</p>
<table style="border-collapse:collapse;font-size:14px">${rows.map(r => `<tr>${r.map((c, j) => `<td style="padding:3px 12px 3px 0;${j < 3 ? "color:#104946;white-space:nowrap" : ""}">${esc(c)}</td>`).join("")}</tr>`).join("")}</table>
<p style="margin:18px 0"><a href="${link}" style="display:inline-block;background:#B2D049;color:#061a18;padding:11px 20px;text-decoration:none;font-weight:700">Review and approve in HQ →</a></p></div>`;
  const text = `${items.length} drafts are ready for the week of ${fmtDay(weekOf)}. Nothing goes out until a director approves it.\n\n${rows.map(r => r.join(" · ")).join("\n")}\n\nReview and approve in HQ: ${link}`;
  const r = await sendResend({ from: dsscFrom(), to, subject, html, text });
  await log(sb, null, "digest", { week_of: weekOf, to, ok: r.ok, error: r.error || null });
  return r;
}

export { ctToday, ctIso, EMPTY_FILTERS };
