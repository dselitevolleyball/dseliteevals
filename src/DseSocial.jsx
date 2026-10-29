// HQ -> Social (DS Elite): posts for DS Elite's Facebook Page and Instagram,
// made from family photo uploads and coach intro surveys, approved here or in
// Slack before anything goes out. The engine is api/_lib/dse-social.js; this
// screen talks to /api/dse-social. See DSE_SOCIAL_SETUP.md.
//
//   Drafts     approve, skip, edit the caption, reorder / drop photos, switch
//              collage <-> carousel, pick Facebook / Instagram
//   Scheduled  approved, waiting for their time (coach intros: one an evening)
//   Posted     what went out, with links
//   Photos     the family uploads: batches, "preview with Claude", make a post
//              from hand-picked photos, hide a photo, keep a family off social
//   Coaches    send the "Meet the Coach" survey, follow answers, make posters
//   Settings   the Facebook connection, auto-drafting, approvers, hashtags,
//              the survey questions
import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";

const T = { bg: "#0a0a0a", card: "#141414", card2: "#1b1b1b", line: "#2a2a2a", pink: "#e91e8c", hot: "#ff69b4", text: "#fff", mut: "#999", ok: "#22c55e", bad: "#ff8a7a", warn: "#f59e0b" };
const realApi = async (action, body = {}) => {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch("/api/dse-social", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (session?.access_token || "") }, body: JSON.stringify({ action, ...body }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || r.statusText);
  return d;
};
const fmtWhen = (iso) => iso ? new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const fmtDay = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
const teamLabel = (t) => String(t || "").replace(/^(\d+ Rise) 1$/, "$1");
const FORMAT = { collage: "Collage", carousel: "Carousel", single: "Single photo", poster: "Poster" };
const STATUS = { draft: [T.hot, "Draft"], approved: [T.ok, "Scheduled"], publishing: [T.warn, "Posting…"], published: [T.ok, "Posted"], failed: [T.bad, "Failed"], skipped: [T.mut, "Skipped"] };

