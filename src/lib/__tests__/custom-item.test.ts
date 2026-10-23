import { describe, expect, it } from "vitest";
import { computeEventTotals, expandCombosInByItem } from "@/lib/calc";
import { findComboSuggestion } from "@/lib/combos";
import {
  CUSTOM_BASE_PRICE,
  MILK_ONLY_ID,
  comboUnitPrice,
  componentKind,
  customComponents,
  customCostParts,
  customItemCost,
  customItemId,
  customItemName,
  customItemPrice,
  findMenuItem,
  packagingLines,
  parseCustomItemId,
  standardMilk,
} from "@/lib/custom-item";
import { cartTotal } from "@/lib/order-steps";
import { deriveOrderItem, reducer } from "@/lib/reducer";
import { initialSeed } from "@/lib/seed";
import type { AppState, Ingredient, MenuItem, MenuSnapshot, Order } from "@/lib/types";

const T = "2026-01-01T00:00:00.000Z";
const ing = (
  id: string, name: string, price: number, amount: number, unit: Ingredient["unit"],
  pool: Ingredient["pool"] = null, customRole?: Ingredient["customRole"],
): Ingredient => ({ id, name, packagePrice: price, packageAmount: amount, unit, pool, customRole, createdAt: T, updatedAt: T });
const drink = (id: string, sortOrder: number, lines: MenuItem["ingredientLines"], over: Partial<MenuItem> = {}): MenuItem => ({
  id, name: id, category: "other", price: 7, size: "16oz", active: true, sortOrder,
  ingredientLines: lines, defaultMilkId: "milk", allowedMilkIds: [], allowedCreamIds: [], createdAt: T, updatedAt: T, ...over,
});

// Round per-unit costs so expected numbers are easy to check by hand:
// matcha $1/g, hojicha $0.50/g, genmaicha $0.25/g, milk $0.01/ml, oat $0.02/ml,
// creams $0.10/ml, purée $0.01/ml, cup $0.10, lid $0.05, agave $0.01/ml.
const MATCHA = ing("matcha", "Matcha powder", 100, 100, "g", null, "base");
const HOJICHA = ing("hojicha", "Hojicha powder", 50, 100, "g", null, "base");
const GENMAI = ing("genmai", "Genmaicha", 25, 100, "g", null, "base");
const MILK = ing("milk", "Whole milk", 10, 1000, "ml", "milk");
const OAT = ing("oat", "Oat milk", 20, 1000, "ml", "milk");
const UBE = ing("ube", "Ube cream", 20, 200, "ml", "cream", "topping");
const BANANA = ing("banana", "Banana cream", 30, 300, "ml", "cream", "topping");
const PUREE = ing("puree", "Strawberry purée", 5, 500, "ml", null, "topping");
const CUP = ing("cup", "16oz cup", 10, 100, "piece");
const LID = ing("lid", "Lid", 5, 100, "piece");
const AGAVE = ing("agave", "Agave", 10, 1000, "ml");
const CHOCO = ing("choco", "Chocolate spread", 10, 100, "g");

const base = (extra: MenuItem["ingredientLines"]): MenuItem["ingredientLines"] => [
  ...extra,
  { ingredientId: "cup", amount: 1, unit: "piece" },
  { ingredientId: "lid", amount: 1, unit: "piece" },
];
const SNAP: MenuSnapshot = {
  id: "s",
  ingredients: [MATCHA, HOJICHA, GENMAI, MILK, OAT, UBE, BANANA, PUREE, CUP, LID, AGAVE, CHOCO],
  menuItems: [
    drink("latte", 1, base([
      { ingredientId: "matcha", amount: 5, unit: "g" },
      { ingredientId: "milk", amount: 100, unit: "ml" },
      { ingredientId: "agave", amount: 5, unit: "ml" },
    ])),
    drink("hoj", 2, base([
      { ingredientId: "hojicha", amount: 4, unit: "g" },
      { ingredientId: "milk", amount: 120, unit: "ml" },
      { ingredientId: "agave", amount: 5, unit: "ml" },
    ])),
    drink("ubedrink", 3, base([
      { ingredientId: "matcha", amount: 5, unit: "g" },
      { ingredientId: "ube", amount: 30, unit: "ml" },
      { ingredientId: "milk", amount: 100, unit: "ml" },
      { ingredientId: "agave", amount: 5, unit: "ml" },
    ])),
    drink("berry", 4, base([
      { ingredientId: "puree", amount: 20, unit: "ml" },
      { ingredientId: "genmai", amount: 6, unit: "g" },
      { ingredientId: "choco", amount: 15, unit: "g" },
      { ingredientId: "milk", amount: 100, unit: "ml" },
    ])),
  ],
  createdAt: T,
};
const spec = (baseIds: string[], toppingIds: string[] = []) => ({ baseIds, toppingIds });

