# DSSC Marketing Machine — build contract (Oct 22 2026)

Drew (owner) asked for an "automated marketing machine" inside DSSC HQ: it auto-plans and
drafts Facebook + Instagram posts, a weekly email and text campaigns from upcoming / new /
just-started programs; balances the flow across program lines (volleyball, basketball,
Reach, birthday parties, Camp Elevate, rentals, open gym); renders on-brand graphics from the
club's photo library; lets him edit, ask for changes ("Thanksgiving: push Camp Elevate hard +
volleyball and basketball camps"), and approve quickly; and publishes approved items on
schedule. **Nothing ever goes out without a director's approval.**

Two builders work from this file in parallel in the same checkout (branch `marketing`):
**BACKEND** owns `migrations/20261022_marketing.sql`, `api/marketing*.js`, `api/_lib/marketing-*.js`,
`shared/marketing-plan.js`, `vercel.json`, `MARKETING_SETUP.md`.
**FRONTEND** owns `src/dssc/DsscMarketing*.jsx`, `shared/marketing-graphics.js`, and the wiring
lines in `src/App.jsx` / `src/Nav.jsx`.
Don't edit the other side's files; if the contract is wrong, follow it anyway and note it in
your report. Neither side commits — the lead commits.

## Sources (already live)
- Programs feed (public JSON, CORS *): `https://www.drippingsportsclub.com/api/programs`
  `{ ok, today, programs:[{ id, name, sport: volleyball|basketball|reach|camps|other, kind: program|camp|clinic|pod|league|academy|membership|open-gym|tryout-prep|private, audience, ages, first_date, last_date, next:{date,start,end}, next_dates[], days[], time, sessions_left, sessions_total, status: starts_soon|in_progress, is_new, ongoing, register_url (direct Playbook page), sport_url }], listings:{ volleyball|basketball|reach|other: [{kind,name,url?}] } }`
  Camp Elevate = name matches /camp elevate/i. Line mapping in `shared/marketing-plan.js` → `lineOf(program)`.
- Photo library (public JSON, CORS *): `https://www.drippingsportsclub.com/photos.json`
  `{ photos: [{ key, url (1600px jpg, CORS-enabled), width, height, alt, tags: ['volleyball'|'basketball'|'reach'|'kids'|'camp'|'parties'|'facility'|'people'|'flagship'|'community'], line|null }] }`
  Brand files (CORS-enabled): `https://www.drippingsportsclub.com/brand/logo-light.png` (white lockup 1200×309),
  `/brand/logo-mark-light.png` (white shield 320×497), `/brand/4qa-mark.png` (4QA mark, basketball only).
- Public links: `https://www.drippingsportsclub.com/<volleyball|basketball|reach-performance|camp-elevate|parties|rentals|open-gym|programs>`;
  self-serve booking: parties `https://drippingsports.playbookapi.com/programs/rentals/?resource_type=resource_group&resource_group_pks=175,176`,
  rentals `…resource_group_pks=103,101`; Camp Elevate `https://drippingsports.playbookapi.com/programs/more_info/class_package/78326/`.
- Existing HQ code to reuse: `shared/campaign-audience.js` + `sms_campaigns` table + `api/sms-campaigns.js` cron (texts — consent, do_not_text, STOP handled there);
  `api/_lib/site-inbox.js` (`verifyDirector`, `sendResend`, `dsscFrom`), `shared/dssc-directors.js`, `public.is_dssc_director()` (from migration 20261020_site_inbox.sql, same branch);
  `src/dssc/DsscHub.jsx` exports `DS` palette, `Btn`, `Tag`, `inputStyle`, `fetchAll`.

## Brand (Night Game style guide — graphics and copy)
Colors: ink #061a18, ink-2 #0a2422, evergreen #104946, teal #0F8B76, lime #B2D049, orange #FF7300, paper #F4F0E8, mute #a9b7b1.
Type: **Barlow Condensed 900, UPPERCASE** headlines (tight, big, one accent word in lime or orange); **Schibsted Grotesk** body.
Shapes: clipped-corner buttons/bars (polygon cut 14–28px), skewed tags (skewX(-12deg)) for labels, hard edges — no rounded pills, no cards/dashboard chrome, no drop shadows, no stock gradients except a dark scrim over photos.
Voice: local, warm, confident, short. "Where Dripping Springs plays." Families, not "customers". Specific (dates, grades, what kids do). One clear call to action. Emojis sparingly on social (0–2), never in email subject lines more than one. No invented facts: no prices, no spots-left numbers unless in the feed, no claims about coaches/results not given. Hosts (not coaches) at birthday parties. Buildings: "the Warehouse" (Warehouse I & II, Fitzhugh Rd at Trautwein Rd). Basketball = "4th Quarter Athlete at DSSC". Never mention the Flex.

