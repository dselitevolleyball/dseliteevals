// The testing leaderboard on the DSSC 42" touch-screen TV (Drew, Oct 14 2026):
// "highlight the top 20 athletes for each of the measurements (Vertical,
// Approach Jump, Standing Jump, Broad Jump, 10 yard dash) ... clear buttons to
// filter - male female, age group etc. ... a search bar for players to see how
// they rank ... first name and last name initial only ... cycle through these
// highlights ... make it look cool for the top three ... highlight best growth
// for testing as it happens."
//
// Left alone it plays a slideshow: each test's top 20 for everyone, biggest
// gains, the leader of every age group, then the same for one age group (a
// different one each loop). A touch stops the show and the screen is theirs;
// after `idle_seconds` untouched it resets and plays again. Data comes from
// /api/leaderboard every few seconds; a result Brandon saves gets its own
// moment on screen once it has held still for one poll (so a half-typed
// number never gets celebrated).
//
// Everything is drawn on a fixed 1920x1080 stage scaled to the screen.

import { useEffect, useMemo, useRef, useState } from "react";
import { fmtMetric } from "../shared/stat-report.js";

const STAGE_W = 1920, STAGE_H = 1080;
const AGES = ["U11", "U12", "U13", "U14", "U15", "U16+"];
const QS = new URLSearchParams(window.location.search);
const KEY = QS.get("k") || "";
const API = (QS.get("api") || "/api/leaderboard");
const LOGO = "/dssc/logo-horizontal-white.png";
const ALL = { gender: "all", age: "all", team: "all" };
const BOOT = Date.now();

const GAIN_MIN = (k) => (k === "dash_10y" ? 0.02 : 0.25);
const realGain = (k, g) => g != null && g >= GAIN_MIN(k);
const fmtGain = (k, g) => (k === "dash_10y" ? "−" + g.toFixed(2) + "s" : "+" + g.toFixed(2) + '"');
const fmtDay = (iso) => (iso ? new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Tryouts");
const matches = (a, f) => (f.gender === "all" || a.g === f.gender) && (f.age === "all" || a.ag === f.age) && (f.team === "all" || a.t === f.team);
const metaOf = (a) => [a.t, a.ag].filter(Boolean).join(" · ");
// Font size that keeps text on one line in a box (Archivo 900 runs ~0.58em a character).
const fit = (text, width, max, ratio = 0.58) => Math.max(18, Math.min(max, Math.floor(width / (String(text).length * ratio))));
const genderWord = (g) => (g === "F" ? "girls" : g === "M" ? "boys" : "athletes");

// Best first, standard competition ranks (1, 2, 2, 4).
function ranked(athletes, k, up) {
  const list = athletes.filter(a => a.m[k]).map(a => ({ a, v: a.m[k].best }));
  list.sort((x, y) => (up ? y.v - x.v : x.v - y.v) || x.a.n.localeCompare(y.a.n));
  let prev = null;
  for (let i = 0; i < list.length; i++) { list[i].rank = prev && prev.v === list[i].v ? prev.rank : i + 1; prev = list[i]; }
  return list;
}
// Where one athlete stands in a pool: { rank, n }.
function standing(athletes, a, k, up, f) {
  const list = ranked(athletes.filter(x => matches(x, f)), k, up);
  const me = list.find(x => x.a.id === a.id);
  return me ? { rank: me.rank, n: list.length } : null;
}

// The slideshow: everyone first (each test, gains, age-group leaders), then
// one age group's tests and gains; the age group moves on each loop.
function buildSlides(data) {
  const count = (k, f) => data.athletes.filter(a => a.m[k] && matches(a, f)).length;
  const gainers = (f) => data.athletes.filter(a => matches(a, f) && data.metrics.some(m => realGain(m.key, a.m[m.key]?.gain))).length;
  const allBlock = [...data.metrics.filter(m => count(m.key, ALL) >= 3).map(m => ({ tab: m.key, ...ALL })),
    ...(gainers(ALL) ? [{ tab: "gains", ...ALL }] : []), { tab: "leaders", ...ALL }];
  const ages = AGES.filter(ag => data.athletes.some(a => a.ag === ag));
  const out = [];
  for (const ag of ages.length ? ages : [null]) {
    out.push(...allBlock);
    if (!ag) continue;
    const f = { ...ALL, age: ag };
    out.push(...data.metrics.filter(m => count(m.key, f) >= 3).map(m => ({ tab: m.key, ...f })));
    if (gainers(f) >= 2) out.push({ tab: "gains", ...f });
  }
  return out.length ? out : [{ tab: "vertical", ...ALL }];
}

// Every result point on the board: "athlete|metric|date" -> value.
function pointsOf(d) {
  const s = new Map();
  for (const a of d.athletes) for (const k of Object.keys(a.m)) for (const [date, v] of a.m[k].hist) s.set(a.id + "|" + k + "|" + date, v);
  return s;
}
// A settled new result for one athlete -> what the TV says about it.
function describe(d, a, k, date, v) {
  const metric = d.metrics.find(m => m.key === k), mm = a.m[k];
  if (!metric || !mm) return null;
  const earlier = mm.hist.filter(([dd]) => dd !== date).map(([, x]) => x);
  const pb = earlier.length > 0 && (metric.up ? v > Math.max(...earlier) : v < Math.min(...earlier));
  const gain = mm.lastDate === date ? mm.gain : null;
  const sameG = { ...ALL, gender: a.g || "all" };
  return { k, v, date, pb, gain, all: standing(d.athletes, a, k, metric.up, sameG), age: a.ag ? standing(d.athletes, a, k, metric.up, { ...sameG, age: a.ag }) : null };
}

function useStageScale() {
  const [s, setS] = useState({ scale: 1, x: 0, y: 0 });
  useEffect(() => {
    const fit = () => { const sc = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H); setS({ scale: sc, x: (window.innerWidth - STAGE_W * sc) / 2, y: (window.innerHeight - STAGE_H * sc) / 2 }); };
    fit(); window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return s;
}

// Keep the TV awake and full screen (best effort - kiosk browsers vary).
let wakeLock = null;
async function keepAwake() { try { if ("wakeLock" in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); } } catch { /* not allowed here */ } }
function goFullscreen() { const el = document.documentElement; if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {}); }

