import type { MenuItem } from "./types";

/** What ADD_MENU_ITEM takes: a whole menu item minus the fields the store assigns. */
export type NewMenuItem = Omit<MenuItem, "id" | "createdAt" | "updatedAt">;

const COPY_SUFFIX = /\s\(copy(?: \d+)?\)$/;

/** "Latte" -> "Latte (copy)"; if that exists, "Latte (copy 2)", ...; duplicating a copy does not stack suffixes. */
export function copyName(name: string, existingNames: string[]): string {
  const base = name.replace(COPY_SUFFIX, "");
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  let candidate = `${base} (copy)`;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${base} (copy ${n})`;
  return candidate;
}

/**
 * An independent copy of a menu item for a similar drink: every recipe line and amount, price, size,
 * category, description, tax flag and the milk / cream choices, under a distinct name. Nothing is shared
 * with the original (lines and id lists are new objects), so editing one never changes the other, and
 * it costs exactly like the original until it is edited. The store gives it its own id and puts it at the
 * end of the menu. The copy is always active, even when the original is archived: it is a new drink.
 */
export function duplicateMenuItem(item: MenuItem, existingNames: string[]): NewMenuItem {
  return {
    name: copyName(item.name, existingNames),
    category: item.category,
    price: item.price,
    size: item.size,
    active: true,
    description: item.description,
    ingredientLines: item.ingredientLines.map((l) => ({ ...l })),
    defaultMilkId: item.defaultMilkId,
    defaultCreamId: item.defaultCreamId,
    allowedMilkIds: [...item.allowedMilkIds],
    allowedCreamIds: [...item.allowedCreamIds],
    taxable: item.taxable,
  };
}
