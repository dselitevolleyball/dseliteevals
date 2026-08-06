-- 20260806 — Team parent (team mom) and general volunteer signups, per team.
--
-- Parents volunteer at the season kickoff meeting; until now the list lived in
-- Drew's notes, so coaches had no way to see who their team parent is or how to
-- reach them. One row per volunteer per team.
--
-- `role` splits the two things parents signed up for:
--   team_parent — the team mom/dad role (comms, snack/hotel wrangling, etc.)
--   volunteer   — everything else offered (GameChanger, events, photos)
--
-- email/phone/player_name are denormalised from players at seed time rather
-- than joined live: several volunteers are the second parent on a record whose
-- parent_name is the other spouse, so there is no reliable key back to a row.
--
-- Run: node scripts/run-sql.mjs migrations/20260806_team_volunteers.sql
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS public.team_volunteers (
  id          bigserial    PRIMARY KEY,
  team_name   text         NOT NULL,
  name        text         NOT NULL,
  role        text         NOT NULL DEFAULT 'team_parent',  -- team_parent | volunteer
  email       text,
  phone       text,
  player_name text,        -- whose parent this is, for coaches scanning the roster
  note        text         NOT NULL DEFAULT '',
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now()
);

-- One entry per person per team. Plain (not lower(name)) because PostgREST can
-- only target a literal column list with on_conflict, and the app upserts here.
DROP INDEX IF EXISTS public.team_volunteers_team_name_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS team_volunteers_team_name_uniq
  ON public.team_volunteers (team_name, name);
CREATE INDEX IF NOT EXISTS team_volunteers_team_idx
  ON public.team_volunteers (team_name);

COMMENT ON COLUMN public.team_volunteers.role IS 'team_parent = team mom/dad; volunteer = GameChanger, events, photos, etc.';
COMMENT ON COLUMN public.team_volunteers.name IS 'As the parent wrote it at signup — may name a couple, e.g. "Eric/Erika Fitzgerald".';

ALTER TABLE public.team_volunteers ENABLE ROW LEVEL SECURITY;

-- Same shape as team_tasks: any approved coach can read and maintain their
-- team's list. Coaches are the ones who find out a team parent has stepped
-- down, so gating writes to admins would just route it through Drew.
DROP POLICY IF EXISTS team_volunteers_all_approved ON public.team_volunteers;
CREATE POLICY team_volunteers_all_approved ON public.team_volunteers
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));
