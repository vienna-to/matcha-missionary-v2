-- ============================================================
-- Migration: Drop "card" as a payment method.
--
-- We don't accept cards, so existing rows that were paid via card
-- (e.g. test data, the original sample seed) are rolled into the
-- "other" bucket so they don't get hidden from totals after the UI
-- stopped surfacing card.
--
-- The CHECK constraint on payment_method still allows 'card' (kept for
-- backwards compatibility with any historical data this migration
-- might miss in other workspaces). The app no longer offers it in any
-- picker.
--
-- Run once. Safe to re-run.
-- ============================================================

update public.orders
   set payment_method = 'other'
 where payment_method = 'card';
