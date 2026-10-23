// Club newsletter sign-ups from drippingsportsclub.com. The website keeps them
// in its own Supabase project (site_subscribers - dssc-investor-network,
// supabase/047-site-forms.sql); the marketing cron copies them into HQ People
// on the "Website newsletter" list so the marketing emails reach them.
//
//   • a new sign-up → a contact (created if new, never overwritten) on the list
//   • unsubscribed on the website → mkt_unsubscribes, so HQ stops emailing too
//   • signed up again after that → taken back off mkt_unsubscribes
//
// Env: SITE_SUPABASE_URL, SITE_SUPABASE_SERVICE_KEY (the website project's
// service-role key). Without them this step is skipped.

export const SITE_LIST = "Website newsletter";
const nrm = (e) => String(e || "").trim().toLowerCase();
const chunks = (a, n = 300) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

async function siteRows(env) {
  const url = String(env.SITE_SUPABASE_URL || "").replace(/\/+$/, ""), key = env.SITE_SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  const r = await fetch(`${url}/rest/v1/site_subscribers?select=email,first_name,last_signup_at,unsubscribed_at&order=id`, { headers: { apikey: key, Authorization: "Bearer " + key }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`website subscribers: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
  return (await r.json()).map(x => ({ ...x, email: nrm(x.email) })).filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.email));
}

export async function syncSiteSubscribers(sb, { dry = false, env = process.env } = {}) {
  const rows = await siteRows(env);
  if (!rows) return { skipped: "SITE_SUPABASE_URL / SITE_SUPABASE_SERVICE_KEY not set" };
  const active = rows.filter(r => !r.unsubscribed_at), gone = rows.filter(r => r.unsubscribed_at);
  const listed = new Map(), unsub = new Map();
  for (const c of chunks(rows.map(r => r.email))) {
    const [{ data: have, error: e1 }, { data: out, error: e2 }] = await Promise.all([
      sb.from("dssc_contacts").select("email, lists").in("email", c),
      sb.from("mkt_unsubscribes").select("email, created_at").in("email", c),
    ]);
    if (e1 || e2) throw new Error((e1 || e2).message);
    for (const h of have || []) listed.set(nrm(h.email), (h.lists || []).includes(SITE_LIST));
    for (const u of out || []) unsub.set(nrm(u.email), u.created_at);
  }
  const fresh = active.filter(r => !listed.get(r.email));
  const newContacts = fresh.filter(r => !listed.has(r.email));
  const rejoined = active.filter(r => unsub.has(r.email) && r.last_signup_at && new Date(r.last_signup_at) > new Date(unsub.get(r.email)));
  const leaving = gone.filter(r => !unsub.has(r.email));
  const out = { subscribers: active.length, added: fresh.map(r => r.email), unsubscribed: leaving.map(r => r.email), rejoined: rejoined.map(r => r.email) };
  if (dry) return out;
  if (newContacts.length) {
    const { error } = await sb.from("dssc_contacts").upsert(newContacts.map(r => ({ email: r.email, first_name: r.first_name || null, sources: ["website"] })), { onConflict: "email", ignoreDuplicates: true });
    if (error) throw new Error("contacts: " + error.message);
  }
  if (fresh.length) {
    const { error } = await sb.rpc("dssc_add_list", { p_emails: fresh.map(r => r.email), p_list: SITE_LIST });
    if (error) throw new Error("list: " + error.message);
  }
  if (leaving.length) {
    const { error } = await sb.from("mkt_unsubscribes").upsert(leaving.map(r => ({ email: r.email })), { onConflict: "email", ignoreDuplicates: true });
    if (error) throw new Error("unsubscribes: " + error.message);
  }
  if (rejoined.length) await sb.from("mkt_unsubscribes").delete().in("email", rejoined.map(r => r.email));
  return out;
}
