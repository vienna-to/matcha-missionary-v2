-- ============================================================
-- Migration: Add taxable flag to menu_items.
--
-- Defaults to true so legacy rows are treated as taxable — safer
-- for tax reporting. Toggle per item in Menu Manager.
--
-- Run once. Safe to re-run.
-- ============================================================

alter table public.menu_items
  add column if not exists taxable boolean not null default true;
