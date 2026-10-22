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
- `DSSC_FROM_EMAIL` is already set and verified in Resend (the inbox uses it), and so is
  `RESEND_API_KEY`. Replies to marketing email go to info@, which lands in the shared Inbox.
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
| `META_GRAPH_VERSION` | no | Default `v21.0` |
| `MARKETING_PUBLIC_BASE` | no | Where the unsubscribe link points; default `https://www.drippingsportsclub.com/hq` |
| `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `DSSC_FROM_EMAIL`, `CRON_SECRET`, `TWILIO_*`, `DSSC_TWILIO_FROM_NUMBER` | — | Already set |

Redeploy after you add them. **Marketing → Settings** lists anything still missing.

## How it runs
- **Every Sunday after 5 pm CT** (Settings: auto-generate, day): if next week is empty, the machine
  drafts it and emails `notify_emails` "N drafts ready — approve in HQ" with a link to that week.
  You can also press **Generate this week** at any time.
- **Planning:** each line has a weight (Settings) and gets a boost from active priorities (the first
  line listed gets the most) and from program dates (last call, starting soon, new, just started).
  Lines that were posted a lot recently score lower. Parties, rentals and open gym each come up at
  least every 3 weeks. Camp Elevate is only posted before a camp starts. The default schedule is 4
  social posts a week (Mon/Wed/Fri/Sat 6:30 pm), the email on Thursday 7:30 am, and at most 2 texts a
  month (only for a priority starting within 2 weeks, or a last call).
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
