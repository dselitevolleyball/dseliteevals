-- 20260624 — Rename player team_assignment codes to real team names.
--
-- Player placements used tryout codes (14-1, 14-2 …) while the teams are named
-- descriptively (14 Diamond, 14 Ruby …), so the two never matched. This maps
-- each code to its team name (per Drew's mapping) so Home / team cards / Teams
-- view all line up on one naming system.
--
-- NOTE: 11-2 → "11 Diamond" and 17-1 → "17 Diamond" were inferred (only 11-1
-- and no 17 mapping were given). The Rise teams use the practice_teams names
-- "11 Rise 1" / "12 Rise 1" / "12 Rise 2". Tell me if any of those are off.
--
-- Run once in the Supabase SQL editor. Idempotent (codes won't match after).

UPDATE public.players SET team_assignment = CASE team_assignment
  WHEN '11-1' THEN '11 Rise 1'
  WHEN '11-2' THEN '11 Diamond'
  WHEN '12-1' THEN '12 Diamond'
  WHEN '12-2' THEN '12 Ruby'
  WHEN '12-3' THEN '12 Rise 1'
  WHEN '12-4' THEN '12 Rise 2'
  WHEN '13-1' THEN '13 Diamond'
  WHEN '13-2' THEN '13 Ruby'
  WHEN '13-3' THEN '13 Sapphire'
  WHEN '13-4' THEN '13 Rise'
  WHEN '14-1' THEN '14 Diamond'
  WHEN '14-2' THEN '14 Ruby'
  WHEN '14-3' THEN '14 Sapphire'
  WHEN '14-4' THEN '14 Emerald'
  WHEN '14-5' THEN '14 Topaz'
  WHEN '15-1' THEN '15 Diamond'
  WHEN '15-2' THEN '15 Ruby'
  WHEN '15-3' THEN '15 Sapphire'
  WHEN '15-4' THEN '15 Emerald'
  WHEN '16-1' THEN '16 Diamond'
  WHEN '16-2' THEN '16 Ruby'
  WHEN '17-1' THEN '17 Diamond'
  ELSE team_assignment END
WHERE team_assignment IS NOT NULL AND team_assignment <> '';
