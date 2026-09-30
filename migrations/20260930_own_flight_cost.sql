-- 20260930 — A coach who books her own flight says what it cost.
--
-- "Fly — I'll book my own" is reimbursed up to what the club paid for
-- everyone else's ticket on that trip, but there was nowhere to record her
-- fare, so the tournament's cost and her reimbursement were both unknown.
-- The fare lives in coach_travel.flight_cost (the column a club-bought
-- deviation already uses). This lets the coach herself write that one number
-- for her own trip; admins can write it for anyone.
--
-- Run: node scripts/run-sql.mjs migrations/20260930_own_flight_cost.sql

CREATE OR REPLACE FUNCTION public.set_own_flight_cost(
  p_tournament_id bigint,
  p_coach_name    text,
  p_cost          numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (public.is_me_coach(p_coach_name) OR public.is_admin_coach()) THEN
    RAISE EXCEPTION 'That trip is not yours to edit.';
  END IF;
  IF p_cost IS NOT NULL AND (p_cost < 0 OR p_cost > 20000) THEN
    RAISE EXCEPTION 'That fare does not look right: %', p_cost;
  END IF;
  UPDATE public.coach_travel
     SET flight_cost = p_cost, updated_at = NOW()
   WHERE tournament_id = p_tournament_id AND coach_name = btrim(p_coach_name)
     AND private_owner IS NULL AND travel_mode = 'fly_own';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pick "Fly — I''ll book my own" for this trip first.';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.set_own_flight_cost(bigint, text, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_own_flight_cost(bigint, text, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_own_flight_cost(bigint, text, numeric) TO authenticated;
