import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "./supabase";
import Papa from "papaparse";

const POSITIONS = ["S","OH","MB","RS","L","DS"];
const POS_LABELS = {S:"Setter",OH:"Outside Hitter",MB:"Middle Blocker",RS:"Right Side",L:"Libero",DS:"Def Specialist"};
const SKILLS = ["Serving","Passing","Serve Receive","Attacking","Setting","Blocking","Agility","Communication","Coachability"];
const PROJ_OPTS = ["","1","1/2","2","2/3","3"];
const ROSTER_POS = ["S1","S2","Pin1","Pin2","Pin3","Pin4","M1","M2","M3","L","DS1","DS2","U1","U2"];
const ROSTER_GROUPS = [{label:"Setters",pos:["S1","S2"]},{label:"Pins",pos:["Pin1","Pin2","Pin3","Pin4"]},{label:"Middles",pos:["M1","M2","M3"]},{label:"Libero/DS",pos:["L","DS1","DS2"]},{label:"Utility",pos:["U1","U2"]}];
const DIVS = ["U10","U11","U12","U13","U14","U15","U16"];
const TM = {U10:["11-1","11-2","11-3"],U11:["11-1","11-2","11-3"],U12:["12-1","12-2","12-3"],U13:["13-1","13-2","13-3"],U14:["14-1","14-2","14-3"],U15:["15-1","15-2","15-3"],U16:["16 Diamond","16-1","16-2"]};
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
function avg(p) { const v = Object.values(p.scores||{}); return v.length?(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1):"\u2014"; }

const inpStyle = {background:"#1a1a1a",border:"1px solid "+C.border,borderRadius:6,color:C.text,fontFamily:"inherit",outline:"none"};

function Tag({c,children}) { return <span style={{display:"inline-block",padding:"2px 7px",borderRadius:10,fontSize:10,fontWeight:600,background:c+"22",color:c}}>{children}</span>; }

