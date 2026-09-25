// Match a name from an outside system (Playbook, SportsEngine) to a player.
//
// Outside systems have the girl as a parent typed her at sign-up, which is not
// always how the roster has her: "Katherine Stroop" is Kate, "Josephine
// Thiede" is Josie, "Elizabeth Brandl" is Lizzie. Matching is by last name
// first, then first name — exact, a prefix of the other, or a known nickname.
// A tie between two girls with the same name is broken by the parent's name
// or email when the caller has one, then by the one on a team that orders
// gear over a Rise player. Anything still ambiguous is left unmatched and
// reported rather than guessed: a wrong match marks the wrong girl done.

const letters = (s) => String(s || "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z\s-]/g, "").trim();
export const nameTokens = (s) => letters(s).split(/[\s-]+/).filter(Boolean);
// A roster first name can carry the name she goes by in parentheses —
// "(Kensleigh) O'ren" — and the other system may have either, so both count.
const firstTokens = (s) => String(s || "").toLowerCase().replace(/[^a-z\s-]/g, " ").split(/[\s-]+/).filter(Boolean);

// nickname → the formal names it stands for (letters only)
const NICK = {
  kate: ["katherine", "kathryn", "katelyn"], katie: ["katherine", "kathryn"], kat: ["katherine"],
  josie: ["josephine"], jo: ["josephine"],
  lizzie: ["elizabeth"], liz: ["elizabeth"], beth: ["elizabeth"], eliza: ["elizabeth"], libby: ["elizabeth"],
  ellie: ["eleanor", "elizabeth", "ellen"], nell: ["eleanor"],
  bella: ["isabella", "isabel"], izzy: ["isabella", "isabel"],
  millie: ["millicent", "amelia", "camille"], addie: ["addison", "adelaide"],
  maddie: ["madeline", "madeleine", "madison"], maddy: ["madeline", "madison"],
  lilly: ["lillian"], lilli: ["lillian"], lily: ["lillian"],
  becca: ["rebekah", "rebecca"], bekah: ["rebekah"],
  hattie: ["harriet"], gigi: ["gianna", "georgia"],
  ella: ["gabriella", "isabella", "eleanor"], lulu: ["louise", "lucy"],
  kenzie: ["mackenzie"], mac: ["mackenzie"], ally: ["allison", "alexandra"], allie: ["allison", "alexandra"],
  lexi: ["alexis", "alexandra"], alex: ["alexandra", "alexis"],
  charlie: ["charlotte"], lottie: ["charlotte"],
  vivi: ["vivienne", "vivian"], evie: ["evelyn", "genevieve"],
  penny: ["penelope"], posey: ["josephine"], bree: ["brianna"],
  sophie: ["sophia"], annie: ["anna", "anne"], nora: ["eleanor", "honora"],
  emmy: ["emily", "emma"], em: ["emily", "emma"], mia: ["amelia"],
};
const sameFirst = (a, b) => {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  if ((NICK[a] || []).includes(b) || (NICK[b] || []).includes(a)) return true;
  return false;
};
const email = (s) => String(s || "").trim().toLowerCase();

// hints: { parent: "Stephanie Ward", email: "stephanieward@x.com", strict: true }
// — parent/email break ties; strict refuses a last-name-only match (needed
// when the file also holds parents and coaches, who share a girl's surname).
export function matchPlayer(name, players, hints = {}) {
  const toks = nameTokens(name);
  if (toks.length < 2) return { player: null, note: "one-word name" };
  const first = toks[0];
  const last = toks[toks.length - 1];
  const byLast = (players || []).filter(p => {
    const lt = nameTokens(p.last_name);
    const ltJoined = lt.join("");
    // "Carey-McWilliams" ↔ "McWilliams"; "Kensleigh O'ren Smith" ↔ "Smith";
    // "Briar Carey-McWilliams" ↔ "Carey-McWilliams". Whole trailing tokens
    // only — "Breanna Coward" must not end in "Ward".
    if (lt.includes(last)) return true;
    for (let k = 1; k < toks.length; k++) if (toks.slice(-k).join("") === ltJoined) return true;
    return false;
  });
  if (!byLast.length) return { player: null, note: "no player with last name " + last };
  const live = byLast.filter(p => !["declined", "not_invited", "opted_out"].includes(p.offer_status || "") && (p.roster_status || "active") === "active");
  const pool = live.length ? live : byLast;
  if (pool.length === 1) {
    const p = pool[0];
    const ok = firstTokens(p.first_name).some(f => sameFirst(f, first));
    if (ok) return { player: p, note: null };
    const note = "first name differs: " + name + " ↔ " + p.first_name + " " + p.last_name;
    return hints.strict ? { player: null, note } : { player: p, note };
  }
  const byFirst = pool.filter(p => firstTokens(p.first_name).some(f => sameFirst(f, first)));
  if (byFirst.length === 1) return { player: byFirst[0], note: null };
  if (byFirst.length > 1) {
    const em = email(hints.email);
    const emailHit = em ? byFirst.filter(p => [p.parent_email, p.parent_email2, p.parent_email3, p.player_email].some(x => email(x) === em)) : [];
    if (emailHit.length === 1) return { player: emailHit[0], note: "matched by email " + em };
    const owner = nameTokens(hints.parent);
    const parentHit = owner.length ? byFirst.filter(p => [p.parent_name, p.parent2_name].some(n => {
      const nt = nameTokens(n); return nt.length && nt[0] === owner[0] && nt[nt.length - 1] === owner[owner.length - 1];
    })) : [];
    if (parentHit.length === 1) return { player: parentHit[0], note: "matched by parent " + hints.parent };
    const gearTeam = byFirst.filter(p => p.team_assignment && !/rise/i.test(p.team_assignment));
    if (gearTeam.length === 1) return { player: gearTeam[0], note: "two " + name + "s — took the one on " + gearTeam[0].team_assignment + " (the other is Rise)" };
  }
  return { player: null, note: (byFirst.length ? "several players match: " : "same last name, different first names: ") + pool.map(p => p.first_name + " " + p.last_name).join(", ") };
}

// The columns a matcher needs from players — one select for every importer.
export const PLAYER_MATCH_COLUMNS = "id, first_name, last_name, team_assignment, offer_status, roster_status, parent_name, parent2_name, parent_email, parent_email2, parent_email3";
