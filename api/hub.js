// Tournament Hub — the public page parents, coaches and directors keep open at
// a tournament: who each DS Elite team plays, when, on which court, the work
// duties, scores set by set, pool place, "if we finish 1st/2nd..." and the
// final placing. No login.
//
//   GET /hub                                (rewrite /hub → /api/hub) club home
//   GET /hub?team=14-diamond                one team (slug = team name, lowercased, spaces → '-')
//   GET /hub?demo=aes:<key>:<clubId>[&team=<slug>][&tz=<IANA>]
//   GET /hub?demo=otto:<eswId>:<teamId,teamId>[&team=<slug>]
//                                           another club's live event, so the hub can be
//                                           seen with real data before DS Elite's first
//                                           published event (pink "Demo" banner, no alerts)
//
// Drew, 10 Oct 2026: "an easy way for parents, coaches and directors to see who
// they are playing and when, in real time ... a great way to introduce the app
// to parents." Built to beat what parents complain about in Volleyball Hub:
// a returning parent lands on My teams (followed teams, kept in localStorage)
// with each team's NEXT card on the first screen — no navigation — and every
// page is a real URL, so the phone's back button always works.
//
// The page is one HTML response with the hub data embedded (api/hub-data.js
// buildHubData), so the first paint needs no second request; Refresh and the
// 60-second auto-refresh (only while one of the page's tournaments is live
// today) fetch /api/hub-data — one request each. Demo pages skip the embed and
// fetch, because the AES calls take a second or two.
//
// "Notify me" is web push: it registers /sw.js with scope /hub (its own
// registration, so turning hub alerts off can never unsubscribe a coach's HQ
// alerts in the same browser), subscribes with VAPID_PUBLIC_KEY and POSTs the
// subscription + followed teams to /api/hub-subscribe. iPhones only get web
// push from a Home Screen app, so outside one the card explains Add to Home
// Screen instead of offering a button that can't work. /hub.webmanifest makes
// that Home Screen app open on /hub, not the coaches' login.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY (no key → no
// Notify button).

import { buildHubData, hubSupabase, hubQuery, parseDemo, slugOf } from "./hub-data.js";
import { appOrigin } from "../shared/app-origin.js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// JSON inside <script type="application/json">: nothing may close the tag.
const safeJson = (o) => JSON.stringify(o).replace(/</g, "\\u003c");

