import { describe, expect, it } from "vitest";
import { computeItemCost, defaultItemCost, ingredientCostPerCanonical, preparedBatchCost } from "@/lib/calc";
import { normalizeIngredientPatch, preparedUsing, sanitizeSubRecipe, subRecipeChoices } from "@/lib/prepared";
import { deriveOrderItem, reducer } from "@/lib/reducer";
import { initialSeed } from "@/lib/seed";
import type { AppState, Ingredient, MenuItem, Order } from "@/lib/types";

const T = "2026-01-01T00:00:00.000Z";
const raw = (id: string, name: string, price: number, amount: number, unit: Ingredient["unit"], pool: Ingredient["pool"] = null): Ingredient => ({
  id, name, packagePrice: price, packageAmount: amount, unit, pool, createdAt: T, updatedAt: T,
});

// bananas $3/kg, sugar $2/kg, cream $8/L, matcha $1/g, milk $0.01/ml
const BANANA = raw("banana", "Bananas", 3, 1000, "g");
const SUGAR = raw("sugar", "Sugar", 2, 1000, "g");
const CREAM = raw("cream", "Heavy cream", 8, 1000, "ml");
const MATCHA = raw("matcha", "Matcha", 100, 100, "g");
const MILK = raw("milk", "Milk", 10, 1000, "ml", "milk");

// One batch = 300g banana (0.90) + 100g sugar (0.20) + 400ml cream (3.20) = 4.30, yielding 500 ml.
const BANANA_CREAM: Ingredient = {
  id: "bcream", name: "Banana cream", packagePrice: 0, packageAmount: 500, unit: "ml", kind: "prepared",
  subRecipe: [
    { ingredientId: "banana", amount: 300, unit: "g" },
    { ingredientId: "sugar", amount: 100, unit: "g" },
    { ingredientId: "cream", amount: 400, unit: "ml" },
  ],
  createdAt: T, updatedAt: T,
};
const ALL = [BANANA, SUGAR, CREAM, MATCHA, MILK, BANANA_CREAM];

const LATTE: MenuItem = {
  id: "latte", name: "Banana latte", category: "other", price: 7, size: "16oz", active: true,
  ingredientLines: [
    { ingredientId: "matcha", amount: 5, unit: "g" },
    { ingredientId: "milk", amount: 100, unit: "ml" },
    { ingredientId: "bcream", amount: 30, unit: "ml" }, // ONE line, like any ingredient
  ],
  defaultMilkId: "milk", allowedMilkIds: [], allowedCreamIds: [], createdAt: T, updatedAt: T,
};

describe("prepared ingredient cost per unit = (sum of raw sub-recipe costs for one batch) / yield", () => {
  it("batch cost is the sum of its raw lines", () => {
    expect(preparedBatchCost(BANANA_CREAM, ALL)).toBeCloseTo(0.9 + 0.2 + 3.2, 10);
  });
  it("per ml = batch / yield", () => {
    expect(ingredientCostPerCanonical(BANANA_CREAM, ALL)).toBeCloseTo(4.3 / 500, 10);
  });
  it("yield in another unit converts (16 fl oz)", () => {
    const fl = { ...BANANA_CREAM, packageAmount: 16, unit: "fl_oz" as const };
    expect(ingredientCostPerCanonical(fl, ALL)).toBeCloseTo(4.3 / (16 * 29.5735), 10);
  });
  it("a raw ingredient is unchanged: package price / package amount", () => {
    expect(ingredientCostPerCanonical(CREAM)).toBeCloseTo(0.008, 10);
  });
  it("a zero yield costs 0 instead of dividing by zero", () => {
    expect(ingredientCostPerCanonical({ ...BANANA_CREAM, packageAmount: 0 }, ALL)).toBe(0);
  });
  it("sub-recipe amounts are converted from their own units (a pound of bananas)", () => {
    const p = { ...BANANA_CREAM, subRecipe: [{ ingredientId: "banana", amount: 1, unit: "lb" as const }] };
    expect(preparedBatchCost(p, ALL)).toBeCloseTo(3 * 0.453592, 6);
  });
});

describe("a drink recipe using a prepared ingredient", () => {
  it("costs: raw lines plus (prepared per-unit cost x amount used)", () => {
    expect(computeItemCost(LATTE, ALL)).toBeCloseTo(5 + 1 + 30 * (4.3 / 500), 10);
    expect(defaultItemCost(LATTE, ALL)).toBeCloseTo(6.258, 10);
  });
  it("a prepared ingredient used in ounces converts like any ingredient", () => {
    const l = { ...LATTE, ingredientLines: [{ ingredientId: "bcream", amount: 1, unit: "fl_oz" as const }] };
    expect(computeItemCost(l, ALL)).toBeCloseTo(29.5735 * (4.3 / 500), 10);
  });
  it("scales with the event cup size like every other line", () => {
    expect(computeItemCost(LATTE, ALL, { cupSizeOz: 8 })).toBeCloseTo(6.258 / 2, 10);
  });
  it("a raw-only drink costs exactly what it did before", () => {
    const plain = { ...LATTE, ingredientLines: LATTE.ingredientLines.slice(0, 2) };
    expect(computeItemCost(plain, ALL)).toBeCloseTo(6, 10);
  });
});

