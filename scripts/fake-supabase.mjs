// A tiny in-memory stand-in for the Supabase client, for offline tests of the
// server code: from().select/insert/upsert/update/delete with eq/neq/in/is/
// not/gte/lte/order/range/maybeSingle/single, and rpc() handlers you supply.
// Not a database - just enough of the query builder the CRM code uses.
//
//   const sb = fakeSupabase({ dssc_contacts: [] }, { rpc: { fn: (db, args) => … } });
//   sb.db.dssc_contacts  // the rows

export function fakeSupabase(seed = {}, { rpc = {} } = {}) {
  const db = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map(r => ({ ...r }))]));
  const ids = {};
  const nextId = (t) => { ids[t] = Math.max(ids[t] || 0, ...((db[t] || []).map(r => +r.id || 0))) + 1; return ids[t]; };
  const table = (t) => (db[t] ||= []);
  const parseSel = (sel) => (!sel || sel.trim() === "*") ? null : sel.split(",").map(s => s.trim()).filter(Boolean);

  function query(t) {
    const filters = [];
    let op = "select", payload = null, opts = {}, sel = null, order = null, range = null, single = null, returning = false;
    const q = {
      select(s = "*") { if (op === "select") sel = parseSel(s); else returning = true, sel = parseSel(s); return q; },
      insert(rows) { op = "insert"; payload = [].concat(rows); return q; },
      upsert(rows, o = {}) { op = "upsert"; payload = [].concat(rows); opts = o; return q; },
      update(patch) { op = "update"; payload = patch; return q; },
      delete() { op = "delete"; return q; },
      eq(c, v) { filters.push(r => r[c] === v || (r[c] != null && v != null && String(r[c]) === String(v))); return q; },
      neq(c, v) { filters.push(r => r[c] !== v); return q; },
      in(c, vs) { const s = new Set(vs.map(String)); filters.push(r => r[c] != null && s.has(String(r[c]))); return q; },
      is(c, v) { filters.push(r => v === null ? r[c] == null : r[c] === v); return q; },
      not(c, o, v) { if (o === "is" && v === null) filters.push(r => r[c] != null); return q; },
      gte(c, v) { filters.push(r => r[c] != null && r[c] >= v); return q; },
      lte(c, v) { filters.push(r => r[c] != null && r[c] <= v); return q; },
      gt(c, v) { filters.push(r => r[c] != null && r[c] > v); return q; },
      lt(c, v) { filters.push(r => r[c] != null && r[c] < v); return q; },
      order(c, o = {}) { order = { c, asc: o.ascending !== false }; return q; },
      range(a, b) { range = [a, b]; return q; },
      limit(n) { range = [0, n - 1]; return q; },
      maybeSingle() { single = "maybe"; return q; },
      single() { single = "one"; return q; },
      then(res, rej) { return Promise.resolve().then(run).then(res, rej); },
    };
    const pick = (r) => sel ? Object.fromEntries(sel.map(k => [k, r[k]])) : { ...r };
    function run() {
      const rows = table(t);
      let out;
      if (op === "insert") { out = payload.map(r => { const row = { id: nextId(t), ...r }; rows.push(row); return row; }); }
      else if (op === "upsert") {
        const keys = String(opts.onConflict || "id").split(",").map(s => s.trim());
        out = [];
        for (const r of payload) {
          const hit = rows.find(x => keys.every(k => x[k] != null && String(x[k]) === String(r[k])));
          if (hit) { if (!opts.ignoreDuplicates) Object.assign(hit, r); out.push(hit); }
          else { const row = { id: nextId(t), ...r }; rows.push(row); out.push(row); }
        }
      } else if (op === "update") { out = rows.filter(r => filters.every(f => f(r))); out.forEach(r => Object.assign(r, payload)); }
      else if (op === "delete") { out = rows.filter(r => filters.every(f => f(r))); db[t] = rows.filter(r => !out.includes(r)); }
      else {
        out = rows.filter(r => filters.every(f => f(r)));
        if (order) out = out.slice().sort((a, b) => (a[order.c] > b[order.c] ? 1 : a[order.c] < b[order.c] ? -1 : 0) * (order.asc ? 1 : -1));
        if (range) out = out.slice(range[0], range[1] + 1);
      }
      if (op !== "select" && !returning) return { data: null, error: null };
      const data = out.map(pick);
      if (single) return single === "one" && data.length !== 1 ? { data: null, error: { message: "not one row" } } : { data: data[0] || null, error: null };
      return { data, error: null };
    }
    return q;
  }
  return {
    db,
    from: query,
    rpc: async (name, args) => rpc[name] ? { data: await rpc[name](db, args), error: null } : { data: null, error: { message: "no rpc " + name } },
  };
}
