import type {
  FixedCost,
  Ingredient,
  IngredientLine,
  MenuItem,
  MenuSnapshot,
  Order,
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
  qty: number;
  paidQty: number;
  unpaidQty: number;
  compedQty: number;
  priceSnap: number; // representative selling price (first observed)
  costSnapAvg: number; // average costSnap weighted by qty
  revenuePaid: number;
  revenueOwed: number;
  totalCost: number;
  profit: number;
  margin: number | null;
  cashPaidQty: number;
  venmoPaidQty: number;
  zellePaidQty: number;
  cardPaidQty: number;
  otherPaidQty: number;
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
      qty: 0,
      paidQty: 0,
      unpaidQty: 0,
      compedQty: 0,
      priceSnap: mi.price,
      costSnapAvg: 0,
      revenuePaid: 0,
      revenueOwed: 0,
      totalCost: 0,
      profit: 0,
      margin: null,
      cashPaidQty: 0,
      venmoPaidQty: 0,
      zellePaidQty: 0,
      cardPaidQty: 0,
      otherPaidQty: 0,
    });
  }
  // accumulate weighted cost sums separately
  const costSum = new Map<string, number>();

  for (const order of orders) {
    if (order.status === "cancelled") continue;
    for (const oi of order.items) {
      const t = result.get(oi.menuItemId);
      if (!t) continue;
      t.qty += oi.quantity;
      t.totalCost += oi.costSnap * oi.quantity;
      costSum.set(oi.menuItemId, (costSum.get(oi.menuItemId) ?? 0) + oi.costSnap * oi.quantity);
      if (order.paymentStatus === "paid") {
        t.paidQty += oi.quantity;
        t.revenuePaid += oi.priceSnap * oi.quantity;
        switch (order.paymentMethod) {
          case "cash":
            t.cashPaidQty += oi.quantity;
            break;
          case "venmo":
            t.venmoPaidQty += oi.quantity;
            break;
          case "zelle":
            t.zellePaidQty += oi.quantity;
            break;
          case "card":
            t.cardPaidQty += oi.quantity;
            break;
          case "other":
            t.otherPaidQty += oi.quantity;
            break;
        }
      } else if (order.paymentStatus === "unpaid") {
        t.unpaidQty += oi.quantity;
        t.revenueOwed += oi.priceSnap * oi.quantity;
      } else if (order.paymentStatus === "comped") {
        t.compedQty += oi.quantity;
      }
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
  paidOrders: number;
  unpaidOrders: number;
  compedOrders: number;
  cancelledOrders: number;
  totalCups: number;
  revenuePaid: number;
  revenueOwed: number;
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
  let totalOrders = 0;
  let paidOrders = 0;
  let unpaidOrders = 0;
  let compedOrders = 0;
  let cancelledOrders = 0;
  for (const o of orders) {
    if (o.status === "cancelled") {
      cancelledOrders += 1;
      continue;
    }
    totalOrders += 1;
    if (o.paymentStatus === "paid") paidOrders += 1;
    else if (o.paymentStatus === "unpaid") unpaidOrders += 1;
    else if (o.paymentStatus === "comped") compedOrders += 1;
  }
  const totalCups = byItem.reduce((s, t) => s + t.qty, 0);
  const revenuePaid = byItem.reduce((s, t) => s + t.revenuePaid, 0);
  const revenueOwed = byItem.reduce((s, t) => s + t.revenueOwed, 0);
  const ingredientCost = byItem.reduce((s, t) => s + t.totalCost, 0);
  const fixedCostsSum = fixedCosts.reduce((s, f) => s + f.amount, 0);
  const totalCost = ingredientCost + fixedCostsSum;
  const profit = revenuePaid - totalCost;
  const margin = revenuePaid > 0 ? profit / revenuePaid : null;
  return {
    totalOrders,
    paidOrders,
    unpaidOrders,
    compedOrders,
    cancelledOrders,
    totalCups,
    revenuePaid,
    revenueOwed,
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
