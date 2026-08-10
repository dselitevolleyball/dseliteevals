-- 20260810 — Per-shift pay rate override on a check-in.
--
-- coach_rates holds ONE standing rate per coach (plus a head_rate for shifts on
-- a team they head-coach). That cannot express "this one event pays a different
-- rate for everybody", which is what a one-off coach training is: on Fri Aug 7
-- 2026 every head and assistant coach was to be paid head-coach rate ($30/hr)
-- regardless of whose team they normally cover.
--
-- Without this column the only ways to hit that number were to raise each
-- coach's standing rate (which would have repriced 245 unpaid hours on other
-- dates, and 82 more inside the same Mon-Sun payroll week) or to fudge the
-- hours so hours x rate landed on the right dollar amount (which would put a
-- false hour count on the timecard and in the CSV that goes to the bookkeeper).
--
-- rate_override is NULL for normal shifts, so existing behaviour is unchanged:
-- payroll still resolves head_rate/hourly_rate exactly as before. When it is
-- set it wins outright, and it is scoped to the single check-in row.
--
-- Both pay calculators must honour it — api/payroll-report.js (the Monday email
-- and its CSV) and the Time Cards view in src/App.jsx — or the app and the
-- emailed report will disagree.
--
-- Run: node scripts/run-sql.mjs migrations/20260810_checkin_rate_override.sql
-- Additive, non-destructive, idempotent.

ALTER TABLE public.coach_checkins
  ADD COLUMN IF NOT EXISTS rate_override NUMERIC(6,2);

COMMENT ON COLUMN public.coach_checkins.rate_override IS
  'Per-shift $/hr that beats coach_rates for this row only. NULL = use the coach''s standing head_rate/hourly_rate. Set for one-off events (e.g. a club-wide coach training) where the normal role-based rate does not apply.';
