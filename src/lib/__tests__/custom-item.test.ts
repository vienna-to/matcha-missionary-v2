import { describe, expect, it } from "vitest";
import { computeEventTotals } from "@/lib/calc";
import {
  CUSTOM_BASE_PRICE,
  componentKind,
  customComponents,
  customItemCost,
  customItemId,
  customItemName,
  customItemPrice,
  findMenuItem,
  parseCustomItemId,
} from "@/lib/custom-item";
import { deriveOrderItem, reducer } from "@/lib/reducer";
import { initialSeed } from "@/lib/seed";
import type { AppState, Ingredient, MenuItem, MenuSnapshot, Order } from "@/lib/types";

const T = "2026-01-01T00:00:00.000Z";
const ing = (id: string, name: string, price: number, amount: number, unit: Ingredient["unit"], pool: Ingredient["pool"] = null): Ingredient => ({
  id, name, packagePrice: price, packageAmount: amount, unit, pool, createdAt: T, updatedAt: T,
});
const drink = (id: string, sortOrder: number, lines: MenuItem["ingredientLines"]): MenuItem => ({
  id, name: id, category: "other", price: 7, size: "16oz", active: true, sortOrder,
  ingredientLines: lines, allowedMilkIds: [], allowedCreamIds: [], createdAt: T, updatedAt: T,
});

// Round per-unit costs so the expected numbers are easy to check by hand:
// matcha $1/g, hojicha $0.50/g, milk $0.01/ml, creams $0.10/ml, purée $0.01/ml.
const MATCHA = ing("matcha", "Matcha powder", 100, 100, "g");
const HOJICHA = ing("hojicha", "Hojicha powder", 50, 100, "g");
const MILK = ing("milk", "Whole milk", 10, 1000, "ml", "milk");
const UBE = ing("ube", "Ube cream", 20, 200, "ml", "cream");
const BANANA = ing("banana", "Banana cream", 30, 300, "ml", "cream");
const PUREE = ing("puree", "Strawberry purée", 5, 500, "ml");
const CUP = ing("cup", "16oz cup", 10, 100, "piece");
const AGAVE = ing("agave", "Agave", 10, 1000, "ml");

const SNAP: MenuSnapshot = {
  id: "s",
  ingredients: [MATCHA, HOJICHA, MILK, UBE, BANANA, PUREE, CUP, AGAVE],
  menuItems: [
    drink("latte", 1, [
      { ingredientId: "matcha", amount: 5, unit: "g" },
      { ingredientId: "milk", amount: 100, unit: "ml" },
      { ingredientId: "agave", amount: 5, unit: "ml" },
      { ingredientId: "cup", amount: 1, unit: "piece" },
    ]),
    drink("hoj", 2, [
      { ingredientId: "hojicha", amount: 4, unit: "g" },
      { ingredientId: "milk", amount: 120, unit: "ml" },
    ]),
    drink("ubedrink", 3, [
      { ingredientId: "matcha", amount: 5, unit: "g" },
      { ingredientId: "ube", amount: 30, unit: "ml" },
    ]),
    drink("berry", 4, [{ ingredientId: "puree", amount: 20, unit: "ml" }]),
  ],
  createdAt: T,
};

describe("custom drink price: 6.70 flat + 0.20 per topping, bases never matter", () => {
  it("no toppings is the flat price", () => {
    expect(customItemPrice(0)).toBe(6.7);
    expect(CUSTOM_BASE_PRICE).toBe(6.7);
  });
  it("adds 0.20 per topping", () => {
    expect(customItemPrice(1)).toBe(6.9);
    expect(customItemPrice(2)).toBe(7.1);
    expect(customItemPrice(3)).toBe(7.3);
  });
  it("2 bases + 2 toppings = 7.10, same as 1 base + 2 toppings", () => {
    const id2 = customItemId({ baseIds: ["matcha", "hojicha"], toppingIds: ["ube", "banana"] });
    const id1 = customItemId({ baseIds: ["matcha"], toppingIds: ["ube", "banana"] });
    expect(findMenuItem(SNAP, id2)!.price).toBe(7.1);
    expect(findMenuItem(SNAP, id1)!.price).toBe(7.1);
  });
});