export default function DseSocial({ api = realApi }) {
  const [tab, setTab] = useState("drafts");
  const [status, setStatus] = useState(null);
  const [posts, setPosts] = useState(null);
  const [err, setErr] = useState("");
  const focusId = useMemo(() => { try { return Number(new URLSearchParams(window.location.search).get("post")) || null; } catch { return null; } }, []);
  const loadStatus = () => api("status").then(setStatus).catch(e => setErr(e.message));
  const loadPosts = () => api("posts").then(d => setPosts(d.posts)).catch(e => setErr(e.message));
  useEffect(() => { loadStatus(); loadPosts(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => { loadStatus(); loadPosts(); };
  const by = (sts) => (posts || []).filter(p => sts.includes(p.status));
  const drafts = by(["draft", "failed"]), sched = by(["approved", "publishing"]), done = by(["published", "skipped"]);
  const meta = status?.meta;
  const tabs = [["drafts", "Drafts", drafts.length], ["scheduled", "Scheduled", sched.length], ["posted", "Posted", 0], ["photos", "Photos", 0], ["coaches", "Coach intros", 0], ["settings", "Settings", 0]];

  return (
    <div style={{ margin: "-14px -18px", padding: "16px 16px 40px", background: T.bg, minHeight: "calc(100vh - 56px)", color: T.text, fontFamily: "inherit" }}>
      <style>{"@media (max-width: 700px) { .dse-social-card { grid-template-columns: 1fr !important; } }"}</style>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-0.01em" }}>📣 Social</div>
          <span style={{ fontSize: 12, color: T.mut }}>DS Elite's Facebook & Instagram · nothing posts until it's approved</span>
          <div style={{ flex: 1 }} />
          {meta && (meta.connected
            ? <Pill color={T.ok}>● {meta.page?.name || "Facebook"}{meta.instagram ? " + IG" : ""}</Pill>
            : <button onClick={() => setTab("settings")} style={pillBtn(T.warn)}>⚠ Facebook not connected</button>)}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {tabs.map(([k, l, n]) => <button key={k} onClick={() => setTab(k)} style={{ ...chip(tab === k), display: "inline-flex", gap: 6, alignItems: "center" }}>{l}{n > 0 && <span style={badge(tab === k)}>{n}</span>}</button>)}
        </div>
        {err && <div style={{ color: T.bad, marginBottom: 10, fontSize: 13 }}>{err} <button onClick={() => setErr("")} style={link}>dismiss</button></div>}
        {tab === "drafts" && <PostList api={api} posts={drafts} loading={!posts} focusId={focusId} onChange={refresh} empty={<>No drafts right now. New family photos become drafts on their own (every half hour, once a batch has gone quiet for 2 hours) - or make one from <button style={link} onClick={() => setTab("photos")}>Photos</button>.</>} />}
        {tab === "scheduled" && <PostList api={api} posts={sched} loading={!posts} onChange={refresh} empty="Nothing waiting. Approved photo posts go out right away; coach intros take the next free evening." />}
        {tab === "posted" && <PostList api={api} posts={done} loading={!posts} onChange={refresh} compact empty="Nothing posted yet." />}
        {tab === "photos" && <Photos api={api} onMade={() => { loadPosts(); setTab("drafts"); }} />}
        {tab === "coaches" && <Coaches api={api} onDrafted={() => { loadPosts(); setTab("drafts"); }} />}
        {tab === "settings" && <Settings api={api} status={status} onChange={loadStatus} />}
      </div>
    </div>
  );
}

// ── posts ───────────────────────────────────────────────────────────────────
function PostList({ api, posts, loading, empty, onChange, focusId, compact }) {
  if (loading) return <Muted>Loading…</Muted>;
  if (!posts.length) return <Box><Muted>{empty}</Muted></Box>;
  return <div style={{ display: "grid", gap: 14 }}>{posts.map(p => <PostCard key={p.id + ":" + p.updated_at} api={api} post={p} onChange={onChange} focus={p.id === focusId} compact={compact} />)}</div>;
}

function PostCard({ api, post, onChange, focus, compact }) {
  const [caption, setCaption] = useState(post.caption || "");
  const [tags, setTags] = useState((post.hashtags || []).map(h => "#" + h).join(" "));
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState(post.status === "failed" ? post.error : "");
  const [design, setDesign] = useState(post.design || {});
  const editable = ["draft", "failed", "approved"].includes(post.status);
  const dirty = caption !== (post.caption || "") || tags !== (post.hashtags || []).map(h => "#" + h).join(" ");
  const go = async (label, action, body = {}) => { setBusy(label); setErr(""); try { const r = await api(action, { id: post.id, ...body }); if (r.errors?.length) setErr(r.errors.join(" · ")); onChange(); } catch (e) { setErr(e.message); } setBusy(""); };
  const save = () => go("save", "update_post", { caption, hashtags: tags.split(/[\s,]+/).filter(Boolean) });
  const photos = post.photos || [];
  const move = (i, d) => { const a = [...photos]; const [x] = a.splice(i, 1); a.splice(i + d, 0, x); go("photos", "update_post", { photos: a.map(p => p.photo_id) }); };
  const drop = (i) => go("photos", "update_post", { photos: photos.filter((_, k) => k !== i).map(p => p.photo_id) });
  const [st, stLabel] = STATUS[post.status] || [T.mut, post.status];
  const links = post.external_ids?.links || {};
  const images = post.format === "carousel" ? photos.map(p => p.url).filter(Boolean) : [post.asset_url].filter(Boolean);

  return (
    <div style={{ background: T.card, border: "1px solid " + (focus ? T.pink : T.line), borderRadius: 14, padding: 14, display: "grid", gridTemplateColumns: compact ? "120px 1fr" : "minmax(0, 340px) 1fr", gap: 16 }} className="dse-social-card">
      <div>
        <div style={{ display: "flex", gap: 6, overflowX: "auto", scrollSnapType: "x mandatory" }}>
          {images.map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer" style={{ flex: "0 0 " + (images.length > 1 ? "85%" : "100%"), scrollSnapAlign: "start" }}><img src={u} alt="" style={{ width: "100%", aspectRatio: "4/5", objectFit: "cover", borderRadius: 10, display: "block", background: T.card2 }} /></a>)}
          {!images.length && <div style={{ width: "100%", aspectRatio: "4/5", background: T.card2, borderRadius: 10 }} />}
        </div>
        {!compact && post.kind === "photos" && editable && photos.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, color: T.mut, marginBottom: 4 }}>{photos.length} photo{photos.length === 1 ? "" : "s"} - order & remove</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {photos.map((p, i) => (
                <div key={p.photo_id || i} title={p.note || ""} style={{ position: "relative", width: 54 }}>
                  <img src={p.url || post.asset_url} alt="" style={{ width: 54, height: 54, objectFit: "cover", borderRadius: 6, display: "block", opacity: busy === "photos" ? 0.5 : 1 }} />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                    <button disabled={!!busy || i === 0} onClick={() => move(i, -1)} style={tiny}>‹</button>
                    <button disabled={!!busy || photos.length < 2} onClick={() => drop(i)} style={{ ...tiny, color: T.bad }}>✕</button>
                    <button disabled={!!busy || i === photos.length - 1} onClick={() => move(i, 1)} style={tiny}>›</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
          <Pill color={st}>{stLabel}</Pill>
          <span style={{ fontWeight: 800 }}>{post.title}</span>
          <span style={{ fontSize: 12, color: T.mut }}>{FORMAT[post.format]} · {fmtDay(post.created_at)}</span>
        </div>
        {post.status === "approved" && post.scheduled_at && <div style={{ fontSize: 13, color: T.ok, marginBottom: 6 }}>Goes out {fmtWhen(post.scheduled_at)}{post.approved_by ? ` · approved by ${post.approved_by}` : ""}</div>}
        {["draft", "failed", "approved"].includes(post.status) && !compact && <PlannedTime post={post} busy={busy} onSave={(iso) => go("time", "update_post", { scheduled_at: iso })} />}
        {post.status === "published" && <div style={{ fontSize: 13, marginBottom: 6 }}>Posted {fmtWhen(post.published_at)} {links.facebook && <a href={links.facebook} target="_blank" rel="noreferrer" style={{ color: T.hot }}>Facebook ↗</a>} {links.instagram && <a href={links.instagram} target="_blank" rel="noreferrer" style={{ color: T.hot }}>Instagram ↗</a>}{post.error && <span style={{ color: T.mut }}> · {post.error}</span>}</div>}
        {compact ? <div style={{ fontSize: 13, color: T.mut, whiteSpace: "pre-wrap" }}>{post.caption}</div> : (<>
          <textarea value={caption} disabled={!editable} onChange={e => setCaption(e.target.value)} rows={5} style={{ ...input, width: "100%", resize: "vertical", lineHeight: 1.45 }} />
          <input value={tags} disabled={!editable} onChange={e => setTags(e.target.value)} placeholder="#hashtags" style={{ ...input, width: "100%", marginTop: 6, color: T.hot }} />
          {post.kind === "coach_intro" && editable && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", fontSize: 13, color: T.mut }}>Edit the poster's words</summary>
              <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
                <input value={design.headline || ""} onChange={e => setDesign(d => ({ ...d, headline: e.target.value }))} placeholder="Headline" style={input} />
                <textarea value={design.quote || ""} onChange={e => setDesign(d => ({ ...d, quote: e.target.value }))} rows={3} placeholder="Quote (their words)" style={input} />
                {[0, 1, 2].map(i => <div key={i} style={{ display: "flex", gap: 6 }}>
                  <input value={design.facts?.[i]?.label || ""} onChange={e => setDesign(d => { const f = [...(d.facts || [])]; f[i] = { ...(f[i] || {}), label: e.target.value }; return { ...d, facts: f }; })} placeholder="Label" style={{ ...input, width: 130 }} />
                  <input value={design.facts?.[i]?.value || ""} onChange={e => setDesign(d => { const f = [...(d.facts || [])]; f[i] = { ...(f[i] || {}), value: e.target.value }; return { ...d, facts: f }; })} placeholder="Value" style={{ ...input, flex: 1 }} />
                </div>)}
                <Btn small disabled={!!busy} onClick={() => go("design", "update_post", { design: { ...design, facts: (design.facts || []).filter(f => f?.label && f?.value) } })}>{busy === "design" ? "Redrawing…" : "Redraw the poster"}</Btn>
              </div>
            </details>
          )}
          {editable && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8, fontSize: 13 }}>
              {["facebook", "instagram"].map(p => <label key={p} style={{ display: "inline-flex", gap: 5, alignItems: "center", cursor: "pointer" }}><input type="checkbox" checked={(post.platforms || []).includes(p)} disabled={!!busy} onChange={e => go("platforms", "update_post", { platforms: e.target.checked ? [...(post.platforms || []), p] : (post.platforms || []).filter(x => x !== p) })} />{p === "facebook" ? "Facebook" : "Instagram"}</label>)}
              {post.kind === "photos" && <select value={post.format} disabled={!!busy} onChange={e => go("format", "update_post", { format: e.target.value })} style={{ ...input, width: "auto", padding: "4px 8px" }}>
                {["collage", "carousel", "single"].map(f => <option key={f} value={f}>{FORMAT[f]}</option>)}
              </select>}
              {busy && busy !== "save" && <span style={{ color: T.mut }}>Updating…</span>}
            </div>
          )}
          {post.kind === "photos" && post.ai?.verdicts?.some(v => !v.usable) && (
            <details style={{ marginTop: 8, fontSize: 12, color: T.mut }}>
              <summary style={{ cursor: "pointer" }}>Claude left out {post.ai.verdicts.filter(v => !v.usable).length} photo{post.ai.verdicts.filter(v => !v.usable).length === 1 ? "" : "s"}</summary>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{post.ai.verdicts.filter(v => !v.usable).map((v, i) => <li key={i}>{v.reason}</li>)}</ul>
            </details>
          )}
          {err && <div style={{ color: T.bad, fontSize: 13, marginTop: 8 }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {dirty && <Btn primary disabled={!!busy} onClick={save}>{busy === "save" ? "Saving…" : "Save changes"}</Btn>}
            {["draft", "failed"].includes(post.status) && !dirty && <Btn primary disabled={!!busy} onClick={() => go("approve", post.status === "failed" ? "publish_now" : "approve")}>{busy === "approve" ? "Working…" : post.status === "failed" ? "↻ Try posting again" : future(post.scheduled_at) ? `✓ Approve for ${fmtWhen(post.scheduled_at)}` : "✓ Approve & post"}</Btn>}
            {post.status === "draft" && !dirty && future(post.scheduled_at) && <Btn disabled={!!busy} onClick={() => go("approve", "approve", { now: true })}>Approve & post now</Btn>}
            {post.status === "approved" && <Btn primary disabled={!!busy} onClick={() => go("now", "publish_now")}>{busy === "now" ? "Posting…" : "Post now"}</Btn>}
            {post.status === "approved" && <Btn disabled={!!busy} onClick={() => go("back", "unapprove")}>Back to draft</Btn>}
            {["draft", "failed", "approved"].includes(post.status) && <Btn disabled={!!busy} onClick={() => go("skip", "skip")}>Skip</Btn>}
            {post.status === "skipped" && <Btn disabled={!!busy} onClick={() => go("back", "unapprove")}>Bring back as a draft</Btn>}
          </div>
        </>)}
      </div>
    </div>
  );
}

const future = (iso) => !!iso && Date.parse(iso) > Date.now() + 5 * 60e3;
// The planned time, and a way to move it (a local date + time picker).
function PlannedTime({ post, busy, onSave }) {
  const toLocal = (iso) => { if (!iso) return ""; const d = new Date(iso); const z = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; };
  const [v, setV] = useState(toLocal(post.scheduled_at));
  const changed = v !== toLocal(post.scheduled_at);
  if (post.status === "approved") return null;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13, color: T.mut, marginBottom: 8 }}>
      📅 {future(post.scheduled_at) ? <>Planned for <b style={{ color: T.text }}>{fmtWhen(post.scheduled_at)}</b></> : post.scheduled_at ? <>Its planned time has passed - approving posts it now</> : "No planned time - approving posts it now"}
      <input type="datetime-local" value={v} onChange={e => setV(e.target.value)} style={{ ...input, width: "auto", padding: "3px 6px", fontSize: 12, colorScheme: "dark" }} />
      {changed && <Btn small disabled={!!busy} onClick={() => onSave(v ? new Date(v).toISOString() : null)}>{busy === "time" ? "…" : "Move it"}</Btn>}
    </div>
  );
}

// ── photos ──────────────────────────────────────────────────────────────────
function Photos({ api, onMade }) {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(30);
  const [team, setTeam] = useState("");
  const [sel, setSel] = useState([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState(null);
  const load = () => api("photos", { days }).then(setData).catch(e => setErr(e.message));
  useEffect(() => { setData(null); load(); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps
  const teams = useMemo(() => [...new Set((data?.photos || []).map(p => p.team_name).filter(Boolean))].sort(), [data]);
  const shown = (data?.photos || []).filter(p => !team || p.team_name === team);
  const toggle = (id) => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id].slice(0, 20));
  const run = async (label, fn) => { setBusy(label); setErr(""); try { await fn(); } catch (e) { setErr(e.message); } setBusy(""); };
  const make = (ids) => run("make", async () => { await api("make_post", { photo_ids: ids }); setSel([]); onMade(); });
  const look = (ids) => run("preview", async () => setPreview(await api("preview_post", { photo_ids: ids })));
  const byId = new Map((data?.photos || []).map(p => [p.id, p]));

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Box>
        <div style={{ fontSize: 13, color: T.mut, lineHeight: 1.5 }}>Families upload at <b style={{ color: T.text }}>dseliteevals.vercel.app/photos</b>. New photos are grouped by team, event and day; once a batch has {"≥"} the minimum and nobody has added to it for 2 hours, Claude picks the best (and leaves out anything that shouldn't be public - swimwear, hot tubs, blurry, screenshots), writes the caption, and the draft comes to you in Slack.</div>
        {data?.batches?.length > 0 && <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: T.hot, textTransform: "uppercase", letterSpacing: "0.06em" }}>Waiting batches</div>
          {data.batches.map(b => <div key={b.key} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
            <b>{teamLabel(b.team) || "No team"}</b><span style={{ color: T.mut }}>{b.event || ""} {b.day} · {b.count} photo{b.count === 1 ? "" : "s"}{b.ready ? " · ready" : ""}</span>
            <Btn small disabled={!!busy} onClick={() => look(b.ids)}>{busy === "preview" ? "Looking…" : "Preview with Claude"}</Btn>
            <Btn small primary disabled={!!busy} onClick={() => make(b.ids)}>{busy === "make" ? "Making…" : "Make the draft"}</Btn>
          </div>)}
        </div>}
      </Box>
      {preview && <Box>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}><b>Claude's take</b><span style={{ color: T.mut, fontSize: 12 }}>{preview.format} · nothing saved</span><div style={{ flex: 1 }} /><button style={link} onClick={() => setPreview(null)}>close</button></div>
        {preview.error && <div style={{ color: T.bad, fontSize: 13 }}>{preview.error}</div>}
        {preview.caption && <div style={{ whiteSpace: "pre-wrap", fontSize: 14, margin: "4px 0 8px" }}>{preview.caption} <span style={{ color: T.hot }}>{(preview.hashtags || []).map(h => "#" + h).join(" ")}</span></div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{(preview.verdicts || []).map(v => { const p = byId.get(v.photo_id); return <div key={v.photo_id} style={{ width: 120, fontSize: 11, color: v.usable ? T.text : T.bad }}>
          {p?.url && <img src={p.url} alt="" style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 8, opacity: v.usable ? 1 : 0.4, outline: (preview.picks || []).includes(v.photo_id) ? "2px solid " + T.pink : "none" }} />}
          <div>{v.usable ? `✓ ${v.score}/10` : "✕"} {v.reason}</div></div>; })}</div>
      </Box>}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select value={team} onChange={e => setTeam(e.target.value)} style={{ ...input, width: "auto" }}><option value="">All teams</option>{teams.map(t => <option key={t} value={t}>{teamLabel(t)}</option>)}</select>
        <select value={days} onChange={e => setDays(Number(e.target.value))} style={{ ...input, width: "auto" }}>{[14, 30, 60, 120].map(d => <option key={d} value={d}>Last {d} days</option>)}</select>
        <div style={{ flex: 1 }} />
        {sel.length > 0 && <>
          <span style={{ fontSize: 13, color: T.mut }}>{sel.length} picked</span>
          <Btn small disabled={!!busy} onClick={() => look(sel)}>Preview with Claude</Btn>
          <Btn small primary disabled={!!busy} onClick={() => make(sel)}>{busy === "make" ? "Making…" : `Make a post from ${sel.length}`}</Btn>
          <button style={link} onClick={() => setSel([])}>clear</button>
        </>}
      </div>
      {err && <div style={{ color: T.bad, fontSize: 13 }}>{err}</div>}
      {!data ? <Muted>Loading photos…</Muted> : !shown.length ? <Box><Muted>No photos in this window.</Muted></Box> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8 }}>
          {shown.map(p => {
            const on = sel.includes(p.id), used = p.social_post_id > 0, off = p.social_hidden || p.blocked;
            return <div key={p.id} style={{ position: "relative", background: T.card, borderRadius: 10, overflow: "hidden", outline: on ? "3px solid " + T.pink : "none" }}>
              <img src={p.url} alt="" loading="lazy" onClick={() => !off && toggle(p.id)} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block", cursor: off ? "default" : "pointer", opacity: off ? 0.3 : used ? 0.7 : 1 }} />
              <div style={{ padding: "5px 7px", fontSize: 11, display: "flex", gap: 4, alignItems: "center" }}>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{teamLabel(p.team_name)} · {fmtDay(p.created_at)}</span>
                <button title={p.social_hidden ? "Allow on social again" : "Keep this photo off social"} onClick={() => run("hide", async () => { await api("hide_photo", { id: p.id, hidden: !p.social_hidden }); await load(); })} style={tiny}>{p.social_hidden ? "↺" : "🚫"}</button>
              </div>
              {(used || off) && <span style={{ position: "absolute", top: 6, left: 6, ...pillStyle(p.blocked ? T.bad : p.social_hidden ? T.mut : T.ok), fontSize: 10 }}>{p.blocked ? "family opted out" : p.social_hidden ? "hidden" : p.social_post_id ? "used" : ""}</span>}
            </div>;
          })}
        </div>
      )}
      <OptOuts api={api} list={data?.no_social || []} onChange={load} />
    </div>
  );
}

