-- ============================================================
-- Migration: Add `sort_order` to ingredients so users can drag to
-- reorder the Ingredients list in Menu Manager.
--
-- Backfill: existing rows get sort_order by creation order
-- (oldest first = top of list).
--
-- Run once. Safe to re-run.
-- ============================================================

alter table public.ingredients
  add column if not exists sort_order integer;

with ranked as (
  select id,
         row_number() over (partition by workspace_id order by created_at) - 1 as rn
  from public.ingredients
)
update public.ingredients i
   set sort_order = ranked.rn
  from ranked
 where i.id = ranked.id
   and i.sort_order is null;

create index if not exists idx_ingredients_workspace_sort
  on public.ingredients(workspace_id, sort_order nulls last);
