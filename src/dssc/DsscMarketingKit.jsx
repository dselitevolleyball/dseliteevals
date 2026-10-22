// DSSC Marketing Machine — the pieces every Marketing tab shares: the API
// call, line labels/colours, week maths, the setup check, the live graphic
// preview and the approve pipeline (render → upload → update → approve).

import { useState, useEffect, useRef } from "react";
import { supabase } from "../supabase";
import { DS } from "./DsscHub.jsx";
import * as PLAN from "../../shared/marketing-plan.js";
import { ensureFonts, loadGraphicImages, renderGraphic, renderGraphicBlob } from "../../shared/marketing-graphics.js";

export const NARROW = 760;
export const MIGRATION_MSG = "The marketing tables aren't set up yet — run migrations/20261022_marketing.sql.";
export const isMissingTable = (err) => !!err && (err.code === "42P01" || err.code === "PGRST205" || /mkt_\w+|schema cache|does not exist/i.test(err.message || ""));

// ── Lines (labels + colours come from shared/marketing-plan.js) ────────────
const FALLBACK_LINES = [
  { key: "volleyball", label: "Volleyball", color: "#B2D049" },
  { key: "basketball", label: "Basketball", color: "#FF7300" },
  { key: "reach", label: "Reach", color: "#7FD1C3" },
  { key: "camp_elevate", label: "Camp Elevate", color: "#F5C542" },
  { key: "parties", label: "Parties", color: "#F06BB4" },
  { key: "rentals", label: "Rentals", color: "#60A5FA" },
  { key: "open_gym", label: "Open gym", color: "#A78BFA" },
  { key: "club", label: "Club", color: "#A9C7C3" },
];
export const LINES = Array.isArray(PLAN.LINES) && PLAN.LINES.length ? PLAN.LINES : FALLBACK_LINES;
export const DEFAULT_WEIGHTS = PLAN.DEFAULT_WEIGHTS || { volleyball: 3, basketball: 3, reach: 2, camp_elevate: 2, parties: 2, rentals: 1, open_gym: 1, club: 1 };
export const DEFAULT_CADENCE = PLAN.DEFAULT_CADENCE || { social: { per_week: 4, days: ["mon", "wed", "fri", "sat"], time: "18:30" }, email: { day: "thu", time: "07:30" }, sms: { per_month: 2, time: "17:30" } };
// Line colours are brand colours; a dark one (volleyball teal) is lifted
// toward white so it reads as text on the evergreen panels.
function readable(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return hex || DS.mut;
  const n = parseInt(m[1], 16), rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lum = rgb.map(c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }).reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
  if (lum >= 0.3) return "#" + m[1];
  const t = 0.5;
  return "#" + rgb.map(c => Math.round(c + (255 - c) * t).toString(16).padStart(2, "0")).join("");
}
const metaCache = new Map();
export const lineMeta = (k) => {
  if (metaCache.has(k)) return metaCache.get(k);
  const base = LINES.find(l => l.key === k) || FALLBACK_LINES.find(l => l.key === k) || { key: k || "club", label: k ? String(k).replace(/_/g, " ") : "Club", color: DS.mut };
  const m = { ...base, color: readable(base.color) };
  metaCache.set(k, m);
  return m;
};
export const lineColor = (k) => lineMeta(k).color || DS.mut;
export const lineLabel = (k) => lineMeta(k).label || k;

export const ANGLES = { starting_soon: "Starting soon", new: "New", just_started: "Just started", evergreen: "Evergreen", priority: "Priority", reminder: "Reminder", last_call: "Last call", follow_up: "Follow-up", preview: "Month preview", spotlight: "Meet the Coaches" };
// What a slot / item is (shared/marketing-plan.js KINDS); old rows have none.
export const KIND_LABEL = PLAN.KIND_LABEL || { post: "Post", story: "Story", follow_up: "Follow-up story", preview: "Month preview", roundup: "Weekly email", dedicated: "Dedicated email", text: "Text" };
export const kindOf = (x) => x?.kind || (x?.channel === "email" ? "roundup" : x?.channel === "sms" ? "text" : "post");
export const STATUS_META = {
  draft: ["Draft", DS.mut], approved: ["Approved", DS.lime], publishing: ["Publishing", "#60A5FA"],
  published: ["Published", "#7FD1C3"], failed: ["Failed", DS.orange], rejected: ["Rejected", DS.dim],
};
export const CHANNEL_META = { social: ["Social", "📱"], email: ["Email", "✉️"], sms: ["Text", "💬"] };
export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const DAY_LABEL = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