describe("custom drink price: 6.70 flat + 0.20 per topping, bases never matter", () => {
  it("no toppings is the flat price; adds 0.20 per topping", () => {
    expect(customItemPrice(0)).toBe(6.7);
    expect(CUSTOM_BASE_PRICE).toBe(6.7);
    expect(customItemPrice(1)).toBe(6.9);
    expect(customItemPrice(2)).toBe(7.1);
    expect(customItemPrice(3)).toBe(7.3);
  });
  it("2 bases + 2 toppings = 7.10, same as 1 base + 2 toppings, and milk only + 2 toppings", () => {
    const price = (s: ReturnType<typeof spec>) => findMenuItem(SNAP, customItemId(s))!.price;
    expect(price(spec(["matcha", "hojicha"], ["ube", "banana"]))).toBe(7.1);
    expect(price(spec(["matcha"], ["ube", "banana"]))).toBe(7.1);
    expect(price(spec([MILK_ONLY_ID], ["ube", "banana"]))).toBe(7.1);
  });
});

describe("combo price: $10 covers up to one topping, +0.20 for each extra topping", () => {
  it("base only (6.70) and one topping (6.90) are both $10", () => {
    expect(comboUnitPrice(customItemId(spec(["matcha"])))).toBe(10);
    expect(comboUnitPrice(customItemId(spec(["matcha"], ["ube"])))).toBe(10);
  });
  it("each additional topping beyond the first adds 0.20", () => {
    expect(comboUnitPrice(customItemId(spec(["matcha"], ["ube", "banana"])))).toBe(10.2);
    expect(comboUnitPrice(customItemId(spec(["matcha"], ["ube", "banana", "puree"])))).toBe(10.4);
  });
  it("a menu drink is plain $10", () => {
    expect(comboUnitPrice("latte")).toBe(10);
    expect(comboUnitPrice(undefined)).toBe(10);
  });
});

