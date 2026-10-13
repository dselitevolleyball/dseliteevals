// Post-build step for the DSSC-only app (Drew, 13 Oct 2026).
//
// `npm run build` builds the app twice: the DS Elite HQ build into dist/ and
// the same code with base "/hq/" into dist/hq/, which www.drippingsportsclub.com/hq
// proxies to. This gives the /hq copy the club's own name, colors, icons and
// install manifest, so on a phone it installs as "DSSC HQ", not DS Elite.
import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const out = resolve(import.meta.dirname, "../dist/hq");
if (!existsSync(resolve(out, "index.html"))) throw new Error("dist/hq/index.html missing - run the /hq vite build first");

let html = readFileSync(resolve(out, "index.html"), "utf8");
const swap = (a, b) => { if (!html.includes(a)) throw new Error("index.html: missing " + a); html = html.replace(a, b); };
swap("<title>DS Elite HQ</title>", "<title>DSSC HQ</title>");
swap('content="DS Elite HQ"', 'content="DSSC HQ"');
swap('<meta name="theme-color" content="#0a0a0a" />', '<meta name="theme-color" content="#104946" />');
html = html.replace(/href="\/hq\/favicon-32\.png"/, 'href="/hq/dssc/favicon-32.png"').replace(/href="\/hq\/apple-touch-icon\.png"/, 'href="/hq/dssc/apple-touch-icon.png"');
writeFileSync(resolve(out, "index.html"), html);

writeFileSync(resolve(out, "manifest.webmanifest"), JSON.stringify({
  name: "DSSC HQ",
  short_name: "DSSC HQ",
  description: "Dripping Springs Sports Club - classes, coaches, clock-ins and staff",
  start_url: "/hq/",
  scope: "/hq/",
  display: "standalone",
  background_color: "#104946",
  theme_color: "#104946",
  orientation: "portrait",
  icons: [
    { src: "/hq/dssc/app-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/hq/dssc/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/hq/dssc/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
}, null, 2) + "\n");

// Vite copied all of public/ in here too; DS Elite's standalone pages (briefs,
// kits, guides) have no business being reachable on the club's domain.
for (const f of readdirSync(out)) if (/\.html$/i.test(f) && f !== "index.html") unlinkSync(resolve(out, f));

// The service worker uses <scope>icon-192.png on notifications.
copyFileSync(resolve(out, "dssc/app-icon-192.png"), resolve(out, "icon-192.png"));
console.log("dist/hq branded as DSSC HQ");
