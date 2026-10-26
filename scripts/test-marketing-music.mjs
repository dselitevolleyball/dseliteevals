// Free music: Openverse search filtering, copying a track into the library,
// and that the CC BY credit stays out of reel captions (it's on the end card). Run: node scripts/test-marketing-music.mjs
import assert from "node:assert/strict";
import { searchFreeMusic, addFreeTrack, creditLine } from "../api/_lib/marketing-music.js";
import { captionFor } from "../api/_lib/marketing-publish.js";

const ID = "0f3c9a8e-1111-4222-8333-444455556666";
const ov = (o) => ({ id: ID, title: "Sunny Run", creator: "Ada", duration: 95000, source: "jamendo", license: "by", license_version: "3.0", url: "https://cdn.example/sunny.mp3", foreign_landing_url: "https://jamendo.example/t/1", filetype: "mp3", ...o });
let calls = [];
globalThis.fetch = async (url) => {
  calls.push(String(url));
  if (/\/v1\/audio\/\?/.test(url)) return new Response(JSON.stringify({ result_count: 4, results: [
    ov(), ov({ id: "x2", license: "by-nc" }), ov({ id: "x3", duration: 5000 }), ov({ id: "x4", license: "cc0", creator: null }),
  ] }), { status: 200 });
  if (url.endsWith(`/v1/audio/${ID}/`)) return new Response(JSON.stringify(ov()), { status: 200 });
  if (url === "https://cdn.example/sunny.mp3") return new Response(new Uint8Array(50000), { status: 200, headers: { "content-type": "audio/mpeg" } });
  return new Response("", { status: 404 });
};

// 1. search keeps only commercial-safe music of a usable length
const s = await searchFreeMusic({ mood: "hype" });
assert.match(calls[0], /q=hip%20hop/);
assert.match(calls[0], /license=cc0,by/);
assert.deepEqual(s.results.map(r => r.id), [ID, "x4"]);
assert.equal(s.results[0].credit, 'Music: "Sunny Run" by Ada (CC BY 3.0)');
assert.equal(s.results[1].credit, null);
assert.equal(s.results[0].duration, 95);
console.log("1 search filters ok");

// 2. add copies the file to storage and records the licence + credit; second add dedupes
const rows = [], uploads = [];
const sb = {
  from: () => {
    const q = { _eq: null,
      select() { return q; }, eq(_, v) { q._eq = v; return q; },
      maybeSingle: async () => ({ data: rows.find(r => r.external_id === q._eq) || null }),
      insert(row) { const r = { id: rows.length + 1, ...row }; rows.push(r); return { select: () => ({ single: async () => ({ data: r }) }) }; } };
    return q;
  },
  storage: { from: () => ({ upload: async (p, buf, o) => { uploads.push({ p, n: buf.length, o }); return {}; }, getPublicUrl: (p) => ({ data: { publicUrl: "https://sb.example/" + p } }) }) },
};
const a = await addFreeTrack(sb, ID, { by: "drew", mood: ["hype"] });
assert.equal(a.already, false);
assert.equal(uploads[0].p, "music/openverse-sunny-run-0f3c9a8e.mp3");
assert.equal(a.track.rights_ok, true);
assert.equal(a.track.attribution, 'Music: "Sunny Run" by Ada (CC BY 3.0)');
assert.equal(a.track.source_url, "https://jamendo.example/t/1");
assert.deepEqual(a.track.mood, ["hype"]);
const b = await addFreeTrack(sb, ID, {});
assert.equal(b.already, true); assert.equal(rows.length, 1);
await assert.rejects(() => addFreeTrack(sb, "not-an-id"), /Unknown track/);
console.log("2 add + dedupe ok");

// 3. the credit never goes in the caption (the reel's end card carries it)
const cap = captionFor({ body: "Big week at the club!", hashtags: ["#dssc"], music_credit: creditLine(ov()), kind: "reel" }, "instagram");
assert.doesNotMatch(cap, /Music:/);
assert.match(cap, /Big week at the club!/);
console.log("3 no caption credit ok");
console.log("all music tests passed");
