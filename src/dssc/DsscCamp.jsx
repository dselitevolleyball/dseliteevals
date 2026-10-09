// DSSC summer camp planning — Heatwave Volleyball (Heatwave ATX / H-ATX), the
// Heatwave Summer Sessions; Winter Sessions later. Named Oct 8 2026.
//
// Drew's brief: an invite/referral-only summer training program for national
// and bubble-national players, led by college coaches ("where the best come to
// train from the best"), sold to out-of-towners as a few days in Austin too.
// Eight sessions on two courts: Hitting, Libero/Defense and Setting for 14-16s
// (2 each) plus two 11/12 All Skills. 9-12 and 1-4 with lunch provided.
//
// Tabs: Plan (the write-up, editable), Economics (assumptions -> per-session
// P&L, 2- vs 3-day comparison), Sessions (dates, price, cap, lead coach),
// Coaches (the star-coach workbook), Launch (checklist to Jan 1).
//
// Data: dssc_camp_plan (one 'main' row, jsonb), dssc_camp_sessions,
// dssc_camp_coaches. Applications/payments come later with the public site.

import { useState, useEffect, useMemo } from "react";
import { supabase } from "../supabase";
import { DS, Btn, Card, Label, Tag, inputStyle, Field, rid } from "./DsscHub.jsx";

const FOCUS = { hitting: "Hitting", defense: "Libero / Defense", setting: "Setting", all_skills: "All Skills" };
const STATUS = ["idea", "contacted", "interested", "confirmed", "declined"];
const STATUS_COLOR = { idea: DS.dim, contacted: DS.mut, interested: DS.orange, confirmed: DS.lime, declined: "#e66" };
const SESSION_STATUS = ["tentative", "confirmed", "open", "full", "cancelled"];
const money = (n) => (n < 0 ? "-$" : "$") + Math.round(Math.abs(n || 0)).toLocaleString();
const fmtD = (iso) => iso ? new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "—";
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// Economics assumptions (editable on the Economics tab, stored in plan.data.econ).
const DEFAULT_ECON = {
  sessionPrice: 1600, sessionDays: 2, athletes: 14,
  starRate: 1000, flight: 500, hotelNight: 200, groundDay: 60, mealsDay: 75,
  assistants: 3, asstRate: 30, asstHours: 8,
  lunch: 15, swag: 35, courtDay: 0, procPct: 3, marketing: 3000, deposit: 250,
};
// Program pricing applies to every session at once (Sessions tab can still
// override one). The rest are cost assumptions.
const PRICING_KEYS = ["sessionPrice", "sessionDays", "athletes"];
const ECON_FIELDS = [
  ["Program pricing (every session)", [["sessionPrice", "Price per athlete, per session", "$"], ["sessionDays", "Days per session", "#"], ["athletes", "Athletes per session", "#"]]],
  ["Star coach", [["starRate", "Day rate", "$"], ["flight", "Flight (per session)", "$"], ["hotelNight", "Hotel per night", "$"], ["groundDay", "Car / Uber per day", "$"], ["mealsDay", "Meals per day", "$"]]],
  ["DS Elite / DSSC assistants", [["assistants", "Assistants per session", "#"], ["asstRate", "Hourly rate", "$"], ["asstHours", "Paid hours per day", "#"]]],
  ["Per player / per day", [["lunch", "Lunch per person per day (players + coaches)", "$"], ["swag", "Shirt / swag per player", "$"], ["courtDay", "Court cost per day (2 courts; $0 = our own)", "$"], ["procPct", "Card processing", "%"]]],
  ["Program", [["marketing", "Marketing for the summer (ads, design)", "$"], ["deposit", "Application deposit", "$"]]],
];

// One session's P&L. A lead coach's own rate / travel estimate wins over the defaults.
export const sessionEcon = (s, a, coach) => {
  const n = s.expected ?? s.cap, d = s.days, price = s.price_per_day;
  const revenue = n * price * d;
  const star = (coach?.day_rate ?? a.starRate) * d;
  const travel = coach?.travel_est ?? (a.flight + a.hotelNight * d + (a.groundDay + a.mealsDay) * d);
  const assistants = a.assistants * a.asstRate * a.asstHours * d;
  const lunch = (n + a.assistants + 1) * a.lunch * d;
  const swag = n * a.swag, courts = a.courtDay * d, processing = revenue * a.procPct / 100;
  const cost = star + travel + assistants + lunch + swag + courts + processing;
  const fixed = star + travel + assistants + (a.assistants + 1) * a.lunch * d + courts;
  const perPlayer = price * d * (1 - a.procPct / 100) - a.lunch * d - a.swag;
  return { n, revenue, star, travel, assistants, lunch, swag, courts, processing, cost, margin: revenue - cost,
           breakeven: perPlayer > 0 ? Math.ceil(fixed / perPlayer) : null };
};

