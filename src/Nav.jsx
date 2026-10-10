// App navigation (Drew, Oct 2026: "the navigation for the admin is super
// messy"). One list - buildNav() - drives every surface:
//   desktop  : <Sidebar> on the left, grouped by job, collapsible to an icon
//              rail (button or the [ key; auto-rail under 1100px wide)
//   phone    : <BottomBar> (first 4 pins + Menu), <NavDrawer> (everything,
//              vertical, thumb-sized rows) and <SiblingChips> (the other
//              screens in the current section, one tap apart)
// Every item's gate mirrors the screen guards in App.jsx (OPS_VIEWS, the
// per-view isAdmin / canViewTeams / isDsscDirector checks), so nobody sees a
// row that opens "restricted". Add a screen = one line in IT + one in a section.
import { useEffect, useMemo, useRef, useState } from "react";

// view -> [label, icon, gate, search aliases, short label for the phone bar]
// Gates: all | ops | admin | owner | teams | mine | duty | reports | opsMine | opsTeams | dir
const IT = {
  home:          ["Home", "🏠", "all", "dashboard start", "Home"],
  dayschedule:   ["Day Schedule", "🕘", "admin", "hour by hour coverage who is working", "Day"],
  practice:      ["Practice Board", "📋", "ops", "practice daily board courts scrimmage", "Practice"],
  coverage:      ["Coach Coverage", "🔁", "ops", "subs sub coverage", "Coverage"],
  staffing:      ["Staffing Board", "🧩", "admin", "staffing", "Staffing"],
  sa:            ["S&A Schedule", "💪", "ops", "strength agility", "S&A"],
  clockin:       ["Clock In", "⏱", "all", "timesheet hours", "Clock In"],
  messages:      ["Texts", "💬", "ops", "messages sms text", "Texts"],
  email:         ["Email", "✉️", "ops", "mail", "Email"],
  notifications: ["Notifications", "🔔", "all", "alerts", "Alerts"],
  coachcomms:    ["SportsYou Posts", "📣", "ops", "coach comms sportsyou posts", "Posts"],
  assignments:   ["Post Assignments", "📝", "ops", "assignments sportsyou", "Assign"],
  teamdir:       ["All Teams", "🏐", "opsTeams", "teams directory", "Teams"],
  roster:        ["Roster", "👥", "opsMine", "players", "Roster"],
  incidentboard: ["Issue Board", "🚩", "ops", "injury injuries issues incidents", "Issues"],
  incidents:     ["Issues & Injuries", "🩹", "mine", "injury injuries incidents", "Issues"],
  school:        ["School Teams", "🏫", "ops", "high school middle school", "School"],
  schoolgames:   ["School Games", "🗓", "ops", "school schedule", "Games"],
  photos:        ["Team Photos", "📸", "ops", "pictures", "Photos"],
  waiting:       ["Waiting on", "⏳", "ops", "forms owe owed missing nudges", "Waiting"],
  tracker:       ["Registration Tracker", "📊", "ops", "tracker registration payments paid sportsengine", "Tracker"],
  kickoff:       ["Kickoffs", "🎉", "ops", "kickoff parties", "Kickoffs"],
  playergear:    ["Player Gear Orders", "👕", "ops", "gear orders uniforms shoes", "Gear"],
  scholarships:  ["Scholarships", "🎓", "ops", "financial aid", "Scholar"],
  tournaments:   ["Tournaments", "🏆", "ops", "aes lone star events schedule", "Events"],
  workduty:      ["Work Duty", "🦺", "duty", "work matches officiating", "Work"],
  tournament:    ["In-House Tournament", "🥇", "all", "in house", "In-House"],
  dsysa:         ["DSYSA Clinics", "⚽", "all", "dsysa", "DSYSA"],
  travel:        ["Travel", "✈️", "admin", "flights trips", "Travel"],
  housing:       ["Housing", "🏨", "admin", "hotel rooms", "Housing"],
  hawaii:        ["Hawaii", "🌺", "admin", "paniolo trip", "Hawaii"],
  coaches:       ["Coaches", "🧑‍🏫", "admin", "staff", "Coaches"],
  requests:      ["Time-off Requests", "🙋", "ops", "requests time off", "Time off"],
  gear:          ["Coach Gear Sizes", "📏", "ops", "gear sizes coach uniforms", "Gear sizes"],
  timecards:     ["Time Cards", "🕒", "ops", "payroll hours", "Time"],
  claims:        ["Coach Claims", "🧾", "ops", "payroll expenses reimburse", "Claims"],
  myexpenses:    ["My Expenses", "💳", "all", "expenses receipts", "Expenses"],
  finance:       ["Finance", "💵", "admin", "money budget", "Finance"],
  lineups:       ["Lineups", "📋", "all", "rotations", "Lineups"],
  practiceplan:  ["Playbook", "📖", "all", "practice plans drills", "Playbook"],
  checkin:       ["Quick Check-in", "✅", "mine", "check in", "Check-in"],
  playereval:    ["Player Evaluations", "📝", "all", "evaluations", "Evals"],
  passing:       ["Passer Ratings", "🎯", "all", "passing serve receive", "Passing"],
  testreports:   ["Testing Reports", "📈", "reports", "reach stat reports", "Reports"],
  games:         ["4v4 Practice Games", "🎲", "all", "games 4v4", "Games"],
  dashboard:     ["Tryout Dashboard", "📊", "all", "dashboard tryouts", "Tryouts"],
  evaluate:      ["Evaluate", "✍️", "all", "tryout evaluate", "Evaluate"],
  favorites:     ["My Favorites", "⭐", "all", "favorites", "Favorites"],
  teams:         ["Team Formation", "🧮", "teams", "teams formation", "Teams"],
  rankings:      ["Rankings", "🏅", "all", "rankings", "Rankings"],
  physical:      ["Physical Testing", "🏃", "all", "vertical broad jump approach", "Testing"],
  tryouts:       ["Tryout Coach Assignments", "🗂", "all", "coach assignments tryouts", "Assign"],
  // DSSC
  clinics:       ["Clinics & Camps Board", "🗂", "dir", "board clinics camps", "Board"],
  dssccamp:      ["Heatwave Camp", "🔥", "dir", "camp heatwave", "Heatwave"],
  pods:          ["Skill Pods", "🧠", "ops", "pods", "Pods"],
  privates:      ["Privates", "🤝", "ops", "private lessons", "Privates"],
  dssctexts:     ["DSSC Texts", "💬", "dir", "sms text messages", "Texts"],
  dssccrm:       ["People", "📇", "dir", "crm families contacts", "People"],
  dssc:          ["Coach Hub", "🏠", "all", "hub", "Hub"],
  dssccal:       ["Coverage Calendar", "📅", "ops", "coverage calendar shifts", "Coverage"],
  dssctime:      ["DSSC Time Cards", "🕒", "all", "payroll hours", "Time"],
  // Footer
  activity:      ["Activity Log", "🕓", "all", "history changes", "Activity"],
  faq:           ["FAQ", "❓", "all", "help", "FAQ"],
  askai:         ["Ask AI", "✦", "owner", "ai", "Ask AI"],
};

