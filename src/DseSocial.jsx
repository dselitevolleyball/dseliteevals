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
//   Stock      Drew's own photos for graphics: bulk upload, tag a team, notes
//   Coaches    send the "Meet the Coach" survey, follow answers, make posters
//   Settings   the Facebook connection, auto-drafting, approvers, hashtags,
//              the survey questions
import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";

// DS Elite posts only to its own Instagram (api/_lib/dse-social-meta.js DSE_IG).
const DSE_IG = "dselitevb";
const wrongIg = (m) => !!m?.instagram && String(m.instagram.username || "").toLowerCase() !== DSE_IG;

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
const IDEA_KIND = { birthday: "🎂 Coach birthday", tournament: "🏐 Game week", schedule: "📅 Schedules posted", holiday: "🎉 Holiday", meme: "😂 Meme", trend: "🔥 Trend", engagement: "💬 Engagement", throwback: "📸 Throwback", custom: "✍️ Your idea" };
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
  const tabs = [["drafts", "Drafts", drafts.length], ["scheduled", "Scheduled", sched.length], ["posted", "Posted", 0], ["ideas", "Ideas", 0], ["photos", "Photos", 0], ["stock", "Stock photos", 0], ["coaches", "Coach intros", 0], ["settings", "Settings", 0]];

  return (
    <div style={{ margin: "-14px -18px", padding: "16px 16px 40px", background: T.bg, minHeight: "calc(100vh - 56px)", color: T.text, fontFamily: "inherit" }}>
      <style>{"@media (max-width: 700px) { .dse-social-card { grid-template-columns: 1fr !important; } }"}</style>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-0.01em" }}>📣 Social</div>
          <span style={{ fontSize: 12, color: T.mut }}>DS Elite's Facebook & Instagram · nothing posts until it's approved</span>
          <div style={{ flex: 1 }} />
          {meta && (meta.connected
            ? <Pill color={T.ok}>● {meta.page?.name || "Facebook"}{meta.instagram && !wrongIg(meta) ? " + IG" : ""}</Pill>
            : <button onClick={() => setTab("settings")} style={pillBtn(T.warn)}>⚠ Facebook not connected</button>)}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {tabs.map(([k, l, n]) => <button key={k} onClick={() => setTab(k)} style={{ ...chip(tab === k), display: "inline-flex", gap: 6, alignItems: "center" }}>{l}{n > 0 && <span style={badge(tab === k)}>{n}</span>}</button>)}
        </div>
        {err && <div style={{ color: T.bad, marginBottom: 10, fontSize: 13 }}>{err} <button onClick={() => setErr("")} style={link}>dismiss</button></div>}
        {tab === "drafts" && <PostList api={api} posts={drafts} loading={!posts} focusId={focusId} onChange={refresh} empty={<>No drafts right now. New family photos become drafts on their own (every half hour, once a batch has gone quiet for 2 hours) - or make one from <button style={link} onClick={() => setTab("photos")}>Photos</button>.</>} />}
        {tab === "scheduled" && <PostList api={api} posts={sched} loading={!posts} onChange={refresh} empty="Nothing waiting. Approved photo posts go out right away; coach intros take the next free evening." />}
        {tab === "posted" && <PostList api={api} posts={done} loading={!posts} onChange={refresh} compact empty="Nothing posted yet." />}
        {tab === "ideas" && <Ideas api={api} onDrafted={() => { loadPosts(); setTab("drafts"); }} />}
        {tab === "photos" && <Photos api={api} onMade={() => { loadPosts(); setTab("drafts"); }} />}
        {tab === "stock" && <Stock api={api} />}
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
  const [picking, setPicking] = useState(false);
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
        {!compact && post.kind === "idea" && editable && (
          <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Btn small primary={!picking} disabled={!!busy} onClick={() => setPicking(p => !p)}>{picking ? "Close photos" : design.style === "text" ? "📷 Add a photo" : "📷 Change photo"}</Btn>
              {design.style !== "text" && design.idea_kind !== "birthday" && <Btn small disabled={!!busy} onClick={() => go("design", "update_post", { another_photo: true })}>{busy === "design" ? "Redrawing…" : "Shuffle"}</Btn>}
            </div>
            {picking && <StockPicker api={api} busy={busy} teams={design.teams || []} current={design.photo_url} onPick={(p) => { setPicking(false); go("design", "update_post", { design: { photo_url: p.url, focus: p.ai ? { x: p.ai.focal_x / 100, y: p.ai.focal_y / 100 } : null, ...(design.style === "text" ? { style: "holiday" } : {}) } }); }} />}
          </div>
        )}
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
          <span style={{ fontSize: 12, color: T.mut }}>{post.kind === "idea" ? (IDEA_KIND[post.design?.idea_kind] || "Idea") : FORMAT[post.format]} · {fmtDay(post.created_at)}</span>
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
          {editable && <Feedback post={post} busy={busy} onSend={async (text) => { if (dirty) await api("update_post", { id: post.id, caption, hashtags: tags.split(/[\s,]+/).filter(Boolean) }); await go("revise", "revise_post", { feedback: text }); }} />}
          {post.kind === "idea" && editable && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", fontSize: 13, color: T.mut }}>Edit the graphic</summary>
              <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
                {design.style === "meme" ? <>
                  <input value={design.top || ""} onChange={e => setDesign(d => ({ ...d, top: e.target.value }))} placeholder="Top line" style={input} />
                  <input value={design.bottom || ""} onChange={e => setDesign(d => ({ ...d, bottom: e.target.value }))} placeholder="Bottom line" style={input} />
                </> : <>
                  <input value={design.tag || ""} onChange={e => setDesign(d => ({ ...d, tag: e.target.value }))} placeholder="Tag (the pink label)" style={input} />
                  <input value={design.headline || ""} onChange={e => setDesign(d => ({ ...d, headline: e.target.value }))} placeholder="Headline" style={input} />
                  <input value={design.sub || ""} onChange={e => setDesign(d => ({ ...d, sub: e.target.value }))} placeholder="Line under it" style={input} />
                  {Array.isArray(design.lines) && <textarea value={(design.lines || []).join("\n")} onChange={e => setDesign(d => ({ ...d, lines: e.target.value.split("\n") }))} rows={4} placeholder="One per line (teams)" style={input} />}
                </>}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Btn small disabled={!!busy} onClick={() => go("design", "update_post", { design: { ...design, lines: Array.isArray(design.lines) ? design.lines.map(l => l.trim()).filter(Boolean) : design.lines } })}>{busy === "design" ? "Redrawing…" : "Redraw"}</Btn>
                </div>
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

// ── ideas ───────────────────────────────────────────────────────────────────
// Fun ideas: coach birthdays, game weeks, posted schedules and holidays from
// the club's own data, plus Claude's memes, trends and engagement posts.
function Ideas({ api, onDrafted }) {
  const [ideas, setIdeas] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [own, setOwn] = useState("");
  const [ownDay, setOwnDay] = useState("");
  const load = () => api("ideas").then(d => setIdeas(d.ideas)).catch(e => setMsg(e.message));
  useEffect(() => { api("ideas_sync").catch(() => {}).finally(load); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (key, fn, ok) => { setBusy(key); setMsg(""); try { const r = await fn(); if (ok) setMsg(typeof ok === "function" ? ok(r) : ok); await load(); return r; } catch (e) { setMsg(e.message); } finally { setBusy(""); } };
  const shown = (ideas || []).filter(i => showAll || i.status !== "dismissed");
  const days = [...new Set(shown.map(i => i.post_on || ""))].sort();
  const dayLabel = (d) => d ? new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) : "Any day";
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Box>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>✍️ Your idea</div>
          <div style={{ fontSize: 12, color: T.mut, marginBottom: 8 }}>Say what you want in plain words. Claude writes it from HQ's real teams, coaches, practices, tournaments, fees and the commitment's expectations, draws the graphic and puts it in Drafts for approval.</div>
          <textarea value={own} onChange={e => setOwn(e.target.value)} rows={3} placeholder="e.g. Make me a post looking for players for our 11 Regional team. Include the cost, the schedule, the practices and the expectations." style={{ ...input, width: "100%", resize: "vertical", fontSize: 14 }} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            <Btn primary disabled={!!busy || own.trim().length < 5} onClick={async () => { const r = await run("own", () => api("idea_custom", { prompt: own, post_on: ownDay || null })); if (r?.post) { setOwn(""); setOwnDay(""); onDrafted(); } }}>{busy === "own" ? "Writing it… (about a minute)" : "Write it"}</Btn>
            <label style={{ fontSize: 13, color: T.mut, display: "inline-flex", gap: 6, alignItems: "center" }}>Post on <input type="date" value={ownDay} onChange={e => setOwnDay(e.target.value)} style={{ ...input, padding: "4px 8px", fontSize: 13 }} /></label>
            <span style={{ fontSize: 12, color: T.mut }}>{ownDay ? "" : "(blank = the next open slot)"}</span>
          </div>
        </Box>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <Btn primary disabled={!!busy} onClick={() => run("brain", () => api("ideas_brainstorm", { count: 6 }), (r) => `${r.added} new idea${r.added === 1 ? "" : "s"}${r.trend_error ? " (the trend search didn't work this time, so these are evergreen)" : ""}`)}>{busy === "brain" ? "Thinking… (about a minute)" : "✨ New fun ideas"}</Btn>
        <Btn disabled={!!busy} onClick={() => run("sync", () => api("ideas_sync"), (r) => r.added ? `${r.added} new from the calendar` : "Up to date")}>{busy === "sync" ? "Checking…" : "Check birthdays & tournaments"}</Btn>
        <label style={{ fontSize: 13, color: T.mut, display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />Show dismissed</label>
        {msg && <span style={{ fontSize: 13, color: T.mut }}>{msg}</span>}
      </div>
      <div style={{ fontSize: 12, color: T.mut, marginBottom: 12 }}>Coach birthdays, game weeks, posted schedules and holidays come from HQ's own data every morning. Memes, trends and comment posts are Claude's, a fresh batch every Monday. "Make it a post" draws the graphic and puts it in Drafts for approval.</div>
      {!ideas ? <Muted>Loading…</Muted> : !shown.length ? <Box><Muted>No ideas for the next few weeks yet. Press "✨ New fun ideas".</Muted></Box> : (
        <div style={{ display: "grid", gap: 16 }}>
          {days.map(d => (
            <div key={d}>
              <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: T.hot, marginBottom: 6 }}>{dayLabel(d)}</div>
              <div style={{ display: "grid", gap: 8 }}>{shown.filter(i => (i.post_on || "") === d).map(i => <IdeaCard key={i.id + ":" + i.updated_at} api={api} idea={i} busy={busy} run={run} onDrafted={onDrafted} />)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function IdeaCard({ api, idea, busy, run, onDrafted }) {
  const [caption, setCaption] = useState(idea.caption || "");
  const c = idea.card || {};
  const look = c.style === "meme" ? `Meme on a team photo: "${c.top || ""}" / "${c.bottom || ""}"` : c.style === "text" ? `Text card: "${c.headline || ""}"${c.sub ? ` · ${c.sub}` : ""}` : `${c.tag ? c.tag + " · " : ""}${c.headline || ""}${c.lines?.length ? ` · ${c.lines.length} teams` : ""}`;
  const dirty = caption !== (idea.caption || "");
  return (
    <div style={{ background: T.card, border: "1px solid " + T.line, borderRadius: 12, padding: 12, opacity: idea.status === "dismissed" ? 0.55 : 1 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
        <Pill color={T.hot}>{IDEA_KIND[idea.kind] || idea.kind}</Pill>
        <b>{idea.title}</b>
        {idea.status === "drafted" && <Pill color={T.ok}>In drafts</Pill>}
      </div>
      {idea.pitch && <div style={{ fontSize: 13, color: T.mut, marginBottom: 6 }}>{idea.pitch}</div>}
      <div style={{ fontSize: 12, color: T.mut, marginBottom: 6 }}>🖼 {look}</div>
      {idea.status !== "drafted" ? <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={2} style={{ ...input, width: "100%", resize: "vertical", fontSize: 13 }} /> : <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{idea.caption}</div>}
      {idea.sources?.length > 0 && <div style={{ fontSize: 11, color: T.mut, marginTop: 4 }}>Trend: {idea.sources.slice(0, 2).map((s, k) => <a key={k} href={s.url} target="_blank" rel="noreferrer" style={{ color: T.mut, marginRight: 8 }}>{s.title} ↗</a>)}</div>}
      {idea.status !== "drafted" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          {idea.status === "new" && <Btn primary small disabled={!!busy} onClick={async () => { if (dirty) await api("idea_update", { id: idea.id, caption }); const r = await run("draft" + idea.id, () => api("idea_draft", { id: idea.id })); if (r?.post || r?.already) onDrafted(); }}>{busy === "draft" + idea.id ? "Drawing it…" : "Make it a post"}</Btn>}
          {dirty && idea.status === "new" && <Btn small disabled={!!busy} onClick={() => run("save" + idea.id, () => api("idea_update", { id: idea.id, caption }), "Saved")}>Save caption</Btn>}
          {idea.status === "new" && <Btn small disabled={!!busy} onClick={() => run("x" + idea.id, () => api("idea_dismiss", { id: idea.id }))}>Dismiss</Btn>}
          {idea.status === "dismissed" && <Btn small disabled={!!busy} onClick={() => run("x" + idea.id, () => api("idea_restore", { id: idea.id }))}>Bring back</Btn>}
        </div>
      )}
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

// ── stock photos ────────────────────────────────────────────────────────────
// Drew's own pictures for graphics (Oct 30 2026). Each is shrunk here (2400px
// long side, JPEG; drawing to a canvas also drops EXIF/GPS) with a 480px
// thumbnail, then uploaded straight to storage through signed slots.
function shrinkTo(file, max, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      cv.toBlob(b => b ? resolve({ blob: b, width: w, height: h }) : reject(new Error("couldn't encode it")), "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(/heic|heif/i.test(file.type + file.name) ? "iPhone HEIC - this browser can't open it; export it as JPG (or upload from the iPhone itself)" : "not a picture this browser can open")); };
    img.src = url;
  });
}
function Stock({ api }) {
  const [data, setData] = useState(null);
  const [team, setTeam] = useState("");          // the team new uploads get
  const [note, setNote] = useState("");          // and their note
  const [filter, setFilter] = useState("all");
  const [showHidden, setShowHidden] = useState(false);
  const [prog, setProg] = useState(null);        // { done, total }
  const [fails, setFails] = useState([]);
  const [err, setErr] = useState("");
  const [over, setOver] = useState(false);
  const [sort, setSort] = useState("new");
  const [busy, setBusy] = useState("");
  const load = () => api("stock").then(setData).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Claude reads new uploads in the background; refresh until it has.
  const unread = (data?.photos || []).filter(p => !p.ai_at && !p.ai_error).length;
  useEffect(() => { if (!unread || prog) return; const t = setTimeout(load, 8000); return () => clearTimeout(t); }, [data, prog]); // eslint-disable-line react-hooks/exhaustive-deps
  const analyze = async (body, label) => { setBusy(label); setErr(""); try { await api("stock_analyze", body); await load(); } catch (e) { setErr(e.message); } setBusy(""); };
  const uploadAll = async (fileList) => {
    const files = [...fileList].filter(f => /^image\//.test(f.type) || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
    if (!files.length) return;
    setErr(""); setFails([]); setProg({ done: 0, total: files.length });
    const bad = [];
    for (let i = 0; i < files.length; i += 5) {
      const chunk = files.slice(i, i + 5);
      try {
        const { bucket, slots } = await api("stock_upload_urls", { count: chunk.length });
        const items = (await Promise.all(chunk.map(async (f, k) => {
          try {
            const [full, thumb] = [await shrinkTo(f, 2400, 0.88), await shrinkTo(f, 480, 0.8)];
            const s = slots[k];
            const [a, b] = await Promise.all([
              supabase.storage.from(bucket).uploadToSignedUrl(s.path, s.token, full.blob, { contentType: "image/jpeg" }),
              supabase.storage.from(bucket).uploadToSignedUrl(s.thumb_path, s.thumb_token, thumb.blob, { contentType: "image/jpeg" }),
            ]);
            if (a.error || b.error) throw new Error((a.error || b.error).message);
            return { path: s.path, thumb_path: s.thumb_path, width: full.width, height: full.height, team_name: team || null, note, original_name: f.name };
          } catch (e) { bad.push({ name: f.name, why: e.message }); return null; }
        }))).filter(Boolean);
        if (items.length) await api("stock_add", { items });
      } catch (e) { chunk.forEach(f => bad.push({ name: f.name, why: e.message })); }
      setProg({ done: Math.min(files.length, i + chunk.length), total: files.length });
      setFails([...bad]);
    }
    setProg(null);
    load();
  };
  const patch = async (id, body) => { try { await api("stock_update", { id, ...body }); load(); } catch (e) { setErr(e.message); } };
  const del = async (p) => { if (!window.confirm("Delete this photo from the stock library? (Posts already made keep their graphic.)")) return; try { await api("stock_delete", { id: p.id }); load(); } catch (e) { setErr(e.message); } };
  const teams = data?.teams || [];
  const SORTS = { new: () => 0, social: (a, b) => (b.ai?.social_score || 0) - (a.ai?.social_score || 0), website: (a, b) => (b.ai?.website_score || 0) - (a.ai?.website_score || 0) };
  const shown = (data?.photos || []).filter(p => (showHidden || !p.hidden) && (filter === "all" || (filter === "web" ? p.website : filter === "club" ? !p.team_name : p.team_name === filter))).sort(SORTS[sort]);
  const counts = (data?.photos || []).filter(p => !p.hidden).reduce((m, p) => { const k = p.team_name || "club"; m[k] = (m[k] || 0) + 1; return m; }, {});

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Box>
        <div style={{ fontWeight: 800, marginBottom: 4 }}>Add photos</div>
        <div style={{ fontSize: 12, color: T.mut, marginBottom: 10 }}>Pick a team (or leave it club-wide) and an optional note, then drop in as many photos as you like. Idea and "Your idea" graphics use these first - the team's own, least-used first - and every draft has "Choose a stock photo". A note ("13 Diamond huddle at CTPL", "tryouts sign-in") helps Claude pick the right one.</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <select value={team} onChange={e => setTeam(e.target.value)} style={input}>
            <option value="">Club-wide (no team)</option>
            {teams.map(t => <option key={t} value={t}>{teamLabel(t)}</option>)}
          </select>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note for this batch (optional)" style={{ ...input, flex: "1 1 240px" }} />
        </div>
        <label onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); if (!prog) uploadAll(e.dataTransfer.files); }}
          style={{ display: "block", border: "2px dashed " + (over ? T.pink : T.line), borderRadius: 12, padding: "26px 14px", textAlign: "center", cursor: prog ? "default" : "pointer", background: over ? "#1f0f18" : T.card2 }}>
          <input type="file" accept="image/*,.heic,.heif" multiple disabled={!!prog} onChange={e => { uploadAll(e.target.files); e.target.value = ""; }} style={{ display: "none" }} />
          {prog ? <b>Uploading {prog.done} of {prog.total}…</b> : <><b>Drop photos here</b><div style={{ fontSize: 12, color: T.mut, marginTop: 4 }}>or click to choose · JPG, PNG, WebP (iPhone photos work from the phone)</div></>}
        </label>
        {fails.length > 0 && <div style={{ marginTop: 8, fontSize: 12, color: T.bad }}>{fails.length} didn't upload: {fails.slice(0, 6).map(f => `${f.name} (${f.why})`).join("; ")}{fails.length > 6 ? "…" : ""}</div>}
        {err && <div style={{ marginTop: 8, fontSize: 13, color: T.bad }}>{err}</div>}
      </Box>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => setFilter("all")} style={chip(filter === "all")}>All {(data?.photos || []).filter(p => !p.hidden).length}</button>
        <button onClick={() => setFilter("club")} style={chip(filter === "club")}>Club-wide {counts.club || 0}</button>
        {teams.filter(t => counts[t]).map(t => <button key={t} onClick={() => setFilter(t)} style={chip(filter === t)}>{teamLabel(t)} {counts[t]}</button>)}
        <button onClick={() => setFilter("web")} style={chip(filter === "web")}>🌐 Website {(data?.photos || []).filter(p => p.website).length}</button>
        <select value={sort} onChange={e => setSort(e.target.value)} style={{ ...input, padding: "5px 8px", fontSize: 13 }}>
          <option value="new">Newest first</option><option value="social">Best for social</option><option value="website">Best for website</option>
        </select>
        <label style={{ fontSize: 13, color: T.mut, display: "inline-flex", gap: 6, alignItems: "center", marginLeft: 6 }}><input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} />Show hidden</label>
        {unread > 0 && <span style={{ fontSize: 12, color: T.warn }}>Claude is reading {unread} photo{unread === 1 ? "" : "s"}… <button style={link} disabled={!!busy} onClick={() => analyze({}, "all")}>{busy === "all" ? "working…" : "nudge it"}</button></span>}
      </div>
      <div style={{ fontSize: 12, color: T.mut }}>Claude reads every photo: what's in it, a 1-10 score for social and for the website, the website role (hero banner / section / gallery) and alt text, where the subject is (so crops keep it), where a headline fits, and a safety check - anything that shouldn't be public is hidden with the reason. 🌐 marks a photo for dselitevolleyball.com; ask Claude to "pull the website photos" to add them to the site.</div>
      {!data ? <Muted>Loading…</Muted> : !shown.length ? <Box><Muted>No stock photos here yet.</Muted></Box> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10 }}>
          {shown.map(p => (
            <div key={p.id} style={{ background: T.card, border: "1px solid " + T.line, borderRadius: 10, overflow: "hidden", opacity: p.hidden ? 0.5 : 1 }}>
              <a href={p.url} target="_blank" rel="noreferrer"><img src={p.thumb_url || p.url} alt={p.note || ""} loading="lazy" style={{ width: "100%", aspectRatio: "4/5", objectFit: "cover", display: "block", background: T.card2 }} /></a>
              <div style={{ padding: 6, display: "grid", gap: 4 }}>
                <select value={p.team_name || ""} onChange={e => patch(p.id, { team_name: e.target.value })} style={{ ...input, padding: "4px 6px", fontSize: 12 }}>
                  <option value="">Club-wide</option>
                  {teams.map(t => <option key={t} value={t}>{teamLabel(t)}</option>)}
                </select>
                <input defaultValue={p.note || ""} placeholder="Note" onBlur={e => e.target.value !== (p.note || "") && patch(p.id, { note: e.target.value })} style={{ ...input, padding: "4px 6px", fontSize: 12 }} />
                <StockAi p={p} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: T.mut }}>
                  <span>{p.used_count ? `used ${p.used_count}×` : "not used yet"}</span>
                  <span>
                    <button onClick={() => patch(p.id, { website: !p.website })} title={p.website ? "On the website list - click to remove" : "Use on the website"} style={{ ...tiny, color: p.website ? T.ok : T.mut }}>🌐{p.website ? "✓" : ""}</button>
                    <button disabled={!!busy} onClick={() => analyze({ ids: [p.id] }, "a" + p.id)} title="Have Claude look again" style={tiny}>{busy === "a" + p.id ? "…" : "↻"}</button>
                    <button onClick={() => patch(p.id, { hidden: !p.hidden })} style={tiny}>{p.hidden ? "Unhide" : "Hide"}</button>
                    <button onClick={() => del(p)} style={{ ...tiny, color: T.bad }}>Delete</button>
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
// Claude's read of one stock photo (api/_lib/dse-stock-ai.js), compact.
const ROLE = { hero: "hero banner", section: "section", gallery: "gallery", none: "not for site" };
function StockAi({ p }) {
  const a = p.ai;
  if (!a) return <div style={{ fontSize: 11, color: p.ai_error ? T.bad : T.mut }}>{p.ai_error ? `Claude couldn't read it: ${p.ai_error}` : "Claude is reading it…"}</div>;
  const sc = (n) => n >= 8 ? T.ok : n >= 5 ? T.text : T.mut;
  return (
    <div style={{ fontSize: 11, lineHeight: 1.4 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span>Social <b style={{ color: sc(a.social_score) }}>{a.social_score}</b>/10</span>
        <span>Web <b style={{ color: sc(a.website_score) }}>{a.website_score}</b>/10</span>
        <span style={{ color: T.mut }}>{ROLE[a.website_role] || a.website_role}</span>
      </div>
      {!a.social_ok && <div style={{ color: T.bad }}>⚠ {a.social_concern || "not for a public post"}</div>}
      <details>
        <summary style={{ cursor: "pointer", color: T.mut }}>{a.description.slice(0, 60)}{a.description.length > 60 ? "…" : ""}</summary>
        <div style={{ color: T.mut, marginTop: 2 }}>{a.description}</div>
        <div style={{ color: T.mut, marginTop: 2 }}><b>Alt:</b> {a.alt}</div>
        <div style={{ color: T.mut, marginTop: 2 }}><b>Good for:</b> {(a.best_for || []).join(", ").replace(/_/g, " ") || "-"} · <b>headline room:</b> {a.text_space} · <b>quality</b> {a.quality}/10{a.dse_gear ? " · DS Elite gear" : ""}</div>
        <div style={{ color: T.hot, marginTop: 2 }}>{(a.tags || []).map(t => "#" + t.replace(/\s+/g, "")).join(" ")}</div>
      </details>
    </div>
  );
}
// "Tell Claude what to change" on a draft (api revise_post). The last round's
// summary comes from post.ai.revisions, since the card remounts on every change.
const FEEDBACK_HINTS = ["Use a court action photo", "Shorter caption", "Make the headline punchier", "Add that tryouts are this Saturday"];
function Feedback({ post, busy, onSend }) {
  const [text, setText] = useState("");
  const revs = post.ai?.revisions || [];
  const last = revs[revs.length - 1];
  const working = busy === "revise";
  return (
    <div style={{ marginTop: 10, background: T.card2, border: "1px solid " + T.line, borderRadius: 10, padding: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>✨ Tell Claude what to change</div>
      {last && <div style={{ fontSize: 12, color: T.ok, marginBottom: 6 }}>Last change: {last.changed || "updated"} <span style={{ color: T.mut }}>(you asked: "{last.feedback.slice(0, 90)}{last.feedback.length > 90 ? "…" : ""}")</span></div>}
      <textarea value={text} onChange={e => setText(e.target.value)} disabled={working} rows={2} placeholder={post.kind === "idea" ? "e.g. use a photo of the team celebrating, make it shorter, lead with the cost, change the headline to…" : "e.g. make it shorter, mention the tournament name, more excited…"} style={{ ...input, width: "100%", resize: "vertical", fontSize: 13 }} />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
        <Btn small primary disabled={!!busy || text.trim().length < 3} onClick={() => onSend(text.trim())}>{working ? "Claude is rewriting… (~30s)" : "Update the draft"}</Btn>
        {!text && !working && FEEDBACK_HINTS.filter(h => post.kind === "idea" || !/photo|headline/i.test(h)).map(h => <button key={h} onClick={() => setText(h)} style={{ ...pillBtn(T.mut), background: "transparent" }}>{h}</button>)}
        {revs.length > 1 && <span style={{ fontSize: 11, color: T.mut }}>{revs.length} rounds so far</span>}
      </div>
    </div>
  );
}

// On a draft: pick the photo its graphic is drawn on. The post's own teams
// lead, then Claude's social score; the current photo is marked.
function StockPicker({ api, busy, onPick, teams = [], current = null }) {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState("all");
  useEffect(() => { api("stock").then(setData).catch(() => setData({ photos: [], teams: [] })); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <Muted>Loading stock photos…</Muted>;
  const live = data.photos.filter(p => !p.hidden);
  if (!live.length) return <Muted>No stock photos yet - add some in the Stock photos tab.</Muted>;
  const teams = [...new Set(live.map(p => p.team_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const mine = (p) => teams.includes(p.team_name) ? 1 : 0;
  const shown = live.filter(p => filter === "all" || (filter === "club" ? !p.team_name : p.team_name === filter)).sort((a, b) => mine(b) - mine(a) || (b.ai?.social_score || 0) - (a.ai?.social_score || 0));
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <select value={filter} onChange={e => setFilter(e.target.value)} style={{ ...input, padding: "4px 6px", fontSize: 12 }}>
        <option value="all">All teams</option><option value="club">Club-wide</option>
        {teams.map(t => <option key={t} value={t}>{teamLabel(t)}</option>)}
      </select>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))", gap: 4, maxHeight: 260, overflowY: "auto" }}>
        {shown.map(p => <button key={p.id} disabled={!!busy} title={[teamLabel(p.team_name), p.note, p.ai && `social ${p.ai.social_score}/10 - ${p.ai.description}`].filter(Boolean).join(" - ")} onClick={() => onPick(p)} style={{ padding: 0, border: "none", background: "none", cursor: "pointer" }}>
          <img src={p.thumb_url || p.url} alt="" loading="lazy" style={{ width: "100%", aspectRatio: "4/5", objectFit: "cover", borderRadius: 6, display: "block", outline: p.url === current ? "3px solid " + T.pink : "none", outlineOffset: -3 }} />
        </button>)}
      </div>
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
          ? <div style={{ fontSize: 14 }}>Posting to <b>{meta.page?.name || meta.page?.id}</b>{meta.instagram && wrongIg(meta) ? <span style={{ color: T.bad }}> - the Instagram linked to this Page is <b>@{meta.instagram.username}</b>, not @{DSE_IG}, so nothing goes to Instagram until @{DSE_IG} is linked to the Page in Meta Business Suite</span> : meta.instagram ? <> and Instagram <b>@{meta.instagram.username || meta.instagram.id}</b></> : <span style={{ color: T.warn }}> - no Instagram linked to this Page</span>}{meta.since ? <span style={{ color: T.mut, fontSize: 12 }}> · since {fmtDay(meta.since)}{meta.by ? " by " + meta.by : ""}</span> : null}</div>
          : <div style={{ fontSize: 14, color: T.warn }}>Not connected yet. Connect DS Elite's Page once and HQ keeps a token that doesn't expire.</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <Btn primary disabled={!!busy || !meta.oauth} title={meta.oauth ? "" : "Needs META_APP_ID and META_APP_SECRET in Vercel"} onClick={() => run("oauth", async () => { const { url } = await api("connect_url"); window.location.href = url; })}>{meta.connected ? "Reconnect Facebook" : "Connect Facebook"}</Btn>
          {meta.connected && <Btn disabled={!!busy} onClick={() => run("check", async () => { setCheck((await api("meta_check")).meta); onChange?.(); })}>{busy === "check" ? "Checking…" : "Check the connection"}</Btn>}
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
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={f.auto_ideas} onChange={e => setF({ ...f, auto_ideas: e.target.checked })} />Draft coach birthdays, game weeks and posted schedules by themselves (2 days ahead)</label>
          <label>A batch needs at least <input type="number" min={1} max={10} value={f.min_photos} onChange={e => setF({ ...f, min_photos: e.target.value })} style={{ ...input, width: 60 }} /> photos</label>
          <div style={{ display: "flex", gap: 12 }}>Post to {["facebook", "instagram"].map(p => <label key={p} style={{ display: "inline-flex", gap: 4 }}><input type="checkbox" checked={f.platforms.includes(p)} onChange={e => setF({ ...f, platforms: e.target.checked ? [...f.platforms, p] : f.platforms.filter(x => x !== p) })} />{p === "facebook" ? "Facebook" : "Instagram"}</label>)}</div>
          <label>Approvals go to (Slack DM, by email) <input value={f.approvers} onChange={e => setF({ ...f, approvers: e.target.value })} style={{ ...input, width: "100%" }} /></label>
          <label>Hashtags on every post <input value={f.hashtags} onChange={e => setF({ ...f, hashtags: e.target.value })} style={{ ...input, width: "100%", color: T.hot }} /></label>
          <label>Posts go out at <input type="time" value={f.intro_time} onChange={e => setF({ ...f, intro_time: e.target.value })} style={{ ...input, width: 120, colorScheme: "dark" }} /> Central, one a day: each draft is planned for the next free day (photo posts and coach intros alike)</label>
          <label>Survey questions (one per line)<textarea value={f.intro_questions} onChange={e => setF({ ...f, intro_questions: e.target.value })} rows={7} style={{ ...input, width: "100%", marginTop: 2 }} /></label>
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
          <Btn primary disabled={!!busy} onClick={() => run("save", async () => { await api("settings_save", { settings: { auto_photos: f.auto_photos, auto_ideas: f.auto_ideas, min_photos: Number(f.min_photos), platforms: f.platforms, approvers: f.approvers.split(/[\s,;]+/).filter(Boolean), hashtags: f.hashtags.split(/[\s,]+/).filter(Boolean), intro_time: f.intro_time, intro_questions: f.intro_questions.split("\n") } }); onChange(); setMsg("Saved"); })}>{busy === "save" ? "Saving…" : "Save settings"}</Btn>
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
