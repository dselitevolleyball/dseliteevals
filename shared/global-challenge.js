// Girls Global Challenge (Croatia, summer 2027) — the interest form's facts and
// answer options, in one place so the public page (api/global-form.js), the
// send script and the app's Waiting on screen all say the same thing.
//
// Organised by Cory Solomon; Hunter runs it for the club. Mick Haley has been
// to it the last six years.

export const GC_TEAMS = ["14 Diamond", "14 Ruby", "15 Diamond", "15 Ruby"];

// Cory's package is $2,595 a head. The club adds $500 for its own costs, and
// families only ever see the total. Airfare is on top of either.
export const GC_PACKAGE = 2595;
export const GC_CLUB_FEE = 500;
export const GC_PRICE = GC_PACKAGE + GC_CLUB_FEE;
export const GC_SINGLE_SUPPLEMENT = 700;

// July 2027, per Cory's 27 Aug 2026 email.
export const GC_ITINERARY = [
  { when: "July 7", what: "Leave the US as a team" },
  { when: "July 8", what: "Arrive in our pre-tour city" },
  { when: "July 9–11", what: "Pre-tour: practices, scrimmages against local clubs, and sightseeing together" },
  { when: "July 12", what: "Travel to Pula, Croatia · opening ceremonies that evening" },
  { when: "July 13–16", what: "The tournament, four days, closing ceremonies and party after the final" },
  { when: "July 17", what: "Travel to Venice, Italy" },
  { when: "July 18", what: "Fly home from Venice" },
];

export const GC_CITIES = [
  { key: "budapest", label: "Budapest, Hungary" },
  { key: "prague", label: "Prague, Czech Republic" },
  { key: "vienna", label: "Vienna, Austria / Bratislava, Slovakia" },
  { key: "milan", label: "Milan, Italy" },
  { key: "belgrade", label: "Belgrade, Serbia" },
  { key: "any", label: "No preference" },
];

export const GC_INTEREST = [
  { key: "yes", label: "Yes, we're interested", sub: "Count us in as we figure out numbers" },
  { key: "maybe", label: "Maybe", sub: "Interested, but we have questions first" },
  { key: "no", label: "Not this time", sub: "Thanks for thinking of us" },
];

// Same codes as POSITIONS in src/App.jsx.
export const GC_POSITIONS = [
  { key: "S", label: "Setter" },
  { key: "OH", label: "Outside hitter" },
  { key: "MB", label: "Middle blocker" },
  { key: "RS", label: "Right side / opposite" },
  { key: "L", label: "Libero" },
  { key: "DS", label: "Defensive specialist" },
  { key: "ANY", label: "Anywhere the team needs me" },
];

export const GC_TRAVEL = [
  { key: "solo", label: "She'd travel with the team on her own", sub: "Like a school trip: with her coaches and teammates" },
  { key: "parent", label: "At least one parent would come along" },
  { key: "family", label: "We'd like to make it a family trip" },
  { key: "unsure", label: "Not sure yet" },
];

export const labelOf = (list, key) => list.find((x) => x.key === key)?.label || key || "";
