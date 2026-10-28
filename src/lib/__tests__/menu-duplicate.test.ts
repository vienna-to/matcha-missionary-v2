import { describe, expect, it } from "vitest";
import { defaultItemCost } from "@/lib/calc";
import { copyName, duplicateMenuItem } from "@/lib/menu-duplicate";
import { reducer } from "@/lib/reducer";
import { initialSeed } from "@/lib/seed";
import { toMenuItemInsert } from "@/lib/supabase/serialize";
import type { AppState, MenuItem } from "@/lib/types";

const seed = (): AppState => initialSeed();
const find = (s: AppState, name: string) => s.menuItems.find((m) => m.name === name)!;

/** Duplicate through the same action the Menu Manager button dispatches. */
function duplicate(s: AppState, name: string): { next: AppState; original: MenuItem; copy: MenuItem } {
  const original = find(s, name);
  const next = reducer(s, {
    type: "ADD_MENU_ITEM",
    item: duplicateMenuItem(original, s.menuItems.map((m) => m.name)),
  });
  const copy = next.menuItems.find((m) => m.name === `${name} (copy)`)!;
  return { next, original, copy };
}

describe("duplicating a menu item", () => {
  it("copies the whole item: recipe lines and amounts, price, size, category, tax, milk and cream settings", () => {
    const { original, copy } = duplicate(seed(), "Classic Matcha");
    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe("Classic Matcha (copy)");
    expect(copy.ingredientLines).toEqual(original.ingredientLines);
    expect(copy.ingredientLines.length).toBeGreaterThan(0);
    for (const k of ["price", "size", "category", "description", "taxable", "defaultMilkId", "defaultCreamId"] as const) {
      expect(copy[k], k).toEqual(original[k]);
    }
    expect(copy.allowedMilkIds).toEqual(original.allowedMilkIds);
    expect(copy.allowedCreamIds).toEqual(original.allowedCreamIds);
    expect(copy.active).toBe(true);
  });

  it("costs exactly like the original until it is edited", () => {
    const s = seed();
    const { next, original, copy } = duplicate(s, "Hojicha Latte");
    expect(defaultItemCost(copy, next.ingredients)).toBe(defaultItemCost(original, next.ingredients));
  });

  it("is independent: editing the copy never changes the original, and the other way round", () => {
    const { next, original, copy } = duplicate(seed(), "Classic Matcha");
    const snapshotOfOriginal = JSON.parse(JSON.stringify(original));
    const snapshotOfCopy = JSON.parse(JSON.stringify(copy));

    // edit the copy: price, a recipe line's amount, an added line, milk settings
    const lines = copy.ingredientLines.map((l, i) => (i === 0 ? { ...l, amount: l.amount * 3 } : l));
    const extra = original.ingredientLines[0];
    const edited = reducer(next, {
      type: "UPDATE_MENU_ITEM",
      id: copy.id,
      patch: { price: copy.price + 4, ingredientLines: [...lines, { ...extra, amount: 1 }], allowedMilkIds: [], defaultMilkId: undefined },
    });
    expect(find(edited, "Classic Matcha")).toEqual(expect.objectContaining(snapshotOfOriginal));
    expect(find(edited, "Classic Matcha").updatedAt).toBe(original.updatedAt);

    // and the other way
    const editedOriginal = reducer(next, { type: "UPDATE_MENU_ITEM", id: original.id, patch: { price: original.price + 9, name: "Renamed" } });
    const stillCopy = editedOriginal.menuItems.find((m) => m.id === copy.id)!;
    expect(stillCopy.price).toBe(snapshotOfCopy.price);
    expect(stillCopy.name).toBe("Classic Matcha (copy)");
  });

  it("shares no objects with the original (no aliasing of lines or id lists)", () => {
    const original = find(seed(), "Classic Matcha");
    const dup = duplicateMenuItem(original, []);
    expect(dup.ingredientLines).not.toBe(original.ingredientLines);
    dup.ingredientLines.forEach((l, i) => expect(l).not.toBe(original.ingredientLines[i]));
    expect(dup.allowedMilkIds).not.toBe(original.allowedMilkIds);
    expect(dup.allowedCreamIds).not.toBe(original.allowedCreamIds);
    dup.ingredientLines[0].amount = 12345;
    expect(original.ingredientLines[0].amount).not.toBe(12345);
  });

  it("an item without milk or cream (a pastry) duplicates without them", () => {
    const { copy, original } = duplicate(seed(), "Matcha Cheesecake");
    expect(copy.defaultMilkId).toBeUndefined();
    expect(copy.allowedMilkIds).toEqual(original.allowedMilkIds);
  });

  it("is stored with the existing columns only (no migration)", () => {
    const { copy } = duplicate(seed(), "Classic Matcha");
    const row = toMenuItemInsert("w", copy);
    const original = toMenuItemInsert("w", find(seed(), "Classic Matcha"));
    expect(Object.keys(row).sort()).toEqual(Object.keys(original).sort());
    expect(row.ingredient_lines).toEqual(original.ingredient_lines);
  });
});

describe("copyName", () => {
  it("adds (copy), then numbers further copies, and does not stack suffixes", () => {
    expect(copyName("Latte", ["Latte"])).toBe("Latte (copy)");
    expect(copyName("Latte", ["Latte", "Latte (copy)"])).toBe("Latte (copy 2)");
    expect(copyName("Latte", ["Latte", "Latte (copy)", "Latte (copy 2)"])).toBe("Latte (copy 3)");
    expect(copyName("Latte (copy)", ["Latte", "Latte (copy)"])).toBe("Latte (copy 2)");
    expect(copyName("Latte (copy 2)", ["Latte", "Latte (copy)", "Latte (copy 2)"])).toBe("Latte (copy 3)");
  });
  it("ignores case and spacing when checking for a clash", () => {
    expect(copyName("Latte", ["latte (COPY) "])).toBe("Latte (copy 2)");
  });
});