const DSE_OPS = [
  ["today", "Today & schedule", "📅", ["home", "dayschedule", "practice", "coverage", "staffing", "sa", "clockin"]],
  ["talk", "Talk to people", "💬", ["messages", "email", "notifications", "coachcomms", "assignments"]],
  ["teams", "Teams & players", "🏐", ["teamdir", "roster", "incidentboard", "incidents", "school", "schoolgames", "photos"]],
  ["families", "Families & signups", "👪", ["waiting", "tracker", "kickoff", "playergear", "scholarships"]],
  ["events", "Tournaments & travel", "✈️", ["tournaments", "workduty", "tournament", "dsysa", "travel", "housing", "hawaii"]],
  ["staff", "Staff, pay & finance", "💵", ["coaches", "requests", "gear", "timecards", "claims", "myexpenses", "finance"]],
  ["court", "On the court", "📖", ["lineups", "practiceplan", "checkin", "playereval", "passing", "testreports", "games"]],
  ["tryouts", "Tryouts 2026-27", "🎯", ["dashboard", "evaluate", "favorites", "teams", "rankings", "physical", "tryouts"]],
];
// Coaches get their own short order instead of the admin list with holes in it.
const DSE_COACH = [
  ["mine", "My teams", "🏐", ["incidents", "checkin", "workduty"]],
  ["court", "On the court", "📖", ["lineups", "practiceplan", "playereval", "passing", "games", "testreports"]],
  ["me", "Me", "🙋", ["home", "clockin", "notifications", "myexpenses"]],
  ["events", "Events", "🏆", ["tournament", "dsysa"]],
  ["tryouts", "Tryouts 2026-27", "🎯", ["dashboard", "evaluate", "favorites", "teams", "rankings", "physical", "tryouts"]],
];
const DSSC_SECS = [
  ["programs", "Programs", "🏕", ["clinics", "dssccamp", "pods", "privates"]],
  ["people", "Texts & people", "💬", ["dssctexts", "dssccrm"]],
  ["dsscstaff", "Coaches & pay", "🗓", ["dssc", "dssccal", "dssctime"]],
];
const FOOTER = ["activity", "faq", "askai"];

const ACTION_BADGES = { messages: "smsDse", dssctexts: "smsDssc", notifications: "notif", incidentboard: "issuesOpen", incidents: "issuesMine", kickoff: "kickoffs", claims: "claims", requests: "reqs", gear: "gear" };
const INFO_BADGES = { favorites: "favorites" };

