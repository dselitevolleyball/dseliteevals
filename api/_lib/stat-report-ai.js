// Claude writes the "Coach's take" on a testing report (Drew, 12 Oct 2026:
// "use Claude to customize the report more based on the team they are on,
// their position, etc." — and, after a made-up example called a libero a
// middle: the position must be the one on her roster record or not mentioned).
//
// Claude gets facts only — her first name, team and level, the positions on
// file, each result (baseline, now, change, team rank) — and writes 2-4
// sentences in Coach Brandon's voice. Numbers flagged as likely typos are left
// out before Claude sees them. The text is a draft: Testing Reports shows it,
// a coach can edit it, and only then does it go in the email.
//
// Model: Claude Opus 5.5 with server-side fallbacks ("default"), so a declined
// request is retried on a fallback model inside the same call.

import { claudeClient } from "./ai-client.js";

export const AI_MODEL = "claude-opus-5-5";

// How the roster writes positions → what a parent reads.
const POSITION_NAMES = {
  DS: "defensive specialist", L: "libero", OH: "outside hitter", RS: "right side", OPP: "opposite",
  MB: "middle blocker", Middle: "middle blocker", MH: "middle blocker", S: "setter", Setter: "setter",
  Pin: "pin hitter", U: "utility", Other: null,
};
export const positionNames = (positions) =>
  [...new Set((positions || []).map(p => POSITION_NAMES[String(p).trim()] !== undefined ? POSITION_NAMES[String(p).trim()] : null).filter(Boolean))];

const SYSTEM = `You write one short paragraph — the "Coach's take" — for a youth girls' club volleyball performance-testing email. The email comes from Coach Brandon, who runs Reach, the performance-training program at Dripping Springs Sports Club (DSSC). It goes to the player's parents, and the player may read it.

The email already shows her full results table, a team comparison chart, and a section about training: for 13s and up it recommends Reach twice a week with the right times for her team's practice schedule; for 11s and 12s it explains Reach comes after an evaluation and attaches an at-home intro program. Your paragraph sits above all of that and makes it personal.

Write 2 to 4 sentences, about 50 to 90 words, in Coach Brandon's first-person voice ("I"). Warm, specific and honest — the tone of a coach who watched her test, not marketing copy.

What to do:
- Lead with her strongest result: the biggest real improvement, or where she ranks highest on her team. Use the numbers exactly as given (they are already formatted).
- If positions are given, connect that strength to what it means for how she plays that position (for example: a libero or defensive specialist lives on first-step quickness and reading the ball; a middle blocker on approach touch and a quick, high transition; an outside or right side on approach touch and vertical to hit over the block; a setter on quick feet and getting up to set or block). Use only the positions given, in the words given.
- Name the one area where an individual Reach plan would help her most, framed as an opportunity — usually her lowest team rank or her smallest change. Say what training would target (e.g. first-step speed, explosive power off two feet, strength for harder swings).

Rules:
- Use only the facts provided. Never invent numbers, dates, positions, injuries, goals or comparisons. If no positions are given, do not mention or guess a position.
- Never name or describe teammates. A team rank like "#2 of 12" is fine; never say she is last or near the bottom — talk about room to grow instead.
- If she has only one set of numbers (no retest yet), talk about where she is starting, not about improvement.
- If youth_11_12 is true, she plays on an 11s or 12s team. Reach individual training normally starts at 13s, so do not recommend Reach or an individual plan for her. Instead name the one area to build, framed around the at-home Intro to Volleyball Strength & Conditioning program attached to the email (landing softly, basic strength, quick feet, jumping technique).
- No greeting, no sign-off, no headings, no lists, no emojis, at most one exclamation point. Don't restate the whole table and don't repeat the Reach schedule or pricing.
- Output only the paragraph.`;

// facts: { player_first, team, level, age_group, positions:[names], has_retest,
//          results:[{ test, baseline, baseline_from, now, now_from, change, better, team_rank }],
//          worked_on }
export async function writeCoachTake(facts, { apiKey = process.env.ANTHROPIC_API_KEY } = {}) {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const client = claudeClient("stat-reports", { apiKey });
  const msg = await client.beta.messages.create({
    model: AI_MODEL,
    max_tokens: 4000,
    output_config: { effort: "medium" },
    // Server-side fallback: if Claude declines, the API re-runs the request on
    // a fallback model in the same call instead of returning nothing.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [{ role: "user", content: "Write the Coach's take for this player. Facts (JSON):\n" + JSON.stringify(facts, null, 1) }],
  });
  if (msg.stop_reason === "refusal") return { take: null, model: msg.model, error: "Claude declined to write this one" + (msg.stop_details?.category ? " (" + msg.stop_details.category + ")" : "") };
  const take = (msg.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
  if (!take) return { take: null, model: msg.model, error: "Empty response (" + msg.stop_reason + ")" };
  return { take, model: msg.model, usage: msg.usage };
}
