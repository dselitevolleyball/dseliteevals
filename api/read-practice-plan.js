// Vercel serverless function: reads a PHOTO of a practice plan (a whiteboard,
// a handwritten page, a printed sheet) and converts it into the app's
// structured practice-plan format so a coach can save, share, and run it.
//
// Called from the Practice Planner page's "Upload a photo" box. Same output
// shape as api/plan-practice.js, so the extracted plan drops straight into the
// existing planner UI, review flow, and practice_plans table.
//
// Env vars (Vercel -> Project Settings -> Environment Variables):
//   ANTHROPIC_API_KEY  - required. Same key the other AI endpoints use.
//
// Request body: {
//   image:   string,                 // data URL or bare base64 of the photo
//   minutes: number,                 // total practice length (a hint)
//   library: [{ name, skill, phase, minutes, level }]   // club drills, to match names
// }
// Response: { plan: { name, blocks: [{ name, skill, phase, minutes, desc }], unreadable: [] } }
//           { error: "<message>" }

import Anthropic from "@anthropic-ai/sdk";

const SKILLS = ["Serving","Passing","Setting","Hitting","Blocking","Defense","Ball control","Team play","Conditioning"];
const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024; // API caps images ~5MB base64

const SYSTEM_PROMPT = `You transcribe volleyball practice plans from photos for DS Elite Volleyball. A coach photographs a plan — a whiteboard, a handwritten notebook page, a printed sheet, a phone note — and you convert exactly what they wrote into the club's structured format.

You are TRANSCRIBING, not designing. This is the most important rule:
- Read what is actually on the page. Do not invent blocks the coach did not write, and do not drop blocks because they seem unusual.
- Keep the coach's own wording for block names wherever it is legible. Do not "improve" their names.
- Keep the order exactly as written, top to bottom.

Filling the structured fields:
- minutes: use the time written next to the block. If the plan shows clock times (e.g. "5:00-5:15"), convert to a duration. If a block has no time, estimate from the surrounding blocks so the total lands near the stated practice length, and say so in that block's desc.
- skill: infer the primary volleyball skill from the block's name and notes. If genuinely unclear, use "Team play".
- phase: infer from position and content — warmup, skill, competitive, cooldown, or water.
- desc: put the coach's own supporting notes here (reps, scoring, rotations, coaching points). If they wrote nothing, write one short sentence describing what the block clearly is. Never leave desc empty.
- If a block's name closely matches a drill in the LIBRARY, use the library's EXACT name so it links to the saved drill. Only do this when it is clearly the same drill.

Handling what you cannot read:
- If a word or number is illegible, make your best reading and add it to the "unreadable" list so the coach can check it.
- If the whole image is not a practice plan (a roster, a scoresheet, a random photo), return zero blocks and explain in the "unreadable" list.
- Never guess a time you cannot see and present it as certain — flag it.

Return the transcription by calling read_plan. Do not write any prose outside the tool call.`;

const PLAN_TOOL = {
  name: "read_plan",
  description: "Return the practice plan transcribed from the photo.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "The plan's title as written on the page. If untitled, write a short descriptive one." },
      blocks: {
        type: "array",
        description: "The practice blocks in the order written on the page.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Block name in the coach's own words, or the exact LIBRARY name when it is clearly that drill." },
            skill: { type: "string", enum: SKILLS, description: "Primary skill this block trains." },
            phase: { type: "string", enum: ["warmup","skill","competitive","cooldown","water"] },
            minutes: { type: "number", description: "Whole minutes for this block." },
            desc: { type: "string", description: "The coach's notes for this block, or one sentence describing it." },
          },
          required: ["name","skill","phase","minutes","desc"],
        },
      },
      unreadable: {
        type: "array",
        description: "Anything you could not read with confidence, or had to estimate, so the coach can verify it. Empty when the photo was fully legible.",
        items: { type: "string" },
      },
    },
    required: ["name","blocks","unreadable"],
  },
};

// Accepts a data URL ("data:image/png;base64,AAA...") or bare base64.
function parseImage(raw) {
  const s = String(raw || "").trim();
  if (!s) return { error: "No photo was uploaded." };
  const m = /^data:([^;,]+);base64,(.*)$/is.exec(s);
  let mediaType = "image/jpeg", data = s;
  if (m) { mediaType = m[1].toLowerCase().trim(); data = m[2]; }
  data = data.replace(/\s/g, "");
  if (!MEDIA_TYPES.has(mediaType)) {
    return { error: "That image type isn't supported. Use a JPEG, PNG, GIF, or WebP photo." };
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length < 100) {
    return { error: "That photo didn't upload correctly. Try taking it again." };
  }
  // base64 -> bytes is a 4:3 ratio.
  if (Math.floor(data.length * 3 / 4) > MAX_BYTES) {
    return { error: "That photo is too large. Retake it at a lower resolution, or crop it to just the plan." };
  }
  return { mediaType, data };
}

function buildUserText(body) {
  const lines = [];
  if (body.minutes) lines.push(`The coach says this practice is about ${body.minutes} minutes total — use it to sanity-check any times you have to estimate.`);
  const library = Array.isArray(body.library) ? body.library : [];
  if (library.length) {
    lines.push("");
    lines.push(`LIBRARY (${library.length} drills the club already uses) — match a block to one of these ONLY when it is clearly the same drill, and then reuse the exact name:`);
    for (const d of library) lines.push(`- ${d.name} | ${d.skill} | ${d.phase}`);
  }
  lines.push("");
  lines.push("Transcribe the plan in this photo now by calling read_plan.");
  return lines.join("\n");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server. Add it in Vercel -> Project Settings -> Environment Variables and redeploy." });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  const img = parseImage(body && body.image);
  if (img.error) return res.status(400).json({ error: img.error });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: [PLAN_TOOL],
      tool_choice: { type: "tool", name: "read_plan" },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } },
          { type: "text", text: buildUserText(body || {}) },
        ],
      }],
    });

    if (response.stop_reason === "refusal") {
      return res.status(422).json({ error: "That photo couldn't be processed. Try a photo of just the practice plan." });
    }
    const toolUse = (response.content || []).find(b => b.type === "tool_use" && b.name === "read_plan");
    if (!toolUse || !toolUse.input) {
      return res.status(502).json({ error: "Couldn't read that photo. Try a straighter, better-lit shot of the plan." });
    }
    const plan = toolUse.input;
    if (!Array.isArray(plan.blocks) || !plan.blocks.length) {
      const why = Array.isArray(plan.unreadable) && plan.unreadable.length ? " " + plan.unreadable.join(" ") : "";
      return res.status(422).json({ error: "No practice blocks were found in that photo." + why });
    }
    // Round minutes so the planner's totals stay clean.
    plan.blocks = plan.blocks.map(b => ({ ...b, minutes: Math.max(1, Math.round(+b.minutes || 0)) }));
    if (!Array.isArray(plan.unreadable)) plan.unreadable = [];
    return res.status(200).json({ plan });
  } catch (err) {
    console.error("read-practice-plan error:", err);
    const msg = (err && err.message) || "Could not read the photo";
    const status = err && err.status ? err.status : 500;
    return res.status(status >= 400 && status < 600 ? status : 500).json({ error: msg });
  }
}
