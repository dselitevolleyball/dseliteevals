// Turn an uploaded practice-plan file into something Claude can read.
//
// Claude reads images and PDFs natively, so those pass through as content
// blocks. Office files (.xlsx / .docx) are ZIP+XML — we unzip them and pull the
// text out here, because the Messages API has no native block type for them.
//
// Used by api/read-practice-plan.js. Kept separate so the extraction can be
// unit-tested against real files without calling the API.

import { unzipSync, strFromU8 } from "fflate";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
export const MAX_BYTES = 25 * 1024 * 1024; // generous; PDFs run larger than photos

// XML helpers — these files are machine-generated, so targeted regex is safe
// and avoids pulling in a parser.
const stripTags = (xml) => xml.replace(/<[^>]*>/g, "");
// Office files are ZIPs. fflate throws "invalid zip data" at a coach who
// uploaded something truncated or mislabelled — say something useful instead.
const unzipOrThrow = (bytes, kind) => {
  try { return unzipSync(bytes); }
  catch { throw new Error(`That ${kind} couldn't be opened — it may be damaged, or it may not really be a ${kind}. Try re-saving it, or export it as a PDF.`); }
};
const decode = (s) => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&amp;/g, "&"); // last, so &amp;lt; doesn't double-decode

// ── .docx ────────────────────────────────────────────────────────────────
// word/document.xml holds the body. Paragraphs are <w:p>, line breaks <w:br/>,
// and table cells <w:tc> — we keep the row/cell shape because practice plans
// are very often written as a table.
export function docxToText(bytes) {
  const files = unzipOrThrow(bytes, ".docx file");
  const doc = files["word/document.xml"];
  if (!doc) throw new Error("That .docx looks damaged — no document body found.");
  let xml = strFromU8(doc);
  xml = xml.replace(/<w:br\b[^>]*\/?>/g, "\n").replace(/<w:tab\b[^>]*\/?>/g, "\t");
  // Walk the body in document order, matching either a whole table or a loose
  // paragraph. Matching a table as one unit consumes the paragraphs inside its
  // cells, so cell text is never emitted twice. The [ >] guards keep <w:tblPr>
  // and <w:pPr> from matching as content.
  const out = [];
  const walker = /<w:tbl[ >][\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g;
  let m;
  while ((m = walker.exec(xml)) !== null) {
    const chunk = m[0];
    if (chunk.startsWith("<w:tbl")) {
      // Keep the grid: one line per row, cells joined by " | ".
      for (const r of chunk.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []) {
        const cells = (r.match(/<w:tc[ >][\s\S]*?<\/w:tc>/g) || [])
          .map(c => decode(stripTags(c)).replace(/\s+/g, " ").trim());
        if (cells.some(Boolean)) out.push(cells.join(" | "));
      }
    } else {
      const t = decode(stripTags(chunk)).replace(/[ \t]+/g, " ").trim();
      if (t) out.push(t);
    }
  }
  const text = out.join("\n").trim();
  if (!text) throw new Error("That .docx appears to be empty (or is all images — try a photo or PDF instead).");
  return text;
}

// ── .xlsx ────────────────────────────────────────────────────────────────
// Rebuilds each sheet as a tab-separated grid so row/column meaning survives —
// a practice plan in a spreadsheet is usually one block per row.
const colToIndex = (ref) => {
  const m = /^([A-Z]+)/.exec(ref || "");
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

export function xlsxToText(bytes) {
  const files = unzipOrThrow(bytes, "spreadsheet");
  // Shared strings table: <si> entries, each possibly split across <t> runs.
  const shared = [];
  if (files["xl/sharedStrings.xml"]) {
    const sx = strFromU8(files["xl/sharedStrings.xml"]);
    for (const si of sx.match(/<si[ >][\s\S]*?<\/si>/g) || []) {
      const parts = (si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [])
        .map(t => decode(t.replace(/<[^>]*>/g, "")));
      shared.push(parts.join(""));
    }
  }
  // Sheet names, in workbook order, so output is labelled. The \s after "sheet"
  // matters: without it the <sheets> container matches too, and every sheet
  // name shifts by one.
  const names = [];
  if (files["xl/workbook.xml"]) {
    const wb = strFromU8(files["xl/workbook.xml"]);
    for (const s of wb.match(/<sheet\s[^>]*>/g) || []) {
      const n = /name="([^"]*)"/.exec(s);
      names.push(n ? decode(n[1]) : "");
    }
  }
  const sheetPaths = Object.keys(files)
    .filter(p => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
    .sort((a, b) => (+/(\d+)\.xml$/.exec(a)[1]) - (+/(\d+)\.xml$/.exec(b)[1]));
  if (!sheetPaths.length) throw new Error("That .xlsx looks damaged — no worksheets found.");

  const out = [];
  sheetPaths.forEach((path, i) => {
    const sx = strFromU8(files[path]);
    const lines = [];
    for (const row of sx.match(/<row[ >][\s\S]*?<\/row>/g) || []) {
      const cells = [];
      for (const c of row.match(/<c[ >][\s\S]*?<\/c>|<c[^>]*\/>/g) || []) {
        const ref = /r="([A-Z]+\d+)"/.exec(c);
        const type = /t="([^"]*)"/.exec(c);
        let val = "";
        if (type && type[1] === "inlineStr") {
          val = (c.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(t => decode(t.replace(/<[^>]*>/g, ""))).join("");
        } else {
          const v = /<v[^>]*>([\s\S]*?)<\/v>/.exec(c);
          if (v) {
            val = decode(v[1]);
            if (type && type[1] === "s") val = shared[+val] ?? "";
          }
        }
        const idx = ref ? colToIndex(ref[1]) : cells.length;
        while (cells.length < idx) cells.push("");
        cells[idx] = String(val).replace(/\s+/g, " ").trim();
      }
      // Drop fully empty rows — spreadsheets are full of them.
      if (cells.some(v => v !== "")) lines.push(cells.join("\t"));
    }
    if (!lines.length) return;
    const label = names[i] || `Sheet ${i + 1}`;
    out.push(`--- Sheet: ${label} ---\n${lines.join("\n")}`);
  });
  const text = out.join("\n\n").trim();
  if (!text) throw new Error("That spreadsheet appears to be empty.");
  return text;
}

