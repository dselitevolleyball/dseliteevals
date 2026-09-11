-- Did each signer go through the commitment at orientation, in person?
--
-- The commitment is written to be walked through live: Drew on the court,
-- families on their phones. A family that signs at home three days later has
-- agreed to the same words without hearing any of the context around them,
-- and Drew wants to know which families those are so he can follow up.
--
-- One answer per side, not per family. The player and parent sign separately,
-- often on different phones, and it is ordinary for the girl to be there with
-- one parent while the other signs from home that night.
--
-- 'live'      — was at orientation in person
-- 'not_live'  — couldn't make it
-- NULL        — signed before this question existed

alter table player_commitments
  add column if not exists player_attended text check (player_attended in ('live','not_live')),
  add column if not exists parent_attended text check (parent_attended in ('live','not_live'));
