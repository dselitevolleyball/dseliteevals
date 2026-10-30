// Claude's read of a DS Elite stock photo (HQ -> Social -> Stock photos).
//
// Drew, Oct 30 2026: "can you do an ai analysis of the photo to use when
// creating social media posts and choosing pictures for the website?"
//
// One call per photo, looking at the public 2400px JPEG. The answer is saved on
// dse_social_stock.ai and used by:
//   - idea / "Your idea" graphics (dse-social-ideas.js cardPool): social_ok
//     false never goes out; better social_score first; focal_x/y crop the card;
//     "Your idea" gets the descriptions to choose from.
//   - the website: website_role / alt / focal match the website's photo
//     manifest (dselite-website scripts/photos.config.json), so a photo Drew
//     marks "Use on website" can be pulled in as-is (/api/site-photos).
import { claudeClient } from "./ai-client.js";
import { AI_MODEL } from "./dse-social.js";

const BEST_FOR = ["recruiting", "game_day", "celebration", "team_spirit", "training", "holiday", "meme", "coach_feature", "website_hero", "team_page"];
export const STOCK_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["description", "alt", "setting", "subject", "people", "tags", "quality", "social_ok", "social_concern", "social_score", "website_score", "website_role", "focal_x", "focal_y", "text_space", "best_for", "dse_gear"],
  properties: {
    description: { type: "string" }, alt: { type: "string" },
    setting: { type: "string", enum: ["tournament", "practice", "team_event", "portrait", "off_court", "other"] },
    subject: { type: "string", enum: ["action", "celebration", "huddle", "team_photo", "posed_individual", "coach", "fans", "venue", "other"] },
    people: { type: "integer" },
    tags: { type: "array", items: { type: "string" } },
    quality: { type: "integer" },
    social_ok: { type: "boolean" }, social_concern: { type: "string" },
    social_score: { type: "integer" }, website_score: { type: "integer" },
    website_role: { type: "string", enum: ["hero", "section", "gallery", "none"] },
    focal_x: { type: "integer" }, focal_y: { type: "integer" },
    text_space: { type: "string", enum: ["top", "bottom", "left", "right", "none"] },
    best_for: { type: "array", items: { type: "string", enum: BEST_FOR } },
    dse_gear: { type: "boolean" },
  },
};
const SYSTEM = `You review photos for DS Elite Volleyball, a girls' club volleyball program (players about 10-18) at the Dripping Springs Sports Club in Texas. The club's director uploads them to a stock library used for its public Facebook Page / Instagram graphics and its website (dselitevolleyball.com). Judge ONE photo and fill every field.

These are photos of minors, so safety first. social_ok = false (and say why in social_concern) if ANY is true: swimwear, underwear, sleepwear, a pool, hot tub, lake, beach, bedroom or bathroom; revealing or suggestive; someone upset, injured or embarrassed; framing that centers on a player's backside or shorts; personal information readable (a home address, a phone number, a car plate up close); alcohol, a rude gesture or anything off-brand for a youth club; a screenshot or mostly text. When unsure, false. social_concern is "" when there is none. A photo that is merely blurry or dull is still social_ok - score it low instead. Names and numbers printed on jerseys, warm-ups, backpacks or team gear are normal for a club (the website publishes rosters) and are NOT a concern; a player seen from behind in a normal game or team moment is fine.

description: 1-2 plain sentences of what's in it (what's happening, setting, how many people, uniforms/colors, mood) for the director and for picking it later. alt: website alt text under 125 characters describing the moment. NEVER a name, jersey-number shout-out or guess at who someone is - "a DS Elite hitter", "the team", "a coach".
quality 1-10: sharpness, light, exposure, composition, faces visible and not cut off. social_score 1-10: how strong it is for a club social post (energy, emotion, DS Elite gear, clear subject, reads well small on a phone). website_score 1-10: for a polished website (sharp, well lit, clean background, works cropped wide).
website_role: hero (landscape, sharp, striking, room to crop wide - a page banner), section (good supporting image), gallery (fine in a grid), none (not for the website).
focal_x / focal_y: the main subject's centre as a percent of the width / height (0-100) - where a crop should stay.
text_space: where the photo has calm, empty area for a headline (top, bottom, left, right) or none.
tags: 3-8 short lowercase tags (serve, dig, block, huddle, celebration, bench, crowd, coach, warm-up, tournament, practice, team photo, etc.). best_for: the uses it suits. dse_gear: a DS Elite uniform, shirt or logo is visible. people: how many people are clearly in it.`;

