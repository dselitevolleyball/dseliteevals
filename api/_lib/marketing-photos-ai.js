// The photo library's AI librarian: Claude looks at a photo and says which
// program line it belongs to, what's in it, what it's good for (a feed post,
// a story, an email banner, the website, a program card), how good it is and
// whether recognizable kids are in it - so the marketing machine, the
// website and the emails can find the right picture without anyone tagging
// by hand.
//
// One request per photo (the image goes by its public URL), structured JSON
// out. Model: Claude Opus 5.5 with server-side fallbacks ("default"), effort
// low - this is classification. No temperature / top_p: this model rejects
// them. A refusal or a bad answer leaves the photo as it was, with ai_error.
//
// tagPhotos(sb, photos, { mode }) writes the result to mkt_photos:
//   mode "fill" (uploads, the nightly backfill): adds to what's there - the
//     AI's tags join the photo's tags, its line and alt text are used only
//     when the photo has none (or only a camera file name).
//   mode "replace" (a director's "Re-run AI"): the AI's line, tags and alt
//     text replace the old ones.

import { claudeClient } from "./ai-client.js";
import { LINE_KEYS, LINES } from "../../shared/marketing-plan.js";
import { PHOTO_TAGS_ALL, PHOTO_USES, PEOPLE, SETTINGS, looksLikeFilename } from "../../shared/marketing-photos.js";
import { AI_MODEL, aiReady } from "./marketing-ai.js";

const SYSTEM = `You catalogue photos for Dripping Springs Sports Club (DSSC) in Dripping Springs, Texas: a youth and adult sports club with volleyball, basketball ("4th Quarter Athlete"), Reach Performance (speed, strength and athletic-development training), Camp Elevate (a full-day multi-sport camp when school is out), birthday parties run by party hosts, court rentals and open gym, in a building called the Warehouse. The club's marketing machine uses your answers to pick photos for social posts, stories, emails, the website and program pages.

For the photo you are shown, return JSON matching the schema:
- line: the program line the photo best represents: ${LINES.map(l => `${l.key} (${l.label})`).join(", ")}, or "none" when it fits none. A volleyball or basketball game or drill is that sport; strength, speed or agility work without a ball is reach; a party room, cake or balloons is parties; an empty court or the building is rentals or club; club-wide moments (teams together, community events, the logo) are club.
- tags: every tag from the list that clearly applies - nothing you'd have to guess.
- description: one or two plain sentences saying what is in the photo, as a search would want it ("Two girls in a youth volleyball clinic bump-passing on the main court").
- alt: alt text under 120 characters for a screen reader.
- people: who is in it - none, kids (about 12 and under), teens, adults, or mixed.
- setting: where it was taken.
- uses: what the photo is good for. social_post: a strong, clear subject that crops to 4:5. story: works as a tall 9:16 crop. email_banner: works as a wide crop with room for words. website_hero: high quality and wide, with a clear focal point. program_card: clearly shows one activity.
- quality: 1 to 5. 5 = sharp, well lit, a great moment; 3 = usable; 1 = blurry, dark or awkward.
- minors: true when a child's face can be recognized in the photo.
Describe only what you can see. Do not identify people by name.`;

const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["line", "tags", "description", "alt", "people", "setting", "uses", "quality", "minors"],
  properties: {
    line: { type: "string", enum: [...LINE_KEYS, "none"] },
    tags: { type: "array", items: { type: "string", enum: PHOTO_TAGS_ALL } },
    description: { type: "string" },
    alt: { type: "string" },
    people: { type: "string", enum: PEOPLE },
    setting: { type: "string", enum: SETTINGS },
    uses: { type: "array", items: { type: "string", enum: PHOTO_USES } },
    quality: { type: "integer", enum: [1, 2, 3, 4, 5] },
    minors: { type: "boolean" },
  },
};