const CSS = `
  :root { color-scheme:dark; --bg:#12100f; --card:#1c1a18; --card2:#24211e; --ink:#f6f2ec; --body:#d5cfc6; --mut:#a39b90;
          --rule:#34302b; --gold:#e0b455; --grn:#4ade80; --err:#f87171; --pink:#ec3f8e; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html { -webkit-text-size-adjust:100%; }
  body { margin:0; background:var(--bg); color:var(--body); font-family:"Source Sans 3",system-ui,-apple-system,"Segoe UI",sans-serif;
         font-size:16px; line-height:1.45; overflow-wrap:break-word; }
  .wrap { max-width:640px; margin:0 auto; padding:0 max(16px, env(safe-area-inset-right)) calc(64px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); }
  a { color:var(--gold); }
  a:focus-visible, button:focus-visible, summary:focus-visible { outline:3px solid var(--gold); outline-offset:2px; border-radius:8px; }
  .sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
  .eyebrow, .sect { font-size:12px; letter-spacing:.16em; text-transform:uppercase; color:var(--gold); font-weight:700; }
  .sect { margin:26px 0 8px; }
  h1 { margin:4px 0 2px; color:var(--ink); font-family:"Barlow Condensed",sans-serif; font-weight:700; font-size:clamp(2.1rem,10vw,2.9rem);
       line-height:1; text-transform:uppercase; }
  h2, h3 { margin:0; }
  .hd { padding:10px 0 4px; }
  .sub { margin:6px 0 0; color:var(--mut); font-size:.98rem; }
  .mut { color:var(--mut); }
  .big { color:var(--ink); font-weight:700; font-size:1.1rem; margin:0 0 4px; }
  .card { background:var(--card); border:1px solid var(--rule); border-radius:16px; padding:16px; margin-top:12px; }
  .card p { margin:0 0 8px; } .card p:last-child { margin-bottom:0; }
  .card.soft { background:transparent; border-style:dashed; }

  /* top bar: always reachable while scrolling a long day */
  .top { position:sticky; top:0; z-index:5; display:flex; align-items:center; justify-content:space-between; gap:8px;
         margin:0 -16px; padding:calc(8px + env(safe-area-inset-top)) 16px 8px; background:rgba(18,16,15,.94);
         -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px); border-bottom:1px solid transparent; }
  .back { display:inline-flex; align-items:center; gap:6px; min-height:44px; padding:0 4px; color:var(--gold); font-weight:700;
          text-decoration:none; font-size:1rem; white-space:nowrap; }
  .back span { font-size:1.5rem; line-height:1; margin-top:-2px; }
  .brand { color:var(--ink); font-family:"Barlow Condensed",sans-serif; font-weight:700; font-size:1.15rem; letter-spacing:.04em;
           text-transform:uppercase; text-decoration:none; min-height:44px; display:inline-flex; align-items:center; gap:.28em; }
  .brand i { font-style:normal; color:var(--gold); }
  .acts { display:flex; gap:6px; flex-shrink:0; }
  .act { min-height:44px; min-width:44px; padding:0 13px; border-radius:22px; border:1px solid var(--rule); background:var(--card);
         color:var(--ink); font:inherit; font-weight:700; font-size:.95rem; cursor:pointer; white-space:nowrap; }
  .act[aria-pressed="true"] { border-color:var(--gold); color:var(--gold); background:rgba(224,180,85,.1); }
  .act.icon { padding:0; font-size:1.2rem; }
  .act:disabled { opacity:.55; }
  .spin { display:inline-block; animation:spin 1s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }

  .demo { margin:10px 0 0; padding:10px 12px; border-radius:12px; background:var(--pink); color:#1a0710; font-size:.9rem; line-height:1.35; }
  .demo b { letter-spacing:.12em; } .demo a { color:#1a0710; font-weight:700; display:inline-block; padding:4px 0; }

  /* tournament block */
  .tn { margin-top:18px; }
  .tn-hd, .tc-hd { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:flex-start; gap:6px 10px; }
  .tn-hd > div, .tc-hd > h3 { flex:1 1 13em; min-width:0; }
  .tn-hd h2 { color:var(--ink); font-size:1.15rem; line-height:1.25; }
  .meta { margin:2px 0 0; color:var(--mut); font-size:.9rem; }
  .chip { flex-shrink:0; display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:800; letter-spacing:.06em;
          text-transform:uppercase; padding:4px 9px; border-radius:999px; border:1px solid var(--rule); color:var(--mut); white-space:nowrap; }
  .chip.live { background:var(--pink); border-color:var(--pink); color:#1a0710; }
  .chip.posted { border-color:var(--gold); color:var(--gold); }
  .chip.final { border-color:var(--grn); color:var(--grn); }
  .live-dot { width:8px; height:8px; border-radius:50%; background:currentColor; animation:pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity:.25; } }
  .tznote { margin:8px 0 0; font-size:.85rem; color:var(--mut); }

  /* NEXT card */
  .next { margin-top:12px; padding:16px; border-radius:18px; border:1px solid rgba(224,180,85,.5);
          background:linear-gradient(180deg, rgba(224,180,85,.12), rgba(224,180,85,.03)); }
  .next.is-live { border-color:var(--pink); background:linear-gradient(180deg, rgba(236,63,142,.16), rgba(236,63,142,.04)); }
  .next.done { border-color:rgba(74,222,128,.45); background:linear-gradient(180deg, rgba(74,222,128,.10), rgba(74,222,128,.02)); }
  .next.wait { border-style:dashed; background:transparent; }
  .nx-top { display:flex; justify-content:space-between; align-items:center; gap:8px; min-height:24px; }
  .rel { color:var(--ink); font-weight:700; font-size:.92rem; }
  .nx-main { display:flex; justify-content:space-between; align-items:flex-end; gap:12px; margin-top:6px; }
  .nx-time { font-family:"Barlow Condensed",sans-serif; font-weight:700; color:var(--ink); font-size:clamp(2.7rem,14vw,3.5rem); line-height:.92; white-space:nowrap; }
  .nx-time small { display:block; font-family:"Source Sans 3",sans-serif; font-size:.95rem; color:var(--gold); line-height:1.2; margin-bottom:2px; }
  .nx-court { text-align:right; min-width:0; font-family:"Barlow Condensed",sans-serif; font-weight:700; color:var(--gold);
              font-size:clamp(1.5rem,8vw,2.1rem); line-height:1; }
  .nx-court small, .lbl { display:block; font-family:"Source Sans 3",sans-serif; font-size:11px; letter-spacing:.16em; text-transform:uppercase;
                          color:var(--mut); font-weight:700; margin-bottom:4px; }
  .nx-opp { margin-top:12px; color:var(--ink); font-weight:700; font-size:1.3rem; line-height:1.2; }
  .nx-sub { color:var(--mut); font-size:.92rem; margin-top:2px; }
  .nx-then { margin-top:10px; font-size:.95rem; color:var(--body); }
  .nx-work { display:flex; gap:10px; align-items:flex-start; margin-top:14px; padding-top:12px; border-top:1px solid var(--rule); }
  .nx-work b { color:var(--ink); } .nx-work small { display:block; color:var(--mut); font-size:.88rem; }
  .fin { font-family:"Barlow Condensed",sans-serif; font-weight:700; color:var(--ink); font-size:2.6rem; line-height:1; margin:6px 0 4px; }
  .fin small { font-family:"Source Sans 3",sans-serif; font-size:1rem; color:var(--grn); margin-left:6px; }
  .tag { display:inline-block; font-size:11px; font-weight:800; letter-spacing:.08em; padding:3px 7px; border-radius:6px; line-height:1.2;
         white-space:nowrap; vertical-align:1px; }
  .tag.wk { border:1px solid var(--gold); color:var(--gold); }
  .tag.tent { border:1px solid var(--rule); color:var(--mut); }
  .badge { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:800; letter-spacing:.08em; padding:3px 9px;
           border-radius:999px; background:var(--pink); color:#1a0710; white-space:nowrap; }

  .stats { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
  .stat { flex:1 1 auto; min-width:0; background:var(--card); border:1px solid var(--rule); border-radius:12px; padding:9px 12px; }
  .stat b { display:block; color:var(--ink); font-family:"Barlow Condensed",sans-serif; font-size:1.55rem; line-height:1.05; }
  .stat small { display:block; color:var(--mut); font-size:.78rem; }

  /* where-next paths */
  .pl { list-style:none; margin:0; padding:0; }
  .pl li { display:grid; grid-template-columns:minmax(0,9.5em) minmax(0,1fr); gap:10px; padding:10px 0; border-top:1px solid var(--rule); }
  .pl li:first-child { border-top:none; padding-top:2px; }
  .pif { color:var(--gold); font-weight:700; }
  .pgo b { color:var(--ink); display:block; } .pgo small { display:block; color:var(--mut); font-size:.86rem; }

  /* day lists */
  details.day { background:var(--card); border:1px solid var(--rule); border-radius:16px; margin-top:12px; overflow:hidden; }
  details.day > summary { list-style:none; display:flex; justify-content:space-between; align-items:center; gap:10px; min-height:50px;
                          padding:10px 16px; cursor:pointer; color:var(--ink); font-weight:700; }
  details.day > summary::-webkit-details-marker { display:none; }
  details.day > summary::after { content:"\\25BE"; color:var(--gold); font-size:1rem; transition:transform .15s; }
  details.day[open] > summary::after { transform:rotate(180deg); }
  details.day > summary .cnt { margin-left:auto; color:var(--mut); font-weight:600; font-size:.88rem; white-space:nowrap; }
  .list { list-style:none; margin:0; padding:0; }
  .it { display:grid; grid-template-columns:4.6em minmax(0,1fr) auto; gap:10px; padding:12px 16px; border-top:1px solid var(--rule); align-items:start; }
  .it .t { color:var(--ink); font-weight:700; font-size:.95rem; font-variant-numeric:tabular-nums; white-space:nowrap; padding-top:1px; }
  .it .b b { display:block; color:var(--ink); line-height:1.3; }
  .it .b small { display:block; color:var(--mut); font-size:.86rem; margin-top:1px; }
  .it .r { text-align:right; white-space:nowrap; }
  .it .r small { display:block; color:var(--mut); font-size:.8rem; }
  .it.wk { background:rgba(224,180,85,.05); }
  .it.live { background:rgba(236,63,142,.10); }
  .it.past { opacity:.92; }
  .res { font-family:"Barlow Condensed",sans-serif; font-weight:700; font-size:1.55rem; line-height:1; }
  .res.w { color:var(--grn); } .res.l { color:var(--err); } .res.s { color:var(--gold); font-size:1.15rem; }
  .sets { display:flex; flex-wrap:wrap; gap:5px; margin-top:6px; }
  .sets i { font-style:normal; font-size:.84rem; font-weight:700; padding:2px 7px; border-radius:6px; background:var(--card2);
            font-variant-numeric:tabular-nums; }
  .sets i.w { color:var(--grn); } .sets i.l { color:var(--err); }

  .tn-ft { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:6px 14px; margin-top:12px; font-size:.9rem; }
  .ext { display:inline-flex; align-items:center; min-height:44px; font-weight:700; }
  .upd { color:var(--mut); }

  /* home */
  .mycard { display:block; margin-top:10px; padding:14px 16px; border-radius:18px; text-decoration:none; color:inherit;
            background:var(--card); border:1px solid var(--rule); }
  .mycard.is-live { border-color:var(--pink); background:linear-gradient(180deg, rgba(236,63,142,.12), rgba(236,63,142,.03)); }
  .mycard:active, .tbtn:active, .tchip:active { border-color:var(--gold); }
  .mc-hd { display:flex; align-items:center; gap:8px; }
  .mc-hd b { color:var(--ink); font-family:"Barlow Condensed",sans-serif; font-size:1.55rem; line-height:1.1; text-transform:uppercase; }
  .chev { margin-left:auto; color:var(--gold); font-size:1.7rem; line-height:1; }
  .mc-next { display:flex; flex-wrap:wrap; align-items:baseline; gap:4px 12px; margin-top:4px; }
  .mc-next .tm { color:var(--ink); font-family:"Barlow Condensed",sans-serif; font-weight:700; font-size:2.1rem; line-height:1; }
  .mc-next .ct { color:var(--gold); font-weight:700; font-size:1.05rem; }
  .mc-next .dy { color:var(--gold); font-weight:700; font-size:.95rem; }
  .mc-l { color:var(--ink); font-weight:600; margin-top:4px; }
  .mc-s { color:var(--mut); font-size:.9rem; margin-top:2px; }
  .tncard h3 { color:var(--ink); font-size:1.1rem; line-height:1.25; }
    .chips { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
  .tchip { display:inline-flex; flex-direction:column; justify-content:center; min-height:44px; padding:6px 12px; border-radius:12px;
           background:var(--card2); border:1px solid var(--rule); color:var(--ink); text-decoration:none; font-weight:700; line-height:1.2; }
  .tchip small { color:var(--mut); font-weight:600; font-size:.8rem; }
  .tchip small.lv { color:var(--pink); }
  .nu { list-style:none; margin:8px 0 0; padding:0; }
  .nu li { padding:10px 0; border-top:1px solid var(--rule); }
  .nu li b { color:var(--ink); display:block; } .nu li small { color:var(--mut); display:block; }
  .grp { margin:16px 0 8px; color:var(--mut); font-size:.85rem; font-weight:700; letter-spacing:.06em; text-transform:uppercase; }
  .tgrid { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:8px; }
  @media (min-width:520px) { .tgrid { grid-template-columns:repeat(3, minmax(0,1fr)); } }
  .tbtn { position:relative; display:flex; flex-direction:column; justify-content:center; min-height:58px; padding:9px 30px 9px 12px;
          border-radius:12px; background:var(--card); border:1px solid var(--rule); color:var(--ink); text-decoration:none; }
  .tbtn b { font-size:1.05rem; line-height:1.2; }
  .tbtn small { color:var(--mut); font-size:.8rem; line-height:1.25; }
  .tbtn small.lv { color:var(--pink); font-weight:700; }
  .tbtn .star { position:absolute; top:7px; right:9px; color:var(--gold); }

  /* season + alerts + footer */
  .season { list-style:none; margin:0; padding:0; }
  .season li { display:grid; grid-template-columns:4.8em minmax(0,1fr); gap:10px; padding:11px 0; border-top:1px solid var(--rule); align-items:start; }
  .season li:first-child { border-top:none; padding-top:0; }
  .season .sd { color:var(--gold); font-weight:700; font-size:.92rem; white-space:nowrap; }
  .season .sd small { display:block; color:var(--mut); font-weight:600; }
  .season b { color:var(--ink); line-height:1.25; } .season .tag { margin-left:6px; }
  .season small { display:block; color:var(--mut); font-size:.86rem; }
  .btn { display:block; width:100%; min-height:50px; margin-top:12px; padding:12px 16px; border-radius:12px; border:none; cursor:pointer;
         font:inherit; font-weight:800; font-size:1.02rem; background:var(--gold); color:#1a1613; }
  .btn.ghost { background:transparent; color:var(--gold); border:1px solid var(--gold); }
  .btn:disabled { opacity:.5; cursor:default; }
  .steps { margin:8px 0 0; padding-left:22px; } .steps li { margin:4px 0; }
  .alerts .ok { color:var(--grn); font-weight:700; }
  .ft { margin-top:28px; text-align:center; color:var(--mut); font-size:.86rem; }
  .ft p { margin:8px 0; } .ft a { display:inline-block; padding:11px 6px; }
  .toast { position:fixed; left:50%; bottom:calc(18px + env(safe-area-inset-bottom)); transform:translate(-50%, 16px); opacity:0; visibility:hidden; max-width:calc(100% - 32px);
           padding:12px 16px; border-radius:12px; background:var(--ink); color:#1a1613; font-weight:700; box-shadow:0 8px 30px rgba(0,0,0,.5);
           transition:transform .2s ease, opacity .2s ease, visibility .2s; z-index:20; }
  .toast.on { transform:translate(-50%, 0); opacity:1; visibility:visible; }
  .skel { height:120px; border-radius:18px; margin-top:14px; background:linear-gradient(90deg, var(--card) 0%, var(--card2) 50%, var(--card) 100%);
          background-size:200% 100%; animation:sh 1.2s linear infinite; }
  @keyframes sh { to { background-position:-200% 0; } }
  @media (prefers-reduced-motion: reduce) { .live-dot, .spin, .skel { animation:none; } .toast { transition:none; } }
`;

