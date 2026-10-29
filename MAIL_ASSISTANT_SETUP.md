# Email assistant — setup

The assistant reads **drew@dselitevolleyball.com** and **drew@drippingsportsclub.com** every
5 minutes. When an email needs an answer, Claude drafts one, and the HQ Slack bot DMs it to Drew
with three buttons:

- **Send:** goes out from that Gmail, in the same thread, with their message quoted below.
- **Edit:** opens the draft in a box. Change it and press Send.
- **Skip:** no reply.

Replying **in that Slack thread** changes the draft:

- **Anything else** ("shorter", "say yes, Friday works") makes Claude rewrite it.
- **`reply: …`** replaces it with exactly what you write.
- **`send`** sends it, and **`skip`** skips it.

**Nothing is sent until Drew presses Send.** It also behaves like this:

- **Left alone:** newsletters, receipts, no-reply senders, automatic replies and Gmail's
  Promotions, Social, Updates and Forums tabs. These never go to Claude.
- **No reply needed:** Claude also skips thank-yous, FYIs and finished conversations.
- **Answered in Gmail first:** the Slack card changes to "Answered in Gmail".
- **Older mail:** mail from before a mailbox was connected is never drafted.

Only Drew can press the buttons; the API and Slack both check.

## One-time setup (about 10 minutes)

### 1. A Google OAuth client

Do this at [console.cloud.google.com](https://console.cloud.google.com), signed in as
drew@drippingsportsclub.com:

1. **Create a project:** project picker → New project → name it `DSSC HQ`.
2. **Turn on Gmail:** APIs & Services → Library → **Gmail API** → Enable.
3. **Set up the consent screen:** Google Auth Platform → Get started.
   - App name `DSSC HQ`, support email yours.
   - Audience: **External**. It has to be External because the two mailboxes are on different
     domains.
4. **Add the permissions:** Google Auth Platform → Data access → Add or remove scopes. Add:
   - `.../auth/gmail.modify`
   - `openid`
   - `.../auth/userinfo.email`
5. **Fill in Branding:** Google Auth Platform → Branding. Google won't publish without it.
   - App home page: `https://www.drippingsportsclub.com`
   - Privacy policy: `https://www.drippingsportsclub.com/privacy`
   - Authorized domains: `drippingsportsclub.com`
   - Developer contact: your email. Then Save.
6. **Publish the app:** Google Auth Platform → Audience → **Publish app** ("In production").
   - **Why:** while it says "Testing", Google cuts the access every 7 days.
   - **The warning screen:** since it's your own app and not reviewed by Google, you'll see
     "Google hasn't verified this app" when you connect. Click **Advanced → Go to DSSC HQ**.
     That's expected; it's limited to 100 users and only you use it.
7. **Create the client:** Google Auth Platform → Clients → Create client.
   - Type **Web application**.
   - **Authorized redirect URI:** `https://www.drippingsportsclub.com/hq/api/mail-connect`.
8. **Copy the keys:** copy the **Client ID** and **Client secret**.

### 2. Vercel

In Vercel, open the dseliteevals project → Settings → Environment Variables (Production):

1. Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
2. Redeploy, or tell Claude to.

### 3. Connect each Gmail

1. In HQ, open **Product → Settings → Email assistant**.
2. Press **Connect** next to a mailbox.
3. Sign in as **that** account, then click through the "unverified" screen.
4. Allow Gmail access.
5. Repeat for the other mailbox.

**If Google Workspace blocks it:** in Google Admin (admin.google.com) for that domain, open
Security → API controls → App access control → Manage third-party app access. Add the app by its
**Client ID** and set it to Trusted. Then connect again.

### 4. Slack (for thread replies)

The buttons already work through the HQ Slack bot. For **replies in the thread** to rewrite a
draft, the Slack app needs one more event:

1. Go to api.slack.com → your HQ app → Event Subscriptions → Subscribe to bot events.
2. Add **`message.im`**.
3. Save, and reinstall the app if Slack asks.

## Files

| File | What it does |
|---|---|
| `migrations/20261112_mail_assistant.sql` | `mail_accounts` (tokens, server only), `mail_drafts` |
| `api/_lib/mail-assistant.js` | Google sign-in, Gmail read and send, filters, Claude drafts, Slack cards |
| `api/mail-assistant.js` | the 5-minute check (cron) and the HQ panel's API |
| `api/mail-connect.js` | where Google sends you back after Connect |
| `api/product-slack.js` | Send / Edit / Skip, the Edit box, thread replies |
| `src/ProductBoard.jsx` | Product → Settings → Email assistant |
| `scripts/test-mail-assistant.mjs` | offline tests: `node scripts/test-mail-assistant.mjs` |
