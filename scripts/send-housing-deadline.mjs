// Text the parents of players who still haven't booked tournament housing,
// one personal text per parent from the DS Elite number, signed Coach Drew.
//
//   node scripts/send-housing-deadline.mjs --dry     # print every text, send nothing
//   node scripts/send-housing-deadline.mjs --send    # send them
//   add --wait to retry until the deploy accepting the service key is live
//
// Edit PLAYERS / EVENT below for the next deadline.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APP = "https://dseliteevals.vercel.app";
const PLAYERS = [310, 396, 407, 100, 274]; // Addison Robbins, Isla Walker (16 Diamond), Ciara Smith (15 Diamond), Riley Hjornevik, Harper Ward (15 Ruby)
const EVENT = "the Red Rock Rave National Qualifier in Las Vegas (Mar 5–7)";

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const args = process.argv.slice(2), send = args.includes("--send");
if (!send && !args.includes("--dry")) { console.error("Say --dry or --send."); process.exit(1); }

const e164 = (s) => { const d = String(s || "").replace(/\D/g, ""); if (d.length === 10) return "+1" + d; if (d.length === 11 && d.startsWith("1")) return "+" + d; return ""; };
const first = (s) => String(s || "").trim().split(/\s+/)[0] || "";
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: players, error } = await sb.from("players").select("id, first_name, last_name, team_assignment, parent_name, parent_phone, parent2_name, parent2_phone").in("id", PLAYERS);
if (error) throw error;
const { data: outs } = await sb.from("sms_optouts").select("phone").eq("brand", "dse");
const optedOut = new Set((outs || []).map((o) => o.phone));

const texts = [], seen = new Set();
for (const p of players) {
  for (const [name, phone] of [[p.parent_name, p.parent_phone], [p.parent2_name, p.parent2_phone]]) {
    const to = e164(phone);
    if (!to || seen.has(to)) continue; seen.add(to);
    if (optedOut.has(to)) { console.log(`skip ${name} ${to}: opted out`); continue; }
    const hi = first(name) ? `Hi ${first(name)}, ` : "Hi, ";
    const body = `${hi}it's Coach Drew with DS Elite. We don't have a hotel booked for ${p.first_name} yet for ${EVENT}. The housing deadline is tonight at 11:59pm, so please book your room today through KC Sports Housing. If you've already booked, just reply and let me know. Thank you! – Coach Drew`;
    texts.push({ to, body, player_id: p.id, team_name: p.team_assignment, contact_name: String(name || "").trim(), contact_kind: "parent", sent_by_label: "Drew Rose", brand: "dse" });
  }
}
for (const t of texts) console.log(`\n${t.contact_name} ${t.to} (${t.team_name})\n${t.body}`);
console.log(`\n${texts.length} texts`);
if (!send) process.exit(0);

let ok = 0; const failed = [];
for (const t of texts) {
  for (let i = 1; i <= (args.includes("--wait") ? 30 : 1); i++) {
    const r = await fetch(APP + "/api/send-sms", { method: "POST", headers: { Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY, "Content-Type": "application/json" }, body: JSON.stringify(t) });
    const j = await r.json().catch(() => ({}));
    if ((r.status === 401 || r.status === 403) && i < 30 && args.includes("--wait")) { console.log(`waiting for deploy (${r.status})…`); await new Promise((res) => setTimeout(res, 10000)); continue; }
    if (r.ok) { ok++; console.log(`sent ${t.contact_name} ${t.to} ${j.status || ""}`); } else { failed.push(t); console.log(`FAILED ${t.contact_name} ${t.to}: ${j.error || r.status}`); }
    break;
  }
}
console.log(`\n${ok} sent, ${failed.length} failed`);