export function buildNav(ctx) {
  const { canOps, isAdmin, isOwner, canViewTeams, hasTeams, canSendReports, isDsscDirector } = ctx;
  const n = ctx.counts || {};
  const ok = {
    all: true, ops: !!canOps, admin: !!isAdmin, owner: !!isOwner, teams: !!canViewTeams,
    mine: !!(canViewTeams || hasTeams), duty: !!(canViewTeams || canOps || hasTeams), reports: !!canSendReports,
    opsMine: !!(canOps && (canViewTeams || hasTeams)), opsTeams: !!(canOps && canViewTeams), dir: !!isDsscDirector,
  };
  const can = (v) => !!IT[v] && ok[IT[v][2]];
  const secsFor = (ws) => {
    const base = ws === "dssc" ? DSSC_SECS : (canOps ? DSE_OPS : DSE_COACH);
    return base.map(([key, title, icon, views]) => ({ key, title, icon, items: views.filter(can) })).filter(s => s.items.length);
  };
  const ws = ctx.workspace === "dssc" ? "dssc" : "dse";
  const sections = secsFor(ws);
  const footer = FOOTER.filter(can);
  const visible = new Set(["home", ...footer, ...sections.flatMap(s => s.items)]);
  const badge = (v) => { const k = ACTION_BADGES[v]; return k && can(v) ? Number(n[k] || 0) : 0; };
  const info = (v) => { const k = INFO_BADGES[v]; return k ? Number(n[k] || 0) : 0; };
  const counts = (s, v) => !(v === "incidents" && s.items.includes("incidentboard")); // the board already counts these
  const sectionTotal = (s) => s.items.reduce((sum, v) => sum + (counts(s, v) ? badge(v) : 0), 0);
  // Menu badge on the phone: everything the bottom-bar slots don't already show.
  const restTotal = (shown) => sections.reduce((sum, s) => sum + s.items.reduce((t, v) => t + (!shown.includes(v) && counts(s, v) ? badge(v) : 0), 0), 0);
  const defaults = ws === "dssc"
    ? (isDsscDirector ? ["clinics", "dssctexts", canOps ? "dssccal" : "dssctime", "dssctime", "dssccrm"] : ["dssc", "dssctime", "notifications"])
    : (canOps ? ["home", "messages", isAdmin ? "dayschedule" : "coverage", "practice", "tournaments", "waiting"] : ["home", "clockin", "lineups", "practiceplan"]);
  const stored = ctx.pins && Array.isArray(ctx.pins[ws]) ? ctx.pins[ws] : null;
  const pinsBase = [...new Set(stored || defaults)];
  const pins = pinsBase.filter(v => visible.has(v));
  const other = secsFor(ws === "dssc" ? "dse" : "dssc");
  // Search covers both businesses; picking the other one's screen flips the
  // workspace (App's view -> workspace effect does that).
  const searchList = [];
  const seen = new Set();
  for (const [w, secs] of [[ws, sections], [ws === "dssc" ? "dse" : "dssc", other]]) {
    for (const s of secs) for (const v of s.items) if (!seen.has(v)) { seen.add(v); searchList.push({ v, sec: s.title, ws: w }); }
  }
  for (const v of footer) if (!seen.has(v)) { seen.add(v); searchList.push({ v, sec: "", ws }); }
  // Screens both businesses share (Home, Notifications...) only borrow a
  // section from the business you're in, never from the other one.
  const NEUTRAL = new Set(["home", "notifications", "activity", "faq", "askai"]);
  const sectionOf = (v) => sections.find(s => s.items.includes(v)) || (NEUTRAL.has(v) ? null : other.find(s => s.items.includes(v))) || null;
  return {
    ws, sections, footer, pins, pinsBase, visible, badge, info, sectionTotal, restTotal, sectionOf, searchList,
    label: (v) => (IT[v] ? IT[v][0] : v), icon: (v) => (IT[v] ? IT[v][1] : "•"), short: (v) => (IT[v] ? IT[v][4] : v),
    search: (q) => {
      const s = String(q || "").trim().toLowerCase();
      if (!s) return [];
      const scored = [];
      for (const it of searchList) {
        const lab = IT[it.v][0].toLowerCase(), al = IT[it.v][3] || "";
        let sc = -1;
        if (lab.startsWith(s)) sc = 0;
        else if (lab.split(/[\s&-]+/).some(w => w.startsWith(s))) sc = 1;
        else if (lab.includes(s)) sc = 2;
        else if ((" " + al + " ").includes(" " + s)) sc = 3;
        else if ((it.sec || "").toLowerCase().includes(s)) sc = 4;
        if (sc >= 0) scored.push({ ...it, sc: sc + (it.ws === ws ? 0 : 0.5) });
      }
      return scored.sort((a, b) => a.sc - b.sc).slice(0, 9);
    },
  };
}

export function navTheme(ws, C) {
  return ws === "dssc"
    ? { bg: "#0C3A37", panel: "#0E4541", border: "rgba(255,255,255,0.14)", accent: "#B2D049", onAccent: "#104946", text: "#FFFFFF", mut: "#A9C7C3", dim: "#7FA6A1", active: "rgba(178,208,73,0.14)", hover: "rgba(255,255,255,0.07)" }
    : { bg: "#0f0f0f", panel: "#151515", border: (C && C.border) || "#2a2a2a", accent: (C && C.gold) || "#e91e8c", onAccent: "#000", text: "#FFFFFF", mut: "#a3a3a3", dim: "#6f6f6f", active: "rgba(233,30,140,0.13)", hover: "rgba(255,255,255,0.06)" };
}

