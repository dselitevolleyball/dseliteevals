-- Privates asks remember which message went (first | update | reminder), so the
-- Privates screen can say "reminded 2d ago" and not just "asked".
alter table public.coach_privates_asks add column if not exists kind text;
