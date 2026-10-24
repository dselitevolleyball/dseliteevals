// US phone numbers that can't exist are never texted. Run: node scripts/test-phone.mjs
import assert from "node:assert/strict";
import { usE164, isUsPhone } from "../shared/phone.js";
import { normalizePhone } from "../api/_lib/sms.js";
import { e164 } from "../api/_lib/dssc-crm.js";
import { buildPeople, resolveAudience } from "../shared/campaign-audience.js";

for (const ok of ["5127126366", "(512) 712-6366", "+1 512 712 6366", "15127126366"]) { assert.equal(usE164(ok), "+15127126366"); assert.equal(normalizePhone(ok), "+15127126366"); assert.equal(e164(ok), "+15127126366"); }
// A 1 typed in front of 9 digits (what Playbook let through), zeros, 555-style exchange 0/1.
for (const bad of ["1512712636", "+11512712636", "0000000000", "+11111111111", "5121234567".replace("123", "023")]) { assert.equal(usE164(bad), null, bad); assert.equal(normalizePhone(bad), "", bad); assert.equal(e164(bad), null, bad); }
assert.equal(isUsPhone("+15125550101"), true);
assert.equal(normalizePhone("+44 7700 900123"), "+447700900123");   // international still allowed
assert.equal(e164("+44 7700 900123"), "+447700900123");
// The audience engine leaves the bad number out instead of texting it.
const people = buildPeople({ contacts: [{ id: 1, first_name: "Good", last_name: "A", phone: "5127126366" }, { id: 2, first_name: "Bad", last_name: "B", phone: "+11512712636" }], participants: [{ id: 11, contact_id: 1, first_name: "Kid", last_name: "A" }, { id: 12, contact_id: 2, first_name: "Kid", last_name: "B" }], participation: [], players: [], teams: [], roster: [], clinics: [], coaches: [], optouts: [] }, "2026-10-24");
assert.deepEqual(resolveAudience(people, {}).recipients.map(r => r.name), ["Good A"]);
console.log("all phone checks passed");
