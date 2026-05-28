-- ============================================================
-- Migration: Add `sort_order` to menu_items so users can reorder
-- menu items in Menu Manager and have that order reflected
-- everywhere items are listed (Live Orders, Quick-Add Past Event,
-- Finance, Event Summary).
--
-- Backfill: existing rows get sort_order based on their creation
-- order (oldest first = lowest sort_order = top of list).
--
-- Run once. Safe to re-run.
-- ============================================================

alter table public.menu_items
  add column if not exists sort_order integer;

-- Backfill: rank by created_at, oldest first.
with ranked as (
  select id,
         row_number() over (partition by workspace_id order by created_at) - 1 as rn
  from public.menu_items
)
update public.menu_items mi
   set sort_order = ranked.rn
  from ranked
 where mi.id = ranked.id
   and mi.sort_order is null;

create index if not exists idx_menu_items_workspace_sort
  on public.menu_items(workspace_id, sort_order nulls last);
