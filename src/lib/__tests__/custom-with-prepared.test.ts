import { describe, expect, it } from "vitest";
import { ingredientCostPerCanonical } from "@/lib/calc";
import {
  MILK_ONLY_ID,
  customComponents,
  customCostParts,
  customItemCost,
  customItemId,
  packagingLines,
} from "@/lib/custom-item";
import { normalizeIngredientPatch } from "@/lib/prepared";
import { deriveOrderItem, reducer } from "@/lib/reducer";
import { initialSeed } from "@/lib/seed";
import type { AppState, Ingredient, MenuItem, MenuSnapshot } from "@/lib/types";

/**
 * Both features together: a custom drink that uses a PREPARED ingredient (made
 * from raw ones) must cost it from its recipe, not $0, and the base/topping
 * roles must work alongside prepared ingredients.
 */
const T = "2026-01-01T00:00:00.000Z";
const raw = (
  id: string, name: string, price: number, amount: number, unit: Ingredient["unit"],
  pool: Ingredient["pool"] = null, customRole?: Ingredient["customRole"],
): Ingredient => ({ id, name, packagePrice: price, packageAmount: amount, unit, pool, customRole, createdAt: T, updatedAt: T });
const prepared = (
  id: string, name: string, yieldAmount: number, unit: Ingredient["unit"], subRecipe: Ingredient["subRecipe"],
  customRole?: Ingredient["customRole"],
): Ingredient => ({
  id, name, packagePrice: 0, packageAmount: yieldAmount, unit, kind: "prepared", subRecipe, customRole, createdAt: T, updatedAt: T,
});
const drink = (id: string, sortOrder: number, lines: MenuItem["ingredientLines"]): MenuItem => ({
  id, name: id, category: "other", price: 7, size: "16oz", active: true, sortOrder,
  ingredientLines: lines, defaultMilkId: "milk", allowedMilkIds: [], allowedCreamIds: [], createdAt: T, updatedAt: T,
});

// raw: matcha $1/g, hojicha $0.50/g, milk $0.01/ml, banana $3/kg, sugar $2/kg, cream $8/L, cup $0.10, lid $0.05
const MATCHA = raw("matcha", "Matcha powder", 100, 100, "g", null, "base");
const HOJICHA = raw("hojicha", "Hojicha powder", 50, 100, "g", null, "base");
const MILK = raw("milk", "Whole milk", 10, 1000, "ml", "milk");
const BANANA = raw("banana", "Bananas", 3, 1000, "g", null, "none");
const SUGAR = raw("sugar", "Sugar", 2, 1000, "g", null, "none");
const CREAM = raw("cream", "Heavy cream", 8, 1000, "ml", null, "none");
const CUP = raw("cup", "16oz cup", 10, 100, "piece");
const LID = raw("lid", "Lid", 5, 100, "piece");
// prepared topping: one batch = 300g banana (0.90) + 100g sugar (0.20) + 400ml cream (3.20) = 4.30 -> 500 ml
const BANANA_CREAM = prepared("bcream", "Banana cream", 500, "ml", [
  { ingredientId: "banana", amount: 300, unit: "g" },
  { ingredientId: "sugar", amount: 100, unit: "g" },
  { ingredientId: "cream", amount: 400, unit: "ml" },
], "topping");
// prepared base: one batch = 50g matcha (50) + 50g hojicha (25) -> 100 g  => $0.75/g
const HOUSE_BLEND = prepared("blend", "House blend", 100, "g", [
  { ingredientId: "matcha", amount: 50, unit: "g" },
  { ingredientId: "hojicha", amount: 50, unit: "g" },
], "base");
// prepared, used in every drink, role never set (a house syrup)
const SYRUP = prepared("syrup", "House syrup", 100, "ml", [{ ingredientId: "sugar", amount: 50, unit: "g" }]);

const PER_ML_BANANA_CREAM = 4.3 / 500;
const PER_G_BLEND = 75 / 100;

