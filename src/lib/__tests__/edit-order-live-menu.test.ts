import { describe, expect, it } from "vitest";
import { reducer } from "@/lib/reducer";
import { initialSeed } from "@/lib/seed";
import { menuForOrderEdit } from "@/lib/edit-menu";
import { customItemId } from "@/lib/custom-id";
import { customItemCost } from "@/lib/custom-item";
import type { AppState, Order, OrderItem } from "@/lib/types";

/**
 * Edit Order must price and cost a NEW or CHANGED line the way Live Orders does for the active
 * event: from the current menu, not from the menu frozen when the event was created. Lines that are
 * unchanged keep what they were sold at. Events that are not active keep their frozen snapshot.
 */
function setup() {
  let s: AppState = initialSeed();
  s = reducer(s, {
    type: "CREATE_EVENT",
    event: { name: "E", date: "2026-10-16", startTime: "11:00", endTime: "16:00", eventType: "standard", cupSizeOz: 16 },
  });
  const ev = s.events.find((e) => e.name === "E")!;
  return { s, ev };
}

const item = (s: AppState, name: string) => s.menuItems.find((m) => m.name === name)!;

function withOrder(s: AppState, eventId: string, items: OrderItem[]): AppState {
  const o: Order = {
    id: "ord_edit_test", eventId, orderNumber: 1, customerName: "T", items,
    submittedAt: "2026-10-16T12:00:00.000Z", updatedAt: "2026-10-16T12:00:00.000Z",
    paymentStatus: "paid", paymentMethod: "cash", status: "pending",
  };
  return reducer(s, { type: "SUBMIT_ORDER", order: o });
}

const raw = (menuItemId: string, over: Partial<OrderItem> & { sourceItemId?: string } = {}) => ({
  menuItemId, quantity: 1, status: "pending" as const, ...over,
});

