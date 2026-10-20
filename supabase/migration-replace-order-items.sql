-- ============================================================
-- Migration: replace_order_items (atomic "edit order" item update).
--
-- Why: saving an edited order used to be two requests, DELETE the old
-- order_items then INSERT the new ones. In between, other devices (and the
-- 5s poll) could read the order with no items, or with a mix of old and new
-- rows. This function does both steps in ONE transaction, so every reader
-- sees either the complete old set or the complete new set, never a mix.
--
-- It is idempotent for a given payload (running it twice leaves the same
-- rows). An empty array is allowed and removes all items, matching the old
-- behaviour of an edit that removes every line.
--
-- Columns mirror submit_order v2 (migration-submit-order-v2.sql), so run this
-- AFTER that migration and the ones it depends on. Run once; safe to re-run.
--
-- The app falls back to the old delete + insert if this function is missing,
-- so it is safe to deploy the app before or after running this.
-- ============================================================

create or replace function public.replace_order_items(
  p_order_id     uuid,
  p_workspace_id uuid,
  p_items        jsonb
)
returns jsonb
language plpgsql
as $$
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'replace_order_items: p_items must be a json array';
  end if;

  -- Lock the order row so two concurrent edits of one order serialize instead
  -- of interleaving their deletes and inserts.
  perform 1 from public.orders
    where id = p_order_id and workspace_id = p_workspace_id
    for update;
  if not found then
    raise exception 'replace_order_items: order % not found in this workspace', p_order_id;
  end if;

  delete from public.order_items
    where order_id = p_order_id and workspace_id = p_workspace_id;

  insert into public.order_items (
    id, workspace_id, order_id, menu_item_id, menu_item_name_snap, price_snap,
    cost_snap, quantity, milk_choice_id, cream_choice_id, milk_name_snap,
    cream_name_snap, sugar_adjustment, ice_adjustment, special_requests, status,
    is_combo, combo_pastry_id, combo_pastry_name_snap, combo_pastry_cost_snap,
    discount_pct, list_price, price_charged, free_reason
  )
  select
    i.id, p_workspace_id, p_order_id, i.menu_item_id, i.menu_item_name_snap, i.price_snap,
    i.cost_snap, i.quantity, i.milk_choice_id, i.cream_choice_id, i.milk_name_snap,
    i.cream_name_snap, i.sugar_adjustment, i.ice_adjustment, i.special_requests,
    coalesce(i.status, 'pending'),
    coalesce(i.is_combo, false), i.combo_pastry_id, i.combo_pastry_name_snap,
    i.combo_pastry_cost_snap, i.discount_pct,
    coalesce(i.list_price, i.price_snap),
    coalesce(i.price_charged, i.price_snap * (1 - coalesce(i.discount_pct, 0) / 100)),
    i.free_reason
  from jsonb_populate_recordset(null::public.order_items, p_items) i;

  return jsonb_build_object('items', jsonb_array_length(p_items), 'features', 1);
end;
$$;

grant execute on function public.replace_order_items(uuid, uuid, jsonb) to anon, authenticated;

-- Make PostgREST pick up the new function immediately.
notify pgrst, 'reload schema';
