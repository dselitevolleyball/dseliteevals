// US phone numbers. In a real (NANP) number neither the area code nor the
// exchange starts with 0 or 1, so "+11512712636" - a 1 typed in front of a
// 9-digit number, which Playbook lets families save - passes a plain
// "10 digits" check but Twilio refuses it every time (error 21211). These
// helpers call such a number "no phone" instead, so it's never texted.
export const isUsPhone = (e) => /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(String(e || ""));
// Any way a US number gets written → "+1XXXXXXXXXX", or null.
export function usE164(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  const out = d.length === 10 ? "+1" + d : d.length === 11 && d.startsWith("1") ? "+" + d : null;
  return out && isUsPhone(out) ? out : null;
}