export default function App() {
  const [authed, setAuthed] = useState(!import.meta.env.VITE_APP_PASSWORD);
  const [pw, setPw] = useState("");
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("dashboard");
  const [activeDiv, setActiveDiv] = useState("U14");
  const [search, setSearch] = useState("");
  const [filterPos, setFilterPos] = useState("");
  const [filterProj, setFilterProj] = useState("");
  const [filterEval, setFilterEval] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [profileId, setProfileId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [saving, setSaving] = useState(false);

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

  useEffect(() => { if (authed) loadPlayers(); }, [authed, loadPlayers]);

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
        
        setUploadMsg("Uploading " + newPlayers.length + " players...");
        const { error } = await supabase.from("players").insert(newPlayers);
        if (error) {
          setUploadMsg("Error: " + error.message); setUploading(false); return;
        }
        setUploadMsg(newPlayers.length + " players uploaded successfully!");
        await loadPlayers();
        setUploading(false);
      },
      error: (err) => { setUploadMsg("Parse error: " + err.message); setUploading(false); }
    });
  }, [loadPlayers]);

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

  const divP = useMemo(() => players.filter(p => (p.usavDiv || p.usav_div) === activeDiv), [players, activeDiv]);

  const filtered = useMemo(() => {
    let l = [...divP];
    if (search) { const s = search.toLowerCase(); l = l.filter(p => (p.first_name + " " + p.last_name).toLowerCase().includes(s)); }
    if (filterPos) l = l.filter(p => (p.positions||[]).includes(filterPos));
    if (filterProj) l = l.filter(p => p.projected_team === filterProj);
    if (filterEval === "done") l = l.filter(p => p.eval_complete);
    if (filterEval === "pending") l = l.filter(p => !p.eval_complete);
    if (sortBy === "name") l.sort((a,b) => (a.last_name||"").localeCompare(b.last_name||""));
    else if (sortBy === "score") l.sort((a,b) => tot(b) - tot(a));
    else if (sortBy === "age") l.sort((a,b) => parseInt(b.age||0) - parseInt(a.age||0));
    else if (sortBy === "proj") { const o = {"1":0,"1/2":1,"2":2,"2/3":3,"3":4,"":5}; l.sort((a,b) => (o[a.projected_team]||5) - (o[b.projected_team]||5)); }
    return l;
  }, [divP, search, filterPos, filterProj, filterEval, sortBy]);

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

  const activeDivs = DIVS.filter(d => players.some(p => (p.usavDiv||p.usav_div) === d));

  function ScoreB({player, skill}) {
    const cur = (player.scores && player.scores[skill]) || 0;
    return <div style={{display:"flex",gap:2}}>{[1,2,3,4,5].map(v => {
      const active = cur === v;
      return <button key={v} style={{width:28,height:26,borderRadius:5,border:active?"2px solid "+C.gold:"1px solid "+C.border,cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:700,
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
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
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
        {/* Age Group Cards */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12}}>
          {activeDivs.map(d => {
            const g = players.filter(p => (p.usavDiv||p.usav_div) === d);
            const ev = g.filter(p => p.eval_complete).length;
            const pct = g.length ? Math.round(ev/g.length*100) : 0;
            return <div key={d} style={{background:C.card,borderRadius:12,padding:"16px 18px",border:"1px solid "+C.border,cursor:"pointer"}} onClick={() => {setActiveDiv(d);setView("evaluate");}}>
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
    const tdS = {padding:"7px 7px",fontSize:12,borderBottom:"1px solid "+C.border,verticalAlign:"middle"};
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
          <select style={{...inpStyle,padding:"7px 10px",fontSize:12}} value={sortBy} onChange={e=>setSortBy(e.target.value)}>
            <option value="name">Name</option><option value="score">Score</option><option value="proj">Projected</option>
          </select>
          <span style={{fontSize:11,color:C.mut,marginLeft:"auto"}}>{saving?"Saving...":filtered.length+" players"}</span>
        </div>
        <div style={{background:C.card,borderRadius:12,border:"1px solid "+C.border,overflow:"hidden"}}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0}}>
              <thead><tr>
                {["#","Player","Prev Team","Pos","Proj",...SKILLS,"Tot","Avg","Team","Status","Notes","TRY","\u2713"].map((h,i) =>
                  <th key={i} style={{padding:"8px 7px",textAlign:"left",fontSize:9,fontWeight:700,textTransform:"uppercase",color:C.mut,borderBottom:"1px solid "+C.border,background:C.card,position:"sticky",top:0,whiteSpace:"nowrap"}}>{h}</th>
                )}
              </tr></thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id}>
                    <td style={tdS}><input style={{...inpStyle,width:30,padding:"3px",textAlign:"center",fontSize:10}} value={p.tryout_number||""} placeholder="\u2014" onChange={e=>upd(p.id,{tryout_number:e.target.value})} /></td>
                    <td style={tdS}>
                      <div style={{cursor:"pointer"}} onClick={()=>setProfileId(p.id)}>
                        <div style={{fontWeight:700,fontSize:12,color:C.gold}}>{p.first_name} {p.last_name}</div>
                        <div style={{fontSize:10,color:C.mut}}>Age {p.age} • {p.usavDiv||p.usav_div}</div>
                        {p.min_level && <Tag c={C.gold}>Min: {p.min_level}</Tag>}
                        {p.supplemental===1 && <Tag c={C.acc}>SUPP</Tag>}
                        {p.status && p.status !== "In Progress" && <Tag c={STATUS_COLORS[p.status]}>{p.status}</Tag>}
                      </div>
                    </td>
                    <td style={tdS}><input style={{...inpStyle,width:100,fontSize:11,padding:"4px 6px"}} placeholder="Prev team..." value={p.current_team||""} onChange={e=>upd(p.id,{current_team:e.target.value})} /></td>
                    <td style={tdS}><PosChips player={p} /></td>
                    <td style={tdS}><select style={{...inpStyle,width:44,fontSize:10,padding:"3px 1px"}} value={p.projected_team||""} onChange={e=>upd(p.id,{projected_team:e.target.value})}>{PROJ_OPTS.map(o=><option key={o} value={o}>{o||"\u2014"}</option>)}</select></td>
                    {SKILLS.map(sk=><td key={sk} style={tdS}><ScoreB player={p} skill={sk} /></td>)}
                    <td style={tdS}><span style={{fontWeight:800,fontSize:14,color:tot(p)?C.gold:C.mut}}>{tot(p)||"\u2014"}</span></td>
                    <td style={tdS}><span style={{fontWeight:600,fontSize:12}}>{avg(p)}</span></td>
                    <td style={tdS}>
                      <select style={{...inpStyle,fontSize:10,padding:"3px",width:90}} value={p.team_assignment||""} onChange={e=>upd(p.id,{team_assignment:e.target.value,roster_pos:""})}>
                        <option value="">{"\u2014"}</option>{(TM[activeDiv]||[]).map(t=><option key={t} value={t}>{t}</option>)}
                      </select>
                      {p.team_assignment && <select style={{...inpStyle,fontSize:9,padding:"2px",width:58,marginTop:2,display:"block"}} value={p.roster_pos||""} onChange={e=>upd(p.id,{roster_pos:e.target.value})}>
                        <option value="">Roster</option>
                        {ROSTER_POS.map(rp => { const taken = players.some(o=>o.id!==p.id&&o.team_assignment===p.team_assignment&&o.roster_pos===rp); return <option key={rp} value={rp} disabled={taken}>{rp}{taken?" \u2713":""}</option>; })}
                      </select>}
                    </td>
                    <td style={tdS}>
                      <select style={{...inpStyle,fontSize:10,padding:"3px",width:85,color:STATUS_COLORS[p.status||"In Progress"]}} value={p.status||"In Progress"} onChange={e=>upd(p.id,{status:e.target.value})}>
                        {STATUS_OPTS.map(s=><option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td style={tdS}><input style={{...inpStyle,width:140,fontSize:11,padding:"4px 6px"}} placeholder="Notes..." value={p.notes||""} onChange={e=>upd(p.id,{notes:e.target.value})} /></td>
                    <td style={tdS}><input type="checkbox" checked={p.supplemental===1} onChange={e=>upd(p.id,{supplemental:e.target.checked?1:0})} style={{width:16,height:16,cursor:"pointer",accentColor:"#ff69b4"}} title="Using eval as tryout" /></td>
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
  function renderTeams() {
    const teams = TM[activeDiv]||[];
    return (
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))",gap:14}}>
        {teams.map(team => {
          const tp = divP.filter(p=>p.team_assignment===team);
          const rosterMap = {}; tp.forEach(p=>{ if(p.roster_pos) rosterMap[p.roster_pos]=p; });
          const unslotted = tp.filter(p=>!p.roster_pos);
          return (
            <div key={team} style={{background:C.card,borderRadius:12,padding:"16px 18px",border:"1px solid "+C.border}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <h3 style={{margin:0,fontSize:17,fontWeight:800,color:C.gold}}>{team}</h3>
                <Tag c={C.acc}>{tp.length} players</Tag>
              </div>
              {ROSTER_GROUPS.map(grp => (
                <div key={grp.label} style={{marginBottom:10}}>
                  <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.mut,marginBottom:4}}>{grp.label}</div>
                  {grp.pos.map(rp => {
                    const player = rosterMap[rp];
                    return <div key={rp} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 8px",marginBottom:2,background:C.bg,borderRadius:6,border:player?"1px solid "+C.border:"1px dashed "+C.border}}>
                      <span style={{fontSize:11,fontWeight:700,color:player?C.gold:C.mut,minWidth:36}}>{rp}</span>
                      {player ? <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flex:1,cursor:"pointer"}} onClick={()=>setProfileId(player.id)}>
                        <span style={{fontSize:12,fontWeight:600}}>{player.first_name} {player.last_name}</span>
                        <span style={{fontWeight:800,fontSize:13,color:C.gold}}>{tot(player)||"\u2014"}</span>
                      </div> : <span style={{fontSize:11,color:C.mut,fontStyle:"italic"}}>open</span>}
                    </div>;
                  })}
                </div>
              ))}
              {unslotted.length>0 && <div style={{marginTop:6}}>
                <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:C.acc,marginBottom:4}}>No Roster Position</div>
                {unslotted.map(p => <div key={p.id} style={{display:"flex",justifyContent:"space-between",padding:"5px 8px",marginBottom:2,background:C.bg,borderRadius:6,cursor:"pointer",border:"1px solid rgba(233,30,140,0.3)"}} onClick={()=>setProfileId(p.id)}>
                  <span style={{fontSize:12,fontWeight:600}}>{p.first_name} {p.last_name}</span>
                  <span style={{fontWeight:800,fontSize:13,color:C.gold}}>{tot(p)||"\u2014"}</span>
                </div>)}
              </div>}
            </div>
          );
        })}
        {/* Unassigned */}
        <div style={{background:C.card,borderRadius:12,padding:"16px 18px",border:"1px solid rgba(239,68,68,0.3)"}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
            <h3 style={{margin:0,fontSize:17,fontWeight:800,color:C.red}}>Unassigned</h3>
            <Tag c={C.red}>{divP.filter(p=>!p.team_assignment).length}</Tag>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:3,maxHeight:400,overflowY:"auto"}}>
            {divP.filter(p=>!p.team_assignment).sort((a,b)=>tot(b)-tot(a)).map(p =>
              <div key={p.id} style={{display:"flex",justifyContent:"space-between",padding:"5px 8px",background:C.bg,borderRadius:5,fontSize:11,cursor:"pointer"}} onClick={()=>setProfileId(p.id)}>
                <span style={{fontWeight:600}}>{p.first_name} {p.last_name}</span>
                <div style={{display:"flex",gap:4,alignItems:"center"}}>
                  {p.projected_team && <Tag c={C.gold}>{p.projected_team}</Tag>}
                  <span style={{fontWeight:700,color:C.gold}}>{tot(p)||"\u2014"}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── RANKINGS ───
  function renderRankings() {
    const ranked = [...divP].filter(p=>tot(p)>0).sort((a,b)=>tot(b)-tot(a));
    const shown = filterPos ? ranked.filter(p=>(p.positions||[]).includes(filterPos)) : ranked;
    const tdS = {padding:"7px 7px",fontSize:12,borderBottom:"1px solid "+C.border,verticalAlign:"middle"};
    return (
      <div>
        <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center"}}>
          <span style={{fontSize:12,color:C.mut,fontWeight:600}}>Rank by position:</span>
          <select style={{...inpStyle,padding:"7px 10px",fontSize:12}} value={filterPos} onChange={e=>setFilterPos(e.target.value)}>
            <option value="">All</option>{POSITIONS.map(p=><option key={p} value={p}>{p} - {POS_LABELS[p]}</option>)}
          </select>
          <span style={{fontSize:11,color:C.mut,marginLeft:"auto"}}>{shown.length} ranked</span>
        </div>
        <div style={{background:C.card,borderRadius:12,border:"1px solid "+C.border,overflow:"hidden"}}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0}}>
              <thead><tr>{["Rank","Player","Age","Pos","Proj",...SKILLS,"Total","Avg","Team"].map((h,i)=><th key={i} style={{padding:"8px 7px",textAlign:"left",fontSize:9,fontWeight:700,textTransform:"uppercase",color:C.mut,borderBottom:"1px solid "+C.border,background:C.card,position:"sticky",top:0,whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
              <tbody>{shown.map((p,i) => (
                <tr key={p.id}>
                  <td style={tdS}><span style={{fontWeight:800,fontSize:15,color:i<3?C.gold:C.mut}}>#{i+1}</span></td>
                  <td style={tdS}><span style={{fontWeight:700,fontSize:12,color:C.gold,cursor:"pointer"}} onClick={()=>setProfileId(p.id)}>{p.first_name} {p.last_name}</span></td>
                  <td style={tdS}>{p.age}</td>
                  <td style={tdS}><div style={{display:"flex",gap:2,flexWrap:"wrap"}}>{(p.positions||[]).map(pos=><Tag key={pos} c={C.grn}>{pos}</Tag>)}</div></td>
                  <td style={tdS}>{p.projected_team && <Tag c={C.gold}>{p.projected_team}</Tag>}</td>
                  {SKILLS.map(sk=><td key={sk} style={tdS}><span style={{fontWeight:600,color:(p.scores||{})[sk]>=4?C.grn:(p.scores||{})[sk]>=3?C.gold:(p.scores||{})[sk]?C.red:C.mut}}>{(p.scores||{})[sk]||"\u2014"}</span></td>)}
                  <td style={tdS}><span style={{fontWeight:800,fontSize:15,color:C.gold}}>{tot(p)}</span></td>
                  <td style={tdS}><span style={{fontWeight:600}}>{avg(p)}</span></td>
                  <td style={tdS}><Tag c={p.team_assignment?C.grn:C.mut}>{p.team_assignment||"\u2014"}</Tag></td>
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
              <h2 style={{margin:0,fontSize:22,fontWeight:800,color:C.gold}}>{p.first_name} {p.last_name}</h2>
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
          {/* Team/Roster/Prev/Status */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr",gap:12,marginBottom:14}}>
            <div><span style={lbl}>Projected</span><select style={editInp} value={p.projected_team||""} onChange={e=>upd(p.id,{projected_team:e.target.value})}>{PROJ_OPTS.map(o=><option key={o} value={o}>{o||"--"}</option>)}</select></div>
            <div><span style={lbl}>Team</span><select style={editInp} value={p.team_assignment||""} onChange={e=>upd(p.id,{team_assignment:e.target.value,roster_pos:""})}><option value="">--</option>{(TM[p.usavDiv||p.usav_div]||[]).map(t=><option key={t} value={t}>{t}</option>)}</select></div>
            <div><span style={lbl}>Roster Pos</span><select style={editInp} value={p.roster_pos||""} onChange={e=>upd(p.id,{roster_pos:e.target.value})}><option value="">--</option>{ROSTER_POS.map(rp=>{const taken=players.some(o=>o.id!==p.id&&o.team_assignment===p.team_assignment&&o.roster_pos===rp);return <option key={rp} value={rp} disabled={taken}>{rp}{taken?" (taken)":""}</option>;})}</select></div>
            <div><span style={lbl}>Status</span><select style={{...editInp,color:STATUS_COLORS[p.status||"In Progress"]}} value={p.status||"In Progress"} onChange={e=>upd(p.id,{status:e.target.value})}>{STATUS_OPTS.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
            <div><span style={lbl}>Prev Season Team</span><input style={editInp} placeholder="e.g. DSE 13 Diamond" value={p.current_team||""} onChange={e=>upd(p.id,{current_team:e.target.value})} /></div>
          </div>
          {/* Notes */}
          <div style={{marginBottom:14}}><span style={lbl}>Coach Notes</span><textarea style={{...editInp,minHeight:70,resize:"vertical"}} placeholder="Notes..." value={p.notes||""} onChange={e=>upd(p.id,{notes:e.target.value})} /></div>
          {/* Eval Dates */}
          <div style={{marginBottom:14}}>
            <span style={lbl}>Eval Sessions</span>
            <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{EVAL_DATES.map(d => {
              const active = (p.eval_dates||[]).includes(d);
              return <button key={d} style={{padding:"6px 12px",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer",border:active?"2px solid "+C.gold:"1px solid "+C.border,background:active?"rgba(233,30,140,0.2)":"transparent",color:active?C.gold:C.mut}}
                onClick={()=>{const next=active?(p.eval_dates||[]).filter(x=>x!==d):[...(p.eval_dates||[]),d]; upd(p.id,{eval_dates:next});}}>{d}</button>;
            })}</div>
          </div>
          {/* Registration Info */}
          <div style={{background:C.bg,borderRadius:10,padding:14}}>
            <div style={{fontSize:11,fontWeight:700,color:C.gold,marginBottom:10}}>REGISTRATION INFO & INTAKE</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
              <div><span style={lbl}>Parent</span><div style={{fontSize:13}}>{p.parent_name||"\u2014"}</div></div>
              <div><span style={lbl}>Contact</span><div style={{fontSize:11,wordBreak:"break-all"}}>{p.parent_email}<br/>{p.parent_phone}</div></div>
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
          {/* Mark Complete */}
          <div style={{display:"flex",alignItems:"center",gap:10,marginTop:8,padding:"12px 16px",background:p.eval_complete?"rgba(34,197,94,0.1)":C.bg,borderRadius:10,border:"1px solid "+(p.eval_complete?C.grn:C.border),cursor:"pointer"}} onClick={()=>upd(p.id,{eval_complete:!p.eval_complete})}>
            <input type="checkbox" checked={!!p.eval_complete} readOnly style={{width:20,height:20,accentColor:C.gold,cursor:"pointer"}} />
            <span style={{fontSize:14,fontWeight:700,color:p.eval_complete?C.grn:C.mut}}>{p.eval_complete?"Evaluation Complete ✓":"Mark Evaluation Complete"}</span>
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
        <nav style={{display:"flex",gap:3}}>
          {[["dashboard","Dashboard"],["evaluate","Evaluate"],["teams","Teams"],["rankings","Rankings"]].map(([v,l]) =>
            <button key={v} style={{padding:"6px 14px",borderRadius:8,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600,background:view===v?C.gold:"transparent",color:view===v?"#000":C.mut}} onClick={()=>setView(v)}>{l}</button>
          )}
        </nav>
      </header>
      {view !== "dashboard" && (
        <div style={{display:"flex",gap:4,padding:"10px 18px",borderBottom:"1px solid "+C.border,flexWrap:"wrap"}}>
          {activeDivs.map(d =>
            <button key={d} style={{padding:"5px 14px",borderRadius:16,border:"1px solid "+(activeDiv===d?C.gold:C.border),background:activeDiv===d?"rgba(233,30,140,0.12)":"transparent",color:activeDiv===d?C.gold:C.mut,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600}}
              onClick={()=>{setActiveDiv(d);setSearch("");setFilterPos("");setFilterProj("");setFilterEval("all");}}>
              {d} ({players.filter(p=>(p.usavDiv||p.usav_div)===d).length})
            </button>
          )}
        </div>
      )}
      <div style={{padding:"14px 18px",maxWidth:1500,margin:"0 auto"}}>
        {view==="dashboard" && renderDashboard()}
        {view==="evaluate" && renderEval()}
        {view==="teams" && renderTeams()}
        {view==="rankings" && renderRankings()}
      </div>
      {profileId !== null && renderProfile()}
    </div>
  );
}
