-- 20260829 — the head-coach kickoff check-in.
--
-- Two things nobody has a straight answer to right now: who each team's team
-- parent actually IS, and whether the team has had its kickoff party.
--
-- We have a guess at the first. Parents signed up at the season meeting and
-- those signups are already in team_volunteers — but several teams have five or
-- six names on that list, which is a list of people who offered, not the person
-- doing the job. Only the head coach knows which one it turned out to be, so
-- the coach confirms rather than retypes: the form shows the signups and they
-- tick the real one.
--
-- The kickoff answer has a third state that matters more than the other two.
-- "Held" and "scheduled" are just facts to record; "not scheduled yet" is the
-- one that needs something to happen, so the form turns that answer into the
-- ask — go talk to your team parent — and takes a date by which they'll have
-- one, which is what the board then chases.
--
-- Delivery is a per-team link (practice_teams.kickoff_form_token), not a login.
-- A coach opens it from the push notification or the email on their phone in a
-- gym. The token is a capability: whoever holds it can answer for that one team
-- and nothing else.
--
-- Run: node scripts/run-sql.mjs migrations/20260829_team_kickoff_checkin.sql
-- Additive and idempotent.

-- ── Per-team form link ──────────────────────────────────────────────────────
ALTER TABLE public.practice_teams
  ADD COLUMN IF NOT EXISTS kickoff_form_token uuid;

UPDATE public.practice_teams
   SET kickoff_form_token = gen_random_uuid()
 WHERE kickoff_form_token IS NULL;

ALTER TABLE public.practice_teams
  ALTER COLUMN kickoff_form_token SET DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS practice_teams_kickoff_token_idx
  ON public.practice_teams (kickoff_form_token);

COMMENT ON COLUMN public.practice_teams.kickoff_form_token IS
  'Per-team capability token for /kickoff?t=… — the head coach''s check-in link. Not a credential; re-issue by setting it to gen_random_uuid().';

-- ── Which volunteer is actually the team parent ─────────────────────────────
-- Confirmation lives on the person, not in the kickoff row, so there is one
-- list of team parents rather than two that drift. The team card already reads
-- team_volunteers; this only adds a tick to it.
ALTER TABLE public.team_volunteers
  ADD COLUMN IF NOT EXISTS confirmed    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirmed_by text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

COMMENT ON COLUMN public.team_volunteers.confirmed IS
  'Head coach confirmed this person is the team parent doing the job (vs. having signed up at the kickoff meeting).';

-- ── The kickoff answer, one row per team ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.team_kickoffs (
  team_name       text        PRIMARY KEY,
  -- held | scheduled | not_scheduled. No 'unknown' — a row only exists once a
  -- coach has answered, so a missing row IS the unanswered state and doesn't
  -- need a value of its own that someone later has to remember to exclude.
  kickoff_status  text        NOT NULL,
  kickoff_date    date,                                  -- the date it was held, or is booked for
  kickoff_where   text,                                  -- host's house, a restaurant, the gym
  -- Only for not_scheduled: the date the coach commits to having one booked by.
  -- This is what the board chases; without it "not scheduled" is a status that
  -- never changes on its own.
  plan_by         date,
  -- The coach says the team still hasn't got a team parent. Kept separate from
  -- "nobody ticked a box", which is just an unfinished form.
  no_team_parent  boolean     NOT NULL DEFAULT false,
  notes           text        NOT NULL DEFAULT '',
  submitted_by    text,                                  -- head coach at the time of answering
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.team_kickoffs IS
  'Head-coach kickoff check-in. One row per team; no row means they have not answered.';

ALTER TABLE public.team_kickoffs ENABLE ROW LEVEL SECURITY;

-- Same shape as team_volunteers: any approved coach reads and maintains it.
-- The form itself writes with the service role, past RLS.
DROP POLICY IF EXISTS team_kickoffs_all_approved ON public.team_kickoffs;
CREATE POLICY team_kickoffs_all_approved ON public.team_kickoffs
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));

-- ── Who we asked, and when ──────────────────────────────────────────────────
-- Same job as coach_gear_reminders: the answers tell you who hasn't replied,
-- this tells you whether that's because we never actually asked them.
CREATE TABLE IF NOT EXISTS public.team_kickoff_requests (
  id          bigserial   PRIMARY KEY,
  team_name   text        NOT NULL,
  coach_name  text,
  channel     text        NOT NULL DEFAULT 'email',      -- email | push
  sent_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_kickoff_requests_team_idx
  ON public.team_kickoff_requests (team_name, sent_at DESC);

ALTER TABLE public.team_kickoff_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_kickoff_requests_read_approved ON public.team_kickoff_requests;
CREATE POLICY team_kickoff_requests_read_approved ON public.team_kickoff_requests
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));
