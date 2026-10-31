import { describe, expect, it } from "vitest";
import { deriveOrderItem, mergeServerOrders, reducer } from "@/lib/reducer";
import { itemDrinkName, orderCardIssue, resolveMilkName } from "@/lib/order-labels";
import { initialSeed } from "@/lib/seed";
import { MATCHA_LATTE, SNAPSHOT, WHOLE, makeItem, makeOrder } from "./fixtures";

/**
 * Reproduction of the "blank barista card" bug and its fixes.
 *
 * Before: an `orders` INSERT reached other iPads before its `order_items`
 * were written; the realtime handler turned it into an order with
 * `items: []`, which the queue rendered as a card with no drink name / milk.
 */
describe("blank barista card (reproduction)", () => {
  it("an order that arrives without items is detected, not rendered blank", () => {
    // This is exactly the state the old RT_UPSERT_ORDER path produced.
    const { items: _items, ...shell } = makeOrder({ items: [] });
    void _items;
    const state = reducer(initialSeed(), { type: "RT_UPSERT_ORDER", order: shell });
    const stored = state.orders.find((o) => o.id === shell.id)!;
    expect(stored.items).toEqual([]); // the failure state exists...
    expect(orderCardIssue(stored, SNAPSHOT)).toBe("empty"); // ...and is flagged
  });

  it("RT_SET_ORDER installs the order together with its items", () => {
    const state = reducer(initialSeed(), { type: "RT_SET_ORDER", order: makeOrder() });
    const stored = state.orders.find((o) => o.id === "ord-1")!;
    expect(stored.items).toHaveLength(1);
    expect(orderCardIssue(stored, SNAPSHOT)).toBe("ok");
  });

  it("an item with a blank or placeholder name has no drink name (red warning)", () => {
    expect(itemDrinkName(makeItem({ menuItemNameSnap: "" }), undefined)).toBeNull();
    expect(itemDrinkName(makeItem({ menuItemNameSnap: "Unknown item" }), undefined)).toBeNull();
    expect(
      orderCardIssue(makeOrder({ items: [makeItem({ menuItemNameSnap: "" })] }), undefined),
    ).toBe("partial");
  });

  it("a blank snapshot name falls back to the menu snapshot", () => {
    expect(itemDrinkName(makeItem({ menuItemNameSnap: "" }), SNAPSHOT)).toBe("Matcha Latte");
  });
});

describe("snapshot at order time", () => {
  it("stores drink + milk names on the line item, and never a cream (retired choice)", () => {
    const item = deriveOrderItem(
      { menuItemId: MATCHA_LATTE.id, quantity: 1 },
      "ord-1",
      SNAPSHOT,
    );
    expect(item.menuItemNameSnap).toBe("Matcha Latte");
    expect(item.milkNameSnap).toBe("Whole milk"); // from the drink's default
    expect(item.creamNameSnap).toBeUndefined();
    expect(item.creamChoiceId).toBeUndefined();
  });

  it("keeps the milk name even if the ingredient is later deleted", () => {
    const item = deriveOrderItem(
      { menuItemId: MATCHA_LATTE.id, quantity: 1, milkChoiceId: WHOLE.id },
      "ord-1",
      SNAPSHOT,
    );
    // Later the ingredient disappears from the master list:
    expect(resolveMilkName(item.milkChoiceId, MATCHA_LATTE, [])).toBeUndefined();
    // ...but the snapshot on the item still names it.
    expect(item.milkNameSnap).toBe("Whole milk");
  });

  it("names the synthetic milk choices used when no ingredient matches", () => {
    const item = deriveOrderItem(
      { menuItemId: MATCHA_LATTE.id, quantity: 1, milkChoiceId: "__milk_lactose" },
      "ord-1",
      SNAPSHOT,
    );
    expect(item.milkNameSnap).toBe("Lactose free milk");
  });
});

describe("mergeServerOrders (poll / refetch)", () => {
  it("drops orders deleted elsewhere but keeps ones still being saved", () => {
    const keep = makeOrder({ id: "mine", orderNumber: 2 });
    const gone = makeOrder({ id: "gone", orderNumber: 3 });
    const server = [makeOrder({ id: "other", orderNumber: 1 })];
    const merged = mergeServerOrders([keep, gone], server, "evt-1", new Set(["mine"]));
    expect(merged.map((o) => o.id).sort()).toEqual(["mine", "other"]);
  });

  it("leaves orders from other events alone when scoped", () => {
    const old = makeOrder({ id: "old", eventId: "evt-0" });
    const merged = mergeServerOrders([old], [], "evt-1", new Set());
    expect(merged.map((o) => o.id)).toEqual(["old"]);
  });

  it("never lets an item-less server row blank an order we hold items for", () => {
    const local = makeOrder();
    const merged = mergeServerOrders([local], [makeOrder({ items: [] })], "evt-1", new Set());
    expect(merged[0].items).toHaveLength(1);
  });
});
