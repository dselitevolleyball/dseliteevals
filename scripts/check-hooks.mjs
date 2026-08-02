// Two App.jsx invariants that a bundler build cannot catch, both of which have
// taken production down:
//
//   1. TDZ — a `const` loader named in a useEffect dependency array that is
//      declared LATER in the component body. The array is evaluated when the
//      component body runs, so the whole app dies with
//      "Cannot access 'x' before initialization".
//
//   2. Hook order — any hook called after the component's early returns
//      (`if (!session)` / `if (!coach.is_approved)`), which changes the hook
//      count between renders: React error #310.
//
// Usage: node scripts/check-hooks.mjs   (exit 1 on failure)

import { readFileSync } from "node:fs";

const SRC = new URL("../src/App.jsx", import.meta.url);
const lines = readFileSync(SRC, "utf8").split(/\r?\n/);
let failures = 0;
const fail = (msg) => { console.error("FAIL  " + msg); failures++; };

// ── 1. Early-return boundary ────────────────────────────────────────────────
const boundary = lines.findIndex(l => /^\s{2}if \(!session\) \{/.test(l));
if (boundary < 0) {
  console.warn("warn  couldn't find the `if (!session)` early return — skipping hook-order check");
} else {
  const hookRe = /\b(useState|useEffect|useCallback|useMemo|useRef|useReducer|useLayoutEffect)\s*\(/;
  for (let i = boundary + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;      // comments don't call hooks
    if (hookRe.test(line)) fail(`hook called at line ${i + 1}, after the early return on line ${boundary + 1}:\n      ${line.trim().slice(0, 110)}`);
  }
}

// ── 2. Loaders used in a dep array before they're declared ──────────────────
// Where each top-level `const NAME = useCallback(` is declared.
const declaredAt = new Map();
lines.forEach((l, i) => {
  const m = /^\s{2}const ([A-Za-z_$][\w$]*)\s*=\s*(?:useCallback|useMemo)\s*\(/.exec(l);
  if (m && !declaredAt.has(m[1])) declaredAt.set(m[1], i);
});

// Every dependency array, and the line it sits on.
lines.forEach((l, i) => {
  const m = /\}\s*,\s*\[([^\]]*)\]\s*\)\s*;?\s*$/.exec(l);
  if (!m) return;
  for (const raw of m[1].split(",")) {
    const dep = raw.trim();
    if (!/^[A-Za-z_$][\w$]*$/.test(dep)) continue;
    const at = declaredAt.get(dep);
    if (at != null && at > i) {
      fail(`"${dep}" is used in a dependency array on line ${i + 1} but declared on line ${at + 1} — TDZ crash on load`);
    }
  }
});

if (failures) { console.error(`\n${failures} problem(s) found.`); process.exit(1); }
console.log("check-hooks: ok — no hooks after the early return, no dep-array used before declaration");
