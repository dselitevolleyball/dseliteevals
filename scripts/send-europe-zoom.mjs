// Europe trip interest meeting (Sun Oct 11, 3:30pm): the Zoom link to every
// family that RSVP'd "On Zoom" (global_meeting_rsvps.response = 'zoom').
// One text per parent phone ({first}, ASCII), one email per family to every
// parent address. Skips STOP opt-outs.
//   node scripts/send-europe-zoom.mjs          # dry run
//   node scripts/send-europe-zoom.mjs --send
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APP = "https://dseliteevals.vercel.app";
const ZOOM = "https://livingsecurity.zoom.us/j/6191058815";
const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const doSend = process.argv.includes("--send");
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const last10 = (p) => String(p || "").replace(/\D/g, "").slice(-10);

const { data: rsvps } = await sb.from("global_meeting_rsvps").select("player_id").eq("response", "zoom");
const [{ data: players }, { data: outs }] = await Promise.all([
  sb.from("players").select("id, first_name, parent_name, parent2_name, parent_phone, parent2_phone, parent_email, parent_email2, parent_email3").in("id", rsvps.map(r => r.player_id)),
  sb.from("sms_optouts").select("phone"),
]);
const out = new Set((outs || []).map(o => last10(o.phone)));
const TEXT = `Hi {first}, here is the Zoom link for today's DS Elite Europe trip (Croatia 2027) meeting at 3:30pm: ${ZOOM}\nMeeting ID: 619 105 8815. Talk to you then!\n- Drew, DS Elite`;
const texts = [], emails = [];
for (const p of players) {
  const seen = new Set();
  for (const [ph, nm] of [[p.parent_phone, p.parent_name], [p.parent2_phone, p.parent2_name]]) {
    const d = last10(ph); if (d.length !== 10 || out.has(d) || seen.has(d)) continue; seen.add(d);
    texts.push({ to: "+1" + d, name: String(nm || "").trim(), player_id: p.id });
  }
  const to = [...new Set([p.parent_email, p.parent_email2, p.parent_email3].map(e => String(e || "").trim().toLowerCase()).filter(e => EMAIL_RE.test(e)))];
  const names = [...new Set([p.parent_name, p.parent2_name].map(x => String(x || "").trim().split(/\s+/)[0]).filter(Boolean))];
  if (to.length) emails.push({ to, hi: names.length ? "Hi " + names.join(" and ") + "," : "Hi," });
}
if (/[^\x20-\x7E\n]/.test(TEXT) || TEXT.length > 600) throw new Error("bad text");
const subject = "Zoom link: Europe trip meeting today at 3:30pm";
const body = (hi) => `${hi}\n\nThanks for joining us on Zoom for today's Europe trip (Croatia 2027) interest meeting.\n\nSunday, October 11 at 3:30pm (Central)\nJoin Zoom: ${ZOOM}\nMeeting ID: 619 105 8815\n\nOne tap mobile:\n+13462487799,,6191058815# US (Houston)\n+12532050468,,6191058815# US\n\nTalk to you then.\n\n- Drew`;
const html = (hi) => `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:600px"><p style="margin:0 0 14px">${hi}</p><p style="margin:0 0 14px">Thanks for joining us on Zoom for today&rsquo;s Europe trip (Croatia 2027) interest meeting.</p><p style="margin:0 0 16px"><b>Sunday, October 11 at 3:30pm (Central)</b></p><p style="margin:0 0 8px"><a href="${ZOOM}" style="display:inline-block;background:#e91e8c;color:#fff;padding:13px 22px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">Join the Zoom meeting &rarr;</a></p><p style="margin:0 0 16px;font-size:13px;color:#555">${ZOOM}<br>Meeting ID: 619 105 8815</p><p style="margin:0 0 16px;font-size:14px">One tap mobile:<br>+13462487799,,6191058815# US (Houston)<br>+12532050468,,6191058815# US</p><p style="margin:0 0 14px">Talk to you then.</p><p style="margin:0">&mdash; Drew</p></div>`;
console.log(`${players.length} families on Zoom: ${texts.length} texts, ${emails.length} emails`);
if (!doSend) { console.log("\n" + TEXT.replace("{first}", (texts[0]?.name || "").split(" ")[0]) + "\n\nSUBJECT: " + subject + "\n" + body(emails[0]?.hi || "Hi,") + "\n\nDRY RUN"); process.exit(0); }
let e = 0, t = 0;
for (const j of emails) {
  const r = await fetch(APP + "/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject, body: body(j.hi), bodyHtml: html(j.hi), recipients: j.to, sentBy: "Drew Rose", sentByEmail: "drew@dselitevolleyball.com", source: "script" }) });
  const o = await r.json().catch(() => ({})); if (r.ok && !o.error) e++; else console.log("EMAIL FAILED: " + (o.error || r.status));
}
for (const j of texts) {
  const r = await fetch(APP + "/api/send-sms", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY }, body: JSON.stringify({ to: j.to, body: TEXT, contact_name: j.name, contact_kind: "parent", player_id: j.player_id, sent_by_label: "Drew Rose" }) });
  const o = await r.json().catch(() => ({})); if (r.ok && !o.error) t++; else console.log("TEXT FAILED " + j.name + ": " + (o.error || r.status));
}
console.log(`Sent ${e} emails, ${t} texts.`);
