// Tryout-day emails for Saturday 19 Sep 2026 — three audiences, three emails.
//
//   accepted    — already have a spot; come play to help fill out their team
//   registered  — signed up for tryouts, not on a team; here's tomorrow
//   unregistered — haven't signed up; still time, and reply if you already did
//
// Lists are Drew's, pasted as given. One email per parent address per group;
// siblings in the same group share one email with both names.
// Replies go to Drew — the third email asks for them.
//
// DRY RUN BY DEFAULT.
//   node scripts/send-tryout-day.mjs
//   node scripts/send-tryout-day.mjs --test drew@dselitevolleyball.com
//   node scripts/send-tryout-day.mjs --send [--group accepted|registered|unregistered]

const APP = "https://dseliteevals.vercel.app";
const SENDER = { name: "Drew Rose", email: "drew@dselitevolleyball.com" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const WHEN = "tomorrow, Saturday, September 19, from 1:00 to 4:00pm";
const WHERE = "DSSC Warehouse, 15113 Fitzhugh Rd, Suite 1400, Dripping Springs";
const REG_1112 = "https://dselitevolleyball.sportngin.com/register/form/534224012";
const REG_1314 = "https://dselitevolleyball.sportngin.com/register/form/440865514";
const FALL_CAMP = "https://drippingsports.playbookapi.com/programs/more_info/class_package/77559/";

const LISTS = {
  accepted: `Rebekah Hardge|Kelli Hardge|krhardge@gmail.com
Greylee Smith|Courtney Smith|aggiecl@yahoo.com
Ellie James Halbert|Amanda Halbert|amandahalbert23@gmail.com
Harper Ward|Beth Ward|bethannward03@gmail.com
Quinn Rybak|Jessica Rybak|jessrybak@yahoo.com
Vallie Miser|Lizzy Miser|lizflo82@gmail.com
Ellie Rippie|Christine Hobson|clhobs@gmail.com
Elizabeth Escareno|Meaghan Escareno|housemm@gmail.com
Emma Norris|Jillian Norris|jillianmnorris@gmail.com
Julia Hart|Lara Hart|laraejaffe@aol.com
Hallye Afflixio|Tyler Afflixio|tafflixio@gmail.com
Ella Mendibles|Jeni Mendibles|jenimendibles@gmail.com`,
  registered: `Sydney Breckner|Teresa Breckner|teresa.breckner@gmail.com
Madilyn Walston|Whitney Walston|wsultemeier@gmail.com
Ava Scarborough|Amy Scarborough|amygawlik@gmail.com
Addison Ballman|Amber Ballman|amberballman@gmail.com
Jemma Gong|Alan Gong|alantgong@gmail.com
Kirra McElwee|Jeremiah McElwee|jahmiah@yahoo.com
Claire Davis|Carrie Davis|carriedavis13@gmail.com
Charlotte John|Christie John|crust32@gmail.com
Ava Boyle|Nick Boyle|nickboyle77@gmail.com
Sarine Schutz|Corinna Schutz|noahandcorinna@icloud.com
Violet DeBruin|Jana DeBruin|jana.debruin@gmail.com
Ameliya Abbasova|Elnara Abbasova|elnarina@me.com
Marlo Oswald|Kathryn Oswald|kathryneoswald@gmail.com
Alaina Donahue|Lexi Donahue|lexiberk@me.com
Rose McIlrath|Sean McIlrath|seanmcilrath5@gmail.com
Alex Jensen|Christy Jensen|christine.y.jensen@gmail.com
Hadley Spencer|Meaghen Spencer|meg.foleyspencer@gmail.com
Juliette Nunez|Michaela Frandrup|miafrandrup@gmail.com
Emery Roberts|Annie Roberts|aib4bu@yahoo.com
Julia Darcy|Erin Darcy|erin.l.darcy@gmail.com
Ava Dieringer|Mary Dieringer|mmdieringer82@gmail.com`,
  unregistered: `Alia Dhilla|Alefiya Dhilla|ally11201@gmail.com
Elise Callas|Paula Callas|paulacallas@gmail.com
Rowan Bedwell|Laney Bedwell|laney.bedwell@gmail.com
Kelby Sonntag|Katie Sonntag|katieksonntag@gmail.com
Landry Owenson|Haley Owenson|haleyowenson@gmail.com
Kyla Sonntag|Katie Sonntag|katieksonntag@gmail.com
Scarlett Rincon|Lindsay Rincon|lucyfish91@hotmail.com
Casey Elkins|Kristen Elkins|kristen.elkins14@gmail.com
Riley Scott|Katie Scott|scottfamilyinformation@gmail.com
Juliet Afflixio|Tyler Afflixio|tafflixio@gmail.com
Austin Trahan|Kristin Trahan|ktrahan321@gmail.com
Char Hales|Camilla Hales|clhales@gmail.com
Morgan Haiges|Shay Jordan|sjordan@igloogroup.com
Lucia Thielk|Christina Thielk|cstina.castro@gmail.com
Josephine Gavin Moss|Emily Gavin|etgavin@gmail.com
Ava Reyes|Heather Reyes|heather.n.reyes@gmail.com
Ella Peabody|Tiffany Peabody|tiffanygpeabody@gmail.com
Hadley Mader|Jenn Bailey|jbaileyresidential@gmail.com
Mithra Krishnan|Lakshmi Balakrishnan|lakshmibalu87@gmail.com
Layla Brown|Janita Brown|jbrunson2002@yahoo.com
Kayla Sherman|Stephen Sherman|sshermanjr@gmail.com
Lucy McIlrath|Sean McIlrath|seanmcilrath5@gmail.com
Mercer Jeffrey|Kate Terry|kate.l.terry@gmail.com
Lucy White|Megan White|megan@toddwhite.com, lucydance910@gmail.com
Audrey Stein|Amy Stein|amykstein@gmail.com
Moxie Henderson|Bailey Henderson|baileyhenderson08@yahoo.com
Maddy Downes|Jaclynn Vansant Downes|vansantjaclynn@gmail.com`,
};

// One job per group per family: siblings sharing a parent email get one email.
const jobsFor = (group) => {
  const byKey = new Map();
  for (const line of LISTS[group].split("\n")) {
    const [player, parent, emails] = line.split("|").map(s => s.trim());
    const to = emails.split(/[,\s]+/).map(e => e.replace(/["']/g, "").trim().toLowerCase()).filter(e => EMAIL_RE.test(e));
    const key = to.slice().sort().join(",");
    const j = byKey.get(key) || { group, parent, to, players: [] };
    j.players.push(player.split(/\s+/)[0]);
    byKey.set(key, j);
  }
  return [...byKey.values()];
};
const both = (xs) => xs.length === 1 ? xs[0] : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];

const LOGISTICS = (girl, shirt, early) => [
  ["What to bring", [shirt, "Knee pads", "A water bottle"]],
  ["How the afternoon runs", ["Physical testing first", "Then skill assessment", "Then 6-on-6 play"]],
  ["For parents", [
    "You're welcome to watch from the mezzanine. Parents aren't allowed on the court or on the first-floor turf.",
    ...(early ? [`Please stay close by — we may finish early with this group, so be ready to pick ${girl} up before 4:00.`] : []),
  ]],
];

const build = (j) => {
  const girl = both(j.players), plural = j.players.length > 1;
  const first = String(j.parent).split(/\s+/)[0];
  let subject, intro, blocks, outro;
  if (j.group === "accepted") {
    subject = `Tryouts tomorrow — we'd love ${girl} on the court (1–4pm)`;
    intro = [
      `We'd love for ${girl} to come to tryouts ${WHEN}, at the ${WHERE}.`,
      `${plural ? "They've" : `${girl} has`} already accepted a spot, so this isn't about ${plural ? "their" : "her"} place — having ${plural ? "them" : "her"} on the court helps us fill out the team ${plural ? "they're" : "she's"} on. There's nothing to register: just show up and go through the tryout the same way as last time.`,
    ];
    blocks = LOGISTICS(girl, "Pink DS Elite shirt", true);
    outro = `Thank you — we'll see ${plural ? "them" : "her"} tomorrow!`;
  } else if (j.group === "registered") {
    subject = `Tryouts tomorrow: what ${girl} needs to know (1–4pm)`;
    intro = [
      `Thank you for registering ${girl} for DS Elite tryouts! Here's what to expect ${WHEN}, at the ${WHERE}.`,
    ];
    blocks = [
      ...LOGISTICS(girl, "A pink shirt — a DS Elite shirt if you have one"),
      ["After tryouts", [
        `We'll be in touch with you about team placement after tryouts.`,
        `We have more players trying out than open spots, so several girls won't be placed on a team tomorrow — which is exactly why we're running Rise Fall Camp (below).`,
      ]],
    ];
    outro = `We're looking forward to seeing ${girl} tomorrow!`;
  } else {
    subject = `There's still time — DS Elite tryouts are tomorrow, 1–4pm`;
    intro = [
      `DS Elite tryouts are ${WHEN}, at the ${WHERE} — and there's still time to sign ${girl} up. We'd love to see ${plural ? "them" : "her"} there!`,
    ];
    blocks = [
      ["Sign up here", [`11U and 12U: ${REG_1112}`, `13U and 14U: ${REG_1314}`]],
      ["Already registered?", [`Please reply to this email and let me know, so I can update my list. Thank you!`]],
      ...LOGISTICS(girl, "A pink shirt — a DS Elite shirt if you have one"),
    ];
    outro = `Hope to see ${girl} tomorrow!`;
  }

  // Every family hears about Rise Fall Camp — placed, still trying out, or not signed up.
  blocks.push(["New: Rise Fall Camp", [
    `We're offering a second round of our Rise training program — Rise Fall Camp — on Saturdays from September through the start of the season.`,
    j.group === "accepted"
      ? `It's great extra training on top of team practice, and we'd love to see ${girl} there.`
      : `We'd love to see ${girl} at camp whether or not ${plural ? "they make" : "she makes"} a team.`,
    `Details and sign-up: ${FALL_CAMP}`,
  ]]);
  blocks.push(["Did we miss something?", [
    `We're doing our best to keep up with everything families have told us, but we may have missed something. If anything here doesn't match your plans, just reply to this email and let us know.`,
  ]]);

  const link = (s) => esc(s).replace(/(https?:\/\/\S+)/g, '<a href="$1" style="color:#c2186f">$1</a>');
  const text = `Hi ${first},\n\n${intro.join("\n\n")}\n\n`
    + blocks.map(([h, items]) => `${h.toUpperCase()}\n${items.map(i => "  • " + i).join("\n")}`).join("\n\n")
    + `\n\n${outro}\n\nDrew Rose\nDirector, DS Elite`;
  const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:600px">'
    + `<p style="margin:0 0 14px">Hi ${esc(first)},</p>`
    + intro.map(p => `<p style="margin:0 0 14px">${esc(p)}</p>`).join("")
    + blocks.map(([h, items]) =>
        `<p style="margin:22px 0 6px;font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#c2186f">${esc(h)}</p>`
        + `<ul style="margin:0 0 10px;padding-left:20px">${items.map(i => `<li style="margin-bottom:4px">${link(i)}</li>`).join("")}</ul>`).join("")
    + `<p style="margin:20px 0 0">${esc(outro)}</p><p style="margin:14px 0 0">Drew Rose<br>Director, DS Elite</p></div>`;
  return { subject, text, html };
};

const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const testTo = val("test"), doSend = args.includes("--send"), only = val("group");
const groups = only ? [only] : ["accepted", "registered", "unregistered"];

const send = async (m, recipients) => {
  const r = await fetch(APP + "/api/send-email", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: m.subject, body: m.text, bodyHtml: m.html, recipients, replyTo: SENDER.email,
      sentBy: SENDER.name, sentByEmail: SENDER.email, source: "script", skipPush: true }),
  });
  const o = await r.json().catch(() => ({}));
  return r.ok && !o.error ? null : (o.error || String(r.status));
};

for (const g of groups) {
  const jobs = jobsFor(g);
  console.log(`\n=== ${g}: ${jobs.length} emails, ${jobs.reduce((n, j) => n + j.players.length, 0)} players`);
  if (testTo) {
    const m = build(jobs[0]);
    const err = await send({ ...m, subject: "[TEST " + g + "] " + m.subject }, [testTo]);
    console.log(err ? "FAILED: " + err : `test sent (${jobs[0].players.join(", ")}'s wording)`);
  } else if (doSend) {
    let ok = 0;
    for (const j of jobs) {
      const err = await send(build(j), j.to);
      if (err) console.error("FAILED " + j.players.join("+") + ": " + err); else { ok++; console.log("sent " + j.players.join("+").padEnd(22) + "→ " + j.to.join(", ")); }
    }
    console.log(`${ok}/${jobs.length} sent`);
  } else {
    const m = build(jobs[0]);
    console.log("SUBJECT: " + m.subject + "\n" + m.text);
    for (const j of jobs.filter(x => x.players.length > 1)) console.log("  combined: " + j.players.join(" + ") + " → " + j.to.join(", "));
  }
}
if (!testTo && !doSend) console.log("\nDRY RUN — --test <email> or --send.");
