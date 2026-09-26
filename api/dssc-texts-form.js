// /dssc-texts — the club's text opt-in page (Dripping Springs Sports Club).
//
// This is the consent the DSSC 10DLC campaign points at: a parent types their
// name, mobile and their player's name and agrees to texts from the club.
// The opt-in is recorded in sms_consents (brand 'dssc'), and the phone is
// written onto every class roster row for that player, so the DSSC Texts
// screen can reach them. GET renders the form; POST saves it.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const normalizePhone = (raw) => { const d = String(raw || "").replace(/[^\d+]/g, ""); if (d.startsWith("+")) return d; if (d.length === 10) return "+1" + d; if (d.length === 11 && d.startsWith("1")) return "+" + d; return d ? "+" + d : ""; };

function page(inner, title = "Text updates from Dripping Springs Sports Club") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
  body{margin:0;background:#104946;color:#fff;font-family:"Archivo",-apple-system,"Segoe UI",sans-serif}
  .wrap{max-width:520px;margin:0 auto;padding:28px 18px 60px}
  img.logo{height:34px;margin-bottom:22px}
  h1{font-size:26px;line-height:1;margin:0 0 8px;letter-spacing:-.01em}
  p{color:#A9C7C3;line-height:1.5;font-size:15px}
  label{display:block;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#B2D049;margin:16px 0 6px}
  input{width:100%;box-sizing:border-box;background:#0C3A37;border:1px solid rgba(255,255,255,.18);border-radius:8px;color:#fff;font:inherit;font-size:16px;padding:11px 12px}
  .consent{display:flex;gap:10px;align-items:flex-start;margin-top:18px;font-size:13px;color:#fff;line-height:1.45}
  .consent input{width:auto;margin-top:3px}
  button{margin-top:18px;width:100%;background:#B2D049;color:#104946;border:0;border-radius:10px;font:inherit;font-weight:800;font-size:16px;padding:13px;cursor:pointer}
  .fine{font-size:12px;color:#6F9995;margin-top:16px;line-height:1.5}
  .ok{background:rgba(178,208,73,.14);border:1px solid #B2D049;border-radius:12px;padding:16px;font-size:15px}
  a{color:#B2D049}
</style></head><body><div class="wrap"><img class="logo" src="/dssc/logo-horizontal-white.png" alt="Dripping Springs Sports Club">${inner}</div></body></html>`;
}

const FORM = (msg) => page(`
<h1>Keep your number current</h1>
<p>Class reminders, schedule changes, coach notes and photos from your player's clinics and pods come by text. If you've changed numbers or never gave us one, add it here.</p>
${msg ? `<div class="ok">${esc(msg)}</div>` : ""}
<form method="POST" action="/dssc-texts">
  <label for="n">Your name</label><input id="n" name="name" required autocomplete="name">
  <label for="p">Mobile number</label><input id="p" name="phone" type="tel" required autocomplete="tel" placeholder="(512) 555-0100">
  <label for="k">Your player's name (first and last)</label><input id="k" name="player" required placeholder="Add more than one, separated by commas">
  <div class="consent"><input type="checkbox" name="agree" value="yes" required id="a"><label for="a" style="margin:0;text-transform:none;letter-spacing:0;font-size:13px;font-weight:500;color:#fff">I agree to receive text messages from Dripping Springs Sports Club at the number above about the programs my player is registered for — reminders, schedule changes, coach feedback and photos. Message frequency varies. Message &amp; data rates may apply. Reply STOP to unsubscribe, HELP for help.</label></div>
  <button type="submit">Sign me up</button>
</form>
<p class="fine">Dripping Springs Sports Club · Dripping Springs, TX. We never sell or share your number. <a href="https://www.drippingsportsclub.com/sms-privacy">Privacy policy</a> · <a href="https://www.drippingsportsclub.com/sms-terms">Terms</a></p>`);

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (req.method === "GET") return res.status(200).send(FORM(""));
  if (req.method !== "POST") { res.setHeader("Allow", ["GET", "POST"]); return res.status(405).send("Method not allowed"); }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).send(page("<p>Server not configured.</p>"));
  let b = req.body || {};
  if (typeof b === "string") { const o = {}; for (const [k, v] of new URLSearchParams(b)) o[k] = v; b = o; }
  const name = String(b.name || "").trim().slice(0, 120), phone = normalizePhone(b.phone), player = String(b.player || "").trim().slice(0, 200);
  if (!name || !/^\+\d{10,15}$/.test(phone) || !player || b.agree !== "yes") return res.status(400).send(FORM("Please fill in every field, check the box, and use a 10-digit mobile number."));
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await sb.from("sms_consents").upsert({ phone, brand: "dssc", name, player_name: player, source: "dssc-texts form", consented_at: new Date().toISOString(), notes: "ip " + String(req.headers["x-forwarded-for"] || "").split(",")[0] }, { onConflict: "phone,brand" });
  if (error) return res.status(500).send(page("<p>Something went wrong saving that. Please try again.</p>"));
  // Put the number on the player's class rosters so the Texts screen finds them.
  let matched = 0;
  for (const nm of player.split(/[,;&]|\band\b/i).map(s => s.trim()).filter(s => s.length > 2)) {
    const { data } = await sb.from("dssc_pod_roster").update({ parent_phone: phone, sms_consent: true, parent_name: name, updated_at: new Date().toISOString() }).ilike("player_name", nm).select("id");
    matched += (data || []).length;
  }
  return res.status(200).send(page(`<div class="ok"><b>You're in.</b> ${esc(name)}, we'll text ${esc(phone)} about ${esc(player)}'s programs.${matched ? "" : " We didn't find a current registration under that name yet — no problem, it'll link up when they're signed up."}<br><br>Reply STOP to any message to opt out.</div>`, "You're signed up"));
}
