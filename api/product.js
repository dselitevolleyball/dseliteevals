// Product board (Drew, Oct 28 2026): a Linear-style board for HQ features,
// staff feedback, coding agents, and Claude usage. See
// migrations/20261105_product_board.sql and shared/product.js.
//
// POST /api/product  { action, ... }   Authorization: Bearer <session token>
// Anyone signed in to HQ (approved coach / DSSC staff, or an owner):
//   boot                 -> { me, settings? } (approvers also get items + github status)
//   request { title, body, kind, area?, context?, screenshot? (data URL) }  the 💡 Feedback popup
//   mine                 -> the requests I sent, with where they are
//   vote { id }          +1 / un-+1 a request
// Approvers (owners and HQ admins):
//   items                -> every card (declined/canceled from the last 60 days)
//   item { id }          -> { item, events, runs, screenshot_url }
//   create { item }      a card straight into Backlog
//   save { item }        edit fields (title, body, kind, priority, area, repo, model, effort...)
//   move { id, status, sort? }
//   decide { id, approve, note? }   Inbox -> Backlog (approve) or Declined; the requester hears in Slack (email if not in Slack)
//   comment { id, body }
//   build { id }         queue an agent run that builds it on a branch and opens a PR
//   revise { id, instructions }   another agent round on the same branch
//   ship { id }          merge the branch to main (the run reports back when it's live)
//   cancel_run { run_id }
//   redispatch { run_id }         start GitHub again for a queued run
//   usage { days? }      -> totals by day / feature / model, this month, agent runs, rate limits, org report
//   settings { patch }   budget, defaults, notify, github_token / admin_key (write-only)
//   test_github          -> can HQ start the agent workflow in each repo?
//
// Agent runs: GitHub Actions in the card's repo (.github/workflows/feature-agent.yml)
// is started here with the GitHub token from Settings and talks back to
// /api/product-agent (GitHub OIDC - no secret in GitHub).

import { createClient } from "@supabase/supabase-js";
import { OWNER_EMAILS, sendMail, esc } from "./_lib/projects.js";
import { STATUSES, KINDS, REPOS, WORKFLOW_FILE, itemKey, repoFor } from "../shared/product.js";
import { MODELS, EFFORTS } from "../shared/ai-pricing.js";
import { productSlack, SLACK_HOOK, slackCfg, saveSlackCfg, slackApi, slackTarget, postCard, requestMessage, dmPerson, requesterMessage } from "./_lib/product-slack.js";

export const config = { maxDuration: 60 };
const nrm = (v) => String(v || "").trim().toLowerCase();
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const STATUS_KEYS = STATUSES.map(([k]) => k);
const HQ_URL = "https://dseliteevals.vercel.app/?view=product";
const DEFAULTS = { budget_monthly: 300, model: "claude-opus-5-5", effort: "high", max_turns: 80, max_budget_usd: 10, notify: ["drew@dselitevolleyball.com"], email_requests: false };

async function whoIs(sb, req) {
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return null;
  if (bearer === process.env.SUPABASE_SERVICE_ROLE_KEY) return { email: "drew@dselitevolleyball.com", name: "Drew Rose", approver: true, service: true };
  const { data: { user } = {} } = await sb.auth.getUser(bearer).catch(() => ({ data: {} }));
  const email = nrm(user?.email);
  if (!email) return null;
  const { data: c } = await sb.from("coaches").select("display_name, is_admin, is_approved").ilike("email", email).maybeSingle();
  const owner = OWNER_EMAILS.includes(email);
  if (!owner && !c?.is_approved) return null;
  return { email, name: c?.display_name || email.split("@")[0], approver: owner || !!c?.is_admin };
}

