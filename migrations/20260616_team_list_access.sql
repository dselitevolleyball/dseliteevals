-- 20260616 — Per-coach "team lists" access flag.
--
-- Adds coaches.can_view_teams. The app gates the Teams tab on this flag
-- (the owner, Drew, always has access via a code-level override). Existing
-- coaches keep their current access; brand-new signups default to NO team
-- access until granted from the Coaches screen.
--
-- Run once in the Supabase SQL editor. Additive, non-destructive, and
-- idempotent — the one-time "grant existing coaches" step only runs the first
-- time the column is created, so re-running won't undo any access you revoke.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'coaches' AND column_name = 'can_view_teams'
  ) THEN
    ALTER TABLE public.coaches ADD COLUMN can_view_teams BOOLEAN NOT NULL DEFAULT FALSE;
    -- Preserve access for everyone who already has an account at rollout time.
    UPDATE public.coaches SET can_view_teams = TRUE;
  END IF;
END $$;
