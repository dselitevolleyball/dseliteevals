// DSSC Marketing → Reels (Drew, Oct 29 2026: "I need a better spot to put reels
// - before plugging them right into planning"). Every reel made in Videos lands
// on the shelf here first: cut it, render and watch it, fix the words - then
// "Put on the calendar" on the day you want, where it's a draft to approve like
// anything else. "Back to the shelf" takes one off the calendar again.
//   Shelf      mkt_items kind 'reel' in SHELF_WEEK (no date) - shared/marketing-plan.js
//   Coming up  reels on the calendar that haven't posted yet
//   Posted     the last few, with their links
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabase";
import { DS, Btn, Tag, inputStyle } from "./DsscHub.jsx";
import { videoApi, Msg, Panel, H, fmtWhen, isoLocal, lineLabel } from "./DsscMarketingKit.jsx";
import ReelBox from "./DsscMarketingReel.jsx";
import { SHELF_WEEK } from "../../shared/marketing-plan.js";

const STATUS = { draft: [DS.mut, "Draft - approve it in Week"], approved: [DS.lime, "Approved"], publishing: ["#7FD1C3", "Posting"], failed: [DS.orange, "Failed"] };

export default function MarketingReels({ narrow, onOpenWeek, onOpenVideos, onChanged }) {
  const [shelf, setShelf] = useState(null), [coming, setComing] = useState([]), [posted, setPosted] = useState([]);
  const [msg, setMsg] = useState(null);
  const load = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      supabase.from("mkt_items").select("*").eq("kind", "reel").eq("week_of", SHELF_WEEK).neq("status", "rejected").order("created_at", { ascending: false }),
      supabase.from("mkt_items").select("*").eq("kind", "reel").neq("week_of", SHELF_WEEK).in("status", ["draft", "approved", "publishing", "failed"]).gte("scheduled_at", new Date(Date.now() - 864e5).toISOString()).order("scheduled_at"),
      supabase.from("mkt_items").select("id, headline, published_at, external_ids, asset_url, graphic").eq("kind", "reel").eq("status", "published").order("published_at", { ascending: false }).limit(8),
    ]);
    if (a.error) { setMsg({ err: a.error.message }); setShelf([]); return; }
    setShelf(a.data || []); setComing(b.data || []); setPosted(c.data || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  const replace = (it) => { setShelf(s => (s || []).map(x => x.id === it.id ? it : x)); setComing(s => s.map(x => x.id === it.id ? it : x)); };
  const patch = async (it, fields) => {
    replace({ ...it, ...fields });
    const { error } = await supabase.from("mkt_items").update(fields).eq("id", it.id);
    if (error) { setMsg({ err: error.message }); load(); }
  };
  const act = async (fn, ok) => { setMsg(null); try { const r = await fn(); await load(); onChanged?.(); if (ok) setMsg(typeof ok === "function" ? ok(r) : { ok }); } catch (e) { setMsg({ err: e.message }); } };

  if (!shelf) return <Panel><span style={{ color: DS.mut }}>Loading reels…</span></Panel>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 14 }}>
      <div style={{ fontSize: 13, color: DS.mut, lineHeight: 1.5 }}>Reels you make in <button onClick={onOpenVideos} style={{ background: "none", border: "none", padding: 0, color: DS.lime, fontWeight: 800, cursor: "pointer", fontFamily: DS.font, fontSize: 13 }}>Videos</button> wait here. Cut it, render it, watch it and fix the words - then put it on the calendar on the day you want. Nothing posts from the shelf.</div>
      <Msg msg={msg} />
      {msg?.week && <Btn small kind="link" onClick={() => onOpenWeek?.(msg.week)}>Open that week →</Btn>}

      <div>
        <H style={{ margin: "0 0 8px" }}>On the shelf {shelf.length ? `(${shelf.length})` : ""}</H>
        {!shelf.length && <Panel><span style={{ color: DS.mut, fontSize: 13 }}>Nothing on the shelf. Make a reel in Videos - pick some moments, a whole video, or a collection's ideas - and it lands here.</span></Panel>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(420px, 100%), 1fr))", gap: 12 }}>
          {shelf.map(it => <ShelfCard key={it.id} it={it} narrow={narrow} replace={replace} patch={patch}
            onSchedule={(day, time) => act(() => videoApi("reel_schedule", { id: it.id, day, time }), (r) => ({ ok: `On the calendar for ${fmtWhen(r.item.scheduled_at)} - approve it in Week.`, week: r.item.week_of }))}
            onDelete={() => window.confirm("Throw this reel away? The videos stay in Videos.") && act(() => videoApi("reel_delete", { id: it.id }), "Deleted.")} />)}
        </div>
      </div>

      {coming.length > 0 && <div>
        <H style={{ margin: "0 0 8px" }}>On the calendar</H>
        {coming.map(it => { const [c, l] = STATUS[it.status] || [DS.mut, it.status]; return (
          <div key={it.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "8px 0", borderBottom: "1px solid " + DS.line }}>
            {it.graphic?.photo_url && <img src={it.graphic.photo_url} alt="" style={{ width: 44, height: 64, objectFit: "cover", borderRadius: 6 }} />}
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontWeight: 800 }}>{it.headline || "Reel"}</div>
              <div style={{ fontSize: 12, color: DS.mut }}>{fmtWhen(it.scheduled_at)} · {lineLabel(it.line)}{it.render_status !== "rendered" ? " · not rendered yet" : ""}</div>
            </div>
            <Tag color={c}>{l}</Tag>
            <Btn small onClick={() => onOpenWeek?.(it.week_of)}>Open in Week</Btn>
            {!["publishing"].includes(it.status) && <Btn small onClick={() => act(() => videoApi("reel_shelve", { id: it.id }), "Back on the shelf - off the calendar.")}>Back to the shelf</Btn>}
          </div>); })}
      </div>}

      {posted.length > 0 && <div>
        <H style={{ margin: "0 0 8px" }}>Posted</H>
        {posted.map(it => (
          <div key={it.id} style={{ display: "flex", gap: 10, fontSize: 13, padding: "5px 0", borderBottom: "1px solid " + DS.line, flexWrap: "wrap" }}>
            <span style={{ color: DS.mut, minWidth: 110 }}>{fmtWhen(it.published_at)}</span>
            <b style={{ flex: 1, minWidth: 140 }}>{it.headline || "Reel"}</b>
            {it.external_ids?.links?.instagram && <a href={it.external_ids.links.instagram} target="_blank" rel="noreferrer" style={{ color: DS.lime }}>Instagram</a>}
            {it.external_ids?.links?.facebook && <a href={it.external_ids.links.facebook} target="_blank" rel="noreferrer" style={{ color: DS.lime }}>Facebook</a>}
          </div>))}
      </div>}
    </div>
  );
}

