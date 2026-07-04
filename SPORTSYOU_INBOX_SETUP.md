# SportsYou Coach-Comms Inbox — Setup (IMAP polling)

Tracks what coaches post to their teams on SportsYou, in one place, and nudges
coaches who've gone quiet. The DS Elite "house" account
(`sportsyou@dselitevolleyball.com`) is a member of every SportsYou team, so every
team post emails that mailbox. A scheduled job reads that mailbox over IMAP,
parses the posts, stores them, and shows them under **Operations → Coach Comms**.

```
SportsYou posts → house Gmail mailbox → /api/sportsyou-poll (every ~15 min, IMAP)
   → parse team+author+body → sportsyou_posts table → Coach Comms view
   + daily cron emails a "quiet teams" digest
```

## What's built & deployed in code
- **DB:** `sportsyou_posts` table (migration `20260704_sportsyou_inbox.sql`, already run).
- **Poller:** `api/sportsyou-poll.js` — reads unseen SportsYou email over IMAP, parses, stores, marks read.
- **Shared parser:** `api/_lib/sportsyou-parse.js` (19/19 unit tests) — matches each email to a real `practice_teams` name.
- **Reminders cron:** `api/sportsyou-reminders.js` — daily digest of quiet teams; optional direct-to-coach nudges.
- **UI:** Operations → **Coach Comms** — per-team "days since last post" (most silent first) + filterable message log.
- **Webhook (alternate ingestion):** `api/sportsyou-inbox.js` — only needed if you ever switch to push-based inbound email (see appendix).

## Your one-time setup

### 1. Confirm the house mailbox actually receives mail
`dselitevolleyball.com` is on Google Workspace. Make sure
`sportsyou@dselitevolleyball.com` is a **real mailbox or alias** in Google Admin,
and send it a test email to confirm it lands. (If it isn't real, SportsYou's
notifications are bouncing.)

### 2. Create a Google **App Password** for that account
The poller logs in over IMAP, which needs an App Password (not the normal login):
1. Sign in as `sportsyou@dselitevolleyball.com`.
2. Turn on **2-Step Verification** (required for App Passwords).
3. Go to **Google Account → Security → App passwords**, create one named "DS Elite poller".
4. Copy the 16-character password — you'll paste it into Vercel (step 3), not here.
> If "App passwords" is missing, your Workspace admin may need to allow it, or
> ensure IMAP is enabled (Gmail → Settings → *Forwarding and POP/IMAP* → **Enable IMAP**).

### 3. Set environment variables in Vercel (Project → Settings → Env Vars)
| Var | Required | Notes |
|-----|----------|-------|
| `GMAIL_USER` | ✅ | `sportsyou@dselitevolleyball.com` |
| `GMAIL_APP_PASSWORD` | ✅ | The 16-char App Password from step 2. |
| `CRON_SECRET` | ✅ | Long random string; protects the poll + reminder endpoints. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | ✅ (set) | Used by poller + cron. |
| `RESEND_API_KEY`, `DSE_FROM_EMAIL` | ✅ (set) | Used to send the digest/reminders. |
| `DSE_REPLY_TO`, `SPORTSYOU_DIGEST_TO` | optional | Reply-to / who gets the daily digest. |
| `SPORTSYOU_SILENT_DAYS` | optional | "Quiet" threshold, default `7`. |
| `SPORTSYOU_REMIND_COACHES` | optional | `true` = also email coaches directly. Leave off until you've eyeballed the digest. |
| `SPORTSYOU_FROM_MATCH` | optional | Sender substring to match, default `sportsyou`. |
| `SPORTSYOU_MAX_FETCH` | optional | Max emails per run, default `25`. |

### 4. Deploy
Commit + push (or `vercel --prod`). Crons register from `vercel.json` on deploy.

### 5. Make the poller run every ~15 min ⚠️ (plan note)
`vercel.json` schedules the poll for `*/15 * * * *`, **but Vercel's Hobby plan
only triggers crons once per day.** Options:
- **Vercel Pro** — the `*/15` schedule runs as written. Done.
- **Free external pinger** (works on any plan) — have [cron-job.org](https://cron-job.org)
  or a GitHub Actions schedule hit, every 15 min:
  ```
  GET https://<your-domain>/api/sportsyou-poll?token=<CRON_SECRET>
  ```
The daily reminder digest is fine on Hobby (it's meant to run once a day).

### 6. Test it
- **Locally, verify the mailbox creds before deploying** (from the repo, with the two
  values filled in):
  ```
  GMAIL_USER=sportsyou@dselitevolleyball.com GMAIL_APP_PASSWORD='xxxx xxxx xxxx xxxx' \
    node -e "import('imapflow').then(async({ImapFlow})=>{const c=new ImapFlow({host:'imap.gmail.com',port:993,secure:true,auth:{user:process.env.GMAIL_USER,pass:process.env.GMAIL_APP_PASSWORD},logger:false});await c.connect();const l=await c.getMailboxLock('INBOX');const u=await c.search({from:'sportsyou'},{uid:true});console.log('SportsYou emails visible:',(u||[]).length);l.release();await c.logout();}).catch(e=>console.error('FAILED:',e.message))"
  ```
  A count (even 0) means the credentials work. `FAILED:` means fix the App Password / IMAP.
- **After deploy**, trigger a run: `GET /api/sportsyou-poll?token=<CRON_SECRET>` →
  returns `{ scanned, inserted, matched, duplicates }`. Then check **Coach Comms**.

## How team matching works (and "Unmatched")
The parser scans each email's subject + body for any of your real team names
(`practice_teams.team_name`) and stores the longest match — normalizing spelling.
If no known team name appears, the post is stored as **Unmatched** (visible in the
log's team filter). Every email's key fields are saved to `raw_email`, so the
parser can be improved and history re-parsed later — nothing is lost.

## Turning on automatic coach reminders
Once the digest shows team↔coach matching looks right, set
`SPORTSYOU_REMIND_COACHES=true`. Coaches whose team is quiet 7+ days get a gentle
nudge (you're BCC'd). Coaches are matched to teams via
`practice_teams.head_coach` → `coaches.display_name`; if those don't line up the
coach just won't be emailed (they still appear in your digest).

## Limitation to know
This captures **team-wide posts**, not private coach→player DMs the house account
isn't part of — inherent to SportsYou, not something code can change.

---

## Appendix — alternate push-based ingestion (webhook)
If you ever prefer real-time push over polling, `api/sportsyou-inbox.js` accepts
inbound email (Resend Inbound JSON or generic). Point an inbound-email provider
at `POST /api/sportsyou-inbox?token=<SPORTSYOU_INBOX_TOKEN>` (set that env var).
Not needed while IMAP polling is in use.
