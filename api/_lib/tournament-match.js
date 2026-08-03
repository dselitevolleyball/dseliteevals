// Match a registration email's event name to a tournament row.
//
// The names differ a lot. The email says "2027 adidas Lone Star Classic
// National Qualifier #2: OKLAHOMA CITY (14 ULAPS)"; the row says "Lone Star
// Classic Girls Junior National Qualifier Weekend 2 — Oklahoma City
// (Convention Center)". So: strip the noise, score on shared words, and only
// claim a match when it's clearly ahead of the runner-up.
//
// A wrong auto-link is worse than none — it would flip the wrong teams to
// "registered" and put the cost on the wrong event. When in doubt, return null
// and let the review screen ask.

const NOISE = new Set([
  "the","and","of","a","an","at","in","for","girls","boys","2024","2025","2026","2027","2028",
  "adidas","nike","usav","usa","volleyball","tournament","event","presented","by",
]);

const words = (s) => String(s || "")
  .toLowerCase()
  .replace(/[#—–\-:,()\/]/g, " ")
  .replace(/[^a-z0-9 ]/g, "")
  .split(/\s+/)
  .filter(w => w && !NOISE.has(w));

// "weekend 2" and "#2" mean the same thing; keep the number as a strong signal.
const numbers = (s) => new Set(String(s || "").match(/(?:#|weekend\s*|wk\s*)(\d+)/gi)?.map(x => x.replace(/\D/g, "")) || []);

export function matchTournament(eventName, tournaments) {
  const ew = new Set(words(eventName));
  if (!ew.size || !Array.isArray(tournaments) || !tournaments.length) return null;
  const en = numbers(eventName);

  const scored = tournaments.map(t => {
    const tw = new Set(words(t.name));
    let shared = 0;
    for (const w of ew) if (tw.has(w)) shared++;
    // Jaccard-ish: reward overlap, penalise names that share little either way.
    const denom = Math.max(ew.size, tw.size) || 1;
    let score = shared / denom;
    const tn = numbers(t.name);
    if (en.size && tn.size) {
      const same = [...en].some(x => tn.has(x));
      score += same ? 0.25 : -0.35;      // "#2" vs "Weekend 3" is a real mismatch
    }
    return { t, score, shared };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0], next = scored[1];
  // Needs real overlap, and needs to be clearly ahead of the alternative.
  if (!best || best.shared < 2 || best.score < 0.45) return null;
  if (next && best.score - next.score < 0.12) return null;
  return { id: best.t.id, name: best.t.name, score: Number(best.score.toFixed(2)) };
}
