-- ============================================================
-- Migration: let the app's roles (anon, authenticated) use event_extras and
-- order_revisions.
--
-- Why: the app talks to Supabase with the anon key and relies on table
-- privileges alone (row level security is off on every table, see
-- migration-disable-rls.sql). None of the migrations ever GRANTs table
-- privileges; the tables created in May (workspaces, ingredients, menu_items,
-- events, orders, order_items, inventory_purchases) work because they picked up
-- Supabase's default privileges when they were created. The two tables created
-- later (order_revisions in September, event_extras in October) did not: in
-- production the anon role holds only TRUNCATE / REFERENCES / TRIGGER on them,
-- so every read and write fails with 42501 "permission denied".
--
-- Effect of the bug in production: tips / extra money (event_extras) and the
-- order edit audit trail (order_revisions) silently do not load or save. The
-- app tolerates the errors, so nothing is shown.
--
-- What this grants (the least the app needs, see src/lib/supabase):
--   event_extras    : SELECT, INSERT, UPDATE, DELETE  (the app reads, adds,
--                     edits and removes entries)
--   order_revisions : SELECT, INSERT only             (append-only audit log:
--                     the app never updates or deletes a revision, so the
--                     anon role is deliberately not given UPDATE / DELETE)
--
-- Nothing else changes: no table, column, policy or function is touched, and
-- TRUNCATE is not granted. Granting is idempotent, safe to re-run.
--
-- Not related to replace_order_items: that function only touches orders and
-- order_items. The audit row is written by the app as a separate request.
-- ============================================================

grant select, insert, update, delete on table public.event_extras    to anon, authenticated;
grant select, insert                 on table public.order_revisions to anon, authenticated;

-- Make PostgREST pick up the new privileges immediately.
notify pgrst, 'reload schema';

-- To check afterwards (read-only):
--   select grantee, table_name, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name in ('event_extras', 'order_revisions')
--      and grantee = 'anon'
--    order by table_name, privilege_type;
