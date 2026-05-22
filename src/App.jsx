import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "./supabase";
import Papa from "papaparse";
import { DndContext, useDraggable, useDroppable, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";

const POSITIONS = ["S","OH","MB","RS","L","DS","U"];
const POS_LABELS = {S:"Setter",OH:"Outside Hitter",MB:"Middle Blocker",RS:"Right Side",L:"Libero",DS:"Def Specialist",U:"Utility"};
const SKILLS = ["Serving","Passing","Serve Receive","Attacking","Setting","Blocking","Agility","Communication","Coachability"];
// Short labels for the Evaluate-table column headers (full name shown on hover).
// Lets us fit all 9 skill columns on a single screen without horizontal scrolling.
const SKILL_ABBR = {Serving:"SRV",Passing:"PASS","Serve Receive":"S/R",Attacking:"ATK",Setting:"SET",Blocking:"BLK",Agility:"AGI",Communication:"COM",Coachability:"COACH"};
const PROJ_OPTS = ["","1","1/2","2","2/3","3"];
const ROSTER_POS = ["S1","S2","Pin1","Pin2","Pin3","Pin4","M1","M2","M3","L","DS1","DS2","U1","U2"];
const ROSTER_GROUPS = [{label:"Setters",pos:["S1","S2"]},{label:"Pins",pos:["Pin1","Pin2","Pin3","Pin4"]},{label:"Middles",pos:["M1","M2","M3"]},{label:"Libero/DS",pos:["L","DS1","DS2"]},{label:"Utility",pos:["U1","U2"]}];
const DIVS = ["U10","U11","U12","U13","U14","U15","U16"];
const CLINIC_DIVS = ["U14","U15","U16"];
const TM = {U10:["11-1","11-2","11-3"],U11:["11-1","11-2","11-3"],U12:["12-1","12-2","12-3"],U13:["13-1","13-2","13-3","13-4"],U14:["14-1","14-2","14-3","14-4"],U15:["15-1","15-2","15-3"],U16:["16 Diamond","16-1","16-2"]};
const EVAL_DATES = ["5/13","5/14","5/20","5/21","5/27","5/28","6/3","6/4","6/9","6/10"];
const STATUS_OPTS = ["In Progress","Offered","Accepted","Declined","No Offer"];
const STATUS_COLORS = {"In Progress":"#999999","Offered":"#e91e8c","Accepted":"#22c55e","Declined":"#ef4444","No Offer":"#666666"};
const C = {bg:"#0a0a0a",card:"#141414",border:"#2a2a2a",gold:"#e91e8c",text:"#ffffff",mut:"#999999",acc:"#ff69b4",red:"#ef4444",grn:"#22c55e"};

function calcUSAV(dob) {
  if (!dob) return 12;
  const parts = dob.split("-");
  const y = parseInt(parts[0]); const m = parseInt(parts[1]);
  return 2026 - (m >= 7 ? y : y - 1);
}
function tot(p) { const v = Object.values(p.scores||{}); return v.length?v.reduce((a,b)=>a+b,0):0; }
function avg(p) { const v = Object.values(p.scores||{}); return v.length?(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1):"—"; }
// A player counts as a returning DS Elite athlete if her Prev Season Team field
// names DSE / DS Elite. Coaches can correct false positives/negatives by editing
// the "Prev Season Team" value in the profile modal.
function isReturningDSE(p) {
  const t = (p.current_team || "").toUpperCase();
  return t.includes("DSE") || t.includes("DS ELITE");
}
// Highlights players added to the DB in the last 3 days — surfaces fresh CSV uploads.
const NEW_PLAYER_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
function isNewPlayer(p) {
  if (!p.created_at) return false;
  const t = new Date(p.created_at).getTime();
  return Number.isFinite(t) && (Date.now() - t) < NEW_PLAYER_WINDOW_MS;
}

const inpStyle = {background:"#1a1a1a",border:"1px solid "+C.border,borderRadius:6,color:C.text,fontFamily:"inherit",outline:"none"};

function Tag({c,children}) { return <span style={{display:"inline-block",padding:"2px 7px",borderRadius:10,fontSize:10,fontWeight:600,background:c+"22",color:c}}>{children}</span>; }

// DnD wrappers — module-level so they aren't recreated on every App render (which would wipe input state).
// PointerSensor distance + TouchSensor delay let taps still register as clicks (open profile, focus rank input).
function DraggablePlayer({ player, children, style }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: "player-" + player.id });
  return <div ref={setNodeRef} {...listeners} {...attributes}
    style={{ ...(style||{}), opacity: isDragging ? 0.3 : 1, touchAction: "manipulation" }}>{children}</div>;
}
function DropZone({ id, children, style }) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return <div ref={setNodeRef}
    style={{ ...style, outline: isOver ? "2px solid " + C.gold : "2px solid transparent", outlineOffset: -2, transition: "outline-color 0.1s" }}>{children}</div>;
}
function RankInput({ value, max, onCommit }) {
  const [v, setV] = useState(value == null ? "" : String(value));
  useEffect(() => { setV(value == null ? "" : String(value)); }, [value]);
  const commit = () => {
    const n = parseInt(v);
    if (!isNaN(n) && n >= 1 && n !== value) onCommit(n);
    else setV(value == null ? "" : String(value));
  };
  return <input type="number" inputMode="numeric" min={1} max={max} value={v}
    onChange={e => setV(e.target.value)}
    onBlur={commit}
    onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
    onPointerDown={e => e.stopPropagation()}
    onClick={e => e.stopPropagation()}
    title="Rank within position (1 = top). Persists across team assignment changes."
    style={{ ...inpStyle, width: 40, fontSize: 11, padding: "3px 4px", textAlign: "center", fontWeight: 700, color: C.gold }} />;
}

