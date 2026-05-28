-- ============================================================
-- Migration: Disable RLS for the workspace-code-only auth model.
--
-- Why: The session-variable approach used by current_workspace_id()
-- doesn't survive across PostgREST requests (each request is its own
-- transaction), so RLS rejects every query. Realtime has the same issue.
--
-- Trust model after this migration:
--  - The Supabase anon key is public (shipped in the client bundle).
--  - The 6-char workspace code is the only secret keeping a workspace
--    private. App code always filters by workspace_id.
--  - Anyone with both the anon key and a workspace code can access that
--    workspace; anyone with just the anon key can enumerate workspace
--    codes via `select code from workspaces` — accepted as part of the
--    "no auth, lose the code = lose the data" spec model.
--
-- Run once after the initial schema.sql. Safe to re-run.
-- ============================================================

alter table public.workspaces  disable row level security;
alter table public.ingredients disable row level security;
alter table public.menu_items  disable row level security;
alter table public.events      disable row level security;
alter table public.orders      disable row level security;
alter table public.order_items disable row level security;

-- Drop the policies so they don't surprise anyone who toggles RLS back on.
drop policy if exists "anon can create workspaces"     on public.workspaces;
drop policy if exists "session can read own workspace" on public.workspaces;
drop policy if exists "session can update own workspace" on public.workspaces;

drop policy if exists "ingredients read"   on public.ingredients;
drop policy if exists "ingredients insert" on public.ingredients;
drop policy if exists "ingredients update" on public.ingredients;
drop policy if exists "ingredients delete" on public.ingredients;

drop policy if exists "menu_items read"   on public.menu_items;
drop policy if exists "menu_items insert" on public.menu_items;
drop policy if exists "menu_items update" on public.menu_items;
drop policy if exists "menu_items delete" on public.menu_items;

drop policy if exists "events read"   on public.events;
drop policy if exists "events insert" on public.events;
drop policy if exists "events update" on public.events;
drop policy if exists "events delete" on public.events;

drop policy if exists "orders read"   on public.orders;
drop policy if exists "orders insert" on public.orders;
drop policy if exists "orders update" on public.orders;
drop policy if exists "orders delete" on public.orders;

drop policy if exists "order_items read"   on public.order_items;
drop policy if exists "order_items insert" on public.order_items;
drop policy if exists "order_items update" on public.order_items;
drop policy if exists "order_items delete" on public.order_items;

-- The set_workspace / current_workspace_id helpers are no longer wired.
-- Keep them defined (harmless) in case you re-enable RLS later with a
-- header-based or JWT-based strategy.