// ── Dates (weeks start Monday; all local dates as YYYY-MM-DD) ──────────────
export const isoLocal = (d) => { const x = new Date(d); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
export const mondayOf = (s) => {
  if (typeof PLAN.mondayOf === "function") { try { const m = PLAN.mondayOf(s); if (m) return m; } catch { /* fall through */ } }
  const d = new Date((s || isoLocal(new Date())) + "T12:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoLocal(d);
};
export const addDays = (s, n) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return isoLocal(d); };
export const fmtDate = (s, opts = { month: "short", day: "numeric" }) => s ? new Date(s + "T12:00:00").toLocaleDateString(undefined, opts) : "";
export const fmtWhen = (iso) => iso ? new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
export const timeOf = (iso) => { if (!iso) return ""; const d = new Date(iso); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
export const dayOf = (iso) => iso ? isoLocal(new Date(iso)) : "";
export const withTime = (iso, hhmm, fallbackDay) => { const day = dayOf(iso) || fallbackDay; return new Date(`${day}T${hhmm || "18:30"}:00`).toISOString(); };
export const weekLabel = (wk) => {
  const cur = mondayOf();
  const rel = wk === cur ? "This week" : wk === addDays(cur, 7) ? "Next week" : wk === addDays(cur, -7) ? "Last week" : "";
  return { rel, range: `${fmtDate(wk)} – ${fmtDate(addDays(wk, 6))}` };
};

// ── API ─────────────────────────────────────────────────────────────────────
export async function mktApi(action, payload = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  let r;
  try {
    r = await fetch("/api/marketing", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (session?.access_token || "") }, body: JSON.stringify({ action, ...payload }) });
  } catch (e) { throw new Error("Couldn't reach the server — " + e.message); }
  const text = await r.text();
  let d = {}; try { d = text ? JSON.parse(text) : {}; } catch { d = {}; }
  if (!r.ok || d.error) {
    const e = new Error(d.error || (r.status === 404 ? "The marketing API isn't deployed yet (api/marketing.js)." : r.status === 504 ? "The server took too long — try again in a minute." : `HTTP ${r.status}`));
    e.status = r.status; e.data = d;
    throw e;
  }
  return d;
}

// ── Graphics ────────────────────────────────────────────────────────────────
// The spec the renderer draws for an item: its stored graphic, plus the line
// (4QA mark on basketball) and the call to action.
export const specOf = (item, override = {}) => {
  const g = item?.graphic && typeof item.graphic === "object" ? item.graphic : {};
  const fmt = item?.channel === "email" ? "email" : (g.format && g.format !== "email" ? g.format : "post");
  return { template: "photo", ...g, format: fmt, headline: g.headline || item?.headline || "", line: item?.line || g.line, cta: g.cta || item?.cta_text || "", ...override };
};
export const hasGraphic = (item) => item && item.channel !== "sms";

// Live preview of an item's graphic. Draws at full resolution and lets CSS
// scale it, so what Drew sees is pixel-for-pixel what gets posted.
export function GraphicPreview({ spec, style, onClick }) {
  const ref = useRef(null);
  const [state, setState] = useState("loading");
  const key = JSON.stringify(spec);
  useEffect(() => {
    let dead = false;
    (async () => {
      setState("loading");
      await ensureFonts();
      const imgs = await loadGraphicImages(spec);
      if (dead || !ref.current) return;
      renderGraphic(ref.current, spec, imgs);
      setState(spec.photo_url && !imgs.photoImg ? "nophoto" : "ok");
    })().catch(() => !dead && setState("err"));
    return () => { dead = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ position: "relative", ...style }} onClick={onClick}>
      <canvas ref={ref} width={1080} height={1350} style={{ width: "100%", height: "auto", display: "block", background: "#061a18", cursor: onClick ? "pointer" : "default" }} />
      {state === "loading" && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: DS.mut, fontSize: 12, pointerEvents: "none" }}>Drawing…</div>}
      {state === "nophoto" && <div style={{ position: "absolute", left: 6, top: 6, fontSize: 11, background: "rgba(0,0,0,0.6)", color: DS.orange, padding: "2px 6px", borderRadius: 4 }}>Photo couldn't load — swap it</div>}
    </div>
  );
}