// The page's script. A String.raw so regexes read normally — which means no
// backticks and no dollar-brace anywhere inside it. Plain ES2017, no build step.
const CLIENT_JS = String.raw`
(function () {
  "use strict";
  var BOOT = {};
  try { BOOT = JSON.parse(document.getElementById("hub-boot").textContent) || {}; } catch (e) {}
  var app = document.getElementById("app");
  var toastEl = document.getElementById("toast");
  var DEMO = BOOT.demo || "";
  var TZQ = BOOT.tz || "";
  var SLUG = BOOT.team || "";
  var D = BOOT.data || null;
  var fetchedAt = Date.now();
  var busy = false, timer = null, toastTimer = null;
  var openDays = {};
  var FKEY = DEMO ? "dseHub.follow.demo" : "dseHub.follow";
  var PKEY = "dseHub.push";

  // ---------- storage (private mode can throw)
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function follows() { var f = lsGet(FKEY, []); return Array.isArray(f) ? f.filter(function (x) { return typeof x === "string"; }) : []; }
  function isFollowed(n) { return follows().indexOf(n) >= 0; }
  function setFollow(n, on) { var f = follows().filter(function (x) { return x !== n; }); if (on) f.push(n); lsSet(FKEY, f); }
  function pushRec() { var p = DEMO ? null : lsGet(PKEY, null); return p && p.endpoint ? p : null; }

  // ---------- text + venue-local time ('YYYY-MM-DDTHH:mm', never converted)
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function lms(s) { var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(s || "")); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : NaN; }
  function lstr(ms) { return isFinite(ms) ? new Date(ms).toISOString().slice(0, 16) : ""; }
  function addMin(s, n) { return lstr(lms(s) + n * 60000); }
  var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function fmtTime(s) { var m = /T(\d{2}):(\d{2})/.exec(String(s || "")); if (!m) return ""; var h = +m[1]; return (h % 12 === 0 ? 12 : h % 12) + ":" + m[2] + " " + (h < 12 ? "AM" : "PM"); }
  function fmtDay(s) { var t = lms(String(s || "").slice(0, 10)); if (!isFinite(t)) return ""; var d = new Date(t); return DOW[d.getUTCDay()] + " " + (d.getUTCMonth() + 1) + "/" + d.getUTCDate(); }
  function day(s) { return String(s || "").slice(0, 10); }
  function dayTime(s, now) { return day(s) === day(now) ? fmtTime(s) : fmtDay(s) + " " + fmtTime(s); }
  function dateRange(a, b) { return !b || b === a ? fmtDay(a) : fmtDay(a) + " – " + fmtDay(b); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ord(n) { var v = +n; if (!(v > 0)) return ""; var s = v % 100 >= 11 && v % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[v % 10] || "th"; return v + s; }
  function courtText(c) { return c == null || c === "" ? "" : /^\d+$/.test(String(c)) ? "Court " + c : String(c); }
  function platformName(p) { return p === "otto" ? "OTTO" : "AES"; }
  function place(t) { return [t.venue, t.location].filter(function (x, i, a) { return x && a.indexOf(x) === i; }).join(" · "); }
  // The venue's clock now: the server's reading plus the minutes since we fetched.
  function nowFor(t) { return t && t.now_local ? addMin(t.now_local, Math.floor((Date.now() - fetchedAt) / 60000)) : ""; }
  function rel(start, now) {
    var d = Math.round((lms(start) - lms(now)) / 60000);
    if (!isFinite(d)) return "";
    if (d <= 0) return "Starting now";
    if (d < 60) return "in " + d + " min";
    if (day(start) === day(now)) return "in " + Math.floor(d / 60) + " h " + (d % 60 ? (d % 60) + " min" : "");
    // Another day: the card already shows the date above the time.
    var dd = Math.round((lms(day(start)) - lms(day(now))) / 86400000);
    return dd === 1 ? "Tomorrow" : "in " + dd + " days";
  }
  function ago(iso) {
    var t = Date.parse(iso); if (!isFinite(t)) return "";
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 45) return "just now";
    var m = Math.round(s / 60); if (m < 60) return m + " min ago";
    var h = Math.round(m / 60); if (h < 24) return h + " h ago";
    return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  function tzShort(tz) {
    try { var p = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date()); for (var i = 0; i < p.length; i++) if (p[i].type === "timeZoneName") return p[i].value; } catch (e) {}
    return tz;
  }

  // ---------- urls
  function qs(slug, api) {
    var p = [];
    if (DEMO) p.push("demo=" + DEMO);
    if (DEMO && TZQ) p.push("tz=" + encodeURIComponent(TZQ));
    if (slug) p.push("team=" + encodeURIComponent(slug));
    return (api ? "/api/hub-data" : "/hub") + (p.length ? "?" + p.join("&") : "");
  }

  // ---------- data lookups
  function teams() { return (D && D.teams) || []; }
  function teamByName(n) { var t = teams(); for (var i = 0; i < t.length; i++) if (t[i].name === n) return t[i]; return null; }
  function tns() { return (D && D.tournaments) || []; }
  function tnById(id) { var t = tns(); for (var i = 0; i < t.length; i++) if (String(t[i].id) === String(id)) return t[i]; return null; }
  function entriesFor(n) { return ((D && D.snapshots && D.snapshots[n]) || []).slice(); }
  function entryFor(n, tid) { var e = entriesFor(n); for (var i = 0; i < e.length; i++) if (String(e[i].tournament_id) === String(tid)) return e[i]; return null; }
  // A team's most relevant tournament this weekend: live first, then soonest.
  function bestFor(n) {
    var list = tns().filter(function (t) { return t.teams && t.teams.indexOf(n) >= 0; });
    list.sort(function (a, b) { return (b.live_today ? 1 : 0) - (a.live_today ? 1 : 0) || String(a.start).localeCompare(String(b.start)); });
    return list[0] || null;
  }
  function anyLive() { return tns().some(function (t) { return t.live_today; }); }

  // ---------- pieces
  function statusChip(tn, s) {
    var fin = isFinal(s, tn);
    var st = fin ? "final" : tn.status;
    var txt = fin ? "Final" : st === "not_posted" ? "Not posted yet" : tn.status_text;
    if (st === "live") return '<span class="chip live"><span class="live-dot" aria-hidden="true"></span>Live</span>';
    var cls = st === "final" ? "final" : st === "posted" ? "posted" : "";
    return '<span class="chip ' + cls + '">' + esc(txt || "") + "</span>";
  }
  function extLink(url, text) { return url ? '<a class="ext" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(text) + ' <span aria-hidden="true">↗</span><span class="sr"> (opens in a new tab)</span></a>' : ""; }
  function tzNote(tn) {
    var now = nowFor(tn); if (!now || !tn.tz) return "";
    var d = new Date();
    var dev = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
    if (Math.abs(lms(dev) - lms(now)) < 30 * 60000) return "";
    return '<p class="tznote">All times are venue time (' + esc(tzShort(tn.tz)) + "). It’s " + esc(fmtTime(now)) + " there now.</p>";
  }
  function workOn(w, now) { return !!(w && w.start && w.start <= now && now < (w.end || addMin(w.start, 60))); }
  // busy: one of our matches is live. withNext keeps a match live until it's
  // scored, and courts run late, so a duty whose start has passed meanwhile is
  // what comes after the match — "WORK NEXT", never "WORKING NOW" while playing.
  function workLine(w, now, busy) {
    if (!w) return "";
    var on = workOn(w, now);
    return '<div class="nx-work"><span class="tag wk">' + (on ? (busy ? "WORK NEXT" : "WORKING NOW") : "WORK") + "</span><div><b>" + esc(dayTime(w.start, now)) + (w.court ? " · " + esc(courtText(w.court)) : "") + "</b>" +
      (w.teams || w.round ? "<small>" + esc([w.teams, w.round].filter(Boolean).join(" · ")) + "</small>" : "") + "</div></div>";
  }
  function finishText(f) { return f && f.text ? f.text : ""; }
  // "overall" only when the place is division-wide (AES OverallRank); an OTTO
  // tied rank with a heading ("1st (Gold 1)") or AES's flight place is not.
  function isOverall(f) { return !!(f && f.overall === true); }
  function finishFull(f) { return finishText(f) + (isOverall(f) ? " overall" : ""); }
  // A pool place, as parents say it: "Finished 1st in Div 1 Pool 6".
  function poolFin(p) { return p && p.name && p.rank != null ? "Finished " + (p.rank_text || ord(p.rank)) + " in " + p.name : ""; }
  // Which result a final match was. Two-set pool play can end 1-1: a split, not a loss.
  function resultWord(m) { return m.won === true ? "Won" : m.won === false ? "Lost" : "Split"; }
  // OTTO's "done" is a guess (finished matches, nothing upcoming, no pool going
  // on) that is also true between rounds — pool play over, crossovers not
  // seeded yet. Without a finish place it only means final once the event is
  // over (the HQ view's rule, src/TournamentHub.jsx).
  function isFinal(s, tn) {
    if (!s) return false;
    if (s.finish) return true;
    if (!s.done) return false;
    return s.platform !== "otto" || !!(tn && tn.end && (day(nowFor(tn)) || tn.today) > tn.end);
  }
  function recText(r) { return r ? r.mw + "–" + r.ml + " in matches · " + r.sw + "–" + r.sl + " in sets" : ""; }

  function nextCard(s, tn) {
    var now = nowFor(tn), n = s.next || {}, live = n.live, play = n.play;
    if (!live && !play) {
      if (isFinal(s, tn)) {
        // Done playing can still mean a work duty to go (AES lists a team's
        // finish while it still works a later match), so the work line stays.
        return '<div class="next done"><span class="eyebrow">Final</span>' +
          (s.finish ? '<p class="fin">' + esc(finishText(s.finish)) + (isOverall(s.finish) ? "<small>overall</small>" : "") + "</p>" +
            (s.finish.flight_text ? '<p class="mut">' + esc(s.finish.flight_text) + " in its flight</p>" : "")
            : '<p class="big">' + (n.work ? "Done playing" : "All done") + "</p>") +
          (s.record ? '<p class="mut">' + esc(recText(s.record)) + "</p>" : "") + workLine(n.work, now) + "</div>";
      }
      var waiting = s.paths && s.paths.length;
      return '<div class="next wait"><span class="eyebrow">Next match</span><p class="big">' + (waiting ? "Waiting on this round’s results" : s.done ? "No more matches posted yet" : "Not scheduled yet") + "</p>" +
        (waiting ? '<p class="mut">Where we play next depends on how we finish — see below.</p>' : '<p class="mut">The next round shows here as soon as the tournament desk posts it.</p>') +
        workLine(n.work, now) + "</div>";
    }
    var m = live || play;
    var h = '<div class="next' + (live ? " is-live" : "") + '" aria-label="' + (live ? "Playing now" : "Next match") + '">';
    h += '<div class="nx-top"><span class="eyebrow">' + (live ? "Playing now" : "Next match") + "</span>" +
      (live ? '<span class="badge"><span class="live-dot" aria-hidden="true"></span>LIVE</span>' : '<span class="rel">' + esc(rel(m.start, now)) + "</span>") + "</div>";
    h += '<div class="nx-main"><div class="nx-time">' + (day(m.start) !== day(now) ? "<small>" + esc(fmtDay(m.start)) + "</small>" : "") + esc(fmtTime(m.start)) + "</div>" +
      (m.court ? '<div class="nx-court"><small>Court</small>' + esc(m.court) + "</div>" : "") + "</div>";
    h += '<div class="nx-opp">vs ' + esc(m.opponent || "opponent TBD") + "</div>";
    var sub = [m.round, m.label, m.opponent_club].filter(Boolean).join(" · ");
    if (sub) h += '<div class="nx-sub">' + esc(sub) + "</div>";
    if (live && play && play.id !== live.id) h += '<div class="nx-then">Then <b>' + esc(dayTime(play.start, now)) + "</b>" + (play.court ? " · " + esc(courtText(play.court)) : "") + " vs " + esc(play.opponent || "TBD") + "</div>";
    h += workLine(n.work, now, !!live);
    return h + "</div>";
  }

  function statsStrip(s) {
    // [value, label, small-suffix] — all text, escaped once at the end.
    var c = [];
    if (s.record && (s.record.mw + s.record.ml > 0)) { c.push([s.record.mw + "–" + s.record.ml, "Matches"]); c.push([s.record.sw + "–" + s.record.sl, "Sets"]); }
    // The pool before this one (round 1 of pool-to-pool formats, or the pool
    // left for a bracket): its place, once known.
    var lp = s.last_pool;
    if (lp && lp.name && lp.rank != null) c.push([lp.rank_text || ord(lp.rank), "Finished in " + lp.name, lp.teams ? " of " + lp.teams : ""]);
    if (s.pool && s.pool.name) {
      if (s.pool.rank != null) c.push([s.pool.rank_text || ord(s.pool.rank), s.pool.name, s.pool.teams ? " of " + s.pool.teams : ""]);
      else c.push([s.pool.name, s.pool.teams ? s.pool.teams + " teams · in play" : "In play"]);
    }
    if (s.finish && s.finish.text) c.push([s.finish.text, isOverall(s.finish) ? "Overall finish" + (s.finish.flight_text ? " · " + s.finish.flight_text + " in flight" : "") : "Finish"]);
    if (!c.length) return "";
    return '<div class="stats">' + c.map(function (x) { return '<div class="stat"><b>' + esc(x[0]) + (x[2] ? '<small style="display:inline;font-size:.9rem">' + esc(x[2]) + "</small>" : "") + "</b><small>" + esc(x[1]) + "</small></div>"; }).join("") + "</div>";
  }

  function pathsCard(s, tn) {
    if (!s.paths || !s.paths.length) return "";
    var now = nowFor(tn);
    var byRank = s.paths.every(function (p) { return /^\d+(st|nd|rd|th)\b/.test(p.if || ""); });
    return '<div class="card"><h3 class="sect" style="margin-top:0">' + (byRank ? "If we finish…" : "What’s next") + '</h3><ul class="pl">' + s.paths.map(function (p) {
      // A place that goes to a round the director reseeds first has no time yet.
      return '<li><span class="pif">' + esc(p.if) + '</span><span class="pgo"><b>' + esc(p.start ? dayTime(p.start, now) : "Time TBD") + (p.court ? " · " + esc(courtText(p.court)) : "") + "</b>" +
        "<small>" + esc([p.round, p.work_start ? "work " + dayTime(p.work_start, now) + (p.work_court ? " " + courtText(p.work_court) : "") : ""].filter(Boolean).join(" · ")) + "</small></span></li>";
    }).join("") + "</ul></div>";
  }

  function setChips(sets) {
    if (!sets || !sets.length) return "";
    return '<span class="sets" aria-label="Set scores, ours first">' + sets.map(function (x) { return '<i class="' + (+x[0] > +x[1] ? "w" : "l") + '">' + (+x[0]) + "-" + (+x[1]) + "</i>"; }).join("") + "</span>";
  }
  // The same item as the NEXT card's (withNext): by id, else by start + court.
  function same(a, b) { return !!(a && b) && (a.id != null && b.id != null ? String(a.id) === String(b.id) : a.start === b.start && String(a.court || "") === String(b.court || "")); }
  // LIVE only on the match the NEXT card calls live — withNext's rule (started,
  // not scored yet, today, nothing of ours scored after it), so the card and
  // the list never disagree when a court runs late.
  function matchRow(m, now, nx) {
    var live = !m.final && same(m, nx.live);
    var w = m.final && m.won === true, l = m.final && m.won === false, split = m.final && !w && !l && m.sets && m.sets.length;
    var sw = (m.sets || []).filter(function (x) { return x[0] > x[1]; }).length, sl = (m.sets || []).length - sw;
    var right = m.final ? '<span class="res ' + (w ? "w" : l ? "l" : split ? "s" : "") + '" aria-label="' + (w ? "Won" : l ? "Lost" : split ? "Split" : "Final") + '">' + (w ? "W" : l ? "L" : split ? "Split" : "–") + "</span>" + (m.sets && m.sets.length ? "<small>" + sw + "-" + sl + "</small>" : "")
      : live ? '<span class="badge"><span class="live-dot" aria-hidden="true"></span>LIVE</span>' : "";
    return '<li class="it' + (live ? " live" : m.final ? " past" : "") + '"><span class="t">' + esc(fmtTime(m.start)) + '</span><span class="b"><b>vs ' + esc(m.opponent || "TBD") + "</b>" +
      "<small>" + esc([m.round, m.label, courtText(m.court)].filter(Boolean).join(" · ")) + "</small>" + setChips(m.sets) + '</span><span class="r">' + right + "</span></li>";
  }
  // WORKING only on the NEXT card's duty while it's on and we aren't still playing.
  function workRow(w, now, nx) {
    var on = !nx.live && same(w, nx.work) && workOn(w, now);
    return '<li class="it wk"><span class="t">' + esc(fmtTime(w.start)) + '</span><span class="b"><b><span class="tag wk">' + (on ? "WORKING" : "WORK") + "</span> " + esc(courtText(w.court) || "Court TBD") + "</b>" +
      "<small>" + esc([w.teams, w.round, w.label].filter(Boolean).join(" · ")) + '</small></span><span class="r"></span></li>';
  }
  function daysList(s, tn) {
    var now = nowFor(tn), today = day(now), byDay = {}, dates = [], nx = s.next || {};
    function add(k, x) { var d = day(x.start) || "TBD"; if (!byDay[d]) { byDay[d] = []; dates.push(d); } byDay[d].push({ k: k, x: x }); }
    (s.matches || []).forEach(function (m) { add("m", m); });
    (s.work || []).forEach(function (w) { add("w", w); });
    if (!dates.length) return "";
    dates.sort();
    var openDefault = dates.indexOf(today) >= 0 ? today : (dates.filter(function (d) { return d >= today; })[0] || dates[dates.length - 1]);
    return dates.map(function (d) {
      var items = byDay[d].sort(function (a, b) { return String(a.x.start).localeCompare(String(b.x.start)) || (a.k === "m" ? -1 : 1); });
      var ms = items.filter(function (i) { return i.k === "m"; }).map(function (i) { return i.x; });
      var won = ms.filter(function (m) { return m.final && m.won === true; }).length, lost = ms.filter(function (m) { return m.final && m.won === false; }).length;
      var splits = ms.filter(function (m) { return m.final && m.won !== true && m.won !== false && m.sets && m.sets.length; }).length;
      var key = tn.id + "|" + d;
      var open = Object.prototype.hasOwnProperty.call(openDays, key) ? openDays[key] : d === openDefault;
      var cnt = ms.length + (ms.length === 1 ? " match" : " matches") + (won + lost + splits ? " · " + won + "–" + lost + (splits ? " · " + splits + " split" : "") : "");
      return '<details class="day" data-key="' + esc(key) + '"' + (open ? " open" : "") + "><summary><span>" + (d === today ? "Today · " : "") + esc(d === "TBD" ? "Time TBD" : fmtDay(d)) + '</span><span class="cnt">' + esc(cnt) + "</span></summary>" +
        '<ul class="list">' + items.map(function (i) { return i.k === "m" ? matchRow(i.x, now, nx) : workRow(i.x, now, nx); }).join("") + "</ul></details>";
    }).join("");
  }

  function tnBlock(tn, e) {
    var s = e && e.snapshot;
    var h = '<section class="tn" aria-labelledby="tn-' + esc(tn.id) + '"><div class="tn-hd"><div>' + (isThisWeekend(tn) ? "" : '<span class="eyebrow">' + laterHeading([tn]) + "</span>") + '<h2 id="tn-' + esc(tn.id) + '">' + esc(tn.name) + "</h2>" +
      '<p class="meta">' + esc([dateRange(tn.start, tn.end), place(tn), s && s.division].filter(Boolean).join(" · ")) + "</p></div>" + statusChip(tn, s) + "</div>";
    if (!s) {
      h += '<div class="card soft"><p class="big">Schedule not posted yet</p><p class="mut">' +
        (tn.posts_hint && (tn.today || day(nowFor(tn))) < tn.posts_hint ? "Tournament directors usually post it the week of the event — around " + esc(fmtDay(tn.posts_hint)) + ". " : "Directors usually post it a few days ahead, so it should be up any time now. ") +
        "This page fills in on its own as soon as it’s up" + (pushRec() ? ", and you’ll get an alert." : ".") + "</p>" +
        (e && e.feed_url ? extLink(e.feed_url, "Open on " + platformName(e.platform)) : "") + "</div>";
      return h + "</section>";
    }
    h += tzNote(tn) + nextCard(s, tn) + statsStrip(s) + pathsCard(s, tn) + daysList(s, tn);
    h += '<div class="tn-ft">' + extLink(s.team_url || (e && e.feed_url), "Open on " + platformName(s.platform)) +
      '<span class="upd">Updated <span data-ago="' + esc((e && e.checked_at) || D.generated_at) + '"></span></span></div>';
    return h + "</section>";
  }

  function seasonList(name) {
    var list = (D.upcoming && D.upcoming[name]) || [];
    if (!list.length) return "";
    return '<section class="card" aria-labelledby="season-h"><h2 class="sect" id="season-h" style="margin-top:0">Season schedule</h2><ul class="season">' + list.map(function (u) {
      return '<li><span class="sd">' + esc(fmtDay(u.start)) + (u.end && u.end !== u.start ? "<small>– " + esc(fmtDay(u.end)) + "</small>" : "") + "</span><span><b>" + esc(u.name) + "</b>" + (u.tentative ? '<span class="tag tent">Tentative</span>' : "") +
        (place(u) ? "<small>" + esc(place(u)) + "</small>" : "") + (u.posts_hint ? "<small>Schedule posts ~" + esc(fmtDay(u.posts_hint)) + "</small>" : "") + "</span>" +
        "</li>";
    }).join("") + "</ul></section>";
  }

  // ---------- alerts (web push)
  var ua = navigator.userAgent || "";
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var standalone = navigator.standalone === true || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  var canPush = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  function pushState() {
    if (DEMO) return "demo";
    if (!BOOT.vapid) return "nokey";
    if (pushRec() && canPush && Notification.permission === "granted") return "on";
    if (isIOS && !standalone) return "ios";
    if (!canPush) return "unsupported";
    if (Notification.permission === "denied") return "denied";
    return "off";
  }
  function alertsCard(team) {
    var st = pushState();
    if (st === "nokey") return "";
    var h = '<section class="card alerts" id="alerts" aria-labelledby="alerts-h"><h2 class="sect" id="alerts-h" style="margin-top:0">Alerts</h2>';
    var what = "Next match (time, court, opponent), every score, pool finish and final place — sent to this phone. Nothing overnight.";
    if (st === "demo") return h + '<p class="mut">Alerts are off in the demo. On a DS Elite team page, Notify me sends ' + esc(what.charAt(0).toLowerCase() + what.slice(1)) + "</p></section>";
    if (st === "ios") return h + "<p>" + esc(what) + '</p><p class="mut">On iPhone, alerts work from the Home Screen app:</p><ol class="steps"><li>Tap <b>Share</b> at the bottom of Safari</li><li>Choose <b>Add to Home Screen</b></li><li>Open <b>DS Elite</b> from your Home Screen and tap <b>Notify me</b></li></ol></section>';
    if (st === "unsupported") return h + '<p class="mut">This browser can’t show alerts. Chrome on Android, or Safari on iPhone (iOS 16.4+, from the Home Screen) can.</p></section>';
    if (st === "denied") return h + '<p class="mut">Notifications are blocked for this site. Allow them in your browser’s site settings, then come back.</p></section>';
    var rec = pushRec(), f = follows().filter(teamByName);
    if (st === "on") {
      var list = (rec.teams || []).filter(teamByName);
      h += '<p><span class="ok">Alerts on</span> for ' + esc(list.join(", ") || "your teams") + ".</p>";
      if (team && list.indexOf(team.name) < 0) h += '<button type="button" class="btn" data-act="notify">Add ' + esc(team.name) + "</button>";
      return h + '<button type="button" class="btn ghost" data-act="notify-off">Turn off alerts</button></section>';
    }
    h += "<p>" + esc(what) + "</p>";
    if (team) return h + '<button type="button" class="btn" data-act="notify">🔔 Notify me about ' + esc(team.name) + "</button></section>";
    if (f.length) return h + '<button type="button" class="btn" data-act="notify">🔔 Notify me about my teams</button></section>';
    return h + '<p class="mut">Follow a team first, then tap Notify me on its page.</p></section>';
  }
  function b64u8(b64) { var s = (b64 + "===".slice((b64.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/"); var raw = atob(s), out = new Uint8Array(raw.length); for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i); return out; }
  function swActive(reg) {
    return new Promise(function (res) {
      if (reg.active) return res(reg);
      var w = reg.installing || reg.waiting; if (!w) return res(reg);
      w.addEventListener("statechange", function () { if (w.state === "activated") res(reg); });
    });
  }
  // Only the hub's own registration: with none, getRegistration("/hub") returns
  // HQ's "/" one, and turning hub alerts off must never unsubscribe a coach's HQ alerts.
  function hubReg() {
    return navigator.serviceWorker.getRegistration("/hub").then(function (r) {
      try { return r && new URL(r.scope).pathname.indexOf("/hub") === 0 ? r : null; } catch (e) { return null; }
    });
  }
  function postSub(sub, list) {
    return fetch("/api/hub-subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON ? sub.toJSON() : sub, teams: list }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || "HTTP " + r.status); lsSet(PKEY, { endpoint: sub.endpoint, teams: j.teams || list }); return j; }); });
  }
  function enablePush(addTeam) {
    if (addTeam) setFollow(addTeam, true);
    var list = follows().filter(teamByName).slice(0, 10);
    if (!list.length) return;
    var p = Notification.requestPermission();
    Promise.resolve(p).then(function (perm) {
      if (perm !== "granted") throw new Error(perm === "denied" ? "Notifications are blocked for this site." : "Alerts weren’t turned on.");
      return navigator.serviceWorker.register("/sw.js", { scope: "/hub" });
    }).then(swActive).then(function (reg) {
      return reg.pushManager.getSubscription().then(function (sub) { return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u8(BOOT.vapid) }); });
    }).then(function (sub) { return postSub(sub, list); })
      .then(function (j) { render(); toast("Alerts on for " + (j.teams || list).join(", ")); })
      .catch(function (e) { render(); toast(e && e.message ? e.message : "Couldn’t turn on alerts"); });
  }
  function disablePush() {
    var rec = pushRec();
    var del = rec ? fetch("/api/hub-subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: rec.endpoint }) }).catch(function () {}) : Promise.resolve();
    del.then(function () { return canPush ? hubReg() : null; })
      .then(function (reg) { return reg && reg.pushManager.getSubscription(); })
      .then(function (sub) { return sub && sub.unsubscribe(); })
      .catch(function () {})
      .then(function () { lsSet(PKEY, null); render(); toast("Alerts off"); });
  }
  // Follow/unfollow while alerts are on: the server's team list follows along.
  function syncPush() {
    var rec = pushRec(); if (!rec || !canPush) return;
    var list = follows().filter(teamByName).slice(0, 10);
    if (!list.length) return disablePush();
    hubReg().then(function (reg) { return reg && reg.pushManager.getSubscription(); })
      .then(function (sub) { if (sub) return postSub(sub, list).then(render); lsSet(PKEY, null); render(); })
      .catch(function () {});
  }
  // A subscription the browser dropped (cleared site data, reinstall) shows as off.
  function checkPush() {
    if (!pushRec() || !canPush) return;
    hubReg().then(function (reg) { return reg ? reg.pushManager.getSubscription() : null; })
      .then(function (sub) { if (!sub) { lsSet(PKEY, null); render(); } }).catch(function () {});
  }

  // ---------- views
  function topBar(team) {
    var h = '<nav class="top" aria-label="Hub">';
    h += team || SLUG ? '<a class="back" href="' + esc(qs("")) + '"><span aria-hidden="true">‹</span> All teams</a>' : '<a class="brand" href="' + esc(qs("")) + '">DS Elite <i>Hub</i></a>';
    h += '<div class="acts">';
    if (team) {
      var on = isFollowed(team.name);
      h += '<button type="button" class="act" data-act="follow" aria-pressed="' + on + '">' + (on ? "★ Following" : "☆ Follow") + "</button>";
      h += '<button type="button" class="act" data-act="share">Share</button>';
    }
    h += '<button type="button" class="act icon" data-act="refresh" aria-label="Refresh"' + (busy ? " disabled" : "") + '><span aria-hidden="true"' + (busy ? ' class="spin"' : "") + ">↻</span></button>";
    return h + "</div></nav>";
  }
  function demoBar() {
    if (!DEMO || !D || !D.demo) return "";
    return '<div class="demo" role="note"><b>DEMO</b> · real ' + esc(platformName(D.demo.platform)) + " data for " + esc(D.demo.club) + (D.demo.event_name ? " at " + esc(D.demo.event_name) : "") +
      ' — not DS Elite. <a href="/hub">Exit demo</a></div>';
  }
  // How fresh the schedules on screen are: the oldest check among today's live
  // tournaments (else all shown), not when this response was built — so a
  // stalled sync can't hide behind "Updated just now".
  function dataAsOf() {
    var list = tns().filter(function (t) { return t.live_today; });
    if (!list.length) list = tns();
    var o = null;
    list.forEach(function (t) {
      (t.teams || []).forEach(function (n) { var e = entryFor(n, t.id); if (e && e.checked_at && (!o || Date.parse(e.checked_at) < Date.parse(o))) o = e.checked_at; });
    });
    return o || D.generated_at;
  }
  function footer() {
    var plats = {}; tns().forEach(function (t) { (t.feeds || []).forEach(function (f) { plats[platformName(f.platform)] = 1; }); });
    var src = Object.keys(plats).join(" and ") || "AES and OTTO";
    return '<footer class="ft"><p>Schedules checked <span data-ago="' + esc(dataAsOf()) + '"></span>' + (anyLive() ? " · this page refreshes every minute" : "") + "</p>" +
      "<p>Schedules and scores come from " + esc(src) + ". The tournament desk has the final word.</p>" +
      (DEMO ? "" : '<p><a href="/">Coaches: DS Elite HQ</a></p>') + "</footer>";
  }

  function teamView() {
    var t = D.team;
    if (!t) {
      return topBar(null) + '<header class="hd"><span class="eyebrow">Tournament Hub</span><h1>Team not found</h1><p class="sub">That link doesn’t match a team. Pick yours:</p></header>' + allTeams() + footer();
    }
    var h = topBar(t) + demoBar();
    h += '<header class="hd"><span class="eyebrow">' + esc(DEMO ? (D.demo && D.demo.club) || "Demo" : "DS Elite · " + t.group) + "</span><h1>" + esc(t.name) + "</h1></header>";
    var list = tns();
    if (!list.filter(isThisWeekend).length) {
      var up = list[0] || ((D.upcoming && D.upcoming[t.name]) || [])[0];
      h += '<div class="card soft"><p class="big">No tournament this weekend</p><p class="mut">' + (up ? "Next up: <b>" + esc(up.name) + "</b>, " + esc(dateRange(up.start, up.end)) + "." : "Nothing else is on the schedule yet.") + "</p></div>";
    }
    list.forEach(function (tn) { h += tnBlock(tn, entryFor(t.name, tn.id)); });
    h += seasonList(t.name) + alertsCard(t) + footer();
    return h;
  }

  // "Working now · Court 3" / "Work 4:00 PM · Court 3"; never "Working now"
  // while one of our matches is still live (busy — see workLine).
  function workText(w, now, busy) { return (workOn(w, now) && !busy ? "Working now" : "Work " + dayTime(w.start, now)) + (w.court ? " · " + courtText(w.court) : ""); }
  function nextSummary(n, tn, e) {
    // The compact NEXT used on My teams cards and team chips.
    var s = e && e.snapshot, now = nowFor(tn);
    if (!s) return { live: false, html: '<div class="mc-l">' + esc(tn.name) + '</div><div class="mc-s">' + esc(dateRange(tn.start, tn.end)) + " · schedule not posted yet</div>", chip: "" };
    var nx = s.next || {}, m = nx.live || nx.play, w = nx.work;
    if (m) {
      return { live: !!nx.live,
        html: '<div class="mc-next">' + (nx.live ? '<span class="badge"><span class="live-dot" aria-hidden="true"></span>LIVE</span>' : "") +
          (day(m.start) !== day(now) ? '<span class="dy">' + esc(fmtDay(m.start)) + "</span>" : "") + '<span class="tm">' + esc(fmtTime(m.start)) + "</span>" +
          (m.court ? '<span class="ct">' + esc(courtText(m.court)) + "</span>" : "") + "</div>" +
          '<div class="mc-l">vs ' + esc(m.opponent || "TBD") + "</div>" +
          '<div class="mc-s">' + esc([w ? workText(w, now, !!nx.live) : "", s.record && s.record.mw + s.record.ml ? "Record " + s.record.mw + "–" + s.record.ml : ""].filter(Boolean).join(" · ")) + "</div>",
        chip: nx.live ? "LIVE" + (m.court ? " · " + courtText(m.court) : "") : dayTime(m.start, now) + (m.court ? " · " + courtText(m.court) : "") };
    }
    if (isFinal(s, tn)) {
      // Done playing with a duty still to work: the duty is what's next.
      if (w) return { live: false, html: '<div class="mc-l">' + esc(workText(w, now)) + '</div><div class="mc-s">' + esc([s.finish ? "Finished " + finishFull(s.finish) : "Done playing", recText(s.record)].filter(Boolean).join(" · ")) + "</div>", chip: workOn(w, now) ? "Working now" : "Work " + dayTime(w.start, now) };
      return { live: false, html: '<div class="mc-l">Final: ' + esc(s.finish ? finishFull(s.finish) : "Done") + '</div><div class="mc-s">' + esc(recText(s.record)) + "</div>", chip: s.finish ? finishText(s.finish) : "Final" };
    }
    var last = s.last || (s.matches || []).filter(function (x) { return x.final; }).pop();
    var lastText = last ? resultWord(last) + ((last.sets || []).length ? " " + last.sets.map(function (x) { return x[0] + "-" + x[1]; }).join(", ") : "") + " vs " + (last.opponent || "TBD") : "";
    var pf = poolFin(s.pool) || poolFin(s.last_pool);
    return { live: false, html: '<div class="mc-l">Waiting on the next round</div><div class="mc-s">' + esc((w ? [workText(w, now), pf || lastText] : [pf, lastText]).filter(Boolean).join(" · ") || tn.name) + "</div>", chip: w && workOn(w, now) ? "Working now" : "Waiting" };
  }
  function myCard(name) {
    var t = teamByName(name); if (!t) return "";
    var tn = bestFor(name), body, live = false;
    if (tn) { var x = nextSummary(name, tn, entryFor(name, tn.id)); body = x.html; live = x.live; }
    else {
      var up = ((D.upcoming && D.upcoming[name]) || [])[0];
      body = up ? '<div class="mc-l">Next: ' + esc(up.name) + '</div><div class="mc-s">' + esc(dateRange(up.start, up.end) + (place(up) ? " · " + place(up) : "")) + "</div>" : '<div class="mc-s">No tournaments on the schedule yet</div>';
    }
    return '<a class="mycard' + (live ? " is-live" : "") + '" href="' + esc(qs(t.slug)) + '"><div class="mc-hd"><b>' + esc(name) + '</b><span class="chev" aria-hidden="true">›</span></div>' + body + "</a>";
  }
  function teamChip(n, tn) {
    var t = teamByName(n); if (!t) return "";
    var x = nextSummary(n, tn, entryFor(n, tn.id));
    return '<a class="tchip" href="' + esc(qs(t.slug)) + '">' + esc(n) + (x.chip ? '<small class="' + (x.live ? "lv" : "") + '">' + esc(x.chip) + "</small>" : "") + "</a>";
  }
  // The list reaches 10 days out; tn.weekend says which weekend (demo: none → this).
  function isThisWeekend(t) { return !t.weekend || t.weekend === "this"; }
  function laterHeading(list) { return list.every(function (t) { return t.weekend === "next"; }) ? "Next weekend" : "Coming up"; }
  function weekend() {
    var cur = tns().filter(isThisWeekend);
    var later = tns().filter(function (t) { return !isThisWeekend(t); }).sort(function (a, b) { return String(a.start).localeCompare(String(b.start)); });
    function cards(list) {
      return list.map(function (tn) {
        return '<article class="card tncard"><div class="tc-hd"><h3>' + esc(tn.name) + "</h3>" + statusChip(tn, null) + '</div><p class="meta">' + esc([dateRange(tn.start, tn.end), place(tn)].filter(Boolean).join(" · ")) + "</p>" +
          '<div class="chips">' + (tn.teams || []).map(function (n) { return teamChip(n, tn); }).join("") + "</div></article>";
      }).join("");
    }
    var h = '<section aria-labelledby="wk-h"><h2 class="sect" id="wk-h">' + (cur.length && cur.every(function (t) { return t.live_today; }) ? "Today" : "This weekend") + "</h2>";
    if (!cur.length) {
      var nu = D.next_up;
      h += '<div class="card soft"><p class="big">No tournaments this weekend</p>';
      if (nu && nu.tournaments && nu.tournaments.length) {
        h += '<p class="mut">Next tournament weekend: <b style="color:var(--ink)">' + esc(fmtDay(nu.start)) + "</b></p><ul class=\"nu\">" + nu.tournaments.map(function (t) {
          return "<li><b>" + esc(t.name) + "</b><small>" + esc([dateRange(t.start, t.end), place(t)].filter(Boolean).join(" · ")) + '</small><div class="chips">' +
            (t.teams || []).map(function (n) { var tm = teamByName(n); return tm ? '<a class="tchip" href="' + esc(qs(tm.slug)) + '">' + esc(n) + "</a>" : ""; }).join("") + "</div></li>";
        }).join("") + "</ul>";
      }
      h += "</div>";
    }
    h += cards(cur) + "</section>";
    if (later.length) h += '<section aria-labelledby="wk2-h"><h2 class="sect" id="wk2-h">' + laterHeading(later) + "</h2>" + cards(later) + "</section>";
    return h;
  }
  function allTeams() {
    var groups = {}, order = [];
    teams().forEach(function (t) { if (!groups[t.group]) { groups[t.group] = []; order.push(t.group); } groups[t.group].push(t); });
    return '<section aria-labelledby="all-h"><h2 class="sect" id="all-h">All teams</h2>' + order.map(function (g) {
      return '<h3 class="grp">' + esc(g) + '</h3><div class="tgrid">' + groups[g].map(function (t) {
        var tn = bestFor(t.name), small = "";
        if (tn) { var x = nextSummary(t.name, tn, entryFor(t.name, tn.id)); small = x.chip ? '<small class="' + (x.live ? "lv" : "") + '">' + esc(x.chip) + "</small>" : "<small>" + esc(fmtDay(tn.start)) + "</small>"; }
        return '<a class="tbtn" href="' + esc(qs(t.slug)) + '">' + (isFollowed(t.name) ? '<span class="star" aria-hidden="true">★</span><span class="sr">Following: </span>' : "") + "<b>" + esc(t.name) + "</b>" + small + "</a>";
      }).join("") + "</div>";
    }).join("") + "</section>";
  }
  function homeView() {
    var h = topBar(null) + demoBar();
    h += '<header class="hd"><span class="eyebrow">' + esc(DEMO ? (D.demo && D.demo.club) || "Demo" : "DS Elite Volleyball") + "</span><h1>Tournament Hub</h1>" +
      '<p class="sub">Who we play, when and on which court — live all tournament weekend.</p></header>';
    var f = follows().filter(teamByName);
    h += '<section aria-labelledby="my-h"><h2 class="sect" id="my-h">My teams</h2>';
    h += f.length ? f.map(myCard).join("") : '<div class="card soft"><p class="big">Follow your team</p><p class="mut">Tap your team below, then <b style="color:var(--ink)">☆ Follow</b>. It’ll be right here with its next match every time you open the hub.</p></div>';
    h += "</section>" + weekend() + allTeams() + alertsCard(null) + footer();
    return h;
  }

  function render() {
    if (!D) { app.innerHTML = topBar(null) + '<div class="skel" aria-hidden="true"></div><div class="skel" aria-hidden="true"></div><p class="sr" role="status">Loading</p>'; return; }
    if (D.ok === false) {
      app.innerHTML = topBar(null) + '<div class="card" role="alert"><p class="big">Couldn’t load the schedule</p><p class="mut">' + esc(D.error || "Try again in a minute.") + '</p><button type="button" class="btn" data-act="refresh">Try again</button>' + (DEMO || BOOT.error ? '<a class="btn ghost" style="text-align:center;text-decoration:none" href="/hub">Go to the DS Elite hub</a>' : "") + "</div>";
      return;
    }
    app.innerHTML = SLUG ? teamView() : homeView();
    document.title = SLUG && D.team ? D.team.name + " · DS Elite Hub" : "DS Elite Tournament Hub";
    tickAgo();
  }
  function tickAgo() { var els = app.querySelectorAll("[data-ago]"); for (var i = 0; i < els.length; i++) els[i].textContent = ago(els[i].getAttribute("data-ago")); }

  // ---------- refresh
  function schedule() {
    clearTimeout(timer);
    if (D && D.ok !== false && anyLive() && document.visibilityState === "visible") timer = setTimeout(function () { refresh(false); }, 60000);
  }
  function refresh(manual) {
    if (busy) return;
    busy = true;
    if (manual) render();
    fetch(qs(SLUG, true), { cache: "no-store", headers: { Accept: "application/json" } })
      .then(function (r) { return r.json().then(function (j) { return { r: r, j: j }; }); })
      .then(function (x) {
        if (x.j && (x.r.ok || x.r.status === 404)) { D = x.j; fetchedAt = Date.now(); }
        else if (!D || D.ok === false) D = { ok: false, error: (x.j && x.j.error) || "Couldn’t reach the schedule." };
        else toast("Couldn’t refresh — showing the last update");
      })
      .catch(function () {
        if (!D || D.ok === false) D = { ok: false, error: navigator.onLine === false ? "You’re offline." : "Couldn’t reach the schedule." };
        else toast(navigator.onLine === false ? "You’re offline — showing the last update" : "Couldn’t refresh — try again");
      })
      .then(function () { busy = false; render(); schedule(); });
  }

  // ---------- actions
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add("on");
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.classList.remove("on"); }, 3200);
  }
  function share() {
    var t = D && D.team;
    var url = location.origin + qs(t ? t.slug : "");
    var title = t ? t.name + " · DS Elite Tournament Hub" : "DS Elite Tournament Hub";
    if (navigator.share) { navigator.share({ title: title, text: t ? "Schedule, courts and scores for " + t.name : title, url: url }).catch(function () {}); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { toast("Link copied"); }, function () { window.prompt("Copy this link", url); });
    else window.prompt("Copy this link", url);
  }
  app.addEventListener("click", function (ev) {
    var el = ev.target.closest ? ev.target.closest("[data-act]") : null;
    if (!el) return;
    var act = el.getAttribute("data-act");
    if (act === "refresh") refresh(true);
    else if (act === "share") share();
    else if (act === "follow" && D && D.team) {
      var on = !isFollowed(D.team.name);
      setFollow(D.team.name, on); render(); syncPush();
      toast(on ? "Following " + D.team.name + " — it’s on your hub home now" : "Unfollowed " + D.team.name);
    }
    else if (act === "notify") enablePush(D && D.team ? D.team.name : null);
    else if (act === "notify-off") disablePush();
  });
  // Keep each day open/closed the way the parent left it across refreshes.
  app.addEventListener("toggle", function (ev) { var d = ev.target; if (d && d.matches && d.matches("details.day")) openDays[d.getAttribute("data-key")] = d.open; }, true);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") { clearTimeout(timer); return; }
    if (Date.now() - fetchedAt > 60000) refresh(false); else schedule();
  });
  setInterval(tickAgo, 30000);
  // Home Screen app: keep the hub's service worker registered so alerts and
  // the offline fallback keep working.
  if (standalone && canPush && !DEMO) navigator.serviceWorker.register("/sw.js", { scope: "/hub" }).catch(function () {});

  if (BOOT.error && !D) D = { ok: false, error: BOOT.error };
  render();
  if (!BOOT.data && !BOOT.error) refresh(false); else schedule();
  checkPush();
})();
`;

