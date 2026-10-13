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

/** PostgREST "function not in schema cache" / Postgres "undefined function". */
function isMissingRpc(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "PGRST202" || code === "42883";
}

function rpcResult(data: unknown, o: Order): { finalOrderNumber: number } {
  const n = (data as { order_number?: number } | null)?.order_number;
  return { finalOrderNumber: typeof n === "number" ? n : o.orderNumber };
}

/** Insert order_items, tolerating a database that predates the *_name_snap
 *  columns (migration-atomic-order.sql not run yet). */
async function insertOrderItems(
  supabase: SupabaseClient,
  workspaceId: string,
  items: OrderItem[],
  label: string,
) {
  const attempt = (includeSnapNames: boolean) =>
    retryWithBackoff(label, () =>
      supabase
        .from("order_items")
        .insert(items.map((it) => toOrderItemInsert(workspaceId, it, { includeSnapNames }))),
    );
  const first = await attempt(true);
  if (first.error && /_name_snap/.test(String((first.error as { message?: string }).message))) {
    return attempt(false);
  }
  return first;
}

/** The pre-migration two-step write: order first, then items, rolling the
 *  order back if the items fail. Not atomic — another device can briefly see
 *  the order without items — which is exactly why submit_order() exists. */
async function legacySubmitOrder(
  supabase: SupabaseClient,
  workspaceId: string,
  o: Order,
): Promise<{ finalOrderNumber: number } | { error: string }> {
  let currentOrder = o;
  let insertedParent = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const r1 = await supabase.from("orders").insert(toOrderInsert(workspaceId, currentOrder));
    if (!r1.error) {
      insertedParent = true;
      break;
    }
    const code = (r1.error as { code?: string } | null)?.code;
    if (code !== "23505") {
      const retried = await retryWithBackoff("submitOrder:order", () =>
        supabase.from("orders").insert(toOrderInsert(workspaceId, currentOrder)),
      );
      tag("submitOrder:order")(retried.error);
      if (retried.error) return { error: "order insert failed" };
      insertedParent = true;
      break;
    }
    // 23505 is either an order_number collision or a retry of an order that
    // already landed. Tell them apart before renumbering.
    const { data: already } = await supabase
      .from("orders")
      .select("order_number")
      .eq("id", currentOrder.id)
      .limit(1);
    if (already && already.length > 0) {
      const { count } = await supabase
        .from("order_items")
        .select("id", { count: "exact", head: true })
        .eq("order_id", currentOrder.id);
      if ((count ?? 0) > 0) {
        return { finalOrderNumber: already[0].order_number as number };
      }
      insertedParent = true; // parent exists but items never landed — finish them
      currentOrder = { ...currentOrder, orderNumber: already[0].order_number as number };
      break;
    }
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
    const r2 = await insertOrderItems(supabase, workspaceId, currentOrder.items, "submitOrder:items");
    if (r2.error) {
      tag("submitOrder:items")(r2.error);
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
    // a customer's drink never reaches the barista queue.
    //
    // Preferred path: ONE transaction (public.submit_order) writes the order
    // and all its items, so Realtime can never broadcast an order that has no
    // items yet. It is idempotent on order id, so retrying is always safe.
    const rpc = () =>
      supabase.rpc("submit_order", {
        p_order: toOrderInsert(workspaceId, o),
        p_items: o.items.map((it) => toOrderItemInsert(workspaceId, it)),
      });
    let r = await rpc();
    if (!r.error) return rpcResult(r.data, o);
    if (!isMissingRpc(r.error)) {
      r = await retryWithBackoff("submitOrder:rpc", rpc);
      if (!r.error) return rpcResult(r.data, o);
      tag("submitOrder:rpc")(r.error);
      return { error: "order submit failed" };
    }
    // The migration hasn't been run on this database yet — fall back to the
    // old two-step write so ordering keeps working (but see its caveat).
    console.warn(
      "[supabase submitOrder] submit_order() not found — run supabase/migration-atomic-order.sql. Using non-atomic fallback.",
    );
    return legacySubmitOrder(supabase, workspaceId, o);
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
      const { error: e2 } = await insertOrderItems(
        supabase,
        workspaceId,
        items,
        "replaceOrderItems:insert",
      );
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
