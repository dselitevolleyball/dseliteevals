// DSSC People -> Campaigns (Drew, Oct 29 2026: "quickly group, segment, craft
// AI generated campaigns that feed the marketing calendar", "rebound
// campaigns and offers like come back and try a class 50% off").
//
// A campaign is an audience (a segment - shared/crm-segments.js), a goal, an
// offer and a few steps over a week or two, e.g.
//   day 0  email   everyone                 "Come back: 50% off your next class"
//   day 3  text    hasn't booked yet        a short nudge with the code
//   day 7  email   hasn't booked yet        last call
// Claude writes every step from the offer, the audience and the club's voice
// (mkt_settings). Scheduling puts each step on the Marketing calendar as an
// ordinary draft (a dedicated email, or a text) tied to the campaign
// (mkt_items.crm_campaign_id), so it's approved and sent exactly like any
// other marketing item - nothing goes out from here. A follow-up step's
// audience drops anyone who has booked since the campaign started
// (segment.notSince), re-checked when it sends.
//
// Results: who it reached (email sends, texts), replies, and who booked
// within 45 days of the start (purchases and sign-ups by the families it was
// planned for) and what they spent.

import { claudeClient } from "./ai-client.js";
import { AI_MODEL, pickPhoto, buildEmail, smsBody, ctIso, flairText } from "./marketing-ai.js";
import { loadPhotos } from "./marketing-core.js";
import { weekStartOf, lineUrl, LINE_KEYS } from "../../shared/marketing-plan.js";
import { rulesText } from "../../shared/marketing-rules.js";
import { loadSegmentData, buildFamilies, resolveSegment, resolveSegmentPhones, describeSegment, EMPTY_SEGMENT } from "../../shared/crm-segments.js";
import { offerText, GOALS } from "../../shared/crm-ideas.js";

