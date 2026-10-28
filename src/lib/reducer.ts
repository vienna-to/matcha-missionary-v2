import { validateEventTimes } from "./event-times";
import { computeItemCost } from "./calc";
import { comboUnitPrice, customItemCost, findMenuItem, isCustomItemId, parseCustomItemId } from "./custom-item";
import { normalizeIngredientPatch, normalizeNewIngredient } from "./prepared";
import { newId, nowIso } from "./id";
import { menuForOrderEdit } from "./edit-menu";
import { chargedUnitFromPct, normalizeItemPatch } from "./pricing";
import { hasDrinkAdjustments, resolveCreamName, resolveMilkName } from "./order-labels";
import {
  type AppState,
  type Event,
  type EventExtra,
  type FixedCost,
  type Ingredient,
  type InventoryPurchase,
  type MenuItem,
  type MenuSnapshot,
  type Order,
  type OrderItem,
  type OrderItemStatus,
  type OrderRevision,
  type OrderStatus,
  type Settings,
} from "./types";

export type Action =
  | { type: "REPLACE"; state: AppState }
  | { type: "UPDATE_SETTINGS"; patch: Partial<Settings> }
  | { type: "ADD_INGREDIENT"; ing: Omit<Ingredient, "id" | "createdAt" | "updatedAt"> }
  | { type: "UPDATE_INGREDIENT"; id: string; patch: Partial<Ingredient> }
  | { type: "DELETE_INGREDIENT"; id: string }
  | {
      type: "ADD_MENU_ITEM";
      item: Omit<MenuItem, "id" | "createdAt" | "updatedAt">;
    }
  | { type: "UPDATE_MENU_ITEM"; id: string; patch: Partial<MenuItem> }
  | { type: "DELETE_MENU_ITEM"; id: string }
  | {
      type: "CREATE_EVENT";
      event: Omit<
        Event,
        "id" | "menuSnapshotId" | "fixedCosts" | "isActive" | "createdAt" | "updatedAt"
      > & { initialFixedCosts?: FixedCost[] };
    }
  | { type: "UPDATE_EVENT"; id: string; patch: Partial<Event> }
  | { type: "DELETE_EVENT"; id: string }
  | { type: "SET_ACTIVE_EVENT"; id: string }
  | {
      type: "UPDATE_EVENT_SNAPSHOT";
      eventId: string;
      patch: Partial<MenuSnapshot>;
    }
  /** The caller must pass a fully-formed Order (with id + items + orderNumber).
   *  This avoids the race where setTimeout-based writers re-read stateRef and
   *  pick up the wrong "latest" order when two submits happen back-to-back. */
  | { type: "SUBMIT_ORDER"; order: Order }
  | { type: "UPDATE_ORDER"; id: string; patch: Partial<Order> }
  | {
      type: "REPLACE_ORDER_ITEMS";
      orderId: string;
      items: (Omit<OrderItem, "id" | "orderId" | "priceSnap" | "listPrice" | "priceCharged" | "costSnap" | "menuItemNameSnap" | "status"> & {
        status?: OrderItemStatus;
        /** Id of the existing order line this draft came from. Lets the reducer
         *  keep the price and cost stamped at sale time instead of re-pricing. */
        sourceItemId?: string;
      })[];
    }
  | {
      type: "SET_ORDER_ITEM_STATUS";
      orderId: string;
      orderItemId: string;
      status: OrderItemStatus;
    }
  /** Patch a single order item in place (e.g. change discountPct). */
  | {
      type: "UPDATE_ORDER_ITEM";
      orderId: string;
      orderItemId: string;
      patch: Partial<OrderItem>;
    }
  | { type: "DELETE_ORDER"; id: string }
  | {
      type: "ADD_INVENTORY_PURCHASE";
      purchase: Omit<InventoryPurchase, "id" | "createdAt" | "updatedAt">;
    }
  | { type: "UPDATE_INVENTORY_PURCHASE"; id: string; patch: Partial<InventoryPurchase> }
  | { type: "DELETE_INVENTORY_PURCHASE"; id: string }
  | {
      type: "ADD_EVENT_EXTRA";
      extra: Omit<EventExtra, "id" | "createdAt" | "updatedAt">;
    }
  | { type: "UPDATE_EVENT_EXTRA"; id: string; patch: Partial<EventExtra> }
  | { type: "DELETE_EVENT_EXTRA"; id: string }
  | { type: "RT_UPSERT_EVENT_EXTRA"; extra: EventExtra }
  | { type: "RT_DELETE_EVENT_EXTRA"; id: string }
  | { type: "RT_UPSERT_INVENTORY_PURCHASE"; purchase: InventoryPurchase }
  | { type: "RT_DELETE_INVENTORY_PURCHASE"; id: string }
  /** Local-only insert of an audit snapshot. The Supabase writer mirrors to
   *  the order_revisions table; the reducer just appends. Never edited. */
  | { type: "APPEND_ORDER_REVISION"; revision: OrderRevision }
  | { type: "RESET_TO_SEED"; seed: AppState }
  // -- Realtime echoes from Supabase (idempotent upsert/delete) --
  | { type: "RT_UPSERT_INGREDIENT"; ing: Ingredient }
  | { type: "RT_DELETE_INGREDIENT"; id: string }
  | { type: "RT_UPSERT_MENU_ITEM"; item: MenuItem }
  | { type: "RT_DELETE_MENU_ITEM"; id: string }
  | { type: "RT_UPSERT_EVENT"; event: Event; snapshot?: MenuSnapshot }
  | { type: "RT_DELETE_EVENT"; id: string }
  | { type: "RT_UPSERT_ORDER"; order: Omit<Order, "items">; preserveItems?: boolean }
  | { type: "RT_DELETE_ORDER"; id: string }
  /** Replace/insert a whole order *including* its items (fetched together). */
  | { type: "RT_SET_ORDER"; order: Order }
  /** Result of a poll / full refetch. `scopeEventId` limits which local orders
   *  the server result is authoritative for (undefined = every event).
   *  `keepIds` are orders whose write hasn't landed yet and must survive. */
  | { type: "RT_SYNC_ORDERS"; orders: Order[]; scopeEventId?: string; keepIds: string[] }
  /** `extrasUnavailable`: the event_extras table could not be read (migration
   *  not run), so keep the local list instead of replacing it with nothing. */
  | { type: "RT_SYNC_FULL"; state: AppState; keepIds: string[]; extrasUnavailable?: boolean }
  | { type: "RT_UPSERT_ORDER_ITEM"; item: OrderItem }
  | { type: "RT_DELETE_ORDER_ITEM"; id: string; orderId?: string }
  | { type: "RT_UPDATE_SETTINGS"; patch: Partial<Settings> };

