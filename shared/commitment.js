// The DS Elite commitment, as signed on orientation night.
//
// Every clause here comes from a slide in the orientation deck, and nothing in
// it is new — that is the promise made on slide 24 ("Everything we just
// covered is in it"), and it only stays true if this file and the deck move
// together. The `slide` field on each clause says where it came from, so when
// the deck changes you can find what has to change here.
//
// WRITTEN AS SPECIFIC ACTIONS, ON PURPOSE
//
// Each clause is a heading with a list of things the signer will actually do,
// phrased so you could tell afterwards whether it happened. "I will raise
// concerns the right way" is a sentiment nobody can be held to. "I will wait
// 24 hours after a tournament before raising anything about playing time" is a
// commitment — in February you either did or you didn't. Vague clauses are
// what make a signed contract decorative, so when adding one, write the
// behaviour and not the value behind it.
//
// One source of truth: api/commitment-form.js renders it for families and the
// app renders it on the player card. Two copies would drift, and a signature
// is worthless if nobody can say what was on the page.
//
// VERSION is stamped onto every signature. Change the wording, bump the
// version — an old signature then still says exactly what was agreed to, and
// the card can tell you who signed which one.

export const SEASON = "2026-27";
export const VERSION = "2026-27.3";

// What the player agrees to. Written to her, not about her.
export const PLAYER_CLAUSES = [
  {
    key: "work",
    slide: "07 · 08",
    title: "The work nobody scheduled",
    points: [
      "I will get reps outside of team practice every week — open gym, extra time before or after, or a wall and a ball at home.",
      "I will arrive early or stay late when the chance is there, rather than leaving the moment practice ends.",
      "I will keep doing the extra work through a stretch where nothing improves, because that stretch is coming and it is not a sign it stopped working.",
    ],
  },
  {
    key: "attendance",
    slide: "17",
    title: "Being at practice",
    points: [
      "I will be at every practice unless I am ill, have a family event, or there is an emergency.",
      "When I have to miss or will be late, my coach will hear it at least two hours before practice starts — not ten minutes before warm-ups.",
      "I will leave drama and gossip outside the gym.",
    ],
  },
  {
    key: "wallwork",
    slide: "17b",
    title: "Wall work when I miss",
    points: [
      "When I miss a practice or arrive late, I will complete my wall work — traps, setting, passing — before or after another practice.",
      "I understand that if my wall work is not done, I sit a tournament. Not part of one.",
    ],
  },
  {
    key: "gameday",
    slide: "18",
    title: "Tournament day",
    points: [
      "I will arrive one hour before our first start time, in full travel gear.",
      "I will take my reffing assignments as they come up through the season.",
      "I will stay until the whole team is finished, even when my own matches are over and the team still has a work assignment.",
    ],
  },
  {
    key: "officials",
    slide: "11",
    title: "Officials and the other team",
    points: [
      "I will not speak to an official — not a word, not a look, not a face from the bench. Only the head coach and the game captain do that.",
      "After a call goes against me, I will go to the next play instead of reacting to it.",
      "I will shag balls for the team we are about to play, and take it seriously.",
      "I will thank the referees working my court.",
    ],
  },
  {
    key: "teammate",
    slide: "12 · 13",
    title: "Being a teammate",
    points: [
      "I will not let a teammate eat alone, warm up alone, or sit alone.",
      "On the bench I will cheer my teammates by name, track the rotation, and be ready to go in cold.",
      "If two or more of us are planning anything on a tournament weekend — dinner, the pool, a room — I will make sure every player on the roster is invited.",
    ],
  },
  {
    key: "spot",
    slide: "15",
    title: "What earns a spot",
    points: [
      "I will be among the first in the gym and among the last to stop working.",
      "I will talk on defense.",
      "When I get a correction I will use it on the very next rep instead of explaining why.",
    ],
  },
  {
    key: "gear",
    slide: "19",
    title: "Showing up ready",
    points: [
      "I will wear knee pads at every practice and every match.",
      "I will keep headbands and pre-wrap to pink, grey or black.",
      "I will arrive with my hair up, my nails short, and any taping already done.",
      "I will not get a new piercing during the season.",
      "I will keep volleyball shoes for indoors only and bring separate shoes or slides.",
      "I will have my phone off and in my bag from five minutes before warm-ups, and never at the scorer's table.",
    ],
  },
  {
    key: "speakup",
    slide: "21 · 22",
    title: "Speaking up",
    points: [
      "When something is wrong, I will go to my coach first.",
      "If I am being bullied, or I see it happening to someone else, I will tell an adult in this club — even if I am not certain and cannot prove it.",
    ],
  },
];

// What the parent agrees to. Deliberately as specific as the players' — a
// commitment only one side can be held to is not a commitment.
export const PARENT_CLAUSES = [
  {
    key: "stands",
    slide: "14",
    title: "In the stands",
    points: [
      "I will cheer for effort rather than only for points.",
      "I will leave the coaching to the coaches while a match is going on.",
      "I will say nothing toward an official, an opposing player, or an opposing parent — during a match or after it.",
    ],
  },
  {
    key: "chain",
    slide: "21",
    title: "Raising a concern",
    points: [
      "I will wait 24 hours after a tournament before raising anything about playing time or a tournament issue.",
      "I will never raise a concern during a tournament — not between matches, not in the parking lot, and never where players can hear it.",
      "I will go to her coach before I go to a director.",
      "I will put it in writing first, and then meet with both coaches present rather than pulling one aside.",
      "If it is still unresolved after that, I will take it to Coach T rather than around her.",
    ],
  },
  {
    key: "attendance",
    slide: "17 · 17b",
    title: "Getting her there",
    points: [
      "I will get her to practice on time, and to tournaments an hour before the first start.",
      "When she has to miss or will be late, I will make sure her coach knows at least two hours before practice.",
      "I understand that missed practices owe wall work, and that if it is not done she sits a tournament.",
    ],
  },
  {
    key: "comms",
    slide: "20",
    title: "Staying reachable",
    points: [
      "I will install SportsYou and keep its notifications turned on all season.",
    ],
  },
  {
    key: "health",
    slide: "22 · 23",
    title: "Injuries, illness and safety",
    points: [
      "I will report an injury or illness the day it happens rather than at the next practice.",
      "If I hear about bullying — toward my daughter or anyone else's — I will bring it to an adult in this club.",
    ],
  },
];

export const ALL_KEYS = {
  player: PLAYER_CLAUSES.map((c) => c.key),
  parent: PARENT_CLAUSES.map((c) => c.key),
};

// Handy for the card and for anyone counting what was actually agreed to.
export const pointCount = (clauses) =>
  clauses.reduce((n, c) => n + c.points.length, 0);

// A signature counts only when every box on that side is ticked. Half a
// commitment is not one, and a partially ticked form is a family who stopped
// reading — better to send them back than to file it as agreement.
export const isComplete = (items, side) =>
  ALL_KEYS[side].every((k) => items && items[k] === true);

// Both sides in, which is what the player card means by "commitment signed".
export const isFullySigned = (row) =>
  !!row && !!row.player_signed_at && !!row.parent_signed_at;
