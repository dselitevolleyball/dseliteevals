-- Drew's own post ideas ("Make me a post looking for players for our 11 Regional
-- team..."), written by Claude from the club's facts: a new idea kind.
alter table public.dse_social_ideas drop constraint if exists dse_social_ideas_kind_check;
alter table public.dse_social_ideas add constraint dse_social_ideas_kind_check
  check (kind in ('birthday', 'tournament', 'schedule', 'holiday', 'meme', 'trend', 'engagement', 'throwback', 'custom'));
