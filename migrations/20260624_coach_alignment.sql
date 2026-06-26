-- 20260624 — Align coach_roster + practice_teams to the master coach spreadsheet.
-- Only names, phone, and email are set (NOT stipend / monthly / hourly / season
-- start, per request). Run once in the Supabase SQL editor.
--
-- ASSUMPTIONS / THINGS TO VERIFY:
--   * Team names: the sheet says "11 Rise" / "12 Rise"; practice_teams has
--     "11 Rise 1" / "12 Rise 1". Mapped accordingly.
--   * Rene Sandoval's sheet had two phones (one was Matt's number, likely a
--     copy/paste error). Used 512-808-8447.
--   * Names: kept Breanna COWARD (sheet "Cohen" was wrong); Roessier→Rosser;
--     Rob→"Adriel" Roberts; "Smith - Wright"→"Smith-Wright".
--   * "Hunter Hal" is a duplicate of Hunter Haley and is DELETED below.
--   * 12 Rise 2 and 16 Ruby have no Head Coach in the sheet → head set to NULL.

-- ── Part A: coach_roster contact info + name fixes ──────────────────────────
UPDATE public.coach_roster SET phone='512-897-5903', email='ambriarupp@gmail.com'        WHERE lower(first_name)='ambria'  AND lower(last_name)='rupp';
UPDATE public.coach_roster SET phone='321-274-6251', email='brandonblahnik@outlook.com'  WHERE lower(first_name)='brandon' AND lower(last_name)='blahnik';
UPDATE public.coach_roster SET last_name='Coward', phone='512-636-1595', email='divoga24@gmail.com' WHERE lower(first_name)='breanna' AND lower(last_name) IN ('coward','cohen');
UPDATE public.coach_roster SET phone='210-602-3205', email='Britneyaparker@gmail.com'    WHERE lower(first_name)='britney' AND lower(last_name)='parker';
UPDATE public.coach_roster SET phone='210-414-9330', email='changguo@utexas.edu'         WHERE lower(first_name)='chang'   AND lower(last_name)='guo';
UPDATE public.coach_roster SET phone='512-202-9099', email='drew@drippingsportsclub.com' WHERE lower(first_name)='drew'    AND lower(last_name)='rose';
UPDATE public.coach_roster SET phone='512-817-9669', email='ella.hinkle00@gmail.com'     WHERE lower(first_name)='ella'    AND lower(last_name)='hinkle';
UPDATE public.coach_roster SET phone='310-633-0352', email='hunterhaleysc10@gmail.com'   WHERE lower(first_name)='hunter'  AND lower(last_name)='haley';
-- Hunter Hal is a duplicate of Hunter Haley — remove it (Haley row above is kept).
DELETE FROM public.coach_roster WHERE lower(first_name)='hunter' AND lower(last_name)='hal';
UPDATE public.coach_roster SET last_name='Rosser', phone='254-251-9435', email='jaarose15@icloud.com' WHERE lower(first_name)='jaalin' AND lower(last_name) IN ('roessier','rosser');
UPDATE public.coach_roster SET phone='512-773-7244', email='jbaerwald23@gmail.com'       WHERE lower(first_name)='jason'   AND lower(last_name)='baerwald';
UPDATE public.coach_roster SET phone='512-758-0487', email='jaydenwright0131@gmail.com'  WHERE lower(first_name)='jayden'  AND lower(last_name)='wright';
UPDATE public.coach_roster SET phone='830-263-0952', email='jess.cantu.2012@gmail.com'   WHERE lower(first_name)='jessica' AND lower(last_name)='cantu';
UPDATE public.coach_roster SET phone='484-554-8171', email='rissa.lee9@gmail.com'        WHERE lower(first_name)='karissa' AND lower(last_name)='lee';
UPDATE public.coach_roster SET phone='512-644-2899', email='krhardge@gmail.com'          WHERE lower(first_name)='kelli'   AND lower(last_name)='hardge';
UPDATE public.coach_roster SET phone='713-560-8363', email='kristen.alexandrov@gmail.com' WHERE lower(first_name)='kristen' AND lower(last_name)='alexandrov';
UPDATE public.coach_roster SET phone='361-522-8733', email='lrshumway@gmail.com'         WHERE lower(first_name)='lindsey' AND lower(last_name)='shumway';
UPDATE public.coach_roster SET phone='(512)241-9154', email='MatthewMercier87@gmail.com' WHERE lower(first_name)='matt'    AND lower(last_name)='mercier';
UPDATE public.coach_roster SET phone='512-696-2389', email='Miadelarosa870@gmail.com'    WHERE lower(first_name)='mia'     AND lower(last_name)='de la rosa';
UPDATE public.coach_roster SET phone='512-808-8447', email='renealbertosandoval@gmail.com' WHERE lower(first_name)='rene'  AND lower(last_name)='sandoval';
UPDATE public.coach_roster SET first_name='Adriel', phone='202-487-1439', email='adrielroberts97@gmail.com' WHERE lower(first_name) IN ('rob','adriel','rob (adriel)') AND lower(last_name)='roberts';
UPDATE public.coach_roster SET phone='602-214-4448', email='samanthagmabry@gmail.com'    WHERE lower(first_name)='sam'     AND lower(last_name)='mabry';
UPDATE public.coach_roster SET phone='832-998-9269', email='sammystar29@gmail.com'       WHERE lower(first_name)='sam'     AND lower(last_name)='robinson';
UPDATE public.coach_roster SET phone='503-919-0997', email='shelwilliams@gmail.com'      WHERE lower(first_name)='shellie' AND lower(last_name)='williams';
UPDATE public.coach_roster SET phone='512-633-4454', email='taraanne888@yahoo.com'       WHERE lower(first_name)='tara'    AND lower(last_name)='fisher';
UPDATE public.coach_roster SET phone='916-826-2563', email='tionne@drippingsportsclub.com' WHERE lower(first_name)='tionne' AND lower(last_name)='graves-brown';

