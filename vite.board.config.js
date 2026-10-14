// The testing leaderboard TV (board/) builds on its own into dist/reach, so
// the HQ app's bundle and build are untouched. Served at /reach here and at
// www.drippingsportsclub.com/reach (the club site proxies /reach/* to it);
// everything it loads - assets, the logo, /reach/api/leaderboard - lives under
// /reach/ so the proxy needs no other paths.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
export default defineConfig({
  root: here("./board"),
  base: "/reach/",
  publicDir: false,
  plugins: [react()],
  build: { outDir: here("./dist/reach"), emptyOutDir: true },
});
