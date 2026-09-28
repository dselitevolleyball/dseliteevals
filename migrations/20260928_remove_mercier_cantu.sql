-- 20260928 — Matt Mercier and Jessica Cantu off the coaches list (Drew, 28 Sep).
--
-- Matt left in July ("no longer working with us") and was already off the
-- roster; what kept him visible was the reminder-mute row and a gear reminder.
-- Jessica never got a team; she comes off the roster, the pay rates, the gear
-- order, the sign-up allowlist and loses app approval. Clock-in history and
-- email logs are left alone — they are what happened.
--
-- Run: node scripts/run-sql.mjs migrations/20260928_remove_mercier_cantu.sql

delete from public.hours_reminder_excludes where coach_name in ('Matt Mercier', 'Jessica Cantu');
delete from public.coach_gear_reminders     where coach_name in ('Matt Mercier', 'Jessica Cantu');
delete from public.coach_gear               where coach_name = 'Jessica Cantu' or coach_email ilike 'jess.cantu.2012@gmail.com';
delete from public.coach_rates              where coach_name = 'Jessica Cantu';
delete from public.allowed_signup_emails    where email ilike 'jess.cantu.2012@gmail.com';
update public.coaches set is_approved = false where email ilike 'jess.cantu.2012@gmail.com';
delete from public.coach_roster             where id = 22 and last_name = 'Cantu';   -- cascades coach_privates / asks

select (select count(*) from public.coach_roster where last_name in ('Mercier','Cantu')) as roster_left,
       (select count(*) from public.hours_reminder_excludes where coach_name in ('Matt Mercier','Jessica Cantu')) as mutes_left;