// Approve one item: render its graphic(s) at full size, upload to the
// `marketing` bucket, store the URLs on the item, then approve it.
async function uploadPng(id, blob, suffix = "") {
  const path = `items/${id}/${Date.now()}${suffix}.png`;
  const { error } = await supabase.storage.from("marketing").upload(path, blob, { contentType: "image/png", upsert: true, cacheControl: "31536000" });
  if (error) throw new Error("Upload failed: " + error.message + (/bucket/i.test(error.message) ? " (run migrations/20261022_marketing.sql — it creates the bucket)" : ""));
  return supabase.storage.from("marketing").getPublicUrl(path).data.publicUrl;
}
export async function approveItem(item, onStep) {
  if (hasGraphic(item)) {
    const spec = specOf(item);
    onStep?.("Drawing the graphic…");
    const blob = await renderGraphicBlob(spec, { format: spec.format });
    onStep?.("Uploading…");
    const patch = { asset_url: await uploadPng(item.id, blob) };
    if (item.channel === "social") {
      const story = await renderGraphicBlob(spec, { format: "story" });
      patch.asset_story_url = await uploadPng(item.id, story, "-story");
    }
    await mktApi("update", { id: item.id, patch });
  }
  onStep?.("Approving…");
  // approve answers 200 with per-item errors ({items, errors}).
  const d = await mktApi("approve", { ids: [item.id] });
  const bad = (d.errors || []).find(e => Number(e.id) === Number(item.id));
  if (bad) throw new Error("Not approved: " + bad.error);
  return d;
}
// Ready = has what it needs to go out.
export const readyIssue = (it) => {
  if (it.status !== "draft") return "not a draft";
  if (it.channel === "social") { if (!String(it.body || "").trim()) return "no caption"; if (!(it.platforms || []).length) return "no platform picked"; }
  if (it.channel === "email") { if (!String(it.email_subject || "").trim()) return "no subject"; if (!String(it.body || "").trim()) return "no email text"; }
  if (it.channel === "sms" && !String(it.body || "").trim()) return "no text";
  return "";
};

// ── Small UI bits ──────────────────────────────────────────────────────────
export const chipStyle = (on, color = DS.lime, big) => ({ fontFamily: DS.font, fontSize: big ? 14 : 12, fontWeight: 700, padding: big ? "9px 14px" : "5px 11px", minHeight: big ? 40 : undefined, borderRadius: 999, cursor: "pointer", border: "1px solid " + (on ? color : DS.line), background: on ? (color === DS.lime ? DS.limeSoft : color + "22") : "transparent", color: on ? color : DS.mut, whiteSpace: "nowrap" });
export const LineChip = ({ line, fill }) => { const m = lineMeta(line); return <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: fill ? DS.bg : m.color, background: fill ? m.color : "transparent", border: "1px solid " + m.color, borderRadius: 6, padding: "2px 7px", whiteSpace: "nowrap" }}>{m.label}</span>; };
export const Msg = ({ msg, style }) => !msg ? null : <div style={{ color: msg.err ? DS.orange : DS.lime, fontWeight: 700, fontSize: 13, whiteSpace: "pre-wrap", ...style }}>{msg.err || msg.ok}</div>;
export const Panel = ({ children, style }) => <div style={{ background: DS.panel, border: "1px solid " + DS.line, borderRadius: 14, padding: 14, ...style }}>{children}</div>;
export const H = ({ children, style }) => <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: DS.lime, marginBottom: 8, ...style }}>{children}</div>;
export function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < NARROW);
  useEffect(() => { const f = () => setNarrow(window.innerWidth < NARROW); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  return narrow;
}
