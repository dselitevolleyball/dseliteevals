// Vercel serverless: AI intake for the Coaching Playbook. A coach types messy
// notes; this either asks ONE clarifying question or returns clean, structured
// playbook entries. Iterative — pass the running transcript and current draft
// to refine.
//
// Env: ANTHROPIC_API_KEY
//
// Request body: {
//   history: [{ role:"user"|"assistant", text }],  // conversation so far
//   draft:   [{ entry_type, category, title, body, cues }]  // current proposal (optional)
// }
// Response: { need_more:boolean, question?:string, note?:string,
//             entries:[{ entry_type, category, title, body, cues }] }

import Anthropic from "@anthropic-ai/sdk";

const TYPES = ["Technique", "Cue", "System", "Idea", "Drill note", "Other"];
const CATS = ["Serving", "Passing", "Serve Receive", "Setting", "Hitting", "Blocking", "Defense", "Team play", "Culture", "Conditioning", "General"];

const SYSTEM = `You are the intake assistant for DS Elite Volleyball's Coaching Playbook. Coaches brain-dump ideas — a technique, a cue, a system, a teaching progression — and you turn it into clean, reusable playbook entries other coaches can read and apply. This is NOT about drills; it's about how we teach, talk about, and reinforce the game.

Each entry has:
- entry_type: one of ${TYPES.join(", ")}.
- category: the skill/topic area, ideally one of ${CATS.join(", ")} (or a sensible short label).
- title: a short, specific name (e.g. "Proper wall trap", "Hold your platform", "Right-left setter footwork").
- body: how to do it / how we teach it, in clear coaching language — a few sentences.
- cues: the short exact phrases we say to players (optional but encouraged), separated by " · ".

Rules:
- Split a brain-dump into as many focused entries as it naturally contains — one clear idea per entry. Don't cram multiple techniques into one.
- Write in DS Elite's voice: game-like, high-touch, concise, cue-driven.
- If the notes are too vague to make a genuinely useful entry (you can't tell the skill, or what the coach actually means), set need_more=true and ask exactly ONE short, specific question. Otherwise set need_more=false and return the entries.
- When the coach refines or answers a question, update the draft accordingly and return the full revised set.
- Preserve the coach's intent and specifics; don't invent technique they didn't imply.

Always respond by calling the return_entries tool. No prose outside the tool call.`;

const TOOL = {
  name: "return_entries",
  description: "Return either a clarifying question or the structured playbook entries.",
  input_schema: {
    type: "object",
    properties: {
      need_more: { type: "boolean", description: "true if you must ask a clarifying question before producing good entries." },
      question: { type: "string", description: "One short, specific question to the coach (only when need_more is true)." },
      note: { type: "string", description: "Optional one-line summary of what you produced or changed." },
      entries: {
        type: "array",
        description: "The finished entries (empty when need_more is true).",
        items: {
          type: "object",
          properties: {
            entry_type: { type: "string", enum: TYPES },
            category: { type: "string" },
            title: { type: "string" },
            body: { type: "string" },
            cues: { type: "string", description: "Short cue phrases separated by ' · ', or empty." },
          },
          required: ["entry_type", "category", "title", "body"],
        },
      },
    },
    required: ["need_more", "entries"],
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server." });

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: "Invalid JSON body" }); }

  const history = Array.isArray(body?.history) ? body.history : [];
  if (!history.some(m => m.role === "user" && String(m.text || "").trim())) {
    return res.status(400).json({ error: "Type what you want to add first." });
  }

  const messages = [];
  if (body?.draft && Array.isArray(body.draft) && body.draft.length) {
    messages.push({ role: "user", content: "Current draft entries (revise these):\n" + JSON.stringify(body.draft) });
    messages.push({ role: "assistant", content: "Understood — I'll revise those." });
  }
  history.forEach(m => {
    const text = String(m.text || "").trim();
    if (text) messages.push({ role: m.role === "assistant" ? "assistant" : "user", content: text });
  });
  if (messages[messages.length - 1]?.role !== "user") messages.push({ role: "user", content: "Please continue." });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const resp = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1500,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "return_entries" },
      messages,
    });
    const toolUse = (resp.content || []).find(b => b.type === "tool_use" && b.name === "return_entries");
    if (!toolUse || !toolUse.input) return res.status(502).json({ error: "The assistant didn't return a usable result. Try rephrasing." });
    const out = toolUse.input;
    return res.status(200).json({
      need_more: !!out.need_more,
      question: out.question || "",
      note: out.note || "",
      entries: Array.isArray(out.entries) ? out.entries : [],
    });
  } catch (err) {
    console.error("playbook-assist error:", err);
    const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    return res.status(status).json({ error: err?.message || "Assist failed" });
  }
}