## Lines
`volleyball`, `basketball`, `reach`, `camp_elevate`, `parties`, `rentals`, `open_gym`, `club` (flagship / community / general).
Default weights (settings): volleyball 3, basketball 3, reach 2, camp_elevate 2, parties 2, rentals 1, open_gym 1, club 1.

## Database (BACKEND writes migration; idempotent; RLS: directors via `public.is_dssc_director()` SELECT/INSERT/UPDATE/DELETE on every mkt_* table; service role does the rest)
- `mkt_settings` (single row id=1): `voice text` (extra brand notes Drew writes), `weights jsonb`, `cadence jsonb` default
  `{"social":{"per_week":4,"days":["mon","wed","fri","sat"],"time":"18:30"},"email":{"day":"thu","time":"07:30"},"sms":{"per_month":2,"time":"17:30"}}`,
  `auto_generate boolean default true`, `generate_day text default 'sun'`, `email_audience jsonb default '{"source":"dssc_contacts"}'`,
  `sms_filters jsonb default '{}'` (EMPTY_FILTERS shape from campaign-audience, brand dssc), `notify_emails text[] default '{drew@drippingsportsclub.com}'`, `updated_at`, `updated_by`.
- `mkt_priorities`: `id bigserial`, `title text`, `notes text`, `lines text[]`, `weight int 1..5 default 3`, `starts_on date`, `ends_on date`, `channels text[] default '{social,email,sms}'`, `active bool default true`, `created_by`, `created_at`, `updated_at`.
  **Seed** (on conflict do nothing by title): "Thanksgiving break — push Camp Elevate" notes "Thanksgiving break (Nov 23–25): push Camp Elevate hard, plus the volleyball and basketball break camps/clinics. Camp Elevate is a full-day, every-sport camp — pick one day or all three." lines {camp_elevate,volleyball,basketball} weight 5, starts_on 2026-10-26, ends_on 2026-11-24.
- `mkt_items`: `id bigserial`, `week_of date` (Monday), `channel text check in ('social','email','sms')`, `platforms text[] default '{facebook,instagram}'` (social only), `line text`, `program jsonb` (`{id,name,url,first_date,status,sport}` or null), `programs jsonb default '[]'` (email: several), `reason text` (why the planner picked it, shown to Drew), `angle text` (starting_soon|new|just_started|evergreen|priority|reminder|last_call),
  `status text check in ('draft','approved','publishing','published','failed','rejected') default 'draft'`, `scheduled_at timestamptz`,
  `headline text`, `body text` (social caption / sms text / email plain-text), `email_subject text`, `email_preheader text`, `email_html text`, `cta_text text`, `cta_url text`, `hashtags text[] default '{}'`,
  `graphic jsonb` `{template:'photo'|'starts'|'list'|'countdown', format:'post'|'square'|'story'|'email', photo_url, photo_key, headline, accent, sub, tag, date_label, items:[string]}`, `asset_url text` (rendered PNG, set by the UI before approve), `asset_story_url text`,
  `audience jsonb` (sms: campaign-audience filters; email: `{source}`), `sms_campaign_id bigint`, `external_ids jsonb default '{}'` (`{facebook: postId, instagram: mediaId, email: {sent, failed}}`), `error text`,
  `revisions jsonb default '[]'` (`[{at, by, instruction, before:{headline,body,email_subject}}]`), `created_by text default 'auto'`, `approved_by text`, `approved_at timestamptz`, `published_at timestamptz`, `created_at`, `updated_at`.
- `mkt_photos`: `id bigserial`, `url text unique`, `source text` (site|upload|class), `key text`, `tags text[]`, `line text`, `alt text`, `width int`, `height int`, `active bool default true`, `used_count int default 0`, `last_used_at timestamptz`, `created_at`.
- `mkt_unsubscribes`: `email text primary key`, `created_at`.
- `mkt_log`: `id`, `at`, `item_id`, `kind text`, `detail jsonb`.
- Storage bucket `marketing` (public; png/jpeg/webp; 10 MB): read public; insert/update/delete for `is_dssc_director()`.

