// Offline checks for follow-ups on a question form (api/questions-form.js):
// Drew replies under answers on his copy (?r=), sends them, the person answers
// just those from their link (?t=), and back again - with the Tasks card and
// the Slack messages. Fake database, Slack stubbed.
//
//   node scripts/test-question-followups.mjs

import { fakeSupabase } from "./fake-supabase.mjs";
const { runQuestionsForm } = await import("../api/questions-form.js");

let failed = 0;
const check = (ok, label) => { console.log((ok ? "PASS  " : "FAIL  ") + label); if (!ok) failed++; };

const slack = [];
globalThis.fetch = async (url, opts = {}) => {
  const raw = String(opts.body || "");
  const body = raw.startsWith("{") ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
  const m = String(url).split("/").pop();
  if (m === "users.lookupByEmail") return { json: async () => ({ ok: true, user: { id: "U-" + body.email } }) };
  if (m === "conversations.open") return { json: async () => ({ ok: true, channel: { id: "D-" + body.users } }) };
  if (m === "chat.postMessage") { slack.push(body); return { json: async () => ({ ok: true, ts: "1" }) }; }
  return { json: async () => ({ ok: true }) };
};

const T = "11111111-1111-4111-8111-111111111111", R = "22222222-2222-4222-8222-222222222222";
const questions = [
  { id: "a", section: "October", title: "Why $500?", ask: "Explain the $500.", context: ["ctx"] },
  { id: "b", section: "October", title: "What is in $149K?", ask: "Break it down." },
  { id: "c", section: "Overhead", title: "Rent in March?", ask: "What changed?" },
];
const sb = fakeSupabase({
  question_forms: [{ id: 1, token: T, results_token: R, brand: "dssc", title: "Questions on the financial reports", recipient_name: "Deroald Hopkins", recipient_email: "deroald@drippingsportsclub.com", notify_email: "drew@drippingsportsclub.com",
    questions, answers: { a: { text: "Cash vs accrual." }, b: { text: "Wages <b>and</b> rent." }, c: { text: "New lease." } }, status: "sent", task_id: 55, replies: {}, drafts: {}, followup: null, followup_round: 0 }],
  dssc_project_tasks: [{ id: 55, project_id: null, title: "Answer Drew's 3 questions", status: "done", category: "Finance & admin", departments: ["Admin"] }],
  dssc_project_updates: [], hq_kv: [{ key: "product_slack", value: { bot_token: "xoxb-test" } }], dssc_project_settings: [{ id: 1, slack_ids: {} }],
});
const form = () => sb.db.question_forms[0];

async function call(query, method = "GET", body) {
  let code = 200, out = null;
  const res = { status(c) { code = c; return res; }, send(x) { out = x; return res; }, json(x) { out = x; return res; }, setHeader() {} };
  await runQuestionsForm(sb, { method, query, body }, res);
  return { code, out };
}

// Before the answers are in: Drew can't reply yet.
let r = await call({ r: R });
check(r.code === 200 && !/<textarea/.test(r.out) && /Not opened yet|In progress/.test(r.out), "before the answers are sent, Drew's copy is read-only");
r = await call({ r: R }, "POST", { action: "draft", id: "a", text: "x" });
check(r.code === 409, "…and replying is refused");

form().status = "completed"; form().completed_at = new Date().toISOString();
r = await call({ r: R });
check(r.code === 200 && (r.out.match(/<textarea class="reply"/g) || []).length === 3 && /Reply to Deroald/.test(r.out), "once they're in: a reply box under each of the 3 answers");
check(r.out.includes("Wages &lt;b&gt;and&lt;/b&gt; rent.") && !r.out.includes("<b>and</b>"), "his answers are escaped");

r = await call({ r: R }, "POST", { action: "send" });
check(r.code === 400, "Send with nothing written is refused");
await call({ r: R }, "POST", { action: "draft", id: "a", text: "So which basis for October?" });
await call({ r: R }, "POST", { action: "draft", id: "c", text: "Is the new lease in the budget?" });
await call({ r: R }, "POST", { action: "draft", id: "c", text: "Is the new lease in the 2027 budget?" });
await call({ r: R }, "POST", { action: "draft", id: "b", text: "   " });
check(JSON.stringify(form().drafts.asker) === JSON.stringify({ a: "So which basis for October?", c: "Is the new lease in the 2027 budget?" }), "replies save as drafts; a blank one is dropped");
r = await call({ r: R });
check(r.out.includes(">So which basis for October?</textarea>"), "a saved reply is back in its box on reload");
r = await call({ r: R }, "POST", { action: "draft", id: "zzz", text: "x" });
check(r.code === 400, "an unknown question is refused");

