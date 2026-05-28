import type { SupabaseClient } from "@supabase/supabase-js";
import { initialSeed } from "@/lib/seed";
import type { MenuItem, MenuSnapshot, Order, OrderItem, Event as AppEvent } from "@/lib/types";
import {
  toEventInsert,
  toIngredientInsert,
  toMenuItemInsert,
  toOrderInsert,
  toOrderItemInsert,
} from "./serialize";

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback (browsers without crypto.randomUUID are vanishingly rare)
  const r = (Math.random().toString(16) + "000000000").slice(2, 10);
  return `${r}-${r.slice(0, 4)}-4${r.slice(0, 3)}-8${r.slice(0, 3)}-${r}${r.slice(0, 4)}`;
}

const remapMaybe = (id: string | undefined, map: Map<string, string>): string | undefined =>
  id === undefined ? undefined : map.get(id) ?? id;

/**
 * Bulk-load the UCI Spring Pop-Up sample data into the given Supabase
 * workspace. Generates fresh UUIDs and remaps every cross-reference so the
 * data inserts cleanly against the uuid-PK schema.
 *
 * Idempotency: every call creates a NEW sample event (with fresh UUIDs). Run
 * once per test. If you call it twice you'll get two sample events.
 */
export async function loadSampleDataIntoSupabase(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<void> {
  const seed = initialSeed();

  // ---------- ID remapping ----------
  const ingMap = new Map<string, string>();
  for (const i of seed.ingredients) ingMap.set(i.id, uuid());

  const miMap = new Map<string, string>();
  for (const m of seed.menuItems) miMap.set(m.id, uuid());

  // ---------- Rewrite entities ----------
  const newIngredients = seed.ingredients.map((i) => ({
    ...i,
    id: ingMap.get(i.id)!,
  }));

  const newMenuItems: MenuItem[] = seed.menuItems.map((m) => ({
    ...m,
    id: miMap.get(m.id)!,
    ingredientLines: m.ingredientLines.map((l) => ({
      ...l,
      ingredientId: ingMap.get(l.ingredientId) ?? l.ingredientId,
    })),
    defaultMilkId: remapMaybe(m.defaultMilkId, ingMap),
    defaultCreamId: remapMaybe(m.defaultCreamId, ingMap),
    allowedMilkIds: m.allowedMilkIds.map((id) => ingMap.get(id) ?? id),
    allowedCreamIds: m.allowedCreamIds.map((id) => ingMap.get(id) ?? id),
  }));

  // The seed has exactly one event + matching snapshot. Build the new versions.
  const seedEvent = seed.events[0];
  const newEventId = uuid();
  const newSnapshotId = uuid();

  const newSnapshot: MenuSnapshot = {
    id: newSnapshotId,
    menuItems: newMenuItems.map((m) => ({
      ...m,
      ingredientLines: m.ingredientLines.map((l) => ({ ...l })),
      allowedMilkIds: [...m.allowedMilkIds],
      allowedCreamIds: [...m.allowedCreamIds],
    })),
    ingredients: newIngredients.map((i) => ({ ...i })),
    createdAt: seed.menuSnapshots[0]?.createdAt ?? new Date().toISOString(),
  };

  const newEvent: AppEvent = {
    ...seedEvent,
    id: newEventId,
    menuSnapshotId: newSnapshotId,
    isActive: true,
  };

  // ---------- Rewrite orders + order_items ----------
  const newOrders: Order[] = [];
  const newOrderItems: OrderItem[] = [];
  for (const o of seed.orders) {
    const newOrderId = uuid();
    const remappedItems: OrderItem[] = o.items.map((oi) => ({
      ...oi,
      id: uuid(),
      orderId: newOrderId,
      menuItemId: miMap.get(oi.menuItemId) ?? oi.menuItemId,
      milkChoiceId: remapMaybe(oi.milkChoiceId, ingMap),
      // "none" is a sentinel meaning "no cream selected" — preserve it as-is.
      creamChoiceId:
        oi.creamChoiceId === "none" ? "none" : remapMaybe(oi.creamChoiceId, ingMap),
    }));
    newOrders.push({
      ...o,
      id: newOrderId,
      eventId: newEventId,
      items: remappedItems,
    });
    newOrderItems.push(...remappedItems);
  }

  // ---------- Insertion order (FK-safe) ----------
  // 1. ingredients
  {
    const { error } = await supabase
      .from("ingredients")
      .insert(newIngredients.map((i) => toIngredientInsert(workspaceId, i)));
    if (error) throw new Error(`ingredients: ${error.message}`);
  }
  // 2. menu_items (default_milk_id / default_cream_id FK ingredients)
  {
    const { error } = await supabase
      .from("menu_items")
      .insert(newMenuItems.map((m) => toMenuItemInsert(workspaceId, m)));
    if (error) throw new Error(`menu_items: ${error.message}`);
  }
  // 3. event (single insert with embedded snapshot)
  {
    const { error } = await supabase
      .from("events")
      .insert(toEventInsert(workspaceId, newEvent, newSnapshot));
    if (error) throw new Error(`events: ${error.message}`);
  }
  // 4. orders (in chunks if > 100 — the seed only has 30, single insert is fine)
  {
    const { error } = await supabase
      .from("orders")
      .insert(newOrders.map((o) => toOrderInsert(workspaceId, o)));
    if (error) throw new Error(`orders: ${error.message}`);
  }
  // 5. order_items (~35 rows)
  if (newOrderItems.length > 0) {
    const { error } = await supabase
      .from("order_items")
      .insert(newOrderItems.map((oi) => toOrderItemInsert(workspaceId, oi)));
    if (error) throw new Error(`order_items: ${error.message}`);
  }
}

/**
 * Find and delete a sample event by name. Cascade on the FK takes care of
 * its orders + order_items. Master menu_items and ingredients are left alone
 * (they're shared with whatever the user has built since).
 */
export async function clearSampleEventFromSupabase(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("events")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("name", "UCI Spring Pop-Up")
    .select("id");
  if (error) throw new Error(error.message);
  return (data?.length ?? 0);
}
