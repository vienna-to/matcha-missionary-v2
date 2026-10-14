-- ============================================================
-- Migration: submit_order v2 (carries the new price / extra columns).
--
-- Replaces public.submit_order(jsonb, jsonb). Built from the latest live
-- definition, which is the one in migration-atomic-order.sql (no other
-- migration file defines or alters this function), with these additions:
--   orders      : tip_amount, tip_payment_method
--   order_items : list_price, price_charged, free_reason
-- Everything else (idempotent on order id, order_number bump on collision,
-- rejects empty items, all earlier columns) is unchanged.
--
-- The result now also carries "features": 2. The app uses that to detect an
-- old function that would silently ignore tip / free reason, and shows an
-- error instead of losing them.
--
-- Run order: AFTER migration-order-item-prices.sql and
-- migration-order-tips-and-extras.sql (it references their columns).
-- Run once. Safe to re-run.
-- ============================================================

create or replace function public.submit_order(p_order jsonb, p_items jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_id          uuid := (p_order->>'id')::uuid;
  v_event_id    uuid := (p_order->>'event_id')::uuid;
  v_workspace   uuid := (p_order->>'workspace_id')::uuid;
  v_number      integer := (p_order->>'order_number')::integer;
  v_existing    integer;
  v_try         integer := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'submit_order: an order needs at least one item';
  end if;

  select order_number into v_existing from public.orders where id = v_id;
  if found then
    return jsonb_build_object('order_number', v_existing, 'features', 2);
  end if;

  loop
    begin
      insert into public.orders (
        id, workspace_id, event_id, order_number, customer_name, status,
        payment_status, payment_method, comp_reason, comp_reason_other, notes,
        submitted_at, done_at, queue_priority, tip_amount, tip_payment_method
      )
      select
        v_id, v_workspace, v_event_id, v_number, r.customer_name, r.status,
        r.payment_status, r.payment_method, r.comp_reason, r.comp_reason_other, r.notes,
        coalesce(r.submitted_at, now()), r.done_at, r.queue_priority,
        coalesce(r.tip_amount, 0), r.tip_payment_method
      from jsonb_populate_record(null::public.orders, p_order) r;
      exit;
    exception when unique_violation then
      -- Either a concurrent submit of this same id (return it) or another
      -- order took this number (bump and retry).
      select order_number into v_existing from public.orders where id = v_id;
      if found then
        return jsonb_build_object('order_number', v_existing, 'features', 2);
      end if;
      v_try := v_try + 1;
      if v_try > 5 then
        raise;
      end if;
      select coalesce(max(order_number), 0) + 1 into v_number
        from public.orders where event_id = v_event_id;
    end;
  end loop;

  insert into public.order_items (
    id, workspace_id, order_id, menu_item_id, menu_item_name_snap, price_snap,
    cost_snap, quantity, milk_choice_id, cream_choice_id, milk_name_snap,
    cream_name_snap, sugar_adjustment, ice_adjustment, special_requests, status,
    is_combo, combo_pastry_id, combo_pastry_name_snap, combo_pastry_cost_snap,
    discount_pct, list_price, price_charged, free_reason
  )
  select
    i.id, v_workspace, v_id, i.menu_item_id, i.menu_item_name_snap, i.price_snap,
    i.cost_snap, i.quantity, i.milk_choice_id, i.cream_choice_id, i.milk_name_snap,
    i.cream_name_snap, i.sugar_adjustment, i.ice_adjustment, i.special_requests,
    coalesce(i.status, 'pending'),
    coalesce(i.is_combo, false), i.combo_pastry_id, i.combo_pastry_name_snap,
    i.combo_pastry_cost_snap, i.discount_pct,
    coalesce(i.list_price, i.price_snap),
    coalesce(i.price_charged, i.price_snap * (1 - coalesce(i.discount_pct, 0) / 100)),
    i.free_reason
  from jsonb_populate_recordset(null::public.order_items, p_items) i;

  return jsonb_build_object('order_number', v_number, 'features', 2);
end;
$$;

grant execute on function public.submit_order(jsonb, jsonb) to anon, authenticated;

-- Make PostgREST pick up the replaced function immediately.
notify pgrst, 'reload schema';
