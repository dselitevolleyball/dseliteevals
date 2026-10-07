-- 2027 AAU Girls Junior National Championships, Orange County Convention
-- Center, Orlando — five age waves (from the AAU wave graphic, Oct 2026).
insert into public.tournaments (name, start_date, end_date, location, venue, age_low, age_high, gender, is_qualifier, stay_over, aau, source, format, divisions, entries, wish_list)
select v.name, v.s::date, v.e::date, 'Orlando, FL', 'Orange County Convention Center', v.lo, v.hi, 'Female', false, true, true, 'manual', 'Four Day Format',
       '{}'::text[], v.entries, '{}'::text[]
from (values
  ('AAU Nationals Wave 1', '2027-06-13', '2027-06-16', 10, 18, array['10 Girls','11 Open','11 Club','12 Open','12 Premier','12 Club','12 Classic','13 Open','13 Premier','13 Elite','13 Club','13 Aspire','13 Spirit','18 Club','18 Classic']),
  ('AAU Nationals Wave 2', '2027-06-17', '2027-06-20', 14, 14, array['14 Open','14 Premier','14 Elite','14 Select','14 Ascend','14 Club','14 Aspire','14 Spirit']),
  ('AAU Nationals Wave 3', '2027-06-21', '2027-06-24', 15, 15, array['15 Open','15 Premier','15 Elite','15 Select','15 Ascend','15 Club','15 Aspire','15 Spirit']),
  ('AAU Nationals Wave 4', '2027-06-25', '2027-06-28', 16, 17, array['16 Open','16 Premier','16 Elite','16 Select','16 Ascend','16 Club','16 Aspire','17 Open','17 Premier','17 Elite','17 Ascend','17 Club','17 Aspire','17 Spirit','17 Classic']),
  ('AAU Nationals Wave 5', '2027-06-30', '2027-07-03', 13, 16, array['13 Classic','14 Classic','15 Classic','16 Classic','16 Spirit'])
) as v(name, s, e, lo, hi, entries)
where not exists (select 1 from public.tournaments t where t.name = v.name);
select id, name, start_date, end_date, array_length(entries,1) n from public.tournaments where name like 'AAU Nationals Wave %' order by start_date;