slack.length = 0;
r = await call({ r: R }, "POST", { action: "send" });
check(r.code === 200 && r.out.sent === 2, "Send: 2 replies sent");
check(form().followup === "waiting" && form().followup_round === 1 && form().replies.a.length === 1 && form().replies.a[0].by === "asker" && !form().replies.b && Object.keys(form().drafts.asker).length === 0, "the replies move into the thread and the drafts clear");
const task = sb.db.dssc_project_tasks.find(t => t.id === form().followup_task_id);
check(task && task.status === "todo" && task.assignee_email === "deroald@drippingsportsclub.com" && task.title === "Answer Drew's 2 follow-ups on the financial reports" && task.link_url.endsWith("?t=" + T) && task.category === "Finance & admin" && task.due_date, `a Tasks card for Deroald (${task?.title}, due ${task?.due_date})`);
check(slack.length === 1 && slack[0].channel === "D-U-deroald@drippingsportsclub.com" && /replied to 2 of them/.test(slack[0].text) && slack[0].text.includes("?t=" + T), "Deroald gets a Slack DM with his link");

r = await call({ r: R });
check(!/<textarea/.test(r.out) && /Waiting on Deroald/.test(r.out) && /You sent 2 follow-ups/.test(r.out), "while it's with him, Drew's copy says so and has no reply boxes");
r = await call({ r: R }, "POST", { action: "draft", id: "b", text: "more" });
check(r.code === 409, "…and Drew can't add more until he answers");

// Deroald's side.
r = await call({ t: T });
const data = JSON.parse(r.out.match(/const D = (.*);\n/)[1]);
check(data.mode === "followup" && data.questions.map(q => q.id).join() === "a,c" && data.questions[0].answer === "Cash vs accrual." && data.questions[1].comment === "Is the new lease in the 2027 budget?", "his link asks just the 2 follow-ups, with his answer and Drew's reply");
r = await call({ t: T }, "POST", { action: "save", id: "a", text: "x" });
check(r.code === 400, "the old answer form's save is refused during follow-ups");
r = await call({ t: T }, "POST", { action: "reply_save", id: "b", text: "x" });
check(r.code === 400, "a question Drew didn't reply to can't be answered");
await call({ t: T }, "POST", { action: "reply_save", id: "a", text: "Accrual, from QBO." });
r = await call({ t: T }, "POST", { action: "reply_submit" });
check(r.code === 400 && /Follow-up 2 still needs/.test(r.out.error), "sending with one unanswered is refused");
await call({ t: T }, "POST", { action: "reply_save", id: "c", text: "Yes, line 6100." });
slack.length = 0;
r = await call({ t: T }, "POST", { action: "reply_submit" });
check(r.code === 200 && form().followup === "answered" && form().replies.c.map(m => m.by).join() === "asker,recipient" && Object.keys(form().drafts.recipient).length === 0, "his replies go into the thread; back to Drew");
check(sb.db.dssc_project_tasks.find(t => t.id === form().followup_task_id).status === "done" && sb.db.dssc_project_updates.some(u => u.task_id === form().followup_task_id && /replies sent to Drew/.test(u.body)), "the Tasks card is marked done");
check(slack.length === 1 && slack[0].channel === "D-U-drew@drippingsportsclub.com" && slack[0].text.includes("?r=" + R) && /2 follow-ups/.test(slack[0].text), "Drew gets a Slack DM with his copy's link");

r = await call({ t: T });
check(/Sent to Drew ✓/.test(r.out) && r.out.includes("Yes, line 6100."), "his link shows everything, back-and-forth included");
r = await call({ r: R });
check((r.out.match(/<textarea class="reply"/g) || []).length === 3 && r.out.includes("Accrual, from QBO.") && /answered your follow-ups/.test(r.out), "Drew's copy shows the thread, with reply boxes again for round 2");

// Round 2.
await call({ r: R }, "POST", { action: "draft", id: "c", text: "Great, thanks." });
r = await call({ r: R }, "POST", { action: "send" });
check(r.code === 200 && form().followup_round === 2 && form().replies.c.length === 3, "round 2 works the same way");
r = await call({ t: T });
const d2 = JSON.parse(r.out.match(/const D = (.*);\n/)[1]);
check(d2.questions.length === 1 && d2.questions[0].earlier.map(m => m.who).join() === "Drew,You" && d2.questions[0].comment === "Great, thanks.", "…his link shows the earlier back-and-forth above Drew's new reply");

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
