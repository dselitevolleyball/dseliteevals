// Dripping Springs Sports Club — the Marketing Machine (Drew, 22 Oct 2026:
// "an automated marketing machine"). The planner balances the week across
// the club's lines (volleyball, basketball, Reach, Camp Elevate, parties,
// rentals, open gym) from what's starting on the website and Drew's
// priorities; the machine drafts Facebook/Instagram posts with on-brand
// graphics, a weekly email and the odd text; a director edits, asks for
// changes and approves — from a phone, in a couple of taps. Nothing goes out
// without approval; the cron publishes approved items at their time.
//
// Tabs: Calendar (default: everything planned / drafted / approved / sent, by
// day; click in to edit, approve a week or a selection) · Approve (one week,
// every item open) · Ideas (the idea scout + "Meet the Coaches") · Plan & flow · Rules (the directors' standing rules) ·
// Priorities · Photos · Videos (reels) · Settings.
// Spec: docs/MARKETING_CONTRACT.md. Server: api/marketing.js (POST {action}).
// Reads (and a few simple writes) go straight to Supabase — RLS lets the
// directors at the mkt_* tables (public.is_dssc_director()).

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabase";
import { DS, Btn } from "./DsscHub.jsx";
import { mktApi, isMissingTable, MIGRATION_MSG, weekStartOf, useNarrow } from "./DsscMarketingKit.jsx";
import MarketingApprove from "./DsscMarketingApprove.jsx";
import { MarketingPlan, MarketingPriorities } from "./DsscMarketingPlan.jsx";
import { MarketingPhotos, MarketingSettings } from "./DsscMarketingLibrary.jsx";
import MarketingIdeas from "./DsscMarketingIdeas.jsx";
import MarketingVideos from "./DsscMarketingVideos.jsx";
import MarketingReels from "./DsscMarketingReels.jsx";
import MarketingRules from "./DsscMarketingRules.jsx";
import MarketingCalendar from "./DsscMarketingCalendar.jsx";

const TABS = [["calendar", "Calendar"], ["approve", "Week"], ["ideas", "Ideas"], ["plan", "Plan & flow"], ["priorities", "Priorities"], ["rules", "Rules"], ["photos", "Photos"], ["videos", "Videos"], ["reels", "Reels"], ["settings", "Settings"]];
const TAB_KEY = "dssc.marketing.tab";

