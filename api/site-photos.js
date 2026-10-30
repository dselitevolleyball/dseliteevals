// Public: the stock photos Drew marked "Use on website" in HQ -> Social ->
// Stock photos, with Claude's alt text, role and focal point (api/_lib/dse-stock-ai.js).
//
//   GET /api/site-photos → { ok, photos: [{ key, url, w, h, role, alt, focal: [x%, y%], team, team_name }] }
//
// The website repo's scripts/pull-stock-photos.mjs reads this, downloads each
// photo into its manifest (scripts/photos.config.json) and runs the optimizer,
// so these become ordinary site photos (keys "hq-<id>"). team is the hub/website
// team slug ('14-diamond') or null for club-wide. Only website-marked, not
// hidden, Claude-approved photos; never a note, uploader or usage count.
import { createClient } from "@supabase/supabase-js";
import { slugOf } from "./hub-data.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("X-Robots-Tag", "noindex");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "GET only" });
  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data, error } = await sb.from("dse_social_stock").select("id, url, width, height, team_name, ai").eq("website", true).eq("hidden", false).order("website_at");
    if (error) throw error;
    const photos = (data || []).filter(p => p.ai && p.ai.social_ok !== false).map(p => ({
      key: `hq-${p.id}`, url: p.url, w: p.width, h: p.height,
      role: ["hero", "section", "gallery"].includes(p.ai.website_role) ? p.ai.website_role : "gallery",
      alt: p.ai.alt || p.ai.description || "DS Elite Volleyball",
      focal: [p.ai.focal_x ?? 50, p.ai.focal_y ?? 50],
      team: p.team_name ? slugOf(p.team_name) : null, team_name: p.team_name ? String(p.team_name).replace(/^(\d+ Rise) 1$/, "$1") : null,
    }));
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({ ok: true, photos });
  } catch (e) {
    console.error("site-photos", e.message);
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({ ok: false, error: "Couldn't load the photos right now." });
  }
}
