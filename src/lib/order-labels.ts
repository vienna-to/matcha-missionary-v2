import type { Ingredient, MenuItem, MenuSnapshot, Order, OrderItem } from "./types";

// Canonical milk options offered when taking an order. `match` resolves the
// choice to a real ingredient in the workspace (so cost calc picks up milk
// cost); with no matching ingredient we fall back to the synthetic `id` here.
export const MILK_CHOICES: Array<{ id: string; name: string; match: RegExp }> = [
  { id: "__milk_whole", name: "Whole milk", match: /whole/i },
  { id: "__milk_lactose", name: "Lactose free milk", match: /lactose/i },
];

export function resolveMilkChoices(ingredients: Ingredient[]) {
  return MILK_CHOICES.map((c) => {
    const ing = ingredients.find((i) => /milk/i.test(i.name) && c.match.test(i.name));
    return { id: ing?.id ?? c.id, name: c.name };
  });
}

export function milkLabelForId(id: string): string | undefined {
  return MILK_CHOICES.find((c) => c.id === id)?.name;
}

/** Name of the milk for a choice (or the drink's default), or undefined. */
export function resolveMilkName(
  milkChoiceId: string | undefined,
  drink: Pick<MenuItem, "defaultMilkId"> | undefined,
  ingredients: Ingredient[],
): string | undefined {
  const id = milkChoiceId ?? drink?.defaultMilkId;
  if (!id) return undefined;
  return ingredients.find((i) => i.id === id)?.name ?? milkLabelForId(id);
}

/** Name of the cream ("no cream" for the explicit none choice), or undefined. */
export function resolveCreamName(
  creamChoiceId: string | undefined,
  drink: Pick<MenuItem, "defaultCreamId"> | undefined,
  ingredients: Ingredient[],
): string | undefined {
  if (creamChoiceId === "none") return "no cream";
  const id = creamChoiceId ?? drink?.defaultCreamId;
  if (!id) return undefined;
  return ingredients.find((i) => i.id === id)?.name;
}

const PLACEHOLDER_NAMES = new Set(["", "unknown item", "unknown drink", "unknown"]);

/**
 * The drink name to show on a barista card. Prefers the name snapshotted on
 * the line item; falls back to the menu snapshot; returns null when neither
 * has a real name (the caller must then show the red warning, never a blank).
 */
export function itemDrinkName(item: OrderItem, snapshot: MenuSnapshot | undefined): string | null {
  const snap = item.menuItemNameSnap?.trim();
  if (snap && !PLACEHOLDER_NAMES.has(snap.toLowerCase())) return snap;
  const fromMenu = snapshot?.menuItems.find((m) => m.id === item.menuItemId)?.name?.trim();
  return fromMenu ? fromMenu : null;
}

/**
 * Whether an order is safe to render as a normal barista card.
 *  - "ok":      has items, every item has a drink name
 *  - "empty":   no items at all (still loading, or the item rows never arrived)
 *  - "partial": has items but at least one has no usable drink name
 */
export function orderCardIssue(
  order: Pick<Order, "items">,
  snapshot: MenuSnapshot | undefined,
): "ok" | "empty" | "partial" {
  if (order.items.length === 0) return "empty";
  if (order.items.some((it) => itemDrinkName(it, snapshot) === null)) return "partial";
  return "ok";
}

/**
 * Whether an item is a pastry. Menu Manager has no Category control (new
 * items are saved as "other"); the "Pastry" an owner picks there is the Size
 * option (`pastry_count`). So either signal counts: category "pastry" or
 * size "pastry_count".
 */
export function isPastry(item: Pick<MenuItem, "category" | "size"> | undefined): boolean {
  return item?.category === "pastry" || item?.size === "pastry_count";
}

/**
 * Whether an item takes drink adjustments (milk / cream / sugar / ice).
 * Pastries get only a special-requests box. Unknown items default to "yes" so
 * a lookup miss never silently hides drink options.
 */
export function hasDrinkAdjustments(
  item: Pick<MenuItem, "category" | "size"> | undefined,
): boolean {
  return !isPastry(item);
}
