import { COMBO_PRICE } from "./types";

/**
 * Custom drink ids and prices. Kept free of other lib imports so calc.ts can
 * use it without a cycle.
 *
 * A custom line is an ordinary order line whose menuItemId encodes what was
 * picked: "custom:<baseIds>|<toppingIds>". Nothing new is stored.
 */
export const CUSTOM_ID_PREFIX = "custom:";
export const CUSTOM_BASE_PRICE = 6.7;
export const CUSTOM_TOPPING_PRICE = 0.2;
/** The standalone "milk only" base (no tea). */
export const MILK_ONLY_ID = "__milk__";

export type CustomSpec = { baseIds: string[]; toppingIds: string[] };

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

/** Combo price of a drink + pastry bundle. The flat COMBO_PRICE covers a custom
 *  drink with up to one topping; each topping beyond the first adds 0.20. */
export function comboUnitPrice(drinkId: string | undefined): number {
  const spec = drinkId ? parseCustomItemId(drinkId) : null;
  if (!spec) return COMBO_PRICE;
  return cents(COMBO_PRICE + CUSTOM_TOPPING_PRICE * Math.max(0, spec.toppingIds.length - 1));
}

/** List price of a custom drink id, or undefined for any other id. */
export function customUnitPrice(id: string): number | undefined {
  const spec = parseCustomItemId(id);
  return spec ? customItemPrice(spec.toppingIds.length) : undefined;
}
