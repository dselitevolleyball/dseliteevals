-- Migration: tournament planning foundation
-- Date: 2026-05-25
--
-- Adds 4 tables and seeds them with the 26-27 team roster + USAV tournament
-- list provided 2026-05-25. RLS: approved coaches can read everything; for
-- tournaments + assignments any approved coach can also write (the planning
-- is collaborative), but only admins can edit the team roster or the
-- holiday calendar.

-- ───── 1. teams ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.teams (
  id                TEXT         PRIMARY KEY,
  division          TEXT         NOT NULL,
  level             TEXT,
  practice_sun      BOOLEAN      DEFAULT FALSE,
  practice_mon      BOOLEAN      DEFAULT FALSE,
  practice_wed      BOOLEAN      DEFAULT FALSE,
  practice_thur     BOOLEAN      DEFAULT FALSE,
  has_summer        BOOLEAN      DEFAULT FALSE,
  head_coach        TEXT,
  assistant_coach   TEXT,
  qualifier_target  INTEGER,
  active            BOOLEAN      DEFAULT TRUE,
  notes             TEXT,
  sort_order        INTEGER,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS teams_select_approved ON public.teams;
CREATE POLICY teams_select_approved ON public.teams
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));

DROP POLICY IF EXISTS teams_write_admin ON public.teams;
CREATE POLICY teams_write_admin ON public.teams
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_admin));

INSERT INTO public.teams (id, division, level, practice_sun, practice_mon, practice_wed, practice_thur, has_summer, head_coach, assistant_coach, sort_order) VALUES
  ('17 Diamond/Ruby', 'U17', NULL,            NULL,  NULL,  NULL,  NULL,  NULL,  NULL,        NULL,            1),
  ('16 Diamond',      'U16', 'National',      FALSE, TRUE,  TRUE,  TRUE,  FALSE, 'Tionne',    'Ambria',        2),
  ('15 Sapphire',     'U15', 'Regional',      TRUE,  TRUE,  FALSE, TRUE,  FALSE, 'Mikayla',   'Shellie',       3),
  ('15 Ruby',         'U15', 'National',      TRUE,  TRUE,  FALSE, TRUE,  FALSE, 'Chang',     'Matt Mercier',  4),
  ('15 Diamond',      'U15', 'National',      TRUE,  TRUE,  TRUE,  TRUE,  FALSE, 'Hunter',    'Bree',          5),
  ('15 Emerald',      'U15', 'Regional',      NULL,  NULL,  NULL,  NULL,  NULL,  NULL,        'Tara',          6),
  ('14 Sapphire',     'U14', 'Regional',      TRUE,  TRUE,  FALSE, TRUE,  FALSE, 'Ambria',    'Mia',           7),
  ('14 Ruby',         'U14', 'National',      TRUE,  TRUE,  FALSE, TRUE,  FALSE, 'Jayden',    'Rene',          8),
  ('14 Emerald',      'U14', 'Regional',      NULL,  NULL,  NULL,  NULL,  NULL,  'Mikayla',   'Ella',          9),
  ('14 Diamond',      'U14', 'National',      TRUE,  TRUE,  FALSE, TRUE,  TRUE,  'Drew',      'Kristen',      10),
  ('13 Ruby',         'U13', 'Regional',      TRUE,  TRUE,  FALSE, FALSE, TRUE,  'Bree',      'Sam M.',       11),
  ('13 Rise',         'U13', 'Developmental', FALSE, TRUE,  FALSE, FALSE, TRUE,  NULL,        NULL,           12),
  ('13 Diamond',      'U13', 'National',      TRUE,  TRUE,  FALSE, TRUE,  TRUE,  'Sam R.',    'Jayden',       13),
  ('13 Sapphire',     'U13', 'Regional',      NULL,  NULL,  NULL,  NULL,  NULL,  NULL,        NULL,           14),
  ('12 Ruby',         'U12', 'Regional',      FALSE, TRUE,  TRUE,  FALSE, FALSE, 'Jason',     NULL,           15),
  ('12 Rise 2',       'U12', 'Developmental', NULL,  NULL,  NULL,  NULL,  NULL,  NULL,        'Shellie',      16),
  ('12 Rise 1',       'U12', 'Developmental', FALSE, TRUE,  FALSE, FALSE, TRUE,  'Rob',       'Mia',          17),
  ('12 Diamond',      'U12', 'National',      TRUE,  TRUE,  TRUE,  FALSE, TRUE,  'Tara',      NULL,           18),
  ('11 Rise 1',       'U11', 'Developmental', FALSE, TRUE,  FALSE, FALSE, TRUE,  'Lindsey',   'Rob',          19),
  ('11 Diamond',      'U11', 'Regional',      TRUE,  TRUE,  TRUE,  FALSE, TRUE,  'Brandon',   'Ella',         20)
