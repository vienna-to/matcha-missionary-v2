import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Event,
  Ingredient,
  InventoryPurchase,
  MenuItem,
  MenuSnapshot,
  Order,
  OrderItem,
  OrderRevision,
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
  toOrderRevisionInsert,
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

/**
 * Retry a Supabase write a few times on transient failure. Only retries when
 * `.insert()` / `.update()` returned a truthy error — successful writes are
 * one-shot. Used for high-stakes writes (like order submission) where a
 * silent drop means a customer walks away without their drink.
 *
 * The Postgres client itself does not throw on network hiccups, so this only
 * catches errors that Supabase surfaces via the `{ error }` return.
 */
async function retryWithBackoff<T extends { error: unknown }>(
  label: string,
  op: () => PromiseLike<T>,
  attempts = 3,
): Promise<T> {
  let last: T | undefined;
  let delayMs = 300;
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await op();
      if (!result.error) return result;
      last = result;
      console.warn(`[supabase ${label}] attempt ${i + 1}/${attempts} failed`, result.error);
    } catch (e) {
      console.warn(`[supabase ${label}] attempt ${i + 1}/${attempts} threw`, e);
      last = { error: e } as T;
    }
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs *= 2;
    }
  }
  return last!;
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
    // Upsert (INSERT ... ON CONFLICT DO NOTHING) so a caller that already
    // upserted the same event row defensively (e.g. ContractResultsDialog,
    // which needs the FK target to exist before writing orders) doesn't get
    // followed by a noisy unique-violation from this fire-and-forget writer.
    const { error } = await supabase
      .from("events")
      .upsert(toEventInsert(workspaceId, evt, snapshot), {
        onConflict: "id",
        ignoreDuplicates: true,
      });
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
  async submitOrder(
    o: Order,
  ): Promise<{ finalOrderNumber: number } | { error: string }> {
    // Order submission is the most costly write to lose — a dropped one means
    // a customer's drink never reaches the barista queue. Handles two hazards:
    //
    // 1. Concurrent submits from two devices can pick the same order_number
    //    (both derived from local state). The DB has UNIQUE(event_id,
    //    order_number) so the second insert fails with 23505. We detect that,
    //    query max(order_number) in the DB, bump, and retry — up to 5x.
    //
    // 2. Parent order can insert successfully while items insert fails, which
    //    leaves other devices seeing an empty "0 items" card in the queue.
    //    On items failure we roll back the parent so the state is consistent.
    let currentOrder = o;
    let insertedParent = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const r1 = await supabase
        .from("orders")
        .insert(toOrderInsert(workspaceId, currentOrder));
      if (!r1.error) {
        insertedParent = true;
        break;
      }
      const code = (r1.error as { code?: string } | null)?.code;
      if (code !== "23505") {
        // Not a collision — a real error. Retry with backoff via the shared
        // helper (network blip / transient RLS glitch / …).
        const retried = await retryWithBackoff("submitOrder:order", () =>
          supabase.from("orders").insert(toOrderInsert(workspaceId, currentOrder)),
        );
        tag("submitOrder:order")(retried.error);
        if (retried.error) return { error: "order insert failed" };
        insertedParent = true;
        break;
      }
      // Collision on (event_id, order_number). Look up the actual current
      // max and bump past it.
      const { data: maxRow } = await supabase
        .from("orders")
        .select("order_number")
        .eq("workspace_id", workspaceId)
        .eq("event_id", currentOrder.eventId)
        .order("order_number", { ascending: false })
        .limit(1);
      const observedMax =
        (maxRow?.[0]?.order_number as number | undefined) ?? currentOrder.orderNumber;
      const nextNum = Math.max(observedMax + 1, currentOrder.orderNumber + 1);
      console.warn(
        `[supabase submitOrder] order_number collision at ${currentOrder.orderNumber}; renumbering to ${nextNum}`,
      );
      currentOrder = { ...currentOrder, orderNumber: nextNum };
    }
    if (!insertedParent) {
      console.error(`[supabase submitOrder] gave up after 5 renumber attempts`);
      return { error: "renumber attempts exhausted" };
    }

    if (currentOrder.items.length > 0) {
      const r2 = await retryWithBackoff("submitOrder:items", () =>
        supabase
          .from("order_items")
          .insert(currentOrder.items.map((it) => toOrderItemInsert(workspaceId, it))),
      );
      if (r2.error) {
        tag("submitOrder:items")(r2.error);
        // Roll back the parent so other devices don't see a phantom empty
        // order in the barista queue. The submitter's local optimistic order
        // will get removed by the RT_DELETE_ORDER echo — they should try
        // submitting again.
        console.error(
          `[supabase submitOrder] items failed after parent inserted — rolling back order ${currentOrder.id}`,
        );
        await supabase
          .from("orders")
          .delete()
          .eq("id", currentOrder.id)
          .eq("workspace_id", workspaceId);
        return { error: "items insert failed; parent rolled back" };
      }
    }

    return { finalOrderNumber: currentOrder.orderNumber };
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

  // ---------- order revisions (audit trail, append-only) ----------
  async writeOrderRevision(rev: Omit<OrderRevision, "occurredAt">) {
    // Persist the DB-generated id-and-timestamp so the local record matches
    // what future loads will see. Snapshot writes are best-effort: if the
    // table doesn't exist yet (migration not run), we warn and continue so
    // the user's edit still lands locally.
    const row = { id: rev.id, ...toOrderRevisionInsert(workspaceId, rev) };
    const { error } = await supabase.from("order_revisions").insert(row);
    tag("writeOrderRevision")(error);
  },
});

export type Writer = ReturnType<typeof writer>;
