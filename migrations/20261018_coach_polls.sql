-- Coach polls (Drew, Oct 18 2026: "a poll to send to all coaches regarding DS
-- Elite Friendsgiving"). A poll is a few tap questions; every coach gets their
-- own link (/poll?t=<invite token>), no login. Drew reads the tallies at
-- /poll?r=<results_token>.
--   questions  [{ id, label, kind: 'choice'|'multi'|'text', options?: [{ k, label }] }]
-- Run: node scripts/run-sql.mjs migrations/20261018_coach_polls.sql
CREATE TABLE IF NOT EXISTS public.coach_polls (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  intro          TEXT,
  questions      JSONB NOT NULL,
  results_token  UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.coach_poll_invites (
  token          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id        TEXT NOT NULL REFERENCES public.coach_polls(id) ON DELETE CASCADE,
  coach_id       BIGINT,
  name           TEXT NOT NULL,
  email          TEXT,
  phone          TEXT,
  answers        JSONB,
  answered_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (poll_id, coach_id)
);
ALTER TABLE public.coach_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_poll_invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_read_coach_polls" ON public.coach_polls;
CREATE POLICY "auth_read_coach_polls" ON public.coach_polls FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "auth_read_coach_poll_invites" ON public.coach_poll_invites;
CREATE POLICY "auth_read_coach_poll_invites" ON public.coach_poll_invites FOR SELECT USING (auth.uid() IS NOT NULL);
GRANT SELECT ON public.coach_polls, public.coach_poll_invites TO authenticated;
GRANT ALL ON public.coach_polls, public.coach_poll_invites TO service_role;
SELECT 'ok' AS done;
