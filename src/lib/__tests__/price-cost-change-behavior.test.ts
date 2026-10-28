import { describe, expect, it } from "vitest";
import { computeEventTotals } from "@/lib/calc";
import { deriveOrderItem, reducer } from "@/lib/reducer";
import { initialSeed } from "@/lib/seed";
import type { AppState, MenuSnapshot, Order, OrderItem } from "@/lib/types";

/**
 * What changing a menu item's PRICE or its COST (an ingredient's package price, or a recipe line)
 * in Menu Manager does, per REPORT.md (mid-event price / cost changes):
 *   - orders already placed:        never change (price and cost are stamped on the order line)
 *   - new orders, active event:     use the new price and cost immediately (Live Orders sells from the live menu)
 *   - a new (future) event:         starts from the new numbers (its snapshot is taken at creation)
 *   - the event that already exists: keeps its frozen snapshot (used for names and layout, not for money)
 */
function setup() {
  let s: AppState = initialSeed();
  s = reducer(s, {
    type: "CREATE_EVENT",
    event: { name: "Live", date: "2026-10-27", startTime: "11:00", endTime: "16:00", eventType: "standard", cupSizeOz: 16 },
  });
  const ev = s.events.find((e) => e.name === "Live")!;
  return { s, ev };
}

/** What Live Orders sells from: the event's snapshot shell with the CURRENT menu and ingredients. */
const liveSnapshot = (s: AppState, snapId: string): MenuSnapshot => ({
  id: snapId,
  menuItems: s.menuItems,
  ingredients: s.ingredients,
  createdAt: "",
});

/** Place one Classic Matcha the way Live Orders does (buildOrder -> deriveOrderItem on the live menu). */
function place(s: AppState, evId: string, snapId: string, id: string, n: number): AppState {
  const item = deriveOrderItem(
    { menuItemId: "mi_classic", quantity: 1, status: "pending" },
    id,
    liveSnapshot(s, snapId),
    16,
  );
  const o: Order = {
    id, eventId: evId, orderNumber: n, customerName: id, items: [item], submittedAt: "2026-10-27T12:00:00.000Z",
    updatedAt: "2026-10-27T12:00:00.000Z", paymentStatus: "paid", paymentMethod: "cash", status: "pending",
  };
  return reducer(s, { type: "SUBMIT_ORDER", order: o });
}

const line = (s: AppState, id: string): OrderItem => s.orders.find((o) => o.id === id)!.items[0];
const matcha = (s: AppState) => s.menuItems.find((m) => m.id === "mi_classic")!;
const totalsOf = (s: AppState, evId: string) => {
  const ev = s.events.find((e) => e.id === evId)!;
  const snap = s.menuSnapshots.find((x) => x.id === ev.menuSnapshotId)!;
  return computeEventTotals(snap, ev.fixedCosts, s.orders.filter((o) => o.eventId === evId));
};

describe("changing a menu item's PRICE", () => {
  it("placed orders keep their price; new orders use the new one; the event snapshot and event totals stay put", () => {
    const { s, ev } = setup();
    const placed = place(s, ev.id, ev.menuSnapshotId, "ord_before", 1);
    const before = line(placed, "ord_before");
    const totalsBefore = totalsOf(placed, ev.id);

    const raised = reducer(placed, { type: "UPDATE_MENU_ITEM", id: "mi_classic", patch: { price: matcha(placed).price + 3 } });
    // already placed: untouched, and so are the event's totals
    expect(line(raised, "ord_before")).toEqual(before);
    expect(totalsOf(raised, ev.id).revenuePaid).toBe(totalsBefore.revenuePaid);
    expect(totalsOf(raised, ev.id).totalCost).toBe(totalsBefore.totalCost);
    // the next order in the same active event: new price
    const next = place(raised, ev.id, ev.menuSnapshotId, "ord_after", 2);
    expect(line(next, "ord_after").priceSnap).toBe(before.priceSnap + 3);
    expect(line(next, "ord_after").priceCharged).toBe(before.priceSnap + 3);
    // the existing event keeps its frozen snapshot (names and layout; it is not used for money)
    const snap = raised.menuSnapshots.find((x) => x.id === ev.menuSnapshotId)!;
    expect(snap.menuItems.find((m) => m.id === "mi_classic")!.price).toBe(before.priceSnap);
    // a future event starts from the new price
    const future = reducer(raised, {
      type: "CREATE_EVENT",
      event: { name: "Next", date: "2026-11-01", startTime: "11:00", endTime: "16:00", eventType: "standard", cupSizeOz: 16 },
    });
    const evNext = future.events.find((e) => e.name === "Next")!;
    expect(future.menuSnapshots.find((x) => x.id === evNext.menuSnapshotId)!.menuItems.find((m) => m.id === "mi_classic")!.price).toBe(
      before.priceSnap + 3,
    );
  });
});