describe("Edit Order uses the live menu on the active event", () => {
  it("a line added in Edit Order is priced and costed at today's price, not the event-creation price", () => {
    const { s, ev } = setup();
    const matcha = item(s, "Classic Matcha");
    // price and tea cost go up AFTER the event was created
    let t = reducer(s, { type: "UPDATE_MENU_ITEM", id: matcha.id, patch: { price: matcha.price + 2 } });
    const tea = t.ingredients.find((i) => /matcha powder/i.test(i.name))!;
    t = reducer(t, { type: "UPDATE_INGREDIENT", id: tea.id, patch: { packagePrice: tea.packagePrice * 3 } });
    t = withOrder(t, ev.id, []);
    const oldSnapCost = s.menuSnapshots.find((m) => m.id === ev.menuSnapshotId)!;
    expect(oldSnapCost.menuItems.find((m) => m.id === matcha.id)!.price).toBe(matcha.price); // snapshot is stale by design

    const out = reducer(t, { type: "REPLACE_ORDER_ITEMS", orderId: "ord_edit_test", items: [raw(matcha.id)] });
    const line = out.orders.find((o) => o.id === "ord_edit_test")!.items[0];
    expect(line.priceSnap).toBe(matcha.price + 2);
    // cost reflects the tripled tea price
    const stale = reducer(withOrder(s, ev.id, []), { type: "REPLACE_ORDER_ITEMS", orderId: "ord_edit_test", items: [raw(matcha.id)] });
    expect(line.costSnap).toBeGreaterThan(stale.orders.find((o) => o.id === "ord_edit_test")!.items[0].costSnap);
  });

  it("an unchanged line keeps its sale-time price and cost even though the menu moved on", () => {
    const { s, ev } = setup();
    const matcha = item(s, "Classic Matcha");
    const sold = reducer(withOrder(s, ev.id, []), { type: "REPLACE_ORDER_ITEMS", orderId: "ord_edit_test", items: [raw(matcha.id)] }).orders.find((o) => o.id === "ord_edit_test")!.items[0];
    let t = withOrder(s, ev.id, [sold]);
    t = reducer(t, { type: "UPDATE_MENU_ITEM", id: matcha.id, patch: { price: matcha.price + 5 } });
    const out = reducer(t, {
      type: "REPLACE_ORDER_ITEMS",
      orderId: "ord_edit_test",
      items: [raw(matcha.id, { quantity: 3, sourceItemId: sold.id, specialRequests: "note" })],
    });
    const line = out.orders.find((o) => o.id === "ord_edit_test")!.items[0];
    expect(line.priceSnap).toBe(sold.priceSnap);
    expect(line.costSnap).toBe(sold.costSnap);
    expect(line.quantity).toBe(3);
  });

  it("changing a custom drink's components re-stamps it at today's cost; the same components keep the old stamp", () => {
    const { s, ev } = setup();
    const hojicha = s.ingredients.find((i) => /hojicha/i.test(i.name))!;
    const matchaPowder = s.ingredients.find((i) => /^matcha powder/i.test(i.name))!;
    const id = customItemId({ baseIds: [hojicha.id], toppingIds: [] });
    const snap0 = s.menuSnapshots.find((m) => m.id === ev.menuSnapshotId)!;
    const soldCost = customItemCost({ baseIds: [hojicha.id], toppingIds: [] }, snap0, 16);
    const sold: OrderItem = {
      id: "oi_1", orderId: "ord_edit_test", menuItemId: id, menuItemNameSnap: "Custom: Hojicha powder", priceSnap: 6.7,
      listPrice: 6.7, priceCharged: 6.7, costSnap: soldCost, quantity: 1, status: "pending",
    };
    let t = withOrder(s, ev.id, [sold]);
    t = reducer(t, { type: "UPDATE_INGREDIENT", id: hojicha.id, patch: { packagePrice: hojicha.packagePrice * 3 } });

    const same = reducer(t, { type: "REPLACE_ORDER_ITEMS", orderId: "ord_edit_test", items: [raw(id, { sourceItemId: "oi_1", specialRequests: "cold" })] });
    expect(same.orders.find((o) => o.id === "ord_edit_test")!.items[0].costSnap).toBe(soldCost);

    // same tea, a topping added: a different product, costed with the tripled tea price
    const topping = t.ingredients.find((i) => i.pool === "cream")!;
    const id2 = customItemId({ baseIds: [hojicha.id], toppingIds: [topping.id] });
    const changed = reducer(t, { type: "REPLACE_ORDER_ITEMS", orderId: "ord_edit_test", items: [raw(id2, { sourceItemId: "oi_1" })] });
    const live = { ...snap0, ingredients: t.ingredients, menuItems: t.menuItems };
    expect(changed.orders.find((o) => o.id === "ord_edit_test")!.items[0].costSnap).toBeCloseTo(customItemCost({ baseIds: [hojicha.id], toppingIds: [topping.id] }, live, 16), 6);
    expect(changed.orders.find((o) => o.id === "ord_edit_test")!.items[0].costSnap).toBeGreaterThan(soldCost);
    void matchaPowder;
  });
});

describe("menuForOrderEdit", () => {
  it("active event: live menu wins, snapshot fills in what the live menu no longer has", () => {
    const { s, ev } = setup();
    const snap = s.menuSnapshots.find((m) => m.id === ev.menuSnapshotId)!;
    const live = { menuItems: s.menuItems.slice(1).map((m) => ({ ...m, price: 99 })), ingredients: s.ingredients };
    const merged = menuForOrderEdit(snap, live, true);
    expect(merged.menuItems.find((m) => m.id === live.menuItems[0].id)!.price).toBe(99);
    expect(merged.menuItems.some((m) => m.id === s.menuItems[0].id)).toBe(true); // kept from the snapshot
  });
  it("not active: the frozen snapshot wins, the live menu only adds items it lacks", () => {
    const { s, ev } = setup();
    const snap = s.menuSnapshots.find((m) => m.id === ev.menuSnapshotId)!;
    const live = { menuItems: s.menuItems.map((m) => ({ ...m, price: 99 })), ingredients: s.ingredients };
    const merged = menuForOrderEdit(snap, live, false);
    expect(merged.menuItems.find((m) => m.id === snap.menuItems[0].id)!.price).toBe(snap.menuItems[0].price);
  });
});