function ShelfCard({ it, narrow, replace, patch, onSchedule, onDelete }) {
  const tomorrow = isoLocal(new Date(Date.now() + 864e5));
  const [day, setDay] = useState(tomorrow), [time, setTime] = useState("18:30");
  const [caption, setCaption] = useState(it.body || "");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setCaption(it.body || ""); }, [it.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => { setBusy(true); await onSchedule(day, time); setBusy(false); };
  return (
    <div style={{ background: DS.panel, border: "1px solid " + DS.line, borderRadius: 14, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <b style={{ flex: 1, minWidth: 140 }}>{it.headline || "Reel"}</b>
        <Tag color={it.render_status === "rendered" ? DS.lime : DS.mut}>{it.render_status === "rendered" ? "Rendered" : it.render_status === "rendering" ? "Rendering" : "Not rendered yet"}</Tag>
        <span style={{ fontSize: 12, color: DS.dim }}>{lineLabel(it.line)} · made {new Date(it.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
      </div>
      <ReelBox item={it} editable narrow={narrow} onReplace={replace} onPatch={patch} />
      <label style={{ fontSize: 12, color: DS.mut }}>Caption
        <textarea value={caption} onChange={e => setCaption(e.target.value)} onBlur={() => caption !== (it.body || "") && patch(it, { body: caption })} rows={3} style={{ ...inputStyle, marginTop: 4, lineHeight: 1.45 }} />
      </label>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", paddingTop: 8, borderTop: "1px solid " + DS.line }}>
        <input type="date" value={day} min={isoLocal(new Date())} onChange={e => setDay(e.target.value)} style={{ ...inputStyle, width: "auto", padding: "6px 8px" }} />
        <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ ...inputStyle, width: "auto", padding: "6px 8px" }} />
        <Btn kind="primary" disabled={busy || !day} onClick={go}>{busy ? "Adding…" : "📅 Put on the calendar"}</Btn>
        <div style={{ flex: 1 }} />
        <Btn small onClick={onDelete}>Delete</Btn>
      </div>
    </div>
  );
}