const clip = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));
function tidy(a) {
  return {
    description: String(a.description || "").slice(0, 600), alt: String(a.alt || "").slice(0, 160),
    setting: a.setting, subject: a.subject, people: clip(a.people, 0, 200),
    tags: (a.tags || []).map(t => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 8),
    quality: clip(a.quality, 1, 10), social_ok: !!a.social_ok, social_concern: String(a.social_concern || "").slice(0, 300),
    social_score: clip(a.social_score, 1, 10), website_score: clip(a.website_score, 1, 10), website_role: a.website_role,
    focal_x: clip(a.focal_x, 0, 100), focal_y: clip(a.focal_y, 0, 100), text_space: a.text_space,
    best_for: (a.best_for || []).filter(b => BEST_FOR.includes(b)), dse_gear: !!a.dse_gear,
  };
}

export async function analyzeOne(row) {
  const client = claudeClient("dse-stock-ai", { timeout: 120000, maxRetries: 1 });
  const msg = await client.beta.messages.create({
    model: AI_MODEL, max_tokens: 3000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: STOCK_SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "url", url: row.url } },
      { type: "text", text: [row.team_name ? `Tagged team: ${String(row.team_name).replace(/^(\d+ Rise) 1$/, "$1")}.` : "Tagged: the whole club.", row.note ? `Director's note: ${row.note}` : "", row.width && row.height ? `Size: ${row.width}x${row.height} (${row.width >= row.height * 1.2 ? "landscape" : row.height >= row.width * 1.2 ? "portrait" : "square-ish"}).` : ""].filter(Boolean).join(" ") },
    ] }],
  });
  if (msg.stop_reason === "refusal") throw new Error("Claude declined to review it");
  if (msg.stop_reason === "max_tokens") throw new Error("Claude ran out of room");
  return tidy(JSON.parse((msg.content || []).filter(b => b.type === "text").map(b => b.text).join("")));
}

// Analyze these ids (or the next unread ones), a few at a time. A photo Claude
// calls unsafe for social is hidden from the library too (and un-hidden if a
// later read clears it).
export async function analyzeStock(sb, { ids = null, limit = 12, force = false } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw Object.assign(new Error("ANTHROPIC_API_KEY isn't set"), { status: 500 });
  let q = sb.from("dse_social_stock").select("id, url, team_name, note, width, height, ai_at, ai, hidden").order("created_at", { ascending: false }).limit(Math.min(40, limit));
  if (ids?.length) q = q.in("id", ids.map(Number)); else if (!force) q = q.is("ai_at", null).is("ai_error", null);
  const { data: rows, error } = await q;
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  const out = { done: 0, failed: 0, flagged: 0 };
  const todo = (rows || []).filter(r => force || ids?.length || !r.ai_at);
  for (let i = 0; i < todo.length; i += 4) {
    await Promise.all(todo.slice(i, i + 4).map(async (r) => {
      try {
        const ai = await analyzeOne(r);
        // Claude's flag hides it; a re-read that clears it un-hides only what Claude hid (not Drew's own hides).
        const claudeHid = r.hidden && r.ai?.social_ok === false;
        const patch = { ai, ai_at: new Date().toISOString(), ai_error: null, ...(ai.social_ok ? (claudeHid ? { hidden: false } : {}) : { hidden: true }) };
        await sb.from("dse_social_stock").update(patch).eq("id", r.id);
        out.done++; if (!ai.social_ok) out.flagged++;
      } catch (e) {
        await sb.from("dse_social_stock").update({ ai_error: String(e.message || e).slice(0, 300) }).eq("id", r.id);
        out.failed++;
      }
    }));
  }
  const { count } = await sb.from("dse_social_stock").select("id", { count: "exact", head: true }).is("ai_at", null).is("ai_error", null);
  return { ...out, waiting: count || 0 };
}
