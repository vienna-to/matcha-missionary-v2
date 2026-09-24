-- ============================================================
-- Migration: Add `archived` flag to inventory_purchases.
--
-- We broke even and want to start expense tracking fresh going
-- forward. Archived rows stay in Finance for reference but no
-- longer contribute to the All-Events "Inventory spending" /
-- net-profit aggregate.
--
-- Run once. Safe to re-run.
-- ============================================================

alter table public.inventory_purchases
  add column if not exists archived boolean not null default false;

create index if not exists idx_inventory_workspace_archived
  on public.inventory_purchases(workspace_id, archived);
