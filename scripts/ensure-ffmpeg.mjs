// Build step: make sure ffmpeg-static's binary is there for the video
// functions (api/marketing-video.js, the cron). Newer npm skips install
// scripts that aren't approved, so the download may not have happened -
// run it here, and fail the build rather than ship reels that can't render.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const bin = require("ffmpeg-static");
if (!existsSync(bin)) {
  console.log("ffmpeg-static: binary missing, downloading…");
  const r = spawnSync(process.execPath, ["install.js"], { cwd: dirname(require.resolve("ffmpeg-static/package.json")), stdio: "inherit" });
  if (r.status !== 0) { console.error("ffmpeg-static: download failed"); process.exit(1); }
}
const v = spawnSync(bin, ["-version"], { encoding: "utf8" });
if (v.status !== 0) { console.error("ffmpeg-static: the binary doesn't run", v.error?.message || v.stderr); process.exit(1); }
console.log("ffmpeg-static:", v.stdout.split("\n")[0]);
