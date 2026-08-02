-- 20260802 — Private (family) travellers, and adding a coach to a tournament
-- their team isn't attending.
--
-- Two changes:
--
-- 1. private_owner. A row with private_owner set is visible ONLY to that user —
--    not to other admins. Drew tracks flights and hotels for Ashley and Emilia
--    and nobody else in the club should see them, so this is enforced in RLS
--    rather than by hiding it in the UI. NULL = ordinary club travel.
--
-- 2. traveler_type. 'coach' (default) or 'family'. Family rows are excluded
--    from the club cost totals — they're personal spend, not club spend.
--
-- The unique key gains private_owner with NULLS NOT DISTINCT (PG15+), so two
-- club rows for one coach are still blocked, while a club "Ashley" and Drew's
-- private "Ashley" can coexist.
--
-- Run: node scripts/run-sql.mjs migrations/20260802_private_and_manual_travel.sql
-- Additive and idempotent.

ALTER TABLE public.coach_travel       ADD COLUMN IF NOT EXISTS private_owner uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.coach_travel       ADD COLUMN IF NOT EXISTS traveler_type text NOT NULL DEFAULT 'coach';
ALTER TABLE public.coach_travel_rooms ADD COLUMN IF NOT EXISTS private_owner uuid REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.coach_travel DROP CONSTRAINT IF EXISTS coach_travel_tournament_id_coach_name_key;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coach_travel_tn_name_owner_key') THEN
    ALTER TABLE public.coach_travel
      ADD CONSTRAINT coach_travel_tn_name_owner_key
      UNIQUE NULLS NOT DISTINCT (tournament_id, coach_name, private_owner);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS coach_travel_private_idx       ON public.coach_travel (private_owner)       WHERE private_owner IS NOT NULL;
CREATE INDEX IF NOT EXISTS coach_travel_rooms_private_idx ON public.coach_travel_rooms (private_owner) WHERE private_owner IS NOT NULL;

-- ── RLS: club rows behave as before; private rows belong to one user only ──
DROP POLICY IF EXISTS coach_travel_admin_all  ON public.coach_travel;
DROP POLICY IF EXISTS coach_travel_read_own   ON public.coach_travel;
DROP POLICY IF EXISTS coach_travel_private    ON public.coach_travel;

CREATE POLICY coach_travel_admin_all ON public.coach_travel FOR ALL
  USING (public.is_admin_coach() AND private_owner IS NULL)
  WITH CHECK (public.is_admin_coach() AND private_owner IS NULL);

-- Your own private rows: full control, invisible to everyone else including
-- other admins.
CREATE POLICY coach_travel_private ON public.coach_travel FOR ALL
  USING (private_owner = auth.uid())
  WITH CHECK (private_owner = auth.uid());

CREATE POLICY coach_travel_read_own ON public.coach_travel FOR SELECT
  USING (private_owner IS NULL AND public.is_me_coach(coach_name));

DROP POLICY IF EXISTS coach_travel_rooms_admin_all ON public.coach_travel_rooms;
DROP POLICY IF EXISTS coach_travel_rooms_read_own  ON public.coach_travel_rooms;
DROP POLICY IF EXISTS coach_travel_rooms_private   ON public.coach_travel_rooms;

CREATE POLICY coach_travel_rooms_admin_all ON public.coach_travel_rooms FOR ALL
  USING (public.is_admin_coach() AND private_owner IS NULL)
  WITH CHECK (public.is_admin_coach() AND private_owner IS NULL);

CREATE POLICY coach_travel_rooms_private ON public.coach_travel_rooms FOR ALL
  USING (private_owner = auth.uid())
  WITH CHECK (private_owner = auth.uid());

CREATE POLICY coach_travel_rooms_read_own ON public.coach_travel_rooms FOR SELECT
  USING (private_owner IS NULL AND EXISTS (
    SELECT 1 FROM public.coach_travel t
    WHERE t.room_id = coach_travel_rooms.id AND public.is_me_coach(t.coach_name)
  ));

COMMENT ON COLUMN public.coach_travel.private_owner IS
  'Visible only to this auth user. NULL = club travel, visible to admins.';
COMMENT ON COLUMN public.coach_travel.traveler_type IS
  'coach | family. Family rows are excluded from club cost totals.';
