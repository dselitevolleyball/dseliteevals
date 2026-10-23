# DSSC Marketing Machine — one-time setup

**DSSC HQ → Marketing** plans the club's marketing from the live programs feed.
It drafts Facebook + Instagram posts, a weekly email and an occasional text,
balances them across the program lines, and builds the graphics from the photo
library. A director edits, asks for changes or approves. Approved items go out
on schedule. **Nothing is published until a director approves it.**

```
programs feed + priorities + settings ─► planner (shared/marketing-plan.js) ─► Claude writes the copy ─► drafts (mkt_items)
director in HQ: edit / "ask for a change" / Approve (renders the PNG, uploads it) ─► status approved
/api/marketing-cron (every 15 min): due + approved ─► Facebook · Instagram · email (Resend) · text (sms_campaigns ─► texts cron)
Sunday after 5 pm CT: next week's drafts are made and you get a "drafts ready" email
```

## What Drew does once

### 1. Run the migration (after the inbox one)
```
node scripts/run-sql.mjs migrations/20261022_marketing.sql
```
This creates the `mkt_*` tables, the public storage bucket `marketing` and the
policies (directors only, via `is_dssc_director()`). It also seeds the settings
and the **Thanksgiving break — push Camp Elevate** priority. It's safe to run twice.

Then the second one (the weekly rhythm and the AI photo library):
```
node scripts/run-sql.mjs migrations/20261023_marketing_rhythm_photos.sql
```
It adds the photo librarian's columns to `mkt_photos` (description, people, setting, uses,
quality, kids visible, release OK), `kind` and `theme` to `mkt_items`, and `themes` to
`mkt_settings`. Photos already on the club website are marked release OK. Also safe to run twice.

### 2. Claude
`ANTHROPIC_API_KEY` is already set for other features, so there's nothing to do.
Without the key, drafts still get made from plain templates.

### 3. Facebook + Instagram (Meta)
1. The Instagram account has to be a **professional** (business or creator) account, **linked to the
   club's Facebook Page**. To check: Meta Business Suite → Settings → Accounts → Instagram accounts.
2. Go to developers.facebook.com → **My Apps → Create app** (type *Business*), and attach it to the
   club's business portfolio. Add the products **Facebook Login for Business** and **Instagram**
   (Instagram API with Facebook Login).
