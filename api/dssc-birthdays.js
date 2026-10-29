// DSSC People -> Birthdays: the party invite 75 days before and the birthday
// wishes on the day. The work is in api/_lib/dssc-birthdays.js.
//
//   GET  (Vercel Cron, Bearer CRON_SECRET; also ?token=)   send today's emails (9am and 3pm CT;
//        the second pass only picks up new or failed ones). ?dry=1 = who would get one, nothing sent.
//   POST { action, ... } with a director's Supabase token:
//     state                      settings, the next 30 days, the last 100 sends
//     save { settings }          on/off, codes, amounts, ages, days
//     preview { kind }           the next real party invite / birthday email, to me, marked [Preview]
//     skip / unskip { pid, kind, birthday }   never send that one / undo

import { createClient } from "@supabase/supabase-js";
import { verifyDirector } from "./_lib/site-inbox.js";
import { runBirthdays, sendPreview, loadSettings, loadBirthdayData, upcomingPlan, ctToday, SETTING_KEYS, DEFAULTS } from "./_lib/dssc-birthdays.js";

export const config = { maxDuration: 300 };
const fail = (status, msg) => Object.assign(new Error(msg), { status });

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET } = process.env;
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    if (req.method === "GET") {
      const url = new URL(req.url, "http://x");
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "") || url.searchParams.get("token") || "";
      if (!CRON_SECRET || token !== CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });
      const out = await runBirthdays(sb, { dry: url.searchParams.get("dry") === "1" });
      if (out.plan) out.plan = { party: out.plan.party.length, birthday: out.plan.birthday.length, skipped: out.plan.skipped.length };
      return res.status(200).json({ ok: true, ...out });
    }
    if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return res.status(405).json({ error: "GET or POST" }); }
    const who = await verifyDirector(sb, req);
    if (who.error) return res.status(who.status).json({ error: who.status === 403 ? "Birthday emails are for the club's directors" : who.error });
    let b = req.body;
    if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
    return res.status(200).json({ ok: true, ...(await run(sb, who, b || {})) });
  } catch (e) {
    console.error("dssc-birthdays", e);
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

const clean = (k, v) => {
  if (typeof DEFAULTS[k] === "boolean") return !!v;
  if (typeof DEFAULTS[k] === "number") { const n = Math.round(Number(v)); if (!Number.isFinite(n) || n < 0 || n > 400) throw fail(400, `${k} must be a number from 0 to 400`); return n; }
  const t = String(v || "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,30}$/.test(t)) throw fail(400, "A code is 2-30 letters or numbers");
  return t;
};

export async function run(sb, { me, name }, b) {
  const today = ctToday();
  switch (b.action) {
    case "state": {
      const s = await loadSettings(sb);
      const d = await loadBirthdayData(sb, today);
      const { data: recent } = await sb.from("dssc_birthday_sends").select("id, participant_id, contact_id, kind, birthday, turns, email, status, reason, created_at, sent_at").order("created_at", { ascending: false }).limit(100);
      const kids = new Map(d.kids.map(k => [k.id, k]));
      const withKid = (recent || []).map(r => ({ ...r, first: kids.get(r.participant_id)?.first_name || "", last: kids.get(r.participant_id)?.last_name || "" }));
      return { settings: s, today, upcoming: upcomingPlan(d, s, today, 30), recent: withKid, kidsWithBirthday: d.kids.filter(k => !k.is_contact).length };
    }
    case "save": {
      const patch = Object.fromEntries(Object.entries(b.settings || {}).filter(([k]) => SETTING_KEYS.includes(k)).map(([k, v]) => [k, clean(k, v)]));
      const { data, error } = await sb.from("dssc_birthday_settings").upsert({ id: 1, ...patch, updated_by: String(name || me), updated_at: new Date().toISOString() }, { onConflict: "id" }).select().single();
      if (error) throw fail(500, error.message);
      return { settings: data };
    }
    case "preview": {
      if (!["party", "birthday"].includes(b.kind)) throw fail(400, "kind is party or birthday");
      return { preview: await sendPreview(sb, { kind: b.kind, to: me, today }) };
    }
    // Never send this one (a test record, a family that asked not to...), or undo that.
    case "skip": case "unskip": {
      const pid = Number(b.pid), kind = b.kind, birthday = String(b.birthday || "").slice(0, 10);
      if (!pid || !["party", "birthday"].includes(kind) || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) throw fail(400, "pid, kind and birthday");
      if (b.action === "unskip") { await sb.from("dssc_birthday_sends").delete().eq("participant_id", pid).eq("kind", kind).eq("birthday", birthday).eq("status", "skipped"); return {}; }
      const { data: k } = await sb.from("dssc_participants").select("contact_id").eq("id", pid).maybeSingle();
      const { error } = await sb.from("dssc_birthday_sends").upsert({ participant_id: pid, contact_id: k?.contact_id || null, kind, birthday, status: "skipped", reason: `skipped by ${String(name || me).split(/[\s@]/)[0]}` }, { onConflict: "participant_id,kind,birthday", ignoreDuplicates: true });
      if (error) throw fail(500, error.message);
      return {};
    }
    default: throw fail(400, "Unknown action");
  }
}