export default function DsscMarketing({ coach, initialWeek, initialTab, onConsumedInitial, onChanged }) {
  const narrow = useNarrow();
  const [tab, setTabState] = useState(() => { if (TABS.some(([k]) => k === initialTab)) return initialTab; if (initialWeek) return "approve"; try { const t = sessionStorage.getItem(TAB_KEY); return TABS.some(([k]) => k === t) ? t : "calendar"; } catch { return "calendar"; } });
  const setTab = (t) => { setTabState(t); try { sessionStorage.setItem(TAB_KEY, t); } catch { /* ignore */ } };
  const [calFocus, setCalFocus] = useState(null);   // { id, day } - open the Calendar on this item
  const [week, setWeek] = useState(() => /^\d{4}-\d{2}-\d{2}$/.test(initialWeek || "") ? weekStartOf(initialWeek) : weekStartOf());
  const [status, setStatus] = useState(null);
  const [statusErr, setStatusErr] = useState("");
  const [setupErr, setSetupErr] = useState("");

  // Deep link from the "drafts ready" email: ?view=dsscmarketing&week=YYYY-MM-DD
  useEffect(() => {
    if (!initialWeek && !initialTab) return;
    if (/^\d{4}-\d{2}-\d{2}$/.test(initialWeek || "")) { setWeek(weekStartOf(initialWeek)); setTab("approve"); }
    if (TABS.some(([k]) => k === initialTab)) setTab(initialTab);
    onConsumedInitial?.();
  }, [initialWeek, initialTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadStatus = useCallback(async () => {
    try { setStatus(await mktApi("status")); setStatusErr(""); }
    catch (e) { setStatusErr(e.message); setStatus(s => s || { connections: null, settings: null, priorities: [] }); }
  }, []);
  useEffect(() => {
    loadStatus();
    supabase.from("mkt_settings").select("id").limit(1).then(({ error }) => setSetupErr(error && isMissingTable(error) ? MIGRATION_MSG : ""));
  }, [loadStatus]);
  const changed = () => { onChanged?.(); };

  return (
    <div style={{ margin: "-14px -18px", padding: narrow ? "12px 12px 90px" : "16px 16px 48px", background: DS.bg, minHeight: "calc(100vh - 56px)", fontFamily: DS.font, color: DS.text, boxSizing: "border-box", overflowX: "hidden" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
          <div style={{ fontSize: 24, fontWeight: 800 }}>Marketing</div>
          <div style={{ flex: 1 }} />
          {!narrow && <Btn small kind="quiet" onClick={loadStatus}>Refresh</Btn>}
        </div>
        {!narrow && <div style={{ fontSize: 13, color: DS.mut, marginBottom: 12 }}>The week's Facebook + Instagram posts, email and texts — planned across the club's lines, drafted with on-brand graphics, and waiting for a director. Nothing goes out until it's approved.</div>}
        {setupErr && <div style={{ color: DS.orange, fontWeight: 700, fontSize: 13, margin: "8px 0 12px" }}>{setupErr}</div>}
        {statusErr && !setupErr && <div style={{ color: DS.orange, fontSize: 12, margin: "4px 0 10px" }}>Server: {statusErr}</div>}

        {/* Tabs: on the phone all nine show as a 3-across grid (a scrolling
            row hid Videos and Settings off the edge, with nothing to say so). */}
        <div style={narrow ? { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 14 } : { display: "flex", gap: 4, overflowX: "auto", borderBottom: "1px solid " + DS.line, marginBottom: 14, scrollbarWidth: "none" }}>
          {TABS.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={narrow
              ? { fontFamily: DS.font, fontSize: 14, fontWeight: 800, padding: "10px 4px", minHeight: 44, borderRadius: 10, border: "1px solid " + (tab === k ? DS.lime : DS.line), background: tab === k ? DS.limeSoft : "transparent", color: tab === k ? DS.text : DS.mut, cursor: "pointer", whiteSpace: "nowrap" }
              : { fontFamily: DS.font, fontSize: 14, fontWeight: 800, padding: "10px 14px", minHeight: 44, background: "none", border: "none", borderBottom: "3px solid " + (tab === k ? DS.lime : "transparent"), color: tab === k ? DS.text : DS.mut, cursor: "pointer", whiteSpace: "nowrap", flex: "none" }}>{l}</button>
          ))}
        </div>

        {tab === "calendar" && <MarketingCalendar narrow={narrow} status={status} focus={calFocus} onOpenWeek={(w) => { setWeek(weekStartOf(w)); setTab("approve"); }} onChanged={changed} />}
        {tab === "approve" && <MarketingApprove week={week} setWeek={setWeek} status={status} narrow={narrow} onChanged={changed} coach={coach} onShowOnCalendar={(id, day) => { setCalFocus({ id, day, n: Date.now() }); setTab("calendar"); }} />}
        {tab === "ideas" && <MarketingIdeas narrow={narrow} onOpenWeek={(w) => { setWeek(weekStartOf(w)); setTab("approve"); }} onChanged={changed} />}
        {tab === "plan" && <MarketingPlan week={week} status={status} narrow={narrow} onOpenWeek={(w) => { setWeek(weekStartOf(w)); setTab("approve"); }} />}
        {tab === "priorities" && <MarketingPriorities narrow={narrow} onChanged={() => { loadStatus(); changed(); }} />}
        {tab === "rules" && <MarketingRules status={status} narrow={narrow} onChanged={() => { loadStatus(); changed(); }} />}
        {tab === "photos" && <MarketingPhotos narrow={narrow} />}
        {tab === "videos" && <MarketingVideos narrow={narrow} onOpenWeek={(w) => { setWeek(weekStartOf(w)); setTab("approve"); }} onOpenReels={() => setTab("reels")} onChanged={changed} />}
        {tab === "reels" && <MarketingReels narrow={narrow} onOpenWeek={(w) => { setWeek(weekStartOf(w)); setTab("approve"); }} onOpenVideos={() => setTab("videos")} onChanged={changed} />}
        {tab === "settings" && <MarketingSettings status={status} narrow={narrow} reloadStatus={loadStatus} onChanged={changed} />}
      </div>
    </div>
  );
}
