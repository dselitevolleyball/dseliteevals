// The testing leaderboard TV (board/) builds on its own into dist/board, so
// the HQ app's bundle and build are untouched. Served at /board (vercel.json).
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
export default defineConfig({
  root: here("./board"),
  base: "/board/",
  publicDir: false,
  plugins: [react()],
  build: { outDir: here("./dist/board"), emptyOutDir: true },
});
