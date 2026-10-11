// Registration check (HQ) — what AES and OTTO say about each DS Elite team's
// tournament entries, next to what HQ says. Drew, 11 Oct 2026: "Fix HQ now —
// do a daily check as well."
//
// Read-only over three tables the daily job writes (api/registration-check.js,
// api/_lib/registration-check.js; schema in
// migrations/20261011_registration_check.sql):
//   tournament_registrations  one row per (platform event, DS Elite team)
//   registration_flags        things a person should look at (stable key per fact)
//   registration_check_runs   one row per run with its summary
// The only write from here is dismissing a flag (dismissed_at/dismissed_by;
// RLS lets approved coaches do it). "Run check now" POSTs to the job with the
// session bearer; the job itself makes the auto-updates and writes the rows.
//
// Two exports for src/App.jsx:
//   default RegistrationCheck — the panel at the top of the Tournaments view (ops)
//   RegBadges                 — the AES/OTTO badge on a "Teams going" chip
//   loadRegistrationCheck(sb) — loads everything both of them read

import { useState, useEffect } from "react";

const DEF_C = { bg: "#0a0a0a", card: "#141414", border: "#2a2a2a", gold: "#e91e8c", text: "#ffffff", mut: "#999999", red: "#ef4444", grn: "#22c55e" };
const AMBER = "#f59e0b", ORANGE = "#f97316", CYAN = "#22d3ee";
const PLAT = { aes: "AES", otto: "OTTO" };
const DROPPED = /^(dropped|withdrawn|withdrew|declined|deleted|removed|rejected|cancel+ed)$/i;
const AUTO_DAYS = 14;
const STALE_H = 36;          // the job runs daily; older than this means a missed run
const NEW_H = 26;            // "NEW" marker on flags raised by the latest daily run

// Open flags, grouped in this order. Anything the job adds later still shows
// under its own kind name.
const KINDS = [
  { kind: "dropped_on_platform", label: "Dropped on the platform", color: DEF_C.red,
    hint: "The platform shows the team dropped or withdrawn, but HQ still has them going." },
  { kind: "not_on_platform", label: "Going in HQ, not on the platform", color: ORANGE,
    hint: "HQ says registered, accepted, locked or rostered, but the event's team list doesn't include them." },
  { kind: "not_in_hq", label: "On the platform, missing from HQ", color: "#a855f7",
    hint: "The platform lists the team at this tournament, but HQ has no assignment (or has them dropped)." },
  { kind: "not_found", label: "Event not found on AES or OTTO", color: AMBER,
    hint: "Starts within 75 days and no AES or OTTO event matches it. Check where we registered." },
  { kind: "unknown_event", label: "Entered at an event HQ doesn't have", color: "#3b82f6",
    hint: "The platform lists the team at an event with no matching HQ tournament." },
];
const KIND_META = Object.fromEntries(KINDS.map(k => [k.kind, k]));

// ---------- loading ----------

export async function loadRegistrationCheck(sb) {
  const since = new Date(Date.now() - AUTO_DAYS * 864e5).toISOString();
  const [regs, open, autos, runs] = await Promise.all([
    // Badges only need rows matched to an HQ tournament that the platform still lists.
    sb.from("tournament_registrations")
      .select("id,platform,event_ref,event_name,event_start,event_end,team_name,division,status,tournament_id,match_how,status_changed_at,last_seen_at,gone_at")
      .not("tournament_id", "is", null).is("gone_at", null).limit(5000),
    // Unresolved flags: the open ones and the dismissed ones (for Undo).
    sb.from("registration_flags").select("*").is("resolved_at", null)
      .order("first_flagged_at", { ascending: false }).limit(1000),
    sb.from("registration_flags").select("*").eq("kind", "auto_updated").gte("first_flagged_at", since)
      .order("first_flagged_at", { ascending: false }).limit(300),
    sb.from("registration_check_runs").select("*").order("run_at", { ascending: false }).limit(10),
  ]);
  const err = [regs, open, autos, runs].find(r => r.error)?.error || null;
  if (err) console.error("Load registration check error:", err);
  return {
    regs: regs.data || [],
    flags: open.data || [],
    autos: autos.data || [],
    runs: runs.data || [],
    error: err ? err.message || String(err) : null,
  };
}

// ---------- small helpers ----------