describe("custom drink cost = tea + milk + toppings + packaging, from existing recipes", () => {
  it("standard amounts come from the recipes menu drinks already use", () => {
    const { bases, toppings, milk } = customComponents(SNAP);
    const by = (id: string) => [...bases, ...toppings].find((c) => c.ingredient.id === id)!;
    expect(by("matcha").line.amount).toBe(5); // from the latte
    expect(by("hojicha").line.amount).toBe(4);
    expect(by("ube").line.amount).toBe(30);
    expect(by("banana").line.amount).toBe(30); // in no recipe itself: the cream pool's amount
    expect(by("puree").line.amount).toBe(20);
    expect(milk!.ingredient.id).toBe("milk"); // the first drink's default milk
    expect(milk!.line.amount).toBe(100);
  });

  it("packaging is what most drinks use besides tea, milk and toppings, read from the recipes", () => {
    const pack = packagingLines(SNAP).map((p) => p.ingredient.id).sort();
    expect(pack).toEqual(["agave", "cup", "lid"]); // chocolate (1 of 4 drinks) is not packaging
  });

  it("one tea: its tea amount + full milk + packaging", () => {
    const c = customCostParts(spec(["hojicha"]), SNAP);
    expect(c.tea).toBeCloseTo(2, 10); // 4g x 0.50
    expect(c.milk).toBeCloseTo(1, 10); // 100ml x 0.01
    expect(c.toppings).toBe(0);
    expect(c.packaging).toBeCloseTo(0.2, 10); // cup 0.10 + lid 0.05 + agave 5ml 0.05
    expect(c.total).toBeCloseTo(3.2, 10);
  });

  it("hojicha + banana cream = tea 2 + milk 1 + topping 3 + packaging 0.20", () => {
    expect(customItemCost(spec(["hojicha"], ["banana"]), SNAP)).toBeCloseTo(6.2, 10);
  });

  it("2 teas split the tea amount evenly; milk stays one full amount", () => {
    const c = customCostParts(spec(["matcha", "hojicha"]), SNAP);
    expect(c.tea).toBeCloseTo(5 / 2 + 2 / 2, 10); // half of each tea
    expect(c.milk).toBeCloseTo(1, 10); // not doubled
  });

  it("3 teas split into thirds; milk still full", () => {
    const c = customCostParts(spec(["matcha", "hojicha", "genmai"]), SNAP);
    expect(c.tea).toBeCloseTo((5 + 2 + 6 * 0.25) / 3, 10);
    expect(c.milk).toBeCloseTo(1, 10);
  });

  it("2 teas + 2 toppings: every part once", () => {
    const c = customCostParts(spec(["matcha", "hojicha"], ["ube", "puree"]), SNAP);
    expect(c.total).toBeCloseTo(3.5 + 1 + (3 + 0.2) + 0.2, 10);
  });

  it("milk only: no tea, one full milk amount, plus toppings and packaging", () => {
    const c = customCostParts(spec([MILK_ONLY_ID], ["banana"]), SNAP);
    expect(c.tea).toBe(0);
    expect(c.milk).toBeCloseTo(1, 10);
    expect(c.total).toBeCloseTo(1 + 3 + 0.2, 10);
  });

  it("a milk choice swaps the milk like a menu drink's", () => {
    expect(customCostParts(spec(["hojicha"]), SNAP, undefined, "oat").milk).toBeCloseTo(2, 10);
    expect(customCostParts(spec(["hojicha"]), SNAP, undefined, "not-a-milk").milk).toBeCloseTo(1, 10);
  });

  it("scales with the event cup size like a menu drink (recipes are authored at 16oz)", () => {
    expect(customItemCost(spec(["hojicha"], ["banana"]), SNAP, 8)).toBeCloseTo(6.2 / 2, 10);
    expect(customItemCost(spec(["hojicha"], ["banana"]), SNAP, 16)).toBeCloseTo(6.2, 10);
  });

  it("follows ingredient prices: nothing is hardcoded", () => {
    const pricier: MenuSnapshot = {
      ...SNAP,
      ingredients: SNAP.ingredients.map((i) =>
        i.id === "cup" ? { ...i, packagePrice: 20 } : i.id === "milk" ? { ...i, packagePrice: 20 } : i,
      ),
    };
    const c = customCostParts(spec(["hojicha"]), pricier);
    expect(c.packaging).toBeCloseTo(0.3, 10); // cup now 0.20
    expect(c.milk).toBeCloseTo(2, 10);
  });

  it("matches a menu drink built from the same parts", () => {
    // The latte is matcha 5g + milk 100ml + agave + cup + lid: exactly what a one-tea custom costs.
    const latte = SNAP.menuItems[0];
    const asMenu = latte.ingredientLines.reduce((s, l) => {
      const i = SNAP.ingredients.find((x) => x.id === l.ingredientId)!;
      return s + (i.packagePrice / i.packageAmount) * l.amount;
    }, 0);
    expect(customItemCost(spec(["matcha"]), SNAP)).toBeCloseTo(asMenu, 10);
  });
});

