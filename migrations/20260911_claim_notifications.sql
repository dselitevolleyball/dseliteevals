-- Coach expense claims: who has been told what.
--
-- Three moments send an email — a claim filed (to Drew), a decision (to the
-- coach), and payment (to the coach). Each is stamped here so a double-click,
-- a retry or a page refresh can never send the same email twice.
--
-- The decision is stamped with the STATUS it announced rather than a boolean,
-- because a claim can be rejected, corrected and then approved: the second
-- decision is new news and should be sent, the repeat of the first is not.

alter table expenses
  add column if not exists claim_filed_notified_at    timestamptz,
  add column if not exists claim_decision_notified    text,
  add column if not exists claim_decision_notified_at timestamptz,
  add column if not exists claim_paid_notified_at     timestamptz,
  add column if not exists reimbursed_at              timestamptz;
