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

### 4. Slack: the "DSSC Mail" app

Email drafts get their own Slack app, so they have their own conversation in your sidebar, apart
from the HQ bot's social approvals and Product posts. Until it's set up, drafts come from the HQ
bot.

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From a
   manifest**.
2. Pick your workspace and paste this (JSON):

```json
{
  "display_information": {
    "name": "DSSC Mail",
    "description": "Drafted replies to Drew's email - Send, Edit or Skip",
    "background_color": "#082c2a"
  },
  "features": {
    "app_home": { "home_tab_enabled": false, "messages_tab_enabled": true, "messages_tab_read_only_enabled": false },
    "bot_user": { "display_name": "DSSC Mail", "always_online": true }
  },
  "oauth_config": {
    "scopes": { "bot": ["chat:write", "im:write", "im:history", "users:read", "users:read.email"] }
  },
  "settings": {
    "event_subscriptions": {
      "request_url": "https://dseliteevals.vercel.app/api/mail-slack",
      "bot_events": ["message.im"]
    },
    "interactivity": { "is_enabled": true, "request_url": "https://dseliteevals.vercel.app/api/mail-slack" },
    "org_deploy_enabled": false,
    "socket_mode_enabled": false,
    "token_rotation_enabled": false
  }
}
```

3. Press **Create**, then **Install to Workspace** → Allow.
4. Copy two values into HQ → **Product → Settings → Email assistant → Slack app**, then press
   **Save**:
   - **OAuth & Permissions** → the **Bot User OAuth Token** (`xoxb-…`).
   - **Basic Information** → the **Signing Secret**.
5. Press **Send a test**. A DM from **DSSC Mail** should arrive.

From then on, new drafts come from DSSC Mail. Cards the HQ bot already posted keep working where
they are.

## Files

| File | What it does |
|---|---|
| `migrations/20261112_mail_assistant.sql` | `mail_accounts` (tokens, server only), `mail_drafts` |
| `api/_lib/mail-assistant.js` | Google sign-in, Gmail read and send, filters, Claude drafts, Slack cards |
| `api/mail-assistant.js` | the 5-minute check (cron) and the HQ panel's API |
| `api/mail-connect.js` | where Google sends you back after Connect |
| `api/mail-slack.js`, `api/_lib/mail-slack.js` | the DSSC Mail Slack app: Send / Edit / Skip, the Edit box, thread replies |
| `api/product-slack.js` | the same, for cards the HQ bot posted before DSSC Mail |
| `src/ProductBoard.jsx` | Product → Settings → Email assistant |
| `scripts/test-mail-assistant.mjs` | offline tests: `node scripts/test-mail-assistant.mjs` |