// ── dispatcher ───────────────────────────────────────────────────────────
// Returns { kind, block } where block is a Messages API content block, or
// { kind, text } for anything we converted to plain text.
const EXT = (name) => (/\.([a-z0-9]+)$/i.exec(String(name || "")) || [, ""])[1].toLowerCase();

export function parseUpload({ data, mediaType, filename }) {
  const b64 = String(data || "").replace(/\s/g, "");
  if (!b64) throw new Error("No file was uploaded.");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length < 32) {
    throw new Error("That file didn't upload correctly. Try again.");
  }
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length > MAX_BYTES) {
    throw new Error("That file is too large (max 25MB). Try a smaller or lower-resolution version.");
  }
  const mt = String(mediaType || "").toLowerCase().split(";")[0].trim();
  const ext = EXT(filename);

  if (IMAGE_TYPES.has(mt) || ["jpg","jpeg","png","gif","webp"].includes(ext)) {
    const type = IMAGE_TYPES.has(mt) ? mt : ({ jpg:"image/jpeg", jpeg:"image/jpeg", png:"image/png", gif:"image/gif", webp:"image/webp" })[ext];
    // Images have their own, smaller practical ceiling.
    if (bytes.length > 5 * 1024 * 1024) throw new Error("That photo is too large (max 5MB). Retake it at a lower resolution.");
    return { kind: "image", block: { type: "image", source: { type: "base64", media_type: type, data: b64 } } };
  }
  if (mt === "application/pdf" || ext === "pdf") {
    return { kind: "pdf", block: { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } } };
  }
  if (ext === "xlsx" || ext === "xlsm" || mt.includes("spreadsheetml")) {
    return { kind: "spreadsheet", text: xlsxToText(bytes) };
  }
  if (ext === "docx" || mt.includes("wordprocessingml")) {
    return { kind: "document", text: docxToText(bytes) };
  }
  if (["csv","tsv","txt","md","text"].includes(ext) || mt.startsWith("text/")) {
    const text = bytes.toString("utf8").trim();
    if (!text) throw new Error("That file is empty.");
    return { kind: "text", text };
  }
  if (ext === "xls" || ext === "doc") {
    throw new Error("Old Office formats (.xls / .doc) aren't supported — save as .xlsx / .docx, or export a PDF.");
  }
  if (ext === "pages" || ext === "numbers" || ext === "key") {
    throw new Error("Apple iWork files aren't supported — export a PDF from Pages/Numbers and upload that.");
  }
  throw new Error("Unsupported file type. Upload a photo, PDF, Word (.docx), Excel (.xlsx), or CSV/text file.");
}