## shared/marketing-plan.js (BACKEND; pure ESM, no I/O; imported by API and UI)
- `LINES` (ordered `[{key,label,color}]`), `DEFAULT_WEIGHTS`, `DEFAULT_CADENCE`, `LINE_LINKS` (public page + booking URL per line), `lineOf(program)`, `mondayOf(dateStr)`.
- `signalsFor(programs, today)` → `[{line, program, angle, urgency 0..5, reason}]` (starts in 7–21 days → starting_soon; starts in ≤7 days → last_call; is_new or first_date within past 7 days → just_started; ongoing → evergreen).
- `planWeek({ weekOf, programs, priorities, settings, history })` → `{ slots: [{channel, platforms?, day:'YYYY-MM-DD', time:'HH:MM', line, program|null, programs?, angle, reason}], scores: {line: number}, notes: [string] }`.
  `history` = items from the previous 4 weeks (`{week_of, channel, line, status}`); rules: score = weight + active priority boosts (weight×2 for listed lines, during the window) + signal urgency − fatigue (lines used ≥2× in last 2 weeks) + rotation debt (lines unseen 3+ weeks get +2; parties/rentals/open_gym are evergreen and must appear at least every 3 weeks). Social slots = cadence.social.per_week spread over cadence days, highest-scoring lines first, no line twice in a row; email = 1 slot (featured line + up to 4 starting-soon programs + one evergreen); sms = only when a priority with sms channel is active or a last_call program exists, max cadence.sms.per_month per calendar month counting history.
- `planFlow({ startWeek, weeks: 6, programs, priorities, settings, history })` → `[{weekOf, lines:{line:count}, notes}]` — the multi-week rotation view for the Plan tab (deterministic, no AI).

