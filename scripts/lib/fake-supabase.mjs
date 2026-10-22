import { randomUUID } from "node:crypto";

// An in-memory stand-in for the Supabase client, enough of it for the
// marketing tests (scripts/test-marketing-backend.mjs, test-marketing-ideas.mjs):
// select / insert / upsert / update / delete with eq, neq, lt, lte, gte, in, not,
// ilike, is, contains, order, limit, range, single, maybeSingle, head counts.
// `inserted` keeps the raw insert payloads as PostgREST would get them; storage
// mints fake signed upload URLs and public URLs.
// Column defaults the real tables fill in (see the migrations).
const DEFAULTS = {
  mkt_photos: () => ({ active: true, used_count: 0, uses: [] }),
  mkt_spotlights: () => ({ token: randomUUID(), series: "Meet the Coaches", photos: [], item_ids: [], sent_via: [], questions: [] }),
  mkt_ideas: () => ({ sources: [], status: "new" }),
  mkt_log: () => ({ at: new Date().toISOString() }),
};

export function fakeSupabase(seed = {}) {
  const db = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map(r => ({ ...r }))]));
  const ids = {};
  const inserted = {};                 // raw insert payloads, as PostgREST would get them
  const T = (t) => (db[t] ||= []);
  const now = () => new Date().toISOString();
  class Q {
    constructor(t) { this.t = t; this.f = []; this.op = "select"; this.ord = []; this.lim = null; this.rng = null; this.one = null; this.ret = false; this.opts = {}; }
    select(_c, opts = {}) { if (this.op === "select") this.opts = opts; else this.ret = true; return this; }
    insert(rows) { this.op = "insert"; this.rows = [].concat(rows); (inserted[this.t] ||= []).push(...this.rows.map(r => ({ ...r }))); return this; }
    upsert(rows, o = {}) { this.op = "upsert"; this.rows = [].concat(rows); this.uo = o; return this; }
    update(p) { this.op = "update"; this.patch = p; return this; }
    delete() { this.op = "delete"; return this; }
    eq(k, v) { this.f.push(r => String(r[k]) === String(v)); return this; }
    neq(k, v) { this.f.push(r => String(r[k]) !== String(v)); return this; }
    lt(k, v) { this.f.push(r => r[k] != null && r[k] < v); return this; }
    lte(k, v) { this.f.push(r => r[k] != null && r[k] <= v); return this; }
    gte(k, v) { this.f.push(r => r[k] != null && r[k] >= v); return this; }
    in(k, vs) { this.f.push(r => vs.map(String).includes(String(r[k]))); return this; }
    not(k, op, v) {
      if (op === "is") this.f.push(r => r[k] != null);
      else if (op === "in") { const vs = String(v).replace(/[()]/g, "").split(","); this.f.push(r => !vs.includes(String(r[k]))); }
      return this;
    }
    like(k, v) { const re = new RegExp("^" + String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$"); this.f.push(r => re.test(String(r[k] ?? ""))); return this; }
    ilike(k, v) { this.f.push(r => String(r[k] || "").toLowerCase() === String(v).toLowerCase()); return this; }
    is(k, v) { this.f.push(r => v === null ? r[k] == null : r[k] === v); return this; }
    contains(k, obj) { this.f.push(r => Object.entries(obj).every(([a, b]) => r[k]?.[a] === b)); return this; }
    order(k, o = {}) { this.ord.push([k, o.ascending !== false]); return this; }
    limit(n) { this.lim = n; return this; }
    range(a, b) { this.rng = [a, b]; return this; }
    maybeSingle() { this.one = "maybe"; return this; }
    single() { this.one = "single"; return this; }
    run() {
      const rows = T(this.t);
      const match = (r) => this.f.every(fn => fn(r));
      let out;
      if (this.op === "insert" || this.op === "upsert") {
        out = [];
        for (const r0 of this.rows) {
          const key = this.uo?.onConflict;
          const ex = key ? rows.find(r => String(r[key]) === String(r0[key])) : null;
          if (ex) { if (!this.uo.ignoreDuplicates) Object.assign(ex, r0, this.t === "mkt_settings" ? { updated_at: now() } : {}); out.push(ex); continue; }
          const pk = this.t === "mkt_unsubscribes" ? null : (r0.id ?? (ids[this.t] = (ids[this.t] || 1000) + 1));
          const r = { created_at: now(), updated_at: now(), revisions: [], external_ids: {}, ...(DEFAULTS[this.t] ? DEFAULTS[this.t]() : {}), ...r0 };
          if (pk != null) r.id = pk;
          rows.push(r); out.push(r);
        }
      } else if (this.op === "update") {
        out = rows.filter(match);
        for (const r of out) Object.assign(r, this.patch, ["mkt_items", "mkt_settings", "mkt_priorities"].includes(this.t) ? { updated_at: now() } : {});
      } else if (this.op === "delete") {
        out = rows.filter(match);
        db[this.t] = rows.filter(r => !match(r));
      } else {
        out = rows.filter(match);
        for (const [k, asc] of this.ord.slice().reverse()) out = out.slice().sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (asc ? 1 : -1));
        if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
        if (this.lim != null) out = out.slice(0, this.lim);
      }
      out = out.map(r => ({ ...r }));
      if (this.opts.head) return { data: null, count: out.length, error: null };
      if (this.one) {
        if (this.one === "single" && out.length !== 1) return { data: null, error: { message: `expected 1 row, got ${out.length}` } };
        return { data: out[0] || null, error: null };
      }
      return { data: (this.op === "select" || this.ret) ? out : null, error: null, count: out.length };
    }
    then(res, rej) { try { return Promise.resolve(this.run()).then(res, rej); } catch (e) { return Promise.reject(e).then(res, rej); } }
  }
  const storage = { from: (bucket) => ({
    createSignedUploadUrl: async (path) => ({ data: { signedUrl: `https://fake.supabase.co/storage/v1/upload/sign/${bucket}/${path}?token=t`, token: "t", path }, error: null }),
    getPublicUrl: (path) => ({ data: { publicUrl: `https://fake.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
  }) };
  return { db, inserted, storage, from: (t) => new Q(t), auth: { getUser: async () => ({ data: { user: null } }) } };
}
