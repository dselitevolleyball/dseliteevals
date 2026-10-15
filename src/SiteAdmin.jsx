// Website — what dselitevolleyball.com shows, edited from HQ (admins only).
//
// The public site reads one whitelisted payload from /api/site-data (teams,
// rosters, coaches, practices, tournaments) and re-renders every few minutes,
// so a change here is live on the site shortly after Save. Three tabs:
//   Staff profiles     site_staff: title, bio, photo, leadership, order, show/hide
//                      for every public coach (practice_teams minus event teams)
//                      plus the leadership rows. Photos are shrunk in the browser
//                      (800x1000 max, WebP) and go to the public site-media bucket.
//   Roster visibility  players.site_hidden — a family that asks not to be listed.
//                      Only girls who accepted (this season) are ever public.
//   Inquiries          site_inquiries from the website's contact form.

import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "./supabase";
import { personSlug } from "../shared/site-slug.js";
import { isEventTeam } from "../shared/event-teams.js";
import { isPlaceholder } from "../shared/day-schedule.js";
import { PROD_ORIGIN } from "../shared/app-origin.js";

const SITE_ORIGIN = import.meta.env.VITE_SITE_ORIGIN || "https://dselite-website.vercel.app";
const DATA_URL = PROD_ORIGIN + "/api/site-data";
const C = { bg: "#0a0a0a", card: "#141414", border: "#2a2a2a", gold: "#e91e8c", text: "#ffffff", mut: "#999999", dim: "#6f6f6f", red: "#ef4444", grn: "#22c55e", amber: "#f59e0b" };
const BUCKET = "site-media";
const LEVEL_ORDER = { National: 0, Regional: 1, Rise: 2 };
const levelOf = (level, name) => (/rise/i.test(name || "") || /develop/i.test(level || "") ? "Rise" : /national/i.test(level || "") ? "National" : "Regional");
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const key = (s) => clean(s).toLowerCase();
const seasonNow = () => { const d = new Date(); const y = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-${String((y + 1) % 100).padStart(2, "0")}`; };
const btn = (kind) => ({ padding: "8px 14px", borderRadius: 10, border: kind === "ghost" ? "1px solid " + C.border : "none", background: kind === "ghost" ? "transparent" : C.gold, color: kind === "ghost" ? C.text : "#000", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "inherit" });
const input = { width: "100%", boxSizing: "border-box", background: "#0f0f0f", border: "1px solid " + C.border, borderRadius: 8, color: C.text, fontFamily: "inherit", fontSize: 14, padding: "8px 10px" };
const label = { fontSize: 11, fontWeight: 800, color: C.mut, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4, display: "block" };
const chip = (text, color) => <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 8, background: color + "22", color, whiteSpace: "nowrap" }}>{text}</span>;
const initials = (n) => clean(n).split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const ago = (iso) => { if (!iso) return ""; const d = new Date(iso); return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); };

// Shrink a picked photo to 800x1000 max and re-encode (WebP; JPEG if the
// browser can't write WebP). Drawing to a canvas also drops EXIF (GPS etc.).
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 800 / img.naturalWidth, 1000 / img.naturalHeight);
      const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      cv.toBlob((b) => {
        if (b && b.type === "image/webp") return resolve({ blob: b, ext: "webp", type: "image/webp" });
        cv.toBlob((j) => (j ? resolve({ blob: j, ext: "jpg", type: "image/jpeg" }) : reject(new Error("Couldn't encode the image."))), "image/jpeg", 0.85);
      }, "image/webp", 0.8);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that image. Use a JPG or PNG (iPhone HEIC photos: export as JPG first).")); };
    img.src = url;
  });
}

export default function SiteAdmin({ coach }) {
  const [tab, setTab] = useState(() => { try { return localStorage.getItem("dse.website.tab") || "staff"; } catch { return "staff"; } });
  const [teams, setTeams] = useState(null);
  const [staffRows, setStaffRows] = useState([]);
  const [players, setPlayers] = useState([]);
  const [inquiries, setInquiries] = useState([]);
  const [err, setErr] = useState("");
  const me = coach?.display_name || coach?.email || "HQ";
  const season = seasonNow();
  useEffect(() => { try { localStorage.setItem("dse.website.tab", tab); } catch { /* private mode */ } }, [tab]);

  const loadStaff = useCallback(async () => {
    const [t, s] = await Promise.all([
      supabase.from("practice_teams").select("team_name, level, head_coach, assistant_coach, third_coach, practices_per_week"),
      supabase.from("site_staff").select("name, slug, title, bio, photo_url, leadership, sort_order, show_on_site, updated_at, updated_by"),
    ]);
    if (t.error || s.error) setErr((t.error || s.error).message);
    setTeams((t.data || []).filter((x) => clean(x.team_name) && !isEventTeam(x)).map((x) => ({ ...x, team_name: clean(x.team_name), group: levelOf(x.level, x.team_name), age: parseInt(x.team_name, 10) || 99 }))
      .sort((a, b) => a.age - b.age || LEVEL_ORDER[a.group] - LEVEL_ORDER[b.group] || a.team_name.localeCompare(b.team_name, undefined, { numeric: true })));
    setStaffRows(s.data || []);
  }, []);
  const loadPlayers = useCallback(async () => {
    const { data, error } = await supabase.from("players").select("id, first_name, last_name, jersey_number, team_assignment, site_hidden")
      .in("offer_status", ["accepted", "locked"]).eq("season", season).not("team_assignment", "is", null).neq("team_assignment", "");
    if (error) setErr(error.message);
    setPlayers(data || []);
  }, [season]);
  const loadInquiries = useCallback(async () => {
    const { data, error } = await supabase.from("site_inquiries").select("*").eq("is_test", false).order("created_at", { ascending: false }).limit(300);
    if (error) setErr(error.message);
    setInquiries(data || []);
  }, []);
  useEffect(() => { loadStaff(); loadPlayers(); loadInquiries(); }, [loadStaff, loadPlayers, loadInquiries]);

  const openCount = inquiries.filter((q) => !q.handled).length;
  const tabs = [["staff", "Staff profiles"], ["roster", "Roster visibility"], ["inquiries", "Inquiries" + (openCount ? ` (${openCount})` : "")]];

  return (
    <div style={{ padding: "16px 16px 48px", maxWidth: 980, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.gold }}>Website</h2>
          <div style={{ fontSize: 12, color: C.mut }}>What dselitevolleyball.com shows. Teams, rosters, practices and tournaments come from HQ automatically; changes here appear on the site within a few minutes.</div>
        </div>
        <a href={SITE_ORIGIN} target="_blank" rel="noreferrer" style={{ ...btn("ghost"), textDecoration: "none" }}>Open website ↗</a>
        <a href={DATA_URL} target="_blank" rel="noreferrer" style={{ ...btn("ghost"), textDecoration: "none" }}>View public data ↗</a>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {tabs.map(([k, t]) => (
          <button key={k} onClick={() => setTab(k)} style={{ ...btn(tab === k ? "" : "ghost"), padding: "7px 12px" }}>{t}</button>
        ))}
      </div>
      {err && <div style={{ color: C.red, fontWeight: 700, fontSize: 13, marginBottom: 10 }}>{err}</div>}
      {!teams ? <div style={{ color: C.mut, padding: 12 }}>Loading…</div>
        : tab === "staff" ? <StaffTab teams={teams} rows={staffRows} me={me} onSaved={loadStaff} setErr={setErr} />
        : tab === "roster" ? <RosterTab teams={teams} players={players} setPlayers={setPlayers} setErr={setErr} season={season} />
        : <InquiriesTab rows={inquiries} setRows={setInquiries} me={me} setErr={setErr} reload={loadInquiries} />}
    </div>
  );
}

// ── Staff profiles ─────────────────────────────────────────────────────────────
export function StaffTab({ teams, rows, me, onSaved, setErr }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState("");
  const people = useMemo(() => {
    const byKey = new Map();
    for (const t of teams) {
      for (const [raw, role] of [[t.head_coach, "Head"], [t.assistant_coach, "Asst"], [t.third_coach, "Asst"]]) {
        const n = clean(raw);
        if (!n || isPlaceholder(n)) continue;
        if (!byKey.has(key(n))) byKey.set(key(n), { name: n, teams: [] });
        byKey.get(key(n)).teams.push({ team: t.team_name, role });
      }
    }
    for (const r of rows) if (r.leadership && !byKey.has(key(r.name))) byKey.set(key(r.name), { name: clean(r.name), teams: [] });
    const rowBy = new Map(rows.map((r) => [key(r.name), r]));
    const last = (n) => n.split(" ").slice(1).join(" ") || n;
    return [...byKey.values()].map((p) => ({ ...p, row: rowBy.get(key(p.name)) || null }))
      .sort((a, b) => (b.row?.leadership ? 1 : 0) - (a.row?.leadership ? 1 : 0) || (a.row?.sort_order ?? 100) - (b.row?.sort_order ?? 100) || last(a.name).localeCompare(last(b.name)));
  }, [teams, rows]);
  const offTeam = rows.filter((r) => !people.some((p) => key(p.name) === key(r.name)));
  const shown = people.filter((p) => !q || key(p.name).includes(key(q)) || p.teams.some((t) => key(t.team).includes(key(q))));
  const stats = { photo: people.filter((p) => p.row?.photo_url).length, bio: people.filter((p) => p.row?.bio).length, hidden: people.filter((p) => p.row?.show_on_site === false).length };

  const addLeader = async () => {
    const n = clean(adding);
    if (!n) return;
    const { error } = await supabase.from("site_staff").upsert({ name: n, slug: personSlug(n), leadership: true, sort_order: 10, show_on_site: true, updated_at: new Date().toISOString(), updated_by: me }, { onConflict: "name" });
    if (error) { setErr(error.message); return; }
    setAdding(""); setOpen(key(n)); onSaved();
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a coach or team" style={{ ...input, maxWidth: 260 }} />
        <div style={{ fontSize: 12, color: C.mut, flex: 1 }}>{people.length} people · {stats.photo} with a photo · {stats.bio} with a bio{stats.hidden ? ` · ${stats.hidden} hidden` : ""}. A coach with no bio shows name, photo and teams only.</div>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {shown.map((p) => <StaffCard key={key(p.name)} person={p} open={open === key(p.name)} onToggle={() => setOpen(open === key(p.name) ? null : key(p.name))} me={me} onSaved={onSaved} setErr={setErr} />)}
      </div>
      <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 14, marginTop: 14 }}>
        <span style={label}>Add someone to the managing team (no team needed)</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Full name, as on the roster" style={{ ...input, maxWidth: 300 }} />
          <button onClick={addLeader} disabled={!clean(adding)} style={btn()}>Add</button>
        </div>
        {offTeam.length > 0 && <div style={{ fontSize: 12, color: C.mut, marginTop: 10 }}>Saved profiles not on a team and not leadership (not shown on the site): {offTeam.map((r) => r.name).join(", ")}</div>}
      </div>
    </div>
  );
}

export function StaffCard({ person, open, onToggle, me, onSaved, setErr }) {
  const r = person.row;
  const blank = { title: "", bio: "", photo_url: "", leadership: false, sort_order: 100, show_on_site: true };
  const fromRow = () => (r ? { title: r.title || "", bio: r.bio || "", photo_url: r.photo_url || "", leadership: !!r.leadership, sort_order: r.sort_order ?? 100, show_on_site: r.show_on_site !== false } : blank);
  const [d, setD] = useState(fromRow);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => { if (!dirty) setD(fromRow()); }, [r]);   // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch) => { setD((x) => ({ ...x, ...patch })); setDirty(true); setNote(""); };
  const slug = clean(r?.slug) || personSlug(person.name);

  const save = async (draft = d) => {
    setBusy("Saving…"); setErr("");
    const row = {
      name: person.name, slug, title: clean(draft.title) || null,
      bio: String(draft.bio || "").replace(/\r\n?/g, "\n").split(/\n\s*\n/).map(clean).filter(Boolean).join("\n\n") || null,
      photo_url: clean(draft.photo_url) || null, leadership: !!draft.leadership,
      sort_order: Number.isFinite(Number(draft.sort_order)) ? Math.round(Number(draft.sort_order)) : 100,
      show_on_site: !!draft.show_on_site, updated_at: new Date().toISOString(), updated_by: me,
    };
    if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(row.bio || "") || /\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/.test(row.bio || "")) {
      setBusy(""); setNote("Take the phone number / email out of the bio — the site never shows coaches' contact details."); return;
    }
    const { error } = await supabase.from("site_staff").upsert(row, { onConflict: "name" });
    setBusy("");
    if (error) { setErr(error.message); return; }
    setDirty(false); setNote("Saved ✓"); onSaved();
  };

  const upload = async (file) => {
    if (!file) return;
    setBusy("Uploading photo…"); setErr("");
    try {
      const { blob, ext, type } = await shrinkImage(file);
      const path = `staff/${slug}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: type, cacheControl: "31536000", upsert: false });
      if (error) throw new Error(error.message);
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const next = { ...d, photo_url: data.publicUrl };
      setD(next);
      await save(next);
    } catch (e) { setBusy(""); setErr(e.message); }
  };

  const photo = d.photo_url;
  return (
    <div style={{ background: C.card, border: "1px solid " + (open ? C.gold : C.border), borderRadius: 12 }}>
      <div onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", cursor: "pointer" }}>
        <div style={{ width: 44, height: 55, borderRadius: 8, overflow: "hidden", background: "#222", flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "center", color: C.mut, fontWeight: 800, fontSize: 14 }}>
          {photo ? <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initials(person.name)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {person.name}
            {r?.leadership && chip("Leadership", C.gold)}
            {r?.show_on_site === false && chip("Hidden", C.red)}
            {!r?.bio && chip("No bio", C.dim)}
            {!r?.photo_url && chip("No photo", C.dim)}
          </div>
          <div style={{ fontSize: 12, color: C.mut, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {[r?.title, ...person.teams.map((t) => `${t.team} (${t.role})`)].filter(Boolean).join(" · ") || "No team"}
          </div>
        </div>
        <div style={{ color: C.mut, fontSize: 12 }}>{open ? "▲" : "▼"}</div>
      </div>
      {open && (
        <div style={{ padding: "4px 14px 14px", borderTop: "1px solid " + C.border }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(140px, 180px) 1fr", gap: 14, marginTop: 12 }}>
            <div>
              <div style={{ width: "100%", aspectRatio: "4 / 5", borderRadius: 10, overflow: "hidden", background: "#222", display: "flex", alignItems: "center", justifyContent: "center", color: C.mut, fontSize: 28, fontWeight: 800 }}>
                {photo ? <img src={photo} alt={person.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initials(person.name)}
              </div>
              <label style={{ ...btn("ghost"), display: "block", textAlign: "center", marginTop: 8, padding: "7px 8px" }}>
                {photo ? "Replace photo" : "Upload photo"}
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
              {photo && <button onClick={() => set({ photo_url: "" })} style={{ background: "none", border: "none", color: C.mut, textDecoration: "underline", cursor: "pointer", fontSize: 11, fontFamily: "inherit", marginTop: 6, padding: 0 }}>Remove photo</button>}
              <div style={{ fontSize: 10, color: C.dim, marginTop: 6 }}>Shown in a 4:5 frame. Resized to 800×1000 before upload.</div>
            </div>
            <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
              <div>
                <span style={label}>Title (optional)</span>
                <input value={d.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Assistant Director — leave blank for coaches" style={input} />
              </div>
              <div>
                <span style={label}>Bio</span>
                <textarea value={d.bio} onChange={(e) => set({ bio: e.target.value })} rows={8} placeholder="Their own words only (no invented bios). Blank line between paragraphs. No phone numbers or emails." style={{ ...input, resize: "vertical", lineHeight: 1.45 }} />
              </div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
                <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}><input type="checkbox" checked={d.show_on_site} onChange={(e) => set({ show_on_site: e.target.checked })} style={{ accentColor: C.gold, width: 16, height: 16 }} /> Show on website</label>
                <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}><input type="checkbox" checked={d.leadership} onChange={(e) => set({ leadership: e.target.checked })} style={{ accentColor: C.gold, width: 16, height: 16 }} /> Leadership (managing team)</label>
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>Sort order <input type="number" value={d.sort_order} onChange={(e) => set({ sort_order: e.target.value })} style={{ ...input, width: 80, padding: "6px 8px" }} /></label>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={() => save()} disabled={!!busy || !dirty} style={{ ...btn(), opacity: busy || !dirty ? 0.5 : 1 }}>{busy || "Save"}</button>
                {dirty && !busy && <button onClick={() => { setD(fromRow()); setDirty(false); setNote(""); }} style={btn("ghost")}>Discard</button>}
                {note && <span style={{ fontSize: 12, fontWeight: 700, color: /✓/.test(note) ? C.grn : C.amber }}>{note}</span>}
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: C.dim }}>/coaches/{slug}{r?.updated_at ? ` · edited ${ago(r.updated_at)}${r.updated_by ? " by " + r.updated_by : ""}` : " · no profile saved yet"}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Roster visibility ──────────────────────────────────────────────────────────
export function RosterTab({ teams, players, setPlayers, setErr, season }) {
  const [team, setTeam] = useState(teams[0]?.team_name || "");
  const byTeam = useMemo(() => {
    const m = new Map(teams.map((t) => [t.team_name, []]));
    for (const p of players) { const t = clean(p.team_assignment); if (m.has(t)) m.get(t).push(p); }
    for (const list of m.values()) list.sort((a, b) => (a.jersey_number ?? 1e9) - (b.jersey_number ?? 1e9) || String(a.first_name).localeCompare(String(b.first_name)));
    return m;
  }, [teams, players]);
  const hiddenAll = players.filter((p) => p.site_hidden && byTeam.has(clean(p.team_assignment)));
  const list = byTeam.get(team) || [];
  const toggle = async (p) => {
    const next = !p.site_hidden;
    setPlayers((xs) => xs.map((x) => (x.id === p.id ? { ...x, site_hidden: next } : x)));
    const { error } = await supabase.from("players").update({ site_hidden: next }).eq("id", p.id);
    if (error) { setErr(error.message); setPlayers((xs) => xs.map((x) => (x.id === p.id ? { ...x, site_hidden: !next } : x))); }
  };
  return (
    <div>
      <div style={{ fontSize: 12, color: C.mut, marginBottom: 10, lineHeight: 1.5 }}>
        The website lists each team's players who accepted their spot this season ({season}): first and last name, jersey number, position and grad year. Untick a player when her family asks not to be listed.
        {hiddenAll.length ? <> <b style={{ color: C.text }}>Hidden now:</b> {hiddenAll.map((p) => `${clean(p.first_name)} ${clean(p.last_name)} (${clean(p.team_assignment)})`).join(", ")}.</> : " Nobody is hidden right now."}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {teams.map((t) => {
          const n = (byTeam.get(t.team_name) || []).length, h = (byTeam.get(t.team_name) || []).filter((p) => p.site_hidden).length;
          return <button key={t.team_name} onClick={() => setTeam(t.team_name)} style={{ ...btn(team === t.team_name ? "" : "ghost"), padding: "6px 10px", fontSize: 12 }}>{t.team_name} <span style={{ opacity: 0.7, fontWeight: 600 }}>{n}{h ? ` · ${h} hidden` : ""}</span></button>;
        })}
      </div>
      <div style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 12 }}>
        {!list.length && <div style={{ color: C.mut, fontSize: 13 }}>No accepted players on {team} yet.</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 6 }}>
          {list.map((p) => {
            const on = !p.site_hidden;
            return (
              <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, background: on ? C.bg : "rgba(239,68,68,0.10)", border: "1px solid " + (on ? C.border : C.red), cursor: "pointer", fontSize: 14 }}>
                <input type="checkbox" checked={on} onChange={() => toggle(p)} style={{ width: 18, height: 18, accentColor: C.gold }} />
                <span style={{ width: 26, textAlign: "right", color: C.gold, fontWeight: 800 }}>{p.jersey_number ?? "–"}</span>
                <span style={{ fontWeight: 700, color: on ? C.text : C.red, textDecoration: on ? "none" : "line-through" }}>{clean(p.first_name)} {clean(p.last_name)}</span>
                <span style={{ marginLeft: "auto", fontSize: 10, color: on ? C.mut : C.red, fontWeight: 800, textTransform: "uppercase" }}>{on ? "Shown" : "Hidden"}</span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Inquiries ──────────────────────────────────────────────────────────────────
const TOPIC = { tryouts: "Tryouts", general: "General", coaching: "Coaching", other: "Other" };
export function InquiriesTab({ rows, setRows, me, setErr, reload }) {
  const [show, setShow] = useState("open");
  const list = rows.filter((q) => (show === "all" ? true : !q.handled));
  const toggle = async (q) => {
    const patch = { handled: !q.handled, handled_at: !q.handled ? new Date().toISOString() : null, handled_by: !q.handled ? me : null };
    setRows((xs) => xs.map((x) => (x.id === q.id ? { ...x, ...patch } : x)));
    const { error } = await supabase.from("site_inquiries").update(patch).eq("id", q.id);
    if (error) { setErr(error.message); reload(); }
  };
  return (
    <div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        {[["open", "Open"], ["all", "All"]].map(([k, t]) => <button key={k} onClick={() => setShow(k)} style={{ ...btn(show === k ? "" : "ghost"), padding: "6px 10px", fontSize: 12 }}>{t}</button>)}
        <span style={{ fontSize: 12, color: C.mut, marginLeft: 6 }}>Messages from the website's contact form, newest first. Each one is also emailed to Drew (reply goes straight to the sender).</span>
      </div>
      {!list.length && <div style={{ color: C.mut, fontSize: 13, padding: "8px 2px" }}>{rows.length ? "Nothing here." : "No messages yet."}</div>}
      <div style={{ display: "grid", gap: 8 }}>
        {list.map((q) => (
          <div key={q.id} style={{ background: C.card, border: "1px solid " + C.border, borderRadius: 12, padding: 12, opacity: q.handled ? 0.6 : 1 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
              <b style={{ fontSize: 15 }}>{q.name}</b>
              {chip(TOPIC[q.topic] || q.topic, C.gold)}
              {!q.emailed_at && chip("Not emailed", C.red)}
              <span style={{ fontSize: 12, color: C.mut }}>{ago(q.created_at)}</span>
              <span style={{ flex: 1 }} />
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={!!q.handled} onChange={() => toggle(q)} style={{ accentColor: C.grn, width: 16, height: 16 }} /> Handled{q.handled && q.handled_by ? ` (${q.handled_by})` : ""}
              </label>
            </div>
            <div style={{ fontSize: 12, color: C.mut, display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
              <a href={`mailto:${q.email}`} style={{ color: C.gold }}>{q.email}</a>
              {q.phone && <a href={`tel:${q.phone}`} style={{ color: C.mut }}>{q.phone}</a>}
              {q.player_name && <span>Player: {q.player_name}</span>}
              {q.age_group && <span>Age group: {q.age_group}</span>}
            </div>
            <div style={{ fontSize: 14, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{q.message}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
