// Europe (Girls Global Challenge) interest meeting — RSVP + add to calendar.
//
//   GET  /meet?t=<players.global_token>          → details + RSVP buttons
//   POST /meet?t=…  { response, attendees, note } → saves (global_meeting_rsvps)
//   GET  /meet?t=…&ics=1                          → calendar file (Apple/Outlook)
//
// Sunday, Oct 11, 2026, 3:30pm, DSSC Warehouse — and on Zoom for anyone who
// can't be there. Drew and Hunter host.

import { createClient } from "@supabase/supabase-js";

const START = "2026-10-11T15:30:00", END = "2026-10-11T16:30:00";   // America/Chicago
const ZOOM = "https://livingsecurity.zoom.us/j/6191058815";
const WAREHOUSE = "DSSC Warehouse, 15113 Fitzhugh Rd, Suite 1400, Dripping Springs, TX";
const TITLE = "DS Elite Europe trip interest meeting";
const DESC = `Croatia Girls Global Challenge (July 2027) interest meeting with Drew and Hunter. In person at the DSSC Warehouse, or join on Zoom: ${ZOOM}`;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const utc = (local) => { const d = new Date(local + "-05:00"); return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); };   // CDT
const gcal = "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(TITLE) + "&dates=" + utc(START) + "/" + utc(END)
  + "&details=" + encodeURIComponent(DESC) + "&location=" + encodeURIComponent(WAREHOUSE + " / Zoom: " + ZOOM) + "&ctz=America/Chicago";

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const url = new URL(req.url, "https://x");
  const t = url.searchParams.get("t") || "";
  const { data: p } = /^[0-9a-f-]{36}$/i.test(t) ? await sb.from("players").select("id, first_name, last_name, team_assignment, parent_name").eq("global_token", t).maybeSingle() : { data: null };

  if (url.searchParams.get("ics") === "1") {
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//DS Elite//Meeting//EN", "METHOD:PUBLISH", "BEGIN:VEVENT",
      "UID:europe-meeting-20261011@dselitevolleyball.com", "DTSTAMP:" + utc("2026-10-05T12:00:00"), "DTSTART:" + utc(START), "DTEND:" + utc(END),
      "SUMMARY:" + TITLE, "LOCATION:" + WAREHOUSE.replace(/,/g, "\\,") + " / Zoom", "URL:" + ZOOM, "DESCRIPTION:" + DESC.replace(/,/g, "\\,"), "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="europe-interest-meeting.ics"');
    return res.status(200).send(ics);
  }
  if (!p) { res.setHeader("Content-Type", "text/html; charset=utf-8"); return res.status(404).send(page("Link not valid", "<h1>This link isn't valid</h1><p>Reply to the text and we'll send you a new one.</p>")); }

  if (req.method === "POST") {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (!["in_person", "zoom", "cant"].includes(b.response)) return res.status(400).json({ error: "Pick an option" });
    const row = { player_id: p.id, response: b.response, attendees: b.attendees ? Math.max(1, Math.min(10, parseInt(b.attendees, 10) || 1)) : null, note: String(b.note || "").slice(0, 300) || null, responder: String(b.responder || "").slice(0, 80) || null, updated_at: new Date().toISOString() };
    const { error } = await sb.from("global_meeting_rsvps").upsert(row, { onConflict: "player_id" });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  const { data: cur } = await sb.from("global_meeting_rsvps").select("*").eq("player_id", p.id).maybeSingle();
  const girl = p.first_name;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  return res.status(200).send(page("Europe trip meeting", `
<div class="kicker">DS Elite · Europe 2027</div>
<h1>Europe trip interest meeting</h1>
<div class="card">
  <div class="row"><b>Sunday, October 11 · 3:30pm</b></div>
  <div class="row">In person: <b>DSSC Warehouse</b>, 15113 Fitzhugh Rd, Suite 1400, Dripping Springs</div>
  <div class="row">Can't be there? Join on Zoom: <a href="${ZOOM}">${ZOOM.replace("https://", "")}</a></div>
  <div class="row">Drew and Hunter will walk through the Croatia Girls Global Challenge (July 2027) and answer your questions. Players and parents are both welcome.</div>
</div>
<h2>Will you join us${girl ? " with " + esc(girl) : ""}?</h2>
<div class="opts">
  <button data-r="in_person">In person at the Warehouse</button>
  <button data-r="zoom">On Zoom</button>
  <button data-r="cant">Can't make it</button>
</div>
<label class="n">How many of you? <input id="n" type="number" min="1" max="10" value="${cur?.attendees || 2}"></label>
<label class="n">Your name <input id="who" value="${esc(cur?.responder || "")}" placeholder="optional"></label>
<label class="n">Questions for Drew &amp; Hunter <input id="note" value="${esc(cur?.note || "")}" placeholder="optional"></label>
<div id="msg">${cur ? "You said: <b>" + ({ in_person: "in person", zoom: "Zoom", cant: "can't make it" })[cur.response] + "</b>. Tap another option to change it." : ""}</div>
<h2>Add it to your calendar</h2>
<div class="cal"><a class="btn" href="${esc(gcal)}" target="_blank" rel="noreferrer">Google Calendar</a><a class="btn" href="/meet?t=${esc(t)}&ics=1">Apple / Outlook</a></div>
<p class="small">Haven't filled out the trip interest form yet? <a href="/global?t=${esc(t)}">It's here</a> — it takes two minutes.</p>
<script>
document.querySelectorAll(".opts button").forEach(function (b) { b.addEventListener("click", async function () {
  var msg = document.getElementById("msg"); msg.textContent = "Saving...";
  try {
    var r = await fetch(location.href, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ response: b.dataset.r, attendees: document.getElementById("n").value, responder: document.getElementById("who").value, note: document.getElementById("note").value }) });
    var d = await r.json(); if (!r.ok) throw new Error(d.error || "Couldn't save");
    document.querySelectorAll(".opts button").forEach(function (x) { x.classList.toggle("on", x === b); });
    msg.innerHTML = b.dataset.r === "cant" ? "Thanks for letting us know. We'll share what we cover." : "Thanks, you're on the list! " + (b.dataset.r === "zoom" ? "The Zoom link is above, and in the calendar invite." : "See you Sunday at the Warehouse.");
  } catch (e) { msg.textContent = e.message; }
}); });
${cur ? `document.querySelector('.opts button[data-r="${cur.response}"]').classList.add("on");` : ""}
</script>`));
}

