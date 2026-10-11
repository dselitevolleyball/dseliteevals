-- Serve grader (Drew, Oct 11 2026): a miss is graded like any serve - accuracy 0
-- plus a toughness 1-3 (a nasty serve that just missed is still nasty). Score
-- stays accuracy x toughness. Rows saved before this change (miss, no
-- toughness) stay valid.
-- Run: node scripts/run-sql.mjs migrations/20261011_serve_reps_miss_toughness.sql --force
alter table public.serve_reps drop constraint if exists serve_reps_check;
alter table public.serve_reps add constraint serve_reps_check check (
  (toughness is null and accuracy = 0 and score = 0)
  or (toughness is not null and score = accuracy * toughness)
);
select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.serve_reps'::regclass and conname = 'serve_reps_check';