const readJSON = (k, d) => { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : d; } catch { return d; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

// One shared stylesheet: hover states and the drawer slide-in can't be inline.
const NAV_CSS = `
.dse-nr{transition:background .12s}
.dse-nr:hover{background:var(--dse-hover)}
.dse-nr .dse-star{opacity:0;transition:opacity .12s}
.dse-nr:hover .dse-star,.dse-star.on{opacity:.85}
.dse-nav-scroll{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.18) transparent}
.dse-nav-scroll::-webkit-scrollbar{width:6px}
.dse-nav-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.18);border-radius:3px}
.dse-chips{scrollbar-width:none}.dse-chips::-webkit-scrollbar{display:none}
@keyframes dse-drawer-in{from{transform:translateX(-100%)}to{transform:none}}
@keyframes dse-fade-in{from{opacity:0}to{opacity:1}}
@media (hover:none){.dse-nr .dse-star{opacity:.55}}
html.dse-nav-lock{overflow:hidden}
`;
export function NavStyles() { return <style>{NAV_CSS}</style>; }

function Pill({ n, T, info }) {
  if (!n) return null;
  return <span style={{ minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: info ? "rgba(255,255,255,0.12)" : T.accent, color: info ? T.mut : T.onAccent, fontSize: 10, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, lineHeight: 1 }}>{n > 99 ? "99+" : n}</span>;
}

function Logo({ ws, T, small, onClick }) {
  if (ws === "dssc") return <img src="/dssc/logo-horizontal-white.png" alt="Dripping Springs Sports Club" onClick={onClick} style={{ height: small ? 18 : 26, width: "auto", cursor: "pointer", display: "block", maxWidth: "100%" }} />;
  return (
    <div onClick={onClick} style={{ fontSize: small ? 20 : 18, fontWeight: 800, color: T.accent, display: "flex", alignItems: "center", gap: 7, cursor: "pointer", whiteSpace: "nowrap" }}>
      <span style={{ fontSize: small ? 22 : 20 }}>◆</span>{!small && <>DS ELITE<span style={{ fontSize: 10, fontWeight: 600, color: T.mut, marginLeft: 2 }}>HQ</span></>}
    </div>
  );
}

function WsSwitch({ ws, switchWs, T, big, vertical }) {
  return (
    <div role="tablist" aria-label="Business" style={{ display: "flex", flexDirection: vertical ? "column" : "row", borderRadius: vertical ? 10 : 999, border: "1px solid " + T.border, overflow: "hidden", background: "rgba(0,0,0,0.25)" }}>
      {[["dse", vertical ? "DSE" : "DS Elite"], ["dssc", "DSSC"]].map(([k, l]) => {
        const on = ws === k;
        return (
          <button key={k} role="tab" aria-selected={on} onClick={() => switchWs(k)}
            style={{ flex: 1, padding: big ? "11px 0" : vertical ? "6px 0" : "6px 0", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: big ? 14 : vertical ? 9 : 11, fontWeight: 800, letterSpacing: 0.3, background: on ? (k === "dssc" ? "#B2D049" : "#e91e8c") : "transparent", color: on ? (k === "dssc" ? "#104946" : "#000") : T.mut }}>{l}</button>
        );
      })}
    </div>
  );
}

// A nav row. Desktop rows are 30px; touch rows (drawer) are 44px.
function Row({ nav, v, view, go, T, pinned, togglePin, touch, iconToo }) {
  const on = view === v;
  return (
    <div className="dse-nr" role="link" tabIndex={0} aria-current={on ? "page" : undefined}
      onClick={() => go(v)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(v); } }}
      style={{ "--dse-hover": T.hover, display: "flex", alignItems: "center", gap: 8, minHeight: touch ? 44 : 30, padding: touch ? "0 4px 0 12px" : "0 4px 0 10px", margin: "1px 0", borderRadius: 8, cursor: "pointer", fontSize: touch ? 15 : 13, fontWeight: on ? 700 : 500, color: on ? T.text : T.mut, background: on ? T.active : undefined, boxShadow: on ? "inset 3px 0 0 " + T.accent : "none", outline: "none" }}>
      {iconToo && <span style={{ width: 20, textAlign: "center", fontSize: touch ? 16 : 13, flexShrink: 0 }}>{nav.icon(v)}</span>}
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nav.label(v)}</span>
      <Pill n={nav.badge(v)} T={T} /><Pill n={nav.info(v)} T={T} info />
      {togglePin && (
        <span role="button" aria-label={pinned ? "Unpin " + nav.label(v) : "Pin " + nav.label(v)} title={pinned ? "Unpin" : "Pin to the top"}
          className={"dse-star" + (pinned ? " on" : "")}
          onClick={e => { e.stopPropagation(); togglePin(v); }}
          style={{ width: touch ? 40 : 22, height: touch ? 40 : 22, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: touch ? 17 : 12, color: pinned ? T.accent : T.dim, flexShrink: 0, cursor: "pointer" }}>{pinned ? "★" : "☆"}</span>
      )}
    </div>
  );
}

function SectionHead({ s, open, onToggle, T, nav, touch }) {
  const tot = nav.sectionTotal(s);
  return (
    <button onClick={onToggle} aria-expanded={open}
      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", minHeight: touch ? 44 : 30, padding: touch ? "0 12px" : "0 8px 0 10px", marginTop: touch ? 2 : 4, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left", color: T.text, borderRadius: 8 }}>
      <span style={{ width: 20, textAlign: "center", fontSize: touch ? 16 : 13 }}>{s.icon}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: touch ? 14 : 12, fontWeight: 800, letterSpacing: 0.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title}</span>
      {!open && <Pill n={tot} T={T} />}
      <span style={{ fontSize: 10, color: T.dim, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s", width: 12, textAlign: "center" }}>▶</span>
    </button>
  );
}