// The program write-up. Drew's brief, tightened — every section is editable.
const DEFAULT_SECTIONS = [
  ["name", "Name", "Heatwave Volleyball"],
  ["brand", "Brand", "Full name: Heatwave Volleyball\nShort forms: Heatwave ATX, H-ATX\nPrograms: Heatwave Summer Sessions; Heatwave Winter Sessions (later)"],
  ["tagline", "Tagline", "Where the best come to train from the best."],
  ["pitch", "The pitch", "A small-group summer intensive in Austin for national and bubble-national players. Two days of position-specific training led by college coaches: 14 athletes on two courts with four coaches, a 1:3.5 coach-to-player ratio. $1,600 per two-day session (room and board not included). It's built for the player who already trains hard and wants a summer edge she can't get at her club or a big-name camp of 200. For families from out of town it's also a reason to spend a few days in Austin: train in the mornings and afternoons, and enjoy the city's food, music and Hill Country in the evenings."],
  ["who", "Who it's for (eligibility)", "Ages 14-16 for the position intensives (Hitting, Libero/Defense, Setting); ages 11-12 for All Skills.\nNational or bubble-national level: playing on (or pushing for) a national/open-level club team.\nAdmission requires a referral from the player's club coach or club director, plus game or skills film.\nWe keep each session to similar ages and levels so the training stays at the top end - two courts, one group."],
  ["format", "Format", "Every session is 2 days. $1,600 per athlete, lunch on training days included; room and board not included.\n9:00am-12:00pm training, 12:00-1:00 lunch provided by DSSC, 1:00-4:00pm training. 6 hours on court a day.\nOne star lead coach + three DS Elite / DSSC assistants, two courts, 14 players (4 coaches : 14 athletes = 1:3.5).\nEach athlete leaves with a written evaluation from the lead coach and a short video breakdown of her skill work (worth adding: it's the thing families share)."],
  ["coaches", "Coaching", "Each session is led by a college head or assistant coach who specializes in that skill - the name is the product, so we announce the lead coach for every session. Three DS Elite / DSSC staff assist on court so every rep gets feedback. We need 8 star coaches for 8 sessions (shortlist 2 per session in case of conflicts)."],
  ["apply", "Application", "1. Apply online: player info, position, club and team, level, and a film link (Hudl/YouTube).\n2. A coach or club director submits a short referral (we email them a link, so the referral comes from the coach, not the parent).\n3. Pay the application deposit by card to hold a place in review.\n4. We review film + referral and accept, waitlist or decline within 14 days.\n5. Accepted players pay the balance within 7 days to lock the spot. Declined applicants get the deposit back in full."],
  ["policy", "Payment & cancellation", "Deposit at application; balance due on acceptance.\nCancel on or before April 1: 50% of the amount paid is refunded.\nCancel after April 1: no refund.\nIf DSSC cancels a session, a full refund or a transfer to another session.\n(Confirm with counsel/insurance before launch; spell out what happens if a player is injured before camp.)"],
  ["marketing", "Marketing & outreach", "Personal invitations to club directors in Texas and neighboring states (Lone Star, North Texas, South Texas, Oklahoma, Louisiana) with a referral link they can forward to their coaches.\nSocial: announce each lead coach as a separate post; short clips from the coaches; DS Elite and DSSC accounts plus the coaches' own followings.\nDirect outreach to our own national-team families and alumni.\nA landing page with the coaches, sessions, the Austin angle (where to stay, eat, what to do) and the application."],
  ["austin", "The Austin angle", "A one-page city guide for visiting families: partner hotel rates near Dripping Springs/Austin, favorite places to eat, things to do between sessions (Barton Springs, South Congress, Hill Country wineries for the parents), and airport logistics."],
  ["risks", "Open questions / risks", "Dates: 14-16 national teams play nationals through July 5; Texas high-school volleyball starts early August. June sessions compete with nationals prep.\nInsurance/waivers for non-members; liability for minors staying in hotels with parents only (no overnight supervision by DSSC).\nCollege coaches' NCAA camp rules (recruiting-camp restrictions, especially for prospects aged 14-16) - check before announcing names.\nPayment processor for deposits, balances and partial refunds."],
];

const DEFAULT_CHECKLIST = [
  ["Pick the name, buy the domain and social handles", "2026-10-31"],
  ["Lock pricing, deposit and refund policy", "2026-11-15"],
  ["Check NCAA camp rules for college coaches working a private camp", "2026-11-15"],
  ["Shortlist 16 star coaches (2 per session)", "2026-11-15"],
  ["Pick the payment processor (deposit, balance, partial refunds)", "2026-12-01"],
  ["Confirm 8 lead coaches and lock session dates", "2026-12-15"],
  ["Build the site + application (film link, referral, deposit)", "2026-12-15"],
  ["Coach/director referral form and email", "2026-12-15"],
  ["Club director invite list and invitation email", "2026-12-20"],
  ["Social launch posts (one per lead coach)", "2026-12-20"],
  ["Waiver and insurance for non-member athletes", "2026-12-20"],
  ["LAUNCH - applications open", "2027-01-01"],
  ["Partner hotel rates + Austin city guide", "2027-03-01"],
  ["Refund-deadline reminder to accepted families", "2027-03-15"],
  ["April 1 - refund cutoff", "2027-04-01"],
  ["Book lead coaches' travel and hotels", "2027-04-15"],
  ["Lunch vendor + shirts ordered", "2027-05-01"],
  ["Schedule DS Elite / DSSC assistants for every session", "2027-05-01"],
];

const num = (v) => { const x = Number(String(v).replace(/[^0-9.]/g, "")); return Number.isFinite(x) ? x : 0; };
const small = { ...inputStyle, padding: "6px 8px", fontSize: 13 };

