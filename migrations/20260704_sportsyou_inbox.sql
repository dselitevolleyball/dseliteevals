-- Migration: SportsYou inbox — central log of coach→team posts.
-- Date: 2026-07-04
--
-- A DS Elite "house" account is added to every SportsYou team, so every team
-- post generates a notification email to the house inbox. Those emails are
-- forwarded to /api/sportsyou-inbox, parsed, and stored here — giving us one
-- central log of what coaches are sending, plus a "days since last post" per
-- team so we can nudge coaches who've gone quiet.
--
-- Mirrors the sms_messaging pattern: auth-only SELECT/modify via RLS, while the
-- webhook (service role) bypasses RLS to insert. Realtime pushes new posts to
-- the Coach Comms view without a refresh.
--
-- Run: node scripts/run-sql.mjs migrations/20260704_sportsyou_inbox.sql
-- Additive, non-destructive, idempotent.

CREATE TABLE IF NOT EXISTS public.sportsyou_posts (
  id              BIGSERIAL PRIMARY KEY,
  source          TEXT NOT NULL DEFAULT 'sportsyou',
  -- team_name is normalized to practice_teams.team_name when we can match it;
  -- NULL means "couldn't match a known team" (parsed_ok = false) so it shows up
  -- as Unmatched in the UI and can be re-parsed later from raw_email.
  team_name       TEXT,
  raw_team_label  TEXT,                 -- team text exactly as it arrived (subject etc.)
  author          TEXT,                 -- poster/coach name if we could parse it
  subject         TEXT,
  body            TEXT,
  from_email      TEXT,                 -- parsed sender address
  posted_at       TIMESTAMPTZ,          -- email Date header; falls back to received time
  message_id      TEXT UNIQUE,          -- email Message-ID (or synthesized hash) for dedup
  raw_email       TEXT,                 -- full inbound payload, so we can re-parse history
  parsed_ok       BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sportsyou_posts_team_idx   ON public.sportsyou_posts(team_name);
CREATE INDEX IF NOT EXISTS sportsyou_posts_posted_idx ON public.sportsyou_posts(posted_at DESC);
CREATE INDEX IF NOT EXISTS sportsyou_posts_msgid_idx  ON public.sportsyou_posts(message_id);

-- RLS — authenticated users may read/curate; the webhook uses the service role,
-- which bypasses RLS, so ingestion works regardless of these policies.
ALTER TABLE public.sportsyou_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_sportsyou_posts" ON public.sportsyou_posts;
DROP POLICY IF EXISTS "auth_modify_sportsyou_posts" ON public.sportsyou_posts;

CREATE POLICY "auth_select_sportsyou_posts" ON public.sportsyou_posts
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_modify_sportsyou_posts" ON public.sportsyou_posts
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Realtime — push new posts to the Coach Comms view live.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='sportsyou_posts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sportsyou_posts;
  END IF;
END $$;
