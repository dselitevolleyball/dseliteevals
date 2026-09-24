// The address links in emails and push notifications should point at.
//
// Vercel runs cron jobs and server-to-server calls against the deployment's
// own hostname (dseliteevals-<hash>-<team>.vercel.app), and those hosts sit
// behind deployment protection — so a link built from `req.headers.host` in a
// cron opened a Vercel login page instead of the app. Only the production
// domain (or an explicit APP_URL) is ever a link we want a parent or coach to
// tap.
export const PROD_ORIGIN = "https://dseliteevals.vercel.app";

export function appOrigin(req) {
  const env = String(process.env.APP_URL || "").trim().replace(/\/+$/, "");
  if (env) return env;
  const host = String((req && req.headers && (req.headers["x-forwarded-host"] || req.headers.host)) || "").split(",")[0].trim();
  return /^dseliteevals\.vercel\.app$/i.test(host) ? "https://" + host : PROD_ORIGIN;
}