async function kv(sb, key) { const { data } = await sb.from("hq_kv").select("value").eq("key", key).maybeSingle(); return data?.value ?? null; }
async function setKv(sb, key, value, by, secret = false) {
  await sb.from("hq_kv").upsert({ key, value, secret, updated_at: new Date().toISOString(), updated_by: by }, { onConflict: "key" });
}
async function settingsOf(sb) { return { ...DEFAULTS, ...((await kv(sb, "product_settings")) || {}) }; }
// One token per GitHub account (dselitevolleyball, drew-dssc): a fine-grained
// token only reaches one owner's repos.
const githubTokens = async (sb) => { const v = (await kv(sb, "github_token")) || {}; return v.tokens || (v.token ? { "*": v.token } : {}); };
const githubToken = async (sb, repo) => { const t = await githubTokens(sb); const owner = String(repo || "").split("/")[0]; return t[owner] || t["*"] || process.env.GITHUB_AGENT_TOKEN || null; };

async function event(sb, item_id, me, kind, body, data = {}) {
  await sb.from("product_events").insert({ item_id, kind, body: String(body || "").slice(0, 8000), data, by_email: me?.email || null, by_name: me?.name || null });
}
async function getItem(sb, id) {
  const { data, error } = await sb.from("product_items").select("*").eq("id", Number(id)).maybeSingle();
  if (error) throw fail(500, error.message);
  if (!data) throw fail(404, "No such card");
  return data;
}

// Start the agent workflow in the card's repo. Without a token the run waits
// in the queue; "Run workflow" in GitHub Actions picks it up too.
async function dispatch(sb, repo) {
  const token = await githubToken(sb, repo);
  if (!token) return { ok: false, error: `GitHub isn't connected for ${repo.split("/")[0]} - add a token in Product -> Settings` };
  const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "dssc-hq" },
    body: JSON.stringify({ ref: "main" }),
  }).catch(e => ({ ok: false, status: 0, text: async () => e.message }));
  if (r.ok) return { ok: true };
  const t = (await r.text().catch(() => "")).slice(0, 300);
  return { ok: false, error: r.status === 404 ? `GitHub can't find the agent workflow in ${repo} (or the token can't see that repo)` : r.status === 401 || r.status === 403 ? "GitHub refused the token - it needs Actions: Read and write on this repo" : `GitHub ${r.status}: ${t}` };
}

async function queueRun(sb, me, item, kind, extra = {}) {
  const { data: busy } = await sb.from("product_runs").select("id, kind, status").eq("item_id", item.id).in("status", ["queued", "running"]);
  if ((busy || []).length) throw fail(409, `An agent run is already ${busy[0].status} for this card`);
  if (!REPOS[item.repo]) throw fail(400, `Agents can't work in ${item.repo}`);
  const s = await settingsOf(sb);
  const month = await monthCost(sb);
  if (kind !== "ship" && s.budget_monthly && month >= Number(s.budget_monthly)) throw fail(402, `This month's Claude spend ($${month.toFixed(2)}) has reached the $${s.budget_monthly} budget - raise it in Settings to keep building`);
  const row = { item_id: item.id, kind, status: "queued", repo: item.repo, model: item.model, effort: item.effort, max_turns: item.max_turns, max_budget_usd: item.max_budget_usd, requested_by: me.email, branch: item.branch, pr_number: item.pr_number, pr_url: item.pr_url, ...extra };
  const { data: run, error } = await sb.from("product_runs").insert(row).select("*").single();
  if (error) throw fail(500, error.message);
  const d = await dispatch(sb, item.repo);
  await sb.from("product_runs").update(d.ok ? { dispatched_at: new Date().toISOString() } : { error: d.error }).eq("id", run.id);
  return { run: { ...run, error: d.ok ? null : d.error }, dispatched: d.ok, dispatch_error: d.ok ? null : d.error };
}

async function monthCost(sb) {
  const { data } = await sb.rpc("ai_usage_summary", { p_days: 31 });
  return Number(data?.month?.cost || 0);
}