const norm = (s) => String(s ?? "").trim().toLowerCase();
const keyOf = (tid, team) => String(tid) + "|" + norm(team);
const day = (d) => {
  if (!d) return "";
  const x = new Date(String(d).length <= 10 ? d + "T12:00:00" : d);
  return isNaN(x) ? "" : x.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const stamp = (iso) => {
  const x = new Date(iso);
  return isNaN(x) ? "" : x.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};
const ago = (iso) => {
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms)) return "";
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  const h = Math.round(m / 60);
  if (h < 48) return h + "h ago";
  return Math.round(h / 24) + "d ago";
};
const eventUrl = (platform, ref) => {
  if (!ref) return null;
  if (platform === "aes") return /^\d+$/.test(String(ref)) ? `https://www.advancedeventsystems.com/${ref}` : null;
  if (platform === "otto") return `https://events.ottoevent.ai/event/${encodeURIComponent(ref)}`;
  return null;
};
// Where a flag points on the platform: its detail first, then its key
// (`${kind}|${platform}|${event_ref or tournament_id}|${team}`). The key holds
// an event ref only for the event-based kinds — not_on_platform and not_found
// key on the HQ tournament id.
const KEY_HAS_EVENT = new Set(["dropped_on_platform", "not_in_hq", "unknown_event", "auto_updated"]);
const flagEvent = (f) => {
  const d = f.detail && typeof f.detail === "object" ? f.detail : {};
  let platform = d.platform || null, ref = d.event_ref ?? null;
  if ((!platform || !ref) && KEY_HAS_EVENT.has(f.kind)) {
    const parts = String(f.key || "").split("|");
    if (PLAT[parts[1]] && parts[2]) { platform = platform || parts[1]; ref = ref ?? parts[2]; }
  }
  return { platform, ref, name: d.event_name || null, start: d.event_start || null };
};
const isOpen = (f) => !f.resolved_at && !f.dismissed_at && f.kind !== "auto_updated";

// How one registration row reads on a chip.
function badgeOf(r) {
  const p = PLAT[r.platform] || String(r.platform || "").toUpperCase();
  const s = String(r.status || "").trim();
  const ls = s.toLowerCase();
  if (DROPPED.test(s)) return { rank: 0, label: "⚠ " + ls, color: DEF_C.red, dropped: true };
  if (ls === "accepted") return { rank: 3, label: p + " ✓", color: DEF_C.grn };
  if (r.platform === "otto" && ls === "entered") return { rank: 2, label: p + " ✓ entered", color: DEF_C.grn };
  return { rank: 1, label: p + " · " + (ls || "listed"), color: AMBER };
}
const rowTitle = (r) => {
  const p = PLAT[r.platform] || r.platform;
  return [
    `${p}: ${r.status || "listed"}${r.division ? " (" + r.division + ")" : ""}`,
    `${r.event_name || "Event " + r.event_ref}${r.event_start ? " · " + day(r.event_start) : ""}`,
    r.last_seen_at ? `Last seen ${stamp(r.last_seen_at)}` : null,
    r.status_changed_at ? `Status since ${stamp(r.status_changed_at)}` : null,
  ].filter(Boolean).join("\n");
};

// One index per loaded data object (cached), so every chip on the page reads
// the same maps instead of filtering the tables again.
const cache = new WeakMap();
function indexFor(data) {
  let ix = cache.get(data);
  if (ix) return ix;
  const regs = new Map(), flags = new Map();
  const push = (m, k, v) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };
  for (const r of data.regs || []) {
    if (r.gone_at || r.tournament_id == null || !r.team_name) continue;
    push(regs, keyOf(r.tournament_id, r.team_name), r);
  }
  for (const f of data.flags || []) {
    if (!isOpen(f) || f.tournament_id == null || !f.team_name) continue;
    push(flags, keyOf(f.tournament_id, f.team_name), f);
  }
  ix = { regs, flags };
  cache.set(data, ix);
  return ix;
}

const pill = (color, extra) => ({
  display: "inline-flex", alignItems: "center", padding: "1px 5px", borderRadius: 5, fontSize: 9, fontWeight: 800,
  letterSpacing: 0.2, whiteSpace: "nowrap", border: "1px solid " + color, background: color + "1a", color, cursor: "help", ...extra,
});

// ---------- chip badge ----------

