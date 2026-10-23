import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Event,
  EventExtra,
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
  isMissingTable,
  isMissingPreparedColumn,
  missingColumns,
  MIGRATION_HINT,
  PREPARED_MIGRATION_HINT,
  reportSaveError,
} from "./save-errors";
import {
  toEventExtraInsert,
  toEventExtraPatch,
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

const money = (n: number) => `$${n.toFixed(2)}`;

/** Tell the user, loudly, that a tip / a free reason did not reach the
 *  database. Never swallowed: the values were real input. */
function reportLostExtras(o: Pick<Order, "orderNumber">, what: string) {
  reportSaveError(
    `Order #${o.orderNumber}: ${what} could not be saved because the database is out of date. ` +
      `The order itself was saved. ${MIGRATION_HINT} Then re-enter it with Edit order.`,
  );
}

function reportLostFreeReason(orderNumber: number | string) {
  reportSaveError(
    `Order #${orderNumber}: the free reason could not be saved because the database is out of date. ` +
      `${MIGRATION_HINT} Then set it again on the item.`,
  );
}

/** Insert order_items, tolerating a database that predates the *_name_snap
 *  columns (migration-atomic-order.sql) or the price columns (silently, since
 *  they are derived from price_snap / discount_pct). A missing free_reason
 *  column is reported to the user when a reason was set. */
async function insertOrderItems(
  supabase: SupabaseClient,
  workspaceId: string,
  items: OrderItem[],
  label: string,
): Promise<{ error: unknown; lostFreeReason: boolean }> {
  const opts = { includeSnapNames: true, includePrices: true, includeFreeReason: true };
  let last: unknown = null;
  for (let i = 0; i < 4; i++) {
    const r = await retryWithBackoff(label, () =>
      supabase
        .from("order_items")
        .insert(items.map((it) => toOrderItemInsert(workspaceId, it, opts))),
    );
    if (!r.error) {
      return {
        error: null,
        lostFreeReason: !opts.includeFreeReason && items.some((it) => Boolean(it.freeReason)),
      };
    }
    last = r.error;
    const msg = String((r.error as { message?: string }).message);
    const miss = missingColumns(r.error);
    let changed = false;
    if (opts.includeSnapNames && /_name_snap/.test(msg)) {
      opts.includeSnapNames = false;
      changed = true;
    }
    if (opts.includePrices && miss.some((c) => c === "list_price" || c === "price_charged")) {
      opts.includePrices = false;
      changed = true;
    }
    if (opts.includeFreeReason && miss.includes("free_reason")) {
      opts.includeFreeReason = false;
      changed = true;
    }
    if (!changed) break;
  }
  return { error: last, lostFreeReason: false };
}

/** submit_order() returns features: 2 once migration-submit-order-v2.sql has
 *  run. An older function ignores tip / free reason without any error. */
function rpcHasV2(data: unknown): boolean {
  return (data as { features?: number } | null)?.features === 2;
}

function orderHasExtras(o: Order): boolean {
  return (
    (o.tipAmount ?? 0) > 0 ||
    Boolean(o.tipPaymentMethod) ||
    o.items.some((it) => Boolean(it.freeReason))
  );
}

/** The submit_order() on this database predates tip / free reason and dropped
 *  them. Apply them with plain updates, and report if the columns are missing. */
async function healExtras(supabase: SupabaseClient, workspaceId: string, o: Order) {
  console.warn(
    "[supabase submitOrder] submit_order() is out of date. Run supabase/migration-submit-order-v2.sql.",
  );
  if ((o.tipAmount ?? 0) > 0 || o.tipPaymentMethod) {
    const { error } = await supabase
      .from("orders")
      .update(toOrderPatch({ tipAmount: o.tipAmount, tipPaymentMethod: o.tipPaymentMethod }))
      .eq("id", o.id)
      .eq("workspace_id", workspaceId);
    if (error) {
      if (missingColumns(error).length > 0) {
        reportLostExtras(o, `the tip of ${money(o.tipAmount ?? 0)}`);
      } else {
        tag("healExtras:tip")(error);
        reportSaveError(
          `Order #${o.orderNumber}: the tip of ${money(o.tipAmount ?? 0)} may not have been saved. Open Edit order to check it.`,
        );
      }
    }
  }
  for (const it of o.items) {
    if (!it.freeReason) continue;
    const { error } = await supabase
      .from("order_items")
      .update({ free_reason: it.freeReason })
      .eq("id", it.id)
      .eq("workspace_id", workspaceId);
    if (error) {
      if (missingColumns(error).length > 0) reportLostFreeReason(o.orderNumber);
      else tag("healExtras:freeReason")(error);
    }
  }
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
  let includeTip = true;
  const orderRow = () => toOrderInsert(workspaceId, currentOrder, { includeTip });
  for (let attempt = 0; attempt < 6; attempt++) {
    const r1 = await supabase.from("orders").insert(orderRow());
    if (!r1.error) {
      insertedParent = true;
      break;
    }
    const code = (r1.error as { code?: string } | null)?.code;
    if (includeTip && missingColumns(r1.error).some((c) => c === "tip_amount" || c === "tip_payment_method")) {
      // The extra columns do not exist yet. Save the order without them so
      // the drink still reaches the barista, and tell the user what was lost.
      includeTip = false;
      if ((currentOrder.tipAmount ?? 0) > 0 || currentOrder.tipPaymentMethod) {
        reportLostExtras(currentOrder, `the tip of ${money(currentOrder.tipAmount ?? 0)}`);
      }
      continue;
    }
    if (code !== "23505") {
      const retried = await retryWithBackoff("submitOrder:order", () =>
        supabase.from("orders").insert(orderRow()),
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
    console.error(`[supabase submitOrder] gave up after 6 attempts`);
    return { error: "renumber attempts exhausted" };
  }

  if (currentOrder.items.length > 0) {
    const r2 = await insertOrderItems(supabase, workspaceId, currentOrder.items, "submitOrder:items");
    if (r2.lostFreeReason) reportLostFreeReason(currentOrder.orderNumber);
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
    if (error && ing.kind === "prepared" && isMissingPreparedColumn(error)) {
      // Never save it as a raw ingredient (it would cost $0): say so, loudly.
      reportSaveError(`The prepared ingredient "${ing.name}" could not be saved: the database is out of date. ${PREPARED_MIGRATION_HINT}`);
      return;
    }
    tag("addIngredient")(error);
  },
  async updateIngredient(id: string, patch: Partial<Ingredient>) {
    const { error } = await supabase
      .from("ingredients")
      .update(toIngredientPatch(patch))
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    if (error && (patch.kind !== undefined || patch.subRecipe !== undefined) && isMissingPreparedColumn(error)) {
      reportSaveError(`A prepared ingredient change could not be saved: the database is out of date. ${PREPARED_MIGRATION_HINT}`);
      // Keep the rest of the edit, but never the price reset that goes with becoming prepared.
      const { kind: _k, subRecipe: _s, ...rest } = patch;
      void _k;
      void _s;
      if (patch.kind === "prepared") delete rest.packagePrice;
      if (Object.keys(rest).length === 0) return;
      const r2 = await supabase
        .from("ingredients")
        .update(toIngredientPatch(rest))
        .eq("id", id)
        .eq("workspace_id", workspaceId);
      tag("updateIngredient")(r2.error);
      return;
    }
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
    const done = async (data: unknown) => {
      if (!rpcHasV2(data) && orderHasExtras(o)) await healExtras(supabase, workspaceId, o);
      return rpcResult(data, o);
    };
    let r = await rpc();
    if (!r.error) return done(r.data);
    if (!isMissingRpc(r.error) && missingColumns(r.error).length === 0) {
      r = await retryWithBackoff("submitOrder:rpc", rpc);
      if (!r.error) return done(r.data);
      if (missingColumns(r.error).length === 0) {
        tag("submitOrder:rpc")(r.error);
        return { error: "order submit failed" };
      }
    }
    if (!isMissingRpc(r.error)) {
      // The function wants columns this database does not have yet. The
      // fallback below saves what it can and reports what it had to drop.
      console.warn("[supabase submitOrder] submit_order() failed on a missing column", r.error);
      return legacySubmitOrder(supabase, workspaceId, o);
    }
    // The migration hasn't been run on this database yet — fall back to the
    // old two-step write so ordering keeps working (but see its caveat).
    console.warn(
      "[supabase submitOrder] submit_order() not found — run supabase/migration-atomic-order.sql. Using non-atomic fallback.",
    );
    return legacySubmitOrder(supabase, workspaceId, o);
  },
  async updateOrder(id: string, patch: Partial<Order>) {
    const dbPatch = toOrderPatch(patch);
    if (Object.keys(dbPatch).length === 0) return;
    const { error } = await supabase
      .from("orders")
      .update(dbPatch)
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    if (error && missingColumns(error).length > 0) {
      // Save the rest of the edit (name, notes, ...) and say loudly that the
      // extra did not land.
      const rest: Record<string, unknown> = { ...dbPatch };
      const hadTip = "tip_amount" in rest || "tip_payment_method" in rest;
      delete rest.tip_amount;
      delete rest.tip_payment_method;
      if (Object.keys(rest).length > 0) {
        const r2 = await supabase
          .from("orders")
          .update(rest)
          .eq("id", id)
          .eq("workspace_id", workspaceId);
        tag("updateOrder")(r2.error);
      }
      if (hadTip) {
        reportSaveError(
          `The tip on this order could not be saved because the database is out of date. ${MIGRATION_HINT}`,
        );
      }
      return;
    }
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
    // Preferred path: ONE transaction (public.replace_order_items) swaps the
    // old rows for the new ones, so no reader (another device, the 5s poll)
    // ever sees the order with no items or with a mix of old and new rows.
    const rpc = () =>
      supabase.rpc("replace_order_items", {
        p_order_id: orderId,
        p_workspace_id: workspaceId,
        p_items: items.map((it) => toOrderItemInsert(workspaceId, it)),
      });
    let r = await rpc();
    if (!r.error) return;
    if (!isMissingRpc(r.error)) {
      // A failed call rolled back, so the old items are still intact: safe to retry.
      r = await retryWithBackoff("replaceOrderItems:rpc", rpc);
      if (!r.error) return;
      if (!isMissingRpc(r.error)) {
        tag("replaceOrderItems:rpc")(r.error);
        return;
      }
    }
    // The migration hasn't been run on this database yet: fall back to the
    // old two-step write so editing keeps working (but see its caveat).
    console.warn(
      "[supabase replaceOrderItems] replace_order_items() not found, run supabase/migration-replace-order-items.sql. Using non-atomic fallback.",
    );
    const { error: e1 } = await supabase
      .from("order_items")
      .delete()
      .eq("order_id", orderId)
      .eq("workspace_id", workspaceId);
    tag("replaceOrderItems:delete")(e1);
    if (items.length > 0) {
      const r2 = await insertOrderItems(supabase, workspaceId, items, "replaceOrderItems:insert");
      if (r2.lostFreeReason) reportLostFreeReason("(edited)");
      tag("replaceOrderItems:insert")(r2.error);
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
    const miss = missingColumns(error);
    if (error && miss.length > 0) {
      // Retry with the plain columns so the discount still lands. A missing
      // price column is lossless (derived from discount_pct); a missing
      // free_reason column loses real input, so that one is reported.
      const lost = miss.includes("free_reason") && Boolean(patch.freeReason);
      const rest: Record<string, unknown> = { ...dbPatch };
      delete rest.list_price;
      delete rest.price_charged;
      delete rest.free_reason;
      if (Object.keys(rest).length > 0) {
        const r2 = await supabase
          .from("order_items")
          .update(rest)
          .eq("id", orderItemId)
          .eq("workspace_id", workspaceId);
        tag("updateOrderItem")(r2.error);
      }
      if (lost) reportLostFreeReason("(edited)");
      return;
    }
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

  // ---------- standalone extra money ----------
  async addEventExtra(x: EventExtra) {
    const { error } = await supabase
      .from("event_extras")
      .insert(toEventExtraInsert(workspaceId, x));
    if (error && isMissingTable(error)) {
      reportSaveError(
        `The tip of ${money(x.amount)} was not saved because the event_extras table does not exist. Run supabase/migration-order-tips-and-extras.sql, then add it again.`,
      );
      return;
    }
    if (error) {
      reportSaveError(
        `The tip of ${money(x.amount)} may not have been saved. Check your connection and add it again if it is missing.`,
      );
    }
    tag("addEventExtra")(error);
  },
  async updateEventExtra(id: string, patch: Partial<EventExtra>) {
    const { error } = await supabase
      .from("event_extras")
      .update(toEventExtraPatch(patch))
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    if (error) reportSaveError("A tip entry could not be updated. Check your connection and try again.");
    tag("updateEventExtra")(error);
  },
  async deleteEventExtra(id: string) {
    const { error } = await supabase
      .from("event_extras")
      .delete()
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    if (error) reportSaveError("A tip entry could not be deleted. Check your connection and try again.");
    tag("deleteEventExtra")(error);
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
