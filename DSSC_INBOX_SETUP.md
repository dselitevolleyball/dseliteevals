# DSSC shared Inbox — one-time setup

One inbox for all the directors: every form on drippingsportsclub.com and every
email to **info@drippingsportsclub.com** becomes a thread in **DSSC HQ → Inbox**
(www.drippingsportsclub.com/hq). The right director is emailed with a link to
the thread; they reply from HQ (it goes out as the club, Reply-To info@), and the
family's answer lands back on the same thread. Nothing is lost in anyone's Gmail.

```
website form ──► POST /api/site-inbox (x-site-token) ──┐
mail to info@ ─► mailbox ─► /api/site-inbox-poll (IMAP, every 15 min) ──┤──► site_inquiries + site_inbox_messages
director reply ◄── /api/site-inbox-reply (Resend, Reply-To info@) ◄─────┘        ──► email the routed director(s), CC Drew
```

Routing (override any entry with env `DSSC_INBOX_ROUTES`, a JSON object of
sport/kind → comma list): volleyball → Hunter · basketball → Adrian + Jonathan ·
Reach → Brandon · rentals, parties, leagues, open gym, membership, plain contact
and email → Jonathan · Drew CC'd on everything. A thread that has an assignee
notifies only that director.

## What Drew does once

### 1. Run the migration
```
node scripts/run-sql.mjs migrations/20261020_site_inbox.sql
```
Adds the thread columns to `site_inquiries`, creates `site_inbox_messages`,
`is_dssc_director()` and the policies. Safe to run twice.

### 2. The mailbox the poller reads
info@ already delivers to your Gmail, so pick one:
- **Simplest:** use your own account. `DSSC_INBOX_IMAP_USER = drew@drippingsportsclub.com`
  plus an App Password for it. The poller only touches mail addressed to info@
  (To / Cc / Delivered-To), flags what it has taken with an IMAP keyword
  (`$DSSCInbox`) and marks it read; your other mail is never touched.
- **Cleaner:** make `info@drippingsportsclub.com` a real Workspace mailbox
  (Google Admin → Users → add user; move the alias off your account), sign in
  as it and use that login.

Either way, on that Google account: **Security → 2-Step Verification → on**,
then **Security → App passwords** → create one named "DSSC inbox" and copy the
16 characters (that is `DSSC_INBOX_IMAP_PASSWORD`). Check Gmail → Settings →
Forwarding and POP/IMAP → **IMAP enabled**.

### 3. Resend
`DSSC_FROM_EMAIL` must be an address on a domain verified in Resend, e.g.
`Dripping Springs Sports Club <info@drippingsportsclub.com>`.
drippingsportsclub.com is verified on the DSSC Resend account, so an
@drippingsportsclub.com sender goes out with `DSSC_RESEND_API_KEY`
(api/_lib/resend-key.js); other senders use `RESEND_API_KEY`. Without
`DSSC_FROM_EMAIL` the inbox borrows `DSE_FROM_EMAIL` under the club's name.

### 4. Environment variables — HQ Vercel project (dseliteevals)
| Var | Required | What it is |
|-----|----------|------------|
| `DSSC_SITE_TOKEN` | yes | A long random string (`openssl rand -hex 32`). The website sends it as `x-site-token`. |
| `DSSC_INBOX_IMAP_USER` | yes | The mailbox login from step 2. |
| `DSSC_INBOX_IMAP_PASSWORD` | yes | Its 16-char Google App Password. |
| `DSSC_FROM_EMAIL` | yes | The club's verified sending address (step 3). |
| `DSSC_INBOX_IMAP_HOST` | no | Default `imap.gmail.com`. |
| `DSSC_INBOX_ADDRESS` | no | Reply-To on replies, default `info@drippingsportsclub.com`. |
| `DSSC_INBOX_MATCH_TO` | no | Which addresses count as "the inbox", default info@ (comma list ok). |
| `DSSC_INBOX_ROUTES` | no | JSON overriding who gets what, e.g. `{"basketball":"adrian@4thquarterathlete.com","cc":"drew@drippingsportsclub.com"}`. |
| `DSSC_INBOX_MAX_FETCH`, `DSSC_INBOX_SINCE_DAYS`, `DSSC_INBOX_MARK_SEEN` | no | 25 mails per run · look back 14 days · mark read (1). |
| `CRON_SECRET`, `RESEND_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | already set | Used as before. |

### 5. Environment variable — website Vercel project (dssc-investor-network)
`HQ_INBOX_TOKEN` = the same value as `DSSC_SITE_TOKEN`. The site POSTs each form
to `https://dseliteevals.vercel.app/api/site-inbox` and, when HQ answers
`{ ok: true, emailed: true }`, sends no email of its own.

### 6. Deploy
Push; the `*/15 * * * *` cron for `/api/site-inbox-poll` registers from
`vercel.json` (the project is on a plan that already runs 5-minute crons).

## Test it

Intake (what the website sends):
```
curl -s https://dseliteevals.vercel.app/api/site-inbox \
  -H "content-type: application/json" -H "x-site-token: $DSSC_SITE_TOKEN" \
  -d '{"site":"dssc","kind":"rental","name":"Test Parent","email":"you@example.com","phone":"5125551234",
       "message":"Testing the inbox","details":{"date":"2026-11-01","time":"6-8pm","group":"12","sport":"volleyball","building":"Main"},"page":"/rentals"}'
# → {"ok":true,"id":123,"emailed":true}   Hunter + Drew get the email; the thread is in HQ → Inbox.
```

Mail in: send a message from a personal address to info@drippingsportsclub.com,
then run the poller by hand (or wait 15 minutes):
```
curl -s "https://dseliteevals.vercel.app/api/site-inbox-poll?token=$CRON_SECRET&dry=1"   # look, don't touch
curl -s "https://dseliteevals.vercel.app/api/site-inbox-poll?token=$CRON_SECRET"         # → { scanned, stored, newThreads, replies, notified }
```

Reply from the API (HQ's Send button does this with your session token):
```
curl -s https://dseliteevals.vercel.app/api/site-inbox-reply \
  -H "content-type: application/json" -H "authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -d '{"inquiry_id":123,"body":"Thanks - we have court space that night. What time works?"}'
```
The family receives it from DSSC_FROM_EMAIL with Reply-To info@; their answer
is picked up by the poller and appears on thread 123, which goes back to **New**.

## Day to day
- **DSSC HQ → Inbox.** New / Mine / Waiting / Done, sport chips, search. Open a
  thread, "I've got it", reply (four canned replies to start from), add an
  internal note, set the status. The nav badge counts threads nobody has taken.
- Answering from your own Gmail still works: CC info@ and the poller files your
  reply on the thread and marks it waiting on the family.
- Each director's notification email links straight to the thread
  (`/hq/?view=dsscinbox&inquiry=<id>`).
