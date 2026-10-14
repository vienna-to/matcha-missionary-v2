import { newId } from "./id";
import { isPastry } from "./order-labels";
import type { CartLine } from "./order-steps";
import { COMBO_PRICE, type MenuItem, type MenuSnapshot } from "./types";

/**
 * Combo suggestion: a drink line and a pastry line that are not already a
 * combo can be merged into one combo line when the bundle is cheaper than
 * buying them separately.
 */

export type ComboSuggestion = {
  drinkCid: string;
  pastryCid: string;
  drinkId: string;
  pastryId: string;
  /** How many combos: min(drink qty, pastry qty). */
  pairs: number;
  /** What those pairs cost separately (list prices). */
  separateTotal: number;
  /** What they cost as combos. */
  comboTotal: number;
};

/** Key for "No thanks": the same drink and pastry pair is not offered again
 *  in this order. */
export const pairKey = (drinkId: string, pastryId: string) => `${drinkId}:${pastryId}`;

/** Lines the suggestion may touch: plain (not a combo), full price (no
 *  discount, so not free either), and at least one unit. A discounted or free
 *  line is skipped on purpose: a combo has one fixed price, so there is no
 *  honest way to carry a per-line discount onto it. */
function isPlain(l: CartLine): boolean {
  return !l.isCombo && (l.discountPct ?? 0) === 0 && l.quantity > 0;
}

/** First drink + pastry pair worth offering, or null. */
export function findComboSuggestion(
  cart: CartLine[],
  snapshot: MenuSnapshot,
  dismissed: ReadonlySet<string>,
): ComboSuggestion | null {
  const lookup = (l: CartLine): MenuItem | undefined =>
    snapshot.menuItems.find((m) => m.id === l.menuItemId);
  const plain = cart.filter(isPlain);
  const isDrink = (m: MenuItem | undefined) =>
    Boolean(m) && !isPastry(m) && !(m!.category === "other" && m!.size === "other");
  const drinks = plain.filter((l) => isDrink(lookup(l)));
  const pastries = plain.filter((l) => isPastry(lookup(l)));

  for (const d of drinks) {
    for (const p of pastries) {
      if (dismissed.has(pairKey(d.menuItemId, p.menuItemId))) continue;
      const dm = lookup(d);
      const pm = lookup(p);
      if (!dm || !pm) continue;
      const pairs = Math.min(d.quantity, p.quantity);
      const separateTotal = (dm.price + pm.price) * pairs;
      const comboTotal = COMBO_PRICE * pairs;
      // Only suggest when the combo is actually cheaper for the customer.
      if (comboTotal >= separateTotal) continue;
      return {
        drinkCid: d.cid,
        pastryCid: p.cid,
        drinkId: d.menuItemId,
        pastryId: p.menuItemId,
        pairs,
        separateTotal,
        comboTotal,
      };
    }
  }
  return null;
}

/**
 * Turn the suggested pair into one combo line. The combo line is the drink
 * line (same milk, cream, sugar, ice, special requests) with the pastry
 * attached and quantity = pairs. Whatever is left of either line stays as it
 * was, with its quantity reduced.
 *
 * A combo has a single special-requests field (the drink's). A request on the
 * pastry line is folded into it as "Pastry: ..." so nothing is lost.
 */
export function applyComboSuggestion(cart: CartLine[], s: ComboSuggestion): CartLine[] {
  const drink = cart.find((l) => l.cid === s.drinkCid);
  const pastry = cart.find((l) => l.cid === s.pastryCid);
  if (!drink || !pastry) return cart;

  const drinkNote = drink.specialRequests?.trim();
  const pastryNote = pastry.specialRequests?.trim();
  const merged = [drinkNote, pastryNote ? `Pastry: ${pastryNote}` : ""].filter(Boolean).join("; ");

  const combo: CartLine = {
    ...drink,
    cid: newId("cart"),
    quantity: s.pairs,
    isCombo: true,
    comboPastryId: pastry.menuItemId,
    specialRequests: merged || undefined,
    discountPct: undefined,
    freeReason: undefined,
  };

  const out: CartLine[] = [];
  for (const l of cart) {
    if (l.cid === drink.cid) {
      out.push(combo);
      if (l.quantity - s.pairs > 0) out.push({ ...l, quantity: l.quantity - s.pairs });
    } else if (l.cid === pastry.cid) {
      if (l.quantity - s.pairs > 0) out.push({ ...l, quantity: l.quantity - s.pairs });
    } else {
      out.push(l);
    }
  }
  return out;
}

/**
 * Menu items for the combo builder. Drinks and pastries are told apart with
 * the same rule used everywhere else (isPastry: category "pastry" or size
 * "pastry_count"). An item with category "other" AND size "other" (merch, a
 * retail tin) is neither: it can't be placed, so it is left out of both lists
 * and counted in `unclassified`.
 */
export function comboChoices(items: MenuItem[]): {
  drinks: MenuItem[];
  pastries: MenuItem[];
  unclassified: number;
} {
  const drinks: MenuItem[] = [];
  const pastries: MenuItem[] = [];
  let unclassified = 0;
  for (const m of items) {
    if (isPastry(m)) pastries.push(m);
    else if (m.category === "other" && m.size === "other") unclassified += 1;
    else drinks.push(m);
  }
  return { drinks, pastries, unclassified };
}
