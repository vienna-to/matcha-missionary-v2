import type { Unit } from "./types";

export type UnitCategory = "mass" | "volume" | "count";

type UnitInfo = {
  canonical: Unit;
  factor: number; // multiply by factor to get canonical value
  category: UnitCategory;
};

// Canonical units per category: g (mass), ml (volume), piece (count).
// `bag` is treated as count with factor 1 — no real conversion to/from `piece`.
// Menu Manager validates that an item's line unit matches its ingredient's unit category.
export const UNIT_TABLE: Record<Unit, UnitInfo> = {
  g: { canonical: "g", factor: 1, category: "mass" },
  oz: { canonical: "g", factor: 28.3495, category: "mass" },
  kg: { canonical: "g", factor: 1000, category: "mass" },
  lb: { canonical: "g", factor: 453.592, category: "mass" },
  ml: { canonical: "ml", factor: 1, category: "volume" },
  fl_oz: { canonical: "ml", factor: 29.5735, category: "volume" },
  cup: { canonical: "ml", factor: 236.588, category: "volume" },
  piece: { canonical: "piece", factor: 1, category: "count" },
  bag: { canonical: "piece", factor: 1, category: "count" },
};

export const UNIT_LABELS: Record<Unit, string> = {
  g: "g",
  oz: "oz",
  kg: "kg",
  lb: "lb",
  ml: "ml",
  fl_oz: "fl oz",
  cup: "cup",
  piece: "piece",
  bag: "bag",
};

export function unitCategory(u: Unit): UnitCategory {
  return UNIT_TABLE[u].category;
}

export function toCanonical(amount: number, unit: Unit): number {
  return amount * UNIT_TABLE[unit].factor;
}

export function sameCategory(a: Unit, b: Unit): boolean {
  return UNIT_TABLE[a].category === UNIT_TABLE[b].category;
}

export const UNITS_BY_CATEGORY: Record<UnitCategory, Unit[]> = {
  mass: ["g", "oz", "kg", "lb"],
  volume: ["ml", "fl_oz", "cup"],
  count: ["piece", "bag"],
};
