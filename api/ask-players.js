// Vercel serverless function: answers natural-language questions about the
// player/eval dataset using Claude. Called from the owner-only "Ask AI" tab.
//
// Env vars (Vercel -> Project Settings -> Environment Variables):
//   ANTHROPIC_API_KEY  - required. Same key the other AI endpoints use.
//
// Request body: { question: string, players: [ { name, div, pos, scores, avg,
//   tot, proj, team, status, minLvl, notes, parentFeedback, strengths, goal,
//   leaving, currentTeam, school } ] }
// Response: { answer: "<plain text>" } | { error: "<message>" }

import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `You are a precise data analyst for DS Elite Volleyball's director. You answer questions about their tryout/evaluation players using ONLY the player data provided in the user message.

Each player record may include: name, age group (USAV division), positions, evaluation scores (each skill rated 1-5, higher is better), average and total score, current projected team tier, current team assignment, tryout status, minimum acceptable level, and free-text fields — coach notes, parent-feedback notes, the player's stated strengths, her goals, and her reason for leaving a prior club.

Key scales:
- Skill scores are 1-5 (5 = strongest). A blank/0 means not yet evaluated.
- projected_team tier: "1" = top team, then "1/2", "2", "2/3", "3" = lowest. Blank = not yet projected.

Rules:
- Use ONLY the supplied data. Never invent players, scores, notes, or facts. If the data can't answer the question, say so plainly.
- FIND questions: return a clean, scannable list. For each player give her name and age group, plus the specific evidence that matched — quote or tightly paraphrase the relevant note/score. Don't pad the list with weak matches.
- JUDGMENT questions (e.g. "undervalued players who should be on a higher team"): reason explicitly. Compare each candidate's scores/average and positive feedback against her current projected tier, and surface mismatches — strong scores or glowing notes paired with a low/blank tier. For each pick, show the evidence and a one-line rationale. Lead with the strongest cases.
- FREE-TEXT searches (e.g. scholarship or payment-help requests, injuries, scheduling conflicts): scan the notes / parent-feedback / goals / leaving-reason fields and list who matched with the exact quote.
- Be honest about uncertainty. Prefer fewer, well-supported answers over a long speculative list. Note when evidence is thin.
- Output plain text. Simple bullet or numbered lists are fine. No markdown headers or tables.`;

function fmtPlayer(p, i) {
  const cut = (s, n) => { s = (s == null ? "" : String(s)).trim(); return s.length > n ? s.slice(0, n) + "…" : s; };
  const parts = [`#${i + 1} ${p.name || "(no name)"}`];
  if (p.div) parts.push(p.div);
  if (p.pos) parts.push(`pos:${p.pos}`);
  const scores = p.scores && typeof p.scores === "object"
    ? Object.entries(p.scores).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ")
    : "";
  if (scores) parts.push(`scores:[${scores}]`);
  if (p.avg) parts.push(`avg:${p.avg}`);
  if (p.tot) parts.push(`tot:${p.tot}`);
  if (p.proj) parts.push(`projTier:${p.proj}`);
  if (p.team) parts.push(`team:${p.team}`);
  if (p.status) parts.push(`status:${p.status}`);
  if (p.minLvl) parts.push(`minLevel:${p.minLvl}`);
  if (p.currentTeam) parts.push(`prevClub:${cut(p.currentTeam, 60)}`);
  if (p.school) parts.push(`school:${cut(p.school, 60)}`);
  let line = parts.join(" | ");
  const free = [];
  if (p.notes)          free.push(`  notes: ${cut(p.notes, 600)}`);
  if (p.parentFeedback) free.push(`  parentFeedback: ${cut(p.parentFeedback, 600)}`);
  if (p.strengths)      free.push(`  strengths: ${cut(p.strengths, 300)}`);
  if (p.goal)           free.push(`  goal: ${cut(p.goal, 300)}`);
  if (p.leaving)        free.push(`  leavingReason: ${cut(p.leaving, 300)}`);
  return free.length ? line + "\n" + free.join("\n") : line;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server. Add it in Vercel -> Project Settings -> Environment Variables and redeploy." });
  }

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: "Invalid JSON body" }); }

  const question = body && typeof body.question === "string" ? body.question.trim() : "";
  const players  = body && Array.isArray(body.players) ? body.players : [];
  if (!question) return res.status(400).json({ error: "Ask a question first." });
  if (!players.length) return res.status(400).json({ error: "No player data was provided." });

  const dataText = `PLAYER DATA — ${players.length} players:\n` + players.map(fmtPlayer).join("\n");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2500,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content: [
          // Cache the (large) data block so repeated questions in a session are cheaper/faster.
          { type: "text", text: dataText, cache_control: { type: "ephemeral" } },
          { type: "text", text: "QUESTION: " + question + "\n\nAnswer using only the data above." },
        ],
      }],
    });
    const text = (response.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    if (!text) return res.status(502).json({ error: "Empty response from the model. Try rephrasing." });
    return res.status(200).json({ answer: text });
  } catch (err) {
    console.error("ask-players error:", err);
    const msg = (err && err.message) || "Generation failed";
    const status = err && err.status ? err.status : 500;
    return res.status(status >= 400 && status < 600 ? status : 500).json({ error: msg });
  }
}
