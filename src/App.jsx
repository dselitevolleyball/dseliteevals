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
// 2026-27 season club plan: how many teams at each competitive tier per age group.
// Sent to the AI summary so parents see the broader landscape their daughter is
// being evaluated against. Edit here when the plan changes.
const TEAM_PLAN_2026 = {
  U10: { national: 0, regional: 0, rise: 0 },
  U11: { national: 0, regional: 1, rise: 1 },
  U12: { national: 1, regional: 1, rise: 2 },
  U13: { national: 1, regional: 2, rise: 1 },
  U14: { national: 2, regional: 2, rise: 0 },
  U15: { national: 2, regional: 2, rise: 0 },
  U16: { national: 1, regional: 1, rise: 0 },
};
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

// Payload sent to /api/summarize-player. Shared by initial generation and
// the refine flow so both requests describe the player identically.
function buildPlayerPayload(p, players) {
  const div = p.usavDiv || p.usav_div;
  const divPeers = players.filter(o => (o.usavDiv || o.usav_div) === div && tot(o) > 0);
  const playerTotal = tot(p);
  let division_band = null;
  if (playerTotal > 0 && divPeers.length >= 5) {
    const betterCount = divPeers.filter(o => tot(o) > playerTotal).length;
    const rank = betterCount + 1;
    const pct = rank / divPeers.length; // 1/N = best, 1.0 = worst
    if (pct <= 0.10)      division_band = "top10";
    else if (pct <= 0.25) division_band = "top25";
    else if (pct >= 0.90) division_band = "bottom10";
    else if (pct >= 0.75) division_band = "bottom25";
    else                  division_band = "middle";
  }
  return {
    first_name: p.first_name, last_name: p.last_name, age: p.age,
    usav_div: div,
    positions: p.positions, scores: p.scores,
    notes: p.notes, parent_feedback_notes: p.parent_feedback_notes,
    eval_dates: p.eval_dates,
    projected_team: p.projected_team, team_assignment: p.team_assignment,
    status: p.status,
    strength_weakness: p.strength_weakness, goal: p.goal,
    division_band,
    division_total_scored: divPeers.length,
    team_plan: TEAM_PLAN_2026[div] || null,
  };
}
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
  // ─── Auth state ─────────────────────────────────────────────────────
  // We use Supabase Auth (email + password). Each coach has their own login.
  // `session` is the raw Supabase session; `coach` is the matching row in
  // public.coaches (display_name, is_admin, is_approved). The app is gated
  // until `coach.is_approved` is true — the FIRST signup is auto-approved as
  // admin by the handle_new_user trigger, every other signup waits.
  const [authChecking, setAuthChecking] = useState(true);
  const [session, setSession]           = useState(null);
  const [coach, setCoach]               = useState(null);
  // Login/signup form state (only used pre-auth):
  const [loginMode, setLoginMode]               = useState("login"); // "login" | "signup"
  const [loginEmail, setLoginEmail]             = useState("");
  const [loginPassword, setLoginPassword]       = useState("");
  const [loginDisplayName, setLoginDisplayName] = useState("");
  const [loginBusy, setLoginBusy]               = useState(false);
  const [loginError, setLoginError]             = useState("");
  const [loginInfo, setLoginInfo]               = useState("");
  // Activity tab state (audit log):
  const [activityLog, setActivityLog]         = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityActor, setActivityActor]     = useState("");
  const [activityAction, setActivityAction]   = useState("");
  // Coaches admin tab state:
  const [coachesList, setCoachesList]         = useState([]);
  const [coachesLoading, setCoachesLoading]   = useState(false);
  // Signup email allowlist (admin section of the Coaches tab):
  const [allowedEmails, setAllowedEmails]       = useState([]);
  const [allowedLoading, setAllowedLoading]     = useState(false);
  const [bulkAllowedInput, setBulkAllowedInput] = useState("");

  // Bootstrap auth on mount; subscribe to changes so the UI re-renders on
  // login/logout/token-refresh.
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      setSession(session);
      setAuthChecking(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  // Whenever the session changes, look up (or refetch) the coach profile row.
  // Also stamp last_seen_at — useful in the Coaches admin screen.
  useEffect(() => {
    if (!session) { setCoach(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("coaches").select("*").eq("id", session.user.id).maybeSingle();
      if (cancelled) return;
      setCoach(data || null);
      if (data) {
        supabase.from("coaches").update({ last_seen_at: new Date().toISOString() }).eq("id", session.user.id);
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

  const isApproved = !!coach?.is_approved;
  const isAdmin    = !!coach?.is_admin;

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
  // AI parent-summary state for the profile modal. Reset whenever the profile changes.
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState("");
  const [aiError, setAiError] = useState("");
  const [aiCopied, setAiCopied] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiSavedAt, setAiSavedAt] = useState(null);
  // When the profile changes, hydrate the AI summary state from the player row
  // so a previously-generated summary shows up again instead of disappearing.
  useEffect(() => {
    setAiBusy(false); setAiError(""); setAiCopied(false); setAiInstruction("");
    const player = players.find(x => x.id === profileId);
    setAiResult(player?.parent_summary || "");
    setAiSavedAt(player?.parent_summary_updated_at || null);
    // Intentionally only re-run when the open profile changes — we don't want
    // a background players reload to wipe an in-progress edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);
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

  useEffect(() => { if (isApproved) { loadPlayers(); loadRankings(); } }, [isApproved, loadPlayers, loadRankings]);

  // Coaches list loader (used by the admin Coaches tab). Lives up here, NOT
  // next to renderCoaches, so the hook call order stays stable across the
  // auth-gate early returns below.
  const loadCoaches = useCallback(async () => {
    setCoachesLoading(true);
    const { data, error } = await supabase.from("coaches").select("*").order("created_at", { ascending: true });
    if (error) console.error("Load coaches error:", error);
    setCoachesList(data || []);
    setCoachesLoading(false);
  }, []);
  useEffect(() => { if (isApproved && view === "coaches") loadCoaches(); }, [isApproved, view, loadCoaches]);

  // Allowed-signup-emails loader (lives next to loadCoaches so the Coaches
  // tab can render both lists in one fetch round).
  const loadAllowedEmails = useCallback(async () => {
    setAllowedLoading(true);
    const { data, error } = await supabase.from("allowed_signup_emails").select("*").order("added_at", { ascending: false });
    if (error) console.error("Load allowed emails error:", error);
    setAllowedEmails(data || []);
    setAllowedLoading(false);
  }, []);
  useEffect(() => { if (isApproved && view === "coaches") loadAllowedEmails(); }, [isApproved, view, loadAllowedEmails]);

  // Activity feed loader (used by the Activity tab). Same hook-order rule.
  const loadActivity = useCallback(async () => {
    setActivityLoading(true);
    let q = supabase.from("change_log").select("*").order("created_at", { ascending: false }).limit(300);
    if (activityActor)  q = q.eq("actor_id", activityActor);
    if (activityAction) q = q.eq("action", activityAction);
    const { data, error } = await q;
    if (error) console.error("Load activity error:", error);
    setActivityLog(data || []);
    setActivityLoading(false);
  }, [activityActor, activityAction]);
  useEffect(() => { if (isApproved && view === "activity") loadActivity(); }, [isApproved, view, loadActivity]);

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

  // ─── AUTH GATES ──────────────────────────────────────────────────────
  // 1. While bootstrapping the session, render a quiet loading screen so we
  //    don't flash the login form for users who already have a session.
  if (authChecking) {
    return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:C.bg,color:C.mut}}>Checking session…</div>;
  }

  // 2. No session -> login / signup form.
  if (!session) {
    const submitAuth = async (e) => {
      if (e && e.preventDefault) e.preventDefault();
      const email    = loginEmail.trim();
      const password = loginPassword;
      if (!email || !password) { setLoginError("Email and password are required."); return; }
      setLoginBusy(true); setLoginError(""); setLoginInfo("");
      // Flip the form into Sign In mode with a friendly banner. Called both
      // by the pre-check (clean path) and by the catch block when Supabase
      // rejects a duplicate signup with "already registered" or a rate-limit
      // error.
      const redirectToSignIn = (reason) => {
        setLoginMode("login");
        setLoginPassword("");
        setLoginError("");
        setLoginInfo(reason || "Looks like you already have an account. Sign in with your existing password below.");
      };
      // Match the family of Supabase Auth errors that mean "this email is
      // already in use" so we can recover instead of just showing the raw
      // message ("Email rate limit exceeded", "User already registered", etc.)
      const looksLikeDuplicateSignup = (msg) => {
        const m = (msg || "").toLowerCase();
        return m.includes("already registered")
            || m.includes("already exists")
            || m.includes("user already")
            || m.includes("rate limit")
            || m.includes("over_email_send_rate_limit");
      };
      try {
        if (loginMode === "signup") {
          // 1. Pre-check the email allowlist — clean rejection message.
          const { data: allowed, error: rpcErr } = await supabase.rpc("is_signup_allowed", { check_email: email });
          if (rpcErr) {
            console.warn("is_signup_allowed RPC failed:", rpcErr);
          } else if (allowed === false) {
            throw new Error("This email isn't on the approved signup list. Contact the Director of Volleyball to be added.");
          }
          // 2. Pre-check whether this email already has an account. If yes,
          //    flip to Sign In mode instead of letting Supabase return a
          //    confusing rate-limit error on the second attempt.
          const { data: alreadyRegistered, error: regErr } = await supabase.rpc("is_email_registered", { check_email: email });
          if (regErr) {
            console.warn("is_email_registered RPC failed:", regErr);
          } else if (alreadyRegistered === true) {
            redirectToSignIn();
            return;
          }
          // 3. Actually create the account.
          const { data, error } = await supabase.auth.signUp({
            email, password,
            options: { data: { display_name: loginDisplayName.trim() || email.split("@")[0] } },
          });
          if (error) {
            if (looksLikeDuplicateSignup(error.message)) { redirectToSignIn(); return; }
            throw error;
          }
          if (!data.session) {
            setLoginInfo("Account created. Check your email for a confirmation link, then sign in.");
            setLoginMode("login");
          }
        } else {
          const { error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) throw error;
        }
      } catch (err) {
        // Catch-all: if even a sign-in error looks like the duplicate-signup
        // family (rare, but possible if the user toggled tabs), redirect.
        if (loginMode === "signup" && looksLikeDuplicateSignup(err.message)) {
          redirectToSignIn();
        } else {
          setLoginError(err.message || "Authentication failed");
        }
      } finally {
        setLoginBusy(false);
      }
    };
    return (
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:C.bg,padding:16}}>
        <form onSubmit={submitAuth} style={{background:C.card,padding:32,borderRadius:16,border:"1px solid "+C.border,maxWidth:400,width:"100%"}}>
          <div style={{textAlign:"center",marginBottom:20}}>
            <div style={{fontSize:28,fontWeight:800,color:C.gold,marginBottom:4}}>◆ DS ELITE</div>
            <div style={{fontSize:13,color:C.mut}}>Tryout Evaluations 2026-27</div>
          </div>
          <div style={{display:"flex",gap:4,marginBottom:18,background:C.bg,borderRadius:8,padding:3}}>
            {["login","signup"].map(m => (
              <button key={m} type="button" onClick={()=>{setLoginMode(m);setLoginError("");setLoginInfo("");}}
                style={{flex:1,padding:"8px 0",borderRadius:6,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,background:loginMode===m?C.gold:"transparent",color:loginMode===m?"#000":C.mut}}>
                {m === "login" ? "Sign In" : "Sign Up"}
              </button>
            ))}
          </div>
          {loginMode === "signup" && (
            <label style={{display:"block",marginBottom:10}}>
              <span style={{fontSize:11,fontWeight:700,color:C.mut,textTransform:"uppercase"}}>Display Name</span>
              <input type="text" value={loginDisplayName} onChange={e=>setLoginDisplayName(e.target.value)} placeholder="e.g. Sarah Smith" autoComplete="name"
                style={{...inpStyle,width:"100%",padding:"10px 14px",fontSize:14,marginTop:3}} />
            </label>
          )}
          <label style={{display:"block",marginBottom:10}}>
            <span style={{fontSize:11,fontWeight:700,color:C.mut,textTransform:"uppercase"}}>Email</span>
            <input type="email" value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} autoComplete="email" autoFocus
              style={{...inpStyle,width:"100%",padding:"10px 14px",fontSize:14,marginTop:3}} />
          </label>
          <label style={{display:"block",marginBottom:14}}>
            <span style={{fontSize:11,fontWeight:700,color:C.mut,textTransform:"uppercase"}}>Password</span>
            <input type="password" value={loginPassword} onChange={e=>setLoginPassword(e.target.value)} autoComplete={loginMode==="signup"?"new-password":"current-password"} minLength={6}
              style={{...inpStyle,width:"100%",padding:"10px 14px",fontSize:14,marginTop:3}} />
          </label>
          {loginError && <div style={{fontSize:12,color:C.red,marginBottom:10,whiteSpace:"pre-wrap"}}>{loginError}</div>}
          {loginInfo  && <div style={{fontSize:12,color:C.grn,marginBottom:10,whiteSpace:"pre-wrap"}}>{loginInfo}</div>}
          <button type="submit" disabled={loginBusy}
            style={{width:"100%",padding:"12px",borderRadius:8,border:"none",background:loginBusy?C.border:C.gold,color:loginBusy?C.mut:"#000",fontFamily:"inherit",fontSize:14,fontWeight:700,cursor:loginBusy?"default":"pointer"}}>
            {loginBusy ? "Please wait…" : (loginMode==="signup" ? "Create Account" : "Sign In")}
          </button>
          {loginMode === "signup" && (
            <div style={{fontSize:10,color:C.mut,marginTop:12,textAlign:"center",lineHeight:1.5}}>
              New accounts require approval by an existing admin before you can access the app.
            </div>
          )}
        </form>
      </div>
    );
  }

  // 3. Session exists but the coach row hasn't loaded yet — brief loading.
  if (!coach) {
    return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:C.bg,color:C.mut}}>Loading profile…</div>;
  }

  // 4. Logged in but not yet approved by an admin.
  if (!coach.is_approved) {
    return (
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:C.bg,padding:16}}>
        <div style={{background:C.card,padding:32,borderRadius:16,border:"1px solid "+C.border,maxWidth:420,textAlign:"center"}}>
          <div style={{fontSize:24,fontWeight:800,color:C.gold,marginBottom:6}}>◆ Awaiting Approval</div>
          <div style={{fontSize:13,color:C.text,marginBottom:6}}>Hi {coach.display_name || coach.email}.</div>
          <div style={{fontSize:13,color:C.mut,marginBottom:20,lineHeight:1.6}}>
            Your account has been created but an admin needs to approve it before you can access the eval data.
            Ping the Director of Volleyball — they can approve you from the <b>Coaches</b> tab.
          </div>
          <button onClick={async ()=>{ await supabase.auth.signOut(); }}
            style={{padding:"10px 20px",borderRadius:8,border:"1px solid "+C.border,background:"transparent",color:C.mut,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700}}>
            Sign out
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
                  {label:"Pinny",full:"Pinny / tryout number"},{label:"Player"},{label:"Pos"},{label:"Proj"},
                  ...SKILLS.map(s => ({label: SKILL_ABBR[s] || s, full: s})),
                  {label:"Tot"},{label:"Avg"},{label:"Team"},{label:"Notes"},{label:"✓",full:"Evaluation complete"}
                ].map((h,i) =>
                  <th key={i} title={h.full||""} style={{padding:"6px 4px",textAlign:"left",fontSize:9,fontWeight:700,textTransform:"uppercase",color:C.mut,borderBottom:"1px solid "+C.border,background:C.card,position:"sticky",top:0,zIndex:2,whiteSpace:"nowrap",boxShadow:"0 1px 0 "+C.border}}>{h.label}</th>
                )}
              </tr></thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id}>
                    <td style={tdS}><input style={{...inpStyle,width:44,padding:"4px",textAlign:"center",fontSize:12,fontWeight:700,color:p.tryout_number?C.gold:C.text}} value={p.tryout_number||""} placeholder="—" onChange={e=>upd(p.id,{tryout_number:e.target.value})} /></td>
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
          Drag a player onto a team card to assign (clears their roster slot). Drag onto Unassigned, Declined, or Not Invited to change status.
          Click the "+ offer" chip on a team player to cycle offer → accepted → none.
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
      const player = players.find(p => p.id === playerId);
      if (!player) return;
      const now = new Date().toISOString();
      // Terminal-status buckets — clear team assignment and stamp the status.
      if (overId === "bucket-declined") {
        if (player.offer_status === "declined" && !player.team_assignment) return;
        upd(playerId, { team_assignment: "", roster_pos: "", offer_status: "declined", offer_decision_at: now });
        return;
      }
      if (overId === "bucket-not_invited") {
        if (player.offer_status === "not_invited" && !player.team_assignment) return;
        upd(playerId, { team_assignment: "", roster_pos: "", offer_status: "not_invited", offer_made_at: null, offer_decision_at: null });
        return;
      }
      // Team drops (including unassigned via team-""). If the player was declined
      // or not-invited, reset that status — they're back in the offer pipeline.
      if (overId.startsWith("team-")) {
        const newTeam = overId.replace("team-", "");
        const currentTeam = player.team_assignment || "";
        const isTerminal = player.offer_status === "declined" || player.offer_status === "not_invited";
        if (currentTeam === newTeam && !isTerminal) return;
        const updates = { team_assignment: newTeam, roster_pos: "" };
        if (isTerminal) {
          updates.offer_status = "";
          updates.offer_made_at = null;
          updates.offer_decision_at = null;
        }
        upd(playerId, updates);
      }
    };

    // Small pinny-number chip next to a player's name — same source as the
    // Evaluate table's Pinny column (players.tryout_number). Hidden if blank.
    const pinnyChip = (player) => {
      const v = (player.tryout_number || "").trim();
      if (!v) return null;
      return <span title="Pinny #" style={{fontSize:9,fontWeight:800,padding:"1px 6px",borderRadius:8,background:"rgba(255,255,255,0.08)",color:C.text,whiteSpace:"nowrap"}}>#{v}</span>;
    };

    // Click-to-cycle offer-status chip on team-card player rows:
    //   none → "made" → "accepted" → none. Declined / not_invited are set by
    //   dragging to those buckets, not by clicking the chip.
    const cycleOffer = (player) => {
      const cur = player.offer_status || "";
      const now = new Date().toISOString();
      const updates = {};
      if (cur === "" || cur === "declined" || cur === "not_invited") {
        updates.offer_status = "made"; updates.offer_made_at = now; updates.offer_decision_at = null;
      } else if (cur === "made") {
        updates.offer_status = "accepted"; updates.offer_decision_at = now;
      } else {
        updates.offer_status = ""; updates.offer_made_at = null; updates.offer_decision_at = null;
      }
      upd(player.id, updates);
    };
    const offerChip = (player) => {
      const s = player.offer_status || "";
      let label, bg, fg, border = "none";
      if (s === "made")          { label = "OFFER";     bg = "rgba(245,158,11,0.22)"; fg = "#f59e0b"; }
      else if (s === "accepted") { label = "✓ ACCEPTED"; bg = "rgba(34,197,94,0.22)";  fg = C.grn; }
      else                       { label = "+ offer";   bg = "transparent";           fg = C.mut; border = "1px dashed "+C.border; }
      return <span title="Click to cycle: none → offer made → accepted → none"
        onClick={(e) => { e.stopPropagation(); cycleOffer(player); }}
        style={{fontSize:9,fontWeight:800,padding:"1px 6px",borderRadius:8,background:bg,color:fg,whiteSpace:"nowrap",cursor:"pointer",border,userSelect:"none"}}>{label}</span>;
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
            const offerPending  = tp.filter(p => p.offer_status === "made").length;
            const offerAccepted = tp.filter(p => p.offer_status === "accepted").length;
            return (
              <DropZone key={team} id={"team-"+team}
                style={{background:C.card,borderRadius:12,padding:"16px 18px",border:"1px solid "+C.border}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,gap:6,flexWrap:"wrap"}}>
                  <h3 style={{margin:0,fontSize:17,fontWeight:800,color:C.gold}}>{team}</h3>
                  <div style={{display:"flex",gap:4,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>
                    <Tag c={C.acc}>{tp.length} players</Tag>
                    {offerPending  > 0 && <Tag c="#f59e0b">{offerPending} pending</Tag>}
                    {offerAccepted > 0 && <Tag c={C.grn}>{offerAccepted} accepted</Tag>}
                  </div>
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
                            <div style={{display:"flex",gap:3,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>{offerChip(player)}{pinnyChip(player)}{posRankTags(player)}</div>
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
                        <div style={{display:"flex",gap:3,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>{offerChip(p)}{pinnyChip(p)}{posRankTags(p)}</div>
                        <span style={{fontWeight:800,fontSize:13,color:C.gold,minWidth:22,textAlign:"right"}}>{tot(p)||"—"}</span>
                      </div>
                    </DraggablePlayer>
                  ))}
                </div>}
                {tp.length === 0 && <div style={{textAlign:"center",padding:10,color:C.mut,fontSize:11,fontStyle:"italic"}}>Drop players here to add to {team}</div>}
              </DropZone>
            );
          })}
          {/* Unassigned drop zone with position-grouped lists and global rank inputs.
              Declined / not-invited players have their own buckets below, so we
              exclude them here to keep this column focused on players still in play. */}
          {(() => {
            const unassigned = divPlayers.filter(p => !p.team_assignment && p.offer_status !== "declined" && p.offer_status !== "not_invited");
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
                                {pinnyChip(p)}
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
          {/* Declined Offer bucket — players whose families said no. */}
          {(() => {
            const declined = divPlayers.filter(p => p.offer_status === "declined");
            return (
              <DropZone id="bucket-declined" style={{background:C.card,borderRadius:12,padding:"16px 18px",border:"1px solid rgba(245,158,11,0.45)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <h3 style={{margin:0,fontSize:17,fontWeight:800,color:"#f59e0b"}}>Declined Offer</h3>
                  <Tag c="#f59e0b">{declined.length}</Tag>
                </div>
                <div style={{fontSize:10,color:C.mut,marginBottom:8,fontStyle:"italic"}}>Drop a player here when the family has declined. Drag back to a team or Unassigned to reconsider.</div>
                <div style={{display:"flex",flexDirection:"column",gap:3,maxHeight:640,overflowY:"auto"}}>
                  {declined.map(p => (
                    <DraggablePlayer key={p.id} player={p}>
                      <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 8px",background:C.bg,borderRadius:5,fontSize:11}}>
                        <span style={{display:"flex",alignItems:"center",gap:4,flex:1,fontWeight:600,cursor:"pointer"}} onClick={()=>setProfileId(p.id)}>
                          {isReturningDSE(p) && <span title="DS Elite returning athlete" style={{color:C.gold,fontSize:14,fontWeight:800,lineHeight:1}}>◆</span>}
                          {p.first_name} {p.last_name}
                        </span>
                        {pinnyChip(p)}
                        {(p.positions||[]).map(pos => <span key={pos} style={{fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:8,background:"rgba(34,197,94,0.18)",color:C.grn}}>{pos}</span>)}
                        {p.offer_decision_at && <span title="When declined" style={{fontSize:9,color:C.mut,whiteSpace:"nowrap"}}>{new Date(p.offer_decision_at).toLocaleDateString()}</span>}
                      </div>
                    </DraggablePlayer>
                  ))}
                  {declined.length === 0 && <div style={{textAlign:"center",padding:14,color:C.mut,fontSize:11}}>No declined offers</div>}
                </div>
              </DropZone>
            );
          })()}
          {/* Not Invited bucket — players the staff explicitly excluded from offers. */}
          {(() => {
            const notInvited = divPlayers.filter(p => p.offer_status === "not_invited");
            return (
              <DropZone id="bucket-not_invited" style={{background:C.card,borderRadius:12,padding:"16px 18px",border:"1px dashed "+C.border}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <h3 style={{margin:0,fontSize:17,fontWeight:800,color:C.mut}}>Not Invited</h3>
                  <Tag c={C.mut}>{notInvited.length}</Tag>
                </div>
                <div style={{fontSize:10,color:C.mut,marginBottom:8,fontStyle:"italic"}}>Drop players here who aren't being offered a spot. Drag back to a team or Unassigned to reconsider.</div>
                <div style={{display:"flex",flexDirection:"column",gap:3,maxHeight:640,overflowY:"auto"}}>
                  {notInvited.map(p => (
                    <DraggablePlayer key={p.id} player={p}>
                      <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 8px",background:C.bg,borderRadius:5,fontSize:11,opacity:0.85}}>
                        <span style={{display:"flex",alignItems:"center",gap:4,flex:1,fontWeight:600,cursor:"pointer"}} onClick={()=>setProfileId(p.id)}>
                          {isReturningDSE(p) && <span title="DS Elite returning athlete" style={{color:C.gold,fontSize:14,fontWeight:800,lineHeight:1}}>◆</span>}
                          {p.first_name} {p.last_name}
                        </span>
                        {pinnyChip(p)}
                        {(p.positions||[]).map(pos => <span key={pos} style={{fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:8,background:"rgba(34,197,94,0.18)",color:C.grn}}>{pos}</span>)}
                      </div>
                    </DraggablePlayer>
                  ))}
                  {notInvited.length === 0 && <div style={{textAlign:"center",padding:14,color:C.mut,fontSize:11}}>No players marked not invited</div>}
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
      // Pinny # (stored as players.tryout_number). Numeric pinnies sort numerically;
      // blanks sort to the bottom either direction.
      { key:"pinny",  label:"Pinny",  sortable:true,  defDir:"asc",  get:p=>{ const n=parseInt(p.tryout_number); return isNaN(n)?Number.POSITIVE_INFINITY:n; } },
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
                  <td style={tdS}><span style={{fontWeight:700,color:p.tryout_number?C.gold:C.mut}}>{p.tryout_number ? "#"+p.tryout_number : "—"}</span></td>
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
            <div><span style={lbl}>Pinny #</span><input style={editInp} placeholder="e.g. 12" value={p.tryout_number||""} onChange={e=>upd(p.id,{tryout_number:e.target.value})} /></div>
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
          {/* AI parent-facing summary. Calls /api/summarize-player which proxies Anthropic. */}
          <div style={{marginTop:16,padding:"14px 16px",background:C.bg,borderRadius:10,border:"1px solid "+C.border}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
              <div>
                <div style={{fontSize:12,fontWeight:700,color:C.gold,letterSpacing:0.5}}>AI PARENT SUMMARY</div>
                <div style={{fontSize:11,color:C.mut,marginTop:2}}>Generates a warm, parent-facing recap you can paste into an email or use as call talking points.</div>
                {aiSavedAt && aiResult && (
                  <div style={{fontSize:10,color:C.mut,marginTop:4,fontStyle:"italic"}}>
                    Saved · last generated {new Date(aiSavedAt).toLocaleString()}
                  </div>
                )}
              </div>
              <button
                disabled={aiBusy}
                onClick={async () => {
                  setAiBusy(true); setAiError(""); setAiResult(""); setAiCopied(false); setAiInstruction("");
                  try {
                    const res = await fetch("/api/summarize-player", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ player: buildPlayerPayload(p, players) }),
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(data.error || ("Request failed (" + res.status + ")"));
                    const summary = data.summary || "";
                    setAiResult(summary);
                    // Persist so the summary survives closing the profile / refresh.
                    if (summary) {
                      const now = new Date().toISOString();
                      setAiSavedAt(now);
                      upd(p.id, { parent_summary: summary, parent_summary_updated_at: now });
                    }
                  } catch (e) {
                    setAiError(e.message || "Generation failed");
                  } finally {
                    setAiBusy(false);
                  }
                }}
                style={{padding:"8px 14px",borderRadius:8,border:"none",background:aiBusy?C.border:C.gold,color:aiBusy?C.mut:"#000",fontFamily:"inherit",fontSize:12,fontWeight:700,cursor:aiBusy?"default":"pointer"}}>
                {aiBusy ? "Writing..." : (aiResult ? "Regenerate" : "Generate Summary")}
              </button>
            </div>
            {aiError && <div style={{marginTop:10,fontSize:12,color:C.red,whiteSpace:"pre-wrap"}}>{aiError}</div>}
            {aiResult && (
              <div style={{marginTop:12}}>
                <div style={{background:"#0a0a0a",border:"1px solid "+C.border,borderRadius:8,padding:"12px 14px",fontSize:13,lineHeight:1.55,whiteSpace:"pre-wrap",color:C.text}}>{aiResult}</div>
                <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:8}}>
                  <button onClick={() => {
                      if (!window.confirm("Clear the saved parent summary for this player?")) return;
                      setAiResult(""); setAiSavedAt(null); setAiInstruction(""); setAiError("");
                      upd(p.id, { parent_summary: "", parent_summary_updated_at: null });
                    }}
                    style={{padding:"6px 12px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                    Clear saved
                  </button>
                  <button onClick={() => { navigator.clipboard.writeText(aiResult).then(()=>{ setAiCopied(true); setTimeout(()=>setAiCopied(false), 2000); }); }}
                    style={{padding:"6px 12px",borderRadius:6,border:"1px solid "+C.gold,background:"transparent",color:C.gold,fontFamily:"inherit",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                    {aiCopied ? "Copied ✓" : "Copy to clipboard"}
                  </button>
                </div>
                {/* Refine: lets the coach iterate on the generated summary with a follow-up
                    instruction. Sends previous_summary + instruction to /api/summarize-player. */}
                <div style={{marginTop:14,paddingTop:12,borderTop:"1px dashed "+C.border}}>
                  <div style={{fontSize:11,fontWeight:700,color:C.mut,letterSpacing:0.5,marginBottom:6}}>REFINE THIS SUMMARY</div>
                  <textarea
                    value={aiInstruction}
                    onChange={e=>setAiInstruction(e.target.value)}
                    placeholder='e.g. "Make it shorter", "Mention her serving more", "Warmer tone, less formal"'
                    disabled={aiBusy}
                    style={{...editInp,minHeight:54,resize:"vertical",fontSize:12}} />
                  <div style={{display:"flex",justifyContent:"flex-end",marginTop:8}}>
                    <button
                      disabled={aiBusy || !aiInstruction.trim()}
                      onClick={async () => {
                        const instruction = aiInstruction.trim();
                        if (!instruction || !aiResult) return;
                        const previous = aiResult;
                        setAiBusy(true); setAiError(""); setAiCopied(false);
                        try {
                          const res = await fetch("/api/summarize-player", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              player: buildPlayerPayload(p, players),
                              previous_summary: previous,
                              instruction,
                            }),
                          });
                          const data = await res.json().catch(() => ({}));
                          if (!res.ok) throw new Error(data.error || ("Request failed (" + res.status + ")"));
                          const summary = data.summary || "";
                          setAiResult(summary);
                          setAiInstruction("");
                          if (summary) {
                            const now = new Date().toISOString();
                            setAiSavedAt(now);
                            upd(p.id, { parent_summary: summary, parent_summary_updated_at: now });
                          }
                        } catch (e) {
                          setAiError(e.message || "Refinement failed");
                        } finally {
                          setAiBusy(false);
                        }
                      }}
                      style={{padding:"8px 14px",borderRadius:8,border:"none",background:(aiBusy||!aiInstruction.trim())?C.border:C.gold,color:(aiBusy||!aiInstruction.trim())?C.mut:"#000",fontFamily:"inherit",fontSize:12,fontWeight:700,cursor:(aiBusy||!aiInstruction.trim())?"default":"pointer"}}>
                      {aiBusy ? "Refining..." : "Refine Summary"}
                    </button>
                  </div>
                </div>
              </div>
            )}
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

  // ─── COACHES (USER MANAGEMENT) ────────────────────────────────────────
  // Admin-only. Lists every signed-up coach with controls to approve, mark
  // admin, edit display name, and remove. The first signup is auto-approved
  // as admin; all subsequent coaches land here awaiting approval.
  //
  // loadCoaches / loadActivity hooks live at the top of the component (above
  // the auth gates) so the hook-call order is stable across renders. The
  // render and mutation helpers stay here next to their renderXxx fn.

  // Bulk-add: accepts a textarea full of emails separated by any combination
  // of whitespace, commas, semicolons. Lowercases, dedupes, skips invalid.
  const addAllowedEmails = async (raw) => {
    const parts = (raw || "")
      .split(/[\s,;]+/)
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
      .filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
    if (!parts.length) { window.alert("No valid email addresses found in that input."); return; }
    const unique = [...new Set(parts)];
    const rows = unique.map(email => ({
      email,
      added_by: coach.id,
      added_by_name: coach.display_name || coach.email,
      note: null,
    }));
    const { error } = await supabase.from("allowed_signup_emails").upsert(rows, { onConflict: "email" });
    if (error) { window.alert("Add failed: " + error.message); return; }
    setBulkAllowedInput("");
    loadAllowedEmails();
  };
  const removeAllowedEmail = async (email) => {
    if (!window.confirm("Remove " + email + " from the signup allowlist?")) return;
    const { error } = await supabase.from("allowed_signup_emails").delete().eq("email", email);
    if (error) { window.alert("Remove failed: " + error.message); return; }
    loadAllowedEmails();
  };

  const updateCoach = async (id, patch) => {
    // Optimistic local update
    setCoachesList(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
    const { error } = await supabase.from("coaches").update(patch).eq("id", id);
    if (error) { window.alert("Update failed: " + error.message); loadCoaches(); }
    if (id === coach.id) {
      setCoach(prev => prev ? { ...prev, ...patch } : prev);
    }
  };
  const removeCoach = async (target) => {
    if (target.id === coach.id) { window.alert("You can't remove your own account from here. Use Sign Out instead."); return; }
    if (!window.confirm("Remove "+(target.display_name||target.email)+" from the coaches list? Their login still exists in Supabase Auth until you delete it there, but they will no longer be able to access the app.")) return;
    const { error } = await supabase.from("coaches").delete().eq("id", target.id);
    if (error) { window.alert("Remove failed: " + error.message); return; }
    loadCoaches();
  };

  function renderCoaches() {
    if (!isAdmin) {
      return <div style={{padding:24,color:C.mut,textAlign:"center"}}>Coach management is admin-only.</div>;
    }
    const th = {padding:"8px 10px",textAlign:"left",fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut,borderBottom:"1px solid "+C.border,background:C.card,whiteSpace:"nowrap"};
    const td = {padding:"8px 10px",fontSize:12,borderBottom:"1px solid "+C.border,verticalAlign:"middle"};
    const pending = coachesList.filter(c => !c.is_approved);
    return (
      <div>
        {/* Signup allowlist — only emails in this list are permitted to create
            an account. Enforced both server-side (handle_new_user trigger) and
            client-side (is_signup_allowed RPC before the signUp call). */}
        <div style={{background:C.card,borderRadius:12,border:"1px solid "+C.border,padding:"16px 18px",marginBottom:18}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,flexWrap:"wrap",gap:8}}>
            <div>
              <h3 style={{margin:0,fontSize:14,fontWeight:800,color:C.gold,letterSpacing:0.5}}>ALLOWED SIGNUP EMAILS</h3>
              <div style={{fontSize:11,color:C.mut,marginTop:2}}>Only people whose email is on this list can create an account. {allowedEmails.length} on the list.</div>
            </div>
            <button onClick={loadAllowedEmails} disabled={allowedLoading}
              style={{padding:"4px 10px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
              {allowedLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
          <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap",alignItems:"flex-start"}}>
            <textarea value={bulkAllowedInput} onChange={e=>setBulkAllowedInput(e.target.value)}
              placeholder="Paste one or more emails — separated by commas, spaces, or new lines"
              rows={2}
              style={{...inpStyle,flex:"1 1 320px",minHeight:54,padding:"8px 10px",fontSize:12,fontFamily:"inherit",resize:"vertical"}} />
            <button onClick={()=>addAllowedEmails(bulkAllowedInput)} disabled={!bulkAllowedInput.trim()}
              style={{padding:"10px 16px",borderRadius:8,border:"none",background:bulkAllowedInput.trim()?C.gold:C.border,color:bulkAllowedInput.trim()?"#000":C.mut,fontFamily:"inherit",fontSize:12,fontWeight:700,cursor:bulkAllowedInput.trim()?"pointer":"default",alignSelf:"stretch"}}>
              Add
            </button>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,maxHeight:200,overflowY:"auto"}}>
            {allowedEmails.map(row => {
              const hasAccount = coachesList.some(c => (c.email||"").toLowerCase() === row.email.toLowerCase());
              return (
                <span key={row.email}
                  title={(row.added_by_name ? "Added by "+row.added_by_name+" · " : "") + (row.added_at ? new Date(row.added_at).toLocaleDateString() : "") + (hasAccount ? " · signed up" : "")}
                  style={{display:"inline-flex",alignItems:"center",gap:6,padding:"4px 6px 4px 10px",borderRadius:20,background:C.bg,border:"1px solid "+(hasAccount?C.grn:C.border),fontSize:11,color:hasAccount?C.grn:C.text}}>
                  {row.email}
                  <button onClick={()=>removeAllowedEmail(row.email)} title="Remove from allowlist"
                    style={{width:18,height:18,borderRadius:9,border:"none",background:"transparent",color:C.mut,cursor:"pointer",fontFamily:"inherit",fontSize:13,lineHeight:1,padding:0}}>×</button>
                </span>
              );
            })}
            {!allowedEmails.length && <div style={{fontSize:11,color:C.mut,fontStyle:"italic",padding:"8px 0"}}>{allowedLoading ? "Loading…" : "No emails on the allowlist yet."}</div>}
          </div>
          <div style={{fontSize:10,color:C.mut,marginTop:8,lineHeight:1.5}}>
            Green chips have already signed up and appear in the Coaches list below. Removing an email here does not delete an existing account — use the Coaches list for that.
          </div>
        </div>

        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8}}>
          <div>
            <h2 style={{margin:0,fontSize:18,fontWeight:800,color:C.gold}}>Coaches</h2>
            <div style={{fontSize:11,color:C.mut,marginTop:2}}>{coachesList.length} total · {pending.length} awaiting approval</div>
          </div>
          <button onClick={loadCoaches} disabled={coachesLoading}
            style={{padding:"6px 12px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
            {coachesLoading ? "Loading…" : "Refresh"}
          </button>
        </div>
        {pending.length > 0 && (
          <div style={{background:"rgba(245,158,11,0.08)",border:"1px solid rgba(245,158,11,0.35)",borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:12,color:"#f59e0b"}}>
            {pending.length} coach{pending.length===1?" is":"es are"} waiting to be approved.
          </div>
        )}
        <div style={{background:C.card,borderRadius:12,border:"1px solid "+C.border,overflow:"hidden"}}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0}}>
              <thead><tr>
                <th style={th}>Display Name</th>
                <th style={th}>Email</th>
                <th style={th}>Approved</th>
                <th style={th}>Admin</th>
                <th style={th}>Last seen</th>
                <th style={th}>Joined</th>
                <th style={th}></th>
              </tr></thead>
              <tbody>
                {coachesList.map(c => {
                  const isSelf = c.id === coach.id;
                  return (
                    <tr key={c.id} style={{background: c.is_approved ? "transparent" : "rgba(245,158,11,0.05)"}}>
                      <td style={td}>
                        <input style={{...inpStyle,padding:"5px 8px",fontSize:12,width:"100%",minWidth:120}}
                          value={c.display_name||""}
                          onChange={e => updateCoach(c.id, { display_name: e.target.value })}
                          placeholder="(no name)" />
                      </td>
                      <td style={{...td,color:C.mut}}>{c.email}{isSelf && <span style={{color:C.gold,marginLeft:6,fontSize:10}}>(you)</span>}</td>
                      <td style={td}>
                        <label style={{display:"inline-flex",alignItems:"center",gap:6,cursor:isSelf?"default":"pointer"}}>
                          <input type="checkbox" checked={!!c.is_approved} disabled={isSelf}
                            onChange={e => updateCoach(c.id, { is_approved: e.target.checked })}
                            style={{width:16,height:16,accentColor:C.grn,cursor:isSelf?"default":"pointer"}} />
                          <span style={{fontSize:11,color:c.is_approved?C.grn:C.mut,fontWeight:600}}>{c.is_approved?"Yes":"No"}</span>
                        </label>
                      </td>
                      <td style={td}>
                        <label style={{display:"inline-flex",alignItems:"center",gap:6,cursor:isSelf?"default":"pointer"}}>
                          <input type="checkbox" checked={!!c.is_admin} disabled={isSelf}
                            onChange={e => updateCoach(c.id, { is_admin: e.target.checked })}
                            style={{width:16,height:16,accentColor:C.gold,cursor:isSelf?"default":"pointer"}} />
                          <span style={{fontSize:11,color:c.is_admin?C.gold:C.mut,fontWeight:600}}>{c.is_admin?"Yes":"No"}</span>
                        </label>
                      </td>
                      <td style={{...td,color:C.mut,whiteSpace:"nowrap"}}>{c.last_seen_at ? new Date(c.last_seen_at).toLocaleString() : "—"}</td>
                      <td style={{...td,color:C.mut,whiteSpace:"nowrap"}}>{new Date(c.created_at).toLocaleDateString()}</td>
                      <td style={td}>
                        {!isSelf && (
                          <button onClick={()=>removeCoach(c)}
                            style={{padding:"4px 10px",borderRadius:6,border:"1px solid "+C.red,background:"transparent",color:C.red,fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!coachesList.length && <div style={{padding:24,textAlign:"center",color:C.mut,fontSize:12}}>{coachesLoading ? "Loading…" : "No coaches yet."}</div>}
          </div>
        </div>
        <div style={{fontSize:11,color:C.mut,marginTop:10,lineHeight:1.6}}>
          Coaches sign up at the login screen and appear here awaiting your approval.
          Display names show up in the Activity log so coaches see who made each change.
          You can't toggle your own admin / approved flags (use the Supabase Dashboard if you ever need to).
        </div>
      </div>
    );
  }

  // ─── ACTIVITY (AUDIT LOG) ─────────────────────────────────────────────
  // Global feed of every change to a player row, attributed to the coach who
  // made it. Populated server-side by the players_audit trigger.
  // (loadActivity useCallback + useEffect live at the top of the component,
  // above the auth gates, to keep React's hook-call order stable.)

  function renderActivity() {
    // Distinct actors / actions for the filter dropdowns. We compute from the
    // currently-loaded log so a freshly-loaded feed has the right options.
    const distinctActors = Array.from(new Map(
      activityLog.filter(e => e.actor_id).map(e => [e.actor_id, e.actor_name || e.actor_email || "Unknown"])
    ).entries()); // [[id, name], ...]

    const formatChange = (entry) => {
      // For updates: "5 fields changed: scores, notes, …"
      // For insert/delete: name from the row snapshot.
      if (entry.action === "update") {
        const fields = entry.field_changes ? Object.keys(entry.field_changes) : [];
        if (!fields.length) return "(no visible changes)";
        return fields.length === 1 ? "Changed " + fields[0] : fields.length + " fields: " + fields.slice(0,5).join(", ") + (fields.length>5?", …":"");
      }
      const row = entry.field_changes || {};
      const name = ((row.first_name||"") + " " + (row.last_name||"")).trim();
      if (entry.action === "insert") return "Added " + (name || "player #"+(entry.player_id||"?"));
      if (entry.action === "delete") return "Deleted " + (name || "player #"+(entry.player_id||"?"));
      return entry.action;
    };
    const playerName = (entry) => {
      // Try to find current player; fall back to snapshot fields for deletes.
      const p = entry.player_id ? players.find(x => x.id === entry.player_id) : null;
      if (p) return p.first_name + " " + p.last_name;
      const row = entry.field_changes || {};
      const snap = ((row.first_name||"") + " " + (row.last_name||"")).trim();
      return snap || (entry.player_id ? "Player #"+entry.player_id : "—");
    };

    const td = {padding:"7px 10px",fontSize:12,borderBottom:"1px solid "+C.border,verticalAlign:"top"};
    const th = {padding:"8px 10px",textAlign:"left",fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut,borderBottom:"1px solid "+C.border,background:C.card,whiteSpace:"nowrap"};
    return (
      <div>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap"}}>
          <h2 style={{margin:0,fontSize:18,fontWeight:800,color:C.gold}}>Activity</h2>
          <span style={{fontSize:11,color:C.mut}}>Last 300 changes</span>
          <div style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
            <select value={activityActor} onChange={e=>setActivityActor(e.target.value)}
              style={{...inpStyle,padding:"6px 10px",fontSize:12}}>
              <option value="">All coaches</option>
              {distinctActors.map(([id,name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <select value={activityAction} onChange={e=>setActivityAction(e.target.value)}
              style={{...inpStyle,padding:"6px 10px",fontSize:12}}>
              <option value="">All actions</option>
              <option value="update">Updates</option>
              <option value="insert">Adds</option>
              <option value="delete">Deletes</option>
            </select>
            <button onClick={loadActivity} disabled={activityLoading}
              style={{padding:"6px 12px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
              {activityLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>
        <div style={{background:C.card,borderRadius:12,border:"1px solid "+C.border,overflow:"hidden"}}>
          <div style={{overflowX:"auto",maxHeight:"calc(100vh - 220px)"}}>
            <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0}}>
              <thead><tr>
                <th style={th}>When</th>
                <th style={th}>Coach</th>
                <th style={th}>Action</th>
                <th style={th}>Player</th>
                <th style={th}>Change</th>
              </tr></thead>
              <tbody>
                {activityLog.map(entry => {
                  const actionColor = entry.action === "insert" ? C.grn : entry.action === "delete" ? C.red : C.gold;
                  return (
                    <tr key={entry.id}>
                      <td style={{...td,color:C.mut,whiteSpace:"nowrap"}}>{new Date(entry.created_at).toLocaleString()}</td>
                      <td style={td}>{entry.actor_name || entry.actor_email || <span style={{color:C.mut}}>unknown</span>}</td>
                      <td style={td}><span style={{fontSize:10,fontWeight:800,padding:"2px 7px",borderRadius:8,background:actionColor+"22",color:actionColor,textTransform:"uppercase"}}>{entry.action}</span></td>
                      <td style={td}>
                        {entry.player_id
                          ? <span style={{color:C.gold,cursor:"pointer",fontWeight:600}} onClick={()=>{const p = players.find(x=>x.id===entry.player_id); if (p) setProfileId(p.id);}}>{playerName(entry)}</span>
                          : <span style={{color:C.mut}}>{playerName(entry)}</span>}
                      </td>
                      <td style={td}>
                        <div style={{color:C.text}}>{formatChange(entry)}</div>
                        {entry.action === "update" && entry.field_changes && (
                          <details style={{marginTop:4}}>
                            <summary style={{fontSize:10,color:C.mut,cursor:"pointer"}}>Show diff</summary>
                            <pre style={{margin:"4px 0 0 0",padding:8,background:C.bg,border:"1px solid "+C.border,borderRadius:6,fontSize:10,color:C.text,overflow:"auto",maxHeight:200,whiteSpace:"pre-wrap"}}>{JSON.stringify(entry.field_changes, null, 2)}</pre>
                          </details>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!activityLog.length && <div style={{padding:24,textAlign:"center",color:C.mut,fontSize:12}}>{activityLoading ? "Loading…" : "No activity yet."}</div>}
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
          <nav style={{display:"flex",gap:3,flexWrap:"wrap"}}>
            {[
              ["dashboard","Dashboard"],
              ["evaluate","Evaluate"],
              ["teams","Teams"],
              ["rankings","Rankings"],
              ["activity","Activity"],
              ...(isAdmin ? [["coaches","Coaches"]] : []),
            ].map(([v,l]) =>
              <button key={v} style={{padding:"6px 14px",borderRadius:8,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600,background:view===v?C.gold:"transparent",color:view===v?"#000":C.mut}} onClick={()=>setView(v)}>{l}</button>
            )}
          </nav>
          <button onClick={openAddPlayer} title="Add a player from any view"
            style={{padding:"6px 12px",borderRadius:8,border:"1px solid "+C.gold,background:"transparent",color:C.gold,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700}}>
            + Add Player
          </button>
          <div style={{display:"flex",alignItems:"center",gap:6,marginLeft:6,paddingLeft:10,borderLeft:"1px solid "+C.border}}>
            <span style={{fontSize:11,color:C.mut}} title={coach.email}>
              {coach.display_name || coach.email}{isAdmin && <span style={{color:C.gold,marginLeft:4,fontSize:9}}>ADMIN</span>}
            </span>
            <button onClick={async ()=>{ await supabase.auth.signOut(); }}
              title="Sign out"
              style={{padding:"4px 10px",borderRadius:6,border:"1px solid "+C.border,background:"transparent",color:C.mut,cursor:"pointer",fontFamily:"inherit",fontSize:10,fontWeight:700}}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      {view !== "dashboard" && view !== "activity" && view !== "coaches" && (
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
        {view==="activity" && renderActivity()}
        {view==="coaches"  && renderCoaches()}
      </div>
      {profileId !== null && renderProfile()}
      {addingPlayer && renderAddPlayer()}
    </div>
  );
}
