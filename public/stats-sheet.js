// Coach testing sheet (served with /stats?t=…, see api/stats-form.js).
// Roster view: each player's latest numbers with ▲▼ change from the test
// before. Tap a player: full history + a form for a new test that compares
// every number to last time (and to the first result) as it's typed, and
// warns under a box when a number looks like a data-entry slip.

// Likely data-entry errors (Drew, Oct 12 2026: "red-flag potential issues with
// players' metrics — things that seem too high or too low — potentially a data
// entry issue"). A line-for-line port of sections A–C of statFlags in
// shared/stat-report.js (unit slips + physical range; the row against itself;
// change since her previous result), walking her history the way
// statResultRows does. The thresholds are NOT in this file: R is
// STAT_FLAG_RULES and L the metric labels, serialized into the page by
// api/stats-form.js, so a recalibration in HQ reaches the sheet too. Section D
// (unusual for her age group) needs the whole club's numbers and stays in HQ.
// Checked flag-for-flag against statFlags on every real player plus 20,000
// random histories (Oct 12 2026). Global on purpose so that check can load it.
//   base  = { date: stat_baseline_date, stand_reach, approach_touch, standing_touch, dash_10y }
//   tests = [{ id, date, stand_reach, approach_touch, standing_touch, vertical, broad_jump, dash_10y }]
//   -> [{ key, from, date, row, value, level, reason, rule, related, prevRow? }], red first
function statSheetFlags(R, L, base, tests) {
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function hund(n) { return Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-6); }
  function d2(n) { return (hund(n) / 100).toFixed(2); }
  function typed(v) { return String(+(+v).toFixed(2)); }
  function signed(d) { var h = hund(d); return (h > 0 ? "+" : h < 0 ? "−" : "±") + (Math.abs(h) / 100).toFixed(2); }
  function day(iso) { return new Date(String(iso).slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); }
  function has(a, x) { return a.indexOf(x) >= 0; }
  var KEYS = ["stand_reach", "approach_touch", "standing_touch", "vertical", "broad_jump", "dash_10y"];
  // Her results oldest first: the baseline, then each test (statResultRows).
  base = base || {};
  var sr = num(base.stand_reach), ap0 = num(base.approach_touch);
  var bd = /^\d{4}-\d{2}-\d{2}/.test(String(base.date || "")) ? String(base.date).slice(0, 10) : null;
  var rows = [{ row: "tryout", from: bd ? day(bd) : "Tryouts", date: bd, tryout: true,
    stand_reach: sr, approach_touch: ap0, standing_touch: num(base.standing_touch), vertical: sr != null && ap0 != null ? ap0 - sr : null, broad_jump: null, dash_10y: num(base.dash_10y),
    reach: sr, reachOwn: sr != null, reachRow: sr != null ? "tryout" : null, vertEntered: null }];
  var reach = sr, reachRow = rows[0].reachRow;
  (tests || []).slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)) || (Number(a.id) || 0) - (Number(b.id) || 0); }).forEach(function (t, i) {
    var r = { row: "test:" + (t.id != null ? t.id : i), from: day(t.date), date: String(t.date || "").slice(0, 10) || null, tryout: false };
    KEYS.forEach(function (k) { r[k] = num(t[k]); });
    if (r.stand_reach != null) { reach = r.stand_reach; reachRow = r.row; }
    r.reach = reach; r.reachOwn = r.stand_reach != null; r.reachRow = reachRow; r.vertEntered = r.vertical;
    // Vertical is always touch minus reach when both are on file (same as shared/stat-report.js statResultRows), so the sheet and HQ agree to the hundredth.
    if (r.approach_touch != null && reach != null) r.vertical = r.approach_touch - reach;
    rows.push(r);
  });
  rows.forEach(function (r) { r.standJump = r.standing_touch != null && r.reach != null ? r.standing_touch - r.reach : null; });

  var out = [], SIZE = ["stand_reach", "approach_touch", "standing_touch"], short = R.short40cm;
  function add(r, key, level, rule, reason, extra) {
    var f = { key: key, from: r.from, date: r.date, row: r.row, value: r[key], level: level, reason: reason, rule: rule, related: [] };
    for (var x in extra || {}) f[x] = extra[x];
    out.push(f);
  }
  function rangeRed(row, keys) { return out.some(function (f) { return f.row === row && f.rule === "range" && has(keys, f.key); }); }
  for (var ri = 0; ri < rows.length; ri++) {
    var r = rows[ri];
    // A. Unit slips first (they explain the number), then the physical range.
    Object.keys(R.range).forEach(function (k) {
      var v = r[k]; if (v == null) return;
      var lo = R.range[k][0], hi = R.range[k][1], Lk = L[k], why = null;
      if (k === "dash_10y") {
        if (v >= 100) why = Lk + " " + typed(v) + "s: looks like it was typed without the decimal point (" + d2(v / (v >= 1000 ? 1000 : 100)) + "s?)";
        else if (v >= 10) why = Lk + " " + typed(v) + "s: looks like a typo (" + d2(v / 10) + "s?)";
        else if (v < lo) why = Lk + " " + d2(v) + "s is faster than any youth player runs; likely a typo";
        else if (v > hi) why = Lk + " " + d2(v) + "s is far too slow for 10 yards; likely a typo";
      } else {
        if (v >= 600) why = Lk + " " + typed(v) + '": missing decimal point? (' + d2(v / (v >= 6000 ? 100 : 10)) + '"?)';
        else if (v >= 150 && v < 330) why = Lk + " " + typed(v) + '": looks like centimeters (' + d2(v / 2.54) + '")';
        else if (v < 12) why = Lk + " " + typed(v) + '": looks like feet (' + typed(v) + " ft = " + d2(v * 12) + '"). Enter inches';
        else if (v < 40 && (k === "approach_touch" || k === "standing_touch")) why = Lk + " " + typed(v) + '": looks like a jump height, not a touch height';
        else if (v < lo || v > hi) why = Lk + " " + d2(v) + '" is too ' + (v < lo ? "low" : "high") + " to be right; likely a typo";
      }
      if (why) add(r, k, "red", "range", why, { related: k === "approach_touch" || k === "stand_reach" ? ["vertical"] : [] });
    });
    // B. The row against itself; skipped on a junk reach/touch (or a reach
    // carried from a row where it's junk) — relationships on those are noise.
    if (rangeRed(r.row, SIZE)) continue;
    var rch = r.reachRow && r.reachRow !== r.row && rangeRed(r.reachRow, ["stand_reach"]) ? null : r.reach;
    var ap = r.approach_touch, st = r.standing_touch, v, why;
    if (ap != null && rch != null) {
      v = ap - rch; why = "(touch " + d2(ap) + '" − reach ' + d2(rch) + '")';
      if (v <= 0) add(r, "approach_touch", "red", "ap<=reach", "Approach touch " + d2(ap) + '" is not above her standing reach ' + d2(rch) + '"; likely a typo', { related: ["stand_reach", "vertical"] });
      else if (v < R.vertical[0]) add(r, "vertical", "red", "vertLow", "Approach vertical only " + d2(v) + '" ' + why + "; one of those is likely a typo" + (v + short >= R.vertical[0] && v + short <= R.vertical[1] ? " (touch about 40 cm short?)" : ""), { value: v, related: ["approach_touch", "stand_reach"] });
      else if (v > R.vertical[1]) add(r, "vertical", "red", "vertHigh", "Approach vertical " + d2(v) + '" ' + why + " is beyond elite level; check the reach and touch", { value: v, related: ["approach_touch", "stand_reach"] });
    }
    if (st != null && rch != null) {
      v = st - rch;
      if (v <= 0) add(r, "standing_touch", "red", "st<=reach", "Standing jump touch " + d2(st) + '" is not above her standing reach ' + d2(rch) + '"; likely a typo', { related: ["stand_reach"] });
      else if (v < R.standJump[0]) add(r, "standing_touch", "red", "sjLow", "Standing jump only " + d2(v) + '" above her reach (touch ' + d2(st) + '", reach ' + d2(rch) + '"); likely a typo' + (v + short >= R.standJump[0] && v + short <= R.standJump[1] ? " (touch about 40 cm short?)" : ""), { related: ["stand_reach"] });
      else if (v > R.standJump[1]) add(r, "standing_touch", "red", "sjHigh", "Standing jump " + d2(v) + '" above her reach (touch ' + d2(st) + '", reach ' + d2(rch) + '") is beyond elite level; likely a typo', { related: ["stand_reach"] });
    }
    if (ap != null && st != null) {
      var d = ap - st, B = R.bonus;
      if (d < B.redLo) add(r, "approach_touch", "red", "bonusNeg", "Approach touch " + d2(ap) + '" is ' + d2(-d) + '" below her standing jump touch ' + d2(st) + '". Boxes swapped, or a typo?', { related: ["standing_touch", "vertical"] });
      else if (d < B.amberLo) add(r, "approach_touch", "amber", "bonusNeg", "Approach touch " + d2(ap) + '" is ' + d2(-d) + '" below her standing jump touch ' + d2(st) + '". Boxes swapped?', { related: ["standing_touch", "vertical"] });
      else if (d > B.redHi) add(r, "standing_touch", "red", "bonusPos", "Standing jump touch " + d2(st) + '" is ' + d2(d) + '" below her approach touch ' + d2(ap) + '". Players are usually within 0–5"; likely a typo', { related: ["approach_touch"] });
      else if (d > B.amberHi) add(r, "standing_touch", "amber", "bonusPos", "Standing jump touch " + d2(st) + '" is ' + d2(d) + '" below her approach touch ' + d2(ap) + '"; an unusually big gap', { related: ["approach_touch"] });
    }
    if (r.vertEntered != null && ap != null && rch != null && Math.abs(r.vertEntered - (ap - rch)) > R.vMismatch)
      add(r, "vertical", "red", "vMismatch", "Vertical " + d2(r.vertEntered) + "\" doesn't match approach touch − reach (" + d2(ap - rch) + '")', { value: r.vertEntered, related: ["approach_touch", "stand_reach"] });
    if (!r.tryout && st != null && ap == null) {
      var bestAp = Math.max.apply(null, rows.filter(function (x) { return x !== r && x.approach_touch != null; }).map(function (x) { return x.approach_touch; }));
      if (isFinite(bestAp) && st > bestAp + R.stAboveAp)
        add(r, "standing_touch", "amber", "stAboveAp", "Standing jump touch " + d2(st) + '" is above her best approach touch (' + d2(bestAp) + '") and approach is blank. Typed in the wrong box?');
    }
  }

  // C. Change vs her previous result for that metric; the flag sits on the
  // later result and is skipped when a red flag at either end explains it.
  [["stand_reach", "stand_reach", ["stand_reach"], ["vertical"]], ["vertical", "vertical", ["vertical", "approach_touch", "stand_reach"], ["approach_touch"]],
    ["standJump", "standing_touch", ["standing_touch", "stand_reach"], []], ["broad_jump", "broad_jump", ["broad_jump"], []], ["dash_10y", "dash_10y", ["dash_10y"], []]].forEach(function (c4) {
    var m = c4[0], key = c4[1], deps = c4[2], related = c4[3], c = R.change[m], u = m === "dash_10y" ? "s" : '"', prev = null;
    rows.forEach(function (r) {
      var v = r[m]; if (v == null) return;   // stand_reach is only her own, never a carried one
      if (prev) {
        var known = !!(prev.r.date && r.date);
        var months = known ? Math.max(0.5, (Date.parse(r.date) - Date.parse(prev.r.date)) / 864e5 / 30.44) : 4;
        var sc = Math.max(1, months / 4), d = v - prev.v, gain = m === "dash_10y" ? -d : d;
        var lim = function (x) { return Array.isArray(x) ? x[0] + x[1] * months : x * sc; };
        var level = gain > lim(c.redUp) ? "red" : gain > lim(c.amberUp) ? "amber" : -gain > c.redDown ? "red" : -gain > c.amberDown ? "amber" : null;
        var explained = out.some(function (f) { return f.level === "red" && (f.row === r.row || f.row === prev.r.row) && (has(deps, f.key) || has(f.related, key)); });
        if (level && !explained) {
          var lab = m === "standJump" ? "Standing jump (touch − reach)" : L[m];
          add(r, key, level, "change:" + m, lab + " " + signed(d) + u + " since " + prev.r.from + " (" + d2(prev.v) + u + " → " + d2(v) + u + ")" + (known ? " in " + months.toFixed(1) + " months" : "") + ", more than real change explains; one of the two is likely a typo", { prevRow: prev.r.row, related: related });
        }
      }
      prev = { r: r, v: v };
    });
  });

  // Red first, then oldest result first.
  var at = {}; rows.forEach(function (r, i) { at[r.row] = i; });
  return out.map(function (f, i) { return [f, i]; }).sort(function (a, b) { return (a[0].level === b[0].level ? 0 : a[0].level === "red" ? -1 : 1) || at[a[0].row] - at[b[0].row] || a[1] - b[1]; }).map(function (x) { return x[0]; });
}