3. Open **Tools → Graph API Explorer** and pick your app. Click *Get User Access Token* with these
   permissions: `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `instagram_basic`,
   `instagram_content_publish`, `business_management`. Approve them for the club's Page and its
   Instagram account.
4. Make the token long-lived. Paste it into the **Access Token Debugger** → *Extend Access Token*.
   Then call `GET /me/accounts` with the long-lived user token. The `access_token` next to the club's
   Page is a **Page token that doesn't expire**. That token is `META_PAGE_ACCESS_TOKEN`, and the
   Page's `id` is `META_PAGE_ID`.
5. Call `GET /{META_PAGE_ID}?fields=instagram_business_account`. The `id` that comes back is
   `META_IG_USER_ID`.
6. While the app is in Development mode, your own admin account can post to your own Page and
   Instagram, which is all this needs. You don't need App Review.

The Page token stops working if you change your Facebook password or remove the app. When that
happens, Marketing → Settings shows Facebook/Instagram as not connected; repeat steps 3–5.

### 4. Email
- `DSSC_FROM_EMAIL` = `Dripping Springs Sports Club <info@drippingsportsclub.com>`. drippingsportsclub.com is
  verified on the DSSC Resend account, so mail from it goes out with `DSSC_RESEND_API_KEY`
  (api/_lib/resend-key.js picks the key by the From domain). Replies to marketing email go to info@, which lands in the shared Inbox.
- Set **`MARKETING_UNSUB_SECRET`** to a long random string (`openssl rand -hex 32`). It signs
  every email's unsubscribe link. Don't change it later, or links in emails already sent stop working.
- The audience is every `dssc_contacts` row with an email, minus anyone who unsubscribed
  (`mkt_unsubscribes`). For a soft launch, set Settings → email audience to `{"source":"directors"}`
  so only the directors get it.

### 5. Texts
These already work through the DSSC Twilio number (`DSSC_TWILIO_FROM_NUMBER`). An approved text
becomes a scheduled campaign in **DSSC Texts → Campaigns**, and the existing texts cron sends it.
Opt-outs, STOP and do-not-text work exactly as they do for any campaign. Every marketing text
ends with "Reply STOP to opt out." By default it goes to parents (the campaign audience in
Settings). There are at most 2 texts a month.

### 6. Environment variables — HQ Vercel project (dseliteevals)
| Var | Required | What it is |
|-----|----------|------------|
| `META_PAGE_ACCESS_TOKEN` | for social | The long-lived Page token (step 3) |
| `META_PAGE_ID` | for Facebook | The club Page's id |
| `META_IG_USER_ID` | for Instagram | The Instagram business account id |
| `MARKETING_UNSUB_SECRET` | for email | Signs unsubscribe links (falls back to `CRON_SECRET`) |
| `META_GRAPH_VERSION` | no | Default `v26.0` |
| `MARKETING_PUBLIC_BASE` | no | Where the unsubscribe link points; default `https://www.drippingsportsclub.com/hq` |
| `DSSC_FROM_EMAIL` | for email | `Dripping Springs Sports Club <info@drippingsportsclub.com>` (sent with `DSSC_RESEND_API_KEY`) |
| `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `DSSC_RESEND_API_KEY`, `CRON_SECRET`, `TWILIO_*`, `DSSC_TWILIO_FROM_NUMBER` | — | Already set |

Redeploy after you add them. **Marketing → Settings** lists anything still missing.

## How it runs
- **Every Sunday after 5 pm CT** (Settings: auto-generate, day): if next week is empty, the machine
  drafts it and emails `notify_emails` "N drafts ready — approve in HQ" with a link to that week.
  You can also press **Generate this week** at any time.
- **The weekly rhythm** (Settings → Weekly rhythm, "Follow our calendar") comes from the club's
  marketing calendar (Annual_Marketing_Table.xlsx):
  | Day | What | Platforms |
  |-----|------|-----------|
  | Mon | Basketball post | Facebook + Instagram |
  | Tue | Follow-up story: Monday's line broken out program by program | IG + FB stories |
  | Wed | Reach / birthday parties / Camp Elevate / rentals / open gym — the best of them that week | Facebook + Instagram |
  | Thu | Volleyball post | Facebook + Instagram |
  | Fri | Follow-up story on Thursday's volleyball | IG + FB stories |
  | Last Sat of the month | "Coming in <next month>" preview post | Facebook + Instagram |
  Posts go out at 6:30 pm. Each day can list several lines (the machine picks the best that week) or
  none (any line); days can be added, removed or changed in Settings, and "Reset to the club
  calendar" puts this table back. An active priority of weight 4–5 gets its line onto a day that
  lists it, or takes over the weakest day when none does; "less X" in the week's note opens X's day
  to the other lines. **Balance automatically** is the old layout (N posts on chosen days, the
  best-scoring lines first).
- **Email:** the weekly roundup ("what's happening now + what's coming") on Tuesday 7:30 am, plus
  **dedicated emails** on one line each — a priority's line (its own email at most every 2 weeks), or
  the next line due from Settings → Dedicated emails (default birthday parties and Reach, about once a
  month each), at most 2 a month, on Fridays. The roundup never leads with the dedicated email's line.
- **Content ideas** (Settings → Content ideas): every post carries an idea for its line, rotating
  week to week — "Sell the why of 3v3", "POV: you're a kid at a DSSC birthday party", "Break it out by
  who it's for"… taken from the calendar's notes. Write your own per line to replace them. Claude
  uses the idea as the angle; facts still come only from the programs feed.
- **Scoring:** each line has a weight (Settings) and gets a boost from active priorities (the first
  line listed gets the most) and from program dates (last call, starting soon, new, just started).
  Lines that were posted a lot recently score lower; a line unseen for 3+ weeks scores higher. Camp
  Elevate is only posted before a camp starts. At most 2 texts a month (only for a priority starting
  within 2 weeks, or a last call).
- **Photos** (Marketing → Photos): drag photos in (or Upload). Each one is scaled down, stored with a
  permanent public link, and sorted by Claude: program line, tags, a searchable description, what it's
  good for (post, story, email banner, website hero, program card), quality 1–5, and whether kids can
  be recognized. Photos with recognizable kids show **kids — release?** until a director presses
  *Release OK* or *Don't post publicly*; the machine never uses a "don't post" photo. Search ("girls
  volleyball action"), filter by line, tag, use, shape and quality, then **Copy link**, **Download** or
  **Copy for website** (an `<img>` tag with the alt text) to use a photo in an email, on the website or
  on a Playbook program page. The machine prefers high-quality photos, tall ones for stories and wide
  ones for email banners. Photos nobody has sorted yet (e.g. the website's) are sorted by the cron, 6
  every 15 minutes — or press **Sort N with AI**.
- **Your input:** "Tell the machine what matters this week…" saves your note as a one-week priority
  (e.g. "more Reach, less volleyball") and redrafts that week's untouched drafts. **Ask for a change**
  on one item has Claude rewrite just that item. Anything you edited by hand is never replaced.
- **Approve:** HQ renders the graphic, uploads it, then approves. If you edit an approved item, it
  goes back to draft so it has to be approved again. Changing only the time keeps it approved.
- **Publishing:** the cron runs every 15 minutes and publishes approved items once their time has
  come. **Publish now** skips the wait. If a platform fails, the item shows *failed* with the reason.
  Publishing it again posts only to the platforms that didn't go out.
- Copy rules: no prices, no "spots left", no made-up facts, never the Flex. Links always come from the
  feed or the club's pages. If Claude breaks a rule, that item falls back to template copy.

## Rules (Marketing → Rules)
Run once: `node scripts/run-sql.mjs migrations/20261027_marketing_rules.sql` (adds `mkt_settings.rules`).
- Standing rules in plain words, e.g. "Don't combine sport programming and birthday parties". Every
  writer follows them: weekly drafts, rewrites, ideas, reels and spotlight drafts.
- When a rule keeps programs apart, Claude reads which ones when you add it, and you can adjust them with
  the chips. The planner then enforces it (`shared/marketing-rules.js`):
  - the weekly roundup's programs and closing line, and the month preview's list, never mix the two sides;
  - copy that mentions the other side is refused, and the plain template is used instead;
  - reels: clips you pick that mix them are refused, and "Best of" keeps to one side.
- After a change, the tab lists upcoming items that break a rule. **Redo N drafts** removes those drafts
  and drafts just those slots again. Approved items are only listed: unapprove them first.
- Offline checks: `node scripts/test-marketing-rules.mjs`.

## Ideas and "Meet the Coaches" (Marketing → Ideas)
Run once (after the other two marketing migrations):
```
node scripts/run-sql.mjs migrations/20261024_marketing_ideas_spotlights.sql
```
- **The idea scout** (`api/_lib/marketing-scout.js`) suggests 5–7 posts the weekly rhythm wouldn't make
  on its own: holidays and school breaks (`shared/marketing-seasons.js`), the season, what's on around
  Dripping Springs (a web search - community events, the ISD calendar, local teams' big moments; a
  local idea is only kept when search actually found it, and links its source), the club's own news,
  and just-for-fun formats. Each idea has a pitch, a hook ("POV: your setter is a T. rex"), a line, a
  format and a best day. It runs every **Saturday morning** (Settings → Flair and the idea scout) and
  emails `notify_emails` with a **Make this post** button per idea; in HQ there's **Get fresh ideas** and
  **Ask the scout** ("something fun for Halloween").
- **Make it** turns an idea into a draft on its best day (it still needs approving). **Not this** asks
  why ("Not our vibe", "Wrong timing"…); the reasons go into the next run, so the scout learns.
- **Meet the Coaches** (`api/_lib/marketing-spotlight.js`): every 2 weeks (Settings) the scout lines up
  the next person - the line featured longest ago, nobody spotlighted in the last 6 months, from the
  directors, logins with a DSSC role and DSSC people - and Claude writes 6–8 questions. You check them
  and press **Send** (or **Send the interview** in the ideas email). The coach gets an email and a text
  with their own page (`www.drippingsportsclub.com/hq/api/spotlight-form?t=…`): answer the questions,
  add up to 8 photos (phones' HEIC is converted to JPEG on the phone), tick "OK to share". No answer in
  3 days → one reminder. Within 15 minutes of an answer the cron drafts a **quote post** (their photo +
  their own words - Claude may tidy, never add facts; a quote that isn't theirs is replaced), a
  **story**, and the **"Meet the Coaches #n" email** (the Q&A), and emails you to review them. Their photos
  join the photo library. Answers that came back by text? **Type in answers** on the spotlight.
- **One-tap buttons** in these emails are signed and expire after 7 days. Each opens a "Yes, do it"
  page, so a mail scanner opening the link can't post anything or text a coach.
- **Flair** (Settings): Plain · Some personality (default) · Bold & fun. It shapes every draft and idea;
  the facts rules never bend.
- Offline checks: `node scripts/test-marketing-ideas.mjs` (scout, spotlights, the coach page, one-tap
  links, the cron steps - Claude, Resend and Twilio stubbed).

## Videos and reels (Marketing → Videos)
Run once (after the ideas migration):
```
node scripts/run-sql.mjs migrations/20261025_marketing_video.sql
```
- **Storage.** Raw videos go to the private `marketing-video` bucket with resumable uploads (6 MB
  chunks, so a dropped gym-wifi connection picks up where it left off). Supabase's **free plan caps
  every file at 50 MB and the project at 1 GB**, which is less than a minute of glasses video. Upgrade
  the HQ Supabase org to **Pro** (Dashboard → Organization → Billing), then raise the per-file limit.
  Claude can do it, or run:
  ```
  curl -X PATCH "https://api.supabase.com/v1/projects/tbkogifobjjlnvcxagpk/config/storage" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
    -d '{"fileSizeLimit": 2147483648}'
  ```
  Until then, an upload over the limit says "upgrade Supabase". Rendered reels (around 10–20 MB) go to the
  public `marketing` bucket.
- **Upload** from a phone or computer: drag files in, or tap **Upload videos**. Each video is sorted
  within about a minute (`api/_lib/marketing-video.js`, ffmpeg on Vercel). Frames every half-second
  (fewer for long videos) become contact sheets, and Claude picks the 3–8 best moments with a score and a label, guesses the line,
  and flags kids who can be recognized. If you leave the page, the cron finishes the sorting.
- **Kids.** A video with recognizable kids shows "kids — release?". **Don't post publicly** keeps it out
  of every reel, the same as the photo release flag.
- **Make a reel.** You can tick moments across any videos and press **Make a reel from N**, use **Make a
  reel from this video**, or use **Best of the last 3 weeks**. Claude orders the clips (strongest first, a
  smile at the end) and writes the headline, caption and hashtags. Clips are at most 5 s each and 30 s in
  total, with an intro card, the words over the first clip, and the end card.
- **In Approve**, a reel shows its cut. You can nudge in/out points, reorder, remove or add clips, edit the
  words, set the original-sound and music volumes, then **Render the reel**: the cards are drawn in the
  browser and the server cuts a 1080×1920 H.264 MP4. Approving renders it first if needed. It posts as an
  **Instagram Reel** (shared to the feed, with the intro card as the cover) and a **Facebook video**. If
  Instagram is still processing, the cron finishes the post on its next run, and nothing is posted twice.
- **Music library.** Only tracks the club has the rights to use (royalty-free or a licence such as
  Epidemic Sound or Artlist). Adding one requires ticking the rights box. Instagram's in-app music can't
  be added to posts made through the API. The machine picks a track by mood, and you can change it per reel.
- **The scout** suggests "Cut a reel from the new videos" when videos have come in since the last reel.
  **Cut the reel** in the email makes the draft.
- Offline checks: `node scripts/test-marketing-video.mjs` (real ffmpeg: probe, sorting, the cut, the
  render, Reels publishing, the scout's reel idea - Claude and Meta stubbed).

## Testing it safely
- Use **Test** on an email to send it to yourself with `[TEST]` in the subject. Test on a text sends
  it to your phone. Test on a post shows the exact caption and image without posting.
- Use a dry run of the cron to see what it would publish, auto-generate and sync, without sending
  or writing anything:
  ```
  curl -H "Authorization: Bearer $CRON_SECRET" "https://dseliteevals.vercel.app/api/marketing-cron?dry=1"
  # pretend it's Sunday evening to check auto-generate:
  curl -H "Authorization: Bearer $CRON_SECRET" "https://dseliteevals.vercel.app/api/marketing-cron?dry=1&at=2026-11-08T23:30:00Z"
  ```
- Offline checks (no credentials needed; they only read the public programs feed):
  ```
  node scripts/test-marketing-plan.mjs      # the planner on the live feed
  node scripts/test-marketing-backend.mjs   # copy, generate, cron, publish, API (all stubbed)
  ```
