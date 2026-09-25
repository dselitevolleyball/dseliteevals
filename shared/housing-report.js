// Stay-to-play housing: parse a bureau's "pickup report" email and match each
// booked room to a player (or a coach) so the club can see who hasn't booked.
//
// KC Sports Housing's report is an HTML table. Pasted out of Gmail it arrives
// one cell per line (blank lines between), the header cells first, then each
// row starting with its row number. Copied straight from the table it can also
// come tab-separated. Both are handled; anything else parses to nothing rather
// than to nonsense.
//
// Matching is deliberately generous — the parent books under their own name,
// or the player's, from any email or phone the family uses — and then
// tightened by the team column and by never letting one player absorb two
// rooms when a sibling on the same trip could own the second.

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
const lower = (s) => clean(s).toLowerCase();
const digits = (s) => String(s || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const ACK_RE = /^[A-Z0-9]{6,12}$/;
const toISO = (mdy) => { const m = DATE_RE.exec(clean(mdy)); return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null; };

const HEADER_KEYS = [
  [/^event$/i, "event"], [/^hotel$/i, "hotel"], [/^last\s*name$/i, "last_name"], [/^first\s*name$/i, "first_name"],
  [/^club\s*name$/i, "club_name"], [/^team$/i, "team_raw"], [/^e-?mail$/i, "email"], [/^phone/i, "phone"],
  [/^check-?\s*in$/i, "check_in"], [/^check-?\s*out$/i, "check_out"], [/^(number\s*of\s*)?nights$/i, "nights"],
  [/^room\s*type$/i, "room_type"], [/^ack/i, "ack_number"], [/^share/i, "share_with"],
];
const keyFor = (h) => (HEADER_KEYS.find(([re]) => re.test(clean(h))) || [])[1] || null;

function finish(b) {
  return {
    row_no: b.row_no != null ? Number(b.row_no) : null,
    hotel: clean(b.hotel) || null, last_name: clean(b.last_name) || null, first_name: clean(b.first_name) || null,
    club_name: clean(b.club_name) || null, team_raw: clean(b.team_raw) || null,
    email: lower(b.email) || null, phone: clean(b.phone) || null,
    check_in: toISO(b.check_in), check_out: toISO(b.check_out),
    nights: /^\d+$/.test(clean(b.nights)) ? Number(clean(b.nights)) : null,
    room_type: clean(b.room_type) || null, ack_number: clean(b.ack_number) || null,
    share_with: clean(b.share_with).replace(/\s*;\s*/g, "; ") || null,
  };
}

// Tab-separated: header row names the columns, in whatever order.
function parseTsv(lines) {
  const rows = lines.filter(l => l.includes("\t")).map(l => l.split("\t").map(clean));
  const hi = rows.findIndex(r => r.filter(keyFor).length >= 6);
  if (hi < 0) return [];
  const keys = rows[hi].map(keyFor);
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const b = {};
    r.forEach((v, i) => { if (keys[i]) b[keys[i]] = v; else if (i === 0 && /^\d+$/.test(v)) b.row_no = v; });
    if (b.last_name || b.email) out.push(finish(b));
  }
  return out;
}

// One cell per line (a Gmail paste). Anchor on the email cell: the six lines
// before it are event, hotel, last, first, club, team; after it come phone,
// check-in, check-out, nights, room type, acknowledgement, then "share with"
// until the next row number.
function parseLines(lines) {
  const L = lines.map(clean).filter(Boolean);
  let start = L.findIndex(l => /^share\s*with$/i.test(l));
  if (start < 0) start = 0; else start += 1;
  const out = [];
  let i = start;
  while (i < L.length) {
    if (!/^\d{1,3}$/.test(L[i])) { i++; continue; }
    const rowNo = Number(L[i]);
    // Email within the next 9 lines, else this number wasn't a row number.
    let e = -1;
    for (let k = i + 1; k <= Math.min(i + 9, L.length - 1); k++) if (EMAIL_RE.test(L[k])) { e = k; break; }
    if (e < 0) { i++; continue; }
    const before = L.slice(i + 1, e);
    const b = { row_no: rowNo, email: L[e] };
    // Right-align the six leading cells; a missing event/hotel just shifts.
    const names = ["event", "hotel", "last_name", "first_name", "club_name", "team_raw"];
    const off = names.length - before.length;
    before.forEach((v, k) => { const key = names[k + Math.max(0, off)]; if (key) b[key] = v; });
    let k = e + 1;
    b.phone = L[k++]; b.check_in = L[k++]; b.check_out = L[k++]; b.nights = L[k++];
    // Room type may wrap; keep taking lines until the acknowledgement number.
    const room = [];
    while (k < L.length && !ACK_RE.test(L[k]) && room.length < 4) room.push(L[k++]);
    b.room_type = room.join(" ");
    if (k < L.length && ACK_RE.test(L[k])) b.ack_number = L[k++];
    // Share-with runs until the next row number (or the sign-off).
    const share = [];
    while (k < L.length) {
      const l = L[k];
      if (/^\d{1,3}$/.test(l) && Number(l) === rowNo + 1) break;
      if (/^(sincerely|thank|regards|best)/i.test(l)) break;
      share.push(l); k++;
      if (share.length > 8) break;
    }
    b.share_with = share.join(" ");
    out.push(finish(b));
    i = k;
  }
  return out;
}