// Which sections are open: the one holding the current screen opens itself;
// anything Drew opened or closed by hand is remembered.
function useOpenSections(nav, view) {
  const [open, setOpen] = useState(() => readJSON("dse.navOpen", {}));
  const cur = nav.sectionOf(view);
  useEffect(() => {
    if (cur && open[cur.key] === false) setOpen(o => { const n = { ...o }; delete n[cur.key]; writeJSON("dse.navOpen", n); return n; });
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  const isOpen = (s) => open[s.key] === true || (open[s.key] !== false && cur && cur.key === s.key);
  const toggle = (s) => setOpen(o => { const n = { ...o, [s.key]: !isOpen(s) }; writeJSON("dse.navOpen", n); return n; });
  return [isOpen, toggle];
}

function SearchResults({ nav, results, sel, go, T, touch }) {
  if (!results.length) return <div style={{ padding: "10px 12px", fontSize: touch ? 14 : 12, color: T.dim }}>No screens match. Try payroll, hotel, forms or texts.</div>;
  return results.map((r, i) => (
    <div key={r.v} className="dse-nr" role="link" tabIndex={-1} onClick={() => go(r.v)}
      style={{ "--dse-hover": T.hover, display: "flex", alignItems: "center", gap: 8, minHeight: touch ? 46 : 34, padding: "4px 10px", borderRadius: 8, cursor: "pointer", background: i === sel ? T.active : undefined }}>
      <span style={{ width: 20, textAlign: "center", fontSize: touch ? 16 : 13 }}>{nav.icon(r.v)}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: touch ? 15 : 13, fontWeight: 600, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nav.label(r.v)}</div>
        <div style={{ fontSize: 10, color: T.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.ws === "dssc" ? "DSSC" : "DS Elite"}{r.sec ? " · " + r.sec : ""}</div>
      </span>
      <Pill n={nav.badge(r.v)} T={T} />
    </div>
  ));
}

function useSearch(nav, go) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const results = useMemo(() => nav.search(q), [nav, q]);
  const pick = (v) => { setQ(""); setSel(0); go(v); };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel(s => Math.min(s + 1, Math.max(results.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
    else if (e.key === "Enter" && results[sel]) { e.preventDefault(); pick(results[sel].v); e.currentTarget.blur(); }
    else if (e.key === "Escape") { setQ(""); e.currentTarget.blur(); }
  };
  return { q, setQ: (v) => { setQ(v); setSel(0); }, sel, results, pick, onKey };
}

// ── Desktop sidebar ─────────────────────────────────────────────────────────
export function Sidebar({ nav, view, go, switchWs, collapsed, setCollapsed, togglePin, C }) {
  const T = navTheme(nav.ws, C);
  const [isOpen, toggle] = useOpenSections(nav, view);
  const S = useSearch(nav, go);
  const searchRef = useRef(null);
  const [fly, setFly] = useState(null); // rail flyout: { key, top }
  const [peek, setPeek] = useState(false); // expanded just for a search, not saved
  const railed = collapsed && !peek;
  const openSearch = () => { setFly(null); if (railed) setPeek(true); setTimeout(() => searchRef.current && searchRef.current.focus(), 30); };
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target, tag = (t && t.tagName) || "";
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (t && t.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault(); openSearch();
      } else if (!typing && e.key === "[" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault(); setFly(null);
        if (peek) setPeek(false); else setCollapsed(!collapsed);
      } else if (e.key === "Escape") setFly(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapsed, setCollapsed, peek, railed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setFly(null); setPeek(false); }, [view, nav.ws]);
  const pinned = new Set(nav.pins);
  const goHome = () => go("home");

  if (railed) {
    const railBtn = (key, icon, title, n, active, onClick) => (
      <button key={key} title={title} aria-label={title} onClick={onClick}
        style={{ position: "relative", width: 44, height: 40, borderRadius: 10, border: "none", cursor: "pointer", fontSize: 18, lineHeight: 1, background: active ? T.active : (fly && fly.key === key ? T.hover : "transparent"), boxShadow: active ? "inset 3px 0 0 " + T.accent : "none", color: T.text, fontFamily: "inherit" }}>
        {icon}
        {n > 0 && <span style={{ position: "absolute", top: 3, right: 3, minWidth: 15, height: 15, padding: "0 3px", borderRadius: 8, background: T.accent, color: T.onAccent, fontSize: 9, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{n > 99 ? "99+" : n}</span>}
      </button>
    );
    const openFly = (key) => (e) => { const r = e.currentTarget.getBoundingClientRect(); setFly(f => (f && f.key === key ? null : { key, top: Math.max(8, Math.min(r.top, window.innerHeight - 200)) })); };
    const curSec = nav.sectionOf(view);
    const flySec = fly && nav.sections.find(s => s.key === fly.key);
    const flyItems = fly ? (fly.key === "_pins" ? nav.pins : fly.key === "_more" ? nav.footer : flySec ? flySec.items : []) : [];
    const flyTitle = fly ? (fly.key === "_pins" ? "Pinned" : fly.key === "_more" ? "Help & history" : flySec ? flySec.title : "") : "";
    return (
      <aside aria-label="Main menu" style={{ position: "sticky", top: 0, height: "100vh", width: 64, flexShrink: 0, background: T.bg, borderRight: "1px solid " + T.border, display: "flex", flexDirection: "column", alignItems: "center", zIndex: 45 }}>
        <NavStyles />
        <div style={{ padding: "12px 0 8px" }}><Logo ws={nav.ws} T={T} small onClick={goHome} /></div>
        <div style={{ width: 46, marginBottom: 8 }}><WsSwitch ws={nav.ws} switchWs={switchWs} T={T} vertical /></div>
        <div className="dse-nav-scroll" style={{ flex: 1, overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, width: "100%", paddingBottom: 8 }}>
          {railBtn("_search", "🔍", "Jump to a screen (Ctrl K)", 0, false, openSearch)}
          {railBtn("_pins", "★", "Pinned", 0, nav.pins.includes(view), openFly("_pins"))}
          <div style={{ width: 28, height: 1, background: T.border, margin: "4px 0" }} />
          {nav.sections.map(s => railBtn(s.key, s.icon, s.title, nav.sectionTotal(s), curSec && curSec.key === s.key, openFly(s.key)))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "6px 0 10px", borderTop: "1px solid " + T.border, width: "100%" }}>
          {nav.footer.length > 0 && railBtn("_more", "⋯", "Activity, FAQ, Ask AI", 0, nav.footer.includes(view), openFly("_more"))}
          {railBtn("_expand", "»", "Expand menu  [", 0, false, () => { setFly(null); setCollapsed(false); })}
        </div>
        {fly && <>
          <div onClick={() => setFly(null)} style={{ position: "fixed", inset: 0, zIndex: 46 }} />
          <div role="menu" className="dse-nav-scroll" style={{ position: "fixed", left: 70, top: fly.top, zIndex: 47, width: 250, maxHeight: "calc(100vh - " + (fly.top + 12) + "px)", overflowY: "auto", background: T.panel, border: "1px solid " + T.border, borderRadius: 12, boxShadow: "0 14px 36px rgba(0,0,0,0.55)", padding: 6, animation: "dse-fade-in .12s ease-out" }}>
            <div style={{ padding: "6px 10px 6px", fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: T.accent }}>{flyTitle}</div>
            {flyItems.length ? flyItems.map(v => <Row key={v} nav={nav} v={v} view={view} go={(x) => { setFly(null); go(x); }} T={T} pinned={pinned.has(v)} togglePin={fly.key === "_more" ? null : togglePin} iconToo={fly.key === "_pins"} />)
              : <div style={{ padding: "6px 10px 10px", fontSize: 12, color: T.dim }}>Nothing pinned yet. Expand the menu and tap ☆ on any screen.</div>}
          </div>
        </>}
      </aside>
    );
  }

  return (
    <aside aria-label="Main menu" style={{ position: "sticky", top: 0, height: "100vh", width: 236, flexShrink: 0, background: T.bg, borderRight: "1px solid " + T.border, display: "flex", flexDirection: "column", zIndex: 45 }}>
      <NavStyles />
      <div style={{ padding: "12px 12px 8px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 28 }}>
          <div style={{ flex: 1, minWidth: 0 }}><Logo ws={nav.ws} T={T} onClick={goHome} /></div>
          <button onClick={() => { if (peek) setPeek(false); else setCollapsed(true); }} title="Collapse menu  [" aria-label="Collapse menu"
            style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid " + T.border, background: "transparent", color: T.mut, cursor: "pointer", fontSize: 14, lineHeight: 1, fontFamily: "inherit", flexShrink: 0 }}>«</button>
        </div>
        <WsSwitch ws={nav.ws} switchWs={switchWs} T={T} />
        <div style={{ position: "relative" }}>
          <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: T.dim, pointerEvents: "none" }}>🔍</span>
          <input ref={searchRef} value={S.q} onChange={e => S.setQ(e.target.value)} onKeyDown={S.onKey} placeholder="Jump to…" aria-label="Jump to a screen"
            style={{ width: "100%", boxSizing: "border-box", padding: "7px 44px 7px 28px", borderRadius: 8, border: "1px solid " + T.border, background: "rgba(0,0,0,0.25)", color: T.text, fontFamily: "inherit", fontSize: 12, outline: "none" }} />
          <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 9, fontWeight: 700, color: T.dim, border: "1px solid " + T.border, borderRadius: 4, padding: "1px 4px", pointerEvents: "none" }}>Ctrl K</span>
        </div>
      </div>
      <div className="dse-nav-scroll" style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px", overscrollBehavior: "contain" }}>
        {S.q ? <SearchResults nav={nav} results={S.results} sel={S.sel} go={S.pick} T={T} /> : <>
          {nav.pins.length > 0 && <>
            <div style={{ padding: "4px 10px 2px", fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: T.dim }}>★ Pinned</div>
            {nav.pins.map(v => <Row key={"p" + v} nav={nav} v={v} view={view} go={go} T={T} pinned togglePin={togglePin} iconToo />)}
            <div style={{ height: 1, background: T.border, margin: "8px 6px 4px" }} />
          </>}
          {nav.sections.map(s => {
            const open = isOpen(s);
            return (
              <div key={s.key}>
                <SectionHead s={s} open={open} onToggle={() => toggle(s)} T={T} nav={nav} />
                {open && <div style={{ paddingLeft: 8, marginBottom: 4 }}>{s.items.map(v => <Row key={v} nav={nav} v={v} view={view} go={go} T={T} pinned={pinned.has(v)} togglePin={togglePin} />)}</div>}
              </div>
            );
          })}
        </>}
      </div>
      <div style={{ borderTop: "1px solid " + T.border, padding: "6px 8px 8px" }}>
        {nav.footer.map(v => <Row key={v} nav={nav} v={v} view={view} go={go} T={T} iconToo />)}
      </div>
    </aside>
  );
}

// ── Phone: slide-in drawer ──────────────────────────────────────────────────
export function NavDrawer({ nav, view, go, switchWs, togglePin, onClose, C, extras }) {
  const T = navTheme(nav.ws, C);
  const [isOpen, toggle] = useOpenSections(nav, view);
  const S = useSearch(nav, go);
  const pinned = new Set(nav.pins);
  // Lock the page behind the drawer so a scroll inside it doesn't move the page.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("dse-nav-lock");
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { root.classList.remove("dse-nav-lock"); window.removeEventListener("keydown", onKey); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const needs = nav.searchList.filter(it => it.ws === nav.ws && nav.badge(it.v) > 0 && it.v !== "incidents");
  const x = extras || {};
  const smallBtn = { flex: 1, minHeight: 40, borderRadius: 10, border: "1px solid " + T.border, background: "transparent", color: T.text, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700 };
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 79, animation: "dse-fade-in .15s ease-out" }} />
      <nav aria-label="Main menu" style={{ position: "fixed", top: 0, bottom: 0, left: 0, width: "min(88vw, 340px)", zIndex: 80, background: T.bg, borderRight: "1px solid " + T.border, display: "flex", flexDirection: "column", paddingTop: "env(safe-area-inset-top, 0px)", animation: "dse-drawer-in .2s ease-out", boxShadow: "8px 0 32px rgba(0,0,0,0.5)" }}>
        <NavStyles />
        <div style={{ padding: "10px 12px 8px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}><Logo ws={nav.ws} T={T} onClick={() => go("home")} /></div>
            <button onClick={onClose} aria-label="Close menu" style={{ width: 40, height: 40, borderRadius: 10, border: "1px solid " + T.border, background: "transparent", color: T.text, fontSize: 18, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
          </div>
          <WsSwitch ws={nav.ws} switchWs={switchWs} T={T} big />
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: T.dim, pointerEvents: "none" }}>🔍</span>
            {/* 16px keeps iOS from zooming the page when the box gets focus. */}
            <input value={S.q} onChange={e => S.setQ(e.target.value)} onKeyDown={S.onKey} placeholder="Find a screen…" aria-label="Find a screen" enterKeyHint="go"
              style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px 10px 36px", borderRadius: 10, border: "1px solid " + T.border, background: "rgba(0,0,0,0.25)", color: T.text, fontFamily: "inherit", fontSize: 16, outline: "none" }} />
          </div>
        </div>
        <div className="dse-nav-scroll" style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", padding: "0 8px calc(16px + env(safe-area-inset-bottom, 0px))" }}>
          {S.q ? <SearchResults nav={nav} results={S.results} sel={S.sel} go={S.pick} T={T} touch /> : <>
            {needs.length > 0 && (
              <div style={{ padding: "2px 4px 10px" }}>
                <div style={{ padding: "0 6px 6px", fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: T.dim }}>Needs you</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {needs.map(it => (
                    <button key={it.v} onClick={() => go(it.v)}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 36, padding: "0 12px", borderRadius: 18, border: "1px solid " + T.border, background: view === it.v ? T.active : "rgba(255,255,255,0.04)", color: T.text, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                      {nav.short(it.v)}<Pill n={nav.badge(it.v)} T={T} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {(x.onAddPlayer || x.onRefresh) && (
              <div style={{ display: "flex", gap: 8, padding: "0 4px 10px" }}>
                {x.onAddPlayer && <button onClick={x.onAddPlayer} style={{ ...smallBtn, borderColor: T.accent, color: T.accent }}>+ Add Player</button>}
                {x.onRefresh && <button onClick={x.onRefresh} disabled={x.refreshing} style={smallBtn}>{x.refreshing ? "Refreshing…" : "⟳ Refresh"}</button>}
              </div>
            )}
            {nav.pins.length > 0 && <>
              <div style={{ padding: "4px 12px 2px", fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: T.dim }}>★ Pinned</div>
              {nav.pins.map(v => <Row key={"p" + v} nav={nav} v={v} view={view} go={go} T={T} pinned togglePin={togglePin} touch iconToo />)}
              <div style={{ height: 1, background: T.border, margin: "8px 8px 4px" }} />
            </>}
            {nav.sections.map(s => {
              const open = isOpen(s);
              return (
                <div key={s.key}>
                  <SectionHead s={s} open={open} onToggle={() => toggle(s)} T={T} nav={nav} touch />
                  {open && <div style={{ paddingLeft: 12, marginBottom: 6 }}>{s.items.map(v => <Row key={v} nav={nav} v={v} view={view} go={go} T={T} pinned={pinned.has(v)} togglePin={togglePin} touch />)}</div>}
                </div>
              );
            })}
            <div style={{ height: 1, background: T.border, margin: "8px 8px 4px" }} />
            {nav.footer.map(v => <Row key={v} nav={nav} v={v} view={view} go={go} T={T} touch iconToo />)}
            {x.userName && (
              <div style={{ margin: "12px 4px 0", padding: 12, borderRadius: 12, border: "1px solid " + T.border, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 13, color: T.text, fontWeight: 700 }}>{x.userName}{x.tag && <span style={{ color: T.accent, marginLeft: 6, fontSize: 10, fontWeight: 800 }}>{x.tag}</span>}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {x.onTogglePreview && <button onClick={x.onTogglePreview} style={smallBtn}>{x.coachPreview ? "Exit coach view" : "Coach view"}</button>}
                  {x.onSignOut && <button onClick={x.onSignOut} style={smallBtn}>Sign out</button>}
                </div>
              </div>
            )}
          </>}
        </div>
      </nav>
    </>
  );
}

// ── Phone: bottom tab bar ───────────────────────────────────────────────────
// First four pins + Menu. Hides while the keyboard is up (a text field has
// focus) so a composer never sits under it.
export function BottomBar({ nav, view, go, onMenu, menuOpen, C }) {
  const T = navTheme(nav.ws, C);
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const isText = (el) => !!el && (el.tagName === "TEXTAREA" || el.isContentEditable || (el.tagName === "INPUT" && !/^(checkbox|radio|button|submit|reset|range|color|file|image|hidden)$/i.test(el.type || "")));
    const onIn = (e) => setTyping(isText(e.target));
    const onOut = () => setTimeout(() => setTyping(isText(document.activeElement)), 60);
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => { document.removeEventListener("focusin", onIn); document.removeEventListener("focusout", onOut); };
  }, []);
  if (typing) return null;
  const slots = nav.pins.slice(0, 4);
  const slot = (key, icon, label, active, n, onClick) => (
    <button key={key} onClick={onClick} aria-current={active ? "page" : undefined}
      style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, height: 56, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", color: active ? T.accent : T.mut, position: "relative", WebkitTapHighlightColor: "transparent" }}>
      <span style={{ fontSize: 20, lineHeight: 1, filter: active ? "none" : "grayscale(0.35)", position: "relative" }}>
        {icon}
        {n > 0 && <span style={{ position: "absolute", top: -6, right: -12, minWidth: 16, height: 16, padding: "0 4px", borderRadius: 8, background: T.accent, color: T.onAccent, fontSize: 9, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>{n > 99 ? "99+" : n}</span>}
      </span>
      <span style={{ fontSize: 10, fontWeight: active ? 800 : 600, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "0 2px" }}>{label}</span>
      {active && <span style={{ position: "absolute", top: 0, left: "28%", right: "28%", height: 2, borderRadius: 2, background: T.accent }} />}
    </button>
  );
  const menuBadge = nav.restTotal(slots);
  return (
    <nav aria-label="Shortcuts" style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 45, background: T.bg, borderTop: "1px solid " + T.border, display: "flex", paddingBottom: "env(safe-area-inset-bottom, 0px)", paddingLeft: "env(safe-area-inset-left, 0px)", paddingRight: "env(safe-area-inset-right, 0px)" }}>
      <NavStyles />
      {slots.map(v => slot(v, nav.icon(v), nav.short(v), !menuOpen && view === v, nav.badge(v), () => go(v)))}
      {slot("_menu", "☰", "Menu", menuOpen, Math.max(0, menuBadge), onMenu)}
    </nav>
  );
}

// ── Phone: the other screens in this section, one tap apart ─────────────────
export function SiblingChips({ nav, view, go, C }) {
  const T = navTheme(nav.ws, C);
  const ref = useRef(null);
  const sec = nav.sectionOf(view);
  const items = sec ? sec.items.filter(v => nav.visible.has(v)) : [];
  useEffect(() => {
    const box = ref.current; if (!box) return;
    const on = box.querySelector("[data-on='1']");
    if (on) box.scrollLeft = Math.max(0, on.offsetLeft - (box.clientWidth - on.offsetWidth) / 2);
  }, [view]);
  if (items.length < 2) return null;
  return (<>
    <NavStyles />
    <div ref={ref} className="dse-chips" style={{ display: "flex", gap: 6, overflowX: "auto", padding: "8px 12px", borderBottom: "1px solid " + T.border, WebkitOverflowScrolling: "touch" }}>
      {items.map(v => {
        const on = v === view;
        return (
          <button key={v} data-on={on ? "1" : "0"} onClick={() => go(v)}
            style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 13px", borderRadius: 17, border: "1px solid " + (on ? T.accent : T.border), background: on ? T.accent : "transparent", color: on ? T.onAccent : T.mut, fontFamily: "inherit", fontSize: 13, fontWeight: on ? 800 : 600, cursor: "pointer", whiteSpace: "nowrap" }}>
            {nav.label(v)}{!on && <Pill n={nav.badge(v)} T={T} />}
          </button>
        );
      })}
    </div>
  </>);
}
