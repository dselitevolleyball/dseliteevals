// Vercel serverless function: reads an UPLOADED practice plan — a photo of a
// whiteboard, a scanned PDF, a Word doc, a spreadsheet, a CSV — and converts it
// into the app's structured practice-plan format so a coach can save, share,
// and run it.
//
// Called from the Practice Planner page's "Upload a plan" box. Same output
// shape as api/plan-practice.js, so the extracted plan drops straight into the
// existing planner UI, review flow, and practice_plans table.
//
// Images and PDFs go to Claude natively as content blocks. Office files are
// unzipped to text first — see api/_lib/extract-doc.js.
//
// Env vars (Vercel -> Project Settings -> Environment Variables):
//   ANTHROPIC_API_KEY  - required. Same key the other AI endpoints use.
//
// Request body: {
//   file:      string,               // data URL or bare base64 of the upload
//   filename:  string,               // original name — how we tell .xlsx from .docx
//   mediaType: string,               // optional; falls back to the data URL / extension
//   image:     string,               // legacy alias for `file`
//   minutes:   number,               // total practice length (a hint)
//   library:   [{ name, skill, phase, minutes, level }]   // club drills, to match names
// }
// Response: { plan: { name, blocks: [{ name, skill, phase, minutes, desc }], unreadable: [] } }
//           { error: "<message>" }

import Anthropic from "@anthropic-ai/sdk";
import { parseUpload } from "./_lib/extract-doc.js";

const SKILLS = ["Serving","Passing","Setting","Hitting","Blocking","Defense","Ball control","Team play","Conditioning"];

const SYSTEM_PROMPT = `You transcribe volleyball practice plans for DS Elite Volleyball. A coach uploads a plan — a photo of a whiteboard, a handwritten notebook page, a scanned PDF, a Word document, a spreadsheet, a phone note — and you convert exactly what they wrote into the club's structured format.

You are TRANSCRIBING, not designing. This is the most important rule:
- Read what is actually there. Do not invent blocks the coach did not write, and do not drop blocks because they seem unusual.
- Keep the coach's own wording for block names wherever it is legible. Do not "improve" their names.
- Keep the order exactly as written, top to bottom.

Filling the structured fields:
- minutes: use the time written next to the block. If the plan shows clock times (e.g. "5:00-5:15"), convert to a duration. If a block has no time, estimate from the surrounding blocks so the total lands near the stated practice length, and say so in that block's desc.
- skill: infer the primary volleyball skill from the block's name and notes. If genuinely unclear, use "Team play".
- phase: infer from position and content — warmup, skill, competitive, cooldown, or water.
- desc: put the coach's own supporting notes here (reps, scoring, rotations, coaching points). If they wrote nothing, write one short sentence describing what the block clearly is. Never leave desc empty.
- If a block's name closely matches a drill in the LIBRARY, use the library's EXACT name so it links to the saved drill. Only do this when it is clearly the same drill.

Reading extracted text (spreadsheets, documents):
- Spreadsheets arrive as a tab-separated grid, one row per line. Documents arrive as lines, with table rows written as "cell | cell | cell". A header row naming the columns tells you what each column means — use it, and do not turn the header itself into a block.
- Ignore rows that are totals, blank separators, or notes to the coach rather than practice blocks.

Handling what you cannot read:
- If a word or number is illegible or ambiguous, make your best reading and add it to the "unreadable" list so the coach can check it.
- If the upload is not a practice plan at all (a roster, a scoresheet, a random photo), return zero blocks and explain in the "unreadable" list.
- Never guess a time you cannot see and present it as certain — flag it.

Return the transcription by calling read_plan. Do not write any prose outside the tool call.`;

const PLAN_TOOL = {
  name: "read_plan",
  description: "Return the practice plan transcribed from the uploaded file.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "The plan's title as written in the file. If untitled, write a short descriptive one." },
      blocks: {
        type: "array",
        description: "The practice blocks in the order written in the file.",
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
        description: "Anything you could not read with confidence, or had to estimate, so the coach can verify it. Empty when the file was fully legible.",
        items: { type: "string" },
      },
    },
    required: ["name","blocks","unreadable"],
  },
};

