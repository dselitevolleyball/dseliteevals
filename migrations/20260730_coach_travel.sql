-- 20260730 — Coach travel for stay-over tournaments: flights and hotel rooms.
--
-- Hotels are modelled as ROOMS rather than per-coach fields, because all three
-- real cases have to work:
--   * one coach alone on a room
--   * two coaches sharing a room  -> two coach_travel rows, same room_id
--   * the club splitting a coach's share -> hotel_cost vs hotel_club_pays
-- Cost lives per coach, not per room, so a shared room can be split unevenly
-- and the club can cover different amounts for different coaches.
--
-- Flights are deliberately simple (airline, out date, back date, cost,
-- confirmation) — per-leg times were considered and dropped.
--
-- Admins write everything. An approved coach may read only their OWN travel
-- row, matched on either their login display_name or their coach_roster name,
-- because the two disagree for several coaches (britneyaparker vs Britney
-- Parker). Costs for other coaches are never readable.
--
-- Run: node scripts/run-sql.mjs migrations/20260730_coach_travel.sql
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS public.coach_travel_rooms (
  id            BIGSERIAL   PRIMARY KEY,
  tournament_id BIGINT      NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  hotel_name    TEXT,
  confirmation  TEXT,
  check_in      DATE,
  check_out     DATE,
  total_cost    NUMERIC,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS coach_travel_rooms_tn_idx ON public.coach_travel_rooms (tournament_id);

CREATE TABLE IF NOT EXISTS public.coach_travel (
  id              BIGSERIAL   PRIMARY KEY,
  tournament_id   BIGINT      NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  coach_name      TEXT        NOT NULL,
  airline         TEXT,
  depart_date     DATE,
  return_date     DATE,
  flight_cost     NUMERIC,
  ticket_number   TEXT,
  room_id         BIGINT      REFERENCES public.coach_travel_rooms(id) ON DELETE SET NULL,
  hotel_cost      NUMERIC,    -- this coach's share of the room
  hotel_club_pays NUMERIC,    -- how much of that share the club covers
  notes           TEXT,
  updated_by      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tournament_id, coach_name)
);
CREATE INDEX IF NOT EXISTS coach_travel_tn_idx ON public.coach_travel (tournament_id);

ALTER TABLE public.coach_travel       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_travel_rooms ENABLE ROW LEVEL SECURITY;

-- Does the current user's identity resolve to this coach name? Checks the login
-- display_name first, then the coach_roster row matched by email.
CREATE OR REPLACE FUNCTION public.is_me_coach(p_name TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.coaches c
    WHERE c.id = auth.uid() AND c.is_approved
      AND (
        lower(btrim(c.display_name)) = lower(btrim(p_name))
        OR EXISTS (
          SELECT 1 FROM public.coach_roster r
          WHERE lower(btrim(r.email)) = lower(btrim(c.email))
            AND lower(btrim(coalesce(r.first_name,'') || ' ' || coalesce(r.last_name,''))) = lower(btrim(p_name))
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin_coach()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved AND c.is_admin);
$$;

DROP POLICY IF EXISTS coach_travel_admin_all ON public.coach_travel;
CREATE POLICY coach_travel_admin_all ON public.coach_travel FOR ALL
  USING (public.is_admin_coach()) WITH CHECK (public.is_admin_coach());

DROP POLICY IF EXISTS coach_travel_read_own ON public.coach_travel;
CREATE POLICY coach_travel_read_own ON public.coach_travel FOR SELECT
  USING (public.is_me_coach(coach_name));

DROP POLICY IF EXISTS coach_travel_rooms_admin_all ON public.coach_travel_rooms;
CREATE POLICY coach_travel_rooms_admin_all ON public.coach_travel_rooms FOR ALL
  USING (public.is_admin_coach()) WITH CHECK (public.is_admin_coach());

-- A coach can see a room only if they're actually in it.
DROP POLICY IF EXISTS coach_travel_rooms_read_own ON public.coach_travel_rooms;
CREATE POLICY coach_travel_rooms_read_own ON public.coach_travel_rooms FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.coach_travel t
    WHERE t.room_id = coach_travel_rooms.id AND public.is_me_coach(t.coach_name)
  ));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='coach_travel') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.coach_travel;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='coach_travel_rooms') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.coach_travel_rooms;
  END IF;
END $$;
