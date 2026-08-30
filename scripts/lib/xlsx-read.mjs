// Minimal xlsx → rows reader. Unzips with the system `unzip` and parses the
// two parts that matter: sharedStrings.xml and each sheet's rows.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const decode = (s) => String(s)
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&amp;/g, "&");

// A1 -> 0-based column index.
const colOf = (ref) => {
  const m = /^([A-Z]+)/.exec(ref || "");
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

export function readXlsx(path) {
  const dir = mkdtempSync(join(tmpdir(), "xlsx-"));
  execFileSync("unzip", ["-o", "-q", path, "-d", dir]);

  // Shared strings: <si> may hold one <t> or several inside <r> runs.
  const shared = [];
  const ssPath = join(dir, "xl", "sharedStrings.xml");
  if (existsSync(ssPath)) {
    const xml = readFileSync(ssPath, "utf8");
    for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) || []) {
      shared.push(decode([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join("")));
    }
  }

  // Sheet name ← rId ← file, so sheets come back under the names on the tabs.
  const wb = readFileSync(join(dir, "xl", "workbook.xml"), "utf8");
  const rels = readFileSync(join(dir, "xl", "_rels", "workbook.xml.rels"), "utf8");
  const relTarget = new Map();
  for (const m of rels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    relTarget.set(m[1], m[2].replace(/^\/?xl\//, "").replace(/^\//, ""));
  }
  const sheets = [];
  for (const m of wb.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    sheets.push({ name: decode(m[1]), file: relTarget.get(m[2]) });
  }
  if (!sheets.length) {
    for (const f of readdirSync(join(dir, "xl", "worksheets"))) {
      if (f.endsWith(".xml")) sheets.push({ name: f.replace(/\.xml$/, ""), file: "worksheets/" + f });
    }
  }

  const out = {};
  for (const sh of sheets) {
    const p = join(dir, "xl", sh.file || "");
    if (!sh.file || !existsSync(p)) continue;
    const xml = readFileSync(p, "utf8");
    const rows = [];
    for (const rm of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>|<row[^>]*r="(\d+)"[^>]*\/>/g)) {
      const rIdx = parseInt(rm[1] || rm[3], 10) - 1;
      const cells = [];
      for (const cm of (rm[2] || "").matchAll(/<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g)) {
        const attrs = cm[1] || cm[3] || "";
        const inner = cm[2] || "";
        const ref = (/r="([A-Z]+\d+)"/.exec(attrs) || [])[1] || "";
        const type = (/t="([^"]+)"/.exec(attrs) || [])[1] || "n";
        let val = "";
        if (type === "inlineStr") {
          val = decode([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(""));
        } else {
          const v = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
          if (v != null) val = type === "s" ? (shared[parseInt(v, 10)] ?? "") : decode(v);
        }
        cells[colOf(ref)] = val;
      }
      rows[rIdx] = cells;
    }
    out[sh.name] = rows;
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith("xlsx-read.mjs")) {
  const book = readXlsx(process.argv[2]);
  for (const [name, rows] of Object.entries(book)) {
    console.log("\n=== SHEET: " + name + " (" + rows.length + " rows) ===");
    (rows || []).slice(0, parseInt(process.argv[3] || "12", 10)).forEach((r, i) =>
      console.log(String(i).padStart(3) + " | " + (r || []).map(c => String(c ?? "")).join(" | ")));
  }
}
