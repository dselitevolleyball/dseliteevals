// Playbook's sale export → shoe_invoices rows, matched to players.
//
// Shared by the gear board's upload button (src/App.jsx) and the CLI
// (scripts/import-shoe-invoices.mjs), so both read the file the same way and
// match names the same way.
//
// Playbook has the player as the parent typed her at registration, which is
// not always how the roster has her: "Katherine Stroop" is Kate, "Josephine
// Thiede" is Josie, "Elizabeth Brandl" is Lizzie. Matching is by last name
// first, then first name — exact, a prefix of the other, or a known nickname.
// Anything still ambiguous is left unmatched and shown on the board rather
// than guessed: a wrong match marks the wrong girl's shoes paid.

const letters = (s) => String(s || "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z\s-]/g, "").trim();
const tokens = (s) => letters(s).split(/[\s-]+/).filter(Boolean);

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
  hattie: ["harriet"], hadley: ["hadley"], gigi: ["gianna", "georgia"],
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

const money = (s) => { const n = parseFloat(String(s ?? "").replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : null; };
const when = (s) => {
  // "09/24/2026 12:44 PM" — Playbook is Central; keep the wall clock, note the zone.
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(String(s || "").trim());
  if (!m) return null;
  let h = Number(m[4]) % 12; if (/p/i.test(m[6] || "")) h += 12;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}T${String(h).padStart(2, "0")}:${m[5]}:00-05:00`;
};

// Papa-parsed rows (header: true) → invoice rows. Only the shoe item.
export function parseSaleRows(rows) {
  const out = [];
  for (const r of rows || []) {
    const item = String(r["Item Name"] || "").trim();
    const sale = String(r["Sale ID"] || "").trim();
    const participant = String(r["Participant"] || "").trim();
    if (!sale || !participant) continue;
    if (item && !/shoe/i.test(item)) continue;
    out.push({
      sale_id: sale, sale_date: when(r["Sale Date"]), account_owner: String(r["Account Owner"] || "").trim() || null,
      participant, item_name: item || null,
      price: money(r["Item Price"]), paid: money(r["Paid"]), remaining: money(r["Remaining"]),
      status: String(r["Status"] || "").trim() || null, player_id: null, match_note: null,
    });
  }
  return out;
}

// A roster first name can carry the name she goes by in parentheses —
// "(Kensleigh) O'ren" — and Playbook may have either, so both count.
const firstTokens = (s) => String(s || "").toLowerCase().replace(/[^a-z\s-]/g, " ").split(/[\s-]+/).filter(Boolean);

// Find the player an invoice is for. Prefers girls on the current roster.
// accountOwner (the parent invoiced) breaks a tie between two girls with the
// same name on different teams; failing that, the one on a team that orders
// gear wins over a Rise player, since Rise families aren't invoiced for shoes.
export function matchPlayer(participant, players, accountOwner) {
  const toks = tokens(participant);
  if (toks.length < 2) return { player: null, note: "one-word name" };
  const first = toks[0];
  const last = toks[toks.length - 1];
  const full = toks.join("");
  const lastOf = (p) => tokens(p.last_name);
  const byLast = (players || []).filter(p => {
    const lt = lastOf(p);
    // "Carey-McWilliams" ↔ "McWilliams"; "O'ren Smith" ↔ "Smith"
    return lt.includes(last) || lt.join("") === toks.slice(1).join("") || full.endsWith(lt.join(""));
  });
  if (!byLast.length) return { player: null, note: "no player with last name " + last };
  const live = byLast.filter(p => !["declined", "not_invited", "opted_out"].includes(p.offer_status || "") && (p.roster_status || "active") === "active");
  const pool = live.length ? live : byLast;
  if (pool.length === 1) {
    const p = pool[0];
    const ok = firstTokens(p.first_name).some(f => sameFirst(f, first));
    return ok ? { player: p, note: null } : { player: p, note: "first name differs: " + participant + " ↔ " + p.first_name + " " + p.last_name };
  }
  const byFirst = pool.filter(p => firstTokens(p.first_name).some(f => sameFirst(f, first)));
  if (byFirst.length === 1) return { player: byFirst[0], note: null };
  if (byFirst.length > 1) {
    const owner = tokens(accountOwner);
    const parentHit = byFirst.filter(p => owner.length && [p.parent_name, p.parent2_name].some(n => {
      const nt = tokens(n); return nt.length && nt[0] === owner[0] && nt[nt.length - 1] === owner[owner.length - 1];
    }));
    if (parentHit.length === 1) return { player: parentHit[0], note: "matched by parent " + accountOwner };
    const gearTeam = byFirst.filter(p => p.team_assignment && !/rise/i.test(p.team_assignment));
    if (gearTeam.length === 1) return { player: gearTeam[0], note: "two " + participant + "s — took the one on " + gearTeam[0].team_assignment + " (the other is Rise)" };
  }
  return { player: null, note: (byFirst.length ? "several players match: " : "same last name, different first names: ") + pool.map(p => p.first_name + " " + p.last_name).join(", ") };
}

export function matchInvoicesToPlayers(invoices, players) {
  let matched = 0;
  for (const inv of invoices) {
    const { player, note } = matchPlayer(inv.participant, players, inv.account_owner);
    inv.player_id = player ? player.id : null;
    inv.match_note = note;
    if (player) matched++;
  }
  return { matched, unmatched: invoices.filter(i => !i.player_id) };
}
