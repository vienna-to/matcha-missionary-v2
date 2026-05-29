-- ============================================================
-- Migration: Add donation_pct to events.
--
-- For charity events where a percentage of revenue per drink is
-- donated. Optional — defaults to NULL (no donation). Event Summary
-- subtracts (revenue × donation_pct/100) from net profit when set.
--
-- Run once. Safe to re-run.
-- ============================================================

alter table public.events
  add column if not exists donation_pct numeric
  check (donation_pct is null or (donation_pct >= 0 and donation_pct <= 100));
