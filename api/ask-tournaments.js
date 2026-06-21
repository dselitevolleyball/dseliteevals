// Vercel serverless function: answers natural-language questions about the
// tournament schedule using Claude. Called from the Tournaments page Q&A box.
//
// Env vars:
//   ANTHROPIC_API_KEY  - required. Same key the other AI endpoints use.
//
// Request body: { question: string, tournaments: [ { name, start, end,
//   location, venue, ageLow, ageHigh, entries:[...], qualifier, status,
//   cancelled, easter, threeDay, holidays:[...], committed:[{team,division}] } ] }
// Response: { answer: "<plain text>" } | { error: "<message>" }

import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `You are a precise scheduling analyst for DS Elite Volleyball's director. You answer questions about their tournament schedule using ONLY the tournament data provided in the user message.

Each tournament record may include:
- name, date range (start..end, ISO dates), location, venue
- age range the event serves (ageLow..ageHigh, as USAV ages like 14 = 14U)
- entries: the specific "<age> <division-tier>" slots DS Elite is fielding or that are offered, e.g. "14 Liberty", "14 USA", "17 Open". The number is the age; the word is the competitive tier (Open, USA, American, Liberty, National, Patriot, Freedom, etc.). "14 Diamond" style team names refer to the club's own teams — match them by age (14) and, if a tier is requested, by an entry of that tier at that age.
- qualifier: true if it is a national-qualifier event
- status: registration/availability note
- cancelled: true if the event is cancelled (exclude unless asked)
- tags: labels on the tournament (auto ones like "Easter", "3-Day Weekend", holiday names, plus the director's own custom tags). When asked to filter or group "by tag", match against this list.
- holidays: names of school/holiday blackouts overlapping the dates (e.g. "Spring Break (DSISD)", "Thanksgiving Break (DSISD)")
- easter: true if the dates fall on Easter weekend
- threeDay: true if it lands on a 3-day (long) weekend
- committed: teams already assigned to this tournament, with the division they are playing

How to reason:
- "available for <team/age>": include tournaments whose age range covers that age OR that have an entry at that age. If a tier is named (e.g. "Liberty or USA"), require an entry matching that age AND one of those tiers.
- Exclusions like "not on Easter / spring break / holidays": drop tournaments where easter is true, or holidays includes the named break (spring break = a holiday containing "Spring Break").
- "not conflicting with other committed tournaments" (for a given team): treat the team as committed to any tournament listing it in committed. Exclude candidate tournaments whose date range overlaps the same weekend as one the team is already committed to. State which commitment caused an exclusion when relevant.
- Always honor every constraint in the question together (age, tier, holiday, conflict).

Rules:
- Use ONLY the supplied data. Never invent tournaments, dates, or entries. If nothing matches, say so plainly.
- Return a clean, scannable list. For each match give the name, the date range, location, and the matching entry/tier — plus a short note on why it qualifies. Sort by start date.
- If the question implies conflicts or exclusions, briefly note what you filtered out and why.
- Output plain text. Simple bullet or numbered lists are fine. No markdown headers or tables.`;

function fmtTournament(t, i) {
  const cut = (s, n) => { s = (s == null ? "" : String(s)).trim(); return s.length > n ? s.slice(0, n) + "…" : s; };
  const parts = [`#${i + 1} ${t.name || "(no name)"}`];
  parts.push(`${t.start || "?"}${t.end && t.end !== t.start ? ".." + t.end : ""}`);
  if (t.location) parts.push(cut(t.location, 60));
  if (t.ageLow != null || t.ageHigh != null) parts.push(`ages:${t.ageLow ?? "?"}-${t.ageHigh ?? "?"}`);
  if (Array.isArray(t.entries) && t.entries.length) parts.push(`entries:[${t.entries.join(", ")}]`);
  if (t.qualifier) parts.push("QUALIFIER");
  if (t.status) parts.push(`status:${cut(t.status, 40)}`);
  if (t.cancelled) parts.push("CANCELLED");
  if (Array.isArray(t.tags) && t.tags.length) parts.push(`tags:[${t.tags.join(", ")}]`);
  if (Array.isArray(t.holidays) && t.holidays.length) parts.push(`holidays:[${t.holidays.join(", ")}]`);
  if (t.easter) parts.push("easter:yes");
  if (t.threeDay) parts.push("3dayWeekend:yes");
  if (Array.isArray(t.committed) && t.committed.length)
    parts.push(`committed:[${t.committed.map(c => c.team + (c.division ? "(" + c.division + ")" : "")).join(", ")}]`);
  if (t.venue) parts.push(`venue:${cut(t.venue, 50)}`);
  return parts.join(" | ");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server. Add it in Vercel -> Project Settings -> Environment Variables and redeploy." });
  }

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: "Invalid JSON body" }); }

  const question    = body && typeof body.question === "string" ? body.question.trim() : "";
  const tournaments = body && Array.isArray(body.tournaments) ? body.tournaments : [];
  if (!question) return res.status(400).json({ error: "Ask a question first." });
  if (!tournaments.length) return res.status(400).json({ error: "No tournament data was provided." });

  const dataText = `TOURNAMENT DATA — ${tournaments.length} tournaments:\n` + tournaments.map(fmtTournament).join("\n");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2500,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content: [
          { type: "text", text: dataText, cache_control: { type: "ephemeral" } },
          { type: "text", text: "QUESTION: " + question + "\n\nAnswer using only the data above." },
        ],
      }],
    });
    const text = (response.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    if (!text) return res.status(502).json({ error: "Empty response from the model. Try rephrasing." });
    return res.status(200).json({ answer: text });
  } catch (err) {
    console.error("ask-tournaments error:", err);
    const msg = (err && err.message) || "Generation failed";
    const status = err && err.status ? err.status : 500;
    return res.status(status >= 400 && status < 600 ? status : 500).json({ error: msg });
  }
}
