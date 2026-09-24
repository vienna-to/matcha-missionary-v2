-- ============================================================
-- Migration: Append-only audit log for order edits.
--
-- Every time an order is updated (beyond barista workflow),
-- has its items replaced, an item patched, or is deleted, the
-- pre-change order + items snapshot is written here. Nothing
-- is ever updated in this table; each row is a tombstone of
-- what the order looked like BEFORE the edit landed.
--
-- Used for the tax-records CSV export in Settings so historical
-- corrections leave a paper trail.
--
-- Run once. Safe to re-run.
-- ============================================================

create table if not exists public.order_revisions (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  -- Not a FK: revisions survive the deletion of the order they document.
  order_id        uuid not null,
  event_id        uuid,
  order_number    integer,
  action_type     text not null check (action_type in ('update', 'replace_items', 'update_item', 'delete')),
  -- Full pre-change order shape (including nested items).
  snapshot        jsonb not null,
  occurred_at     timestamptz not null default now()
);

create index if not exists idx_order_revisions_workspace_time
  on public.order_revisions(workspace_id, occurred_at desc);
create index if not exists idx_order_revisions_order
  on public.order_revisions(order_id, occurred_at desc);

alter table public.order_revisions disable row level security;
