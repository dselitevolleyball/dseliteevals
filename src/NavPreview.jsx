// Dev-only harness for src/Nav.jsx: /?navpreview in `npm run dev`. Mirrors the
// App shell (sidebar + header + content, phone top bar + chips + bottom bar +
// drawer) with sample badge counts and a role switcher, so the navigation can
// be checked without signing in. main.jsx only loads this when import.meta.env.DEV.
import { useEffect, useState } from "react";
import { buildNav, navTheme, Sidebar, NavDrawer, BottomBar, SiblingChips } from "./Nav.jsx";

const C = { bg: "#0a0a0a", card: "#141414", border: "#2a2a2a", gold: "#e91e8c", text: "#ffffff", mut: "#999999" };
const ROLES = {
  admin: { canOps: true, isAdmin: true, isOwner: true, canViewTeams: true, hasTeams: true, canSendReports: true, isDsscDirector: true },
  coach: { canOps: false, isAdmin: false, isOwner: false, canViewTeams: false, hasTeams: true, canSendReports: false, isDsscDirector: false },
  hunter: { canOps: false, isAdmin: false, isOwner: false, canViewTeams: false, hasTeams: false, canSendReports: false, isDsscDirector: true },
};

export default function NavPreview() {
  const [view, setView] = useState("home");
  const [workspace, setWorkspace] = useState("dse");
  const [role, setRole] = useState("admin");
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia("(max-width: 700px)").matches);
  const [isMid, setIsMid] = useState(() => window.matchMedia("(max-width: 1099px)").matches);
  const [collapsed, setCollapsed] = useState(null);
  const [pins, setPins] = useState({});
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    const a = window.matchMedia("(max-width: 700px)"), b = window.matchMedia("(max-width: 1099px)");
    const fa = e => setIsNarrow(e.matches), fb = e => setIsMid(e.matches);
    a.addEventListener("change", fa); b.addEventListener("change", fb);
    return () => { a.removeEventListener("change", fa); b.removeEventListener("change", fb); };
  }, []);
  const ctx = { workspace, ...ROLES[role], pins, counts: { smsDse: 4, smsDssc: 2, notif: 3, issuesOpen: 3, issuesMine: 1, kickoffs: 5, claims: 3, reqs: 2, gear: 1, favorites: 7 } };
  const nav = buildNav(ctx);
  const T = navTheme(workspace, C);
  const sec = nav.sectionOf(view);
  const go = (v) => { setDrawer(false); setView(v); if (["dssc", "clinics", "dssctexts", "dssccrm", "dssccal", "dssctime", "pods", "privates", "dssccamp"].includes(v)) setWorkspace("dssc"); else if (!["home", "notifications", "activity", "faq", "askai"].includes(v)) setWorkspace("dse"); };
  const switchWs = (k) => { setWorkspace(k); setView("home"); };
  const togglePin = (v) => { const cur = nav.pins; const next = cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v].slice(-8); setPins(p => ({ ...p, [nav.ws]: next })); };
  const showSidebar = !isNarrow;
  const isColl = collapsed === null ? isMid : collapsed;
  return (
    <div style={{ fontFamily: "Outfit,sans-serif", background: workspace === "dssc" ? "#104946" : C.bg, color: C.text, minHeight: "100vh", ...(showSidebar ? { display: "flex", alignItems: "flex-start" } : {}) }}>
      {showSidebar && <Sidebar nav={nav} view={view} go={go} switchWs={switchWs} collapsed={isColl} setCollapsed={setCollapsed} togglePin={togglePin} C={C} />}
      <div style={showSidebar ? { flex: "1 1 auto", minWidth: 0 } : undefined}>
        <header style={{ background: workspace === "dssc" ? "linear-gradient(135deg,#0C3A37,#104946)" : "linear-gradient(135deg,#0f0f0f,#1a1a1a)", borderBottom: "1px solid " + T.border, padding: isNarrow ? "calc(8px + env(safe-area-inset-top, 0px)) 10px 8px" : "10px 18px", minHeight: isNarrow ? undefined : 52, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, ...(isNarrow ? { position: "sticky", top: 0, zIndex: 45 } : {}) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: "1 1 auto" }}>
            {isNarrow ? (<>
              <button onClick={() => setDrawer(true)} aria-label="Open menu" style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 10, border: "1px solid " + T.border, background: "transparent", color: T.text, fontSize: 18, cursor: "pointer" }}>☰</button>
              <div style={{ minWidth: 0, lineHeight: 1.15 }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: T.mut, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{workspace === "dssc" ? "DSSC" : "DS Elite"}{sec ? " · " + sec.title : ""}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nav.label(view)}</div>
              </div>
            </>) : (
              <div style={{ fontSize: 13, color: T.mut, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
                {sec && <span>{sec.icon} {sec.title}<span style={{ margin: "0 8px", color: T.dim }}>›</span></span>}
                <span style={{ color: T.text, fontWeight: 800 }}>{nav.label(view)}</span>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: isNarrow ? 2 : 8, alignItems: "center", flex: "0 0 auto", fontSize: 13 }}>
            <select value={role} onChange={e => { setRole(e.target.value); setView("home"); }} style={{ background: "#000", color: "#fff", border: "1px solid #333", borderRadius: 6, padding: 4 }}>
              <option value="admin">Admin</option><option value="coach">Coach</option><option value="hunter">DSSC director</option>
            </select>
            <span style={{ color: C.gold, fontWeight: 800, padding: "6px 10px", border: "1px solid " + C.border, borderRadius: 8 }}>{isNarrow ? "✦" : "✦ Ask HQ"}</span>
            <span style={{ fontSize: 18 }}>💬</span><span style={{ fontSize: 18 }}>🔔</span>
          </div>
        </header>
        {isNarrow && view !== "messages" && view !== "dssctexts" && <SiblingChips nav={nav} view={view} go={go} C={C} />}
        <div style={{ padding: isNarrow ? "14px 18px calc(84px + env(safe-area-inset-bottom, 0px))" : "14px 18px", maxWidth: 1500, margin: "0 auto" }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 20, fontWeight: 800, color: C.gold }}>{nav.icon(view)} {nav.label(view)}</h2>
          {view === "messages" && <div style={{ marginBottom: 12 }}><textarea placeholder="Type a text (focus hides the bottom bar)" style={{ width: "100%", minHeight: 60, background: "#111", color: "#fff", border: "1px solid #333", borderRadius: 8, padding: 8, fontSize: 16 }} /></div>}
          {Array.from({ length: 30 }).map((_, i) => <div key={i} style={{ height: 38, borderRadius: 8, background: "#141414", border: "1px solid #222", marginBottom: 8, padding: "10px 12px", fontSize: 13, color: "#777" }}>Row {i + 1} of {nav.label(view)}</div>)}
        </div>
      </div>
      {isNarrow && <BottomBar nav={nav} view={view} go={go} onMenu={() => setDrawer(d => !d)} menuOpen={drawer} C={C} />}
      {isNarrow && drawer && <NavDrawer nav={nav} view={view} go={go} switchWs={switchWs} togglePin={togglePin} onClose={() => setDrawer(false)} C={C}
        extras={{ onAddPlayer: workspace !== "dssc" ? () => setDrawer(false) : null, onRefresh: () => {}, refreshing: false, userName: "Drew Rose", tag: "ADMIN", onTogglePreview: () => setRole(r => r === "admin" ? "coach" : "admin"), coachPreview: role === "coach", onSignOut: () => {} }} />}
    </div>
  );
}
