-- Court chart: move a block, and the change log for Playbook (Drew, Oct 23
-- 2026: "I want to be able to move volleyball101 because it conflicts with
-- the court ... then send an updated change log to Jonathan to change in
-- Playbook").
--
-- court_block_hides now holds both kinds of chart change:
--   action 'hide'  the block comes off the chart (as before)
--   action 'move'  the block is drawn on to_courts, to_start_h-to_end_h instead
-- sent_at / sent_to: when the change went to Jonathan in a "Changes for
-- Playbook" email (null = not sent yet). Rentals added in HQ (source 'hq')
-- carry playbook_sent_at the same way.
-- Run: node scripts/run-sql.mjs migrations/20261031_court_moves.sql

ALTER TABLE public.court_block_hides ADD COLUMN IF NOT EXISTS action     text NOT NULL DEFAULT 'hide';
ALTER TABLE public.court_block_hides ADD COLUMN IF NOT EXISTS to_courts  text[];
ALTER TABLE public.court_block_hides ADD COLUMN IF NOT EXISTS to_start_h numeric;
ALTER TABLE public.court_block_hides ADD COLUMN IF NOT EXISTS to_end_h   numeric;
ALTER TABLE public.court_block_hides ADD COLUMN IF NOT EXISTS sent_at    timestamptz;
ALTER TABLE public.court_block_hides ADD COLUMN IF NOT EXISTS sent_to    text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'court_block_hides_action_check') THEN
    ALTER TABLE public.court_block_hides ADD CONSTRAINT court_block_hides_action_check CHECK (action IN ('hide', 'move'));
  END IF;
END $$;
ALTER TABLE public.dssc_court_rentals ADD COLUMN IF NOT EXISTS playbook_sent_at timestamptz;
SELECT 'ok' AS done;
