-- ============================================================
-- Migration: allow "friend" as a free reason on order_items.
--
-- migration-order-item-prices.sql created the check constraint
-- order_items_free_reason_check allowing giveaway, sample, staff,
-- influencer, other. This drops it and re-adds it with "friend" added.
-- That earlier migration is left untouched.
--
-- It also drops any other check constraint on order_items whose
-- definition mentions free_reason, in case the constraint ended up with
-- a different name on your database.
--
-- Run once, after migration-order-item-prices.sql. Safe to re-run.
-- ============================================================

do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.order_items'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%free_reason%'
  loop
    execute format('alter table public.order_items drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.order_items
  add constraint order_items_free_reason_check
  check (
    free_reason is null
    or free_reason in ('giveaway', 'sample', 'staff', 'influencer', 'friend', 'other')
  );

notify pgrst, 'reload schema';