export default function DsscCamp({ coach }) {
  const [tab, setTab] = useState("plan");
  const [plan, setPlan] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [err, setErr] = useState(null);
  const who = coach?.display_name || coach?.email || null;

  const load = async () => {
    const [p, s, c] = await Promise.all([
      supabase.from("dssc_camp_plan").select("*").eq("id", "main").maybeSingle(),
      supabase.from("dssc_camp_sessions").select("*").order("sort"),
      supabase.from("dssc_camp_coaches").select("*").order("name"),
    ]);
    const e = p.error || s.error || c.error; if (e) setErr(e.message);
    setPlan(p.data?.data || {}); setSessions(s.data || []); setCoaches(c.data || []);
  };
  useEffect(() => { load(); }, []);

  const savePlan = async (patch) => {
    const next = { ...(plan || {}), ...patch };
    setPlan(next);
    const { error } = await supabase.from("dssc_camp_plan").upsert({ id: "main", data: next, updated_at: new Date().toISOString(), updated_by: who });
    if (error) setErr(error.message);
  };
  const saveSession = async (id, patch) => {
    setSessions(xs => xs.map(x => x.id === id ? { ...x, ...patch } : x));
    const { error } = await supabase.from("dssc_camp_sessions").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) setErr(error.message);
  };
  const saveCoach = async (id, patch) => {
    setCoaches(xs => xs.map(x => x.id === id ? { ...x, ...patch } : x));
    const { error } = await supabase.from("dssc_camp_coaches").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) setErr(error.message);
  };
  const addCoach = async () => {
    const { data, error } = await supabase.from("dssc_camp_coaches").insert({ name: "New coach" }).select().single();
    if (error) { setErr(error.message); return; }
    setCoaches(xs => [data, ...xs]);
  };
  const removeCoach = async (c) => {
    if (!window.confirm(`Remove ${c.name} from the coach list?`)) return;
    const { error } = await supabase.from("dssc_camp_coaches").delete().eq("id", c.id);
    if (error) { setErr(error.message); return; }
    setCoaches(xs => xs.filter(x => x.id !== c.id)); setSessions(xs => xs.map(s => s.lead_coach_id === c.id ? { ...s, lead_coach_id: null } : s));
  };

  const econ = { ...DEFAULT_ECON, ...(plan?.econ || {}) };
  const coachBy = useMemo(() => new Map(coaches.map(c => [c.id, c])), [coaches]);
  const live = sessions.filter(s => s.status !== "cancelled");
  const rows = live.map(s => ({ s, e: sessionEcon(s, econ, coachBy.get(s.lead_coach_id)) }));
  const tot = rows.reduce((t, { e }) => ({ revenue: t.revenue + e.revenue, cost: t.cost + e.cost, players: t.players + e.n }), { revenue: 0, cost: 0, players: 0 });
  const net = tot.revenue - tot.cost - econ.marketing;
  const name = plan?.sections?.name || "Heatwave Volleyball";

  if (!plan) return <div style={{ padding: 24, color: DS.mut, fontFamily: DS.font }}>Loading…</div>;
  const tabs = [["plan", "Plan"], ["econ", "Economics"], ["sessions", "Sessions"], ["coaches", `Coaches (${coaches.length})`], ["interest", "Interest"], ["launch", "Launch"]];
  const confirmedLeads = live.filter(s => coachBy.get(s.lead_coach_id)?.status === "confirmed").length;

  return (
    <div style={{ background: DS.bg, color: DS.text, fontFamily: DS.font, minHeight: "100%", padding: "18px 18px 40px", boxSizing: "border-box" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: DS.lime }}>DSSC · Heatwave Summer Sessions 2027</div>
            <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.15 }}>{name}</div>
            <div style={{ fontSize: 14, color: DS.mut }}>{plan?.sections?.tagline || DEFAULT_SECTIONS[1][2]}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Stat label="Sessions" value={live.length} />
            <Stat label="Lead coaches confirmed" value={`${confirmedLeads}/${live.length}`} />
            <Stat label="Players at plan" value={tot.players} />
            <Stat label="Projected net" value={money(net)} color={net >= 0 ? DS.lime : DS.orange} />
          </div>
        </div>
        {err && <div style={{ color: DS.orange, fontWeight: 700, fontSize: 13, margin: "8px 0" }}>{err}</div>}
        <div style={{ display: "flex", gap: 2, borderBottom: "1px solid " + DS.line, margin: "12px 0 16px", overflowX: "auto" }}>
          {tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} style={{ fontFamily: DS.font, fontSize: 14, fontWeight: 700, padding: "10px 14px", background: "none", border: "none", borderBottom: "3px solid " + (tab === k ? DS.lime : "transparent"), color: tab === k ? DS.text : DS.mut, cursor: "pointer", whiteSpace: "nowrap" }}>{l}</button>)}
        </div>

        {tab === "plan" && <PlanTab plan={plan} savePlan={savePlan} />}
        {tab === "econ" && <EconTab econ={econ} savePlan={savePlan} rows={rows} tot={tot} net={net}
          applyPricing={async (e) => { for (const x of sessions.filter(x => x.status !== "cancelled")) await saveSession(x.id, { days: e.sessionDays, cap: e.athletes, expected: null, price_per_day: Math.round(e.sessionPrice / Math.max(1, e.sessionDays)) }); }} />}
        {tab === "sessions" && <SessionsTab sessions={sessions} coaches={coaches} coachBy={coachBy} econ={econ} saveSession={saveSession} />}
        {tab === "coaches" && <CoachesTab coaches={coaches} sessions={sessions} saveCoach={saveCoach} addCoach={addCoach} removeCoach={removeCoach} />}
        {tab === "interest" && <InterestTab />}
        {tab === "launch" && <LaunchTab plan={plan} savePlan={savePlan} />}
      </div>
    </div>
  );
}