const fail = (status, msg) => Object.assign(new Error(msg), { status });
const ctToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const addDays = (ymd, n) => new Date(Date.parse(ymd + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

// The program area a campaign is about (for the link, the photo and the calendar color).
export function lineFor(c) {
  if (c.line && LINE_KEYS.includes(c.line)) return c.line;
  const g = c.goal, seg = c.segment || {};
  const prods = [...(seg.products || []), ...(seg.noProducts || [])].join(" ");
  if (g === "parties") return "parties";
  if (g === "rentals") return "rentals";
  if (g === "camps") return "camp_elevate";
  if (g === "membership" || /open_gym/.test(prods)) return "open_gym";
  if (/reach/.test(prods) && g === "try_new") return "reach";
  if (g === "try_new" && (seg.noProducts || []).includes("basketball")) return "basketball";
  if (g === "try_new" && (seg.noProducts || []).includes("volleyball")) return "volleyball";
  if (g === "privates") return "volleyball";
  return "club";
}

export const CADENCES = {
  one: [{ day: 0, channel: "email", who: "everyone" }],
  two: [{ day: 0, channel: "email", who: "everyone" }, { day: 3, channel: "text", who: "not_booked" }],
  three: [{ day: 0, channel: "email", who: "everyone" }, { day: 3, channel: "text", who: "not_booked" }, { day: 7, channel: "email", who: "not_booked" }],
  text: [{ day: 0, channel: "text", who: "everyone" }],
};

const STEP = { type: "object", additionalProperties: false, required: ["day", "channel", "who", "subject", "preheader", "headline", "accent", "tag", "body", "cta_text", "sms"],
  properties: { day: { type: "integer" }, channel: { type: "string", enum: ["email", "text"] }, who: { type: "string", enum: ["everyone", "not_booked"] },
    subject: { type: "string" }, preheader: { type: "string" }, headline: { type: "string" }, accent: { type: "string" }, tag: { type: "string" },
    body: { type: "string" }, cta_text: { type: "string" }, sms: { type: "string" } } };
const DRAFT_SCHEMA = { type: "object", additionalProperties: false, required: ["name", "steps"], properties: { name: { type: "string" }, steps: { type: "array", items: STEP } } };

const SYSTEM = `You write marketing campaigns for Dripping Springs Sports Club (DSSC) - volleyball, basketball, Reach Performance training, open gym, birthday parties, camps and court rentals, in Warehouse I and II in Dripping Springs, Texas. "Where Dripping Springs plays." The readers are parents.

Each campaign goes to one audience with one offer, in a few steps:
- email: subject (under 50 characters, no emoji, not salesy-shouty), preheader (under 90), headline (2-5 punchy words for the big type), accent (one word from the headline to color), tag (1-3 words, e.g. "COME BACK", "MEMBERS", "NEW"), body (2-4 short paragraphs, warm and specific, plain text, no links, no lists of prices), cta_text (2-4 words on the button). sms = "".
- text: sms only (under 230 characters before the link; plain characters; may use {parent_first} and {player_first}; no link, no "reply STOP" - both are added). Other fields "".
Rules:
- The offer is exactly as given: same amount, same code, same end date. Never invent a discount, a price, a date, a coach or a program.
- Speak to who they are (the audience description): a family who hasn't been in for months reads differently from a VIP family.
- A step for "not_booked" is a follow-up: shorter, assumes they saw the first message, adds urgency only from the real end date.
- Never name a child. No ALL CAPS sentences. At most one emoji per email body and per text.`;

async function loadVoice(sb) {
  const { data } = await sb.from("mkt_settings").select("voice, flair, rules").limit(1).maybeSingle();
  return data || {};
}

// What the campaign is for, in words Claude (and a director) can read.
function brief(c, audience) {
  const goal = (GOALS.find(g => g[0] === c.goal) || [c.goal, c.goal])[1];
  const o = offerText(c.offer || {});
  return `Campaign goal: ${goal}.
Audience: ${audience.label} - ${audience.families} families (${audience.emailable} by email, ${audience.textable} by text).${audience.notes ? "\nAbout them: " + audience.notes : ""}
Offer: ${o || "no discount - an invitation"}${c.offer?.applies_to ? "" : ""}.${c.offer?.url ? "\nLink: " + c.offer.url : ""}
Program area: ${c.line}.${c.notes ? "\nDirector's notes: " + c.notes : ""}`;
}

// Claude writes the steps. -> { name, steps, model, error }
export async function draftCampaign(sb, c, audience, { timeoutMs = 100000 } = {}) {
  const cadence = CADENCES[c.cadence] || CADENCES.two;
  const steps = cadence.filter(s => (c.channels || ["email", "text"]).includes(s.channel));
  if (!steps.length) throw fail(400, "Pick email, text or both");
  const v = await loadVoice(sb);
  const ask = `${brief(c, audience)}

Write these steps, in this order:
${steps.map((s, i) => `${i + 1}. day ${s.day}, ${s.channel}, to ${s.who === "everyone" ? "everyone in the audience" : "those who haven't booked yet"}`).join("\n")}
Also give the campaign a short internal name (e.g. "Come back - fall classes").`;
  if (!process.env.ANTHROPIC_API_KEY) return { ...templateDraft(c, steps), error: "ANTHROPIC_API_KEY isn't set - plain template copy" };
  const client = claudeClient("crm-campaign", { timeout: timeoutMs, maxRetries: 1 });
  const msg = await client.beta.messages.create({
    model: AI_MODEL, max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: DRAFT_SCHEMA } },
    system: [{ type: "text", text: SYSTEM }, { type: "text", text: `${flairText(v.flair ?? 1)}\n${rulesText(v.rules || []) || ""}\n${v.voice ? "Voice notes from the directors:\n" + String(v.voice).slice(0, 3000) : ""}` }],
    messages: [{ role: "user", content: ask }],
  }).catch(e => ({ error: e.message }));
  if (msg.error || msg.stop_reason === "refusal" || msg.stop_reason === "max_tokens") return { ...templateDraft(c, steps), error: msg.error || "Claude didn't finish - plain template copy" };
  let j = null;
  try { j = JSON.parse((msg.content || []).filter(b => b.type === "text").map(b => b.text).join("")); } catch { /* fall through */ }
  if (!j?.steps?.length) return { ...templateDraft(c, steps), error: "Couldn't read Claude's answer - plain template copy" };
  // Keep the cadence's days/channels/audiences whatever came back; take the words.
  const out = steps.map((s, i) => ({ ...clean(j.steps[i] || {}), day: s.day, channel: s.channel, who: s.who }));
  return { name: String(j.name || c.name || "Campaign").slice(0, 80), steps: out, model: msg.model };
}
const clean = (x) => Object.fromEntries(["subject", "preheader", "headline", "accent", "tag", "body", "cta_text", "sms"].map(k => [k, String(x[k] || "").trim()]));
function templateDraft(c, steps) {
  const o = offerText(c.offer || {});
  return { name: c.name || "Campaign", steps: steps.map(s => s.channel === "email"
    ? { ...s, subject: s.who === "everyone" ? "Something for your family at DSSC" : "Last call", preheader: o, headline: "We saved you a spot", accent: "spot", tag: "FOR YOU", body: `We'd love to see you back at DSSC.${o ? "\n\nFor you: " + o + "." : ""}`, cta_text: "Book now", sms: "" }
    : { ...s, subject: "", preheader: "", headline: "", accent: "", tag: "", body: "", cta_text: "", sms: `Hi {parent_first}! ${o ? "DSSC has " + o + " for you." : "We'd love to see you back at DSSC."}` }) };
}

