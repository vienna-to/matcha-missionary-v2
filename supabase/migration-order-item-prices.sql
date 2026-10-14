-- ============================================================
-- Migration: list_price / price_charged / free_reason on order_items.
--
-- list_price    : menu price per unit at time of sale (same value as the
--                 existing price_snap).
-- price_charged : what the customer actually paid per unit.
--                 Free       = price_charged = 0
--                 Discounted = price_charged > 0 and < list_price
--                 "Free" is derived from this number, never a manual flag.
-- free_reason   : optional label on a free line (giveaway, sample, staff,
--                 influencer, other).
--
-- Backfill (existing rows), so revenue totals do not move:
--   list_price    = price_snap
--   price_charged = price_snap * (1 - coalesce(discount_pct, 0) / 100)
-- That is exactly the number the app has always computed for revenue.
-- price_snap and discount_pct stay in place and are still written.
--
-- A trigger keeps price_charged correct for clients that still only know
-- about price_snap / discount_pct (an iPad on an old tab, an old deploy):
-- on insert it fills the two columns when missing, and on update it
-- recomputes price_charged when only discount_pct or price_snap changed.
--
-- Run order: this file, then migration-order-tips-and-extras.sql, then
-- migration-submit-order-v2.sql. Run once. Safe to re-run.
-- ============================================================

alter table public.order_items
  add column if not exists list_price    numeric,
  add column if not exists price_charged numeric,
  add column if not exists free_reason   text;

-- Backfill only rows that have not been filled yet.
update public.order_items
   set list_price    = coalesce(list_price, price_snap),
       price_charged = coalesce(
         price_charged,
         price_snap * (1 - coalesce(discount_pct, 0) / 100)
       )
 where list_price is null or price_charged is null;

alter table public.order_items
  alter column list_price    set not null,
  alter column price_charged set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'order_items_price_nonneg'
  ) then
    alter table public.order_items
      add constraint order_items_price_nonneg
      check (list_price >= 0 and price_charged >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'order_items_free_reason_check'
  ) then
    alter table public.order_items
      add constraint order_items_free_reason_check
      check (
        free_reason is null
        or free_reason in ('giveaway', 'sample', 'staff', 'influencer', 'other')
      );
  end if;
end $$;

create or replace function public.tg_order_items_prices()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.list_price := coalesce(new.list_price, new.price_snap);
    new.price_charged := coalesce(
      new.price_charged,
      new.price_snap * (1 - coalesce(new.discount_pct, 0) / 100)
    );
  else
    -- Old clients patch discount_pct (or price_snap) alone. Re-derive
    -- price_charged unless the writer also changed it explicitly.
    if new.price_charged is not distinct from old.price_charged
       and (new.discount_pct is distinct from old.discount_pct
            or new.price_snap is distinct from old.price_snap) then
      new.price_charged := new.price_snap * (1 - coalesce(new.discount_pct, 0) / 100);
    end if;
    if new.price_snap is distinct from old.price_snap
       and new.list_price is not distinct from old.list_price then
      new.list_price := new.price_snap;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_order_items_prices on public.order_items;
create trigger trg_order_items_prices
  before insert or update on public.order_items
  for each row execute function public.tg_order_items_prices();

notify pgrst, 'reload schema';
