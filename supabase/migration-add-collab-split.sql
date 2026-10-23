-- ============================================================
-- Migration: collab profit / expense split on events.
--
--   collab_profit_pct     the partner's share (0-100) of the event's profit
--   collab_contribution   dollars the partner puts toward ingredients,
--                         typed per event (not a percentage)
--
-- Event Summary then shows:
--   partner take-home = (profit x collab_profit_pct / 100) - collab_contribution
--   your take-home    = profit - partner take-home
--
-- Both columns are optional (null = not a collab), so every existing event is
-- unchanged. The app works without this migration (the split is kept on the
-- device that typed it and a red banner says to run this), so the app can be
-- deployed before it is run. Run once. Safe to re-run.
-- ============================================================

alter table public.events
  add column if not exists collab_profit_pct numeric
  check (collab_profit_pct is null or (collab_profit_pct >= 0 and collab_profit_pct <= 100));

alter table public.events
  add column if not exists collab_contribution numeric
  check (collab_contribution is null or collab_contribution >= 0);

-- Make PostgREST pick up the new columns immediately.
notify pgrst, 'reload schema';
