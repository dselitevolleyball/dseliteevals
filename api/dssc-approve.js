// Vercel serverless function: approve or decline a DSSC shift pickup from a
// signed link — no login, one tap from the email.
//
// Getting to a pickup in the app means opening DSSC Coaches, finding the right
// day, then finding the amber chip. Hunter already has the notification in his
// hand; this makes that notification the approval.
//
// Tokens are HMAC-signed with SUPABASE_SERVICE_ROLE_KEY (server-only), the same
// scheme as practice-approval.js, and are scoped to ONE session + coach +
// action, so a leaked link can do exactly one already-intended thing.
//
//   GET  /api/dssc-approve?token=…   confirm page
//   POST /api/dssc-approve           applies it (token in the form body)
//   POST /api/dssc-approve?action=notify  { clinicId, sessionId, coachName }
//        → emails the approvers a pair of signed links. Called by the app right
//          after a coach picks up a shift.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY (or
//      resend_api_key), DSE_FROM_EMAIL, DSSC_PLANNER_EMAILS (opt), APP_URL (opt)

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const APPROVERS_DEFAULT = ["hunterhaleysc10@gmail.com", "drew@dselitevolleyball.com"];
const TTL_MS = 30 * 24 * 3600 * 1000;   // a month — clinics are planned that far out

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => { s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Buffer.from(s, "base64"); };
const sign = (obj, secret) => { const p = b64url(JSON.stringify(obj)); return p + "." + b64url(crypto.createHmac("sha256", secret).update(p).digest()); };
const verify = (token, secret) => {
  const i = String(token || "").indexOf(".");
  if (i < 0) return null;
  const payload = token.slice(0, i), sig = token.slice(i + 1);
  const expected = b64url(crypto.createHmac("sha256", secret).update(payload).digest());
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const o = JSON.parse(fromB64url(payload).toString("utf8")); if (o.exp && Date.now() > o.exp) return null; return o; } catch { return null; }
};
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const nrm = (s) => String(s || "").trim().toLowerCase();
const fmtD = (iso) => { try { return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }); } catch { return iso; } };

const page = (title, inner) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#eaeaea;margin:0;display:flex;justify-content:center;padding:28px}.card{max-width:520px;width:100%;background:#161616;border:1px solid #2a2a2a;border-radius:16px;padding:28px}h1{color:#e91e8c;font-size:22px;margin:0 0 10px}p{line-height:1.55;color:#bbb;font-size:15px}.muted{color:#888;font-size:13px}.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}button{padding:14px 24px;border-radius:10px;border:none;font-size:16px;font-weight:800;cursor:pointer;font-family:inherit}.ok{background:#22c55e;color:#06210f}.no{background:transparent;border:1px solid #ef4444;color:#ef4444}a{color:#e91e8c}</style></head><body><div class="card">${inner}</div></body></html>`;

// Mirrors sessionStaff() in the app: pre-staffing sessions carry only coach_name.
const staffOf = (s) => {
  if (Array.isArray(s?.staff)) return s.staff;
  const nm = String(s?.coach_name || "").trim();
  return nm ? [{ name: nm, role: "lead", status: "approved" }] : [];
};
const needOf = (s, c) => Math.max(1, Number(s?.coaches_needed ?? c?.coaches_needed ?? 1) || 1);

