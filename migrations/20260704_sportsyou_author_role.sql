-- 20260704 — Tag each SportsYou post's author as club admin vs team coach.
--
-- DS Elite admins (Drew Rose, Tionne Graves-Brown, Kristen Alexandrov) are on
-- every team; anyone else posting is that team's coach. author_role lets Coach
-- Comms distinguish club-wide admin announcements from actual coach messages.
--
-- Run: node scripts/run-sql.mjs migrations/20260704_sportsyou_author_role.sql
-- Additive, non-destructive, idempotent.

ALTER TABLE public.sportsyou_posts
  ADD COLUMN IF NOT EXISTS author_role TEXT;   -- 'admin' | 'coach' | NULL
