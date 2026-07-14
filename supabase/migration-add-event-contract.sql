-- ============================================================
-- Migration: Add event_type + cup_size_oz + contract fields to events.
--
-- event_type = 'standard' (default; existing behaviour) or 'contract'
--   (fixed-fee event: client pays a flat contract_payout regardless of
--   how many drinks are served — no overage tracking).
-- cup_size_oz = per-event cup size. New events default to 16 in the UI.
--   Existing rows stay NULL and are treated as "no scaling" by the cost
--   calc, so their stamped costSnaps remain unchanged.
-- client_name, contract_payout = only meaningful when event_type='contract'.
--
-- All new columns are additive & nullable (except event_type which
-- defaults to 'standard'), so existing rows are untouched.
-- Run once. Safe to re-run.
-- ============================================================

alter table public.events
  add column if not exists event_type text not null default 'standard'
    check (event_type in ('standard','contract')),
  add column if not exists cup_size_oz numeric,
  add column if not exists client_name text,
  add column if not exists contract_payout numeric;
