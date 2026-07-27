-- 20260727 — Coach gear sizing.
-- One row per coach, holding the sizes needed to order staff gear. Keyed on
-- coach_name (not an id) so it joins the same way every other coach table does,
-- and so a coach with an app account but no roster row still has somewhere to
-- put their answers.
--
-- Style columns are kept separate from size columns ("M" + "hoodie" rather than
-- "M hoodie") so the export can be handed to a supplier as clean columns.
-- Run: node scripts/run-sql.mjs migrations/20260727_coach_gear.sql
-- Additive, idempotent.

CREATE TABLE IF NOT EXISTS public.coach_gear (
  coach_name        text PRIMARY KEY,
  coach_email       text,
  shoe_size         text,   -- e.g. "9.5"
  shoe_gender       text,   -- mens | womens
  tshirt_size       text,   -- unisex XS–3XL
  sweatshirt_size   text,
  sweatshirt_style  text,   -- crew | hoodie
  longsleeve_size   text,
  longsleeve_style  text,   -- crew | hooded
  backpack_name     text,   -- what goes on the bag, e.g. "Coach Drew"
  submitted_at      timestamptz,
  updated_at        timestamptz DEFAULT now()
);

ALTER TABLE public.coach_gear ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS coach_gear_all_approved ON public.coach_gear;
CREATE POLICY coach_gear_all_approved ON public.coach_gear
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));

-- Tracks that a reminder went out, so the daily nudge can report who has been
-- chased and how often without re-reading the mail log.
CREATE TABLE IF NOT EXISTS public.coach_gear_reminders (
  id          bigserial PRIMARY KEY,
  coach_name  text NOT NULL,
  channel     text NOT NULL,   -- push | email
  sent_at     timestamptz DEFAULT now()
);

ALTER TABLE public.coach_gear_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS coach_gear_reminders_all_approved ON public.coach_gear_reminders;
CREATE POLICY coach_gear_reminders_all_approved ON public.coach_gear_reminders
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));
