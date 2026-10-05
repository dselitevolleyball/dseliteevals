// Coach testing sheet (served with /stats?t=…, see api/stats-form.js).
// Roster view: each player's latest numbers with ▲▼ change from the test
// before. Tap a player: full history + a form for a new test that compares
// every number to last time (and to the first result) as it's typed.
(function () {
  var D = JSON.parse(document.getElementById("data").textContent);
  // [key, label, unit, higher is better]
  var M = [["stand_reach", "Stand & reach", '"', 1], ["approach_touch", "Jump approach", '"', 1], ["standing_touch", "Standing jump", '"', 1], ["vertical", "Vertical", '"', 1], ["broad_jump", "Broad jump", '"', 1], ["dash_10y", "10 yd dash", "s", 0]];
  var app = document.getElementById("app");
  var by = ""; try { by = localStorage.getItem("statsBy") || ""; } catch (e) { /* private mode */ }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function f1(n) { return n == null ? "—" : String(Math.round(n * 10) / 10); }
  function inch(v) {
    v = String(v || "").trim(); if (!v) return null;
    var m = /^(\d+)\s*(?:'|ft|feet|-)\s*(\d+(?:\.\d+)?)?\s*(?:"|in)?$/i.exec(v); if (m) return +m[1] * 12 + (m[2] ? +m[2] : 0);
    m = /^(\d+(?:\.\d+)?)\s*(?:"|in|s|sec)?$/i.exec(v); return m ? +m[1] : NaN;
  }
  function fmtDate(d) { if (!d) return "Tryout"; return new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" }); }
  // Vertical for every row, carrying the last stand & reach forward when it wasn't re-measured.
  function withVert(hist) {
    var reach = null;
    return hist.map(function (h) { var o = Object.assign({}, h); if (o.stand_reach != null) reach = o.stand_reach; o.vertical = (o.approach_touch != null && reach != null) ? o.approach_touch - reach : null; return o; });
  }
  // [value before latest, latest, first]
  function points(hist, k) { var v = hist.filter(function (h) { return h[k] != null; }); return [v.length > 1 ? v[v.length - 2][k] : null, v.length ? v[v.length - 1][k] : null, v.length ? v[0][k] : null]; }
  function delta(prev, cur, up, unit) {
    if (prev == null || cur == null) return "";
    var d = cur - prev; if (Math.abs(d) < 0.05) return '<span class="d same">no change</span>';
    var good = up ? d > 0 : d < 0;
    return '<span class="d ' + (good ? "up" : "down") + '">' + (d > 0 ? "▲ +" : "▼ ") + f1(d) + unit + "</span>";
  }

  function list() {
    var rows = D.players.map(function (p) {
      var h = withVert(p.hist), last = h[h.length - 1];
      var cells = M.map(function (m) { var t = points(h, m[0]); return "<td><b>" + (t[1] == null ? "—" : f1(t[1]) + m[2]) + "</b>" + delta(t[0], t[1], m[3], m[2]) + "</td>"; }).join("");
      return '<tr data-id="' + p.id + '"><td class="nm">' + (p.num ? '<span class="no">#' + esc(p.num) + "</span> " : "") + esc(p.name) +
        '<div class="when">' + (h.length > 1 ? "tested " + fmtDate(last.date) : "tryout numbers only") + "</div></td>" + cells + '<td><button class="add">+ Add</button></td></tr>';
    }).join("");
    app.innerHTML = "<h1>" + esc(D.team) + " — testing</h1>" +
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
      return '<tr><td class="dt">' + fmtDate(r.date) + (r.by ? '<div class="when">' + esc(r.by) + "</div>" : "") + "</td>" + M.map(function (m) {
        var prev = null; for (var j = i - 1; j >= 0; j--) if (h[j][m[0]] != null) { prev = h[j][m[0]]; break; }
        return "<td>" + (r[m[0]] == null ? "—" : f1(r[m[0]]) + m[2]) + delta(prev, r[m[0]], m[3], m[2]) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    function field(m) {
      if (m[0] === "vertical") return '<label><span>Vertical (auto)</span><div class="auto" id="vert">—</div><div class="cmp" id="c_vertical"></div></label>';
      var t = points(h, m[0]);
      return '<label><span>' + m[1] + '</span><input inputmode="decimal" name="' + m[0] + '" autocomplete="off" placeholder="' + (t[1] == null ? "" : f1(t[1])) + '"><em>' + (m[2] === "s" ? "sec" : "in") + '</em><div class="cmp" id="c_' + m[0] + '"></div></label>';
    }
    app.innerHTML = '<button class="back">‹ All players</button><h1>' + (p.num ? '<span class="no">#' + esc(p.num) + "</span> " : "") + esc(p.name) + "</h1>" +
      '<div class="tw"><table class="list hist"><thead><tr><th>Date</th>' + M.map(function (m) { return "<th>" + m[1] + "</th>"; }).join("") + "</tr></thead><tbody>" + histRows + "</tbody></table></div>" +
      '<h2>New test</h2><div class="top"><label>Date <input type="date" id="date" value="' + D.today + '"></label><label>Tested by <input id="by" value="' + esc(by) + '" placeholder="Your name"></label></div>' +
      '<p class="hint">Inches, or feet like <b>8\'4</b>. Leave anything you didn\'t test blank — stand &amp; reach carries over from last time for the vertical. Saving again on the same date updates it.</p>' +
      '<div class="g">' + M.map(field).join("") + "</div>" +
      '<div class="bar"><span id="msg"></span><button class="save">Save</button></div>';
    app.querySelector(".back").onclick = list;
    var inputs = app.querySelectorAll(".g input");
    function recalc() {
      var vals = {}; inputs.forEach(function (i) { vals[i.name] = inch(i.value); });
      var reach = vals.stand_reach != null && !isNaN(vals.stand_reach) ? vals.stand_reach : points(h, "stand_reach")[1];
      vals.vertical = (vals.approach_touch != null && !isNaN(vals.approach_touch) && reach != null) ? vals.approach_touch - reach : null;
      document.getElementById("vert").textContent = vals.vertical == null ? "—" : f1(vals.vertical) + '"';
      M.forEach(function (m) {
        var el = document.getElementById("c_" + m[0]), t = points(h, m[0]), v = vals[m[0]];
        if (v != null && isNaN(v)) { el.innerHTML = '<span class="d down">can\'t read that</span>'; return; }
        if (v == null) { el.innerHTML = t[1] == null ? "no earlier result" : "last: " + f1(t[1]) + m[2]; return; }
        el.innerHTML = t[1] == null ? "first result" : "vs last " + delta(t[1], v, m[3], m[2]) + (t[2] != null && t[0] != null ? ' <span class="since">· vs first ' + delta(t[2], v, m[3], m[2]) + "</span>" : "");
      });
    }
    inputs.forEach(function (i) { i.addEventListener("input", recalc); });
    recalc();
    app.querySelector(".save").onclick = async function () {
      var btn = this, msg = document.getElementById("msg"), row = { player_id: p.id };
      inputs.forEach(function (i) { row[i.name] = i.value; });
      by = document.getElementById("by").value; try { localStorage.setItem("statsBy", by); } catch (e) { /* ignore */ }
      btn.disabled = true; msg.textContent = "Saving…";
      try {
        var r = await fetch(location.href, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: document.getElementById("date").value, by: by, rows: [row] }) });
        var d = await r.json(); if (!r.ok) throw new Error(d.error || "Couldn't save");
        var rec = { date: d.date, by: by };
        M.forEach(function (m) { if (m[0] !== "vertical") { var v = inch(row[m[0]]); rec[m[0]] = v == null || isNaN(v) ? null : v; } });
        // Same date again replaces that day's entry.
        p.hist = [p.hist[0]].concat(p.hist.slice(1).filter(function (x) { return x.date !== d.date; }), [rec]).sort(function (a, b) { return a.date === "" ? -1 : b.date === "" ? 1 : a.date.localeCompare(b.date); });
        list();
      } catch (e) { msg.textContent = e.message; btn.disabled = false; }
    };
    window.scrollTo(0, 0);
  }

  list();
})();