const withCup = (lines: MenuItem["ingredientLines"]): MenuItem["ingredientLines"] => [
  ...lines,
  { ingredientId: "cup", amount: 1, unit: "piece" },
  { ingredientId: "lid", amount: 1, unit: "piece" },
];
const snap = (extra: Partial<MenuSnapshot> = {}, ingredients: Ingredient[] = [MATCHA, HOJICHA, MILK, BANANA, SUGAR, CREAM, CUP, LID, BANANA_CREAM, HOUSE_BLEND, SYRUP]): MenuSnapshot => ({
  id: "s",
  ingredients,
  menuItems: [
    drink("latte", 1, withCup([{ ingredientId: "matcha", amount: 5, unit: "g" }, { ingredientId: "milk", amount: 100, unit: "ml" }, { ingredientId: "syrup", amount: 10, unit: "ml" }])),
    drink("hoj", 2, withCup([{ ingredientId: "hojicha", amount: 4, unit: "g" }, { ingredientId: "milk", amount: 120, unit: "ml" }, { ingredientId: "syrup", amount: 10, unit: "ml" }])),
    drink("bananadrink", 3, withCup([{ ingredientId: "matcha", amount: 5, unit: "g" }, { ingredientId: "bcream", amount: 30, unit: "ml" }, { ingredientId: "milk", amount: 100, unit: "ml" }, { ingredientId: "syrup", amount: 10, unit: "ml" }])),
    drink("blenddrink", 4, withCup([{ ingredientId: "blend", amount: 6, unit: "g" }, { ingredientId: "milk", amount: 100, unit: "ml" }, { ingredientId: "syrup", amount: 10, unit: "ml" }])),
  ],
  createdAt: T,
  ...extra,
});
const spec = (baseIds: string[], toppingIds: string[] = []) => ({ baseIds, toppingIds });

describe("a custom drink using a prepared ingredient is costed from its recipe, never $0", () => {
  const S = snap();

  it("the prepared ingredient's own per-unit cost is sum of raw / yield", () => {
    expect(ingredientCostPerCanonical(BANANA_CREAM, S.ingredients)).toBeCloseTo(PER_ML_BANANA_CREAM, 12);
  });

  it("prepared TOPPING: standard amount (30 ml from a recipe) x computed per-ml cost", () => {
    const c = customCostParts(spec(["hojicha"], ["bcream"]), S);
    expect(c.toppings).toBeCloseTo(30 * PER_ML_BANANA_CREAM, 10);
    expect(c.toppings).toBeGreaterThan(0.2); // $0.258, not $0
    expect(c.total).toBeCloseTo(c.tea + c.milk + c.toppings + c.packaging, 10);
  });

  it("prepared BASE: costed from its recipe and split evenly with another tea", () => {
    const alone = customCostParts(spec(["blend"]), S);
    expect(alone.tea).toBeCloseTo(6 * PER_G_BLEND, 10); // 6 g from the recipe that uses it
    const shared = customCostParts(spec(["blend", "hojicha"]), S);
    expect(shared.tea).toBeCloseTo((6 * PER_G_BLEND + 4 * 0.5) / 2, 10); // each at half
    expect(shared.milk).toBeCloseTo(alone.milk, 10); // milk stays one full amount
  });

  it("a raw price change flows through the prepared ingredient into the custom drink", () => {
    const before = customItemCost(spec(["hojicha"], ["bcream"]), S);
    const pricier = snap({}, S.ingredients.map((i) => (i.id === "cream" ? { ...i, packagePrice: 16 } : i))); // cream doubles
    const after = customItemCost(spec(["hojicha"], ["bcream"]), pricier);
    // 400 ml of cream per 500 ml batch, 30 ml used: 30 x (400 x 0.008 / 500)
    expect(after - before).toBeCloseTo(30 * ((400 * 0.008) / 500), 10);
  });

  it("scales with the event cup size like any component", () => {
    const full = customCostParts(spec(["hojicha"], ["bcream"]), S, 16).toppings;
    expect(customCostParts(spec(["hojicha"], ["bcream"]), S, 8).toppings).toBeCloseTo(full / 2, 10);
  });

  it("a milk-only drink with a prepared topping", () => {
    const c = customCostParts(spec([MILK_ONLY_ID], ["bcream"]), S);
    expect(c.tea).toBe(0);
    expect(c.toppings).toBeCloseTo(30 * PER_ML_BANANA_CREAM, 10);
  });
});

describe("base/topping roles and prepared ingredients", () => {
  const ids = (s: MenuSnapshot) => {
    const c = customComponents(s);
    return { bases: c.bases.map((b) => b.ingredient.id).sort(), toppings: c.toppings.map((t) => t.ingredient.id).sort() };
  };

  it("the dropdowns list a prepared ingredient flagged base or topping, with the raw ones", () => {
    expect(ids(snap())).toEqual({ bases: ["blend", "hojicha", "matcha"], toppings: ["bcream"] });
  });

  it("a prepared ingredient with no role is not offered, and the builder says which", () => {
    const noRole = snap({}, snap().ingredients.map((i) => (i.id === "bcream" ? { ...i, customRole: undefined } : i)));
    expect(ids(noRole).toppings).toEqual([]);
    expect(customComponents(noRole).unassignedPrepared.map((i) => i.name)).toContain("Banana cream");
  });

  it("role 'none' hides a prepared ingredient, and it is not reported as missing a role", () => {
    const none = snap({}, snap().ingredients.map((i) => (i.id === "bcream" ? { ...i, customRole: "none" as const } : i)));
    expect(ids(none).toppings).toEqual([]);
    expect(customComponents(none).unassignedPrepared.map((i) => i.id)).not.toContain("bcream");
  });

  it("a prepared ingredient cannot be listed inside another prepared ingredient's recipe, even a flagged one", () => {
    const patch = normalizeIngredientPatch(snap().ingredients, "blend", {
      subRecipe: [{ ingredientId: "bcream", amount: 1, unit: "ml" }, { ingredientId: "matcha", amount: 5, unit: "g" }],
    });
    expect(patch.subRecipe!.map((l) => l.ingredientId)).toEqual(["matcha"]);
  });
});

