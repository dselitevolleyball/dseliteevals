// Reach texts: a scope "reach" campaign reaches Reach families only, whatever
// else its filters say, and only Reach staff count as Reach staff.
// Run: node scripts/test-reach-texts.mjs
import assert from "node:assert/strict";
import { buildPeople, resolveAudience, reachFilters, isReachStaff } from "../shared/campaign-audience.js";

const d = {
  contacts: [
    { id: 1, first_name: "Adam", last_name: "R", phone: "+15125550101" },
    { id: 2, first_name: "Ajel", last_name: "W", phone: "512-555-0102" },
    { id: 3, first_name: "Val", last_name: "B", phone: "+15125550103" },
    { id: 4, first_name: "Nope", last_name: "X", phone: "+15125550104", do_not_text: true },
  ],
  participants: [{ id: 11, contact_id: 1, first_name: "Cruz", last_name: "R" }, { id: 12, contact_id: 2, first_name: "Ajel", last_name: "W", is_contact: true }, { id: 13, contact_id: 3, first_name: "Vee", last_name: "B" }, { id: 14, contact_id: 4, first_name: "Kid", last_name: "X" }],
  participation: [
    { participant_id: 11, contact_id: 1, program: "Elite Athlete Development", category: "reach", event_date: "2026-09-30", source: "playbook" },
    { participant_id: 12, contact_id: 2, program: "Reach Adult Performance", category: "reach", event_date: "2026-05-02", source: "playbook" },
    { participant_id: 13, contact_id: 3, program: "Volleyball 101", category: "volleyball", event_date: "2026-09-02", source: "playbook" },
    { participant_id: 14, contact_id: 4, program: "Elite Athlete Development", category: "reach", event_date: "2026-09-02", source: "playbook" },
  ],
  players: [], teams: [], roster: [], clinics: [], coaches: [{ id: 1, first_name: "Coach", last_name: "C", phone: "+15125550199" }],
  optouts: [{ phone: "+15125550102", brand: "dse" }],
};
const people = buildPeople(d, "2026-10-23");
const names = (a) => a.recipients.map(r => r.name).sort();

assert.deepEqual(names(resolveAudience(people, { scope: "reach" })), ["Adam R", "Ajel W"]);
assert.deepEqual(resolveAudience(people, { scope: "reach" }).skipped.map(s => s.reason), ["do not text"]);
// No other filter can widen a Reach send.
assert.deepEqual(names(resolveAudience(people, { scope: "reach", categories: ["volleyball"], target: "coaches", dse: "members" })), ["Adam R", "Ajel W"]);
// Since a date and one program narrow it.
assert.deepEqual(names(resolveAudience(people, reachFilters({ since: "2026-07-01" }))), ["Adam R"]);
assert.deepEqual(names(resolveAudience(people, reachFilters({ program: "adult" }))), ["Ajel W"]);
assert.deepEqual(names(resolveAudience(people, reachFilters({ exclude: ["5125550101"] }))), ["Ajel W"]);
// The parent's message names the athlete; an adult athlete is their own contact.
const adam = resolveAudience(people, { scope: "reach" }).recipients.find(r => r.name === "Adam R");
assert.deepEqual(adam.players, ["Cruz R"]); assert.equal(adam.program, "Elite Athlete Development");
// Without the scope, the same filters reach others.
assert.ok(names(resolveAudience(people, { categories: ["volleyball"] })).includes("Val B"));

assert.equal(isReachStaff({ is_approved: true, sports: ["reach"], staff_view: ["reach"] }), true);
assert.equal(isReachStaff({ is_approved: true, staff_view: ["reach"] }), true);
assert.equal(isReachStaff({ is_approved: false, sports: ["reach"] }), false);
assert.equal(isReachStaff({ is_approved: true, sports: ["volleyball"] }), false);
assert.equal(isReachStaff(null), false);
console.log("all reach text checks passed");
