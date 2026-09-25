-- 20260925 — Heather Davis confirmed as 14 Ruby team parent; Jessica Cantu's
-- account named properly so team matching can find her.
--
-- Heather signed up through the kickoff form on 15 Sep (row 86) but was never
-- confirmed, so the coach view still showed her as "offered". Drew confirmed
-- her directly. Phone copied from Belle's player record.
--
-- Jessica's coaches row was created from her Gmail local-part
-- ("jess.cantu.2012"), which never matches "Jessica Cantu" on a team row, so
-- nothing team-targeted could reach her account.
--
-- Run: node scripts/run-sql.mjs migrations/20260925_heather_davis_team_parent.sql
-- Idempotent.

UPDATE public.team_volunteers
   SET role = 'team_parent', confirmed = true, confirmed_by = 'Drew Rose',
       confirmed_at = COALESCE(confirmed_at, now()),
       phone = COALESCE(phone, '+13039957403'), updated_at = now()
 WHERE team_name = '14 Ruby' AND lower(name) = 'heather davis';

UPDATE public.coaches SET display_name = 'Jessica Cantu'
 WHERE lower(email) = 'jess.cantu.2012@gmail.com' AND display_name <> 'Jessica Cantu';