describe("one level of nesting only", () => {
  it("a prepared ingredient is not offered as a sub-recipe ingredient, nor the owner itself", () => {
    const ids = subRecipeChoices("bcream", ALL).map((i) => i.id).sort();
    expect(ids).toEqual(["banana", "cream", "matcha", "milk", "sugar"]);
  });

  it("sanitize drops prepared, self and unknown lines", () => {
    const other: Ingredient = { ...BANANA_CREAM, id: "other", name: "Other prep" };
    const lines = [
      { ingredientId: "banana", amount: 1, unit: "g" as const },
      { ingredientId: "bcream", amount: 1, unit: "ml" as const }, // itself
      { ingredientId: "other", amount: 1, unit: "ml" as const }, // another prepared
      { ingredientId: "ghost", amount: 1, unit: "g" as const }, // does not exist
      { ingredientId: "sugar", amount: Number.NaN, unit: "g" as const },
    ];
    expect(sanitizeSubRecipe("bcream", lines, [...ALL, other]).map((l) => l.ingredientId)).toEqual(["banana"]);
  });

  it("a prepared ingredient cannot be added to another prepared ingredient's recipe (reducer)", () => {
    let s: AppState = initialSeed();
    s = reducer(s, { type: "ADD_INGREDIENT", ing: { name: "Mix A", packagePrice: 0, packageAmount: 100, unit: "ml", kind: "prepared", subRecipe: [{ ingredientId: "ing_agave", amount: 10, unit: "ml" }] } });
    const a = s.ingredients.find((i) => i.name === "Mix A")!;
    s = reducer(s, {
      type: "ADD_INGREDIENT",
      ing: { name: "Mix B", packagePrice: 0, packageAmount: 100, unit: "ml", kind: "prepared", subRecipe: [{ ingredientId: a.id, amount: 5, unit: "ml" }, { ingredientId: "ing_agave", amount: 5, unit: "ml" }] },
    });
    const b = s.ingredients.find((i) => i.name === "Mix B")!;
    expect(b.subRecipe!.map((l) => l.ingredientId)).toEqual(["ing_agave"]);
    // and updating a recipe the same way
    s = reducer(s, { type: "UPDATE_INGREDIENT", id: b.id, patch: { subRecipe: [{ ingredientId: a.id, amount: 1, unit: "ml" }] } });
    expect(s.ingredients.find((i) => i.id === b.id)!.subRecipe).toEqual([]);
  });

  it("a raw ingredient used inside a prepared recipe cannot become prepared", () => {
    let s: AppState = initialSeed();
    s = reducer(s, { type: "ADD_INGREDIENT", ing: { name: "Mix A", packagePrice: 0, packageAmount: 100, unit: "ml", kind: "prepared", subRecipe: [{ ingredientId: "ing_agave", amount: 10, unit: "ml" }] } });
    expect(preparedUsing("ing_agave", s.ingredients).map((i) => i.name)).toEqual(["Mix A"]);
    const patch = normalizeIngredientPatch(s.ingredients, "ing_agave", { kind: "prepared", subRecipe: [], packagePrice: 0, name: "Agave 2" });
    expect(patch.kind).toBeUndefined();
    expect(patch.name).toBe("Agave 2"); // the rest of the edit still applies
    s = reducer(s, { type: "UPDATE_INGREDIENT", id: "ing_agave", patch: { kind: "prepared", subRecipe: [] } });
    expect(s.ingredients.find((i) => i.id === "ing_agave")!.kind).toBeUndefined();
  });

  it("a prepared ingredient listed inside another's recipe adds no cost even if stored that way", () => {
    const nested: Ingredient = { ...BANANA_CREAM, id: "nested", subRecipe: [{ ingredientId: "bcream", amount: 100, unit: "ml" }] };
    expect(preparedBatchCost(nested, [...ALL, nested])).toBe(0);
  });

  it("converting back to raw clears the recipe; a new prepared ingredient has price 0", () => {
    const p = normalizeIngredientPatch(ALL, "bcream", { kind: "raw", packagePrice: 5 });
    expect(p.subRecipe).toEqual([]);
    expect(p.packagePrice).toBe(5);
    const q = normalizeIngredientPatch(ALL, "matcha", { kind: "prepared", subRecipe: [{ ingredientId: "banana", amount: 1, unit: "g" }] });
    expect(q.packagePrice).toBe(0);
  });
});

// ---- a raw price change flows up; sale-time cost is snapshotted ----

function setup() {
  let s: AppState = initialSeed();
  s = reducer(s, {
    type: "ADD_INGREDIENT",
    ing: {
      name: "Agave cream", packagePrice: 0, packageAmount: 200, unit: "ml", kind: "prepared",
      subRecipe: [{ ingredientId: "ing_agave", amount: 100, unit: "ml" }, { ingredientId: "ing_milk_whole", amount: 100, unit: "ml" }],
    },
  });
  const prep = s.ingredients.find((i) => i.name === "Agave cream")!;
  s = reducer(s, {
    type: "UPDATE_MENU_ITEM",
    id: "mi_classic",
    patch: { ingredientLines: [...s.menuItems.find((m) => m.id === "mi_classic")!.ingredientLines, { ingredientId: prep.id, amount: 20, unit: "ml" }] },
  });
  return { s, prep };
}

