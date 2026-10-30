import type { Ingredient, MenuItem, Pool } from "./types";

/**
 * The milk "pool". An ingredient is a milk ONLY when its `pool` field says so; nothing else (not its
 * name) decides. The pool is what fills a menu item's default / allowed milk lists, what the "Uses milk?"
 * box offers, what an order's milk choice swaps into a recipe line, and what the custom drink builder
 * treats as its automatic milk. Ingredients typed in by hand start with no pool, so they must be
 * designated; the suggestion below looks for obvious candidates by name so existing ingredients can be
 * marked in one click.
 *
 * Cream is NOT chosen by anyone any more: it is just a recipe ingredient and costs as the line says. The
 * stored value 'cream' (and the retired default / allowed cream fields on menu items, and the cream
 * choice on past orders) is left as data; the custom drink builder still reads `pool === "cream"`
 * to decide an unset-role ingredient is a topping and to borrow a topping's usual amount.
 */
export type PoolName = "milk" | "cream";

const NOT_MILK = /powder|condensed|chocolate|\btea\b|bubble|shake|magnesia/i;

export function looksLikeMilk(name: string): boolean {
  return /\bmilk\b/i.test(name) && !NOT_MILK.test(name);
}

/** Raw ingredients with no pool whose names look like milk. Prepared ingredients are never pooled. */
export function suggestPools(ingredients: Ingredient[]): { milk: Ingredient[] } {
  return { milk: ingredients.filter((i) => !i.pool && i.kind !== "prepared" && looksLikeMilk(i.name)) };
}

export function inPool(ingredients: Ingredient[], pool: PoolName): Ingredient[] {
  return ingredients.filter((i) => i.pool === pool);
}

type ItemPatch = { id: string; patch: Partial<MenuItem> };

/**
 * The menu item changes that go with marking an ingredient as milk, or un-marking it (to = milk / null).
 *
 * Into the pool: a recipe line that points at a milk ingredient is swapped for the order's choice, or the
 * item's default, and a milk line with NO default adds nothing to the cost. So every item whose recipe
 * already uses this ingredient and has no default milk gets it as default and only allowed choice: the
 * swap then lands on the very same ingredient and the item costs exactly what it did. Items that already
 * have a default are left alone.
 *
 * Out of the pool: it can no longer be a default or an allowed choice anywhere, so it is removed from
 * those lists (the first remaining allowed choice, if any, becomes the default). Moving a legacy cream
 * changes nothing on menu items: cream lists are retired data.
 */
export function poolChangePatches(items: MenuItem[], ingredient: Ingredient, to: Pool | undefined): ItemPatch[] {
  const from = ingredient.pool ?? null;
  const target = to ?? null;
  if (from === target) return [];
  const out: ItemPatch[] = [];
  for (const item of items) {
    const patch: Partial<MenuItem> = {};
    if (from === "milk") {
      if (item.allowedMilkIds.includes(ingredient.id) || item.defaultMilkId === ingredient.id) {
        const rest = item.allowedMilkIds.filter((id) => id !== ingredient.id);
        patch.allowedMilkIds = rest;
        if (item.defaultMilkId === ingredient.id) patch.defaultMilkId = rest[0];
      }
    }
    if (target === "milk" && item.ingredientLines.some((l) => l.ingredientId === ingredient.id)) {
      if (!item.defaultMilkId) {
        patch.defaultMilkId = ingredient.id;
        patch.allowedMilkIds = [...new Set([...item.allowedMilkIds, ingredient.id])];
      }
    }
    if (Object.keys(patch).length > 0) out.push({ id: item.id, patch });
  }
  return out;
}
