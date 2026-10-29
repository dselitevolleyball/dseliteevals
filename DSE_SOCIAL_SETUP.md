# DS Elite Social: setup

**HQ → Talk to people → Social** makes posts for **DS Elite Volleyball's** Facebook Page and
Instagram from two things the club already has:

1. **Family photo uploads** (`/photos`). New photos are grouped by team, event and day. Once a
   batch has 3+ photos (Settings) and nobody has added to it for 2 hours, Claude looks at every
   photo, leaves out anything that shouldn't be on a public page (swimwear, pools and hot tubs,
   bedrooms, blurry shots, screenshots, anyone upset), picks the best and chooses a **collage**,
   a **carousel** (several photos in one post) or a **single photo**. It writes the caption without
   ever naming a player. The graphic is drawn in DS Elite's black and pink.
2. **Coach intro surveys.** HQ emails and/or texts a coach their own page with a few questions,
   a photo upload and "OK to share". When they answer, Claude makes a **"Meet the Coach" poster**
   from their own words (the quote must be something they actually wrote), plus a caption.

Every draft comes to you as a **Slack DM with the picture, the caption and Approve & post / Skip**,
and it's in HQ → Social to edit: the caption, the hashtags, the photo order, collage or carousel,
Facebook and/or Instagram, and the planned time. **Every draft is planned for the next free
evening** (6:30 pm Central, one DS Elite post a day, so a week of drafts becomes a week of posts).
Approving it keeps that time; **Post now** sends it straight away. **Nothing posts without an
approval.**

**Already posted?** The club also posts family photos by hand. Before a batch becomes a draft,
every photo is compared with DS Elite's Facebook and Instagram from the last 75 days
(`api/_lib/dse-social-feed.js`: a visual fingerprint, so a resized copy still matches). A photo
already there is recorded as used, under an "already on Facebook" entry in Posted linked to that
post, and left out. On the first scan (Oct 29 2026) it found 94 of 151 uploads already posted,
with no false matches. Near-blank images (screenshots, text slides) are never matched.

```
/photos uploads ──► cron (every 15 min): batch quiet 2 h ──► Claude picks + caption ──► render ──► Slack DM ─┐
coach survey ─────► answered ──► Claude poster copy + photo ──► render ──► Slack DM ───────────────────────┤
                                                                         Approve (Slack or HQ) ──► Facebook + Instagram
```

## 1. Run the migration
```
node scripts/run-sql.mjs migrations/20261109_dse_social.sql
```
This creates `dse_social_posts`, `dse_coach_intros`, `dse_social_settings` and the public
`dse-social` storage bucket. Only the picked photos (cropped copies) and the rendered graphics go
in that bucket; the family uploads stay private. It also adds `player_photos.social_hidden` and
`players.no_social` (a family that asked not to be posted). It's safe to run twice.

## 2. The Facebook app: use the one the club already has

The club already has a Meta app, **"DSSC HQ"**, and it posts to the DSSC Page today. A Meta app
can post to any Page its admin manages, so DS Elite doesn't need a second app. It only needs
DS Elite's Page connected to that app.

**Before you start:**
- Your Facebook login must be an **admin of the DS Elite Volleyball Page** (Page → Settings →
  Page access, or Meta Business Suite → Settings → People).
- To post to Instagram too, DS Elite's Instagram must be a **professional** (business or creator)
  account **linked to the DS Elite Page**. To check: Meta Business Suite → Settings → Accounts →
  Instagram accounts.

**In the app** (developers.facebook.com → My Apps → DSSC HQ). You might rename it under App
settings → Basic → Display name, e.g. "Club HQ", since it now posts for both clubs.

1. **App settings → Basic:** copy the **App ID** and the **App Secret** (press Show).
2. **Facebook Login for Business → Settings → Valid OAuth Redirect URIs:** add
   `https://dseliteevals.vercel.app/api/dse-social-connect` and save. If the app has no
   Facebook Login product yet: Add product → Facebook Login for Business.
3. **Facebook Login for Business → Configurations → Create configuration:**
   - Name it "HQ posting".
   - Choose **User access token**.
   - Assets: **Pages** and **Instagram accounts**.
   - Permissions: `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`,
     `instagram_basic`, `instagram_content_publish`, `business_management`.
   - Copy the **Configuration ID**.
4. In the **HQ Vercel project** (dseliteevals) → Settings → Environment Variables, add these
   (Sensitive, Production):

   | Var | Value |
   |-----|-------|
   | `META_APP_ID` | the App ID |
   | `META_APP_SECRET` | the App Secret |
   | `META_LOGIN_CONFIG_ID` | the Configuration ID (leave it out if the app uses classic Facebook Login, which takes the permissions list instead) |

   Then redeploy.
5. **HQ → Social → Settings → Connect Facebook.** Facebook asks which Pages and Instagram accounts
   to allow: tick **DS Elite Volleyball** and its Instagram. HQ then lists your Pages with DS
   Elite's first; pick it. HQ keeps a Page token that **doesn't expire**, in `mkt_secrets`
   (service role only). **Check the connection** confirms the Page, the Instagram account and the
   permissions.

