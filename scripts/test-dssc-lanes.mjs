// Tests for the DSSC texting lanes (shared/dssc-lanes.js, api/_lib/sms.js):
// which lane a text goes in, and which conversation a reply lands in.
// Run: node scripts/test-dssc-lanes.mjs
import assert from "node:assert/strict";
import { laneOfPerson, laneOfText, homeLaneFor } from "../shared/dssc-lanes.js";
import { laneFor, replyThreadFor } from "../api/_lib/sms.js";

// A tiny stand-in for the Supabase query builder: filters rows by eq/in and
// answers maybeSingle / limit / await.
function fakeDb(tables) {
  return {
    from(name) {
      let rows = [...(tables[name] || [])], lim = Infinity, desc = false;
      const q = {
        select() { return q; },
        eq(k, v) { rows = rows.filter(r => r[k] === v); return q; },
        in(k, vs) { rows = rows.filter(r => vs.includes(r[k])); return q; },
        order(k, o) { desc = o?.ascending === false; rows.sort((a, b) => (a[k] > b[k] ? 1 : -1) * (desc ? -1 : 1)); return q; },
        limit(n) { lim = n; return q; },
        maybeSingle() { return Promise.resolve({ data: rows[0] || null, error: null }); },
        then(ok) { return Promise.resolve({ data: rows.slice(0, lim), error: null }).then(ok); },
      };
      return q;
    },
  };
}

// People
assert.equal(laneOfPerson({ email: "Hunter@DrippingSportsClub.com" }), "volleyball");
assert.equal(laneOfPerson({ email: "adrian@drippingsportsclub.com" }), "basketball");
assert.equal(laneOfPerson({ email: "brandon@drippingsportsclub.com" }), "reach");
assert.equal(laneOfPerson({ email: "jonathan@drippingsportsclub.com", sports: ["basketball", "volleyball"] }), "general");
assert.equal(laneOfPerson({ email: "coach@x.com", sports: ["basketball"] }), "basketball");
assert.equal(laneOfPerson({ email: "coach@x.com", sports: ["basketball", "volleyball"] }), null);
assert.equal(homeLaneFor({ email: "drew@drippingsportsclub.com" }), "all");

// Program names
assert.equal(laneOfText("Reach+ Vball"), "reach");
assert.equal(laneOfText("Middle School Basketball Tryout Prep"), "basketball");
assert.equal(laneOfText("U13-15 National Pins"), "volleyball");
assert.equal(laneOfText("Open gym"), null);

// Which lane a text goes in
const db = fakeDb({
  dssc_clinics: [{ name: "Elite Tots K-2nd", sport: "basketball" }, { name: "Volleyball 101", sport: "volleyball" }],
  coaches: [{ id: "h", email: "hunter@drippingsportsclub.com" }, { id: "a", email: "adrian@drippingsportsclub.com" }, { id: "d", email: "drew@drippingsportsclub.com" }],
});
assert.equal(await laneFor(db, { brand: "dse" }), "", "DS Elite has no lanes");
assert.equal(await laneFor(db, { brand: "dssc", lane: "reach", dssc_program: "Volleyball 101" }), "reach", "asked-for lane wins");
assert.equal(await laneFor(db, { brand: "dssc", dssc_program: "Elite Tots K-2nd" }, { sent_by_coach_id: "h" }), "basketball", "program's sport beats the sender");
assert.equal(await laneFor(db, { brand: "dssc", dssc_program: "Reach+ Vball" }), "reach");
assert.equal(await laneFor(db, { brand: "dssc" }, { sent_by_coach_id: "a" }), "basketball", "no program: the sender's lane");
assert.equal(await laneFor(db, { brand: "dssc" }, { sent_by_coach_id: "d" }), "general", "Drew with no program: front desk");
assert.equal(await laneFor(db, { brand: "dssc", lane: "nonsense" }), "general");

// Which conversation a reply lands in
const T = (id, lane, at) => ({ id, phone: "+15125550100", brand: "dssc", lane, last_message_at: at });
const replyDb = fakeDb({
  sms_threads: [T(1, "volleyball", "2026-10-27T10:00:00Z"), T(2, "basketball", "2026-10-20T10:00:00Z"), { ...T(3, "", "2026-10-28T10:00:00Z"), brand: "dse" }],
  sms_messages: [{ id: 10, thread_id: 1, direction: "outbound" }, { id: 11, thread_id: 2, direction: "outbound" }, { id: 12, thread_id: 1, direction: "inbound" }],
});
assert.equal((await replyThreadFor(replyDb, "+15125550100", "dssc")).id, 2, "Adrian texted last, so the reply is Basketball's");
assert.equal((await replyThreadFor(replyDb, "+15125550100", "dse")).id, 3, "DS Elite is separate");
assert.equal(await replyThreadFor(replyDb, "+15125550199", "dssc"), null, "a new number starts at the front desk");
const quietDb = fakeDb({ sms_threads: [T(1, "volleyball", "2026-10-27T10:00:00Z"), T(2, "basketball", "2026-10-20T10:00:00Z")], sms_messages: [] });
assert.equal((await replyThreadFor(quietDb, "+15125550100", "dssc")).id, 1, "nothing sent yet: the latest conversation");

console.log("dssc lanes: all tests passed");
