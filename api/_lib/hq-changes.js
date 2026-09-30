// Ask HQ: checking and applying proposed database changes (from an uploaded
// document, or from an admin asking in chat).
//
// Claude proposes, an admin applies. api/ask-hq.js calls checkChanges() when
// Claude files a proposal, so what the admin sees is already validated: the
// table may be edited, every column exists, an update names exactly one row by
// its primary key, and "before" is what that row holds right now. Changes that
// wouldn't change anything are dropped. api/hq-apply.js calls applyChanges()
// with the ticked entries and re-checks each row still holds "before", so an
// edit someone made in the app after the upload is never overwritten.
//
// Deletes (added 30 Sep 2026 so Kristen can take someone off a trip from Ask
// HQ) are one row at a time by primary key, never on the club's core records
// (players, tournaments, teams, staff), never on a row other records point at
// — so nothing cascades — and at most MAX_DELETES per batch. The whole row is
// captured as "before", shown to the admin, re-checked at Apply, and written
// to change_log so it can be put back.
// Never touches logins, message logs, or secret columns.

export const SECRET_COL = /token|secret|password|api_key|signed_ip|user_agent|raw_email/i;
const DENY_TABLE = /^(coaches|change_log|email_log|hq_.*|sms_.*|push_.*|player_nudges|coach_privates_asks)$/;
const DENY_COL = new Set(["id", "created_at"]);
export const MAX_CHANGES = 300;
export const MAX_DELETES = 25;
// Core records: removing one belongs on its own screen, where the app does the
// clean-up that goes with it.
const DENY_DELETE = /^(players|tournaments|teams|practice_teams|coach_roster|dssc_contacts|dssc_participants|dssc_clinics|dsysa_clinics)$/;

// Rows elsewhere that point at this one (any foreign key). A delete with
// dependents is refused rather than cascading or orphaning them.
const fkCache = new Map();
async function dependents(sb, table, row) {
  if (!fkCache.has(table)) {
    const t = String(table).replace(/[^a-z0-9_]/gi, "");
    const { data, error } = await sb.rpc("hq_query", { sql: `select c.conrelid::regclass::text as child, a.attname as col, pa.attname as parent_col from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1] join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1] where c.contype = 'f' and c.confrelid = to_regclass('public.${t}')`, max_rows: 100 });
    if (error) throw new Error(error.message);
    fkCache.set(table, data || []);
  }
  const out = [];
  for (const fk of fkCache.get(table)) {
    const v = row[fk.parent_col];
    if (v == null) continue;
    const { count, error } = await sb.from(fk.child.replace(/^public\./, "")).select(fk.col, { count: "exact", head: true }).eq(fk.col, v);
    if (error) throw new Error(error.message);
    if (count) out.push(count + " in " + fk.child);
  }
  return out;
}
const clean = (row) => Object.fromEntries(Object.entries(row || {}).filter(([k]) => !SECRET_COL.test(k)));

const same = (a, b) => {
  if (a == null || a === "") return b == null || b === "";
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return String(a) === String(b);
};

// Columns and primary key of a public table, via the read-only hq_query.
const infoCache = new Map();
export async function tableInfo(sb, table) {
  if (infoCache.has(table)) return infoCache.get(table);
  const t = String(table).replace(/[^a-z0-9_]/gi, "");
  const { data: cols, error } = await sb.rpc("hq_query", { sql: `select column_name, data_type from information_schema.columns where table_schema='public' and table_name='${t}'`, max_rows: 500 });
  if (error) throw new Error(error.message);
  const { data: pk } = await sb.rpc("hq_query", { sql: `select kcu.column_name from information_schema.table_constraints tc join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema where tc.table_schema='public' and tc.table_name='${t}' and tc.constraint_type='PRIMARY KEY'`, max_rows: 10 });
  const info = { columns: new Map((cols || []).map(c => [c.column_name, c.data_type])), pk: (pk || []).map(r => r.column_name) };
  infoCache.set(table, info);
  return info;
}

