// Every Claude client HQ makes comes from here, so every call is logged
// (Product -> Usage): tokens, cost, which feature, how long, and the latest
// rate-limit headers Anthropic sent back.
//
//   const client = claudeClient("marketing-copy", { timeout: 60000, maxRetries: 1 });
//
// It is a plain Anthropic client with a fetch that watches /v1/messages
// responses: a JSON reply is read from a clone, a streamed one from a tee of
// the stream, so the caller sees exactly what it would have. Logging never
// throws and never delays the caller (the database write is not awaited).

import Anthropic from "@anthropic-ai/sdk";
import { costOf } from "../../shared/ai-pricing.js";

const env = () => process.env;
let lastLimits = 0;

async function rest(path, body, prefer = "return=minimal") {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env();
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: prefer },
    body: JSON.stringify(body),
  }).catch(() => {});
}

export function logUsage({ feature, model, usage = {}, ms = null, status = 200, source = "hq", item_id = null, run_id = null }) {
  const row = {
    source, feature: feature || null, model: model || null, ms, status, item_id, run_id,
    input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0,
    cache_read_tokens: usage.cache_read_input_tokens || 0, cache_write_tokens: usage.cache_creation_input_tokens || 0,
    cost_usd: Number(costOf(model, usage).toFixed(6)),
  };
  return rest("ai_usage", row).catch(() => {});
}

function saveLimits(headers, model) {
  if (Date.now() - lastLimits < 60000) return;
  const h = {};
  headers.forEach((v, k) => { if (/^(anthropic-ratelimit-|x-ratelimit-|retry-after)/i.test(k)) h[k.toLowerCase()] = v; });
  if (!Object.keys(h).length) return;
  lastLimits = Date.now();
  rest("hq_kv?on_conflict=key", { key: "anthropic_ratelimit", value: { headers: h, model, at: new Date().toISOString() }, updated_at: new Date().toISOString() }, "resolution=merge-duplicates,return=minimal");
}

// SSE: usage arrives in message_start (input side) and message_delta (output side).
async function readStream(stream, done) {
  const reader = stream.getReader(), dec = new TextDecoder();
  let buf = "", model = null; const usage = {};
  try {
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        try {
          const ev = JSON.parse(line.slice(5));
          if (ev.type === "message_start") { model = ev.message?.model; Object.assign(usage, ev.message?.usage || {}); }
          if (ev.type === "message_delta" && ev.usage) for (const [k, v] of Object.entries(ev.usage)) if (typeof v === "number" && v) usage[k] = v;
        } catch { /* a partial or non-JSON line */ }
      }
    }
  } catch { /* the caller cancelled the stream */ }
  done(model, usage);
}

function loggingFetch(feature, base) {
  return async (url, init) => {
    const t0 = Date.now();
    const res = await (base || fetch)(url, init);
    const u = String(url);
    if (!/\/v1\/messages(\?|$)/.test(u)) return res;
    try {
      saveLimits(res.headers);
      const ms = () => Date.now() - t0;
      if (!res.ok) { logUsage({ feature, model: null, ms: ms(), status: res.status }); return res; }
      if (/event-stream/.test(res.headers.get("content-type") || "") && res.body) {
        const [mine, theirs] = res.body.tee();
        readStream(mine, (model, usage) => logUsage({ feature, model, usage, ms: ms(), status: res.status }));
        return new Response(theirs, { status: res.status, statusText: res.statusText, headers: res.headers });
      }
      res.clone().json().then(j => logUsage({ feature, model: j.model, usage: j.usage, ms: ms(), status: res.status })).catch(() => {});
    } catch { /* never break the call over logging */ }
    return res;
  };
}

export function claudeClient(feature, opts = {}) {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, ...opts, fetch: loggingFetch(feature, opts.fetch) });
}