describe("base / topping flag decides what the builder offers", () => {
  const ids = (snap: MenuSnapshot) => {
    const c = customComponents(snap);
    return { bases: c.bases.map((b) => b.ingredient.id).sort(), toppings: c.toppings.map((t) => t.ingredient.id).sort() };
  };

  it("offers only flagged bases and toppings (milk and packaging never)", () => {
    expect(ids(SNAP)).toEqual({ bases: ["genmai", "hojicha", "matcha"], toppings: ["banana", "puree", "ube"] });
  });

  it("an explicit role beats the name: 'none' hides a tea, 'base' offers an oddly named ingredient", () => {
    const taro = ing("taro", "Taro paste", 10, 100, "g", null, "base");
    const snap: MenuSnapshot = {
      ...SNAP,
      ingredients: [...SNAP.ingredients.map((i) => (i.id === "matcha" ? { ...i, customRole: "none" as const } : i)), taro],
      menuItems: [...SNAP.menuItems, drink("taro-latte", 5, base([{ ingredientId: "taro", amount: 8, unit: "g" }]))],
    };
    expect(ids(snap).bases).toContain("taro");
    expect(ids(snap).bases).not.toContain("matcha");
  });

  it("milk is never a base even if flagged, and an unused ingredient is not offered", () => {
    const snap: MenuSnapshot = {
      ...SNAP,
      ingredients: [
        ...SNAP.ingredients.map((i) => (i.id === "milk" ? { ...i, customRole: "base" as const } : i)),
        ing("sencha", "Sencha", 10, 100, "g", null, "base"),
      ],
    };
    expect(ids(snap).bases).not.toContain("milk");
    expect(ids(snap).bases).not.toContain("sencha"); // no recipe uses it, cannot be costed
  });

  it("a never-set role (column missing, old data) falls back to a guess from the name", () => {
    expect(componentKind(ing("a", "Hojicha powder", 1, 1, "g"))).toBe("base");
    expect(componentKind(ing("b", "Ube cream", 1, 1, "ml", "cream"))).toBe("topping");
    expect(componentKind(ing("c", "Strawberry purée", 1, 1, "ml"))).toBe("topping");
    expect(componentKind(ing("d", "Taro paste", 1, 1, "g"))).toBeNull();
    expect(componentKind(ing("e", "16oz cup", 1, 1, "piece"))).toBeNull();
    expect(componentKind(MILK)).toBeNull();
  });

  it("standard milk is the first drink's default milk at its recipe amount", () => {
    expect(standardMilk(SNAP)!.ingredient.id).toBe("milk");
    expect(standardMilk({ ...SNAP, menuItems: [] })).toBeNull();
  });
});

describe("custom item id and name", () => {
  it("is canonical and round-trips", () => {
    const a = customItemId(spec(["matcha", "hojicha"], ["banana", "ube"]));
    const b = customItemId(spec(["hojicha", "matcha", "matcha"], ["ube", "banana"]));
    expect(a).toBe(b);
    expect(parseCustomItemId(a)).toEqual({ baseIds: ["hojicha", "matcha"], toppingIds: ["banana", "ube"] });
    expect(parseCustomItemId("mi_classic")).toBeNull();
  });
  it("names the drink with its components, bases first; milk only is named Milk", () => {
    expect(customItemName(spec(["hojicha"], ["banana"]), SNAP)).toBe("Custom: Hojicha powder + Banana cream");
    expect(customItemName(spec([MILK_ONLY_ID], ["banana"]), SNAP)).toBe("Custom: Milk + Banana cream");
  });
});

// ---- flows into the order, the totals and the sale-time snapshot (seed data) ----

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

// Seed prices: hojicha 4g @ 0.32, whole milk 180ml @ 5.49/3785 (the first drink in menu order, Classic Matcha),
// banana cream 30ml @ 0.018, purée 20ml @ 0.014, packaging = 16oz cup + lid + straw + 50g ice + 5ml agave.
const SEED_PACKAGING = 28 / 100 + 12 / 100 + 6 / 250 + (4 / 4000) * 50 + (8.99 / 660) * 5;
const SEED_MILK = (5.49 / 3785) * 180; // Classic Matcha is first in menu order: 180 ml