describe("a raw price change flows up into the prepared ingredient and every drink using it", () => {
  const classic = (s: AppState) => s.menuItems.find((m) => m.id === "mi_classic")!;

  it("raw -> prepared -> drink", () => {
    const { s, prep } = setup();
    const agavePerMl = 8.99 / 660;
    const milkPerMl = 5.49 / 3785;
    const preparedPerMl = (100 * agavePerMl + 100 * milkPerMl) / 200;
    expect(ingredientCostPerCanonical(prep, s.ingredients)).toBeCloseTo(preparedPerMl, 10);
    const before = defaultItemCost(classic(s), s.ingredients);

    const s2 = reducer(s, { type: "UPDATE_INGREDIENT", id: "ing_agave", patch: { packagePrice: 17.98 } }); // doubles
    const preparedPerMl2 = (100 * agavePerMl * 2 + 100 * milkPerMl) / 200;
    expect(ingredientCostPerCanonical(s2.ingredients.find((i) => i.id === prep.id)!, s2.ingredients)).toBeCloseTo(preparedPerMl2, 10);
    // the drink moved by (new - old per ml of the prepared) x 20 ml, plus the 5 ml of agave it also uses directly
    const after = defaultItemCost(classic(s2), s2.ingredients);
    expect(after - before).toBeCloseTo(20 * (preparedPerMl2 - preparedPerMl) + 5 * agavePerMl, 10);
  });

  it("an order stamps the cost at that moment; later raw price changes do not rewrite it, new orders use the new price", () => {
    let { s } = setup();
    s = reducer(s, {
      type: "CREATE_EVENT",
      event: { name: "E", date: "2026-10-23", startTime: "11:00", endTime: "16:00", eventType: "standard", cupSizeOz: 16 },
    });
    const ev = s.events.find((e) => e.name === "E")!;
    const live = () => ({ id: "live", menuItems: s.menuItems, ingredients: s.ingredients, createdAt: "" });
    const line = deriveOrderItem({ menuItemId: "mi_classic", quantity: 1 }, "ord_p", live(), 16);
    expect(line.costSnap).toBeCloseTo(computeItemCost(classic(s), s.ingredients, { cupSizeOz: 16 }), 10);
    const order: Order = {
      id: "ord_p", eventId: ev.id, orderNumber: 1, customerName: "T", items: [line],
      submittedAt: "2026-10-23T12:00:00.000Z", updatedAt: "2026-10-23T12:00:00.000Z",
      paymentStatus: "paid", paymentMethod: "cash", status: "pending",
    };
    s = reducer(s, { type: "SUBMIT_ORDER", order });

    s = reducer(s, { type: "UPDATE_INGREDIENT", id: "ing_agave", patch: { packagePrice: 100 } });
    // the placed order is untouched, also through an edit that only changes quantity
    expect(s.orders.find((o) => o.id === "ord_p")!.items[0].costSnap).toBeCloseTo(line.costSnap, 10);
    s = reducer(s, { type: "REPLACE_ORDER_ITEMS", orderId: "ord_p", items: [{ sourceItemId: line.id, menuItemId: "mi_classic", quantity: 2 }] });
    expect(s.orders.find((o) => o.id === "ord_p")!.items[0].costSnap).toBeCloseTo(line.costSnap, 10);
    // an order placed after the change is costed with the new price
    const fresh = deriveOrderItem({ menuItemId: "mi_classic", quantity: 1 }, "o2", live(), 16);
    expect(fresh.costSnap).toBeGreaterThan(line.costSnap + 0.1);
  });

  it("the event's frozen snapshot keeps the prepared definition and the raw prices it was created with", () => {
    let { s } = setup();
    s = reducer(s, {
      type: "CREATE_EVENT",
      event: { name: "E", date: "2026-10-23", startTime: "11:00", endTime: "16:00", eventType: "standard", cupSizeOz: 16 },
    });
    const ev = s.events.find((e) => e.name === "E")!;
    const snap = s.menuSnapshots.find((m) => m.id === ev.menuSnapshotId)!;
    const inSnap = snap.ingredients.find((i) => i.name === "Agave cream")!;
    expect(inSnap.kind).toBe("prepared");
    expect(inSnap.subRecipe).toHaveLength(2);
    const frozen = ingredientCostPerCanonical(inSnap, snap.ingredients);
    s = reducer(s, { type: "UPDATE_INGREDIENT", id: "ing_agave", patch: { packagePrice: 100 } });
    const snapAfter = s.menuSnapshots.find((m) => m.id === ev.menuSnapshotId)!;
    expect(ingredientCostPerCanonical(snapAfter.ingredients.find((i) => i.name === "Agave cream")!, snapAfter.ingredients)).toBeCloseTo(frozen, 12);
  });
});
