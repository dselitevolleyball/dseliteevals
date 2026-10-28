// The Dripping Springs Sports Club directors - the people the shared inbox
// (HQ -> DSSC -> Inbox) routes to and who may work it. One list for the
// server (api/site-inbox*.js) and the app (src/dssc/DsscInbox.jsx); the SQL
// twin is is_dssc_director() in migrations/20261020_site_inbox.sql - keep the
// three in step.
//
// Adrian uses adrian@drippingsportsclub.com (Drew, Oct 28 2026; it was
// adrian@4thquarterathlete.com from Oct 14 to 28).

export const DSSC_DIRECTORS = [
  { email: "drew@drippingsportsclub.com",     name: "Drew Rose",         role: "Owner",                  also: ["drew@dselitevolleyball.com"] },
  { email: "jonathan@drippingsportsclub.com", name: "Jonathan DelaRosa", role: "Director of Operations" },
  { email: "hunter@drippingsportsclub.com",   name: "Hunter Haley",      role: "Director of Volleyball", also: ["hunterhaleysc10@gmail.com"] },
  { email: "adrian@drippingsportsclub.com",    name: "Adrian Thomas",     role: "Director of Basketball", also: ["adrian@4thquarterathlete.com"] },
  { email: "brandon@drippingsportsclub.com",  name: "Brandon",           role: "Reach Performance" },
  { email: "deroald@drippingsportsclub.com",  name: "Deroald",           role: "DSSC admin" },
];

export const DSSC_INBOX_ADDRESS = "info@drippingsportsclub.com";
export const DSSC_HQ_URL = "https://www.drippingsportsclub.com/hq";
// The deep link an email carries to one thread (App.jsx reads ?inquiry=).
export const inboxThreadUrl = (id) => `${DSSC_HQ_URL}/?view=dsscinbox&inquiry=${encodeURIComponent(id)}`;

const lower = (v) => String(v || "").trim().toLowerCase();
export const directorByEmail = (email) => { const e = lower(email); return e ? DSSC_DIRECTORS.find(d => d.email === e || (d.also || []).includes(e)) || null : null; };
export const isDirectorEmail = (email) => !!directorByEmail(email);
export const directorEmails = () => DSSC_DIRECTORS.flatMap(d => [d.email, ...(d.also || [])]);
// hunterhaleysc10@gmail.com -> hunter@drippingsportsclub.com: one name per person in "Assigned to".
export const canonicalDirectorEmail = (email) => directorByEmail(email)?.email || lower(email) || null;
export const directorName = (email) => directorByEmail(email)?.name || String(email || "").split("@")[0] || "";
export const initialsOf = (name) => String(name || "").split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");

// What a thread is about. The website's forms send `kind`; the DS Elite
// contact form's topics (tryouts, general, coaching, other) are kinds too, and
// mail read from info@ is 'email'.
export const KIND_LABELS = {
  rental: "Court rental", party: "Birthday party", reach: "Reach Performance", contact: "Contact form",
  camp: "Camp", league: "League", opengym: "Open gym", membership: "Membership", email: "Email",
  tryouts: "Tryouts", general: "General question", coaching: "Coaching", other: "Other",
};
export const KINDS = Object.keys(KIND_LABELS);
export const kindLabel = (k) => KIND_LABELS[k] || (k ? k[0].toUpperCase() + k.slice(1) : "Message");
export const SPORT_LABELS = { volleyball: "Volleyball", basketball: "Basketball", reach: "Reach" };
export function normSport(v) {
  const s = lower(v);
  if (!s) return null;
  if (/basket|bball|hoop/.test(s)) return "basketball";
  if (/volley|vball/.test(s)) return "volleyball";
  if (/reach|perform|strength|speed|agility|conditioning/.test(s)) return "reach";
  return null;
}
// The sport a thread belongs to: the form's sport, or implied by its kind.
export const inquirySport = ({ kind, sport } = {}) => normSport(sport) || (kind === "reach" ? "reach" : null);

// Who is told about a new message. A sport wins over a kind; everything else
// is the front desk (Jonathan); Drew is copied on all of it. Env
// DSSC_INBOX_ROUTES (a JSON object with these same keys -> comma lists) can
// override any entry without a deploy.
export const DEFAULT_ROUTES = {
  volleyball: "hunter@drippingsportsclub.com",
  basketball: "adrian@drippingsportsclub.com, jonathan@drippingsportsclub.com",
  reach: "brandon@drippingsportsclub.com",
  rental: "jonathan@drippingsportsclub.com",
  party: "jonathan@drippingsportsclub.com",
  league: "jonathan@drippingsportsclub.com",
  opengym: "jonathan@drippingsportsclub.com",
  membership: "jonathan@drippingsportsclub.com",
  contact: "jonathan@drippingsportsclub.com",
  email: "jonathan@drippingsportsclub.com",
  default: "jonathan@drippingsportsclub.com",
  cc: "drew@drippingsportsclub.com",
};
const emailList = (v) => [...new Set(String(v || "").split(/[,;\s]+/).map(lower).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))];
export function routeInquiry({ kind, sport } = {}, overrides) {
  const routes = { ...DEFAULT_ROUTES, ...(overrides && typeof overrides === "object" ? overrides : {}) };
  const sp = inquirySport({ kind, sport });
  let to = sp ? emailList(routes[sp]) : [];
  if (!to.length && kind) to = emailList(routes[kind]);
  if (!to.length) to = emailList(routes.default);
  const cc = emailList(routes.cc).filter(e => !to.includes(e));
  return { to, cc, sport: sp };
}