The app can stay in **Development mode**: an app's own admins can post to the Pages they manage
without App Review. The DSSC connection (`META_PAGE_ACCESS_TOKEN`) is separate and unchanged.

**No app secret? Paste instead.**
1. In Graph API Explorer, pick the app and use *Get User Access Token* with the permissions above.
2. Extend it in the Access Token Debugger (*Extend Access Token*).
3. Paste it under Settings → "Or paste a token" and pick the Page.

A Page token pasted directly is saved as is.

**If you'd rather have a separate DS Elite app:**
1. developers.facebook.com → Create app → type **Business**, attached to DS Elite's business
   portfolio.
2. Add **Facebook Login for Business** and **Instagram** (Instagram API with Facebook Login).
3. Then do steps 1–5 above with its ID and secret.

The token stops working if you change your Facebook password or remove the app; Settings then
shows it as not connected. Press Connect Facebook again.

## 3. Slack
The approvals come from the HQ Slack bot, the same one as the Product board. It's already set up
(Product → Settings), and its Interactivity URL (`/api/product-slack`) also handles these buttons.
**Settings → Approvals go to** lists who gets the DM, by email (default: Drew). Only Drew and HQ
admins can press Approve. When a post is decided in HQ, the Slack DM updates to say so, and a
posted one links to Facebook and Instagram.

## 4. Coach intro surveys
**Social → Coach intros** lists every coach (`coach_roster`) with their teams this season.
1. Tick coaches and pick Email and/or Text, then press **Send**.
   - Email goes from `DSE_FROM_EMAIL` and replies go to Drew.
   - Texts go from DS Elite's Twilio number; replies land in DS Elite Texts.
2. Their page is `dseliteevals.vercel.app/coach-intro?t=…`.
   - The questions are in Settings, one per line.
   - Photos are shrunk on the phone (iPhone HEIC included) before they upload.
   - "OK to share" is required.
3. If there's no answer in 3 days, one reminder goes out. Within 15 minutes of an answer, the
   poster draft arrives in Slack.

Other actions:
- **Type in answers** handles answers that came back by text. It counts as their OK to share.
- **Make it again** redraws a poster.
- **Edit the poster's words** on the draft changes the headline, the quote or the facts, then
  redraws it.

Preview the survey page: `https://dseliteevals.vercel.app/coach-intro?preview=1`.

**Files it can't open:** empty files (an upload that never finished) and iPhone HEIC photos saved
as ".jpeg" are set aside. Each file is checked by its first bytes before it's opened, because a HEIC
crashes the image decoder.

## 5. Kids' privacy
- **Claude is told to reject when unsure.** Anything a parent could reasonably not want public is
  left out, and it's fine for Claude to reject a whole batch. The draft shows which photos it left
  out and why.
- **Captions never name a player**, even when a family's upload note does.
- **Families who asked not to be posted** (Photos tab → "Families who asked not to be posted"):
  none of their uploads are ever picked. The upload page already tells families to ask, and this
  is where that request is honoured.
- **🚫 on a photo** keeps that one photo out.
- **Every post is approved by a person** before it goes out.

## How it runs
- **Instagram** goes to whichever Instagram is linked to the Page. If posts land on the wrong
  account, turn Instagram off in Settings, link the right account to the Page (Meta Business Suite
  → Settings → Accounts → Instagram accounts), press Connect Facebook again, check that Settings
  shows the right @handle, and turn Instagram back on.
- **`/api/dse-social-cron`** runs at :07, :22, :37 and :52 past the hour. Each run:
  1. posts approved posts whose time has come (and retries any stuck one);
  2. sends 3-day reminders;
  3. turns new answers into posters (two a run);
  4. every half hour, turns quiet photo batches into drafts (two a run).

  A photo is only ever considered once: each one is stamped with the post it went into, or 0 if
  nothing in its batch was usable.
- **If a platform fails** (e.g. Instagram is still processing), the post shows Failed with the
  reason. **Try posting again** only posts to the platform that didn't go out, so nothing is
  posted twice.
- **No Instagram linked:** posts go to Facebook only, and the post says so.
- **Photos tab:**
  - Waiting batches.
  - **Preview with Claude:** what Claude would pick and why, with nothing saved or sent.
  - **Make the draft** now.
  - Hand-pick up to 20 photos and **Make a post from N**.
- **Settings:**
  - Auto-drafting on or off and the batch size.
  - Facebook and/or Instagram.
  - Approvers, standard hashtags, the intro time and the survey questions.

Checks:
- Offline (no network or database; Facebook, Instagram, Slack and storage are stubbed):
  `node scripts/test-dse-social.mjs`.
- A dry run of the cron:
  `curl -H "Authorization: Bearer $CRON_SECRET" "https://dseliteevals.vercel.app/api/dse-social-cron?dry=1"`.