describe("custom item on an order", () => {
  const cspec = spec(["ing_hojicha"], ["ing_cream_banana", "ing_strawberry"]);

  it("is stamped like a menu item and includes packaging and milk", () => {
    const { snap } = setup();
    const line = deriveOrderItem({ menuItemId: customItemId(cspec), quantity: 2 }, "o", snap, 16);
    expect(line.menuItemNameSnap).toBe("Custom: Hojicha powder + Banana cream + Strawberry purée");
    expect(line.priceSnap).toBe(7.1);
    expect(line.listPrice).toBe(7.1);
    expect(line.priceCharged).toBe(7.1);
    expect(line.costSnap).toBeCloseTo(4 * 0.32 + SEED_MILK + 30 * 0.018 + 20 * 0.014 + SEED_PACKAGING, 10);
    expect(SEED_PACKAGING).toBeGreaterThan(0.5); // about $0.54 on the seed menu
  });

  it("the milk choice is kept and re-costs; cream choice is dropped", () => {
    const { snap } = setup();
    const whole = deriveOrderItem({ menuItemId: customItemId(cspec), quantity: 1 }, "o", snap, 16);
    const oat = deriveOrderItem(
      { menuItemId: customItemId(cspec), quantity: 1, milkChoiceId: "ing_milk_oat", creamChoiceId: "ing_cream_ube" },
      "o", snap, 16,
    );
    expect(oat.milkChoiceId).toBe("ing_milk_oat");
    expect(oat.creamChoiceId).toBeUndefined();
    expect(oat.costSnap).toBeGreaterThan(whole.costSnap); // oat milk costs more
    expect(whole.milkNameSnap).toBe("Whole milk");
  });

  it("a discount applies to the custom price like any item", () => {
    const { snap } = setup();
    const line = deriveOrderItem({ menuItemId: customItemId(cspec), quantity: 1, discountPct: 50 }, "o", snap, 16);
    expect(line.priceCharged).toBeCloseTo(3.55, 10);
  });

  it("flows into revenue, cost, profit, margin and cups poured", () => {
    const { s, ev, snap } = setup();
    const line = deriveOrderItem({ menuItemId: customItemId(cspec), quantity: 2 }, "o", snap, 16);
    const classic = deriveOrderItem({ menuItemId: "mi_classic", quantity: 1 }, "o", snap, 16);
    const st = orderWith(s, ev.id, [line, classic]);
    const totals = computeEventTotals(snap, [], st.orders.filter((o) => o.eventId === ev.id));
    expect(totals.revenuePaid).toBeCloseTo(2 * 7.1 + 6.7, 10);
    expect(totals.ingredientCost).toBeCloseTo(2 * line.costSnap + classic.costSnap, 10);
    expect(totals.profit).toBeCloseTo(totals.revenuePaid - totals.ingredientCost, 10);
    expect(totals.cupsPoured).toBe(3);
    expect(totals.byItem.find((t) => t.menuItemId === customItemId(cspec))!.qty).toBe(2);
  });

  it("keeps sale-time cost and price when an ingredient price changes later, also through an edit", () => {
    const { s, ev, snap } = setup();
    const line = deriveOrderItem({ menuItemId: customItemId(cspec), quantity: 1 }, "ord_c", snap, 16);
    let st = orderWith(s, ev.id, [line]);
    st = reducer(st, { type: "UPDATE_INGREDIENT", id: "ing_hojicha", patch: { packagePrice: 320 } });
    st = reducer(st, { type: "UPDATE_INGREDIENT", id: "ing_cup_16", patch: { packagePrice: 280 } });
    st = reducer(st, {
      type: "REPLACE_ORDER_ITEMS",
      orderId: "ord_c",
      items: [{ sourceItemId: line.id, menuItemId: customItemId(cspec), quantity: 3 }],
    });
    const after = st.orders.find((o) => o.id === "ord_c")!.items[0];
    expect(after.quantity).toBe(3);
    expect(after.costSnap).toBeCloseTo(line.costSnap, 10);
    expect(after.priceSnap).toBe(7.1);
    expect(after.menuItemNameSnap).toBe(line.menuItemNameSnap);
  });

  it("a custom line added in Edit Order (no sourceItemId) is costed at edit time", () => {
    const { s, ev, snap } = setup();
    const classic = deriveOrderItem({ menuItemId: "mi_classic", quantity: 1 }, "ord_c", snap, 16);
    let st = orderWith(s, ev.id, [classic]);
    st = reducer(st, {
      type: "REPLACE_ORDER_ITEMS",
      orderId: "ord_c",
      items: [
        { sourceItemId: classic.id, menuItemId: "mi_classic", quantity: 1 },
        { menuItemId: customItemId(spec(["ing_hojicha"])), quantity: 1 },
      ],
    });
    const [, custom] = st.orders.find((o) => o.id === "ord_c")!.items;
    expect(custom.priceSnap).toBe(6.7);
    expect(custom.costSnap).toBeCloseTo(4 * 0.32 + SEED_MILK + SEED_PACKAGING, 10);
    expect(custom.menuItemNameSnap).toBe("Custom: Hojicha powder");
  });
});