// The audience right now -> counts, ids and a description.
export async function audienceOf(sb, segment) {
  const index = buildFamilies(await loadSegmentData(sb), ctToday());
  const emails = resolveSegment(index, segment), texts = resolveSegmentPhones(index, segment);
  const ids = [...new Set([...index.fams.values()].filter(f => emails.recipients.some(r => r.contact_id === f.c.id) || texts.recipients.some(r => r.contact_id === f.c.id)).map(f => f.c.id))];
  return { families: emails.matched, emailable: emails.recipients.length, textable: texts.recipients.length, ids, label: describeSegment(segment) };
}

// Put the steps on the Marketing calendar as drafts. -> the campaign row
export async function scheduleCampaign(sb, camp, { by, startsOn } = {}) {
  if (!["draft", "scheduled", "live"].includes(camp.status)) throw fail(400, `This campaign is ${camp.status}`);
  if (!(camp.steps || []).length) throw fail(400, "Write the steps first");
  // A step that has already gone out stays as it is (and so does the start
  // date the follow-ups count from); the rest are replaced.
  const { data: had } = await sb.from("mkt_items").select("id, status").eq("crm_campaign_id", camp.id);
  const sent = new Map((had || []).filter(i => ["publishing", "published"].includes(i.status)).map(i => [i.id, i]));
  const start = sent.size && camp.starts_on ? camp.starts_on : startsOn || camp.starts_on || ctToday();
  if (!sent.size && start < ctToday()) throw fail(400, "The start date has passed");
  const seg = { ...EMPTY_SEGMENT, ...(camp.segment || {}) };
  const aud = await audienceOf(sb, seg);
  if (!aud.families) throw fail(400, "Nobody is in this audience");
  await removeItems(sb, camp, { onlyUnsent: true });
  const line = camp.offer?.line || lineFor(camp);
  const url = camp.offer?.url || lineUrl(line);
  const photos = await loadPhotos(sb).catch(() => []);
  const used = new Set();
  const stepSeg = (s) => s.who === "not_booked" ? { ...seg, notSince: start, notSinceCats: camp.offer?.cats || [] } : seg;
  const todo = (camp.steps || []).map((s, i) => [s, i]).filter(([s]) => !sent.has(s.item_id));
  const rows = todo.map(([s, i]) => {
    const day = addDays(start, Number(s.day) || 0);
    const base = { week_of: weekStartOf(day), line, programs: [], status: "draft", created_by: by || "crm", reason: `Campaign: ${camp.name}`, angle: "campaign", theme: "campaign",
      crm_campaign_id: camp.id, platforms: [], hashtags: [], email_subject: null, email_preheader: null, email_html: null, email_blocks: [], cta_url: url, graphic: null };
    if (s.channel === "text") return { ...base, channel: "sms", kind: "text", scheduled_at: ctIso(day, "10:30"), headline: s.headline || camp.name, body: smsBody(s.sms, url), audience: { target: "crm", segment: stepSeg(s), crm_campaign_id: camp.id } };
    const photo = pickPhoto(photos, line, { used, seed: camp.id + ":" + i, format: "email" });
    if (photo) used.add(photo.url);
    const graphic = { template: "photo", format: "email", photo_url: photo?.url || null, photo_key: photo?.key || null, headline: s.headline, accent: s.accent, sub: offerText(camp.offer || {}).slice(0, 60), tag: s.tag, date_label: "", items: [] };
    const row = { ...base, channel: "email", kind: "dedicated", scheduled_at: ctIso(day, "07:30"), headline: s.headline, body: s.body, cta_text: s.cta_text || "Book now",
      email_subject: s.subject, email_preheader: s.preheader, graphic, audience: { segment: stepSeg(s), crm_campaign_id: camp.id } };
    row.email_html = buildEmail({ ...row }).html;
    return row;
  });
  const { data: items, error } = rows.length ? await sb.from("mkt_items").insert(rows).select("id, channel, scheduled_at") : { data: [] };
  if (error) throw fail(500, "Adding to the calendar: " + error.message);
  const made = new Map(todo.map(([, i], k) => [i, items[k]]));
  const steps = camp.steps.map((s, i) => made.has(i) ? { ...s, item_id: made.get(i)?.id || null, at: made.get(i)?.scheduled_at || null } : s);
  const { data: row, error: e2 } = await sb.from("crm_campaigns").update({ status: sent.size ? "live" : "scheduled", starts_on: start, steps, item_ids: steps.map(s => s.item_id).filter(Boolean), audience_ids: aud.ids, audience_count: aud.families, audience_label: aud.label, updated_at: new Date().toISOString() }).eq("id", camp.id).select().single();
  if (e2) throw fail(500, e2.message);
  return row;
}

