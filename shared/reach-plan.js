// Reach recommendation for the testing report email (Drew, 12 Oct 2026).
//
// "Players should be coming to Reach 2x a week if they want to see more of an
// increase in their athletic abilities as well as injury prevention. Teams
// that practice 7-9: come 5:30-6:30, have some dinner/protein, then practice
// 7-9. Teams that practice 5-7: practice, dinner, then Reach 7:30-8:30 — or
// Reach on their off days." And: "start now — middle and high school
// volleyball is ending; get in the gym between now and Thanksgiving, then pivot
// to a consistent schedule around your team's practice nights."
//
// reachPlanFor(team, assignments) reads the team's weekday practice nights
// from practice_assignments (Sunday afternoons don't decide anything) and says
// which Reach slot fits. Shared so the HQ preview and the sent email agree.

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);
const listDays = (days) => {
  const d = [...new Set(days)].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  return d.length <= 1 ? (d[0] || "") : d.slice(0, -1).join(", ") + " and " + d[d.length - 1];
};
// "7-9pm", "7:00-9:00pm", "7-9 PM" → start hour on a 24h clock (19).
const startHour = (slot) => {
  const m = /(\d{1,2})(?::\d{2})?\s*-\s*\d{1,2}(?::\d{2})?\s*(am|pm)?/i.exec(String(slot || ""));
  if (!m) return null;
  let h = Number(m[1]);
  const pm = !m[2] || /pm/i.test(m[2]);
  if (pm && h < 12) h += 12;
  return h;
};

// assignments: practice_assignments rows { team_name, day, slot, phase }.
// phase: which schedule to read ("season" — the regular season nights).
export function reachPlanFor(team, assignments, { phase = "season" } = {}) {
  const nights = (assignments || [])
    .filter(a => a.team_name === team && (a.phase || "season") === phase && WEEKDAYS.has(a.day))
    .map(a => ({ day: a.day, slot: a.slot, start: startHour(a.slot) }))
    .filter(n => n.start != null);
  const late = nights.filter(n => n.start >= 19), early = nights.filter(n => n.start >= 16 && n.start < 19);
  const kind = late.length && early.length ? "both" : late.length ? "late" : early.length ? "early" : "none";
  const lateText = late.length
    ? `${team} practices ${listDays(late.map(n => n.day))} 7–9pm, so come to Reach 5:30–6:30, grab dinner or a protein snack, then head to practice.`
    : "";
  const earlyText = early.length
    ? `${team} practices ${listDays(early.map(n => n.day))} 5–7pm, so after practice have dinner and come to Reach 7:30–8:30 — or come on your off days.`
    : "";
  const text = kind === "none"
    ? `Pick two nights a week that fit around ${team || "her team"}'s practices.`
    : [lateText, earlyText].filter(Boolean).join(" ");
  return { kind, team, nights, lateDays: late.map(n => n.day), earlyDays: early.map(n => n.day), text };
}

// 11s and 12s (Drew, 12 Oct 2026): "only after evaluation and director's
// discretion because we typically start at 13s", with the Intro to Volleyball
// S&C program attached. Their email swaps the 2x-a-week pitch and the
// membership buttons for this copy and the PDF (public/reach/intro-volleyball-sc.pdf).
export const isYouthTeam = (team) => /^\s*1[12]\b/.test(String(team || ""));
export const REACH_YOUTH_COPY = {
  youth_pitch_heading: "Building {player_first}'s athletic base",
  youth_pitch: [
    "At 11 and 12, the biggest gains come from moving well, landing safely and building basic strength. Those habits protect her body and pay off for years.",
    "Individual Reach training typically starts at 13s. For 11s and 12s, we add players only after an evaluation and at the director's discretion. If you'd like {player_first} considered, just reply to this email and we'll set one up.",
    "In the meantime, I've attached Intro to Volleyball Strength & Conditioning, a program built for ages 11–12: 8 weeks, 3 days a week, about 40 minutes a session. It starts with bodyweight and bands, then moves to light weights and bigger jumps, and it has a simple test and log so you can see her progress. Please supervise every session.",
  ].join("\n\n"),
  youth_pdf: { filename: "Intro Volleyball S&C.pdf", path: "/reach/intro-volleyball-sc.pdf", label: "Open the Intro to Volleyball S&C program (PDF)" },
};

// The new pitch copy (Drew, 12 Oct 2026). {player_first}, {team} and
// {reach_plan} are filled per player by the report builder.
export const REACH_COPY = {
  pitch_heading: "Take {player_first}'s numbers further: Reach, 2x a week",
  pitch: [
    "The players who see the biggest jumps in speed, vertical and power — and who stay healthy through a long club season — train twice a week on top of practice. That's our recommendation for {player_first}: Reach 2x a week.",
    "Start now. Middle and high school volleyball is wrapping up, so this is the time to get in the gym: come in between now and Thanksgiving, then settle into a consistent schedule around {team}'s practice nights. {reach_plan}",
    "Already doing strength and conditioning at school? Keep it. But a school program is built for a whole class. A plan built around {player_first} — her position, her numbers, what she wants to improve — will net much greater results.",
    "The Reach sessions DS Elite has provided so far were team-based. Going forward, every player who signs up for Reach gets her own individual plan, built around what she wants to work on: explosiveness, vertical touch, strength for harder attacks, speed. And she's re-tested regularly so you can watch the numbers move.",
    "Reply to this email with any questions, or pick a membership below to sign {player_first} up.",
  ].join("\n\n"),
  pitch_button: "Sign {player_first} up for Reach",
  // The two memberships (Drew, 12 Oct 2026). Elite is the 2x-a-week plan the
  // email recommends; Foundation is one session a week.
  signup_note: "Sign up from your own DSSC account and add {player_first} as the participant.",
  memberships: [
    { name: "Reach Elite", price: "$400/month", detail: "Unlimited monthly training sessions with Reach Performance",
      link: "https://drippingsports.playbookapi.com/subscribe/subscription_registration/?subscription_id=6530", recommended: true },
    { name: "Reach Foundation", price: "$250/month", detail: "4 Elite Athlete Development sessions a month (1 per week)",
      link: "https://drippingsports.playbookapi.com/subscribe/subscription_registration/?subscription_id=6529" },
  ],
  fine_print: "Memberships bill monthly, and unused sessions don't roll over. Once you're signed up, book sessions in the DSSC app or on the website.",
  // Coach Brandon with athletes he has trained (Drew, 12 Oct 2026) — on every
  // testing report email. One caption for both photos: who stands where isn't
  // recorded, so no per-photo names. Paths are under public/; the email
  // builder makes them absolute with the app's origin.
  photos: ["/reach/brandon-athletes-smu.jpg", "/reach/brandon-athletes-texas.jpg"],
  photos_caption: "Coach Brandon with athletes he's trained: Henley Anderson (RS/OH, University of Texas), Camille Presley (MB, University of Texas) and Christa Wilburn (OH, SMU).",
};
