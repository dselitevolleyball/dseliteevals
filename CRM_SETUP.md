# DSSC CRM — spend, email segments, old lists

Everything lives in **DSSC → People**:

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