export default async function handler(req, res) {
  const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY, SUPA_URL = process.env.SUPABASE_URL;
  const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.resend_api_key;
  const { DSE_FROM_EMAIL, DSSC_PLANNER_EMAILS, APP_URL } = process.env;
  const url = (() => { try { return new URL(req.url, "https://x"); } catch { return null; } })();
  const action = url?.searchParams.get("action") || "";

  if (!SECRET || !SUPA_URL) {
    if (action === "notify") return res.status(500).json({ error: "Not configured" });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(500).send(page("Error", "<h1>Not available</h1><p>The approval service isn't configured yet.</p>"));
  }
  const supabase = createClient(SUPA_URL, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
  const origin = APP_URL || ("https://" + (req.headers["x-forwarded-host"] || req.headers.host));

  // ── Send the approver a pair of one-tap links ────────────────────────────
  if (action === "notify") {
    let body; try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; } catch { return res.status(400).json({ error: "Invalid JSON" }); }
    const clinicId = Number(body?.clinicId), sessionId = String(body?.sessionId || ""), coachName = String(body?.coachName || "").trim();
    if (!clinicId || !sessionId || !coachName) return res.status(400).json({ error: "clinicId, sessionId and coachName are required" });

    const { data: clinic } = await supabase.from("dssc_clinics").select("*").eq("id", clinicId).maybeSingle();
    const s = (clinic?.sessions || []).find(x => String(x.id) === sessionId);
    if (!clinic || !s) return res.status(404).json({ error: "No such session" });
    // Only ever emails about a pickup that is genuinely pending, so this can't
    // be used to send arbitrary mail.
    const entry = staffOf(s).find(v => nrm(v.name) === nrm(coachName) && v.status === "pending");
    if (!entry) return res.status(409).json({ error: "That pickup isn't pending" });

    if (!RESEND_API_KEY || !DSE_FROM_EMAIL) return res.status(200).json({ ok: true, emailed: false, note: "Email not configured" });
    const to = (DSSC_PLANNER_EMAILS ? DSSC_PLANNER_EMAILS.split(",") : APPROVERS_DEFAULT).map(x => x.trim().toLowerCase()).filter(Boolean);
    const mk = (a) => origin + "/api/dssc-approve?token=" + encodeURIComponent(sign({ c: clinicId, s: sessionId, n: coachName, a, exp: Date.now() + TTL_MS }, SECRET));
    const when = fmtD(String(s.date).slice(0, 10));
    const where = [s.court || clinic.location, s.start_time].filter(Boolean).join(" · ");
    const role = entry.role === "lead" ? "LEAD" : "assistant";
    const html = `<div style="font-family:sans-serif;font-size:15px;line-height:1.55">
      <p><b>${esc(coachName)}</b> wants to pick up a DSSC shift as <b>${esc(role)}</b>:</p>
      <p style="margin:0 0 4px"><b>${esc(clinic.name)}</b><br>${esc(when)}<br><span style="color:#666">${esc(where)}</span></p>
      <p style="margin:18px 0">
        <a href="${mk("approve")}" style="display:inline-block;background:#22c55e;color:#06210f;font-weight:800;padding:13px 26px;border-radius:9px;text-decoration:none">Approve</a>
        &nbsp;&nbsp;
        <a href="${mk("decline")}" style="display:inline-block;border:1px solid #ef4444;color:#ef4444;font-weight:700;padding:12px 22px;border-radius:9px;text-decoration:none">Decline</a>
      </p>
      <p style="color:#888;font-size:12px">One tap — no login. Or open <a href="${origin}/?view=dssccal">DSSC Coaches</a>.</p></div>`;
    await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: DSE_FROM_EMAIL, to, subject: `Approve? ${coachName} → ${clinic.name}, ${when}`, html,
        text: `${coachName} wants to pick up ${clinic.name} on ${when} (${where}) as ${role}.\n\nApprove: ${mk("approve")}\nDecline: ${mk("decline")}` }),
    }).catch(() => {});
    return res.status(200).json({ ok: true, emailed: true, to });
  }

  // ── The signed link itself ───────────────────────────────────────────────
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const isPost = req.method === "POST";
  let token = "";
  if (isPost) {
    let b = req.body;
    if (typeof b === "string") { try { b = Object.fromEntries(new URLSearchParams(b)); } catch { b = {}; } }
    token = (b && b.token) || "";
  } else token = url?.searchParams.get("token") || "";

  const d = verify(token, SECRET);
  if (!d || !d.c || !d.s || !d.n) return res.status(400).send(page("Invalid link", "<h1>Link expired</h1><p>This approval link is invalid or has expired. Open <a href=\"" + origin + "/?view=dssccal\">DSSC Coaches</a> instead.</p>"));

  const { data: clinic } = await supabase.from("dssc_clinics").select("*").eq("id", d.c).maybeSingle();
  const sess = (clinic?.sessions || []).find(x => String(x.id) === String(d.s));
  if (!clinic || !sess) return res.status(404).send(page("Gone", "<h1>That session is gone</h1><p>It may have been deleted or rescheduled.</p>"));

  const staff = staffOf(sess);
  const entry = staff.find(v => nrm(v.name) === nrm(d.n));
  const when = fmtD(String(sess.date).slice(0, 10));
  const where = [sess.court || clinic.location, sess.start_time].filter(Boolean).join(" · ");

  if (!entry) return res.status(200).send(page("Already handled", `<h1>Nothing to do</h1><p><b>${esc(d.n)}</b> is no longer on ${esc(clinic.name)} — ${esc(when)}.</p>`));
  if (entry.status !== "pending") {
    const word = entry.status === "approved" ? "already approved" : "already declined";
    return res.status(200).send(page("Already handled",
      `<h1>${esc(d.n)} was ${word}</h1><p>${esc(clinic.name)} — ${esc(when)}<br><span class="muted">${esc(where)}</span></p><p class="muted">Change it in <a href="${origin}/?view=dssccal">DSSC Coaches</a>.</p>`));
  }

  if (!isPost) {
    const verb = d.a === "decline" ? "Decline" : "Approve";
    return res.status(200).send(page(verb + " shift pickup", `
      <h1>${verb} this pickup?</h1>
      <p><b>${esc(d.n)}</b> as <b>${esc(entry.role === "lead" ? "LEAD" : "assistant")}</b><br>
         ${esc(clinic.name)}<br>${esc(when)}<br><span class="muted">${esc(where)}</span></p>
      <form method="POST" action="/api/dssc-approve"><input type="hidden" name="token" value="${esc(token)}">
        <div class="row"><button class="${d.a === "decline" ? "no" : "ok"}" type="submit">${verb}</button></div>
      </form>
      <p class="muted" style="margin-top:16px">Or open <a href="${origin}/?view=dssccal">DSSC Coaches</a>.</p>`));
  }

  // Apply it. Same mirroring rules as the app: coach_name tracks the approved
  // lead, needsCoverage tracks the headcount.
  const ok = d.a !== "decline";
  const nextStaff = staff.map(v => nrm(v.name) === nrm(d.n)
    ? { ...v, status: ok ? "approved" : "declined", by: "email link", at: new Date().toISOString() } : v);
  const nextSessions = (clinic.sessions || []).map(x => {
    if (String(x.id) !== String(d.s)) return x;
    const merged = { ...x, staff: nextStaff };
    const lead = nextStaff.find(v => v.role === "lead" && v.status === "approved");
    merged.coach_name = lead ? lead.name : null;
    merged.needsCoverage = nextStaff.filter(v => v.status === "approved").length < needOf(merged, clinic);
    return merged;
  });
  const { error } = await supabase.from("dssc_clinics")
    .update({ sessions: nextSessions, updated_by: "email approval", updated_at: new Date().toISOString() }).eq("id", d.c);
  if (error) return res.status(500).send(page("Error", "<h1>Couldn't save</h1><p>" + esc(error.message) + "</p>"));

  // Tell the coach either way — a pickup that silently sits is why this exists.
  if (RESEND_API_KEY && DSE_FROM_EMAIL) {
    const { data: roster } = await supabase.from("coach_roster").select("first_name,last_name,email");
    const { data: avail } = await supabase.from("dssc_availability").select("coach_name,coach_email");
    const em = (avail || []).find(x => x.coach_email && nrm(x.coach_name) === nrm(d.n))?.coach_email
      || (roster || []).find(x => x.email && nrm(`${x.first_name || ""} ${x.last_name || ""}`.trim()) === nrm(d.n))?.email;
    if (em) await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: DSE_FROM_EMAIL, to: [em],
        subject: (ok ? "You're on: " : "Not this time: ") + clinic.name + " — " + when,
        text: ok ? `You're confirmed for ${clinic.name} on ${when} (${where}).\n\nClock in from DS Elite HQ → DSSC Hours when you get there.`
                 : `${clinic.name} on ${when} has been covered another way — thanks for offering.\n\nOther open shifts are in DS Elite HQ → DSSC Hours.` }),
    }).catch(() => {});
  }

  return res.status(200).send(page(ok ? "Approved" : "Declined", `
    <h1>${ok ? "Approved ✓" : "Declined"}</h1>
    <p><b>${esc(d.n)}</b> — ${esc(clinic.name)}<br>${esc(when)}<br><span class="muted">${esc(where)}</span></p>
    <p class="muted">${esc(d.n.split(/\s+/)[0])} has been told${ok ? " and can clock in on the day" : ""}.</p>
    <p class="muted"><a href="${origin}/?view=dssccal">Open DSSC Coaches</a></p>`));
}
