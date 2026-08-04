// Turn an arbitrary receipt email into one or more draft expense rows.
//
// Two tiers, deliberately. A SportWrench/AES registration has a stated team
// list and total, so it splits per team with confidence "high". Everything else
// — hotels, airlines, Amazon, Custom Ink — gets a best-effort vendor, amount and
// date at confidence "low". Both land as status='pending'; the difference is how
// much reviewing the weekly digest actually needs.
//
// Guessing a category from the vendor is a convenience, never a commitment:
// every field is editable before approval.

import { parseRegistrationEmail } from "./registration-parse.js";
import { seasonForDate } from "./season.js";

// vendor pattern -> [category, allocation]. First match wins.
const VENDOR_RULES = [
  [/sportwrench|advanced ?event|aes|usa ?volleyball|usav|\bAAU\b/i,        "Tournament",     null],
  [/marriott|hilton|hyatt|holiday inn|hampton|courtyard|residence inn|airbnb|booking\.com|expedia/i, "Travel", null],
  [/southwest|american airlines|delta|united airlines|alaska air|jetblue|spirit air/i, "Travel", null],
  [/custom ?ink|sticker ?mule|branded ?bills|ren athletics/i,              "Uniforms",       null],
  [/hudl/i,                                                                "Hudl",           "All Teams"],
  [/game ?changer/i,                                                       "Game Changer",   null],
  [/intuit|quickbooks|hercules|google ?workspace|gworkspace|godaddy/i,      "G&A",            "Software"],
  [/volleyballusa|amazon|target|dick'?s sporting/i,                        "S&C",            "Equipment and Supplies"],
  [/insurance|watkins/i,                                                   "G&A",            "Insurance"],
];

const money = (s) => {
  const n = Number(String(s || "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

// Largest currency figure near a total-ish label, else the largest overall.
// Receipts list line items and tax; the total is almost always the biggest.
//
// The (?<![\d.,]) guard is load-bearing. Without it the gap-matcher between the
// label and the number backtracks INTO the number and returns its tail —
// $4,377.24 came back as $7.24, which looks like a plausible small charge and
// would never be caught by eye in a list. The guard means a match can only
// begin at a real number boundary.
const NUM = String.raw`(?<![\d.,])([\d,]+\.\d{2})(?![\d])`;
function findAmount(body) {
  const labelled = [];
  const re = new RegExp(
    String.raw`(total amount|amount (?:paid|charged|due)|order total|grand total|total|charged|payment)\s*:?\s*\$?\s*` + NUM,
    "gi");
  let m;
  while ((m = re.exec(body))) { const v = money(m[2]); if (v) labelled.push(v); }
  if (labelled.length) return Math.max(...labelled);
  const all = [...body.matchAll(new RegExp(String.raw`\$\s*` + NUM, "g"))].map(x => money(x[1])).filter(Boolean);
  return all.length ? Math.max(...all) : null;
}

function findDate(body) {
  const m1 = /([A-Za-z]{3,9})\s+(\d{1,2}),?\s*(\d{4})/.exec(body);
  if (m1) {
    const mo = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(m1[1].slice(0,3).toLowerCase());
    if (mo >= 0) return `${m1[3]}-${String(mo+1).padStart(2,"0")}-${String(+m1[2]).padStart(2,"0")}`;
  }
  const m2 = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/.exec(body);
  if (m2) {
    let y = +m2[3]; if (y < 100) y += 2000;
    return `${y}-${String(+m2[1]).padStart(2,"0")}-${String(+m2[2]).padStart(2,"0")}`;
  }
  return null;
}

const vendorFrom = (from, subject) => {
  const disp = /^\s*"?([^"<]+?)"?\s*</.exec(String(from || ""));
  if (disp && disp[1].trim()) return disp[1].trim();
  const dom = /@([\w.-]+)/.exec(String(from || ""));
  if (dom) return dom[1].replace(/\.(com|net|org|io|co)$/i, "");
  return String(subject || "").slice(0, 40) || "Unknown";
};

export function parseReceiptEmail({ from = "", subject = "", text = "", messageId = null, season = null } = {}) {
  const body = String(text || "").replace(/\r/g, "");
  // The season comes from the receipt's own date. This used to default to the
  // literal "2026-27", which would have quietly mislabelled everything captured
  // after 31 July 2027 and shown up only as a season total that looked wrong.
  const seasonOf = (d) => season || seasonForDate(d) || seasonForDate(new Date().toISOString().slice(0, 10));

  // Tier 1 — a registration with a stated team list splits exactly.
  const reg = parseRegistrationEmail(body);
  if (reg.ok && reg.teams.length) {
    return {
      confidence: "high",
      kind: "registration",
      rows: reg.perTeam.map(p => ({
        season: seasonOf(reg.paidDate || findDate(body)), category: "Tournament", allocation: p.team, team_name: null,
        item: reg.event + " registration", expense_date: reg.paidDate || findDate(body),
        amount: p.amount, payment_method: reg.method, vendor: vendorFrom(from, subject),
        status: "pending", source: "email", message_id: messageId, email_subject: subject,
        notes: `Split from $${reg.total.toFixed(2)} across ${reg.teams.length} teams`,
      })),
      total: reg.total, event: reg.event,
    };
  }

  // Tier 2 — best effort. One row, flagged for review.
  const amount = findAmount(body);
  if (!amount) return { confidence: "none", kind: "unparsed", rows: [], reason: "no amount found" };
  const vendor = vendorFrom(from, subject);
  const hay = vendor + " " + subject + " " + body.slice(0, 400);
  const rule = VENDOR_RULES.find(([re]) => re.test(hay));
  return {
    confidence: "low",
    kind: "receipt",
    total: amount,
    rows: [{
      season: seasonOf(findDate(body)), category: rule ? rule[1] : "Club Expenses", allocation: rule ? rule[2] : null, team_name: null,
      item: String(subject || "Receipt").slice(0, 120), expense_date: findDate(body),
      amount, payment_method: null, vendor,
      status: "pending", source: "email", message_id: messageId, email_subject: subject,
      notes: rule ? null : "Category guessed — no vendor rule matched",
    }],
  };
}
