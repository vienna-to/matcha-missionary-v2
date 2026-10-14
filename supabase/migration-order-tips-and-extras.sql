-- ============================================================
-- Migration: extra money (tips / round-ups) on orders + standalone extras.
--
-- orders.tip_amount          : extra money received with the order. Never part
--                              of item prices, line totals or revenue.
--                              Existing orders default to 0.
-- orders.tip_payment_method  : how the extra was paid. NULL means "same as the
--                              order's payment_method".
-- event_extras               : extra money not tied to an order (for example a
--                              Venmo sent after the event). One row per entry.
--
-- Run order: after migration-order-item-prices.sql. Run once. Safe to re-run.
-- ============================================================

alter table public.orders
  add column if not exists tip_amount numeric not null default 0,
  add column if not exists tip_payment_method text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_tip_amount_nonneg'
  ) then
    alter table public.orders
      add constraint orders_tip_amount_nonneg check (tip_amount >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'orders_tip_payment_method_check'
  ) then
    alter table public.orders
      add constraint orders_tip_payment_method_check
      check (
        tip_payment_method is null
        or tip_payment_method in ('cash', 'venmo', 'zelle', 'card', 'other')
      );
  end if;
end $$;

create table if not exists public.event_extras (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  event_id        uuid not null references public.events(id) on delete cascade,
  amount          numeric not null check (amount > 0),
  payment_method  text not null
                  check (payment_method in ('cash', 'venmo', 'zelle', 'card', 'other')),
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_event_extras_workspace
  on public.event_extras(workspace_id);
create index if not exists idx_event_extras_event
  on public.event_extras(event_id);

drop trigger if exists trg_event_extras_updated_at on public.event_extras;
create trigger trg_event_extras_updated_at before update on public.event_extras
  for each row execute function public.tg_set_updated_at();

-- RLS off (workspace code is the gate, per supabase/migration-disable-rls.sql)
alter table public.event_extras disable row level security;

-- Realtime (guarded: ADD TABLE errors if it is already published)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'event_extras'
  ) then
    alter publication supabase_realtime add table public.event_extras;
  end if;
end $$;

notify pgrst, 'reload schema';
