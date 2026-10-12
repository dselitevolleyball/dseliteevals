// Who a personal email about a player goes to, and how it greets them.
//
// Drew, Oct 12 2026: "a divorced toggle for all of our players so we know when
// to send emails separately to parents instead of together … some divorced
// parents would expect to see an email individually sent." players.parents_separate:
//   false → one email to every parent address, "Hi Sarah and Mike,"
//   true  → one email per parent: Parent Email ↔ Parent Name, Parent Email 2 ↔
//           Parent 2 Name, Parent Email 3 on its own; each greets only its parent.
// Use it for anything that names the parents or is sent "to the family"
// (testing reports, Waiting-on nudges, send scripts). Team blasts through
// /api/send-email already go one address at a time with no names, so they
// don't need it.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const first = (n) => String(n || "").trim().split(/\s+/)[0] || "";
const clean = (e) => String(e || "").trim().toLowerCase();
const joinNames = (ns) => ns.length <= 1 ? (ns[0] || "") : ns.slice(0, -1).join(", ") + " and " + ns[ns.length - 1];

// [{ to: [emails], parentFirst: "Sarah" | "Sarah and Mike" | "" }]
export function parentMailings(p) {
  if (!p) return [];
  const slots = [[p.parent_email, p.parent_name], [p.parent_email2, p.parent2_name], [p.parent_email3, null]]
    .map(([e, n]) => ({ email: clean(e), name: first(n) })).filter(s => EMAIL_RE.test(s.email));
  const seen = new Set(), uniq = slots.filter(s => !seen.has(s.email) && seen.add(s.email));
  if (!uniq.length) return [];
  if (p.parents_separate) return uniq.map(s => ({ to: [s.email], parentFirst: s.name }));
  const names = [...new Set([first(p.parent_name), first(p.parent2_name)].filter(Boolean))];
  return [{ to: uniq.map(s => s.email), parentFirst: joinNames(names) }];
}

export const greetingFor = (parentFirst) => parentFirst ? `Hi ${parentFirst},` : "Hi,";
