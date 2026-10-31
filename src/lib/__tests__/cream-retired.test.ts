import { describe, expect, it } from "vitest";
import { computeItemCost } from "@/lib/calc";
import { legacyCreamName, resolveCreamName } from "@/lib/order-labels";
import { deriveOrderItem, reducer } from "@/lib/reducer";
import { initialSeed } from "@/lib/seed";
import { fromOrderItem, toOrderItemInsert } from "@/lib/supabase/serialize";
import type { AppState, Order, OrderItem } from "@/lib/types";

/**
 * Cream used to be a per-order choice (a swap on the recipe's cream line, plus a "no cream" option). It is
 * retired: cream is a plain recipe ingredient. These tests pin what must NOT change (cream lines cost as
 * before; past orders keep their cream choice and stamped cost) and what stops (new lines record none).
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

describe("cream costs as the recipe line says", () => {
  it("every seed cream drink costs the same as it did with its default cream swapped in", () => {
    const { ingredients, menuItems } = initialSeed();
    for (const m of menuItems.filter((x) => x.category === "cream_top")) {
      // the old swap, written out: the cream line costs the item's default cream (the seed default was the recipe's own)
      const line = m.ingredientLines.find((l) => ingredients.find((i) => i.id === l.ingredientId)?.pool === "cream")!;
      expect(line, m.name).toBeDefined();
      const noCream = computeItemCost({ ...m, ingredientLines: m.ingredientLines.filter((l) => l !== line) }, ingredients);
      expect(computeItemCost(m, ingredients)).toBeGreaterThan(noCream);
    }
  });

  it("a recipe cream line costs even when the item has no cream settings at all (it used to cost $0)", () => {
    const s = initialSeed();
    const ube = s.menuItems.find((m) => m.id === "mi_ube")!;
    const without = { ...ube, defaultCreamId: undefined, allowedCreamIds: [] };
    expect(computeItemCost(without, s.ingredients)).toBeCloseTo(computeItemCost(ube, s.ingredients), 10);
  });
});

describe("new lines never record a cream choice", () => {
  it("deriveOrderItem drops a cream choice and its name snapshot", () => {
    const { s, snap } = setup();
    const raw = { menuItemId: "mi_ube", quantity: 1, creamChoiceId: "none", creamNameSnap: "no cream" };
    const it = deriveOrderItem(raw, "o1", snap, 16);
    expect(it.creamChoiceId).toBeUndefined();
    expect(it.creamNameSnap).toBeUndefined();
    // and it costs the recipe, not "no cream"
    expect(it.costSnap).toBeCloseTo(computeItemCost(s.menuItems.find((m) => m.id === "mi_ube")!, s.ingredients, { cupSizeOz: 16 }), 10);
  });
});

describe("past orders that recorded a cream choice", () => {
  const legacyItem = (extra: Partial<OrderItem> = {}): OrderItem => ({
    id: "oi_old",
    orderId: "ord_old",
    menuItemId: "mi_ube",
    menuItemNameSnap: "Ube Cream Matcha",
    priceSnap: 6.9,
    listPrice: 6.9,
    priceCharged: 6.9,
    costSnap: 1.2345,
    quantity: 1,
    creamChoiceId: "ing_cream_sesame",
    creamNameSnap: "Sesame cream",
    status: "done",
    ...extra,
  });

  function withOrder(item: OrderItem) {
    const { s, ev } = setup();
    const o: Order = {
      id: "ord_old",
      eventId: ev.id,
      orderNumber: 1,
      customerName: "T",
      items: [item],
      submittedAt: "2026-10-16T12:00:00.000Z",
      updatedAt: "2026-10-16T12:00:00.000Z",
      paymentStatus: "paid",
      paymentMethod: "cash",
      status: "completed",
    };
    return { s: reducer(s, { type: "SUBMIT_ORDER", order: o }), ev };
  }

  it("keep the recorded choice, the name and the stamped cost when an edit leaves the line alone", () => {
    const { s } = withOrder(legacyItem());
    const t = reducer(s, {
      type: "REPLACE_ORDER_ITEMS",
      orderId: "ord_old",
      items: [{ sourceItemId: "oi_old", menuItemId: "mi_ube", quantity: 3, creamChoiceId: undefined }],
    });
    const it = t.orders.find((o) => o.id === "ord_old")!.items[0];
    expect(it.quantity).toBe(3);
    expect(it.costSnap).toBe(1.2345);
    expect(it.creamChoiceId).toBe("ing_cream_sesame");
    expect(it.creamNameSnap).toBe("Sesame cream");
  });

  it("show on the barista card as recorded, including an explicit no-cream", () => {
    const { s } = withOrder(legacyItem());
    expect(legacyCreamName(legacyItem(), s.ingredients)).toBe("Sesame cream");
    expect(legacyCreamName(legacyItem({ creamNameSnap: undefined }), s.ingredients)).toBe("Sesame cream");
    expect(legacyCreamName(legacyItem({ creamNameSnap: undefined, creamChoiceId: "none" }), s.ingredients)).toBe("no cream");
    expect(legacyCreamName(legacyItem({ creamNameSnap: undefined, creamChoiceId: undefined }), s.ingredients)).toBeUndefined();
    expect(resolveCreamName("ing_cream_banana", s.ingredients)).toBe("Banana cream");
    expect(resolveCreamName(undefined, s.ingredients)).toBeUndefined();
  });

  it("round-trip through the database row unchanged", () => {
    const item = legacyItem();
    const row = toOrderItemInsert("ws", item);
    expect(row.cream_choice_id).toBe("ing_cream_sesame");
    expect(row.cream_name_snap).toBe("Sesame cream");
    const back = fromOrderItem(row as never);
    expect(back.creamNameSnap).toBe("Sesame cream");
    expect(back.creamChoiceId).toBe("ing_cream_sesame");
    expect(back.costSnap).toBe(1.2345);
  });
});
