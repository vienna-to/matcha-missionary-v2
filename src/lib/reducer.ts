import { computeItemCost } from "./calc";
import { newId, nowIso } from "./id";
import {
  COMBO_PRICE,
  type AppState,
  type Event,
  type FixedCost,
  type Ingredient,
  type InventoryPurchase,
  type MenuItem,
  type MenuSnapshot,
  type Order,
  type OrderItem,
  type OrderItemStatus,
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
  | {
      type: "SUBMIT_ORDER";
      order: Omit<Order, "id" | "orderNumber" | "items" | "submittedAt" | "updatedAt"> & {
        items: (Omit<OrderItem, "id" | "orderId" | "priceSnap" | "costSnap" | "menuItemNameSnap" | "status"> & {
          status?: OrderItemStatus;
        })[];
      };
    }
  | { type: "UPDATE_ORDER"; id: string; patch: Partial<Order> }
  | {
      type: "REPLACE_ORDER_ITEMS";
      orderId: string;
      items: (Omit<OrderItem, "id" | "orderId" | "priceSnap" | "costSnap" | "menuItemNameSnap" | "status"> & {
        status?: OrderItemStatus;
      })[];
    }
  | {
      type: "SET_ORDER_ITEM_STATUS";
      orderId: string;
      orderItemId: string;
      status: OrderItemStatus;
    }
  | { type: "DELETE_ORDER"; id: string }
  | {
      type: "ADD_INVENTORY_PURCHASE";
      purchase: Omit<InventoryPurchase, "id" | "createdAt" | "updatedAt">;
    }
  | { type: "UPDATE_INVENTORY_PURCHASE"; id: string; patch: Partial<InventoryPurchase> }
  | { type: "DELETE_INVENTORY_PURCHASE"; id: string }
  | { type: "RT_UPSERT_INVENTORY_PURCHASE"; purchase: InventoryPurchase }
  | { type: "RT_DELETE_INVENTORY_PURCHASE"; id: string }
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
  | { type: "RT_UPSERT_ORDER_ITEM"; item: OrderItem }
  | { type: "RT_DELETE_ORDER_ITEM"; id: string; orderId?: string }
  | { type: "RT_UPDATE_SETTINGS"; patch: Partial<Settings> };

function findSnapshot(state: AppState, id: string): MenuSnapshot | undefined {
  return state.menuSnapshots.find((s) => s.id === id);
}

function findEvent(state: AppState, id: string): Event | undefined {
  return state.events.find((e) => e.id === id);
}

function deriveOrderItem(
  raw: Omit<OrderItem, "id" | "orderId" | "priceSnap" | "costSnap" | "menuItemNameSnap" | "status"> & {
    status?: OrderItemStatus;
  },
  orderId: string,
  snapshot: MenuSnapshot,
): OrderItem {
  const mi = snapshot.menuItems.find((m) => m.id === raw.menuItemId);
  const drinkCost = mi
    ? computeItemCost(mi, snapshot.ingredients, {
        milkChoiceId: raw.milkChoiceId,
        creamChoiceId: raw.creamChoiceId,
      })
    : 0;

  // Combo deal: bundle drink + pastry at the fixed bundle price. costSnap is
  // the *total* cost (drink + pastry) so margin math stays accurate.
  if (raw.isCombo && raw.comboPastryId) {
    const pastry = snapshot.menuItems.find((m) => m.id === raw.comboPastryId);
    const pastryCost = pastry ? computeItemCost(pastry, snapshot.ingredients, {}) : 0;
    return {
      id: newId("oi"),
      orderId,
      menuItemId: raw.menuItemId,
      menuItemNameSnap: mi?.name ?? "Unknown drink",
      priceSnap: COMBO_PRICE,
      costSnap: drinkCost + pastryCost,
      quantity: raw.quantity,
      milkChoiceId: raw.milkChoiceId,
      creamChoiceId: raw.creamChoiceId,
      sugarAdjustment: raw.sugarAdjustment,
      iceAdjustment: raw.iceAdjustment,
      specialRequests: raw.specialRequests,
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
    costSnap: drinkCost,
    quantity: raw.quantity,
    milkChoiceId: raw.milkChoiceId,
    creamChoiceId: raw.creamChoiceId,
    sugarAdjustment: raw.sugarAdjustment,
    iceAdjustment: raw.iceAdjustment,
    specialRequests: raw.specialRequests,
    status: raw.status ?? "pending",
  };
}

function nextOrderNumber(state: AppState, eventId: string): number {
  const ns = state.orders
    .filter((o) => o.eventId === eventId)
    .map((o) => o.orderNumber);
  return ns.length === 0 ? 1 : Math.max(...ns) + 1;
}

function deriveOrderStatusFromItems(items: OrderItem[]): OrderStatus | null {
  if (items.length === 0) return null;
  if (items.every((it) => it.status === "done")) return "completed";
  if (items.some((it) => it.status !== "pending")) return "in_progress";
  return "pending";
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "REPLACE":
      return action.state;

    case "UPDATE_SETTINGS":
      return { ...state, settings: { ...state.settings, ...action.patch } };

    case "ADD_INGREDIENT": {
      const ing: Ingredient = {
        ...action.ing,
        id: newId("ing"),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      return { ...state, ingredients: [...state.ingredients, ing] };
    }

    case "UPDATE_INGREDIENT":
      return {
        ...state,
        ingredients: state.ingredients.map((i) =>
          i.id === action.id ? { ...i, ...action.patch, updatedAt: nowIso() } : i,
        ),
      };

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

    case "UPDATE_EVENT":
      return {
        ...state,
        events: state.events.map((e) =>
          e.id === action.id ? { ...e, ...action.patch, updatedAt: nowIso() } : e,
        ),
      };

    case "DELETE_EVENT": {
      const evt = findEvent(state, action.id);
      if (!evt) return state;
      // Also remove the snapshot if it's not shared and all related orders
      return {
        ...state,
        events: state.events.filter((e) => e.id !== action.id),
        menuSnapshots: state.menuSnapshots.filter((s) => s.id !== evt.menuSnapshotId),
        orders: state.orders.filter((o) => o.eventId !== action.id),
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
      const evt = findEvent(state, action.order.eventId);
      if (!evt) return state;
      const snap = findSnapshot(state, evt.menuSnapshotId);
      if (!snap) return state;
      const orderId = newId("ord");
      const items: OrderItem[] = action.order.items.map((raw) =>
        deriveOrderItem(raw, orderId, snap),
      );
      const order: Order = {
        ...action.order,
        id: orderId,
        orderNumber: nextOrderNumber(state, evt.id),
        items,
        submittedAt: nowIso(),
        updatedAt: nowIso(),
      };
      return { ...state, orders: [...state.orders, order] };
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
      const snap = findSnapshot(state, evt.menuSnapshotId);
      if (!snap) return state;
      const items: OrderItem[] = action.items.map((raw) =>
        deriveOrderItem(raw, order.id, snap),
      );
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
          const derived = deriveOrderStatusFromItems(items);
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

    case "DELETE_ORDER":
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
