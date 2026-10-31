import { describe, expect, it } from "vitest";
import { defaultItemCost } from "@/lib/calc";
import { looksLikeMilk, milkLineMissing, offersMilk, poolChangePatches, suggestPools } from "@/lib/pools";
import { reducer } from "@/lib/reducer";
import { initialSeed } from "@/lib/seed";
import type { AppState, Ingredient, MenuItem } from "@/lib/types";

/** The user's case: milks and creams typed in by hand, so they have no pool. */
function handMade(): AppState {
  const s = initialSeed();
  const names: Record<string, string> = {
    ing_milk_whole: "whole milk",
    ing_milk_lactose: "Lactose-free milk",
    ing_cream_plain: "heavy cream",
  };
  return {
    ...s,
    ingredients: s.ingredients.map((i) => ({
      ...i,
      name: names[i.id] ?? i.name,
      pool: i.id in names ? null : i.pool,
    })),
    // their drinks have no milk / cream choices set up (the boxes could not be ticked)
    menuItems: s.menuItems.map((m) => ({ ...m, defaultMilkId: undefined, allowedMilkIds: [] })),
  };
}

const apply = (s: AppState, ing: Ingredient, to: "milk" | null): AppState => {
  const patches = poolChangePatches(s.menuItems, ing, to);
  let t = reducer(s, { type: "UPDATE_INGREDIENT", id: ing.id, patch: { pool: to } });
  for (const p of patches) t = reducer(t, { type: "UPDATE_MENU_ITEM", id: p.id, patch: p.patch });
  return t;
};

describe("name suggestions", () => {
  it("milk by name, but not things that merely contain the word", () => {
    for (const n of ["whole milk", "Lactose-free milk", "Oat Milk", "Coconut milk"]) expect(looksLikeMilk(n), n).toBe(true);
    for (const n of ["Milk tea powder", "Condensed milk", "Milk chocolate", "Matcha powder", "Ice"]) expect(looksLikeMilk(n), n).toBe(false);
  });

  it("suggests only raw ingredients that have no pool yet", () => {
    const s = handMade();
    const { milk } = suggestPools(s.ingredients);
    expect(milk.map((i) => i.name).sort()).toEqual(["Lactose-free milk", "whole milk"]);
    // cream is never suggested: it is a recipe ingredient, not a choice
    expect(suggestPools(s.ingredients)).not.toHaveProperty("cream");
    // already pooled seed ingredients (Oat milk...) are not suggested again
    expect(milk.some((i) => i.name === "Oat milk")).toBe(false);
    const prepared: Ingredient = { ...s.ingredients[0], id: "p", name: "House milk", pool: null, kind: "prepared", subRecipe: [] };
    expect(suggestPools([prepared]).milk).toEqual([]);
  });
});

describe("the user's case: hand-made milks have no pool", () => {
  it("nothing is offered for 'Uses milk?' until they are designated, then they are", () => {
    const s = handMade();
    expect(s.ingredients.filter((i) => i.pool === "milk").map((i) => i.name)).toEqual(["Oat milk", "Almond milk"]);
    const whole = s.ingredients.find((i) => i.name === "whole milk")!;
    const t = apply(s, whole, "milk");
    expect(t.ingredients.filter((i) => i.pool === "milk").map((i) => i.name)).toContain("whole milk");
  });

  it("a user with no pooled milk at all gets a populated list after designating theirs", () => {
    const s = handMade();
    const stripped = { ...s, ingredients: s.ingredients.map((i) => ({ ...i, pool: null })) };
    expect(stripped.ingredients.filter((i) => i.pool === "milk")).toEqual([]);
    let t: AppState = stripped;
    for (const i of suggestPools(stripped.ingredients).milk) t = apply(t, t.ingredients.find((x) => x.id === i.id)!, "milk");
    const milks = t.ingredients.filter((i) => i.pool === "milk").map((i) => i.name);
    expect(milks).toEqual(expect.arrayContaining(["whole milk", "Lactose-free milk", "Oat milk", "Almond milk"]));
  });
});

