// DSSC texting lanes (Drew, Oct 28 2026): "give each director their own
// section for text messaging - so when Adrian is texting for basketball, his
// responses aren't interfering with Hunter's responses. Same with Reach."
//
// The club has one texting number, so a family can be talking to Hunter about
// volleyball and to Adrian about basketball at once. Each club text thread now
// belongs to a lane (sms_threads.lane), one thread per phone per lane:
//   volleyball  Hunter          basketball  Adrian
//   reach       Brandon         general     the front desk (Jonathan) - anything else
// A text goes into the lane of the program it's about, else the sender's own
// lane; a reply goes to the lane of the last text sent to that number
// (api/sms-webhook.js). DS Elite's threads have no lane ("").

export const LANES = [
  { key: "volleyball", label: "Volleyball", who: "Hunter", icon: "🏐" },
  { key: "basketball", label: "Basketball", who: "Adrian", icon: "🏀" },
  { key: "reach", label: "Reach", who: "Brandon", icon: "🏃" },
  { key: "general", label: "Front desk", who: "Jonathan", icon: "🏢" },
];
export const LANE_KEYS = LANES.map(l => l.key);
export const laneLabel = (k) => (LANES.find(l => l.key === k) || {}).label || "Front desk";
export const isLane = (k) => LANE_KEYS.includes(k);

// Each director's own lane; anyone else lands on "general" unless their
// sports say otherwise.
export const DIRECTOR_LANE = {
  "hunter@drippingsportsclub.com": "volleyball", "hunterhaleysc10@gmail.com": "volleyball",
  "adrian@drippingsportsclub.com": "basketball", "adrian@4thquarterathlete.com": "basketball",
  "brandon@drippingsportsclub.com": "reach",
  "jonathan@drippingsportsclub.com": "general",
};
// The lane a person sends from by default: theirs if they're a director, else
// their one sport (a basketball coach texts in Basketball), else null.
export function laneOfPerson(p) {
  const e = String(p?.email || "").trim().toLowerCase();
  if (DIRECTOR_LANE[e]) return DIRECTOR_LANE[e];
  const sports = [...new Set([...[].concat(p?.sports || []), ...[].concat(p?.staff_view || [])].map(s => String(s).toLowerCase()))].filter(isLane);
  return sports.length === 1 ? sports[0] : null;
}
// A program name's lane from its words (when HQ has no record of the program).
export function laneOfText(text) {
  const s = String(text || "");
  if (!s.trim()) return null;
  if (/\breach\b/i.test(s)) return "reach";
  if (/basket|hoops|shooting lab|skill lab|ball ?handling|\bbb\b/i.test(s)) return "basketball";
  if (/volley|serve|setter|libero|pins|middles|hitting|passing|pod|\bvb\b|jump serve|all-skills/i.test(s)) return "volleyball";
  return null;
}
// Which lanes a person sees first in DSSC Texts (everyone may switch to All).
export const homeLaneFor = (p) => laneOfPerson(p) || "all";
