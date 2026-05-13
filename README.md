# DS Elite Tryout Evaluations - Deployment Guide

## What You'll Need
- A free **Supabase** account (database) → [supabase.com](https://supabase.com)
- A free **Vercel** account (hosting) → [vercel.com](https://vercel.com)
- A **GitHub** account → [github.com](https://github.com)

Total time: ~15 minutes. Total cost: $0.

---

## Step 1: Set Up Supabase (5 min)

1. Go to [supabase.com](https://supabase.com) and sign up (use your GitHub account)
2. Click **"New Project"**
3. Name it `ds-elite-evals`, set a database password, choose region `US East`
4. Wait ~2 minutes for it to provision
5. Once ready, click **SQL Editor** in the left sidebar
6. Copy the ENTIRE contents of `supabase-schema.sql` and paste it in
7. Click **Run** — you should see "Success"
8. Go to **Settings → API** and copy:
   - **Project URL** (looks like `https://xxxx.supabase.co`)
   - **anon / public** key (the long string)

## Step 2: Push Code to GitHub (3 min)

1. Create a new repo on GitHub called `ds-elite-evals`
2. Upload all these project files to the repo (drag and drop works)
3. Make sure the file structure looks like:
   ```
   ds-elite-evals/
   ├── package.json
   ├── vite.config.js
   ├── vercel.json
   ├── index.html
   ├── supabase-schema.sql
   └── src/
       ├── main.jsx
       ├── App.jsx
       └── supabase.js
   ```

## Step 3: Deploy to Vercel (5 min)

1. Go to [vercel.com](https://vercel.com) and sign up with GitHub
2. Click **"Add New Project"**
3. Import your `ds-elite-evals` repo
4. Before deploying, add **Environment Variables**:
   - `VITE_SUPABASE_URL` = your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` = your Supabase anon key
   - `VITE_APP_PASSWORD` = `dselite2026` (or whatever password you want)
5. Click **Deploy**
6. In ~1 minute you'll have a live URL like `ds-elite-evals.vercel.app`

## Step 4: Upload Your Players

1. Open your deployed site
2. Enter the access code
3. On the Dashboard, click **"Upload CSV"**
4. Upload your UpperHand CSV exports (the same files you gave me)
5. Players will be added with their USAV age automatically calculated

---

## How It Works

- **All coaches** open the same URL on their phone/tablet
- **All data syncs** — when one coach scores a player, everyone sees it
- **Upload new registrations** anytime from the Dashboard
- **Export to CSV** to download all eval data to a spreadsheet
- **Password protected** — only people with the code can access it

## Adding New Eval Dates

Edit the `EVAL_DATES` array in `src/App.jsx` and redeploy (push to GitHub, Vercel auto-deploys).

## Customizing Teams

Edit the `TM` object in `src/App.jsx` to change team names per age group.

## Need Help?

The app uses:
- **Supabase** free tier: 500MB database, 50K monthly requests
- **Vercel** free tier: unlimited deploys, custom domain support
- Both are way more than enough for a volleyball club's tryout season
