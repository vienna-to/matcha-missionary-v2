-- ============================================================
-- Migration: Add city + admission_charged to events (tax reporting).
--
-- Both fields are optional so historical rows keep working. The
-- Settings → Tax records report groups revenue by city and by
-- admission-charged / free-entry.
--
-- Run once. Safe to re-run.
-- ============================================================

alter table public.events
  add column if not exists city text,
  add column if not exists admission_charged boolean;

create index if not exists idx_events_workspace_city
  on public.events(workspace_id, city);
