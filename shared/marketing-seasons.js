// The year as a youth sports club in Dripping Springs, TX lives it: holidays,
// school breaks, seasons and "days" worth a post. The idea scout
// (api/_lib/marketing-scout.js) reads the next few weeks of these, alongside
// local news and the club's own programs. Pure ESM, no I/O.
//
// Dates are computed for any year. School dates (breaks, first/last day) are
// the usual Texas pattern and marked approx - the scout says "around" and
// checks the district calendar through web search when it can.
//
// moments(from, days) -> [{ key, name, kind, start, end, approx, lines, idea, days_out }]
//   kind: holiday | school | season | day | fun

const ymd = (d) => d.toISOString().slice(0, 10);
const D = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const add = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
// The n-th weekday (0 Sun..6 Sat) of a month; n = -1 is the last one.
export function nthWeekday(y, m, wd, n) {
  if (n > 0) { const first = D(y, m, 1); return add(first, (wd - first.getUTCDay() + 7) % 7 + (n - 1) * 7); }
  const last = D(y, m + 1, 0); return add(last, -((last.getUTCDay() - wd + 7) % 7));
}
// Easter Sunday (anonymous Gregorian algorithm).
export function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return D(y, month, day);
}

function yearMoments(y) {
  const M = (key, name, kind, start, end, lines, idea, approx = false) => ({ key: `${key}-${y}`, name, kind, start: ymd(start), end: ymd(end || start), approx, lines, idea });
  const thanksgiving = nthWeekday(y, 11, 4, 4);
  const memorial = nthWeekday(y, 5, 1, -1);
  return [
    M("new-year", "New Year's Day", "holiday", D(y, 1, 1), null, ["club", "reach"], "New year, new goals - what is your athlete working on this year? Fresh-start programs."),
    M("mlk", "Martin Luther King Jr. Day", "holiday", nthWeekday(y, 1, 1, 3), null, ["camp_elevate", "open_gym"], "A Monday off school - a day to play; honor the day with a service or community note.", true),
    M("girls-women-sports", "National Girls & Women in Sports Day", "day", nthWeekday(y, 2, 3, 1), null, ["volleyball", "basketball"], "Celebrate the girls and women who play at DSSC - Women's Academy, girls' pods and teams."),
    M("super-bowl", "Super Bowl weekend", "fun", add(nthWeekday(y, 2, 0, 2), -2), nthWeekday(y, 2, 0, 2), ["club"], "Big-game energy: a fun this-or-that, or the club's own 'MVP' of the week."),
    M("valentines", "Valentine's Day", "fun", D(y, 2, 14), null, ["club", "parties"], "Love the game: what athletes love about their sport; partner-drill fun."),
    M("presidents", "Presidents' Day", "holiday", nthWeekday(y, 2, 1, 3), null, ["camp_elevate", "open_gym"], "Often a school holiday - a day-off camp or open gym.", true),
    M("spring-forward", "Clocks spring forward", "fun", nthWeekday(y, 3, 0, 2), null, ["club"], "More daylight - spring season energy, what's starting this spring."),
    M("spring-break", "Spring break", "school", nthWeekday(y, 3, 1, 2), add(nthWeekday(y, 3, 1, 2), 4), ["camp_elevate", "open_gym"], "Spring break: camps, clinics and open gym for kids who are home.", true),
    M("march-madness", "March Madness", "season", add(nthWeekday(y, 3, 0, 3), -4), add(nthWeekday(y, 4, 1, 1), 1), ["basketball"], "Bracket season: basketball fun - a shooting challenge, 'who's your pick', skill-lab highlights.", true),
    M("april-fools", "April Fools' Day", "fun", D(y, 4, 1), null, ["club"], "A light, obviously-a-joke post (never about prices or programs)."),
    M("easter", "Easter weekend", "holiday", add(easter(y), -2), easter(y), ["club", "parties"], "A spring weekend note; family time."),
    M("teacher-appreciation", "Teacher Appreciation Week", "day", nthWeekday(y, 5, 1, 1), add(nthWeekday(y, 5, 1, 1), 4), ["club"], "Coaches are teachers too - thank them; a coach spotlight fits here."),
    M("mothers-day", "Mother's Day", "holiday", nthWeekday(y, 5, 0, 2), null, ["club"], "Thank the sports moms - every drop-off, every tournament weekend."),
    M("school-out", "Last week of school", "school", add(memorial, -7), add(memorial, -3), ["camp_elevate", "club"], "School's out: summer camps and programs - lock in the summer plan.", true),
    M("memorial", "Memorial Day", "holiday", memorial, null, ["club"], "A respectful remembrance post; no sales."),
    M("summer", "Summer break", "season", D(y, 6, 1), D(y, 8, 5), ["camp_elevate", "volleyball", "basketball", "reach"], "Summer camps, training blocks and keeping athletes moving.", true),
    M("fathers-day", "Father's Day", "holiday", nthWeekday(y, 6, 0, 3), null, ["club"], "Thank the sports dads - rebounders, drivers, sideline coaches."),
    M("july4", "Independence Day", "holiday", D(y, 7, 4), null, ["club"], "Fourth of July: red-white-and-blue team photos, a holiday-hours note."),
    M("back-to-school", "Back to school", "school", nthWeekday(y, 8, 3, 2), add(nthWeekday(y, 8, 3, 2), 9), ["volleyball", "basketball", "reach", "club"], "Back to school, back to the gym: fall programs and the weekly routine.", true),
    M("labor-day", "Labor Day", "holiday", nthWeekday(y, 9, 1, 1), null, ["open_gym", "club"], "A long weekend - open gym or a family day."),
    M("coaches-day", "National Coaches Day", "day", D(y, 10, 6), null, ["club", "volleyball", "basketball", "reach"], "Thank a coach: the perfect week for a coach spotlight."),
    M("tryout-season", "Club volleyball tryout season", "season", D(y, 10, 15), D(y, 11, 20), ["volleyball"], "Tryout prep: confidence, skills and what to expect.", true),
    M("halloween", "Halloween", "fun", D(y, 10, 31), null, ["club", "parties"], "Costume practice, spooky-good drills, a 'which monster are you on the court' post."),
    M("fall-back", "Clocks fall back", "fun", nthWeekday(y, 11, 0, 1), null, ["reach", "open_gym"], "Darker evenings - indoor training is the move."),
    M("veterans", "Veterans Day", "holiday", D(y, 11, 11), null, ["club"], "A respectful thank-you to veterans in the DSSC family; no sales."),
    M("thanksgiving-break", "Thanksgiving break", "school", add(thanksgiving, -3), add(thanksgiving, 1), ["camp_elevate", "volleyball", "basketball"], "Thanksgiving break: camps for kids who are home, and a thankful post.", true),
    M("thanksgiving", "Thanksgiving", "holiday", thanksgiving, null, ["club"], "What the club is thankful for - families, coaches, athletes."),
    M("winter-break", "Winter break", "school", D(y, 12, 21), D(y + 1, 1, 3), ["camp_elevate", "open_gym", "club"], "Winter break camps and open gym; holiday hours.", true),
    M("christmas", "Christmas", "holiday", D(y, 12, 24), D(y, 12, 25), ["club"], "Merry Christmas from DSSC; holiday hours."),
    M("new-years-eve", "New Year's Eve", "fun", D(y, 12, 31), null, ["club", "reach"], "Year in review: the club's best moments; next year's goals."),
  ];
}

const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5);

// Every moment that overlaps [from, from + days], soonest first.
export function moments(from, days = 21) {
  const to = ymd(add(new Date(from + "T00:00:00Z"), days));
  const y0 = +from.slice(0, 4), y1 = +to.slice(0, 4);
  const out = [];
  for (let y = y0 - 1; y <= y1; y++) for (const m of yearMoments(y)) if (m.end >= from && m.start <= to) out.push({ ...m, days_out: Math.max(0, daysBetween(from, m.start)) });
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.key.localeCompare(b.key));
}
