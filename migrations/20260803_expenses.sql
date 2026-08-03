-- 20260803 — Expense ledger: the actuals behind the finance model.
--
-- Mirrors the sheet Drew has been keeping by hand (What / Team / Item / Date /
-- Cost / Account / Paid / Reimbursed / Payment Method) so last season imports
-- cleanly, but splits the "Team" column in two:
--
--   allocation  — exactly what the sheet said: "14 Diamond", "All Teams",
--                 "Overhead", "Marketing", "Meals"…
--   team_name   — set only when the allocation IS a real team, so per-team
--                 roll-ups are a join rather than string-matching every time.
--
-- Rows allocated to "All Teams" or a cost centre carry a NULL team_name and are
-- club overhead; spreading those across teams is a reporting decision, not a
-- storage one, so it isn't baked in here.
--
-- Run: node scripts/run-sql.mjs migrations/20260803_expenses.sql
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS public.expenses (
  id             BIGSERIAL   PRIMARY KEY,
  season         TEXT        NOT NULL DEFAULT '2026-27',
  category       TEXT        NOT NULL,          -- Tournament, Travel, Uniforms, Courts, G&A…
  allocation     TEXT,                          -- verbatim from the sheet
  team_name      TEXT,                          -- resolved team, NULL = club/overhead
  item           TEXT,
  expense_date   DATE,
  amount         NUMERIC     NOT NULL DEFAULT 0,
  account        TEXT,
  paid           BOOLEAN     NOT NULL DEFAULT false,
  reimbursed     BOOLEAN,
  payment_method TEXT,
  tournament_id  BIGINT      REFERENCES public.tournaments(id) ON DELETE SET NULL,
  notes          TEXT,
  source         TEXT        NOT NULL DEFAULT 'manual',  -- manual | import | aes | email
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS expenses_season_idx   ON public.expenses (season);
CREATE INDEX IF NOT EXISTS expenses_team_idx     ON public.expenses (team_name) WHERE team_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS expenses_category_idx ON public.expenses (category);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
-- Money is admin-only, like the Hawaii tracker.
DROP POLICY IF EXISTS expenses_admin ON public.expenses;
CREATE POLICY expenses_admin ON public.expenses FOR ALL
  USING (public.is_admin_coach()) WITH CHECK (public.is_admin_coach());

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='expenses') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.expenses;
  END IF;
END $$;
