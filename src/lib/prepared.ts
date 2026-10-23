import { preparedBatchCost } from "./calc";
import type { Ingredient, IngredientLine } from "./types";

/**
 * Prepared ingredients: made from raw ingredients, one level only.
 *
 * Rules enforced here (the reducer and the store both go through them, so the
 * local state and what is written to the database agree):
 *  - a prepared ingredient's sub-recipe holds only RAW ingredients that exist;
 *  - it never lists itself or another prepared ingredient;
 *  - an ingredient that is used in a prepared ingredient's sub-recipe cannot
 *    itself become prepared (that would make a second level).
 */

/** Prepared ingredients whose sub-recipe uses ingredient `id`. */
export function preparedUsing(id: string, ingredients: Ingredient[]): Ingredient[] {
  return ingredients.filter(
    (p) => p.kind === "prepared" && (p.subRecipe ?? []).some((l) => l.ingredientId === id),
  );
}

/** Raw ingredients a sub-recipe may use (everything but prepared ingredients and the owner). */
export function subRecipeChoices(ownerId: string | undefined, ingredients: Ingredient[]): Ingredient[] {
  return ingredients.filter((i) => i.kind !== "prepared" && i.id !== ownerId);
}

/** Drop sub-recipe lines that would break the rules (unknown, itself, prepared, not a number). */
export function sanitizeSubRecipe(
  ownerId: string | undefined,
  subRecipe: IngredientLine[],
  ingredients: Ingredient[],
): IngredientLine[] {
  const allowed = new Set(subRecipeChoices(ownerId, ingredients).map((i) => i.id));
  return subRecipe.filter((l) => allowed.has(l.ingredientId) && Number.isFinite(l.amount) && l.amount >= 0);
}

/** Why a sub-recipe line list is not acceptable, for messages. Empty when fine. */
export function subRecipeProblems(
  ownerId: string | undefined,
  subRecipe: IngredientLine[],
  ingredients: Ingredient[],
): string[] {
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const out: string[] = [];
  for (const l of subRecipe) {
    const ing = byId.get(l.ingredientId);
    if (!ing) out.push("a listed ingredient no longer exists");
    else if (ing.id === ownerId) out.push("an ingredient cannot contain itself");
    else if (ing.kind === "prepared") out.push(`"${ing.name}" is prepared; only raw ingredients can go in a recipe here`);
  }
  return out;
}

/**
 * Make an ingredient patch obey the rules, given the ingredients as they are
 * now. Returns the patch to apply AND to write to the database.
 */
export function normalizeIngredientPatch(
  ingredients: Ingredient[],
  id: string,
  patch: Partial<Ingredient>,
): Partial<Ingredient> {
  const cur = ingredients.find((i) => i.id === id);
  const p: Partial<Ingredient> = { ...patch };
  // An ingredient used inside a prepared ingredient's recipe stays raw.
  if (p.kind === "prepared" && cur?.kind !== "prepared" && preparedUsing(id, ingredients).length > 0) {
    delete p.kind;
    delete p.subRecipe;
  }
  const kind = p.kind ?? cur?.kind ?? "raw";
  if (kind === "prepared") {
    if (p.subRecipe !== undefined) p.subRecipe = sanitizeSubRecipe(id, p.subRecipe, ingredients);
    if (cur?.kind !== "prepared" || p.kind === "prepared") p.packagePrice = 0; // cost is computed
  } else if (p.kind === "raw") {
    p.subRecipe = [];
  }
  return p;
}

/** The same rules for a brand-new ingredient. */
export function normalizeNewIngredient<T extends Omit<Ingredient, "id" | "createdAt" | "updatedAt">>(
  ingredients: Ingredient[],
  ing: T,
): T {
  if (ing.kind !== "prepared") return ing;
  return { ...ing, packagePrice: 0, subRecipe: sanitizeSubRecipe(undefined, ing.subRecipe ?? [], ingredients) };
}

/** Cost of one batch and per yield unit, for display. */
export function preparedCostSummary(ing: Ingredient, ingredients: Ingredient[]) {
  const batch = preparedBatchCost(ing, ingredients);
  return { batch, perYieldUnit: ing.packageAmount > 0 ? batch / ing.packageAmount : 0 };
}
