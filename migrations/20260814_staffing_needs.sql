-- 20260814 — Staffing board: open coaching roles, the people who could fill
-- them, and who's being considered for what.
--
-- Until now this lived in Drew's head: 13 Rise 1 has no coaches at all, 15 Ruby
-- has the "15-2 Assistant Coach" placeholder standing in for a real assistant,
-- and the "Tournament Floater Coach" placeholder is booked into 19 practices
-- and half a dozen tournament slots with nobody actually attached to it. On the
-- other side sit people with capacity — Jaalin (off 12 Ruby), Jessica (16 Ruby
-- was cut), Kelli, plus Yuli and Jillian who aren't on the roster at all yet.
--
-- Three tables so a need and a person can be weighed against each other
-- without either one having to be resolved first:
--
--   staffing_needs      — a hole to fill. Team roles point at practice_teams;
--                         `floater`/`other` needs stand alone (team_name NULL).
--   staffing_candidates — someone who could fill one. NOT limited to the coach
--                         roster: interested outsiders live here before they
--                         have a roster row or an app login.
--   staffing_matches    — one candidate being considered for one need, with a
--                         fit rating and where the conversation stands. Many
--                         to many on purpose: one person can be up for three
--                         roles, one role can have three people in the running.
--
-- Nothing here writes to practice_teams. Deciding is done on this board;
-- committing is still the ordinary edit in the Practice view, so a half-formed
-- idea can never quietly become a team's actual assistant coach.
--
-- Run: node scripts/run-sql.mjs migrations/20260814_staffing_needs.sql
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS public.staffing_needs (
  id          bigserial   PRIMARY KEY,
  team_name   text,       -- NULL for needs that aren't a team seat (floater)
  role        text        NOT NULL DEFAULT 'assistant',  -- head | assistant | third | floater | other
  title       text        NOT NULL DEFAULT '',           -- label for non-team needs
  priority    text        NOT NULL DEFAULT 'normal',     -- high | normal | low
  status      text        NOT NULL DEFAULT 'open',       -- open | considering | filled | dropped
  filled_by   text,       -- who ended up in the seat, once status = filled
  notes       text        NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.staffing_candidates (
  id            bigserial   PRIMARY KEY,
  name          text        NOT NULL,
  contact       text        NOT NULL DEFAULT '',   -- email/phone for people with no roster row
  status        text        NOT NULL DEFAULT 'available', -- available | considering | placed | unavailable
  on_roster     boolean     NOT NULL DEFAULT false,-- already a DS Elite coach
  wants         text        NOT NULL DEFAULT '',   -- what they're open to, in their words
  notes         text        NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.staffing_matches (
  id            bigserial   PRIMARY KEY,
  need_id       bigint      NOT NULL REFERENCES public.staffing_needs(id)      ON DELETE CASCADE,
  candidate_id  bigint      NOT NULL REFERENCES public.staffing_candidates(id) ON DELETE CASCADE,
  fit           text        NOT NULL DEFAULT 'maybe',  -- strong | maybe | stretch
  status        text        NOT NULL DEFAULT 'idea',   -- idea | asked | accepted | declined
  notes         text        NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per person per need — the app upserts, so a repeated "consider X for
-- Y" edits the existing pairing instead of stacking duplicates on the card.
CREATE UNIQUE INDEX IF NOT EXISTS staffing_matches_pair_uniq
  ON public.staffing_matches (need_id, candidate_id);
CREATE UNIQUE INDEX IF NOT EXISTS staffing_candidates_name_uniq
  ON public.staffing_candidates (lower(btrim(name)));
CREATE INDEX IF NOT EXISTS staffing_needs_status_idx ON public.staffing_needs (status);

COMMENT ON COLUMN public.staffing_needs.team_name IS 'Matches practice_teams.team_name; NULL for club-wide needs like a tournament floater.';
COMMENT ON COLUMN public.staffing_needs.filled_by IS 'Recorded here for history — the real assignment still lives in practice_teams.';
COMMENT ON COLUMN public.staffing_candidates.on_roster IS 'False = interested outsider with no coach_roster row or app login yet.';
COMMENT ON COLUMN public.staffing_matches.fit IS 'strong = would take today; maybe = worth the conversation; stretch = only if nothing better.';

ALTER TABLE public.staffing_needs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staffing_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staffing_matches    ENABLE ROW LEVEL SECURITY;

-- Admins only, unlike most tables here. These rows say things like "would be a
-- stretch" and "asked, declined" about named coaches — notes meant for the
-- people doing the hiring, not for the coach being weighed up.
DROP POLICY IF EXISTS staffing_needs_admin ON public.staffing_needs;
CREATE POLICY staffing_needs_admin ON public.staffing_needs
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved AND c.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved AND c.is_admin));

DROP POLICY IF EXISTS staffing_candidates_admin ON public.staffing_candidates;
CREATE POLICY staffing_candidates_admin ON public.staffing_candidates
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved AND c.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved AND c.is_admin));

DROP POLICY IF EXISTS staffing_matches_admin ON public.staffing_matches;
CREATE POLICY staffing_matches_admin ON public.staffing_matches
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved AND c.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved AND c.is_admin));
