-- DSSC Tasks & Projects (Drew, Oct 28 2026): "a full task tracking application
-- for all of my team members" - Jonathan, Hunter, Adrian, Brandon. One-off,
-- daily, weekly and monthly tasks in categories; Slack for updates and
-- feedback; notes, details, deadlines, blockers, overdue; on-time tracking;
-- asking for help; views by person / category / department; tasks that cross
-- departments; projects as the larger one-off items holding many tasks; and
-- tasks that point at the HQ screen the work happens in (programming, time
-- cards, staff hours...).
--
-- Built on the Projects tables (20261014d_dssc_projects.sql), so the existing
-- projects and their cards carry on unchanged:
--   dssc_project_tasks   a task. project_id is now optional: a task without a
--                        project is a standalone task. New: category,
--                        departments, the recurring series it came from, the
--                        blocker, a help request, an HQ screen / link, who
--                        finished it, and 'skipped' (a repeat that was missed).
--   dssc_task_series     a repeating task: daily (on chosen weekdays), weekly
--                        (on chosen weekdays, every N weeks) or monthly (a day
--                        of the month, or the last day). HQ makes each
--                        occurrence a task a few days ahead (api/_lib/tasks.js).
--   dssc_project_updates / dssc_project_files   project_id optional too, so a
--                        standalone task has comments, the trail and files.
--   dssc_project_settings  the category list, Slack member IDs (for
--                        @mentions) and the daily Slack digest switch.
--
-- Read and written only through /api/projects (service role).
-- Run: node scripts/run-sql.mjs migrations/20261106_dssc_tasks.sql
-- Additive and idempotent (safe to run twice).

CREATE TABLE IF NOT EXISTS public.dssc_task_series (
  id               BIGSERIAL PRIMARY KEY,
  title            TEXT NOT NULL,
  details          TEXT,
  category         TEXT,
  departments      TEXT[] NOT NULL DEFAULT '{}',
  priority         TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  assignee_email   TEXT,
  assignee_name    TEXT,
  helpers          JSONB NOT NULL DEFAULT '[]',
  checklist        JSONB NOT NULL DEFAULT '[]',   -- copied (unticked) onto each occurrence
  frequency        TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
  every_n          INT  NOT NULL DEFAULT 1 CHECK (every_n BETWEEN 1 AND 12),  -- every N weeks / months
  weekdays         INT[] NOT NULL DEFAULT '{}',   -- 0 = Sunday ... 6 = Saturday (daily / weekly)
  monthday         INT CHECK (monthday BETWEEN -1 AND 31 AND monthday <> 0),  -- monthly: 1-31, -1 = last day
  starts_on        DATE NOT NULL,
  ends_on          DATE,
  hq_view          TEXT,
  link_url         TEXT,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  last_generated_on DATE,
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.dssc_project_tasks ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE public.dssc_project_tasks ADD COLUMN IF NOT EXISTS category            TEXT;
ALTER TABLE public.dssc_project_tasks ADD COLUMN IF NOT EXISTS departments         TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.dssc_project_tasks ADD COLUMN IF NOT EXISTS series_id           BIGINT REFERENCES public.dssc_task_series(id) ON DELETE SET NULL;
ALTER TABLE public.dssc_project_tasks ADD COLUMN IF NOT EXISTS blocker             TEXT;          -- what it's waiting on
ALTER TABLE public.dssc_project_tasks ADD COLUMN IF NOT EXISTS help_requested_at   TIMESTAMPTZ;   -- set while someone has asked for help
ALTER TABLE public.dssc_project_tasks ADD COLUMN IF NOT EXISTS help_note           TEXT;
ALTER TABLE public.dssc_project_tasks ADD COLUMN IF NOT EXISTS help_from           TEXT;          -- the person asked (null = anyone)
ALTER TABLE public.dssc_project_tasks ADD COLUMN IF NOT EXISTS help_by             TEXT;          -- who asked
ALTER TABLE public.dssc_project_tasks ADD COLUMN IF NOT EXISTS hq_view             TEXT;          -- an HQ screen: dssctime, staffadmin, clinics...
ALTER TABLE public.dssc_project_tasks ADD COLUMN IF NOT EXISTS link_url            TEXT;
ALTER TABLE public.dssc_project_tasks ADD COLUMN IF NOT EXISTS completed_by        TEXT;
ALTER TABLE public.dssc_project_tasks ADD COLUMN IF NOT EXISTS overdue_notified_at TIMESTAMPTZ;   -- Slack heard it went overdue
ALTER TABLE public.dssc_project_tasks DROP CONSTRAINT IF EXISTS dssc_project_tasks_status_check;
ALTER TABLE public.dssc_project_tasks ADD CONSTRAINT dssc_project_tasks_status_check CHECK (status IN ('todo','doing','blocked','done','skipped'));
-- One task per occurrence. Not a partial index, so the API's upsert can name it;
-- tasks without a series (NULL) never collide.
CREATE UNIQUE INDEX IF NOT EXISTS dssc_project_tasks_series_due_idx ON public.dssc_project_tasks (series_id, due_date);
CREATE INDEX IF NOT EXISTS dssc_project_tasks_status_due_idx ON public.dssc_project_tasks (status, due_date);

ALTER TABLE public.dssc_project_updates ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE public.dssc_project_files   ALTER COLUMN project_id DROP NOT NULL;

ALTER TABLE public.dssc_project_settings ADD COLUMN IF NOT EXISTS categories    JSONB NOT NULL DEFAULT '["Programming","Operations","Facilities","Marketing","Staffing & payroll","Finance & admin","Customer service","Events"]';
ALTER TABLE public.dssc_project_settings ADD COLUMN IF NOT EXISTS departments   JSONB NOT NULL DEFAULT '["Volleyball","Basketball","Reach","DS Elite","Front desk","Admin"]';
ALTER TABLE public.dssc_project_settings ADD COLUMN IF NOT EXISTS slack_ids    JSONB NOT NULL DEFAULT '{}';   -- { email: "U0123ABC" } for @mentions
ALTER TABLE public.dssc_project_settings ADD COLUMN IF NOT EXISTS daily_digest  BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.dssc_project_settings ADD COLUMN IF NOT EXISTS last_daily_at TIMESTAMPTZ;
ALTER TABLE public.dssc_project_settings ADD COLUMN IF NOT EXISTS last_generated_at TIMESTAMPTZ;

ALTER TABLE public.dssc_task_series ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.dssc_task_series TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.dssc_task_series_id_seq TO service_role;

SELECT 'ok' AS done;