-- Coaches that may not exist yet — insert if missing, then set contact info.
INSERT INTO public.coach_roster (first_name, last_name) SELECT 'Mikayla','Smith-Wright' WHERE NOT EXISTS (SELECT 1 FROM public.coach_roster WHERE lower(first_name)='mikayla' AND lower(last_name)='smith-wright');
UPDATE public.coach_roster SET phone='512-400-5747', email='mikayla_sw_95@yahoo.com' WHERE lower(first_name)='mikayla' AND lower(last_name)='smith-wright';
INSERT INTO public.coach_roster (first_name, last_name) SELECT 'David','Stanley' WHERE NOT EXISTS (SELECT 1 FROM public.coach_roster WHERE lower(first_name)='david' AND lower(last_name)='stanley');
UPDATE public.coach_roster SET phone='251-648-3925', email='dstan4au@gmail.com' WHERE lower(first_name)='david' AND lower(last_name)='stanley';
INSERT INTO public.coach_roster (first_name, last_name, phone) SELECT 'Valerie','Reyna','737-317-0044' WHERE NOT EXISTS (SELECT 1 FROM public.coach_roster WHERE lower(first_name)='valerie' AND lower(last_name)='reyna');
INSERT INTO public.coach_roster (first_name, last_name) SELECT 'Victoria','Reyna' WHERE NOT EXISTS (SELECT 1 FROM public.coach_roster WHERE lower(first_name)='victoria' AND lower(last_name)='reyna');

-- ── Part B: practice_teams head/assistant (canonical "First Last") ──────────
UPDATE public.practice_teams SET head_coach='Brandon Blahnik',     assistant_coach='Ella Hinkle'        WHERE team_name='11 Diamond';
UPDATE public.practice_teams SET head_coach='Lindsey Shumway',     assistant_coach='Adriel Roberts'     WHERE team_name='11 Rise 1';
UPDATE public.practice_teams SET head_coach='Tara Fisher',         assistant_coach='Rene Sandoval'      WHERE team_name='12 Diamond';
UPDATE public.practice_teams SET head_coach='Adriel Roberts',      assistant_coach='Victoria Reyna'    WHERE team_name='12 Rise 1';
UPDATE public.practice_teams SET head_coach=NULL,                  assistant_coach='Britney Parker'     WHERE team_name='12 Rise 2';
UPDATE public.practice_teams SET head_coach='Jason Baerwald',      assistant_coach='Jaalin Rosser'      WHERE team_name='12 Ruby';
UPDATE public.practice_teams SET head_coach='Sam Robinson',        assistant_coach='Jayden Wright'      WHERE team_name='13 Diamond';
UPDATE public.practice_teams SET head_coach='Kelli Hardge',        assistant_coach='Shellie Williams'   WHERE team_name='13 Rise';
UPDATE public.practice_teams SET head_coach='Breanna Coward',      assistant_coach='Sam Mabry'          WHERE team_name='13 Ruby';
UPDATE public.practice_teams SET head_coach='David Stanley',       assistant_coach='Valerie Reyna'      WHERE team_name='13 Sapphire';
UPDATE public.practice_teams SET head_coach='Drew Rose',           assistant_coach='Kristen Alexandrov' WHERE team_name='14 Diamond';
UPDATE public.practice_teams SET head_coach='Mikayla Smith-Wright', assistant_coach='Ella Hinkle'       WHERE team_name='14 Emerald';
UPDATE public.practice_teams SET head_coach='Jayden Wright',       assistant_coach='Rene Sandoval'      WHERE team_name='14 Ruby';
UPDATE public.practice_teams SET head_coach='Ambria Rupp',         assistant_coach='Mia De la Rosa'     WHERE team_name='14 Sapphire';
UPDATE public.practice_teams SET head_coach='Karissa Lee',         assistant_coach='Britney Parker'     WHERE team_name='14 Topaz';
UPDATE public.practice_teams SET head_coach='Hunter Haley',        assistant_coach='Breanna Coward'     WHERE team_name='15 Diamond';
UPDATE public.practice_teams SET head_coach='Sam Robinson',        assistant_coach='Jaalin Rosser'      WHERE team_name='15 Emerald';
UPDATE public.practice_teams SET head_coach='Chang Guo',           assistant_coach='Matt Mercier'       WHERE team_name='15 Ruby';
UPDATE public.practice_teams SET head_coach='Mikayla Smith-Wright', assistant_coach='Shellie Williams'  WHERE team_name='15 Sapphire';
UPDATE public.practice_teams SET head_coach='Tionne Graves-Brown', assistant_coach='Ambria Rupp'        WHERE team_name='16 Diamond';
UPDATE public.practice_teams SET head_coach=NULL,                  assistant_coach='Tara Fisher'        WHERE team_name='16 Ruby';
UPDATE public.practice_teams SET head_coach='Kelli Hardge',        assistant_coach='Jessica Cantu'      WHERE team_name='17 Diamond';
