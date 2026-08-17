-- One payment per coach per stretch of time.
--
-- A coach holding both a float block and a sub assignment for the same two
-- hours could log both and be paid twice; it happened twice in the week of
-- Aug 10, 2026. The app now refuses the second check-in, but the app is not
-- the only way rows land here (two devices racing, an admin add, a future
-- import), so the rule belongs in the database too.
--
-- Scoped to (coach, date, slot) rather than true time-overlap: slots are the
-- fixed 2-hour blocks, so an exact repeat of the same block is the case that
-- actually occurred and the one expressible as an index. Overlap across
-- DIFFERENT labels (a 1-hour float inside a 2-hour block) stays the app's job.
--
-- Case- and whitespace-insensitive on the name, because check-ins arrive with
-- the coach's own typing ("ella hinkle" vs "Ella Hinkle").
--
-- Rows with no slot are left alone: admin-added shifts legitimately carry a
-- null slot, and NULLs never collide in a unique index anyway.
--
-- Verified before writing this: 228 existing check-ins, 0 violations, so the
-- index builds without needing any cleanup first.

create unique index if not exists coach_checkins_one_per_slot
  on public.coach_checkins (lower(btrim(coach_name)), check_date, slot)
  where slot is not null;

comment on index public.coach_checkins_one_per_slot is
  'Stops the same coach being paid twice for one time block (e.g. logged as both sub and float).';