function findSnapshot(state: AppState, id: string): MenuSnapshot | undefined {
  return state.menuSnapshots.find((s) => s.id === id);
}

function findEvent(state: AppState, id: string): Event | undefined {
  return state.events.find((e) => e.id === id);
}

/** Stamp list price, price charged and (for free lines) the reason. */
function priceFields(
  listPrice: number,
  raw: { discountPct?: number; freeReason?: OrderItem["freeReason"] },
): Pick<OrderItem, "listPrice" | "priceCharged" | "freeReason"> {
  const priceCharged = chargedUnitFromPct(listPrice, raw.discountPct);
  return {
    listPrice,
    priceCharged,
    freeReason: priceCharged <= 0 ? raw.freeReason : undefined,
  };
}

export function deriveOrderItem(
  raw: Omit<OrderItem, "id" | "orderId" | "priceSnap" | "listPrice" | "priceCharged" | "costSnap" | "menuItemNameSnap" | "status"> & {
    status?: OrderItemStatus;
  },
  orderId: string,
  snapshot: MenuSnapshot,
  cupSizeOz?: number,
): OrderItem {
  const mi = findMenuItem(snapshot, raw.menuItemId);
  // A custom drink has an automatic milk (the milk choice swaps it, like a
  // menu drink) but no cream choice: its creams are the selected toppings.
  if (isCustomItemId(raw.menuItemId)) {
    raw = { ...raw, creamChoiceId: undefined };
  }
  // Pastries take no milk / cream / sugar / ice: drop them (and skip the
  // default-milk snapshot) so nothing drink-related is ever saved on them.
  // Special requests are kept.
  if (!hasDrinkAdjustments(mi)) {
    raw = {
      ...raw,
      milkChoiceId: undefined,
      creamChoiceId: undefined,
      sugarAdjustment: undefined,
      iceAdjustment: undefined,
    };
  }
  const drinkOptions = hasDrinkAdjustments(mi);
  // Snapshot the human-readable milk / cream now, so the barista card doesn't
  // depend on an ingredient lookup that can miss later.
  const milkNameSnap = drinkOptions
    ? resolveMilkName(raw.milkChoiceId, mi, snapshot.ingredients)
    : undefined;
  const creamNameSnap = drinkOptions
    ? resolveCreamName(raw.creamChoiceId, mi, snapshot.ingredients)
    : undefined;
  const customSpec = parseCustomItemId(raw.menuItemId);
  const drinkCost = customSpec
    ? customItemCost(customSpec, snapshot, cupSizeOz, raw.milkChoiceId)
    : mi
    ? computeItemCost(mi, snapshot.ingredients, {
        milkChoiceId: raw.milkChoiceId,
        creamChoiceId: raw.creamChoiceId,
        cupSizeOz,
      })
    : 0;

  // Combo deal: bundle drink + pastry at the fixed bundle price. costSnap is
  // the *total* cost (drink + pastry) so margin math stays accurate. Pastry
  // cost is per-piece (size === "pastry_count" auto-skips cup scaling inside
  // computeItemCost), so passing cupSizeOz through is safe.
  if (raw.isCombo && raw.comboPastryId) {
    const pastry = snapshot.menuItems.find((m) => m.id === raw.comboPastryId);
    const pastryCost = pastry
      ? computeItemCost(pastry, snapshot.ingredients, { cupSizeOz })
      : 0;
    return {
      id: newId("oi"),
      orderId,
      menuItemId: raw.menuItemId,
      menuItemNameSnap: mi?.name ?? "Unknown drink",
      priceSnap: comboUnitPrice(raw.menuItemId),
      ...priceFields(comboUnitPrice(raw.menuItemId), raw),
      costSnap: drinkCost + pastryCost,
      quantity: raw.quantity,
      milkChoiceId: raw.milkChoiceId,
      creamChoiceId: raw.creamChoiceId,
      milkNameSnap,
      creamNameSnap,
      sugarAdjustment: raw.sugarAdjustment,
      iceAdjustment: raw.iceAdjustment,
      specialRequests: raw.specialRequests,
      discountPct: raw.discountPct,
      status: raw.status ?? "pending",
      isCombo: true,
      comboPastryId: raw.comboPastryId,
      comboPastryNameSnap: pastry?.name ?? "Unknown pastry",
      comboPastryCostSnap: pastryCost,
    };
  }

  return {
    id: newId("oi"),
    orderId,
    menuItemId: raw.menuItemId,
    menuItemNameSnap: mi?.name ?? "Unknown item",
    priceSnap: mi?.price ?? 0,
    ...priceFields(mi?.price ?? 0, raw),
    costSnap: drinkCost,
    quantity: raw.quantity,
    milkChoiceId: raw.milkChoiceId,
    creamChoiceId: raw.creamChoiceId,
    milkNameSnap,
    creamNameSnap,
    sugarAdjustment: raw.sugarAdjustment,
    iceAdjustment: raw.iceAdjustment,
    specialRequests: raw.specialRequests,
    discountPct: raw.discountPct,
    status: raw.status ?? "pending",
  };
}