describe("designating an ingredient never changes what an item costs", () => {
  it("recipes that already use it keep their cost: the item gets it as its default milk", () => {
    const s = handMade();
    const whole = s.ingredients.find((i) => i.name === "whole milk")!;
    const users = s.menuItems.filter((m) => m.ingredientLines.some((l) => l.ingredientId === whole.id));
    expect(users.length).toBeGreaterThan(0);
    const before = new Map(users.map((m) => [m.id, defaultItemCost(m, s.ingredients)]));
    expect(before.get(users[0].id)).toBeGreaterThan(0);

    // without the companion change the milk line would drop out of the cost (a pool line with no default)
    const bare = reducer(s, { type: "UPDATE_INGREDIENT", id: whole.id, patch: { pool: "milk" } });
    const dropped = bare.menuItems.find((m) => m.id === users[0].id)!;
    expect(defaultItemCost(dropped, bare.ingredients)).toBeLessThan(before.get(users[0].id)!);

    const t = apply(s, whole, "milk");
    for (const u of users) {
      const after = t.menuItems.find((m) => m.id === u.id)!;
      expect(after.defaultMilkId).toBe(whole.id);
      expect(after.allowedMilkIds).toContain(whole.id);
      expect(defaultItemCost(after, t.ingredients)).toBeCloseTo(before.get(u.id)!, 10);
    }
  });

  it("an item that already has a default milk keeps it; items that do not use the ingredient are untouched", () => {
    const s = handMade();
    const whole = s.ingredients.find((i) => i.name === "whole milk")!;
    const users = s.menuItems.filter((m) => m.ingredientLines.some((l) => l.ingredientId === whole.id));
    const withDefault: AppState = {
      ...s,
      menuItems: s.menuItems.map((m) => (m.id === users[0].id ? { ...m, defaultMilkId: "ing_milk_oat", allowedMilkIds: ["ing_milk_oat"] } : m)),
    };
    const patches = poolChangePatches(withDefault.menuItems, whole, "milk");
    expect(patches.find((p) => p.id === users[0].id)).toBeUndefined();
    for (const p of patches) expect(users.some((u) => u.id === p.id)).toBe(true);
  });

  it("cream lines cost the cream they name, whatever the item's retired cream fields say", () => {
    const s = initialSeed();
    const ube = s.menuItems.find((m) => m.id === "mi_ube")!;
    const plain = defaultItemCost(ube, s.ingredients);
    // retired fields left behind on old items, pointing somewhere else, or nowhere
    const odd = { ...ube, defaultCreamId: "ing_cream_banana", allowedCreamIds: ["ing_cream_banana"] };
    expect(defaultItemCost(odd, s.ingredients)).toBeCloseTo(plain, 10);
    expect(defaultItemCost({ ...ube, defaultCreamId: undefined, allowedCreamIds: [] }, s.ingredients)).toBeCloseTo(plain, 10);
    expect(plain).toBeGreaterThan(0);
  });
});

describe("taking an ingredient out of a pool", () => {
  it("removes it from every default and allowed list, handing the default to the next allowed choice", () => {
    const s = initialSeed();
    const oat = s.ingredients.find((i) => i.id === "ing_milk_oat")!;
    const item: MenuItem = { ...s.menuItems[0], defaultMilkId: "ing_milk_oat", allowedMilkIds: ["ing_milk_oat", "ing_milk_whole"] };
    const patches = poolChangePatches([item], oat, null);
    expect(patches).toEqual([{ id: item.id, patch: { allowedMilkIds: ["ing_milk_whole"], defaultMilkId: "ing_milk_whole" } }]);
    const last: MenuItem = { ...item, allowedMilkIds: ["ing_milk_oat"] };
    expect(poolChangePatches([last], oat, null)[0].patch).toEqual({ allowedMilkIds: [], defaultMilkId: undefined });
  });

  it("no change, no patches", () => {
    const s = initialSeed();
    const oat = s.ingredients.find((i) => i.id === "ing_milk_oat")!;
    expect(poolChangePatches(s.menuItems, oat, "milk")).toEqual([]);
  });
});

describe("milk line warning: milk is offered but nothing in the recipe is milk", () => {
  const seed = initialSeed();
  const latte = seed.menuItems.find((m) => m.ingredientLines.some((l) => seed.ingredients.find((i) => i.id === l.ingredientId)?.pool === "milk"))!;

  it("a drink with a milk line is fine", () => {
    expect(offersMilk(latte)).toBe(true);
    expect(milkLineMissing(latte, seed.ingredients)).toBe(false);
  });

  it("the user's case: default milk + allowed milks, recipe without a milk line", () => {
    const bare: MenuItem = {
      ...latte,
      ingredientLines: latte.ingredientLines.filter((l) => seed.ingredients.find((i) => i.id === l.ingredientId)?.pool !== "milk"),
    };
    expect(bare.ingredientLines.length).toBeGreaterThan(0);
    expect(milkLineMissing(bare, seed.ingredients)).toBe(true);
    // and that really is $0 of milk: the cost does not move with the default
    const withoutMilk = defaultItemCost(bare, seed.ingredients);
    expect(withoutMilk).toBeLessThan(defaultItemCost(latte, seed.ingredients));
    expect(defaultItemCost({ ...bare, defaultMilkId: "ing_milk_oat" }, seed.ingredients)).toBeCloseTo(withoutMilk, 10);
  });

  it("allowed milks alone (no default) also count as offering milk", () => {
    const bare: MenuItem = { ...latte, defaultMilkId: undefined, allowedMilkIds: ["ing_milk_whole"], ingredientLines: [] };
    expect(milkLineMissing(bare, seed.ingredients)).toBe(true);
  });

  it("no warning when milk is not offered, or for a pastry-like item with no milk set up", () => {
    expect(milkLineMissing({ ...latte, defaultMilkId: undefined, allowedMilkIds: [], ingredientLines: [] }, seed.ingredients)).toBe(false);
  });

  it("a line pointing at an ingredient that is not marked as milk does not count", () => {
    const ingredients = seed.ingredients.map((i) => (i.id === "ing_milk_whole" ? { ...i, pool: null } : i));
    const onlyWhole: MenuItem = {
      ...latte,
      defaultMilkId: "ing_milk_oat",
      allowedMilkIds: ["ing_milk_oat"],
      ingredientLines: latte.ingredientLines.filter((l) => l.ingredientId === "ing_milk_whole"),
    };
    expect(onlyWhole.ingredientLines.length).toBe(1);
    expect(milkLineMissing(onlyWhole, ingredients)).toBe(true);
  });
});