export function parsePickupReport(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const tsv = lines.some(l => (l.match(/\t/g) || []).length >= 8) ? parseTsv(lines) : [];
  if (tsv.length) return tsv;
  return parseLines(lines);
}

// ── Matching ────────────────────────────────────────────────────────────────
// players: rows from `players` (team_assignment, names, parent contacts)
// coaches: rows from coach_roster (first_name, last_name, email, phone)
// teams:   team names at this tournament
export function matchBookings(bookings, players, coaches, teams) {
  const teamSet = new Set(teams);
  const pool = players.filter(p => teamSet.has(p.team_assignment) && !["declined", "not_invited", "opted_out"].includes(p.offer_status || ""));
  const fullName = (p) => lower((p.first_name || "") + " " + (p.last_name || ""));
  const emailsOf = (p) => [p.parent_email, p.parent_email2, p.parent_email3, p.player_email].map(lower).filter(Boolean);
  const phonesOf = (p) => [p.parent_phone, p.parent2_phone, p.player_phone].map(digits).filter(d => d.length >= 10);
  const parentNames = (p) => [p.parent_name, p.parent2_name].map(lower).filter(Boolean);
  const coachNames = coaches.map(c => ({ c, full: lower((c.first_name || "") + " " + (c.last_name || "")), email: lower(c.email), phone: digits(c.phone) }));
  const taken = new Set();   // player ids already owning a room

  const results = bookings.map(b => {
    const bLast = lower(b.last_name), bFull = lower((b.first_name || "") + " " + (b.last_name || ""));
    const bEmail = lower(b.email), bPhone = digits(b.phone), share = lower(b.share_with);
    const teamHint = lower(b.team_raw);
    const hintOk = (p) => !teamHint || lower(p.team_assignment).split(" ").every(w => teamHint.includes(w)) || !/\d/.test(teamHint);

    // Staff first: a coach's own booking, or a room shared with a coach.
    const staff = coachNames.find(c => (c.email && c.email === bEmail) || (c.phone && c.phone === bPhone) || (c.full && (c.full === bFull || (share && share.includes(c.full)))));
    if (staff && !pool.some(p => emailsOf(p).includes(bEmail) || phonesOf(p).includes(bPhone))) {
      return { ...b, is_staff: true, matched_player_id: null, matched_team: null, match_how: "coach", staff_name: (staff.c.first_name + " " + staff.c.last_name).trim(), candidates: [] };
    }

    const tries = [
      ["email", p => bEmail && emailsOf(p).includes(bEmail)],
      ["phone", p => bPhone.length >= 10 && phonesOf(p).includes(bPhone)],
      ["player name", p => bFull && fullName(p) === bFull],
      ["share with", p => share && share.includes(fullName(p))],
      ["parent name", p => bFull && parentNames(p).some(n => n === bFull)],
      ["last name", p => bLast && lower(p.last_name) === bLast],
      ["last name", p => bLast && bLast.length > 3 && (lower(p.last_name).includes(bLast) || parentNames(p).some(n => n.endsWith(" " + bLast)))],
    ];
    for (const [how, test] of tries) {
      let cands = pool.filter(test);
      if (cands.length > 1) { const h = cands.filter(hintOk); if (h.length) cands = h; }
      if (cands.length > 1) { const free = cands.filter(p => !taken.has(p.id)); if (free.length) cands = free; }
      if (cands.length === 1) {
        const p = cands[0]; taken.add(p.id);
        return { ...b, is_staff: false, matched_player_id: p.id, matched_team: p.team_assignment, match_how: how, candidates: [] };
      }
      if (cands.length > 1) return { ...b, is_staff: false, matched_player_id: null, matched_team: null, match_how: null, candidates: cands.map(p => ({ id: p.id, name: (p.first_name + " " + p.last_name).trim(), team: p.team_assignment })) };
    }
    return { ...b, is_staff: false, matched_player_id: null, matched_team: null, match_how: null, candidates: [] };
  });

  const bookedIds = new Set(results.filter(r => r.matched_player_id).map(r => r.matched_player_id));
  const unbooked = pool.filter(p => !bookedIds.has(p.id)).sort((a, b) => a.team_assignment.localeCompare(b.team_assignment) || (a.last_name || "").localeCompare(b.last_name || ""));
  return { bookings: results, unbooked, pool };
}
