// The DSSC-only app is this same code built a second time with base "/hq/"
// and served at https://www.drippingsportsclub.com/hq (that site proxies
// /hq/* here). Under that base, absolute "/api/..." calls would land on the
// club website instead of this app, so they're sent to "/hq/api/..." (which
// vercel.json rewrites back to /api). Plain DS Elite builds (base "/") are
// untouched. Imported first by main.jsx.
export const BASE = import.meta.env.BASE_URL || "/";
export const HQ_DSSC = BASE !== "/";

if (HQ_DSSC && typeof window !== "undefined" && window.fetch && !window.__hqFetch) {
  const orig = window.fetch.bind(window);
  const fix = (u) => (typeof u === "string" && u.startsWith("/api/") ? BASE + u.slice(1) : u);
  window.fetch = (input, init) => {
    if (typeof input === "string") return orig(fix(input), init);
    if (input instanceof Request && new URL(input.url).origin === window.location.origin && new URL(input.url).pathname.startsWith("/api/")) {
      return orig(new Request(BASE + new URL(input.url).pathname.slice(1) + new URL(input.url).search, input), init);
    }
    return orig(input, init);
  };
  window.__hqFetch = true;
}
