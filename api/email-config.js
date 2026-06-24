// Diagnostic: reports whether the email env vars are visible to the deployed
// function. Does NOT expose the API key — only whether it is present.
// Visit /api/email-config in a browser after setting the vars + redeploying.

export default function handler(req, res) {
  const from = process.env.DSE_FROM_EMAIL || null;
  const raw = process.env.RESEND_API_KEY;
  // Names only (never values) of env vars that look email/key related — to
  // catch a misnamed key (e.g. RESEND_KEY) or a stray trailing space.
  const relatedVarNames = Object.keys(process.env)
    .filter(k => /resend|dse|email|mail|reply|from|key|api/i.test(k))
    .sort();
  res.status(200).json({
    hasResendKey: !!(raw && raw.trim()),
    resendKeyPrefix: raw && raw.trim() ? raw.trim().slice(0, 3) + "…" : null,
    resendKeyLength: raw ? raw.length : 0,           // 0 = missing, small = blank/partial
    hasFromEmail: !!from,
    fromEmail: from,                                  // not secret
    replyTo: process.env.DSE_REPLY_TO || "(defaults to from)",
    vercelEnv: process.env.VERCEL_ENV || "(unknown)",
    relatedVarNames,                                  // look here for a typo'd name
    note: "If RESEND_API_KEY is not in relatedVarNames, it was never added (or named differently). resendKeyLength:0 with the name present = blank value.",
  });
}
