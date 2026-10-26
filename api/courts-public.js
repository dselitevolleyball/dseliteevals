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
    <div id="app"></div>
    <p class="foot">Checked at ${esc(checked)}. Courts can be booked after this was checked, so please confirm at the front desk. Courts 1-4 are in Warehouse I, 5-6 in Warehouse II.</p>
    <script type="application/json" id="data">${json}</script>
    <script>${CLIENT}</script>`));
}

// The page's own script: a day picker and, per court, open times + a timeline.
const CLIENT = `(function(){
  var D = JSON.parse(document.getElementById('data').textContent);
  var sel = 0, mode = 'day';
  var STEP = 0.5, ROW = 22;
  function h12(h){ var hh=Math.floor(h), mm=Math.round((h-hh)*60), ap=hh>=12&&hh<24?'pm':'am', x=hh%12===0?12:hh%12; return x+(mm?':'+(mm<10?'0':'')+mm:'')+ap; }
  function sh(h){ return h12(h).replace(':00','').replace('am','a').replace('pm','p'); }
  function dayName(d,i){ if(i===0) return 'Today'; if(i===1) return 'Tomorrow'; return new Date(d+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}); }
  function longDay(d){ return new Date(d+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'}); }
  function opens(c){ return c.open.filter(function(w){ return w[1]-w[0] >= 0.5; }); }
  function isBusy(c,h){ return c.busy.some(function(w){ return h >= w[0]-1e-9 && h < w[1]-1e-9; }); }
  function controls(){
    var chips = D.days.map(function(x,i){ return '<button class="day'+(i===sel?' on':'')+'" data-i="'+i+'">'+dayName(x.date,i)+'</button>'; }).join('');
    return '<div class="ctl"><div class="seg"><button class="m'+(mode==='day'?' on':'')+'" data-m="day">Day</button><button class="m'+(mode==='week'?' on':'')+'" data-m="week">Week</button></div></div>'
      + (mode==='day' ? '<div class="days">'+chips+'</div>' : '');
  }
  function dayView(){
    var day = D.days[sel], html = '<h2>'+longDay(day.date)+'</h2>';
    html += '<div class="legend"><span><i class="sw open"></i>Open</span><span><i class="sw busy"></i>Booked</span></div>';
    html += '<div class="cards">' + day.courts.map(function(c){ var o=opens(c);
      return '<div class="card"><div class="ct"><b>'+c.label+'</b> <span>&middot; '+c.building+'</span></div><div class="cw'+(o.length?'':' none')+'">'+(o.length?'Open '+o.map(function(w){return sh(w[0])+'&ndash;'+sh(w[1]);}).join(', '):'No open time')+'</div>'+(c.alsoReserved?'<div class="cn">Also reserved at a time not shown</div>':'')+'</div>'; }).join('') + '</div>';
    var slots=[]; for (var h=D.start; h<D.end-1e-9; h+=STEP) slots.push(Math.round(h*100)/100);
    var cols = day.courts.map(function(c){ return slots.map(function(h){ return isBusy(c,h); }); });
    var t = '<div class="tw"><table><thead><tr><th class="tm" rowspan="2">Time</th><th colspan="4">Warehouse I</th><th colspan="2" class="fx">Warehouse II</th></tr><tr>'
      + day.courts.map(function(c,i){ return '<th'+(i===4?' class="fx"':'')+'>'+c.label+'</th>'; }).join('') + '</tr></thead><tbody>';
    slots.forEach(function(h, si){
      t += '<tr><td class="tm'+(Number.isInteger(h)?' hr':'')+'">'+(Number.isInteger(h)?h12(h):'')+'</td>';
      cols.forEach(function(col, ci){
        if (si>0 && col[si-1]===col[si]) return;
        var n=1; while (si+n<col.length && col[si+n]===col[si]) n++;
        var end = slots[si+n-1]+STEP;
        t += '<td rowspan="'+n+'"'+(ci===4?' class="fx"':'')+'><div class="'+(col[si]?'b':'o')+'" style="min-height:'+(n*ROW-4)+'px">'+(col[si]?'Booked':(n>=2?'Open '+sh(h)+'&ndash;'+sh(end):''))+'</div></td>';
      });
      t += '</tr>';
    });
    return html + t + '</tbody></table></div>';
  }
  function weekView(){
    var t = '<h2>This week</h2><div class="tw"><table class="wk"><thead><tr><th>Court</th>'
      + D.days.map(function(x,i){ return '<th><a href="#" data-go="'+i+'">'+dayName(x.date,i)+'</a></th>'; }).join('') + '</tr></thead><tbody>';
    D.days[0].courts.forEach(function(c0, ci){
      t += '<tr><td class="cl"><b>'+c0.label+'</b><div>'+c0.building+'</div></td>';
      D.days.forEach(function(x,i){ var c=x.courts[ci], o=opens(c);
        t += '<td data-go="'+i+'">'+(o.length?o.map(function(w){return '<div>'+sh(w[0])+'&ndash;'+sh(w[1])+'</div>';}).join(''):'<span class="nn">Booked</span>')+(c.alsoReserved?'<div class="cn">+ reserved (time?)</div>':'')+'</td>'; });
      t += '</tr>';
    });
    return t + '</tbody></table></div><p class="sub">Tap a day to see it hour by hour.</p>';
  }
  function render(){
    document.getElementById('app').innerHTML = controls() + (mode==='day' ? dayView() : weekView());
    Array.prototype.forEach.call(document.querySelectorAll('.day'), function(b){ b.onclick=function(){ sel=+b.getAttribute('data-i'); render(); }; });
    Array.prototype.forEach.call(document.querySelectorAll('.m'), function(b){ b.onclick=function(){ mode=b.getAttribute('data-m'); render(); }; });
    Array.prototype.forEach.call(document.querySelectorAll('[data-go]'), function(b){ b.onclick=function(e){ e.preventDefault(); sel=+b.getAttribute('data-go'); mode='day'; render(); window.scrollTo(0,0); }; });
  }
  render();
})();`;

function page(title, inner) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>
  :root{color-scheme:dark}
  body{margin:0 auto;background:#104946;color:#fff;font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:18px 16px 40px;max-width:1100px}
  header img{height:30px;display:block;margin-bottom:12px}
  h1{font-size:24px;margin:0 0 4px;color:#B2D049} h2{font-size:17px;margin:14px 0 8px}
  .sub{color:#A9C7C3;font-size:14px;margin:0 0 12px;line-height:1.5}
  .ctl{display:flex;gap:10px;align-items:center;margin:4px 0 8px}
  .seg{display:inline-flex;border:1px solid rgba(255,255,255,.25);border-radius:10px;overflow:hidden}
  .seg button{background:transparent;border:none;color:#d6e6e3;font:inherit;font-weight:800;font-size:14px;padding:8px 18px}
  .seg button.on{background:#B2D049;color:#104946}
  .days{display:flex;gap:8px;overflow-x:auto;padding:2px 0 4px;scrollbar-width:none} .days::-webkit-scrollbar{display:none}
  .day{flex:0 0 auto;padding:9px 14px;border-radius:20px;border:1px solid rgba(255,255,255,.25);background:transparent;color:#d6e6e3;font:inherit;font-size:14px;font-weight:700}
  .day.on{background:#B2D049;border-color:#B2D049;color:#104946}
  .legend{display:flex;gap:14px;font-size:12px;color:#A9C7C3;margin:0 0 10px} .legend span{display:inline-flex;align-items:center;gap:6px}
  .sw{display:inline-block;width:12px;height:12px;border-radius:3px} .sw.open{background:rgba(178,208,73,.18);border:1px solid #B2D049} .sw.busy{background:#2c4643;border:1px solid #4d6865}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:12px}
  .card{background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:8px 10px}
  .ct{font-size:13px} .ct span{color:#A9C7C3;font-size:12px} .cw{font-size:13px;color:#d9ef8a;font-weight:700;margin-top:3px;line-height:1.45} .cw.none{color:#A9C7C3;font-weight:500}
  .cn{font-size:11px;color:#fdba74;margin-top:3px}
  .tw{overflow-x:auto;border:1px solid rgba(255,255,255,.14);border-radius:10px;background:rgba(0,0,0,.12)}
  table{border-collapse:collapse;width:100%;min-width:620px;table-layout:fixed}
  th{font-size:11px;font-weight:800;color:#A9C7C3;padding:6px;border-bottom:1px solid rgba(255,255,255,.14);text-align:center}
  th.tm{width:56px} .fx{border-left:2px solid rgba(255,255,255,.18)}
  td{padding:2px;vertical-align:top;border-left:1px solid rgba(255,255,255,.06)}
  td.tm{font-size:10px;color:#A9C7C3;height:22px;padding:0 6px;white-space:nowrap;border-top:1px dotted rgba(255,255,255,.06)} td.tm.hr{border-top:1px solid rgba(255,255,255,.14)}
  td .o{border-radius:6px;background:rgba(178,208,73,.12);border:1px solid rgba(178,208,73,.45);color:#d9ef8a;font-size:10px;font-weight:700;padding:3px 5px;box-sizing:border-box}
  td .b{border-radius:6px;background:#2c4643;border:1px solid #4d6865;color:#9fb5b2;font-size:11px;font-weight:700;padding:3px 5px;box-sizing:border-box}
  table.wk{min-width:760px;table-layout:auto} table.wk th{text-align:left} table.wk th a{color:#d6e6e3;text-decoration:none}
  table.wk td{padding:8px;font-size:12px;color:#d9ef8a;line-height:1.6;border-top:1px solid rgba(255,255,255,.1);cursor:pointer}
  td.cl{color:#fff;white-space:nowrap} td.cl div{font-size:10px;color:#A9C7C3} .nn{color:#9fb5b2}
  .foot{color:#A9C7C3;font-size:12px;line-height:1.5;margin-top:18px}
</style></head><body>${inner}</body></html>`;
}
