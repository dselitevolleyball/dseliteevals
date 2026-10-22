// GET/POST /api/marketing-act?a=<action>&id=<id>&x=<expires>&t=<signature>
// The one-tap buttons in the directors' marketing emails (api/_lib/marketing-links.js):
//   idea        make that idea into a draft (it still needs approving in HQ)
//   spot_send   send the "Meet the Coaches" interview to the coach
//   spot_draft  make the drafts from a coach's answers now
// GET shows what will happen and a button; only the POST from that button
// acts - so a mail scanner that opens links can't post or text anyone.
// Env: as api/marketing.js.

import { serviceSb, loadSettings, log, HQ_MARKETING_URL } from "./_lib/marketing-core.js";
import { verifyAct } from "./_lib/marketing-links.js";
import { acceptIdea } from "./_lib/marketing-scout.js";
import { sendSpotlight, draftSpotlight, SERIES } from "./_lib/marketing-spotlight.js";
import { directorName } from "../shared/dssc-directors.js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const page = (title, body, status = 200) => [status, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{margin:0;background:#061a18;color:#F4F0E8;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;font-size:17px;line-height:1.5}.w{max-width:560px;margin:0 auto;padding:28px 18px}
h1{font:900 34px/1 "Arial Narrow",Impact,sans-serif;text-transform:uppercase;margin:0 0 12px}.m{color:#a9b7b1}button,a.b{display:inline-block;background:#B2D049;color:#061a18;border:0;padding:14px 22px;font-weight:800;font-size:17px;text-decoration:none;cursor:pointer;margin:14px 10px 0 0}a.q{color:#a9b7b1}</style></head>
<body><div class="w">${body}</div></body></html>`];

export default async function handler(req, res) {
  return handleAct(serviceSb(), req, res);
}

export async function handleAct(sb, req, res) {
  res.setHeader("Cache-Control", "no-store");
  const send = ([status, html]) => res.status(status).setHeader("Content-Type", "text/html; charset=utf-8").send(html);
  const u = new URL(req.url, "https://x");
  const a = u.searchParams.get("a") || "", id = u.searchParams.get("id") || "", x = u.searchParams.get("x") || "", t = u.searchParams.get("t") || "";
  if (!verifyAct(a, id, x, t)) return send(page("Link expired", `<h1>This link has expired</h1><p class="m">Open Marketing in HQ to do it from there.</p><a class="b" href="${esc(HQ_MARKETING_URL() + "&mtab=ideas")}">Open HQ →</a>`, 403));
  if (!sb) return send(page("Error", "<h1>Server not configured</h1>", 500));
  const settings = await loadSettings(sb);
  const who = (settings.notify_emails || [])[0] || "a director";
  const hq = HQ_MARKETING_URL() + "&mtab=ideas";

  // What the button will do.
  let what = "", subject = null;
  if (a === "idea") {
    const { data } = await sb.from("mkt_ideas").select("*").eq("id", Number(id)).maybeSingle();
    if (!data) return send(page("Not found", `<h1>That idea is gone</h1><a class="b" href="${esc(hq)}">Open HQ →</a>`, 404));
    subject = data;
    if (data.status === "accepted") return send(page("Already made", `<h1>Already a draft</h1><p class="m">"${esc(data.title)}" is in the Approve tab.</p><a class="b" href="${esc(hq)}">Open HQ →</a>`));
    if (data.status !== "new") return send(page("Not open", `<h1>That idea was ${esc(data.status)}</h1><a class="b" href="${esc(hq)}">Open HQ →</a>`));
    what = `Make <b>${esc(data.title)}</b> into a draft? You'll still approve the post in HQ before it goes out.`;
  } else {
    const { data } = await sb.from("mkt_spotlights").select("*").eq("id", Number(id)).maybeSingle();
    if (!data) return send(page("Not found", `<h1>That spotlight is gone</h1><a class="b" href="${esc(hq)}">Open HQ →</a>`, 404));
    subject = data;
    if (a === "spot_send") {
      if (data.status !== "draft") return send(page("Already sent", `<h1>Already ${esc(data.status)}</h1><p class="m">${esc(data.name)}'s interview isn't waiting to be sent.</p><a class="b" href="${esc(hq)}">Open HQ →</a>`));
      const ways = [data.email ? `email (${esc(data.email)})` : null, data.phone ? "text" : null].filter(Boolean).join(" and ");
      what = `Send the "${esc(SERIES)}" interview to <b>${esc(data.name)}</b> by ${ways || "-"}? ${(data.questions || []).length} questions:<br><span class="m">${(data.questions || []).map(q => "• " + esc(q.q)).join("<br>")}</span>`;
    } else {
      if (data.status !== "answered") return send(page("Nothing to draft", `<h1>Nothing to draft</h1><p class="m">${esc(data.name)}'s spotlight is ${esc(data.status)}.</p><a class="b" href="${esc(hq)}">Open HQ →</a>`));
      what = `Make the post, story and email from <b>${esc(data.name)}</b>'s answers? They'll wait for your approval.`;
    }
  }

  if (req.method === "GET") return send(page("Confirm", `<h1>One tap</h1><p>${what}</p><form method="post"><button type="submit">Yes, do it</button><a class="q" href="${esc(hq)}">Edit in HQ instead</a></form>`));
  if (req.method !== "POST") return send(page("Error", "<h1>GET or POST</h1>", 405));

  const by = `${who} (email link)`;
  try {
    if (a === "idea") {
      const r = await acceptIdea(sb, subject.id, { by });
      return send(page("Done", `<h1>Draft made</h1><p>"${esc(subject.title)}" is waiting in the Approve tab${r.item?.scheduled_at ? ` for ${esc(new Date(r.item.scheduled_at).toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "long", month: "short", day: "numeric" }))}` : ""}.</p><a class="b" href="${esc(HQ_MARKETING_URL(r.item?.week_of))}">Review it →</a>`));
    }
    if (a === "spot_send") {
      const via = settings.scout?.via || ["email", "sms"];
      const r = await sendSpotlight(sb, subject, { via, by, byName: directorName(who).split(" ")[0] || "Drew" });
      await sb.from("mkt_ideas").update({ status: "accepted", decided_by: by, decided_at: new Date().toISOString() }).eq("spotlight_id", subject.id).eq("status", "new");
      await log(sb, null, "spotlight_send", { id: subject.id, by, sent: r.sent, errors: r.errors });
      return send(page("Sent", `<h1>Sent to ${esc(subject.name)}</h1><p>${[r.sent.email ? "Emailed" : null, r.sent.sms ? "texted" : null].filter(Boolean).join(" and ")}. You'll get an email when the answers come in and the drafts are ready.${r.errors.length ? `<br><span class="m">${esc(r.errors.join(" · "))}</span>` : ""}</p><a class="b" href="${esc(hq)}">Open HQ →</a>`));
    }
    const r = await draftSpotlight(sb, subject, { settings, by });
    return send(page("Drafted", `<h1>${r.items.length} drafts made</h1><p>${esc(subject.name)}'s post, story and email are in the Approve tab.</p><a class="b" href="${esc(HQ_MARKETING_URL(r.items[0]?.week_of))}">Review them →</a>`));
  } catch (e) {
    return send(page("Didn't work", `<h1>That didn't work</h1><p class="m">${esc(e.message)}</p><a class="b" href="${esc(hq)}">Open HQ →</a>`, 500));
  }
}
