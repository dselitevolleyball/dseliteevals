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

// Platforms that send on an event's behalf. Their From line is often the event
// name, so "2027 ATX Showcase" ends up looking like the vendor — the body is
// where the actual issuer is named ("...by SportWrench Inc").
const ISSUERS = [
  [/sportwrench/i, "SportWrench"],
  [/advanced ?event ?systems|\bAES\b/i, "Advanced Event Systems"],
  [/sportsengine/i, "SportsEngine"],
  [/usa ?volleyball|\bUSAV\b/i, "USA Volleyball"],
  [/\bAAU\b/i, "AAU"],
];

const vendorFrom = (from, subject, body = "") => {
  const f = String(from || "");
  // A display name that's really the event ("2027 ATX Showcase") is worse than
  // useless, so check the known issuers first.
  const hay = f + " " + String(subject || "") + " " + String(body).slice(0, 1200);
  const issuer = ISSUERS.find(([re]) => re.test(hay));
  if (issuer) return issuer[1];
  const disp = /^\s*"?([^"<]+?)"?\s*</.exec(f);
  if (disp && disp[1].trim() && !/^\d{4}\b/.test(disp[1].trim())) return disp[1].trim();
  const dom = /@([\w.-]+)/.exec(f);
  if (dom) return dom[1].replace(/^(mail|email|no-?reply|notifications?)\./i, "").replace(/\.(com|net|org|io|co)$/i, "");
  // Falling back to the subject gives every receipt from one sender the same
  // name, so say plainly that it's unknown instead.
  return "Unknown sender";
};

// Mail that discusses money without any having moved. A failure notice or an
// overdue reminder quotes the same figures a receipt does, so without this they
// book as real spend — and a chased invoice books once per chase. "Payment
// Failed for DS Elite Volleyball" alone produced nine rows worth $9,071.
const NOT_A_PAYMENT = /payment failed|failed payment|declined|past due|overdue|reminder:|action required|unable to process|will be charged|upcoming (?:payment|invoice)|statement (?:is )?ready|autopay|cancell?ed/i;

export function parseReceiptEmail({ from = "", subject = "", text = "", messageId = null, season = null } = {}) {
  const body = String(text || "").replace(/\r/g, "");
  const subj = String(subject || "");
  if (NOT_A_PAYMENT.test(subj)) {
    return { confidence: "none", kind: "not-a-payment", rows: [],
             reason: "no payment was made: " + subj.slice(0, 60) };
  }
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
        amount: p.amount, payment_method: reg.method, vendor: vendorFrom(from, subject, body),
        status: "pending", source: "email", message_id: messageId, email_subject: subject,
        notes: `Split from $${reg.total.toFixed(2)} across ${reg.teams.length} teams`,
      })),
      total: reg.total, event: reg.event,
    };
  }

  // Tier 2 — best effort. One row, flagged for review.
  const amount = findAmount(body);
  if (!amount) return { confidence: "none", kind: "unparsed", rows: [], reason: "no amount found" };
  const vendor = vendorFrom(from, subject, body);
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
