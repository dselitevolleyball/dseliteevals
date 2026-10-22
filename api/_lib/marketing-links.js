// One-tap links for the directors' marketing emails ("Make this post",
// "Send the interview to Coach X"). Each link is signed (HMAC with the
// unsubscribe secret, a separate "act:" key) and expires after a week. The
// link opens a confirm page and only a POST from that page acts, so a mail
// scanner that follows links can't make a post or text a coach.
// Handled by api/marketing-act.js.

import { createHmac } from "node:crypto";
import { unsubSecret, publicBase } from "./marketing-publish.js";
import { safeEqual } from "./site-inbox.js";

export const ACTIONS = ["idea", "spot_send", "spot_draft"];
const sig = (a, id, x) => createHmac("sha256", "act:" + unsubSecret()).update(`${a}:${id}:${x}`).digest("base64url").slice(0, 32);

export function actUrl(a, id, { days = 7, now = Date.now() } = {}) {
  const x = Math.floor(now / 1000) + days * 86400;
  return `${publicBase()}/api/marketing-act?a=${encodeURIComponent(a)}&id=${encodeURIComponent(id)}&x=${x}&t=${sig(a, id, x)}`;
}
export function verifyAct(a, id, x, t, { now = Date.now() } = {}) {
  return !!unsubSecret() && ACTIONS.includes(a) && /^\d+$/.test(String(id)) && Number(x) > now / 1000 && safeEqual(sig(a, id, x), String(t || ""));
}
