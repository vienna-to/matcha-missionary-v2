-- ============================================================
-- Migration: prepared (composite) ingredients.
--
-- An ingredient is either RAW (a typed package price, as always) or PREPARED:
-- made from raw ingredients, with its cost computed from that sub-recipe.
--
--   kind        'raw' (default, every existing row) or 'prepared'
--   sub_recipe  prepared only: json list of { ingredientId, amount, unit } naming
--               RAW ingredients (one level: never another prepared ingredient)
--
-- The YIELD of one batch is stored in the existing package_amount + unit
-- columns (for example 32 and fl_oz), and package_price is 0 for a prepared
-- ingredient. Its cost per unit is never stored: the app computes
--   (cost of one batch of the sub-recipe) / (yield)
-- so a raw price change flows into the prepared ingredient and every drink
-- that uses it, and a placed order keeps the cost it was sold at (cost_snap).
--
-- The app works without this migration for everything that is raw. A prepared
-- ingredient needs these columns to be saved (without them the app says so and
-- keeps it on that device only), so the app can be deployed before this runs.
-- Run once. Safe to re-run; existing rows stay raw.
-- ============================================================

alter table public.ingredients
  add column if not exists kind text not null default 'raw'
  check (kind in ('raw', 'prepared'));

alter table public.ingredients
  add column if not exists sub_recipe jsonb;

-- Make PostgREST pick up the new columns immediately.
notify pgrst, 'reload schema';
