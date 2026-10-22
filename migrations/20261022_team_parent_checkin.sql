-- 20261022 — Team parent check-in (Drew, Oct 22 2026: "send a message to all team parents asking
-- them to confirm their status of team parents and if we are missing any team parents for their
-- team — a simple form to click on and provide information").
--
-- Every team_volunteers row gets a capability link (/team-parent?t=checkin_token). The parent says
-- whether they are the team parent, fixes their contact details, says which of the other names on
-- file are team parents, and adds anyone missing. api/team-parent-form.js applies the answer:
--   yes  -> confirmed = true (confirmed_by 'self: team parent check-in')
--   no   -> confirmed = false, declined_at = now()
--   added parents -> new unconfirmed team_parent rows (note says who added them)
-- and keeps the full answer in team_parent_checkins (latest answer per person wins on screen).
--
-- Run: node scripts/run-sql.mjs migrations/20261022_team_parent_checkin.sql   (additive, idempotent)

ALTER TABLE public.team_volunteers ADD COLUMN IF NOT EXISTS checkin_token uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.team_volunteers ADD COLUMN IF NOT EXISTS declined_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS team_volunteers_checkin_token_uniq ON public.team_volunteers (checkin_token);

CREATE TABLE IF NOT EXISTS public.team_parent_checkins (
  id            bigserial PRIMARY KEY,
  volunteer_id  bigint REFERENCES public.team_volunteers(id) ON DELETE SET NULL,
  team_name     text NOT NULL,
  respondent    text NOT NULL,
  answer        text NOT NULL CHECK (answer IN ('yes', 'no')),
  email         text,
  phone         text,
  others        jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ id, name, is_team_parent: 'yes'|'no'|'unsure' }]
  added         jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ name, email, phone, new_id }]
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_parent_checkins_team_idx ON public.team_parent_checkins (team_name, created_at DESC);

ALTER TABLE public.team_parent_checkins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_parent_checkins_auth_read ON public.team_parent_checkins;
CREATE POLICY team_parent_checkins_auth_read ON public.team_parent_checkins FOR SELECT USING (auth.uid() IS NOT NULL);
GRANT SELECT ON public.team_parent_checkins TO authenticated;
GRANT ALL ON public.team_parent_checkins TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.team_parent_checkins_id_seq TO service_role;
SELECT 'ok' AS done;