ON CONFLICT (id) DO NOTHING;

-- ───── 2. tournaments ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tournaments (
  id                     BIGSERIAL    PRIMARY KEY,
  name                   TEXT         NOT NULL,
  start_date             DATE         NOT NULL,
  end_date               DATE         NOT NULL,
  location               TEXT,
  venue                  TEXT,
  age_low                INTEGER,
  age_high               INTEGER,
  gender                 TEXT,
  divisions              TEXT[]       NOT NULL DEFAULT '{}',
  is_qualifier           BOOLEAN      NOT NULL DEFAULT FALSE,
  qualifier_type         TEXT,
  format                 TEXT,
  status                 TEXT,
  source_url             TEXT,
  source                 TEXT,
  cost                   NUMERIC,
  registration_deadline  DATE,
  notes                  TEXT,
  cancelled              BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tournaments_start_idx ON public.tournaments (start_date);

ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tournaments_all_approved ON public.tournaments;
CREATE POLICY tournaments_all_approved ON public.tournaments
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));

-- Seed: 63 USAV three-day tournaments (paste of 2026-05-25)
INSERT INTO public.tournaments (name, start_date, end_date, location, venue, age_low, age_high, gender, format, status, source, cancelled) VALUES
  ('2026 AllstateSugarBowl NewOrleans AAUSuperRegional',          '2026-05-23', '2026-05-25', 'New Orleans, LA',       'Go to www.tournamentcentral.info',                              12, 18, 'Female',        'Three Day Format', 'Registration Closed',                'USAV', FALSE),
  ('2026 East Coast Championships',                                '2026-05-23', '2026-05-25', 'Pittsburgh, PA',        'David L Lawrence Convention Center',                            12, 18, 'Female',        'Three Day Format', 'Registration Closed',                'USAV', FALSE),
  ('2026 JVA West Coast Cup',                                      '2026-05-23', '2026-05-25', 'Long Beach, CA',        'Long Beach Convention Center',                                  13, 18, 'Female',        'Three Day Format', 'Registration Closed',                'USAV', FALSE),
  ('2026 STARS & STRIPES Festival AAU Grand Prix',                 '2026-05-23', '2026-05-25', 'Mesa, AZ',              'Arizona Athletic Grounds at Mesa Campus',                       12, 18, 'Male / Female', 'Three Day Format', 'Registration Closed',                'USAV', FALSE),
  ('2026 WCVBA Boys Memorial Day Tournament',                      '2026-05-23', '2026-05-25', 'Rancho Cordova, CA',    'OMNI',                                                          14, 18, 'Male',          'Three Day Format', 'Registration Closed',                'USAV', FALSE),
  ('38th Emerald City Classic Invitational',                       '2026-05-23', '2026-05-25', 'Seattle, WA',           'Seattle Convention Center: Arch and Summit',                    12, 18, 'Female',        'Three Day Format', 'Registration Closed',                'USAV', FALSE),
  ('CANCELLED Lexington',                                          '2026-05-23', '2026-05-25', 'Lexington, KY',         'Sports Center & Surrounding Facilities',                        10, 18, 'Female',        'Three Day Format', 'Registration Closed',                'USAV', TRUE),
  ('Ho''oikaika VBC 37th Annual Invitational Tournament',          '2026-05-23', '2026-05-25', 'Waimea, HI',            'Waimea High School Gym',                                        10, 18, 'Male / Female', 'Three Day Format', 'Registration Closed',                'USAV', FALSE),
  ('Postponed - Endless Summer Tournament',                        '2026-05-23', '2026-05-25', 'Sevierville, TN',       'Sevierville Convention Center',                                 12, 18, 'Female',        'Three Day Format', 'Registration Closed',                'USAV', FALSE),
  ('The Stampede into the Summer',                                 '2026-05-23', '2026-05-25', 'Pocono Manor, PA',      'Kalahari Resorts & Convention Center',                          12, 16, 'Female',        'Three Day Format', 'Registration Closed',                'USAV', FALSE),
  ('Premier / GVA Pre-Nationals Warm up 2026',                     '2026-05-28', '2026-05-31', 'Guaynabo, PR',          'Guaynabo, PR',                                                   8, 18, 'Male / Female', 'Three Day Format', 'Registration Closed',                'USAV', FALSE),
  ('Summerfest 2026 (6U-20U)',                                     '2026-06-03', '2026-06-07', 'Toa Baja, PR',          'Avoli / Collazo',                                                8, 18, 'Male / Female', 'Three Day Format', 'Registration Closed',                'USAV', FALSE),
  ('2026 Navy Pier Asics Nat Volleyball Chp June 5-7',             '2026-06-05', '2026-06-07', 'Chicago, IL',           'Navy Pier Chicago',                                             13, 18, 'Female',        'Three Day Format', 'Registration Open',                  'USAV', FALSE),
  ('2026 AAU International/National Warm Championships',           '2026-06-05', '2026-06-07', 'Orlando, FL',           'Game Point Events Center',                                      12, 18, 'Female',        'Three Day Format', 'Registration Closed',                'USAV', FALSE),
  ('2026 Triple Crown Summer NIT',                                 '2026-06-05', '2026-06-07', 'Mesa, AZ',              'Arizona Athletic Grounds',                                      13, 17, 'Female',        'Three Day Format', 'Registration Closed',                'USAV', FALSE),
  ('2026 Triple Crown West Coast Invitational',                    '2026-06-06', '2026-06-08', 'Sandy, UT',             'Mountain America Expo Center',                                  12, 18, 'Male / Female', 'Three Day Format', 'Registration Closed',                'USAV', FALSE),
  ('2026 The Big Summer Showdown',                                 '2026-06-12', '2026-06-14', 'Sandusky, OH',          'Cedar Point Sports Center',                                     11, 18, 'Female',        'Three Day Format', 'Registration Open',                  'USAV', FALSE),
  ('2026 AAU/JVA Windy City Round-Up',                             '2026-06-19', '2026-06-21', 'Chicago, IL',           'McCormick Place-West Halls F1/F2',                              13, 18, 'Male',          'Three Day Format', 'Registration Open',                  'USAV', FALSE),
  ('2026 Endless Summer: Destination Hawaii',                      '2026-06-19', '2026-06-21', 'Honolulu, HI',          'Hawaii Convention Center',                                      12, 18, 'Male / Female', 'Three Day Format', 'Registration Closed',                'USAV', FALSE),
  ('DEMO - Lucid',                                                 '2026-06-26', '2026-06-28', 'Houston, TX',           'TEST LOCATION',                                                 11, 18, 'Female',        'Three Day Format', 'Registration Closed',                'USAV', FALSE),
  ('2nd Annual Double Down in the Desert',                         '2026-11-20', '2026-11-22', 'Las Vegas, NV',         'Rio Convention Center',                                         14, 18, 'Male',          'Three Day Format', 'Registration Open',                  'USAV', FALSE),
  ('2026 Boys Winter Invitational',                                '2026-12-11', '2026-12-13', 'Louisville, KY',        'Kentucky Exposition Center',                                    12, 18, 'Male',          'Three Day Format', 'Registration Opens - Jun 1, 2026',   'USAV', FALSE),
  ('2026 Triple Crown Boys NIT',                                   '2026-12-11', '2026-12-13', 'Salt Lake City, UT',    'Salt Palace Convention Center',                                 12, 18, 'Female',        'Three Day Format', 'Registration Closed',                'USAV', FALSE),
  ('2027 Battle on Broadway (FREE Entry Nationals)',               '2027-01-16', '2027-01-18', 'Nashville, TN',         'Nashville Fairgrounds/Expo & add. facilities',                  11, 18, 'Female',        'Three Day Format', 'Registration Opens - Jul 1, 2026',   'USAV', FALSE),
  ('2027 Cactus Classic Invitational',                             '2027-01-16', '2027-01-18', 'Tucson, AZ',            'Tucson Convention Center; Sporting Chance Center',              12, 18, 'Female',        'Three Day Format', 'Registration Opens - Sep 1, 2026',   'USAV', FALSE),
  ('2027 City of Oaks Challenge',                                  '2027-01-16', '2027-01-18', 'Raleigh, NC',           'Raleigh Convention Center | Triangle Volleyball Club',          12, 18, 'Male / Female', 'Three Day Format', 'Registration Opens - Sep 23, 2026',  'USAV', FALSE),
  ('2027 Florida USA MLK Showcase at Wiregrass Ranch',             '2027-01-16', '2027-01-18', 'Wesley Chapel, FL',     'Wiregrass Ranch Sports Complex',                                12, 18, 'Female',        'Three Day Format', 'Registration Opens - Aug 1, 2026',   'USAV', FALSE),
  ('2027 Gateway City Classic',                                    '2027-01-16', '2027-01-18', 'Omaha, NE',             'CHI Health Center',                                             12, 18, 'Female',        'Three Day Format', 'Registration Opens - Aug 1, 2026',   'USAV', FALSE),
  ('2027 Indy Grand Prix',                                         '2027-01-16', '2027-01-18', 'Westfield, IN',         'Grand Park Event Center',                                       11, 18, 'Female',        'Three Day Format', 'Registration Opens - Jul 1, 2026',   'USAV', FALSE),
  ('2027 Matt Hartner Memorial Classic',                           '2027-01-16', '2027-01-18', 'Eugene, OR',            'Moshofsky Center, Bob Keefer Center',                           16, 18, 'Female',        'Three Day Format', 'Registration Opens - Nov 1, 2026',   'USAV', FALSE),
  ('2027 Mid-Atlantic Opener',                                     '2027-01-16', '2027-01-18', 'York, PA',              'York Expo Center',                                              12, 18, 'Female',        'Three Day Format', 'Registration Opens - Aug 1, 2026',   'USAV', FALSE),
  ('2027 MLK Kickoff Challenge',                                   '2027-01-16', '2027-01-18', 'Manheim, PA',           'Spooky Nook Sports',                                            12, 18, 'Female',        'Three Day Format', 'Registration Opens - Aug 1, 2026',   'USAV', FALSE),
  ('2027 MLK Seattle Kickoff',                                     '2027-01-16', '2027-01-18', 'Seattle, WA',           'Seattle Convention Center',                                     12, 18, 'Female',        'Three Day Format', 'Registration Opens - Aug 1, 2026',   'USAV', FALSE),
  ('2027 Sweet Tea MLK Challenge',                                 '2027-01-16', '2027-01-18', 'Hoover, AL',            'Finley Center',                                                 12, 18, 'Female',        'Three Day Format', 'Registration Opens - Jul 1, 2026',   'USAV', FALSE),
  ('2027 Triple Crown Colorado Challenge',                         '2027-01-16', '2027-01-18', 'Loveland, CO',          'Northern Colorado Facilities',                                  13, 18, 'Female',        'Three Day Format', 'Registration Closed',                'USAV', FALSE),
  ('2027 UA MLK Invitational',                                     '2027-01-16', '2027-01-18', 'Sevierville, TN',       'Sevierville Convention Center',                                 12, 18, 'Male / Female', 'Three Day Format', 'Registration Opens - Aug 1, 2026',   'USAV', FALSE),
  ('8th Annual AC Invitational G Open/B Premier',                  '2027-01-16', '2027-01-18', 'Atlantic City, NJ',     'Harrah''s Hotel & Casino Atlantic City & The Armory',           12, 18, 'Male / Female', 'Three Day Format', 'Registration Open',                  'USAV', FALSE),
  ('Battle on the Boardwalk 2027',                                 '2027-01-16', '2027-01-18', 'Virginia Beach, VA',    'Virginia Beach Sports Center',                                  12, 18, 'Male / Female', 'Three Day Format', 'Registration Opens - Sep 1, 2026',   'USAV', FALSE),
  ('2027 Nike Steel City Boys Championships',                      '2027-02-05', '2027-02-07', 'Pittsburgh, PA',        'David L. Lawrence Convention Center',                           12, 18, 'Male',          'Three Day Format', 'Registration Opens - Jun 1, 2026',   'USAV', FALSE),
  ('The 2nd Annual Blizzard in the Poconos',                       '2027-02-12', '2027-02-14', 'Pocono Manor, PA',      'Kalahari Resorts & Convention Center',                          13, 17, 'Female',        'Three Day Format', 'Registration Open',                  'USAV', FALSE),
  ('2026 UA Presidents Day Invitational',                          '2027-02-13', '2027-02-15', 'Knoxville & Sevierville, TN', 'Knoxville CC & Sevierville CC',                            11, 18, 'Male / Female', 'Three Day Format', 'Registration Opens - Aug 1, 2026',   'USAV', FALSE),
  ('2027 AAU Coast to Coast Grand Prix',                           '2027-02-13', '2027-02-15', 'Glen Allen, VA',        'Henrico Sports & Events Center',                                12, 18, 'Female',        'Three Day Format', 'Registration Opens - Aug 1, 2026',   'USAV', FALSE),
  ('2027 President''s Day Seattle',                                '2027-02-13', '2027-02-15', 'Auburn, WA',            'Auburn Fieldhouse - Auburn and ASC - Lynnwood',                 12, 18, 'Female',        'Three Day Format', 'Registration Opens - Aug 1, 2026',   'USAV', FALSE),
  ('2027 Presidents'' Day: Battle of Ohio',                        '2027-02-13', '2027-02-15', 'Sandusky, OH',          'Cedar Point Sports Center',                                     12, 18, 'Female',        'Three Day Format', 'Registration Opens - Jul 1, 2026',   'USAV', FALSE),
  ('2027 Prez Day Pacific Showdown',                               '2027-02-13', '2027-02-15', 'Ridgefield, WA',        'Clark County Event Center',                                     12, 18, 'Female',        'Three Day Format', 'Registration Opens - Aug 1, 2026',   'USAV', FALSE),
  ('2027 Triple Crown NIT',                                        '2027-02-13', '2027-02-15', 'Kansas City, MO',       'Bartle Hall Convention Center',                                 12, 18, 'Female',        'Three Day Format', 'Registration Closed',                'USAV', FALSE),
  ('2027 UA Presidents Day Showdown',                              '2027-02-13', '2027-02-15', 'Atlantic City, NJ',     'Atlantic City Facility',                                        12, 18, 'Female',        'Three Day Format', 'Registration Opens - Aug 1, 2026',   'USAV', FALSE),
  ('First Annual North American Championship',                     '2027-02-13', '2027-02-15', 'Ontario, CA',           'Ontario Convention Center',                                     12, 14, 'Male / Female', 'Three Day Format', 'Registration Open',                  'USAV', FALSE),
  ('NEW AAU Boys Colonial Classic Grand Prix',                     '2027-02-13', '2027-02-15', 'Williamsburg, VA',      'Greater Williamsburg Sports and Event Center',                  14, 18, 'Male',          'Three Day Format', 'Registration Opens - Aug 1, 2026',   'USAV', FALSE),
  ('2027 March Mania',                                             '2027-03-20', '2027-03-22', 'Ridgefield, WA',        'Clark County Event Center',                                     12, 18, 'Female',        'Three Day Format', 'Registration Opens - Aug 1, 2026',   'USAV', FALSE),
  ('2027 Cactus Clash',                                            '2027-04-16', '2027-04-18', 'Phoenix, AZ',           'Phoenix Convention Center',                                     15, 17, 'Female',        'Three Day Format', 'Registration Opens - Aug 1, 2026',   'USAV', FALSE),
  ('2027 Under Armour 18U National Championship',                  '2027-04-16', '2027-04-18', 'Phoenix, AZ',           'Phoenix Convention Center',                                     18, 18, 'Female',        'Three Day Format', 'Registration Opens - Aug 1, 2026',   'USAV', FALSE),
  ('Best of the West 2027',                                        '2027-04-23', '2027-04-25', 'Bozeman, MT',           'Montana State University',                                      12, 18, 'Female',        'Three Day Format', 'Registration Open',                  'USAV', FALSE),
  ('13th Annual In it to Win it Challenge Weekend 1',              '2027-04-30', '2027-05-02', 'Las Vegas, NV',         'Rio Convention Center',                                         12, 18, 'Female',        'Three Day Format', 'Registration Open',                  'USAV', FALSE),
  ('2027 Music City Mayhem',                                       '2027-04-30', '2027-05-02', 'Nashville, TN',         'Fairgrounds & Expo Center (Nashville)',                         11, 18, 'Female',        'Three Day Format', 'Registration Opens - Jul 1, 2026',   'USAV', FALSE),
  ('2027 OVR-Mizuno 12s-17s Bid Tournament',                       '2027-04-30', '2027-05-02', 'Columbus, OH',          'Greater Columbus Convention Center',                            12, 17, 'Female',        'Three Day Format', 'Registration Opens - Aug 1, 2026',   'USAV', FALSE),
  ('13th Annual In it to Win it Challenge Weekend 2',              '2027-05-07', '2027-05-09', 'Las Vegas, NV',         'Rio Convention Center',                                         12, 18, 'Female',        'Three Day Format', 'Registration Open',                  'USAV', FALSE),
  ('2027 Savannah Invitational',                                   '2027-05-21', '2027-05-23', 'Savannah, GA',          'Savannah Convention Center',                                    12, 18, 'Female',        'Three Day Format', 'Registration Opens - Aug 1, 2026',   'USAV', FALSE),
  ('2027 The Championship Path Series Orlando',                    '2027-05-29', '2027-05-31', 'Orlando, FL',           'Orange County Convention Center, West Hall',                    10, 18, 'Female',        'Three Day Format', 'Registration Opens - Aug 1, 2026',   'USAV', FALSE),
  ('2027 AAU International Orlando Championships',                 '2027-06-04', '2027-06-06', 'Orlando, FL',           'Game Point Events Center',                                      12, 18, 'Female',        'Three Day Format', 'Registration Opens - Aug 1, 2026',   'USAV', FALSE),
  ('2027 Navy Pier Asics Nat Volleyball Chp June 4-5-6',           '2027-06-04', '2027-06-06', 'Chicago, IL',           'Navy Pier Chicago',                                             13, 18, 'Female',        'Three Day Format', 'Registration Open',                  'USAV', FALSE),
  ('2027 The Big Summer Showdown',                                 '2027-06-11', '2027-06-13', 'Sandusky, OH',          'Cedar Point Sports Center',                                     11, 18, 'Female',        'Three Day Format', 'Registration Opens - Jul 1, 2026',   'USAV', FALSE),
  ('MASTER AAU TransPacific Volleyball Championships',             '2028-01-14', '2028-01-16', 'Honolulu, HI',          'Hawaii Convention Center',                                      12, 18, 'Male / Female', 'Three Day Format', 'Registration Closed',                'USAV', FALSE)
