-- ============================================================
-- Migration: Add taxable flag to menu_items.
--
-- Defaults to FALSE — user opts items in per row from Menu Manager.
-- Undefined / missing values elsewhere in the app also default to
-- non-taxable so the tax report never over-attributes revenue.
--
-- Run once. Safe to re-run.
-- ============================================================

alter table public.menu_items
  add column if not exists taxable boolean not null default false;
