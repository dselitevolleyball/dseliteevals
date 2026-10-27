// A director's Gmail replies land on HQ inbox threads (api/site-inbox-sent-poll.js).
// Runs fileSent against a fake Sent folder and a fake database.
// Run: node scripts/test-inbox-sent.mjs
import { fakeSupabase } from "./lib/fake-supabase.mjs";
import { fileSent, sentAccounts } from "../api/site-inbox-sent-poll.js";

let bad = 0;
const check = (ok, msg) => { console.log((ok ? "PASS  " : "FAIL  ") + msg); if (!ok) bad++; };
const raw = ({ id, to, subject, body, inReplyTo }) => Buffer.from([
  "From: Jonathan DelaRosa <jonathan@drippingsportsclub.com>", "To: " + to, "Subject: " + subject,
  "Date: Mon, 26 Oct 2026 10:15:00 -0500", "Message-ID: " + id, ...(inReplyTo ? ["In-Reply-To: " + inReplyTo] : []),
  "Content-Type: text/plain; charset=utf-8", "", body].join("\r\n"));
const MAIL = [
  { uid: 1, id: "<a1@mail.gmail.com>", to: "mom@example.com", subject: "Re: Birthday party Nov 14", body: "Hi! Yes, 2-4pm works. Jonathan" },
  { uid: 2, id: "<a2@mail.gmail.com>", to: "friend@example.com", subject: "Lunch?", body: "Personal note" },
  { uid: 3, id: "<a3@mail.gmail.com>", to: "dad@work.com", subject: "Re: Court rental", body: "Court 5 is yours.", inReplyTo: "<fam-1@example.com>" },
  { uid: 4, id: "<already@resend.dev>", to: "mom@example.com", subject: "Re: Birthday party", body: "sent from HQ" },
];
const client = {
  async search() { return MAIL.map(m => m.uid); },
  async *fetch() { for (const m of MAIL) yield { uid: m.uid, envelope: { to: [{ address: m.to }], messageId: m.id, inReplyTo: m.inReplyTo || null } }; },
  async fetchOne(uid) { const m = MAIL.find(x => x.uid === uid); return { source: raw(m) }; },
};
const sb = fakeSupabase({
  site_inquiries: [
    { id: 10, email: "mom@example.com", status: "new", assigned_to: null, last_message_at: "2026-10-25T10:00:00Z", is_test: false },
    { id: 11, email: "parent@family.org", status: "waiting", assigned_to: "hunter@drippingsportsclub.com", last_message_at: "2026-10-20T10:00:00Z", is_test: false },
  ],
  site_inbox_messages: [
    { id: 1, inquiry_id: 11, direction: "in", message_id: "<fam-1@example.com>" },
    { id: 2, inquiry_id: 10, direction: "out", message_id: "<already@resend.dev>" },
  ],
});
const byEmail = new Map([["mom@example.com", { id: 10 }], ["parent@family.org", { id: 11 }]]);
const stats = { scanned: 0, filed: 0, duplicates: 0, items: [] };
await fileSent(sb, client, "jonathan@drippingsportsclub.com", byEmail, { since: new Date(0), dry: false, stats });

const msgs = (await sb.from("site_inbox_messages").select("*")).data;
const inqs = (await sb.from("site_inquiries").select("*")).data;
const t10 = inqs.find(q => q.id === 10), t11 = inqs.find(q => q.id === 11);
check(stats.filed === 2, "files the two replies to families with threads (filed " + stats.filed + ")");
check(!msgs.some(m => m.message_id === "<a2@mail.gmail.com>"), "leaves his personal mail alone");
check(stats.duplicates === 1, "skips the reply HQ already sent (same Message-ID)");
const m1 = msgs.find(m => m.message_id === "<a1@mail.gmail.com>");
check(m1 && m1.inquiry_id === 10 && m1.direction === "out" && /2-4pm/.test(m1.body_text) && m1.from_email === "jonathan@drippingsportsclub.com", "his Gmail reply shows on the thread, word for word, as his");
check(t10.status === "waiting" && t10.assigned_to === "jonathan@drippingsportsclub.com", "the New thread becomes Waiting on the family and is assigned to him");
const m3 = msgs.find(m => m.message_id === "<a3@mail.gmail.com>");
check(m3 && m3.inquiry_id === 11, "a reply to the family's own email finds its thread even from a different address");
check(t11.assigned_to === "hunter@drippingsportsclub.com" && t11.status === "waiting", "a thread someone else owns keeps its owner");

const stats2 = { scanned: 0, filed: 0, duplicates: 0, items: [] };
await fileSent(sb, client, "jonathan@drippingsportsclub.com", byEmail, { since: new Date(0), dry: false, stats: stats2 });
check(stats2.filed === 0 && stats2.duplicates === 3, "running again files nothing twice");

// A separate token per director; the old JSON list still counts, and the token wins for the same address.
const accts = sentAccounts({ DSSC_INBOX_PASS_JONATHAN: "aaaa", DSSC_INBOX_PASS_HUNTER: "bbbb", DSSC_INBOX_USER_HUNTER: "Hunter.X@gmail.com", DSSC_INBOX_PASS_EMPTY: " ",
  DSSC_INBOX_SENT_ACCOUNTS: JSON.stringify([{ user: "jonathan@drippingsportsclub.com", pass: "old" }, { user: "drew@drippingsportsclub.com", pass: "cccc" }]) });
const pw = Object.fromEntries(accts.map(a => [a.user, a.pass]));
check(accts.length === 3 && pw["jonathan@drippingsportsclub.com"] === "aaaa" && pw["hunter.x@gmail.com"] === "bbbb" && pw["drew@drippingsportsclub.com"] === "cccc", "one token per director, with an optional address, alongside the old list");

console.log(bad ? `\n${bad} failed` : "\nall inbox sent-mail checks passed");
process.exit(bad ? 1 : 0);
