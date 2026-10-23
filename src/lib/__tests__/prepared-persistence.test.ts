import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromIngredient, toIngredientInsert, toIngredientPatch, type DbIngredient } from "@/lib/supabase/serialize";
import { clearSaveErrors, getSaveErrors } from "@/lib/supabase/save-errors";
import { writer } from "@/lib/supabase/writer";
import type { Ingredient } from "@/lib/types";

/**
 * Prepared ingredients must round-trip through the database rows, and the app
 * must keep working (and say so loudly) on a database without the new columns.
 */
const T = "2026-01-01T00:00:00.000Z";
const RAW: Ingredient = { id: "r1", name: "Sugar", packagePrice: 2, packageAmount: 1000, unit: "g", pool: null, createdAt: T, updatedAt: T };
const PREP: Ingredient = {
  id: "p1", name: "Banana cream", packagePrice: 0, packageAmount: 32, unit: "fl_oz", pool: null, kind: "prepared",
  subRecipe: [{ ingredientId: "r1", amount: 100, unit: "g" }], createdAt: T, updatedAt: T,
};
const row = (over: Partial<DbIngredient> = {}): DbIngredient => ({
  id: "p1", workspace_id: "w", name: "Banana cream", package_price: 0, package_amount: 32, unit: "fl_oz",
  pool: null, sort_order: null, created_at: T, updated_at: T, ...over,
});
const MISSING = { code: "PGRST204", message: "Could not find the 'sub_recipe' column of 'ingredients' in the schema cache" };

describe("serialize", () => {
  it("reads kind and sub_recipe; a row without the columns (old database) is raw", () => {
    const p = fromIngredient(row({ kind: "prepared", sub_recipe: PREP.subRecipe }));
    expect(p.kind).toBe("prepared");
    expect(p.subRecipe).toEqual(PREP.subRecipe);
    expect(p.packageAmount).toBe(32); // the yield
    expect(p.unit).toBe("fl_oz");
    const r = fromIngredient(row({ kind: "raw", sub_recipe: null }));
    expect(r.kind).toBeUndefined();
    expect(r.subRecipe).toBeUndefined();
    expect(fromIngredient(row()).kind).toBeUndefined();
  });
  it("only a prepared ingredient sends the new columns, so a raw insert works before the migration", () => {
    expect("kind" in toIngredientInsert("w", RAW)).toBe(false);
    expect("sub_recipe" in toIngredientInsert("w", RAW)).toBe(false);
    const ins = toIngredientInsert("w", PREP);
    expect(ins.kind).toBe("prepared");
    expect(ins.sub_recipe).toEqual(PREP.subRecipe);
  });
  it("a patch sends them only when they change", () => {
    expect(toIngredientPatch({ packagePrice: 3 })).toEqual({ package_price: 3 });
    expect(toIngredientPatch({ subRecipe: [] })).toEqual({ sub_recipe: [] });
  });
});

function fake(columnsMissing: boolean) {
  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const touches = (r: Record<string, unknown>) => "kind" in r || "sub_recipe" in r;
  const client = {
    from: () => ({
      insert: (r: Record<string, unknown>) => {
        inserts.push(r);
        return Promise.resolve({ error: columnsMissing && touches(r) ? MISSING : null });
      },
      update: (r: Record<string, unknown>) => {
        updates.push(r);
        const result = { error: columnsMissing && touches(r) ? MISSING : null };
        const chain = { eq: () => chain, then: (res: (v: unknown) => unknown) => Promise.resolve(result).then(res) };
        return chain;
      },
    }),
  } as unknown as SupabaseClient;
  return { client, inserts, updates };
}

describe("writer on a database without the prepared-ingredient columns", () => {
  beforeEach(() => clearSaveErrors());

  it("a raw ingredient is added and edited exactly as before, with no error", async () => {
    const { client, inserts, updates } = fake(true);
    await writer(client, "w").addIngredient(RAW);
    await writer(client, "w").updateIngredient("r1", { packagePrice: 4 });
    expect(inserts).toHaveLength(1);
    expect(updates).toEqual([{ package_price: 4 }]);
    expect(getSaveErrors()).toHaveLength(0);
  });

  it("a prepared ingredient is not silently saved as a raw one: it reports the migration", async () => {
    const { client, inserts } = fake(true);
    await writer(client, "w").addIngredient(PREP);
    expect(inserts).toHaveLength(1); // no second, raw insert
    expect(getSaveErrors()[0].message).toContain("migration-add-prepared-ingredients.sql");
  });

  it("making a raw ingredient prepared does not zero its price in the database when the columns are missing", async () => {
    const { client, updates } = fake(true);
    await writer(client, "w").updateIngredient("r1", { kind: "prepared", subRecipe: [], packagePrice: 0, name: "Renamed" });
    expect(updates).toEqual([{ kind: "prepared", sub_recipe: [], package_price: 0, name: "Renamed" }, { name: "Renamed" }]);
    expect(getSaveErrors()[0].message).toContain("migration-add-prepared-ingredients.sql");
  });

  it("with the columns present nothing is reported", async () => {
    const { client, updates } = fake(false);
    await writer(client, "w").updateIngredient("p1", { subRecipe: PREP.subRecipe });
    expect(updates).toEqual([{ sub_recipe: PREP.subRecipe }]);
    expect(getSaveErrors()).toHaveLength(0);
  });
});
