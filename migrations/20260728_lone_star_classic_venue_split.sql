-- 20260728 — Split the Lone Star Classic JNQ weekends by playing site.
--
-- Each LSC weekend runs simultaneously in two or three cities. They were stored
-- as ONE row per weekend with a mashed-up location ("Dallas / Houston, TX /
-- Oklahoma City, OK") and the real split buried in free-text notes. That string
-- is what api/calendar.js puts in the ICS LOCATION, so every team's SportsYou
-- calendar showed all three cities.
--
-- One row per weekend PER SITE. The busiest site at each weekend keeps the
-- original id so the ICS UID (<team>-tn-<id>@dseliteevals) stays stable for the
-- most teams; only teams that actually move get a new UID.
--
-- Teams follow their division: tournament_assignments.division is the USAV tier
-- ("USA", "Select"), tournaments.entries are "<age> <tier>" tokens. Assignments
-- are re-pointed, never deleted, so coach overrides, sub coaches, notes and
-- locked status all survive.
--
-- Run: node scripts/run-sql.mjs migrations/20260728_lone_star_classic_venue_split.sql
-- No DDL, no DELETEs — UPDATEs plus four INSERTs.

BEGIN;

--------------------------------------------------------------------------------
-- WEEKEND 1 — Apr 2–4, 2027.  id 192 keeps Oklahoma City; Dallas is new.
--   OKC    13 Open / 13 USA / 13 American  → 13 Diamond, 13 Ruby
--   Dallas all 12s                         → 12 Diamond, 12 Ruby
-- Venues not yet published by LSC for either site — left NULL.
--------------------------------------------------------------------------------
UPDATE public.tournaments SET
  name       = 'Lone Star Classic Girls Junior National Qualifier Weekend 1 — Oklahoma City',
  location   = 'Oklahoma City, OK',
  age_low    = 13,
  age_high   = 13,
  entries    = ARRAY['13 Open','13 USA','13 American'],
  wish_list  = ARRAY[]::text[],
  notes      = NULL,
  updated_at = NOW()
WHERE id = 192;

WITH src AS (SELECT * FROM public.tournaments WHERE id = 192),
ins AS (
  INSERT INTO public.tournaments (
    name, start_date, end_date, location, venue, age_low, age_high, gender,
    divisions, is_qualifier, qualifier_type, format, status, source_url, source,
    cost, registration_deadline, notes, cancelled, wish_list, entries, tags,
    hidden_tags, stay_over, registration_opens, registration_platform,
    registration_opens_time, stay_to_play, housing_opens, housing_opens_time, housing_url
  )
  SELECT
    'Lone Star Classic Girls Junior National Qualifier Weekend 1 — Dallas',
    start_date, end_date, 'Dallas, TX', NULL, 12, 12, gender,
    divisions, is_qualifier, qualifier_type, format, status, source_url, source,
    cost, registration_deadline, NULL, false,
    ARRAY['12 Diamond','12 Ruby'], ARRAY['12 National','12 USA','12 American'],
    tags, hidden_tags, stay_over, registration_opens, registration_platform,
    registration_opens_time, stay_to_play, housing_opens, housing_opens_time, housing_url
  FROM src RETURNING id
)
UPDATE public.tournament_assignments a SET tournament_id = ins.id
FROM ins WHERE a.tournament_id = 192 AND a.team_id IN ('12 Diamond','12 Ruby');

--------------------------------------------------------------------------------
-- WEEKEND 2 — Apr 9–11, 2027.  id 196 keeps the OKC Convention Center group.
--   OKC Convention Ctr  14 USA / Liberty / Premier / Select
--                       → 14 Diamond, 14 Ruby, 14 Emerald, 14 Topaz
--   Bennett Event Ctr   14 American                → 14 Sapphire
--   Kay Bailey Hutchison 13 Liberty / 13 Select / 11 National
--                       → 13 Sapphire, 13 Emerald, 11 Diamond
--------------------------------------------------------------------------------
UPDATE public.tournaments SET
  name       = 'Lone Star Classic Girls Junior National Qualifier Weekend 2 — Oklahoma City (Convention Center)',
  location   = 'Oklahoma City, OK',
  venue      = 'Oklahoma City Convention Center',
  age_low    = 14,
  age_high   = 14,
  entries    = ARRAY['14 USA','14 Liberty','14 Premier','14 Select'],
  wish_list  = ARRAY['14 Diamond'],
  notes      = NULL,
  updated_at = NOW()
WHERE id = 196;

WITH src AS (SELECT * FROM public.tournaments WHERE id = 196),
ins AS (
  INSERT INTO public.tournaments (
    name, start_date, end_date, location, venue, age_low, age_high, gender,
    divisions, is_qualifier, qualifier_type, format, status, source_url, source,
    cost, registration_deadline, notes, cancelled, wish_list, entries, tags,
    hidden_tags, stay_over, registration_opens, registration_platform,
    registration_opens_time, stay_to_play, housing_opens, housing_opens_time, housing_url
  )
  SELECT
    'Lone Star Classic Girls Junior National Qualifier Weekend 2 — Oklahoma City (Bennett Event Center)',
    start_date, end_date, 'Oklahoma City, OK', 'Bennett Event Center', 14, 14, gender,
    divisions, is_qualifier, qualifier_type, format, status, source_url, source,
    cost, registration_deadline, NULL, false,
    ARRAY[]::text[], ARRAY['14 American'],
    tags, hidden_tags, stay_over, registration_opens, registration_platform,
    registration_opens_time, stay_to_play, housing_opens, housing_opens_time, housing_url
  FROM src RETURNING id
)
UPDATE public.tournament_assignments a SET tournament_id = ins.id
FROM ins WHERE a.tournament_id = 196 AND a.team_id IN ('14 Sapphire');

WITH src AS (SELECT * FROM public.tournaments WHERE id = 196),
ins AS (
  INSERT INTO public.tournaments (
    name, start_date, end_date, location, venue, age_low, age_high, gender,
    divisions, is_qualifier, qualifier_type, format, status, source_url, source,
    cost, registration_deadline, notes, cancelled, wish_list, entries, tags,
    hidden_tags, stay_over, registration_opens, registration_platform,
    registration_opens_time, stay_to_play, housing_opens, housing_opens_time, housing_url
  )
  SELECT
    'Lone Star Classic Girls Junior National Qualifier Weekend 2 — Dallas',
    start_date, end_date, 'Dallas, TX', 'Kay Bailey Hutchison Convention Center', 10, 13, gender,
    divisions, is_qualifier, qualifier_type, format, status, source_url, source,
    cost, registration_deadline, NULL, false,
    ARRAY[]::text[], ARRAY['13 Liberty','13 Select','11 National'],
    tags, hidden_tags, stay_over, registration_opens, registration_platform,
    registration_opens_time, stay_to_play, housing_opens, housing_opens_time, housing_url
  FROM src RETURNING id
)
UPDATE public.tournament_assignments a SET tournament_id = ins.id
FROM ins WHERE a.tournament_id = 196 AND a.team_id IN ('13 Sapphire','13 Emerald','11 Diamond');

--------------------------------------------------------------------------------
-- WEEKEND 3 — Apr 16–18, 2027.  id 200 keeps Houston (George R. Brown).
--   Houston  16 Open/USA/Liberty, 15 Open/USA/Liberty, 14 Open, all 17s
--            → 15 Diamond, 16 Diamond, 17 Diamond
--   OKC      16 Club, 15 Premier/Select/Club, 14 Club, 13 Club
--            → 15 Emerald, 15 Sapphire
--   Dallas   15 American                     → 15 Ruby
--------------------------------------------------------------------------------
UPDATE public.tournaments SET
  name       = 'Lone Star Classic Girls Junior National Qualifier Weekend 3 — Houston',
  location   = 'Houston, TX',
  venue      = 'George R. Brown Convention Center',
  age_low    = 14,
  age_high   = 17,
  entries    = ARRAY['17 Open','17 USA','17 American','17 Liberty','17 Premier','17 Select','17 Club',
                     '16 Open','16 USA','16 Liberty','15 Open','15 USA','15 Liberty','14 Open'],
  wish_list  = ARRAY['17 Diamond/Ruby','16 Diamond','15 Diamond'],
  notes      = NULL,
  updated_at = NOW()
WHERE id = 200;

WITH src AS (SELECT * FROM public.tournaments WHERE id = 200),
ins AS (
  INSERT INTO public.tournaments (
    name, start_date, end_date, location, venue, age_low, age_high, gender,
    divisions, is_qualifier, qualifier_type, format, status, source_url, source,
    cost, registration_deadline, notes, cancelled, wish_list, entries, tags,
    hidden_tags, stay_over, registration_opens, registration_platform,
    registration_opens_time, stay_to_play, housing_opens, housing_opens_time, housing_url
  )
  SELECT
    'Lone Star Classic Girls Junior National Qualifier Weekend 3 — Oklahoma City',
    start_date, end_date, 'Oklahoma City, OK', 'Oklahoma City Convention Center', 13, 16, gender,
    divisions, is_qualifier, qualifier_type, format, status, source_url, source,
    cost, registration_deadline, NULL, false,
    ARRAY['15 Sapphire','15 Emerald'],
    ARRAY['16 Club','15 Premier','15 Select','15 Club','14 Club','13 Club'],
    tags, hidden_tags, stay_over, registration_opens, registration_platform,
    registration_opens_time, stay_to_play, housing_opens, housing_opens_time, housing_url
  FROM src RETURNING id
)
UPDATE public.tournament_assignments a SET tournament_id = ins.id
FROM ins WHERE a.tournament_id = 200 AND a.team_id IN ('15 Emerald','15 Sapphire');

WITH src AS (SELECT * FROM public.tournaments WHERE id = 200),
ins AS (
  INSERT INTO public.tournaments (
    name, start_date, end_date, location, venue, age_low, age_high, gender,
    divisions, is_qualifier, qualifier_type, format, status, source_url, source,
    cost, registration_deadline, notes, cancelled, wish_list, entries, tags,
    hidden_tags, stay_over, registration_opens, registration_platform,
    registration_opens_time, stay_to_play, housing_opens, housing_opens_time, housing_url
  )
  SELECT
    'Lone Star Classic Girls Junior National Qualifier Weekend 3 — Dallas',
    start_date, end_date, 'Dallas, TX', 'Kay Bailey Hutchison Convention Center', 15, 15, gender,
    divisions, is_qualifier, qualifier_type, format, status, source_url, source,
    cost, registration_deadline, NULL, false,
    ARRAY['15 Ruby'], ARRAY['15 American'],
    tags, hidden_tags, stay_over, registration_opens, registration_platform,
    registration_opens_time, stay_to_play, housing_opens, housing_opens_time, housing_url
  FROM src RETURNING id
)
UPDATE public.tournament_assignments a SET tournament_id = ins.id
FROM ins WHERE a.tournament_id = 200 AND a.team_id IN ('15 Ruby');

COMMIT;