const Stat = ({ label, value, color }) => (
  <div style={{ background: DS.panel, border: "1px solid " + DS.line, borderRadius: 12, padding: "8px 14px", minWidth: 110 }}>
    <div style={{ fontSize: 11, color: DS.mut, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
    <div style={{ fontSize: 20, fontWeight: 800, color: color || DS.text }}>{value}</div>
  </div>
);

function PlanTab({ plan, savePlan }) {
  const sec = plan.sections || {};
  const set = (k, v) => savePlan({ sections: { ...sec, [k]: v } });
  return (<>
    <Card accent={DS.lime}>
      <div style={{ fontSize: 13, color: DS.mut, lineHeight: 1.5 }}>The program write-up. Everything below is a starting draft from your brief — edit any section and it saves as you type. This is what the public site will be built from.</div>
    </Card>
    {DEFAULT_SECTIONS.map(([k, label, def]) => (
      <Card key={k}>
        <Label>{label}</Label>
        <Field value={sec[k] ?? def} onSave={v => set(k, v)} multiline={k !== "name" && k !== "tagline"} minRows={k === "pitch" ? 4 : 3} />
      </Card>
    ))}
  </>);
}

function EconTab({ econ, savePlan, rows, tot, net, applyPricing }) {
  const set = async (k, v) => {
    const next = { ...econ, [k]: num(v) };
    if (next[k] === econ[k]) return;
    if (PRICING_KEYS.includes(k)) {
      if (!(next.sessionDays >= 1) || !(next.athletes >= 1)) return;
      await savePlan({ econ: next });
      await applyPricing(next);
    } else savePlan({ econ: next });
  };
  // What one session nets at the program's days, across prices and group sizes.
  const P = econ.sessionPrice, D = Math.max(1, econ.sessionDays), N = econ.athletes;
  const prices = [...new Set([P - 200, P, P + 200].filter(x => x > 0))];
  const sizes = [...new Set([N - 2, N, N + 1].filter(x => x > 0))];
  const grid = prices.map(price => ({ price, cells: sizes.map(n => ({ n, e: sessionEcon({ days: D, price_per_day: price / D, cap: n, expected: n }, econ, null) })) }));
  const th = { textAlign: "right", padding: "6px 8px", fontSize: 11, color: DS.mut, fontWeight: 700, textTransform: "uppercase", whiteSpace: "nowrap", borderBottom: "1px solid " + DS.line };
  const td = { textAlign: "right", padding: "6px 8px", fontSize: 13, borderBottom: "1px solid " + DS.line, whiteSpace: "nowrap" };
  return (<>
    <Card>
      <Label>The summer at plan</Label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Stat label="Revenue" value={money(tot.revenue)} />
        <Stat label="Session costs" value={money(tot.cost)} />
        <Stat label="Marketing" value={money(econ.marketing)} />
        <Stat label="Net" value={money(net)} color={net >= 0 ? DS.lime : DS.orange} />
        <Stat label="Margin" value={tot.revenue ? Math.round(net / tot.revenue * 100) + "%" : "—"} />
      </div>
      <div style={{ overflowX: "auto", marginTop: 12 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 760 }}>
          <thead><tr><th style={{ ...th, textAlign: "left" }}>Session</th><th style={th}>Players</th><th style={th}>Revenue</th><th style={th}>Star + travel</th><th style={th}>Assistants</th><th style={th}>Lunch</th><th style={th}>Swag/courts/fees</th><th style={th}>Net</th><th style={th}>Break-even</th></tr></thead>
          <tbody>{rows.map(({ s, e }) => (
            <tr key={s.id}>
              <td style={{ ...td, textAlign: "left" }}>{s.name}<div style={{ fontSize: 11, color: DS.mut }}>{s.days} days · {money(s.price_per_day * s.days)}/athlete</div></td>
              <td style={td}>{e.n}</td><td style={td}>{money(e.revenue)}</td><td style={td}>{money(e.star + e.travel)}</td><td style={td}>{money(e.assistants)}</td>
              <td style={td}>{money(e.lunch)}</td><td style={td}>{money(e.swag + e.courts + e.processing)}</td>
              <td style={{ ...td, fontWeight: 800, color: e.margin >= 0 ? DS.lime : DS.orange }}>{money(e.margin)}</td>
              <td style={td}>{e.breakeven ?? "—"} players</td>
            </tr>))}</tbody>
        </table>
      </div>
    </Card>
    <Card>
      <Label>Price × group size (one {D}-day session, net)</Label>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", minWidth: 520 }}>
          <thead><tr><th style={{ ...th, textAlign: "left" }}>Price / athlete</th>{sizes.map(n => <th key={n} style={th}>{n} athletes</th>)}</tr></thead>
          <tbody>{grid.map(r => (
            <tr key={r.price}><td style={{ ...td, textAlign: "left", fontWeight: 700 }}>${r.price}</td>
              {r.cells.map((c, i) => <td key={i} style={{ ...td, background: r.price === P && c.n === N ? DS.limeSoft : "transparent" }}><b style={{ color: DS.lime }}>{money(c.e.margin)}</b><div style={{ fontSize: 11, color: DS.mut }}>{money(c.n * r.price)} in</div></td>)}
            </tr>))}</tbody>
        </table>
      </div>
      <div style={{ fontSize: 12, color: DS.mut, marginTop: 8, lineHeight: 1.5 }}>Highlighted: the current plan. Change price, days or athletes under Assumptions and every session updates.</div>
    </Card>
    <Card>
      <Label>Assumptions</Label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
        {ECON_FIELDS.map(([group, fields]) => (
          <div key={group}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>{group}</div>
            {fields.map(([k, label, unit]) => (
              <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 13, color: DS.mut }}>
                <span style={{ flex: 1 }}>{label}</span>
                <span style={{ color: DS.dim, width: 12, textAlign: "right" }}>{unit === "$" ? "$" : ""}</span>
                <input defaultValue={econ[k]} onBlur={e => set(k, e.target.value)} style={{ ...small, width: 80, textAlign: "right" }} />
                <span style={{ color: DS.dim, width: 12 }}>{unit === "%" ? "%" : ""}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: DS.mut, marginTop: 8, lineHeight: 1.5 }}>Star travel per session = flight + hotel × days + (car + meals) × days, unless the coach has her own travel estimate on the Coaches tab. Assistants: {econ.assistants} × ${econ.asstRate}/hr × {econ.asstHours} hrs a day. Lunch covers the players and all {econ.assistants + 1} coaches.</div>
    </Card>
  </>);
}

function SessionsTab({ sessions, coaches, coachBy, econ, saveSession }) {
  const sorted = [...sessions].sort((a, b) => String(a.start_date || "9").localeCompare(String(b.start_date || "9")));
  const endOf = (s) => s.start_date ? addDays(s.start_date, s.days - 1) : null;
  // Two courts = one session at a time.
  const clash = (s) => sessions.find(o => o.id !== s.id && o.status !== "cancelled" && s.status !== "cancelled" && o.start_date && s.start_date && o.start_date <= endOf(s) && endOf(o) >= s.start_date);
  return (<>
    <Card accent={DS.lime}><div style={{ fontSize: 13, color: DS.mut, lineHeight: 1.5 }}>Dates are a starting point: after USAV 16s/17s Nationals (ends Jul 5) and before Texas high-school volleyball starts in August, with two sessions in early June. Move them as coaches' schedules come in — the warning shows if two sessions would need the courts at once.</div></Card>
    {sorted.map(s => {
      const lead = coachBy.get(s.lead_coach_id), e = sessionEcon(s, econ, lead), c = clash(s);
      const fits = coaches.filter(x => x.status !== "declined" && (x.skills || []).some(k => k === s.focus || (s.focus === "all_skills") || k === "all_skills"))
        .sort((a, b) => STATUS.indexOf(b.status) - STATUS.indexOf(a.status) || a.name.localeCompare(b.name));
      return (
        <Card key={s.id} accent={s.status === "cancelled" ? DS.line : undefined} style={{ opacity: s.status === "cancelled" ? 0.6 : 1 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <Tag color={DS.lime}>{FOCUS[s.focus]}</Tag><Tag>{s.ages}</Tag>
            <input defaultValue={s.name} onBlur={ev => ev.target.value.trim() && ev.target.value !== s.name && saveSession(s.id, { name: ev.target.value.trim() })} style={{ ...small, fontSize: 16, fontWeight: 800, flex: "1 1 220px", background: "transparent", border: "1px solid transparent" }} />
            <select value={s.status} onChange={ev => saveSession(s.id, { status: ev.target.value })} style={{ ...small, width: "auto" }}>{SESSION_STATUS.map(x => <option key={x}>{x}</option>)}</select>
            <span style={{ fontWeight: 800, color: e.margin >= 0 ? DS.lime : DS.orange }}>{money(e.margin)} net</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <Mini label="Start"><input type="date" value={s.start_date || ""} onChange={ev => saveSession(s.id, { start_date: ev.target.value || null })} style={small} /></Mini>
            <Mini label="Days"><select value={s.days} onChange={ev => saveSession(s.id, { days: +ev.target.value })} style={small}>{[1, 2, 3, 4].map(d => <option key={d} value={d}>{d}</option>)}</select></Mini>
            <Mini label="Price / day"><input defaultValue={s.price_per_day} onBlur={ev => saveSession(s.id, { price_per_day: num(ev.target.value) })} style={small} /></Mini>
            <Mini label="Cap"><input defaultValue={s.cap} onBlur={ev => saveSession(s.id, { cap: num(ev.target.value) || 1 })} style={small} /></Mini>
            <Mini label="Plan for"><input defaultValue={s.expected ?? ""} placeholder={String(s.cap)} onBlur={ev => saveSession(s.id, { expected: ev.target.value.trim() ? num(ev.target.value) : null })} style={small} /></Mini>
            <Mini label="Ages"><input defaultValue={s.ages || ""} onBlur={ev => saveSession(s.id, { ages: ev.target.value.trim() })} style={small} /></Mini>
          </div>
          <div style={{ fontSize: 13, color: DS.mut, marginTop: 8 }}>
            {s.start_date ? <>{fmtD(s.start_date)} – {fmtD(endOf(s))} · 9–12 & 1–4, lunch provided · {money(s.price_per_day * s.days)} per player</> : "No dates yet"}
            {c && <span style={{ color: DS.orange, fontWeight: 700 }}> · ⚠ overlaps {c.name} (two courts = one session at a time)</span>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10, marginTop: 10 }}>
            <Mini label="Lead (star) coach">
              <select value={s.lead_coach_id || ""} onChange={ev => saveSession(s.id, { lead_coach_id: ev.target.value ? +ev.target.value : null })} style={small}>
                <option value="">— pick from the Coaches tab —</option>
                {fits.map(x => <option key={x.id} value={x.id}>{x.name}{x.title ? " · " + x.title : ""} ({x.status})</option>)}
              </select>
              {lead && <div style={{ fontSize: 12, color: DS.mut, marginTop: 4 }}><Tag color={STATUS_COLOR[lead.status]}>{lead.status}</Tag> {lead.availability ? "Availability: " + lead.availability : "No availability noted yet"}</div>}
            </Mini>
            <Mini label="Assistants (DS Elite / DSSC)"><Field value={s.assistants || ""} onSave={v => saveSession(s.id, { assistants: v })} placeholder="Three staff names" /></Mini>
          </div>
          <div style={{ marginTop: 10 }}><Field value={s.notes || ""} onSave={v => saveSession(s.id, { notes: v })} multiline minRows={1} placeholder="Notes" /></div>
        </Card>
      );
    })}
  </>);
}

const Mini = ({ label, children }) => <div><div style={{ fontSize: 11, color: DS.mut, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>{label}</div>{children}</div>;

function CoachesTab({ coaches, sessions, saveCoach, addCoach, removeCoach }) {
  const [skill, setSkill] = useState(""), [status, setStatus] = useState("");
  const shown = coaches.filter(c => (!skill || (c.skills || []).includes(skill)) && (!status || c.status === status));
  const leading = (c) => sessions.filter(s => s.lead_coach_id === c.id).map(s => s.name);
  const counts = STATUS.map(s => [s, coaches.filter(c => c.status === s).length]);
  return (<>
    <Card accent={DS.lime}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontSize: 13, color: DS.mut, flex: "1 1 280px", lineHeight: 1.5 }}>Every star-coach prospect: what they teach, where they are in the conversation, when they're free. We need 8 confirmed (2 per skill + 2 for 11/12). Assign them to sessions on the Sessions tab.</div>
        <Btn kind="primary" onClick={addCoach}>+ Add coach</Btn>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        <select value={skill} onChange={e => setSkill(e.target.value)} style={{ ...small, width: "auto" }}><option value="">All skills</option>{Object.entries(FOCUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select value={status} onChange={e => setStatus(e.target.value)} style={{ ...small, width: "auto" }}><option value="">All statuses</option>{STATUS.map(s => <option key={s}>{s}</option>)}</select>
        {counts.map(([s, n]) => n ? <Tag key={s} color={STATUS_COLOR[s]}>{n} {s}</Tag> : null)}
      </div>
    </Card>
    {!shown.length && <div style={{ color: DS.mut, fontSize: 14, padding: "8px 2px" }}>{coaches.length ? "No coaches match those filters." : "No coaches yet — add the first prospect."}</div>}
    {shown.map(c => (
      <Card key={c.id}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          <div style={{ flex: "1 1 200px" }}><Field value={c.name} onSave={v => v.trim() && saveCoach(c.id, { name: v.trim() })} style={{ fontSize: 16, fontWeight: 800 }} /></div>
          <div style={{ flex: "1 1 220px" }}><Field value={c.title || ""} onSave={v => saveCoach(c.id, { title: v })} placeholder="Title, school (e.g. Assistant Coach, Baylor)" /></div>
          <select value={c.status} onChange={e => saveCoach(c.id, { status: e.target.value })} style={{ ...small, width: "auto", color: STATUS_COLOR[c.status], fontWeight: 800 }}>{STATUS.map(s => <option key={s}>{s}</option>)}</select>
          <Btn kind="quiet" small onClick={() => removeCoach(c)}>Remove</Btn>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {Object.entries(FOCUS).map(([k, l]) => { const on = (c.skills || []).includes(k); return (
            <button key={k} onClick={() => saveCoach(c.id, { skills: on ? c.skills.filter(x => x !== k) : [...(c.skills || []), k] })}
              style={{ fontFamily: DS.font, fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: 999, cursor: "pointer", border: "1px solid " + (on ? DS.lime : DS.line), background: on ? DS.limeSoft : "transparent", color: on ? DS.lime : DS.mut }}>{l}</button>); })}
          {leading(c).length > 0 && <span style={{ fontSize: 12, color: DS.lime, alignSelf: "center" }}>Leading: {leading(c).join(", ")}</span>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <Mini label="Availability / dates"><Field value={c.availability || ""} onSave={v => saveCoach(c.id, { availability: v })} placeholder="e.g. Free Jul 12-24" /></Mini>
          <Mini label="Email"><Field value={c.email || ""} onSave={v => saveCoach(c.id, { email: v })} /></Mini>
          <Mini label="Phone"><Field value={c.phone || ""} onSave={v => saveCoach(c.id, { phone: v })} /></Mini>
          <Mini label="Flies from"><Field value={c.from_city || ""} onSave={v => saveCoach(c.id, { from_city: v })} placeholder="City" /></Mini>
          <Mini label="Day rate ($)"><Field value={String(c.day_rate ?? 1000)} onSave={v => saveCoach(c.id, { day_rate: num(v) || 0 })} /></Mini>
          <Mini label="Travel per session ($)"><Field value={c.travel_est == null ? "" : String(c.travel_est)} onSave={v => saveCoach(c.id, { travel_est: v.trim() ? num(v) : null })} placeholder="default estimate" /></Mini>
          <Mini label="Connection"><Field value={c.connection || ""} onSave={v => saveCoach(c.id, { connection: v })} placeholder="Who knows them" /></Mini>
        </div>
        <SiteProfile c={c} saveCoach={saveCoach} />
        <div style={{ marginTop: 10 }}><Field value={c.notes || ""} onSave={v => saveCoach(c.id, { notes: v })} multiline minRows={1} placeholder="Notes" /></div>
      </Card>
    ))}
  </>);
}

function LaunchTab({ plan, savePlan }) {
  const list = plan.checklist || DEFAULT_CHECKLIST.map(([text, due]) => ({ id: rid(), text, due, owner: "", done: false }));
  const save = (next) => savePlan({ checklist: next });
  const today = new Date().toISOString().slice(0, 10);
  const sorted = [...list].sort((a, b) => String(a.due || "9").localeCompare(String(b.due || "9")));
  const done = list.filter(x => x.done).length;
  return (<>
    <Card accent={DS.lime}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, fontSize: 13, color: DS.mut }}>Everything between now and the January 1 launch, then through the summer. {done}/{list.length} done.</div>
        <Btn small onClick={() => save([...list, { id: rid(), text: "New task", due: "", owner: "", done: false }])}>+ Add task</Btn>
      </div>
    </Card>
    <Card>
      {sorted.map(x => {
        const late = !x.done && x.due && x.due < today;
        const upd = (patch) => save(list.map(y => y.id === x.id ? { ...y, ...patch } : y));
        return (
          <div key={x.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: "1px solid " + DS.line, flexWrap: "wrap" }}>
            <input type="checkbox" checked={!!x.done} onChange={e => upd({ done: e.target.checked })} style={{ width: 18, height: 18, accentColor: DS.lime }} />
            <div style={{ flex: "1 1 260px", textDecoration: x.done ? "line-through" : "none", opacity: x.done ? 0.6 : 1 }}><Field value={x.text} onSave={v => upd({ text: v })} style={{ background: "transparent", border: "1px solid transparent", padding: "4px 6px", fontWeight: /^LAUNCH|April 1/.test(x.text) ? 800 : 400 }} /></div>
            <input type="date" value={x.due || ""} onChange={e => upd({ due: e.target.value })} style={{ ...small, width: 150, color: late ? DS.orange : DS.text }} />
            <div style={{ width: 130 }}><Field value={x.owner || ""} onSave={v => upd({ owner: v })} placeholder="Owner" style={{ padding: "6px 8px", fontSize: 13 }} /></div>
            <Btn kind="quiet" small onClick={() => save(list.filter(y => y.id !== x.id))}>✕</Btn>
          </div>
        );
      })}
    </Card>
  </>);
}

// Sign-ups from the heatwaveatx.com interest form (api/interest.js in the
// heatwave-atx repo writes heatwave_interest with the service role).
const ROLE_LABEL = { parent: "Parent", player: "Player", director: "Director / coach" };
const LEVEL_LABEL = { national: "National", bubble: "Bubble", regional: "Regional", other: "Other" };
const INT_STATUS = ["new", "contacted", "applied", "not a fit"];
function InterestTab() {
  const [rows, setRows] = useState(null);
  const [role, setRole] = useState(""), [q, setQ] = useState("");
  useEffect(() => { supabase.from("heatwave_interest").select("*").order("created_at", { ascending: false }).then(({ data }) => setRows(data || [])); }, []);
  const save = async (id, patch) => { setRows(xs => xs.map(x => x.id === id ? { ...x, ...patch } : x)); await supabase.from("heatwave_interest").update(patch).eq("id", id); };
  if (!rows) return <div style={{ color: DS.mut }}>Loading…</div>;
  const ql = q.trim().toLowerCase();
  const shown = rows.filter(r => (!role || r.role === role) && (!ql || [r.name, r.email, r.player_name, r.club, r.city].join(" ").toLowerCase().includes(ql)));
  const bySession = Object.keys(FOCUS).map(k => [k, rows.filter(r => (r.sessions || []).includes(k)).length]);
  const csv = () => {
    const cols = ["created_at", "role", "name", "email", "phone", "ok_text", "player_name", "grad_year", "club", "level", "sessions", "city", "heard_from", "message", "status", "notes"];
    const cell = (v) => '"' + String(Array.isArray(v) ? v.join("; ") : v ?? "").replace(/"/g, '""') + '"';
    const blob = new Blob([[cols.join(","), ...shown.map(r => cols.map(c => cell(r[c])).join(","))].join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "heatwave-interest.csv"; a.click();
  };
  return (<>
    <Card accent={DS.lime}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Stat label="Sign-ups" value={rows.length} />
        <Stat label="Directors" value={rows.filter(r => r.role === "director").length} />
        <Stat label="National" value={rows.filter(r => r.level === "national").length} />
        {bySession.map(([k, n]) => <Stat key={k} label={FOCUS[k]} value={n} />)}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
        <select value={role} onChange={e => setRole(e.target.value)} style={{ ...small, width: "auto" }}><option value="">Everyone</option>{Object.entries(ROLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, club, city" style={{ ...small, width: 220 }} />
        <div style={{ flex: 1 }} />
        <a href="https://heatwaveatx.com" target="_blank" rel="noreferrer" style={{ color: DS.lime, fontSize: 13, fontWeight: 700 }}>heatwaveatx.com ↗</a>
        <Btn small onClick={csv} disabled={!shown.length}>Download CSV</Btn>
      </div>
    </Card>
    {!shown.length && <div style={{ color: DS.mut, fontSize: 14, padding: "8px 2px" }}>{rows.length ? "No sign-ups match." : "No sign-ups yet — the form is live at heatwaveatx.com."}</div>}
    {shown.map(r => (
      <Card key={r.id}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <b style={{ fontSize: 16 }}>{r.player_name || r.name}</b>
          <Tag color={r.role === "director" ? DS.orange : DS.mut}>{ROLE_LABEL[r.role] || r.role}</Tag>
          {r.level && <Tag color={r.level === "national" ? DS.lime : DS.mut}>{LEVEL_LABEL[r.level]}</Tag>}
          {(r.sessions || []).map(k => <Tag key={k} color={DS.brier}>{FOCUS[k] || k}</Tag>)}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: DS.mut }}>{new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
          <select value={r.status} onChange={e => save(r.id, { status: e.target.value })} style={{ ...small, width: "auto" }}>{INT_STATUS.map(x => <option key={x}>{x}</option>)}</select>
        </div>
        <div style={{ fontSize: 13, color: DS.mut, marginTop: 6, lineHeight: 1.6 }}>
          {r.player_name && <>{r.name} · </>}<a href={"mailto:" + r.email} style={{ color: DS.lime }}>{r.email}</a>{r.phone ? " · " + r.phone : ""}{r.ok_text ? " (OK to text)" : ""}
          {r.club && <> · {r.club}</>}{r.grad_year && <> · class of {r.grad_year}</>}{r.city && <> · {r.city}</>}{r.heard_from && <> · heard via {r.heard_from}</>}
        </div>
        {r.message && <div style={{ fontSize: 14, marginTop: 6, whiteSpace: "pre-wrap" }}>"{r.message}"</div>}
        <div style={{ marginTop: 8 }}><Field value={r.notes || ""} onSave={v => save(r.id, { notes: v })} placeholder="Notes" /></div>
      </Card>
    ))}
  </>);
}

// The coach's public card on heatwaveatx.com: headshot, bio, and a switch.
// The site's hero reads coaches with show_on_site on (heatwave-atx api/coaches.js).
function SiteProfile({ c, saveCoach }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const upload = async (file) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) { setErr("Pick an image file."); return; }
    setBusy(true); setErr(null);
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = "coaches/" + c.id + "-" + Date.now() + "." + ext;
    const { error } = await supabase.storage.from("heatwave").upload(path, file, { contentType: file.type, upsert: true });
    if (error) { setErr(error.message); setBusy(false); return; }
    const { data } = supabase.storage.from("heatwave").getPublicUrl(path);
    await saveCoach(c.id, { photo_url: data.publicUrl });
    setBusy(false);
  };
  const ready = !!(c.photo_url && (c.bio || "").trim() && (c.title || "").trim());
  return (
    <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: "1px dashed " + (c.show_on_site ? DS.lime : DS.line), display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div style={{ width: 96, flex: "none" }}>
        <div style={{ width: 96, height: 120, borderRadius: 10, background: DS.panel2, backgroundImage: c.photo_url ? "url(" + c.photo_url + ")" : "none", backgroundSize: "cover", backgroundPosition: "center top", display: "flex", alignItems: "center", justifyContent: "center", color: DS.dim, fontSize: 11, textAlign: "center" }}>{c.photo_url ? "" : "No photo"}</div>
        <label style={{ display: "block", marginTop: 6, fontSize: 12, fontWeight: 700, color: DS.lime, cursor: "pointer" }}>
          {busy ? "Uploading…" : c.photo_url ? "Change photo" : "Upload photo"}
          <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => upload(e.target.files?.[0])} />
        </label>
      </div>
      <div style={{ flex: "1 1 260px" }}>
        <Mini label="Bio for heatwaveatx.com (shows when people hover her photo)"><Field value={c.bio || ""} onSave={v => saveCoach(c.id, { bio: v })} multiline minRows={3} placeholder="2-4 sentences: current role, where she played, what she's known for as a coach." /></Mini>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13, fontWeight: 700, color: c.show_on_site ? DS.lime : DS.mut, cursor: ready || c.show_on_site ? "pointer" : "default" }}
          title={ready ? "" : "Needs a photo, a bio and a title first"}>
          <input type="checkbox" checked={!!c.show_on_site} disabled={!ready && !c.show_on_site} onChange={e => saveCoach(c.id, { show_on_site: e.target.checked })} style={{ width: 18, height: 18, accentColor: DS.lime }} />
          Show on heatwaveatx.com {ready ? "" : "· add a photo, bio and title first"}
        </label>
        {err && <div style={{ color: DS.orange, fontSize: 12, fontWeight: 700, marginTop: 4 }}>{err}</div>}
      </div>
    </div>
  );
}
