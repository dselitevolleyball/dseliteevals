// The directors' marketing rules (Marketing → Settings → Rules), e.g. "Don't
// combine sport programming and birthday parties". Each rule is plain words
// that every writer (Claude: posts, emails, rewrites, ideas, reels, spotlight
// drafts) is told to follow, and - when it is about keeping lines apart - a
// structured part the planner enforces itself and the copy is checked
// against:
//   { id, text, active, apart: [[lines], [lines]] | null }
// "apart" means nothing from one side shares a post, story or email with
// anything from the other side (the roundup's programs and closing line, the
// month preview's list, and the words of the copy).
// Shared by the server (api/_lib/marketing-*.js) and HQ (Settings → Rules).

import { LINE_KEYS, lineLabel } from "./marketing-plan.js";

export const SPORT_LINES = ["volleyball", "basketball", "reach", "camp_elevate"];

const clean = (ls) => [...new Set((Array.isArray(ls) ? ls : []).filter(l => LINE_KEYS.includes(l)))];
export function normRules(rules) {
  return (Array.isArray(rules) ? rules : []).map((r, i) => {
    const text = String(r?.text || "").trim().slice(0, 300);
    let apart = Array.isArray(r?.apart) && r.apart.length === 2 ? [clean(r.apart[0]), clean(r.apart[1])] : null;
    if (apart) { apart[1] = apart[1].filter(l => !apart[0].includes(l)); if (!apart[0].length || !apart[1].length) apart = null; }
    return { id: String(r?.id || "").slice(0, 40) || `r${Date.now().toString(36)}${i}`, text, active: r?.active !== false, apart };
  }).filter(r => r.text).slice(0, 40);
}
const live = (rules) => normRules(rules).filter(r => r.active);

// Do these two lines have to stay apart?
export function clash(a, b, rules) {
  if (!a || !b || a === b) return null;
  for (const r of live(rules)) if (r.apart && ((r.apart[0].includes(a) && r.apart[1].includes(b)) || (r.apart[1].includes(a) && r.apart[0].includes(b)))) return r;
  return null;
}
// The lines a piece already has may share it with `line`?
export const fits = (line, lines, rules) => !lines.some(l => clash(l, line, rules));
// Every line kept apart from any of `lines`.
export function apartFrom(lines, rules) {
  const out = new Set();
  for (const l of lines) for (const k of LINE_KEYS) if (clash(l, k, rules)) out.add(k);
  return [...out];
}

// Words that say a piece is about a line - the check after the copy is written.
export const LINE_WORDS = {
  volleyball: /\bvolleyball\b/i, basketball: /\bbasketball\b|\bhoops\b/i, reach: /\bReach Performance\b|\bReach\b(?= (?:training|sessions?|athletes?|program))/,
  camp_elevate: /\bCamp Elevate\b/i, parties: /\bbirthdays?\b|\bpart(?:y|ies)\b/i, rentals: /\bcourt rentals?\b|\brent (?:a|the) court\b/i, open_gym: /\bopen gym\b/i,
};
// -> the rules a piece's words break, given the lines the piece is about.
export function rulesBroken(text, lines, rules) {
  const t = String(text || ""), on = clean(lines);
  const out = [];
  for (const r of live(rules)) {
    if (!r.apart) continue;
    for (const [mine, theirs] of [[r.apart[0], r.apart[1]], [r.apart[1], r.apart[0]]]) {
      if (!on.some(l => mine.includes(l)) || on.some(l => theirs.includes(l))) continue;
      const hit = theirs.find(l => LINE_WORDS[l]?.test(t));
      if (hit) { out.push(`${r.text} (mentions ${lineLabel(hit).toLowerCase()})`); break; }
    }
  }
  return out;
}

// For Claude's instructions. "" when there are none.
export function rulesText(rules) {
  const rs = live(rules);
  if (!rs.length) return "";
  return `The directors' rules - always follow these; they outrank everything except the facts rules:\n${rs.map(r => `- ${r.text}${r.apart ? ` (never put ${r.apart[0].map(lineLabel).join(" / ")} together with ${r.apart[1].map(lineLabel).join(" / ")} in the same post, story, email or text - not even a mention)` : ""}`).join("\n")}`;
}

// A first reading of a rule without Claude: "X and Y" kept apart, by keywords.
const WORDS = [
  [SPORT_LINES, /\bsports?\b|\bathletic|\bprogram(?:s|ming)?\b|\btraining\b/i],
  [["volleyball"], /volleyball/i], [["basketball"], /basketball|hoops/i], [["reach"], /\breach\b/i], [["camp_elevate"], /camp/i],
  [["parties"], /birthday|part(?:y|ies)/i], [["rentals"], /rental|rent\b/i], [["open_gym"], /open gym/i],
];
export function guessApart(text) {
  const t = String(text || "");
  if (!/\b(?:don'?t|do not|never|no|keep|separate|avoid|not)\b/i.test(t)) return null;
  const found = WORDS.map(([ls, re]) => { const m = re.exec(t); return m ? { ls, at: m.index } : null; }).filter(Boolean).sort((a, b) => a.at - b.at);
  // the specific line beats the general "sports" when both match the same words
  const sides = [];
  for (const f of found) { const prev = sides[sides.length - 1]; if (prev && f.ls.every(l => prev.includes(l))) continue; if (prev && prev.every(l => f.ls.includes(l))) { sides[sides.length - 1] = f.ls; continue; } sides.push(f.ls); }
  if (sides.length < 2) return null;
  const a = clean(sides[0]), b = clean(sides[1]).filter(l => !a.includes(l));
  return a.length && b.length ? [a, b] : null;
}
