// DSSC People -> Pulse: the club at a glance, and where the next dollar is.
//
//   the numbers     families, customers, revenue in 12 months, who can be texted / emailed, who answers
//   lifecycle       New · Active · Cooling · Lapsed · Lost · Prospects - click one to see them
//   products        open gym members, privates families, Reach members, renters, parties, camps, DS Elite
//   revenue ideas   shared/crm-ideas.js: a ready campaign each, with its audience and a rough $ -
//                   "Build campaign" opens it in Campaigns, "See them" in People
//   new lately      forms, emails to info@, text opt-ins and first-time customers in the last 14 days
import { useMemo } from "react";
import { DS, Btn, Card } from "./DsscHub.jsx";
import { STAGES, PRODUCT_FILTERS, hasProduct } from "../../shared/crm-profile.js";
import { EMPTY_SEGMENT } from "../../shared/crm-segments.js";

const money = (c) => "$" + Math.round((c || 0) / 100).toLocaleString();
const k$ = (d) => d >= 1000 ? "$" + (d / 1000).toFixed(d >= 10000 ? 0 : 1) + "K" : "$" + d;
const fmtD = (iso) => iso ? new Date(String(iso).slice(0, 10) + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
const name = (c) => ((c.first_name || "") + " " + (c.last_name || "")).trim() || c.email || c.phone || "Family";

export default function DsscCrmPulse({ index, ideas, loading, onPeople, onCampaign, onOpen }) {
  const s = useMemo(() => {
    if (!index) return null;
    const fams = [...index.fams.values()], P = fams.map(f => f.profile);
    const stage = Object.fromEntries(STAGES.map(([k]) => [k, P.filter(p => p.stage === k).length]));
    const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
    const recent = [];
    for (const f of fams) {
      const t = (f.profile.reached.last || "").slice(0, 10);
      if (t >= since) recent.push({ f, at: t, why: (index.ctx.touchesByContact.get(f.c.id) || [])[0]?.detail || "Wrote to us" });
      else if (f.profile.first && f.profile.first >= since && f.profile.first <= index.today) recent.push({ f, at: f.profile.first, why: "First sign-up" });
    }
    return {
      families: fams.length, customers: P.filter(p => p.customer).length,
      rev12: P.reduce((a, p) => a + (p.spend["12m"] || 0), 0),
      texts: P.filter(p => p.text.state === "ok").length, emails: P.filter(p => p.email.state === "ok").length,
      answers: P.filter(p => p.text.replies > 0).length, opens: P.filter(p => p.email.opens > 0).length,
      stage, products: PRODUCT_FILTERS.map(([k, l]) => [k, l, P.filter(p => hasProduct(p, k)).length]).filter(x => x[2] > 0),
      bdays: P.filter(p => p.birthdays.some(b => b.days <= 30)).length,
      recent: recent.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12),
    };
  }, [index]);
  if (loading || !s) return <Card><span style={{ color: DS.mut }}>Loading everyone the club knows…</span></Card>;
  const tile = (v, l, sub, onClick) => (
    <button onClick={onClick} disabled={!onClick} style={{ textAlign: "left", background: DS.panel, border: "1px solid " + DS.line, borderRadius: 14, padding: "12px 14px", cursor: onClick ? "pointer" : "default", color: DS.text, fontFamily: DS.font, minWidth: 0 }}>
      <div style={{ fontSize: 24, fontWeight: 900, lineHeight: 1.1 }}>{v}</div>
      <div style={{ fontSize: 12, fontWeight: 700, marginTop: 2 }}>{l}</div>
      {sub && <div style={{ fontSize: 11, color: DS.mut, marginTop: 2 }}>{sub}</div>}
    </button>
  );
  const total = STAGES.reduce((a, [k]) => a + (s.stage[k] || 0), 0) || 1;
  const potential = ideas.reduce((a, i) => a + i.est, 0);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        {tile(s.families.toLocaleString(), "Families", `${s.customers.toLocaleString()} have bought`)}
        {tile(money(s.rev12), "Spent in 12 months", s.customers ? `${money(s.rev12 / Math.max(1, (s.stage.new || 0) + (s.stage.active || 0) + (s.stage.cooling || 0)))} per recent family` : "")}
        {tile(s.texts.toLocaleString(), "Can be texted", `${s.answers.toLocaleString()} have answered a text`, () => onPeople({ ...EMPTY_SEGMENT, texts: "replies" }, "Families who answer texts"))}
        {tile(s.emails.toLocaleString(), "Can be emailed", s.opens ? `${s.opens.toLocaleString()} have opened one` : "opens show once marketing emails go out")}
        {tile(s.bdays.toLocaleString(), "Birthdays in 30 days", "a kid's birthday coming up", () => onPeople({ ...EMPTY_SEGMENT, birthdayDays: "30" }, "A kid's birthday in the next 30 days"))}
        {tile(k$(potential), "In the ideas below", "rough revenue if every idea ran")}
      </div>

      <Card>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: DS.mut, marginBottom: 8 }}>Where every family is</div>
        <div style={{ display: "flex", height: 34, borderRadius: 10, overflow: "hidden", border: "1px solid " + DS.line }}>
          {STAGES.map(([k, l, d, color]) => s.stage[k] ? <button key={k} title={`${l}: ${s.stage[k]} - ${d}`} onClick={() => onPeople({ ...EMPTY_SEGMENT, stages: [k] }, `${l}: ${d}`)} style={{ flex: s.stage[k] / total, background: color, border: "none", cursor: "pointer", minWidth: 6, color: "#061a18", fontFamily: DS.font, fontWeight: 900, fontSize: 12, overflow: "hidden", whiteSpace: "nowrap" }}>{s.stage[k] / total > 0.06 ? s.stage[k] : ""}</button> : null)}
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8 }}>
          {STAGES.map(([k, l, d, color]) => <button key={k} onClick={() => onPeople({ ...EMPTY_SEGMENT, stages: [k] }, `${l}: ${d}`)} title={d} style={{ background: "none", border: "none", color: DS.text, fontFamily: DS.font, fontSize: 12.5, cursor: "pointer", padding: 0, display: "inline-flex", gap: 6, alignItems: "center" }}><span style={{ width: 10, height: 10, borderRadius: 3, background: color }} />{l} <b>{(s.stage[k] || 0).toLocaleString()}</b></button>)}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
          {s.products.map(([k, l, n]) => <button key={k} onClick={() => onPeople({ ...EMPTY_SEGMENT, products: [k] }, l)} style={{ fontFamily: DS.font, fontSize: 12.5, fontWeight: 700, padding: "5px 11px", borderRadius: 999, cursor: "pointer", border: "1px solid " + DS.lineStrong, background: "transparent", color: DS.text }}>{l} <span style={{ color: DS.lime, fontWeight: 900 }}>{n}</span></button>)}
        </div>
      </Card>

      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "4px 0 8px", flexWrap: "wrap" }}>
          <div style={{ fontSize: 18, fontWeight: 900 }}>💡 Revenue ideas</div>
          <div style={{ fontSize: 12, color: DS.mut }}>Ready-made campaigns from your own data. The $ is families you can reach × a conservative take-up × your typical price; it ranks the ideas, it doesn't promise them.</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(300px, 100%), 1fr))", gap: 10 }}>
          {ideas.map(i => (
            <div key={i.key} style={{ background: DS.panel, border: "1px solid " + DS.line, borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div style={{ fontSize: 22 }}>{i.emoji}</div>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 900, fontSize: 15, lineHeight: 1.2 }}>{i.title}</div><div style={{ fontSize: 11.5, color: DS.mut, marginTop: 2 }}>{i.why}</div></div>
                <div style={{ textAlign: "right" }}><div style={{ fontSize: 18, fontWeight: 900, color: DS.lime }}>~{k$(i.est)}</div><div style={{ fontSize: 10, color: DS.mut }}>{Math.round(i.conv * 100)}% take-up</div></div>
              </div>
              <div style={{ fontSize: 13, color: DS.text, lineHeight: 1.45 }}>{i.pitch}</div>
              <div style={{ fontSize: 12.5, color: DS.lime, fontWeight: 700 }}>Offer: {i.offer_text || "an invitation"}</div>
              <div style={{ display: "flex", gap: 8, marginTop: "auto", paddingTop: 4 }}>
                <Btn small kind="primary" onClick={() => onCampaign({ idea: i })}>Build campaign</Btn>
                <Btn small onClick={() => onPeople(i.segment, i.title)}>See the {i.families.toLocaleString()}</Btn>
              </div>
            </div>
          ))}
          {!ideas.length && <Card><span style={{ color: DS.mut }}>No ideas yet - they appear once People has families with history.</span></Card>}
        </div>
      </div>

      <Card>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: DS.mut, marginBottom: 8 }}>New lately · last 14 days</div>
        {s.recent.length ? s.recent.map(({ f, at, why }) => (
          <div key={f.c.id} onClick={() => onOpen(f.c.id)} style={{ display: "flex", gap: 10, padding: "6px 0", borderBottom: "1px solid " + DS.line, cursor: "pointer", fontSize: 13 }}>
            <span style={{ color: DS.mut, minWidth: 54 }}>{fmtD(at)}</span><b style={{ minWidth: 150 }}>{name(f.c)}</b><span style={{ color: DS.mut, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{why}</span>
          </div>)) : <div style={{ fontSize: 13, color: DS.mut }}>Nobody new in the last two weeks. Website forms, emails to info@ and text opt-ins land here automatically.</div>}
      </Card>
    </div>
  );
}