ON CONFLICT DO NOTHING;

-- ───── 3. tournament_assignments ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tournament_assignments (
  id              BIGSERIAL    PRIMARY KEY,
  tournament_id   BIGINT       NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  team_id         TEXT         NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  division        TEXT,
  status          TEXT         NOT NULL DEFAULT 'planned',
  notes           TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(tournament_id, team_id)
);

CREATE INDEX IF NOT EXISTS tournament_assignments_team_idx       ON public.tournament_assignments (team_id);
CREATE INDEX IF NOT EXISTS tournament_assignments_tournament_idx ON public.tournament_assignments (tournament_id);

ALTER TABLE public.tournament_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tournament_assignments_all_approved ON public.tournament_assignments;
CREATE POLICY tournament_assignments_all_approved ON public.tournament_assignments
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));

-- ───── 4. blackout_dates ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.blackout_dates (
  id           BIGSERIAL    PRIMARY KEY,
  date_start   DATE         NOT NULL,
  date_end     DATE         NOT NULL,
  name         TEXT         NOT NULL,
  type         TEXT         NOT NULL,
  notes        TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS blackout_dates_idx ON public.blackout_dates (date_start);

ALTER TABLE public.blackout_dates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS blackout_dates_select_approved ON public.blackout_dates;
CREATE POLICY blackout_dates_select_approved ON public.blackout_dates
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_approved));

