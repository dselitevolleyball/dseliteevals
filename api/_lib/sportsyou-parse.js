// Shared SportsYou email-parsing helpers, used by both the inbound webhook
// (api/sportsyou-inbox.js) and the IMAP poller (api/sportsyou-poll.js).
//
// Folder name is _lib so Vercel does not treat it as a routable function.

import crypto from "node:crypto";

export const extractAddress = (from) => {
  if (!from) return "";
  if (typeof from === "object") return String(from.address || from.email || "").trim().toLowerCase();
  const m = String(from).match(/<([^>]+)>/);
  return (m ? m[1] : String(from)).trim().toLowerCase();
};

// headers can arrive as an array [{name,value}], an object {name:value}, or a
// Map (mailparser). Returns "" when absent.
export const headerValue = (headers, name) => {
  if (!headers) return "";
  const want = name.toLowerCase();
  if (typeof headers.get === "function") { // Map (mailparser headers)
    const v = headers.get(want) ?? headers.get(name);
    return v == null ? "" : String(v.value || v);
  }
  if (Array.isArray(headers)) {
    const h = headers.find(x => String(x.name || x.key || "").toLowerCase() === want);
    return h ? String(h.value || "") : "";
  }
  if (typeof headers === "object") {
    for (const k of Object.keys(headers)) if (k.toLowerCase() === want) return String(headers[k] || "");
  }
  return "";
};

export const stripHtml = (html) => String(html || "")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
  .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

// Gmail auto-forward wraps the original in a header block. Pull the embedded
// From/Subject/Date if present, and return the body with the wrapper removed.
export const unwrapForward = (text) => {
  const out = { from: "", subject: "", date: "", body: text || "" };
  if (!text) return out;
  const marker = text.search(/-{3,}\s*Forwarded message\s*-{3,}/i);
  if (marker === -1) return out;
  const after = text.slice(marker);
  const from = after.match(/^\s*From:\s*(.+)$/im);
  const subj = after.match(/^\s*Subject:\s*(.+)$/im);
  const date = after.match(/^\s*Date:\s*(.+)$/im);
  if (from) out.from = from[1].trim();
  if (subj) out.subject = subj[1].trim();
  if (date) out.date = date[1].trim();
  const toLine = after.match(/^\s*To:\s*.+$/im);
  if (toLine) {
    const idx = after.indexOf(toLine[0]) + toLine[0].length;
    out.body = after.slice(idx).trim();
  }
  return out;
};

// SportsYou subjects read "<Full Name> posted in DS Elite <Team>" — the most
// reliable author signal. Fall back to body patterns otherwise.
export const parseAuthor = (subject, body = "") => {
  const subj = String(subject || "");
  const m = subj.match(/^(.+?)\s+posted in\b/i);
  if (m) return m[1].trim();
  const hay = subj + "\n" + String(body || "");
  const NAME = "([A-Z][A-Za-z.'-]+(?:\\s+[A-Z][A-Za-z.'-]+){0,2})";
  const pats = [
    new RegExp("\\bposted by\\s+" + NAME),
    new RegExp("(?:^|\\n)\\s*(?:Coach\\s+)?" + NAME + "\\s+posted\\b", "m"),
  ];
  for (const re of pats) { const mm = hay.match(re); if (mm) return mm[1].trim(); }
  return null;
};

// DS Elite club admins sit on every team; anyone else posting is a team coach.
export const DS_ELITE_ADMINS = ["drew rose", "tionne graves-brown", "kristen alexandrov"];
const normPerson = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
export const roleForAuthor = (author) =>
  !author ? null : (DS_ELITE_ADMINS.includes(normPerson(author)) ? "admin" : "coach");

// SportsYou also emails team invitations / system notices — not coach posts.
export const isInvitationEmail = (subject, body) => {
  const t = (String(subject || "") + " " + String(body || "")).toLowerCase();
  return /has invited you to|team invitation|accept invitation/.test(t);
};

// Match the message against the club's real team names. Longest match wins
// (so "14 Diamond" beats a stray "14"). Doubles as name normalization.
export const matchTeam = (haystack, teamNames) => {
  const hay = " " + haystack.toLowerCase() + " ";
  let best = null;
  for (const name of (teamNames || [])) {
    const n = String(name || "").trim();
    if (!n) continue;
    if (hay.includes(n.toLowerCase())) {
      if (!best || n.length > best.length) best = n;
    }
  }
  return best;
};

export const parseDate = (s) => {
  if (!s) return null;
  const t = Date.parse(s instanceof Date ? s.toISOString() : s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

// Turn a raw email-ish object into a normalized sportsyou_posts row (minus
// raw_email / insert bookkeeping). Accepts fields from Resend Inbound JSON,
// a generic webhook body, or mailparser output.
export function parseSportsYouEmail(input, teamNames) {
  const { from, subject, text, html, headers, date, messageId } = input || {};
  const rawText = String(text || (html ? stripHtml(html) : "") || "");
  const fwd = unwrapForward(rawText);

  const fromEmail = extractAddress(fwd.from || from);
  const subj = String(subject || fwd.subject || "").trim();
  const cleanBody = (fwd.body || rawText).trim();

  const postedAt =
    parseDate(headerValue(headers, "Date")) ||
    parseDate(date) ||
    parseDate(fwd.date) ||
    null;

  let mid = headerValue(headers, "Message-ID") || String(messageId || "").trim();
  if (!mid) {
    mid = "syh-" + crypto.createHash("sha256")
      .update(fromEmail + "|" + subj + "|" + cleanBody.slice(0, 500) + "|" + (postedAt || ""))
      .digest("hex").slice(0, 40);
  }

  const haystack = subj + "\n" + cleanBody;
  const team = matchTeam(haystack, teamNames);
  const author = parseAuthor(subj, cleanBody);

  return {
    fromEmail,
    subject: subj,
    body: cleanBody,
    postedAt,                 // may be null — caller defaults to received time
    messageId: mid,
    team,                     // null if unmatched
    author,
    authorRole: roleForAuthor(author),        // 'admin' | 'coach' | null
    isInvitation: isInvitationEmail(subj, cleanBody),
  };
}