## API (BACKEND) — `POST /api/marketing` (Bearer user JWT, directors only via `verifyDirector`), JSON `{action, ...}`
- `status` → `{ connections: { ai:bool, facebook:bool, instagram:bool, email:bool, sms:bool }, missing: {facebook:['META_PAGE_ID',…], …}, settings, priorities }`
- `programs` → the programs feed (server fetch, 5-min memo) + `signals`
- `plan {week_of}` → `planWeek` output (no writes)
- `flow {start_week}` → `planFlow` output
- `generate {week_of, replace_drafts?:bool, instruction?:string}` → plans the week, writes copy (AI or template fallback) and a graphic spec + photo pick per item, inserts `mkt_items` as drafts (deletes that week's untouched drafts first when `replace_drafts`); returns `{items}`.
- `revise {id, instruction}` → AI rewrites that item following the instruction; pushes old text to `revisions`; may change graphic headline/accent/photo; returns `{item}`.
- `brief {week_of, instruction}` → week-level ask ("more Reach, less volleyball", "push Camp Elevate harder"): stores it as a 1-week priority (title from instruction) and regenerates that week's drafts; returns `{items, priority}`.
- `update {id, patch}` (headline, body, email_*, cta_*, hashtags, graphic, scheduled_at, platforms, audience, asset_url, asset_story_url) · `approve {ids:[]}` (requires asset_url for social; sets approved/approved_by/at) · `unapprove {id}` · `reject {id, reason}` · `delete {id}`
- `publish_now {id}` (approved item, ignores schedule) · `test {id, to?}` (email → the director's address; sms → test via `sms-campaigns` test path or direct sendOneSms to the director's phone; social → no-op returns preview)
- `photos_sync` → pulls photos.json into `mkt_photos` (upsert by url) · `settings_save {patch}` · `priority_save {priority}` · `priority_delete {id}`
- `GET /api/marketing-cron` (CRON_SECRET; vercel.json `*/15 * * * *`): publish due approved items (scheduled_at ≤ now): social → Meta Graph API (FB `POST /{META_PAGE_ID}/photos {url: asset_url, caption}`; IG `POST /{META_IG_USER_ID}/media {image_url, caption}` then `/media_publish {creation_id}`; Graph version env `META_GRAPH_VERSION` default `v21.0`; token `META_PAGE_ACCESS_TOKEN`); email → Resend batch (`/emails/batch`, ≤100/req) to the audience minus `mkt_unsubscribes`, `List-Unsubscribe` header + footer link `/api/marketing-unsubscribe?e=&t=` (HMAC with `MARKETING_UNSUB_SECRET` or CRON_SECRET), club address footer; sms → insert an `sms_campaigns` row (brand dssc, status scheduled, scheduled_at, body, filters from item.audience or settings.sms_filters) and store its id — the existing cron sends it. Also: once a day after 17:00 CT on `generate_day`, if `auto_generate` and next week has no items, generate next week and email `notify_emails` a digest ("12 drafts ready — approve in HQ" → `https://www.drippingsportsclub.com/hq/?view=dsscmarketing&week=YYYY-MM-DD`). Daily: `photos_sync`. `?dry=1` lists what it would do.
- `GET /api/marketing-unsubscribe?e=&t=` → records the unsubscribe, shows a tiny confirmation page.
- AI: `api/_lib/marketing-ai.js`, `@anthropic-ai/sdk` (installed), model **`claude-opus-5-5`**, `client.beta.messages.create` with `betas:["server-side-fallback-2026-07-01"]`, `fallbacks:"default"`, `output_config:{ effort:"medium", format:{ type:"json_schema", schema } }` (structured outputs — read `/tmp/claude-0/bundled-skills/2.1.308/e1c3f566ca272fa3c1f9bf2b00397e8f/claude-api/typescript/claude-api/tool-use.md` "Structured outputs" for the exact shape), system prompt = brand + facts rules + `settings.voice` with `cache_control:{type:"ephemeral"}`; **no temperature/top_p** (400 on this model); check `stop_reason === "refusal"` and fall back to template copy; never put `Date.now()` in the cached system block. Generate one week in a single call (all slots at once, JSON array) to keep it fast; `maxDuration` 120 for `api/marketing.js`.

## UI (FRONTEND) — `src/dssc/DsscMarketing.jsx`, view key `dsscmarketing`, label "Marketing", icon 📣, perm `dir`
Nav: add to the DSSC sections (e.g. a "Marketing" section or with Inbox), `ACTION_BADGES.dsscmarketing = "mktDrafts"` (count of `mkt_items` status draft for this + next week), pin first for directors after Inbox. App.jsx: import, mount gated on `isDsscDirector` like `dsscinbox`, add to `DSSC_VIEWS`, deep link `?view=dsscmarketing&week=YYYY-MM-DD`, badge loader like `inboxNew`.
Tabs (DS palette, inline styles, mobile-first — Drew approves from his phone):
1. **Approve** (default): week picker (← this week →), "Generate this week" / "Regenerate drafts", a week-level ask box ("Tell the machine what matters this week…" → `brief`), "Approve all ready". Items by day: platform icons, time (editable), line chip, the planner's `reason`, graphic preview (rendered client-side), editable headline/caption/CTA, hashtags; email: subject, preheader, rendered HTML preview (iframe srcdoc); sms: text + segments (`segmentsOf` from campaign-audience) + audience summary. Buttons: **Approve** (renders the graphic to PNG at full size → uploads to bucket `marketing` at `items/<id>/<timestamp>.png` → `update {asset_url}` → `approve`), Reject, **Ask for a change** (text → `revise`), swap photo (picker from `mkt_photos` filtered by line/tags), swap template, Test (email/sms), Publish now. Status chips for approved/published/failed with error text.
2. **Plan & flow**: 6-week matrix (lines × weeks, heat by count) from `flow`, line balance vs weights, live program signals list (starting soon / new / just started / last call) from `programs`, each with "Make a post" (creates a single draft via `generate` with instruction).
3. **Priorities**: list + editor (title, notes, lines multi-select, weight 1–5 slider, dates, channels, active). The seeded Thanksgiving priority shows here.
4. **Photos**: grid from `mkt_photos` with tag/line filters, "Sync from website", upload (to `marketing/uploads/…`, then insert `mkt_photos` source upload), toggle active, edit tags/line.
5. **Settings**: connections status with setup steps (from `status.missing`), cadence, line weights (sliders), brand voice notes textarea, auto-generate on/off + day, notify emails, SMS default audience (reuse campaign-audience filters minimal: categories + target).
`shared/marketing-graphics.js`: `renderGraphic(canvas, spec, {logoImg, markImg, photoImg})` + `loadImage(url)` (crossOrigin anonymous) + `ensureFonts()` (inject Google Fonts link for Barlow Condensed 800/900 + Schibsted Grotesk 400/700, await `document.fonts.load`). Formats: post 1080×1350, square 1080×1080, story 1080×1920, email 1200×630. Templates:
`photo` (full-bleed photo, dark bottom scrim, skewed lime tag top-left, huge uppercase headline with accent word, sub line, clipped-corner orange CTA bar, DSSC lockup bottom-right; 4QA mark next to it for basketball),
`starts` (photo top 58%, ink panel: big date block "NOV 23" in lime + program name + days/time),
`list` (ink background, headline, up to 4 rows "MON · Skill Lab 3–5th"),
`countdown` (photo + "3 DAYS" / "LAST CALL" orange burst for last_call/priority). Draw with canvas 2D only.
