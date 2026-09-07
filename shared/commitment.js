// The DS Elite commitment, as signed on orientation night.
//
// Every clause here comes from a slide in the orientation deck, and nothing in
// it is new — that is the promise made on slide 24 ("Everything we just
// covered is in it"), and it only stays true if this file and the deck move
// together. The `slide` field on each clause says where it came from, so when
// the deck changes you can find what has to change here.
//
// One source of truth on purpose: api/commitment-form.js renders it for
// families and the app renders it on the player card. Two copies would drift,
// and a signature is worthless if nobody can say what was on the page.
//
// VERSION is stamped onto every signature. Change the wording, bump the
// version — an old signature then still says exactly what was agreed to, and
// the card can tell you who signed which one.

export const SEASON = "2026-27";
export const VERSION = "2026-27.1";

// What the player agrees to. Written to her, not about her.
export const PLAYER_CLAUSES = [
  {
    key: "work",
    slide: "07 · 08",
    title: "I'll do the work nobody scheduled",
    text: "Team practice builds the team. It is not enough to build my game, and it never will be — there aren't enough hours in it. I'll get the extra reps: early to the gym, staying after, open gym, a wall and a ball at home. I also know there will be a stretch this season where I work just as hard and nothing improves. That is what learning looks like, and I won't quit during it.",
  },
  {
    key: "attendance",
    slide: "17",
    title: "I'll be at practice, and my coach hears from me early",
    text: "I'm expected at every practice. Illness, a family event, or an emergency are the reasons to miss. When one of those happens my coach hears it from me at least two hours before practice — not ten minutes before warm-ups, and not from an empty spot on the floor.",
  },
  {
    key: "wallwork",
    slide: "17b",
    title: "If I miss, I owe wall work",
    text: "Missing a practice means missing reps my teammates got. Wall work is how I get them back — traps, setting, passing, done before or after a practice with my coach signing off. It isn't a punishment and it isn't conditioning. I understand that if the wall work isn't done, I sit a tournament.",
  },
  {
    key: "gameday",
    slide: "18",
    title: "I'll do tournament day right",
    text: "I arrive an hour before start time in full travel gear. I take my reffing assignments as they rotate. And nobody leaves the gym until the whole team is finished — if my matches are done and my team still has a work assignment, I'm still there.",
  },
  {
    key: "officials",
    slide: "11",
    title: "I'll respect the game and the people running it",
    text: "Only the head coach and the game captain speak to an official. I never do — not a word, not a look, not a face from the bench. After a bad call, the next play. We shag balls for the team we're about to play, and we thank every referee on the court.",
  },
  {
    key: "teammate",
    slide: "12 · 13",
    title: "I'll be a teammate",
    text: "Nobody eats alone, warms up alone, or sits alone. The bench is a job — I cheer by name, track the rotation, and I'm ready to go in cold. If two or more of us are planning something on a tournament weekend, everyone on the roster is invited. And nothing about a teammate, a coach, or a match goes on social media.",
  },
  {
    key: "spot",
    slide: "15",
    title: "I know what earns a spot",
    text: "First in the gym, last to stop working. Talking on defense. Taking a correction and using it on the very next rep. Making my teammates better. None of that is about how tall I am or how hard I hit — every one of them is a choice I can make at the next practice.",
  },
  {
    key: "gear",
    slide: "19",
    title: "I'll show up ready",
    text: "Knee pads every time. Headbands and pre-wrap in pink, grey or black. Hair up, nails short, no new piercings during the season, taping done before the match, and volleyball shoes indoors only. My phone is off and in my bag from five minutes before warm-ups, and never at the scorer's table.",
  },
  {
    key: "speakup",
    slide: "21 · 22",
    title: "I'll speak up — to my coach, and about anyone being hurt",
    text: "If something is wrong, I go to my coach first. And if I'm being bullied, or I'm watching it happen to someone else, I'll tell an adult in this club. I don't have to be certain and I don't have to have proof. I just have to say something.",
  },
];

// What the parent agrees to. Written to them, and deliberately as specific as
// the players' — a commitment only one side can be held to is not a commitment.
export const PARENT_CLAUSES = [
  {
    key: "team",
    slide: "04 · 06",
    title: "I'm here for the team, not only my player",
    text: "I came in caring about one player, and I'll widen that out. I'll be on my feet for a kid who isn't mine. I also accept how we measure a good season: every player better in May than she was in September, a team that still likes each other in March, and a daughter who can name what she learned — not the record.",
  },
  {
    key: "stands",
    slide: "14",
    title: "I'll get the stands right",
    text: "I cheer for effort, and for the whole roster rather than only my own. I leave the coaching to the coaches. I say nothing toward officials, opposing players, or opposing parents. My daughter can hear me, and so can everyone else in the building.",
  },
  {
    key: "ridehome",
    slide: "14",
    title: "I'll get the ride home right",
    text: "She has already replayed the match forty times before she reaches the car. The ride home is not the place to coach it. “I loved watching you play” is almost always the right thing to say.",
  },
  {
    key: "chain",
    slide: "21",
    title: "I'll raise concerns the right way",
    text: "I go to the coach before the director. Nothing about playing time until 24 hours after a tournament. In writing first, then a scheduled meeting with both coaches present, and to Coach T if it isn't resolved. Never during a tournament — not between matches, not in the parking lot, and never with a kid standing there.",
  },
  {
    key: "attendance",
    slide: "17 · 17b",
    title: "I'll get her there, and I'll back the standard",
    text: "Attendance is monitored all season, and I'll do my part to get her to practice on time. When she has to miss, her coach hears from us at least two hours ahead. I understand wall work is how missed reps get made up, and that if it isn't done she sits a tournament.",
  },
  {
    key: "comms",
    slide: "20",
    title: "I'll stay reachable in SportsYou",
    text: "Team communication runs through SportsYou. If it isn't in the app, it didn't happen. I'll install it, keep notifications on, and tell her coach if my access code doesn't arrive — the codes expire after 24 hours.",
  },
  {
    key: "money",
    slide: "23",
    title: "I understand the money and the deadlines",
    text: "I've read the payment schedule and due dates, what club fees do and don't include, and the uniform ordering deadline — we can't order late. I also understand that every national qualifier is stay to play: I book through the tournament's housing partner, not a cheaper hotel down the road, because enough families booking outside it can cost the team its entry.",
  },
  {
    key: "health",
    slide: "22 · 23",
    title: "I'll tell you the day it happens",
    text: "Injuries and illness get reported the day they happen, and we'll follow the return-to-play protocol. And if I hear about bullying — toward my daughter or anyone else's — I'll bring it to any adult in this club. Every allegation is investigated, up to and including removal, and how good a player someone is never enters into it.",
  },
];

export const ALL_KEYS = {
  player: PLAYER_CLAUSES.map((c) => c.key),
  parent: PARENT_CLAUSES.map((c) => c.key),
};

// A signature counts only when every box on that side is ticked. Half a
// commitment is not one, and a partially ticked form is a family who stopped
// reading — better to send them back than to file it as agreement.
export const isComplete = (items, side) =>
  ALL_KEYS[side].every((k) => items && items[k] === true);

// Both sides in, which is what the player card means by "commitment signed".
export const isFullySigned = (row) =>
  !!row && !!row.player_signed_at && !!row.parent_signed_at;
