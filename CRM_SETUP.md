# DSSC CRM — spend, email segments, old lists, campaigns

Everything lives in **DSSC → People**. Since v2 (Oct 29 2026) it has four tabs:

- **Pulse:** the club at a glance. It shows families, revenue, who can be texted or emailed, and
  where every family is in its lifecycle. It also lists **revenue ideas**: ready-made campaigns,
  each with its audience and a rough dollar figure.
- **People:** every family with its stage, what they have (open gym, privates, Reach, rentals…),
  how they answer texts and emails, and when they were last in. Click a family for its profile
  and timeline.
- **Segments:** the audience builder (below), now with the v2 filters.
- **Campaigns:** AI-written campaigns of one to three steps that land on the Marketing calendar.

Before v2:

- **Families:** the existing filter screen. Spend now includes Playbook purchases, and there's a filter for each mailing list.
- **Email segments:** build an audience from everything People knows, see the live count, and save it.
- **Marketing:** pick a saved segment as the audience of any email (each email's **To**, or **Settings → Weekly email goes to**).

```
Playbook registrations report (with prices) ─┐
Old mailing lists (Mailchimp, CC, sheets)  ──┼─► People ─► segment ─► Marketing email (Resend)
Playbook hourly sync · Upper Hand · DS Elite ─┘                         │
                         bounces / complaints / opens / clicks ◄─ Resend webhook
```

## One-time setup

1. **Migration:** `node scripts/run-sql.mjs migrations/20261025_dssc_crm_spend_segments.sql`
   (or paste it into Supabase → SQL Editor). It adds `dssc_purchases`, `dssc_segments`,
   `mkt_email_events`, and email status, lists and last-emailed/opened columns on `dssc_contacts`.
   It is safe to run twice. **Run it before deploying this code:** the email sender reads
   `email_status`.
2. **Resend webhook** (bounces and spam complaints switch an address off automatically):
   - Resend → Webhooks → Add endpoint `https://www.drippingsportsclub.com/hq/api/resend-webhook`.
   - Events: `email.bounced`, `email.complained`, `email.opened`, `email.clicked`.
   - Copy its signing secret (`whsec_…`) into the HQ Vercel env as **`RESEND_WEBHOOK_SECRET`**, then redeploy.
   - If Resend's delivery log shows 401s, add `?token=<the same whsec_ value>` to the endpoint URL.
3. **Opens and clicks:** Resend → Domains → your sending domain → turn on open and click
   tracking. This powers the "opened in 90 days" and "emailed but never opened" filters.
4. **Recommended:** send marketing from a subdomain, e.g. `news.drippingsportsclub.com`.
   - Add it in Resend, put its DNS records in GoDaddy, and set `DSSC_FROM_EMAIL` to
     `Dripping Springs Sports Club <hello@news.drippingsportsclub.com>`.
   - A bad blast then can't hurt the reputation of receipts and inbox replies on the main domain.
   - The **Resend Pro** plan (about $20/mo for 50,000 emails) covers several 4,000-family sends a month.

## Weekly: Playbook spend

1. In Playbook, go to **Reports → Registrations** and export (CSV) for the date range. The export
   needs the `invoice_number` and `registration_base_price` columns.
2. Upload it in **People → ⬆ Import CSV**.

Overlapping ranges are fine: a purchase is keyed by invoice × person × program, so re-importing
replaces it and never doubles it.

**What "spend" means:** the list price Playbook charged. A package's price arrives split across
its sessions and is added back up. Credits, discounts and refunds aren't in this export, so
treat spend as "what they signed up for", not net revenue.

**The export also fills gaps in People:** parent phones, kid birthdays and kid genders.

To pull it automatically instead (no weekly upload), the hourly Playbook sync needs this report's
export URL. Open the export in Playbook, copy the address it downloads from, and send it over.

## Old mailing lists

Upload any CSV with an email column in **People → ⬆ Import CSV**. HQ asks what to call the list
(e.g. "Mailchimp 2023").

- **Names and phones:** an existing family's name and phone are never overwritten. New addresses
  become families with source `list`.
- **Status columns:** a status saying unsubscribed / opted out goes to the unsubscribe list. One
  saying cleaned / bounced / invalid marks the address bounced. Neither is ever emailed.
- **Mailchimp exports:** each export is a separate file. A file named `…unsubscribed…` or
  `…cleaned…` is treated that way as a whole.
- **Big files** are uploaded in parts automatically.

## Sending to cold lists — warm up

Addresses from an old list that have never bought and never had an email from us count as
**new**. The segment builder shows how many there are.

- **Set a cap:** on an email (or in Settings), set **New addresses per send**. Start around 500,
  then 1,000, then 2,000 over a couple of weeks.
- **Why it matters:** bounces and complaints from a cold list are what get a domain throttled.
- **Automatic clean-up:** the webhook takes bounced and complaining addresses off as they happen.
- **A resumed send never goes past its cap.**

## Segments: what you can filter on

| | |
|---|---|
| **Took part in** | sport category (any of); program name contains; between dates |
| **Lapsed** | did something before, nothing since a date |
| **A kid in the family** | gender, age range, grade (Texas: K is 5 by Sept 1), DS Elite (member / not / National / Regional / Rise) |
| **Same kid** | when kid filters and program filters are both set, the same kid has to match both |
| **Spend** | at least / at most, ever / last 12 months / this year (Playbook purchases + Upper Hand orders) |
| **Customers** | customers only, or "never bought" (list / website addresses) |
| **Engagement** | opened in the last 90 days, or emailed but never opened |
| **Lists, tags** | old mailing lists, tags (include / exclude) |
| **Where** | town, zip codes |

The same engine (`shared/crm-segments.js`) gives the live count in People and picks the
recipients when the email sends, so the count you see is who gets it. A saved segment is
re-evaluated at send time.

## v2: profiles, intake, campaigns

### One-time setup

Run `migrations/20261110_crm_v2.sql`
(`node scripts/run-sql.mjs migrations/20261110_crm_v2.sql`, or paste it into the SQL Editor).
It is safe to run twice. It adds:

- `dssc_touches` (every time someone reached out);
- `interests` and `last_touch_at` on `dssc_contacts`;
- the intake triggers;
- the `dssc_sms_stats` / `dssc_email_stats` views;
- `crm_campaigns` and `mkt_items.crm_campaign_id`.

It also backfills everyone who has already filled a form, emailed info@ or opted in to texts.
**Run it before deploying the code:** the Marketing week planner reads `crm_campaign_id`.

### Everyone who writes in lands in People

Database triggers do this, so it doesn't depend on which page or function took the message:

| They… | Trigger | Logged as |
|---|---|---|
| fill a website form, or email info@ (a new thread) | `site_inquiries` insert | `form` / `email`, with what they asked about as an **interest** |
| reply on an existing info@ thread | `site_inbox_messages` (inbound) | `email` |
| sign up for club texts (/dssc-texts) | `sms_consents` (brand dssc) | `text_optin` |
| sign up for the newsletter | the subscriber sync | `newsletter` |

How the intake (`dssc_intake()`) treats each person:

- **Matching:** by email first, then by phone.
- **New people** become a family with source `inquiry` / `texts-form`.
- **Existing families:** a name, phone or email we already have is never overwritten. Only gaps
  are filled, and the touch is added to their timeline.
- **Test and spam:** test inquiries are skipped. Marking an inquiry **spam** removes its touch,
  and removes the person too if that inquiry was all we had on them.

### The profile (`shared/crm-profile.js`)

| | |
|---|---|
| **Stage** | Prospect (never bought) · New (first sign-up in 60 days) · Active (last 90 days) · Cooling (3–6 months) · Lapsed (6–12 months) · Lost (over a year). A booking ahead counts as now. |
| **Tier** | VIP (top 10% lifetime spend) · High (next 20%) · Regular · Light (bottom 30%) |
| **Buys** | purchase days in the last 12 months, and the usual gap between them |
| **Has** | open gym (member = paid in the last 35 days, otherwise lapsed), privates (and with which coach), Reach membership, court rentals, birthday party, camps, pods, DS Elite. Read from program names, so a program named differently in Playbook may need a pattern added to `PRODUCTS`. |
| **Texts** | can text / opted out / no phone; texts sent, replies; *answers* / *never answers* / *untested* |
| **Email** | ok / unsubscribed / bounced / none; opens and clicks (once Resend open tracking is on) |
| **Reached out** | forms, emails, opt-ins, with what they asked about |
| **Birthdays** | each kid's next birthday |

### New segment filters

Stage, tier, has / doesn't have (product), texts (can / answers / never answers), reached out,
asked about, a kid's birthday within N days, number of kids, purchases a year, hand-picked
families, and "no booking since" a date. A segment can be texted as well as emailed: the text
audience is the same families with a textable phone, minus opt-outs and "do not text".

### Campaigns

**Build one:** from a revenue idea, from a selection in People, or from a segment.

1. Choose **who**, the **goal** and the **offer**.
2. Choose **how and when:**
   - one email;
   - email, then a text on day 3;
   - email, a text on day 3, and a last-call email on day 7;
   - or one text.
3. Press **✨ Write it.** Claude writes every step in the club's voice from the Marketing
   settings. It keeps the offer, code and end date exactly as given.
4. Edit anything.
5. Press **Put it on the Marketing calendar.**

**On the calendar:**

- Each step becomes an ordinary draft in Marketing: a dedicated email at 7:30 or a text at
  10:30. Nothing goes out until it's approved there.
- A follow-up step only reaches families who **haven't booked since the campaign started**.
  This is re-checked when it sends.
- Editing a scheduled or live campaign refreshes its unsent drafts. A step that has gone out
  is locked.
- **Cancel** takes the unsent steps off the calendar.

**Results:** what each step sent, replies to its texts, and who in the audience booked within
45 days of the start, with what they spent.

**Offers:** offer codes aren't created automatically. Create the code (e.g. `COMEBACK50`) in
Playbook before the first step goes out. HQ reminds you when you schedule.

## Birthday emails (People → Birthdays)

Two automatic emails to the parent of every kid in People with a birthday on file:

| Email | When | Who | Offer |
|---|---|---|---|
| 🎉 **Party invite** | 75 days before the birthday | kids turning 3–13 | **BDAY50**: $50 off one party package. Once per customer; expires Dec 1, 2027. |
| 🎂 **Happy birthday** | on the birthday | kids turning up to 18 | **BDAY35**: $35 off anything. Once per customer; no expiration. |

**The party invite** shows the open party times for the weekends around the birthday. They come
live from Playbook's public party page, which lists the 12 and 20 kid packages:

- **Weekday birthday:** the weekend before and the weekend after.
- **Weekend birthday:** the weekend before and the birthday weekend itself.

It also shows party photos from the Marketing photo library (the `parties` line or tag).

**If Playbook has no party times set up yet** for those dates, the email doesn't say "booked". It
says "booking opens soon" and has a **Hold a date** button that replies to info@. Playbook's
party times currently only go to Dec 27, 2026. Add 2027 times in Playbook (the party packages'
schedule) so invites can show real times.

**Rules:**

- **Timing:** sent at 9am and 3pm Central. The 3pm run only picks up new ones and retries
  failures.
- **Never twice:** each email is claimed in `dssc_birthday_sends` before it goes, so no child
  gets the same email twice.
- **Twins** get one email.
- **One child on two parents' accounts** gets one email, sent to the parent seen most recently.
- **Left out:** families unsubscribed or bounced, staff and Playbook accounts, and test records.
- **Party invite only:** a family with a party already booked within 120 days of the birthday
  isn't invited.
- **Catch-up:** a kid added late still gets the party invite, up to 14 days after day 75.
  When the party invite is first turned on, kids whose day 75 was in the last two weeks get
  theirs on the next run.

**The Birthdays tab:**

- Each email has an **On/Off** switch, and both start off.
- **Send me a preview** builds the next real email and sends it to you, marked [Preview].
- You can edit ages, days, amounts and codes.
- **Next 30 days** shows who gets what and when. **Skip** stops one of those emails.
- **Sent lately** shows what went out.

**Setup:** run `migrations/20261111_dssc_birthdays.sql`. The codes must exist in Playbook.

## Files

| File | What it does |
|---|---|
| `migrations/20261025_dssc_crm_spend_segments.sql` | schema |
| `api/_lib/dssc-crm.js` | `importPlaybookSpend`, `importMailingList` (plus the existing loaders) |
| `api/dssc-crm-import.js` | upload routing |
| `shared/crm-segments.js` | segment engine |
| `api/_lib/marketing-publish.js` | `emailAudience` (segments, suppression, cold cap); sends tag each message `mkt_item` and stamp `last_emailed_at` |
| `api/resend-webhook.js` | bounces, complaints, opens, clicks |
| `src/dssc/DsscCrm.jsx` | the People screen |
| `src/dssc/DsscCrmSegments.jsx` | the segment builder |
| `src/dssc/DsscEmailAudience.jsx` | the audience picker in Marketing |
| `scripts/test-crm.mjs` | offline tests: `node scripts/test-crm.mjs` |
| `migrations/20261110_crm_v2.sql` | v2 schema, intake triggers, stats views, campaigns, backfill |
| `shared/crm-profile.js` | the profile: stage, tier, products, texts / email, birthdays |
| `shared/crm-ideas.js` | revenue ideas, typical prices, offer wording |
| `api/_lib/crm-campaigns.js`, `api/crm-campaigns.js` | campaign drafting (Claude), scheduling onto the calendar, results |
| `src/dssc/DsscCrmPulse.jsx`, `src/dssc/DsscCrmCampaigns.jsx` | the Pulse and Campaigns tabs |
| `scripts/test-crm-v2.mjs` | offline tests: `node scripts/test-crm-v2.mjs` |
| `migrations/20261111_dssc_birthdays.sql`, `api/_lib/dssc-birthdays.js`, `api/dssc-birthdays.js`, `src/dssc/DsscCrmBirthdays.jsx` | birthday emails |
| `scripts/test-dssc-birthdays.mjs` | offline tests: `node scripts/test-dssc-birthdays.mjs` |
