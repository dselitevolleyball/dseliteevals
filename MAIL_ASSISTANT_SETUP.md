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

### 1. A Google OAuth client — as an **Internal** app

Make it **Internal**: no Google review, no demo video, no "unverified app" screen, and access
that never expires. An internal app only works for accounts in its own Google Workspace. If
drippingsportsclub.com and dselitevolleyball.com are separate Workspaces, do this once in each
(step 1b). Don't publish the app, and don't fill in the verification questions; they're only for
public apps.

**1a. drippingsportsclub.com** (signed in as drew@drippingsportsclub.com at
[console.cloud.google.com](https://console.cloud.google.com)):

1. **Create a project:** New project → name it `DSSC HQ`, in the drippingsportsclub.com
   organization.
2. **Turn on Gmail:** APIs & Services → Library → **Gmail API** → Enable.
3. **Set up the consent screen:** Google Auth Platform → Get started. App name `DSSC HQ`, support
   email, Audience **Internal**. If you already picked External, go to Audience and press
   **Make internal**.
4. **Add the permissions:** Google Auth Platform → Data access → Add or remove scopes:
   `.../auth/gmail.modify`, `openid`, `.../auth/userinfo.email`. Save.
5. **Create the client:** Google Auth Platform → Clients → Create client.
   - Type **Web application**.
   - **Authorized redirect URI:** `https://www.drippingsportsclub.com/hq/api/mail-connect`.
6. **Copy the keys:** Client ID and Client secret go into Vercel as `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`.

**1b. dselitevolleyball.com**, only if connecting drew@dselitevolleyball.com says the app is
"restricted to users within its organization":

1. Sign in to Google Cloud as drew@dselitevolleyball.com.
2. Repeat 1a in a project under the dselitevolleyball.com organization, with the same redirect
   URI.
3. Put its keys in Vercel as `GOOGLE_DSE_CLIENT_ID` and `GOOGLE_DSE_CLIENT_SECRET`. HQ uses them
   for that mailbox automatically.

### 2. Vercel

Add the keys above in Environment Variables (Production), then redeploy (or tell Claude to).

### 3. Connect each Gmail

1. In HQ, open **Product → Settings → Email assistant**.
2. Press **Connect** next to a mailbox.
3. Sign in as **that** account.
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
