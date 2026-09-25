// Email Drew a preview of everything a coach gets from the DSSC privates ask:
// the text, the app notification and the email, for both the first-time ask
// and the monthly "has it changed?" — with Drew's own live coach link so the
// page can be tapped through too. Sends only to Drew.
//
//   node scripts/preview-privates-ask.mjs
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { askWording } from "../api/privates-ask.js";
import { askMonth } from "../api/privates-form.js";

const APP = "https://dseliteevals.vercel.app";
const DREW = "drew@dselitevolleyball.com";
const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: me } = await sb.from("coach_roster").select("first_name, last_name, privates_token").ilike("email", DREW).maybeSingle();
if (!me) { console.error("Drew isn't on coach_roster with that email."); process.exit(1); }

const month = askMonth();
const label = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
const link = `${APP}/privates?t=${me.privates_token}&m=${month}`;
const first = askWording({ first: "Kelli", kind: "first", link, label });
const update = askWording({ first: "Kelli", kind: "update", link, label });
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const block = (title, body) => `<h3 style="margin:22px 0 6px;font-size:14px;color:#0e7490">${esc(title)}</h3><pre style="white-space:pre-wrap;font-family:inherit;background:#f4f6f8;border:1px solid #dde3e8;border-radius:8px;padding:12px;margin:0">${esc(body)}</pre>`;
const one = (name, w) => block(name + " · TEXT (from the club number)", w.sms)
  + block(name + " · APP NOTIFICATION", w.push.title + "\n" + w.push.body + "\n(tapping it opens her page)")
  + block(name + " · EMAIL", "Subject: " + w.subject + "\n\n" + w.email);
const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1a;max-width:680px">
<p>Here's exactly what a coach gets. The link in every message is <b>your own</b> coach page, so you can tap through the whole thing: <a href="${link}">${link}</a></p>
<p>The first-time ask goes to anyone who has never answered. The monthly one goes on the 25th to anyone who said yes, for the month ahead. Coaches who say "not right now" are left alone.</p>
${one("FIRST-TIME ASK", first)}
${one("MONTHLY UPDATE (after a yes)", update)}
<p style="margin-top:22px;color:#666">Nothing has gone to any coach. When you're happy, DSSC → Privates → "Send the ${esc(label)} ask to coaches".</p></div>`;
const text = `Preview of the DSSC privates ask (your own link: ${link})\n\n=== FIRST-TIME ASK ===\n\nTEXT:\n${first.sms}\n\nAPP NOTIFICATION:\n${first.push.title}\n${first.push.body}\n\nEMAIL — Subject: ${first.subject}\n\n${first.email}\n\n=== MONTHLY UPDATE (after a yes) ===\n\nTEXT:\n${update.sms}\n\nAPP NOTIFICATION:\n${update.push.title}\n${update.push.body}\n\nEMAIL — Subject: ${update.subject}\n\n${update.email}\n\nNothing has gone to any coach.`;

const r = await fetch(APP + "/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ subject: "[PREVIEW] What coaches get for DSSC privates — " + label, body: text, bodyHtml: html, recipients: [DREW], skipPush: true, sentBy: "Claude (preview)", sentByEmail: DREW, source: "privates-ask preview" }) });
const o = await r.json().catch(() => ({}));
console.log(r.ok && !o.error ? "preview sent to " + DREW + " · link " + link : "FAILED: " + (o.error || r.status));
