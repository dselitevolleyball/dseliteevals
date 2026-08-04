-- Migration: let a coach answer a trip that has no coach_travel row yet.
-- Date: 2026-08-04  Additive, idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260804_confirm_travel_upsert.sql
--
-- coach_travel rows are created lazily — one only exists once somebody edits
-- travel for that coach on that tournament. Who SHOULD travel is derived from
-- the tournament assignments instead (travelStaffFor). The confirmation email
-- read the table rather than the derivation, so a coach assigned to an airfare
-- tournament with no saved row was never asked: Rene was never asked about
-- Oklahoma City, and eight other coach-trips were in the same state.
--
-- The app now derives the trips, which means the form can offer a trip that has
-- no row behind it. confirm_travel() takes an id, so it cannot answer one.
-- This upserts by (tournament_id, coach_name) instead, and still writes only
-- the four answer columns.

CREATE OR REPLACE FUNCTION public.confirm_travel_for(
  p_tournament_id bigint,
  p_coach_name    text,
  p_mode          text,
  p_booking_ok    boolean,
  p_note          text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_mode IS NOT NULL AND p_mode NOT IN ('fly_club', 'drive', 'fly_own') THEN
    RAISE EXCEPTION 'Unknown travel mode: %', p_mode;
  END IF;
  IF NOT (public.is_me_coach(p_coach_name) OR public.is_admin_coach()) THEN
    RAISE EXCEPTION 'That trip is not yours to confirm.';
  END IF;

  -- private_owner stays NULL: this is a club trip. The unique index is
  -- NULLS NOT DISTINCT, so the conflict target matches an existing club row and
  -- can never collide with somebody's private family row.
  INSERT INTO public.coach_travel (tournament_id, coach_name, travel_mode, booking_ok, travel_note, travel_confirmed_at, updated_at)
  VALUES (p_tournament_id, btrim(p_coach_name), p_mode, p_booking_ok, p_note, NOW(), NOW())
  ON CONFLICT (tournament_id, coach_name, private_owner) DO UPDATE
    SET travel_mode         = EXCLUDED.travel_mode,
        booking_ok          = EXCLUDED.booking_ok,
        travel_note         = EXCLUDED.travel_note,
        travel_confirmed_at = NOW(),
        updated_at          = NOW();
END
$$;

REVOKE ALL ON FUNCTION public.confirm_travel_for(bigint, text, text, boolean, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_travel_for(bigint, text, text, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirm_travel_for(bigint, text, text, boolean, text) TO authenticated;

COMMENT ON FUNCTION public.confirm_travel_for IS
  'A coach answers their own fly/drive question for a tournament, creating the coach_travel row if it does not exist yet. Writes only travel_mode, booking_ok, travel_note and travel_confirmed_at.';
