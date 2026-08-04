-- Migration: let a coach answer their own travel question.
-- Date: 2026-08-04  Additive, idempotent.
-- Run: node scripts/run-sql.mjs migrations/20260804_confirm_travel_rpc.sql
--
-- coach_travel_read_own is SELECT-only, so a non-admin coach could read their
-- trip but not answer it — the update would match zero rows and the UI would
-- claim it saved. Widening that policy to UPDATE would also hand them
-- flight_cost, ticket_number and hotel_cost, which is not what we're asking for.
--
-- So: a SECURITY DEFINER function that touches exactly the four answer columns
-- and nothing else. RLS on the table stays as it is.

CREATE OR REPLACE FUNCTION public.confirm_travel(
  p_id         bigint,
  p_mode       text,
  p_booking_ok boolean,
  p_note       text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_mode IS NOT NULL AND p_mode NOT IN ('fly_club', 'drive', 'fly_own') THEN
    RAISE EXCEPTION 'Unknown travel mode: %', p_mode;
  END IF;

  UPDATE public.coach_travel
     SET travel_mode         = p_mode,
         booking_ok          = p_booking_ok,
         travel_note         = p_note,
         travel_confirmed_at = NOW(),
         updated_at          = NOW()
   WHERE id = p_id
     -- Private family rows are answered by their owner through the normal
     -- policy, never through here.
     AND private_owner IS NULL
     AND (public.is_me_coach(coach_name) OR public.is_admin_coach());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That trip is not yours to confirm.';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.confirm_travel(bigint, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_travel(bigint, text, boolean, text) TO authenticated;

COMMENT ON FUNCTION public.confirm_travel IS
  'A coach answers their own fly/drive question. Writes only travel_mode, booking_ok, travel_note and travel_confirmed_at.';
