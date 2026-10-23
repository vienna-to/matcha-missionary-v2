-- ============================================================
-- Migration: ingredient role for the custom drink builder.
--
-- Adds ingredients.custom_role: 'base' (a tea such as matcha or hojicha),
-- 'topping' (a cream or purée), 'none' (never offered) or null (not set yet).
-- The custom drink builder shows dropdowns filled only from ingredients marked
-- base or topping; each ingredient is set in Menu Manager > Ingredients.
-- Milk is never a base: it is added to a tea drink automatically.
--
-- Backfill: so existing menus keep working, ingredients that are obviously
-- teas, creams or purées are marked once, using the same name rule the app
-- used to guess with. Review them in Menu Manager. Rows this does not match
-- stay null (not set) and are not offered until you choose.
--
-- The app works without this migration (it guesses from names and keeps the
-- role only on the device), so the app can be deployed before it is run.
-- Run once. Safe to re-run: the backfill only touches rows that are still null.
-- ============================================================

alter table public.ingredients
  add column if not exists custom_role text
  check (custom_role in ('base', 'topping', 'none'));

-- toppings: every cream, and purées
update public.ingredients
   set custom_role = 'topping'
 where custom_role is null
   and (pool = 'cream' or name ~* 'pur[eé]e');

-- bases: teas (never the milk pool)
update public.ingredients
   set custom_role = 'base'
 where custom_role is null
   and pool is distinct from 'milk'
   and name ~* '\m(matcha|hojicha|tea|earl grey|genmaicha|sencha|chai)\M';

-- Make PostgREST pick up the new column immediately.
notify pgrst, 'reload schema';
