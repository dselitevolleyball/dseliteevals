// NCAA Championship group tickets (Drew, 23 Oct 2026): DS Elite families are
// invited to the NCAA women's volleyball championship match at the Alamodome,
// where the goal is the biggest crowd ever at an indoor volleyball match. The
// facts and answer options live here so the public form (api/ncaa-form.js),
// the send script and the app's Waiting on screen all say the same thing.
//
// One answer per family: brothers and sisters share parent emails, so the form
// saves on whichever player's link was used and clears the siblings' rows.

export const NCAA_PRICE = 52;
export const NCAA_WHEN = "Sunday, December 20 at 2:30pm";
export const NCAA_WHERE = "the Alamodome in San Antonio";
export const NCAA_SEATS = "the 300 level";

export const NCAA_ANSWERS = [
  { key: "yes", label: "Yes, count us in for group tickets", short: "Yes" },
  { key: "have", label: "We already have tickets and will be there", short: "Have tickets" },
  { key: "maybe", label: "Maybe, keep us posted", short: "Maybe" },
  { key: "no", label: "No, we can't make it", short: "No" },
];
export const ncaaLabel = (key, field = "label") => NCAA_ANSWERS.find((o) => o.key === key)?.[field] || key || "";

const emailsOf = (p) => [p?.parent_email, p?.parent_email2, p?.parent_email3]
  .map((e) => String(e || "").trim().toLowerCase()).filter(Boolean);

// A player and her brothers and sisters: anyone who shares a parent email.
export function familyOf(players, p) {
  const mine = new Set(emailsOf(p));
  if (!mine.size) return [p];
  return players.filter((q) => q.id === p.id || emailsOf(q).some((e) => mine.has(e)));
}

// Group players into families (connected by shared parent emails).
export function families(players) {
  const out = [], seen = new Set();
  for (const p of players) {
    if (seen.has(p.id)) continue;
    const fam = [p];
    seen.add(p.id);
    for (let i = 0; i < fam.length; i++) {
      for (const q of familyOf(players, fam[i])) if (!seen.has(q.id)) { seen.add(q.id); fam.push(q); }
    }
    out.push(fam);
  }
  return out;
}

// Answer by this date (the email, the text and the reminders all say it).
export const NCAA_REPLY_BY = "Friday, November 6";

// The words families get, shared by scripts/send-ncaa-tickets.mjs and the
// Waiting on screen's reminders. `link` is that family's /ncaa?t= URL.
export const ncaaEmail = ({ greeting, link, from = "Drew Rose" }) => `${greeting}

The NCAA women's volleyball championship match is coming to ${NCAA_WHERE} on ${NCAA_WHEN}, and they're trying to set the record for the biggest crowd ever at an indoor volleyball match: more than 30,000 fans.

We've been offered a group rate of $${NCAA_PRICE} a ticket, with seats in ${NCAA_SEATS}, and we'd love for DS Elite to do our part by bringing a big group. Players, parents, brothers and sisters, grandparents: everyone is welcome.

Please let us know by ${NCAA_REPLY_BY} on this short form:

${link}

It asks whether your family would like to come and, if so, how many tickets you'd like. If you already have tickets and will be there anyway, tell us that too. We'd love to count you in the DS Elite crowd.

This is just a head count. Nothing is owed yet. Once we know our numbers, we'll follow up with how to pay.

Questions? Just reply to this email.

Thanks,

${from}
DS Elite Volleyball`;

export const NCAA_SUBJECT = "DS Elite at the NCAA Championship in San Antonio: $" + NCAA_PRICE + " group tickets";

export const ncaaText = ({ link, from = "Drew" }) =>
  `Hi {first}, DS Elite is taking a group to the NCAA volleyball championship match at the Alamodome on Sun, Dec 20 at 2:30pm. They're going for the indoor volleyball attendance record (30,000+)! Group tickets are $${NCAA_PRICE} in the 300 level. Want to come, or already have tickets? Please answer by ${NCAA_REPLY_BY.replace(/^\w+, /, "")}: ${link} - ${from}, DS Elite`;