// Admin API (optional): the whole Anthropic organization's cost this month,
// including anything that isn't HQ. Needs an sk-ant-admin key in Settings.
async function orgReport(sb) {
  const key = (await kv(sb, "anthropic_admin_key"))?.token || process.env.ANTHROPIC_ADMIN_KEY;
  if (!key) return null;
  const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
  const h = { "x-api-key": key, "anthropic-version": "2023-06-01" };
  try {
    const [c, u] = await Promise.all([
      fetch(`https://api.anthropic.com/v1/organizations/cost_report?starting_at=${start.toISOString()}&group_by[]=description&limit=31`, { headers: h }).then(r => r.json()),
      fetch(`https://api.anthropic.com/v1/organizations/usage_report/messages?starting_at=${start.toISOString()}&bucket_width=1d&group_by[]=model&limit=31`, { headers: h }).then(r => r.json()),
    ]);
    if (c.error || u.error) return { error: (c.error || u.error).message || "The Admin API refused the key" };
    let cents = 0; const byModel = {};
    for (const b of c.data || []) for (const r of b.results || []) { const v = Number(r.amount || 0); cents += v; const m = r.model || r.description || "other"; byModel[m] = (byModel[m] || 0) + v; }
    let tokens = 0;
    for (const b of u.data || []) for (const r of b.results || []) tokens += (r.uncached_input_tokens || 0) + (r.output_tokens || 0) + (r.cache_read_input_tokens || 0) + (r.cache_creation?.ephemeral_5m_input_tokens || 0) + (r.cache_creation?.ephemeral_1h_input_tokens || 0);
    return { cost: cents / 100, tokens, by_model: Object.entries(byModel).map(([model, v]) => ({ model, cost: v / 100 })).sort((a, b) => b.cost - a.cost) };
  } catch (e) { return { error: e.message }; }
}

async function uploadShot(sb, dataUrl, by) {
  const m = /^data:(image\/(png|jpeg|webp));base64,(.+)$/.exec(String(dataUrl || ""));
  if (!m) return null;
  const buf = Buffer.from(m[3], "base64");
  if (buf.length > 4e6) throw fail(400, "That picture is too big (4 MB max)");
  const path = `requests/${Date.now()}-${nrm(by).replace(/[^a-z0-9]/g, "").slice(0, 20)}.${m[2] === "jpeg" ? "jpg" : m[2]}`;
  const { error } = await sb.storage.from("product-media").upload(path, buf, { contentType: m[1] });
  if (error) throw fail(500, "Couldn't save the picture: " + error.message);
  return path;
}
const signed = async (sb, path) => path ? (await sb.storage.from("product-media").createSignedUrl(path, 3600)).data?.signedUrl || null : null;

// The requester hears about it in Slack (a DM from the Product bot); email
// only when Slack can't reach them (no bot, or they're not in the workspace).
async function tellRequester(sb, item, approve, note, me) {
  if (!item.requested_by || nrm(item.requested_by) === nrm(me.email)) return;
  const dm = await dmPerson(sb, item.requested_by, requesterMessage(item, approve ? "approved" : "declined", { by: me.name, note })).catch(e => ({ ok: false, error: e.message }));
  if (dm.ok) return;
  const first = String(item.requested_name || "").split(/\s+/)[0] || "there";
  const subject = approve ? `Your HQ idea is on the board: ${item.title}` : `About your HQ request: ${item.title}`;
  const line = approve ? "Thanks for the idea - it's been approved and added to the HQ product board." : "Thanks for sending this in. We're not going to build it right now.";
  const html = `<div style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:560px"><p>Hi ${esc(first)},</p><p>${line}</p><p style="padding:10px 14px;background:#f4f4f5;border-radius:8px"><b>${esc(item.title)}</b>${item.body ? `<br><span style="color:#555">${esc(String(item.body).slice(0, 400))}</span>` : ""}</p>${note ? `<p>${esc(me.name)}: ${esc(note)}</p>` : ""}<p style="color:#666">You can see where your requests are from the 💡 Feedback button in HQ.</p></div>`;
  await sendMail({ to: item.requested_by, subject, html, text: `${line}\n\n${item.title}${note ? `\n\n${me.name}: ${note}` : ""}` }).catch(() => {});
}

