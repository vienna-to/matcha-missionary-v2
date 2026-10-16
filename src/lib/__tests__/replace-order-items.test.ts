import { describe, expect, it } from "vitest";
import { deriveOrderItem, reducer } from "@/lib/reducer";
import { initialSeed } from "@/lib/seed";
import type { AppState, Order } from "@/lib/types";

/**
 * Regression for BUG-QA-1 / BUG-QA-1b: saving an order in Edit Order re-derived
 * every line from the event's frozen snapshot, overwriting the price and cost
 * stamped at sale time and turning items added after the event was created into
 * "$0 Unknown item".
 */
function setup() {
  let s: AppState = initialSeed();
  s = reducer(s, {
    type: "CREATE_EVENT",
    event: { name: "E", date: "2026-10-16", startTime: "11:00", endTime: "16:00", eventType: "standard", cupSizeOz: 16 },
  });
  const ev = s.events.find((e) => e.name === "E")!;
  const snap = s.menuSnapshots.find((m) => m.id === ev.menuSnapshotId)!;
  return { s, ev, snap };
}

function orderWith(state: AppState, eventId: string, items: Order["items"]): AppState {
  const o: Order = {
    id: "ord_qa",
    eventId,
    orderNumber: 1,
    customerName: "T",
    items,
    submittedAt: "2026-10-16T12:00:00.000Z",
    updatedAt: "2026-10-16T12:00:00.000Z",
    paymentStatus: "paid",
    paymentMethod: "cash",
    status: "pending",
  };
  return reducer(state, { type: "SUBMIT_ORDER", order: o });
}

describe("REPLACE_ORDER_ITEMS keeps sale-time price and cost", () => {
  it("does not re-price a line sold after a menu price change when only its quantity changes", () => {
    const { s, ev } = setup();
    // price goes up AFTER the event snapshot was taken, then an order is rung up at the new price
    let st = reducer(s, { type: "UPDATE_MENU_ITEM", id: "mi_classic", patch: { price: 8 } });
    const live = { id: "live", menuItems: st.menuItems, ingredients: st.ingredients, createdAt: "" };
    const line = deriveOrderItem({ menuItemId: "mi_classic", quantity: 1 }, "ord_qa", live, 16);
    expect(line.priceSnap).toBe(8);
    st = orderWith(st, ev.id, [line]);

    st = reducer(st, {
      type: "REPLACE_ORDER_ITEMS",
      orderId: "ord_qa",
      items: [{ sourceItemId: line.id, menuItemId: "mi_classic", quantity: 3 }],
    });
    const after = st.orders.find((o) => o.id === "ord_qa")!.items[0];
    expect(after.quantity).toBe(3);
    expect(after.priceSnap).toBe(8);
    expect(after.listPrice).toBe(8);
    expect(after.priceCharged).toBe(8);
    expect(after.costSnap).toBeCloseTo(line.costSnap, 10);
  });

  it("keeps an item that was added to the menu after the event was created", () => {
    const { s, ev } = setup();
    let st = reducer(s, {
      type: "ADD_MENU_ITEM",
      item: {
        name: "Pop Special", category: "other", price: 5, size: "16oz", active: true,
        ingredientLines: [], allowedMilkIds: [], allowedCreamIds: [],
      },
    });
    const added = st.menuItems.find((m) => m.name === "Pop Special")!;
    const live = { id: "live", menuItems: st.menuItems, ingredients: st.ingredients, createdAt: "" };
    const line = deriveOrderItem({ menuItemId: added.id, quantity: 1 }, "ord_qa", live, 16);
    st = orderWith(st, ev.id, [line]);

    st = reducer(st, {
      type: "REPLACE_ORDER_ITEMS",
      orderId: "ord_qa",
      items: [{ sourceItemId: line.id, menuItemId: added.id, quantity: 2 }],
    });
    const after = st.orders.find((o) => o.id === "ord_qa")!.items[0];
    expect(after.menuItemNameSnap).toBe("Pop Special");
    expect(after.priceSnap).toBe(5);
    expect(after.quantity).toBe(2);
  });

  it("a brand-new line (no sourceItemId) is priced from the menu; a changed milk re-costs that line", () => {
    const { s, ev, snap } = setup();
    const line = deriveOrderItem({ menuItemId: "mi_classic", quantity: 1 }, "ord_qa", snap, 16);
    let st = orderWith(s, ev.id, [line]);
    st = reducer(st, {
      type: "REPLACE_ORDER_ITEMS",
      orderId: "ord_qa",
      items: [
        { sourceItemId: line.id, menuItemId: "mi_classic", quantity: 1, milkChoiceId: "ing_milk_oat" },
        { menuItemId: "mi_cheesecake", quantity: 1 },
      ],
    });
    const [oat, cake] = st.orders.find((o) => o.id === "ord_qa")!.items;
    expect(oat.costSnap).not.toBeCloseTo(line.costSnap, 4); // oat milk costs more than whole
    expect(cake.priceSnap).toBe(8);
    expect(cake.costSnap).toBeCloseTo(0.8, 10);
  });
});
