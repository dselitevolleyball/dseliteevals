// DS Elite HQ → New players. One checklist per player who joins after the
// main invites (Coach Kristen runs it): everything between "offered" and
// "fully part of the team" - accepted, paid, onboarding form, jersey number,
// uniform ordered and handed out, USAV membership, on the USAV team roster,
// commitment, SportsYou, shoes, scorekeeping and stay-to-play hotels.
//
// What HQ can already see ticks itself (offer status, the /gear form, jersey
// number, the SportsEngine export, commitment signatures, hotel bookings from
// the housing reports). The rest a person ticks here; each tick keeps who and
// when (player_onboarding.items). Anyone offered since NEW_SINCE shows up on
// their own; anyone else can be added by hand, and "Finished" hides a player.

import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "./supabase";
import { isRiseTeam } from "../shared/gear-teams.js";

const NEW_SINCE = "2026-09-21";            // the day after the main September invites
const TERMINAL = ["declined", "not_invited", "opted_out"];
const APP = "https://dseliteevals.vercel.app";

// kind: auto = worked out from HQ data (can still be ticked by hand if HQ lags behind);
//       manual = a person ticks it.
const ITEMS = [
  { key: "accepted",   label: "Accepted the offer",               short: "Accepted",   kind: "auto" },
  { key: "paid",       label: "Registered & paid in SportsEngine", short: "Paid",      kind: "manual" },
  { key: "form",       label: "Onboarding form (details + sizes)", short: "Form",      kind: "auto" },
  { key: "jersey",     label: "Jersey number assigned",            short: "Jersey #",  kind: "auto" },
  { key: "uniform_ordered", label: "Uniform ordered",               short: "Ordered",   kind: "manual" },
  { key: "uniform_given",   label: "Uniform handed out",            short: "Uniform",   kind: "manual" },
  { key: "usav",       label: "USAV / Lone Star membership",       short: "USAV",      kind: "auto" },
  { key: "roster",     label: "On the USAV team roster",           short: "Roster",    kind: "manual" },
  { key: "commitment", label: "Commitment signed (player + parent)", short: "Commit",  kind: "auto" },
  { key: "sportsyou",  label: "Joined SportsYou",                  short: "SportsYou", kind: "manual" },
  { key: "shoes",      label: "Club shoes (Avoli)",                short: "Shoes",     kind: "manual", regionalOnly: true },
  { key: "scorekeeping", label: "Scorekeeping certified",          short: "Scoring",   kind: "manual" },
  { key: "stay",       label: "Stay-to-play hotels booked",        short: "Hotels",    kind: "auto" },
];

