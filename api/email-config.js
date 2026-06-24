// Diagnostic: reports whether the email env vars are visible to the deployed
// function. Does NOT expose the API key — only whether it is present.
// Visit /api/email-config in a browser after setting the vars + redeploying.

export default function handler(req, res) {
  const from = process.env.DSE_FROM_EMAIL || null;
  res.status(200).json({
    hasResendKey: !!process.env.RESEND_API_KEY,
    resendKeyPrefix: process.env.RESEND_API_KEY ? process.env.RESEND_API_KEY.slice(0, 3) + "…" : null,
    hasFromEmail: !!from,
    fromEmail: from,                       // not secret
    replyTo: process.env.DSE_REPLY_TO || "(defaults to from)",
    vercelEnv: process.env.VERCEL_ENV || "(unknown)",
    note: "hasResendKey:false here means the var is not set in THIS deployment — check the name (RESEND_API_KEY), the environment (Production), and that you redeployed after adding it.",
  });
}