export function nextOrderNumber(state: AppState, eventId: string): number {
  const ns = state.orders
    .filter((o) => o.eventId === eventId)
    .map((o) => o.orderNumber);
  return ns.length === 0 ? 1 : Math.max(...ns) + 1;
}

function deriveOrderStatusFromItems(
  items: OrderItem[],
  current: OrderStatus,
): OrderStatus | null {
  if (items.length === 0) return null;
  if (items.every((it) => it.status === "done")) return "completed";
  // Preserve an "in_progress" claim across item-by-item checkoffs. Otherwise
  // the moment a barista ticks off the first drink, the IN PROGRESS banner
  // would vanish and a second barista could grab the same order — the exact
  // duplicate-drink scenario helper mode is trying to prevent.
  if (current === "in_progress") return "in_progress";
  return "pending";
}

/**
 * Merge a server read of orders into local state. The server is authoritative
 * for every order inside `scopeEventId` (all events when undefined): orders it
 * doesn't return are dropped locally (deleted elsewhere) — except `keepIds`,
 * orders submitted here whose write hasn't landed yet. Orders outside the
 * scope are untouched.
 */
export function mergeServerOrders(
  local: Order[],
  server: Order[],
  scopeEventId: string | undefined,
  keepIds: ReadonlySet<string>,
): Order[] {
  const inScope = (o: Order) => scopeEventId === undefined || o.eventId === scopeEventId;
  const serverIds = new Set(server.map((o) => o.id));
  const keptLocal = local.filter(
    (o) => !inScope(o) || (keepIds.has(o.id) && !serverIds.has(o.id)),
  );
  const localById = new Map(local.map((o) => [o.id, o]));
  // Don't let a server row with no items blank out an order we already hold
  // items for (e.g. a read that raced the item write).
  const merged = server.map((o) => {
    const prev = localById.get(o.id);
    return o.items.length === 0 && prev && prev.items.length > 0 ? { ...o, items: prev.items } : o;
  });
  return [...keptLocal, ...merged];
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "REPLACE":
      return action.state;

    case "UPDATE_SETTINGS":
      return { ...state, settings: { ...state.settings, ...action.patch } };

    case "ADD_INGREDIENT": {
      const maxIngOrder = state.ingredients.reduce(
        (m, x) => Math.max(m, x.sortOrder ?? -1),
        -1,
      );
      const ing: Ingredient = {
        ...normalizeNewIngredient(state.ingredients, action.ing),
        id: newId("ing"),
        sortOrder: action.ing.sortOrder ?? maxIngOrder + 1,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      return { ...state, ingredients: [...state.ingredients, ing] };
    }

    case "UPDATE_INGREDIENT": {
      // One level of nesting only: the patch is brought within the prepared-ingredient rules.
      const patch = normalizeIngredientPatch(state.ingredients, action.id, action.patch);
      return {
        ...state,
        ingredients: state.ingredients.map((i) =>
          i.id === action.id ? { ...i, ...patch, updatedAt: nowIso() } : i,
        ),
      };
    }

    case "DELETE_INGREDIENT":
      return {
        ...state,
        ingredients: state.ingredients.filter((i) => i.id !== action.id),
      };

    case "ADD_MENU_ITEM": {
      const maxOrder = state.menuItems.reduce(
        (m, x) => Math.max(m, x.sortOrder ?? -1),
        -1,
      );
      const item: MenuItem = {
        ...action.item,
        id: newId("mi"),
        sortOrder: action.item.sortOrder ?? maxOrder + 1,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      return { ...state, menuItems: [...state.menuItems, item] };
    }

    case "UPDATE_MENU_ITEM":
      return {
        ...state,
        menuItems: state.menuItems.map((m) =>
          m.id === action.id ? { ...m, ...action.patch, updatedAt: nowIso() } : m,
        ),
      };

    case "DELETE_MENU_ITEM": {
      // Block delete if used in any order
      const used = state.orders.some((o) =>
        o.items.some((it) => it.menuItemId === action.id),
      );
      if (used) return state;
      return {
        ...state,
        menuItems: state.menuItems.filter((m) => m.id !== action.id),
      };
    }

    case "CREATE_EVENT": {
      // Safety net behind the forms: never store an event that ends before it starts.
      if (validateEventTimes(action.event.startTime, action.event.endTime)) return state;
      // Snapshot the *current master menu* (deep copy) so further edits don't
      // mutate this event's frozen view.
      const snapshot: MenuSnapshot = {
        id: newId("snap"),
        menuItems: state.menuItems
          .filter((m) => m.active)
          .map((m) => ({
            ...m,
            ingredientLines: m.ingredientLines.map((l) => ({ ...l })),
            allowedMilkIds: [...m.allowedMilkIds],
            allowedCreamIds: [...m.allowedCreamIds],
          })),
        ingredients: state.ingredients.map((i) => ({ ...i })),
        createdAt: nowIso(),
      };
      const event: Event = {
        ...action.event,
        id: newId("evt"),
        menuSnapshotId: snapshot.id,
        fixedCosts: action.event.initialFixedCosts ?? [],
        isActive: true, // newest event becomes Active (create morning-of)
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      return {
        ...state,
        menuSnapshots: [...state.menuSnapshots, snapshot],
        // Deactivate any previously active events so only the new one is Active.
        events: [...state.events.map((e) => ({ ...e, isActive: false })), event],
      };
    }

    case "UPDATE_EVENT": {
      const cur = state.events.find((e) => e.id === action.id);
      const start = action.patch.startTime ?? cur?.startTime;
      const end = action.patch.endTime ?? cur?.endTime;
      if ((action.patch.startTime || action.patch.endTime) && validateEventTimes(start, end)) return state;
      return {
        ...state,
        events: state.events.map((e) =>
          e.id === action.id ? { ...e, ...action.patch, updatedAt: nowIso() } : e,
        ),
      };
    }

    case "DELETE_EVENT": {
      const evt = findEvent(state, action.id);
      if (!evt) return state;
      // Also remove the snapshot if it's not shared and all related orders
      return {
        ...state,
        events: state.events.filter((e) => e.id !== action.id),
        menuSnapshots: state.menuSnapshots.filter((s) => s.id !== evt.menuSnapshotId),
        orders: state.orders.filter((o) => o.eventId !== action.id),
        eventExtras: state.eventExtras.filter((x) => x.eventId !== action.id),
      };
    }

    case "SET_ACTIVE_EVENT":
      return {
        ...state,
        events: state.events.map((e) => ({
          ...e,
          isActive: e.id === action.id,
          updatedAt: e.id === action.id ? nowIso() : e.updatedAt,
        })),
      };

    case "UPDATE_EVENT_SNAPSHOT":
      return {
        ...state,
        menuSnapshots: state.menuSnapshots.map((s) => {
          const evt = state.events.find((e) => e.id === action.eventId);
          if (!evt || s.id !== evt.menuSnapshotId) return s;
          return { ...s, ...action.patch };
        }),
      };

    case "SUBMIT_ORDER": {
      // Dedupe in case the realtime echo and the optimistic dispatch race.
      if (state.orders.some((o) => o.id === action.order.id)) return state;
      return { ...state, orders: [...state.orders, action.order] };
    }

    case "UPDATE_ORDER":
      return {
        ...state,
        orders: state.orders.map((o) => {
          if (o.id !== action.id) return o;
          const next: Order = { ...o, ...action.patch, updatedAt: nowIso() };
          // Stamp doneAt the first time an order transitions to completed.
          if (next.status === "completed" && !next.doneAt) {
            next.doneAt = nowIso();
          }
          // Clear doneAt if reopened from completed.
          if (next.status !== "completed" && next.doneAt) {
            next.doneAt = undefined;
          }
          return next;
        }),
      };

    case "REPLACE_ORDER_ITEMS": {
      const order = state.orders.find((o) => o.id === action.orderId);
      if (!order) return state;
      const evt = findEvent(state, order.eventId);
      if (!evt) return state;
      const eventSnap = findSnapshot(state, evt.menuSnapshotId);
      if (!eventSnap) return state;
      // Live Orders sells from the master menu while the event is active, so a new or changed line is
      // priced from it too (see menuForOrderEdit); an item added after the event was created is also
      // missing from the event snapshot, and would otherwise become "$0 Unknown item".
      const snap: MenuSnapshot = menuForOrderEdit(eventSnap, state, evt.isActive);
      const items: OrderItem[] = action.items.map((raw) => {
        const { sourceItemId, ...rawItem } = raw;
        const derived = deriveOrderItem(rawItem, order.id, snap, evt.cupSizeOz);
        const prev = sourceItemId ? order.items.find((i) => i.id === sourceItemId) : undefined;
        // Keep what was stamped at sale time when the line is the same product
        // with the same cost-affecting choices. Quantity, discount, notes and
        // status changes must not re-price the line.
        const same =
          prev &&
          prev.menuItemId === derived.menuItemId &&
          Boolean(prev.isCombo) === Boolean(derived.isCombo) &&
          prev.comboPastryId === derived.comboPastryId &&
          prev.milkChoiceId === derived.milkChoiceId &&
          prev.creamChoiceId === derived.creamChoiceId;
        if (!same) return derived;
        return {
          ...derived,
          menuItemNameSnap: prev.menuItemNameSnap,
          priceSnap: prev.priceSnap,
          costSnap: prev.costSnap,
          ...priceFields(prev.listPrice ?? prev.priceSnap, rawItem),
          ...(prev.isCombo
            ? {
                comboPastryNameSnap: prev.comboPastryNameSnap,
                comboPastryCostSnap: prev.comboPastryCostSnap,
              }
            : {}),
        };
      });
      return {
        ...state,
        orders: state.orders.map((o) =>
          o.id === order.id ? { ...o, items, updatedAt: nowIso() } : o,
        ),
      };
    }

    case "SET_ORDER_ITEM_STATUS":
      return {
        ...state,
        orders: state.orders.map((o) => {
          if (o.id !== action.orderId) return o;
          const items = o.items.map((it) =>
            it.id === action.orderItemId ? { ...it, status: action.status } : it,
          );
          const derived = deriveOrderStatusFromItems(items, o.status);
          const status: OrderStatus =
            o.status === "cancelled"
              ? "cancelled"
              : derived ?? o.status;
          let doneAt = o.doneAt;
          if (status === "completed" && !doneAt) doneAt = nowIso();
          else if (status !== "completed" && doneAt) doneAt = undefined;
          return { ...o, items, status, doneAt, updatedAt: nowIso() };
        }),
      };

    case "UPDATE_ORDER_ITEM":
      return {
        ...state,
        orders: state.orders.map((o) => {
          if (o.id !== action.orderId) return o;
          const items = o.items.map((it) =>
            it.id === action.orderItemId
              ? { ...it, ...normalizeItemPatch(it, action.patch) }
              : it,
          );
          return { ...o, items, updatedAt: nowIso() };
        }),
      };

    case "DELETE_ORDER":
      // Remaining orders keep their numbers: a customer holding ticket #4 must
      // still be #4 after #3 is removed. (Deleting the highest-numbered order
      // frees that number for the next order, which is how the database's
      // max(order_number) + 1 works too.)
      return { ...state, orders: state.orders.filter((o) => o.id !== action.id) };

    case "ADD_INVENTORY_PURCHASE": {
      const purchase: InventoryPurchase = {
        ...action.purchase,
        id: newId("inv"),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      return { ...state, inventoryPurchases: [...state.inventoryPurchases, purchase] };
    }

    case "UPDATE_INVENTORY_PURCHASE":
      return {
        ...state,
        inventoryPurchases: state.inventoryPurchases.map((p) =>
          p.id === action.id ? { ...p, ...action.patch, updatedAt: nowIso() } : p,
        ),
      };

    case "DELETE_INVENTORY_PURCHASE":
      return {
        ...state,
        inventoryPurchases: state.inventoryPurchases.filter((p) => p.id !== action.id),
      };

    case "RT_UPSERT_INVENTORY_PURCHASE": {
      const exists = state.inventoryPurchases.some((p) => p.id === action.purchase.id);
      return {
        ...state,
        inventoryPurchases: exists
          ? state.inventoryPurchases.map((p) =>
              p.id === action.purchase.id ? action.purchase : p,
            )
          : [...state.inventoryPurchases, action.purchase],
      };
    }

    case "RT_DELETE_INVENTORY_PURCHASE":
      if (!state.inventoryPurchases.some((p) => p.id === action.id)) return state;
      return {
        ...state,
        inventoryPurchases: state.inventoryPurchases.filter((p) => p.id !== action.id),
      };

    case "ADD_EVENT_EXTRA": {
      const extra: EventExtra = {
        ...action.extra,
        id: newId("xtra"),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      return { ...state, eventExtras: [...state.eventExtras, extra] };
    }

    case "UPDATE_EVENT_EXTRA":
      return {
        ...state,
        eventExtras: state.eventExtras.map((x) =>
          x.id === action.id ? { ...x, ...action.patch, updatedAt: nowIso() } : x,
        ),
      };

    case "DELETE_EVENT_EXTRA":
      return { ...state, eventExtras: state.eventExtras.filter((x) => x.id !== action.id) };

    case "RT_UPSERT_EVENT_EXTRA": {
      const exists = state.eventExtras.some((x) => x.id === action.extra.id);
      return {
        ...state,
        eventExtras: exists
          ? state.eventExtras.map((x) => (x.id === action.extra.id ? action.extra : x))
          : [...state.eventExtras, action.extra],
      };
    }

    case "RT_DELETE_EVENT_EXTRA":
      if (!state.eventExtras.some((x) => x.id === action.id)) return state;
      return { ...state, eventExtras: state.eventExtras.filter((x) => x.id !== action.id) };

    case "APPEND_ORDER_REVISION": {
      // Dedupe by id — the reducer is the local optimistic write; a later
      // realtime echo (if we ever add one) would use the same id.
      if (state.orderRevisions.some((r) => r.id === action.revision.id)) return state;
      return {
        ...state,
        orderRevisions: [...state.orderRevisions, action.revision],
      };
    }

    case "RESET_TO_SEED":
      return action.seed;

    // ---------- Realtime echoes ----------

    case "RT_UPSERT_INGREDIENT": {
      const exists = state.ingredients.some((i) => i.id === action.ing.id);
      return {
        ...state,
        ingredients: exists
          ? state.ingredients.map((i) => (i.id === action.ing.id ? action.ing : i))
          : [...state.ingredients, action.ing],
      };
    }
    case "RT_DELETE_INGREDIENT":
      if (!state.ingredients.some((i) => i.id === action.id)) return state;
      return { ...state, ingredients: state.ingredients.filter((i) => i.id !== action.id) };

    case "RT_UPSERT_MENU_ITEM": {
      const exists = state.menuItems.some((m) => m.id === action.item.id);
      return {
        ...state,
        menuItems: exists
          ? state.menuItems.map((m) => (m.id === action.item.id ? action.item : m))
          : [...state.menuItems, action.item],
      };
    }
    case "RT_DELETE_MENU_ITEM":
      if (!state.menuItems.some((m) => m.id === action.id)) return state;
      return { ...state, menuItems: state.menuItems.filter((m) => m.id !== action.id) };

    case "RT_UPSERT_EVENT": {
      const evt = action.event;
      const existsEvent = state.events.some((e) => e.id === evt.id);
      const snapshotsBase = action.snapshot
        ? state.menuSnapshots.some((s) => s.id === action.snapshot!.id)
          ? state.menuSnapshots.map((s) =>
              s.id === action.snapshot!.id ? action.snapshot! : s,
            )
          : [...state.menuSnapshots, action.snapshot]
        : state.menuSnapshots;
      // Enforce single-active locally too (the DB trigger already does this).
      const events = existsEvent
        ? state.events.map((e) =>
            e.id === evt.id
              ? evt
              : evt.isActive
              ? { ...e, isActive: false }
              : e,
          )
        : [...state.events.map((e) => (evt.isActive ? { ...e, isActive: false } : e)), evt];
      return { ...state, events, menuSnapshots: snapshotsBase };
    }
    case "RT_DELETE_EVENT": {
      const evt = state.events.find((e) => e.id === action.id);
      const hasOrphanOrders = state.orders.some((o) => o.eventId === action.id);
      if (!evt && !hasOrphanOrders) return state;
      return {
        ...state,
        events: evt ? state.events.filter((e) => e.id !== action.id) : state.events,
        menuSnapshots: evt
          ? state.menuSnapshots.filter((s) => s.id !== evt.menuSnapshotId)
          : state.menuSnapshots,
        orders: state.orders.filter((o) => o.eventId !== action.id),
        eventExtras: state.eventExtras.filter((x) => x.eventId !== action.id),
      };
    }

    case "RT_UPSERT_ORDER": {
      const incoming = action.order;
      const existing = state.orders.find((o) => o.id === incoming.id);
      if (existing) {
        // Preserve the items array; only the order-level fields changed.
        return {
          ...state,
          orders: state.orders.map((o) =>
            o.id === incoming.id ? { ...o, ...incoming, items: o.items } : o,
          ),
        };
      }
      return { ...state, orders: [...state.orders, { ...incoming, items: [] }] };
    }
    case "RT_SET_ORDER": {
      const exists = state.orders.some((o) => o.id === action.order.id);
      return {
        ...state,
        orders: exists
          ? state.orders.map((o) => (o.id === action.order.id ? action.order : o))
          : [...state.orders, action.order],
      };
    }
    case "RT_SYNC_ORDERS":
      return {
        ...state,
        orders: mergeServerOrders(
          state.orders,
          action.orders,
          action.scopeEventId,
          new Set(action.keepIds),
        ),
      };
    case "RT_SYNC_FULL":
      return {
        ...action.state,
        orders: mergeServerOrders(
          state.orders,
          action.state.orders,
          undefined,
          new Set(action.keepIds),
        ),
        eventExtras: action.extrasUnavailable ? state.eventExtras : action.state.eventExtras,
        // Audit trail is append-only and not refetched when the table is
        // missing; never let a refetch shrink it.
        orderRevisions:
          action.state.orderRevisions.length >= state.orderRevisions.length
            ? action.state.orderRevisions
            : state.orderRevisions,
      };

    case "RT_DELETE_ORDER":
      if (!state.orders.some((o) => o.id === action.id)) return state;
      return { ...state, orders: state.orders.filter((o) => o.id !== action.id) };

    case "RT_UPSERT_ORDER_ITEM": {
      const oi = action.item;
      return {
        ...state,
        orders: state.orders.map((o) => {
          if (o.id !== oi.orderId) return o;
          const has = o.items.some((it) => it.id === oi.id);
          const items = has
            ? o.items.map((it) => (it.id === oi.id ? oi : it))
            : [...o.items, oi];
          return { ...o, items };
        }),
      };
    }
    case "RT_DELETE_ORDER_ITEM": {
      // Bail out entirely if no order in state still contains this item id —
      // very common after a cascade delete where the parent order was already
      // optimistically removed locally.
      const present = state.orders.some(
        (o) => (!action.orderId || o.id === action.orderId) && o.items.some((it) => it.id === action.id),
      );
      if (!present) return state;
      return {
        ...state,
        orders: state.orders.map((o) => {
          if (action.orderId && o.id !== action.orderId) return o;
          if (!o.items.some((it) => it.id === action.id)) return o;
          return { ...o, items: o.items.filter((it) => it.id !== action.id) };
        }),
      };
    }

    case "RT_UPDATE_SETTINGS":
      return { ...state, settings: { ...state.settings, ...action.patch } };

    default:
      return state;
  }
}
