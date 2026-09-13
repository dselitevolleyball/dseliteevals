-- Ellie McMullen (players.id 276, 13 Sapphire #14).
--
-- Name: McMullen is correct (Drew, 13 Sep). The 26-27 Regional Teams
-- workbook spells the player "McMullin" but her parents "McMullen", and the
-- parents' own email addresses are laurenmcmullen511 / mikejmcmullen. The
-- master-contacts import on 30 Aug applied the workbook's "McMullin"; Kristen
-- changed it back on 1 Sep. The record already reads McMullen — this migration
-- does not touch the name.
--
-- Details from the workbook the app was missing: school, dominant hand,
-- primary position ("Pin", the short form other players' records use for the
-- workbook's "Pin hitter (right or left side)").

update public.players
   set school_team      = 'St. Michael''s',
       dominant_hand    = 'Right',
       primary_position = 'Pin'
 where id = 276 and first_name = 'Ellie' and last_name = 'McMullen'
   and school_team is null and dominant_hand is null and primary_position is null;

select id, first_name, last_name, team_assignment, jersey_number, school_team, dominant_hand, primary_position, positions
  from public.players where id = 276;