const ITEM_FIELDS = ["title", "body", "kind", "priority", "area", "repo", "labels", "model", "effort", "max_turns", "max_budget_usd", "status", "sort"];
function cleanItem(p, s) {
  const out = {};
  for (const k of ITEM_FIELDS) if (k in p) out[k] = p[k];
  if ("title" in out) { out.title = String(out.title || "").trim().slice(0, 200); if (!out.title) throw fail(400, "A title is required"); }
  if ("body" in out) out.body = String(out.body || "").slice(0, 20000);
  if ("kind" in out && !KINDS.some(([k]) => k === out.kind)) out.kind = "feature";
  if ("priority" in out) out.priority = Math.max(0, Math.min(4, Number(out.priority) || 0));
  if ("status" in out && !STATUS_KEYS.includes(out.status)) throw fail(400, "Unknown status");
  if ("repo" in out && !REPOS[out.repo]) throw fail(400, "Unknown repo");
  if ("model" in out && !MODELS.some(m => m.id === out.model)) throw fail(400, "Unknown model");
  if ("effort" in out && !EFFORTS.some(([k]) => k === out.effort)) throw fail(400, "Unknown effort");
  if ("max_turns" in out) out.max_turns = Math.max(5, Math.min(400, Number(out.max_turns) || s.max_turns));
  if ("max_budget_usd" in out) out.max_budget_usd = Math.max(0.5, Math.min(200, Number(out.max_budget_usd) || s.max_budget_usd));
  if ("labels" in out) out.labels = (Array.isArray(out.labels) ? out.labels : String(out.labels || "").split(",")).map(x => String(x).trim()).filter(Boolean).slice(0, 10);
  if ("area" in out && out.area && !("repo" in p)) out.repo = repoFor(out.area);
  return out;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const me = await whoIs(sb, req);
    if (!me) throw fail(403, "Sign in to HQ first");
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const out = await act(sb, me, b);
    return res.status(200).json({ ok: true, ...out });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

// Also used by /api/product-slack (Slack buttons and thread replies act as the person who clicked).
export async function act(sb, me, b) {
  const approverOnly = () => { if (!me.approver) throw fail(403, "Only Drew and HQ admins can do that"); };
  const s = await settingsOf(sb);

  switch (b.action) {
    case "boot": {
      if (!me.approver) return { me };
      const { github_token, ...pub } = s; // never sent back
      const sc = await slackCfg(sb);
      pub.slack = !!(sc.url || sc.bot_token);
      pub.slack_bot = !!sc.bot_token; pub.slack_secret = !!sc.signing_secret; pub.slack_channel = sc.channel_name || null;
      const tok = await githubTokens(sb);
      return { me, settings: pub, github: Object.keys(tok), owners: [...new Set(Object.keys(REPOS).map(r => r.split("/")[0]))], admin_key: !!((await kv(sb, "anthropic_admin_key"))?.token || process.env.ANTHROPIC_ADMIN_KEY), models: MODELS, efforts: EFFORTS, repos: REPOS };
    }

    case "request": {
      const title = String(b.title || "").trim().slice(0, 200);
      if (title.length < 3) throw fail(400, "Give it a short title");
      const shot = b.screenshot ? await uploadShot(sb, b.screenshot, me.email) : null;
      const ctx = b.context && typeof b.context === "object" ? b.context : {};
      const area = String(b.area || ctx.area || "").slice(0, 60) || null;
      const row = {
        title, body: String(b.body || "").slice(0, 8000), kind: KINDS.some(([k]) => k === b.kind) ? b.kind : "feature", status: "inbox",
        area, repo: repoFor(area), requested_by: me.email, requested_name: me.name, created_by: me.email, screenshot_url: shot,
        request_context: { view: String(ctx.view || "").slice(0, 60), view_label: String(ctx.view_label || "").slice(0, 80), url: String(ctx.url || "").slice(0, 300), app: String(ctx.app || "").slice(0, 20), ua: String(ctx.ua || "").slice(0, 200) },
        model: s.model, effort: s.effort, max_turns: s.max_turns, max_budget_usd: s.max_budget_usd, votes: [me.email], sort: -Date.now() / 1000,
      };
      const { data, error } = await sb.from("product_items").insert(row).select("id, title").single();
      if (error) throw fail(500, error.message);
      await event(sb, data.id, me, "system", `${me.name} sent this in from ${row.request_context.view_label || row.request_context.view || "HQ"}`);
      const where = row.request_context.view_label ? ` from _${row.request_context.view_label}_ (${row.request_context.app === "dssc" ? "DSSC" : "DS Elite"})` : "";
      await postCard(sb, { ...row, id: data.id }, requestMessage({ ...row, id: data.id }, me.name, where, !!shot)).catch(() => {});
      // Email only if it's switched on in Settings (Slack is the default since Oct 28 2026).
      const to = s.email_requests ? (s.notify || []).filter(e => /@/.test(e) && nrm(e) !== me.email) : [];
      for (const addr of to) await sendMail({ to: addr, subject: `💡 New HQ ${row.kind === "bug" ? "bug report" : "request"} from ${me.name}: ${title}`, html: `<div style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;max-width:560px"><p><b>${esc(me.name)}</b> sent ${row.kind === "bug" ? "a bug report" : "an idea"} from <i>${esc(row.request_context.view_label || "HQ")}</i>:</p><p style="padding:10px 14px;background:#f4f4f5;border-radius:8px"><b>${esc(title)}</b><br>${esc(row.body).replace(/\n/g, "<br>")}</p><p><a href="${HQ_URL}&item=${data.id}">Approve or decline it in HQ →</a></p></div>`, text: `${me.name}: ${title}\n\n${row.body}\n\n${HQ_URL}&item=${data.id}` }).catch(() => {});
      return { id: data.id, key: itemKey(data.id) };
    }

    case "mine": {
      const { data } = await sb.from("product_items").select("id, title, kind, status, decision_note, created_at, updated_at, pr_url").eq("requested_by", me.email).order("created_at", { ascending: false }).limit(50);
      return { items: data || [] };
    }

    case "vote": {
      const item = await getItem(sb, b.id);
      const votes = new Set(item.votes || []);
      votes.has(me.email) ? votes.delete(me.email) : votes.add(me.email);
      await sb.from("product_items").update({ votes: [...votes] }).eq("id", item.id);
      return { votes: [...votes] };
    }

    case "items": {
      approverOnly();
      const since = new Date(Date.now() - 60 * 86400000).toISOString();
      const { data, error } = await sb.from("product_items").select("*").or(`status.not.in.(declined,canceled),updated_at.gte.${since}`).order("sort").order("id", { ascending: false }).limit(1000);
      if (error) throw fail(500, error.message);
      const ids = (data || []).map(i => i.id);
      const { data: runs } = ids.length ? await sb.from("product_runs").select("id, item_id, kind, status, cost_usd, created_at, finished_at, error").in("item_id", ids).order("created_at", { ascending: false }) : { data: [] };
      const last = {}, cost = {};
      for (const r of runs || []) { if (!last[r.item_id]) last[r.item_id] = r; cost[r.item_id] = (cost[r.item_id] || 0) + Number(r.cost_usd || 0); }
      return { items: (data || []).map(i => ({ ...i, last_run: last[i.id] || null, agent_cost: cost[i.id] || 0 })) };
    }

    case "item": {
      approverOnly();
      const item = await getItem(sb, b.id);
      const [{ data: events }, { data: runs }] = await Promise.all([
        sb.from("product_events").select("*").eq("item_id", item.id).order("at"),
        sb.from("product_runs").select("*").eq("item_id", item.id).order("created_at", { ascending: false }),
      ]);
      return { item, events: events || [], runs: runs || [], screenshot_url: await signed(sb, item.screenshot_url) };
    }

    case "create": {
      approverOnly();
      const p = cleanItem({ status: "backlog", model: s.model, effort: s.effort, max_turns: s.max_turns, max_budget_usd: s.max_budget_usd, ...b.item }, s);
      if (!p.title) throw fail(400, "A title is required");
      const { data, error } = await sb.from("product_items").insert({ ...p, repo: p.repo || repoFor(p.area), created_by: me.email, decided_by: me.email, decided_at: new Date().toISOString(), sort: p.sort ?? -Date.now() / 1000 }).select("*").single();
      if (error) throw fail(500, error.message);
      await event(sb, data.id, me, "system", `${me.name} created this`);
      return { item: data };
    }

    case "save": {
      approverOnly();
      const item = await getItem(sb, b.item?.id);
      const p = cleanItem(b.item || {}, s);
      delete p.status;
      const { data, error } = await sb.from("product_items").update({ ...p, updated_at: new Date().toISOString() }).eq("id", item.id).select("*").single();
      if (error) throw fail(500, error.message);
      const changed = Object.keys(p).filter(k => JSON.stringify(p[k]) !== JSON.stringify(item[k]) && !["sort", "body"].includes(k));
      if (changed.length) await event(sb, item.id, me, "system", `${me.name} changed ${changed.join(", ")}`, { from: Object.fromEntries(changed.map(k => [k, item[k]])), to: Object.fromEntries(changed.map(k => [k, p[k]])) });
      return { item: data };
    }

    case "move": {
      approverOnly();
      const item = await getItem(sb, b.id);
      if (!STATUS_KEYS.includes(b.status)) throw fail(400, "Unknown status");
      const patch = { status: b.status, updated_at: new Date().toISOString(), ...(typeof b.sort === "number" ? { sort: b.sort } : {}) };
      const { data, error } = await sb.from("product_items").update(patch).eq("id", item.id).select("*").single();
      if (error) throw fail(500, error.message);
      if (b.status !== item.status) await event(sb, item.id, me, "status", `${me.name} moved this to ${STATUSES.find(x => x[0] === b.status)[1]}`, { from: item.status, to: b.status });
      return { item: data };
    }

    case "decide": {
      approverOnly();
      const item = await getItem(sb, b.id);
      const approve = !!b.approve, note = String(b.note || "").trim().slice(0, 1000) || null;
      const { data, error } = await sb.from("product_items").update({ status: approve ? "backlog" : "declined", decided_by: me.email, decided_at: new Date().toISOString(), decision_note: note, updated_at: new Date().toISOString() }).eq("id", item.id).select("*").single();
      if (error) throw fail(500, error.message);
      await event(sb, item.id, me, "decision", `${me.name} ${approve ? "approved" : "declined"} this${note ? `: ${note}` : ""}`, { approve });
      await tellRequester(sb, item, approve, note, me);
      return { item: data };
    }

    case "comment": {
      approverOnly();
      const item = await getItem(sb, b.id);
      const body = String(b.body || "").trim();
      if (!body) throw fail(400, "Write something first");
      await event(sb, item.id, me, "comment", body);
      return {};
    }

    case "build":
    case "revise": {
      approverOnly();
      const item = await getItem(sb, b.id);
      if (!String(item.body || "").trim() && b.action === "build") throw fail(400, "Write what to build in the description first - the agent works from it");
      const instructions = b.action === "revise" ? String(b.instructions || "").trim().slice(0, 8000) : null;
      if (b.action === "revise" && !instructions) throw fail(400, "Say what to change");
      if (b.action === "revise" && !item.branch) throw fail(400, "Nothing has been built yet - use Build first");
      const r = await queueRun(sb, me, item, b.action, { instructions });
      await sb.from("product_items").update({ status: "building", updated_at: new Date().toISOString() }).eq("id", item.id);
      await event(sb, item.id, me, "run", b.action === "build" ? `${me.name} handed this to an agent (${item.model}, ${item.effort} effort)` : `${me.name} asked the agent for changes: ${instructions}`, { run_id: r.run.id });
      return r;
    }

    case "ship": {
      approverOnly();
      const item = await getItem(sb, b.id);
      if (!item.branch) throw fail(400, "Nothing to ship - no branch has been built");
      const r = await queueRun(sb, me, item, "ship");
      await event(sb, item.id, me, "run", `${me.name} said ship it`, { run_id: r.run.id });
      return r;
    }

    case "cancel_run": {
      approverOnly();
      const { data: run } = await sb.from("product_runs").select("*").eq("id", Number(b.run_id)).maybeSingle();
      if (!run || !["queued", "running"].includes(run.status)) throw fail(400, "That run isn't waiting or running");
      await sb.from("product_runs").update({ status: "canceled", finished_at: new Date().toISOString(), error: `Canceled by ${me.name}` }).eq("id", run.id);
      const item = await getItem(sb, run.item_id);
      if (item.status === "building") await sb.from("product_items").update({ status: item.branch && run.kind !== "build" ? "review" : "backlog" }).eq("id", item.id);
      await event(sb, run.item_id, me, "run", `${me.name} canceled the agent run`, { run_id: run.id });
      return {};
    }

    case "redispatch": {
      approverOnly();
      const { data: run } = await sb.from("product_runs").select("*").eq("id", Number(b.run_id)).maybeSingle();
      if (!run || run.status !== "queued") throw fail(400, "Only a waiting run can be started again");
      const d = await dispatch(sb, run.repo);
      await sb.from("product_runs").update(d.ok ? { dispatched_at: new Date().toISOString(), error: null } : { error: d.error }).eq("id", run.id);
      if (!d.ok) throw fail(502, d.error);
      return {};
    }

    case "usage": {
      approverOnly();
      const days = Math.max(1, Math.min(365, Number(b.days) || 30));
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const [{ data: sum, error }, { data: runs }, limits, org] = await Promise.all([
        sb.rpc("ai_usage_summary", { p_days: days }),
        sb.from("product_runs").select("id, item_id, kind, status, model, effort, cost_usd, input_tokens, output_tokens, cache_read_tokens, num_turns, duration_ms, created_at, finished_at").gte("created_at", since).order("created_at", { ascending: false }).limit(200),
        kv(sb, "anthropic_ratelimit"),
        orgReport(sb),
      ]);
      if (error) throw fail(500, error.message);
      const ids = [...new Set((runs || []).map(r => r.item_id))];
      const { data: titles } = ids.length ? await sb.from("product_items").select("id, title").in("id", ids) : { data: [] };
      const t = Object.fromEntries((titles || []).map(x => [x.id, x.title]));
      return { summary: sum, runs: (runs || []).map(r => ({ ...r, title: t[r.item_id] || "" })), limits, org, budget: s.budget_monthly, days };
    }

    case "settings": {
      approverOnly();
      const p = b.patch || {};
      const next = { ...s };
      if ("budget_monthly" in p) next.budget_monthly = Math.max(0, Number(p.budget_monthly) || 0);
      if ("model" in p && MODELS.some(m => m.id === p.model)) next.model = p.model;
      if ("effort" in p && EFFORTS.some(([k]) => k === p.effort)) next.effort = p.effort;
      if ("max_turns" in p) next.max_turns = Math.max(5, Math.min(400, Number(p.max_turns) || DEFAULTS.max_turns));
      if ("max_budget_usd" in p) next.max_budget_usd = Math.max(0.5, Math.min(200, Number(p.max_budget_usd) || DEFAULTS.max_budget_usd));
      if ("email_requests" in p) next.email_requests = !!p.email_requests;
      if ("slack_webhook" in p) {
        const url = String(p.slack_webhook || "").trim();
        if (url && !SLACK_HOOK.test(url)) throw fail(400, "That isn't a Slack incoming-webhook address (https://hooks.slack.com/services/...)");
        await saveSlackCfg(sb, { url }, me.email);
      }
      // The Slack app's bot (buttons + thread replies): token, signing secret, where to post.
      if ("slack_bot_token" in p) {
        const tok = String(p.slack_bot_token || "").trim();
        if (tok) {
          if (!/^xoxb-/.test(tok)) throw fail(400, "The Bot User OAuth Token starts with xoxb-");
          const t = await slackApi(tok, "auth.test", {});
          if (!t.ok) throw fail(400, `Slack refused that token (${t.error})`);
          await saveSlackCfg(sb, { bot_token: tok, team: t.team, bot_user: t.user_id, channel: "", channel_name: "" }, me.email);
        } else await saveSlackCfg(sb, { bot_token: "", channel: "", channel_name: "" }, me.email);
      }
      if ("slack_signing_secret" in p) {
        const sec = String(p.slack_signing_secret || "").trim();
        if (sec && !/^[a-f0-9]{32}$/i.test(sec)) throw fail(400, "The Signing Secret is 32 letters and numbers (Basic Information -> App Credentials)");
        await saveSlackCfg(sb, { signing_secret: sec }, me.email);
      }
      if ("slack_channel" in p) {
        const sc = await slackCfg(sb);
        if (!p.slack_channel) await saveSlackCfg(sb, { channel: "", channel_name: "" }, me.email);
        else {
          const info = await slackApi(sc.bot_token, "conversations.info", { channel: String(p.slack_channel) });
          if (!info.ok) throw fail(400, `Slack can't see that channel (${info.error}) - invite the app to it first: /invite @HQ`);
          await saveSlackCfg(sb, { channel: info.channel.id, channel_name: "#" + info.channel.name }, me.email);
        }
      }
      if ("notify" in p) next.notify = (Array.isArray(p.notify) ? p.notify : String(p.notify || "").split(/[\s,;]+/)).map(nrm).filter(e => /@/.test(e)).slice(0, 10);
      await setKv(sb, "product_settings", next, me.email);
      if (p.github_token && typeof p.github_token === "object") {
        const owner = String(p.github_token.owner || "").trim(), tok = String(p.github_token.token || "").trim();
        if (!Object.keys(REPOS).some(r => r.startsWith(owner + "/"))) throw fail(400, "Unknown GitHub account");
        if (tok && !/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(tok)) throw fail(400, "That doesn't look like a GitHub token (it starts with github_pat_)");
        const tokens = { ...(await githubTokens(sb)) }; delete tokens["*"];
        if (tok) tokens[owner] = tok; else delete tokens[owner];
        await setKv(sb, "github_token", { tokens }, me.email, true);
      }
      if ("admin_key" in p) {
        const tok = String(p.admin_key || "").trim();
        if (tok && !/^sk-ant-admin/.test(tok)) throw fail(400, "An Admin API key starts with sk-ant-admin");
        await setKv(sb, "anthropic_admin_key", tok ? { token: tok } : null, me.email, true);
      }
      return { settings: next };
    }

    case "slack_channels": {
      approverOnly();
      const sc = await slackCfg(sb);
      if (!sc.bot_token) return { channels: [] };
      const r = await slackApi(sc.bot_token, "users.conversations", { types: "public_channel,private_channel", exclude_archived: true, limit: 200 });
      if (!r.ok) throw fail(400, `Slack: ${r.error}${r.needed ? ` (add the ${r.needed} scope and reinstall the app)` : ""}`);
      return { channels: (r.channels || []).map(c => ({ id: c.id, name: "#" + c.name })), current: sc.channel || null };
    }

    case "test_slack": {
      approverOnly();
      const r = await productSlack(sb, `👋 HQ Product board is connected - new requests from the 💡 Feedback button, agent results and ships will post here. (Test from ${me.name})`);
      if (r.skipped) throw fail(400, "Save a Slack webhook first");
      if (!r.ok) throw fail(502, `Slack said no (${r.status || ""} ${r.error || ""})`);
      return {};
    }

    case "test_github": {
      approverOnly();
      const repos = await Promise.all(Object.keys(REPOS).map(async (repo) => {
        const token = await githubToken(sb, repo);
        if (!token) return { repo, ok: false, status: 0, note: "No token for this account yet" };
        const h = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "dssc-hq" };
        const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW_FILE}`, { headers: h }).catch(() => null);
        return { repo, ok: !!r?.ok, status: r?.status || 0, note: r?.ok ? "Agent workflow found" : r?.status === 404 ? "Token can't see this repo's agent workflow" : `GitHub ${r?.status || "unreachable"}` };
      }));
      return { repos };
    }

    default: throw fail(400, "Unknown action");
  }
}
