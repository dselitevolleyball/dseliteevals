-- Migration: stay-to-play housing pickup reports, matched to rosters.
-- Date: 2026-09-25  Additive, idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260925_tournament_housing.sql
--
-- KC Sports Housing (and the other housing bureaus) email a "pickup report"
-- listing every room booked under the club for a stay-to-play tournament. An
-- admin pastes that email into Travel → Housing; the app parses the rows,
-- matches each booking to a player (parent last name / email / phone / the
-- "share with" names) or to a coach, and shows who on each team still hasn't
-- booked — then emails those families. Each paste replaces the previous
-- report for that tournament (the bureau sends the whole list every time).

CREATE TABLE IF NOT EXISTS public.tournament_housing_bookings (
  id               BIGSERIAL PRIMARY KEY,
  tournament_id    BIGINT NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  report_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),   -- when this report was pasted
  row_no           INT,
  hotel            TEXT,
  last_name        TEXT,
  first_name       TEXT,
  club_name        TEXT,
  team_raw         TEXT,
  email            TEXT,
  phone            TEXT,
  check_in         DATE,
  check_out        DATE,
  nights           INT,
  room_type        TEXT,
  ack_number       TEXT,
  share_with       TEXT,
  matched_player_id BIGINT REFERENCES public.players(id) ON DELETE SET NULL,
  matched_team     TEXT,
  is_staff         BOOLEAN NOT NULL DEFAULT false,
  match_how        TEXT,                                 -- email | phone | last name | share with | manual | coach
  created_by       TEXT
);
CREATE INDEX IF NOT EXISTS tournament_housing_bookings_tn_idx ON public.tournament_housing_bookings(tournament_id);
ALTER TABLE public.tournament_housing_bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_tournament_housing_bookings" ON public.tournament_housing_bookings;
CREATE POLICY "auth_all_tournament_housing_bookings" ON public.tournament_housing_bookings FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- The bureau's booking cut-off and link, per tournament, so the reminder can
-- say when and where. Reminder log so nobody nags twice in a day.
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS housing_deadline      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS housing_report_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS housing_reminded_at   TIMESTAMPTZ;
