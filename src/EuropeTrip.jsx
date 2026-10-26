// Girls Global Challenge (Croatia, July 2027): every invited player and where
// she stands - not interested, interested, committed, paid - with what's been
// paid and staff notes (Drew, Oct 26 2026). Families answer the /global form
// (interest: yes / maybe / no); staff set the status here, and it wins. A
// player who never answered can be set by hand too. Lives under Waiting on,
// below the chase list for families who haven't answered.

import { useMemo, useState } from "react";
import { supabase } from "./supabase";
import { GC_TEAMS, GC_PRICE, GC_WHEN, GC_INTEREST, GC_TRAVEL, GC_POSITIONS, GC_CITIES, GC_STATUSES, gcStatusOf, labelOf } from "../shared/global-challenge.js";

const C = { bg: "#0a0a0a", card: "#141414", border: "#2a2a2a", gold: "#e91e8c", text: "#ffffff", mut: "#999999", teal: "#2dd4bf", red: "#ef4444" };
const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
const TERMINAL = /declin|releas|withdr|not_invited|opted_out/i;

export default function EuropeTrip({ players = [], gcAnswers = [], team = "", coach, onSaved, onOpenPlayer }) {
  const [edits, setEdits] = useState({});     // player_id -> unsaved fields
  const [saving, setSaving] = useState({});   // player_id -> "saving" | "saved" | error text
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(true);

  const byPlayer = useMemo(() => new Map(gcAnswers.map(a => [a.player_id, a])), [gcAnswers]);
  // Everyone invited (the four National teams, still on the roster) plus anyone who answered.
  const rows = useMemo(() => {
    const ids = new Set([...players.filter(p => GC_TEAMS.includes(p.team_assignment) && !TERMINAL.test(p.offer_status || "")).map(p => p.id), ...gcAnswers.map(a => a.player_id)]);
    const byId = new Map(players.map(p => [p.id, p]));
    return [...ids].map(id => ({ p: byId.get(id), a: byPlayer.get(id) || null })).filter(r => r.p && (!team || r.p.team_assignment === team))
      .map(r => { const e = edits[r.p.id] || {}; return { ...r, st: r.a || e.status ? gcStatusOf({ ...(r.a || {}), ...e }) : "none" }; });
  }, [players, gcAnswers, byPlayer, team, edits]);

  const count = (k) => rows.filter(r => r.st === k).length;
  const paidTotal = rows.reduce((n, r) => n + (Number((edits[r.p.id] || {}).amount_paid ?? r.a?.amount_paid) || 0), 0);
  const ORDER = ["paid", "committed", "interested", "none", "not_interested"];
  const shown = rows.filter(r => filter === "all" || r.st === filter)
    .sort((x, y) => ORDER.indexOf(x.st) - ORDER.indexOf(y.st) || x.p.team_assignment.localeCompare(y.p.team_assignment) || x.p.last_name.localeCompare(y.p.last_name));

  // Save one player's status, amount or note. A player with no answer gets a row
  // marked as set in HQ (interest follows the status) so she counts everywhere.
  const save = async (p, patch) => {
    const a = byPlayer.get(p.id);
    const who = coach?.display_name || coach?.email || "HQ";
    const row = { player_id: p.id, ...patch, status_updated_by: who, status_updated_at: new Date().toISOString() };
    if (!a) Object.assign(row, { interest: patch.status === "not_interested" ? "no" : "yes", respondent_name: "Set in HQ by " + who, updated_at: new Date().toISOString() });
    setEdits(e => ({ ...e, [p.id]: { ...(e[p.id] || {}), ...patch } }));
    setSaving(s => ({ ...s, [p.id]: "saving" }));
    const { error } = await supabase.from("global_challenge_interest").upsert(row, { onConflict: "player_id" });
    setSaving(s => ({ ...s, [p.id]: error ? "Didn't save: " + error.message : "saved" }));
    if (!error) { await onSaved?.(); setEdits(e => { const n = { ...e }; delete n[p.id]; return n; }); }
  };

  const csv = () => {
    const q = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const lines = [["Player", "Team", "Status", "Paid", "Family's answer", "Plays", "Just her / family", "Family coming", "City", "Passport", "Answered by", "Their questions", "Staff notes"].map(q).join(",")];
    for (const { p, a, st } of shown) lines.push([p.first_name + " " + p.last_name, p.team_assignment, st === "none" ? "No answer" : labelOf(GC_STATUSES, st), a?.amount_paid ?? "",
      a ? labelOf(GC_INTEREST, a.interest) : "", a?.primary_position || "", a ? labelOf(GC_TRAVEL, a.travel) : "", a?.travelers ?? "", a ? labelOf(GC_CITIES, a.city) : "", a?.passport || "", a?.respondent_name || "", a?.questions || "", a?.staff_notes || ""].map(q).join(","));
    const el = document.createElement("a"); el.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })); el.download = "europe-trip.csv"; el.click();
  };

  const pill = (k, label, n, color) => (
    <button key={k} onClick={() => setFilter(f => f === k ? "all" : k)} aria-pressed={filter === k}
      style={{ background: filter === k ? color + "22" : C.bg, border: "1px solid " + (filter === k ? color : C.border), borderRadius: 10, padding: "7px 12px", minWidth: 96, textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}>
      <div style={{ fontSize: 20, fontWeight: 900, color, lineHeight: 1.1 }}>{n}</div>
      <div style={{ fontSize: 11, color: C.mut, fontWeight: 700 }}>{label}</div>
    </button>
  );

  return (
    <div style={{ background: C.card, border: "1px solid " + C.teal, borderRadius: 12, marginTop: 18, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 16 }}>🌍</span>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>Europe trip · Girls Global Challenge, {GC_WHEN}</div>
          <div style={{ fontSize: 11, color: C.mut, marginTop: 1 }}>Set each player's status by hand; it overrides the family's form answer. {money(paidTotal)} paid so far · {money(GC_PRICE)} per player.</div>
        </div>
        <button onClick={csv} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid " + C.border, background: "transparent", color: C.mut, fontFamily: "inherit", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>⬇ CSV</button>
        <button onClick={() => setOpen(o => !o)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid " + C.border, background: "transparent", color: C.mut, fontFamily: "inherit", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>{open ? "Hide list" : "Show list"}</button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        {GC_STATUSES.slice().reverse().map(s => pill(s.key, s.label, count(s.key), s.color))}
        {pill("none", "No answer yet", count("none"), C.mut)}
      </div>
      {open && <div style={{ marginTop: 10, borderTop: "1px solid " + C.border }}>
        {!shown.length && <div style={{ padding: "12px 0", fontSize: 12, color: C.mut }}>Nobody here{filter !== "all" ? " with that status" : ""}.</div>}
        {shown.map(({ p, a, st }) => {
          const e = edits[p.id] || {}, sv = saving[p.id];
          const amount = e.amount_paid ?? a?.amount_paid ?? "";
          const notes = e.staff_notes ?? a?.staff_notes ?? "";
          const fam = a && !/^Set in HQ/.test(a.respondent_name || "") ? [labelOf(GC_INTEREST, a.interest).replace(/,.*$/, ""), a.primary_position, labelOf(GC_TRAVEL, a.travel) + (a.travelers ? " (" + a.travelers + ")" : ""), a.city ? labelOf(GC_CITIES, a.city).split(",")[0] : ""].filter(Boolean).join(" · ") : "";
          return (
            <div key={p.id} style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: "9px 0", borderBottom: "1px solid " + C.border, alignItems: "center" }}>
              <div style={{ flex: "1 1 160px", minWidth: 0 }}>
                <button onClick={() => onOpenPlayer?.(p.id)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: C.text, textAlign: "left" }}>{p.first_name} {p.last_name}</button>
                <div style={{ fontSize: 11, color: C.mut }}>{p.team_assignment}</div>
                <div style={{ fontSize: 11, color: C.mut, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a?.questions ? "“" + a.questions + "” — " + a.respondent_name : ""}>{fam ? "Form: " + fam : a ? "Set in HQ" : "Hasn't answered the form"}</div>
              </div>
              <div role="group" aria-label={"Status for " + p.first_name} style={{ flex: "2 1 280px", display: "flex", gap: 4, flexWrap: "wrap" }}>
                {GC_STATUSES.map(s => {
                  const on = st === s.key;
                  return <button key={s.key} onClick={() => !on && save(p, { status: s.key })} aria-pressed={on}
                    style={{ padding: "5px 9px", borderRadius: 999, border: "1px solid " + (on ? s.color : C.border), background: on ? s.color + "26" : "transparent", color: on ? s.color : C.mut, fontFamily: "inherit", fontSize: 11.5, fontWeight: 800, cursor: on ? "default" : "pointer" }}>{s.label}</button>;
                })}
              </div>
              <div style={{ flex: "2 1 220px", display: "flex", gap: 6, alignItems: "center", minWidth: 0 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: C.mut, flexShrink: 0 }}>$
                  <input inputMode="decimal" value={amount} placeholder="paid" aria-label={"Amount paid for " + p.first_name}
                    onChange={ev => setEdits(x => ({ ...x, [p.id]: { ...(x[p.id] || {}), amount_paid: ev.target.value } }))}
                    onBlur={ev => { const v = ev.target.value.replace(/[$,\s]/g, ""); const n = v === "" ? null : Number(v); if (v !== "" && !Number.isFinite(n)) return; if ((a?.amount_paid ?? null) !== n) save(p, { amount_paid: n }); }}
                    style={{ width: 64, background: C.bg, color: C.text, border: "1px solid " + C.border, borderRadius: 6, padding: "5px 6px", fontFamily: "inherit", fontSize: 12 }} /></label>
                <input value={notes} placeholder="Note" aria-label={"Note for " + p.first_name}
                  onChange={ev => setEdits(x => ({ ...x, [p.id]: { ...(x[p.id] || {}), staff_notes: ev.target.value } }))}
                  onBlur={ev => { const v = ev.target.value.trim() || null; if ((a?.staff_notes ?? null) !== v) save(p, { staff_notes: v }); }}
                  style={{ flex: 1, minWidth: 0, background: C.bg, color: C.text, border: "1px solid " + C.border, borderRadius: 6, padding: "5px 7px", fontFamily: "inherit", fontSize: 12 }} />
                <span style={{ fontSize: 10, color: sv && sv !== "saving" && sv !== "saved" ? C.red : C.mut, width: 40, flexShrink: 0 }} title={sv || ""}>{sv === "saving" ? "…" : sv === "saved" ? "Saved" : sv ? "Error" : ""}</span>
              </div>
            </div>
          );
        })}
      </div>}
    </div>
  );
}