(function () {
  var D = JSON.parse(document.getElementById("data").textContent);
  // [key, label, unit, higher is better]
  var M = [["stand_reach", "Stand & reach", '"', 1], ["approach_touch", "Jump approach", '"', 1], ["standing_touch", "Standing jump", '"', 1], ["vertical", "Vertical", '"', 1], ["broad_jump", "Broad jump", '"', 1], ["dash_10y", "10 yd dash", "s", 0]];
  var app = document.getElementById("app");
  var by = ""; try { by = localStorage.getItem("statsBy") || ""; } catch (e) { /* private mode */ }
  // Jump approach and standing jump can be typed in centimeters (Drew, Oct 2026 - same as the tryout
  // Physical Testing card): the sheet converts to inches as you type and saves
  // inches, so the server, the player card and the reports never see cm.
  var CM = 2.54, LEN = { approach_touch: 1, standing_touch: 1 }; // the two touches only (Drew); stand & reach and broad jump stay inches
  var unit = "in"; try { unit = localStorage.getItem("statsUnit") === "cm" ? "cm" : "in"; } catch (e) { /* private mode */ }
  // A typed value -> inches (null = blank, NaN = unreadable), read in unit u.
  function toIn(key, v, u) {
    if (!LEN[key] || (u || unit) !== "cm") return inch(v);
    v = String(v || "").trim(); if (!v) return null;
    var m = /^(\d+(?:\.\d+)?)\s*(?:cm)?$/i.exec(v); return m ? Math.round(+m[1] / CM * 100) / 100 : NaN;
  }
  function inUnit(inches) { return unit === "cm" ? String(Math.round(inches * CM * 10) / 10) : f2(inches); }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  // Hundredths, half away from zero, like shared/stat-report.js (the nudge
  // keeps a typed 1.865 from rounding down to 1.86 on float drift).
  function hund(n) { return Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-6); }
  // Inches to two decimals with a whole number's ".00" dropped — 98.82, 102.50,
  // 102 — so last time, now and the change all line up (Drew, Oct 12 2026: "make
  // sure the change is two decimal points like 3.14"; it used to round to 0.1).
  function f2(n) { return n == null ? "—" : (hund(n) / 100).toFixed(2).replace(/\.00$/, ""); }
  // Timed runs keep hundredths (1.85s, not 1.9) - Drew, Oct 2026. unit "s" = the 10-yard dash.
  function fv(n, unit) { return n == null ? "—" : unit === "s" ? (hund(n) / 100).toFixed(2) : f2(n); }
  function inch(v) {
    v = String(v || "").trim(); if (!v) return null;
    var m = /^(\d+)\s*(?:'|ft|feet|-)\s*(\d+(?:\.\d+)?)?\s*(?:"|in)?$/i.exec(v); if (m) return +m[1] * 12 + (m[2] ? +m[2] : 0);
    m = /^(\d+(?:\.\d+)?)\s*(?:"|in|s|sec)?$/i.exec(v); return m ? +m[1] : NaN;
  }
  function fmtDate(d) { if (!d) return "Tryouts"; return new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" }); }
  // Vertical for every row, carrying the last stand & reach forward when it wasn't re-measured.
  function withVert(hist) {
    var reach = null;
    return hist.map(function (h) { var o = Object.assign({}, h); if (o.stand_reach != null) reach = o.stand_reach; o.vertical = (o.approach_touch != null && reach != null) ? o.approach_touch - reach : null; return o; });
  }
  // [value before latest, latest, first]
  function points(hist, k) { var v = hist.filter(function (h) { return h[k] != null; }); return [v.length > 1 ? v[v.length - 2][k] : null, v.length ? v[v.length - 1][k] : null, v.length ? v[0][k] : null]; }
  function delta(prev, cur, up, unit) {
    if (prev == null || cur == null) return "";
    // Taken between the two numbers as shown, always two decimals: ▲ +2.50".
    var d = (hund(cur) - hund(prev)) / 100; if (!d) return '<span class="d same">no change</span>';
    var good = up ? d > 0 : d < 0;
    return '<span class="d ' + (good ? "up" : "down") + '">' + (d > 0 ? "▲ +" : "▼ ") + Math.abs(d).toFixed(2) + unit + "</span>";
  }

  function list() {
    var rows = D.players.map(function (p) {
      var h = withVert(p.hist), last = h[h.length - 1];
      var cells = M.map(function (m) { var t = points(h, m[0]); return "<td><b>" + (t[1] == null ? "—" : fv(t[1], m[2]) + m[2]) + "</b>" + delta(t[0], t[1], m[3], m[2]) + "</td>"; }).join("");
      return '<tr data-id="' + p.id + '"><td class="nm">' + (p.num ? '<span class="no">#' + esc(p.num) + "</span> " : "") + esc(p.name) +
        '<div class="when">' + (h.length > 1 ? "tested " + fmtDate(last.date) : (p.base ? "baseline " + fmtDate(p.base) : "tryout numbers") + " only") + "</div></td>" + cells + '<td><button class="add">+ Add</button></td></tr>';
    }).join("");
    // Opened from the all-teams list: a way back to it.
    var ref = document.referrer || "";
    var fromList = ref.indexOf("/stats?t=") >= 0 && ref !== location.href;
    app.innerHTML = (fromList ? '<a class="back" href="' + esc(document.referrer) + '" style="display:inline-block;text-decoration:none">‹ All teams</a>' : "") + "<h1>" + esc(D.team) + " — testing</h1>" +
      '<p class="hint">Latest result for each player. ▲▼ is the change from the test before — green is better (for the dash, faster is better). Tap a player to see every test and add new numbers.</p>' +
      '<div class="tw"><table class="list"><thead><tr><th>Player</th>' + M.map(function (m) { return "<th>" + m[1] + "</th>"; }).join("") + "<th></th></tr></thead><tbody>" +
      (rows || '<tr><td colspan="8">No players on this team yet.</td></tr>') + "</tbody></table></div>";
    app.querySelectorAll("tr[data-id]").forEach(function (tr) { tr.addEventListener("click", function () { detail(+tr.dataset.id); }); });
    window.scrollTo(0, 0);
  }

  function detail(id) {
    var p = D.players.find(function (x) { return x.id === id; });
    var h = withVert(p.hist);
    var histRows = h.map(function (r, i) {
      // The baseline row shows the day it was measured, not "Tryout" (Drew, Oct 12
      // 2026: "include the date of the baseline instead of tryouts").
      var when = r.date ? fmtDate(r.date) : p.base ? fmtDate(p.base) + '<div class="when">baseline</div>' : "Tryouts";
      return '<tr><td class="dt">' + when + (r.by ? '<div class="when">' + esc(r.by) + "</div>" : "") + "</td>" + M.map(function (m) {
        var prev = null; for (var j = i - 1; j >= 0; j--) if (h[j][m[0]] != null) { prev = h[j][m[0]]; break; }
        return "<td>" + (r[m[0]] == null ? "—" : fv(r[m[0]], m[2]) + m[2]) + delta(prev, r[m[0]], m[3], m[2]) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    function field(m) {
      if (m[0] === "vertical") return '<label><span>Vertical (auto)</span><div class="auto" id="vert">—</div><div class="cmp" id="c_vertical"></div><div id="w_vertical"></div></label>';
      var t = points(h, m[0]);
      return '<label><span>' + m[1] + '</span><div class="iw"><input inputmode="decimal" name="' + m[0] + '" autocomplete="off" placeholder="' + (t[1] == null ? "" : (LEN[m[0]] ? inUnit(t[1]) : fv(t[1], m[2]))) + '"><em>' + (m[2] === "s" ? "sec" : LEN[m[0]] ? unit : "in") + '</em></div><div class="cmp" id="c_' + m[0] + '"></div><div id="w_' + m[0] + '"></div></label>';
    }
    app.innerHTML = '<button class="back">‹ All players</button><h1>' + (p.num ? '<span class="no">#' + esc(p.num) + "</span> " : "") + esc(p.name) + "</h1>" +
      '<div class="tw"><table class="list hist"><thead><tr><th>Date</th>' + M.map(function (m) { return "<th>" + m[1] + "</th>"; }).join("") + "</tr></thead><tbody>" + histRows + "</tbody></table></div>" +
      '<h2>New test</h2><div class="top"><label>Date <input type="date" id="date" value="' + D.today + '"></label><label>Tested by <input id="by" value="' + esc(by) + '" placeholder="Your name"></label>' +
      '<label>Measuring in<span class="units"><button type="button" data-u="in">IN</button><button type="button" data-u="cm">CM</button></span></label></div>' +
      '<p class="hint" id="unitHint"></p>' +
      '<div class="g">' + M.map(field).join("") + "</div>" +
      '<div class="bar"><span id="msg"></span><button class="save">Save</button></div>';
    app.querySelector(".back").onclick = list;
    var inputs = app.querySelectorAll(".g input");
    function recalc() {
      var vals = {}; inputs.forEach(function (i) { vals[i.name] = toIn(i.name, i.value); });
      var reach = vals.stand_reach != null && !isNaN(vals.stand_reach) ? vals.stand_reach : points(h, "stand_reach")[1];
      vals.vertical = (vals.approach_touch != null && !isNaN(vals.approach_touch) && reach != null) ? vals.approach_touch - reach : null;
      document.getElementById("vert").textContent = vals.vertical == null ? "—" : f2(vals.vertical) + '"';
      M.forEach(function (m) {
        var el = document.getElementById("c_" + m[0]), t = points(h, m[0]), v = vals[m[0]];
        if (v != null && isNaN(v)) { el.innerHTML = '<span class="d down">can\'t read that</span>'; return; }
        if (v == null) { el.innerHTML = t[1] == null ? "no earlier result" : "last: " + fv(t[1], m[2]) + m[2]; return; }
        // Typing cm: show the inches it becomes, right under the box.
        var conv = LEN[m[0]] && unit === "cm" ? '<b class="conv">= ' + f2(v) + ' in</b> · ' : "";
        el.innerHTML = conv + (t[1] == null ? "first result" : "vs last " + delta(t[1], v, m[3], m[2]) + (t[2] != null && t[0] != null ? ' <span class="since">· vs first ' + delta(t[2], v, m[3], m[2]) + "</span>" : ""));
      });
    }
    // ── Warnings: statSheetFlags over her history plus the test being typed ──
    // Amber note under the box, saving still allowed. Judged on the finished
    // number (the box loses focus, or a pause), never per keystroke: the tryout
    // grid's change_log is full of half-typed values (1, 18) that all look
    // wrong (Oct 12 2026 flag calibration).
    var NEW = "test:new", shown = [], timer = null;
    function check() {
      clearTimeout(timer);
      var date = document.getElementById("date").value || D.today, same = null, tests = [];
      p.hist.slice(1).forEach(function (x) { if (x.date === date) same = x; else tests.push(x); });
      // What a save would store: the boxes typed now plus anything already saved
      // that day (a second save on a date adds to it — api/stats-form.js).
      var row = { id: "new", date: date }, any = false;
      inputs.forEach(function (i) {
        var v = toIn(i.name, i.value);
        if (v != null && !isNaN(v)) { row[i.name] = v; any = true; }
        else if (same && same[i.name] != null) { row[i.name] = same[i.name]; any = true; }
      });
      shown = !any || !D.rules ? [] : statSheetFlags(D.rules, D.labels || {}, Object.assign({}, p.hist[0], { date: p.base }), tests.concat([row]))
        .filter(function (f) { return f.row === NEW || f.prevRow === NEW; });
      render();
    }
    // A touch typed in the other unit than the switch says: cm in IN mode (the
    // shared "looks like centimeters" slip), or an inches-sized number in CM
    // mode (98 cm = 38.58" fails the touch range, but 98 is a fine touch in
    // inches). The switch is the fix, and tapping it keeps that number as typed.
    function wrongUnit(f) {
      if (f.row !== NEW || !LEN[f.key] || f.rule !== "range") return false;
      if (unit === "in") return /centimeters/.test(f.reason);
      var raw = parseFloat((app.querySelector('.g input[name="' + f.key + '"]') || {}).value), rg = D.rules.range[f.key];
      return !!rg && raw >= rg[0] && raw <= rg[1];
    }
    function say(f) {
      if (wrongUnit(f)) return unit === "in" ? f.reason + ". Measured in cm? Tap CM."
        : (D.labels[f.key] || f.key) + " " + parseFloat(app.querySelector('.g input[name="' + f.key + '"]').value) + ' cm is only ' + f2(f.value) + '": looks like inches. Measured in inches? Tap IN.';
      // A back-dated test can make a later one look off: say which.
      return (f.row === NEW ? "" : "Your " + f.from + " test: ") + f.reason;
    }
    function render() {
      var at = {}; shown.forEach(function (f) { (at[f.key] = at[f.key] || []).push(f); });
      M.forEach(function (m) {
        var fl = at[m[0]] || [], box = m[0] === "vertical" ? document.getElementById("vert") : app.querySelector('.g input[name="' + m[0] + '"]');
        document.getElementById("w_" + m[0]).innerHTML = fl.map(function (f) { return '<div class="warn">⚠ ' + esc(say(f)) + "</div>"; }).join("");
        if (box) box.classList.toggle("flag", fl.length > 0);
      });
      var msg = document.getElementById("msg");
      if (!app.querySelector(".save").disabled) {
        msg.textContent = shown.length ? "Check the amber note" + (shown.length > 1 ? "s" : "") + " — you can still save." : msg.className === "warned" ? "" : msg.textContent;
        msg.className = shown.length ? "warned" : "";
      }
    }
    // Typing in a box clears the notes that depend on it until it's judged again.
    function hide(k) {
      var n = shown.length;
      shown = shown.filter(function (f) { return f.key !== k && f.related.indexOf(k) < 0 && !(f.key === "vertical" && (k === "approach_touch" || k === "stand_reach")); });
      if (shown.length !== n) render();
    }
    inputs.forEach(function (i) {
      i.addEventListener("input", function () { recalc(); hide(i.name); clearTimeout(timer); timer = setTimeout(check, 800); });
      i.addEventListener("change", check);   // blur after an edit
    });
    document.getElementById("date").addEventListener("change", check);
    function setUnitUI() {
      app.querySelectorAll(".units button").forEach(function (b) { b.className = b.dataset.u === unit ? "on" : ""; });
      inputs.forEach(function (i) {
        if (!LEN[i.name]) return;
        i.nextElementSibling.textContent = unit;
        var t = points(h, i.name); i.placeholder = t[1] == null ? "" : inUnit(t[1]);
      });
      document.getElementById("unitHint").innerHTML = unit === "cm"
        ? "Jump approach and standing jump in centimeters: each shows in inches as you type and is saved in inches (&divide; 2.54). Stand &amp; reach and broad jump stay in inches. Leave anything you didn't test blank &mdash; stand &amp; reach carries over from last time for the vertical. Saving again on the same date updates it."
        : "Inches, or feet like <b>8'4</b>. Leave anything you didn't test blank &mdash; stand &amp; reach carries over from last time for the vertical. Saving again on the same date updates it.";
    }
    // Switching units keeps what's typed: each length is converted to the new
    // unit — except a number the notes say was typed in the other unit (251 in
    // an IN box), which stays as typed: that's why the coach tapped the switch.
    app.querySelectorAll(".units button").forEach(function (b) {
      b.onclick = function () {
        var to = b.dataset.u; if (to === unit) return;
        check();
        inputs.forEach(function (i) {
          if (!LEN[i.name] || !i.value.trim()) return;
          if (shown.some(function (f) { return f.key === i.name && wrongUnit(f); })) return;
          var v = toIn(i.name, i.value, unit); if (v == null || isNaN(v)) return;
          i.value = to === "cm" ? String(Math.round(v * CM * 10) / 10) : String(Math.round(v * 100) / 100);
        });
        unit = to; try { localStorage.setItem("statsUnit", unit); } catch (e) { /* ignore */ }
        setUnitUI(); recalc(); check();
      };
    });
    setUnitUI();
    recalc();
    check();   // numbers already saved today get their notes straight away
    app.querySelector(".save").onclick = async function () {
      var btn = this, msg = document.getElementById("msg"), row = { player_id: p.id };
      // Lengths go to the server in inches, whatever unit they were typed in.
      var unreadable = false;
      inputs.forEach(function (i) {
        var v = toIn(i.name, i.value); if (v != null && isNaN(v)) unreadable = true;
        row[i.name] = LEN[i.name] && v != null && !isNaN(v) ? String(v) : i.value;
      });
      if (unreadable) { document.getElementById("msg").textContent = "Fix the numbers marked “can't read that” first."; return; }
      by = document.getElementById("by").value; try { localStorage.setItem("statsBy", by); } catch (e) { /* ignore */ }
      btn.disabled = true; msg.textContent = "Saving…"; msg.className = "";
      try {
        var r = await fetch(location.href, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: document.getElementById("date").value, by: by, rows: [row] }) });
        var d = await r.json(); if (!r.ok) throw new Error(d.error || "Couldn't save");
        // Same date again: the server keeps that day's numbers for any box left
        // blank, so the copy here does too (it used to blank them until a reload).
        var old = p.hist.slice(1).find(function (x) { return x.date === d.date; }) || {};
        var rec = { id: old.id, date: d.date, by: by };
        M.forEach(function (m) { if (m[0] !== "vertical") { var v = inch(row[m[0]]); rec[m[0]] = v == null || isNaN(v) ? (old[m[0]] != null ? old[m[0]] : null) : v; } });
        p.hist = [p.hist[0]].concat(p.hist.slice(1).filter(function (x) { return x.date !== d.date; }), [rec]).sort(function (a, b) { return a.date === "" ? -1 : b.date === "" ? 1 : a.date.localeCompare(b.date); });
        list();
      } catch (e) { msg.textContent = e.message; btn.disabled = false; }
    };
    window.scrollTo(0, 0);
  }

  list();
})();
