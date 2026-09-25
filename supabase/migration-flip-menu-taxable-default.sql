-- ============================================================
-- Migration: Flip taxable default from true → false, and backfill
-- existing rows to false.
--
-- Only needed for workspaces that already ran the older version of
-- migration-add-menu-taxable.sql (which shipped with `default true`).
-- If your Menu Manager already shows the checkbox off for every
-- item you didn't opt in, you can skip this file.
--
-- Run once. Safe to re-run.
-- ============================================================

alter table public.menu_items
  alter column taxable set default false;

-- Reset every existing item to non-taxable. Uncheck to opt items in
-- individually from Menu Manager afterwards.
update public.menu_items
   set taxable = false
 where taxable is distinct from false;
