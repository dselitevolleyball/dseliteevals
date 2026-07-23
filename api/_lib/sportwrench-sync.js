// Shared SportWrench → tournaments sync. Consumed by:
//   • api/sportwrench-sync.js          (the one-click bookmarklet endpoint)
//   • scripts/sportwrench-seed-from-json.mjs  (one-off local seed)
//
// SportWrench's public API (events.sportwrench.com/api/esw/events) is behind
// Cloudflare, so it can only be read from a real browser — the bookmarklet does
// that and POSTs the already-filtered events here. We keep National Qualifiers
// (name match) and Texas events, upserting into the tournaments table under
// source "SportWrench:Sync" (distinct from the older bulk "SportWrench:*"
// imports so we never touch those). Dedupe is by source_url.
//
// Incoming event shape (from the bookmarklet):
//   { event_id, name, date_start, date_end, city, state, website, qualifier }

const SOURCE = "SportWrench:Sync";
const swUrl = (id) => "https://events.sportwrench.com/#/events/" + id;
export const isQualifierName = (s) => /qualifier|national championship/i.test(s || "");

export function toTournamentRow(e) {
  const qualifier = e.qualifier != null ? !!e.qualifier : isQualifierName((e.name || "") + " " + (e.long_name || ""));
  return {
    name: e.name || e.long_name,
    start_date: (e.date_start || "").slice(0, 10) || null,
    end_date: (e.date_end || "").slice(0, 10) || null,
    location: [e.city, e.state].filter(Boolean).join(", ") || null,
    is_qualifier: qualifier,
    qualifier_type: qualifier ? "National" : null,
    source: SOURCE,
    source_url: swUrl(e.event_id),
    cancelled: false,
    updated_at: new Date().toISOString(),
  };
}

// Upsert the mapped rows into tournaments; returns { inserted, updated, newRows }.
export async function syncSportWrench(supabase, events) {
  const rows = (events || []).filter((e) => e && e.event_id).map(toTournamentRow);
  const { data: existing } = await supabase.from("tournaments").select("id, source_url").eq("source", SOURCE);
  const idByUrl = new Map((existing || []).map((r) => [r.source_url, r.id]));
  const firstRun = idByUrl.size === 0;

  const updates = rows.filter((r) => idByUrl.has(r.source_url)).map((r) => ({ id: idByUrl.get(r.source_url), ...r }));
  const inserts = rows.filter((r) => !idByUrl.has(r.source_url));

  if (updates.length) { const { error } = await supabase.from("tournaments").upsert(updates, { onConflict: "id" }); if (error) throw new Error("update: " + error.message); }
  if (inserts.length) { const { error } = await supabase.from("tournaments").insert(inserts); if (error) throw new Error("insert: " + error.message); }

  return { firstRun, inserted: inserts.length, updated: updates.length, newRows: inserts };
}
