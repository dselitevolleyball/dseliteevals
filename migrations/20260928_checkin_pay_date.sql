-- 20260928 — A shift can be paid in a later week than the day it happened.
--
-- A correction used to be moved onto a date inside the week being paid, which
-- made the ledger say training happened on the 26th when it happened on the
-- 12th. Now the shift keeps its real check_date and carries pay_date: the day
-- inside the pay week it belongs to. Every pay-week query reads
-- coalesce(pay_date, check_date); everything about the day itself reads
-- check_date.
--
-- Run: node scripts/run-sql.mjs migrations/20260928_checkin_pay_date.sql

alter table public.coach_checkins add column if not exists pay_date date;
create index if not exists coach_checkins_pay_date_idx on public.coach_checkins(pay_date) where pay_date is not null;

-- The two coaches-training weeks: back on their real Saturdays, paid on the
-- 21–27 Sep sheet.
update public.coach_checkins
   set check_date = case when note like 'CORRECTION for 9/12:%' then date '2026-09-12' else date '2026-09-19' end,
       pay_date   = date '2026-09-27',
       phase      = case when note like 'CORRECTION for 9/12:%' then 'summer' else 'fall1' end,
       note       = regexp_replace(note, '^CORRECTION for 9/1[29]: ', '')
 where id in (645,646,647,648,649,650,651,652,653,654,655,656) and role = 'training' and paid = false;

select check_date, pay_date, count(*) from public.coach_checkins where role = 'training' and pay_date is not null group by 1, 2 order by 1;
