// Vercel serverless function: no-login practice-schedule approval via a signed
// link from an email. GET shows a confirm page; POST records the approval.
//
// Tokens are HMAC-signed with SUPABASE_SERVICE_ROLE_KEY (server-only secret),
// so no extra env var is needed. Env used:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Link: /api/practice-approval?token=<signed {team,coach,email,exp}>

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => { s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Buffer.from(s, "base64"); };
const verify = (token, secret) => {
  const i = String(token || "").indexOf(".");
  if (i < 0) return null;
  const payload = token.slice(0, i), sig = token.slice(i + 1);
  const expected = b64url(crypto.createHmac("sha256", secret).update(payload).digest());
  if (sig !== expected) return null;
  try { const o = JSON.parse(fromB64url(payload).toString("utf8")); if (o.exp && Date.now() > o.exp) return null; return o; } catch (e) { return null; }
};
const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const page = (title, inner) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#eaeaea;margin:0;display:flex;justify-content:center;padding:28px}.card{max-width:520px;width:100%;background:#161616;border:1px solid #2a2a2a;border-radius:16px;padding:28px}h1{color:#e91e8c;font-size:22px;margin:0 0 10px}p{line-height:1.55;color:#bbb;font-size:15px}.muted{color:#888;font-size:13px}button{padding:14px 24px;border-radius:10px;border:none;background:#22c55e;color:#06210f;font-size:16px;font-weight:800;cursor:pointer}</style></head><body><div class="card">${inner}</div></body></html>`;

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY, SUPA_URL = process.env.SUPABASE_URL;
  if (!SECRET || !SUPA_URL) return res.status(500).send(page("Error", "<h1>Not available</h1><p>The approval service isn't configured yet.</p>"));

  const isPost = req.method === "POST";
  let token = "";
  if (isPost) {
    let b = req.body;
    if (typeof b === "string") { try { b = Object.fromEntries(new URLSearchParams(b)); } catch (e) { b = {}; } }
    token = (b && b.token) || "";
  } else {
    token = (req.query && req.query.token) || "";
  }

  const data = verify(token, SECRET);
  if (!data || !data.team) return res.status(400).send(page("Invalid link", "<h1>Link expired</h1><p>This approval link is invalid or has expired. Please ask Drew to resend it.</p>"));

  if (!isPost) {
    return res.status(200).send(page("Approve practice schedule",
      `<h1>Approve practice schedule</h1>
       <p>Team: <b>${esc(data.team)}</b>${data.coach ? "<br>Coach: <b>" + esc(data.coach) + "</b>" : ""}</p>
       <p>By approving, you confirm <b>${esc(data.team)}</b>'s practice schedule works and has no conflicts.</p>
       <form method="POST" action="/api/practice-approval">
         <input type="hidden" name="token" value="${esc(token)}">
         <button type="submit">&#10003; Approve schedule</button>
       </form>
       <p class="muted" style="margin-top:16px">Want a change instead? Just reply to the email.</p>`));
  }

  const supabase = createClient(SUPA_URL, SECRET, { auth: { persistSession: false } });
  const { data: teamRow } = await supabase.from("practice_teams").select("head_coach,assistant_coach").eq("team_name", data.team).maybeSingle();
  const required = [teamRow && teamRow.head_coach, teamRow && teamRow.assistant_coach].filter(Boolean);
  const { data: apprRow } = await supabase.from("practice_approvals").select("approved_by").eq("team_name", data.team).maybeSingle();
  const cur = (apprRow && apprRow.approved_by) || [];
  const next = Array.from(new Set([...cur, data.coach].filter(Boolean)));
  const fully = required.length > 0 && required.every(rc => next.includes(rc));
  const now = new Date().toISOString();
  const { error } = await supabase.from("practice_approvals").upsert(
    { team_name: data.team, approved: fully, approved_by: next, approved_at: fully ? now : null, updated_at: now },
    { onConflict: "team_name" }
  );
  if (error) return res.status(500).send(page("Error", "<h1>Something went wrong</h1><p>Couldn't save your approval. Please try again or contact Drew.</p>"));

  return res.status(200).send(page("Approved",
    `<h1>&#10003; Approved &mdash; thank you!</h1>
     <p>Your approval of <b>${esc(data.team)}</b>'s practice schedule is recorded${fully ? " and the schedule is now <b>fully approved</b>." : ". We're still waiting on the other coach."}</p>
     <p class="muted">You can close this page.</p>`));
}