// On a TournamentCard "Teams going" chip: one badge per platform that lists
// the team for this tournament, and a red ⚠ when a flag is open for it. The
// title carries the detail; tapping shows it too (no hover on a phone).
export function RegBadges({ data, tournamentId, team }) {
  if (!data || tournamentId == null || !team) return null;
  const ix = indexFor(data);
  const k = keyOf(tournamentId, team);
  const rows = ix.regs.get(k) || [];
  const flags = ix.flags.get(k) || [];
  if (!rows.length && !flags.length) return null;

  const byPlat = new Map();
  for (const r of rows) { const a = byPlat.get(r.platform); if (a) a.push(r); else byPlat.set(r.platform, [r]); }
  const badges = [...byPlat.entries()].map(([platform, list]) => {
    // Best status wins the label (two events under one HQ row is rare); the title lists them all.
    const best = list.map(r => ({ r, b: badgeOf(r) })).sort((x, y) => y.b.rank - x.b.rank)[0];
    return { platform, ...best.b, title: list.map(rowTitle).join("\n\n") };
  }).sort((a, b) => (a.platform === "aes" ? 0 : 1) - (b.platform === "aes" ? 0 : 1));
  // Both platforms list the team: "OTTO ✓" is enough next to "AES ✓" (the title says entered).
  if (badges.length > 1) for (const b of badges) b.label = b.label.replace(/ ✓ entered$/, " ✓");

  // A dropped badge already says ⚠ — fold a dropped_on_platform flag into its title.
  const droppedBadge = badges.find(b => b.dropped);
  const flagText = (f) => "⚠ " + (f.message || f.kind);
  let loose = flags;
  if (droppedBadge) {
    const folded = flags.filter(f => f.kind === "dropped_on_platform");
    if (folded.length) droppedBadge.title += "\n\n" + folded.map(flagText).join("\n");
    loose = flags.filter(f => f.kind !== "dropped_on_platform");
  }
  const show = (t) => (e) => { e.stopPropagation(); window.alert(t); };
  const flagTitle = loose.map(flagText).join("\n");
  // The chip doesn't wrap; this group does. Zero basis + grow: on a phone it
  // takes whatever width is left (wrapping inside) instead of squeezing the
  // team name onto two lines; with room to spare it sits on one line.
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 3, flex: "1 1 0px", minWidth: "min-content" }}>
      {badges.map(b => (
        <span key={b.platform} title={b.title} onClick={show(b.title)} style={pill(b.color)}>{b.label}</span>
      ))}
      {loose.length > 0 && (
        <span title={flagTitle} onClick={show(flagTitle)} style={{ color: DEF_C.red, fontWeight: 900, fontSize: 12, lineHeight: 1, cursor: "help" }}>⚠</span>
      )}
    </span>
  );
}

// ---------- run summary ----------

const at = (o, path) => path.split(".").reduce((v, k) => (v == null ? undefined : v[k]), o);
const num = (o, path) => { const v = at(o, path); return Array.isArray(v) ? v.length : typeof v === "number" ? v : null; };
const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");

// A one-line read of a run summary (registration_check_runs.summary, also the
// `summary` of the POST answer — see runRegistrationCheck):
//   { aes: { events, checked, partial }, otto: { probed, checked, with_dse, partial, partial_reasons },
//     rows: { seen, … }, auto_updates: { found, applied }, flags: { new, open, resolved, … }, emailed, calls, ms }
function summaryBits(s) {
  if (!s || typeof s !== "object") return [];
  const bits = [];
  const aesEv = num(s, "aes.events"), aesOk = num(s, "aes.checked");
  if (aesEv != null) bits.push(plural(aesEv, "AES event") + (aesOk != null && aesOk < aesEv ? ` (${aesOk} read)` : ""));
  const ottoEv = num(s, "otto.probed"), ottoOk = num(s, "otto.checked");
  if (ottoEv != null) bits.push(plural(ottoEv, "OTTO event") + (ottoOk != null && ottoOk < ottoEv ? ` (${ottoOk} read)` : ""));
  const rows = num(s, "rows.seen");
  if (rows != null) bits.push(rows + " team entries");
  const upd = num(s, "auto_updates.applied") ?? num(s, "auto_updates.found");
  if (upd != null) bits.push(plural(upd, "auto-update"));
  const fNew = num(s, "flags.new"), fOpen = num(s, "flags.open"), fRes = num(s, "flags.resolved");
  if (fNew != null) bits.push(plural(fNew, "new flag"));
  if (fOpen != null) bits.push(fOpen + " open");
  if (fRes) bits.push(fRes + " resolved");
  if (s.emailed === true) bits.push("emailed");
  const ms = num(s, "ms");
  if (ms != null) bits.push(Math.round(ms / 1000) + " s");
  return bits;
}
// Which platform passes were partial (AES ranking errors, OTTO GraphQL down,
// probe cap…). A partial pass marks nothing gone and raises no "missing" flags.
function partialOf(s) {
  if (!s || typeof s !== "object") return [];
  const out = [];
  if (at(s, "aes.partial")) out.push("AES");
  if (at(s, "otto.partial")) {
    const why = at(s, "otto.partial_reasons");
    out.push("OTTO" + (Array.isArray(why) && why.length ? " (" + why.slice(0, 3).join("; ") + ")" : ""));
  }
  return out;
}
// Local wall-clock time of the daily 13:30 UTC cron.
const cronTime = () => { const d = new Date(); d.setUTCHours(13, 30, 0, 0); return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); };

