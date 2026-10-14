// DSSC pay - ONE set of rules for the app and for payroll (Drew, 14 Oct 2026).
// The app (Time Cards, Staff Hours, Pay rates screen) and the accountant's
// report (api/dssc-payroll-report.js) both price a shift through here, so a
// shift can never have two answers.
//
//   class clock-in (dssc_checkins)  -> pod pay if it's a pod in a pod-paying
//                                      sport and the coach has a tier and the
//                                      pod was counted; otherwise hours x the
//                                      coach's class rate (or the default).
//   staff shift (dssc_staff_shifts) -> hours x the person's staff rate (or the
//                                      default staff rate). No rate = unpriced.
//
// Settings live in dssc_pay_settings.data (editable on the Pay rates screen);
// per-person rates in dssc_pay_rates; a coach's pod tier on dssc_availability.

export const DEFAULT_PAY = {
  classRate: 25,          // $/hr for class clock-ins
  staffRate: null,        // $/hr for general staff shifts (set it on the Pay rates screen)
  podSports: ["volleyball"],
  // Pods pay per 90-minute session: base (1 player) + perPlayer for each
  // player after the first, up to capPlayers; shorter/longer sessions pro-rate.
  tiers: {
    competitive: { label: "Competitive", base90: 50, perPlayer90: 10, capPlayers: 6 },
    elite:       { label: "Elite",       base90: 70, perPlayer90: 10, capPlayers: 6 },
    master:      { label: "Master",      base90: 85, perPlayer90: 15, capPlayers: 6 },
  },
};
export const TIER_KEYS = ["competitive", "elite", "master"];

const num = (v, d) => (v === "" || v == null || !isFinite(Number(v)) ? d : Number(v));
export const personKey = (s) => String(s || "").trim().toLowerCase().replace(/^coach\s+/, "").replace(/\s+/g, " ");

// Stored settings over the defaults, every number checked.
export function mergePay(data) {
  const d = data && typeof data === "object" ? data : {};
  const tiers = {};
  for (const k of TIER_KEYS) {
    const t = { ...DEFAULT_PAY.tiers[k], ...((d.tiers || {})[k] || {}) };
    tiers[k] = { label: String(t.label || DEFAULT_PAY.tiers[k].label), base90: num(t.base90, DEFAULT_PAY.tiers[k].base90), perPlayer90: num(t.perPlayer90, DEFAULT_PAY.tiers[k].perPlayer90), capPlayers: Math.max(1, Math.round(num(t.capPlayers, DEFAULT_PAY.tiers[k].capPlayers))) };
    tiers[k].cap90 = tiers[k].base90 + tiers[k].perPlayer90 * (tiers[k].capPlayers - 1);
  }
  return {
    classRate: num(d.classRate, DEFAULT_PAY.classRate),
    staffRate: num(d.staffRate, DEFAULT_PAY.staffRate),
    podSports: Array.isArray(d.podSports) ? d.podSports : DEFAULT_PAY.podSports,
    tiers,
  };
}

export const isPodClinic = (pay, clinic) =>
  /pod/i.test(String(clinic?.category || "") + " " + String(clinic?.name || "")) && (pay?.podSports || DEFAULT_PAY.podSports).includes(clinic?.sport || "volleyball");

export function podPay(pay, tierKey, players, minutes) {
  const t = (pay?.tiers || {})[tierKey];
  if (!t) return null;
  const n = Math.min(t.capPlayers, Math.max(1, Math.floor(Number(players) || 1)));
  const per90 = t.base90 + t.perPlayer90 * (n - 1);
  return Math.round(per90 * (Math.max(0, Number(minutes) || 90) / 90) * 100) / 100;
}

// rates: array of dssc_pay_rates rows. Matched on name, then email.
export function rateRow(rates, name, email) {
  const k = personKey(name), e = String(email || "").trim().toLowerCase();
  return (rates || []).find(r => r.person_key === k) || (e ? (rates || []).find(r => String(r.email || "").toLowerCase() === e) : null) || null;
}
export const classRateFor = (pay, rates, name, email) => num(rateRow(rates, name, email)?.class_rate, pay.classRate);
export const staffRateFor = (pay, rates, name, email) => num(rateRow(rates, name, email)?.staff_rate, pay.staffRate);

// One class clock-in. clinic: its dssc_clinics row; players: pod attendance
// count (null = not counted); tier: the coach's pod tier key.
export function classShiftPay({ pay, rates, checkin, clinic, players, tier }) {
  const h = Number(checkin?.hours || 0);
  const rate = classRateFor(pay, rates, checkin?.coach_name, checkin?.coach_email);
  const flat = { amount: Math.round(h * rate * 100) / 100, kind: "hourly", rate, basis: `$${rate}/hr` };
  if (!clinic || !isPodClinic(pay, clinic)) return flat;
  if (players == null) return { ...flat, kind: "uncounted", basis: "pod - not counted, hourly" };
  const amount = podPay(pay, tier, players, h * 60);
  if (amount == null) return { ...flat, kind: "untiered", basis: "pod - no tier, hourly" };
  const n = Math.min(pay.tiers[tier].capPlayers, Math.max(1, Math.floor(Number(players) || 1)));
  return { amount, kind: "pod", tier, players: n, basis: `${pay.tiers[tier].label} pod · ${n}p` };
}

export const staffShiftHours = (s, now = Date.now()) => {
  if (!s?.clock_in) return 0;
  const end = s.clock_out ? new Date(s.clock_out).getTime() : now;
  return Math.max(0, Math.round(((end - new Date(s.clock_in).getTime()) / 3600000) * 4) / 4);
};
// One staff shift. amount null = this person has no rate yet.
export function staffShiftPay({ pay, rates, shift, now }) {
  const hours = staffShiftHours(shift, now);
  const rate = staffRateFor(pay, rates, shift?.person_name, shift?.person_email);
  return { hours, rate, amount: rate == null ? null : Math.round(hours * rate * 100) / 100 };
}
