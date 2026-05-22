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

const SYSTEM_PROMPT = `You are an assistant helping coaches at DS Elite Volleyball write warm, parent-facing summaries of a player's developmental evaluation. The audience is the parent of a girl (ages roughly 10-16) who attended an evaluation session - this is NOT a tryout decision, NOT a placement verdict. It is feedback meant to help the player understand how she performed and what to focus on next.

The parent will read this either in an email (because they missed the eval session) or hear it walked through on a follow-up phone call with a coach.

Tone: warm, encouraging, professional, specific. Like a coach who genuinely cares about the player. Conversational but not casual. Use the player's first name throughout. Avoid jargon - if you mention a skill name, briefly explain it in everyday terms.

Structure (3-4 short paragraphs, ~220-330 words total):
1. Open with a warm acknowledgement and 1-2 specific strengths the coaches observed.
2. If peer comparison data is provided AND the comparative_framing rules below allow it, briefly note how she stacks up against other players we've evaluated in her age group. If a team plan is provided, also use this paragraph (or the next) to describe the broader landscape - how many teams DS Elite is fielding at each competitive level for her age group this year - and where she is currently projecting within that landscape. Stress that the projection is current thinking, not a final decision, and can shift as more information comes in.
3. One or two areas where she can develop, framed as growth opportunities (not deficits).
4. Suggested next steps and an invitation for the parent to follow up with questions. Sign off so the coach can add their own name at the bottom (do NOT invent a coach name).

Comparative framing rules (only applies if division_band is present in the payload):
- division_band = "top10": say clearly that she stands out as one of the stronger players we've evaluated in her age group. Language like "in the top tier of her age group" or "in the top 10% of girls in her age division we've seen" is appropriate and welcome - parents love hearing this when it's true.
- division_band = "top25": say she shows above-average ability in her age group, in the upper quartile / above the middle.
- division_band = "middle": say she fits comfortably within the range of her age group, then move on to individual growth. Do NOT use percentile or ranking phrasing.
- division_band = "bottom25" or "bottom10": do NOT mention percentile, ranking, or peer comparison at all. Frame entirely in terms of her own development - skills she's building, what to work on, what growth looks like for her. Phrases like "earlier in her development" are okay only when they fit naturally; never imply she ranks at the bottom.
- If division_band is missing or null (not enough peers to compare meaningfully), skip the comparison paragraph and use that space for individual context instead.

Team-placement framing rules:
- DS Elite fields teams at three competitive levels: National (highest), Regional (mid), and Rise (developmental). The team plan in the payload tells you how many of each tier the club is running for THIS age group this season.
- If projected_team or team_assignment is present, treat it as a working projection based on what coaches have seen so far. Always state explicitly that this projection could change as the evaluation process continues. Acceptable phrasings: "currently projecting toward...", "based on what we've seen so far we'd expect her to fit on...", "this is our current thinking and could shift...".
- Never describe a projected placement as final, guaranteed, or earned. Never use words like "offer", "cut", "selected", or "made the team".
- When the team plan is provided, briefly describe the age-group landscape so the parent understands the context (e.g., "we're planning two National-level teams and two Regional teams for this age group this season"). Do NOT list every team name or invent team names not in the data.

Hard rules:
- ONLY use facts present in the player data. Do not invent details, scores, anecdotes, or quotes.
- NEVER include raw numeric scores (1-5) or division rank numbers in the prose. Translate scores into qualitative language: a 4 or 5 is "strong" / "comfortable" / "shows real ability"; a 3 is "solid" / "developing nicely"; a 1 or 2 is "an area to keep building" / "still developing".
- This is feedback after an EVALUATION, not a tryout. Do not use words like "tryout", "made the team", "cut", "selected", "offer".
- If a player has no scores yet, say so honestly and lean on whatever notes, eval dates, or registration info is available.
- If coach notes or parent-feedback-session notes are present, weave their substance in. Never quote verbatim.
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

  if (player.division_band) {
    lines.push("");
    lines.push("Peer comparison within her age division (apply comparative framing rules):");
    lines.push(`  division_band: ${player.division_band}`);
    if (player.division_total_scored != null) {
      lines.push(`  (Based on ${player.division_total_scored} evaluated players in her age division.)`);
    }
  } else {
    lines.push("");
    lines.push("Peer comparison: not enough evaluated peers in her age division yet to compare meaningfully. Skip the comparison paragraph.");
  }

  if (player.team_plan && (player.team_plan.national || player.team_plan.regional || player.team_plan.rise)) {
    const tp = player.team_plan;
    const parts = [];
    if (tp.national) parts.push(`${tp.national} National-level team${tp.national===1?"":"s"}`);
    if (tp.regional) parts.push(`${tp.regional} Regional team${tp.regional===1?"":"s"}`);
    if (tp.rise)     parts.push(`${tp.rise} Rise (developmental) team${tp.rise===1?"":"s"}`);
    lines.push("");
    lines.push(`2026-27 plan for her age group: DS Elite is fielding ${parts.join(", ")}.`);
    lines.push("Use this to describe the landscape briefly. The plan can still change; treat as the current intent.");
  }

  if (player.projected_team || player.team_assignment) {
    lines.push("");
    if (player.projected_team) lines.push(`Coaches' current projected tier/team: ${player.projected_team} (working projection — frame as "current thinking, could change").`);
    if (player.team_assignment) lines.push(`Currently penciled in on: ${player.team_assignment} (still subject to change as evaluations continue).`);
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
