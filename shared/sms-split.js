// What a text looks like on the wire. Every text goes through smsPlain then
// splitSms in sendOneSms (api/_lib/sms.js), so the composers' counters use the
// same two functions to show what will really go out.
//
// Carriers drop long texts that carry emoji or "smart" punctuation (error
// 30019, content size exceeds carrier limit). One emoji switches the whole text
// to the 67-characters-per-piece format; Coach Hunter's Oct 11 2026 clinic
// blast was ~900 characters with emoji, about 14 pieces, and 53 of 124 families
// never got it. So (Drew, Oct 13 2026: "yes please change it"):
//   smsPlain  - curly quotes, dashes, bullets, ellipses become plain ASCII,
//               accents are dropped (José -> Jose), emoji are removed
//   splitSms  - anything over SMS_MAX goes out as numbered parts, "(1/2)",
//               broken at a paragraph, then a sentence, then a space
export const SMS_MAX = 600;
const PART = 585; // leaves room for the " (1/3)" tag

const SWAP = [
  [/[‘’‚‛′´`]/g, "'"],
  [/[“”„‟″]/g, '"'],
  [/[‐-―−]/g, "-"],
  [/…/g, "..."],
  [/[•‣▪●◦⁃∙·]/g, "-"],
  [/[  -   　]/g, " "],
  [/[→➡➔]/g, "->"],
  [/×/g, "x"],
  [/½/g, "1/2"], [/¼/g, "1/4"], [/¾/g, "3/4"],
  [/°/g, " deg"],
  [/™/g, "TM"], [/®/g, "(R)"], [/©/g, "(C)"],
  [/€/g, "EUR"], [/£/g, "GBP"],
];

export function smsPlain(text) {
  let s = String(text || "").replace(/\r\n?/g, "\n");
  for (const [re, to] of SWAP) s = s.replace(re, to);
  s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");   // é -> e
  s = s.replace(/[^\x00-\x7F]/g, "");                        // emoji and anything else
  // Tidy what the emoji left behind: "💪 CLINIC 🏐" -> "CLINIC", "• 🏋️ Get" -> "- Get".
  s = s.split("\n").map(l => l.replace(/[ \t]{2,}/g, " ").replace(/^([-*]) +/, "$1 ").replace(/^ +| +$/g, "")).join("\n");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

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

// For the composers: what the counter under a message box should say.
export function smsPreview(text) {
  const plain = smsPlain(text), parts = splitSms(plain);
  return { plain, parts: parts.length, chars: plain.length, cleaned: plain !== String(text || "").replace(/\r\n?/g, "\n").trim() };
}
