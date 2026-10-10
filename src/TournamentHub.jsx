// Tournament Hub (HQ) — every DS Elite team's schedule and results at a
// tournament, live from the platform that runs it (AES or OTTO, the renamed
// SportWrench). Drew, 10 Oct 2026: "an easy way for parents, coaches and
// directors to see who they are playing and when, in real time during the week
// leading up and during the tournament ... like Volleyball Hub".
//
// Read-only over two tables the 5-minute sync writes (api/tournament-sync.js):
// tournament_feeds (which AES/OTTO event a tournament's games are on) and
// tournament_team_feed (one row per team with its normalized TeamSnapshot —
// shape in shared/tournament-feed.js). Nothing here calls AES or OTTO: OTTO has
// no CORS, and one server poll beats every coach's phone polling.
//
// The NEXT card is recomputed here at the venue's wall clock (withNext +
// localNow(tz)), not taken from the stored snapshot, so it moves on between
// syncs and is right for an Anaheim or Honolulu event viewed from Texas.
//
// Coaches see their own teams first and open; everyone else's collapsed to the
// one-line NEXT summary. Ops also get each tournament's feed status and the
// fixes: paste an AES/OTTO link (POST /api/tournament-feed {action:'link'}),
// "Sync now" and unlink — the auto-discovery can't find an event that isn't
// posted, or a Lone Star Classic site under a name nobody would guess.
//
// Event teams (14 Crystal, practices_per_week 0) show to ops only — never to
// coaches, never on the public hub (shared/event-teams.js).

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { tzForTournament, localNow, withNext, fmtTime, fmtDay, cleanTeamText, ordinal } from "../shared/tournament-feed.js";

const DEF_C = { bg: "#0a0a0a", card: "#141414", border: "#2a2a2a", gold: "#e91e8c", text: "#ffffff", mut: "#999999", red: "#ef4444", grn: "#22c55e" };
// Statuses that mean the team isn't going (src/App.jsx TN statuses) — the same
// "counted" rule the sync uses to decide which teams to look for.
const NOT_GOING = ["dropped", "need_to_drop"];
const PLATFORM = { aes: "AES", otto: "OTTO" };
const LEVEL_TAG = { National: "National", Regional: "Regional", Developmental: "Rise" };
const LEVEL_ORDER = { National: 0, Regional: 1, Developmental: 2 };

