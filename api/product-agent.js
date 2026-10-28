// The coding agent's line back to HQ (Product board). Called only by
// .github/workflows/feature-agent.yml in one of the repos in shared/product.js.
//
// Auth: a GitHub Actions OIDC token (audience "dssc-hq"), checked against
// GitHub's published keys: it must come from the agent workflow file on the
// main branch of an allowed repo, started by workflow_dispatch. No secret is
// stored in GitHub - the Anthropic key the agent runs on is handed over here,
// only to that workflow.
//
// POST { action: "claim" }  -> { job } (the oldest waiting run for this repo) or { job: null }
// POST { action: "report", run_id, status: running|succeeded|failed, ...results }

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { REPOS, WORKFLOW_FILE, itemKey, branchFor, STATUS_LABEL } from "../shared/product.js";

export const config = { maxDuration: 30 };
const ISS = "https://token.actions.githubusercontent.com";
const AUD = "dssc-hq";
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const b64 = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
let jwks = { at: 0, keys: [] };

async function verifyGithub(token) {
  const [h, p, sig] = String(token || "").split(".");
  if (!h || !p || !sig) throw fail(401, "No GitHub identity token");
  let header, claims;
  try { header = JSON.parse(b64(h).toString()); claims = JSON.parse(b64(p).toString()); } catch { throw fail(401, "Not a GitHub identity token"); }
  if (header.alg !== "RS256") throw fail(401, "Unexpected token algorithm");
  if (Date.now() - jwks.at > 3600e3 || !jwks.keys.some(k => k.kid === header.kid)) {
    const r = await fetch(`${ISS}/.well-known/jwks`); jwks = { at: Date.now(), keys: (await r.json()).keys || [] };
  }
  const jwk = jwks.keys.find(k => k.kid === header.kid);
  if (!jwk) throw fail(401, "Unknown GitHub signing key");
  const ok = crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), crypto.createPublicKey({ key: jwk, format: "jwk" }), b64(sig));
  if (!ok) throw fail(401, "Bad signature");
  const now = Date.now() / 1000;
  if (claims.iss !== ISS || claims.aud !== AUD || !(claims.exp > now) || (claims.nbf && claims.nbf > now + 60)) throw fail(401, "Token is expired or not for HQ");
  if (!REPOS[claims.repository]) throw fail(403, `Agents aren't set up for ${claims.repository}`);
  if (claims.job_workflow_ref !== `${claims.repository}/.github/workflows/${WORKFLOW_FILE}@refs/heads/main` || claims.ref !== "refs/heads/main") throw fail(403, "Only the agent workflow on main may ask for work");
  if (claims.event_name !== "workflow_dispatch") throw fail(403, "Only a dispatched run may ask for work");
  return claims;
}

