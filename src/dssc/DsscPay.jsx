// DSSC Pay rates (Drew, 14 Oct 2026): the club's pay rules, editable.
//   1. Defaults - class $/hr (coaches clocking in to a class), staff $/hr
//      (general clock in/out).
//   2. Pods - which sports' pods pay by tier, and the tier table itself
//      (1-player base per 90 min, bonus per extra player, player cap).
//   3. People - per-person class and staff rates (blank = the default) and,
//      for volleyball coaches, their pod tier.
// Every shift in the app and in the accountant's report is priced from these
// through shared/dssc-pay.js. Drew + DSSC admins who see every department.

import { useState, useEffect, useMemo } from "react";
import { supabase } from "../supabase";
import { DS, Btn, Card, Label, Tag, inputStyle, nrm } from "./DsscHub.jsx";
import { mergePay, TIER_KEYS, podPay, personKey, rateRow } from "../../shared/dssc-pay.js";

const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numIn = { ...inputStyle, width: 90, textAlign: "right", padding: "7px 9px" };

export default function DsscPay({ coach, payData, rates = [], people = [], avail = [], checkins = [], reload }) {
  const me = coach?.display_name || coach?.email || "";
  const [form, setForm] = useState(() => mergePay(payData));
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => { setForm(mergePay(payData)); }, [payData]);
  const preview = mergePay(form);

  const saveSettings = async () => {
    setBusy("settings"); setSaved(null);
    const data = { classRate: Number(form.classRate), staffRate: form.staffRate === "" || form.staffRate == null ? null : Number(form.staffRate), podSports: form.podSports, tiers: Object.fromEntries(TIER_KEYS.map(k => [k, { label: form.tiers[k].label, base90: Number(form.tiers[k].base90), perPlayer90: Number(form.tiers[k].perPlayer90), capPlayers: Number(form.tiers[k].capPlayers) }])) };
    const { error } = await supabase.from("dssc_pay_settings").upsert({ id: 1, data, updated_by: me, updated_at: new Date().toISOString() }, { onConflict: "id" });
    setBusy(""); setSaved(error ? { err: error.message } : { ok: "Saved - every shift is priced with these from now on." });
    if (!error) reload && reload();
  };
  const setTier = (k, f, v) => setForm(x => ({ ...x, tiers: { ...x.tiers, [k]: { ...x.tiers[k], [f]: v } } }));

  // Everyone who is or has been paid by DSSC.
  const list = useMemo(() => {
    const m = new Map();
    const add = (name, email, kind) => { const k = personKey(name); if (!k) return; const cur = m.get(k) || { key: k, name: String(name).trim(), email: email || null, kinds: new Set() }; if (email && !cur.email) cur.email = email; cur.kinds.add(kind); m.set(k, cur); };
    for (const p of people) add(`${p.first_name} ${p.last_name || ""}`, p.email, p.role === "staff" ? "Staff" : p.role === "admin" ? "Admin" : (p.sports || []).includes("basketball") ? "Basketball" : "Coach");
    for (const a of avail) if (a.coach_name) add(a.coach_name, a.coach_email, "Volleyball");
    for (const c of checkins) if (c.coach_name) add(c.coach_name, c.coach_email, "Volleyball");
    for (const r of rates) add(r.person_name, r.email, "Has a rate");
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [people, avail, checkins, rates]);
  const shown = list.filter(p => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()));

  const saveRate = async (p, field, raw) => {
    const v = raw === "" ? null : Number(raw);
    if (v != null && !(v >= 0 && v < 500)) { setSaved({ err: "Enter an hourly rate between 0 and 500, or leave it blank for the default." }); return; }
    const cur = rateRow(rates, p.name, p.email);
    if ((cur?.[field] ?? null) === v) return;
    setBusy(p.key + field);
    const { error } = await supabase.from("dssc_pay_rates").upsert({ person_key: p.key, person_name: p.name, email: p.email, class_rate: cur?.class_rate ?? null, staff_rate: cur?.staff_rate ?? null, [field]: v, updated_by: me, updated_at: new Date().toISOString() }, { onConflict: "person_key" });
    setBusy(""); if (error) setSaved({ err: error.message }); else reload && reload();
  };
  const saveTierFor = async (p, tier) => {
    setBusy(p.key + "tier");
    const row = avail.find(a => nrm(a.coach_name) === p.key);
    const { error } = row
      ? await supabase.from("dssc_availability").update({ tier: tier || null, updated_at: new Date().toISOString() }).eq("coach_name", row.coach_name)
      : await supabase.from("dssc_availability").insert({ coach_name: p.name, coach_email: p.email, tier: tier || null, available: false, updated_at: new Date().toISOString() });
    setBusy(""); if (error) setSaved({ err: error.message }); else reload && reload();
  };

  return (
    <div style={{ margin: "-14px -18px", padding: "16px 16px 48px", background: DS.bg, minHeight: "calc(100vh - 56px)", fontFamily: DS.font, color: DS.text }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>Pay rates</div>
        <div style={{ fontSize: 13, color: DS.mut, marginBottom: 14 }}>How every DSSC shift is priced - in Time Cards, Staff Hours and the report to the accountant. Change a number here and the pay updates everywhere.</div>

        <Card accent={DS.lime}>
          <Label>Default hourly rates</Label>
          <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ fontSize: 14 }}>Coaching a class <input type="number" min="0" step="0.5" value={form.classRate ?? ""} onChange={e => setForm({ ...form, classRate: e.target.value })} style={{ ...numIn, marginLeft: 8 }} /> /hr</label>
            <label style={{ fontSize: 14 }}>Staff / general clock-in <input type="number" min="0" step="0.5" value={form.staffRate ?? ""} placeholder="not set" onChange={e => setForm({ ...form, staffRate: e.target.value })} style={{ ...numIn, marginLeft: 8 }} /> /hr</label>
          </div>
          <div style={{ fontSize: 12, color: DS.mut, marginTop: 8 }}>A person's own rate below overrides these. Staff with no rate show hours but no pay.</div>
        </Card>

        <Card>
          <Label>Pods - paid by coach tier and players</Label>
          <div style={{ fontSize: 13, color: DS.mut, lineHeight: 1.5, marginBottom: 10 }}>
            A pod pays the coach's tier per 90-minute session: the 1-player base, plus the bonus for each player after the first, up to the player cap (more players than that pay the same). Shorter or longer sessions pro-rate. A pod with no player count yet, or a coach with no tier, pays the hourly rate until it's set.
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: DS.mut }}>Pods paid this way:</span>
            {["volleyball", "basketball"].map(sp => (
              <label key={sp} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, cursor: "pointer" }}><input type="checkbox" checked={(form.podSports || []).includes(sp)} onChange={() => setForm(x => ({ ...x, podSports: (x.podSports || []).includes(sp) ? x.podSports.filter(s => s !== sp) : [...(x.podSports || []), sp] }))} /> {sp[0].toUpperCase() + sp.slice(1)} pods</label>
            ))}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
              <thead><tr style={{ color: DS.lime, fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", textAlign: "left" }}><th style={{ padding: 6 }}>Tier</th><th style={{ padding: 6 }}>1 player (base)</th><th style={{ padding: 6 }}>+ per extra player</th><th style={{ padding: 6 }}>Player cap</th><th style={{ padding: 6 }}>Full pod pays</th><th style={{ padding: 6 }}>Example: 4 players</th></tr></thead>
              <tbody>
                {TIER_KEYS.map(k => (
                  <tr key={k} style={{ borderTop: "1px solid " + DS.line }}>
                    <td style={{ padding: 6 }}><input value={form.tiers[k].label} onChange={e => setTier(k, "label", e.target.value)} style={{ ...inputStyle, width: 130, padding: "7px 9px" }} /></td>
                    <td style={{ padding: 6 }}>$<input type="number" min="0" value={form.tiers[k].base90} onChange={e => setTier(k, "base90", e.target.value)} style={numIn} /></td>
                    <td style={{ padding: 6 }}>$<input type="number" min="0" value={form.tiers[k].perPlayer90} onChange={e => setTier(k, "perPlayer90", e.target.value)} style={numIn} /></td>
                    <td style={{ padding: 6 }}><input type="number" min="1" max="20" value={form.tiers[k].capPlayers} onChange={e => setTier(k, "capPlayers", e.target.value)} style={{ ...numIn, width: 70 }} /></td>
                    <td style={{ padding: 6, fontWeight: 800 }}>{money(preview.tiers[k].cap90)}</td>
                    <td style={{ padding: 6, color: DS.mut }}>{money(podPay(preview, k, 4, 90))} / 90 min · {money(podPay(preview, k, 4, 60))} / 60 min</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "-4px 0 18px" }}>
          <Btn kind="primary" disabled={busy === "settings"} onClick={saveSettings}>{busy === "settings" ? "Saving…" : "Save rates & pod pay"}</Btn>
          {saved?.ok && <span style={{ color: DS.lime, fontWeight: 700, fontSize: 13 }}>{saved.ok}</span>}
          {saved?.err && <span style={{ color: DS.orange, fontWeight: 700, fontSize: 13 }}>{saved.err}</span>}
        </div>

        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <Label style={{ marginBottom: 0 }}>People</Label>
            <span style={{ fontSize: 12, color: DS.mut }}>Blank = the default. Saves when you leave the box.</span>
            <div style={{ flex: 1 }} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a person…" style={{ ...inputStyle, width: 200, padding: "7px 10px" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {shown.map(p => {
              const r = rateRow(rates, p.name, p.email), tier = (avail.find(a => nrm(a.coach_name) === p.key) || {}).tier || "";
              return (
                <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 11px", borderRadius: 10, background: DS.panel2, border: "1px solid " + DS.line }}>
                  <div style={{ flex: 1, minWidth: 170 }}><div style={{ fontSize: 14, fontWeight: 700 }}>{p.name}</div><div style={{ display: "flex", gap: 4, marginTop: 3, flexWrap: "wrap" }}>{[...p.kinds].filter(k => k !== "Has a rate").map(k => <Tag key={k} color={DS.mut}>{k}</Tag>)}</div></div>
                  <label style={{ fontSize: 12, color: DS.mut }}>Class $/hr <input key={"c" + (r?.class_rate ?? "")} type="number" min="0" step="0.5" defaultValue={r?.class_rate ?? ""} placeholder={String(preview.classRate)} onBlur={e => saveRate(p, "class_rate", e.target.value)} style={numIn} /></label>
                  <label style={{ fontSize: 12, color: DS.mut }}>Staff $/hr <input key={"s" + (r?.staff_rate ?? "")} type="number" min="0" step="0.5" defaultValue={r?.staff_rate ?? ""} placeholder={preview.staffRate == null ? "—" : String(preview.staffRate)} onBlur={e => saveRate(p, "staff_rate", e.target.value)} style={numIn} /></label>
                  <label style={{ fontSize: 12, color: DS.mut }}>Pod tier <select value={tier} onChange={e => saveTierFor(p, e.target.value)} style={{ ...inputStyle, width: 130, padding: "7px 8px" }}><option value="">— none —</option>{TIER_KEYS.map(k => <option key={k} value={k}>{preview.tiers[k].label}</option>)}</select></label>
                  {busy.startsWith(p.key) && <span style={{ fontSize: 12, color: DS.mut }}>saving…</span>}
                </div>
              );
            })}
            {!shown.length && <div style={{ fontSize: 13, color: DS.mut }}>Nobody matches.</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}
