-- ============================================================
-- Migration: Add inventory_purchases table.
--
-- Tracks one-off supply spending (matcha tins bought in bulk, cups
-- by the case, signage, tape, etc.) separate from per-drink
-- ingredient costs. Surfaced in the All Events aggregate view so
-- net profit = revenue − event costs − inventory spending.
--
-- Run once. Safe to re-run.
-- ============================================================

create table if not exists public.inventory_purchases (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  name            text not null,
  amount          numeric not null,
  date            date not null,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_inventory_workspace
  on public.inventory_purchases(workspace_id);
create index if not exists idx_inventory_workspace_date
  on public.inventory_purchases(workspace_id, date desc);

drop trigger if exists trg_inventory_updated_at on public.inventory_purchases;
create trigger trg_inventory_updated_at before update on public.inventory_purchases
  for each row execute function public.tg_set_updated_at();

-- RLS off (workspace code is the gate, per supabase/migration-disable-rls.sql)
alter table public.inventory_purchases disable row level security;

-- Realtime
alter publication supabase_realtime add table public.inventory_purchases;
