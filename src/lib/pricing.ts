import type { Order, OrderItem, PaymentMethod } from "./types";

/**
 * One place that answers "what did this line sell for?".
 *
 * Each order line stores `listPrice` (menu price per unit at the time of sale)
 * and `priceCharged` (what the customer actually paid per unit). Free and
 * discounted are DERIVED from those two numbers:
 *   free       = priceCharged = 0
 *   discounted = 0 < priceCharged < listPrice
 *   paid       = priceCharged > 0   (discounted lines are paid lines)
 *
 * Rows from before those columns existed (or local-storage data) carry only
 * `priceSnap` + `discountPct`. The fallback below is the exact formula the app
 * used for revenue before, so those rows produce identical numbers.
 */

export function discountFraction(discountPct: number | undefined): number {
  return Math.min(1, Math.max(0, (discountPct ?? 0) / 100));
}

/** Per-unit price after a percentage discount. */
export function chargedUnitFromPct(priceSnap: number, discountPct: number | undefined): number {
  return priceSnap * (1 - discountFraction(discountPct));
}

type PricedItem = Pick<OrderItem, "priceSnap" | "quantity"> &
  Partial<Pick<OrderItem, "listPrice" | "priceCharged" | "discountPct">>;

/** Menu price per unit at time of sale. */
export function listUnit(it: PricedItem): number {
  return it.listPrice ?? it.priceSnap;
}

/** What the customer paid per unit. */
export function chargedUnit(it: PricedItem): number {
  return it.priceCharged ?? chargedUnitFromPct(it.priceSnap, it.discountPct);
}

/** Revenue for the line: priceCharged x quantity. */
export function lineRevenue(it: PricedItem): number {
  return chargedUnit(it) * it.quantity;
}

/** Retail value of the line: listPrice x quantity. */
export function lineList(it: PricedItem): number {
  return listUnit(it) * it.quantity;
}

export type PriceKind = "free" | "discounted" | "paid";

/** Free, discounted (paid less than list) or full-price paid. */
export function priceKind(it: PricedItem): PriceKind {
  const charged = chargedUnit(it);
  if (charged <= 0) return "free";
  if (charged < listUnit(it)) return "discounted";
  return "paid";
}

export const isFreeItem = (it: PricedItem) => priceKind(it) === "free";

/**
 * Fields to write when an item's discount changes. Keeps `priceCharged` in
 * step with `discountPct` and clears the free reason once the line stops
 * being free. Callers merge the result over the item / patch.
 */
export function discountFields(
  it: PricedItem,
  discountPct: number | undefined,
  freeReason?: OrderItem["freeReason"],
): Pick<OrderItem, "discountPct" | "priceCharged" | "freeReason"> {
  const priceCharged = chargedUnitFromPct(listUnit(it), discountPct);
  return {
    discountPct,
    priceCharged,
    freeReason: priceCharged <= 0 ? freeReason : undefined,
  };
}

/**
 * Turn a patch that changes `discountPct` into one that also carries the new
 * `priceCharged` (unless the caller supplied it). Other patches pass through.
 */
export function normalizeItemPatch(it: PricedItem, patch: Partial<OrderItem>): Partial<OrderItem> {
  if (!("discountPct" in patch) || patch.priceCharged !== undefined) {
    // A free reason only makes sense on a free line.
    if (patch.priceCharged !== undefined && patch.priceCharged > 0 && patch.freeReason === undefined) {
      return { ...patch, freeReason: undefined };
    }
    return patch;
  }
  const next = discountFields(it, patch.discountPct, patch.freeReason ?? (it as OrderItem).freeReason);
  return { ...patch, ...next };
}

// ---------- extra money ----------

/** Extra money on an order (0 when none). */
export function orderTip(o: Pick<Order, "tipAmount">): number {
  return o.tipAmount && o.tipAmount > 0 ? o.tipAmount : 0;
}

/** The method an order's extra was paid with: its own, else the order's. */
export function tipMethod(
  o: Pick<Order, "tipPaymentMethod" | "paymentMethod">,
): PaymentMethod | undefined {
  return o.tipPaymentMethod ?? o.paymentMethod;
}

const cents = (n: number) => Math.round(n * 100);

/** Amount that rounds `owed` up to the next whole dollar. 0 when `owed` is
 *  already a whole dollar amount (or zero). */
export function roundUpExtra(owed: number): number {
  const c = cents(owed);
  if (c <= 0 || c % 100 === 0) return 0;
  return (100 - (c % 100)) / 100;
}
