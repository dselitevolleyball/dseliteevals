// Who may work a DSSC class of a given sport (Drew, Oct 14 2026: "dont let
// volleyball coaches pick up basketball shifts"). One rule for every way onto a
// class - the Coach Hub and DSSC Hours open-shift lists, the class page's
// "I'll take it", approving a pickup in the app, and the one-tap approve link
// (api/dssc-approve.js).
//
//   basketball class - only DSSC basketball people: an active dssc_people row
//                      (coach or admin) whose sports include basketball
//   volleyball class - anyone except a DSSC person listed only for other sports
//                      (DS Elite coaches aren't in dssc_people: volleyball)
//
// Session staff are names, not emails, so names compare case- and
// space-insensitively.
const nm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const fullName = (p) => ((p.first_name || "") + " " + (p.last_name || "")).trim();

export const classSport = (clinic) => (clinic?.sport === "basketball" ? "basketball" : "volleyball");
export const sportLabel = (sport) => (sport === "basketball" ? "Basketball" : "Volleyball");

// people: dssc_people rows ({ first_name, last_name, sports, active, role }).
export function personSports(name, people) {
  const p = (people || []).find(x => x.active !== false && nm(fullName(x)) === nm(name));
  if (!p) return ["volleyball"];
  return Array.isArray(p.sports) && p.sports.length ? p.sports : ["volleyball"];
}
export const canWorkSport = (name, sport, people) => personSports(name, people).includes(sport === "basketball" ? "basketball" : "volleyball");
export const canWorkClass = (name, clinic, people) => canWorkSport(name, classSport(clinic), people);