describe("changing a menu item's COST (ingredient price or recipe)", () => {
  it("an ingredient price change: placed orders keep their cost; new orders use the new cost", () => {
    const { s, ev } = setup();
    const placed = place(s, ev.id, ev.menuSnapshotId, "ord_before", 1);
    const before = line(placed, "ord_before");
    const tea = placed.ingredients.find((i) => /^matcha powder/i.test(i.name))!;
    const pricier = reducer(placed, { type: "UPDATE_INGREDIENT", id: tea.id, patch: { packagePrice: tea.packagePrice * 4 } });
    expect(line(pricier, "ord_before").costSnap).toBe(before.costSnap);
    expect(totalsOf(pricier, ev.id).totalCost).toBe(totalsOf(placed, ev.id).totalCost);
    const next = place(pricier, ev.id, ev.menuSnapshotId, "ord_after", 2);
    expect(line(next, "ord_after").costSnap).toBeGreaterThan(before.costSnap);
    // the frozen event snapshot still holds the old ingredient price
    const snap = pricier.menuSnapshots.find((x) => x.id === ev.menuSnapshotId)!;
    expect(snap.ingredients.find((i) => i.id === tea.id)!.packagePrice).toBe(tea.packagePrice);
  });

  it("a recipe change (more tea in the drink) works the same way", () => {
    const { s, ev } = setup();
    const placed = place(s, ev.id, ev.menuSnapshotId, "ord_before", 1);
    const before = line(placed, "ord_before");
    const lines = matcha(placed).ingredientLines.map((l, i) => (i === 0 ? { ...l, amount: l.amount * 2 } : l));
    const changed = reducer(placed, { type: "UPDATE_MENU_ITEM", id: "mi_classic", patch: { ingredientLines: lines } });
    expect(line(changed, "ord_before").costSnap).toBe(before.costSnap);
    const next = place(changed, ev.id, ev.menuSnapshotId, "ord_after", 2);
    expect(line(next, "ord_after").costSnap).toBeGreaterThan(before.costSnap);
  });

  it("a prepared ingredient follows a raw price change for new orders only", () => {
    const { s, ev } = setup();
    const agave = s.ingredients.find((i) => i.name === "Agave")!;
    const syrup = reducer(s, {
      type: "ADD_INGREDIENT",
      ing: {
        name: "Syrup", kind: "prepared", packagePrice: 0, packageAmount: 500, unit: "ml", pool: null,
        subRecipe: [{ ingredientId: agave.id, amount: 100, unit: "ml" }],
      } as never,
    });
    const prepared = syrup.ingredients.find((i) => i.name === "Syrup")!;
    const lines = [...matcha(syrup).ingredientLines, { ingredientId: prepared.id, amount: 30, unit: "ml" }];
    const withSyrup = reducer(syrup, { type: "UPDATE_MENU_ITEM", id: "mi_classic", patch: { ingredientLines: lines as never } });
    const placed = place(withSyrup, ev.id, ev.menuSnapshotId, "ord_before", 1);
    const before = line(placed, "ord_before");
    const moved = reducer(placed, { type: "UPDATE_INGREDIENT", id: agave.id, patch: { packagePrice: agave.packagePrice * 10 } });
    expect(line(moved, "ord_before").costSnap).toBe(before.costSnap);
    expect(line(place(moved, ev.id, ev.menuSnapshotId, "ord_after", 2), "ord_after").costSnap).toBeGreaterThan(before.costSnap);
  });
});

describe("editing an already placed order after a price / cost change", () => {
  it("a quantity or note edit keeps the sale-time stamps; changing the milk makes it a new product stamped at today's numbers", () => {
    const { s, ev } = setup();
    const placed = place(s, ev.id, ev.menuSnapshotId, "ord_before", 1);
    const sold = line(placed, "ord_before");
    let t = reducer(placed, { type: "UPDATE_MENU_ITEM", id: "mi_classic", patch: { price: matcha(placed).price + 3 } });
    const tea = t.ingredients.find((i) => /^matcha powder/i.test(i.name))!;
    t = reducer(t, { type: "UPDATE_INGREDIENT", id: tea.id, patch: { packagePrice: tea.packagePrice * 4 } });

    const qty = reducer(t, {
      type: "REPLACE_ORDER_ITEMS",
      orderId: "ord_before",
      items: [{ menuItemId: "mi_classic", quantity: 2, status: "pending", sourceItemId: sold.id, specialRequests: "cold" }],
    });
    expect(line(qty, "ord_before").priceSnap).toBe(sold.priceSnap);
    expect(line(qty, "ord_before").costSnap).toBe(sold.costSnap);

    const otherMilk = matcha(t).allowedMilkIds.find((id) => id !== matcha(t).defaultMilkId);
    expect(otherMilk).toBeTruthy();
    const milk = reducer(t, {
      type: "REPLACE_ORDER_ITEMS",
      orderId: "ord_before",
      items: [{ menuItemId: "mi_classic", quantity: 1, status: "pending", sourceItemId: sold.id, milkChoiceId: otherMilk }],
    });
    expect(line(milk, "ord_before").priceSnap).toBe(sold.priceSnap + 3);
    expect(line(milk, "ord_before").costSnap).toBeGreaterThan(sold.costSnap);
  });
});

describe("a past (not active) event is not re-priced by editing it", () => {
  it("adding a line to an old event's order uses that event's frozen menu", () => {
    const { s, ev } = setup();
    const placed = place(s, ev.id, ev.menuSnapshotId, "ord_old", 1);
    const raised = reducer(placed, { type: "UPDATE_MENU_ITEM", id: "mi_classic", patch: { price: matcha(placed).price + 3 } });
    // a newer event becomes active; "Live" is now a past event
    const moved = reducer(raised, {
      type: "CREATE_EVENT",
      event: { name: "Newer", date: "2026-11-02", startTime: "11:00", endTime: "16:00", eventType: "standard", cupSizeOz: 16 },
    });
    expect(moved.events.find((e) => e.id === ev.id)!.isActive).toBe(false);
    const edited = reducer(moved, {
      type: "REPLACE_ORDER_ITEMS",
      orderId: "ord_old",
      items: [{ menuItemId: "mi_classic", quantity: 1, status: "pending" }], // a new line
    });
    expect(line(edited, "ord_old").priceSnap).toBe(matcha(s).price); // the old event's price, not today's
  });
});