// ── icons ───────────────────────────────────────────────────────────────────
const SearchIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-4.6-4.6" /></svg>;
const Crown = () => (
  <svg className="crown" viewBox="0 0 86 60"><defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff3b0" /><stop offset=".5" stopColor="#ffd24a" /><stop offset="1" stopColor="#d48c00" /></linearGradient></defs>
    <path d="M6 50 L2 14 L24 30 L43 4 L62 30 L84 14 L80 50 Z" fill="url(#cg)" stroke="#8a5a00" strokeWidth="2" strokeLinejoin="round" />
    <rect x="6" y="48" width="74" height="9" rx="3" fill="url(#cg)" stroke="#8a5a00" strokeWidth="2" />
    <circle cx="43" cy="31" r="5" fill="#ff7300" /><circle cx="22" cy="38" r="3.5" fill="#b2d049" /><circle cx="64" cy="38" r="3.5" fill="#b2d049" /></svg>
);
const Spark = ({ style }) => <svg className="spark" style={style} viewBox="0 0 20 20"><path d="M10 0 L12 8 L20 10 L12 12 L10 20 L8 12 L0 10 L8 8 Z" fill="#fff5c0" /></svg>;
function Sparkline({ hist, up }) {
  if (!hist || hist.length < 2) return null;
  const vs = hist.map(h => h[1]), lo = Math.min(...vs), hi = Math.max(...vs), W = 260, H = 70, pad = 8;
  const t = (v) => hi === lo ? 0.5 : up ? (v - lo) / (hi - lo) : (hi - v) / (hi - lo);   // 1 = best, drawn highest
  const pt = (v, i) => [pad + (i / (hist.length - 1)) * (W - pad * 2), H - pad - t(v) * (H - pad * 2)];
  const pts = vs.map((v, i) => pt(v, i));
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <polyline points={pts.map(p => p.join(",")).join(" ")} fill="none" stroke="#b2d049" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 7 : 5} fill={i === pts.length - 1 ? "#b2d049" : "#0a2b29"} stroke="#b2d049" strokeWidth="3" />)}
    </svg>
  );
}

// ── views ───────────────────────────────────────────────────────────────────
function Chips({ f }) {
  return (
    <div className="chips">
      <span className="chip">{f.age === "all" ? "All ages" : f.age}</span>
      <span className="chip">{f.gender === "F" ? "Girls" : f.gender === "M" ? "Boys" : "Everyone"}</span>
      {f.team !== "all" && <span className="chip o">{f.team}</span>}
    </div>
  );
}