function page(title, inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>
body{margin:0;background:#0a0a0a;color:#fff;font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:22px 16px 40px;max-width:560px;margin:0 auto}
.kicker{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#e91e8c;font-weight:800}
h1{font-size:24px;margin:6px 0 14px} h2{font-size:16px;margin:22px 0 10px}
.card{background:#141414;border:1px solid #2a2a2a;border-radius:14px;padding:14px 16px} .row{padding:5px 0;line-height:1.45;color:#ddd} a{color:#ff69b4}
.opts{display:flex;flex-direction:column;gap:8px} .opts button{background:#141414;border:1px solid #333;color:#fff;font-size:16px;font-weight:700;padding:14px;border-radius:12px;text-align:left;font-family:inherit}
.opts button.on{border-color:#22c55e;background:rgba(34,197,94,.14);color:#22c55e}
label.n{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:10px;font-size:13px;color:#aaa}
label.n input{background:#141414;border:1px solid #333;color:#fff;border-radius:8px;padding:8px;font-size:15px;width:60%;font-family:inherit} label.n input[type=number]{width:70px}
#msg{margin-top:12px;font-size:14px;color:#22c55e;min-height:20px}
.cal{display:flex;gap:8px;flex-wrap:wrap} .btn{background:#e91e8c;color:#fff;text-decoration:none;font-weight:800;padding:11px 16px;border-radius:10px;font-size:14px}
.small{font-size:13px;color:#999;margin-top:22px}
</style></head><body>${inner}</body></html>`;
}
