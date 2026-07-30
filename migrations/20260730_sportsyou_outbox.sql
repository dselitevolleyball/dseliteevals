-- 20260730 — Queue of messages waiting to be posted to SportsYou team feeds.
--
-- SportsYou has no public API and their GraphQL endpoint only accepts requests
-- from an https://sportsyou.com origin with the session cookie attached
-- (access-control-allow-origin is pinned to that host, cookies are HttpOnly).
-- So nothing server-side can post for us — the actual call has to happen in a
-- logged-in browser tab. This table is the handoff: DS HQ writes rows here,
-- a bookmarklet on sportsyou.com drains them and marks them posted.
--
-- One row per (message, team) so per-team merge fields work. The bookmarklet
-- groups rows with identical text and sends them as a single postCreate with
-- multiple targetIds, so identical text across 17 teams is one request.
--
-- Run: node scripts/run-sql.mjs migrations/20260730_sportsyou_outbox.sql
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS public.sportsyou_outbox (
  id          BIGSERIAL   PRIMARY KEY,
  team_name   TEXT        NOT NULL,          -- DS HQ team name, not the SportsYou one
  subject     TEXT,
  message     TEXT        NOT NULL,          -- already merge-resolved for this team
  status      TEXT        NOT NULL DEFAULT 'pending',   -- pending | posted | failed | cancelled
  queued_by   TEXT,
  queued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posted_at   TIMESTAMPTZ,
  sy_response TEXT,                          -- error text when status = failed
  batch_id    TEXT                           -- groups the teams from one compose action
);

CREATE INDEX IF NOT EXISTS sportsyou_outbox_status_idx ON public.sportsyou_outbox (status, queued_at);

ALTER TABLE public.sportsyou_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sportsyou_outbox_all_approved ON public.sportsyou_outbox;
CREATE POLICY sportsyou_outbox_all_approved ON public.sportsyou_outbox FOR ALL
  USING (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='sportsyou_outbox') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sportsyou_outbox;
  END IF;
END $$;
