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
// Parents and family who come along (Drew, 28 Sep 2026).
export const GC_FAMILY_PRICE = 2495;

// July 2027, per Cory's 27 Aug 2026 email.
export const GC_ITINERARY = [
  { when: "July 7", what: "Leave the US as a team" },
  { when: "July 8–10", what: "Three days in our pre-tour city: practices, scrimmages against local clubs, and group sightseeing" },
  { when: "July 11", what: "One night in Maribor, Slovenia" },
  { when: "July 12", what: "On to Pula, Croatia · opening ceremonies that evening" },
  { when: "July 13–16", what: "The tournament, four days, closing ceremonies and party after the final" },
  { when: "July 17", what: "Travel to Venice, Italy" },
  { when: "July 18", what: "Fly home from Venice" },
];

// Cory's pre-tour options (email of 28 Sep 2026). Each is three days in the
// city, then a night in Maribor, then Pula.
export const GC_CITIES = [
  { key: "budapest", label: "Budapest, Hungary", blurb: "The Danube, the Parliament building, Buda Castle and the thermal baths" },
  { key: "prague", label: "Prague, Czech Republic", blurb: "Old Town Square, Charles Bridge and Prague Castle" },
  { key: "vienna", label: "Vienna, Austria / Bratislava, Slovakia", blurb: "Two capitals an hour apart, with scrimmages alongside a club team from Bratislava" },
  { key: "milan", label: "Milan, Italy", blurb: "The Duomo, the Galleria and one of Italy's great volleyball regions" },
  { key: "belgrade", label: "Belgrade, Serbia", blurb: "Less touristy, with a big volleyball culture and the fortress over two rivers. Cory's personal favorite" },
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
  { key: "solo", label: "Just the player", sub: "She travels with the team, her coaches and the chaperone" },
  { key: "family", label: "As a family", sub: "At least one parent or family member comes too" },
  { key: "unsure", label: "Not sure yet" },
];

export const labelOf = (list, key) => list.find((x) => x.key === key)?.label || key || "";
