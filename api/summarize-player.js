// Vercel serverless function: generates a warm, parent-facing summary of a
// player's evaluation. Called from the player profile modal "AI Summary" button.
//
// Env vars (set in Vercel -> Project Settings -> Environment Variables):
//   ANTHROPIC_API_KEY  - required. Get one at https://console.anthropic.com.
//
// Request body: { player: { first_name, last_name, age, usav_div, positions,
//                           scores, notes, parent_feedback_notes, eval_dates,
//                           projected_team, team_assignment, status, ... } }
// Response: { summary: "<plain text>" }  on success
//           { error:   "<message>"    }  on failure

import Anthropic from "@anthropic-ai/sdk";

const SKILL_LABELS = {
  Serving:        "serving",
  Passing:        "passing (forearm pass / bump)",
  "Serve Receive":"serve receive",
  Attacking:      "attacking (hitting)",
  Setting:        "setting",
  Blocking:       "blocking",
  Agility:        "agility and footwork",
  Communication: "court communication",
  Coachability:  "coachability and effort",
};

const POSITION_LABELS = {
  S: "Setter",
  OH:"Outside Hitter",
  MB:"Middle Blocker",
  RS:"Right Side",
  L: "Libero",
  DS:"Defensive Specialist",
};

const SYSTEM_PROMPT = `You are an assistant helping volleyball coaches at DS Elite Volleyball write warm, constructive evaluation summaries for parents of girls trying out for club teams (ages roughly 10-16).

Audience: a parent who either missed their child's evaluation session or is on a follow-up phone call with a coach. The parent wants to know how their daughter is doing, what she does well, and where she can grow.

Tone: warm, encouraging, professional, specific. Like a coach who genuinely cares about the player. Never clinical, never generic. Use the player's first name throughout. Avoid jargon - if you mention a skill name, briefly explain what it means in everyday terms.

Structure (3-4 short paragraphs, ~180-280 words total):
1. Open with a warm acknowledgement and 1-2 specific strengths the coaches noticed.
2. One or two areas where she can develop, framed constructively (growth, not deficit).
3. What's next - position fit, team placement context (if assigned), recommendations for development.
4. Brief invitation to follow up or ask questions. Sign off so the coach can add their own name at the bottom (do NOT invent a coach name).

Hard rules:
- ONLY use facts that are present in the player data. Do not invent details, scores, anecdotes, or quotes.
- Never include raw numeric scores in the prose. Translate them into qualitative language ("strong serving," "developing her setting," "real comfort at the net," etc.). A 4 or 5 = strong. A 3 = solid / developing. A 1 or 2 = an area to grow.
- If the player has no scores yet (totally unevaluated), say so honestly and lean on whatever notes / eval dates / registration info is available.
- If the player has coach notes or parent feedback session notes, weave the substance in (don't quote verbatim).
- If the player has a projected team or team assignment, mention it in a positive frame.
- If a field is empty, do not mention it.
- Do not mention "AI", "model", "summary", or the fact that this was generated.
- Output plain text only. No markdown headings, no bold, no bullet points.`;

function buildUserPrompt(player) {
  const lines = [];
  lines.push(`Player: ${player.first_name || ""} ${player.last_name || ""}`.trim());
  if (player.age) lines.push(`Age: ${player.age}`);
  const div = player.usav_div || player.usavDiv;
  if (div) lines.push(`Age division: ${div}`);
  if (player.positions && player.positions.length) {
    lines.push(`Positions she plays: ${player.positions.map(p => POSITION_LABELS[p] || p).join(", ")}`);
  }
  if (player.projected_team) lines.push(`Projected team tier: ${player.projected_team}`);
  if (player.team_assignment) lines.push(`Team assignment: ${player.team_assignment}`);
  if (player.status && player.status !== "In Progress") lines.push(`Tryout status: ${player.status}`);
  if (player.eval_dates && player.eval_dates.length) lines.push(`Evaluation sessions attended: ${player.eval_dates.join(", ")}`);

  const scores = player.scores || {};
  const scored = Object.entries(scores).filter(([,v]) => v > 0);
  if (scored.length) {
    lines.push("");
    lines.push("Evaluation scores (1-5 scale, higher is stronger):");
    for (const [skill, v] of scored) {
      lines.push(`  - ${SKILL_LABELS[skill] || skill}: ${v}/5`);
    }
  } else {
    lines.push("");
    lines.push("Evaluation scores: none recorded yet.");
  }

  if (player.notes && player.notes.trim()) {
    lines.push("");
    lines.push(`Coach notes: ${player.notes.trim()}`);
  }
  if (player.parent_feedback_notes && player.parent_feedback_notes.trim()) {
    lines.push("");
    lines.push(`Notes from parent feedback session: ${player.parent_feedback_notes.trim()}`);
  }
  if (player.strength_weakness && player.strength_weakness.trim()) {
    lines.push("");
    lines.push(`What she said about her own strengths / what she wants to improve: ${player.strength_weakness.trim()}`);
  }
  if (player.goal && player.goal.trim()) {
    lines.push(`Her stated volleyball goals: ${player.goal.trim()}`);
  }

  lines.push("");
  lines.push("Write the summary now.");
  return lines.join("\n");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server. Add it in Vercel -> Project Settings -> Environment Variables and redeploy." });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  const player = body && body.player;
  if (!player || !player.first_name) {
    return res.status(400).json({ error: "Missing player payload" });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 700,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: buildUserPrompt(player) }],
    });
    const text = (response.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    if (!text) return res.status(502).json({ error: "Empty response from model" });
    return res.status(200).json({ summary: text });
  } catch (err) {
    console.error("summarize-player error:", err);
    const msg = (err && err.message) || "Generation failed";
    const status = err && err.status ? err.status : 500;
    return res.status(status >= 400 && status < 600 ? status : 500).json({ error: msg });
  }
}