function promptFor(item, run, comments, prevRuns) {
  const repo = REPOS[item.repo];
  const ctx = item.request_context || {};
  const lines = [
    `You are a senior engineer on ${repo.label} (${item.repo}). ${run.kind === "revise" ? "You built the work item below on this branch already; make the changes Drew asks for in this round." : `Build the work item below.`}`,
    "",
    `## ${itemKey(item.id)}: ${item.title}`,
    `Type: ${item.kind}${item.area ? ` · Area: ${item.area}` : ""}${item.priority ? ` · Priority: ${["", "urgent", "high", "medium", "low"][item.priority]}` : ""}`,
    item.requested_name ? `Requested by ${item.requested_name}${ctx.view_label || ctx.view ? ` from the "${ctx.view_label || ctx.view}" screen` : ""}.` : "",
    "",
    item.body || "(no description)",
  ];
  if (comments.length) lines.push("", "## Notes on the card", ...comments.map(c => `- ${c.by_name || "Someone"}: ${c.body}`));
  if (run.kind === "revise") {
    const last = prevRuns.find(r => r.summary);
    if (last) lines.push("", "## What the last round did (its summary)", last.summary.slice(0, 3000));
    lines.push("", "## Changes Drew wants now", run.instructions || "");
  }
  lines.push("", "## How to work",
    "- Read CLAUDE.md (and any CLAUDE.md in folders you touch) first, and follow it.",
    "- Make the change completely. Match the surrounding code: its naming, comment density and idioms. Keep the change focused on this item.",
    `- Before you finish, run \`${repo.build}\` and fix every error it reports.`,
    "- Do NOT commit, push, create branches or open pull requests - the workflow does that after you finish.",
    "- Never read or print secrets, never edit .env files, never call production APIs, databases or third-party services. If the item needs a database change, add a SQL file under migrations/ and say so in your summary - Drew applies it.",
    "- If something in the request is ambiguous, make the most sensible choice and say what you chose.",
    "", "When you are done, reply with a short summary for Drew (plain words, no code): what you changed, the files, anything he must do before shipping (like a migration), and how to try it on the preview.");
  return lines.filter(x => x !== null).join("\n");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY } = process.env;
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const claims = await verifyGithub(String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const runUrl = `https://github.com/${claims.repository}/actions/runs/${claims.run_id}`;

    if (b.action === "claim") {
      const { data: waiting } = await sb.from("product_runs").select("*").eq("status", "queued").eq("repo", claims.repository).order("created_at").limit(5);
      for (const w of waiting || []) {
        const { data: run } = await sb.from("product_runs").update({ status: "running", claimed_at: new Date().toISOString(), github_run_url: runUrl, error: null }).eq("id", w.id).eq("status", "queued").select("*").maybeSingle();
        if (!run) continue;   // another run took it
        const { data: item } = await sb.from("product_items").select("*").eq("id", run.item_id).single();
        const [{ data: comments }, { data: prevRuns }] = await Promise.all([
          sb.from("product_events").select("body, by_name").eq("item_id", item.id).eq("kind", "comment").order("at"),
          sb.from("product_runs").select("summary, kind, status").eq("item_id", item.id).neq("id", run.id).order("created_at", { ascending: false }),
        ]);
        const branch = item.branch || branchFor(item.id);
        if (!item.branch) await sb.from("product_items").update({ branch }).eq("id", item.id);
        await sb.from("product_events").insert({ item_id: item.id, kind: "run", body: `The agent started (${run.kind}) - ${runUrl}`, data: { run_id: run.id } });
        const repo = REPOS[claims.repository];
        return res.status(200).json({ job: {
          run_id: run.id, item_id: item.id, key: itemKey(item.id), kind: run.kind, title: item.title,
          model: run.model, effort: run.effort, max_turns: run.max_turns || 80, max_budget_usd: Number(run.max_budget_usd || 10),
          branch, pr_number: item.pr_number, author: repo.author, node: repo.node, install: repo.install, build: repo.build,
          prompt: run.kind === "ship" ? null : promptFor(item, run, comments || [], prevRuns || []),
          anthropic_api_key: run.kind === "ship" ? null : ANTHROPIC_API_KEY,
        } });
      }
      return res.status(200).json({ job: null });
    }

    if (b.action === "report") {
      const { data: run } = await sb.from("product_runs").select("*").eq("id", Number(b.run_id)).maybeSingle();
      if (!run || run.repo !== claims.repository) throw fail(404, "No such run for this repo");
      if (run.status === "canceled") return res.status(200).json({ ok: true, canceled: true });
      const num = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
      const u = b.usage || {};
      const patch = {
        github_run_url: runUrl,
        ...(b.branch ? { branch: String(b.branch).slice(0, 120) } : {}),
        ...(num(b.pr_number) ? { pr_number: num(b.pr_number) } : {}),
        ...(b.pr_url ? { pr_url: String(b.pr_url).slice(0, 300) } : {}),
        ...(b.preview_url ? { preview_url: String(b.preview_url).slice(0, 300) } : {}),
        ...(b.summary ? { summary: String(b.summary).slice(0, 20000) } : {}),
        ...(num(b.cost_usd) != null ? { cost_usd: num(b.cost_usd) } : {}),
        ...(num(u.input_tokens) != null ? { input_tokens: num(u.input_tokens), output_tokens: num(u.output_tokens), cache_read_tokens: num(u.cache_read_input_tokens), cache_write_tokens: num(u.cache_creation_input_tokens) } : {}),
        ...(num(b.num_turns) != null ? { num_turns: num(b.num_turns) } : {}),
        ...(num(b.duration_ms) != null ? { duration_ms: num(b.duration_ms) } : {}),
      };
      const done = ["succeeded", "failed"].includes(b.status);
      if (done) Object.assign(patch, { status: b.status, finished_at: new Date().toISOString(), error: b.status === "failed" ? String(b.error || "The run failed - see the GitHub log").slice(0, 2000) : null });
      await sb.from("product_runs").update(patch).eq("id", run.id);
      // Cost lands in Usage once per run.
      if (done && num(b.cost_usd) != null && !run.cost_usd) {
        await sb.from("ai_usage").insert({ source: "agent", feature: `agent-${run.kind}`, model: run.model, input_tokens: num(u.input_tokens) || 0, output_tokens: num(u.output_tokens) || 0, cache_read_tokens: num(u.cache_read_input_tokens) || 0, cache_write_tokens: num(u.cache_creation_input_tokens) || 0, cost_usd: num(b.cost_usd), ms: num(b.duration_ms), status: b.status === "failed" ? 500 : 200, item_id: run.item_id, run_id: run.id });
      }
      if (done) {
        const { data: item } = await sb.from("product_items").select("*").eq("id", run.item_id).single();
        const ok = b.status === "succeeded";
        const status = run.kind === "ship" ? (ok ? "shipped" : "review") : (ok ? "review" : (item.pr_url || item.branch && run.kind === "revise" ? "review" : "backlog"));
        await sb.from("product_items").update({
          status, updated_at: new Date().toISOString(),
          ...(patch.branch ? { branch: patch.branch } : {}), ...(patch.pr_number ? { pr_number: patch.pr_number } : {}), ...(patch.pr_url ? { pr_url: patch.pr_url } : {}), ...(patch.preview_url ? { preview_url: patch.preview_url } : {}),
        }).eq("id", item.id);
        const cost = num(b.cost_usd) != null ? ` · $${num(b.cost_usd).toFixed(2)}` : "";
        await sb.from("product_events").insert({ item_id: item.id, kind: "run", data: { run_id: run.id, status: b.status },
          body: ok ? (run.kind === "ship" ? `Shipped - merged to main${cost}` : `The agent finished${cost} - ${STATUS_LABEL[status]}${patch.preview_url ? `, preview: ${patch.preview_url}` : ""}`) : `The agent run failed: ${String(b.error || "see the GitHub log").slice(0, 400)}` });
      }
      return res.status(200).json({ ok: true });
    }
    throw fail(400, "Unknown action");
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}
