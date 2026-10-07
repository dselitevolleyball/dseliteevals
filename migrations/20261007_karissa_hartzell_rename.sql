-- Karissa Lee → Karissa Hartzell (married name, roster updated Sep 2026).
-- Team, float, sub, travel, pay, gear and request rows were still keyed on
-- "Karissa Lee", so the Travel tab and other screens didn't link her roster
-- card. Logs (email_log, sms_messages, clinic_reminder_log) stay as sent.
begin;
update teams            set head_coach = 'Karissa Hartzell' where head_coach = 'Karissa Lee';
update teams            set assistant_coach = 'Karissa Hartzell' where assistant_coach = 'Karissa Lee';
update practice_teams   set head_coach = 'Karissa Hartzell' where head_coach = 'Karissa Lee';
update practice_teams   set assistant_coach = 'Karissa Hartzell' where assistant_coach = 'Karissa Lee';
update coach_floats     set coach_name = 'Karissa Hartzell' where coach_name = 'Karissa Lee';
update practice_coverage set coach_out = 'Karissa Hartzell' where coach_out = 'Karissa Lee';
update practice_coverage set sub_name  = 'Karissa Hartzell' where sub_name  = 'Karissa Lee';
update coach_travel     set coach_name = 'Karissa Hartzell' where coach_name = 'Karissa Lee';
update coach_rates      set coach_name = 'Karissa Hartzell' where coach_name = 'Karissa Lee';
update coach_checkins   set coach_name = 'Karissa Hartzell' where coach_name = 'Karissa Lee';
update team_kickoff_requests set coach_name = 'Karissa Hartzell' where coach_name = 'Karissa Lee';
update expenses         set submitted_by = 'Karissa Hartzell' where submitted_by = 'Karissa Lee';
update expenses         set reimburse_to = 'Karissa Hartzell' where reimburse_to = 'Karissa Lee';
update sms_threads      set contact_name = 'Karissa Hartzell' where contact_name = 'Karissa Lee';
update day_plan_texts   set coach_name = 'Karissa Hartzell', person_key = 'karissa hartzell' where coach_name = 'Karissa Lee';
update coach_gear_reminders set coach_name = 'Karissa Hartzell' where coach_name = 'Karissa Lee';
-- Her Sep 30 gear form is already under Hartzell; the July one is superseded.
delete from coach_gear where coach_name = 'Karissa Lee' and exists (select 1 from coach_gear where coach_name = 'Karissa Hartzell');
update email_templates  set body = replace(body, 'Karissa Lee', 'Karissa Hartzell') where body like '%Karissa Lee%';
commit;