// /hub?team=14-diamond — the public page's team slug; keep in step with
// slugOf in api/hub-data.js.
const hubSlug = (name) => String(name || "").trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]+/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
const courtText = (c) => (c == null || c === "" ? "" : /^\d+$/.test(String(c)) ? `Court ${c}` : String(c));
const setsText = (sets) => (Array.isArray(sets) ? sets : []).map(([a, b]) => `${a}-${b}`).join(", ");
const addDaysISO = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const dateSpan = (s, e) => (!s ? "" : !e || e === s ? fmtDay(s) : `${fmtDay(s)} – ${fmtDay(e)}`);
function ago(iso, nowMs) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return null;
  const m = Math.round((nowMs - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
// "MST", "PDT", "HST" — shown when the venue isn't on Central time.
function zoneAbbr(tz, date) {
  try { return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(date).find((p) => p.type === "timeZoneName")?.value || tz; } catch { return tz; }
}
// Fallback platform links when a snapshot has none yet (unpublished feed):
// results page once there's a key, else an AES event's registration page
// (the same www link api/aes-poll.js stores as source_url).
const feedUrl = (f) => {
  if (!f) return null;
  if (f.event_key) return f.platform === "otto" ? `https://events.ottoevent.ai/event/${encodeURIComponent(f.event_key)}` : `https://results.advancedeventsystems.com/event/${encodeURIComponent(f.event_key)}/home`;
  return f.platform === "aes" && /^\d+$/.test(String(f.event_ref || "")) ? `https://www.advancedeventsystems.com/${f.event_ref}` : null;
};
// "7th overall" only when the place is division-wide (AES OverallRank, an
// OTTO rank without a flight heading) — the finish push's rule
// (shared/tournament-feed.js alertsFor). "1st (Gold 1)" and a bare AES
// flight place stay as they are.
const finishText = (f) => (!f?.text ? "" : f.overall === true ? `${f.text} overall` : f.text);
// The state a place is in: "Foley, AL" → "AL". The last two-letter code wins
// ("La Vernia, Texas 78121, TX"), as stateOf in api/_lib/tournament-sync-core.js;
// withNames also reads a spelled-out state ("Dallas, Texas") — only for a
// location field, since venue names carry words like "Washington".
const US_STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "));
const STATE_NAMES = Object.fromEntries(("alabama AL|alaska AK|arizona AZ|arkansas AR|california CA|colorado CO|connecticut CT|delaware DE|florida FL|georgia GA|hawaii HI|idaho ID|illinois IL|indiana IN|iowa IA|kansas KS|kentucky KY|louisiana LA|maine ME|maryland MD|massachusetts MA|michigan MI|minnesota MN|mississippi MS|missouri MO|montana MT|nebraska NE|nevada NV|new hampshire NH|new jersey NJ|new mexico NM|new york NY|north carolina NC|north dakota ND|ohio OH|oklahoma OK|oregon OR|pennsylvania PA|rhode island RI|south carolina SC|south dakota SD|tennessee TN|texas TX|utah UT|vermont VT|virginia VA|washington WA|west virginia WV|wisconsin WI|wyoming WY")
  .split("|").map((x) => { const i = x.lastIndexOf(" "); return [x.slice(0, i), x.slice(i + 1)]; }));
function stateIn(s, withNames = false) {
  const str = String(s || "");
  const codes = [...str.matchAll(/\b([A-Z]{2})\b/g)].map((m) => m[1]).filter((c) => US_STATES.has(c));
  if (codes.length) return codes[codes.length - 1];
  if (!withNames) return null;
  // Longest first, so "West Virginia" isn't read as "Virginia".
  const nm = Object.keys(STATE_NAMES).sort((a, b) => b.length - a.length).find((n) => new RegExp("\\b" + n + "\\b", "i").test(str));
  return nm ? STATE_NAMES[nm] : null;
}

export default function TournamentHub({
  supabase, C: Cprop, tournaments = [], tournamentAssignments = [], practiceTeams = [], practiceTeamsAll = [],
  isOps = false, myTeamNames = [], initialTournamentId = null, onConsumedInitial, session,
  now: nowFn, // optional () => Date, for the dev harness only; App never passes it
}) {
  const C = { ...DEF_C, amber: "#f59e0b", cyan: "#22d3ee", ...(Cprop || {}) };
  const clock = useCallback(() => (nowFn ? nowFn() : new Date()), [nowFn]);
  const [selId, setSelId] = useState(initialTournamentId ?? null);
  const [feeds, setFeeds] = useState([]);
  const [feedsLoaded, setFeedsLoaded] = useState(false);
  const [rows, setRows] = useState([]);
  const [rowsFor, setRowsFor] = useState(null);      // tournament id the rows belong to
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState({});              // `${tournament}|${team}` → bool (else the default)
  const [busy, setBusy] = useState("");              // 'link' | 'sync' | 'unlink:<id>'
  const [msg, setMsg] = useState(null);              // { ok, text }
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTeams, setLinkTeams] = useState([]);    // [] = every counted team found in it
  const [copied, setCopied] = useState("");
  const selRef = useRef(selId);
  selRef.current = selId;

  // App hands over a tournament once (TournamentCard's "Schedule & results").
  useEffect(() => {
    if (initialTournamentId == null) return;
    setSelId(initialTournamentId);
    onConsumedInitial?.();
  }, [initialTournamentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Who's going where ───────────────────────────────────────────────────
  const eventTeams = useMemo(() => {
    const regular = new Set(practiceTeams.map((t) => t.team_name));
    return new Set(practiceTeamsAll.map((t) => t.team_name).filter((n) => !regular.has(n)));
  }, [practiceTeams, practiceTeamsAll]);
  const levelOf = useMemo(() => new Map(practiceTeamsAll.map((t) => [t.team_name, t.level])), [practiceTeamsAll]);
  const goingByTn = useMemo(() => {
    const m = new Map();
    for (const a of tournamentAssignments) {
      if (!a || NOT_GOING.includes(a.status)) continue;
      if (!isOps && eventTeams.has(a.team_id)) continue;
      if (!m.has(a.tournament_id)) m.set(a.tournament_id, new Set());
      m.get(a.tournament_id).add(a.team_id);
    }
    return m;
  }, [tournamentAssignments, eventTeams, isOps]);
  const mine = useMemo(() => new Set(myTeamNames), [myTeamNames]);

  const nowDate = clock();
  const nowMs = nowDate.getTime();
  const centralToday = localNow("America/Chicago", nowDate).slice(0, 10);
  const tzOf = (t) => tzForTournament(t);
  const stateOf = (t) => {
    const today = localNow(tzOf(t), nowDate).slice(0, 10);
    const end = t.end_date || t.start_date;
    return today < t.start_date ? "upcoming" : today > end ? "past" : "live";
  };

  const cands = useMemo(() => tournaments.filter((t) => t && !t.cancelled && t.start_date && goingByTn.has(t.id)), [tournaments, goingByTn]);
  const tnIdsKey = cands.map((t) => t.id).sort((a, b) => a - b).join(",");

  // ── Loading ─────────────────────────────────────────────────────────────
  const loadFeeds = useCallback(async () => {
    const ids = tnIdsKey ? tnIdsKey.split(",").map(Number) : [];
    if (!ids.length) { setFeeds([]); setFeedsLoaded(true); return; }
    const { data, error } = await supabase.from("tournament_feeds").select("*").in("tournament_id", ids);
    if (error) setErr("Couldn't load event links: " + error.message);
    else setFeeds(data || []);
    setFeedsLoaded(true);
  }, [supabase, tnIdsKey]);
  const loadRows = useCallback(async (id) => {
    if (id == null) return;
    const { data, error } = await supabase.from("tournament_team_feed").select("*").eq("tournament_id", id);
    if (selRef.current !== id) return; // switched tournaments meanwhile
    if (error) { setErr("Couldn't load schedules: " + error.message); return; }
    setRows(data || []);
    setRowsFor(id);
  }, [supabase]);
  const reload = useCallback(async () => {
    setLoading(true); setErr("");
    await Promise.all([loadFeeds(), loadRows(selRef.current)]);
    setLoading(false);
  }, [loadFeeds, loadRows]);
  useEffect(() => { loadFeeds(); }, [loadFeeds]);
  useEffect(() => { if (selId != null) { setErr(""); loadRows(selId); } }, [selId, loadRows]);

  // Default: the tournament being played now, else the next one — with a
  // feed first, and for a coach one of their own teams is at.
  const feedTn = useMemo(() => new Set(feeds.map((f) => f.tournament_id)), [feeds]);
  const sortKey = (t) => {
    const s = stateOf(t), f = feedTn.has(t.id) ? 0 : 1;
    const m = !isOps && [...(goingByTn.get(t.id) || [])].some((n) => mine.has(n)) ? 0 : 1;
    return s === "live" ? `0${f}${m}${t.start_date}` : s === "upcoming" ? `1${f}${m}${t.start_date}` : `2${f}${m}${String(99999999 - Number(String(t.end_date || t.start_date).replace(/-/g, "")))}`;
  };
  useEffect(() => {
    if (selId != null || !feedsLoaded || !cands.length) return;
    setSelId([...cands].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))[0].id);
  }, [feedsLoaded, cands, selId]); // eslint-disable-line react-hooks/exhaustive-deps

  const sel = cands.find((t) => t.id === selId) || tournaments.find((t) => t && t.id === selId) || null;
  const selState = sel ? stateOf(sel) : null;
  const isLive = selState === "live";

  // While a tournament is being played: re-read every 60 s when the tab is
  // visible (the sync writes every 5 min; this keeps NEXT moving in between),
  // and at once when the coach comes back to the tab.
  useEffect(() => {
    if (!isLive) return;
    const vis = () => typeof document === "undefined" || document.visibilityState === "visible";
    const id = setInterval(() => { if (vis()) reload(); }, 60000);
    const onVis = () => { if (vis()) reload(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [isLive, selId, reload]);

  // ── Ops actions (api/tournament-feed.js, owner/admin session bearer) ─────
  // Responses: link → { feed, mapped:[{team,found}], not_found, not_going, sync, feeds, rows };
  // sync → { ok, sync:{ tournaments:[{ error?, feeds:[{error?}], discovery:{errors} }], skipped }, feeds, rows };
  // unlink → { removed, feeds, rows }; failures → { error } with a 4xx/5xx.
  const syncProblems = (sync) => {
    const t0 = sync?.tournaments?.[0];
    return [t0?.error, ...(t0?.feeds || []).map((f) => f?.error), ...(t0?.discovery?.errors || [])].filter(Boolean);
  };
  const post = async (body) => {
    if (!session?.access_token) throw new Error("Your sign-in has expired — reload HQ.");
    const r = await fetch("/api/tournament-feed", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token }, body: JSON.stringify(body) });
    let j = null;
    try { j = await r.json(); } catch { /* not json (e.g. a gateway timeout page) */ }
    if (!r.ok || !j || j.error || j.ok === false) throw new Error((j && (j.error || syncProblems(j.sync)[0])) || `HTTP ${r.status}`);
    return j;
  };
  const doLink = async () => {
    const url = linkUrl.trim();
    if (!url || !sel) return;
    setBusy("link"); setMsg(null);
    try {
      const j = await post({ action: "link", tournament_id: sel.id, url, ...(linkTeams.length ? { teams: linkTeams } : {}) });
      const found = (j.mapped || []).filter((m) => m.found).map((m) => m.team);
      const missing = j.not_found || [], notGoing = j.not_going || [];
      setMsg({ ok: true, text: `Linked to ${j.feed?.event_name || "the event"}.`
        + (found.length ? ` Found ${found.join(", ")}.` : " None of the teams going are in it yet — check the link, or pick the teams and link again.")
        + (found.length && missing.length ? ` ${linkTeams.length ? "Linked but not found in it yet" : "Not in it"}: ${missing.join(", ")}.` : "")
        + (notGoing.length ? ` Not going to this tournament: ${notGoing.join(", ")}.` : "") });
      setLinkUrl(""); setLinkTeams([]);
    } catch (e) { setMsg({ ok: false, text: "Couldn't link: " + e.message }); }
    setBusy(""); reload();
  };
  const doSync = async () => {
    if (!sel) return;
    setBusy("sync"); setMsg(null);
    try {
      const j = await post({ action: "sync", tournament_id: sel.id });
      const fl = j.feeds || [], probs = syncProblems(j.sync), skipped = j.sync?.skipped?.find((x) => String(x.id) === String(sel.id));
      setMsg(skipped && !j.sync?.tournaments?.length ? { ok: false, text: "Not synced: " + (skipped.why || "outside the sync window") }
        : { ok: !probs.length, text: `Synced. ${fl.length ? `${fl.length} event${fl.length === 1 ? "" : "s"} linked, ${fl.filter((f) => f.published).length} posted.` : "No AES/OTTO event found yet."}${probs.length ? ` ${probs.length} problem${probs.length === 1 ? "" : "s"}: ${probs[0]}` : ""}` });
    } catch (e) { setMsg({ ok: false, text: "Sync failed: " + e.message }); }
    setBusy(""); reload();
  };
  const doUnlink = async (f) => {
    if (!sel || !window.confirm(`Unlink ${PLATFORM[f.platform] || f.platform} "${f.event_name || f.event_ref}" from ${sel.name}? Its teams' schedules disappear here and on the parent hub until it's linked again.`)) return;
    setBusy("unlink:" + f.id); setMsg(null);
    try { await post({ action: "unlink", tournament_id: sel.id, feed_id: f.id }); setMsg({ ok: true, text: "Unlinked." }); }
    catch (e) { setMsg({ ok: false, text: "Couldn't unlink: " + e.message }); }
    setBusy(""); reload();
  };
  const copyLink = async (team) => {
    const url = window.location.origin + "/hub?team=" + hubSlug(team);
    try { await navigator.clipboard.writeText(url); setCopied(team); setTimeout(() => setCopied((c) => (c === team ? "" : c)), 2000); }
    catch { window.prompt("Copy the parent link:", url); }
  };

  // ── Styles ──────────────────────────────────────────────────────────────
  const box = { background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 14, marginBottom: 12 };
  const btn = (kind) => ({ padding: "7px 12px", borderRadius: 8, border: kind === "solid" ? "none" : "1px solid " + (kind === "danger" ? C.red : C.border), background: kind === "solid" ? C.gold : "transparent", color: kind === "solid" ? "#000" : kind === "danger" ? C.red : C.text, fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" });
  const lbl = { fontSize: 10, fontWeight: 800, color: C.mut, textTransform: "uppercase", letterSpacing: 0.5 };
  const pill = (c, solid) => ({ display: "inline-block", padding: "1px 7px", borderRadius: 999, fontSize: 10, fontWeight: 800, letterSpacing: 0.3, border: "1px solid " + c, background: solid ? c : "transparent", color: solid ? "#000" : c, whiteSpace: "nowrap" });
  const wl = (m) => (m.won === true ? <span style={pill(C.grn, true)}>W</span> : m.won === false ? <span style={pill(C.red, true)}>L</span> : <span style={pill(C.mut)}>Final</span>);

  if (!cands.length) {
    return (
      <div style={{ padding: "16px 16px 40px", maxWidth: 900, margin: "0 auto" }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 800, color: C.gold }}>Tournament Hub</h2>
        <div style={{ ...box, color: C.mut, fontSize: 13 }}>{tournaments.length ? "No tournaments with teams entered yet." : "Loading tournaments…"}</div>
      </div>
    );
  }

  // ── The selected tournament ─────────────────────────────────────────────
  const tz = sel ? tzOf(sel) : "America/Chicago";
  const nowLocal = localNow(tz, nowDate);
  const today = nowLocal.slice(0, 10);
  const selFeeds = sel ? feeds.filter((f) => f.tournament_id === sel.id).sort((a, b) => Number(b.published) - Number(a.published) || a.id - b.id) : [];
  const feedById = new Map(feeds.map((f) => [f.id, f]));
  const rowsHere = rowsFor === selId ? rows : [];
  const rowBy = new Map(rowsHere.map((r) => [r.team_name, r]));
  const going = sel ? [...(goingByTn.get(sel.id) || [])] : [];
  const ageOf = (n) => parseInt(n, 10) || 99;
  const teams = going.map((name) => {
    const row = rowBy.get(name) || null;
    const snap = row?.snapshot ? withNext(row.snapshot, nowLocal) : null;
    return { name, row, snap, feed: row?.feed_id != null ? feedById.get(row.feed_id) || null : null, level: levelOf.get(name) || null, mine: mine.has(name), event: eventTeams.has(name) };
  }).sort((a, b) => (isOps ? 0 : Number(b.mine) - Number(a.mine)) || ageOf(a.name) - ageOf(b.name) || (LEVEL_ORDER[a.level] ?? 3) - (LEVEL_ORDER[b.level] ?? 3) || a.name.localeCompare(b.name));
  // A coach's own teams open; anyone without a team here (and ops) sees the
  // one-line summaries unless there are only a few teams.
  const defaultOpen = (t) => (isOps || !teams.some((x) => x.mine) ? teams.length <= 3 : t.mine);
  const keyOf = (t) => `${selId}|${t.name}`;
  const isOpen = (t) => open[keyOf(t)] ?? defaultOpen(t);
  const setAll = (v) => setOpen((o) => ({ ...o, ...Object.fromEntries(teams.map((t) => [keyOf(t), v])) }));
  const unmapped = teams.filter((t) => !t.row || t.row.feed_id == null);
  // A team's data is as fresh as its feed's last clean check: the sync leaves
  // synced_at alone when AES hasn't changed for that team (as hub-data.js).
  // A check that hit an error doesn't count.
  const latestIso = (...xs) => xs.filter(Boolean).reduce((a, b) => (a == null || Date.parse(b) > Date.parse(a) ? b : a), null);
  const seenAt = (r) => {
    if (!r?.synced_at) return null;
    const f = r.feed_id != null ? feedById.get(r.feed_id) : null;
    return latestIso(r.synced_at, f && !f.last_error ? f.last_checked_at : null);
  };
  const lastSync = latestIso(...rowsHere.map(seenAt));
  // A team is through (the NEXT line says "Done") with a finish place, or once
  // the snapshot says done — but OTTO's "done" is a guess (finished matches,
  // nothing upcoming, no pool going on) that is also true between rounds, pool
  // play over and crossovers not seeded yet, so without a finish it only
  // counts once the venue's today is past the last day. The parent hub's rule
  // (isFinal in api/hub.js), so HQ and parents agree.
  const isFinal = (s) => !!s && (!!s.finish?.text || (!!s.done && (s.platform !== "otto" || today > (sel.end_date || sel.start_date))));
  // Where the tournament is, to catch a feed found on an event somewhere else
  // (the 14 Emerald → "2027 March Madness", Foley, AL case on the CTPL #4
  // weekend): the sync's own state rule, location before venue.
  const tnState = sel ? stateIn(sel.location, true) || stateIn(sel.venue) : null;
  const feedOff = (f) => { const st = stateIn(f.location, true); return !!(tnState && st && st !== tnState); };

  // "This weekend": anything being played, or starting within the week.
  const weekend = cands.filter((t) => { const s = stateOf(t); return s === "live" || (t.start_date <= addDaysISO(centralToday, 6) && (t.end_date || t.start_date) >= addDaysISO(centralToday, -1)); })
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.name.localeCompare(b.name));
  const chipState = (t) => {
    const s = stateOf(t);
    if (s === "live") return { c: C.gold, t: "Live" };
    if (s === "past") return { c: C.mut, t: "Final" };
    return feeds.some((f) => f.tournament_id === t.id && f.published) ? { c: C.grn, t: "Posted" } : { c: C.mut, t: "Not posted" };
  };
  const groups = [["live", "Being played now"], ["upcoming", "Coming up"], ["past", "Past"]].map(([k, l]) => [l, cands.filter((t) => stateOf(t) === k).sort((a, b) => (k === "past" ? b.start_date.localeCompare(a.start_date) : a.start_date.localeCompare(b.start_date)))]).filter(([, l]) => l.length);

  // ── One team ────────────────────────────────────────────────────────────
  const whenText = (local) => (String(local || "").slice(0, 10) === today ? fmtTime(local) : `${fmtDay(local)} ${fmtTime(local)}`);
  const nextLine = (t) => {
    const s = t.snap;
    if (!t.row || t.row.feed_id == null) return <span style={{ color: C.mut }}>{isOps ? "Not found on AES/OTTO yet" : "Schedule not posted yet"}</span>;
    if (!s || !(s.matches || []).length) return <span style={{ color: C.mut }}>Schedule not posted yet</span>;
    // In time order, so "work 12:00" reads before "next 1:00 PM" — the order
    // the team lives it.
    const { live, play, work } = s.next || {};
    const bits = [];
    if (live) bits.push({ at: live.start, node: <span key="l"><span style={pill(C.gold, true)}>LIVE</span> {courtText(live.court)}{live.opponent ? " vs " + live.opponent : ""}</span> });
    if (play && (!live || play.id !== live.id)) bits.push({ at: play.start, node: <span key="p"><b style={{ color: C.gold }}>Next </b><b>{whenText(play.start)}</b> · {courtText(play.court) || "court TBD"} · vs {play.opponent || "TBD"}</span> });
    // A duty whose time has come while our match is still live (courts run
    // late, and live lasts until the score posts) comes after that match:
    // "Work next", not "Working now" — the parent hub's WORK NEXT.
    const workText = (w) => (!(w.start && w.start <= nowLocal) ? "Work " + whenText(w.start) : live ? `Work next (set for ${whenText(w.start)})` : "Working now");
    if (work) bits.push({ at: work.start, node: <span key="w" style={{ color: C.cyan }}>{workText(work)}{work.court ? " · " + courtText(work.court) : ""}</span> });
    bits.sort((a, b) => String(a.at || "9999").localeCompare(String(b.at || "9999")));
    if (!bits.length) {
      const rec = s.record && s.record.mw + s.record.ml > 0 ? ` · ${s.record.mw}-${s.record.ml}` : "";
      if (isFinal(s)) return <span style={{ color: C.mut }}>Done{s.finish?.text ? " · finished " + finishText(s.finish) : ""}{rec}</span>;
      if ((s.paths || []).length) return <span style={{ color: C.mut }}>Waiting on results for the next round</span>;
      if (s.done) return <span style={{ color: C.mut }}>No more matches posted yet{rec}</span>;
      return <span style={{ color: C.mut }}>No match scheduled right now</span>;
    }
    return <span style={{ display: "inline-flex", flexWrap: "wrap", gap: "2px 10px" }}>{bits.map((b) => b.node)}</span>;
  };
  const poolText = (p) => (!p ? null : `${p.name || "Pool"}${p.rank_text ? ` · ${p.rank_text}${p.teams ? " of " + p.teams : ""}` : p.teams ? ` · ${p.teams} teams` : ""}`);
  // The pool before this one (pool-to-pool rounds: Lone Star Classic's
  // "Round 2 Pool 1", OTTO's R1D1P6 → R2D1P6). Its place is the snapshot's
  // last_pool once known; the sync fetches it when a poll missed it.
  const rankOf = (p) => (p && p.rank != null ? p.rank_text || ordinal(p.rank) : null);
  const lastPoolText = (p) => (!p?.name ? null : rankOf(p) ? `Finished ${rankOf(p)}${p.teams ? " of " + p.teams : ""} in ${p.name}` : `Played ${p.name} · place not posted`);
  const matchRow = (m, s) => {
    const isLiveM = s.next?.live?.id === m.id, isNext = !isLiveM && s.next?.play?.id === m.id;
    return (
      <div key={"m" + m.id} style={{ display: "flex", gap: 10, padding: "8px 10px", borderTop: "1px solid " + C.border, borderLeft: "3px solid " + (isLiveM || isNext ? C.gold : "transparent"), background: isLiveM ? "rgba(233,30,140,0.08)" : "transparent", alignItems: "flex-start" }}>
        <div style={{ width: 62, flexShrink: 0, fontWeight: 800, fontSize: 13 }}>{fmtTime(m.start) || "TBD"}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, overflowWrap: "anywhere" }}>vs {m.opponent || "TBD"}</div>
          <div style={{ fontSize: 11, color: C.mut, overflowWrap: "anywhere" }}>{[m.round, m.label, courtText(m.court)].filter(Boolean).join(" · ")}{m.work_team ? ` · ${m.work_team} works` : ""}</div>
        </div>
        <div style={{ flexShrink: 0, textAlign: "right", maxWidth: "45%" }}>
          {m.final ? <>{wl(m)}<div style={{ fontSize: 12, fontWeight: 700, marginTop: 3, whiteSpace: "nowrap" }}>{setsText(m.sets)}</div></>
            : isLiveM ? <span style={pill(C.gold, true)}>LIVE</span>
            : isNext ? <span style={pill(C.gold)}>NEXT</span> : null}
        </div>
      </div>
    );
  };
  const workRow = (w, s) => {
    const isNext = s.next?.work?.id === w.id;
    return (
      <div key={"w" + w.id} style={{ display: "flex", gap: 10, padding: "8px 10px", borderTop: "1px solid " + C.border, borderLeft: "3px solid " + (isNext ? C.cyan : "transparent"), alignItems: "flex-start" }}>
        <div style={{ width: 62, flexShrink: 0, fontWeight: 800, fontSize: 13, color: C.cyan }}>{fmtTime(w.start) || "TBD"}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: C.cyan, overflowWrap: "anywhere" }}>Work{w.teams ? ": " + w.teams : " duty"}</div>
          <div style={{ fontSize: 11, color: C.mut }}>{[w.round, w.label, courtText(w.court)].filter(Boolean).join(" · ")}</div>
        </div>
        {isNext && <div style={{ flexShrink: 0 }}><span style={pill(C.cyan)}>NEXT WORK</span></div>}
      </div>
    );
  };
  const schedule = (s) => {
    const items = [...(s.matches || []).map((m) => ({ k: "m", x: m })), ...(s.work || []).map((w) => ({ k: "w", x: w }))]
      .sort((a, b) => String(a.x.start || "9999").localeCompare(String(b.x.start || "9999")) || (a.k === "m" ? -1 : 1));
    const byDay = new Map();
    for (const it of items) { const d = String(it.x.start || "").slice(0, 10) || "TBD"; if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(it); }
    return [...byDay.entries()].map(([d, list]) => (
      <div key={d} style={{ marginTop: 10, border: "1px solid " + C.border, borderRadius: 10, overflow: "hidden", background: C.bg }}>
        <div style={{ ...lbl, padding: "7px 10px", color: d === today ? C.gold : C.mut }}>{d === "TBD" ? "Time to be set" : (d === today ? "Today · " : "") + fmtDay(d)}</div>
        {list.map((it) => (it.k === "m" ? matchRow(it.x, s) : workRow(it.x, s)))}
      </div>
    ));
  };
  const teamCard = (t) => {
    const s = t.snap, op = isOpen(t);
    const rec = s?.record && (s.record.mw + s.record.ml > 0) ? `${s.record.mw}-${s.record.ml}` : null;
    const platform = t.feed ? PLATFORM[t.feed.platform] || t.feed.platform : s ? PLATFORM[s.platform] : null;
    const link = s?.team_url || s?.event_url || feedUrl(t.feed);
    return (
      <div key={t.name} style={{ ...box, padding: 0, overflow: "hidden", borderColor: s?.next?.live ? C.gold : C.border }}>
        <div role="button" tabIndex={0} onClick={() => setOpen((o) => ({ ...o, [keyOf(t)]: !op }))} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => ({ ...o, [keyOf(t)]: !op })); } }}
          style={{ padding: "12px 14px", cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 16, fontWeight: 900 }}>{t.name}</span>
            {t.level && <span style={pill(t.level === "National" ? C.gold : C.mut)}>{LEVEL_TAG[t.level] || t.level}</span>}
            {t.mine && !isOps && <span style={pill(C.grn)}>My team</span>}
            {t.event && <span style={pill(C.amber)}>Event team · HQ only</span>}
            {s?.finish?.text && <span style={pill(C.grn, true)}>{finishText(s.finish)}</span>}
            <span style={{ flex: 1 }} />
            {rec && <span style={{ fontSize: 13, fontWeight: 800 }}>{rec}</span>}
            {s?.pool && <span style={{ fontSize: 12, color: C.mut }}>{s.last_pool?.name && rankOf(s.last_pool) ? `${rankOf(s.last_pool)} in ${s.last_pool.name} → ` : ""}{poolText(s.pool)}</span>}
            <span style={{ color: C.mut, fontSize: 12 }}>{op ? "▾" : "▸"}</span>
          </div>
          <div style={{ fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>{nextLine(t)}</div>
        </div>
        {op && (
          <div style={{ padding: "0 14px 14px", borderTop: "1px solid " + C.border }}>
            {s ? <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: 12, color: C.mut, marginTop: 10 }}>
                {s.team_text && <span>On {platform || "the platform"} as <b style={{ color: C.text }}>{cleanTeamText(s.team_text)}</b></span>}
                {(s.division || t.row?.division_name) && <span>Division <b style={{ color: C.text }}>{s.division || t.row.division_name}</b></span>}
                {s.record && (s.record.mw + s.record.ml > 0) && <span>Matches <b style={{ color: C.text }}>{s.record.mw}-{s.record.ml}</b> · sets <b style={{ color: C.text }}>{s.record.sw}-{s.record.sl}</b>{s.record.pr != null ? <> · point ratio <b style={{ color: C.text }}>{s.record.pr.toFixed(3)}</b></> : null}</span>}
                {s.last_pool?.name && <span>{lastPoolText(s.last_pool)}</span>}
                {s.pool && <span><b style={{ color: C.text }}>{poolText(s.pool)}</b></span>}
                {s.finish?.text && <span>Finished <b style={{ color: C.grn }}>{finishText(s.finish)}</b>{s.finish.flight_text ? ` · ${s.finish.flight_text} in its flight` : ""}</span>}
              </div>
              {(s.matches || []).length || (s.work || []).length ? schedule(s) : <div style={{ fontSize: 13, color: C.mut, marginTop: 10 }}>The schedule isn't posted yet{t.feed?.event_name ? ` on ${t.feed.event_name}` : ""}.</div>}
              {(s.paths || []).length > 0 && (
                <div style={{ marginTop: 10, border: "1px dashed " + C.border, borderRadius: 10, padding: "8px 10px" }}>
                  <div style={{ ...lbl, marginBottom: 4 }}>What's next depends on the finish</div>
                  {s.paths.map((p, i) => (
                    <div key={i} style={{ fontSize: 13, padding: "3px 0", overflowWrap: "anywhere" }}>
                      <b>If {p.if}</b> → {[p.round, p.start ? whenText(p.start) : null, courtText(p.court)].filter(Boolean).join(" · ")}
                      {p.work_start ? <span style={{ color: C.cyan }}> · work {whenText(p.work_start)}{p.work_court ? " " + courtText(p.work_court) : ""}</span> : null}
                    </div>
                  ))}
                </div>
              )}
            </> : (
              <div style={{ fontSize: 13, color: C.mut, marginTop: 10 }}>
                {t.row?.feed_id != null ? `Linked to ${t.feed?.event_name || "an event"} — the schedule isn't posted yet.`
                  : isOps ? (selFeeds.length ? "This team isn't on the linked event. If its division is on a different AES/OTTO event, paste that link under Schedule source." : "No AES/OTTO event is linked to this tournament yet.") : "The schedule isn't posted yet — it usually goes up a few days before the tournament."}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
              {link && <a href={link} target="_blank" rel="noreferrer" style={{ ...btn(), textDecoration: "none" }}>Open on {platform || "AES"} ↗</a>}
              {!t.event && <button onClick={() => copyLink(t.name)} style={btn()}>{copied === t.name ? "Copied ✓" : "Copy parent link"}</button>}
              <span style={{ fontSize: 11, color: C.mut }}>{seenAt(t.row) ? "Updated " + ago(seenAt(t.row), nowMs) : ""}</span>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Ops: where each tournament's games are, and the fixes ───────────────
  const feedPanel = isOps && sel && (
    <div style={{ ...box, borderColor: !feedsLoaded || (selFeeds.some((f) => f.published) && !selFeeds.some(feedOff)) ? C.border : C.amber }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <span style={lbl}>Schedule source</span>
        <span style={{ flex: 1 }} />
        <button disabled={!!busy} onClick={doSync} style={btn()} title="Fetch this tournament's schedules and results now (the sync also runs every 5 minutes on its own)">{busy === "sync" ? "Syncing…" : "↻ Sync now"}</button>
      </div>
      {feedsLoaded && selFeeds.length === 0 && (
        <div style={{ fontSize: 13, color: C.amber, fontWeight: 700 }}>
          Not found yet — paste the AES or OTTO link.
          <span style={{ color: C.mut, fontWeight: 400 }}> {selState === "upcoming" && sel.start_date > addDaysISO(centralToday, 10) ? "HQ starts looking 10 days before the event." : "HQ keeps looking every few hours, but can't find an event that isn't posted."}</span>
        </div>
      )}
      {selFeeds.map((f) => {
        const n = rowsHere.filter((r) => r.feed_id === f.id).length;
        return (
          <div key={f.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap", padding: "6px 0", borderTop: "1px solid " + C.border }}>
            <div style={{ flex: "1 1 260px", minWidth: 0, fontSize: 13 }}>
              <div style={{ overflowWrap: "anywhere" }}>Linked to <b>{PLATFORM[f.platform] || f.platform}</b>: {f.event_name || f.event_ref}</div>
              <div style={{ fontSize: 11, color: C.mut, marginTop: 2 }}>
                <span style={{ color: f.published ? C.grn : C.amber, fontWeight: 800 }}>{f.published ? "posted" : "not posted yet"}</span>
                {f.last_checked_at ? " · checked " + ago(f.last_checked_at, nowMs) : " · not checked yet"}
                {" · "}{n} team{n === 1 ? "" : "s"}
                {" · "}{f.linked_by === "manual" ? "linked by hand" : "found automatically"}
                {f.start_date ? " · " + dateSpan(f.start_date, f.end_date) : ""}
                {f.location && !feedOff(f) ? " · " + f.location : ""}
              </div>
              {feedOff(f) && <div style={{ fontSize: 12, color: C.amber, fontWeight: 700, marginTop: 2, overflowWrap: "anywhere" }}>{f.location} — not where this tournament is ({stateIn(sel.location, true) === tnState ? sel.location : tnState}). Check the link.</div>}
              {f.last_error && <div style={{ fontSize: 11, color: C.red, marginTop: 2, overflowWrap: "anywhere" }}>Last error: {f.last_error}</div>}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {feedUrl(f) && <a href={feedUrl(f)} target="_blank" rel="noreferrer" style={{ ...btn(), textDecoration: "none", padding: "4px 9px", fontSize: 11 }}>Open ↗</a>}
              <button disabled={!!busy} onClick={() => doUnlink(f)} style={{ ...btn("danger"), padding: "4px 9px", fontSize: 11 }}>{busy === "unlink:" + f.id ? "Unlinking…" : "Unlink"}</button>
            </div>
          </div>
        );
      })}
      {rowsFor === selId && unmapped.length > 0 && selFeeds.length > 0 && (
        <div style={{ fontSize: 12, color: C.amber, marginTop: 6 }}>Not on a linked event: {unmapped.map((t) => t.name).join(", ")}</div>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doLink(); }}
          placeholder="Paste the AES or OTTO link for this tournament"
          style={{ flex: "1 1 240px", minWidth: 0, background: "#0f0f0f", border: "1px solid " + C.border, borderRadius: 8, color: C.text, fontFamily: "inherit", fontSize: 13, padding: "8px 10px" }} />
        <button disabled={!!busy || !linkUrl.trim()} onClick={doLink} style={{ ...btn("solid"), opacity: linkUrl.trim() ? 1 : 0.5 }}>{busy === "link" ? "Linking…" : "Link"}</button>
      </div>
      {going.length > 1 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
          <span style={{ fontSize: 11, color: C.mut }}>Teams on it:</span>
          <button onClick={() => setLinkTeams([])} style={{ ...pill(linkTeams.length ? C.mut : C.gold, !linkTeams.length), cursor: "pointer", fontFamily: "inherit" }}>All found</button>
          {[...going].sort((a, b) => ageOf(a) - ageOf(b) || a.localeCompare(b)).map((n) => {
            const on = linkTeams.includes(n);
            return <button key={n} onClick={() => setLinkTeams((l) => (on ? l.filter((x) => x !== n) : [...l, n]))} style={{ ...pill(on ? C.gold : C.mut, on), cursor: "pointer", fontFamily: "inherit" }}>{n}</button>;
          })}
        </div>
      )}
      <div style={{ fontSize: 11, color: C.mut, marginTop: 6 }}>AES: the results page link (results.advancedeventsystems.com/event/…) or the event page. OTTO: the event or team page link.</div>
    </div>
  );

  return (
    <div style={{ padding: "16px 16px 40px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.gold }}>Tournament Hub</h2>
          <div style={{ fontSize: 12, color: C.mut }}>Schedules, scores and who works when — live from AES and OTTO.</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a href="/hub" target="_blank" rel="noreferrer" style={{ ...btn(), textDecoration: "none" }} title="The no-login page parents use">Parent hub ↗</a>
          <button onClick={reload} disabled={loading} style={{ ...btn(), opacity: loading ? 0.5 : 1 }} title="Re-read the latest synced schedules">⟳ Refresh</button>
        </div>
      </div>

      {weekend.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <span style={lbl}>This weekend</span>
          {weekend.map((t) => {
            const cs = chipState(t), on = t.id === selId;
            return (
              <button key={t.id} onClick={() => { setSelId(t.id); setMsg(null); }}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 999, border: "1px solid " + (on ? C.gold : C.border), background: on ? "rgba(233,30,140,0.14)" : "transparent", color: C.text, fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer", maxWidth: "100%" }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: cs.c, flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
                <span style={{ color: cs.c, fontSize: 10, fontWeight: 800, flexShrink: 0 }}>{cs.t}</span>
              </button>
            );
          })}
        </div>
      )}

      <select value={selId ?? ""} onChange={(e) => { setSelId(Number(e.target.value)); setMsg(null); }}
        style={{ width: "100%", background: "#0f0f0f", border: "1px solid " + C.border, borderRadius: 8, color: C.text, fontFamily: "inherit", fontSize: 14, fontWeight: 800, padding: "9px 10px", marginBottom: 10 }}>
        {selId == null && <option value="">Pick a tournament…</option>}
        {sel && !cands.includes(sel) && <option value={sel.id}>{sel.name}</option>}
        {groups.map(([label, list]) => (
          <optgroup key={label} label={label}>
            {list.map((t) => <option key={t.id} value={t.id}>{t.name} · {dateSpan(t.start_date, t.end_date)}{isOps && feedsLoaded && !feedTn.has(t.id) ? " · not linked" : ""}</option>)}
          </optgroup>
        ))}
      </select>

      {sel && (
        <div style={{ fontSize: 12, color: C.mut, marginBottom: 10, display: "flex", gap: "2px 12px", flexWrap: "wrap" }}>
          <b style={{ color: isLive ? C.gold : C.text }}>{isLive ? "Being played now" : selState === "past" ? "Final" : "Coming up"}</b>
          <span>{dateSpan(sel.start_date, sel.end_date)}</span>
          {(sel.venue || sel.location) && <span>{[sel.venue, sel.location].filter(Boolean).join(", ")}</span>}
          {tz !== "America/Chicago" && <span style={{ color: C.amber }}>Times are venue time ({zoneAbbr(tz, nowDate)})</span>}
          {lastSync && <span>Synced {ago(lastSync, nowMs)}{isLive ? " · refreshes every minute" : ""}</span>}
        </div>
      )}

      {err && <div style={{ color: C.red, fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{err}</div>}
      {msg && <div style={{ color: msg.ok ? C.grn : C.red, fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{msg.text}</div>}
      {feedPanel}

      {sel && teams.length > 1 && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8, fontSize: 12, color: C.mut }}>
          <span>{teams.length} teams{!isOps && teams.some((t) => t.mine) ? " · yours first" : ""}</span>
          <span style={{ flex: 1 }} />
          <button onClick={() => setAll(true)} style={{ background: "none", border: "none", color: C.mut, textDecoration: "underline", cursor: "pointer", fontSize: 12, fontFamily: "inherit", padding: 0 }}>Expand all</button>
          <button onClick={() => setAll(false)} style={{ background: "none", border: "none", color: C.mut, textDecoration: "underline", cursor: "pointer", fontSize: 12, fontFamily: "inherit", padding: 0 }}>Collapse all</button>
        </div>
      )}
      {sel && rowsFor !== selId && !err && <div style={{ color: C.mut, fontSize: 13, padding: 8 }}>Loading…</div>}
      {sel && rowsFor === selId && teams.map(teamCard)}
      {sel && rowsFor === selId && !teams.length && <div style={{ ...box, color: C.mut, fontSize: 13 }}>No DS Elite teams are entered in this tournament.</div>}
    </div>
  );
}
