import {
  COMBO_BUCKET_ID,
  COMBO_PRICE,
  type FixedCost,
  type Ingredient,
  type IngredientLine,
  type MenuItem,
  type MenuSnapshot,
  type Order,
  type OrderItem,
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

  // Lazy-init a bucket for an order item whose menuItemId wasn't in the
  // snapshot — e.g. a menu item added in Menu Manager after this event's
  // snapshot was taken. Pulls display fields from the item's snap captured
  // at sale time so the row renders sensibly.
  function ensureItemBucket(menuItemId: string, oi: OrderItem): ItemTotals {
    const existing = result.get(menuItemId);
    if (existing) return existing;
    const fresh: ItemTotals = {
      menuItemId,
      name: oi.menuItemNameSnap || "Unknown item",
      category: "other",
      sortOrder: Number.POSITIVE_INFINITY,
      qty: 0,
      priceSnap: oi.priceSnap,
      costSnapAvg: 0,
      revenuePaid: 0,
      revenueGross: 0,
      totalCost: 0,
      profit: 0,
      margin: null,
    };
    result.set(menuItemId, fresh);
    return fresh;
  }

  for (const order of orders) {
    // Legacy: skip cancelled orders if the field is still present in old data.
    if (order.status === "cancelled") continue;
    for (const oi of order.items) {
      // Combos bucket together so the underlying drink and pastry don't get
      // double-counted as individual sales. Non-combo items use ensureItemBucket
      // so a menu item added after this event's snapshot was taken still gets
      // aggregated correctly.
      const t = oi.isCombo ? ensureCombo() : ensureItemBucket(oi.menuItemId, oi);
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
  /** Items with oz sizes (8/10/12/16 oz, or "other"). Combos count too. */
  cupsPoured: number;
  /** Items with size "pastry_count". Combos count too (drink + pastry). */
  pastriesServed: number;
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

  // Split cups/pastries by walking the same items list. Combos contribute one
  // of each (since they bundle a drink with a pastry). Bare items look up the
  // snapshot's size: "pastry_count" → pastry, else (oz / "other") → cup.
  let cupsPoured = 0;
  let pastriesServed = 0;
  for (const o of live) {
    for (const it of o.items) {
      if (it.isCombo) {
        cupsPoured += it.quantity;
        pastriesServed += it.quantity;
      } else {
        const mi = snapshot.menuItems.find((m) => m.id === it.menuItemId);
        if (mi?.size === "pastry_count") {
          pastriesServed += it.quantity;
        } else {
          cupsPoured += it.quantity;
        }
      }
    }
  }
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
    cupsPoured,
    pastriesServed,
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
 * Replace the single COMBO bucket in a byItem list with per-component splits:
 * for every combo OrderItem, add the combo's quantity to *both* the drink and
 * pastry rows, and split the combo's revenue + cost between them in proportion
 * to the components' individual menu prices. Used by Event Summary charts
 * where a single "Combo" row hides which drink/pastry was actually moving.
 *
 * The drink/pastry rows are looked up by menuItemId; if a row doesn't exist
 * yet (combo-only item with no standalone sales this event), it's synthesized
 * from the snapshot. profit/margin/costSnapAvg are recomputed at the end.
 *
 * If a combo has no resolvable price ratio (component missing from snapshot
 * or both prices zero), it's left in the COMBO bucket and that bucket is kept.
 */
export function expandCombosInByItem(
  byItem: ItemTotals[],
  snapshot: MenuSnapshot,
  orders: Order[],
): ItemTotals[] {
  type Split = { qty: number; revenue: number; revenueGross: number; cost: number };
  const splits = new Map<string, Split>();
  let unsplittableComboCount = 0;

  for (const o of orders) {
    if (o.status === "cancelled") continue;
    for (const oi of o.items) {
      if (!oi.isCombo || !oi.comboPastryId) continue;
      const drink = snapshot.menuItems.find((m) => m.id === oi.menuItemId);
      const pastry = snapshot.menuItems.find((m) => m.id === oi.comboPastryId);
      const drinkPrice = drink?.price ?? 0;
      const pastryPrice = pastry?.price ?? 0;
      const totalPrice = drinkPrice + pastryPrice;
      if (totalPrice <= 0) {
        unsplittableComboCount += oi.quantity;
        continue;
      }
      const drinkShare = drinkPrice / totalPrice;
      const pastryShare = pastryPrice / totalPrice;

      const discountFraction = Math.min(1, Math.max(0, (oi.discountPct ?? 0) / 100));
      const effectivePrice = oi.priceSnap * (1 - discountFraction);
      const lineRevenue = effectivePrice * oi.quantity;
      const lineGross = oi.priceSnap * oi.quantity;
      const lineCost = oi.costSnap * oi.quantity;

      const drinkSplit = splits.get(oi.menuItemId) ?? { qty: 0, revenue: 0, revenueGross: 0, cost: 0 };
      drinkSplit.qty += oi.quantity;
      drinkSplit.revenue += lineRevenue * drinkShare;
      drinkSplit.revenueGross += lineGross * drinkShare;
      drinkSplit.cost += lineCost * drinkShare;
      splits.set(oi.menuItemId, drinkSplit);

      const pastrySplit = splits.get(oi.comboPastryId) ?? { qty: 0, revenue: 0, revenueGross: 0, cost: 0 };
      pastrySplit.qty += oi.quantity;
      pastrySplit.revenue += lineRevenue * pastryShare;
      pastrySplit.revenueGross += lineGross * pastryShare;
      pastrySplit.cost += lineCost * pastryShare;
      splits.set(oi.comboPastryId, pastrySplit);
    }
  }

  // Drop the combo bucket (we'll re-add it only if some combos couldn't be
  // split). Clone every other row so callers' originals stay intact.
  const result = byItem
    .filter((it) => it.menuItemId !== COMBO_BUCKET_ID)
    .map((it) => ({ ...it }));

  for (const [miId, split] of splits) {
    let existing = result.find((it) => it.menuItemId === miId);
    if (!existing) {
      const mi = snapshot.menuItems.find((m) => m.id === miId);
      if (!mi) continue;
      existing = {
        menuItemId: miId,
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
      };
      result.push(existing);
    }
    existing.qty += split.qty;
    existing.revenuePaid += split.revenue;
    existing.revenueGross += split.revenueGross;
    existing.totalCost += split.cost;
  }

  // Combos with no resolvable split (missing snapshot rows / zero prices)
  // stay aggregated under the original Combo bucket so they aren't lost.
  if (unsplittableComboCount > 0) {
    const orig = byItem.find((it) => it.menuItemId === COMBO_BUCKET_ID);
    if (orig) result.push({ ...orig });
  }

  for (const it of result) {
    it.profit = it.revenuePaid - it.totalCost;
    it.margin = it.revenuePaid > 0 ? it.profit / it.revenuePaid : null;
    it.costSnapAvg = it.qty > 0 ? it.totalCost / it.qty : 0;
  }

  return result;
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
