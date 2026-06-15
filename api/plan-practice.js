// Vercel serverless function: turns a coach's plain-language request into a
// structured volleyball practice plan, pulling from the club's drill library.
// Called from the Practice Planner page (/practice) "AI Coach" box.
//
// Env vars (Vercel -> Project Settings -> Environment Variables):
//   ANTHROPIC_API_KEY  - required. Same key the eval-summary endpoint uses.
//
// Request body: {
//   prompt:  string,                 // what the coach wants from practice
//   minutes: number,                 // total practice length
//   players: number,
//   level:   string,                 // "All levels" | "Beginner" | ...
//   library: [{ name, skill, phase, minutes, level }]   // drills to choose from
// }
// Response: { plan: { name, blocks: [{ name, skill, phase, minutes, desc }] } }
//           { error: "<message>" }

import Anthropic from "@anthropic-ai/sdk";

const SKILLS = ["Serving","Passing","Setting","Hitting","Blocking","Defense","Ball control","Team play","Conditioning"];

const SYSTEM_PROMPT = `You are an expert volleyball practice planner for DS Elite Volleyball. A coach describes — in plain language — what they want out of a practice, and you build a complete, time-balanced plan they can run today.

You receive the coach's request, the total practice time, the number of players, the team level, and a LIBRARY of drills the club already uses.

How to build the plan:
- The blocks must add up to approximately the total available minutes (within ~5 minutes). Do not go significantly over or under.
- Strongly prefer drills from the LIBRARY when they fit what the coach asked for — reuse their EXACT name so they link to the saved drill. You may also create new custom blocks when the library is missing something the coach specifically wants.
- Always open with a warm-up and end with a short cool-down unless the coach explicitly says not to.
- Honor the coach's emphasis: which skills, how much teaching vs. competitive play, specific situations (serve receive, out-of-system, transition, blocking, etc.), and any time they want reserved for scrimmage/6v6.
- Match the requested level. If level is "Beginner", keep it simple and fun; if advanced, raise the demand.
- Sequence sensibly: warm-up -> skill work (focused) -> competitive/games -> cool-down. Insert a short water block if the practice is long.
- Each block needs: a short name, the skill it trains, its phase, its minutes, and one clear sentence describing what to actually run.

Return the plan by calling the build_plan tool. Do not write any prose outside the tool call.`;

const PLAN_TOOL = {
  name: "build_plan",
  description: "Return the finished practice plan as structured blocks.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "A short title for this practice, e.g. 'Tournament prep — serve receive'." },
      blocks: {
        type: "array",
        description: "Ordered practice blocks that sum to about the total available minutes.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Drill/block name. Match a library drill name exactly when using one." },
            skill: { type: "string", enum: SKILLS, description: "Primary skill this block trains." },
            phase: { type: "string", enum: ["warmup","skill","competitive","cooldown","water"] },
            minutes: { type: "number", description: "Whole minutes for this block." },
            desc: { type: "string", description: "One sentence on what to run." },
          },
          required: ["name","skill","phase","minutes"],
        },
      },
    },
    required: ["name","blocks"],
  },
};

function buildUserPrompt(body) {
  const { prompt, minutes, players, level, library } = body;
  const lines = [];
  lines.push(`Coach's request: ${String(prompt).trim()}`);
  lines.push("");
  lines.push(`Total practice time: ${minutes} minutes`);
  lines.push(`Players: ${players}`);
  lines.push(`Team level: ${level || "All levels"}`);
  lines.push("");
  if (Array.isArray(library) && library.length) {
    lines.push(`LIBRARY (${library.length} drills) — format: Name | skill | phase | typical minutes | level`);
    for (const d of library) {
      lines.push(`- ${d.name} | ${d.skill} | ${d.phase} | ${d.minutes}m | ${d.level || "All levels"}`);
    }
  } else {
    lines.push("LIBRARY: (none provided — build the plan from scratch with sensible drills.)");
  }
  lines.push("");
  lines.push("Build the plan now by calling build_plan.");
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
  if (!body || !body.prompt || !String(body.prompt).trim()) {
    return res.status(400).json({ error: "Tell me what you want from the practice first." });
  }
  body.minutes = Math.max(20, Math.min(+body.minutes || 90, 240));
  body.players = Math.max(1, +body.players || 12);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: [PLAN_TOOL],
      tool_choice: { type: "tool", name: "build_plan" },
      messages: [{ role: "user", content: buildUserPrompt(body) }],
    });
    const toolUse = (response.content || []).find(b => b.type === "tool_use" && b.name === "build_plan");
    if (!toolUse || !toolUse.input || !Array.isArray(toolUse.input.blocks) || !toolUse.input.blocks.length) {
      return res.status(502).json({ error: "The AI did not return a usable plan. Try rephrasing your request." });
    }
    return res.status(200).json({ plan: toolUse.input });
  } catch (err) {
    console.error("plan-practice error:", err);
    const msg = (err && err.message) || "Generation failed";
    const status = err && err.status ? err.status : 500;
    return res.status(status >= 400 && status < 600 ? status : 500).json({ error: msg });
  }
}
