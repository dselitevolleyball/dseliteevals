// Dripping Springs Sports Club — the Marketing Machine (Drew, 22 Oct 2026:
// "an automated marketing machine"). The planner balances the week across
// the club's lines (volleyball, basketball, Reach, Camp Elevate, parties,
// rentals, open gym) from what's starting on the website and Drew's
// priorities; the machine drafts Facebook/Instagram posts with on-brand
// graphics, a weekly email and the odd text; a director edits, asks for
// changes and approves — from a phone, in a couple of taps. Nothing goes out
// without approval; the cron publishes approved items at their time.
//
// Tabs: Approve (default) · Ideas (the idea scout + "Meet the Coaches") · Plan & flow · Priorities · Photos · Videos (reels) · Settings.
// Spec: docs/MARKETING_CONTRACT.md. Server: api/marketing.js (POST {action}).
// Reads (and a few simple writes) go straight to Supabase — RLS lets the
// directors at the mkt_* tables (public.is_dssc_director()).

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabase";
import { DS, Btn } from "./DsscHub.jsx";
import { mktApi, isMissingTable, MIGRATION_MSG, mondayOf, useNarrow } from "./DsscMarketingKit.jsx";
import MarketingApprove from "./DsscMarketingApprove.jsx";
import { MarketingPlan, MarketingPriorities } from "./DsscMarketingPlan.jsx";
import { MarketingPhotos, MarketingSettings } from "./DsscMarketingLibrary.jsx";
import MarketingIdeas from "./DsscMarketingIdeas.jsx";
import MarketingVideos from "./DsscMarketingVideos.jsx";

const TABS = [["approve", "Approve"], ["ideas", "Ideas"], ["plan", "Plan & flow"], ["priorities", "Priorities"], ["photos", "Photos"], ["videos", "Videos"], ["settings", "Settings"]];
const TAB_KEY = "dssc.marketing.tab";

export default function DsscMarketing({ coach, initialWeek, initialTab, onConsumedInitial, onChanged }) {
  const narrow = useNarrow();
  const [tab, setTabState] = useState(() => { if (TABS.some(([k]) => k === initialTab)) return initialTab; if (initialWeek) return "approve"; try { const t = sessionStorage.getItem(TAB_KEY); return TABS.some(([k]) => k === t) ? t : "approve"; } catch { return "approve"; } });
  const setTab = (t) => { setTabState(t); try { sessionStorage.setItem(TAB_KEY, t); } catch { /* ignore */ } };
  const [week, setWeek] = useState(() => /^\d{4}-\d{2}-\d{2}$/.test(initialWeek || "") ? mondayOf(initialWeek) : mondayOf());
  const [status, setStatus] = useState(null);
  const [statusErr, setStatusErr] = useState("");
  const [setupErr, setSetupErr] = useState("");

  // Deep link from the "drafts ready" email: ?view=dsscmarketing&week=YYYY-MM-DD
  useEffect(() => {
    if (!initialWeek && !initialTab) return;
    if (/^\d{4}-\d{2}-\d{2}$/.test(initialWeek || "")) { setWeek(mondayOf(initialWeek)); setTab("approve"); }
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

        {/* Tabs: a scrolling row of big targets on the phone. */}
        <div style={{ display: "flex", gap: narrow ? 6 : 4, overflowX: "auto", WebkitOverflowScrolling: "touch", borderBottom: "1px solid " + DS.line, marginBottom: 14, scrollbarWidth: "none" }}>
          {TABS.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ fontFamily: DS.font, fontSize: narrow ? 15 : 14, fontWeight: 800, padding: narrow ? "12px 12px" : "10px 14px", minHeight: 44, background: "none", border: "none", borderBottom: "3px solid " + (tab === k ? DS.lime : "transparent"), color: tab === k ? DS.text : DS.mut, cursor: "pointer", whiteSpace: "nowrap", flex: "none" }}>{l}</button>
          ))}
        </div>

        {tab === "approve" && <MarketingApprove week={week} setWeek={setWeek} status={status} narrow={narrow} onChanged={changed} coach={coach} />}
        {tab === "ideas" && <MarketingIdeas narrow={narrow} onOpenWeek={(w) => { setWeek(mondayOf(w)); setTab("approve"); }} onChanged={changed} />}
        {tab === "plan" && <MarketingPlan week={week} status={status} narrow={narrow} onOpenWeek={(w) => { setWeek(mondayOf(w)); setTab("approve"); }} />}
        {tab === "priorities" && <MarketingPriorities narrow={narrow} onChanged={() => { loadStatus(); changed(); }} />}
        {tab === "photos" && <MarketingPhotos narrow={narrow} />}
        {tab === "videos" && <MarketingVideos narrow={narrow} onOpenWeek={(w) => { setWeek(mondayOf(w)); setTab("approve"); }} onChanged={changed} />}
        {tab === "settings" && <MarketingSettings status={status} narrow={narrow} reloadStatus={loadStatus} onChanged={changed} />}
      </div>
    </div>
  );
}
