-- ============================================================
-- Matcha Missionary — Supabase schema
-- Run this in the Supabase SQL editor (single execution).
-- Idempotent: safe to re-run; uses IF NOT EXISTS / OR REPLACE.
-- ============================================================

-- ---------- Extensions ----------
create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- ============================================================
-- 1. Tables
-- ============================================================

-- A workspace is the unit of pairing. One install = one workspace,
-- identified by a 6-char human-typed code.
create table if not exists public.workspaces (
  id                          uuid primary key default gen_random_uuid(),
  code                        text not null unique,
  low_margin_threshold_pct    numeric not null default 30,
  barista_ping_enabled        boolean not null default true,
  audio_unlocked              boolean not null default false,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- Master ingredient list — editable any time. Used for derived costs.
create table if not exists public.ingredients (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  name            text not null,
  package_price   numeric not null,
  package_amount  numeric not null,
  unit            text not null check (unit in ('g','oz','kg','lb','ml','fl_oz','cup','piece','bag')),
  pool            text check (pool in ('milk','cream')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Master menu items — editable any time. Cost is derived from ingredient_lines.
create table if not exists public.menu_items (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  name                text not null,
  category            text default 'other',
  price               numeric not null,
  size                text not null default 'other',
  active              boolean not null default true,
  description         text,
  -- ingredient_lines: [{ ingredientId, amount, unit }]
  ingredient_lines    jsonb not null default '[]'::jsonb,
  default_milk_id     uuid references public.ingredients(id) on delete set null,
  default_cream_id    uuid references public.ingredients(id) on delete set null,
  -- arrays of ingredient UUIDs the user is allowed to pick at order time
  allowed_milk_ids    jsonb not null default '[]'::jsonb,
  allowed_cream_ids   jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Events. Menu is snapshotted at creation time (frozen).
-- menu_snapshot stores the deep-cloned menu_items + ingredients + pools
-- so editing the master menu later doesn't mutate event history.
create table if not exists public.events (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  name                text not null,
  date                date not null,
  start_time          text,
  end_time            text,
  target_revenue      numeric,
  is_active           boolean not null default false,
  -- Frozen menu snapshot — see TypeScript MenuSnapshot
  menu_snapshot       jsonb not null,
  -- Fixed costs [{ id, name, amount, allocationMethod }]
  fixed_costs         jsonb not null default '[]'::jsonb,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Orders. order_number resets to 1 per event.
create table if not exists public.orders (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  event_id            uuid not null references public.events(id) on delete cascade,
  order_number        integer not null,
  customer_name       text not null,
  status              text not null check (status in ('pending','in_progress','completed','cancelled')),
  payment_status      text not null check (payment_status in ('paid','unpaid','comped')),
  payment_method      text check (payment_method in ('cash','venmo','zelle','card','other')),
  comp_reason         text check (comp_reason in ('friend','sample','mistake','staff','other')),
  comp_reason_other   text,
  notes               text,
  submitted_at        timestamptz not null default now(),
  done_at             timestamptz,
  updated_at          timestamptz not null default now(),
  -- order_number unique within an event
  unique (event_id, order_number)
);

-- Order items — separate table so per-drink toggles can sync via Realtime.
-- Costs/prices are stamped at submit time so master menu edits don't reflow history.
create table if not exists public.order_items (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  order_id            uuid not null references public.orders(id) on delete cascade,
  -- These reference the snapshot, stored as text since the snapshot lives in JSON.
  menu_item_id        text not null,
  menu_item_name_snap text not null,
  price_snap          numeric not null,
  cost_snap           numeric not null,
  quantity            integer not null check (quantity > 0),
  milk_choice_id      text,
  cream_choice_id     text,
  sugar_adjustment    text check (sugar_adjustment in ('less','normal','extra','no_agave')),
  ice_adjustment      text check (ice_adjustment in ('light','normal','extra')),
  special_requests    text,
  status              text not null check (status in ('pending','in_progress','done'))
);

-- ============================================================
-- 2. Indexes
-- ============================================================

create index if not exists idx_ingredients_workspace      on public.ingredients(workspace_id);
create index if not exists idx_menu_items_workspace       on public.menu_items(workspace_id);
create index if not exists idx_events_workspace           on public.events(workspace_id);
create index if not exists idx_events_workspace_active    on public.events(workspace_id) where is_active = true;
create index if not exists idx_orders_workspace_event     on public.orders(workspace_id, event_id);
create index if not exists idx_orders_event_submitted     on public.orders(event_id, submitted_at);
create index if not exists idx_order_items_order          on public.order_items(order_id);
create index if not exists idx_order_items_workspace      on public.order_items(workspace_id);

-- ============================================================
-- 3. updated_at triggers
-- ============================================================

create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_workspaces_updated_at on public.workspaces;
create trigger trg_workspaces_updated_at  before update on public.workspaces
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_ingredients_updated_at on public.ingredients;
create trigger trg_ingredients_updated_at before update on public.ingredients
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_menu_items_updated_at on public.menu_items;
create trigger trg_menu_items_updated_at  before update on public.menu_items
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_events_updated_at on public.events;
create trigger trg_events_updated_at      before update on public.events
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at      before update on public.orders
  for each row execute function public.tg_set_updated_at();

-- ============================================================
-- 4. doneAt auto-stamp on orders.status = 'completed'
-- ============================================================

create or replace function public.tg_orders_done_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'completed' and (old.status is distinct from 'completed' or new.done_at is null) then
    new.done_at = coalesce(new.done_at, now());
  elsif new.status <> 'completed' and old.status = 'completed' then
    new.done_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_done_at on public.orders;
create trigger trg_orders_done_at before update on public.orders
  for each row execute function public.tg_orders_done_at();

-- ============================================================
-- 5. "Only one active event per workspace" (Create morning-of)
--    When a new event is inserted with is_active=true, deactivate others.
-- ============================================================

create or replace function public.tg_events_single_active()
returns trigger language plpgsql as $$
begin
  if new.is_active then
    update public.events
       set is_active = false
     where workspace_id = new.workspace_id
       and id <> new.id
       and is_active = true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_events_single_active on public.events;
create trigger trg_events_single_active
  after insert or update of is_active on public.events
  for each row when (new.is_active = true)
  execute function public.tg_events_single_active();

-- ============================================================
-- 6. Realtime — publish the tables the app subscribes to
-- ============================================================

-- Create publication if it doesn't exist (Supabase usually has supabase_realtime already)
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table public.workspaces;
alter publication supabase_realtime add table public.ingredients;
alter publication supabase_realtime add table public.menu_items;
alter publication supabase_realtime add table public.events;
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.order_items;

-- ============================================================
-- 7. Row Level Security
--
-- Auth model per finalized SPEC §3: "No accounts. Workspace code only."
-- The workspace code is the secret; the anon API key is public.
-- Strategy: enable RLS, set a per-request workspace_id via
-- `set_config('app.workspace_id', ...)` from the client, and gate every
-- row on that. Insertion of new workspaces is unrestricted.
--
-- App should call once after pairing (via .rpc('set_workspace', { code }))
-- or pass workspace_id with every query and trust client-side filtering.
-- Below is the permissive variant most teams start with — tighten later.
-- ============================================================

alter table public.workspaces  enable row level security;
alter table public.ingredients enable row level security;
alter table public.menu_items  enable row level security;
alter table public.events      enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

-- Helper: return the workspace_id set on this session (or NULL).
create or replace function public.current_workspace_id()
returns uuid language sql stable as $$
  select nullif(current_setting('app.workspace_id', true), '')::uuid;
$$;

-- RPC the client calls after pairing: validates the code and sets the
-- session variable used by all RLS policies below.
create or replace function public.set_workspace(p_code text)
returns uuid language plpgsql security definer as $$
declare
  v_id uuid;
begin
  select id into v_id from public.workspaces where code = p_code;
  if v_id is null then
    raise exception 'unknown workspace code';
  end if;
  perform set_config('app.workspace_id', v_id::text, false);
  return v_id;
end;
$$;
grant execute on function public.set_workspace(text) to anon, authenticated;

-- --- workspaces ---
drop policy if exists "anon can create workspaces"   on public.workspaces;
drop policy if exists "session can read own workspace" on public.workspaces;
drop policy if exists "session can update own workspace" on public.workspaces;
create policy "anon can create workspaces"     on public.workspaces for insert to anon, authenticated with check (true);
create policy "session can read own workspace" on public.workspaces for select to anon, authenticated using (id = public.current_workspace_id());
create policy "session can update own workspace" on public.workspaces for update to anon, authenticated using (id = public.current_workspace_id()) with check (id = public.current_workspace_id());

-- --- helper macro to install standard "same-workspace" policies ---
-- (Copy/paste the four policies per table.)

-- ingredients
drop policy if exists "ingredients read"   on public.ingredients;
drop policy if exists "ingredients insert" on public.ingredients;
drop policy if exists "ingredients update" on public.ingredients;
drop policy if exists "ingredients delete" on public.ingredients;
create policy "ingredients read"   on public.ingredients for select to anon, authenticated using (workspace_id = public.current_workspace_id());
create policy "ingredients insert" on public.ingredients for insert to anon, authenticated with check (workspace_id = public.current_workspace_id());
create policy "ingredients update" on public.ingredients for update to anon, authenticated using (workspace_id = public.current_workspace_id()) with check (workspace_id = public.current_workspace_id());
create policy "ingredients delete" on public.ingredients for delete to anon, authenticated using (workspace_id = public.current_workspace_id());

-- menu_items
drop policy if exists "menu_items read"   on public.menu_items;
drop policy if exists "menu_items insert" on public.menu_items;
drop policy if exists "menu_items update" on public.menu_items;
drop policy if exists "menu_items delete" on public.menu_items;
create policy "menu_items read"   on public.menu_items for select to anon, authenticated using (workspace_id = public.current_workspace_id());
create policy "menu_items insert" on public.menu_items for insert to anon, authenticated with check (workspace_id = public.current_workspace_id());
create policy "menu_items update" on public.menu_items for update to anon, authenticated using (workspace_id = public.current_workspace_id()) with check (workspace_id = public.current_workspace_id());
create policy "menu_items delete" on public.menu_items for delete to anon, authenticated using (workspace_id = public.current_workspace_id());

-- events
drop policy if exists "events read"   on public.events;
drop policy if exists "events insert" on public.events;
drop policy if exists "events update" on public.events;
drop policy if exists "events delete" on public.events;
create policy "events read"   on public.events for select to anon, authenticated using (workspace_id = public.current_workspace_id());
create policy "events insert" on public.events for insert to anon, authenticated with check (workspace_id = public.current_workspace_id());
create policy "events update" on public.events for update to anon, authenticated using (workspace_id = public.current_workspace_id()) with check (workspace_id = public.current_workspace_id());
create policy "events delete" on public.events for delete to anon, authenticated using (workspace_id = public.current_workspace_id());

-- orders
drop policy if exists "orders read"   on public.orders;
drop policy if exists "orders insert" on public.orders;
drop policy if exists "orders update" on public.orders;
drop policy if exists "orders delete" on public.orders;
create policy "orders read"   on public.orders for select to anon, authenticated using (workspace_id = public.current_workspace_id());
create policy "orders insert" on public.orders for insert to anon, authenticated with check (workspace_id = public.current_workspace_id());
create policy "orders update" on public.orders for update to anon, authenticated using (workspace_id = public.current_workspace_id()) with check (workspace_id = public.current_workspace_id());
create policy "orders delete" on public.orders for delete to anon, authenticated using (workspace_id = public.current_workspace_id());

-- order_items
drop policy if exists "order_items read"   on public.order_items;
drop policy if exists "order_items insert" on public.order_items;
drop policy if exists "order_items update" on public.order_items;
drop policy if exists "order_items delete" on public.order_items;
create policy "order_items read"   on public.order_items for select to anon, authenticated using (workspace_id = public.current_workspace_id());
create policy "order_items insert" on public.order_items for insert to anon, authenticated with check (workspace_id = public.current_workspace_id());
create policy "order_items update" on public.order_items for update to anon, authenticated using (workspace_id = public.current_workspace_id()) with check (workspace_id = public.current_workspace_id());
create policy "order_items delete" on public.order_items for delete to anon, authenticated using (workspace_id = public.current_workspace_id());

-- ============================================================
-- Done. Next steps:
-- 1. In the Supabase dashboard, copy the project URL and anon key into
--    .env.local as NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.
-- 2. After the user enters a workspace code on first launch, call
--      supabase.rpc('set_workspace', { p_code: '<code>' })
--    once per session before any reads/writes.
-- 3. Subscribe to realtime on orders, order_items, events, menu_items, ingredients
--    filtered by workspace_id.
-- ============================================================
