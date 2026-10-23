// Free music for reels, from Openverse (api.openverse.org) - the open search
// across Creative Commons audio (Jamendo, Freesound, ccMixter, Wikimedia).
// Only licences that allow commercial use without changes or share-alike:
// CC0 (public domain) and CC BY (credit the artist). A CC BY track carries its
// credit line ("Music: "Title" by Artist (CC BY 3.0)"), and the publisher adds
// it to the caption of any reel that uses it - that's the licence's one ask.
//
// Instagram's and TikTok's own music libraries can't be used here: their APIs
// don't let a business account attach a song to a post. This is the music
// HQ mixes into the reels it renders itself.
//
//   searchFreeMusic({ q, mood, page })  -> { results: [...], total, error? }  (a new search can take ~1 min)
//   addFreeTrack(sb, id, { by, mood })   -> mkt_music row (copied into the 'marketing' bucket)

const OV = "https://api.openverse.org/v1/audio/";
const UA = "DSSC-HQ/1.0 (+https://www.drippingsportsclub.com)";
export const MOOD_QUERY = { upbeat: "upbeat", hype: "hip hop", chill: "relaxing", warm: "happy acoustic", epic: "epic cinematic", fun: "fun happy" };
const OK_LICENSES = ["cc0", "by"];
const LICENSE_LABEL = (l, v) => l === "cc0" ? "CC0 (public domain)" : `CC BY ${v || ""}`.trim();

const toResult = (r) => ({
  id: r.id, title: String(r.title || "Untitled").slice(0, 140), artist: r.creator ? String(r.creator).slice(0, 120) : null,
  duration: r.duration ? Math.round(r.duration / 1000) : null, source: r.source || r.provider || null,
  license: r.license, license_version: r.license_version || null, license_label: LICENSE_LABEL(r.license, r.license_version), license_url: r.license_url || null,
  landing: r.foreign_landing_url || null, preview: r.url || null, filetype: r.filetype || null,
  credit: r.license === "cc0" ? null : creditLine(r),
});
export const creditLine = (r) => `Music: "${String(r.title || "Untitled").slice(0, 80)}"${r.creator ? ` by ${String(r.creator).slice(0, 60)}` : ""} (${LICENSE_LABEL(r.license, r.license_version)})`;

export async function searchFreeMusic({ q = "", mood = "", page = 1, timeoutMs = 75000 } = {}) {
  const query = String(q || MOOD_QUERY[mood] || "upbeat").trim().slice(0, 80);
  const url = `${OV}?q=${encodeURIComponent(query)}&license=${OK_LICENSES.join(",")}&category=music&mature=false&page_size=20&page=${Math.max(1, Math.min(10, +page || 1))}`;
  // Openverse answers a repeat search in a second but can take ~50 s on a new
  // one, so wait patiently; retry only a quick failure, not a timeout.
  const get = (ms) => fetch(url, { headers: { Accept: "application/json", "User-Agent": UA }, signal: AbortSignal.timeout(ms) }).catch(e => ({ ok: false, status: 0, e }));
  const t0 = Date.now();
  let r = await get(timeoutMs);
  if (!r.ok && r.status !== 429 && Date.now() - t0 < 10000) r = await get(Math.max(10000, timeoutMs - (Date.now() - t0)));
  if (!r.ok) return { results: [], total: 0, error: r.status === 429 ? "Openverse is rate-limiting searches - try again in a minute" : r.e?.name === "TimeoutError" ? "Openverse is slow right now - try again (repeat searches are fast)" : `Openverse didn't answer (${r.status || r.e?.message || "network"})` };
  const j = await r.json().catch(() => ({}));
  const results = (j.results || []).filter(x => OK_LICENSES.includes(x.license) && x.url && (!x.duration || (x.duration >= 15000 && x.duration <= 480000))).map(toResult);
  return { results, total: j.result_count || results.length, query };
}

// Copy one track into the club's library (so a reel never depends on a third-party link).
export async function addFreeTrack(sb, id, { by = null, mood = [] } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) throw Object.assign(new Error("Unknown track"), { status: 400 });
  const { data: have } = await sb.from("mkt_music").select("*").eq("external_id", id).maybeSingle();
  if (have) return { track: have, already: true };
  const detail = () => fetch(`${OV}${id}/`, { headers: { Accept: "application/json", "User-Agent": UA }, signal: AbortSignal.timeout(45000) }).then(async r => r.ok ? r.json() : { gone: r.status === 404 }).catch(() => ({}));
  let d = await detail();
  if (!d.url && !d.gone) d = await detail();
  if (!d.url) throw Object.assign(new Error(d.gone ? "Openverse doesn't have that track any more" : "Openverse didn't answer - try again in a minute"), { status: d.gone ? 404 : 502 });
  if (!OK_LICENSES.includes(d.license)) throw Object.assign(new Error(`That track's licence (${d.license}) doesn't allow use in club posts`), { status: 400 });
  const a = await fetch(d.url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(45000) }).catch(e => ({ ok: false, status: 0, e }));
  if (!a.ok) throw Object.assign(new Error(`Couldn't download the track (${a.status || a.e?.message || "network"})`), { status: 502 });
  const buf = Buffer.from(await a.arrayBuffer());
  if (buf.length < 20000) throw Object.assign(new Error("The download wasn't an audio file"), { status: 502 });
  if (buf.length > 45 * 1024 * 1024) throw Object.assign(new Error("That track is too big (over 45 MB)"), { status: 400 });
  const ct = String(a.headers.get("content-type") || "").split(";")[0];
  const isWav = /wav/.test(ct) || /wav/i.test(d.filetype || "");
  const type = isWav ? "audio/wav" : /mp4|m4a|aac/.test(ct) ? "audio/mp4" : "audio/mpeg";
  const ext = isWav ? "wav" : type === "audio/mp4" ? "m4a" : "mp3";
  const slug = String(d.title || "track").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "track";
  const path = `music/openverse-${slug}-${id.slice(0, 8)}.${ext}`;
  const up = await sb.storage.from("marketing").upload(path, buf, { contentType: type, cacheControl: "31536000", upsert: true });
  if (up.error) throw Object.assign(new Error("Saving the track: " + up.error.message), { status: 500 });
  const url = sb.storage.from("marketing").getPublicUrl(path).data.publicUrl;
  const r = toResult(d);
  const row = {
    title: r.title, artist: r.artist, url, path, duration: r.duration, mood: (Array.isArray(mood) ? mood : []).filter(Boolean).slice(0, 4),
    rights_ok: true, rights_note: `${r.license_label} via Openverse (${r.source || "Creative Commons"})${r.credit ? " - credit added to captions" : ""}`,
    active: true, created_by: by, external_id: id, source: `openverse:${r.source || ""}`, source_url: r.landing, license: r.license_label, attribution: r.credit,
  };
  const { data, error } = await sb.from("mkt_music").insert(row).select("*").single();
  if (error) throw Object.assign(new Error("Saving the track: " + error.message), { status: 500 });
  return { track: data, already: false };
}
