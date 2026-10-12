// Open court time for DSSC open-gym members (Drew, Oct 12 2026).
//   GET /courts?t=<token>   (vercel.json rewrite -> /api/courts-public)
//   Also served as www.drippingsportsclub.com/opengym: the DSSC site project
//   (drew-dssc/dssc-investor-network) proxies that path here, so asset URLs
//   on this page are absolute.
// No login: one link for every open-gym family, an HMAC token so it can't be
// guessed (api/_lib/court-data.js; bump LINK_VERSION there to retire it). The
// page shows the next 7 days, per court, OPEN vs booked only - no program,
// renter or team names are ever sent. Cached at the edge for 15 minutes.
import { createClient } from "@supabase/supabase-js";
import { centralToday } from "./_lib/playbook-calendar.js";
import { publicWeek, courtsTokenOk, PUBLIC_START, PUBLIC_END } from "./_lib/court-data.js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).send(page("Unavailable", "<p>Not configured.</p>"));
  const url = new URL(req.url, "https://x");
  if (!courtsTokenOk(url.searchParams.get("t"), SUPABASE_SERVICE_ROLE_KEY)) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(403).send(page("Link not valid", "<h1>This link isn't valid</h1><p>Ask the front desk for the current open-gym court link.</p>"));
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  let week;
  try { week = await publicWeek(sb, centralToday(), 7); }
  catch (e) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(503).send(page("Try again", "<h1>Court times didn't load</h1><p>Please try again in a minute.</p>"));
  }
  // The edge keeps a copy for 15 minutes so a busy evening doesn't pull Playbook on every view.
  res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=1800");
  const checked = new Date().toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
  const json = JSON.stringify({ start: PUBLIC_START, end: PUBLIC_END, checked, days: week }).replace(/</g, "\\u003c");
  return res.status(200).send(page("Open court time · DSSC", `
    <header><img src="https://dseliteevals.vercel.app/dssc/logo-horizontal-white.png" alt="Dripping Springs Sports Club"><h1>Open court time</h1>
    <p class="sub">When the courts are free for open gym. Booked time is shown in gray.</p></header>
    <div id="days" class="days"></div>
    <div id="app"></div>
    <p class="foot">Checked at ${esc(checked)}. Courts can be booked after this was checked, so please confirm at the front desk. Courts 1-4 are in the Warehouse, 5-6 in the Flex.</p>
    <script type="application/json" id="data">${json}</script>
    <script>${CLIENT}</script>`));
}

// The page's own script: a day picker and, per court, open times + a timeline.
const CLIENT = `(function(){
  var D = JSON.parse(document.getElementById('data').textContent);
  var sel = 0;
  function h12(h){ var hh=Math.floor(h), mm=Math.round((h-hh)*60), ap=hh>=12&&hh<24?'pm':'am', x=hh%12===0?12:hh%12; return x+(mm?':'+(mm<10?'0':'')+mm:'')+ap; }
  function dayName(d,i){ var t=new Date(d+'T12:00:00'); if(i===0) return 'Today'; if(i===1) return 'Tomorrow'; return t.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}); }
  function longDay(d){ return new Date(d+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'}); }
  function pct(h){ return ((h-D.start)/(D.end-D.start)*100).toFixed(2)+'%'; }
  function render(){
    document.getElementById('days').innerHTML = D.days.map(function(x,i){ return '<button class="day'+(i===sel?' on':'')+'" data-i="'+i+'">'+dayName(x.date,i)+'</button>'; }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('.day'), function(b){ b.onclick=function(){ sel=+b.getAttribute('data-i'); render(); }; });
    var day = D.days[sel], ticks='';
    for (var h=D.start; h<=D.end; h+=3) ticks += '<span style="left:'+pct(h)+'">'+h12(h).replace(':00','')+'</span>';
    var html = '<h2>'+longDay(day.date)+'</h2>';
    var b = '', any = false;
    day.courts.forEach(function(c){
      var open = c.open.filter(function(w){ return w[1]-w[0] >= 0.5; });
      if (open.length) any = true;
      var bars = c.busy.map(function(w){ return '<i class="busy" style="left:'+pct(w[0])+';width:calc('+pct(w[1])+' - '+pct(w[0])+')"></i>'; }).join('');
      b += '<div class="court"><div class="top"><b>'+c.label+'</b><span class="bld">'+c.building+'</span></div>'
        + '<div class="open">'+(open.length ? open.map(function(w){ return '<span class="pill">'+h12(w[0])+' - '+h12(w[1])+'</span>'; }).join('') : '<span class="none">No open time</span>')+'</div>'
        + '<div class="bar">'+bars+'</div>'
        + (c.alsoReserved ? '<div class="note">Also reserved at a time not shown here - check with the front desk.</div>' : '')
        + '</div>';
    });
    if (!any) html += '<p class="sub">No open court time this day.</p>';
    html += '<div class="ticks">'+ticks+'</div>' + b;
    document.getElementById('app').innerHTML = html;
  }
  render();
})();`;

function page(title, inner) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;background:#104946;color:#fff;font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:18px 16px 40px;max-width:720px;margin:0 auto}
  header img{height:30px;display:block;margin-bottom:12px}
  h1{font-size:24px;margin:0 0 4px;color:#B2D049} h2{font-size:17px;margin:16px 0 10px}
  .sub{color:#A9C7C3;font-size:14px;margin:0 0 14px;line-height:1.5}
  .days{display:flex;gap:8px;overflow-x:auto;padding:4px 0 6px;scrollbar-width:none} .days::-webkit-scrollbar{display:none}
  .day{flex:0 0 auto;padding:10px 14px;border-radius:20px;border:1px solid rgba(255,255,255,.25);background:transparent;color:#d6e6e3;font-size:14px;font-weight:700;font-family:inherit}
  .day.on{background:#B2D049;border-color:#B2D049;color:#104946}
  .court{background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:12px 14px;margin-bottom:10px}
  .top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px} .top b{font-size:16px} .bld{font-size:12px;color:#A9C7C3}
  .open{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
  .pill{background:rgba(178,208,73,.18);border:1px solid #B2D049;color:#e3f2b0;border-radius:14px;padding:5px 10px;font-size:14px;font-weight:700}
  .none{color:#A9C7C3;font-size:14px}
  .bar{position:relative;height:12px;border-radius:6px;background:rgba(178,208,73,.45);overflow:hidden}
  .busy{position:absolute;top:0;bottom:0;background:#5b6b69}
  .ticks{position:relative;height:16px;margin:0 15px 6px;font-size:11px;color:#A9C7C3} .ticks span{position:absolute;transform:translateX(-50%);white-space:nowrap}
  .ticks span:first-child{transform:none} .ticks span:last-child{transform:translateX(-100%)}
  .note{margin-top:8px;font-size:12px;color:#fdba74}
  .foot{color:#A9C7C3;font-size:12px;line-height:1.5;margin-top:18px}
</style></head><body>${inner}</body></html>`;
}
