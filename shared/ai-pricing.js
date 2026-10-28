// Claude API list prices, US$ per million tokens (Anthropic first-party rates,
// Oct 2026). Cache writes are the 5-minute rate (1.25x input). Used to price
// every call HQ logs in ai_usage and to show what an agent run cost.
// A model not listed (or a dated snapshot) matches by prefix; unknown models
// are priced at Opus rates so nothing is ever shown as free by mistake.

export const MODELS = [
  { id: "claude-fable-5-1", label: "Fable 5.1", tier: "Most capable", in: 10, out: 50, read: 0.25, write: 12.5 },
  { id: "claude-opus-5-5", label: "Opus 5.5", tier: "Default", in: 4, out: 20, read: 0.2, write: 5 },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", tier: "Fast + capable", in: 2, out: 10, read: 0.2, write: 2.5 },
  { id: "claude-haiku-5-5", label: "Haiku 5.5", tier: "Cheapest", in: 0.1, out: 0.5, read: 0.01, write: 0.125 },
];
const OLDER = [
  { id: "claude-fable-5", in: 10, out: 50, read: 1, write: 12.5 },
  { id: "claude-opus-5", in: 5, out: 25, read: 0.5, write: 6.25 },
  { id: "claude-opus-4", in: 5, out: 25, read: 0.5, write: 6.25 },
  { id: "claude-sonnet-5", in: 2, out: 10, read: 0.2, write: 2.5 },
  { id: "claude-sonnet-4", in: 3, out: 15, read: 0.3, write: 3.75 },
  { id: "claude-haiku-4", in: 1, out: 5, read: 0.1, write: 1.25 },
];

// Effort: how hard the model thinks (and how many tokens it spends).
export const EFFORTS = [
  ["low", "Low", "Quick fixes and copy changes"],
  ["medium", "Medium", "Small, clear features"],
  ["high", "High", "Most features (default)"],
  ["xhigh", "Extra high", "Bigger or trickier features"],
  ["max", "Max", "Hard problems where correctness matters most"],
];

export function priceOf(model) {
  const m = String(model || "");
  return [...MODELS, ...OLDER].filter(p => m === p.id || m.startsWith(p.id)).sort((a, b) => b.id.length - a.id.length)[0] || MODELS[1];
}

// usage: the API's usage object (input_tokens, output_tokens,
// cache_read_input_tokens, cache_creation_input_tokens).
export function costOf(model, u = {}) {
  const p = priceOf(model);
  return ((u.input_tokens || 0) * p.in + (u.output_tokens || 0) * p.out + (u.cache_read_input_tokens || 0) * p.read + (u.cache_creation_input_tokens || 0) * p.write) / 1e6;
}

export const modelLabel = (id) => MODELS.find(m => m.id === id)?.label || id;