// Take a campaign's steps off the calendar (only ones not sent yet).
export async function removeItems(sb, camp, { onlyUnsent = true } = {}) {
  const { data } = await sb.from("mkt_items").select("id, status").eq("crm_campaign_id", camp.id);
  const drop = (data || []).filter(i => !onlyUnsent || !["publishing", "published"].includes(i.status)).map(i => i.id);
  if (drop.length) await sb.from("mkt_items").delete().in("id", drop);
  return drop.length;
}

// What happened. -> { steps: [{ item status, sent, replies }], booked, revenue, families: [{ id, name, what, cents }] }
export async function campaignResults(sb, camp) {
  const { data: items } = await sb.from("mkt_items").select("id, channel, status, scheduled_at, published_at, external_ids, sms_campaign_id, error").eq("crm_campaign_id", camp.id);
  const smsIds = (items || []).map(i => i.sms_campaign_id).filter(Boolean);
  const { data: sms } = smsIds.length ? await sb.from("sms_campaigns").select("id, status, sent_count, failed_count, recipient_count").in("id", smsIds) : { data: [] };
  const steps = (items || []).map(i => {
    const sc = (sms || []).find(x => x.id === i.sms_campaign_id);
    return { item_id: i.id, channel: i.channel, status: i.status, at: i.published_at || i.scheduled_at, sent: i.channel === "sms" ? (sc?.sent_count ?? null) : (i.external_ids?.email?.sent ?? i.external_ids?.sent ?? null), error: i.error || null };
  });
  // Replies to the campaign's texts.
  let replies = 0;
  if (smsIds.length) {
    const { data: rec } = await sb.from("sms_campaign_recipients").select("phone, sent_at").in("campaign_id", smsIds).not("sent_at", "is", null);
    const phones = [...new Set((rec || []).map(r => r.phone))];
    const since = (rec || []).map(r => r.sent_at).sort()[0];
    if (phones.length && since) {
      const { data: th } = await sb.from("sms_threads").select("id, phone").eq("brand", "dssc").in("phone", phones.slice(0, 500));
      if (th?.length) { const { count } = await sb.from("sms_messages").select("id", { count: "exact", head: true }).in("thread_id", th.map(t => t.id)).eq("direction", "inbound").gte("created_at", since); replies = count || 0; }
    }
  }
  // Bookings by the planned audience within 45 days of the start.
  const ids = camp.audience_ids || [];
  const from = camp.starts_on, to = from ? addDays(from, 45) : null;
  let booked = [], revenue = 0;
  if (ids.length && from) {
    const chunks = []; for (let i = 0; i < ids.length; i += 300) chunks.push(ids.slice(i, i + 300));
    const buys = [], parts = [];
    for (const ch of chunks) {
      const [{ data: b }, { data: p }] = await Promise.all([
        sb.from("dssc_purchases").select("contact_id, program, amount_cents, purchased_at").in("contact_id", ch).gte("purchased_at", from).lte("purchased_at", to + "T23:59:59"),
        sb.from("dssc_participation").select("contact_id, program, created_at").in("contact_id", ch).gte("created_at", from).lte("created_at", to + "T23:59:59"),
      ]);
      buys.push(...(b || [])); parts.push(...(p || []));
    }
    const by = new Map();
    for (const b of buys) { const e = by.get(b.contact_id) || { id: b.contact_id, what: new Set(), cents: 0 }; e.what.add(b.program); e.cents += b.amount_cents || 0; by.set(b.contact_id, e); }
    for (const p of parts) { const e = by.get(p.contact_id) || { id: p.contact_id, what: new Set(), cents: 0 }; e.what.add(p.program); by.set(p.contact_id, e); }
    const { data: names } = by.size ? await sb.from("dssc_contacts").select("id, first_name, last_name, email").in("id", [...by.keys()].slice(0, 300)) : { data: [] };
    booked = [...by.values()].map(e => { const n = (names || []).find(x => x.id === e.id); return { id: e.id, name: n ? [n.first_name, n.last_name].filter(Boolean).join(" ") || n.email : "#" + e.id, what: [...e.what].filter(Boolean).slice(0, 3), cents: e.cents }; }).sort((a, b) => b.cents - a.cents);
    revenue = booked.reduce((s, e) => s + e.cents, 0);
  }
  return { steps, replies, booked: booked.length, revenue, families: booked.slice(0, 50), audience: ids.length, window: from ? { from, to } : null };
}
