// Which Resend API key sends a given From address. drippingsportsclub.com is
// verified on the DSSC Resend account (DSSC_RESEND_API_KEY), not DS Elite's,
// so club mail from an @drippingsportsclub.com address (DSSC_FROM_EMAIL, e.g.
// info@) goes out with that key; everything else, including the DSSC fallback
// "Dripping Springs Sports Club <DS Elite address>", keeps RESEND_API_KEY.
const DSSC_DOMAIN = "drippingsportsclub.com";

export function resendKeyFor(from) {
  const m = String(from || "").match(/<([^>]+)>/);
  const addr = String(m ? m[1] : from || "").trim().toLowerCase();
  const dssc = process.env.DSSC_RESEND_API_KEY;
  if (dssc && addr.endsWith("@" + DSSC_DOMAIN)) return dssc;
  return process.env.RESEND_API_KEY || process.env.resend_api_key || "";
}