DROP POLICY IF EXISTS blackout_dates_write_admin ON public.blackout_dates;
CREATE POLICY blackout_dates_write_admin ON public.blackout_dates
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = auth.uid() AND c.is_admin));

INSERT INTO public.blackout_dates (date_start, date_end, name, type) VALUES
  ('2026-09-07', '2026-09-07', 'Labor Day',                  'federal'),
  ('2026-11-11', '2026-11-11', 'Veterans Day',               'federal'),
  ('2026-11-23', '2026-11-27', 'Thanksgiving Break (DSISD)', 'school'),
  ('2026-12-21', '2027-01-05', 'Winter Break (DSISD)',       'school'),
  ('2027-01-18', '2027-01-18', 'Martin Luther King Jr. Day', 'federal'),
  ('2027-02-15', '2027-02-15', 'Presidents Day',             'federal'),
  ('2027-03-15', '2027-03-19', 'Spring Break (DSISD)',       'spring_break'),
  ('2027-04-02', '2027-04-02', 'Good Friday (DSISD)',        'school'),
  ('2027-05-31', '2027-05-31', 'Memorial Day',               'federal'),
  ('2027-07-04', '2027-07-04', 'Independence Day',           'federal')
ON CONFLICT DO NOTHING;

-- ───── 5. Realtime publication (so multi-coach planning syncs live) ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='tournaments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tournaments;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='tournament_assignments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tournament_assignments;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='teams') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.teams;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='blackout_dates') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.blackout_dates;
  END IF;
END $$;
