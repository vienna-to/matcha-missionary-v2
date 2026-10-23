import { lineCost } from "./calc";
import {
  CUSTOM_ID_PREFIX,
  CUSTOM_BASE_PRICE,
  CUSTOM_TOPPING_PRICE,
  MILK_ONLY_ID,
  comboUnitPrice,
  customItemId,
  customItemPrice,
  customUnitPrice,
  isCustomItemId,
  parseCustomItemId,
  type CustomSpec,
} from "./custom-id";
import { sameCategory } from "./units";
import {
  REFERENCE_CUP_OZ,
  compareMenuItems,
  type Ingredient,
  type IngredientLine,
  type MenuItem,
  type MenuSnapshot,
} from "./types";

export {
  CUSTOM_ID_PREFIX,
  CUSTOM_BASE_PRICE,
  CUSTOM_TOPPING_PRICE,
  MILK_ONLY_ID,
  comboUnitPrice,
  customItemId,
  customItemPrice,
  customUnitPrice,
  isCustomItemId,
  parseCustomItemId,
  type CustomSpec,
};

/**
 * Custom / off-menu drinks: a drink built from existing ingredients instead of
 * picked from the menu. See custom-id.ts for how a selection is stored.
 *
 * Price: flat CUSTOM_BASE_PRICE + CUSTOM_TOPPING_PRICE per topping; bases do
 * not affect price.
 *
 * Cost = tea + milk + toppings + packaging, every amount taken from recipes
 * the menu already has (nothing is hardcoded), so it follows ingredient price
 * changes and is comparable to a menu drink:
 *  - Tea: the standard amount of each selected tea, split evenly when more
 *    than one is picked (2 teas = half each, 3 = a third each).
 *  - Milk: one standard milk amount, always full whatever the number of teas.
 *    "Milk only" is the base for a drink with no tea.
 *  - Toppings: the standard amount of each.
 *  - Packaging: the non-component ingredients most drinks use (cup, lid, straw,
 *    ice, agave).
 */

export type ComponentKind = "base" | "topping";

// Used only for an ingredient whose role was never set (Ingredient.customRole
// undefined, for example before the role column exists): a guess from the name.
// Once a role is set in Menu Manager, the role wins.
const BASE_NAME = /\b(matcha|hojicha|tea|earl grey|genmaicha|sencha|chai)\b/i;
const TOPPING_NAME = /pur[eé]e/i;

/** Milk is never a picked component: it is added automatically (or is the
 *  "milk only" base). */
export function componentKind(ing: Ingredient): ComponentKind | null {
  if (ing.pool === "milk") return null;
  if (ing.customRole) return ing.customRole === "none" ? null : ing.customRole;
  if (ing.pool === "cream" || TOPPING_NAME.test(ing.name)) return "topping";
  if (BASE_NAME.test(ing.name)) return "base";
  return null;
}

const isPastryItem = (m: MenuItem) => m.category === "pastry" || m.size === "pastry_count";

/** Non-pastry drinks, active first then menu order: the order in which a
 *  recipe is allowed to decide a "standard" amount. */
function orderedDrinks(snapshot: MenuSnapshot): MenuItem[] {
  return snapshot.menuItems
    .filter((m) => !isPastryItem(m))
    .sort((a, b) => Number(b.active) - Number(a.active) || compareMenuItems(a, b));
}

/**
 * The standard amount of an ingredient: the amount a menu drink's recipe
 * already uses for it. The first drink that lists the ingredient decides. A
 * pooled ingredient (any cream) falls back to its pool's amount. Null when no
 * drink recipe uses it, so it cannot be costed and is not offered.
 */
export function standardLine(ing: Ingredient, snapshot: MenuSnapshot): IngredientLine | null {
  const byId = new Map(snapshot.ingredients.map((i) => [i.id, i]));
  const drinks = orderedDrinks(snapshot);
  for (const m of drinks) {
    const direct = m.ingredientLines.find((l) => l.ingredientId === ing.id);
    if (direct) return direct;
  }
  if (ing.pool) {
    for (const m of drinks) {
      const pooled = m.ingredientLines.find((l) => byId.get(l.ingredientId)?.pool === ing.pool);
      if (pooled) return pooled;
    }
  }
  return null;
}

