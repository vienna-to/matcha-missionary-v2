import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Event,
  Ingredient,
  InventoryPurchase,
  MenuItem,
  MenuSnapshot,
  Order,
  OrderItem,
  Settings,
} from "@/lib/types";
import {
  toEventInsert,
  toEventPatch,
  toIngredientInsert,
  toIngredientPatch,
  toInventoryPurchaseInsert,
  toInventoryPurchasePatch,
  toMenuItemInsert,
  toMenuItemPatch,
  toOrderInsert,
  toOrderItemInsert,
  toOrderItemPatch,
  toOrderPatch,
} from "./serialize";

/**
 * Write helpers. Each is fire-and-forget — the local reducer has already
 * updated state optimistically. Errors are logged so we know if a write
 * silently dropped (e.g. RLS denied, network blip).
 */
function tag(label: string) {
  return (e: unknown) => {
    if (e) console.error(`[supabase ${label}]`, e);
  };
}

export const writer = (supabase: SupabaseClient, workspaceId: string) => ({
  async updateSettings(patch: Partial<Settings>) {
    const r: Record<string, unknown> = {};
    if (patch.lowMarginThresholdPct !== undefined) r.low_margin_threshold_pct = patch.lowMarginThresholdPct;
    if (patch.baristaPingEnabled    !== undefined) r.barista_ping_enabled     = patch.baristaPingEnabled;
    if (patch.audioUnlocked         !== undefined) r.audio_unlocked           = patch.audioUnlocked;
    if (Object.keys(r).length === 0) return;
    const { error } = await supabase.from("workspaces").update(r).eq("id", workspaceId);
    tag("updateSettings")(error);
  },

  // ---------- ingredients ----------
  async addIngredient(ing: Ingredient) {
    const { error } = await supabase.from("ingredients").insert(toIngredientInsert(workspaceId, ing));
    tag("addIngredient")(error);
  },
  async updateIngredient(id: string, patch: Partial<Ingredient>) {
    const { error } = await supabase
      .from("ingredients")
      .update(toIngredientPatch(patch))
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    tag("updateIngredient")(error);
  },
  async deleteIngredient(id: string) {
    const { error } = await supabase
      .from("ingredients")
      .delete()
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    tag("deleteIngredient")(error);
  },

  // ---------- menu items ----------
  async addMenuItem(m: MenuItem) {
    const { error } = await supabase.from("menu_items").insert(toMenuItemInsert(workspaceId, m));
    tag("addMenuItem")(error);
  },
  async updateMenuItem(id: string, patch: Partial<MenuItem>) {
    const { error } = await supabase
      .from("menu_items")
      .update(toMenuItemPatch(patch))
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    tag("updateMenuItem")(error);
  },
  async deleteMenuItem(id: string) {
    const { error } = await supabase
      .from("menu_items")
      .delete()
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    tag("deleteMenuItem")(error);
  },

  // ---------- events ----------
  async createEvent(evt: Event, snapshot: MenuSnapshot) {
    const { error } = await supabase.from("events").insert(toEventInsert(workspaceId, evt, snapshot));
    tag("createEvent")(error);
  },
  async updateEvent(id: string, patch: Partial<Event>) {
    const { error } = await supabase
      .from("events")
      .update(toEventPatch(patch))
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    tag("updateEvent")(error);
  },
  async deleteEvent(id: string) {
    // CASCADE on the FK takes care of orders + order_items.
    const { error } = await supabase
      .from("events")
      .delete()
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    tag("deleteEvent")(error);
  },
  async setActiveEvent(id: string) {
    // The DB trigger (`tg_events_single_active`) deactivates the others.
    const { error } = await supabase
      .from("events")
      .update({ is_active: true })
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    tag("setActiveEvent")(error);
  },

  // ---------- orders ----------
  async submitOrder(o: Order) {
    const { error: e1 } = await supabase.from("orders").insert(toOrderInsert(workspaceId, o));
    tag("submitOrder:order")(e1);
    if (o.items.length > 0) {
      const { error: e2 } = await supabase
        .from("order_items")
        .insert(o.items.map((it) => toOrderItemInsert(workspaceId, it)));
      tag("submitOrder:items")(e2);
    }
  },
  async updateOrder(id: string, patch: Partial<Order>) {
    const { error } = await supabase
      .from("orders")
      .update(toOrderPatch(patch))
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    tag("updateOrder")(error);
  },
  async deleteOrder(id: string) {
    const { error } = await supabase
      .from("orders")
      .delete()
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    tag("deleteOrder")(error);
  },
  async replaceOrderItems(orderId: string, items: OrderItem[]) {
    // Simple approach: delete + insert (atomic from the client's view; small set).
    const { error: e1 } = await supabase
      .from("order_items")
      .delete()
      .eq("order_id", orderId)
      .eq("workspace_id", workspaceId);
    tag("replaceOrderItems:delete")(e1);
    if (items.length > 0) {
      const { error: e2 } = await supabase
        .from("order_items")
        .insert(items.map((it) => toOrderItemInsert(workspaceId, it)));
      tag("replaceOrderItems:insert")(e2);
    }
  },
  async updateOrderItemStatus(orderItemId: string, status: OrderItem["status"]) {
    const { error } = await supabase
      .from("order_items")
      .update({ status })
      .eq("id", orderItemId)
      .eq("workspace_id", workspaceId);
    tag("updateOrderItemStatus")(error);
  },
  async updateOrderItem(orderItemId: string, patch: Partial<OrderItem>) {
    const dbPatch = toOrderItemPatch(patch);
    if (Object.keys(dbPatch).length === 0) return;
    const { error } = await supabase
      .from("order_items")
      .update(dbPatch)
      .eq("id", orderItemId)
      .eq("workspace_id", workspaceId);
    tag("updateOrderItem")(error);
  },

  // ---------- inventory purchases ----------
  async addInventoryPurchase(p: InventoryPurchase) {
    const { error } = await supabase
      .from("inventory_purchases")
      .insert(toInventoryPurchaseInsert(workspaceId, p));
    tag("addInventoryPurchase")(error);
  },
  async updateInventoryPurchase(id: string, patch: Partial<InventoryPurchase>) {
    const { error } = await supabase
      .from("inventory_purchases")
      .update(toInventoryPurchasePatch(patch))
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    tag("updateInventoryPurchase")(error);
  },
  async deleteInventoryPurchase(id: string) {
    const { error } = await supabase
      .from("inventory_purchases")
      .delete()
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    tag("deleteInventoryPurchase")(error);
  },
});

export type Writer = ReturnType<typeof writer>;
