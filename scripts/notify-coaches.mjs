// Send one announcement to every rostered coach — email, and a push to anyone
// who has notifications on.
//
// DRY RUN BY DEFAULT. Prints the recipients and the message in full and sends
// nothing until --send.
//
// The subject is the first line of the file, then a blank line, then the body.
//
// Usage:
//   node scripts/notify-coaches.mjs --file note.txt            # dry run
//   node scripts/notify-coaches.mjs --file note.txt --send     # email everyone
//   node scripts/notify-coaches.mjs --file note.txt --send --push
//   node scripts/notify-coaches.mjs --file note.txt --send --to me@x.com
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APP_URL = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };

function loadEnv() {
  let raw = "";
  try { raw = readFileSync(new URL("../.env", import.meta.url), "utf8"); }
  catch { console.error("Missing .env next to package.json."); process.exit(1); }
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const doSend = args.includes("--send");
const doPush = args.includes("--push");
const only = String(arg("to") || "").trim().toLowerCase();
const file = arg("file");
if (!file) { console.error("Need --file note.txt (first line is the subject)"); process.exit(1); }

const text = readFileSync(file, "utf8").replace(/\r/g, "");
const [subject, ...rest] = text.split("\n");
const body = rest.join("\n").trim();
if (!subject.trim() || !body) { console.error("File needs a subject line, a blank line, then the body."); process.exit(1); }

const env = loadEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: roster, error } = await supabase.from("coach_roster").select("first_name,last_name,email");
if (error) { console.error("Load roster failed:", error.message); process.exit(1); }

// A placeholder row on the roster is a slot nobody fills, not a person.
const isPlaceholder = (nm) => /assistant coach|head coach|tbd|coach needed|floater/i.test(nm);
const people = (roster || [])
  .map(r => ({ name: `${r.first_name || ""} ${r.last_name || ""}`.trim(), email: String(r.email || "").trim() }))
  .filter(x => x.name && x.email && !isPlaceholder(x.name))
  .filter(x => !only || x.email.toLowerCase() === only);

const emails = [...new Set(people.map(x => x.email.toLowerCase()))];

console.log(`${people.length} coaches · ${emails.length} distinct addresses`);
console.log(people.map(x => "   " + x.name.padEnd(24) + x.email).join("\n"));
console.log("\n─── message ───────────────────────────────────────────");
console.log("Subject: " + subject.trim() + "\n");
console.log(body);
console.log("───────────────────────────────────────────────────────");

if (!doSend) { console.log("\nDRY RUN — nothing sent. Re-run with --send (add --push for a notification too)."); process.exit(0); }

const res = await fetch(APP_URL + "/api/send-email", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    subject: subject.trim(), body, recipients: emails,
    sentBy: SENDER.name, sentByEmail: SENDER.email, source: "coach announcement",
  }),
});
const out = await res.json().catch(() => ({}));
if (!res.ok || out.error) { console.error("Send failed:", out.error || res.status); process.exit(1); }
console.log(`\nEmailed ${out.sent ?? emails.length}${Array.isArray(out.failed) && out.failed.length ? ", " + out.failed.length + " failed" : ""}.`);

if (doPush) {
  let pushed = 0;
  for (const em of emails) {
    try {
      const r = await fetch(APP_URL + "/api/send-push", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skipEmail: true, title: subject.trim().slice(0, 80),
          body: body.split("\n").find(l => l.trim())?.slice(0, 140) || "Open DS Elite HQ",
          url: "/?view=home", audience: { type: "email", email: em },
        }),
      });
      if (r.ok) pushed++;
    } catch { /* push is best-effort */ }
  }
  console.log(`Pushed to ${pushed} of ${emails.length}.`);
}
