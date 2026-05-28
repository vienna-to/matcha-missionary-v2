-- ============================================================
-- Migration: Add `kind` column to events so we can distinguish
-- live-tracked events from quick-entered past events.
--
-- "live" = real event, every order has a real submitted_at + payment_method
-- "past" = quick-entered retroactive event; per-order data is synthetic
--          (one synthetic order per cup, timestamps spread across the
--          window, single default payment method). Event Summary
--          suppresses the time-of-day chart and payment-breakdown card
--          for these.
--
-- Existing rows are backfilled to "live" via the default.
-- Run once. Safe to re-run.
-- ============================================================

alter table public.events
  add column if not exists kind text not null default 'live'
  check (kind in ('live', 'past'));
