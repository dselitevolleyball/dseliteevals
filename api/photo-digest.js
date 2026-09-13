// Vercel Cron: a morning email of the team photos that came in since the last.
//
// Families and coaches upload through /photos into a private bucket that only
// staff can open in DS HQ. The people who turn photos into posts shouldn't
// have to go looking — and one of them isn't a DS HQ user at all — so this
// brings the new ones to them.
//
// ONLY WHAT'S NEW, AND EVERYTHING ONCE
//
// Each photo is stamped digested_at when it goes out, so it's in exactly one
// email: nothing falls in a gap between two time windows, nothing repeats when
// a run is retried. A day with no uploads sends nothing at all.
//
// The files stay private. The email carries signed links good for 7 days —
// long enough to be used, short enough that a forwarded email stops working.
// Still images show inline; videos and anything an email client can't draw
// (HEIC) are a link.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; also ?token=.
// Query: ?dry=1   what would be sent, nothing sent or stamped
//        ?test=1  send to Drew only, nothing stamped
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
//      RESEND_API_KEY (or resend_api_key), DSE_FROM_EMAIL,
//      PHOTO_DIGEST_TO (opt, comma list).

import { createClient } from "@supabase/supabase-js";

const TO_DEFAULT = "drew@dselitevolleyball.com,aksprys19@gmail.com";
const TEST_TO = "drew@dselitevolleyball.com";
const BUCKET = "team-photos";
const LINK_SECONDS = 7 * 24 * 3600;
const MAX_PER_EMAIL = 200;          // a flood after a tournament rolls into tomorrow's email
const APP = "https://dseliteevals.vercel.app";
const INLINE = /^image\/(jpeg|jpg|png|webp|gif)$/i;

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmtDay = (iso) => { try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" }); } catch { return ""; } };

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, PHOTO_DIGEST_TO } = process.env;

  const url = (() => { try { return new URL(req.url, "https://x"); } catch { return null; } })();
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!CRON_SECRET || (bearer !== CRON_SECRET && (url?.searchParams.get("token") || "") !== CRON_SECRET)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Server not configured" });

  const dry = url?.searchParams.get("dry") === "1";
  const test = url?.searchParams.get("test") === "1";
  const to = test ? [TEST_TO] : (PHOTO_DIGEST_TO || TO_DEFAULT).split(",").map(s => s.trim()).filter(Boolean);

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: fresh, error } = await sb.from("player_photos").select("*")
    .is("digested_at", null).order("created_at").limit(MAX_PER_EMAIL + 1);
  if (error) return res.status(500).json({ error: error.message });
  if (!fresh?.length) return res.status(200).json({ ok: true, new: 0, emailed: false });

  const batch = fresh.slice(0, MAX_PER_EMAIL);
  const more = fresh.length > MAX_PER_EMAIL;
  // First ever digest carries the backlog, and says so rather than "since yesterday".
  const { count: everSent } = await sb.from("player_photos").select("id", { count: "exact", head: true }).not("digested_at", "is", null);
  const firstRun = !everSent;

  const playerIds = [...new Set(batch.map(p => p.player_id).filter(Boolean))];
  const { data: players } = playerIds.length
    ? await sb.from("players").select("id, first_name, last_name").in("id", playerIds) : { data: [] };
  const playerName = new Map((players || []).map(p => [p.id, `${p.first_name} ${p.last_name}`]));
  const credit = (p) => {
    const who = String(p.uploaded_by || "").trim();
    if (p.coach_id) return "Coach " + (who || "(unnamed)");
    const fam = p.player_id && playerName.get(p.player_id);
    return fam ? (who ? `${who} (${fam}'s family)` : `${fam}'s family`) : (who || "a family");
  };

  const { data: signed } = await sb.storage.from(BUCKET).createSignedUrls(batch.map(p => p.storage_path), LINK_SECONDS);
  const linkFor = new Map((signed || []).filter(s => s.signedUrl).map(s => [s.path, s.signedUrl]));

  // Team → event, in upload order within each.
  const groups = new Map();
  for (const p of batch) {
    const team = p.team_name || "No team";
    const event = p.event_label || "Other";
    if (!groups.has(team)) groups.set(team, new Map());
    const byEvent = groups.get(team);
    if (!byEvent.has(event)) byEvent.set(event, []);
    byEvent.get(event).push(p);
  }
  const teams = [...groups.keys()].sort();
  const videos = batch.filter(p => /^video\//i.test(p.content_type || "")).length;
  const stills = batch.length - videos;
  const counts = [stills && `${stills} photo${stills === 1 ? "" : "s"}`, videos && `${videos} video${videos === 1 ? "" : "s"}`].filter(Boolean).join(" and ");

  if (dry) {
    return res.status(200).json({ ok: true, dry: true, first_run: firstRun, new: batch.length, more_waiting: more, to,
      by_team: teams.map(t => ({ team: t, events: [...groups.get(t)].map(([e, list]) => ({ event: e, count: list.length })) })) });
  }
  const tile = (p) => {
    const href = linkFor.get(p.storage_path);
    if (!href) return `<td style="padding:4px;vertical-align:top;width:25%"><div style="height:120px;background:#f3f3f3;border-radius:6px;font-size:11px;color:#999;text-align:center;line-height:120px">unavailable</div></td>`;
    const isVideo = /^video\//i.test(p.content_type || "");
    const inner = INLINE.test(p.content_type || "") && !isVideo
      ? `<img src="${esc(href)}" alt="${esc(p.original_name || "photo")}" width="132" style="display:block;width:100%;max-width:132px;height:auto;border-radius:6px;border:1px solid #e5e5e5">`
      : `<div style="height:110px;background:#111;border-radius:6px;color:#fff;font-size:13px;font-weight:700;text-align:center;line-height:110px">${isVideo ? "&#9654; Video" : "Open file"}</div>`;
    return `<td style="padding:4px;vertical-align:top;width:25%"><a href="${esc(href)}" style="text-decoration:none">${inner}</a></td>`;
  };
  const grid = (list) => {
    let rows = "";
    for (let i = 0; i < list.length; i += 4) {
      const cells = list.slice(i, i + 4).map(tile).join("");
      rows += `<tr>${cells}${"<td style=\"width:25%\"></td>".repeat(4 - Math.min(4, list.length - i))}</tr>`;
    }
    return `<table role="presentation" style="border-collapse:collapse;width:100%;max-width:580px;margin:0 0 6px">${rows}</table>`;
  };

  const sections = teams.map(team => {
    const byEvent = groups.get(team);
    const n = [...byEvent.values()].reduce((s, l) => s + l.length, 0);
    return `<p style="margin:26px 0 4px;font-size:17px;font-weight:800;color:#1a1a1a">${esc(team)} <span style="font-weight:600;color:#999;font-size:13px">&middot; ${n}</span></p>`
      + [...byEvent.entries()].map(([event, list]) => {
        const who = [...new Set(list.map(credit))].join(", ");
        const captions = list.map(p => String(p.caption || "").trim()).filter(Boolean);
        return `<p style="margin:12px 0 4px;font-size:13px;font-weight:700;color:#c2186f;text-transform:uppercase;letter-spacing:.04em">${esc(event)}</p>`
          + `<p style="margin:0 0 6px;font-size:12px;color:#777">From ${esc(who)} &middot; sent ${esc(fmtDay(list[0].created_at))}${list.length > 1 && fmtDay(list[list.length - 1].created_at) !== fmtDay(list[0].created_at) ? "&ndash;" + esc(fmtDay(list[list.length - 1].created_at)) : ""}</p>`
          + (captions.length ? `<p style="margin:0 0 6px;font-size:13px;color:#333;font-style:italic">&ldquo;${captions.map(esc).join("&rdquo; &middot; &ldquo;")}&rdquo;</p>` : "")
          + grid(list);
      }).join("");
  }).join("");

  const lead = firstRun
    ? `Everything uploaded so far &mdash; <b>${counts}</b> across ${teams.length} team${teams.length === 1 ? "" : "s"}. From tomorrow this only arrives when new ones come in.`
    : `<b>${counts}</b> came in since the last email, across ${teams.length} team${teams.length === 1 ? "" : "s"}.`;

  const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;max-width:600px">'
    + `<p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#c2186f">DS Elite &middot; team photos</p>`
    + `<p style="margin:0 0 10px">${lead}</p>`
    + `<p style="margin:0 0 4px;font-size:12px;color:#777">Tap any photo for the full-size file. Links work for 7 days.</p>`
    + sections
    + (more ? `<p style="margin:22px 0 0;padding:10px 12px;background:#fff4f9;border-radius:6px;font-size:13px">More came in than fit in one email &mdash; the rest arrive tomorrow.</p>` : "")
    + `<p style="margin:26px 0 0;font-size:12px;color:#999">Staff can see the whole library any time in DS HQ &rarr; Team Photos: ${APP}/?view=photos</p>`
    + '</div>';

  const text = (firstRun ? `Everything uploaded so far — ${counts} across ${teams.length} team(s).` : `${counts} came in since the last email.`)
    + "\nLinks work for 7 days.\n\n"
    + teams.map(team => `${team}\n` + [...groups.get(team).entries()].map(([event, list]) =>
        `  ${event} — from ${[...new Set(list.map(credit))].join(", ")}\n` + list.map(p => "    " + (linkFor.get(p.storage_path) || "(unavailable)")).join("\n")
      ).join("\n")).join("\n\n")
    + (more ? "\n\nMore came in than fit — the rest arrive tomorrow." : "");

  // Through send-email rather than straight to Resend, so each digest is in
  // sent history like every other message, and anyone on it who uses DS HQ
  // also gets it as a notification that opens the gallery.
  const r = await fetch(APP + "/api/send-email", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: (test ? "[TEST] " : "") + `New team photos — ${counts}` + (teams.length <= 3 ? ` (${teams.join(", ")})` : ""),
      body: text, bodyHtml: html, recipients: to,
      sentBy: "DS Elite HQ", source: "photo-digest", url: "/?view=photos",
    }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok || out.error || !out.sent) {
    return res.status(502).json({ error: "Email failed: " + (out.error || r.status), new: batch.length });
  }

  // Stamped only after the send succeeds, so a failed email is retried
  // tomorrow instead of the photos being counted as delivered. A test run
  // stamps nothing, so the real recipients still get these.
  if (!test) {
    const { error: stampErr } = await sb.from("player_photos").update({ digested_at: new Date().toISOString() }).in("id", batch.map(p => p.id));
    if (stampErr) return res.status(200).json({ ok: true, emailed: true, warning: "sent but not stamped — tomorrow may repeat: " + stampErr.message });
  }
  return res.status(200).json({ ok: true, emailed: true, test, to, new: batch.length, more_waiting: more, first_run: firstRun });
}
