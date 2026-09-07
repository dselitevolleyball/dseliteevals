-- Put Jason Baerwald on Brooklynn's record as the second parent.
--
-- His email was already there as parent_email2, so he has been receiving 12 Ruby
-- mail all along — but parent2_name was blank, so he did not show as a parent
-- anywhere in the app and the coach/parent name match could not find him. Phone
-- normalised to E.164 to match parent_phone on the same row.
update public.players set
  parent2_name  = 'Jason Baerwald',
  parent2_phone = '+15127737244',
  updated_at    = now()
where id = 10;

select id, first_name, last_name, team_assignment,
       parent_name, parent_email, parent_phone,
       parent2_name, parent2_phone, parent_email2
from public.players where id = 10;
