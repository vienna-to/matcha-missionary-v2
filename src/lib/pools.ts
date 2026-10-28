import type { Ingredient, MenuItem, Pool } from "./types";

/**
 * Milk and cream "pools". An ingredient is milk or cream ONLY when its `pool` field says so; nothing
 * else (not its name) decides. The pool is what fills a menu item's default / allowed milk and cream
 * lists, what the "Uses milk?" / "Uses cream?" boxes offer, what an order's milk or cream choice swaps
 * into a recipe line, and what the custom drink builder treats as its automatic milk. Ingredients typed
 * in by hand start with no pool, so they must be designated; the suggestions below look for obvious
 * candidates by name so existing ingredients can be marked in one click.
 */
export type PoolName = "milk" | "cream";

const NOT_MILK = /powder|condensed|chocolate|\btea\b|bubble|shake|magnesia/i;
const NOT_CREAM = /ice cream|cream cheese|sour cream|cream of|cheesecake|cream puff|creamsicle/i;

export function looksLikeMilk(name: string): boolean {
  return /\bmilk\b/i.test(name) && !NOT_MILK.test(name);
}

export function looksLikeCream(name: string): boolean {
  return /\bcream(er)?\b|half[- ]and[- ]half/i.test(name) && !NOT_CREAM.test(name);
}

/** Raw ingredients with no pool whose names look like milk or cream. Prepared ingredients are never pooled. */
export function suggestPools(ingredients: Ingredient[]): { milk: Ingredient[]; cream: Ingredient[] } {
  const open = ingredients.filter((i) => !i.pool && i.kind !== "prepared");
  return {
    milk: open.filter((i) => looksLikeMilk(i.name)),
    cream: open.filter((i) => !looksLikeMilk(i.name) && looksLikeCream(i.name)),
  };
}

export function inPool(ingredients: Ingredient[], pool: PoolName): Ingredient[] {
  return ingredients.filter((i) => i.pool === pool);
}

type ItemPatch = { id: string; patch: Partial<MenuItem> };

const FIELDS = {
  milk: { def: "defaultMilkId", allowed: "allowedMilkIds" },
  cream: { def: "defaultCreamId", allowed: "allowedCreamIds" },
} as const;

/**
 * The menu item changes that go with moving an ingredient between pools (to = milk / cream / null).
 *
 * Into a pool: a recipe line that points at a pool ingredient is swapped for the order's choice, or the
 * item's default, and a pool line with NO default adds nothing to the cost. So every item whose recipe
 * already uses this ingredient and has no default for that pool gets it as default and only allowed
 * choice: the swap then lands on the very same ingredient and the item costs exactly what it did. Items
 * that already have a default are left alone.
 *
 * Out of a pool: it can no longer be a default or an allowed choice anywhere, so it is removed from those
 * lists (the first remaining allowed choice, if any, becomes the default).
 */
export function poolChangePatches(items: MenuItem[], ingredient: Ingredient, to: Pool | undefined): ItemPatch[] {
  const from = ingredient.pool ?? null;
  const target = to ?? null;
  if (from === target) return [];
  const out: ItemPatch[] = [];
  for (const item of items) {
    const patch: Partial<MenuItem> = {};
    if (from) {
      const f = FIELDS[from];
      const allowed = item[f.allowed];
      if (allowed.includes(ingredient.id) || item[f.def] === ingredient.id) {
        const rest = allowed.filter((id) => id !== ingredient.id);
        patch[f.allowed] = rest;
        if (item[f.def] === ingredient.id) patch[f.def] = rest[0];
      }
    }
    if (target && item.ingredientLines.some((l) => l.ingredientId === ingredient.id)) {
      const f = FIELDS[target];
      if (!item[f.def]) {
        patch[f.def] = ingredient.id;
        patch[f.allowed] = [...new Set([...item[f.allowed], ingredient.id])];
      }
    }
    if (Object.keys(patch).length > 0) out.push({ id: item.id, patch });
  }
  return out;
}