const fmtDay = (iso) => iso ? new Date(String(iso).length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
const daysSince = (iso) => iso ? Math.max(0, Math.floor((Date.now() - new Date(iso)) / 86400000)) : null;

export default function NewPlayers({ players, coach, C, upd, narrow }) {
  const me = coach?.display_name || coach?.email || "";
  const [rows, setRows] = useState(null);          // player_onboarding
  const [gear, setGear] = useState([]);
  const [commits, setCommits] = useState([]);
  const [trips, setTrips] = useState([]);          // { team, t: tournament }
  const [booked, setBooked] = useState([]);        // housing bookings
  const [err, setErr] = useState("");
  const [team, setTeam] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState("");

  const load = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const [ob, g, c, ta, hb] = await Promise.all([
      supabase.from("player_onboarding").select("*"),
      supabase.from("player_gear_orders").select("player_id, is_draft, details_confirmed, submitted_at"),
      supabase.from("player_commitments").select("player_id, player_signed_at, parent_signed_at"),
      supabase.from("tournament_assignments").select("tournament_id, team_id"),
      supabase.from("tournament_housing_bookings").select("tournament_id, matched_player_id"),
    ]);
    if (ob.error) { setErr(/player_onboarding/.test(ob.error.message) ? "Run migrations/20261030_player_onboarding.sql first." : ob.error.message); setRows([]); return; }
    setRows(ob.data || []); setGear(g.data || []); setCommits(c.data || []); setBooked(hb.data || []);
    const ids = [...new Set((ta.data || []).map(r => r.tournament_id))];
    const { data: tns } = ids.length ? await supabase.from("tournaments").select("id, name, start_date, end_date, stay_over, cancelled").in("id", ids) : { data: [] };
    const byId = new Map((tns || []).filter(t => t.stay_over && !t.cancelled && (t.end_date || t.start_date) >= today).map(t => [t.id, t]));
    setTrips((ta.data || []).filter(r => byId.has(r.tournament_id)).map(r => ({ team: r.team_id, t: byId.get(r.tournament_id) })));
  }, []);
  useEffect(() => { load(); }, [load]);

  const rowBy = useMemo(() => new Map((rows || []).map(r => [r.player_id, r])), [rows]);
  const gearBy = useMemo(() => new Map(gear.map(r => [r.player_id, r])), [gear]);
  const commitBy = useMemo(() => new Map(commits.map(r => [r.player_id, r])), [commits]);

  // Who's on the list: offered since NEW_SINCE, or added by hand; never declined/opted out.
  const list = useMemo(() => (players || []).filter(p => {
    const r = rowBy.get(p.id);
    if (!p.team_assignment || TERMINAL.includes(p.offer_status || "")) return false;
    return !!r || (p.offer_made_at && p.offer_made_at.slice(0, 10) >= NEW_SINCE);
  }), [players, rowBy]);

  // Each item's state for one player: { state: done|todo|na, detail, by? }
  const status = useCallback((p) => {
    const r = rowBy.get(p.id), ticks = r?.items || {};
    const rise = isRiseTeam(p.team_assignment);
    const out = {};
    for (const it of ITEMS) {
      if (it.regionalOnly && rise) { out[it.key] = { state: "na", detail: "Rise teams don't buy the club shoe" }; continue; }
      let auto = null;
      if (it.key === "accepted") auto = p.offer_status === "accepted" || p.offer_status === "locked"
        ? { ok: true, detail: p.offer_decision_at ? "accepted " + fmtDay(p.offer_decision_at) : "accepted" }
        : { ok: false, detail: "offered " + fmtDay(p.offer_made_at) + (p.offer_made_at ? ` (${daysSince(p.offer_made_at)}d ago)` : "") };
      if (it.key === "form") { const g = gearBy.get(p.id); auto = g && !g.is_draft && g.details_confirmed ? { ok: true, detail: "sent " + fmtDay(g.submitted_at) } : { ok: false, detail: g ? (g.is_draft ? "started, not sent" : "sent, details not confirmed") : "not started", link: p.gear_form_token ? `${APP}/gear?t=${p.gear_form_token}` : null }; }
      if (it.key === "jersey") auto = p.jersey_number ? { ok: true, detail: "#" + p.jersey_number } : { ok: false, detail: "set it on her player card" };
      if (it.key === "usav") auto = p.sportsengine_registered ? { ok: true, detail: "in the SportsEngine export" } : { ok: false, detail: "not in the SportsEngine export yet ($55, Lone Star + USAV)" };
      if (it.key === "commitment") { const c = commitBy.get(p.id); auto = c?.player_signed_at && c?.parent_signed_at ? { ok: true, detail: "both signed " + fmtDay(c.parent_signed_at > c.player_signed_at ? c.parent_signed_at : c.player_signed_at) } : { ok: false, detail: !c ? "neither has signed" : !c.player_signed_at ? "player hasn't signed" : "parent hasn't signed", link: p.commitment_token ? `${APP}/commitment?t=${p.commitment_token}` : null }; }
      if (it.key === "sportsyou" && p.sportsyou_registered) auto = { ok: true, detail: "marked on her card" };
      if (it.key === "stay") {
        const mine = trips.filter(x => x.team === p.team_assignment).sort((a, b) => a.t.start_date.localeCompare(b.t.start_date));
        if (!mine.length) { out[it.key] = { state: "na", detail: "no overnight tournaments ahead" }; continue; }
        const has = (t) => booked.some(b => b.tournament_id === t.id && b.matched_player_id === p.id);
        const missing = mine.filter(x => !has(x.t));
        auto = { ok: !missing.length, detail: missing.length ? `${mine.length - missing.length} of ${mine.length} booked · still to book: ${missing.map(x => `${x.t.name} (${fmtDay(x.t.start_date)})`).join(", ")}` : `all ${mine.length} booked` };
      }
      const tick = ticks[it.key];
      if (auto?.ok) out[it.key] = { state: "done", detail: auto.detail };
      else if (tick) out[it.key] = { state: "done", detail: `ticked by ${tick.by || "someone"} ${fmtDay(tick.at)}`, ticked: true };
      else out[it.key] = { state: "todo", detail: auto?.detail || "", link: auto?.link };
    }
    return out;
  }, [rowBy, gearBy, commitBy, trips, booked]);

  const save = async (p, patch) => {
    const cur = rowBy.get(p.id) || { player_id: p.id, items: {}, added_by: null };
    const next = { ...cur, ...patch, player_id: p.id, updated_at: new Date().toISOString() };
    setRows(rs => [...(rs || []).filter(r => r.player_id !== p.id), next]);
    const { error } = await supabase.from("player_onboarding").upsert(next, { onConflict: "player_id" });
    if (error) { setErr("Couldn't save: " + error.message); load(); }
  };
  const tick = (p, key, on) => {
    const items = { ...(rowBy.get(p.id)?.items || {}) };
    if (on) items[key] = { at: new Date().toISOString(), by: me }; else delete items[key];
    save(p, { items });
    if (key === "sportsyou") upd?.(p.id, { sportsyou_registered: on });
  };

  const teams = [...new Set(list.map(p => p.team_assignment))].sort((a, b) => (parseInt(a) || 99) - (parseInt(b) || 99) || a.localeCompare(b));
  const scored = list.map(p => { const s = status(p); const need = ITEMS.filter(i => s[i.key].state !== "na"); return { p, s, done: need.filter(i => s[i.key].state === "done").length, total: need.length }; });
  const shown = scored.filter(x => (!team || x.p.team_assignment === team) && (showDone || !rowBy.get(x.p.id)?.archived_at))
    .sort((a, b) => (a.done / a.total) - (b.done / b.total) || String(a.p.offer_made_at || "").localeCompare(String(b.p.offer_made_at || "")));
  const addable = (players || []).filter(p => p.team_assignment && !TERMINAL.includes(p.offer_status || "") && !list.some(x => x.id === p.id))
    .sort((a, b) => (a.first_name + a.last_name).localeCompare(b.first_name + b.last_name));
  // What's left across everyone shown, item by item - Kristen's to-do list.
  const outstanding = ITEMS.map(i => ({ i, n: shown.filter(x => x.s[i.key].state === "todo").length })).filter(x => x.n);

  const chip = (st) => ({ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
    border: "1px solid " + (st === "done" ? C.grn : st === "na" ? C.border : "#f59e0b"), color: st === "done" ? C.grn : st === "na" ? C.mut : "#f59e0b", background: st === "done" ? "rgba(34,197,94,0.10)" : "transparent", opacity: st === "na" ? 0.5 : 1 });
  const btn = (primary) => ({ padding: "6px 12px", borderRadius: 8, border: "1px solid " + (primary ? C.gold : C.border), background: primary ? C.gold : "transparent", color: primary ? "#000" : C.text, fontFamily: "inherit", fontSize: 12, fontWeight: 800, cursor: "pointer", minHeight: narrow ? 40 : undefined });

  if (rows == null) return <div style={{ padding: 24, color: C.mut }}>Loading new players…</div>;
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.gold }}>🆕 New players</h2>
          <div style={{ fontSize: 12, color: C.mut, marginTop: 2 }}>Everyone who joined after the main invites, and everything still to do for each. Green items HQ sees for itself; tick the rest as they're done.</div>
        </div>
        <button onClick={load} style={btn(false)}>⟳ Refresh</button>
      </div>
      {err && <div style={{ color: C.red, fontSize: 13, margin: "8px 0" }}>{err}</div>}

      {outstanding.length > 0 && <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 12, margin: "12px 0" }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: C.gold, marginBottom: 6 }}>Still to do</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{outstanding.map(({ i, n }) => <span key={i.key} style={chip("todo")}>{i.short} · {n}</span>)}</div>
      </div>}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: "10px 0" }}>
        {["", ...teams].map(t => <button key={t || "all"} onClick={() => setTeam(t)} style={{ ...btn(false), borderColor: team === t ? C.gold : C.border, color: team === t ? C.gold : C.mut, padding: "5px 11px", fontSize: 11.5 }}>{t ? t.replace(/^(\d+ Rise) 1$/, "$1") : "All teams"}</button>)}
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: C.mut, marginLeft: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} style={{ accentColor: C.gold }} /> Show finished
        </label>
        <div style={{ flex: 1 }} />
        <select value={adding} onChange={e => setAdding(e.target.value)} style={{ padding: "6px 8px", borderRadius: 8, background: C.card, color: C.text, border: "1px solid " + C.border, fontFamily: "inherit", fontSize: 12, maxWidth: 220 }}>
          <option value="">+ Add a player…</option>
          {addable.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name} · {p.team_assignment.replace(/^(\d+ Rise) 1$/, "$1")}</option>)}
        </select>
        {adding && <button style={btn(true)} onClick={() => { const p = players.find(x => x.id === Number(adding)); if (p) save(p, { added_by: me, added_at: new Date().toISOString(), archived_at: null }); setAdding(""); }}>Add</button>}
      </div>

      {!shown.length && <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 24, color: C.mut, fontSize: 13, textAlign: "center" }}>Nobody here{team ? " on " + team : ""}. New offers show up on their own.</div>}

      {shown.map(({ p, s, done, total }) => {
        const r = rowBy.get(p.id), isOpen = open === p.id, pct = Math.round(100 * done / total);
        return (
          <div key={p.id} style={{ background: C.card, border: "1px solid " + (isOpen ? C.gold : C.border), borderRadius: 12, marginBottom: 10, overflow: "hidden", opacity: r?.archived_at ? 0.6 : 1 }}>
            <button onClick={() => setOpen(isOpen ? null : p.id)} style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", padding: 12, cursor: "pointer", color: C.text, fontFamily: "inherit" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <b style={{ fontSize: 15 }}>{p.first_name} {p.last_name}</b>
                <span style={{ fontSize: 12, color: C.gold, fontWeight: 700 }}>{p.team_assignment.replace(/^(\d+ Rise) 1$/, "$1")}</span>
                <span style={{ fontSize: 11.5, color: C.mut }}>{p.parent_name || p.parent_email || ""}</span>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 12, fontWeight: 800, color: done === total ? C.grn : C.text }}>{done}/{total}</span>
              </div>
              <div style={{ height: 5, background: C.border, borderRadius: 3, margin: "8px 0" }}><div style={{ width: pct + "%", height: 5, borderRadius: 3, background: done === total ? C.grn : C.gold }} /></div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {ITEMS.map(i => <span key={i.key} style={chip(s[i.key].state)} title={i.label + (s[i.key].detail ? " — " + s[i.key].detail : "")}>{s[i.key].state === "done" ? "✓" : s[i.key].state === "na" ? "–" : "○"} {i.short}</span>)}
              </div>
            </button>
            {isOpen && <div style={{ borderTop: "1px solid " + C.border, padding: 12 }}>
              {ITEMS.map(i => { const st = s[i.key]; return (
                <div key={i.key} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "7px 0", borderBottom: "1px solid " + C.border, opacity: st.state === "na" ? 0.5 : 1 }}>
                  <span style={{ ...chip(st.state), minWidth: 22, justifyContent: "center" }}>{st.state === "done" ? "✓" : st.state === "na" ? "–" : "○"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700 }}>{i.label}{i.kind === "auto" && <span style={{ fontSize: 10, color: C.mut, fontWeight: 600, marginLeft: 6 }}>AUTO</span>}</div>
                    {st.detail && <div style={{ fontSize: 12, color: C.mut, marginTop: 1, overflowWrap: "anywhere" }}>{st.detail}</div>}
                    {st.link && <button onClick={() => navigator.clipboard?.writeText(st.link).then(() => window.alert("Link copied — send it to the family."))} style={{ ...btn(false), padding: "3px 9px", fontSize: 11, marginTop: 4 }}>Copy her link</button>}
                  </div>
                  {i.key === "accepted" && st.state === "todo" && <button style={btn(true)} onClick={() => { if (window.confirm(`Mark ${p.first_name} as accepted on ${p.team_assignment}? That puts her on the roster and club emails.`)) upd?.(p.id, { offer_status: "accepted", status: "Accepted", offer_decision_at: new Date().toISOString() }); }}>Mark accepted</button>}
                  {st.state === "todo" && i.key !== "accepted" && i.key !== "jersey" && <button style={btn(false)} onClick={() => tick(p, i.key, true)}>{i.kind === "auto" ? "Mark done" : "Done"}</button>}
                  {st.ticked && <button style={{ ...btn(false), color: C.mut }} onClick={() => tick(p, i.key, false)}>Undo</button>}
                </div>
              ); })}
              <textarea defaultValue={r?.notes || ""} placeholder="Notes — sizes to swap, who you spoke to, anything to remember…" onBlur={e => { if ((e.target.value || "") !== (r?.notes || "")) save(p, { notes: e.target.value }); }}
                style={{ width: "100%", boxSizing: "border-box", marginTop: 10, minHeight: 64, padding: 10, borderRadius: 8, background: C.bg, color: C.text, border: "1px solid " + C.border, fontFamily: "inherit", fontSize: narrow ? 16 : 13 }} />
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                {r?.archived_at
                  ? <button style={btn(false)} onClick={() => save(p, { archived_at: null, archived_by: null })}>Back on the list</button>
                  : <button style={btn(false)} onClick={() => save(p, { archived_at: new Date().toISOString(), archived_by: me })}>Finished — hide her</button>}
              </div>
            </div>}
          </div>
        );
      })}
    </div>
  );
}
