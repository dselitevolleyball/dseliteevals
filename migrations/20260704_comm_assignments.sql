-- 20260704 — Coach communication assignments.
--
-- Drew assigns a message coaches should send to their teams; the app tracks per
-- team whether it's been sent (auto-detected from sportsyou_posts, confirmed by
-- an admin), and a cron reminds the coaches who haven't until they do.
--
-- Run: node scripts/run-sql.mjs migrations/20260704_comm_assignments.sql
-- Additive, non-destructive, idempotent.

CREATE TABLE IF NOT EXISTS public.comm_assignments (
  id                    BIGSERIAL PRIMARY KEY,
  title                 TEXT NOT NULL,
  instructions          TEXT,                       -- what the coach should send
  due_date              DATE,
  reminder_cadence_days INT  NOT NULL DEFAULT 2,
  team_names            TEXT[] NOT NULL DEFAULT '{}',-- empty = all teams
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.comm_assignment_status (
  id                BIGSERIAL PRIMARY KEY,
  assignment_id     BIGINT NOT NULL REFERENCES public.comm_assignments(id) ON DELETE CASCADE,
  team_name         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','not_needed')),
  confirmed_post_id BIGINT REFERENCES public.sportsyou_posts(id) ON DELETE SET NULL,
  sent_at           TIMESTAMPTZ,
  confirmed_by      TEXT,
  last_reminded_at  TIMESTAMPTZ,
  reminder_count    INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (assignment_id, team_name)
);
CREATE INDEX IF NOT EXISTS comm_status_assignment_idx ON public.comm_assignment_status(assignment_id);
CREATE INDEX IF NOT EXISTS comm_status_team_idx       ON public.comm_assignment_status(team_name);

ALTER TABLE public.comm_assignments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comm_assignment_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_all_comm_assignments ON public.comm_assignments;
DROP POLICY IF EXISTS auth_all_comm_status      ON public.comm_assignment_status;
CREATE POLICY auth_all_comm_assignments ON public.comm_assignments
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY auth_all_comm_status ON public.comm_assignment_status
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='comm_assignments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.comm_assignments;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='comm_assignment_status') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.comm_assignment_status;
  END IF;
END $$;