describe("packaging: an unflagged prepared ingredient most drinks use is not packaging", () => {
  it("raw packaging (cup, lid) is counted; the unflagged prepared syrup used by every drink is not", () => {
    const pack = packagingLines(snap()).map((p) => p.ingredient.id).sort();
    expect(pack).toEqual(["cup", "lid"]);
    const c = customCostParts(spec(["hojicha"]), snap());
    expect(c.packaging).toBeCloseTo(0.1 + 0.05, 10);
  });

  it("marked 'neither', the prepared syrup is a standard drink ingredient (like agave) and IS costed, not $0", () => {
    const neither = snap({}, snap().ingredients.map((i) => (i.id === "syrup" ? { ...i, customRole: "none" as const } : i)));
    expect(packagingLines(neither).map((p) => p.ingredient.id).sort()).toEqual(["cup", "lid", "syrup"]);
    // 10 ml of a syrup whose batch is 50g sugar ($0.10) per 100 ml -> $0.01
    expect(customCostParts(spec(["hojicha"]), neither).packaging).toBeCloseTo(0.1 + 0.05 + 10 * (0.1 / 100), 10);
  });

  it("a raw ingredient used by most drinks and never flagged is still packaging, as before", () => {
    expect(packagingLines(snap()).some((p) => p.ingredient.id === "cup")).toBe(true);
  });
});

describe("on an order (seed data): stamped from the recipe, kept after later price changes", () => {
  function setup() {
    let s: AppState = initialSeed();
    s = reducer(s, {
      type: "ADD_INGREDIENT",
      ing: {
        name: "Agave cream", packagePrice: 0, packageAmount: 200, unit: "ml", kind: "prepared", customRole: "topping",
        subRecipe: [{ ingredientId: "ing_agave", amount: 100, unit: "ml" }, { ingredientId: "ing_milk_whole", amount: 100, unit: "ml" }],
      },
    });
    const prep = s.ingredients.find((i) => i.name === "Agave cream")!;
    s = reducer(s, {
      type: "UPDATE_MENU_ITEM",
      id: "mi_classic",
      patch: { ingredientLines: [...s.menuItems.find((m) => m.id === "mi_classic")!.ingredientLines, { ingredientId: prep.id, amount: 20, unit: "ml" }] },
    });
    s = reducer(s, {
      type: "CREATE_EVENT",
      event: { name: "E", date: "2026-10-23", startTime: "11:00", endTime: "16:00", eventType: "standard", cupSizeOz: 16 },
    });
    return { s, prep };
  }
  const live = (s: AppState): MenuSnapshot => ({ id: "live", menuItems: s.menuItems, ingredients: s.ingredients, createdAt: "" });

  it("costSnap includes the prepared topping, and a later raw price change does not rewrite it", () => {
    const { s, prep } = setup();
    const id = customItemId({ baseIds: ["ing_hojicha"], toppingIds: [prep.id] });
    const line = deriveOrderItem({ menuItemId: id, quantity: 1 }, "o", live(s), 16);
    const perMl = (100 * (8.99 / 660) + 100 * (5.49 / 3785)) / 200;
    expect(line.costSnap).toBeCloseTo(customItemCost({ baseIds: ["ing_hojicha"], toppingIds: [prep.id] }, live(s), 16), 10);
    expect(customCostParts({ baseIds: ["ing_hojicha"], toppingIds: [prep.id] }, live(s), 16).toppings).toBeCloseTo(20 * perMl, 10);
    expect(line.priceSnap).toBe(6.9);

    const s2 = reducer(s, { type: "UPDATE_INGREDIENT", id: "ing_agave", patch: { packagePrice: 100 } });
    const fresh = deriveOrderItem({ menuItemId: id, quantity: 1 }, "o2", live(s2), 16);
    expect(fresh.costSnap).toBeGreaterThan(line.costSnap + 0.5); // new price flows up for a new order
    expect(line.costSnap).toBeCloseTo(customItemCost({ baseIds: ["ing_hojicha"], toppingIds: [prep.id] }, live(s), 16), 10); // stamped value unchanged
  });
});