describe("custom drink cost: sum of the selected components' standard recipe cost", () => {
  it("standard amounts come from the recipes menu drinks already use", () => {
    const by = (id: string) =>
      [...customComponents(SNAP).bases, ...customComponents(SNAP).toppings].find((c) => c.ingredient.id === id)!;
    expect(by("matcha").line.amount).toBe(5); // from the latte
    expect(by("hojicha").line.amount).toBe(4);
    expect(by("milk").line.amount).toBe(100); // first drink's milk line (menu order)
    expect(by("ube").line.amount).toBe(30);
    expect(by("banana").line.amount).toBe(30); // never in a recipe itself: uses the cream pool's amount
    expect(by("puree").line.amount).toBe(20);
  });

  it("hojicha + banana cream = 4g x 0.50 + 30ml x 0.10", () => {
    const spec = { baseIds: ["hojicha"], toppingIds: ["banana"] };
    expect(customItemCost(spec, SNAP)).toBeCloseTo(2 + 3, 10);
  });

  it("2 bases + 2 toppings sums every component once", () => {
    const spec = { baseIds: ["matcha", "hojicha"], toppingIds: ["ube", "puree"] };
    expect(customItemCost(spec, SNAP)).toBeCloseTo(5 + 2 + 3 + 0.2, 10);
  });

  it("a base with no toppings costs just the base", () => {
    expect(customItemCost({ baseIds: ["milk"], toppingIds: [] }, SNAP)).toBeCloseTo(1, 10);
  });

  it("scales with the event cup size like a menu drink (recipes are authored at 16oz)", () => {
    const spec = { baseIds: ["hojicha"], toppingIds: ["banana"] };
    expect(customItemCost(spec, SNAP, 8)).toBeCloseTo(2.5, 10);
    expect(customItemCost(spec, SNAP, 16)).toBeCloseTo(5, 10);
  });

  it("uses the cost data in the system: a pricier ingredient raises the cost", () => {
    const pricier: MenuSnapshot = {
      ...SNAP,
      ingredients: SNAP.ingredients.map((i) => (i.id === "hojicha" ? { ...i, packagePrice: 100 } : i)),
    };
    expect(customItemCost({ baseIds: ["hojicha"], toppingIds: [] }, pricier)).toBeCloseTo(4, 10);
  });

  it("packaging and sweetener are not components", () => {
    const { bases, toppings } = customComponents(SNAP);
    const ids = [...bases, ...toppings].map((c) => c.ingredient.id);
    expect(ids).not.toContain("cup");
    expect(ids).not.toContain("agave");
    expect(bases.map((c) => c.ingredient.id).sort()).toEqual(["hojicha", "matcha", "milk"]);
    expect(toppings.map((c) => c.ingredient.id).sort()).toEqual(["banana", "puree", "ube"]);
  });

  it("an ingredient no drink recipe uses is not offered (it cannot be costed)", () => {
    const unused = ing("genmaicha", "Genmaicha tea", 10, 100, "g");
    const snap = { ...SNAP, ingredients: [...SNAP.ingredients, unused] };
    expect(customComponents(snap).bases.map((c) => c.ingredient.id)).not.toContain("genmaicha");
  });

  it("classifies by pool, then by name", () => {
    expect(componentKind(MILK)).toBe("base");
    expect(componentKind(UBE)).toBe("topping");
    expect(componentKind(PUREE)).toBe("topping");
    expect(componentKind(HOJICHA)).toBe("base");
    expect(componentKind(CUP)).toBeNull();
  });
});

describe("custom item id and name", () => {
  it("is canonical: order and duplicates do not matter, and it round-trips", () => {
    const a = customItemId({ baseIds: ["matcha", "hojicha"], toppingIds: ["banana", "ube"] });
    const b = customItemId({ baseIds: ["hojicha", "matcha", "matcha"], toppingIds: ["ube", "banana"] });
    expect(a).toBe(b);
    expect(parseCustomItemId(a)).toEqual({ baseIds: ["hojicha", "matcha"], toppingIds: ["banana", "ube"] });
    expect(parseCustomItemId("mi_classic")).toBeNull();
  });
  it("names the drink with its components, bases first", () => {
    const name = customItemName({ baseIds: ["hojicha"], toppingIds: ["banana"] }, SNAP);
    expect(name).toBe("Custom: Hojicha powder + Banana cream");
  });
});

// ---- flows into the order, the totals and the sale-time snapshot ----

function setup() {
  let s: AppState = initialSeed();
  s = reducer(s, {
    type: "CREATE_EVENT",
    event: { name: "E", date: "2026-10-20", startTime: "11:00", endTime: "16:00", eventType: "standard", cupSizeOz: 16 },
  });
  const ev = s.events.find((e) => e.name === "E")!;
  const snap = s.menuSnapshots.find((m) => m.id === ev.menuSnapshotId)!;
  return { s, ev, snap };
}
function orderWith(state: AppState, eventId: string, items: Order["items"]): AppState {
  const o: Order = {
    id: "ord_c", eventId, orderNumber: 1, customerName: "T", items,
    submittedAt: "2026-10-20T12:00:00.000Z", updatedAt: "2026-10-20T12:00:00.000Z",
    paymentStatus: "paid", paymentMethod: "cash", status: "pending",
  };
  return reducer(state, { type: "SUBMIT_ORDER", order: o });
}

