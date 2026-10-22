// GET/POST /api/marketing-unsubscribe?e=<email>&t=<token> — leave the DSSC
// marketing email (api/marketing-cron.js sends it; every message carries this
// link and a one-click List-Unsubscribe header that POSTs here).
// The token is an HMAC of the address (MARKETING_UNSUB_SECRET, or CRON_SECRET),
// so nobody can unsubscribe someone else. GET shows a small confirmation page.
// Reached publicly at https://www.drippingsportsclub.com/hq/api/marketing-unsubscribe.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MARKETING_UNSUB_SECRET.

import { serviceClient, esc } from "./_lib/site-forms.js";
import { verifyUnsub } from "./_lib/marketing-publish.js";
import { nrm } from "./_lib/site-inbox.js";

const page = (title, msg) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Dripping Springs Sports Club</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@900&family=Schibsted+Grotesk:wght@400;700&display=swap" rel="stylesheet"></head>
<body style="margin:0;background:#061a18;color:#F4F0E8;font-family:'Schibsted Grotesk',Helvetica,Arial,sans-serif"><div style="max-width:520px;margin:0 auto;padding:56px 16px">
<img src="https://www.drippingsportsclub.com/brand/logo-light.png" alt="Dripping Springs Sports Club" width="200" style="display:block;width:200px;height:auto;margin-bottom:28px">
<h1 style="font-family:'Barlow Condensed','Arial Narrow',Impact,sans-serif;font-weight:900;text-transform:uppercase;font-size:44px;line-height:.95;margin:0 0 14px">${title}</h1>
<p style="font-size:17px;line-height:1.55;color:#a9b7b1;margin:0 0 22px">${msg}</p>
<a href="https://www.drippingsportsclub.com" style="display:inline-block;background:#B2D049;color:#061a18;font-family:'Barlow Condensed','Arial Narrow',Impact,sans-serif;font-weight:900;text-transform:uppercase;font-size:20px;padding:12px 22px;text-decoration:none;clip-path:polygon(0 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%)">Back to drippingsportsclub.com</a>
</div></body></html>`;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  const q = req.query || {};
  const email = nrm(q.e), t = String(q.t || "").trim();
  if (!verifyUnsub(email, t)) {
    if (req.method === "POST") return res.status(400).json({ ok: false });
    return res.status(400).send(page("Link incomplete", "That unsubscribe link didn't come through whole. Reply to any of our emails and we'll take you off the list."));
  }
  const sb = serviceClient();
  if (!sb) return res.status(500).send(page("Try again", "Something went wrong on our side. Please try the link again in a minute."));
  const { error } = await sb.from("mkt_unsubscribes").upsert({ email }, { onConflict: "email", ignoreDuplicates: true });
  if (error) {
    console.error("marketing-unsubscribe", error.message);
    if (req.method === "POST") return res.status(500).json({ ok: false });
    return res.status(500).send(page("Try again", "Something went wrong on our side. Please try the link again in a minute."));
  }
  await sb.from("mkt_log").insert({ kind: "unsubscribe", detail: { email } }).then(() => {}, () => {});
  if (req.method === "POST") return res.status(200).json({ ok: true });
  return res.status(200).send(page("You're unsubscribed", `${esc(email)} won't get any more club news emails from DSSC. You'll still get messages about programs you sign up for. Changed your mind? Reply to any of our emails.`));
}