describe("custom drink in a combo", () => {
  const three = spec(["ing_hojicha"], ["ing_cream_banana", "ing_strawberry", "ing_cream_ube"]);

  it("is priced $10 + 0.20 per topping beyond the first, and costs drink + pastry", () => {
    const { snap } = setup();
    const line = deriveOrderItem(
      { menuItemId: customItemId(three), quantity: 1, isCombo: true, comboPastryId: "mi_cheesecake" },
      "o", snap, 16,
    );
    expect(line.priceSnap).toBe(10.4);
    expect(line.priceCharged).toBe(10.4);
    expect(line.costSnap).toBeCloseTo(customItemCost(three, snap, 16) + 0.8, 10);
    // base only and one topping stay at 10
    const flat = deriveOrderItem(
      { menuItemId: customItemId(spec(["ing_hojicha"], ["ing_cream_banana"])), quantity: 1, isCombo: true, comboPastryId: "mi_cheesecake" },
      "o", snap, 16,
    );
    expect(flat.priceSnap).toBe(10);
  });

  it("the cart total uses the combo price", () => {
    const { snap } = setup();
    const total = cartTotal(
      [{ cid: "c", menuItemId: customItemId(three), quantity: 2, isCombo: true, comboPastryId: "mi_cheesecake" }],
      snap,
    );
    expect(total).toBeCloseTo(20.8, 10);
  });

  it("is suggested when a custom drink and a pastry are in the cart", () => {
    const { snap } = setup();
    const id = customItemId(three);
    const s = findComboSuggestion(
      [
        { cid: "a", menuItemId: id, quantity: 1 },
        { cid: "b", menuItemId: "mi_cheesecake", quantity: 1 },
      ],
      snap,
      new Set(),
    );
    expect(s).not.toBeNull();
    expect(s!.comboTotal).toBeCloseTo(10.4, 10);
    expect(s!.separateTotal).toBeCloseTo(7.3 + 8, 10);
  });

  it("revenue and cost are not lost when the combo is split into drink and pastry rows", () => {
    const { s, ev, snap } = setup();
    const line = deriveOrderItem(
      { menuItemId: customItemId(three), quantity: 2, isCombo: true, comboPastryId: "mi_cheesecake" },
      "o", snap, 16,
    );
    const st = orderWith(s, ev.id, [line]);
    const orders = st.orders.filter((o) => o.eventId === ev.id);
    const totals = computeEventTotals(snap, [], orders);
    const split = expandCombosInByItem(totals.byItem, snap, orders);
    const sum = (k: "revenuePaid" | "totalCost") => split.reduce((a, t) => a + t[k], 0);
    expect(sum("revenuePaid")).toBeCloseTo(2 * 10.4, 10);
    expect(sum("totalCost")).toBeCloseTo(2 * line.costSnap, 10);
    const custom = split.find((t) => t.menuItemId === customItemId(three))!;
    expect(custom.name).toContain("Custom:");
    expect(custom.qty).toBe(2);
  });
});