function Leaderboard({ data, f, metric, highlight, onPick }) {
  const list = ranked(data.athletes.filter(a => matches(a, f)), metric.key, metric.up);
  const top = list.slice(0, 20);
  const [first, second, third] = top;
  const rest = top.slice(3);
  const best = top[0]?.v, worst = top[top.length - 1]?.v;
  const pct = (v) => top.length < 2 || best === worst ? 100 : 28 + 72 * (metric.up ? (v - worst) / (best - worst) : (worst - v) / (worst - best));
  const card = (r, cls) => r && (
    <div className={"pcard " + cls + (highlight === r.a.id ? " hl" : "")} onClick={() => onPick(r.a.id)}>
      {cls === "gold" && <><Crown /><Spark style={{ top: 40, left: 26 }} /><Spark style={{ top: 120, right: 22, animationDelay: "1.1s" }} /><Spark style={{ top: 250, left: 18, animationDelay: "1.7s" }} /></>}
      <div className="medal">{r.rank}</div>
      <div className="pname" style={{ fontSize: fit(r.a.n, cls === "gold" ? 250 : 214, cls === "gold" ? 46 : 40, 0.56) }}>{r.a.n}</div>
      <div className="pmeta">{metaOf(r.a)}</div>
      <div className="pval" style={{ fontSize: fit(fmtMetric(metric.key, r.v), cls === "gold" ? 250 : 214, cls === "gold" ? 66 : 58, 0.6) }}>{fmtMetric(metric.key, r.v)}</div>
      {realGain(metric.key, r.a.m[metric.key].gain) ? <div className="pgain">▲ {fmtGain(metric.key, r.a.m[metric.key].gain)} since {fmtDay(r.a.m[metric.key].baseDate)}</div> : null}
      <div className="pdate">Best · {fmtDay(r.a.m[metric.key].bestDate)}</div>
    </div>
  );
  return (
    <div className="view">
      <div className="vhead">
        <div className="vtitle">{metric.label}</div>
        <div className="vabout">{metric.about} · {list.length} {genderWord(f.gender)}</div>
        <Chips f={f} />
      </div>
      {!top.length ? <div className="empty"><div>No results yet{f.gender === "M" ? " for boys" : ""}<small>Be the first on the board: ask Coach Brandon about testing.</small></div></div> : (
        <div className="board">
          <div className="podium">
            <div className="burst" />
            {card(second, "silver")}
            {card(first, "gold")}
            {card(third, "bronze")}
          </div>
          <div className="list">
            {rest.map((r, i) => (
              <div key={r.a.id} className={"row" + (highlight === r.a.id ? " hl" : "")} style={{ animationDelay: (0.25 + i * 0.045) + "s" }} onClick={() => onPick(r.a.id)}>
                <div className="rk">{r.rank}</div>
                <div className="who"><div className="nm">{r.a.n}</div><div className="mt">{metaOf(r.a)}</div></div>
                <div className="val">{fmtMetric(metric.key, r.v)}</div>
                <div className="bar" style={{ width: pct(r.v) + "%" }} />
              </div>
            ))}
            {!rest.length && <div className="gnone" style={{ gridColumn: "1 / -1" }}>Only {top.length} on the board so far.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function Gains({ data, f, onPick }) {
  return (
    <div className="view">
      <div className="vhead">
        <div className="vtitle">Biggest Gains</div>
        <div className="vabout">Most improved from first test to latest test</div>
        <Chips f={f} />
      </div>
      <div className="gcols">
        {data.metrics.map((m, ci) => {
          const list = data.athletes.filter(a => matches(a, f) && realGain(m.key, a.m[m.key]?.gain)).sort((a, b) => b.m[m.key].gain - a.m[m.key].gain).slice(0, 6);
          return (
            <div key={m.key} className="gcol" style={{ animationDelay: ci * 0.08 + "s" }}>
              <h3>{m.label}</h3>
              {!list.length ? <div className="gnone">No gains on the board yet. They show up after a retest.</div> : list.map((a, i) => (
                <div key={a.id} className={"gitem" + (i === 0 ? " first" : "")} onClick={() => onPick(a.id)}>
                  <div className="gr">{i + 1}</div>
                  <div className="gw"><div className="gn">{a.n}</div><div className="gm">{fmtMetric(m.key, a.m[m.key].base)} → {fmtMetric(m.key, a.m[m.key].last)}</div></div>
                  <div className="gv">{fmtGain(m.key, a.m[m.key].gain)}</div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Leaders({ data, f, onPick }) {
  const ages = AGES.filter(ag => data.athletes.some(a => a.ag === ag && matches(a, { ...f, age: "all" })));
  return (
    <div className="view">
      <div className="vhead">
        <div className="vtitle">Age Group Leaders</div>
        <div className="vabout">The #1 in every test, every age group</div>
        <Chips f={{ ...f, age: "all" }} />
      </div>
      {!ages.length ? <div className="empty"><div>No results yet</div></div> : (
        <div className="lgrid" style={{ gridTemplateRows: `48px repeat(${ages.length}, 1fr)` }}>
          <div />
          {data.metrics.map(m => <div key={m.key} className="lh">{m.label}</div>)}
          {ages.map((ag, ri) => [
            <div key={ag} className="lag">{ag}</div>,
            ...data.metrics.map((m, ci) => {
              const list = ranked(data.athletes.filter(a => matches(a, { ...f, age: ag })), m.key, m.up).slice(0, 3);
              const top = list[0];
              return (
                <div key={ag + m.key} className="lcell" style={{ animationDelay: (ri * 0.06 + ci * 0.03) + "s" }} onClick={() => top && onPick(top.a.id)}>
                  {top ? <>
                    <div className="l1"><span className="dot">1</span><span className="ln">{top.a.n}</span><span className="lv">{fmtMetric(m.key, top.v)}</span></div>
                    <div className="l2">{list.slice(1).map(r => r.rank + ". " + r.a.n).join("   ") || (top.a.t || "")}</div>
                  </> : <div className="l2">—</div>}
                </div>
              );
            }),
          ])}
        </div>
      )}
    </div>
  );
}

// ── overlays ────────────────────────────────────────────────────────────────
const KEYS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
function Search({ athletes, onPick, onClose }) {
  const [q, setQ] = useState("");
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
  const nq = norm(q);
  const hits = nq ? athletes.filter(a => norm(a.n).startsWith(nq)).sort((a, b) => a.n.localeCompare(b.n)).slice(0, 9) : [];
  useEffect(() => {
    const onKey = (e) => {
      if (/^[a-z]$/i.test(e.key)) setQ(v => (v + e.key).slice(0, 24));
      else if (e.key === "Backspace") setQ(v => v.slice(0, -1));
      else if (e.key === " ") setQ(v => (v.endsWith(" ") || !v ? v : v + " "));
      else if (e.key === "Escape") onClose();
      else if (e.key === "Enter" && hits[0]) onPick(hits[0].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const press = (ch) => setQ(v => (v + ch).slice(0, 24));
  return (
    <div className="ovl">
      <button className="x" onClick={onClose}>✕ Close</button>
      <h2>Find your rank</h2>
      <div className="qbox">{q ? q.toUpperCase() : <span className="ph">Type your first name</span>}<span className="caret" /></div>
      {nq && !hits.length ? <div className="shint">No one by that name on the board yet. Check the spelling, or ask Coach Brandon about testing.</div>
        : !nq ? <div className="shint">Names show as first name and last initial, like “Quinn R.”</div>
        : <div className="sres">{hits.map(a => <button key={a.id} onClick={() => onPick(a.id)}><b>{a.n}</b><span>{metaOf(a) || " "}</span></button>)}</div>}
      <div className="kbd">
        {KEYS.map((row, i) => (
          <div key={i} className="krow">
            {i === 2 && <button className="key mid" onClick={() => setQ("")}>CLEAR</button>}
            {[...row].map(ch => <button key={ch} className="key" onClick={() => press(ch.toLowerCase())}>{ch}</button>)}
            {i === 2 && <button className="key mid" onClick={() => setQ(v => v.slice(0, -1))}>⌫</button>}
          </div>
        ))}
        <div className="krow"><button className="key wide" onClick={() => setQ(v => (v.endsWith(" ") || !v ? v : v + " "))}>SPACE</button></div>
      </div>
    </div>
  );
}

function AthleteCard({ data, id, onClose }) {
  const a = data.athletes.find(x => x.id === id);
  if (!a) return null;
  const sameG = { ...ALL, gender: a.g || "all" };
  return (
    <div className="ovl">
      <button className="x" onClick={onClose}>✕ Close</button>
      <div className="acard">
        <div className="ahead">
          <div className="big">{a.n}</div>
          <div className="chips">{a.t && <span className="chip">{a.t}</span>}{a.ag && <span className="chip">{a.ag}</span>}</div>
        </div>
        <div className="atiles">
          {data.metrics.map((m, i) => {
            const mm = a.m[m.key];
            if (!mm) return <div key={m.key} className="atile none" style={{ animationDelay: i * 0.06 + "s" }}><h4>{m.label}</h4><div className="av">—</div><div className="ar"><div className="rk2">Not tested yet</div></div></div>;
            // Age group first - a U11 is #8 of 15 in U11 before #152 of 164 overall.
            const all = standing(data.athletes, a, m.key, m.up, sameG);
            const ageList = a.ag ? ranked(data.athletes.filter(x => matches(x, { ...sameG, age: a.ag })), m.key, m.up) : [];
            const me = ageList.find(x => x.a.id === a.id);
            const pct = me ? Math.max(1, Math.ceil((me.rank / ageList.length) * 100)) : null;
            const hiV = ageList[0]?.v, loV = ageList[ageList.length - 1]?.v;
            const pos = ageList.length > 1 && hiV !== loV ? (m.up ? (mm.best - loV) / (hiV - loV) : (loV - mm.best) / (loV - hiV)) : 1;
            return (
              <div key={m.key} className="atile" style={{ animationDelay: i * 0.06 + "s" }}>
                <h4>{m.label}</h4>
                <div className="av">{fmtMetric(m.key, mm.best)}</div>
                <div className="adate">Best · {fmtDay(mm.bestDate)}</div>
                <div className="ar">
                  {me && <div className="rk2 big"><b>#{me.rank}</b> of {ageList.length} in {a.ag}</div>}
                  {all && <div className="rk2"><b>#{all.rank}</b> of {all.n} {genderWord(a.g)}</div>}
                </div>
                {pct != null && pct <= 50 && <div className="top">Top {pct}% of {a.ag}</div>}
                {realGain(m.key, mm.gain) && <div className="ag">▲ {fmtGain(m.key, mm.gain)} since {fmtDay(mm.baseDate)}</div>}
                <div className="afoot">
                  {mm.hist.length > 1 && <><div className="alab">Your results</div><Sparkline hist={mm.hist} up={m.up} /></>}
                  {ageList.length > 1 && <>
                    <div className="alab">Where you stand in {a.ag}</div>
                    <div className="range"><i style={{ left: Math.max(0, Math.min(1, pos)) * 100 + "%" }} /></div>
                    <div className="rlab"><span>{fmtMetric(m.key, loV)}</span><span>{a.ag} best {fmtMetric(m.key, hiV)}</span></div>
                  </>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Teams({ teams, current, onPick, onClose }) {
  return (
    <div className="ovl">
      <button className="x" onClick={onClose}>✕ Close</button>
      <h2>Pick a team</h2>
      <div className="tgrid">
        <button className={current === "all" ? "on" : ""} onClick={() => onPick("all")}>All teams</button>
        {teams.map(t => <button key={t} className={current === t ? "on" : ""} onClick={() => onPick(t)}>{t}</button>)}
      </div>
    </div>
  );
}

const CONFETTI_COLORS = ["#ffd24a", "#b2d049", "#ff7300", "#ffffff", "#fff1a8"];
function Celebration({ data, ev, leaving }) {
  const a = data.athletes.find(x => x.id === ev.id);
  const bits = useMemo(() => Array.from({ length: 70 }, (_, i) => ({ left: (i * 137.5) % 100, d: (i % 14) * 0.07, t: 2.4 + (i % 5) * 0.35, x: ((i * 53) % 240) - 120, r: ((i * 97) % 720) - 360, c: CONFETTI_COLORS[i % CONFETTI_COLORS.length] })), [ev.key]);
  if (!a) return null;
  return (<>
    {!leaving && <div className="confetti">{bits.map((b, i) => <i key={i} style={{ left: b.left + "%", background: b.c, "--d": b.d + "s", "--t": b.t + "s", "--x": b.x + "px", "--r": b.r + "deg" }} />)}</div>}
    <div className={"cele" + (leaving ? " out" : "")}>
      <div>
        <span className="ctag">{ev.items.some(i => i.pb) ? "NEW PERSONAL BEST" : "NEW RESULT"}</span>
        <div className="cname">{a.n}</div>
        <div className="cteam">{metaOf(a)}</div>
      </div>
      <div className="cres">
        {ev.items.slice(0, 3).map(it => {
          const m = data.metrics.find(x => x.key === it.k);
          return (
            <div key={it.k} className="cr">
              <div className="cl">{m?.label}</div>
              <div className="cv">{fmtMetric(it.k, it.v)}</div>
              <div className="cb">{realGain(it.k, it.gain) ? "▲ " + fmtGain(it.k, it.gain) : it.age ? "#" + it.age.rank + " in " + a.ag : it.all ? "#" + it.all.rank + " overall" : ""}</div>
            </div>
          );
        })}
      </div>
    </div>
  </>);
}

// ── the app ─────────────────────────────────────────────────────────────────
export default function Board() {
  const stage = useStageScale();
  const [data, setData] = useState(null);
  const [error, setError] = useState(KEY ? null : "This screen needs its link: …/board?k=…");
  const [online, setOnline] = useState(true);
  const [mode, setMode] = useState("auto");            // auto = slideshow, touch = someone's using it
  const [slideIdx, setSlideIdx] = useState(0);
  const [view, setView] = useState({ tab: "vertical", ...ALL });
  const [overlay, setOverlay] = useState(null);        // "search" | "teams" | { id }
  const [events, setEvents] = useState([]);            // live celebrations, oldest first
  const [leaving, setLeaving] = useState(false);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const [ticker, setTicker] = useState([]);            // latest results, newest first
  const [spot, setSpot] = useState(null);              // the board right after a celebration
  const [now, setNow] = useState(new Date());
  const lastTouch = useRef(0), verRef = useRef(""), dataRef = useRef(null), seenRef = useRef(null), pendingRef = useRef(new Map()), tickerInit = useRef(false);
  const modeRef = useRef(mode), shownRef = useRef(null), touchRef = useRef(() => {}), starRef = useRef(null);
  modeRef.current = mode;
  const settings = data?.settings || {};
  const slideMs = (settings.slide_seconds || 14) * 1000, idleMs = (settings.idle_seconds || 75) * 1000, pollMs = (settings.poll_seconds || 15) * 1000;

  // Poll; a result that's new and held still for one poll becomes an event.
  useEffect(() => {
    if (!KEY) return;
    let stop = false, timer;
    const settle = (d) => {
      const cur = pointsOf(d);
      if (!seenRef.current) { seenRef.current = cur; return; }
      const fresh = new Map();   // athlete id -> items
      for (const [key, v] of cur) {
        if (seenRef.current.get(key) === v) continue;
        if (pendingRef.current.get(key) === v) {
          pendingRef.current.delete(key); seenRef.current.set(key, v);
          const [id, k, date] = key.split("|"), a = d.athletes.find(x => x.id === id);
          const item = a && describe(d, a, k, date, v);
          if (item) { if (!fresh.has(id)) fresh.set(id, []); fresh.get(id).push(item); }
        } else pendingRef.current.set(key, v);
      }
      for (const key of [...pendingRef.current.keys()]) if (!cur.has(key)) pendingRef.current.delete(key);
      if (fresh.size) {
        // Most impressive first (overall rank; #1 in an age group counts like #2
        // overall), each athlete's best test first; the best of the batch gets
        // the spotlight board once the celebrations are done.
        const score = (it) => Math.min(it.all?.rank ?? 999, it.age ? it.age.rank * 2 : 999);
        const evs = [...fresh.entries()].map(([id, items]) => { items.sort((x, y) => score(x) - score(y)); return { id, items, score: score(items[0]), key: id + ":" + Date.now() }; })
          .sort((x, y) => x.score - y.score);
        if (!starRef.current || evs[0].score < starRef.current.score) starRef.current = evs[0];
        setEvents(q => [...q, ...evs].slice(-16));
        setTicker(t => [...evs.flatMap(e => e.items.map(it => ({ id: e.id, ...it }))), ...t].slice(0, 24));
      }
    };
    const load = async () => {
      try {
        const r = await fetch(`${API}?k=${encodeURIComponent(KEY)}&v=${verRef.current}`, { cache: "no-store" });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.ok) throw new Error(d.error || "HTTP " + r.status);
        if (d.same) { if (dataRef.current) settle(dataRef.current); }
        else {
          verRef.current = d.v; dataRef.current = d; settle(d); setData(d); setError(null);
          // First load: the ticker starts with today's results already on file.
          if (!tickerInit.current) {
            tickerInit.current = true;
            setTicker((d.recent || []).flatMap(x => Object.entries(x.vals).map(([k, v]) => { const a = d.athletes.find(z => z.id === x.id), it = a && describe(d, a, k, x.date, v); return it ? { id: x.id, ...it } : null; })).filter(Boolean).slice(0, 24));
          }
        }
        setOnline(true);
      } catch (e) { setOnline(false); if (!dataRef.current) setError(e.message); }
      if (!stop) timer = setTimeout(load, dataRef.current ? ((dataRef.current.settings?.poll_seconds || 15) * 1000) : 10000);
    };
    load();
    return () => { stop = true; clearTimeout(timer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const slides = useMemo(() => (data ? buildSlides(data) : []), [data]);
  const shown = mode === "auto" ? (spot || slides[slideIdx % Math.max(1, slides.length)] || { tab: "vertical", ...ALL }) : view;
  shownRef.current = shown;
  const celebrating = events.length > 0;

  // Slideshow clock (paused while a result is being celebrated).
  useEffect(() => {
    if (mode !== "auto" || celebrating || !slides.length) return;
    const t = setTimeout(() => {
      if (spot) setSpot(null); else setSlideIdx(i => i + 1);
      // A kiosk runs for days: reload now and then to pick up updates.
      if (Date.now() - BOOT > 6 * 3600e3) window.location.reload();
    }, slideMs);
    return () => clearTimeout(t);
  }, [mode, slideIdx, spot, celebrating, slides.length, slideMs]);

  // Each celebration holds the screen ~6 s (shorter when a whole team lands),
  // then that athlete's board comes up with her row lit.
  const head = events[0]?.key, crowd = events.length > 6;
  useEffect(() => {
    if (!head) return;
    const hold = crowd ? 4200 : 6500;
    const t1 = setTimeout(() => setLeaving(true), hold - 450);
    const t2 = setTimeout(() => {
      if (eventsRef.current.length === 1) {
        const star = starRef.current, a = star && dataRef.current?.athletes.find(x => x.id === star.id), it = star?.items[0];
        starRef.current = null;
        // Her age group's board, or her team's when she's outside that top 20.
        if (modeRef.current === "auto" && a && it) setSpot({ tab: it.k, ...ALL, ...(it.age && it.age.rank > 20 && a.t ? { team: a.t } : { age: a.ag || "all" }), highlight: a.id });
      }
      setLeaving(false); setEvents(q => q.slice(1));
    }, hold);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [head, crowd]);

  // Touch takes over; idle hands it back to the slideshow.
  useEffect(() => {
    const down = () => {
      keepAwake(); goFullscreen(); touchRef.current();
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", down, true);
    keepAwake();
    const vis = () => { if (document.visibilityState === "visible") keepAwake(); };
    document.addEventListener("visibilitychange", vis);
    const t = setInterval(() => {
      setNow(new Date());
      if (lastTouch.current && Date.now() - lastTouch.current > idleMs) { lastTouch.current = 0; setOverlay(null); setMode("auto"); setSlideIdx(i => i + 1); }
    }, 1000);
    return () => { window.removeEventListener("pointerdown", down, true); window.removeEventListener("keydown", down, true); document.removeEventListener("visibilitychange", vis); clearInterval(t); };
  }, [idleMs]);

  const teams = useMemo(() => [...new Set((data?.athletes || []).map(a => a.t).filter(Boolean))].sort((a, b) => (parseInt(a) || 99) - (parseInt(b) || 99) || a.localeCompare(b)), [data]);
  // Someone is using the screen: stop the show and start from what's on it.
  // (Also called from every button, so a press that isn't a pointer event -
  // a remote, a keyboard - still counts.)
  const touch = () => {
    lastTouch.current = Date.now();
    if (modeRef.current === "auto") { setView({ ...shownRef.current, highlight: undefined }); setSpot(null); setMode("touch"); }
  };
  touchRef.current = touch;
  const set = (patch) => { touch(); setView(v => ({ ...v, ...patch, highlight: undefined })); };
  const pick = (id) => { touch(); setOverlay({ id }); };
  const open = (o) => { touch(); setOverlay(o); };
  const hasBoys = !!data?.athletes.some(a => a.g === "M");
  const metric = data?.metrics.find(m => m.key === shown.tab);
  const byId = useMemo(() => new Map((data?.athletes || []).map(a => [a.id, a])), [data]);

  const body = !data ? (
    <div className="connect"><div><img src={LOGO} alt="" /><div>{error || "Loading the leaderboard…"}</div>{error && KEY && <small>Retrying every few seconds.</small>}</div></div>
  ) : (<>
    <div className="hdr">
      <img className="logo" src={LOGO} alt="Dripping Springs Sports Club" />
      <div className="sep" />
      <div><div className="title">{data.title}</div><div className="sub">{data.subtitle}</div></div>
      <div style={{ flex: 1 }} />
      <div className={"live" + (online ? "" : " off")}><i />{online ? "Live results" : "Reconnecting"}</div>
      <div className="clock">{now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</div>
      <button className="findbtn" onClick={() => open("search")}><SearchIcon />Find your rank</button>
    </div>
    <div className="tabs">
      {data.metrics.map(m => <button key={m.key} className={"tab" + (shown.tab === m.key ? " on" : "")} onClick={() => set({ tab: m.key })}>{m.label}</button>)}
      <button className={"tab special" + (shown.tab === "gains" ? " on" : "")} onClick={() => set({ tab: "gains" })}>Biggest Gains</button>
      <button className={"tab special" + (shown.tab === "leaders" ? " on" : "")} onClick={() => set({ tab: "leaders" })}>Age Leaders</button>
    </div>
    <div className="filters">
      <div className="seg">
        {[["all", "Everyone"], ["F", "Girls"], ["M", "Boys"]].map(([k, l]) => <button key={k} className={(shown.gender === k ? "on" : "") + (k === "M" && !hasBoys ? " dim" : "")} onClick={() => set({ gender: k })}>{l}</button>)}
      </div>
      <div className="seg">
        {[["all", "All ages"], ...AGES.map(a => [a, a])].map(([k, l]) => <button key={k} className={shown.age === k ? "on" : ""} onClick={() => set({ age: k })}>{l}</button>)}
      </div>
      <button className={"teambtn" + (shown.team !== "all" ? " on" : "")} onClick={() => open("teams")}>{shown.team === "all" ? "All teams" : shown.team} ▾</button>
      {mode === "touch" && <button className="resume" onClick={(e) => { e.stopPropagation(); lastTouch.current = 0; setOverlay(null); setMode("auto"); }}>▶ Play slideshow</button>}
    </div>
    <div className="main">
      {shown.tab === "gains" ? <Gains key={JSON.stringify(shown)} data={data} f={shown} onPick={pick} />
        : shown.tab === "leaders" ? <Leaders key={JSON.stringify(shown)} data={data} f={shown} onPick={pick} />
        : metric ? <Leaderboard key={JSON.stringify(shown)} data={data} f={shown} metric={metric} highlight={shown.highlight} onPick={pick} /> : null}
    </div>
    <div className="foot">
      {ticker.length ? <>
        <span className="lab">Latest</span>
        <div className="tick"><div className="run" style={{ "--dur": Math.max(30, ticker.length * 7) + "s" }}>
          {ticker.map((t, i) => { const a = byId.get(t.id), m = data.metrics.find(x => x.key === t.k); return a && m ? <span key={i}><b>{a.n}</b> {m.label} <em>{fmtMetric(t.k, t.v)}</em>{realGain(t.k, t.gain) ? " ▲ " + fmtGain(t.k, t.gain) : ""}</span> : null; })}
        </div></div>
      </> : <>
        <span className="lab lime">Tap to explore</span>
        <div className="tip">Tap a test, an age group or <b>Find your rank</b> to see where you stand. <b>{data.athletes.length}</b> athletes on the board.</div>
      </>}
      {mode === "auto" && !celebrating && <div className="prog" key={slideIdx + "|" + (spot ? "s" : "")} style={{ "--dur": slideMs + "ms" }}><i /></div>}
    </div>
    {overlay === "search" && <Search athletes={data.athletes} onPick={pick} onClose={() => setOverlay(null)} />}
    {overlay === "teams" && <Teams teams={teams} current={shown.team} onPick={(t) => { set({ team: t }); setOverlay(null); }} onClose={() => setOverlay(null)} />}
    {overlay && overlay.id && <AthleteCard data={data} id={overlay.id} onClose={() => setOverlay(null)} />}
    {events[0] && <Celebration key={events[0].key} data={data} ev={events[0]} leaving={leaving} />}
  </>);

  return (
    <div className="stage" style={{ transform: `translate(${stage.x}px, ${stage.y}px) scale(${stage.scale})` }}>
      {body}
    </div>
  );
}
