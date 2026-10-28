import type { Ingredient, MenuItem, MenuSnapshot } from "./types";

/**
 * The menu Edit Order prices and costs a new or changed line from.
 *
 * Live Orders sells from the CURRENT menu while an event is active, so a line added or changed in
 * Edit Order on the active event must use it too; the event's frozen snapshot only fills in items
 * or ingredients the current menu no longer has. An event that is not active keeps its frozen
 * snapshot (the current menu only adds items it lacks), so editing an old event never re-prices it
 * at today's numbers. Lines that are unchanged keep their sale-time stamps either way.
 */
export function menuForOrderEdit(
  eventSnap: MenuSnapshot,
  live: { menuItems: MenuItem[]; ingredients: Ingredient[] },
  eventIsActive: boolean,
): MenuSnapshot {
  const union = <T extends { id: string }>(first: T[], second: T[]): T[] => [
    ...first,
    ...second.filter((x) => !first.some((f) => f.id === x.id)),
  ];
  return eventIsActive
    ? {
        ...eventSnap,
        menuItems: union(live.menuItems, eventSnap.menuItems),
        ingredients: union(live.ingredients, eventSnap.ingredients),
      }
    : {
        ...eventSnap,
        menuItems: union(eventSnap.menuItems, live.menuItems),
        ingredients: union(eventSnap.ingredients, live.ingredients),
      };
}
