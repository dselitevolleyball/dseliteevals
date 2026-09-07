// 14 Ruby's Sunday practice moves to 7-9pm until the new gym opens, then 5-7pm.
// DRY RUN BY DEFAULT.  node scripts/send-14ruby-practice-notice.mjs [--send]

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APP_URL = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
const KRISTEN = "kristen@dselitevolleyball.com";
const TERMINAL = ["declined", "not_invited", "opted_out"];

function loadEnv() {
  const raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
const env = loadEnv();
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data, error } = await sb.from("players")
  .select("team_assignment, offer_status, parent_email, parent_email2, parent_email3")
  .eq("team_assignment", "14 Ruby");
if (error) { console.error(error.message); process.exit(1); }

const set = new Set();
for (const p of data.filter(x => !TERMINAL.includes(String(x.offer_status || "").trim())))
  for (const e of [p.parent_email, p.parent_email2, p.parent_email3])
    if (e && e.trim()) set.add(e.trim());
const recipients = [...set];

const SUBJECT = "14 Ruby practice update — Sunday 7-9pm until the new gym opens";
const TEXT = `Hi 14 Ruby families,

A change to Sunday practice, and I want to explain it rather than just drop a new time on you.

Starting this month, 14 Ruby practices Sunday 7-9pm.

Here's the honest reason. We are short on court space right now, and 14 Ruby is the one team we could not fit into an earlier slot. Every other team was already placed, and rather than split your practices across odd days or cut them short, we kept the two hours together and moved them later. It is not the slot I wanted for this group.

This is temporary. When the new gym opens in early October, 14 Ruby moves to Sunday 5-7pm and stays there for the rest of the season. That is the permanent time.

So: 7-9pm on Sundays through the end of September, then 5-7pm from October on. We will confirm the exact changeover date as soon as the building is ready.

I know 7-9 on a Sunday is a real ask on a school night, and I know it falls on you as much as on the girls. Thank you for rolling with it. It is a few weeks, and it buys this team a full uninterrupted practice block instead of a compromise.

If the later time creates a genuine problem for your family on any given Sunday, talk to Coach Jayden and we will work around it.

Appreciate your patience with this one.

Drew Rose
Director, DS Elite Volleyball`;

const html = "<div style=\"font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a\">"
  + TEXT.split("\n\n").map(p => "<p style=\"margin:0 0 14px\">" + p.replace(/\n/g, "<br>") + "</p>").join("") + "</div>";

console.log(`14 Ruby — ${recipients.length} recipients`);
console.log("Subject: " + SUBJECT);
if (!process.argv.includes("--send")) {
  console.log(recipients.join(", "));
  console.log("\nDRY RUN — nothing sent. Re-run with --send.");
} else {
  const res = await fetch(APP_URL + "/api/send-email", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: SUBJECT, body: TEXT, bodyHtml: html, recipients,
      replyTo: KRISTEN, sentBy: SENDER.name, sentByEmail: SENDER.email, source: "script" }),
  });
  const out = await res.json().catch(() => ({}));
  console.log(out.error ? ("FAILED: " + out.error)
    : `Sent ${out.sent} of ${recipients.length}${out.failed?.length ? ", " + out.failed.length + " failed" : ""}.`);
}
