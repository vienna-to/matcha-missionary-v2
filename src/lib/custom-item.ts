import { lineCost } from "./calc";
import { sameCategory } from "./units";
import {
  REFERENCE_CUP_OZ,
  compareMenuItems,
  type Ingredient,
  type IngredientLine,
  type MenuItem,
  type MenuSnapshot,
} from "./types";

/**
 * Custom / off-menu drinks: a drink built from existing ingredients (bases and
 * toppings) instead of picked from the menu.
 *
 * Nothing new is stored. A custom line is an ordinary order line whose
 * menuItemId encodes what was picked ("custom:<baseIds>|<toppingIds>"), so the
 * barista card, order total, revenue, cost, profit, margin and cups poured all
 * work through the same fields a menu item uses. Price and cost are stamped on
 * the line at order time (priceSnap / costSnap), so later ingredient price
 * changes never rewrite a past custom order.
 *
 * Price: flat CUSTOM_BASE_PRICE + CUSTOM_TOPPING_PRICE per topping. Bases do
 * not affect price.
 * Cost: the existing recipe cost of every selected component, each at the
 * standard amount a menu drink already uses for it (see standardLine).
 */
export const CUSTOM_ID_PREFIX = "custom:";
export const CUSTOM_BASE_PRICE = 6.7;
export const CUSTOM_TOPPING_PRICE = 0.2;

export type CustomSpec = { baseIds: string[]; toppingIds: string[] };
export type ComponentKind = "base" | "topping";

export function isCustomItemId(id: string | undefined): boolean {
  return Boolean(id?.startsWith(CUSTOM_ID_PREFIX));
}

const uniqSorted = (ids: string[]) => [...new Set(ids)].sort();

/** Canonical id for a selection (order and duplicates do not matter). */
export function customItemId(spec: CustomSpec): string {
  return `${CUSTOM_ID_PREFIX}${uniqSorted(spec.baseIds).join(",")}|${uniqSorted(spec.toppingIds).join(",")}`;
}

export function parseCustomItemId(id: string): CustomSpec | null {
  if (!isCustomItemId(id)) return null;
  const [bases = "", toppings = ""] = id.slice(CUSTOM_ID_PREFIX.length).split("|");
  const split = (s: string) => s.split(",").filter(Boolean);
  return { baseIds: split(bases), toppingIds: split(toppings) };
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** 6.70 flat + 0.20 per topping. */
export function customItemPrice(toppingCount: number): number {
  return cents(CUSTOM_BASE_PRICE + CUSTOM_TOPPING_PRICE * Math.max(0, toppingCount));
}

// ---------------------------------------------------------------------------
// Which existing ingredients are bases / toppings
// ---------------------------------------------------------------------------

// Ingredients carry no "base" or "topping" flag, so this reads what the data
// already says: the milk pool is bases, the cream pool is toppings, and the
// rest are told apart by name (teas and water are bases, purées are toppings).
const BASE_NAME = /\b(matcha|hojicha|tea|earl grey|genmaicha|sencha|chai|water)\b/i;
const TOPPING_NAME = /pur[eé]e/i;

export function componentKind(ing: Ingredient): ComponentKind | null {
  if (ing.pool === "milk") return "base";
  if (ing.pool === "cream") return "topping";
  if (TOPPING_NAME.test(ing.name)) return "topping";
  if (BASE_NAME.test(ing.name)) return "base";
  return null;
}

const isPastryItem = (m: MenuItem) => m.category === "pastry" || m.size === "pastry_count";

/**
 * The standard amount of an ingredient: the amount a menu drink's recipe
 * already uses for it. The first drink (active first, then menu order) that
 * lists the ingredient decides. A pooled ingredient (any milk, any cream) uses
 * the amount of its pool's line, since a recipe's milk line is "the milk",
 * whichever milk is chosen. Null when no drink recipe uses it, so it cannot be
 * costed and is not offered.
 */
export function standardLine(ing: Ingredient, snapshot: MenuSnapshot): IngredientLine | null {
  const byId = new Map(snapshot.ingredients.map((i) => [i.id, i]));
  const drinks = snapshot.menuItems
    .filter((m) => !isPastryItem(m))
    .sort((a, b) => Number(b.active) - Number(a.active) || compareMenuItems(a, b));
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

export type CustomComponent = {
  ingredient: Ingredient;
  kind: ComponentKind;
  /** The standard recipe amount this component is costed at. */
  line: IngredientLine;
};

/** Every base and topping the builder can offer, sorted by name. */
export function customComponents(snapshot: MenuSnapshot): {
  bases: CustomComponent[];
  toppings: CustomComponent[];
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
  return { bases: bases.sort(byName), toppings: toppings.sort(byName) };
}

/** Cost of one component at its standard amount. `cupSizeOz` scales it the way
 *  a menu drink's recipe is scaled (recipes are authored at REFERENCE_CUP_OZ). */
export function componentCost(c: CustomComponent, cupSizeOz?: number): number {
  const scale = cupSizeOz !== undefined ? cupSizeOz / REFERENCE_CUP_OZ : 1;
  const v = lineCost({ ...c.line, amount: c.line.amount * scale }, c.ingredient);
  return Number.isFinite(v) ? v : 0;
}

function selected(spec: CustomSpec, snapshot: MenuSnapshot): CustomComponent[] {
  const { bases, toppings } = customComponents(snapshot);
  const want = new Set([...spec.baseIds, ...spec.toppingIds]);
  return [...bases, ...toppings].filter((c) => want.has(c.ingredient.id));
}

/** Sum of the selected components' recipe costs. */
export function customItemCost(spec: CustomSpec, snapshot: MenuSnapshot, cupSizeOz?: number): number {
  return selected(spec, snapshot).reduce((sum, c) => sum + componentCost(c, cupSizeOz), 0);
}

/** "Custom: Hojicha powder + Banana cream" (bases first, then toppings). */
export function customItemName(spec: CustomSpec, snapshot: MenuSnapshot): string {
  const names = selected(spec, snapshot)
    .sort((a, b) => Number(a.kind === "topping") - Number(b.kind === "topping"))
    .map((c) => c.ingredient.name);
  return names.length > 0 ? `Custom: ${names.join(" + ")}` : "Custom drink";
}

/** At least one base is required; toppings are optional. */
export function isValidCustomSpec(spec: CustomSpec): boolean {
  return spec.baseIds.length >= 1;
}

/**
 * The menu item a custom id stands for, so every place that looks an item up
 * by id (price, name, adjustments) works unchanged. Not in the menu; never
 * stored. Its ingredientLines are empty: the cost comes from customItemCost.
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
    allowedMilkIds: [],
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
