-- A practice slot that only runs for part of its phase (Oct 2026: 14 Sapphire
-- practices Mondays through Jan 31, then Thursdays once basketball is over).
-- Empty = the whole phase. Read by api/calendar.js (the SportsYou feed),
-- shared/day-schedule.js (Day Schedule, coach clock-in), api/weekly-schedule.js
-- and api/site-data.js (the website's team pages).
alter table public.practice_assignments add column if not exists active_from date;
alter table public.practice_assignments add column if not exists active_to date;