// -> { ai, model } | { error, model? }
export async function describePhoto(photo, { timeoutMs = 60000 } = {}) {
  if (!aiReady()) return { error: "ANTHROPIC_API_KEY is not set" };
  const client = claudeClient("marketing-photos", { apiKey: process.env.ANTHROPIC_API_KEY, timeout: timeoutMs, maxRetries: 1 });
  const hint = [photo.filename && !looksLikeFilename(photo.filename) ? `File name: ${photo.filename}` : null, photo.alt && !looksLikeFilename(photo.alt) ? `Current caption: ${photo.alt}` : null].filter(Boolean).join("\n");
  const msg = await client.beta.messages.create({
    model: AI_MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "url", url: photo.url } },
      { type: "text", text: `Catalogue this photo.${hint ? "\n" + hint : ""}` },
    ] }],
  });
  if (msg.stop_reason === "refusal") return { error: "Claude declined" + (msg.stop_details?.category ? ` (${msg.stop_details.category})` : ""), model: msg.model };
  if (msg.stop_reason === "max_tokens") return { error: "Claude ran out of room", model: msg.model };
  const text = (msg.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  try { return { ai: JSON.parse(text), model: msg.model }; }
  catch { return { error: "Couldn't read Claude's answer", model: msg.model }; }
}

// The row update for one photo from Claude's answer.
export function photoPatch(photo, ai, { mode = "fill", model = AI_MODEL } = {}) {
  const tags = (ai.tags || []).filter(t => PHOTO_TAGS_ALL.includes(t));
  const line = LINE_KEYS.includes(ai.line) ? ai.line : null;
  const alt = String(ai.alt || "").trim().slice(0, 200);
  const replace = mode === "replace";
  return {
    line: replace ? line : (photo.line || line),
    tags: replace ? tags : [...new Set([...(photo.tags || []), ...tags])],
    alt: replace || looksLikeFilename(photo.alt) || (photo.source === "upload" && photo.filename && photo.alt === photo.filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ")) ? (alt || photo.alt || null) : photo.alt,
    description: String(ai.description || "").trim().slice(0, 600) || null,
    people: PEOPLE.includes(ai.people) ? ai.people : null,
    setting: SETTINGS.includes(ai.setting) ? ai.setting : null,
    uses: (ai.uses || []).filter(u => PHOTO_USES.includes(u)),
    quality: [1, 2, 3, 4, 5].includes(Number(ai.quality)) ? Number(ai.quality) : null,
    minors: typeof ai.minors === "boolean" ? ai.minors : null,
    ai_at: new Date().toISOString(), ai_model: model || AI_MODEL, ai_error: null,
  };
}

// Tag photos a few at a time; each result is saved as it lands.
// -> { photos: [updated rows], errors: [{ id, error }] }
export async function tagPhotos(sb, photos, { mode = "fill", concurrency = 4, deadline = Date.now() + 100000 } = {}) {
  const out = [], errors = [];
  const queue = (photos || []).slice();
  const worker = async () => {
    while (queue.length) {
      const p = queue.shift();
      if (Date.now() > deadline - 15000) { errors.push({ id: p.id, error: "out of time - try again" }); continue; }
      let r;
      try { r = await describePhoto(p, { timeoutMs: Math.max(15000, Math.min(60000, deadline - Date.now() - 5000)) }); }
      catch (e) { r = { error: e?.message || String(e) }; }
      if (r.error) {
        errors.push({ id: p.id, error: r.error });
        await sb.from("mkt_photos").update({ ai_error: r.error.slice(0, 300), ai_at: new Date().toISOString() }).eq("id", p.id);
        continue;
      }
      const patch = photoPatch(p, r.ai, { mode, model: r.model });
      const { data, error } = await sb.from("mkt_photos").update(patch).eq("id", p.id).select("*").single();
      if (error) errors.push({ id: p.id, error: error.message });
      else out.push(data);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker));
  return { photos: out, errors };
}
