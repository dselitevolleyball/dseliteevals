// Parse a SportWrench / AES registration confirmation into per-team expense
// rows. The email states one TOTAL for a list of teams, so the per-team cost is
// the total divided by the team count — that division is the whole point, and
// doing it by hand across ten teams is where the errors come from.
//
// Rounding: split evenly to cents, then push the remainder onto the first team
// so the rows always sum back to the total exactly. A half-cent lost per team
// silently under-reports the event.

const CLUB_PREFIX = /^\s*DS\s*Elite\s+/i;

export function parseRegistrationEmail(text) {
  const body = String(text || "").replace(/\r/g, "");
  // These emails are label-then-value blocks, often with a blank line between
  // and sometimes "Label: value" inline. Walk the lines rather than regexing
  // across them — the blank line is what defeats the single-pattern approach.
  // The plain-text body of these emails collapses the whole purchase summary
  // onto ONE line with no separators:
  //   "Event2027 ATX ShowcaseTeam NameDS Elite 15 Diamond, …Purchase status"
  // so neither "label on its own line" nor "line starts with label" works.
  // Instead: find the label anywhere, and read to whichever known label comes
  // next. The labels themselves are the delimiters.
  const LABELS = ["Team Name", "Total amount", "Amount paid", "Date paid",
                  "Payment method", "Purchase status", "Event", "Name", "Email"];
  const lower = body.toLowerCase();
  const after = (label) => {
    const want = label.toLowerCase();
    const start = lower.indexOf(want);
    if (start < 0) return "";
    const from = start + want.length;
    let end = body.length;
    for (const other of LABELS) {
      const o = other.toLowerCase();
      // Skip labels that overlap this one ("Name" inside "Team Name"), or they
      // truncate the value to nothing.
      if (o === want || want.includes(o) || o.includes(want)) continue;
      const i = lower.indexOf(o, from);
      if (i >= 0 && i < end) end = i;
    }
    return body.slice(from, end).replace(/^[:\s]+/, "").trim();
  };

  const event = after("Event") || (body.split("\n").map(s => s.trim()).find(Boolean) || "");
  const teamsRaw = after("Team Name") || after("Teams");
  const totalRaw = after("Total amount") || after("Amount paid") || after("Total");
  const paidRaw = after("Date paid") || after("Payment date");
  const method = after("Payment method");

  // The value often runs straight into the following prose ("4377.24 If you
  // have any questions…"), so take the first number rather than demanding the
  // whole string parse. The guards stop it starting mid-number.
  const totalHit = /(?<![\d.,])([\d,]+(?:\.\d{2})?)(?![\d])/.exec(String(totalRaw || ""));
  const total = totalHit ? Number(totalHit[1].replace(/,/g, "")) : NaN;
  const teams = teamsRaw
    .split(/\s*,\s*/)
    .map(t => t.trim())
    .filter(Boolean)
    .map(t => t.replace(CLUB_PREFIX, "").trim())
    .filter(Boolean);

  // "10:19 AM, Aug 03, 2026" -> 2026-08-03
  let paidDate = null;
  const dm = /([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})/.exec(paidRaw || "");
  if (dm) {
    const mo = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"]
      .indexOf(dm[1].slice(0, 3).toLowerCase());
    if (mo >= 0) paidDate = `${dm[3]}-${String(mo + 1).padStart(2, "0")}-${String(+dm[2]).padStart(2, "0")}`;
  }

  const ok = !!(event && teams.length && Number.isFinite(total) && total > 0);
  let perTeam = [];
  if (ok) {
    const cents = Math.round(total * 100);
    const base = Math.floor(cents / teams.length);
    let left = cents - base * teams.length;          // remainder in whole cents
    perTeam = teams.map((t, i) => {
      const extra = i < left ? 1 : 0;                // spread, don't drop
      return { team: t, amount: (base + extra) / 100 };
    });
  }

  return {
    ok, event, total, teams, perTeam,
    paidDate, method: method || null,
    reason: ok ? null : (!event ? "no event name" : !teams.length ? "no team list" : "no total amount"),
  };
}
