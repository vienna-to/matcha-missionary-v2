-- ============================================================
-- Migration: Per-item discount + queue priority.
--
-- order_items.discount_pct (0–100): replaces the order-level "free"
--   flow with a per-drink discount. 100 = free, 0/null = full price.
-- orders.queue_priority (bigint): timestamp-based pin in Barista
--   Queue. Higher = closer to top; null = unpinned (sorts by
--   submitted_at).
--
-- The old payment/status columns stay around for legacy data — the
-- app no longer reads or writes to them.
--
-- Run once. Safe to re-run.
-- ============================================================

alter table public.order_items
  add column if not exists discount_pct numeric
  check (discount_pct is null or (discount_pct >= 0 and discount_pct <= 100));

alter table public.orders
  add column if not exists queue_priority bigint;

create index if not exists idx_orders_event_priority
  on public.orders (event_id, queue_priority desc nulls last, submitted_at);
