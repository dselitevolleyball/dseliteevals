// Product board -> Slack (Drew, Oct 28 2026: "I want to get slacked when
// someone has a request, not emailed"). One Slack incoming webhook, saved in
// Product -> Settings (hq_kv "product_slack", server-side only). Posts: a new
// staff request, an agent run finishing or failing, and a ship.

export const SLACK_HOOK = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/;
export const HQ_URL = "https://dseliteevals.vercel.app/?view=product";
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const slackLink = (url, text) => `<${url}|${esc(text).replace(/\|/g, "-")}>`;
export const cardLink = (id, title) => slackLink(`${HQ_URL}&item=${id}`, `HQ-${id}: ${title}`);
export const quote = (s, n = 600) => String(s || "").trim().slice(0, n).split("\n").map(l => "> " + esc(l)).join("\n");

export async function productSlack(sb, text, hook) {
  let url = hook;
  if (url === undefined) {
    const { data } = await sb.from("hq_kv").select("value").eq("key", "product_slack").maybeSingle();
    url = data?.value?.url || null;
  }
  if (!url) return { skipped: true };
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, unfurl_links: false, unfurl_media: false }) });
    return { ok: r.ok, status: r.status, error: r.ok ? undefined : (await r.text().catch(() => "")).slice(0, 200) };
  } catch (e) { return { ok: false, error: e.message }; }
}
