// Twilio refuses any single message body over 1,600 characters (error 21617).
// Long notes to families get split into several texts, broken at a paragraph,
// then a sentence, then a space, each tagged "(1/3)" so they read in order.
export const SMS_MAX = 1600;
const PART = 1500; // leaves room for the " (1/3)" tag

export function splitSms(text) {
  const s = String(text || "");
  if (s.length <= SMS_MAX) return [s];
  const parts = [];
  let rest = s;
  while (rest.length > PART) {
    const win = rest.slice(0, PART);
    let cut = win.lastIndexOf("\n\n");
    if (cut < PART * 0.5) cut = Math.max(win.lastIndexOf(". "), win.lastIndexOf("! "), win.lastIndexOf("? "), win.lastIndexOf("\n")) + 1;
    if (cut < PART * 0.5) cut = win.lastIndexOf(" ");
    if (cut < PART * 0.5) cut = PART;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts.map((p, i) => `${p} (${i + 1}/${parts.length})`);
}