describe("custom item on an order", () => {
  const spec = { baseIds: ["ing_hojicha"], toppingIds: ["ing_cream_banana", "ing_strawberry"] };

  it("is stamped like a menu item: name, price, cost, list price", () => {
    const { snap } = setup();
    const line = deriveOrderItem({ menuItemId: customItemId(spec), quantity: 2 }, "o", snap, 16);
    expect(line.menuItemNameSnap).toBe("Custom: Hojicha powder + Banana cream + Strawberry purée");
    expect(line.priceSnap).toBe(7.1);
    expect(line.listPrice).toBe(7.1);
    expect(line.priceCharged).toBe(7.1);
    // hojicha 4g @ $0.32/g + banana cream 30ml @ $0.018/ml + purée 20ml @ $0.014/ml
    expect(line.costSnap).toBeCloseTo(4 * 0.32 + 30 * 0.018 + 20 * 0.014, 10);
  });

  it("drops milk / cream choices (the components are the milk and cream)", () => {
    const { snap } = setup();
    const line = deriveOrderItem(
      { menuItemId: customItemId(spec), quantity: 1, milkChoiceId: "ing_milk_oat", creamChoiceId: "ing_cream_ube" },
      "o", snap, 16,
    );
    expect(line.milkChoiceId).toBeUndefined();
    expect(line.creamChoiceId).toBeUndefined();
  });

  it("a discount applies to the custom price like any item", () => {
    const { snap } = setup();
    const line = deriveOrderItem({ menuItemId: customItemId(spec), quantity: 1, discountPct: 50 }, "o", snap, 16);
    expect(line.priceCharged).toBeCloseTo(3.55, 10);
  });

  it("flows into revenue, cost, profit, margin and cups poured", () => {
    const { s, ev, snap } = setup();
    const line = deriveOrderItem({ menuItemId: customItemId(spec), quantity: 2 }, "o", snap, 16);
    const classic = deriveOrderItem({ menuItemId: "mi_classic", quantity: 1 }, "o", snap, 16);
    const st = orderWith(s, ev.id, [line, classic]);
    const totals = computeEventTotals(snap, [], st.orders.filter((o) => o.eventId === ev.id));
    expect(totals.revenuePaid).toBeCloseTo(2 * 7.1 + 6.7, 10);
    expect(totals.ingredientCost).toBeCloseTo(2 * line.costSnap + classic.costSnap, 10);
    expect(totals.profit).toBeCloseTo(totals.revenuePaid - totals.ingredientCost, 10);
    expect(totals.margin).toBeCloseTo(totals.profit / totals.revenuePaid, 10);
    expect(totals.cupsPoured).toBe(3);
    expect(totals.pastriesServed).toBe(0);
    const row = totals.byItem.find((t) => t.menuItemId === customItemId(spec))!;
    expect(row.qty).toBe(2);
    expect(row.name).toContain("Custom:");
    expect(row.revenuePaid).toBeCloseTo(14.2, 10);
  });

  it("keeps the sale-time cost and price when an ingredient price changes later, also through an edit", () => {
    const { s, ev, snap } = setup();
    const line = deriveOrderItem({ menuItemId: customItemId(spec), quantity: 1 }, "ord_c", snap, 16);
    let st = orderWith(s, ev.id, [line]);
    st = reducer(st, { type: "UPDATE_INGREDIENT", id: "ing_hojicha", patch: { packagePrice: 320 } });
    st = reducer(st, {
      type: "REPLACE_ORDER_ITEMS",
      orderId: "ord_c",
      items: [{ sourceItemId: line.id, menuItemId: customItemId(spec), quantity: 3 }],
    });
    const after = st.orders.find((o) => o.id === "ord_c")!.items[0];
    expect(after.quantity).toBe(3);
    expect(after.costSnap).toBeCloseTo(line.costSnap, 10);
    expect(after.priceSnap).toBe(7.1);
    expect(after.menuItemNameSnap).toBe(line.menuItemNameSnap);
  });

  it("a custom line added in Edit Order (no sourceItemId) is priced and costed at edit time", () => {
    const { s, ev, snap } = setup();
    const classic = deriveOrderItem({ menuItemId: "mi_classic", quantity: 1 }, "ord_c", snap, 16);
    let st = orderWith(s, ev.id, [classic]);
    st = reducer(st, {
      type: "REPLACE_ORDER_ITEMS",
      orderId: "ord_c",
      items: [
        { sourceItemId: classic.id, menuItemId: "mi_classic", quantity: 1 },
        { menuItemId: customItemId({ baseIds: ["ing_hojicha"], toppingIds: [] }), quantity: 1 },
      ],
    });
    const [, custom] = st.orders.find((o) => o.id === "ord_c")!.items;
    expect(custom.priceSnap).toBe(6.7);
    expect(custom.costSnap).toBeCloseTo(4 * 0.32, 10);
    expect(custom.menuItemNameSnap).toBe("Custom: Hojicha powder");
  });
});
