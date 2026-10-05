// No-login testing sheet for a team: Coach Brandon opens the team's link on
// his phone, enters each player's numbers, and they land on the player card
// (player_stat_tests, one row per player per test date) so improvement after
// Reach shows against the tryout baseline.
//
//   GET  /stats?t=<token>              → the sheet for that team
//   POST /stats?t=<token>  {date, by, rows:[{player_id, ...}]} → saves
//   GET  /api/stats-form?links=1       → every team's link (signed-in admins)
//
// The token is an HMAC of the team name with the service-role key (server-only
// secret), so a link only opens its own team and can't be guessed. No expiry:
// it's the team's standing link. Values: inches (or 8'4" style), broad jump
// inches (or 6'10"), 10-yard dash seconds. Vertical = approach − stand & reach.

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { appOrigin } from "../shared/app-origin.js";

const OWNERS = ["drew@dselitevolleyball.com", "drew@drippingsportsclub.com"];
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => { s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Buffer.from(s, "base64"); };
export const signTeam = (team, secret) => { const p = b64url(JSON.stringify({ team, k: "stats" })); return p + "." + b64url(crypto.createHmac("sha256", secret).update(p).digest()).slice(0, 22); };
const verify = (token, secret) => {
  const [p, sig] = String(token || "").split("."); if (!p || !sig) return null;
  if (b64url(crypto.createHmac("sha256", secret).update(p).digest()).slice(0, 22) !== sig) return null;
  try { const o = JSON.parse(fromB64url(p).toString("utf8")); return o.k === "stats" ? o.team : null; } catch { return null; }
};
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const centralToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
// "100", "100.5", "8'4", "8' 4\"", "8-4", "8ft 4in" → inches
const inches = (v) => {
  const s = String(v ?? "").trim(); if (!s) return null;
  let m = /^(\d+)\s*(?:'|ft|feet|-)\s*(\d+(?:\.\d+)?)?\s*(?:"|in|inches)?$/i.exec(s); if (m) return +m[1] * 12 + (m[2] ? +m[2] : 0);
  m = /^(\d+(?:\.\d+)?)\s*(?:"|in|inches)?$/i.exec(s); return m ? +m[1] : NaN;
};
const secs = (v) => { const s = String(v ?? "").trim(); if (!s) return null; const n = parseFloat(s); return Number.isFinite(n) ? n : NaN; };

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).send("Not configured");
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const url = new URL(req.url, "https://x");

  // Admin: every team's link.
  if (url.searchParams.get("links") === "1") {
    const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    let ok = bearer && bearer === SUPABASE_SERVICE_ROLE_KEY;
    if (!ok && bearer) {
      const { data: { user } = {} } = await sb.auth.getUser(bearer).catch(() => ({ data: {} }));
      const email = (user?.email || "").toLowerCase();
      ok = OWNERS.includes(email);
      if (!ok && email) { const { data: c } = await sb.from("coaches").select("is_admin,is_approved").ilike("email", email).maybeSingle(); ok = !!(c?.is_admin && c?.is_approved); }
    }
    if (!ok) return res.status(403).json({ error: "Admins only" });
    const { data: teams } = await sb.from("practice_teams").select("team_name, practices_per_week");
    const origin = appOrigin(req);
    return res.status(200).json({ ok: true, links: (teams || []).filter(t => Number(t.practices_per_week) !== 0).map(t => t.team_name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(team => ({ team, url: origin + "/stats?t=" + signTeam(team, SUPABASE_SERVICE_ROLE_KEY) })) });
  }

  const team = verify(url.searchParams.get("t"), SUPABASE_SERVICE_ROLE_KEY);
  if (!team) { res.setHeader("Content-Type", "text/html; charset=utf-8"); return res.status(403).send(page("Link not valid", `<h1>This link isn't valid</h1><p>Ask Drew for the team's testing link.</p>`)); }
  const { data: players } = await sb.from("players").select("id, first_name, last_name, jersey_number, stand_reach, approach_touch, jump_touch, sprint_10y, offer_status")
    .eq("team_assignment", team).order("last_name");
  const roster = (players || []).filter(p => !/declin|releas|withdr|cancel/i.test(p.offer_status || ""));

  if (req.method === "POST") {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || "") ? body.date : centralToday();
    const by = String(body.by || "").trim().slice(0, 60) || "Coach";
    const ids = new Set(roster.map(p => String(p.id)));
    // Stand & reach rarely changes: when it isn't re-measured, vertical uses the
    // last one on file (latest test, else the tryout number) — same as the sheet shows.
    const { data: prior } = await sb.from("player_stat_tests").select("player_id, test_date, stand_reach").in("player_id", roster.map(p => p.id).concat([0])).not("stand_reach", "is", null).order("test_date");
    const reachOf = new Map(roster.map(p => [String(p.id), p.stand_reach != null ? +p.stand_reach : null]));
    for (const x of prior || []) reachOf.set(String(x.player_id), +x.stand_reach);
    const rows = [], bad = [];
    for (const r of Array.isArray(body.rows) ? body.rows : []) {
      if (!ids.has(String(r.player_id))) continue;
      const v = { stand_reach: inches(r.stand_reach), approach_touch: inches(r.approach_touch), standing_touch: inches(r.standing_touch), broad_jump: inches(r.broad_jump), dash_10y: secs(r.dash_10y) };
      if (Object.values(v).some(x => Number.isNaN(x))) { bad.push(r.player_id); continue; }
      if (Object.values(v).every(x => x == null) && !String(r.notes || "").trim()) continue;
      const reach = v.stand_reach ?? reachOf.get(String(r.player_id));
      const vert = v.approach_touch != null && reach != null ? +(v.approach_touch - reach).toFixed(1) : null;
      rows.push({ player_id: Number(r.player_id), test_date: date, team_name: team, ...v, vertical: vert, notes: String(r.notes || "").trim().slice(0, 300) || null, recorded_by: by, source: "stats-link", updated_at: new Date().toISOString() });
    }
    if (bad.length) return res.status(400).json({ error: "Some numbers couldn't be read — check the highlighted players.", bad });
    if (!rows.length) return res.status(400).json({ error: "Nothing to save yet — enter at least one number." });
    const { error } = await sb.from("player_stat_tests").upsert(rows, { onConflict: "player_id,test_date" });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, saved: rows.length, date });
  }

  // The sheet.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("date") || "") ? url.searchParams.get("date") : centralToday();
  const { data: done } = await sb.from("player_stat_tests").select("*").in("player_id", roster.map(p => p.id).concat([0])).order("test_date");
  const latest = new Map(); const today = new Map();
  for (const d of done || []) { latest.set(d.player_id, d); if (d.test_date === date) today.set(d.player_id, d); }
  const fmt = (n) => n == null ? "" : String(+(+n).toFixed(1));
  const card = (p) => {
    const t = today.get(p.id) || {}, last = latest.get(p.id) || {};
    const prev = (k, base) => { const v = last[k] ?? base; return v == null ? "" : fmt(v); };
    const field = (k, label, base, unit) => `<label><span>${label}</span><input inputmode="decimal" name="${k}" value="${esc(fmt(t[k]))}" placeholder="${esc(prev(k, base))}" autocomplete="off"><em>${unit}</em></label>`;
    return `<div class="p" data-id="${p.id}">
      <div class="n">${p.jersey_number ? `<b>#${esc(p.jersey_number)}</b> ` : ""}${esc((p.first_name || "") + " " + (p.last_name || ""))}<span class="v">Vertical: <b>—</b></span></div>
      <div class="g">
        ${field("stand_reach", "Stand &amp; reach", p.stand_reach, "in")}
        ${field("approach_touch", "Jump approach", p.approach_touch, "in")}
        ${field("standing_touch", "Standing jump", p.jump_touch, "in")}
        ${field("broad_jump", "Broad jump", null, "in")}
        ${field("dash_10y", "10 yd dash", p.sprint_10y, "sec")}
      </div>
    </div>`;
  };
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  return res.status(200).send(page(team + " testing", `
    <h1>${esc(team)} — testing</h1>
    <div class="top">
      <label>Test date <input type="date" id="date" value="${date}"></label>
      <label>Tested by <input id="by" placeholder="Your name" value=""></label>
    </div>
    <p class="hint">Heights in inches — or type feet like <b>8'4</b>. Grey numbers are the player's last result. Vertical fills in (jump approach − stand &amp; reach). Leave anything you didn't test blank. You can come back and save again; the same date updates.</p>
    ${roster.length ? roster.map(card).join("") : "<p>No players on this team yet.</p>"}
    <div class="bar"><span id="msg"></span><button id="save">Save</button></div>
    <script>
      const by = document.getElementById("by"); try { by.value = localStorage.getItem("statsBy") || ""; } catch {}
      document.getElementById("date").addEventListener("change", e => { location.search = "?t=" + encodeURIComponent(new URLSearchParams(location.search).get("t")) + "&date=" + e.target.value; });
      const inch = (v) => { v = String(v || "").trim(); if (!v) return null; let m = /^(\\d+)\\s*(?:'|ft|feet|-)\\s*(\\d+(?:\\.\\d+)?)?\\s*(?:"|in)?$/i.exec(v); if (m) return +m[1]*12 + (m[2] ? +m[2] : 0); m = /^(\\d+(?:\\.\\d+)?)\\s*(?:"|in)?$/i.exec(v); return m ? +m[1] : NaN; };
      const val = (card, k) => { const i = card.querySelector('[name="' + k + '"]'); return inch(i.value || i.placeholder); };
      const recalc = (card) => { const a = val(card, "approach_touch"), r = val(card, "stand_reach"); card.querySelector(".v b").textContent = (a != null && r != null && !isNaN(a) && !isNaN(r)) ? (Math.round((a - r) * 10) / 10) + '"' : "—"; };
      document.querySelectorAll(".p").forEach(c => { recalc(c); c.addEventListener("input", () => { recalc(c); c.classList.remove("bad"); }); });
      document.getElementById("save").addEventListener("click", async () => {
        const btn = document.getElementById("save"), msg = document.getElementById("msg");
        try { localStorage.setItem("statsBy", by.value); } catch {}
        const rows = [...document.querySelectorAll(".p")].map(c => { const o = { player_id: c.dataset.id }; c.querySelectorAll("input").forEach(i => o[i.name] = i.value); return o; });
        btn.disabled = true; msg.textContent = "Saving…";
        try {
          const r = await fetch(location.href, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: document.getElementById("date").value, by: by.value, rows }) });
          const d = await r.json();
          if (!r.ok) { (d.bad || []).forEach(id => document.querySelector('.p[data-id="' + id + '"]')?.classList.add("bad")); throw new Error(d.error || "Couldn't save"); }
          msg.textContent = "Saved " + d.saved + " player" + (d.saved === 1 ? "" : "s") + " ✓";
        } catch (e) { msg.textContent = e.message; } finally { btn.disabled = false; }
      });
    </script>`));
}

function page(title, inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;background:#0a0a0a;color:#fff;font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:16px 14px 90px}
  h1{color:#e91e8c;font-size:22px;margin:0 0 12px}
  .top{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px} .top label{font-size:12px;color:#aaa;display:flex;flex-direction:column;gap:4px}
  .top input{background:#141414;border:1px solid #333;border-radius:8px;color:#fff;padding:9px;font-size:15px}
  .hint{font-size:12px;color:#999;line-height:1.5;margin:6px 0 14px}
  .p{background:#141414;border:1px solid #2a2a2a;border-radius:12px;padding:12px;margin-bottom:10px} .p.bad{border-color:#ef4444}
  .n{font-weight:800;font-size:15px;margin-bottom:8px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap} .n b{color:#e91e8c}
  .v{font-size:12px;color:#aaa;font-weight:600} .v b{color:#22c55e;font-size:15px}
  .g{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}
  .g label{display:flex;flex-direction:column;gap:3px;position:relative} .g span{font-size:11px;color:#aaa}
  .g input{background:#0a0a0a;border:1px solid #333;border-radius:8px;color:#fff;font-size:17px;padding:9px 34px 9px 10px;width:100%;box-sizing:border-box}
  .g input::placeholder{color:#555} .g em{position:absolute;right:9px;bottom:11px;font-style:normal;font-size:11px;color:#666}
  .bar{position:fixed;left:0;right:0;bottom:0;background:#111;border-top:1px solid #2a2a2a;padding:12px 14px;display:flex;gap:10px;align-items:center;justify-content:flex-end}
  #msg{font-size:13px;color:#aaa;flex:1} button{background:#22c55e;color:#04240f;border:none;border-radius:10px;font-size:16px;font-weight:800;padding:12px 26px}
  p{color:#bbb}
</style></head><body>${inner}</body></html>`;
}
