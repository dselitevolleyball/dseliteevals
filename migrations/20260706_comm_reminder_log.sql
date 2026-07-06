-- 20260706 — Log every reminder email/push sent for a communication assignment,
-- so admins can click in and read exactly what went out to each team.
--
-- Written by both the in-app composer (manual sends) and the comm-reminders
-- cron (automatic sends).
--
-- Run: node scripts/run-sql.mjs migrations/20260706_comm_reminder_log.sql
-- Additive, non-destructive, idempotent.

CREATE TABLE IF NOT EXISTS public.comm_reminder_log (
  id             BIGSERIAL PRIMARY KEY,
  assignment_id  BIGINT REFERENCES public.comm_assignments(id) ON DELETE CASCADE,
  team_name      TEXT NOT NULL,
  subject        TEXT,
  body           TEXT,
  recipients     TEXT[] NOT NULL DEFAULT '{}',   -- coach emails the email went to
  push_sent      BOOLEAN NOT NULL DEFAULT FALSE,
  source         TEXT NOT NULL DEFAULT 'manual',  -- 'manual' | 'auto'
  sent_by        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS comm_reminder_log_assignment_idx ON public.comm_reminder_log(assignment_id);
CREATE INDEX IF NOT EXISTS comm_reminder_log_team_idx       ON public.comm_reminder_log(team_name);

ALTER TABLE public.comm_reminder_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_all_comm_reminder_log ON public.comm_reminder_log;
CREATE POLICY auth_all_comm_reminder_log ON public.comm_reminder_log
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='comm_reminder_log') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.comm_reminder_log;
  END IF;
END $$;