export default function App() {
  const [authed, setAuthed] = useState(!import.meta.env.VITE_APP_PASSWORD);
  const [pw, setPw] = useState("");
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("dashboard");
  // Selected age-group tabs. Multi-select: clicking a tab toggles membership.
  // Always at least one division is selected. Drives Evaluate filter, Teams sections, and Rankings.
  const [selectedDivs, setSelectedDivs] = useState(["U14"]);
  const [search, setSearch] = useState("");
  const [filterPos, setFilterPos] = useState("");
  const [filterProj, setFilterProj] = useState("");
  const [filterEval, setFilterEval] = useState("all");
  const [filterDate, setFilterDate] = useState("");
  const [filterClinic, setFilterClinic] = useState("all");
  // "Registered since" date filter (YYYY-MM-DD) — drives the email-the-new-batch workflow.
  const [regSince, setRegSince] = useState("");
  const [copiedEmails, setCopiedEmails] = useState(false);
  const [sortBy, setSortBy] = useState("name");
  // Rankings view column sort: key matches a column id in renderRankings' COLS table.
  const [rankSort, setRankSort] = useState({ key: "total", dir: "desc" });
  // Rankings view date filter — independent from the Evaluate-tab date filter so
  // switching views doesn't carry the selection over.
  const [rankDate, setRankDate] = useState("");
  const [profileId, setProfileId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [addingPlayer, setAddingPlayer] = useState(false);
  const [newPlayer, setNewPlayer] = useState({ first_name:"", last_name:"", dob:"", age:"", usav_div:"", positions:[], parent_name:"", parent_email:"", parent_phone:"" });
  const [addMsg, setAddMsg] = useState("");
  // DnD sensors at App level (hook order must be stable across renders, can't live in renderTeams).
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 200, tolerance: 5 } }),
  );
  // Manual position rankings, scoped by division+position. Synced across all coaches via Supabase.
  // Shape: { [division]: { [position]: [playerId, ...] } }
  // Semantics: the list is the ordered ranking of ALL players in (division, position),
  // regardless of team assignment. Persists across team changes.
  const [unassignedRanks, setUnassignedRanks] = useState({});

  const loadRankings = useCallback(async () => {
    const { data, error } = await supabase.from("unassigned_rankings").select("*");
    if (error) { console.error("Load rankings error:", error); return; }
    const ranks = {};
    (data || []).forEach(r => {
      if (!ranks[r.division]) ranks[r.division] = {};
      ranks[r.division][r.position] = r.player_ids || [];
    });
    setUnassignedRanks(ranks);
  }, []);

  // Persist a ranking change. Pass playerIds=null to reset (delete the row).
  const persistRanking = useCallback(async (division, position, playerIds) => {
    // Optimistic local update
    setUnassignedRanks(prev => {
      const next = { ...prev, [division]: { ...(prev[division] || {}) } };
      if (playerIds === null) delete next[division][position];
      else next[division][position] = playerIds;
      return next;
    });
    if (playerIds === null) {
      const { error } = await supabase.from("unassigned_rankings").delete().match({ division, position });
      if (error) console.error("Reset ranking error:", error);
    } else {
      const { error } = await supabase.from("unassigned_rankings").upsert(
        { division, position, player_ids: playerIds, updated_at: new Date().toISOString() },
        { onConflict: "division,position" }
      );
      if (error) console.error("Save ranking error:", error);
    }
  }, []);

  // Load all players from Supabase
  const loadPlayers = useCallback(async () => {
    const { data, error } = await supabase.from("players").select("*").order("last_name");
    if (error) { console.error(error); return; }
    setPlayers(data.map(p => ({
      ...p,
      scores: p.scores || {},
      positions: p.positions || [],
      eval_dates: p.eval_dates || [],
      usavDiv: p.usav_div || "U" + calcUSAV(p.dob),
    })));
    setLoading(false);
  }, []);

  useEffect(() => { if (authed) { loadPlayers(); loadRankings(); } }, [authed, loadPlayers, loadRankings]);

  // Save a single player field update to Supabase
  const upd = useCallback(async (id, updates) => {
    // Optimistic update
    setPlayers(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
    setSaving(true);
    const dbUpdates = {};
    for (const [k, v] of Object.entries(updates)) {
      if (k === "usavDiv") continue;
      dbUpdates[k] = v;
    }
    const { error } = await supabase.from("players").update(dbUpdates).eq("id", id);
    if (error) console.error("Save error:", error);
    setSaving(false);
  }, []);

  // CSV Upload handler
  const handleCSVUpload = useCallback(async (file) => {
    setUploading(true); setUploadMsg("Parsing CSV...");
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: async (results) => {
        const rows = results.data;
        // Find the header row (starts with "First Name")
        let headerIdx = -1;
        for (let i = 0; i < Math.min(rows.length, 10); i++) {
          if (rows[i][0] === "First Name") { headerIdx = i; break; }
        }
        if (headerIdx === -1) { setUploadMsg("Could not find header row. Make sure CSV has 'First Name' column."); setUploading(false); return; }

        const headers = rows[headerIdx];
        const newPlayers = [];

        for (let i = headerIdx + 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row[0] || !row[0].trim()) continue;

          const get = (partial) => {
            const idx = headers.findIndex(h => h && h.toLowerCase().includes(partial));
            return idx >= 0 ? (row[idx] || "").trim() : "";
          };

          const fn = get("first name");
          const ln = get("last name");
          const dob = get("dob");
          const usav = calcUSAV(dob);

          // Determine reg group from the CSV metadata or filename
          let regGroup = "";
          for (let j = 0; j < headerIdx; j++) {
            const line = rows[j].join(" ").toLowerCase();
            if (line.includes("u11") || line.includes("u12")) { regGroup = "U11/U12"; break; }
            if (line.includes("u13") || line.includes("u14")) { regGroup = "U13/U14"; break; }
            if (line.includes("u15") || line.includes("u16")) { regGroup = "U15/U16"; break; }
          }

          const minLevel = get("minimum level");
          const cleanMin = ["no","n/a","na",""].includes(minLevel.toLowerCase()) ? "" : minLevel;
          const leaving = get("leaving another");
          const cleanLeaving = ["n/a","na","not leaving",""].includes(leaving.toLowerCase()) ? "" : leaving;
          const supp = get("supplemental").toLowerCase() === "yes" ? 1 : 0;

          newPlayers.push({
            first_name: fn,
            last_name: ln,
            age: get("age"),
            dob: dob,
            reg_group: regGroup,
            usav_div: "U" + usav,
            reg_position: get("how long have you been playing"),
            min_level: cleanMin,
            parent_name: get("managed by"),
            parent_email: get("mgr email"),
            parent_phone: get("mgr phone"),
            city: get("city"),
            strength_weakness: get("biggest strength"),
            goal: get("volleyball goals"),
            starter_pref: get("starter on a lower"),
            ideal_coach: get("ideal coach"),
            leaving_reason: cleanLeaving,
            supplemental: supp,
          });
        }

        if (newPlayers.length === 0) {
          setUploadMsg("No players found in CSV."); setUploading(false); return;
        }

        // Dedup against existing players by first+last name (case-insensitive, trimmed)
        // — same key as the manual Add Player flow. Re-uploading the UpperHand export
        // is expected; skip rows that already exist so we don't duplicate everyone.
        const existingKeys = new Set(
          players.map(p => ((p.first_name||"").trim().toLowerCase() + "|" + (p.last_name||"").trim().toLowerCase()))
        );
        const toInsert = [];
        const skipped = [];
        for (const np of newPlayers) {
          const key = (np.first_name||"").trim().toLowerCase() + "|" + (np.last_name||"").trim().toLowerCase();
          if (existingKeys.has(key)) { skipped.push(np); continue; }
          existingKeys.add(key); // also dedup within the CSV itself
          toInsert.push(np);
        }

        if (toInsert.length === 0) {
          setUploadMsg("Nothing new — all " + newPlayers.length + " rows already in DB.");
          setUploading(false);
          return;
        }

        setUploadMsg("Uploading " + toInsert.length + " new players...");
        const { error } = await supabase.from("players").insert(toInsert);
        if (error) {
          setUploadMsg("Error: " + error.message); setUploading(false); return;
        }
        const msg = "Added " + toInsert.length + " new player" + (toInsert.length===1?"":"s")
          + (skipped.length ? ", skipped " + skipped.length + " already in DB." : ".");
        setUploadMsg(msg);
        await loadPlayers();
        setUploading(false);
      },
      error: (err) => { setUploadMsg("Parse error: " + err.message); setUploading(false); }
    });
  }, [loadPlayers, players]);

  // Opens the Add Player modal, pre-filling division to the first selected age tab.
  const openAddPlayer = useCallback(() => {
    setNewPlayer({ first_name:"", last_name:"", dob:"", age:"", usav_div: selectedDivs[0] || "U14", positions:[], parent_name:"", parent_email:"", parent_phone:"" });
    setAddMsg("");
    setAddingPlayer(true);
  }, [selectedDivs]);

  // Manual one-off player add. Dedup-warns on first+last name match (case-insensitive, trimmed)
  // — same key we'll use later when merging tryout-registration CSV rows into existing players.
  const handleAddPlayer = useCallback(async () => {
    const fn = (newPlayer.first_name||"").trim();
    const ln = (newPlayer.last_name||"").trim();
    if (!fn || !ln) { setAddMsg("First and last name are required."); return; }
    const dup = players.find(p =>
      (p.first_name||"").toLowerCase().trim() === fn.toLowerCase() &&
      (p.last_name ||"").toLowerCase().trim() === ln.toLowerCase()
    );
    if (dup) {
      const where = dup.usavDiv || dup.usav_div || "unknown division";
      if (!window.confirm("A player named " + fn + " " + ln + " already exists (" + where + "). Add another row anyway?")) return;
    }
    setAddMsg("Saving...");
    const usav = newPlayer.usav_div || "U" + calcUSAV(newPlayer.dob);
    const insert = {
      first_name: fn,
      last_name: ln,
      dob: newPlayer.dob || null,
      age: newPlayer.age || "",
      usav_div: usav,
      positions: newPlayer.positions || [],
      parent_name: newPlayer.parent_name || "",
      parent_email: newPlayer.parent_email || "",
      parent_phone: newPlayer.parent_phone || "",
    };
    const { error } = await supabase.from("players").insert(insert);
    if (error) { setAddMsg("Error: " + error.message); return; }
    await loadPlayers();
    setAddingPlayer(false);
    setNewPlayer({ first_name:"", last_name:"", dob:"", age:"", usav_div:"", positions:[], parent_name:"", parent_email:"", parent_phone:"" });
    setAddMsg("");
  }, [newPlayer, players, loadPlayers]);

  // Export to CSV
  const exportCSV = useCallback(() => {
    const headers = ["Name","Age","DOB","USAV Div","Reg Group","Positions","Projected","Team","Roster Pos","Current Team","Eval Complete",...SKILLS,"Total","Avg","Notes"];
    const csvRows = [headers.join(",")];
    players.forEach(p => {
      const row = [
        '"' + p.first_name + " " + p.last_name + '"',
        p.age, p.dob, p.usavDiv, p.reg_group,
        '"' + (p.positions||[]).join("/") + '"',
        p.projected_team, p.team_assignment, p.roster_pos, '"' + (p.current_team||"") + '"',
        p.eval_complete ? "Yes" : "No",
        ...SKILLS.map(s => (p.scores||{})[s] || ""),
        tot(p) || "", avg(p),
        '"' + (p.notes||"").replace(/"/g, '""') + '"'
      ];
      csvRows.push(row.join(","));
    });
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "dselite-evals-export.csv"; a.click();
    URL.revokeObjectURL(url);
  }, [players]);

  // Players across all currently-selected age groups (drives Evaluate filter + Rankings combined view).
  const divP = useMemo(() => {
    const divSet = new Set(selectedDivs);
    return players.filter(p => divSet.has(p.usavDiv || p.usav_div));
  }, [players, selectedDivs]);

  const filtered = useMemo(() => {
    let l = [...divP];
    if (search) { const s = search.toLowerCase(); l = l.filter(p => (p.first_name + " " + p.last_name).toLowerCase().includes(s)); }
    if (filterPos) l = l.filter(p => (p.positions||[]).includes(filterPos));
    if (filterProj) l = l.filter(p => p.projected_team === filterProj);
    if (filterDate) l = l.filter(p => (p.eval_dates||[]).includes(filterDate));
    if (filterEval === "done") l = l.filter(p => p.eval_complete);
    if (filterEval === "pending") l = l.filter(p => !p.eval_complete);
    if (filterClinic === "invited") l = l.filter(p => p.id_clinic_invited);
    else if (filterClinic === "attended") l = l.filter(p => p.id_clinic_attended);
    else if (filterClinic === "invited_no_show") l = l.filter(p => p.id_clinic_invited && !p.id_clinic_attended);
    if (regSince) l = l.filter(p => p.created_at && p.created_at >= regSince);
    if (sortBy === "name") l.sort((a,b) => (a.last_name||"").localeCompare(b.last_name||""));
    else if (sortBy === "score") l.sort((a,b) => tot(b) - tot(a));
    else if (sortBy === "age") l.sort((a,b) => parseInt(b.age||0) - parseInt(a.age||0));
    else if (sortBy === "proj") { const o = {"1":0,"1/2":1,"2":2,"2/3":3,"3":4,"":5}; l.sort((a,b) => (o[a.projected_team]||5) - (o[b.projected_team]||5)); }
    return l;
  }, [divP, search, filterPos, filterProj, filterEval, filterDate, filterClinic, regSince, sortBy]);

  // ─── PASSWORD GATE ───
  if (!authed) {
    return (
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:C.bg}}>
        <div style={{background:C.card,padding:40,borderRadius:16,border:"1px solid "+C.border,textAlign:"center",maxWidth:360}}>
          <div style={{fontSize:28,fontWeight:800,color:C.gold,marginBottom:4}}>◆ DS ELITE</div>
          <div style={{fontSize:13,color:C.mut,marginBottom:24}}>Tryout Evaluations 2026-27</div>
          <input type="password" placeholder="Enter access code" value={pw} onChange={e => setPw(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && pw === import.meta.env.VITE_APP_PASSWORD) setAuthed(true); }}
            style={{...inpStyle,width:"100%",padding:"12px 16px",fontSize:15,marginBottom:12,textAlign:"center"}} />
          <button onClick={() => { if (pw === import.meta.env.VITE_APP_PASSWORD) setAuthed(true); }}
            style={{width:"100%",padding:"12px",borderRadius:8,border:"none",background:C.gold,color:"#000",fontFamily:"inherit",fontSize:14,fontWeight:700,cursor:"pointer"}}>
            Enter
          </button>
        </div>
      </div>
    );
  }

  if (loading) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:C.bg,color:C.text}}>Loading DS Elite...</div>;

  const divsWithPlayers = DIVS.filter(d => players.some(p => (p.usavDiv||p.usav_div) === d));

  function ScoreB({player, skill}) {
    const cur = (player.scores && player.scores[skill]) || 0;
    return <div style={{display:"flex",gap:1}}>{[1,2,3,4,5].map(v => {
      const active = cur === v;
      return <button key={v} style={{width:22,height:22,borderRadius:4,padding:0,border:active?"2px solid "+C.gold:"1px solid "+C.border,cursor:"pointer",fontFamily:"inherit",fontSize:10,fontWeight:700,
        background:active?(v>=4?"rgba(34,197,94,0.2)":v>=3?"rgba(233,30,140,0.2)":"rgba(239,68,68,0.15)"):"transparent",
        color:active?(v>=4?C.grn:v>=3?C.gold:C.red):C.mut}} onClick={() => upd(player.id, {scores:{...player.scores,[skill]:cur===v?0:v}})}>{v}</button>;
    })}</div>;
  }

  function PosChips({player}) {
    return <div style={{display:"flex",gap:2,flexWrap:"wrap"}}>{POSITIONS.map(pos => {
      const active = (player.positions||[]).includes(pos);
      return <button key={pos} title={POS_LABELS[pos]} style={{padding:"2px 5px",borderRadius:4,fontSize:9,fontWeight:700,cursor:"pointer",
        border:active?"1.5px solid "+C.gold:"1px solid "+C.border,background:active?"rgba(233,30,140,0.15)":"transparent",color:active?C.gold:C.mut}}
        onClick={() => { const next = active ? (player.positions||[]).filter(p=>p!==pos) : [...(player.positions||[]),pos]; upd(player.id, {positions:next}); }}>{pos}</button>;
    })}</div>;
  }

  // ─── DASHBOARD ───
  function renderDashboard() {
    const evald = players.filter(p => p.eval_complete).length;
    const assigned = players.filter(p => p.team_assignment).length;
    // Group players by the date portion of created_at — surfaces when each
    // CSV/manual batch was added. Limit to last 21 days so this stays useful.
    const cutoffMs = Date.now() - 21 * 24 * 60 * 60 * 1000;
    const byUploadDate = {};
    players.forEach(p => {
      if (!p.created_at) return;
      const t = new Date(p.created_at).getTime();
      if (!Number.isFinite(t) || t < cutoffMs) return;
      const key = new Date(p.created_at).toISOString().slice(0, 10); // YYYY-MM-DD
      if (!byUploadDate[key]) byUploadDate[key] = [];
      byUploadDate[key].push(p);
    });
    const uploadDays = Object.keys(byUploadDate).sort().reverse();
    return (
      <div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:12,marginBottom:18}}>
          {[["Total Athletes",players.length,C.gold],["Evaluated",evald,C.grn],["Assigned",assigned,C.acc],["Offered",players.filter(p=>p.status==="Offered").length,"#e91e8c"],["Accepted",players.filter(p=>p.status==="Accepted").length,"#22c55e"]].map(([l,v,c]) =>
            <div key={l} style={{background:C.card,borderRadius:12,padding:"16px 18px",border:"1px solid "+C.border}}>
              <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut,marginBottom:5}}>{l}</div>
              <div style={{fontSize:30,fontWeight:800,color:c}}>{v}</div>
            </div>
          )}
        </div>
        {/* Upload Section */}
        <div style={{background:C.card,borderRadius:12,padding:"18px 20px",border:"1px solid "+C.border,marginBottom:18}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:C.gold,marginBottom:4}}>Upload New Registrations</div>
              <div style={{fontSize:12,color:C.mut}}>Upload a CSV export from UpperHand to add new players</div>
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
              <button onClick={openAddPlayer} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+C.gold,background:"transparent",color:C.gold,fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                + Add Player
              </button>
              <label style={{padding:"8px 16px",borderRadius:8,background:C.gold,color:"#000",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                {uploading ? "Uploading..." : "Upload CSV"}
                <input type="file" accept=".csv" style={{display:"none"}} onChange={e => { if (e.target.files[0]) handleCSVUpload(e.target.files[0]); }} disabled={uploading} />
              </label>
              <button onClick={exportCSV} style={{padding:"8px 16px",borderRadius:8,border:"1px solid "+C.gold,background:"transparent",color:C.gold,fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                Export CSV
              </button>
            </div>
          </div>
          {uploadMsg && <div style={{marginTop:8,fontSize:12,color:uploadMsg.includes("Error")? C.red : C.grn}}>{uploadMsg}</div>}
        </div>
        {/* Recent Registrations — grouped by created_at date, last 21 days */}
        {uploadDays.length > 0 && (
          <div style={{background:C.card,borderRadius:12,padding:"18px 20px",border:"1px solid "+C.border,marginBottom:18}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:10,flexWrap:"wrap",gap:8}}>
              <div>
                <div style={{fontSize:14,fontWeight:700,color:C.gold}}>Recent Registrations</div>
                <div style={{fontSize:12,color:C.mut}}>Players added in the last 21 days, grouped by upload date.</div>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {uploadDays.map(day => {
                const group = byUploadDate[day];
                const emails = [...new Set(group.map(p => (p.parent_email||"").trim()).filter(Boolean))];
                const pretty = new Date(day + "T00:00:00").toLocaleDateString(undefined, {weekday:"short", month:"short", day:"numeric"});
                return (
                  <div key={day} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:"8px 12px",background:C.bg,borderRadius:8,border:"1px solid "+C.border,flexWrap:"wrap"}}>
                    <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                      <span style={{fontSize:13,fontWeight:700,color:C.gold,minWidth:120}}>{pretty}</span>
                      <Tag c={C.acc}>{group.length} player{group.length===1?"":"s"}</Tag>
                      <span style={{fontSize:11,color:C.mut}}>{emails.length} parent email{emails.length===1?"":"s"}</span>
                    </div>
                    <div style={{display:"flex",gap:6,alignItems:"center"}}>
                      <button onClick={() => { setRegSince(day); setView("evaluate"); }}
                        title="Filter the Evaluate view to players registered on or after this date"
                        style={{padding:"6px 10px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.text,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                        View
                      </button>
                      <button onClick={() => {
                        if (!emails.length) { window.alert("No parent emails found for this date."); return; }
                        navigator.clipboard.writeText(emails.join(", ")).then(()=>{ setCopiedEmails(true); setTimeout(()=>setCopiedEmails(false), 2000); });
                      }} disabled={!emails.length}
                        style={{padding:"6px 10px",borderRadius:6,border:"1px solid "+(emails.length?C.gold:C.border),background:"transparent",color:emails.length?C.gold:C.mut,fontSize:11,fontWeight:700,cursor:emails.length?"pointer":"default",fontFamily:"inherit"}}>
                        Copy emails
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {copiedEmails && <div style={{marginTop:8,fontSize:11,color:C.grn}}>Copied to clipboard.</div>}
          </div>
        )}
        {/* Age Group Cards */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12}}>
          {divsWithPlayers.map(d => {
            const g = players.filter(p => (p.usavDiv||p.usav_div) === d);
            const ev = g.filter(p => p.eval_complete).length;
            const pct = g.length ? Math.round(ev/g.length*100) : 0;
            return <div key={d} style={{background:C.card,borderRadius:12,padding:"16px 18px",border:"1px solid "+C.border,cursor:"pointer"}} onClick={() => {setSelectedDivs([d]);setView("evaluate");}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <span style={{fontSize:18,fontWeight:800,color:C.gold}}>{d}</span>
                <Tag c={C.gold}>{g.length}</Tag>
              </div>
              <div style={{background:C.bg,borderRadius:5,height:7,marginBottom:7,overflow:"hidden"}}>
                <div style={{height:"100%",width:pct+"%",background:"linear-gradient(90deg,"+C.gold+","+C.acc+")",borderRadius:5}} />
              </div>
              <div style={{fontSize:11,color:C.mut}}>{pct}% evaluated</div>
            </div>;
          })}
        </div>
      </div>
    );
  }

  // ─── EVALUATE TABLE ───
  function renderEval() {
    const tdS = {padding:"5px 4px",fontSize:12,borderBottom:"1px solid "+C.border,verticalAlign:"middle"};
    return (
      <div>
        <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
          <input style={{...inpStyle,padding:"7px 12px",fontSize:13,width:180}} placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)} />
          <select style={{...inpStyle,padding:"7px 10px",fontSize:12}} value={filterPos} onChange={e=>setFilterPos(e.target.value)}>
            <option value="">All Pos</option>{POSITIONS.map(p=><option key={p} value={p}>{p}</option>)}
          </select>
          <select style={{...inpStyle,padding:"7px 10px",fontSize:12}} value={filterProj} onChange={e=>setFilterProj(e.target.value)}>
            <option value="">All Proj</option>{PROJ_OPTS.filter(Boolean).map(o=><option key={o} value={o}>Team {o}</option>)}
          </select>
          <select style={{...inpStyle,padding:"7px 10px",fontSize:12,color:filterDate?C.gold:C.text}} value={filterDate} onChange={e=>setFilterDate(e.target.value)} title="Show only players attending this eval date">
            <option value="">All Dates</option>{EVAL_DATES.map(d=><option key={d} value={d}>{d}</option>)}
          </select>
          <select style={{...inpStyle,padding:"7px 10px",fontSize:12}} value={sortBy} onChange={e=>setSortBy(e.target.value)}>
            <option value="name">Name</option><option value="score">Score</option><option value="proj">Projected</option>
          </select>
          {selectedDivs.some(d => CLINIC_DIVS.includes(d)) && (
            <select style={{...inpStyle,padding:"7px 10px",fontSize:12,color:filterClinic!=="all"?C.gold:C.text}} value={filterClinic} onChange={e=>setFilterClinic(e.target.value)} title="National Team ID Clinic filter">
              <option value="all">All Clinic</option>
              <option value="invited">Invited</option>
              <option value="attended">Attended</option>
              <option value="invited_no_show">Invited, no-show</option>
            </select>
          )}
          <span style={{fontSize:11,color:C.mut,marginLeft:8}}>Registered since:</span>
          <input type="date" style={{...inpStyle,padding:"6px 10px",fontSize:12,color:regSince?C.gold:C.text,colorScheme:"dark"}} value={regSince} onChange={e=>setRegSince(e.target.value)} title="Show only players whose created_at is on or after this date" />
          {regSince && <button onClick={()=>setRegSince("")} title="Clear date filter" style={{padding:"6px 8px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>×</button>}
          <button onClick={() => {
            const emails = filtered.map(p => (p.parent_email||"").trim()).filter(Boolean);
            const uniq = [...new Set(emails)];
            if (!uniq.length) { window.alert("No parent emails found for the current filter."); return; }
            navigator.clipboard.writeText(uniq.join(", ")).then(()=>{ setCopiedEmails(true); setTimeout(()=>setCopiedEmails(false), 2000); });
          }} title="Copy parent emails of currently visible players to clipboard, comma-separated" style={{padding:"6px 10px",borderRadius:6,border:"1px solid "+C.gold,background:"transparent",color:C.gold,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
            {copiedEmails ? "Copied ✓" : "Copy emails"}
          </button>
          <span style={{fontSize:11,color:C.mut,marginLeft:"auto"}}>{saving?"Saving...":filtered.length+" players"}</span>
        </div>
        <div style={{background:C.card,borderRadius:12,border:"1px solid "+C.border,overflow:"hidden"}}>
          <div style={{overflow:"auto",maxHeight:"calc(100vh - 200px)"}}>
            <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0}}>
              <thead><tr>
                {[
                  {label:"#"},{label:"Player"},{label:"Pos"},{label:"Proj"},
                  ...SKILLS.map(s => ({label: SKILL_ABBR[s] || s, full: s})),
                  {label:"Tot"},{label:"Avg"},{label:"Team"},{label:"Notes"},{label:"✓",full:"Evaluation complete"}
                ].map((h,i) =>
                  <th key={i} title={h.full||""} style={{padding:"6px 4px",textAlign:"left",fontSize:9,fontWeight:700,textTransform:"uppercase",color:C.mut,borderBottom:"1px solid "+C.border,background:C.card,position:"sticky",top:0,zIndex:2,whiteSpace:"nowrap",boxShadow:"0 1px 0 "+C.border}}>{h.label}</th>
                )}
              </tr></thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id}>
                    <td style={tdS}><input style={{...inpStyle,width:26,padding:"3px",textAlign:"center",fontSize:10}} value={p.tryout_number||""} placeholder="—" onChange={e=>upd(p.id,{tryout_number:e.target.value})} /></td>
                    <td style={tdS}>
                      <div style={{cursor:"pointer"}} onClick={()=>setProfileId(p.id)}>
                        <div style={{display:"flex",alignItems:"center",gap:5}}>
                          {isReturningDSE(p) && <span title="DS Elite returning athlete" style={{color:C.gold,fontSize:14,fontWeight:800,lineHeight:1}}>◆</span>}
                          <span style={{fontWeight:700,fontSize:12,color:C.gold}}>{p.first_name} {p.last_name}</span>
                        </div>
                        <div style={{fontSize:10,color:C.mut}}>Age {p.age} • {p.usavDiv||p.usav_div}</div>
                        {isNewPlayer(p) && <Tag c={C.grn}>NEW</Tag>}
                        {p.min_level && <Tag c={C.gold}>Min: {p.min_level}</Tag>}
                        {p.supplemental===1 && <Tag c={C.acc}>SUPP</Tag>}
                        {p.status && p.status !== "In Progress" && <Tag c={STATUS_COLORS[p.status]}>{p.status}</Tag>}
                        {p.id_clinic_invited && <Tag c={C.gold}>INV</Tag>}
                        {p.id_clinic_attended && <Tag c={C.grn}>ATT</Tag>}
                      </div>
                    </td>
                    <td style={tdS}><PosChips player={p} /></td>
                    <td style={tdS}><select style={{...inpStyle,width:40,fontSize:10,padding:"3px 1px"}} value={p.projected_team||""} onChange={e=>upd(p.id,{projected_team:e.target.value})}>{PROJ_OPTS.map(o=><option key={o} value={o}>{o||"—"}</option>)}</select></td>
                    {SKILLS.map(sk=><td key={sk} style={tdS}><ScoreB player={p} skill={sk} /></td>)}
                    <td style={tdS}><span style={{fontWeight:800,fontSize:14,color:tot(p)?C.gold:C.mut}}>{tot(p)||"—"}</span></td>
                    <td style={tdS}><span style={{fontWeight:600,fontSize:12}}>{avg(p)}</span></td>
                    <td style={tdS}>
                      <select style={{...inpStyle,fontSize:10,padding:"3px",width:74}} value={p.team_assignment||""} onChange={e=>upd(p.id,{team_assignment:e.target.value,roster_pos:""})}>
                        <option value="">{"—"}</option>{(TM[p.usavDiv||p.usav_div]||[]).map(t=><option key={t} value={t}>{t}</option>)}
                      </select>
                      {p.team_assignment && <select style={{...inpStyle,fontSize:9,padding:"2px",width:54,marginTop:2,display:"block"}} value={p.roster_pos||""} onChange={e=>upd(p.id,{roster_pos:e.target.value})}>
                        <option value="">Roster</option>
                        {ROSTER_POS.map(rp => { const taken = players.some(o=>o.id!==p.id&&o.team_assignment===p.team_assignment&&o.roster_pos===rp); return <option key={rp} value={rp} disabled={taken}>{rp}{taken?" ✓":""}</option>; })}
                      </select>}
                    </td>
                    <td style={tdS}><input style={{...inpStyle,width:90,fontSize:11,padding:"4px 6px"}} placeholder="Notes..." value={p.notes||""} onChange={e=>upd(p.id,{notes:e.target.value})} /></td>
                    <td style={tdS}><input type="checkbox" checked={!!p.eval_complete} onChange={e=>upd(p.id,{eval_complete:e.target.checked})} style={{width:16,height:16,cursor:"pointer",accentColor:C.gold}} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!filtered.length && <div style={{textAlign:"center",padding:28,color:C.mut}}>No players match</div>}
        </div>
      </div>
    );
  }

  // ─── TEAMS ───
  // Each selected age group renders as its own section with its own DndContext, so drags are
  // scoped per-division. Team names can repeat across divisions; per-context droppable IDs
  // keep that unambiguous.
  function renderTeams() {
    if (!selectedDivs.length) return null;
    return (
      <>
        <div style={{fontSize:11,color:C.mut,marginBottom:10,fontStyle:"italic"}}>
          Drag a player onto a team card to assign (clears their roster slot). Drag onto Unassigned to remove from a team.
          Type a rank number to reorder within a position — rank persists across team changes.
        </div>
        {selectedDivs.map(div => (
          <div key={div} style={{marginBottom:24}}>
            {selectedDivs.length > 1 && <h2 style={{margin:"0 0 10px 0",fontSize:15,fontWeight:800,color:C.gold,textTransform:"uppercase",letterSpacing:1,borderBottom:"1px solid "+C.border,paddingBottom:6}}>{div} — {players.filter(p=>(p.usavDiv||p.usav_div)===div).length} players</h2>}
            {renderTeamsSection(div)}
          </div>
        ))}
      </>
    );
  }

  function renderTeamsSection(div) {
    const teams = TM[div] || [];
    const divPlayers = players.filter(p => (p.usavDiv || p.usav_div) === div);
    const divRanks = unassignedRanks[div] || {};

    // Full ordered list of player IDs at (div, pos), assigned OR unassigned.
    // Stored manual order first, then any remaining players appended by total score desc.
    const fullPosOrder = (pos) => {
      const allInPos = divPlayers.filter(p => pos === "" ? (p.positions||[]).length === 0 : (p.positions||[]).includes(pos)).map(p => p.id);
      const inSet = new Set(allInPos);
      const stored = (divRanks[pos] || []).filter(id => inSet.has(id));
      const storedSet = new Set(stored);
      const unranked = allInPos.filter(id => !storedSet.has(id))
        .map(id => divPlayers.find(p => p.id === id))
        .sort((a,b) => tot(b) - tot(a))
        .map(p => p.id);
      return [...stored, ...unranked];
    };
    const posRankOf = (playerId, pos) => {
      const order = fullPosOrder(pos);
      const i = order.indexOf(playerId);
      return i >= 0 ? i + 1 : null;
    };
    const setPosRank = (playerId, pos, newRank) => {
      const order = fullPosOrder(pos).filter(id => id !== playerId);
      const clamped = Math.max(1, Math.min(newRank, order.length + 1));
      order.splice(clamped - 1, 0, playerId);
      persistRanking(div, pos, order);
    };
    const resetPos = (pos) => persistRanking(div, pos, null);

    const handleDragEnd = (event) => {
      const { active, over } = event;
      if (!over) return;
      const playerId = parseInt(String(active.id).replace("player-", ""));
      const overId = String(over.id);
      let newTeam = "";
      if (overId.startsWith("team-")) newTeam = overId.replace("team-", "");
      const player = players.find(p => p.id === playerId);
      if (!player || (player.team_assignment || "") === newTeam) return;
      upd(playerId, { team_assignment: newTeam, roster_pos: "" });
    };

    // Compact rank chips next to a player's name on team cards (one per position).
    const posRankTags = (player) => (player.positions || []).map(pos => {
      const r = posRankOf(player.id, pos);
      if (r == null) return null;
      return <span key={pos} title={POS_LABELS[pos]+" rank"}
        style={{fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:8,background:"rgba(233,30,140,0.18)",color:C.gold,whiteSpace:"nowrap"}}>{pos}#{r}</span>;
    });

    return (
      <DndContext sensors={dndSensors} onDragEnd={handleDragEnd}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))",gap:14}}>
          {teams.map(team => {
            const tp = divPlayers.filter(p => p.team_assignment === team);
            const rosterMap = {}; tp.forEach(p => { if (p.roster_pos) rosterMap[p.roster_pos] = p; });
            const unslotted = tp.filter(p => !p.roster_pos);
            return (
              <DropZone key={team} id={"team-"+team}
                style={{background:C.card,borderRadius:12,padding:"16px 18px",border:"1px solid "+C.border}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <h3 style={{margin:0,fontSize:17,fontWeight:800,color:C.gold}}>{team}</h3>
                  <Tag c={C.acc}>{tp.length} players</Tag>
                </div>
                {ROSTER_GROUPS.map(grp => (
                  <div key={grp.label} style={{marginBottom:10}}>
                    <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut,marginBottom:4}}>{grp.label}</div>
                    {grp.pos.map(rp => {
                      const player = rosterMap[rp];
                      const inner = (
                        <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 8px",marginBottom:2,background:C.bg,borderRadius:6,border:player?"1px solid "+C.border:"1px dashed "+C.border}}>
                          <span style={{fontSize:11,fontWeight:700,color:player?C.gold:C.mut,minWidth:36}}>{rp}</span>
                          {player ? (<>
                            <span style={{display:"flex",alignItems:"center",gap:4,fontSize:12,fontWeight:600,flex:1,cursor:"pointer"}} onClick={()=>setProfileId(player.id)}>
                              {isReturningDSE(player) && <span title="DS Elite returning athlete" style={{color:C.gold,fontSize:14,fontWeight:800,lineHeight:1}}>◆</span>}
                              {player.first_name} {player.last_name}
                            </span>
                            <div style={{display:"flex",gap:3,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>{posRankTags(player)}</div>
                            <span style={{fontWeight:800,fontSize:13,color:C.gold,minWidth:22,textAlign:"right"}}>{tot(player)||"—"}</span>
                          </>) : <span style={{fontSize:11,color:C.mut,fontStyle:"italic",flex:1}}>open</span>}
                        </div>
                      );
                      return <div key={rp}>{player ? <DraggablePlayer player={player}>{inner}</DraggablePlayer> : inner}</div>;
                    })}
                  </div>
                ))}
                {unslotted.length>0 && <div style={{marginTop:6}}>
                  <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.acc,marginBottom:4}}>No Roster Position</div>
                  {unslotted.map(p => (
                    <DraggablePlayer key={p.id} player={p}>
                      <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 8px",marginBottom:2,background:C.bg,borderRadius:6,border:"1px solid rgba(233,30,140,0.3)"}}>
                        <span style={{display:"flex",alignItems:"center",gap:4,fontSize:12,fontWeight:600,flex:1,cursor:"pointer"}} onClick={()=>setProfileId(p.id)}>
                          {isReturningDSE(p) && <span title="DS Elite returning athlete" style={{color:C.gold,fontSize:14,fontWeight:800,lineHeight:1}}>◆</span>}
                          {p.first_name} {p.last_name}
                        </span>
                        <div style={{display:"flex",gap:3,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>{posRankTags(p)}</div>
                        <span style={{fontWeight:800,fontSize:13,color:C.gold,minWidth:22,textAlign:"right"}}>{tot(p)||"—"}</span>
                      </div>
                    </DraggablePlayer>
                  ))}
                </div>}
                {tp.length === 0 && <div style={{textAlign:"center",padding:10,color:C.mut,fontSize:11,fontStyle:"italic"}}>Drop players here to add to {team}</div>}
              </DropZone>
            );
          })}
          {/* Unassigned drop zone with position-grouped lists and global rank inputs */}
          {(() => {
            const unassigned = divPlayers.filter(p => !p.team_assignment);
            const groups = {}; POSITIONS.forEach(pos => { groups[pos] = []; }); groups[""] = [];
            unassigned.forEach(p => {
              const ps = p.positions || [];
              if (ps.length === 0) groups[""].push(p);
              else ps.forEach(pos => { if (groups[pos]) groups[pos].push(p); });
            });
            return (
              <DropZone id="team-" style={{background:C.card,borderRadius:12,padding:"16px 18px",border:"1px solid rgba(239,68,68,0.3)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <h3 style={{margin:0,fontSize:17,fontWeight:800,color:C.red}}>Unassigned</h3>
                  <Tag c={C.red}>{unassigned.length}</Tag>
                </div>
                <div style={{fontSize:10,color:C.mut,marginBottom:8,fontStyle:"italic"}}>Numbers are rank within position across the whole division. Drop a player here to remove from team.</div>
                <div style={{display:"flex",flexDirection:"column",gap:10,maxHeight:640,overflowY:"auto"}}>
                  {[...POSITIONS, ""].map(pos => {
                    const list = groups[pos];
                    if (list.length === 0) return null;
                    const ordered = [...list].sort((a,b) => {
                      const ra = posRankOf(a.id, pos), rb = posRankOf(b.id, pos);
                      return (ra == null ? 1e9 : ra) - (rb == null ? 1e9 : rb);
                    });
                    const totalInPos = divPlayers.filter(p => pos === "" ? (p.positions||[]).length === 0 : (p.positions||[]).includes(pos)).length;
                    const isCustom = !!(divRanks[pos] && divRanks[pos].length);
                    const label = pos === "" ? "Unspecified" : POS_LABELS[pos] + " (" + pos + ")";
                    return (
                      <div key={pos||"none"}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4,paddingBottom:3,borderBottom:"1px solid "+C.border}}>
                          <span style={{fontSize:11,fontWeight:700,textTransform:"uppercase",color:C.acc}}>{label} • {list.length} unassigned / {totalInPos} total</span>
                          {isCustom && <button onClick={()=>resetPos(pos)} style={{background:"none",border:"none",color:C.mut,fontSize:9,cursor:"pointer",textDecoration:"underline",fontFamily:"inherit"}}>reset to score order</button>}
                        </div>
                        {ordered.map(p => {
                          const rank = posRankOf(p.id, pos);
                          return (
                            <DraggablePlayer key={p.id} player={p}>
                              <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 6px",background:C.bg,borderRadius:5,fontSize:11,marginBottom:2}}>
                                {pos !== ""
                                  ? <RankInput value={rank} max={totalInPos} onCommit={(n)=>setPosRank(p.id, pos, n)} />
                                  : <span style={{minWidth:40}} />}
                                <span style={{display:"flex",alignItems:"center",gap:4,flex:1,fontWeight:600,cursor:"pointer"}} onClick={()=>setProfileId(p.id)}>
                                  {isReturningDSE(p) && <span title="DS Elite returning athlete" style={{color:C.gold,fontSize:14,fontWeight:800,lineHeight:1}}>◆</span>}
                                  {p.first_name} {p.last_name}
                                </span>
                                {p.projected_team && <Tag c={C.gold}>{p.projected_team}</Tag>}
                                <span title="Total points" style={{fontWeight:700,color:C.gold,minWidth:22,textAlign:"right"}}>{tot(p)||"—"}</span>
                                <span title="Average score" style={{fontWeight:600,color:C.mut,minWidth:26,textAlign:"right",fontSize:10}}>{avg(p)}</span>
                              </div>
                            </DraggablePlayer>
                          );
                        })}
                      </div>
                    );
                  })}
                  {unassigned.length === 0 && <div style={{textAlign:"center",padding:14,color:C.mut,fontSize:11}}>No unassigned players</div>}
                </div>
              </DropZone>
            );
          })()}
        </div>
      </DndContext>
    );
  }

  // ─── RANKINGS ───
  function renderRankings() {
    const tdS = {padding:"7px 7px",fontSize:12,borderBottom:"1px solid "+C.border,verticalAlign:"middle"};
    const PROJ_ORDER = {"1":0,"1/2":1,"2":2,"2/3":3,"3":4,"":5};
    // Column definitions for the Rankings table. `get` extracts the sort value;
    // `defDir` is the direction used when first clicking that column (numeric -> desc, text -> asc).
    const COLS = [
      { key:"rank",   label:"Rank",   sortable:false },
      { key:"player", label:"Player", sortable:true,  defDir:"asc",  get:p=>((p.last_name||"")+" "+(p.first_name||"")).toLowerCase() },
      { key:"age",    label:"Age",    sortable:true,  defDir:"desc", get:p=>parseInt(p.age)||0 },
      { key:"pos",    label:"Pos",    sortable:true,  defDir:"asc",  get:p=>(p.positions||[]).join(",") },
      { key:"proj",   label:"Proj",   sortable:true,  defDir:"asc",  get:p=>PROJ_ORDER[p.projected_team]??5 },
      ...SKILLS.map(sk => ({ key:"sk_"+sk, label:sk, sortable:true, defDir:"desc", get:p=>(p.scores||{})[sk]||0 })),
      { key:"total",  label:"Total",  sortable:true,  defDir:"desc", get:p=>tot(p) },
      { key:"avg",    label:"Avg",    sortable:true,  defDir:"desc", get:p=>parseFloat(avg(p))||0 },
      { key:"team",   label:"Team",   sortable:true,  defDir:"asc",  get:p=>p.team_assignment||"" },
    ];
    const activeCol = COLS.find(c => c.key === rankSort.key) || COLS.find(c => c.key === "total");
    const dirMul = rankSort.dir === "asc" ? 1 : -1;
    const cmpName = (a,b) => {
      const an = ((a.last_name||"")+(a.first_name||"")).toLowerCase();
      const bn = ((b.last_name||"")+(b.first_name||"")).toLowerCase();
      return an < bn ? -1 : an > bn ? 1 : 0;
    };
    const ranked = [...divP]
      .filter(p => tot(p) > 0)
      .filter(p => !rankDate || (p.eval_dates||[]).includes(rankDate))
      .sort((a,b) => {
        const av = activeCol.get(a), bv = activeCol.get(b);
        if (av < bv) return -1 * dirMul;
        if (av > bv) return  1 * dirMul;
        return cmpName(a,b);
      });
    const shown = filterPos ? ranked.filter(p=>(p.positions||[]).includes(filterPos)) : ranked;
    const onSort = (col) => {
      if (!col.sortable) return;
      setRankSort(prev => prev.key === col.key
        ? { key: col.key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key: col.key, dir: col.defDir });
    };
    return (
      <div>
        <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center",flexWrap:"wrap"}}>
          <span style={{fontSize:12,color:C.mut,fontWeight:600}}>Rank by position:</span>
          <select style={{...inpStyle,padding:"7px 10px",fontSize:12}} value={filterPos} onChange={e=>setFilterPos(e.target.value)}>
            <option value="">All</option>{POSITIONS.map(p=><option key={p} value={p}>{p} - {POS_LABELS[p]}</option>)}
          </select>
          <span style={{fontSize:12,color:C.mut,fontWeight:600,marginLeft:6}}>Eval date:</span>
          <select style={{...inpStyle,padding:"7px 10px",fontSize:12,color:rankDate?C.gold:C.text}} value={rankDate} onChange={e=>setRankDate(e.target.value)} title="Limit rankings to players evaluated on this date">
            <option value="">All Dates</option>{EVAL_DATES.map(d=><option key={d} value={d}>{d}</option>)}
          </select>
          <span style={{fontSize:11,color:C.mut,marginLeft:"auto"}}>{shown.length} ranked</span>
        </div>
        <div style={{background:C.card,borderRadius:12,border:"1px solid "+C.border,overflow:"hidden"}}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0}}>
              <thead><tr>{COLS.map(c => {
                const isActive = c.key === rankSort.key;
                const arrow = isActive ? (rankSort.dir === "asc" ? " ▲" : " ▼") : "";
                return <th key={c.key} onClick={()=>onSort(c)}
                  style={{padding:"8px 7px",textAlign:"left",fontSize:9,fontWeight:700,textTransform:"uppercase",color:isActive?C.gold:C.mut,borderBottom:"1px solid "+C.border,background:C.card,position:"sticky",top:0,whiteSpace:"nowrap",cursor:c.sortable?"pointer":"default",userSelect:"none"}}
                  title={c.sortable?"Click to sort":""}>{c.label}{arrow}</th>;
              })}</tr></thead>
              <tbody>{shown.map((p,i) => (
                <tr key={p.id}>
                  <td style={tdS}><span style={{fontWeight:800,fontSize:15,color:i<3?C.gold:C.mut}}>#{i+1}</span></td>
                  <td style={tdS}><span style={{display:"inline-flex",alignItems:"center",gap:5,fontWeight:700,fontSize:12,color:C.gold,cursor:"pointer"}} onClick={()=>setProfileId(p.id)}>{isReturningDSE(p) && <span title="DS Elite returning athlete" style={{color:C.gold,fontSize:14,fontWeight:800,lineHeight:1}}>◆</span>}{p.first_name} {p.last_name}</span></td>
                  <td style={tdS}>{p.age}</td>
                  <td style={tdS}><div style={{display:"flex",gap:2,flexWrap:"wrap"}}>{(p.positions||[]).map(pos=><Tag key={pos} c={C.grn}>{pos}</Tag>)}</div></td>
                  <td style={tdS}>{p.projected_team && <Tag c={C.gold}>{p.projected_team}</Tag>}</td>
                  {SKILLS.map(sk=><td key={sk} style={tdS}><span style={{fontWeight:600,color:(p.scores||{})[sk]>=4?C.grn:(p.scores||{})[sk]>=3?C.gold:(p.scores||{})[sk]?C.red:C.mut}}>{(p.scores||{})[sk]||"—"}</span></td>)}
                  <td style={tdS}><span style={{fontWeight:800,fontSize:15,color:C.gold}}>{tot(p)}</span></td>
                  <td style={tdS}><span style={{fontWeight:600}}>{avg(p)}</span></td>
                  <td style={tdS}><Tag c={p.team_assignment?C.grn:C.mut}>{p.team_assignment||"—"}</Tag></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {!shown.length && <div style={{textAlign:"center",padding:28,color:C.mut}}>No scored players{filterPos?" at "+filterPos:""}</div>}
        </div>
      </div>
    );
  }

  // ─── PROFILE MODAL ───
  function renderProfile() {
    const p = players.find(x => x.id === profileId);
    if (!p) return null;
    const lbl = {fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut,marginBottom:4,display:"block"};
    const editInp = {...inpStyle,width:"100%",padding:"8px 10px",fontSize:13};
    const totalScore = tot(p);
    const scoredCount = Object.values(p.scores||{}).filter(v=>v>0).length;
    return (
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:1000,display:"flex",justifyContent:"center",padding:"30px 16px",overflowY:"auto"}} onClick={()=>setProfileId(null)}>
        <div style={{background:C.card,borderRadius:16,border:"1px solid "+C.border,maxWidth:700,width:"100%",maxHeight:"90vh",overflowY:"auto",padding:24}} onClick={e=>e.stopPropagation()}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}>
            <div>
              <h2 style={{margin:0,fontSize:22,fontWeight:800,color:C.gold,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                {isReturningDSE(p) && <span title="DS Elite returning athlete" style={{color:C.gold,fontSize:14,fontWeight:800,lineHeight:1}}>◆</span>}
                {p.first_name} {p.last_name}
              </h2>
              <div style={{display:"flex",gap:5,marginTop:6,flexWrap:"wrap"}}>
                <Tag c={C.gold}>USAV: {p.usavDiv||p.usav_div}</Tag><Tag c={C.acc}>Reg: {p.reg_group}</Tag><Tag c={C.mut}>Age {p.age}</Tag>
                {(p.positions||[]).map(pos=><Tag key={pos} c={C.grn}>{pos}</Tag>)}
                {p.supplemental===1 && <Tag c={C.acc}>SUPPLEMENTAL</Tag>}
              </div>
            </div>
            <button style={{background:"none",border:"none",color:C.mut,fontSize:24,cursor:"pointer"}} onClick={()=>setProfileId(null)}>✕</button>
          </div>
          {/* Score Summary */}
          <div style={{background:totalScore>0?"linear-gradient(135deg,rgba(233,30,140,0.15),rgba(34,197,94,0.1))":C.bg,borderRadius:12,padding:"14px 18px",marginBottom:16,border:"1px solid "+(totalScore>0?C.gold:C.border)}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div><div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut}}>Total</div><div style={{fontSize:36,fontWeight:800,color:totalScore>0?C.gold:C.mut}}>{totalScore||0}<span style={{fontSize:16,fontWeight:400,color:C.mut}}>/45</span></div></div>
              <div style={{textAlign:"center"}}><div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut}}>Avg</div><div style={{fontSize:28,fontWeight:800,color:totalScore>0?C.grn:C.mut}}>{avg(p)}</div></div>
              <div style={{textAlign:"right"}}><div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut}}>Scored</div><div style={{fontSize:28,fontWeight:800,color:scoredCount===9?C.grn:C.gold}}>{scoredCount}<span style={{fontSize:16,fontWeight:400,color:C.mut}}>/9</span></div></div>
            </div>
          </div>
          {/* Scores */}
          <div style={{marginBottom:14}}>
            <span style={lbl}>Evaluation Scores (tap 1-5)</span>
            <div style={{background:C.bg,borderRadius:10,padding:14}}>
              {SKILLS.map(sk => {
                const cur = (p.scores&&p.scores[sk])||0;
                return <div key={sk} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid "+C.border}}>
                  <span style={{fontSize:13,fontWeight:600,minWidth:120}}>{sk}</span>
                  <div style={{display:"flex",gap:4}}>{[1,2,3,4,5].map(v => {
                    const active=cur===v;
                    return <button key={v} style={{width:36,height:34,borderRadius:8,cursor:"pointer",fontFamily:"inherit",fontSize:14,fontWeight:700,border:active?"2px solid "+C.gold:"1px solid "+C.border,
                      background:active?(v>=4?"rgba(34,197,94,0.2)":v>=3?"rgba(233,30,140,0.2)":"rgba(239,68,68,0.15)"):"transparent",
                      color:active?(v>=4?C.grn:v>=3?C.gold:C.red):C.mut}} onClick={()=>{const ns={...(p.scores||{})}; ns[sk]=cur===v?0:v; upd(p.id,{scores:ns});}}>{v}</button>;
                  })}</div>
                </div>;
              })}
            </div>
          </div>
          {/* Positions */}
          <div style={{marginBottom:14}}>
            <span style={lbl}>Positions</span>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{POSITIONS.map(pos => {
              const active = (p.positions||[]).includes(pos);
              return <button key={pos} style={{padding:"8px 16px",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer",border:active?"2px solid "+C.gold:"1px solid "+C.border,background:active?"rgba(233,30,140,0.15)":"transparent",color:active?C.gold:C.mut}}
                onClick={()=>{const next=active?(p.positions||[]).filter(x=>x!==pos):[...(p.positions||[]),pos]; upd(p.id,{positions:next});}}>{pos} - {POS_LABELS[pos]}</button>;
            })}</div>
          </div>
          {/* Division/Team/Roster/Prev/Status */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:12,marginBottom:14}}>
            <div>
              <span style={lbl}>USAV Div</span>
              <select style={editInp} value={p.usavDiv||p.usav_div||""}
                onChange={e=>{
                  const v = e.target.value;
                  if (v !== (p.usavDiv||p.usav_div) && (p.team_assignment || p.roster_pos)) {
                    if (!window.confirm("Change division to "+v+"? This will clear her team assignment and roster position.")) return;
                  }
                  upd(p.id, { usav_div: v, usavDiv: v, team_assignment: "", roster_pos: "" });
                }}>
                {DIVS.map(d=><option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div><span style={lbl}>Projected</span><select style={editInp} value={p.projected_team||""} onChange={e=>upd(p.id,{projected_team:e.target.value})}>{PROJ_OPTS.map(o=><option key={o} value={o}>{o||"--"}</option>)}</select></div>
            <div><span style={lbl}>Team</span><select style={editInp} value={p.team_assignment||""} onChange={e=>upd(p.id,{team_assignment:e.target.value,roster_pos:""})}><option value="">--</option>{(TM[p.usavDiv||p.usav_div]||[]).map(t=><option key={t} value={t}>{t}</option>)}</select></div>
            <div><span style={lbl}>Roster Pos</span><select style={editInp} value={p.roster_pos||""} onChange={e=>upd(p.id,{roster_pos:e.target.value})}><option value="">--</option>{ROSTER_POS.map(rp=>{const taken=players.some(o=>o.id!==p.id&&o.team_assignment===p.team_assignment&&o.roster_pos===rp);return <option key={rp} value={rp} disabled={taken}>{rp}{taken?" (taken)":""}</option>;})}</select></div>
            <div><span style={lbl}>Status</span><select style={{...editInp,color:STATUS_COLORS[p.status||"In Progress"]}} value={p.status||"In Progress"} onChange={e=>upd(p.id,{status:e.target.value})}>{STATUS_OPTS.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
            <div><span style={lbl}>Prev Season Team</span><input style={editInp} placeholder="e.g. DSE 13 Diamond" value={p.current_team||""} onChange={e=>upd(p.id,{current_team:e.target.value})} /></div>
          </div>
          {/* Notes */}
          <div style={{marginBottom:14}}><span style={lbl}>Coach Notes</span><textarea style={{...editInp,minHeight:70,resize:"vertical"}} placeholder="Notes..." value={p.notes||""} onChange={e=>upd(p.id,{notes:e.target.value})} /></div>
          <div style={{marginBottom:14}}><span style={lbl}>Parent Feedback Session Notes</span><textarea style={{...editInp,minHeight:70,resize:"vertical"}} placeholder="Notes from the parent feedback conversation..." value={p.parent_feedback_notes||""} onChange={e=>upd(p.id,{parent_feedback_notes:e.target.value})} /></div>
          {/* Eval Dates */}
          <div style={{marginBottom:14}}>
            <span style={lbl}>Eval Sessions</span>
            <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{EVAL_DATES.map(d => {
              const active = (p.eval_dates||[]).includes(d);
              return <button key={d} style={{padding:"6px 12px",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer",border:active?"2px solid "+C.gold:"1px solid "+C.border,background:active?"rgba(233,30,140,0.2)":"transparent",color:active?C.gold:C.mut}}
                onClick={()=>{const next=active?(p.eval_dates||[]).filter(x=>x!==d):[...(p.eval_dates||[]),d]; upd(p.id,{eval_dates:next});}}>{d}</button>;
            })}</div>
          </div>
          {/* National Team ID Clinic (U14/U15/U16 only) */}
          {CLINIC_DIVS.includes(p.usavDiv || p.usav_div) && (
            <div style={{marginBottom:14}}>
              <span style={lbl}>National Team ID Clinic</span>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <button onClick={()=>upd(p.id,{id_clinic_invited:!p.id_clinic_invited})}
                  style={{padding:"8px 16px",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",border:p.id_clinic_invited?"2px solid "+C.gold:"1px solid "+C.border,background:p.id_clinic_invited?"rgba(233,30,140,0.15)":"transparent",color:p.id_clinic_invited?C.gold:C.mut}}>
                  {p.id_clinic_invited ? "✓ Invited" : "Mark Invited"}
                </button>
                <button onClick={()=>upd(p.id,{id_clinic_attended:!p.id_clinic_attended})}
                  style={{padding:"8px 16px",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",border:p.id_clinic_attended?"2px solid "+C.grn:"1px solid "+C.border,background:p.id_clinic_attended?"rgba(34,197,94,0.15)":"transparent",color:p.id_clinic_attended?C.grn:C.mut}}>
                  {p.id_clinic_attended ? "✓ Attended" : "Mark Attended"}
                </button>
              </div>
            </div>
          )}
          {/* Registration Info */}
          <div style={{background:C.bg,borderRadius:10,padding:14}}>
            <div style={{fontSize:11,fontWeight:700,color:C.gold,marginBottom:10}}>REGISTRATION INFO & INTAKE</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:10}}>
              <div><span style={lbl}>Parent Name</span><input style={editInp} placeholder="Parent name" value={p.parent_name||""} onChange={e=>upd(p.id,{parent_name:e.target.value})} /></div>
              <div><span style={lbl}>Parent Email</span><input type="email" style={editInp} placeholder="email@example.com" value={p.parent_email||""} onChange={e=>upd(p.id,{parent_email:e.target.value})} /></div>
              <div><span style={lbl}>Parent Phone</span><input style={editInp} placeholder="555-555-5555" value={p.parent_phone||""} onChange={e=>upd(p.id,{parent_phone:e.target.value})} /></div>
            </div>
            {[["Position / Experience",p.reg_position],["Strengths / Improvement",p.strength_weakness],["Ideal Coach",p.ideal_coach],["Goals",p.goal],["Starter Preference",p.starter_pref]].map(([label,val])=>
              val && val!=="na" && <div key={label} style={{marginBottom:10,borderTop:"1px solid "+C.border,paddingTop:8}}><span style={lbl}>{label}</span><div style={{fontSize:13,lineHeight:1.5}}>{val}</div></div>
            )}
            {p.leaving_reason && <div style={{marginBottom:10,borderTop:"1px solid "+C.border,paddingTop:8}}><span style={lbl}>Why leaving previous club?</span><div style={{fontSize:13,lineHeight:1.5}}>{p.leaving_reason}</div></div>}
            {p.min_level && <div><span style={lbl}>Min Level</span><div style={{fontSize:13}}>{p.min_level}</div></div>}
          </div>
          {/* Tryout Toggle */}
          <div style={{display:"flex",alignItems:"center",gap:10,marginTop:16,padding:"12px 16px",background:p.supplemental===1?"rgba(233,30,140,0.1)":C.bg,borderRadius:10,border:"1px solid "+(p.supplemental===1?C.acc:C.border),cursor:"pointer"}} onClick={()=>upd(p.id,{supplemental:p.supplemental===1?0:1})}>
            <input type="checkbox" checked={p.supplemental===1} readOnly style={{width:20,height:20,accentColor:"#ff69b4",cursor:"pointer"}} />
            <span style={{fontSize:14,fontWeight:700,color:p.supplemental===1?C.acc:C.mut}}>{p.supplemental===1?"Using Evaluation as Tryout ✓":"Mark as Using Evaluation for Tryout"}</span>
          </div>
          {/* Feedback Session Complete */}
          <div style={{display:"flex",alignItems:"center",gap:10,marginTop:8,padding:"12px 16px",background:p.feedback_session_complete?"rgba(34,197,94,0.1)":C.bg,borderRadius:10,border:"1px solid "+(p.feedback_session_complete?C.grn:C.border),cursor:"pointer"}} onClick={()=>upd(p.id,{feedback_session_complete:!p.feedback_session_complete})}>
            <input type="checkbox" checked={!!p.feedback_session_complete} readOnly style={{width:20,height:20,accentColor:C.gold,cursor:"pointer"}} />
            <span style={{fontSize:14,fontWeight:700,color:p.feedback_session_complete?C.grn:C.mut}}>{p.feedback_session_complete?"Feedback Session Completed ✓":"Mark Feedback Session Completed"}</span>
          </div>
          {/* Mark Complete */}
          <div style={{display:"flex",alignItems:"center",gap:10,marginTop:8,padding:"12px 16px",background:p.eval_complete?"rgba(34,197,94,0.1)":C.bg,borderRadius:10,border:"1px solid "+(p.eval_complete?C.grn:C.border),cursor:"pointer"}} onClick={()=>upd(p.id,{eval_complete:!p.eval_complete})}>
            <input type="checkbox" checked={!!p.eval_complete} readOnly style={{width:20,height:20,accentColor:C.gold,cursor:"pointer"}} />
            <span style={{fontSize:14,fontWeight:700,color:p.eval_complete?C.grn:C.mut}}>{p.eval_complete?"Evaluation Complete ✓":"Mark Evaluation Complete"}</span>
          </div>
          {/* Danger zone — delete player. Two-step confirmation guards against mis-clicks. */}
          <div style={{marginTop:24,paddingTop:16,borderTop:"1px solid "+C.border}}>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.red,marginBottom:8,letterSpacing:0.5}}>Danger Zone</div>
            <button
              onClick={async () => {
                const name = (p.first_name || "") + " " + (p.last_name || "");
                if (!window.confirm("Delete " + name.trim() + " permanently? This cannot be undone.")) return;
                if (!window.confirm("Are you sure? All scores, notes, and team assignments for " + name.trim() + " will be lost.")) return;
                const { error } = await supabase.from("players").delete().eq("id", p.id);
                if (error) { window.alert("Delete failed: " + error.message); return; }
                setProfileId(null);
                await loadPlayers();
              }}
              style={{padding:"10px 16px",borderRadius:8,border:"1px solid "+C.red,background:"transparent",color:C.red,fontFamily:"inherit",fontSize:13,fontWeight:700,cursor:"pointer"}}>
              Delete Player
            </button>
            <div style={{fontSize:11,color:C.mut,marginTop:6}}>Removes this player and all their evaluation data from the database. You'll be asked to confirm twice.</div>
          </div>
        </div>
      </div>
    );
  }

  // ─── ADD PLAYER MODAL ───
  function renderAddPlayer() {
    const lbl = {fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut,marginBottom:4,display:"block"};
    const editInp = {...inpStyle,width:"100%",padding:"8px 10px",fontSize:13};
    const setF = (k, v) => setNewPlayer(prev => ({ ...prev, [k]: v }));
    const computedUsav = newPlayer.dob ? "U" + calcUSAV(newPlayer.dob) : "";
    const close = () => { setAddingPlayer(false); setAddMsg(""); };
    return (
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:1000,display:"flex",justifyContent:"center",padding:"30px 16px",overflowY:"auto"}} onClick={close}>
        <div style={{background:C.card,borderRadius:16,border:"1px solid "+C.border,maxWidth:560,width:"100%",maxHeight:"90vh",overflowY:"auto",padding:24}} onClick={e=>e.stopPropagation()}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}>
            <h2 style={{margin:0,fontSize:20,fontWeight:800,color:C.gold}}>+ Add Player</h2>
            <button style={{background:"none",border:"none",color:C.mut,fontSize:24,cursor:"pointer"}} onClick={close}>✕</button>
          </div>
          <div style={{fontSize:12,color:C.mut,marginBottom:14,fontStyle:"italic"}}>
            For one-off entries (walk-ins, late registrations). Players from the registration CSV come in via "Upload CSV".
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
            <div><span style={lbl}>First Name *</span><input autoFocus style={editInp} value={newPlayer.first_name} onChange={e=>setF("first_name", e.target.value)} /></div>
            <div><span style={lbl}>Last Name *</span><input style={editInp} value={newPlayer.last_name} onChange={e=>setF("last_name", e.target.value)} /></div>
            <div><span style={lbl}>Date of Birth</span><input type="date" style={editInp} value={newPlayer.dob} onChange={e=>setF("dob", e.target.value)} /></div>
            <div>
              <span style={lbl}>USAV Division{computedUsav?" (auto: "+computedUsav+")":""}</span>
              <select style={editInp} value={newPlayer.usav_div} onChange={e=>setF("usav_div", e.target.value)}>
                <option value="">{computedUsav || "Select…"}</option>
                {DIVS.map(d=><option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div><span style={lbl}>Age (optional)</span><input style={editInp} value={newPlayer.age} onChange={e=>setF("age", e.target.value)} placeholder="e.g. 13" /></div>
            <div></div>
          </div>
          <div style={{marginBottom:14}}>
            <span style={lbl}>Positions</span>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{POSITIONS.map(pos => {
              const active = (newPlayer.positions||[]).includes(pos);
              return <button key={pos} style={{padding:"6px 12px",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer",border:active?"2px solid "+C.gold:"1px solid "+C.border,background:active?"rgba(233,30,140,0.15)":"transparent",color:active?C.gold:C.mut,fontFamily:"inherit"}}
                onClick={()=>{ const next = active ? newPlayer.positions.filter(x=>x!==pos) : [...(newPlayer.positions||[]),pos]; setF("positions", next); }}>{pos} - {POS_LABELS[pos]}</button>;
            })}</div>
          </div>
          <div style={{borderTop:"1px solid "+C.border,paddingTop:12,marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:C.gold,marginBottom:8}}>PARENT / GUARDIAN (OPTIONAL)</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div style={{gridColumn:"1 / -1"}}><span style={lbl}>Name</span><input style={editInp} value={newPlayer.parent_name} onChange={e=>setF("parent_name", e.target.value)} /></div>
              <div><span style={lbl}>Email</span><input type="email" style={editInp} value={newPlayer.parent_email} onChange={e=>setF("parent_email", e.target.value)} /></div>
              <div><span style={lbl}>Phone</span><input style={editInp} value={newPlayer.parent_phone} onChange={e=>setF("parent_phone", e.target.value)} placeholder="e.g. 512-555-1234" /></div>
            </div>
          </div>
          {addMsg && <div style={{fontSize:12,marginBottom:10,color:addMsg.startsWith("Error")?C.red:addMsg==="Saving..."?C.mut:C.grn}}>{addMsg}</div>}
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <button onClick={close} style={{padding:"10px 18px",borderRadius:8,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
            <button onClick={handleAddPlayer} disabled={addMsg==="Saving..."} style={{padding:"10px 18px",borderRadius:8,border:"none",background:C.gold,color:"#000",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit",opacity:addMsg==="Saving..."?0.5:1}}>Add Player</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{fontFamily:"Outfit,sans-serif",background:C.bg,color:C.text,minHeight:"100vh"}}>
      <header style={{background:"linear-gradient(135deg,#0f0f0f,#1a1a1a)",borderBottom:"1px solid "+C.border,padding:"12px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
        <div style={{fontSize:19,fontWeight:800,color:C.gold,display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:22}}>◆</span> DS ELITE
          <span style={{fontSize:11,fontWeight:400,color:C.mut,marginLeft:6}}>2026-27 Tryouts</span>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <nav style={{display:"flex",gap:3}}>
            {[["dashboard","Dashboard"],["evaluate","Evaluate"],["teams","Teams"],["rankings","Rankings"]].map(([v,l]) =>
              <button key={v} style={{padding:"6px 14px",borderRadius:8,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600,background:view===v?C.gold:"transparent",color:view===v?"#000":C.mut}} onClick={()=>setView(v)}>{l}</button>
            )}
          </nav>
          <button onClick={openAddPlayer} title="Add a player from any view"
            style={{padding:"6px 12px",borderRadius:8,border:"1px solid "+C.gold,background:"transparent",color:C.gold,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700}}>
            + Add Player
          </button>
        </div>
      </header>
      {view !== "dashboard" && (
        <div style={{display:"flex",gap:4,padding:"10px 18px",borderBottom:"1px solid "+C.border,flexWrap:"wrap"}}>
          {divsWithPlayers.map(d => {
            const isSelected = selectedDivs.includes(d);
            const isLast = isSelected && selectedDivs.length === 1;
            return <button key={d}
              title={isLast ? "At least one age group must be selected" : (isSelected ? "Click to remove "+d : "Click to add "+d)}
              style={{padding:"5px 14px",borderRadius:16,border:"1px solid "+(isSelected?C.gold:C.border),background:isSelected?"rgba(233,30,140,0.12)":"transparent",color:isSelected?C.gold:C.mut,cursor:isLast?"default":"pointer",opacity:isLast?0.85:1,fontFamily:"inherit",fontSize:12,fontWeight:600}}
              onClick={()=>{
                setSelectedDivs(prev => {
                  if (prev.includes(d)) {
                    return prev.length > 1 ? prev.filter(x => x !== d) : prev;
                  }
                  return [...prev, d];
                });
              }}>
              {d} ({players.filter(p=>(p.usavDiv||p.usav_div)===d).length})
            </button>;
          })}
        </div>
      )}
      <div style={{padding:"14px 18px",maxWidth:1500,margin:"0 auto"}}>
        {view==="dashboard" && renderDashboard()}
        {view==="evaluate" && renderEval()}
        {view==="teams" && renderTeams()}
        {view==="rankings" && renderRankings()}
      </div>
      {profileId !== null && renderProfile()}
      {addingPlayer && renderAddPlayer()}
    </div>
  );
}