/** The milk every tea drink gets: the milk line of the first drink that has
 *  one (its default milk, at that recipe's amount). */
export function standardMilk(
  snapshot: MenuSnapshot,
): { ingredient: Ingredient; line: IngredientLine } | null {
  const byId = new Map(snapshot.ingredients.map((i) => [i.id, i]));
  for (const m of orderedDrinks(snapshot)) {
    const line = m.ingredientLines.find((l) => byId.get(l.ingredientId)?.pool === "milk");
    if (!line) continue;
    const ingredient = (m.defaultMilkId ? byId.get(m.defaultMilkId) : undefined) ?? byId.get(line.ingredientId);
    if (ingredient && sameCategory(line.unit, ingredient.unit)) return { ingredient, line };
  }
  return null;
}

/**
 * Packaging: ingredients that are not a tea, milk, cream or topping and that
 * most (more than half) of the active drinks use. Each is taken at the amount
 * of the first drink that lists it. Read from the recipes, so it follows menu
 * and ingredient changes; with the seed menu it is cup, lid, straw, ice and
 * agave (a one-off ingredient like the chocolate spread is used by too few).
 */
export function packagingLines(
  snapshot: MenuSnapshot,
): Array<{ ingredient: Ingredient; line: IngredientLine }> {
  const byId = new Map(snapshot.ingredients.map((i) => [i.id, i]));
  const all = orderedDrinks(snapshot);
  const drinks = all.some((m) => m.active) ? all.filter((m) => m.active) : all;
  if (drinks.length === 0) return [];
  const out: Array<{ ingredient: Ingredient; line: IngredientLine }> = [];
  const seen = new Set<string>();
  for (const m of drinks) {
    for (const line of m.ingredientLines) {
      if (seen.has(line.ingredientId)) continue;
      seen.add(line.ingredientId);
      const ingredient = byId.get(line.ingredientId);
      if (!ingredient || ingredient.pool || componentKind(ingredient)) continue;
      if (!sameCategory(line.unit, ingredient.unit)) continue;
      const users = drinks.filter((d) => d.ingredientLines.some((l) => l.ingredientId === ingredient.id)).length;
      if (users * 2 > drinks.length) out.push({ ingredient, line });
    }
  }
  return out;
}

export type CustomComponent = {
  ingredient: Ingredient;
  kind: ComponentKind;
  /** The standard recipe amount this component is costed at. */
  line: IngredientLine;
};

/** Every tea (base) and topping the builder can offer, sorted by name. Only
 *  ingredients whose role is base / topping (or guessed, when never set) and
 *  that a drink recipe uses appear. */
export function customComponents(snapshot: MenuSnapshot): {
  bases: CustomComponent[];
  toppings: CustomComponent[];
  /** The milk added to every tea drink, or the "milk only" base; null when no recipe has milk. */
  milk: { ingredient: Ingredient; line: IngredientLine } | null;
} {
  const bases: CustomComponent[] = [];
  const toppings: CustomComponent[] = [];
  for (const ingredient of snapshot.ingredients) {
    const kind = componentKind(ingredient);
    if (!kind) continue;
    const line = standardLine(ingredient, snapshot);
    if (!line || !sameCategory(line.unit, ingredient.unit)) continue;
    (kind === "base" ? bases : toppings).push({ ingredient, kind, line });
  }
  const byName = (a: CustomComponent, b: CustomComponent) =>
    a.ingredient.name.localeCompare(b.ingredient.name);
  return { bases: bases.sort(byName), toppings: toppings.sort(byName), milk: standardMilk(snapshot) };
}

/** Recipes are authored at REFERENCE_CUP_OZ; a per-event cup size scales every
 *  line, exactly as computeItemCost does for a menu drink. */
function scaledCost(line: IngredientLine, ing: Ingredient, cupSizeOz?: number, share = 1): number {
  const scale = cupSizeOz !== undefined ? cupSizeOz / REFERENCE_CUP_OZ : 1;
  const v = lineCost({ ...line, amount: line.amount * scale * share }, ing);
  return Number.isFinite(v) ? v : 0;
}

