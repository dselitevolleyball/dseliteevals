// SportsEngine's sale export → shoe_invoices rows, matched to players.
//
// Shared by the gear board's upload button (src/App.jsx) and the CLI
// (scripts/import-shoe-invoices.mjs), so both read the file the same way and
// match names the same way (shared/name-match.js).

import { matchPlayer } from "./name-match.js";

const money = (s) => { const n = parseFloat(String(s ?? "").replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : null; };
const when = (s) => {
  // "09/24/2026 12:44 PM" — SportsEngine shows Central; keep the wall clock, note the zone.
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

export { matchPlayer };

export function matchInvoicesToPlayers(invoices, players) {
  let matched = 0;
  for (const inv of invoices) {
    const { player, note } = matchPlayer(inv.participant, players, { parent: inv.account_owner });
    inv.player_id = player ? player.id : null;
    inv.match_note = note;
    if (player) matched++;
  }
  return { matched, unmatched: invoices.filter(i => !i.player_id) };
}
