-- DSSC Projects (Drew, Oct 14 2026): "a project menu within the DSSC HQ ...
-- to assign projects and track to-dos and completions" - Heatwave's Inaugural
-- Winter Edition, DS Fall Fest Activations (Jonathan). Each task is a card with
-- details, a checklist, files and a comment thread; staff are assigned; a
-- weekly email lists what needs an update; Slack hears about changes; Claude
-- drafts a whole project from a typed brief.
--
-- Everything is read and written through /api/projects (service role), which
-- checks the login is DSSC staff - so no browser policies here.
-- Run: node scripts/run-sql.mjs migrations/20261014d_dssc_projects.sql

CREATE TABLE IF NOT EXISTS public.dssc_projects (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  summary      TEXT,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('planning','active','on_hold','done','archived')),
  owner_email  TEXT,
  owner_name   TEXT,
  team         JSONB NOT NULL DEFAULT '[]',       -- [{ email, name }] helping on it
  start_date   DATE,
  due_date     DATE,
  icon         TEXT,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.dssc_project_tasks (
  id               BIGSERIAL PRIMARY KEY,
  project_id       BIGINT NOT NULL REFERENCES public.dssc_projects(id) ON DELETE CASCADE,
  section          TEXT,                          -- "Coaching", "Marketing", ...
  title            TEXT NOT NULL,
  details          TEXT,
  status           TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','blocked','done')),
  priority         TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  assignee_email   TEXT,
  assignee_name    TEXT,
  helpers          JSONB NOT NULL DEFAULT '[]',   -- [{ email, name }]
  due_date         DATE,
  checklist        JSONB NOT NULL DEFAULT '[]',   -- [{ id, text, done }]
  sort             INT NOT NULL DEFAULT 0,
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS dssc_project_tasks_project_idx ON public.dssc_project_tasks (project_id);
CREATE INDEX IF NOT EXISTS dssc_project_tasks_assignee_idx ON public.dssc_project_tasks (lower(assignee_email));

-- Comments and the activity trail (status changes, assignments, files...).
CREATE TABLE IF NOT EXISTS public.dssc_project_updates (
  id           BIGSERIAL PRIMARY KEY,
  project_id   BIGINT NOT NULL REFERENCES public.dssc_projects(id) ON DELETE CASCADE,
  task_id      BIGINT REFERENCES public.dssc_project_tasks(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'comment',   -- comment | created | status | assigned | due | file | edit
  body         TEXT,
  author_name  TEXT,
  author_email TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dssc_project_updates_task_idx ON public.dssc_project_updates (task_id, created_at);
CREATE INDEX IF NOT EXISTS dssc_project_updates_project_idx ON public.dssc_project_updates (project_id, created_at);

-- Files on a card (or the project). The bytes live in the private
-- "dssc-projects" bucket; links are signed and short-lived.
CREATE TABLE IF NOT EXISTS public.dssc_project_files (
  id           BIGSERIAL PRIMARY KEY,
  project_id   BIGINT NOT NULL REFERENCES public.dssc_projects(id) ON DELETE CASCADE,
  task_id      BIGINT REFERENCES public.dssc_project_tasks(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  path         TEXT NOT NULL,
  size         BIGINT,
  mime         TEXT,
  uploaded_by  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dssc_project_files_task_idx ON public.dssc_project_files (task_id);

-- One row: where Slack updates go and whether the Monday email runs.
CREATE TABLE IF NOT EXISTS public.dssc_project_settings (
  id             INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  slack_webhook  TEXT,
  weekly_email   BOOLEAN NOT NULL DEFAULT TRUE,
  last_weekly_at TIMESTAMPTZ,
  updated_by     TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.dssc_project_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.dssc_projects         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dssc_project_tasks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dssc_project_updates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dssc_project_files    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dssc_project_settings ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.dssc_projects, public.dssc_project_tasks, public.dssc_project_updates, public.dssc_project_files, public.dssc_project_settings TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.dssc_projects_id_seq, public.dssc_project_tasks_id_seq, public.dssc_project_updates_id_seq, public.dssc_project_files_id_seq TO service_role;

-- Private bucket for card files (25 MB each). No storage policies: uploads use
-- signed upload URLs from the API, downloads signed URLs.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('dssc-projects', 'dssc-projects', false, 26214400)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 26214400;

SELECT 'ok' AS done;