export type CustomCost = { tea: number; milk: number; toppings: number; packaging: number; total: number };

/** Cost of a custom drink, split by part. `milkChoiceId` swaps the milk the way
 *  a menu drink's milk choice does. */
export function customCostParts(
  spec: CustomSpec,
  snapshot: MenuSnapshot,
  cupSizeOz?: number,
  milkChoiceId?: string,
): CustomCost {
  const { bases, toppings, milk } = customComponents(snapshot);
  const teas = bases.filter((c) => spec.baseIds.includes(c.ingredient.id));
  const tops = toppings.filter((c) => spec.toppingIds.includes(c.ingredient.id));
  // Several teas split the tea amount evenly; milk is one full amount.
  const tea = teas.reduce((s, c) => s + scaledCost(c.line, c.ingredient, cupSizeOz, 1 / teas.length), 0);
  const chosenMilk = milkChoiceId
    ? snapshot.ingredients.find((i) => i.id === milkChoiceId && i.pool === "milk")
    : undefined;
  const milkCost = milk
    ? scaledCost(milk.line, chosenMilk && sameCategory(milk.line.unit, chosenMilk.unit) ? chosenMilk : milk.ingredient, cupSizeOz)
    : 0;
  const toppingCost = tops.reduce((s, c) => s + scaledCost(c.line, c.ingredient, cupSizeOz), 0);
  const packaging = packagingLines(snapshot).reduce(
    (s, p) => s + scaledCost(p.line, p.ingredient, cupSizeOz),
    0,
  );
  return { tea, milk: milkCost, toppings: toppingCost, packaging, total: tea + milkCost + toppingCost + packaging };
}

export function customItemCost(
  spec: CustomSpec,
  snapshot: MenuSnapshot,
  cupSizeOz?: number,
  milkChoiceId?: string,
): number {
  return customCostParts(spec, snapshot, cupSizeOz, milkChoiceId).total;
}

/** "Custom: Hojicha powder + Banana cream"; "Custom: Milk + Banana cream" for milk only. */
export function customItemName(spec: CustomSpec, snapshot: MenuSnapshot): string {
  const { bases, toppings } = customComponents(snapshot);
  const teas = bases.filter((c) => spec.baseIds.includes(c.ingredient.id)).map((c) => c.ingredient.name);
  const base = teas.length > 0 ? teas : spec.baseIds.includes(MILK_ONLY_ID) ? ["Milk"] : [];
  const tops = toppings.filter((c) => spec.toppingIds.includes(c.ingredient.id)).map((c) => c.ingredient.name);
  const names = [...base, ...tops];
  return names.length > 0 ? `Custom: ${names.join(" + ")}` : "Custom drink";
}

/** At least one base is required (a tea, or "milk only"); toppings are optional. */
export function isValidCustomSpec(spec: CustomSpec): boolean {
  return spec.baseIds.length >= 1;
}

/**
 * The menu item a custom id stands for, so every place that looks an item up
 * by id (price, name, adjustments) works unchanged. Not in the menu; never
 * stored. Its ingredientLines are empty: the cost comes from customItemCost.
 * It carries the standard milk as its default so the milk choice works like a
 * menu drink's.
 */
export function customMenuItem(id: string, snapshot: MenuSnapshot): MenuItem | undefined {
  const spec = parseCustomItemId(id);
  if (!spec) return undefined;
  return {
    id,
    name: customItemName(spec, snapshot),
    category: "other",
    price: customItemPrice(spec.toppingIds.length),
    size: "other",
    active: true,
    ingredientLines: [],
    defaultMilkId: standardMilk(snapshot)?.ingredient.id,
    allowedMilkIds: snapshot.ingredients.filter((i) => i.pool === "milk").map((i) => i.id),
    allowedCreamIds: [],
    createdAt: "",
    updatedAt: "",
  };
}

/** `snapshot.menuItems.find` that also resolves custom ids. */
export function findMenuItem(snapshot: MenuSnapshot, id: string | undefined): MenuItem | undefined {
  if (!id) return undefined;
  return snapshot.menuItems.find((m) => m.id === id) ?? customMenuItem(id, snapshot);
}