function page({ title, description, boot, origin, ogUrl }) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#12100f">
<meta name="description" content="${esc(description)}">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<meta name="apple-mobile-web-app-title" content="DS Elite">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(origin)}/icon-512.png">
<meta property="og:url" content="${esc(ogUrl)}">
<title>${esc(title)}</title>
<link rel="manifest" href="/hub.webmanifest">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Source+Sans+3:wght@400;600;700;800&display=swap">
<style>${CSS}</style>
</head><body>
<div class="wrap"><main id="app"><noscript><div class="card"><p class="big">Turn on JavaScript to see schedules and scores.</p></div></noscript></main></div>
<div id="toast" class="toast" role="status" aria-live="polite"></div>
<script type="application/json" id="hub-boot">${safeJson(boot)}</script>
<script>${CLIENT_JS}</script>
</body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("GET only");
  }
  const q = hubQuery(req);
  const demo = q.demo ? parseDemo(q.demo) : null;
  const tz = q.tz && /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(q.tz) ? q.tz : null;
  let data = null, error = null, status = 200;
  if (q.demo && !demo) { error = "That demo link isn't right. It should look like ?demo=aes:<key>:<clubId>."; status = 400; }
  else if (!demo) {
    try {
      data = await buildHubData(hubSupabase(), q);
      if (data.not_found) status = 404;
    } catch (e) {
      // Render the page anyway; its script retries /api/hub-data.
      console.error("hub", q, e);
      data = null;
    }
  }
  const origin = appOrigin(req);
  const team = data?.team || null;
  const title = team ? `${team.name} · DS Elite Tournament Hub` : demo ? "Demo · DS Elite Tournament Hub" : "DS Elite Tournament Hub";
  const description = team ? `${team.name}: next match, courts, work duties and live scores.` : "DS Elite Volleyball tournament schedules, courts and live scores.";
  const ogUrl = origin + "/hub" + (q.team && !demo ? "?team=" + encodeURIComponent(slugOf(q.team)) : "");
  const boot = {
    team: q.team ? slugOf(q.team) : null,
    demo: demo ? demo.param : null,
    tz: demo ? tz : null,
    vapid: demo ? null : (process.env.VAPID_PUBLIC_KEY || "").trim() || null,
    data,
    error,
  };
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  // The HTML carries the data, so it's cached like the data; a demo page is
  // just the shell (its data comes from /api/hub-data).
  res.setHeader("Cache-Control", demo ? "public, s-maxage=300, stale-while-revalidate=600" : data ? "public, s-maxage=30, stale-while-revalidate=60" : "no-store");
  return res.status(status).send(page({ title, description, boot, origin, ogUrl }));
}