// Validate Claude's proposed changes. Returns { ok: [...], skipped: [{i, why}], noop }.
export async function checkChanges(sb, changes) {
  const ok = [], skipped = [];
  let noop = 0, deletes = 0;
  const list = (Array.isArray(changes) ? changes : []).slice(0, MAX_CHANGES);
  for (let i = 0; i < list.length; i++) {
    const c = list[i] || {};
    const table = String(c.table || "").trim();
    const action = c.action === "insert" ? "insert" : c.action === "delete" ? "delete" : "update";
    const set = c.set && typeof c.set === "object" && !Array.isArray(c.set) ? c.set : null;
    const skip = (why) => skipped.push({ i, label: c.label || null, why });
    if (!table || DENY_TABLE.test(table)) { skip(`table "${table}" can't be changed from Ask HQ`); continue; }
    let info;
    try { info = await tableInfo(sb, table); } catch (e) { skip(e.message); continue; }
    if (!info.columns.size) { skip(`no table called "${table}"`); continue; }
    const pk = c.pk && typeof c.pk === "object" ? c.pk : null;
    const pkOk = () => {
      if (!info.pk.length) { skip(`${table} has no primary key, so a row can't be pinned down`); return false; }
      if (!pk || info.pk.some(k => pk[k] == null) || Object.keys(pk).length !== info.pk.length) { skip(`${action} needs the primary key (${info.pk.join(", ")})`); return false; }
      return true;
    };

    if (action === "delete") {
      if (DENY_DELETE.test(table)) { skip(`${table} rows can't be deleted from Ask HQ — use that record's own screen`); continue; }
      if (!pkOk()) continue;
      if (deletes >= MAX_DELETES) { skip(`more than ${MAX_DELETES} deletes in one batch`); continue; }
      const { data: rows, error } = await sb.from(table).select("*").match(pk).limit(2);
      if (error) { skip(error.message); continue; }
      if (!rows || rows.length !== 1) { skip(`no ${table} row with ${JSON.stringify(pk)}`); continue; }
      let deps;
      try { deps = await dependents(sb, table, rows[0]); } catch (e) { skip(e.message); continue; }
      if (deps.length) { skip(`other records point at it (${deps.join(", ")}), so it can't be deleted`); continue; }
      deletes++;
      ok.push({ table, action, pk, set: {}, before: clean(rows[0]), label: String(c.label || "").slice(0, 160), reason: String(c.reason || "").slice(0, 300) });
      continue;
    }
    if (!set || !Object.keys(set).length) { skip("nothing to set"); continue; }
    const bad = Object.keys(set).filter(k => !info.columns.has(k) || DENY_COL.has(k) || SECRET_COL.test(k));
    if (bad.length) { skip(`can't set ${bad.join(", ")} on ${table}`); continue; }

    if (action === "insert") {
      ok.push({ table, action, pk: null, set, before: null, label: String(c.label || "").slice(0, 160), reason: String(c.reason || "").slice(0, 300) });
      continue;
    }
    if (!pkOk()) continue;
    const { data: rows, error } = await sb.from(table).select(Object.keys(set).join(",")).match(pk).limit(2);
    if (error) { skip(error.message); continue; }
    if (!rows || rows.length !== 1) { skip(`no ${table} row with ${JSON.stringify(pk)}`); continue; }
    const before = {}, setChanged = {};
    for (const k of Object.keys(set)) if (!same(rows[0][k], set[k])) { before[k] = rows[0][k] ?? null; setChanged[k] = set[k]; }
    if (!Object.keys(setChanged).length) { noop++; continue; }
    ok.push({ table, action, pk, set: setChanged, before, label: String(c.label || "").slice(0, 160), reason: String(c.reason || "").slice(0, 300) });
  }
  return { ok, skipped, noop };
}

// Apply the chosen entries. Each is re-checked against the live row first.
export async function applyChanges(sb, changes, actor) {
  const results = [];
  for (const [i, c] of changes) {
    try {
      if (c.action === "delete") {
        const { data: rows, error } = await sb.from(c.table).select("*").match(c.pk).limit(2);
        if (error) throw new Error(error.message);
        if (!rows || rows.length !== 1) { results.push({ i, status: "missing", why: "already gone" }); continue; }
        const moved = Object.keys(c.before || {}).filter(k => !same(rows[0][k], c.before[k]));
        if (moved.length) { results.push({ i, status: "conflict", why: `${moved.join(", ")} changed in HQ since this was proposed` }); continue; }
        const { error: e2 } = await sb.from(c.table).delete().match(c.pk);
        if (e2) throw new Error(e2.message);
      } else if (c.action === "update") {
        const { data: rows, error } = await sb.from(c.table).select(Object.keys(c.set).join(",")).match(c.pk).limit(2);
        if (error) throw new Error(error.message);
        if (!rows || rows.length !== 1) { results.push({ i, status: "missing", why: "row no longer exists" }); continue; }
        const moved = Object.keys(c.before || {}).filter(k => !same(rows[0][k], c.before[k]));
        if (moved.length) { results.push({ i, status: "conflict", why: `${moved.join(", ")} changed in HQ since this was proposed` }); continue; }
        const { error: e2 } = await sb.from(c.table).update(c.set).match(c.pk);
        if (e2) throw new Error(e2.message);
      } else {
        const { error } = await sb.from(c.table).insert(c.set);
        if (error) throw new Error(error.message);
      }
      // A delete logs the whole row (old → null), so it can be put back.
      const field_changes = c.action === "delete"
        ? Object.fromEntries(Object.keys(c.before || {}).map(k => [k, { old: c.before[k] ?? null, new: null }]))
        : Object.fromEntries(Object.keys(c.set).map(k => [k, { old: c.before?.[k] ?? null, new: c.set[k] }]));
      const player_id = c.table === "players" ? (c.pk?.id ?? null) : (c.set.player_id ?? c.pk?.player_id ?? c.before?.player_id ?? null);
      try { await sb.from("change_log").insert({ player_id, table_name: c.table, action: "hq " + c.action, field_changes, actor_email: actor.email, actor_name: actor.name }); } catch { /* the edit stands without its log row */ }
      results.push({ i, status: "applied" });
    } catch (e) {
      results.push({ i, status: "error", why: e.message });
    }
  }
  return results;
}