function OptOuts({ api, list, onChange }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);
  useEffect(() => { if (q.trim().length < 2) { setHits([]); return; } const t = setTimeout(() => api("player_search", { q }).then(d => setHits(d.players)).catch(() => {}), 250); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = async (id, on) => { await api("no_social", { player_id: id, on }); setQ(""); onChange(); };
  return (
    <Box>
      <div style={{ fontWeight: 800, marginBottom: 4 }}>Families who asked not to be posted</div>
      <div style={{ fontSize: 12, color: T.mut, marginBottom: 8 }}>None of these families' uploads are ever picked, and their photos show "family opted out".</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {list.map(p => <span key={p.id} style={pillStyle(T.mut)}>{p.first_name} {p.last_name} · {teamLabel(p.team_assignment)} <button style={{ ...link, marginLeft: 4 }} onClick={() => set(p.id, false)}>✕</button></span>)}
        {!list.length && <Muted>Nobody yet.</Muted>}
      </div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Add a player…" style={{ ...input, width: 260 }} />
      {hits.length > 0 && <div style={{ marginTop: 6, display: "grid", gap: 4 }}>{hits.filter(h => !h.no_social).map(h => <button key={h.id} onClick={() => set(h.id, true)} style={{ ...chip(false), textAlign: "left" }}>{h.first_name} {h.last_name} · {teamLabel(h.team_assignment)}</button>)}</div>}
    </Box>
  );
}

// ── coach intros ────────────────────────────────────────────────────────────
const INTRO = { draft: [T.mut, "Not sent"], sent: [T.warn, "Survey out"], answered: [T.hot, "Answered"], drafted: [T.hot, "Poster ready"], posted: [T.ok, "Posted"], cancelled: [T.mut, "Cancelled"] };
function Coaches({ api, onDrafted }) {
  const [coaches, setCoaches] = useState(null);
  const [intros, setIntros] = useState([]);
  const [sel, setSel] = useState([]);
  const [via, setVia] = useState(["email", "text"]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(null);
  const load = () => Promise.all([api("coaches"), api("intros")]).then(([c, i]) => { setCoaches(c.coaches); setIntros(i.intros); }).catch(e => setMsg(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (label, fn) => { setBusy(label); setMsg(""); try { await fn(); } catch (e) { setMsg(e.message); } setBusy(""); };
  const send = () => run("send", async () => {
    const r = await api("intro_send", { coach_ids: sel, via });
    setMsg(r.results.map(x => `${x.coach}: ${x.error || x.skipped || "sent by " + (x.via || []).join(" + ")}`).join(" · "));
    setSel([]); await load();
  });
  const free = (coaches || []).filter(c => !c.intro || ["cancelled", "posted"].includes(c.intro.status));
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Box>
        <div style={{ fontWeight: 800, marginBottom: 4 }}>Meet the Coach</div>
        <div style={{ fontSize: 13, color: T.mut, lineHeight: 1.5 }}>Each coach gets a short survey (their own link): a few questions, a photo or two, and "OK to share". When they answer, Claude makes the poster from their own words and it comes to you in Slack. Approved intros go out one an evening. One reminder goes after 3 days. <a href="/coach-intro?preview=1" target="_blank" rel="noreferrer" style={{ color: T.hot }}>See the survey page ↗</a></div>
      </Box>
      <Box>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <b>Send the survey</b>
          <button style={link} onClick={() => setSel(sel.length ? [] : free.filter(c => c.email || c.phone).map(c => c.id))}>{sel.length ? "clear" : "pick everyone not asked yet"}</button>
          <div style={{ flex: 1 }} />
          {["email", "text"].map(v => <label key={v} style={{ fontSize: 13, display: "inline-flex", gap: 4 }}><input type="checkbox" checked={via.includes(v)} onChange={e => setVia(e.target.checked ? [...via, v] : via.filter(x => x !== v))} />{v === "email" ? "Email" : "Text"}</label>)}
          <Btn primary disabled={!sel.length || !via.length || !!busy} onClick={send}>{busy === "send" ? "Sending…" : `Send to ${sel.length || ""} coach${sel.length === 1 ? "" : "es"}`}</Btn>
        </div>
        {msg && <div style={{ fontSize: 13, color: /error|n't|fail/i.test(msg) ? T.bad : T.ok, marginBottom: 8 }}>{msg}</div>}
        {!coaches ? <Muted>Loading coaches…</Muted> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 6 }}>
            {coaches.map(c => { const [col, lab] = c.intro ? INTRO[c.intro.status] || [T.mut, c.intro.status] : [T.mut, ""]; const can = (c.email || c.phone) && (!c.intro || ["cancelled", "posted"].includes(c.intro.status)); return (
              <label key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "7px 9px", background: T.card2, borderRadius: 8, opacity: can ? 1 : 0.75, cursor: can ? "pointer" : "default" }}>
                <input type="checkbox" disabled={!can} checked={sel.includes(c.id)} onChange={() => setSel(s => s.includes(c.id) ? s.filter(x => x !== c.id) : [...s, c.id])} />
                <span style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: 13 }}>{c.name}</b><span style={{ display: "block", fontSize: 11, color: T.mut, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.teams.join(", ") || "no team"}{!c.email && !c.phone ? " · no email or phone" : !c.email ? " · text only" : !c.phone ? " · email only" : ""}</span></span>
                {lab && <span style={pillStyle(col)}>{lab}</span>}
              </label>); })}
          </div>
        )}
      </Box>
      {intros.length > 0 && <Box>
        <b>Surveys</b>
        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
          {intros.map(i => { const [col, lab] = INTRO[i.status] || [T.mut, i.status]; const answered = (i.questions || []).filter(q => q.a).length; return (
            <div key={i.id} style={{ background: T.card2, borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <b style={{ fontSize: 14 }}>{i.name}</b><span style={pillStyle(col)}>{lab}</span>
                <span style={{ fontSize: 12, color: T.mut }}>{i.sent_at ? `sent ${fmtDay(i.sent_at)} by ${(i.sent_via || []).join(" + ")}` : ""}{i.reminded_at ? ` · reminded ${fmtDay(i.reminded_at)}` : ""}{i.answered_at ? ` · answered ${fmtDay(i.answered_at)} (${answered} answers, ${(i.photos || []).length} photos)` : ""}</span>
                {i.error && <span style={{ fontSize: 12, color: T.bad }}>{i.error}</span>}
                <div style={{ flex: 1 }} />
                <button style={link} onClick={() => navigator.clipboard?.writeText(i.link)}>copy link</button>
                {i.status === "sent" && <Btn small disabled={!!busy} onClick={() => run("r" + i.id, async () => { await api("intro_remind", { id: i.id }); await load(); })}>{busy === "r" + i.id ? "…" : "Remind"}</Btn>}
                {["answered", "drafted"].includes(i.status) && <Btn small primary disabled={!!busy} onClick={() => run("d" + i.id, async () => { await api("intro_draft", { id: i.id }); onDrafted(); })}>{busy === "d" + i.id ? "Making…" : i.status === "drafted" ? "Make it again" : "Make the poster"}</Btn>}
                <button style={link} onClick={() => setOpen(open === i.id ? null : i.id)}>{open === i.id ? "hide" : i.status === "sent" ? "type in answers" : "answers"}</button>
                {["draft", "sent", "answered"].includes(i.status) && <button style={{ ...link, color: T.bad }} onClick={() => run("c", async () => { await api("intro_cancel", { id: i.id }); await load(); })}>cancel</button>}
              </div>
              {open === i.id && <Answers api={api} intro={i} onSaved={load} />}
            </div>); })}
        </div>
      </Box>}
    </div>
  );
}
function Answers({ api, intro, onSaved }) {
  const [a, setA] = useState((intro.questions || []).map(q => q.a || ""));
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
      {(intro.questions || []).map((q, k) => <label key={k} style={{ fontSize: 12, color: T.mut }}>{q.q}<textarea value={a[k]} onChange={e => setA(x => x.map((v, j) => j === k ? e.target.value : v))} rows={2} style={{ ...input, width: "100%", marginTop: 2 }} /></label>)}
      {(intro.photos || []).length > 0 && <div style={{ display: "flex", gap: 6 }}>{intro.photos.map(p => <img key={p.path} src={p.url} alt="" style={{ width: 70, height: 70, objectFit: "cover", borderRadius: 6 }} />)}</div>}
      <div><Btn small disabled={busy} onClick={async () => { setBusy(true); try { await api("intro_answers", { id: intro.id, answers: a }); onSaved(); } finally { setBusy(false); } }}>{busy ? "Saving…" : "Save answers"}</Btn> <span style={{ fontSize: 11, color: T.mut }}>Typing answers in (e.g. from a text) counts as the coach's OK to share - only do it if they said so.</span></div>
    </div>
  );
}

// ── settings ────────────────────────────────────────────────────────────────
function Settings({ api, status, onChange }) {
  const s = status?.settings;
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [token, setToken] = useState("");
  const [pages, setPages] = useState(null);
  const [check, setCheck] = useState(null);
  useEffect(() => { if (s && !f) setF({ ...s, approvers: s.approvers.join(", "), hashtags: s.hashtags.map(h => "#" + h).join(" "), intro_questions: s.intro_questions.join("\n") }); }, [s]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (label, fn) => { setBusy(label); setMsg(""); try { await fn(); } catch (e) { setMsg(e.message); } setBusy(""); };
  const meta = status?.meta;
  if (!status || !f) return <Muted>Loading…</Muted>;
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Box>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Facebook & Instagram</div>
        {meta.connected
          ? <div style={{ fontSize: 14 }}>Posting to <b>{meta.page?.name || meta.page?.id}</b>{meta.instagram ? <> and Instagram <b>@{meta.instagram.username || meta.instagram.id}</b></> : <span style={{ color: T.warn }}> - no Instagram linked to this Page</span>}{meta.since ? <span style={{ color: T.mut, fontSize: 12 }}> · since {fmtDay(meta.since)}{meta.by ? " by " + meta.by : ""}</span> : null}</div>
          : <div style={{ fontSize: 14, color: T.warn }}>Not connected yet. Connect DS Elite's Page once and HQ keeps a token that doesn't expire.</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <Btn primary disabled={!!busy || !meta.oauth} title={meta.oauth ? "" : "Needs META_APP_ID and META_APP_SECRET in Vercel"} onClick={() => run("oauth", async () => { const { url } = await api("connect_url"); window.location.href = url; })}>{meta.connected ? "Reconnect Facebook" : "Connect Facebook"}</Btn>
          {meta.connected && <Btn disabled={!!busy} onClick={() => run("check", async () => setCheck((await api("meta_check")).meta))}>{busy === "check" ? "Checking…" : "Check the connection"}</Btn>}
          {meta.connected && <Btn disabled={!!busy} onClick={() => window.confirm("Disconnect DS Elite's Facebook? Nothing can post until it's connected again.") && run("dis", async () => { await api("disconnect"); onChange(); })}>Disconnect</Btn>}
        </div>
        {!meta.oauth && <div style={{ fontSize: 12, color: T.mut, marginTop: 6 }}>The Connect button needs <code>META_APP_ID</code> and <code>META_APP_SECRET</code> in Vercel, and <code>{status.redirect_uri}</code> listed as a Valid OAuth Redirect URI in the Meta app (DSE_SOCIAL_SETUP.md). Or paste a token below.</div>}
        {check && <div style={{ fontSize: 13, marginTop: 8, color: check.problems?.length ? T.bad : T.ok }}>{check.problems?.length ? check.problems.join(" · ") : `✓ Working - ${check.page?.name}${check.instagram ? " + @" + (check.instagram.username || check.instagram.id) : ""} · token ${check.expires === "never" ? "doesn't expire" : "expires " + check.expires}${check.app ? " · app " + check.app : ""}`}</div>}
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontSize: 13, color: T.mut }}>Or paste a token from Graph API Explorer</summary>
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            <input value={token} onChange={e => setToken(e.target.value)} placeholder="User or Page access token" style={{ ...input, flex: 1, minWidth: 240 }} />
            <Btn disabled={!token || !!busy} onClick={() => run("token", async () => { const r = await api("connect_token", { token }); setToken(""); if (r.pages) setPages(r); else { setPages(null); onChange(); setMsg(`Connected ${r.saved.page.name}${r.expires !== "never" ? ` - but this token expires ${r.expires}; use a long-lived one` : ""}`); } })}>{busy === "token" ? "…" : "Use it"}</Btn>
          </div>
          {pages && <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            <div style={{ fontSize: 13 }}>Which Page?{!pages.long_lived && <span style={{ color: T.warn }}> (This token is short-lived; without META_APP_SECRET the connection will expire in about an hour - extend it in the Access Token Debugger first.)</span>}</div>
            {pages.pages.map(p => <button key={p.id} onClick={() => run("pick", async () => { await api("pick_page", { page_id: p.id }); setPages(null); onChange(); })} style={{ ...chip(p.id === pages.likely), textAlign: "left" }}>{p.name} {p.ig_username ? "· @" + p.ig_username : "· no Instagram"}</button>)}
          </div>}
        </details>
      </Box>
      <Box>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>How it runs</div>
        <div style={{ display: "grid", gap: 10, fontSize: 14 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={f.auto_photos} onChange={e => setF({ ...f, auto_photos: e.target.checked })} />Draft photo posts from new family uploads by itself</label>
          <label>A batch needs at least <input type="number" min={1} max={10} value={f.min_photos} onChange={e => setF({ ...f, min_photos: e.target.value })} style={{ ...input, width: 60 }} /> photos</label>
          <div style={{ display: "flex", gap: 12 }}>Post to {["facebook", "instagram"].map(p => <label key={p} style={{ display: "inline-flex", gap: 4 }}><input type="checkbox" checked={f.platforms.includes(p)} onChange={e => setF({ ...f, platforms: e.target.checked ? [...f.platforms, p] : f.platforms.filter(x => x !== p) })} />{p === "facebook" ? "Facebook" : "Instagram"}</label>)}</div>
          <label>Approvals go to (Slack DM, by email) <input value={f.approvers} onChange={e => setF({ ...f, approvers: e.target.value })} style={{ ...input, width: "100%" }} /></label>
          <label>Hashtags on every post <input value={f.hashtags} onChange={e => setF({ ...f, hashtags: e.target.value })} style={{ ...input, width: "100%", color: T.hot }} /></label>
          <label>Posts go out at <input type="time" value={f.intro_time} onChange={e => setF({ ...f, intro_time: e.target.value })} style={{ ...input, width: 120, colorScheme: "dark" }} /> Central, one a day: each draft is planned for the next free day (photo posts and coach intros alike)</label>
          <label>Survey questions (one per line)<textarea value={f.intro_questions} onChange={e => setF({ ...f, intro_questions: e.target.value })} rows={7} style={{ ...input, width: "100%", marginTop: 2 }} /></label>
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
          <Btn primary disabled={!!busy} onClick={() => run("save", async () => { await api("settings_save", { settings: { auto_photos: f.auto_photos, min_photos: Number(f.min_photos), platforms: f.platforms, approvers: f.approvers.split(/[\s,;]+/).filter(Boolean), hashtags: f.hashtags.split(/[\s,]+/).filter(Boolean), intro_time: f.intro_time, intro_questions: f.intro_questions.split("\n") } }); onChange(); setMsg("Saved"); })}>{busy === "save" ? "Saving…" : "Save settings"}</Btn>
          {msg && <span style={{ fontSize: 13, color: /saved|connected/i.test(msg) ? T.ok : T.bad }}>{msg}</span>}
        </div>
      </Box>
    </div>
  );
}

// ── bits ────────────────────────────────────────────────────────────────────
const input = { background: T.card2, border: "1px solid " + T.line, borderRadius: 8, color: T.text, fontFamily: "inherit", fontSize: 14, padding: "8px 10px", boxSizing: "border-box", outline: "none" };
const link = { background: "none", border: "none", color: T.mut, cursor: "pointer", fontFamily: "inherit", fontSize: 12, padding: 0, textDecoration: "underline" };
const tiny = { background: "none", border: "none", color: T.mut, cursor: "pointer", fontFamily: "inherit", fontSize: 13, padding: "0 3px" };
const chip = (on) => ({ padding: "6px 12px", borderRadius: 999, border: "1px solid " + (on ? T.pink : T.line), background: on ? T.pink : "transparent", color: on ? "#fff" : T.text, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700 });
const badge = (on) => ({ minWidth: 18, padding: "0 5px", borderRadius: 9, background: on ? "#fff" : T.pink, color: on ? T.pink : "#fff", fontSize: 11, lineHeight: "18px", textAlign: "center" });
const pillStyle = (c) => ({ display: "inline-block", padding: "2px 8px", borderRadius: 999, border: "1px solid " + c, color: c, fontSize: 11, fontWeight: 800, whiteSpace: "nowrap", background: T.bg });
const pillBtn = (c) => ({ ...pillStyle(c), cursor: "pointer", fontFamily: "inherit", fontSize: 12 });
function Pill({ color, children }) { return <span style={pillStyle(color)}>{children}</span>; }
function Box({ children }) { return <div style={{ background: T.card, border: "1px solid " + T.line, borderRadius: 14, padding: 14 }}>{children}</div>; }
function Muted({ children }) { return <div style={{ color: T.mut, fontSize: 13 }}>{children}</div>; }
function Btn({ primary, small, children, ...rest }) {
  return <button {...rest} style={{ padding: small ? "5px 10px" : "8px 14px", borderRadius: 8, border: "1px solid " + (primary ? T.pink : T.line), background: primary ? T.pink : "transparent", color: "#fff", fontFamily: "inherit", fontWeight: 800, fontSize: small ? 12 : 13, cursor: rest.disabled ? "default" : "pointer", opacity: rest.disabled ? 0.5 : 1 }}>{children}</button>;
}