// Splits a data URL ("data:image/png;base64,AAA...") into its media type and
// payload. A bare base64 string passes straight through.
function splitDataUrl(raw, mediaTypeHint) {
  const s = String(raw || "").trim();
  const m = /^data:([^;,]+);base64,(.*)$/is.exec(s);
  if (m) return { data: m[2], mediaType: m[1].toLowerCase().trim() };
  return { data: s, mediaType: String(mediaTypeHint || "").toLowerCase().trim() };
}

// What to call the upload when talking to the coach.
const NOUN = { image: "photo", pdf: "PDF", spreadsheet: "spreadsheet", document: "document", text: "file" };

function buildUserText(body, kind) {
  const lines = [];
  if (body.minutes) lines.push(`The coach says this practice is about ${body.minutes} minutes total — use it to sanity-check any times you have to estimate.`);
  const library = Array.isArray(body.library) ? body.library : [];
  if (library.length) {
    lines.push("");
    lines.push(`LIBRARY (${library.length} drills the club already uses) — match a block to one of these ONLY when it is clearly the same drill, and then reuse the exact name:`);
    for (const d of library) lines.push(`- ${d.name} | ${d.skill} | ${d.phase}`);
  }
  lines.push("");
  lines.push(`Transcribe the plan in this ${NOUN[kind] || "file"} now by calling read_plan.`);
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
  body = body || {};

  // `image` is the original field name — still accepted so older clients work.
  const { data, mediaType } = splitDataUrl(body.file ?? body.image, body.mediaType);
  let upload;
  try {
    upload = parseUpload({ data, mediaType, filename: body.filename });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  // Native block for images/PDFs; extracted text for everything else.
  const content = upload.block
    ? [upload.block]
    : [{ type: "text", text: `PRACTICE PLAN (extracted from the coach's ${NOUN[upload.kind] || "file"}${body.filename ? ` "${body.filename}"` : ""}):\n\n${upload.text}` }];
  content.push({ type: "text", text: buildUserText(body, upload.kind) });

  const noun = NOUN[upload.kind] || "file";
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: [PLAN_TOOL],
      tool_choice: { type: "tool", name: "read_plan" },
      messages: [{ role: "user", content }],
    });

    if (response.stop_reason === "refusal") {
      return res.status(422).json({ error: `That ${noun} couldn't be processed. Try uploading just the practice plan.` });
    }
    const toolUse = (response.content || []).find(b => b.type === "tool_use" && b.name === "read_plan");
    if (!toolUse || !toolUse.input) {
      const hint = upload.kind === "image"
        ? "Try a straighter, better-lit shot of the plan."
        : "Try re-saving the file, or export it as a PDF.";
      return res.status(502).json({ error: `Couldn't read that ${noun}. ${hint}` });
    }
    const plan = toolUse.input;
    if (!Array.isArray(plan.blocks) || !plan.blocks.length) {
      const why = Array.isArray(plan.unreadable) && plan.unreadable.length ? " " + plan.unreadable.join(" ") : "";
      return res.status(422).json({ error: `No practice blocks were found in that ${noun}.` + why });
    }
    // Round minutes so the planner's totals stay clean.
    plan.blocks = plan.blocks.map(b => ({ ...b, minutes: Math.max(1, Math.round(+b.minutes || 0)) }));
    if (!Array.isArray(plan.unreadable)) plan.unreadable = [];
    return res.status(200).json({ plan });
  } catch (err) {
    console.error("read-practice-plan error:", err);
    const msg = (err && err.message) || `Could not read the ${noun}`;
    const status = err && err.status ? err.status : 500;
    return res.status(status >= 400 && status < 600 ? status : 500).json({ error: msg });
  }
}
