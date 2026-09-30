-- 20260930 — Every DSSC family has a recorded text opt-in (Drew, 30 Sep 2026).
-- The class message already texts everyone except STOP opt-outs; this makes
-- the roster say so too, now and for every row the hourly Playbook pull adds.
-- Run: node scripts/run-sql.mjs migrations/20260930_dssc_sms_consent_all.sql
alter table public.dssc_pod_roster alter column sms_consent set default true;
update public.dssc_pod_roster set sms_consent = true where sms_consent is distinct from true;
select count(*) total, count(*) filter (where sms_consent) consented from public.dssc_pod_roster;
