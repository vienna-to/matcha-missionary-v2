import {
  COMBO_BUCKET_ID,
  COMBO_PRICE,
  type FixedCost,
  type Ingredient,
  type IngredientLine,
  type MenuItem,
  type MenuSnapshot,
  type Order,
} from "./types";
import { sameCategory, toCanonical } from "./units";

export function ingredientCostPerCanonical(ing: Ingredient): number {
  return ing.packagePrice / toCanonical(ing.packageAmount, ing.unit);
}

export function lineCost(line: IngredientLine, ing: Ingredient): number {
  if (!sameCategory(line.unit, ing.unit)) return NaN;
  return ingredientCostPerCanonical(ing) * toCanonical(line.amount, line.unit);
}

/**
 * Compute the cost of one unit of a menu item, with optional modifier swaps
 * for milk and cream pools. If a line points to a pool ingredient, the
 * provided choice (or the item's default) is substituted at calc time.
 */
export function computeItemCost(
  item: MenuItem,
  ingredients: Ingredient[],
  opts: {
    milkChoiceId?: string;
    creamChoiceId?: string | "none";
  } = {},
): number {
  const map = new Map(ingredients.map((i) => [i.id, i]));
  let total = 0;
  for (const line of item.ingredientLines) {
    const base = map.get(line.ingredientId);
    if (!base) continue;
    let use: Ingredient | undefined = base;
    if (base.pool === "milk") {
      const id = opts.milkChoiceId ?? item.defaultMilkId;
      use = id ? map.get(id) : undefined;
      if (!use) continue;
    } else if (base.pool === "cream") {
      if (opts.creamChoiceId === "none") continue;
      const id = opts.creamChoiceId ?? item.defaultCreamId;
      use = id ? map.get(id) : undefined;
      if (!use) continue;
    }
    const c = lineCost(line, use);
    if (Number.isFinite(c)) total += c;
  }
  return total;
}

export type ItemTotals = {
  menuItemId: string;
  name: string;
  category: string;
  sortOrder: number;
  qty: number;
  priceSnap: number; // representative selling price (first observed)
  costSnapAvg: number; // average costSnap weighted by qty
  /** Effective revenue (after per-item discount). */
  revenuePaid: number;
  /** Sum of full price × qty before discount (for "you saved $X" UI). */
  revenueGross: number;
  totalCost: number;
  profit: number;
  margin: number | null;
};

export function computeItemTotals(
  snapshot: MenuSnapshot,
  orders: Order[],
): ItemTotals[] {
  const result = new Map<string, ItemTotals>();
  for (const mi of snapshot.menuItems) {
    result.set(mi.id, {
      menuItemId: mi.id,
      name: mi.name,
      category: mi.category,
      sortOrder: mi.sortOrder ?? Number.POSITIVE_INFINITY,
      qty: 0,
      priceSnap: mi.price,
      costSnapAvg: 0,
      revenuePaid: 0,
      revenueGross: 0,
      totalCost: 0,
      profit: 0,
      margin: null,
    });
  }
  // accumulate weighted cost sums separately
  const costSum = new Map<string, number>();

  // Lazy-init the combo bucket the first time we see one.
  function ensureCombo(): ItemTotals {
    const existing = result.get(COMBO_BUCKET_ID);
    if (existing) return existing;
    const fresh: ItemTotals = {
      menuItemId: COMBO_BUCKET_ID,
      name: "Combo",
      category: "other",
      // Place combos last in any sortOrder-based render.
      sortOrder: Number.POSITIVE_INFINITY - 1,
      qty: 0,
      priceSnap: COMBO_PRICE,
      costSnapAvg: 0,
      revenuePaid: 0,
      revenueGross: 0,
      totalCost: 0,
      profit: 0,
      margin: null,
    };
    result.set(COMBO_BUCKET_ID, fresh);
    return fresh;
  }

  for (const order of orders) {
    // Legacy: skip cancelled orders if the field is still present in old data.
    if (order.status === "cancelled") continue;
    for (const oi of order.items) {
      // Combos bucket together so the underlying drink and pastry don't get
      // double-counted as individual sales.
      const t = oi.isCombo ? ensureCombo() : result.get(oi.menuItemId);
      if (!t) continue;
      const discountFraction = Math.min(1, Math.max(0, (oi.discountPct ?? 0) / 100));
      const effectivePrice = oi.priceSnap * (1 - discountFraction);
      t.qty += oi.quantity;
      t.totalCost += oi.costSnap * oi.quantity;
      t.revenuePaid += effectivePrice * oi.quantity;
      t.revenueGross += oi.priceSnap * oi.quantity;
      costSum.set(oi.menuItemId, (costSum.get(oi.menuItemId) ?? 0) + oi.costSnap * oi.quantity);
    }
  }

  for (const t of result.values()) {
    t.profit = t.revenuePaid - t.totalCost;
    t.margin = t.revenuePaid > 0 ? t.profit / t.revenuePaid : null;
    t.costSnapAvg = t.qty > 0 ? t.totalCost / t.qty : 0;
  }
  return Array.from(result.values());
}

export type EventTotals = {
  totalOrders: number;
  totalCups: number;
  /** Effective revenue (after per-item discount). */
  revenuePaid: number;
  /** Gross before discount — useful for "total discounts given" math. */
  revenueGross: number;
  ingredientCost: number;
  fixedCosts: number;
  totalCost: number;
  profit: number;
  margin: number | null;
  byItem: ItemTotals[];
};

export function computeEventTotals(
  snapshot: MenuSnapshot,
  fixedCosts: FixedCost[],
  orders: Order[],
): EventTotals {
  const byItem = computeItemTotals(snapshot, orders);
  // Legacy "cancelled" orders (from before status was removed) are excluded.
  const live = orders.filter((o) => o.status !== "cancelled");
  const totalOrders = live.length;
  const totalCups = byItem.reduce((s, t) => s + t.qty, 0);
  const revenuePaid = byItem.reduce((s, t) => s + t.revenuePaid, 0);
  const revenueGross = byItem.reduce((s, t) => s + t.revenueGross, 0);
  const ingredientCost = byItem.reduce((s, t) => s + t.totalCost, 0);
  const fixedCostsSum = fixedCosts.reduce((s, f) => s + f.amount, 0);
  const totalCost = ingredientCost + fixedCostsSum;
  const profit = revenuePaid - totalCost;
  const margin = revenuePaid > 0 ? profit / revenuePaid : null;
  return {
    totalOrders,
    totalCups,
    revenuePaid,
    revenueGross,
    ingredientCost,
    fixedCosts: fixedCostsSum,
    totalCost,
    profit,
    margin,
    byItem,
  };
}

/**
 * For Menu Manager display: derived cost using the item's default milk/cream.
 */
export function defaultItemCost(item: MenuItem, ingredients: Ingredient[]): number {
  return computeItemCost(item, ingredients, {});
}

export function defaultItemMargin(item: MenuItem, ingredients: Ingredient[]): number | null {
  const cost = defaultItemCost(item, ingredients);
  if (item.price <= 0) return null;
  return (item.price - cost) / item.price;
}
