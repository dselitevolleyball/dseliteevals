// Stay-to-play housing — who has booked, who hasn't.
//
// The housing bureau (KC Sports Housing for the Red Rock Rave, others for
// other events) emails a "pickup report" listing every room booked under the
// club. An admin pastes it here; the app parses it, matches each room to a
// player or a coach, and shows every family on the trip that still has no
// room — with contacts and a one-click reminder before the cut-off. Each paste
// replaces the last report for that tournament, because the bureau always
// sends the whole list.

import { useState, useEffect, useMemo } from "react";
import { supabase } from "./supabase";
import { parsePickupReport, matchBookings } from "../shared/housing-report.js";

const C = { bg: "#0a0a0a", card: "#141414", border: "#2a2a2a", gold: "#e91e8c", text: "#ffffff", mut: "#999999", acc: "#ff69b4", red: "#ef4444", grn: "#22c55e", amber: "#f59e0b" };
const S = {
  card: { background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 16, marginBottom: 14 },
  lbl: { fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: C.mut, marginBottom: 6 },
  input: { background: C.bg, border: "1px solid " + C.border, borderRadius: 6, color: C.text, fontFamily: "inherit", fontSize: 13, padding: "6px 8px" },
  gold: { padding: "7px 13px", borderRadius: 8, border: "none", background: C.gold, color: "#000", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" },
  ghost: { padding: "7px 13px", borderRadius: 8, border: "1px solid " + C.border, background: "transparent", color: C.text, fontWeight: 600, fontSize: 12, cursor: "pointer", fontFamily: "inherit" },
};
const KRISTEN = "kristen@dselitevolleyball.com";
const localISO = (d) => { const x = d ? new Date(d) : new Date(); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const fmtRange = (t) => { const m = { month: "short", day: "numeric" }; const s = new Date(t.start_date + "T12:00:00"), e = new Date((t.end_date || t.start_date) + "T12:00:00"); return s.toLocaleDateString(undefined, m) + (t.end_date && t.end_date !== t.start_date ? "–" + e.toLocaleDateString(undefined, m) : "") + ", " + s.getFullYear(); };
const fmtDeadline = (iso) => iso ? new Date(iso).toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : null;
const parentsOf = (p) => [p.parent_name, p.parent2_name].map(s => String(s || "").trim()).filter(Boolean);
const emailsOf = (p) => [...new Set([p.parent_email, p.parent_email2, p.parent_email3].map(s => String(s || "").trim().toLowerCase()).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))];
const firstNames = (p) => { const n = parentsOf(p).map(s => s.split(" ")[0]); return n.length ? n.join(" and ") : "there"; };

export default function HousingView({ tournaments = [], tournamentAssignments = [], players = [], coachRoster = [], coach, reloadTournaments }) {
  const today = localISO();
  const coachName = coach?.display_name || coach?.email || "";
  const list = useMemo(() => tournaments
    .filter(t => (t.stay_over || t.stay_to_play) && !t.cancelled && (t.end_date || t.start_date) >= today)
    .sort((a, b) => (a.start_date || "").localeCompare(b.start_date || "")), [tournaments, today]);
  const teamsAt = (tnId) => [...new Set(tournamentAssignments.filter(a => a.tournament_id === tnId).map(a => a.team_id))].sort();
  const [selId, setSelId] = useState(null);
  const [rows, setRows] = useState({});          // tournament_id -> stored bookings
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState(null);
  const [showBooked, setShowBooked] = useState(false);

  const loadRows = async (ids) => {
    if (!ids.length) return;
    const { data } = await supabase.from("tournament_housing_bookings").select("*").in("tournament_id", ids).order("row_no");
    const by = {}; for (const r of (data || [])) (by[r.tournament_id] = by[r.tournament_id] || []).push(r);
    setRows(prev => { const n = { ...prev }; for (const id of ids) n[id] = by[id] || []; return n; });
  };
  useEffect(() => { loadRows(list.map(t => t.id)); }, [list.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Write the automatic matches back to the rows, so the database says who a
  // room belongs to — Ask HQ and anything else reading the table see the same
  // answer the screen shows. Manual matches are never overwritten.
  useEffect(() => {
    if (!players.length) return;
    const updates = [];
    for (const tn of list) {
      const stored = rows[tn.id] || []; if (!stored.length) continue;
      const a = analyse(tn);
      a.bookings.forEach((b, i) => {
        const st = stored[i]; if (!st || st.match_how === "manual") return;
        const pid = b.matched_player_id || null, team = b.matched_team || null, staff = !!b.is_staff, how = b.match_how || null;
        if (st.matched_player_id !== pid || st.matched_team !== team || !!st.is_staff !== staff || (st.match_how || null) !== how) updates.push({ id: st.id, matched_player_id: pid, matched_team: team, is_staff: staff, match_how: how });
      });
    }
    if (!updates.length) return;
    Promise.all(updates.slice(0, 80).map(u => supabase.from("tournament_housing_bookings").update(u).eq("id", u.id))).then(() => loadRows(list.map(t => t.id)));
  }, [rows, players.length, coachRoster.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Match on the client every render, so a roster change or a manual fix
  // shows up without re-importing. Manual matches (match_how = manual) win.
  const analyse = (tn) => {
    const stored = rows[tn.id] || [];
    const teams = teamsAt(tn.id);
    const r = matchBookings(stored, players, coachRoster, teams);
    r.bookings = r.bookings.map((b, i) => stored[i]?.match_how === "manual" ? { ...b, matched_player_id: stored[i].matched_player_id, matched_team: stored[i].matched_team, is_staff: false, match_how: "manual", candidates: [] } : b);
    const bookedIds = new Set(r.bookings.filter(b => b.matched_player_id).map(b => b.matched_player_id));
    r.unbooked = r.pool.filter(p => !bookedIds.has(p.id)).sort((a, b) => a.team_assignment.localeCompare(b.team_assignment) || (a.last_name || "").localeCompare(b.last_name || ""));
    r.teams = teams;
    return r;
  };

  const sel = list.find(t => t.id === selId) || null;
  const importReport = async () => {
    if (!sel) return;
    const parsed = parsePickupReport(paste);
    if (!parsed.length) { window.alert("Couldn't find any bookings in that text. Paste the whole email — from the header row through the last room."); return; }
    if ((rows[sel.id] || []).length && !window.confirm(`Replace the ${rows[sel.id].length} rooms on file with these ${parsed.length}? (The bureau sends the whole list each time.)`)) return;
    setBusy("import");
    // Keep manual matches by acknowledgement number across re-imports.
    const manual = new Map((rows[sel.id] || []).filter(r => r.match_how === "manual" && r.ack_number).map(r => [r.ack_number, r]));
    await supabase.from("tournament_housing_bookings").delete().eq("tournament_id", sel.id);
    const ins = parsed.map(b => { const m = manual.get(b.ack_number); return { tournament_id: sel.id, ...b, created_by: coachName, ...(m ? { matched_player_id: m.matched_player_id, matched_team: m.matched_team, match_how: "manual" } : {}) }; });
    const { error } = await supabase.from("tournament_housing_bookings").insert(ins);
    if (error) { window.alert("Couldn't save: " + error.message); setBusy(""); return; }
    // The email usually states the cut-off; lift it if we can read it.
    const dl = /cut-?off is\s+([A-Za-z]+,?\s+[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{1,2}:\d{2}\s*(?:am|pm)\s*(?:[A-Za-z]+\s+Time)?)/i.exec(paste);
    await supabase.from("tournaments").update({ housing_report_at: new Date().toISOString() }).eq("id", sel.id);
    await loadRows([sel.id]); reloadTournaments && reloadTournaments();
    setPaste(""); setBusy("");
    setNote(`${parsed.length} rooms imported.` + (dl && !sel.housing_deadline ? ` The email says the cut-off is "${dl[1]}" — set it below so the reminder can say so.` : ""));
  };
  const setManual = async (b, playerId) => {
    const p = players.find(x => x.id === Number(playerId));
    await supabase.from("tournament_housing_bookings").update(p ? { matched_player_id: p.id, matched_team: p.team_assignment, match_how: "manual", is_staff: false } : { matched_player_id: null, matched_team: null, match_how: null }).eq("id", b.id);
    await loadRows([sel.id]);
  };
  const saveTn = async (patch) => { await supabase.from("tournaments").update(patch).eq("id", sel.id); reloadTournaments && reloadTournaments(); };

  const remind = async (a) => {
    const fams = a.unbooked.filter(p => emailsOf(p).length);
    const noEmail = a.unbooked.filter(p => !emailsOf(p).length);
    if (!fams.length) { window.alert("None of the unbooked families have an email on file."); return; }
    const when = fmtDeadline(sel.housing_deadline);
    if (!window.confirm(`Email ${fams.length} famil${fams.length === 1 ? "y" : "ies"} who haven't booked for ${sel.name}?${when ? "\nCut-off: " + when : "\n(No cut-off set — the email won't name one.)"}${noEmail.length ? "\n\nNo email on file: " + noEmail.map(p => p.first_name + " " + p.last_name).join(", ") : ""}`)) return;
    setBusy("remind");
    let sent = 0;
    for (const p of fams) {
      const body = `Hi ${firstNames(p)},

${sel.name} (${fmtRange(sel)}) is a stay-to-play event, and the housing bureau's latest report shows no room booked yet for ${p.first_name}${p.team_assignment ? " (" + p.team_assignment + ")" : ""}.

Every family has to book through the club's housing block${when ? " by " + when : ""} — after the cut-off the unbooked rooms go back to the bureau and we can't add them back.${sel.housing_url ? "\n\nBook here: " + sel.housing_url : ""}

If you've already booked in the last day or two, thank you — the report may just be behind. Otherwise please get it done today.

Questions: reply to this email and Kristen will help.

— DS Elite Volleyball`;
      const r = await fetch("/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skipPush: true, subject: `Book your room for ${sel.name}${when ? " — cut-off " + new Date(sel.housing_deadline).toLocaleDateString(undefined, { weekday: "long" }) : ""}`, body, recipients: emailsOf(p), replyTo: KRISTEN, sentBy: coachName, source: "housing-reminder" }) });
      if (r.ok) sent++;
    }
    const summary = fams.map(p => `• ${p.first_name} ${p.last_name} (${p.team_assignment}) — ${parentsOf(p).join(" & ") || "parent"} — ${emailsOf(p).join(", ")}`).join("\n");
    await fetch("/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skipPush: true, subject: `Housing reminder sent — ${sel.name} (${sent} families)`, body: `${coachName} sent the stay-to-play reminder for ${sel.name} to ${sent} famil${sent === 1 ? "y" : "ies"} still without a room:\n\n${summary}${noEmail.length ? "\n\nNo email on file (not sent): " + noEmail.map(p => p.first_name + " " + p.last_name + " (" + p.team_assignment + ")").join(", ") : ""}`, recipients: [KRISTEN, "drew@dselitevolleyball.com"] }) }).catch(() => {});
    await saveTn({ housing_reminded_at: new Date().toISOString() });
    setBusy(""); setNote(`Reminder sent to ${sent} famil${sent === 1 ? "y" : "ies"}. Kristen and Drew got the list.`);
  };
  const copyList = (a) => {
    const txt = a.teams.map(t => { const u = a.unbooked.filter(p => p.team_assignment === t); return `${t} — ${u.length} not booked\n` + u.map(p => `  ${p.first_name} ${p.last_name} — ${parentsOf(p).join(" & ")} — ${emailsOf(p).join(", ")}${p.parent_phone ? " — " + p.parent_phone : ""}`).join("\n"); }).join("\n\n");
    navigator.clipboard?.writeText(txt); setNote("Copied.");
  };

  // ── List of stay-to-play events ────────────────────────────────────────
  if (!sel) return (
    <div style={{ padding: "18px 16px", maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: C.gold }}>Stay-to-play housing</div>
      <div style={{ fontSize: 12, color: C.mut, marginBottom: 14 }}>Paste the housing bureau's pickup report for an event and see which families still need a room.</div>
      {!list.length && <div style={S.card}>No upcoming stay-over tournaments.</div>}
      {list.map(t => {
        const a = analyse(t);
        const has = (rows[t.id] || []).length > 0;
        const dl = t.housing_deadline ? new Date(t.housing_deadline) : null;
        const soon = dl && (dl - Date.now()) < 5 * 86400000 && dl > Date.now();
        return (
          <button key={t.id} onClick={() => { setSelId(t.id); setNote(null); }} style={{ ...S.card, display: "flex", alignItems: "center", gap: 14, width: "100%", textAlign: "left", cursor: "pointer", fontFamily: "inherit", color: C.text, borderColor: has && a.unbooked.length ? C.amber : C.border }}>
            <div style={{ minWidth: 120 }}><div style={{ fontSize: 13, fontWeight: 800 }}>{fmtRange(t)}</div><div style={{ fontSize: 11, color: C.mut }}>{t.location || ""}</div></div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{t.name}</div>
              <div style={{ fontSize: 11, color: C.mut }}>{a.teams.join(" · ") || "no teams assigned"} · {a.pool.length} players</div>
            </div>
            {has ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: C.grn, fontWeight: 800 }}>{a.pool.length - a.unbooked.length} booked</span>
                <span style={{ fontSize: 12, color: a.unbooked.length ? C.amber : C.mut, fontWeight: 800 }}>{a.unbooked.length} not booked</span>
                {dl && <span style={{ fontSize: 11, color: soon ? C.red : C.mut }}>cut-off {dl.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
              </div>
            ) : <span style={{ fontSize: 12, color: C.mut }}>no report yet</span>}
          </button>
        );
      })}
    </div>
  );

  // ── One event ──────────────────────────────────────────────────────────
  const a = analyse(sel);
  const stored = rows[sel.id] || [];
  const byId = (id) => players.find(p => p.id === id);
  const unmatched = a.bookings.filter(b => !b.matched_player_id && !b.is_staff);
  const staff = a.bookings.filter(b => b.is_staff);
  const reportAt = sel.housing_report_at ? new Date(sel.housing_report_at) : null;
  return (
    <div style={{ padding: "18px 16px", maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <button style={S.ghost} onClick={() => setSelId(null)}>← All events</button>
        <div style={{ flex: 1 }} />
        {stored.length > 0 && <button style={S.ghost} onClick={() => copyList(a)}>Copy unbooked list</button>}
        {stored.length > 0 && a.unbooked.length > 0 && <button style={S.gold} disabled={busy === "remind"} onClick={() => remind(a)}>{busy === "remind" ? "Sending…" : `✉ Remind ${a.unbooked.filter(p => emailsOf(p).length).length} unbooked families`}</button>}
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color: C.gold }}>{sel.name}</div>
      <div style={{ fontSize: 12, color: C.mut, marginBottom: 12 }}>{fmtRange(sel)} · {sel.location || ""} · {a.teams.join(", ")} · {a.pool.length} players{sel.housing_reminded_at ? " · last reminder " + new Date(sel.housing_reminded_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}</div>
      {note && <div style={{ ...S.card, borderColor: C.gold, fontSize: 13 }}>{note}</div>}

      <div style={S.card}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
          <div><div style={S.lbl}>Booking cut-off</div><input type="datetime-local" value={sel.housing_deadline ? new Date(new Date(sel.housing_deadline).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""} onChange={e => saveTn({ housing_deadline: e.target.value ? new Date(e.target.value).toISOString() : null })} style={{ ...S.input, width: "100%" }} /></div>
          <div style={{ gridColumn: "span 2" }}><div style={S.lbl}>Booking link (goes in the reminder)</div><input value={sel.housing_url || ""} onChange={e => saveTn({ housing_url: e.target.value || null })} placeholder="https://…" style={{ ...S.input, width: "100%" }} /></div>
        </div>
      </div>

      <div style={S.card}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
          <div style={{ ...S.lbl, marginBottom: 0 }}>Pickup report</div>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: C.mut }}>{reportAt ? `${stored.length} rooms · imported ${reportAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${reportAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : "nothing imported yet"}</span>
        </div>
        <div style={{ fontSize: 12, color: C.mut, marginBottom: 6 }}>Open the bureau's email, select everything from the table header to the last room, copy, paste here. Each import replaces the previous report.</div>
        <textarea value={paste} onChange={e => setPaste(e.target.value)} placeholder={"Event\nHotel\nLast Name\nFirst Name\n…\n1\nResorts World Red Rock Rave 1 2027\n…"} style={{ ...S.input, width: "100%", minHeight: 110, resize: "vertical", boxSizing: "border-box", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <span style={{ fontSize: 12, color: C.mut }}>{paste.trim() ? `${parsePickupReport(paste).length} rooms found` : ""}</span>
          <div style={{ flex: 1 }} />
          <button style={S.gold} disabled={busy === "import" || !paste.trim()} onClick={importReport}>{busy === "import" ? "Importing…" : "Import report"}</button>
        </div>
      </div>

      {stored.length > 0 && (<>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          {[["Rooms", stored.length, C.gold], ["Players booked", a.pool.length - a.unbooked.length, C.grn], ["Not booked", a.unbooked.length, a.unbooked.length ? C.amber : C.mut], ["Staff rooms", staff.length, C.mut], ["Unmatched rooms", unmatched.length, unmatched.length ? C.red : C.mut]].map(([l, v, col]) => (
            <div key={l} style={{ border: "1px solid " + C.border, borderLeft: "3px solid " + col, borderRadius: 8, padding: "8px 14px", minWidth: 110, background: C.card }}>
              <div style={{ fontSize: 19, fontWeight: 800, color: col, lineHeight: 1.15 }}>{v}</div><div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: C.mut }}>{l}</div>
            </div>
          ))}
        </div>

        {unmatched.length > 0 && (
          <div style={{ ...S.card, borderColor: C.red }}>
            <div style={{ ...S.lbl, color: C.red }}>Rooms I couldn't match — pick who they belong to</div>
            {unmatched.map(b => (
              <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "6px 0", borderBottom: "1px solid " + C.border, fontSize: 13 }}>
                <span style={{ minWidth: 200 }}><b>{b.first_name} {b.last_name}</b> <span style={{ color: C.mut }}>· {b.team_raw || "?"} · {b.email || ""}{b.share_with ? " · shares: " + b.share_with : ""}</span></span>
                <select value="" onChange={e => setManual(b, e.target.value)} style={{ ...S.input, minWidth: 220 }}>
                  <option value="">— assign to a player —</option>
                  {b.candidates.length > 0 && <optgroup label="Likely">{b.candidates.map(c => <option key={c.id} value={c.id}>{c.name} · {c.team}</option>)}</optgroup>}
                  <optgroup label="Everyone on the trip">{a.pool.slice().sort((x, y) => (x.last_name || "").localeCompare(y.last_name || "")).map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name} · {p.team_assignment}</option>)}</optgroup>
                </select>
              </div>
            ))}
          </div>
        )}

        {a.teams.map(t => {
          const u = a.unbooked.filter(p => p.team_assignment === t);
          const booked = a.bookings.filter(b => b.matched_team === t);
          const total = a.pool.filter(p => p.team_assignment === t).length;
          return (
            <div key={t} style={{ ...S.card, borderColor: u.length ? C.amber : C.border }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 800 }}>{t}</div>
                <span style={{ fontSize: 12, color: C.grn, fontWeight: 700 }}>{total - u.length}/{total} booked</span>
                {u.length > 0 && <span style={{ fontSize: 12, color: C.amber, fontWeight: 800 }}>{u.length} not booked</span>}
              </div>
              {u.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
                  {u.map(p => (
                    <div key={p.id} style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 13, padding: "5px 8px", borderRadius: 6, background: "rgba(245,158,11,0.07)" }}>
                      <span style={{ fontWeight: 700, minWidth: 160 }}>{p.first_name} {p.last_name}</span>
                      <span style={{ color: C.mut }}>{parentsOf(p).join(" & ") || "—"}</span>
                      <span style={{ color: C.mut }}>{emailsOf(p).join(", ") || <span style={{ color: C.red }}>no email</span>}</span>
                      <span style={{ color: C.mut }}>{p.parent_phone || ""}</span>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={() => setShowBooked(v => !v)} style={{ background: "none", border: "none", color: C.mut, fontSize: 11, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>{showBooked ? "Hide" : "Show"} {booked.length} booked</button>
              {showBooked && booked.map(b => { const p = byId(b.matched_player_id); return (
                <div key={b.id} style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, color: C.mut, padding: "3px 8px" }}>
                  <span style={{ color: C.text, fontWeight: 600, minWidth: 160 }}>{p ? p.first_name + " " + p.last_name : "?"}</span>
                  <span>{b.first_name} {b.last_name} · {b.hotel || ""} · {b.check_in?.slice(5)}→{b.check_out?.slice(5)} ({b.nights}n) · {b.ack_number}</span>
                  <span style={{ fontSize: 10 }}>{b.match_how}</span>
                </div>); })}
            </div>
          );
        })}

        {staff.length > 0 && (
          <div style={S.card}>
            <div style={S.lbl}>Staff rooms ({staff.length})</div>
            {staff.map(b => <div key={b.id} style={{ fontSize: 12, color: C.mut, padding: "2px 0" }}><span style={{ color: C.text, fontWeight: 600 }}>{b.first_name} {b.last_name}</span>{b.share_with ? " · with " + b.share_with.replace(/,\s*\d{2}\/\d{2}-\d{2}\/\d{2}/g, "") : ""} · {b.hotel || ""} · {b.check_in?.slice(5)}→{b.check_out?.slice(5)} · {b.ack_number}</div>)}
          </div>
        )}
      </>)}
    </div>
  );
}