// ---------- panel ----------

export default function RegistrationCheck({ supabase, data, tournaments = [], coach, onReload, onOpenTeam, C = DEF_C }) {
  const [expanded, setExpanded] = useState(null);           // null = open when something needs a look
  const [busy, setBusy] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [, setTick] = useState(0);
  const [result, setResult] = useState(null);               // last "Run check now" outcome
  const [hidden, setHidden] = useState(() => new Set());    // dismissed here, before the reload lands
  const [savingId, setSavingId] = useState(null);
  const [showDismissed, setShowDismissed] = useState(false);
  // Fresh rows carry dismissed_at themselves — stop hiding locally once they land.
  useEffect(() => { setHidden(s => (s.size ? new Set() : s)); }, [data]);
  useEffect(() => {
    if (!busy) return undefined;
    const t = setInterval(() => setTick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const loaded = !!data;
  const runs = data?.runs || [];
  const last = runs[0] || null;
  const tnById = new Map(tournaments.map(t => [String(t.id), t]));
  const open = (data?.flags || []).filter(f => isOpen(f) && !hidden.has(f.id));
  const dismissed = (data?.flags || []).filter(f => !f.resolved_at && f.dismissed_at && f.kind !== "auto_updated");
  const autoById = new Map();
  for (const f of [...(data?.autos || []), ...(data?.flags || []).filter(f => f.kind === "auto_updated")]) autoById.set(f.id, f);
  const autos = [...autoById.values()].sort((a, b) => String(b.first_flagged_at).localeCompare(String(a.first_flagged_at)));
  const groups = [...KINDS.map(k => k.kind), ...new Set(open.map(f => f.kind).filter(k => !KIND_META[k]))]
    .map(kind => ({ kind, meta: KIND_META[kind] || { label: kind.replace(/_/g, " "), color: AMBER, hint: "" }, list: open.filter(f => f.kind === kind) }))
    .filter(g => g.list.length);
  const stale = last && (Date.now() - new Date(last.run_at).getTime()) > STALE_H * 3600e3;
  // ok:false with a summary = finished, but some platform calls failed; without one = it stopped.
  const lastFailed = last && last.ok === false && !last.summary;
  const lastWarn = last && last.ok === false && !!last.summary;
  const isExpanded = expanded ?? (open.length > 0 || !!lastFailed);
  const me = coach?.display_name || coach?.email || "HQ";

  const run = async () => {
    if (busy) return;
    setBusy(true); setStartedAt(Date.now()); setResult(null);
    let ran = false;
    try {
      const { data: { session } = {} } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not signed in");
      const r = await fetch("/api/registration-check", {
        method: "POST",
        headers: { Authorization: "Bearer " + session.access_token, "Content-Type": "application/json" },
        body: "{}",
      });
      const text = await r.text();
      let j = null;
      try { j = JSON.parse(text); } catch { /* not JSON */ }
      ran = !!j && r.status !== 401 && r.status !== 403;   // it answered: it may have changed statuses
      // A finished run answers { ok, summary, errors[] } — ok:false with a
      // summary means it finished with some platform errors; no summary means
      // it stopped (error) or never ran.
      if (j && j.summary && typeof j.summary === "object") {
        const errs = Array.isArray(j.errors) ? j.errors : [];
        setResult({ ok: true, summary: j.summary, warn: errs.length ? plural(errs.length, "problem") + ": " + errs[0] : j.error || null });
      } else if (!r.ok || !j || j.ok === false) {
        throw new Error(j?.error || (r.status === 504 || r.status === 502
          ? "Timed out waiting for the check. It may still finish on its own; hit Refresh in a minute."
          : r.status === 404 ? "The check isn't deployed yet." : "HTTP " + r.status));
      } else {
        setResult({ ok: true, summary: null });
      }
    } catch (e) {
      setResult({ ok: false, text: String(e?.message || e) });
    } finally {
      setBusy(false);
      onReload && onReload(ran);
    }
  };

  // A running check rewrites every open flag when it finishes, so a Dismiss or
  // Undo saved mid-run would be undone by it. Hold both until it's done.
  const dismissLock = busy ? "Wait for the check to finish" : null;
  const setDismissed = async (f, on) => {
    if (busy) return;
    setSavingId(f.id);
    setHidden(s => { const n = new Set(s); if (on) n.add(f.id); else n.delete(f.id); return n; });
    const { error } = await supabase.from("registration_flags")
      .update(on ? { dismissed_at: new Date().toISOString(), dismissed_by: me } : { dismissed_at: null, dismissed_by: null })
      .eq("id", f.id);
    setSavingId(null);
    if (error) {
      setHidden(s => { const n = new Set(s); n.delete(f.id); return n; });
      window.alert("Couldn't save: " + error.message);
      return;
    }
    onReload && onReload(false);
  };

  // ---- pieces ----
  const btn = (color, filled) => ({
    padding: "5px 11px", borderRadius: 7, border: "1px solid " + color, background: filled ? color : "transparent",
    color: filled ? "#000" : color, fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
  });
  const small = { fontSize: 11, color: C.mut };
  const teamLink = (team) => !team ? null : (
    <span onClick={onOpenTeam ? (e) => { e.stopPropagation(); onOpenTeam(team); } : undefined}
      title={onOpenTeam ? "Open team card" : undefined}
      style={{ fontWeight: 800, color: C.text, cursor: onOpenTeam ? "pointer" : "default" }}>{team}</span>
  );
  const tnLabel = (f) => {
    const tn = f.tournament_id != null ? tnById.get(String(f.tournament_id)) : null;
    if (tn) return String(tn.name || "").trim() + (tn.start_date ? " (" + day(tn.start_date) + ")" : "");
    const d = f.detail && typeof f.detail === "object" ? f.detail : {};
    if (d.tournament) return String(d.tournament).trim() + (d.start ? " (" + day(d.start) + ")" : "");
    const ev = flagEvent(f);
    return ev.name ? ev.name.trim() + (ev.start ? " (" + day(ev.start) + ")" : "") : null;
  };
  // "13 Diamond · Round Rock Rumble (Mar 13): accepted on AES but not in HQ" —
  // the email's line. The job's message already leads with the tournament
  // ("Round Rock Rumble (Mar 13): …"); that part is muted, and it isn't said twice.
  const flagLine = (f) => {
    const msg = String(f.message || f.kind || "").trim();
    const team = f.team_name || "";
    if (team && norm(msg).startsWith(norm(team) + " ")) {
      return <>{teamLink(team)}<span style={{ color: C.text }}>{msg.slice(team.length)}</span></>;
    }
    const tl = tnLabel(f);
    const tnName = tl ? tl.replace(/\s*\([^)]*\)$/, "") : "";
    const sep = team ? " · " : "";
    const cut = tnName && norm(msg).startsWith(norm(tnName)) ? msg.indexOf(": ", tnName.length) : -1;
    if (cut > 0) {
      return <>{teamLink(team)}<span style={{ color: C.mut }}>{sep}{msg.slice(0, cut)}</span><span style={{ color: C.text }}>{msg.slice(cut)}</span></>;
    }
    const hasTn = tnName && norm(msg).includes(norm(tnName));
    return (
      <>
        {teamLink(team)}
        {tl && !hasTn && <span style={{ color: C.mut }}>{sep}{tl}</span>}
        <span style={{ color: C.text }}>{tl && !hasTn ? ": " : sep}{msg}</span>
      </>
    );
  };
  const platformLink = (f) => {
    const ev = flagEvent(f);
    const url = eventUrl(ev.platform, ev.ref);
    return url ? (
      <a href={url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
        style={{ fontSize: 10, fontWeight: 700, color: CYAN, whiteSpace: "nowrap" }}>{PLAT[ev.platform]} →</a>
    ) : null;
  };
  const isNew = (f) => f.first_flagged_at && (Date.now() - new Date(f.first_flagged_at).getTime()) < NEW_H * 3600e3;

  const lastLine = (() => {
    if (!loaded) return "Loading…";
    if (data.error) return "Couldn't load: " + data.error;
    if (!last) return "Not run yet. Runs daily at " + cronTime() + ".";
    return "Last run " + ago(last.run_at) + (lastFailed ? " · failed" : lastWarn ? " · with errors" : "");
  })();
  const elapsed = busy ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : 0;
  const headColor = lastFailed || (data && data.error) ? C.red : open.length ? ORANGE : C.border;

  return (
    <div style={{ marginBottom: 10, background: C.card, borderRadius: 10, border: "1px solid " + headColor, overflow: "hidden" }}>
      {/* Header — always visible */}
      <div onClick={() => setExpanded(!isExpanded)}
        style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "9px 12px", cursor: "pointer" }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: C.gold, whiteSpace: "nowrap" }}>Registration check</span>
        {loaded && !data.error && (open.length
          ? <span style={pill(ORANGE, { cursor: "pointer", fontSize: 10 })}>{open.length} to look at</span>
          : last ? <span style={pill(C.grn, { cursor: "pointer", fontSize: 10 })}>✓ matches AES/OTTO</span> : null)}
        {autos.length > 0 && <span style={pill(CYAN, { cursor: "pointer", fontSize: 10 })}>{autos.length} auto-update{autos.length === 1 ? "" : "s"}</span>}
        <span style={{ ...small, color: lastFailed || stale || (data && data.error) ? C.red : lastWarn ? AMBER : C.mut }}
          title={last ? stamp(last.run_at) : undefined}>{lastLine}{stale && !lastFailed ? " (missed a day?)" : ""}</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
          <button onClick={e => { e.stopPropagation(); run(); }} disabled={busy}
            title="Check AES and OTTO now (takes a few minutes). Accepted on AES moves Registered → Accepted; anything else is flagged here."
            style={{ ...btn(C.gold, !busy), opacity: busy ? 0.7 : 1, cursor: busy ? "default" : "pointer" }}>
            {busy ? "Checking… " + elapsed + "s" : "Run check now"}
          </button>
          <span style={{ ...small, width: 10, textAlign: "center" }}>{isExpanded ? "▴" : "▾"}</span>
        </span>
      </div>

      {/* Busy / last "Run now" result */}
      {(busy || result) && (
        <div style={{ padding: "0 12px 9px", fontSize: 11, lineHeight: 1.5, color: busy ? C.mut : result.ok ? C.grn : C.red, display: "flex", gap: 8, alignItems: "flex-start" }}>
          <span style={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>
            {busy ? "Checking every team's AES events and OTTO entries. This usually takes 1–4 minutes; you can keep working (Dismiss waits until it's done)."
              : result.ok ? "Done: " + (summaryBits(result.summary).join(" · ") || "check finished") +
                  (partialOf(result.summary).length ? " · partial: " + partialOf(result.summary).join(", ") : "")
              : "Check failed: " + result.text}
            {!busy && result.ok && result.warn && <span style={{ color: AMBER }}>{" · " + result.warn}</span>}
          </span>
          {!busy && <span onClick={() => setResult(null)} title="Hide" style={{ cursor: "pointer", color: C.mut, fontWeight: 700 }}>×</span>}
        </div>
      )}

      {isExpanded && loaded && (
        <div style={{ borderTop: "1px solid " + C.border, padding: "10px 12px 12px" }}>
          {/* Last run detail */}
          {last && (
            <div style={{ ...small, lineHeight: 1.5, marginBottom: 10 }}>
              <b style={{ color: lastFailed ? C.red : lastWarn ? AMBER : C.text }}>{lastFailed ? "Last run failed" : lastWarn ? "Last run (with errors)" : "Last run"}</b>{" "}
              {stamp(last.run_at)}
              {summaryBits(last.summary).length > 0 && " · " + summaryBits(last.summary).join(" · ")}
              {partialOf(last.summary).length > 0 && (
                <span style={{ color: AMBER }}>{" · partial: " + partialOf(last.summary).join(", ") + " (nothing marked missing from that pass)"}</span>
              )}
              {(lastFailed || lastWarn) && last.error && <div style={{ color: lastFailed ? C.red : AMBER, marginTop: 2, wordBreak: "break-word" }}>{last.error}</div>}
              {stale && <div style={{ color: AMBER, marginTop: 2 }}>No run in over a day. The daily check runs at {cronTime()}; use Run check now.</div>}
            </div>
          )}

          {/* Open flags, grouped */}
          {groups.length === 0 && (
            <div style={{ fontSize: 12, color: last ? C.grn : C.mut, marginBottom: 10 }}>
              {last ? "Nothing to look at. Every team HQ has going matches what AES and OTTO show." : "No results yet. Run the check, or wait for the daily run."}
            </div>
          )}
          {groups.map(g => (
            <div key={g.kind} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", marginBottom: 4 }} title={g.meta.hint}>
                <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4, color: g.meta.color }}>{g.meta.label}</span>
                <span style={{ fontSize: 10, fontWeight: 800, color: g.meta.color }}>{g.list.length}</span>
                {g.meta.hint && <span style={{ fontSize: 10, color: C.mut }}>{g.meta.hint}</span>}
              </div>
              {g.list.map(f => (
                <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "6px 8px", marginBottom: 4, borderRadius: 7, background: C.bg, borderLeft: "3px solid " + g.meta.color }}>
                  <span style={{ flex: "1 1 240px", minWidth: 0, fontSize: 12, lineHeight: 1.45, wordBreak: "break-word" }}>
                    {isNew(f) && <span style={pill(C.gold, { marginRight: 6, cursor: "default" })}>NEW</span>}
                    {flagLine(f)}
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
                    <span style={{ fontSize: 10, color: C.mut, whiteSpace: "nowrap" }} title={"First flagged " + stamp(f.first_flagged_at) + (f.last_seen_at ? "\nStill true at " + stamp(f.last_seen_at) : "")}>since {day(f.first_flagged_at)}</span>
                    {platformLink(f)}
                    <button onClick={() => setDismissed(f, true)} disabled={busy || savingId === f.id}
                      title={dismissLock || "Hide this until something changes. It won't come back unless you undo it."}
                      style={{ ...btn(C.mut, false), padding: "3px 9px", fontSize: 10, borderColor: C.border, ...(busy ? { opacity: 0.5, cursor: "default" } : null) }}>Dismiss</button>
                  </span>
                </div>
              ))}
            </div>
          ))}

          {/* Recent auto-updates */}
          {autos.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4, color: CYAN, marginBottom: 4 }}>
                Updated automatically · last {AUTO_DAYS} days
              </div>
              {autos.map(f => (
                <div key={f.id} style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", fontSize: 12, lineHeight: 1.45, padding: "3px 0", borderBottom: "1px dashed " + C.border }}>
                  <span style={{ fontSize: 10, color: C.mut, minWidth: 44, whiteSpace: "nowrap" }} title={stamp(f.first_flagged_at)}>{day(f.first_flagged_at)}</span>
                  <span style={{ flex: "1 1 220px", minWidth: 0, wordBreak: "break-word" }}>{flagLine(f)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Dismissed — undo */}
          {dismissed.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <span onClick={() => setShowDismissed(v => !v)} style={{ ...small, cursor: "pointer", fontWeight: 700 }}>
                {showDismissed ? "▴" : "▾"} Dismissed ({dismissed.length})
              </span>
              {showDismissed && dismissed.map(f => (
                <div key={f.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 11, padding: "4px 0", opacity: 0.75 }}>
                  <span style={{ flex: "1 1 220px", minWidth: 0, wordBreak: "break-word" }}>{flagLine(f)}</span>
                  <span style={{ fontSize: 10, color: C.mut }}>by {f.dismissed_by || "?"} · {day(f.dismissed_at)}</span>
                  <button onClick={() => setDismissed(f, false)} disabled={busy || savingId === f.id}
                    title={dismissLock || undefined}
                    style={{ ...btn(C.mut, false), padding: "2px 8px", fontSize: 10, borderColor: C.border, ...(busy ? { opacity: 0.5, cursor: "default" } : null) }}>Undo</button>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 10, color: C.mut, lineHeight: 1.5, marginTop: 4 }}>
            Runs daily at {cronTime()}: reads every DS Elite team's AES events and OTTO entries and compares them with each team's status here.
            Accepted on AES moves Planned/In Progress/Registered to Accepted; pending or entered moves Planned/In Progress to Registered.
            Nothing is ever moved backwards, created, or changed once Locked, Rostered or dropped; those come here as flags instead.
          </div>
        </div>
      )}
    </div>
  );
}
